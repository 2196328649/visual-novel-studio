import { effectiveCharacter, type Project } from '../core/model';
import { blueprintScreens, sceneEntry } from '../core/blueprint';
import { pythonLiteral } from './screens';
import { defaultPortraitFraming, portraitGeometry } from '../core/portrait';
import { characterDisplayPresets } from '../core/character-presets';

/** Runtime lookups let typed resource pins use values supplied by a user node. */
export function createBlueprintRuntime(project: Project): string {
  const assets = Object.fromEntries(project.assets.map(asset => [asset.id, { kind: asset.kind, path: asset.path.replaceAll('\\', '/'), ...portraitGeometry(asset, project.width, project.height) }]));
  const characters = Object.fromEntries(project.characters.map(character => {
    const effective = effectiveCharacter(project, character.id)!;
    return [character.id, { expressions: Object.fromEntries(effective.expressions.map(expression => [expression.id, expression.assetId])), names: Object.fromEntries(effective.expressions.map(expression => [expression.name, expression.id])), default: effective.defaultExpressionId ?? effective.expressions[0]?.id, blueprint: effective.blueprintId, framing: { ...defaultPortraitFraming, ...effective.portraitFraming }, presets: characterDisplayPresets(project, character.id), default_preset: effective.defaultDisplayPresetId ?? 'center', transitions: effective.actorTransitions }];
  }));
  const scenes = Object.fromEntries(project.scenes.flatMap(scene => { const entry = sceneEntry(project, scene.id); return entry ? [[scene.id, `vn_node_${entry.id}`]] : []; }));
  return `default vn_actor_instances = {}
default vn_bp_menu_active = False

init python:
    vn_bp_assets = ${pythonLiteral(assets)}
    vn_bp_characters = ${pythonLiteral(characters)}
    vn_bp_scenes = ${pythonLiteral(scenes)}
    vn_bp_menus = ${pythonLiteral(Object.keys(blueprintScreens))}

    def vn_bp_clock():
        # The top-level game runtime stops in menus and UI callbacks. The
        # current context's counter also advances there and survives saves.
        return renpy.game.context().runtime

    def vn_bp_number(value, minimum, maximum, name):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not __import__("math").isfinite(value) or (minimum is not None and value < minimum) or (maximum is not None and value > maximum):
            raise Exception(name + "需要有效的数值（" + str(minimum) + "～" + str(maximum) + "）。")
        return value

    def vn_bp_position(value, name):
        import math
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise Exception(name + "需要有效的数值。")
        return value

    def vn_bp_asset(asset_id, kind):
        asset = vn_bp_assets.get(asset_id)
        if not asset or asset["kind"] != kind:
            raise Exception("蓝图收到的素材不存在或类型不匹配，请检查输入参数。")
        return asset["path"]

    def vn_actor_tag(character_id, instance_id=""):
        if instance_id and not __import__("re").fullmatch("[a-z][a-z0-9_]{0,63}", str(instance_id)):
            raise Exception("实例 ID 请使用小写字母开头的字母、数字或下划线，最多 64 位。")
        return "vn_instance_" + instance_id if instance_id else "vn_actor_" + character_id

    def vn_track_actor(character_id, expression_id, layer, instance_id="", lifetime=""):
        if lifetime not in ("", "line", "persistent"):
            raise Exception("显示范围请选择仅本句或持续显示。")
        tag = vn_actor_tag(character_id, instance_id)
        lifetime = lifetime or vn_actor_instances.get(tag, {}).get("lifetime", "")
        vn_actor_instances[tag] = dict(characterId=character_id, expressionId=expression_id, layer=layer, lifetime=lifetime)

    def vn_has_persistent_actors():
        return any(actor.get("lifetime") == "persistent" and renpy.showing(tag) for tag, actor in vn_actor_instances.items())

    def vn_finish_line_actors():
        for tag, actor in list(vn_actor_instances.items()):
            if actor.get("lifetime") == "line":
                if actor.get("transitions") is not None:
                    vn_actor_pending_exit[tag] = actor
                else:
                    renpy.hide(tag)
                    del vn_actor_instances[tag]

    def vn_character_showing(character_id):
        return renpy.showing("vn_actor_" + character_id) or any(actor["characterId"] == character_id and renpy.showing(tag) for tag, actor in vn_actor_instances.items())

    def vn_animate_instance(character_id, instance_id, motion):
        tag = vn_actor_tag(character_id, instance_id)
        actor = vn_actor_instances.get(tag)
        if actor and renpy.showing(tag):
            actor["signature"] = None
            renpy.show("vn_actor_" + actor["characterId"] + " " + actor["expressionId"], tag=tag, at_list=[motion], zorder=int(actor["layer"]))

    def vn_bp_background(asset_id):
        vn_bp_asset(asset_id, "image")
        if vn_has_persistent_actors():
            for tag in renpy.get_showing_tags():
                if vn_actor_instances.get(tag, {}).get("lifetime") != "persistent":
                    renpy.hide(tag)
        else:
            renpy.scene()
        for tag, actor in list(vn_actor_instances.items()):
            if actor.get("lifetime") != "persistent" or not renpy.showing(tag):
                del vn_actor_instances[tag]
        vn_actor_reset_transitions(keep_overrides=True)
        renpy.show("vn_background_" + asset_id, zorder=-1000000)
        vn_unlock(asset_id)

    def vn_bp_optional_asset(asset_id, kind):
        return vn_bp_asset(asset_id, kind) if asset_id else None

    def vn_bp_show_speaker(expression_id, x, y, scale, layer, hide_others=False, default_framing=False, preset_id="", instance_id="", lifetime="", move_duration=None, move_offsets=None, offset_duration=None, after_offsets=None, transitions=None, wait=True, transition_mode="dissolve", transition_duration=0.5, character_id=None):
        speaker_id = character_id or vn_current_speaker
        character = vn_bp_characters.get(speaker_id)
        if not character or not character["expressions"]:
            return False
        if hide_others:
            for tag, actor in list(vn_actor_instances.items()):
                if actor["characterId"] != speaker_id and actor.get("lifetime") != "persistent" and actor.get("transitions") is not None:
                    vn_actor_depart(tag, actor)
            for other_id in vn_bp_characters:
                if other_id != speaker_id and vn_actor_instances.get("vn_actor_" + other_id, {}).get("lifetime") != "persistent":
                    renpy.hide("vn_actor_" + other_id)
            for tag, actor in list(vn_actor_instances.items()):
                if actor["characterId"] != speaker_id and actor.get("lifetime") != "persistent":
                    renpy.hide(tag)
                    del vn_actor_instances[tag]
        expression_id = character["names"].get(expression_id, expression_id) if expression_id else character["default"]
        if not character_id and vn_actor_instances.get(vn_actor_tag(speaker_id, instance_id), {}).get("lifetime") == "persistent":
            lifetime = "persistent"
        elif not character_id and not lifetime:
            lifetime = "line"
        vn_bp_show(speaker_id, expression_id, x, y, scale, layer, default_framing, preset_id, instance_id, lifetime, move_duration, move_offsets, offset_duration, after_offsets, transitions, wait, transition_mode, transition_duration)
        return True

    def vn_portrait_placement(character_id, expression_id, x=0.5, y=1.0, scale=1.0):
        character = vn_bp_characters[character_id]
        image = vn_bp_assets[character["expressions"][expression_id]]
        bounds, framing = image["bounds"], character["framing"]
        zoom = ${project.height} * (1 - framing["top"]) / framing["visibleFraction"] / bounds["height"] * scale
        px = framing["x"] + x - 0.5 + (image["width"] / 2.0 - bounds["x"] - bounds["width"] / 2.0) * zoom / ${project.width}
        py = framing["top"] + y - 1.0 + (image["height"] - bounds["y"]) * zoom / ${project.height}
        return px, py, zoom

    def vn_display_preset_placement(character_id, expression_id, preset_id="default"):
        character = vn_bp_characters[character_id]
        key = character["default_preset"] if preset_id in ("default", "角色默认", "默认") else preset_id
        preset = next((p for p in character["presets"] if p["id"] == key or p["name"] == key), None)
        if preset is None:
            raise Exception("角色站位预设不存在：" + str(preset_id))
        if preset["useDefaultFraming"]:
            return vn_portrait_placement(character_id, expression_id, preset["x"], preset["y"], preset["scale"])
        return preset["x"], preset["y"], preset["scale"]

    class VNMoveOffsetMotion(object):
        def __init__(self, x, y, scale, duration, offsets, existing, after_offsets=None):
            self.target = (float(x), float(y), float(scale), 0.0, 1.0)
            self.duration = float(duration)
            self.offsets = offsets or {}
            self.after_offsets = after_offsets or {}
            self.after_duration = max([0.0] + [frame["at"] for frames in self.after_offsets.values() for frame in frames])
            self.existing = existing
            self.initial = None
        def __call__(self, trans, st, at):
            def relative(value, extent):
                if hasattr(value, "relative"):
                    return value.relative + value.absolute / float(extent)
                return value / float(extent) if isinstance(value, int) else float(value)
            if self.initial is None:
                self.initial = (relative(trans.state.xpos, config.screen_width), relative(trans.state.ypos, config.screen_height), trans.state.zoom, 0.0, trans.state.alpha) if self.existing else (self.target[0] - .15, self.target[1], self.target[2], 0.0, 0.0)
            phase = min(1.0, max(0.0, st / self.duration)) if self.duration > 0 else 1.0
            factor = __import__("math").sin(phase * __import__("math").pi / 2.0)
            for index, (key, field) in enumerate((("x", "xpos"), ("y", "ypos"), ("scale", "zoom"), ("rotation", "rotate"), ("opacity", "alpha"))):
                value = self.initial[index] + (self.target[index] - self.initial[index]) * factor + vn_visual_curve({"curves": self.offsets}, key, phase, 0.0)
                if st >= self.duration:
                    value += vn_visual_curve({"curves": self.after_offsets}, key, st - self.duration, 0.0)
                if key == "opacity":
                    value = max(0.0, min(1.0, value))
                setattr(trans, field, float(value))
            return 0 if st < self.duration + self.after_duration else None

    def vn_move_offsets(tag, x, y, scale, duration, offsets, after_offsets=None):
        return Transform(function=VNMoveOffsetMotion(x, y, scale, duration, offsets, renpy.showing(tag), after_offsets), xanchor=.5, yanchor=1.0, subpixel=True, rotate_pad=False, transform_anchor=True)

    def vn_show_offsets(x, y, scale, duration, offsets, after_offsets=None):
        motion = VNMoveOffsetMotion(x, y, scale, duration, offsets, False, after_offsets)
        motion.initial = motion.target
        return Transform(function=motion, xanchor=.5, yanchor=1.0, subpixel=True, rotate_pad=False, transform_anchor=True)

    def vn_bp_show(character_id, expression_id, x, y, scale, layer, default_framing=False, preset_id="", instance_id="", lifetime="", move_duration=None, move_offsets=None, offset_duration=None, after_offsets=None, transitions=None, wait=True, transition_mode="dissolve", transition_duration=0.5):
        global vn_actor_last_modern
        character = vn_bp_characters.get(character_id)
        if not character:
            raise Exception("蓝图收到的角色不存在，请检查角色参数。")
        expression_id = expression_id or character["default"]
        if expression_id not in character["expressions"]:
            raise Exception("蓝图收到的表情不属于当前角色，请检查角色与表情参数。")
        vn_bp_position(x, "角色横向位置")
        vn_bp_position(y, "角色纵向位置")
        vn_bp_position(scale, "角色大小")
        vn_bp_position(layer, "角色层级")
        if preset_id:
            x, y, scale = vn_display_preset_placement(character_id, expression_id, preset_id)
        elif default_framing:
            x, y, scale = vn_portrait_placement(character_id, expression_id, x, y, scale)
        tag = vn_actor_tag(character_id, instance_id)
        rules = vn_actor_rules(character_id, transitions, transition_mode, transition_duration, lifetime or vn_actor_instances.get(tag, {}).get("lifetime", ""))
        vn_actor_last_modern = rules is not None
        if rules is None:
            vn_track_actor(character_id, expression_id, layer, instance_id, lifetime)
        motion = vn_stage(float(x), float(y), float(scale)) if move_duration is None else vn_move_stage(float(x), float(y), float(scale), vn_bp_number(move_duration, 0, None, "移动秒数"))
        if move_duration is not None and (move_offsets or after_offsets):
            motion = vn_move_offsets(tag, x, y, scale, move_duration, move_offsets, after_offsets)
        elif offset_duration is not None and (move_offsets or after_offsets):
            motion = vn_show_offsets(x, y, scale, vn_bp_number(offset_duration, 0, None, "入场秒数"), move_offsets, after_offsets)
        if rules is not None:
            prior = vn_actor_instances.get(tag)
            phase = rules["expression"] if prior and prior["characterId"] == character_id else rules["enter"]
            seconds = phase["duration"] if phase["mode"] != "none" else 0
            motion = vn_show_offsets(x, y, scale, seconds, move_offsets, after_offsets) if move_offsets or after_offsets else vn_stage(float(x), float(y), float(scale))
            actor = dict(characterId=character_id, expressionId=expression_id, layer=layer, lifetime=lifetime or vn_actor_instances.get(tag, {}).get("lifetime", ""))
            signature = (character_id, expression_id, float(x), float(y), float(scale), int(layer)) if not (move_offsets or after_offsets) else None
            vn_actor_show(tag, "vn_actor_" + character_id + " " + expression_id, motion, signature, actor, rules, wait)
        else:
            vn_actor_retire_pending(tag)
            vn_actor_pending_exit.pop(tag, None)
            renpy.show("vn_actor_" + character_id + " " + expression_id, tag=tag, at_list=[motion], zorder=int(layer))
        vn_unlock(character["expressions"][expression_id])

    def vn_bp_hide(character_id, instance_id="", rule=None, wait=True):
        global vn_actor_last_modern
        if character_id not in vn_bp_characters:
            raise Exception("蓝图收到的角色不存在，请检查角色参数。")
        tag = vn_actor_tag(character_id, instance_id)
        actor = vn_actor_instances.get(tag)
        vn_actor_last_modern = bool(actor and actor.get("transitions") is not None)
        if vn_actor_last_modern:
            vn_actor_depart(tag, actor, rule, wait)
            return
        renpy.hide(tag)
        vn_actor_pending_exit.pop(tag, None)
        vn_actor_instances.pop(tag, None)

    def vn_bp_character_label(character_id):
        blueprint = vn_bp_characters.get(character_id, {}).get("blueprint")
        return "vn_blueprint_" + blueprint if blueprint else None

    def vn_bp_scene_label(scene_id):
        if scene_id not in vn_bp_scenes:
            raise Exception("蓝图的目标场景没有剧情入口，请先添加剧情段落。")
        return vn_bp_scenes[scene_id]

    def vn_bp_menu_label(screen):
        if screen in vn_custom_pages:
            return "vn_bp_page_" + screen
        if screen not in vn_bp_menus:
            raise Exception("蓝图收到的游戏界面不存在，请重新选择。")
        return "vn_bp_menu_" + screen

    def vn_bp_camera_warper(easing):
        return {"linear": _warper.linear, "easein": _warper.easeout, "easeout": _warper.easein, "ease": _warper.ease}.get(easing, _warper.ease)

    def vn_bp_shake(trans, st, at, direction, duration, amplitude):
        import math
        progress = min(1.0, st / duration) if duration > 0 else 1.0
        offset = math.sin(st * 16.0 * math.pi * 2.0) * amplitude * (1.0 - progress)
        trans.xoffset = offset if direction == "horizontal" else 0
        trans.yoffset = offset if direction != "horizontal" else 0
        return 0 if progress < 1.0 else None

    class VnBlueprintShakeCallback:
        def __init__(self, direction, duration, amplitude):
            self.parameters = (direction, duration, amplitude)

        def __eq__(self, other):
            # ATL compares callbacks when rebuilding a layer for a new interaction.
            # Equal parameters must preserve its elapsed time instead of restarting.
            return isinstance(other, VnBlueprintShakeCallback) and self.parameters == other.parameters

        def __call__(self, trans, st, at):
            return vn_bp_shake(trans, st, at, *self.parameters)

transform vn_blueprint_shake(direction, duration, amplitude):
    subpixel True
    function VnBlueprintShakeCallback(direction, duration, amplitude)

transform vn_blueprint_camera(px, py, pzoom, prot, pduration, peasing):
    subpixel True
    align (0.5, 0.5)
    warp vn_bp_camera_warper(peasing) pduration xoffset (px * ${project.width}) yoffset (py * ${project.height}) zoom pzoom rotate prot

label vn_bp_menu_context(screen):
    $ vn_ui_cancel_pointer()
    $ renpy.context_dynamic("vn_bp_menu_active")
    $ vn_bp_menu_active = True
    call _game_menu(_game_menu_screen=screen)
    return

label vn_bp_menu_return:
    $ renpy.play(config.exit_sound)
    $ renpy.transition(config.game_main_transition if main_menu else config.exit_transition)
    return

${Object.keys(blueprintScreens).map(screen => `label vn_bp_menu_${screen}:\n    $ renpy.call_in_new_context("vn_bp_menu_context", screen="${screen}")\n    return\n`).join('\n')}
${project.ui.customPages.map(page => `label vn_bp_page_${page.id}:\n    if ${pythonLiteral(page.id)} in vn_ui_open_pages:\n        return ""\n    $ vn_ui_page_begin(${pythonLiteral(page.id)}, True)\n    call screen vn_custom_page_${page.id}(_vn_waiting=True)\n    $ vn_ui_page_cleanup(${pythonLiteral(page.id)})\n    return _return\n`).join('\n')}`;
}
