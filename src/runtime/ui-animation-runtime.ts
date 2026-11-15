import type { Project } from '../core/model';
import { pythonLiteral } from './literals';

/** Elapsed time is saved; wall-clock samples live on the function, outside rollback state. */
export function createUiAnimationRuntime(project: Project): string {
  return `default vn_ui_animations = {}
default vn_ui_animation_serial = 0

init python:
    vn_ui_animation_clips = ${pythonLiteral(Object.fromEntries((project.ui.animations ?? []).map(a => [a.id, a])))}

    def vn_ui_animation_value(source, target, progress, easing):
        import math
        t = min(1.0, max(0.0, progress))
        t = t if easing == "linear" else 1 - math.cos(t * math.pi / 2) if easing == "easein" else math.sin(t * math.pi / 2) if easing == "easeout" else .5 - math.cos(t * math.pi) / 2
        return source + (target - source) * t

    def vn_ui_track_value(keys, elapsed, initial):
        previous_time, previous_value = 0.0, initial
        for key in sorted(keys, key=lambda k: k["time"]):
            if elapsed < key["time"]:
                return vn_ui_animation_value(previous_value, key["value"], (elapsed - previous_time) / (key["time"] - previous_time), key["easing"])
            previous_time, previous_value = key["time"], key["value"]
        return previous_value

    def vn_ui_clip_time(state):
        # Older saves have only duration/elapsed and retain forward-once playback.
        if "clip_duration" not in state:
            return state["elapsed"]
        duration, mode = state["clip_duration"], state["mode"]
        if duration == 0:
            return 0.0
        cycle = duration * (2 if mode == "pingpong" else 1)
        distance = state["offset"] + state["elapsed"] * state["speed"]
        if state["loops"] > 0 and distance >= cycle * state["loops"]:
            return duration if mode == "forward" else 0.0
        local = distance % cycle
        return duration - local if mode == "reverse" else cycle - local if mode == "pingpong" and local > duration else local

    def vn_ui_animation_tick(redraw=True):
        import math
        if not vn_ui_animations:
            vn_ui_animation_tick.samples = {}
            vn_parameter_flush_animations()
            return
        now = renpy.display.core.get_time()
        cached = getattr(vn_ui_animation_tick, "samples", {})
        samples = {}
        assignments, updates = [], []
        for key, current in list(vn_ui_animations.items()):
            if vn_ui_animations.get(key) is not current: continue
            if not vn_bp_task_alive(current.get("task")):
                vn_ui_animations.pop(key, None)
                continue
            sample = cached.get((current["token"], key))
            # Load and rollback restore a different record: restart its clock
            # from the saved elapsed value, without including offline time.
            delta = max(0.0, now - sample[1]) if sample and sample[0] is current else 0.0
            elapsed = current["elapsed"] + delta
            state = dict(current, elapsed=min(current["duration"], elapsed) if current["duration"] is not None else elapsed)
            complete = state["duration"] is not None and state["elapsed"] >= state["duration"]
            if complete:
                value = state["target"]
            elif "keys" in state:
                value = vn_ui_track_value(state["keys"], vn_ui_clip_time(state), state["from"])
            else:
                value = vn_ui_animation_value(state["from"], state["target"], state["elapsed"] / state["duration"], state["easing"])
            assignments.append((key[0], key[1], value))
            updates.append((key, state, complete))
        # One frame is one transaction: related sources (for example a range
        # and its current value) must never be observed halfway through a tick.
        changes = vn_ui_property_apply(assignments, animation=True, notify=False)
        for key, state, complete in updates:
            if complete:
                vn_ui_animations.pop(key, None)
            else:
                vn_ui_animations[key] = state
                samples[state["token"], key] = (state, now)
        vn_ui_animation_tick.samples = samples
        vn_ui_property_changes_applied(changes)
        vn_parameter_flush_animations()
        if redraw:
            renpy.restart_interaction()

    def vn_ui_animate(component_id, property, target, duration, easing):
        global vn_ui_animation_serial
        import math
        source = vn_ui_get(component_id, property)
        if property not in ("x", "y", "width", "height", "opacity", "value") or isinstance(target, bool) or not isinstance(target, (int, float)) or not math.isfinite(target) or (property in ("opacity", "value") and not 0 <= target <= 1):
            raise Exception("控件动画需要数值属性；不透明度和进度使用 0 至 1。")
        if isinstance(duration, bool) or not isinstance(duration, (int, float)) or not math.isfinite(duration) or duration < 0 or easing not in ("linear", "ease", "easein", "easeout"):
            raise Exception("控件动画时长不能为负数，并需选择有效缓动。")
        vn_ui_property_prepare([(component_id, property, target)])
        vn_ui_animation_tick(False)
        source = vn_ui_get(component_id, property)
        vn_ui_property_animation_claim(component_id, property)
        vn_ui_animation_serial += 1
        token = vn_ui_animation_serial
        key = (component_id, property)
        if duration == 0 or source == target:
            vn_ui_set(component_id, property, target)
        else:
            state = dict(token=token, task=vn_bp_task, duration=duration, elapsed=0.0, easing=easing, **{"from": source, "target": target})
            vn_ui_animations[key] = state
            samples = getattr(vn_ui_animation_tick, "samples", {})
            samples[token, key] = (state, renpy.display.core.get_time())
            vn_ui_animation_tick.samples = samples
            renpy.retain_after_load()
            renpy.restart_interaction()
        return token

    def vn_ui_play_animation(animation_id, mode="forward", loops=1, speed=1.0, from_current=False):
        global vn_ui_animation_serial
        import math
        clip = vn_ui_animation_clips.get(animation_id)
        if clip is None:
            raise Exception("界面动画已不存在。")
        if mode not in ("forward", "reverse", "pingpong") or isinstance(loops, bool) or not isinstance(loops, (int, float)) or not math.isfinite(loops) or loops < 0 or int(loops) != loops or isinstance(speed, bool) or not isinstance(speed, (int, float)) or not math.isfinite(speed) or speed < .01 or not isinstance(from_current, bool):
            raise Exception("界面动画需要有效方向、不小于 0 的整数循环次数、不小于 0.01 的速度和沿用进度开关。")
        # Read every target before mutating anything, including when a caller
        # references a component removed from this game build.
        sources = [vn_ui_get(t["componentId"], t["property"]) for t in clip["tracks"]]
        parameter_drivers = set()
        for track in clip["tracks"]:
            component_id, property = track["componentId"], track["property"]
            control = vn_ui_property_control(component_id, property)
            if control is not None:
                if control["mode"] == "follow":
                    raise Exception("界面动画有属性正单向跟随参数，整段动画未启动。")
                if control["parameterId"] in parameter_drivers:
                    raise Exception("此界面动画的多条轨道同步同一参数，请只保留一个驱动轨道。")
                parameter_drivers.add(control["parameterId"])
        # Validate related sources together at every authored key time. Two
        # parameters may shift a range as a whole without an invalid half-write.
        times = {0.0, clip["duration"]}
        for track in clip["tracks"]: times.update(key["time"] for key in track["keys"])
        for time in sorted(times):
            vn_ui_property_prepare([(track["componentId"], track["property"], vn_ui_track_value(track["keys"], time, source)) for track, source in zip(clip["tracks"], sources)])
        vn_ui_animation_tick(False)
        sources = [vn_ui_get(t["componentId"], t["property"]) for t in clip["tracks"]]
        previous = [vn_ui_animations.get((t["componentId"], t["property"])) for t in clip["tracks"]]
        first = previous[0] if previous else None
        continuing = from_current and first is not None and all(s is not None and s.get("clip") == animation_id and s["token"] == first["token"] for s in previous)
        position = vn_ui_clip_time(first) if continuing else None
        offset = 0.0 if position is None else clip["duration"] - position if mode == "reverse" else position
        duration = 0.0 if clip["duration"] == 0 else None if loops == 0 else max(0.0, clip["duration"] * (2 if mode == "pingpong" else 1) * loops - offset) / speed
        token = vn_ui_animation_serial + 1
        samples = getattr(vn_ui_animation_tick, "samples", {})
        assignments, states = [], []
        for index, (track, source) in enumerate(zip(clip["tracks"], sources)):
            key = (track["componentId"], track["property"])
            source = previous[index]["from"] if continuing else source
            target = vn_ui_track_value(track["keys"], clip["duration"] if mode == "forward" else 0.0, source)
            state = dict(token=token, task=vn_bp_task, clip=animation_id, duration=duration, clip_duration=clip["duration"], mode=mode, loops=loops, speed=speed, offset=offset, elapsed=0.0, easing="linear", keys=track["keys"], **{"from": source, "target": target})
            value = target if duration == 0 else vn_ui_track_value(track["keys"], vn_ui_clip_time(state), source)
            assignments.append((key[0], key[1], value))
            states.append((key, state))
        vn_ui_property_prepare(assignments)
        for key, state in list(vn_ui_animations.items()):
            if state.get("clip") == animation_id: vn_ui_animations.pop(key, None)
        vn_ui_animation_serial = token
        for key, state in states: vn_ui_property_animation_claim(key[0], key[1])
        vn_ui_property_apply(assignments, animation=True)
        for key, state in states:
            if duration is None or duration > 0:
                vn_ui_animations[key] = state
                samples[token, key] = (state, renpy.display.core.get_time())
        vn_ui_animation_tick.samples = samples
        vn_parameter_flush_animations()
        renpy.retain_after_load()
        renpy.restart_interaction()
        return token

    def vn_ui_stop_playback(animation_id, finish=False):
        if animation_id not in vn_ui_animation_clips or not isinstance(finish, bool):
            raise Exception("请选择有效界面动画和停止方式。")
        finishing = [(key[0], key[1], state["target"]) for key, state in vn_ui_animations.items() if state.get("clip") == animation_id]
        if finish: vn_ui_property_prepare(finishing)
        vn_ui_animation_tick(False)
        finishing = []
        for key, state in list(vn_ui_animations.items()):
            if state.get("clip") == animation_id:
                vn_ui_animations.pop(key, None)
                if finish:
                    finishing.append((key[0], key[1], state["target"]))
        if finish: vn_ui_property_apply(finishing, animation=True)
        vn_parameter_flush_animations()
        renpy.retain_after_load()
        renpy.restart_interaction()

    def vn_ui_animation_active(token):
        return any(state["token"] == token for state in vn_ui_animations.values())

    def vn_ui_stop_animation(component_id, property="all", finish=False):
        if component_id not in vn_ui_defaults or property not in ("all", "x", "y", "width", "height", "opacity", "value") or not isinstance(finish, bool):
            raise Exception("请选择控件和要停止的动画属性。")
        finishing = [(key[0], key[1], state["target"]) for key, state in vn_ui_animations.items() if key[0] == component_id and (property == "all" or key[1] == property)]
        if finish: vn_ui_property_prepare(finishing)
        vn_ui_animation_tick(False)
        finishing = []
        for key, state in list(vn_ui_animations.items()):
            if key[0] == component_id and (property == "all" or key[1] == property):
                vn_ui_animations.pop(key, None)
                if finish:
                    finishing.append((key[0], key[1], state["target"]))
        if finish: vn_ui_property_apply(finishing, animation=True)
        vn_parameter_flush_animations()
        renpy.retain_after_load()
        renpy.restart_interaction()

    def vn_ui_finish_animation(token):
        finishing = [(key[0], key[1], state["target"]) for key, state in vn_ui_animations.items() if state["token"] == token]
        vn_ui_property_prepare(finishing)
        for key, state in list(vn_ui_animations.items()):
            if state["token"] == token: vn_ui_animations.pop(key, None)
        vn_ui_property_apply(finishing, animation=True)
        vn_parameter_flush_animations()
        renpy.retain_after_load()
        renpy.restart_interaction()

screen vn_ui_animation_clock():
    if vn_ui_animations:
        timer 0.016 repeat True action Function(vn_ui_animation_tick)

init python:
    config.overlay_screens.append("vn_ui_animation_clock")
`;
}
