/** Native screen objects are never saved in tasks. Their scope stores a small
 * rollback-aware token; renpy.context() supplies the saved owning context. */
export const uiNativePageDefaults = `default vn_ui_native_page_sessions = {}
default vn_ui_native_page_serial = 0
`;

export const uiNativePageRuntime = `
    def vn_ui_input_key(text):
        # The required Input belongs to renpy.input, not a project/minigame
        # variable. Send through its normal filter/caret/length/IME handling.
        session = vn_ui_native_page_scope("ui:keyboard", create=False)
        if not vn_ui_native_page_alive(session):
            return
        widget = renpy.get_displayable("input", "input")
        if widget is None or not widget.editable:
            return
        pygame = renpy.display.behavior.pygame
        event = pygame.event.Event(pygame.KEYDOWN, key=pygame.K_BACKSPACE, unicode="", mod=0) if text is None else pygame.event.Event(pygame.TEXTINPUT, text=str(text))
        try:
            return widget.event(event, 0, 0, 0)
        except renpy.display.core.IgnoreEvent:
            pass

    def vn_ui_native_page_context(session):
        return next((context for context in renpy.game.contexts if context.info is session.get("owner")), None)

    def vn_ui_native_page_screen(session):
        context = vn_ui_native_page_context(session)
        if context is None:
            return None
        return context.scene_lists.get_displayable_by_name(session["layer"], tuple(session["screen"]))

    def vn_ui_native_page_alive(session):
        if not session:
            return False
        current = vn_ui_native_page_sessions.get(session.get("token"))
        if not current or current.get("closed") or current.get("navigation") is not None or current.get("owner") is not session.get("owner"):
            return False
        parent = session.get("parentTask")
        if parent and not vn_bp_task_alive(parent):
            return False
        screen = vn_ui_native_page_screen(session)
        if screen is not None and screen.scope.get("_vn_native_page_tokens", {}).get(session["page"]) == session["token"]:
            return True
        # Load keeps saved data but restores the base statement's earlier scene
        # list. Its say/choice screen is rebuilt before the next interaction.
        # Only that surviving owner gets this one reconstruction interval;
        # temporary menu contexts and explicitly closed pages still expire.
        return bool(renpy.game.after_rollback and current.get("didShow") and vn_ui_native_page_context(session) is not None)

    def vn_ui_native_page_displayable(page_id):
        names = vn_ui_native_page_screens.get(page_id, [])
        layers = ["screens"] + [layer for layer in config.layers if layer != "screens"]
        return next((item for name in names for layer in layers for item in [renpy.get_screen(name, layer=layer)] if item is not None and item.screen_name[0] in names), None)

    def vn_ui_native_page_scope(page_id, create=True, migrating=False):
        global vn_ui_native_page_serial, vn_ui_native_open_request
        screen = vn_ui_native_page_displayable(page_id)
        if screen is None:
            return None
        tokens = screen.scope.get("_vn_native_page_tokens", {})
        session = vn_ui_native_page_sessions.get(tokens.get(page_id))
        # A callback inherits the same displayable scope in its child context.
        # Preserve its original owner, including while a navigation is pending.
        if session and vn_ui_native_page_context(session) is not None:
            return session
        if not create: return None
        if renpy.game.after_rollback:
            restored = [record for record in vn_ui_native_page_sessions.values()
                if record.get("page") == page_id and tuple(record.get("screen", ())) == tuple(screen.screen_name)
                and record.get("layer") == screen.layer and vn_ui_native_page_screen(record) is screen
                and vn_ui_native_page_alive(record)]
            if restored:
                # Reattach the saved lease, not a fresh OnShow/page instance.
                # Earlier instances of the same screen may still await pruning.
                session = max(restored, key=lambda record: record["token"])
                screen.scope["_vn_native_page_tokens"] = dict(tokens, **{page_id: session["token"]})
                return session
        vn_ui_native_page_serial += 1
        token = vn_ui_native_page_serial
        screen.scope["_vn_native_page_tokens"] = dict(tokens, **{page_id: token})
        session = dict(token=token, page=page_id, owner=renpy.context(), screen=screen.screen_name, layer=screen.layer, didShow=False, flowToken=(vn_flow_active_step or {}).get("token"))
        vn_ui_native_page_sessions[token] = session
        request = vn_ui_native_open_request or {}
        if request.get("owner") is not renpy.context():
            request = {}
        session["parentTask"] = request.get("parentTask")
        supplied = request.get("inputs") if request.get("page") == page_id and not request.get("used") else None
        if supplied is not None:
            vn_ui_native_open_request = dict(request, used=True, key=("native", page_id, token))
        # Do not rediscover this very screen while creating its interface owner.
        task = dict(page=page_id, pageToken=token, native=session, minigame=None, flow=vn_flow_active_step)
        vn_ui_interface_prepare(page_id, supplied, system=supplied is None, task=task, migrated=migrating)
        return session

    def vn_ui_native_page_shown(page_id, blueprint_ids):
        session = vn_ui_native_page_scope(page_id)
        if not session or session.get("didShow") or not vn_ui_native_page_alive(session) or vn_game_flow_transition_page_held(session):
            return
        session["didShow"] = True
        # Restoring a screen is not a second page-entry event.
        if renpy.game.after_rollback:
            record = vn_ui_interface_for_close(page_id)
            vn_ui_interface_store(record["key"], dict(record, created=True, createdDone=True))
            return
        if blueprint_ids:
            renpy.retain_after_load()
        task = vn_bp_task_create(page_id)
        vn_ui_interface_created(page_id)
        for blueprint_id in blueprint_ids:
            if not vn_bp_task_alive(task):
                break
            vn_run_blueprint(blueprint_id, page_id=page_id, show=True)

    def vn_ui_native_page_events_ready(page_id):
        session = vn_ui_native_page_scope(page_id)
        return not vn_game_flow_transition_page_held(session)

    def vn_ui_native_page_needs_show(page_id):
        session = vn_ui_native_page_scope(page_id)
        return bool(session and not session.get("didShow") and not vn_game_flow_transition_page_held(session) and vn_ui_native_page_alive(session))

    def vn_ui_native_current_menu():
        screen = renpy.get_screen("menu")
        if screen is None:
            return None
        for page_id, names in vn_ui_native_page_screens.items():
            if screen.screen_name[0] in names:
                # Navigation/layout queries must not resurrect a closing screen
                # after pruning has released its session but before it is hidden.
                return vn_ui_native_page_scope(page_id, create=False)
        return None

    def vn_ui_defer_native_navigation(action):
        session = vn_ui_native_current_menu()
        if not session or session.get("owner") is renpy.context():
            return False
        # ShowMenu/Return in an event's copied context would only change that
        # copy, or merely dismiss its delay. Unwind cancelled callbacks first,
        # then perform the requested navigation in the actual menu context.
        if session.get("navigation") is None:
            session["navigation"] = action
        vn_bp_prune_task_resources()
        vn_bp_interrupt_wait()
        return True

    def vn_ui_native_dispatch_navigation():
        for session in list(vn_ui_native_page_sessions.values()):
            if session.get("owner") is renpy.context() and session.get("navigation") is not None:
                action = session.pop("navigation")
                result = action.vn_perform()
                # Display/value dispatchers do not necessarily return their
                # callback result to the interaction that owns this menu.
                if result is not None:
                    renpy.end_interaction(result)
                return result
        return None

    def vn_ui_native_page_is_open(page_id):
        return vn_ui_native_page_alive(vn_ui_native_page_scope(page_id, create=False))

    class VnUiClosePageNavigation(Action, DictEquality):
        def __init__(self, page_id, completion, key, force=False):
            self.page_id = page_id
            self.completion = completion
            self.key = key
            self.force = force

        def vn_perform(self):
            global vn_ui_native_page_close_result
            record = vn_ui_interface_records.get(self.key)
            if record is not None:
                if not getattr(self, "force", False):
                    vn_ui_interface_blur_for_close(record)
                vn_game_flow_source_page_closing(self.page_id, record["task"]["native"])
                record["task"]["native"]["closed"] = True
                vn_ui_interface_end(record, self.completion)
            vn_ui_native_page_close_result = dict(self.completion)
            vn_bp_prune_task_resources()
            return renpy.run(Jump("vn_bp_menu_return") if vn_bp_menu_active else VnUiMenu("main_menu") if main_menu else Return())

    def vn_ui_close_native_page(page_id, result, reason, outputs=None, force=False):
        # System content (dialogue, choices, confirmation, etc.) remains owned
        # by its adapter, while its inputs/results/events use the same records.
        if page_id not in vn_bp_page_menus:
            raise Exception("这个模板的生命周期由系统操作管理，不能直接关闭。")
        session = vn_ui_native_page_scope(page_id)
        if not session or not vn_ui_native_page_alive(session):
            return
        force = force or reason in ("parentClosed", "navigated")
        completion = vn_ui_interface_request_close(page_id, result, reason, outputs, force)
        if completion is None:
            return
        record = vn_ui_interface_for_close(page_id)
        force = force or record["key"] in vn_ui_interface_recovery
        action = VnUiClosePageNavigation(page_id, completion, record["key"], force)
        if not force:
            vn_ui_interface_blur_for_close(record)
        if session.get("owner") is renpy.context():
            return action.vn_perform()
        if session.get("navigation") is None:
            session["navigation"] = action
        vn_bp_prune_task_resources()
        renpy.restart_interaction()

    def vn_ui_native_navigation_exit(reason="navigated"):
        session = vn_ui_native_current_menu()
        if session is None:
            return
        vn_game_flow_source_page_closing(session["page"], session)
        key = ("native", session["page"], session["token"])
        record = vn_ui_interface_records.get(key)
        if record and reason != "navigated":
            vn_ui_interface_blur(record)
        session["closed"] = True
        if record:
            vn_ui_interface_end(record, vn_ui_interface_completion(session["page"], "", reason, record=record))
        vn_bp_prune_task_resources()

    def vn_ui_native_finish_context(page_id):
        completion = vn_ui_native_page_close_result
        for record in list(vn_ui_interface_records.values()):
            native = record["task"].get("native")
            if native and native.get("owner") is renpy.context():
                value = vn_ui_interface_completion(record["page"], "", "cancelled", record=record)
                native["closed"] = True
                vn_ui_interface_end(record, value)
                if completion is None:
                    completion = value
        vn_bp_prune_task_resources()
        return vn_ui_interface_result(page_id, completion or vn_ui_interface_completion(page_id, "", "cancelled"), (vn_ui_native_open_request or {}).get("key"))

    def vn_ui_native_pages_prune():
        if getattr(vn_ui_native_pages_prune, "running", False):
            return
        vn_ui_native_pages_prune.running = True
        try:
            for session in list(vn_ui_native_page_sessions.values()):
                parent = session.get("parentTask")
                if parent and not vn_bp_task_alive(parent) and not session.get("closed") and session.get("navigation") is None:
                    key = ("native", session["page"], session["token"])
                    record = vn_ui_interface_records.get(key)
                    completion = vn_ui_interface_completion(session["page"], "", "parentClosed", record=record)
                    if record:
                        vn_ui_interface_store(key, dict(record, closing=True, focused=False))
                    # Unwind the owning menu context, not a callback copy.
                    session["navigation"] = VnUiClosePageNavigation(session["page"], completion, key, True)
            expired = [session for session in list(vn_ui_native_page_sessions.values()) if not vn_ui_native_page_alive(session)]
            for page_id in {session["page"] for session in expired}:
                if not any(session["page"] == page_id and vn_ui_native_page_alive(session) for session in vn_ui_native_page_sessions.values()):
                    vn_ui_page_release(page_id)
            for session in expired:
                if session.get("navigation") is None:
                    vn_ui_native_page_sessions.pop(session["token"], None)
        finally:
            vn_ui_native_pages_prune.running = False

    def vn_ui_native_pages_clear():
        for record in list(vn_ui_interface_records.values()):
            if record["task"].get("native"):
                vn_ui_interface_end(record, vn_ui_interface_completion(record["page"], "", "navigated", record=record))
        for page_id in {session["page"] for session in vn_ui_native_page_sessions.values()}:
            vn_ui_page_release(page_id)
        vn_ui_native_page_sessions.clear()

    class VnUiMenu(ShowMenu):
        def get_sensitive(self):
            # Old authored actions can outlive an optional page being disabled.
            screen = self.screen or store._game_menu_screen
            if screen is None or not (renpy.has_screen(screen) or renpy.has_label(screen) or renpy.has_screen(screen + "_screen") or renpy.has_label(screen + "_screen")):
                return False
            return super(VnUiMenu, self).get_sensitive()

        def __call__(self):
            if self.get_sensitive() and not vn_ui_defer_native_navigation(self):
                return self.vn_perform()

        def vn_perform(self):
            # A settings sub-page remembers that the player came from its
            # parent, so Escape/right-click step back there instead of closing.
            current = renpy.get_screen("menu")
            parents = {"voice_settings": "preferences"}
            kwargs = dict(self.kwargs)
            if current is not None and parents.get(self.screen) == current.screen_name[0]:
                kwargs["vn_back"] = current.screen_name[0]
            vn_ui_native_navigation_exit()
            return ShowMenu(self.screen, *self.args, _transition=self.transition, **kwargs)()

    class VnUiNavigate(Action, DictEquality):
        def __init__(self, action):
            self.action = action

        def __call__(self):
            if not self.get_sensitive():
                return
            session = vn_ui_native_current_menu()
            if session and session["page"] in vn_bp_page_menus:
                return vn_ui_close_native_page(session["page"], "", "cancelled")
            if not vn_ui_defer_native_navigation(self):
                return self.vn_perform()

        def vn_perform(self):
            vn_ui_native_navigation_exit("cancelled")
            return renpy.run(self.action)

        def get_sensitive(self):
            return renpy.is_sensitive(self.action)

        def get_selected(self):
            return renpy.is_selected(self.action)

        def predict(self):
            renpy.display.behavior.predict_action(self.action)
`;
