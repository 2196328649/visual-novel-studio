import type { Project } from '../core/model';
import { playerPreferences } from '../core/preferences';
import { pythonLiteral } from './literals';

/** One player preference store for native menus, authored controls and blueprints. */
export function createPreferencesRuntime(project: Project): string {
  const defaults = Object.fromEntries(Object.entries(playerPreferences).map(([key, info]) => [key, project.playerDefaults?.[key as keyof typeof playerPreferences] ?? info.initial]));
  const fields = { textSpeed: 'text_cps', autoForwardTime: 'afm_time', fullscreen: 'fullscreen', skipAll: 'skip_unseen', voiceSustain: 'voice_sustain' };
  const mixers = { masterVolume: 'main', musicVolume: 'music', soundVolume: 'sfx', ambientVolume: 'ambient', voiceVolume: 'voice' };
  const tags = Object.fromEntries([["", "vn_voice_other"], ...project.characters.map(c => [c.id, `vn_voice_${c.id}`])]);
  return `# Player options are persistent preferences, independent of story saves.
${Object.entries(fields).map(([key, field]) => `default preferences.${field} = ${pythonLiteral(defaults[key])}`).join('\n')}
${Object.entries(mixers).map(([key, mixer]) => `default preferences.volume.${mixer} = ${pythonLiteral(defaults[key])}`).join('\n')}
default preferences.physical_size = (${String(defaults.windowSize).split('x').join(', ')})
default persistent.vn_dialogue_opacity = ${pythonLiteral(defaults.dialogueOpacity)}

init python:
    renpy.music.register_channel("ambient", mixer="ambient", loop=True)
    vn_preference_defaults = ${pythonLiteral(defaults)}
    vn_preference_info = ${pythonLiteral(playerPreferences)}
    vn_preference_fields = ${pythonLiteral(fields)}
    vn_preference_mixers = ${pythonLiteral(mixers)}
    vn_voice_tags = ${pythonLiteral(tags)}
    vn_voice_characters = ${pythonLiteral([...project.characters.map(c => [c.id, c.name]), ['', '旁白及其他']])}

    def vn_preference_tag(character_id):
        if character_id is None:
            character_id = ""
        if not isinstance(character_id, str) or character_id not in vn_voice_tags:
            raise Exception("角色音量引用的角色不存在，请重新选择。")
        return vn_voice_tags[character_id]

    def vn_preference_equal(actual, expected):
        if isinstance(actual, (int, float)) and not isinstance(actual, bool) and isinstance(expected, (int, float)) and not isinstance(expected, bool):
            return abs(actual - expected) < 0.0000001
        return type(actual) is type(expected) and actual == expected

    def vn_window_dimensions(value):
        width, height = (int(part) for part in value.split("x"))
        width = min(width, round(height * ${project.width / project.height}))
        return (width, round(width * ${project.height / project.width}))

    def vn_window_option_available(value):
        if _preferences.fullscreen or not renpy.get_renderer_info().get("resizable", False):
            return False
        width, height = vn_window_dimensions(value)
        # SDL reports usable desktop bounds, excluding the taskbar.
        try:
            display = renpy.display.core.pygame.display
            bounds = display.get_display_usable_bounds(display.get_window_display_index())
            available = (bounds[2], bounds[3])
        except Exception:
            bounds = renpy.display.core.pygame.display.get_display_bounds(0)
            available = (bounds[2], bounds[3])
        dpi = renpy.display.interface.dpi_scale
        return width * dpi <= available[0] - 32 and height * dpi <= available[1] - 112

    def vn_preference_option_selected(key, value, character_id=None):
        if key == "windowSize":
            actual = renpy.get_physical_size() if not _preferences.fullscreen else _preferences.physical_size
            return bool(actual) and all(abs(a - b) <= 1 for a, b in zip(actual, vn_window_dimensions(value)))
        return vn_preference_equal(vn_preference_get(key, character_id), value)

    def vn_preference_get(key, character_id=None):
        if key not in vn_preference_info:
            raise Exception("玩家设置不存在，请重新选择。")
        if key in vn_preference_fields:
            return getattr(_preferences, vn_preference_fields[key])
        if key in vn_preference_mixers:
            value = MixerValue(vn_preference_mixers[key]).get_mixer()
            return max(0.0, min(1.0, value / (1.0 if config.quadratic_volumes else config.volume_db_range)))
        if key == "characterVolume":
            return GetCharacterVolume(vn_preference_tag(character_id))
        if key == "dialogueOpacity":
            return persistent.vn_dialogue_opacity
        if key == "windowSize":
            size = _preferences.physical_size or (${project.width}, ${project.height})
            return "%dx%d" % (size[0], size[1])

    def vn_preference_set(key, value, character_id=None, refresh=True):
        info = vn_preference_info.get(key)
        if not info:
            raise Exception("玩家设置不存在，请重新选择。")
        kind = info["type"]
        valid = isinstance(value, bool) if kind == "boolean" else isinstance(value, str) if kind == "string" else not isinstance(value, bool) and isinstance(value, (int, float)) and info["min"] <= value <= info["max"]
        if not valid or (info.get("options") and value not in info["options"]):
            raise Exception(info["name"] + "的值无效，请检查蓝图输入。")
        if key in vn_preference_fields:
            if key == "fullscreen" and value and not renpy.can_fullscreen():
                return
            setattr(_preferences, vn_preference_fields[key], value)
        elif key in vn_preference_mixers:
            MixerValue(vn_preference_mixers[key]).set_mixer(float(value) * (1.0 if config.quadratic_volumes else config.volume_db_range))
        elif key == "characterVolume":
            persistent._character_volume[vn_preference_tag(character_id)] = float(value)
        elif key == "dialogueOpacity":
            persistent.vn_dialogue_opacity = float(value)
        elif key == "windowSize":
            renpy.set_physical_size(vn_window_dimensions(value))
        if refresh:
            renpy.restart_interaction()

    @renpy.pure
    class VnSetPreference(Action, DictEquality):
        def __init__(self, key, value, character_id=None, component_id=None):
            self.component_id = component_id
            self.key, self.value, self.character_id = key, value, character_id

        def __call__(self):
            if not self.get_sensitive():
                return
            if self.component_id:
                vn_ui_control_set(self.component_id, self.value)
            else:
                vn_preference_set(self.key, self.value, self.character_id)

        def get_selected(self):
            return vn_preference_option_selected(self.key, self.value, self.character_id)

        def get_sensitive(self):
            if self.component_id and not vn_ui_control_available(self.component_id):
                return False
            if self.key == "windowSize":
                return vn_window_option_available(self.value)
            return self.key != "fullscreen" or not self.value or renpy.can_fullscreen()

    @renpy.pure
    class VnPreferenceValue(BarValue, DictEquality):
        def __init__(self, key, character_id=None, reverse=False, component_id=None):
            self.component_id = component_id
            self.key, self.character_id = key, character_id
            self.reverse = reverse
            self.maximum = float(vn_preference_info[key]["max"])
            self.alt = vn_preference_info[key]["name"]

        def get_adjustment(self):
            value = vn_preference_get(self.key, self.character_id)
            # Native text-speed bars put instant text at the right-hand end.
            if self.key == "textSpeed":
                value = self.maximum if value == 0 else value - 1
            if self.reverse:
                value = self.maximum - value
            return ui.adjustment(adjustable=vn_ui_control_available(self.component_id), range=self.maximum, value=value, changed=self.changed, step=1 if self.key == "textSpeed" else self.maximum / 100.0)

        def changed(self, value):
            if self.reverse:
                value = self.maximum - value
            if self.key == "textSpeed":
                value = 0 if value >= self.maximum else min(self.maximum, value + 1)
            if self.component_id:
                vn_ui_control_set(self.component_id, value)
            else:
                vn_preference_set(self.key, value, self.character_id)

        def get_style(self):
            return "slider", "vslider"

    def vn_preference_caption(key, character_id, options):
        if key == "windowSize":
            size = _preferences.physical_size if _preferences.fullscreen else renpy.get_physical_size()
            return "%d × %d" % tuple(size or (${project.width}, ${project.height}))
        value = vn_preference_get(key, character_id)
        return next((entry["label"] for entry in options if vn_preference_equal(entry["value"], value)), str(value).replace("x", " × "))

    def vn_preference_ratio(key, character_id=None):
        value = vn_preference_get(key, character_id)
        maximum = vn_preference_info[key]["max"]
        if key == "textSpeed":
            return 1.0 if value == 0 else max(0.0, min(1.0, (value - 1) / maximum))
        return max(0.0, min(1.0, value / maximum))

    def vn_reset_preferences():
        # Unmute first: Ren'Py can raise a zero volume when clearing mute.
        # Applying authored values afterwards preserves an intentional zero.
        for mixer in vn_preference_mixers.values():
            _preferences.set_mute(mixer, False)
        # Set window size before fullscreen because resizing exits fullscreen.
        for key in ["windowSize"] + [key for key in vn_preference_defaults if key not in ("windowSize", "fullscreen", "characterVolume")]:
            vn_preference_set(key, vn_preference_defaults[key], refresh=False)
        vn_preference_set("fullscreen", vn_preference_defaults["fullscreen"], refresh=False)
        for character_id in vn_voice_tags:
            vn_preference_set("characterVolume", vn_preference_defaults["characterVolume"], character_id, refresh=False)
        vn_parameter_reset_settings(refresh=False)
        renpy.save_persistent()
        renpy.restart_interaction()

init 1600 python:
    for vn_voice_tag in vn_voice_tags.values():
        persistent._character_volume.setdefault(vn_voice_tag, vn_preference_defaults["characterVolume"])
`;
}
