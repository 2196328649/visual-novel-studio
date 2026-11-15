/** Rollback-aware task scopes shared by nested labels, not by unrelated UI callbacks. */
export const blueprintTaskRuntime = `default vn_bp_task = None
default vn_bp_wait = None

init python:
    def vn_bp_task_create(page_id=None, create_native=True):
        # A legacy minigame's initializer is a story call, not a page event.
        # Give its work the same run token as subsequent authored controls.
        if page_id is None and vn_minigame_finished is None:
            page_id = vn_minigames.get((vn_minigame_context or {}).get("minigameId"), {}).get("uiPageId")
        page = page_id if page_id in vn_custom_pages or page_id in vn_ui_native_page_screens else None
        native = vn_ui_native_page_scope(page, create_native) if page in vn_ui_native_page_screens else None
        token = native.get("token") if native else vn_ui_page_token(page) if page else None
        game = None
        # Minigame pages predate page sessions and retain their own lifetime.
        if page and token is None:
            context = vn_minigame_context or {}
            definition = vn_minigames.get(context.get("minigameId"), {})
            if definition.get("uiPageId") == page:
                game = (context.get("minigameId"), context.get("runKey"), context.get("token"))
        return dict(page=page, pageToken=token, native=native, minigame=game, flow=vn_flow_active_step)

    def vn_bp_task_alive(task):
        if task is None:
            return True
        if task.get("async") and not vn_bp_async_active(vn_bp_async_tasks.get(task["async"], {})):
            return False
        if (task.get("flow") or {}).get("cancelled", False):
            return False
        page = task.get("page")
        if not page:
            return True
        if page in vn_ui_native_page_screens:
            return vn_ui_native_page_alive(task.get("native"))
        if task.get("minigame") is not None:
            context = vn_minigame_context or {}
            return vn_minigame_finished is None and task["minigame"] == (context.get("minigameId"), context.get("runKey"), context.get("token"))
        return page in vn_ui_open_pages and task.get("pageToken") is not None and task["pageToken"] == vn_ui_page_token(page)

    def vn_bp_protect_flow_skip(task):
        flow = (task or {}).get("flow") or {}
        if flow.get("kind") != "blueprint" or flow.get("allowSkip", False):
            return False
        # The owning flow step also governs nested timelines and page callbacks.
        # Ren'Py restores these store flags on return, including after loading a
        # saved call. Screen buttons and confirmation actions remain interactive.
        renpy.dynamic(_skipping=False, _dismiss_pause=False)
        renpy.stop_skipping()
        return True

    def vn_bp_prune_task_resources():
        vn_ui_native_pages_prune()
        vn_ui_control_prune_popup()
        vn_ui_page_tasks_prune()
        vn_ui_lifecycle_tick()
        vn_ui_state_prune()
        vn_bp_async_prune()
        for key, state in list(vn_ui_animations.items()):
            if not vn_bp_task_alive(state.get("task")):
                vn_ui_animations.pop(key, None)
        vn_parameter_flush_animations()
        vn_visual_cleanup()
        vn_audio_clip_tick()

    def vn_bp_interrupt_wait():
        # A cancelled page call still has to return its instance completion.
        # Other interactions use True to dismiss; the next checkpoint cancels.
        renpy.end_interaction(vn_ui_interrupted_page_wait())

    def vn_bp_wait_owned(wait):
        if wait is None:
            return False
        # Old saves did not record an owner. Only the saved main context may
        # resume those waits; a menu must not adopt an inherited parent wait.
        if "owner" not in wait:
            return renpy.context_nesting_level() == 0
        return wait["owner"] is renpy.context() and wait.get("depth") == renpy.context_nesting_level()

    def vn_bp_sample_wait_context():
        # The native menu inherits store values but runs its own interaction.
        # Re-anchor when returning to the wait's context, excluding time spent
        # in a menu/callback. Ordinary screen restarts keep their last sample.
        sample = getattr(vn_bp_poll_task, "sample", None)
        context = renpy.game.context()
        context.info.vn_bp_active_wait = vn_bp_wait if vn_bp_wait_owned(vn_bp_wait) else None
        if not vn_bp_wait_owned(vn_bp_wait):
            vn_bp_poll_task.sample = None
        elif sample is None or sample[0] is not vn_bp_wait or sample[2] is not context:
            vn_bp_poll_task.sample = (vn_bp_wait, renpy.display.core.get_time(), context)

    def vn_bp_poll_task():
        global vn_bp_wait
        vn_bp_prune_task_resources()
        vn_ui_native_dispatch_navigation()
        vn_ui_image_poll()
        vn_ui_video_poll()
        vn_ui_spine_poll()
        vn_bp_async_tick()
        if vn_bp_wait is not None and not vn_bp_wait_owned(vn_bp_wait):
            # Resource maintenance still runs in menus, but the parent wait
            # must neither consume time nor end the menu's ui.interact().
            vn_bp_poll_task.sample = None
            return
        if not vn_bp_task_alive(vn_bp_task):
            vn_bp_interrupt_wait()
        if vn_bp_wait is None:
            return
        now = renpy.display.core.get_time()
        sample = getattr(vn_bp_poll_task, "sample", None)
        # A loaded/rolled-back record has a new identity, so offline time is
        # never counted. A screen restart, unlike a new task, keeps this clock.
        context = renpy.game.context()
        delta = max(0.0, now - sample[1]) if sample and sample[0] is vn_bp_wait and sample[2] is context else 0.0
        vn_bp_wait = dict(vn_bp_wait, elapsed=vn_bp_wait["elapsed"] + delta)
        context.info.vn_bp_active_wait = vn_bp_wait
        vn_bp_poll_task.sample = (vn_bp_wait, now, context)
        vn_stage_retain_wait_clock(now)
        renpy.retain_after_load()
        if vn_bp_wait["elapsed"] >= vn_bp_wait["duration"]:
            renpy.end_interaction(False)

    def vn_bp_pause(seconds, hard=False):
        global vn_bp_wait
        if not vn_bp_task_alive(vn_bp_task):
            return True
        if vn_bp_wait is not None and not vn_bp_wait_owned(vn_bp_wait):
            # Compiled callbacks already scope this variable. Also protect a
            # wait entered directly from a native menu: its saved roots still
            # refer to the suspended parent's record, restored on return.
            renpy.context_dynamic("vn_bp_wait")
            vn_bp_wait = None
        # Also cover a saved wait whose label entry predates the flow guard.
        if vn_bp_protect_flow_skip(vn_bp_task):
            hard = True
        vn_flow_transition_flush()
        vn_game_flow_source_extend(vn_stage_clock() + max(0.0, float(seconds)))
        if vn_bp_wait is None:
            vn_bp_wait = dict(owner=renpy.context(), depth=renpy.context_nesting_level(), duration=vn_bp_number(seconds, 0, None, "等待秒数"), elapsed=0.0)
            vn_bp_poll_task.sample = (vn_bp_wait, renpy.display.core.get_time(), renpy.game.context())
        renpy.context().vn_bp_active_wait = vn_bp_wait
        # Even a save before the first timer tick must retain the active wait.
        renpy.retain_after_load()
        try:
            # Native timed pauses hold beneath modal screens and return early
            # after load/rollback. Neither should finish or starve a task wait.
            while vn_bp_task_alive(vn_bp_task) and not renpy.is_skipping() and vn_bp_wait["elapsed"] < vn_bp_wait["duration"]:
                if renpy.pause(max(0.0, vn_bp_wait["duration"] - vn_bp_wait["elapsed"]), hard=hard, modal=False):
                    return True
            return not vn_bp_task_alive(vn_bp_task)
        finally:
            vn_bp_wait = None
            renpy.context().vn_bp_active_wait = None

    class VnUiActions(Action, DictEquality):
        def __init__(self, page_id, actions):
            self.page_id = page_id
            self.actions = actions

        def __call__(self):
            task = vn_bp_task_create(self.page_id)
            result = None
            for action in self.actions:
                if not vn_bp_task_alive(task):
                    break
                value = renpy.run(action)
                if value is not None:
                    result = value
            return result

        def get_sensitive(self):
            return renpy.is_sensitive(self.actions)

        def get_selected(self):
            return renpy.is_selected(self.actions)

        def predict(self):
            renpy.display.behavior.predict_action(self.actions)

        def periodic(self, st):
            return renpy.display.behavior.run_periodic(self.actions, st)

        def unhovered(self):
            renpy.display.behavior.run_unhovered(self.actions)

    config.interact_callbacks.append(vn_bp_sample_wait_context)
    config.always_shown_screens.append("vn_blueprint_task_guard")

screen vn_blueprint_task_guard():
    zorder 200
    if vn_ui_interface_records or vn_ui_video_live() or vn_ui_spine_has_live() or vn_bp_async_needs_tick() or vn_ui_native_page_sessions or vn_bp_wait is not None or vn_bp_task and (vn_bp_task.get("page") or vn_bp_task.get("flow")):
        timer 0.02 repeat True action Function(vn_bp_poll_task, _update_screens=False)
`;
