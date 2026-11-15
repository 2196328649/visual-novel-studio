export const visualTransitionsRuntime = `
default vn_visual_instances = {}

init 10 python:
    def vn_visual_seconds(rule):
        return max(0.0, rule.get("duration", 0.0)) if rule and rule.get("mode") != "none" and preferences.transitions and not renpy.is_skipping() else 0.0

    def vn_visual_rule(data, phase):
        rules = data.get("visualTransitions") or {}
        rule = rules.get(phase) or (rules.get("enter") if phase == "replace" else None) or dict(mode="none", duration=0.0)
        if rule.get("mode") not in ("none", "dissolve", "fade", "move"):
            raise Exception("对象过渡方式无效。")
        vn_bp_number(rule.get("duration", 0), 0, 60, "对象过渡时长")
        return rule

    def vn_visual_owner_context(data):
        owner, depth = data.get("_vn_owner"), data.get("_vn_depth")
        if owner is None or not isinstance(depth, int) or depth < 0 or depth >= len(renpy.game.contexts):
            return None
        context = renpy.game.contexts[depth]
        return context if context.info is owner else None

    def vn_visual_clock(data, rendering=False):
        context = vn_visual_owner_context(data)
        if context is None or context is renpy.game.context():
            # Ordinary stage draws and older saves keep their existing clock.
            return vn_bp_clock() + (vn_stage_render_delta() if rendering else 0.0)
        # A native menu inherits the parent's displayables, not its timeline.
        # The parent interaction has not committed its final event yet. Its
        # active wait retains that position; an old completed wait must never
        # substitute a future timestamp for the parent's actual runtime.
        owner = context.info
        clock = context.runtime + getattr(owner, "vn_stage_clock_offset", 0.0)
        wait, saved = getattr(owner, "vn_bp_active_wait", None), getattr(owner, "vn_stage_wait_clock", None)
        if wait is not None and wait.get("owner") is owner and wait.get("depth") == data["_vn_depth"] and saved and saved.get("owner") is owner and saved.get("depth") == data["_vn_depth"] and saved.get("wait") is wait:
            clock = max(clock, saved["clock"])
        return clock

    def vn_visual_age(data, rendering=False):
        if data.get("_vn_flow_frozen_age") is not None:
            return data["_vn_flow_frozen_age"]
        if data.get("_vn_flow_hold"):
            return 0.0
        return max(0.0, vn_visual_clock(data, rendering) - data["_vn_started"])

    def vn_visual_holds_final(data):
        keep = data.get("_vn_keep_final_frame", (vn_performance_settings.get("transition") or {}).get("mode") in ("color", "dissolve"))
        return bool(data.get("_vn_hold_final_frame") or vn_game_flow_source_holds(data) or vn_performance_active and keep and data.get("_vn_performance_end", -1) >= vn_performance_until - 0.03)

    def vn_visual_performance_frame(data, started, keep):
        data["_vn_keep_final_frame"] = keep
        if vn_performance_active and not data.get("persistent"):
            data["_vn_performance_end"] = started + data["duration"]
        for child in data.get("children") or []:
            vn_visual_performance_frame(child, started + child.get("startAt", 0.0), keep)

    def vn_visual_flow_state(data, holding):
        was_held = data.get("_vn_flow_hold", False)
        data["_vn_flow_hold"] = holding
        clock = data.setdefault("_vn_text_clock", {})
        clock["holding"] = holding
        if not holding:
            clock["started"] = None
            if was_held:
                vn_visual_resume_flow_movie(data)
        for child in data.get("children") or []:
            vn_visual_flow_state(child, holding)

    def vn_visual_freeze_frame(data, age):
        data["_vn_flow_frozen_age"] = age
        clock = data.get("_vn_text_clock")
        if clock:
            clock["frozen"] = max(0.0, renpy.display.interface.frame_time - clock["started"]) if clock.get("started") is not None else 0.0
        for child in data.get("children") or []:
            vn_visual_freeze_frame(child, max(0.0, age - child.get("startAt", 0.0)))

    def vn_visual_preserve_performance_frame():
        for tag in vn_performance_visual_tags:
            entry = vn_visual_instances.get(tag)
            if entry and not entry.get("exiting"):
                data = entry["data"]
                age = vn_visual_age(data)
                if data.get("_vn_expired") and not vn_visual_holds_final(data):
                    continue
                if not data.get("persistent") and age >= data["duration"]:
                    data["_vn_hold_final_frame"] = True
                    age = max(0.0, data["duration"] - 0.00001)
                vn_visual_freeze_frame(data, age)

    def vn_visual_live(st, at, data):
        return vn_visual_display(vn_visual_age(data, True), at, data)

    def vn_visual_still(data):
        # Freeze the authored pose without restarting the source clock.
        child, delay = vn_visual_display(vn_visual_age(data), 0, data)
        return Fixed(child, xysize=(config.screen_width, config.screen_height))

    class VNVisualBlend(renpy.Displayable):
        def __init__(self, previous, data, rule, old_data=None):
            super(VNVisualBlend, self).__init__()
            self.previous, self.data, self.rule = previous, data, rule
            self.old_data = old_data or []
            self.started = vn_bp_clock()
            self.clock = dict(_vn_owner=renpy.context(), _vn_depth=renpy.context_nesting_level())
            self.frozen = None
            self.finished = False
            self.current = Fixed(DynamicDisplayable(vn_visual_live, data), xysize=(config.screen_width, config.screen_height)) if data is not None else None

        def age(self, rendering=False):
            if self.frozen is not None:
                return self.frozen
            if self.data is not None and self.data.get("_vn_flow_hold"):
                return 0.0
            return max(self.rule["duration"] if self.finished else 0.0, vn_visual_age(dict(getattr(self, "clock", {}), _vn_started=self.started), rendering))

        def snapshot(self):
            result = VNVisualBlend(self.previous, self.data, self.rule)
            result.frozen = self.age()
            result.current = vn_visual_still(self.data) if self.data is not None else None
            return result

        def visit(self):
            return [item for item in (self.previous, self.current) if item is not None]

        def render(self, width, height, st, at):
            elapsed = self.age(True)
            duration = self.rule["duration"]
            progress = min(1.0, elapsed / duration) if duration > 0 else 1.0
            old = self.previous or Null(width=config.screen_width, height=config.screen_height)
            new = self.current or Null(width=config.screen_width, height=config.screen_height)
            mode = self.rule["mode"]
            if progress >= 1:
                self.finished = True
                child = new
                for retired in self.old_data:
                    vn_stop_visual_media(retired)
                self.old_data = []
            elif self.current is None:
                child = Transform(old, alpha=1 - progress, xoffset=int(progress * config.screen_width * .15) if mode == "move" else 0)
            elif mode == "dissolve":
                child = renpy.display.transition.Dissolve(duration, old_widget=old, new_widget=new, alpha=True)
            elif mode == "fade":
                child = Transform(old, alpha=1 - progress * 2) if progress < .5 else Transform(new, alpha=progress * 2 - 1)
            elif mode == "move":
                child = Fixed(Transform(old, alpha=1 - progress, xoffset=int(progress * config.screen_width * .15)), Transform(new, alpha=progress, xoffset=int((progress - 1) * config.screen_width * .15)))
            else:
                child = new
            result = renpy.render(child, width, height, elapsed, elapsed)
            if self.frozen is None and progress < 1:
                renpy.redraw(self, 0)
            return result

    def vn_visual_snapshot(entry):
        blend = entry.get("blend")
        return blend.snapshot() if blend and blend.age() < blend.rule["duration"] else vn_visual_still(entry["data"])

    def vn_visual_retired(entry):
        blend = entry.get("blend")
        return [entry["data"]] + (blend.old_data if blend else [])

    def vn_visual_cleanup():
        for tag, entry in list(vn_visual_instances.items()):
            data, blend = entry["data"], entry.get("blend")
            cancelled = not vn_bp_task_alive(data.get("_vn_task"))
            owner_context = vn_visual_owner_context(getattr(blend, "clock", data) if blend else data)
            if not cancelled and owner_context is not None and owner_context is not renpy.game.context():
                # A copied menu scene may clear or replace its master layer.
                # That does not remove the suspended parent's global record.
                continue
            expired = blend.age() >= blend.rule["duration"] if entry.get("exiting") else not data.get("persistent") and not data.get("_vn_flow_hold") and not vn_visual_holds_final(data) and (data.get("_vn_expired") or vn_visual_age(data) >= data["duration"])
            if cancelled or not renpy.showing(tag) or expired:
                vn_stop_visual_media(data)
                if blend:
                    for retired in blend.old_data:
                        vn_stop_visual_media(retired)
                vn_visual_instances.pop(tag, None)
                # Timed objects may hold the final frame for a performance transition.
                if cancelled or entry.get("exiting"):
                    renpy.hide(tag)

    config.interact_callbacks.append(vn_visual_cleanup)

    def vn_install_visual(data):
        vn_visual_cleanup()
        tag = "vn_visual_" + data["instanceId"]
        old = vn_visual_instances.get(tag)
        old_context = vn_visual_owner_context(old["data"]) if old else None
        signature = {key: value for key, value in data.items() if not key.startswith("_vn_") and key not in ("visualTransitions", "transitionWait", "wait", "name")}
        if old and not old.get("exiting") and data.get("persistent") and data["content"] != "video" and old.get("signature") == signature and renpy.showing(tag) and (old_context is None or old_context is renpy.game.context()):
            old["data"]["visualTransitions"] = data.get("visualTransitions")
            old["data"]["_vn_task"] = data.get("_vn_task")
            return 0.0
        rule = dict(vn_visual_rule(data, "replace" if old else "enter"))
        explicit_flow = vn_flow_transition_request is not None or vn_game_flow_transition_request is not None
        seconds = 0.0 if explicit_flow else vn_visual_seconds(rule)
        if not data.get("persistent"):
            seconds = min(seconds, data["duration"])
        rule["duration"] = seconds
        data["_vn_started"] = vn_bp_clock()
        data["_vn_owner"], data["_vn_depth"] = renpy.context(), renpy.context_nesting_level()
        data["_vn_skip_enter"] = old is not None or explicit_flow
        vn_visual_flow_state(data, vn_flow_transition_holding())
        blend = VNVisualBlend(vn_visual_snapshot(old), data, rule, vn_visual_retired(old)) if old and seconds else None
        if old and not blend:
            for retired in vn_visual_retired(old):
                vn_stop_visual_media(retired)
        vn_visual_instances[tag] = dict(data=data, signature=signature, blend=blend)
        renpy.show(tag, what=blend or DynamicDisplayable(vn_visual_live, data), at_list=[Transform(pos=(0, 0), anchor=(0, 0))] if blend else [], zorder=data["layer"])
        vn_performance_extend(seconds)
        return seconds

    def vn_hide_visual(instance_id, rule=None):
        vn_visual_cleanup()
        tag = "vn_visual_" + instance_id
        old = vn_visual_instances.get(tag)
        if old is None:
            renpy.hide(tag)
            return 0.0
        rule = dict(rule or vn_visual_rule(old["data"], "exit"))
        seconds = 0.0 if vn_flow_transition_request is not None or vn_game_flow_transition_request is not None else vn_visual_seconds(rule)
        rule["duration"] = seconds
        if seconds:
            blend = VNVisualBlend(vn_visual_snapshot(old), None, rule, vn_visual_retired(old))
            vn_visual_instances[tag] = dict(data=old["data"], blend=blend, exiting=True)
            renpy.show(tag, what=blend, at_list=[Transform(pos=(0, 0), anchor=(0, 0))], zorder=old["data"]["layer"])
            vn_performance_extend(seconds)
        else:
            for retired in vn_visual_retired(old):
                vn_stop_visual_media(retired)
            vn_visual_instances.pop(tag, None)
            renpy.hide(tag)
        return seconds

    def vn_finish_line_visuals():
        for entry in list(vn_visual_instances.values()):
            data = entry["data"]
            if data.get("lifetime") == "line" and not entry.get("exiting"):
                vn_hide_visual(data["instanceId"])

    def vn_flow_transition_resume_targets(elapsed=0.0):
        # Only objects introduced behind this transition were held. Persistent
        # objects that were already visible keep their original clocks.
        vn_release_flow_source_media()
        now = vn_bp_clock()
        for entry in vn_visual_instances.values():
            data = entry["data"]
            if not data.get("_vn_flow_hold"):
                continue
            data["_vn_started"] = now
            vn_visual_performance_frame(data, vn_stage_clock(), data.get("_vn_keep_final_frame", False))
            blend = entry.get("blend")
            if blend is not None and not entry.get("exiting"):
                blend.started = now
            vn_visual_flow_state(data, False)
        vn_audio_clip_release_flow_targets()
`;
