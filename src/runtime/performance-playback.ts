export function createPerformancePlaybackRuntime(): string {
  return `default vn_performance_active = False
default vn_performance_settings = {}
default vn_performance_skipped = False
default vn_performance_pause_end = None
default vn_performance_until = 0.0
default vn_performance_visual_tags = []
default vn_performance_transition = None
default vn_performance_dismiss_pause = True
default vn_performance_audio_channels = []
default vn_performance_keep_final_frame = False

init python:
    def vn_stage_transition(transition, duration):
        vn_flow_transition_release_capture()
        if transition is None:
            return renpy.with_statement(None)
        if getattr(vn_flow_transition_play, "restoring", None) is renpy.game.context() and renpy.game.after_rollback and renpy.game.interface.suppress_transition and preferences.transitions and not renpy.is_skipping():
            # Only a saved sequence's unconsumed phase bypasses load's one-shot
            # suppression. The normal transition API still enforces preferences
            # and skip, and the native interaction clears rollback state itself.
            renpy.mode("with")
            renpy.transition(transition, layer="master", force=True)
            root_transition = Pause(duration)
            if config.with_callback:
                root_transition = config.with_callback(root_transition, None)
            if not root_transition:
                renpy.game.interface.with_none()
                return False
            renpy.transition(root_transition, force=True)
            return renpy.ui.interact(type="with", trans_pause=True, suppress_overlay=not config.overlay_during_with, mouse="with", clear=True)
        # Layer-only with statements do not wait. A transparent root Pause keeps
        # native timing, click/skip and preferences without blending the UI.
        return renpy.with_statement({"master": transition, None: Pause(duration)})

    def vn_performance_extend(seconds):
        global vn_performance_until
        if vn_performance_active:
            vn_performance_until = max(vn_performance_until, vn_stage_clock() + max(0.0, float(seconds)))

    def vn_performance_begin(settings, keep_final_frame=False):
        global vn_performance_active, vn_performance_settings, vn_performance_skipped, vn_performance_pause_end, vn_performance_until, vn_performance_visual_tags, vn_performance_dismiss_pause, _dismiss_pause, vn_performance_audio_channels, vn_performance_keep_final_frame
        vn_performance_dismiss_pause = _dismiss_pause
        _dismiss_pause = settings.get("clickSkip", True)
        vn_performance_active = True
        vn_performance_settings = settings
        vn_performance_skipped = False
        vn_performance_pause_end = None
        vn_performance_until = vn_stage_clock()
        vn_performance_visual_tags = []
        vn_performance_audio_channels = []
        vn_performance_keep_final_frame = keep_final_frame

    def vn_performance_pause(seconds):
        global vn_performance_skipped, vn_performance_pause_end, vn_performance_until
        if not vn_bp_task_alive(vn_bp_task):
            return True
        vn_flow_transition_flush()
        vn_performance_reveal()
        if not vn_performance_active:
            return vn_bp_pause(seconds)
        if vn_performance_skipped or renpy.is_skipping():
            return True
        if vn_performance_pause_end is None:
            vn_performance_pause_end = vn_stage_clock() + max(0.0, float(seconds))
        vn_performance_until = max(vn_performance_until, vn_performance_pause_end)
        while vn_bp_task_alive(vn_bp_task) and not renpy.is_skipping() and vn_stage_clock() < vn_performance_pause_end:
            if vn_bp_pause(max(0.0, vn_performance_pause_end - vn_stage_clock()), hard=not vn_performance_settings.get("clickSkip", True)):
                if vn_performance_settings.get("clickSkip", True):
                    vn_performance_skipped = True
                    break
        vn_performance_pause_end = None
        return vn_performance_skipped

    def vn_performance_reveal():
        global vn_performance_transition
        transition = vn_performance_transition
        if not transition:
            return
        vn_performance_transition = None
        if vn_flow_transition_legacy_pending:
            renpy.retain_after_load()
        if transition["mode"] == "color":
            renpy.hide_screen("vn_performance_cover", layer="master")
            vn_stage_transition(Dissolve(transition["inDuration"]) if transition["inDuration"] else None, transition["inDuration"])
        elif transition["mode"] == "dissolve":
            vn_stage_transition(Dissolve(transition["outDuration"]) if transition["outDuration"] else None, transition["outDuration"])

    def vn_performance_finish(settings, defer_transition=False, node_id=None, port=None):
        global vn_performance_active, vn_performance_transition, vn_performance_visual_tags, _dismiss_pause
        vn_performance_reveal()
        transition = settings.get("transition") or {}
        if defer_transition:
            vn_visual_preserve_performance_frame()
            vn_flow_transition_defer_performance(transition, node_id, port)
        elif transition.get("mode") == "color":
            cover_order = max([199] + [order for tag, order in renpy.get_zorder_list("master")]) + 1
            renpy.show_screen("vn_performance_cover", color=transition["color"], _layer="master", _zorder=cover_order)
            vn_stage_transition(Dissolve(transition["outDuration"]) if transition["outDuration"] else None, transition["outDuration"])
            if transition["hold"]:
                renpy.pause(transition["hold"], hard=True)
        vn_performance_active = False
        _dismiss_pause = vn_performance_dismiss_pause
        for channel in vn_performance_audio_channels:
            renpy.music.stop(channel=channel)
            vn_audio_clips.pop(channel, None)
        for tag in vn_performance_visual_tags:
            renpy.hide(tag)
        renpy.hide_screen("vn_chapter_title", layer="master")
        vn_performance_visual_tags = []
        vn_performance_transition = transition if not defer_transition and transition.get("mode") in ("color", "dissolve") else None

    def vn_performance_reset(keep_terminal=False):
        global vn_performance_active, vn_performance_transition, vn_performance_pause_end, vn_performance_skipped, vn_performance_keep_final_frame, _dismiss_pause
        if vn_performance_active:
            _dismiss_pause = vn_performance_dismiss_pause
        vn_performance_active = False
        vn_performance_transition = None
        vn_performance_pause_end = None
        vn_performance_skipped = False
        vn_performance_keep_final_frame = False
        vn_flow_transition_reset(keep_terminal=keep_terminal)
        renpy.hide_screen("vn_chapter_title", layer="master")
        renpy.hide_screen("vn_performance_cover", layer="master")

screen vn_performance_cover(color="#000000"):
    zorder 199
    add Solid(color)
`;
}
