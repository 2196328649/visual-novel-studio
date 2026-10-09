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

    def vn_visual_age(data, rendering=False):
        interface = renpy.display.interface
        return max(0.0, vn_bp_clock() - data["_vn_started"] + (max(0.0, interface.frame_time - (interface.interact_time or interface.frame_time)) if rendering else 0.0))

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
            self.frozen = None
            self.finished = False
            self.current = Fixed(DynamicDisplayable(vn_visual_live, data), xysize=(config.screen_width, config.screen_height)) if data is not None else None

        def age(self, rendering=False):
            return self.frozen if self.frozen is not None else max(self.rule["duration"] if self.finished else 0.0, vn_visual_age(dict(_vn_started=self.started), rendering))

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
            expired = blend.age() >= blend.rule["duration"] if entry.get("exiting") else not data.get("persistent") and (data.get("_vn_expired") or vn_visual_age(data) >= data["duration"])
            if not renpy.showing(tag) or expired:
                vn_stop_visual_media(data)
                if blend:
                    for retired in blend.old_data:
                        vn_stop_visual_media(retired)
                vn_visual_instances.pop(tag, None)
                # Timed objects may hold the final frame for a performance transition.
                if entry.get("exiting"):
                    renpy.hide(tag)

    config.interact_callbacks.append(vn_visual_cleanup)

    def vn_install_visual(data):
        vn_visual_cleanup()
        tag = "vn_visual_" + data["instanceId"]
        old = vn_visual_instances.get(tag)
        signature = {key: value for key, value in data.items() if not key.startswith("_vn_") and key not in ("visualTransitions", "transitionWait", "wait", "name")}
        if old and not old.get("exiting") and data.get("persistent") and data["content"] != "video" and old.get("signature") == signature:
            old["data"]["visualTransitions"] = data.get("visualTransitions")
            return 0.0
        rule = dict(vn_visual_rule(data, "replace" if old else "enter"))
        seconds = vn_visual_seconds(rule)
        if not data.get("persistent"):
            seconds = min(seconds, data["duration"])
        rule["duration"] = seconds
        data["_vn_started"] = vn_bp_clock()
        data["_vn_skip_enter"] = old is not None
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
        seconds = vn_visual_seconds(rule)
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
`;
