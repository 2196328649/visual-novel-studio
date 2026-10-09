export function createActorTransitionsRuntime(): string {
  return `default vn_actor_pending_exit = {}
default vn_actor_departures = {}
default vn_actor_wait_until = 0.0
default vn_actor_waiting = []
default vn_actor_transition_overrides = []
default vn_actor_last_modern = False

init python:
    def vn_actor_rules(character_id, rules=None, mode="dissolve", duration=0.5, lifetime=""):
        if isinstance(rules, str):
            rules = __import__("json").loads(rules) if rules else None
        defaults = vn_bp_characters.get(character_id, {}).get("transitions")
        if defaults is None and rules is None and not vn_actor_transition_overrides and lifetime != "line":
            return None
        result = dict(enter=dict(mode=mode, duration=duration), expression=dict(mode=mode, duration=duration), exit=dict(mode="dissolve", duration=0.5))
        for source in (defaults, rules) + tuple(vn_actor_transition_overrides):
            if isinstance(source, str):
                source = __import__("json").loads(source) if source else None
            if source:
                result.update(source)
        for rule in result.values():
            if rule["mode"] not in ("none", "dissolve", "fade", "move"):
                raise Exception("角色过渡方式无效。")
            vn_bp_number(rule["duration"], 0, 60, "角色过渡时长")
        return result

    class VNActorBlend(renpy.Displayable):
        def __init__(self, previous, current, rule):
            super(VNActorBlend, self).__init__()
            self.previous, self.current = previous, current
            self.mode = rule["mode"]
            self.duration = rule["duration"]
            self.started = vn_bp_clock()
            self.finished = False
            old = previous or Null(width=config.screen_width, height=config.screen_height)
            new = current or Null(width=config.screen_width, height=config.screen_height)
            self.dissolve = renpy.display.transition.Dissolve(self.duration, old_widget=old, new_widget=new, alpha=True)

        def complete(self):
            return self.finished or vn_bp_clock() - self.started >= self.duration

        def visit(self):
            return [item for item in (self.previous, self.current) if item is not None]

        def render(self, width, height, st, at):
            interface = renpy.display.interface
            elapsed = max(0.0, vn_bp_clock() - self.started + max(0.0, interface.frame_time - (interface.interact_time or interface.frame_time)))
            progress = 1.0 if self.finished or self.duration <= 0 else min(1.0, elapsed / self.duration)
            old = self.previous or Null(width=config.screen_width, height=config.screen_height)
            new = self.current or Null(width=config.screen_width, height=config.screen_height)
            if progress >= 1:
                child = new
            elif self.current is None and self.mode != "move":
                child = Transform(old, alpha=1 - progress)
            elif self.previous is None and self.mode != "move":
                child = Transform(new, alpha=progress)
            elif self.mode == "dissolve":
                child = self.dissolve
            elif self.mode == "fade" and self.previous is not None and self.current is not None:
                child = Transform(old, alpha=1 - progress * 2) if progress < .5 else Transform(new, alpha=progress * 2 - 1)
            elif self.mode == "move":
                child = Fixed(Transform(old, alpha=1 - progress, xoffset=int(progress * config.screen_width * .15)), Transform(new, alpha=progress, xoffset=int((progress - 1) * config.screen_width * .15)))
            else:
                child = Fixed(Transform(old, alpha=1 - progress), Transform(new, alpha=progress))
            result = renpy.render(child, width, height, elapsed, elapsed)
            if progress < 1:
                renpy.redraw(self, 0)
            return result

    def vn_actor_frame(displayable):
        # Ren'Py applies character placement inside this full-stage frame. The
        # transition wrapper itself always uses the stage origin.
        if isinstance(getattr(displayable, "child", None), VNActorBlend):
            displayable = displayable.child
        if isinstance(displayable, VNActorBlend):
            return displayable.current if displayable.complete() else displayable
        return Fixed(displayable, xysize=(config.screen_width, config.screen_height)) if displayable is not None else None

    def vn_actor_blend(tag, previous, current, rule, layer, wait):
        global vn_actor_wait_until
        seconds = rule["duration"] if rule["mode"] != "none" and preferences.transitions and not renpy.is_skipping() and vn_pending_scene_transition is None and vn_performance_transition is None else 0
        if seconds <= 0:
            if current is None:
                renpy.hide(tag)
            return None
        blend = VNActorBlend(previous, current, rule)
        renpy.show(tag, what=blend, at_list=[Transform(pos=(0, 0), anchor=(0, 0), zoom=1.0, alpha=1.0, rotate=0, rotate_pad=False)], zorder=int(layer))
        vn_performance_extend(seconds)
        if wait:
            vn_actor_wait_until = max(vn_actor_wait_until, blend.started + seconds)
            vn_actor_waiting.append(blend)
        return blend

    def vn_actor_depart(tag, actor, rule=None, wait=None):
        vn_actor_pending_exit.pop(tag, None)
        current = renpy.display.core.displayable_by_tag("master", tag)
        vn_actor_instances.pop(tag, None)
        renpy.hide(tag)
        if current is None:
            return
        ghost = "vn_departure_" + tag
        rule = rule or actor["transitions"]["exit"]
        blend = vn_actor_blend(ghost, vn_actor_frame(current), None, rule, actor["layer"], actor.get("wait", True) if wait is None else wait)
        if blend is not None:
            vn_actor_departures[ghost] = blend

    def vn_actor_retire_pending(except_tag=None):
        for tag, actor in list(vn_actor_pending_exit.items()):
            if tag != except_tag:
                vn_actor_depart(tag, actor)

    def vn_actor_show(tag, image_name, motion, signature, actor, rules, wait):
        vn_actor_retire_pending(tag)
        vn_actor_pending_exit.pop(tag, None)
        previous = renpy.display.core.displayable_by_tag("master", tag)
        old = vn_actor_instances.get(tag)
        actor.update(transitions=rules, wait=wait, signature=signature)
        vn_actor_instances[tag] = actor
        renpy.hide("vn_departure_" + tag)
        vn_actor_departures.pop("vn_departure_" + tag, None)
        if signature is not None and old and old.get("signature") == signature and previous is not None:
            return
        rule = rules["expression"] if old and old["characterId"] == actor["characterId"] and previous is not None else rules["enter"]
        renpy.show(image_name, tag=tag, at_list=[motion], zorder=int(actor["layer"]))
        current = renpy.display.core.displayable_by_tag("master", tag)
        vn_actor_blend(tag, vn_actor_frame(previous), vn_actor_frame(current), rule, actor["layer"], wait)

    def vn_actor_flush():
        global vn_actor_wait_until, vn_actor_waiting
        vn_actor_retire_pending()
        remaining = max(0.0, vn_actor_wait_until - vn_bp_clock())
        waiting = vn_actor_waiting
        vn_actor_wait_until = 0.0
        vn_actor_waiting = []
        if remaining and not renpy.is_skipping() and preferences.transitions:
            if renpy.pause(remaining, hard=not _dismiss_pause):
                for blend in waiting:
                    blend.finished = True
        for tag, blend in list(vn_actor_departures.items()):
            if blend.complete():
                renpy.hide(tag)
                vn_actor_departures.pop(tag, None)

    def vn_actor_reset_transitions(keep_overrides=False):
        global vn_actor_wait_until, vn_actor_waiting
        for tag in vn_actor_departures:
            renpy.hide(tag)
        vn_actor_pending_exit.clear()
        vn_actor_departures.clear()
        if not keep_overrides:
            vn_actor_transition_overrides[:] = []
        vn_actor_wait_until = 0.0
        vn_actor_waiting = []
`;
}
