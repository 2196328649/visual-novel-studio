import type { Project } from '../core/model';
import { parameterRange, parameterSets, settingsParameters } from '../core/parameter-sets';
import { pythonLiteral } from './literals';

export function createParameterRuntime(project: Project): string {
  const info = Object.fromEntries(project.variables.map(variable => [variable.id, { ...variable, ...parameterRange(variable) }]));
  const settings = settingsParameters(project);
  const font = project.assets.find(asset => asset.id === project.ui.fontAssetId && asset.kind === 'font')?.path.replaceAll('\\', '/') ?? 'fonts/SourceHanSansLite.ttf';
  const groups = parameterSets(project).filter(set => set.kind === 'settings').map(set => [set.name, settings.filter(variable => variable.parameterSetId === set.id && variable.setting?.visible !== false).map(variable => variable.id)]);
  return `# Parameter sets organize existing story variables and persistent player options.
python early:
    import pygame_sdl2 as vn_input_pygame

    class VnTextInputMonitor(renpy.Displayable):
        def __init__(self, replaces=None, **properties):
            super(VnTextInputMonitor, self).__init__(**properties)
            self.block_release = getattr(replaces, "block_release", False)

        def render(self, width, height, st, at):
            return renpy.Render(width, height)

        def per_interact(self):
            current, active = renpy.get_editable_input_value()
            if active and isinstance(current, VnParameterInput) and current.component_id:
                if renpy.game.after_rollback or not vn_input_available(current.component_id):
                    renpy.set_editable_input_value(current, False)

        def event(self, ev, x, y, st):
            mouse_down = ev.type == vn_input_pygame.MOUSEBUTTONDOWN and ev.button == 1
            if ev.type == vn_input_pygame.MOUSEBUTTONUP and ev.button == 1 and self.block_release:
                self.block_release = False
                raise renpy.IgnoreEvent()
            current, active = renpy.get_editable_input_value()
            if not active or not isinstance(current, VnParameterInput) or not current.component_id:
                return None
            if not vn_input_available(current.component_id):
                renpy.set_editable_input_value(current, False)
                renpy.restart_interaction()
                return None
            tab = ev.type == vn_input_pygame.KEYDOWN and ev.key == vn_input_pygame.K_TAB
            if not mouse_down and not tab:
                return None
            focus = renpy.display.render.focus_at_point(x, y) if mouse_down else None
            action = getattr(getattr(focus, "widget", None), "action", None)
            if mouse_down and getattr(action, "input_value", None) == current:
                return None
            before = vn_input_page_state()
            current.commit("focusLost")
            if mouse_down and before != vn_input_page_state():
                # Do not deliver the release to a page opened by this commit.
                self.block_release = True
                raise renpy.IgnoreEvent()
            return None

init python:
    import math
    vn_parameter_info = ${pythonLiteral(info)}
    vn_parameter_settings = ${pythonLiteral(settings.map(variable => variable.id))}
    vn_parameter_groups = ${pythonLiteral(groups)}

    def vn_input_page_state():
        screens = vn_input_screens()
        return (tuple(vn_ui_open_pages.items()), tuple(screen.screen_name for screen in screens))

    def vn_input_screens():
        return [screen for entry in renpy.game.context().scene_lists.layers.get("screens", []) if entry.tag for screen in [renpy.get_screen(entry.tag)] if screen is not None]

    def vn_input_available(component_id):
        if not vn_ui_control_available(component_id):
            return False
        screens = vn_input_screens()
        source = next((i for i, screen in enumerate(screens) if "vn_component_" + component_id + "_edit" in screen.widgets), None)
        return source is not None and not any(screen.modal for screen in screens[source + 1:])

    config.always_shown_screens.append("vn_text_input_events")

    def vn_parameter_get(parameter_id):
        info = vn_parameter_info[parameter_id]
        owner = persistent if info["persistent"] else renpy.store
        return getattr(owner, "vn_var_" + parameter_id, info["initial"])

    def vn_parameter_set(parameter_id, value, refresh=True):
        info = vn_parameter_info[parameter_id]
        kind = info["type"]
        valid = isinstance(value, bool) if kind == "boolean" else isinstance(value, str) if kind == "string" else isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
        if not valid:
            raise Exception(info["name"] + "的参数类型不匹配。")
        owner = persistent if info["persistent"] else renpy.store
        setattr(owner, "vn_var_" + parameter_id, value)
        if info["persistent"]:
            renpy.retain_after_load()
            renpy.save_persistent()
        if refresh:
            renpy.restart_interaction()

    def vn_parameter_reset_settings(refresh=True):
        for parameter_id in vn_parameter_settings:
            vn_parameter_set(parameter_id, vn_parameter_info[parameter_id]["initial"], False)
        if refresh:
            renpy.restart_interaction()

    def vn_parameter_unplaced(placed):
        return [parameter_id for _, ids in vn_parameter_groups for parameter_id in ids if parameter_id not in placed]

    def vn_parameter_ratio(parameter_id):
        info = vn_parameter_info[parameter_id]
        return max(0.0, min(1.0, (vn_parameter_get(parameter_id) - info["min"]) / max(0.001, info["max"] - info["min"])))

    class VnParameterValue(BarValue, FieldEquality):
        equality_fields = ("parameter_id", "reverse", "component_id")
        def __init__(self, parameter_id, reverse=False, component_id=None):
            self.component_id = component_id
            self.parameter_id = parameter_id
            self.reverse = reverse
        def get_adjustment(self):
            info = vn_parameter_info[self.parameter_id]
            span = max(0.001, info["max"] - info["min"])
            value = max(0, min(info["max"], vn_parameter_get(self.parameter_id)) - info["min"])
            return ui.adjustment(adjustable=vn_ui_control_available(self.component_id), range=span, value=span - value if self.reverse else value, changed=self.changed, step=info["step"])
        def changed(self, value):
            info = vn_parameter_info[self.parameter_id]
            if self.reverse:
                value = info["max"] - info["min"] - value
            value = min(info["max"], max(info["min"], info["min"] + round(value / info["step"]) * info["step"]))
            if self.component_id:
                vn_ui_control_set(self.component_id, value)
            else:
                vn_parameter_set(self.parameter_id, value)
        def get_style(self):
            return "slider", "vslider"

    class VnParameterInput(InputValue, FieldEquality):
        equality_fields = ("parameter_id", "component_id")
        default = False
        def __init__(self, parameter_id, component_id=None):
            self.component_id = component_id
            self.parameter_id = parameter_id
        def get_text(self):
            return str(vn_parameter_get(self.parameter_id))
        def set_text(self, text):
            if self.component_id:
                vn_ui_control_set(self.component_id, text)
            else:
                vn_parameter_set(self.parameter_id, text, False)

        def commit(self, method):
            current, active = renpy.get_editable_input_value()
            if current != self or not active:
                return
            renpy.set_editable_input_value(self, False)
            if self.component_id and vn_input_available(self.component_id):
                vn_ui_control_commit(self.component_id, method)
            renpy.restart_interaction()

        def enter(self):
            # The Enter used to accept an IME candidate is not a submission.
            if not renpy.display.interface.text_editing:
                self.commit("enter")
            raise renpy.IgnoreEvent()

screen vn_text_input_events():
    zorder 11000
    default monitor = VnTextInputMonitor()
    add monitor

screen vn_parameter_control(parameter_id, width=700, height=95, font_size=26, color="#ffffff", font=${pythonLiteral(font)}, caption=None, component_id=None):
    $ identity = "vn_component_" + component_id if component_id else "vn_parameter_" + parameter_id
    $ info = vn_parameter_info[parameter_id]
    $ value = vn_parameter_get(parameter_id)
    $ options = (info.get("setting") or {}).get("options") or []
    vbox:
        xsize width
        spacing 6
        text (caption or info["name"]) substitute False font font size font_size color color
        if info["type"] == "boolean":
            textbutton ("开启" if value else "关闭") action (Function(vn_ui_control_set, component_id, not value) if component_id else Function(vn_parameter_set, parameter_id, not value)) sensitive vn_ui_control_available(component_id) selected bool(value) text_font font text_size font_size text_color color id (identity + "_toggle")
        elif info["type"] == "number":
            bar value VnParameterValue(parameter_id, component_id=component_id) xsize width ysize max(12, int(height * 0.25)) id identity
        elif options:
            hbox:
                spacing 12
                for option_index, option in enumerate(options):
                    textbutton option action (Function(vn_ui_control_set, component_id, option) if component_id else Function(vn_parameter_set, parameter_id, option)) sensitive vn_ui_control_available(component_id) selected (value == option) text_font font text_size font_size text_color color id (identity + "_option_" + str(option_index))
        else:
            $ input_value = VnParameterInput(parameter_id, component_id)
            button:
                action input_value.Enable()
                sensitive vn_ui_control_available(component_id)
                id (identity + "_edit")
                xsize width
                input value input_value length 200 font font size font_size color color id identity

screen vn_parameter_settings(placed=[], width=700, font_size=26, color="#ffffff"):
    for group_name, parameter_ids in vn_parameter_groups:
        if any(parameter_id not in placed for parameter_id in parameter_ids):
            label group_name
            for parameter_id in parameter_ids:
                if parameter_id not in placed:
                    use vn_parameter_control(parameter_id, width=width, font_size=font_size, color=color)
                    null height 15
`;
}
