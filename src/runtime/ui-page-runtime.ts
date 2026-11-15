/** Page sessions are rollback/save state; event dispatch guards remain transient. */
export const uiPageDefaults = `default vn_ui_page_sessions = {}
default vn_ui_page_order = []
default vn_ui_page_serial = 0
default vn_ui_page_completions = {}
default vn_ui_last_page_reason = "completed"
`;

export const uiPageRuntime = `
    def vn_bp_page_modal(mode):
        if mode not in ("page", "modal", "modeless", "passthrough"):
            raise Exception("页面底层输入设置无效。")
        return None if mode == "page" else mode == "modal"

    def vn_ui_opening(page_id, opening=None, wait=None, input_mode=None):
        definition = vn_custom_pages.get(page_id, {})
        settings = dict(presentation="page", wait=True, input="block" if definition.get("modal", True) else "controls", lifetime="owner", closeOnEscape=True, autoClose=0)
        settings.update(definition.get("opening") or {})
        settings.update(opening or {})
        if wait is not None:
            settings["wait"] = vn_bp_boolean(wait, "等待关闭")
        if input_mode not in (None, "page"):
            if input_mode not in ("modal", "modeless", "passthrough"):
                raise Exception("页面输入方式无效。")
            settings["input"] = {"modal": "block", "modeless": "controls", "passthrough": "none"}[input_mode]
        if settings["presentation"] not in ("page", "overlay") or settings["input"] not in ("block", "controls", "none") or settings["lifetime"] not in ("owner", "scene", "game"):
            raise Exception("页面打开方式无效。")
        settings["autoClose"] = vn_bp_number(settings["autoClose"], 0, None, "自动关闭秒数")
        settings["wait"] = vn_bp_boolean(settings["wait"], "等待关闭")
        settings["closeOnEscape"] = vn_bp_boolean(settings["closeOnEscape"], "允许 Esc 关闭")
        if settings["wait"] and settings["lifetime"] != "owner":
            raise Exception("等待关闭的页面需跟随打开者；跨章节保留请使用显示后继续。")
        if page_id not in vn_custom_pages and (settings["presentation"] != "page" or not settings["wait"] or settings["input"] != "block" or settings["lifetime"] != "owner" or settings["autoClose"] or not settings["closeOnEscape"]):
            raise Exception("此内置页面使用系统菜单，需等待关闭并接管输入。")
        return settings

    def vn_ui_page_modal(page_id):
        return vn_ui_page_sessions.get(page_id, {}).get("modal", vn_custom_pages.get(page_id, {}).get("modal", True))

    def vn_ui_visible_page_order():
        # Native menus occupy their own context. Preserve, but do not render or
        # route input to, unrelated pages underneath that context.
        menu = vn_ui_native_current_menu()
        if not menu:
            return list(vn_ui_page_order)
        depth = next((index + 1 for index, context in enumerate(renpy.game.contexts) if context.info is menu.get("owner")), len(renpy.game.contexts))
        visible = []
        for page_id in vn_ui_page_order:
            session = vn_ui_page_sessions.get(page_id, {})
            parent_task = session.get("parentTask")
            if parent_task:
                native = parent_task.get("native")
                allowed = native.get("token") == menu.get("token") if native else parent_task.get("page") in visible
            else:
                allowed = session.get("menuOwner") == menu.get("token") if "menuOwner" in session else session.get("depth", 1) >= depth
            if allowed:
                visible.append(page_id)
        return visible

    def vn_ui_pages_modal(ev=None, x=None, y=None, w=None, h=None):
        # One shared predicate for the host and control/input availability.
        return any(vn_ui_page_modal(page_id) for page_id in vn_ui_visible_page_order())

    def vn_ui_page_interactive(page_id):
        return vn_ui_page_show_ready(page_id) and vn_ui_page_sessions.get(page_id, {}).get("opening", {}).get("input") != "none"

    def vn_ui_page_show_ready(page_id):
        if vn_game_flow_transition_page_held(vn_ui_page_sessions.get(page_id)):
            return False
        pages = vn_ui_visible_page_order()
        if page_id not in pages or page_id not in vn_ui_open_pages:
            return False
        index = pages.index(page_id)
        return not any(vn_ui_page_modal(other) for other in pages[index + 1:])

    def vn_ui_page_token(page_id):
        return vn_ui_page_sessions.get(page_id, {}).get("token")

    def vn_ui_page_session_update(session, **changes):
        # Playback belongs to the page instance, not one immutable timer/show
        # record. Old saves used the session itself; keep that exact owner when
        # first replacing it so decoded events and playback are not restarted.
        updated = dict(session, **changes)
        updated["mediaOwner"] = session.get("mediaOwner", session)
        return updated

    def vn_ui_focus_page(page_id):
        # A repeated open preserves the existing instance and any nested modal.
        # It never fires OnShow again or creates a second waiting continuation.
        if page_id in vn_ui_open_pages:
            pages = vn_ui_visible_page_order()
            if page_id in pages:
                after = pages[pages.index(page_id) + 1:]
                family = {page_id}
                for other in after:
                    if vn_ui_page_sessions.get(other, {}).get("parent") in family:
                        family.add(other)
                if not any(vn_ui_page_modal(other) for other in after if other not in family):
                    moving = [other for other in vn_ui_page_order if other in family]
                    vn_ui_page_order[:] = [other for other in vn_ui_page_order if other not in family] + moving
            vn_ui_cancel_pointer()
            renpy.restart_interaction()

    def vn_ui_page_begin(page_id, wait=False, modal=None, inputs=None, auto=0.0, confirm=False, allow_skip=False, opening=None):
        global vn_ui_page_serial
        if page_id not in vn_custom_pages:
            raise Exception("页面不存在，请重新选择。")
        if page_id in vn_ui_open_pages:
            vn_ui_focus_page(page_id)
            return None
        if modal is not None and not isinstance(modal, bool):
            raise Exception("页面底层输入设置必须为开关。")
        inputs = vn_ui_interface_inputs(page_id, inputs)
        settings = vn_ui_opening(page_id, opening, wait, None if modal is None else "modal" if modal else ("passthrough" if (opening or {}).get("input") == "none" else "modeless"))
        modal = settings["input"] == "block"
        if modal:
            vn_ui_cancel_pointer()
        vn_ui_page_serial += 1
        token = vn_ui_page_serial
        owner_task = vn_bp_task or vn_bp_task_create()
        visible_pages = vn_ui_visible_page_order()
        parent = None
        if settings["lifetime"] == "owner":
            parent = owner_task.get("page") if owner_task.get("page") in vn_ui_open_pages else (visible_pages[-1] if visible_pages and not owner_task.get("page") else None)
        vn_ui_page_results.pop(page_id, None)
        vn_ui_page_sessions[page_id] = dict(token=token, owner=renpy.context(), mediaOwner=dict(page=page_id, token=token), modal=modal, opening=settings, scene=vn_current_scene, parent=parent, inputs=dict(inputs or {}), values={}, auto=float(auto) if auto else settings["autoClose"], autoElapsed=0.0, confirm=bool(confirm), allowSkip=bool(allow_skip), depth=len(renpy.game.contexts), menuOwner=(vn_ui_native_current_menu() or {}).get("token"), parentTask=owner_task if owner_task.get("page") and settings["lifetime"] == "owner" else None, flowToken=(vn_flow_active_step or {}).get("token"), didShow=False)
        vn_ui_open_pages[page_id] = "waiting" if wait else "shown"
        vn_ui_page_order.append(page_id)
        vn_ui_interface_prepare(page_id, inputs)
        renpy.restart_interaction()
        return token

    def vn_ui_open_page(page_id, modal=None, inputs=None, opening=None):
        vn_bp_page_label(page_id, False, modal)
        return vn_ui_page_begin(page_id, False, modal, inputs, opening=opening)

    def vn_ui_page_cancel_target():
        for page_id in reversed(vn_ui_visible_page_order()):
            session = vn_ui_page_sessions.get(page_id, {})
            settings = session.get("opening", {})
            if vn_ui_page_interactive(page_id) and settings.get("closeOnEscape", True):
                return page_id
            if session.get("modal"):
                break
        return None

    def vn_ui_pages_enter_scene(scene_id):
        for page_id in list(reversed(vn_ui_page_order)):
            session = vn_ui_page_sessions.get(page_id, {})
            if session.get("opening", {}).get("lifetime") != "scene":
                continue
            if session.get("scene") is None:
                vn_ui_page_sessions[page_id] = vn_ui_page_session_update(session, scene=scene_id)
            elif session["scene"] != scene_id:
                vn_ui_close_page(page_id, "", "navigated", force=True)

    def vn_ui_pages_auto_tick():
        now = renpy.display.core.get_time()
        previous = getattr(vn_ui_pages_auto_tick, "samples", {})
        samples = {}
        visible = vn_ui_visible_page_order()
        for page_id in list(visible):
            session = vn_ui_page_sessions.get(page_id, {})
            duration = session.get("auto", 0)
            if duration <= 0 or not session.get("didShow"):
                continue
            before = previous.get(page_id)
            delta = max(0.0, now - before[1]) if before and before[0] is session else 0.0
            session = vn_ui_page_session_update(session, autoElapsed=session.get("autoElapsed", 0.0) + delta)
            vn_ui_page_sessions[page_id] = session
            renpy.retain_after_load()
            samples[page_id] = (session, now)
            if session["autoElapsed"] >= duration:
                # Disable before dispatch, so a blocked close does not reopen a
                # confirmation on every frame. Only the first request is automatic.
                session["auto"] = 0
                vn_ui_close_page(page_id, "完成", "completed", session.get("token"))
        vn_ui_pages_auto_tick.samples = samples

    def vn_ui_page_shown(page_id, token, blueprint_ids):
        # A used screen added to the permanent host does not get a native show
        # event. Persist dispatch on the session, not on a rebuilt displayable.
        session = vn_ui_page_sessions.get(page_id, {})
        if page_id not in vn_ui_open_pages or session.get("token") != token or session.get("didShow", True) or vn_game_flow_transition_page_held(session):
            return
        vn_ui_page_sessions[page_id] = vn_ui_page_session_update(session, didShow=True)
        renpy.retain_after_load()
        vn_ui_interface_created(page_id)
        for blueprint_id in blueprint_ids:
            if page_id not in vn_ui_open_pages or vn_ui_page_token(page_id) != token:
                break
            vn_run_blueprint(blueprint_id, page_id=page_id, show=True)

    def vn_ui_page_input(page_id, name, fallback=""):
        return vn_ui_page_sessions.get(page_id, {}).get("inputs", {}).get(name, fallback)

    def vn_ui_page_release(page_id):
        component_ids = vn_custom_pages.get(page_id, {}).get("componentIds", vn_ui_native_page_components.get(page_id, []))
        vn_ui_cancel_pointer(component_ids)
        for key in list(vn_ui_animations):
            if key[0] in component_ids:
                vn_ui_animations.pop(key, None)
        vn_parameter_flush_animations()
        for component_id in component_ids:
            vn_ui_overrides.pop(component_id, None)
            vn_ui_control_reset_options(component_id)
            vn_ui_image_release(component_id)
            vn_ui_video_release(component_id)
            vn_ui_spine_release(component_id)

    def vn_ui_page_cleanup(page_id, token=None):
        # An older caller may return after a new instance of the same page opens.
        if token is not None:
            vn_ui_page_completions.pop(token, None)
        if token is not None and token != vn_ui_page_token(page_id):
            return
        vn_ui_page_release(page_id)
        vn_ui_open_pages.pop(page_id, None)
        vn_ui_page_sessions.pop(page_id, None)
        vn_ui_page_results.pop(page_id, None)
        if page_id in vn_ui_page_order:
            vn_ui_page_order.remove(page_id)

    def vn_ui_close_page(page_id, result="完成", reason="completed", token=None, outputs=None, force=False):
        if reason not in ("completed", "cancelled", "parentClosed", "navigated"):
            raise Exception("页面关闭原因无效，请选择完成或取消。")
        if page_id in vn_ui_native_page_screens:
            return vn_ui_close_native_page(page_id, result, reason, outputs, force)
        if page_id not in vn_ui_open_pages or token is not None and token != vn_ui_page_token(page_id):
            return
        completion = vn_ui_interface_request_close(page_id, result, reason, outputs, force or reason in ("parentClosed", "navigated"))
        if completion is None:
            return
        record = vn_ui_interface_for_close(page_id)
        if not force and reason in ("completed", "cancelled") and record["key"] not in vn_ui_interface_recovery:
            vn_ui_interface_blur_for_close(record)
        if page_id not in vn_ui_open_pages or vn_ui_page_token(page_id) != record["task"].get("pageToken"):
            return
        vn_game_flow_source_page_closing(page_id, vn_ui_page_sessions.get(page_id), reason)
        # Close descendants from the top down so their owners cannot regain focus
        # or continue timers after their parent has disappeared.
        for child in list(reversed(vn_ui_page_order)):
            if vn_ui_page_sessions.get(child, {}).get("parent") == page_id:
                vn_ui_close_page(child, "", "parentClosed")
        session = vn_ui_page_sessions[page_id]
        mode = vn_ui_open_pages.pop(page_id)
        vn_ui_page_results[page_id] = str(result)
        if mode == "waiting":
            vn_ui_page_completions[session["token"]] = completion
        if page_id in vn_ui_page_order:
            vn_ui_page_order.remove(page_id)
        vn_ui_page_release(page_id)
        if mode == "shown":
            vn_ui_page_sessions.pop(page_id, None)
            vn_ui_page_results.pop(page_id, None)
        vn_ui_interface_end(record, completion)
        vn_bp_prune_task_resources()
        renpy.restart_interaction()

    def vn_ui_page_done(page_id, token):
        return token in vn_ui_page_completions or page_id not in vn_ui_open_pages or token != vn_ui_page_token(page_id)

    def vn_ui_page_completion(token):
        return vn_ui_page_completions.get(token, dict(result="", reason="navigated"))

    def vn_ui_interrupted_page_wait():
        # The task guard can win the timer race after an ancestor closes. Read
        # the waiting screen's saved token, never a possibly reopened session.
        # Screens copied into a child context are not that child's call screen.
        # New defaults also initialize when a released 0.8.0 call resumes here.
        owner = renpy.context()
        for page_id in vn_custom_pages:
            screen = renpy.get_screen("vn_custom_page_" + page_id)
            if screen is None or not screen.scope.get("_vn_waiting") or screen.scope.get("_vn_wait_context") is not owner:
                continue
            token = screen.scope.get("_vn_wait_token")
            if token is not None and vn_ui_page_done(page_id, token):
                return dict(vn_ui_page_completion(token), token=token)
        return True

    def vn_ui_cancel_page(page_id):
        if page_id in vn_ui_open_pages:
            vn_ui_close_page(page_id, "取消", "cancelled")
        elif vn_minigame_owns_page(page_id):
            vn_finish_minigame("cancel")

    def vn_ui_page_tasks_prune():
        if getattr(vn_ui_page_tasks_prune, "running", False):
            return
        vn_ui_page_tasks_prune.running = True
        try:
            vn_ui_pages_auto_tick()
            # Native menus, custom pages and legacy minigames can all own
            # children. A copied callback's lifetime is not the page lifetime.
            for page_id, session in list(vn_ui_page_sessions.items()):
                parent_task = session.get("parentTask")
                if parent_task and not vn_bp_task_alive(parent_task) and page_id in vn_ui_open_pages:
                    vn_ui_close_page(page_id, "", "parentClosed")
        finally:
            vn_ui_page_tasks_prune.running = False

    def vn_ui_clear_pages():
        vn_ui_pages_auto_tick.samples = {}
        vn_ui_native_pages_clear()
        for page_id in list(reversed(vn_ui_page_order)):
            vn_ui_close_page(page_id, "", "navigated", force=True)
            vn_ui_page_cleanup(page_id)
        for record in list(vn_ui_interface_records.values()):
            vn_ui_interface_end(record, vn_ui_interface_completion(record["page"], "", "navigated", record=record))
        vn_ui_page_sessions.clear()
        vn_ui_page_results.clear()
        vn_ui_page_completions.clear()
        vn_ui_open_pages.clear()
        vn_ui_page_order[:] = []
        vn_bp_prune_task_resources()

    def vn_ui_pages_after_load():
        vn_ui_pages_auto_tick.samples = {}
        # Restored base-context calls and shown overlays keep their saved state.
        # Temporary event contexts do not survive loading a save.
        for page_id in list(vn_ui_page_sessions):
            session = vn_ui_page_sessions[page_id]
            if page_id not in vn_custom_pages or vn_ui_open_pages.get(page_id) == "waiting" and session.get("depth", 1) > len(renpy.game.contexts):
                vn_ui_page_cleanup(page_id)
        vn_ui_cancel_pointer()
        vn_bp_prune_task_resources()

    config.after_load_callbacks.append(vn_ui_pages_after_load)
`;

export const uiPageWaitScreen = `screen vn_ui_page_wait(page_id, token):
    zorder 1
    timer 0.02 repeat True action If(vn_ui_page_done(page_id, token), Return(dict(vn_ui_page_completion(token), token=token)), NullAction())
`;
