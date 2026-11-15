/** Lifecycle boundaries include native screens. Story boundaries keep their
 * existing master-only renderer; both consume at the same presentation points. */
export const gameFlowTransitionRuntime = `default vn_game_flow_transition_request = None
default vn_game_flow_transition_active = None
default vn_game_flow_transition_snapshot = None
default vn_game_flow_source_scope = None
default vn_game_flow_source_hold = None
default vn_game_flow_movie = None

init python:
    def vn_game_flow_transition_seconds(spec):
        if not spec or not preferences.transitions or renpy.is_skipping():
            return 0.0
        if spec.get("mode") == "dissolve":
            return max(0.0, float(spec.get("duration", 0)))
        if spec.get("mode") == "color":
            return sum(max(0.0, float(spec.get(key, 0))) for key in ("outDuration", "hold", "inDuration"))
        return 0.0

    def vn_game_flow_transition_owned(record):
        return record is not None and record.get("owner") is renpy.context() and record.get("depth") == renpy.context_nesting_level()

    def vn_game_flow_transition_holding():
        return vn_game_flow_transition_owned(vn_game_flow_transition_active or vn_game_flow_transition_request)

    def vn_game_flow_transition_render_holding():
        return vn_game_flow_transition_active is not None or vn_game_flow_transition_request is not None

    def vn_game_flow_transition_capture():
        global vn_game_flow_transition_snapshot
        # One last actually drawn frame, before releasing its page/media. Bytes
        # are saveable; no Render/texture or frame history enters the save state.
        vn_game_flow_transition_snapshot = renpy.screenshot_to_bytes((config.screen_width, config.screen_height))

    def vn_game_flow_transition_queue(transition, node_id=None, port="next"):
        global vn_game_flow_transition_request
        if transition is None:
            return
        vn_game_flow_transition_request = dict(transition=dict(transition), nodeId=node_id, port=port, owner=renpy.context(), depth=renpy.context_nesting_level())
        # A transparent logical step changes only the chosen effect. It must
        # never replace the last visible source with the now empty scene list.

    def vn_game_flow_source_begin(step, preserve=False):
        global vn_game_flow_source_scope
        vn_game_flow_source_scope = dict(token=step["token"], owner=renpy.context(), depth=renpy.context_nesting_level(), preserve=preserve, until=vn_stage_clock(), presented=False, captured=False)

    def vn_game_flow_source_current():
        scope = vn_game_flow_source_scope
        return scope if vn_game_flow_transition_owned(scope) and (vn_flow_active_step or {}).get("token") == scope.get("token") else None

    def vn_game_flow_source_extend(deadline):
        scope = vn_game_flow_source_current()
        if scope is not None:
            scope["until"] = max(scope["until"], float(deadline))

    def vn_game_flow_source_visual(data, started=None):
        scope = vn_game_flow_source_current()
        if scope is None or data.get("persistent"):
            return
        started = vn_stage_clock() if started is None else started
        data["_vn_game_flow_source"] = scope
        data["_vn_game_flow_end"] = started + data["duration"]
        scope["until"] = max(scope["until"], data["_vn_game_flow_end"])
        if scope["preserve"]:
            data["_vn_keep_final_frame"] = True
        for child in data.get("children") or []:
            vn_game_flow_source_visual(child, started + child.get("startAt", 0.0))

    def vn_game_flow_source_holds(data):
        scope = data.get("_vn_game_flow_source")
        return bool(scope and scope.get("preserve") and scope is vn_game_flow_source_scope and data.get("_vn_game_flow_end", -1) >= scope["until"] - 0.03)

    def vn_game_flow_source_presented():
        scope = vn_game_flow_source_current()
        if scope is not None and vn_game_flow_transition_active is None:
            scope["presented"] = True

    config.interact_callbacks.append(vn_game_flow_source_presented)

    def vn_game_flow_source_release_hold(clear_snapshot=False):
        global vn_game_flow_source_hold, vn_game_flow_transition_snapshot
        vn_game_flow_source_hold = None
        # The always-shown host is re-created empty before the target root is
        # built. No copy of the source image may survive in the new root.
        renpy.hide_screen("vn_game_flow_source_cover")
        if clear_snapshot:
            vn_game_flow_transition_snapshot = None

    def vn_game_flow_source_cover_visible():
        return vn_game_flow_transition_owned(vn_game_flow_source_hold) and vn_game_flow_transition_snapshot is not None

    def vn_game_flow_source_page_closing(page_id, session, reason="completed"):
        global vn_game_flow_source_hold
        scope, step = vn_game_flow_source_scope, vn_flow_active_step
        if scope is None or not scope.get("preserve") or not step or step.get("kind") != "page" or step.get("pageId") != page_id:
            return
        if not session or session.get("flowToken") != scope.get("token") or scope.get("token") != step.get("token"):
            return
        waiting = page_id in vn_custom_pages and vn_ui_open_pages.get(page_id) == "waiting" and step.get("pageWait", True)
        if page_id in vn_custom_pages:
            if not waiting:
                return
            if reason in ("cancelled", "parentClosed", "navigated") and step.get("cancelToTitle", False):
                # This completion returns to title instead of taking the authored
                # next wire. Do not preserve a screenshot while that call unwinds.
                scope["preserve"] = False
                vn_game_flow_source_release_hold(clear_snapshot=True)
                return
        if not scope.get("captured"):
            vn_game_flow_transition_capture()
            scope["captured"] = True
        if waiting and vn_game_flow_transition_snapshot is not None:
            # Closing removes the live page before its call-screen timer can
            # return. Only its pixels bridge that gap; events/media stay closed.
            # A callback can close from a child context: the host belongs to the
            # original flow owner, not the callback's copied screen list.
            vn_game_flow_source_hold = dict(owner=scope["owner"], depth=scope["depth"], token=scope["token"], pageId=page_id, pageToken=session["token"])

    def vn_game_flow_source_finish():
        global vn_game_flow_source_scope
        scope = vn_game_flow_source_current()
        if scope is None:
            return
        step = vn_flow_active_step or {}
        retains_page = step.get("kind") != "page" or step.get("pageWait", True)
        if retains_page and scope["preserve"] and scope["presented"] and not scope["captured"]:
            vn_game_flow_transition_capture()
            scope["captured"] = True
        # Timed source objects belong to this step, not the next story. Existing
        # persistent stage objects and unrelated page/async media keep ownership.
        for tag, entry in list(vn_visual_instances.items()):
            data = entry["data"]
            if data.get("_vn_game_flow_source") is not scope:
                continue
            if not data.get("_vn_expired") and vn_visual_age(data) < data["duration"] and not (vn_flow_active_step or {}).get("cancelled"):
                data.pop("_vn_game_flow_source", None)
                continue
            vn_stop_visual_media(data, force=True)
            for retired in (entry.get("blend").old_data if entry.get("blend") else []):
                vn_stop_visual_media(retired, force=True)
            vn_visual_instances.pop(tag, None)
            renpy.hide(tag)
        for channel, clip in list(vn_audio_clips.items()):
            if ((clip.get("task") or {}).get("flow") or {}).get("token") == scope["token"] and (clip.get("elapsed", 0) >= clip["duration"] or (vn_flow_active_step or {}).get("cancelled")):
                renpy.music.stop(channel=channel, fadeout=0)
                vn_audio_clips.pop(channel, None)
        vn_game_flow_source_scope = None

    class VnGameFlowTransition:
        def __init__(self, spec, snapshot):
            self.spec, self.snapshot = spec, snapshot

        def __call__(self, old_widget=None, new_widget=None):
            old = Transform(im.Data(self.snapshot, "vn-game-flow-source.png"), xysize=(config.screen_width, config.screen_height)) if self.snapshot else old_widget
            if self.spec.get("mode") == "dissolve":
                effect = Dissolve(float(self.spec.get("duration", 0)))
            else:
                effect = Fade(float(self.spec.get("outDuration", 0)), float(self.spec.get("hold", 0)), float(self.spec.get("inDuration", 0)), color=self.spec.get("color", "#000000"))
            # Store transitions are curried factories: bind the actual roots in
            # their second call so Ren'Py receives a Displayable, not a Partial.
            return effect(old_widget=old, new_widget=new_widget)

    def vn_game_flow_transition_resume():
        global vn_game_flow_transition_active, vn_game_flow_transition_snapshot
        active = vn_game_flow_transition_active
        if not vn_game_flow_transition_owned(active):
            return
        elapsed = max(0.0, vn_bp_clock() - active["raw"])
        owner = renpy.context()
        owner.vn_stage_transition_offset = getattr(owner, "vn_stage_transition_offset", 0.0) + elapsed
        vn_game_flow_source_release_hold()
        vn_game_flow_transition_active = None
        vn_game_flow_transition_snapshot = None
        vn_flow_transition_resume_targets(elapsed)
        renpy.retain_after_load()

    def vn_game_flow_transition_flush():
        global vn_game_flow_transition_request, vn_game_flow_transition_active, vn_game_flow_transition_snapshot
        global vn_flow_transition_request, vn_flow_transition_fallback, vn_flow_transition_captured, vn_pending_scene_transition, vn_performance_transition
        active = vn_game_flow_transition_active
        if active is not None:
            if not vn_game_flow_transition_owned(active) or getattr(vn_game_flow_transition_flush, "owner", None) is renpy.game.context():
                return False
            vn_game_flow_transition_resume()
            return True
        request = vn_game_flow_transition_request
        if not vn_game_flow_transition_owned(request):
            hold = vn_game_flow_source_hold
            scope = vn_game_flow_source_current()
            if request is None and vn_game_flow_transition_owned(hold) and (scope is None or scope.get("token") != hold.get("token")):
                # A transparent step can leave no effect at the next real
                # presentation. That boundary still releases the closed page.
                vn_game_flow_source_release_hold(clear_snapshot=True)
            return False
        spec = request["transition"]
        vn_game_flow_transition_request = None
        # Native destinations may transfer the request into their child menu
        # context. Consuming it also clears the original parent's source hold.
        vn_game_flow_source_release_hold()
        # One boundary chooses one explicit effect. The root effect includes the
        # target menu; an automatic scene/master effect must not play after it.
        vn_flow_transition_request = None
        vn_flow_transition_fallback = None
        vn_flow_transition_captured = None
        vn_pending_scene_transition = None
        vn_performance_transition = None
        renpy.hide_screen("vn_performance_cover", layer="master")
        renpy.transition(None, layer="master")
        record = dict(request, raw=vn_bp_clock(), clock=vn_stage_clock())
        vn_game_flow_transition_active = record
        owner_context = renpy.game.context()
        vn_game_flow_transition_flush.owner = owner_context
        renpy.retain_after_load()
        try:
            effect = VnGameFlowTransition(spec, vn_game_flow_transition_snapshot) if vn_game_flow_transition_seconds(spec) else None
            renpy.with_statement(effect)
        finally:
            if renpy.game.context() is owner_context and vn_game_flow_transition_active is record:
                vn_game_flow_transition_resume()
            if getattr(vn_game_flow_transition_flush, "owner", None) is owner_context:
                vn_game_flow_transition_flush.owner = None
        return True

    def vn_game_flow_transition_transfer():
        global vn_game_flow_transition_request
        # Only a deliberate native-page call moves a pending boundary to its
        # real menu host. UI callbacks cannot claim their parent's request.
        request = vn_game_flow_transition_request
        if request is not None and len(renpy.game.contexts) > 1 and request.get("owner") is renpy.game.contexts[-2].info and request.get("depth") + 1 == renpy.context_nesting_level() and vn_flow_active_step:
            vn_game_flow_transition_request = dict(vn_game_flow_transition_request, owner=renpy.context(), depth=renpy.context_nesting_level())

    def vn_game_flow_transition_page_held(session):
        boundary = vn_game_flow_transition_active or vn_game_flow_transition_request
        return bool(session and not session.get("didShow", False) and boundary and session.get("owner") is boundary.get("owner"))

    def vn_game_flow_transition_task_held(task):
        if vn_game_flow_transition_active is None and vn_game_flow_transition_request is None:
            return False
        return bool(task and vn_game_flow_transition_page_held(task.get("native") or vn_ui_page_sessions.get(task.get("page"))))

    def vn_game_flow_transition_media_held(task, looping=False):
        # A page's continuous background is part of the live destination being
        # revealed. Only one-shot media keep their full duration after reveal.
        # Page entry/events/auto-close still use the separate task/page guard.
        return not looping and vn_game_flow_transition_task_held(task)

    def vn_game_flow_transition_media_events_ready(task):
        if vn_game_flow_transition_task_held(task):
            return False
        session = (task.get("native") or vn_ui_page_sessions.get(task.get("page"))) if task else None
        # A failed loop can be observed while revealing the destination. Keep
        # its author callback pending until that page has actually entered.
        return session is None or bool(session.get("didShow", False))

    class VnGameFlowInputGuard(renpy.Displayable):
        def render(self, width, height, st, at):
            return renpy.Render(0, 0)

        def event(self, ev, x, y, st):
            # These SDK underlay actions live outside the transitioned layers.
            # A normal dismiss still ends with; it cannot also open a menu.
            if vn_game_flow_transition_active is not None and (renpy.map_event(ev, "game_menu") or renpy.map_event(ev, "hide_windows")):
                raise renpy.display.core.IgnoreEvent()

    config.underlay.append(VnGameFlowInputGuard())
    config.always_shown_screens.append("vn_game_flow_source_cover")

    def vn_game_flow_transition_reset():
        global vn_game_flow_transition_request, vn_game_flow_transition_active, vn_game_flow_transition_snapshot, vn_game_flow_source_scope, vn_game_flow_movie
        vn_game_flow_source_release_hold()
        vn_game_flow_transition_request = None
        vn_game_flow_transition_active = None
        vn_game_flow_transition_snapshot = None
        vn_game_flow_source_scope = None
        if vn_game_flow_movie is not None:
            vn_game_flow_movie.stop()
            vn_game_flow_movie = None
        renpy.hide("vn_game_flow_movie", layer="master")

    def vn_game_flow_transition_after_load():
        # with was already consumed before saving. Resume the target clock and
        # session, never the source graph or its page-entry side effects.
        vn_game_flow_transition_resume()
        hold = vn_game_flow_source_hold
        if hold is None:
            return
        session = vn_ui_page_sessions.get(hold.get("pageId"), {})
        waiting = (hold.get("pageId") not in vn_ui_open_pages
            and session.get("token") == hold.get("pageToken") and session.get("flowToken") == hold.get("token")
            and hold.get("pageToken") in vn_ui_page_completions and (vn_flow_active_step or {}).get("token") == hold.get("token"))
        if not (vn_game_flow_transition_owned(hold) and vn_game_flow_transition_snapshot is not None
                and (waiting or vn_game_flow_transition_owned(vn_game_flow_transition_request))):
            vn_game_flow_source_release_hold(clear_snapshot=vn_game_flow_transition_request is None and vn_game_flow_transition_active is None)

    config.after_load_callbacks.append(vn_game_flow_transition_after_load)

screen vn_game_flow_source_cover():
    # A normal screens-layer image participates in root transitions. It has no
    # input or callbacks and never prolongs the closed source page's lifetime.
    zorder 199
    modal False
    if vn_game_flow_source_cover_visible():
        add Transform(im.Data(vn_game_flow_transition_snapshot, "vn-game-flow-held-page.png"), xysize=(config.screen_width, config.screen_height))
`;
