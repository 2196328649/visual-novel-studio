import type { Project } from '../core/model';
import { parameterRange, parametersResetWithSettings } from '../core/parameter-sets';
import { pythonLiteral } from './literals';

export function createParameterRuntime(project: Project): string {
  const info = Object.fromEntries(project.variables.map(variable => [variable.id, { ...variable, ...parameterRange(variable) }]));
  const resettable = parametersResetWithSettings(project);
  const font = project.assets.find(asset => asset.id === project.ui.fontAssetId && asset.kind === 'font')?.path.replaceAll('\\', '/') ?? 'fonts/SourceHanSansLite.ttf';
  return `# Project variables are independent of their groups and authored controls.
python early:
    import pygame_sdl2 as vn_input_pygame

    class VnInputFocusRequests(object):
        # Class attributes are transient: no Displayable or request is serialized
        # with a screen, a task, a save or a rollback record.
        pending = None
        serial = 0

    class VnTextInputMonitor(renpy.Displayable):
        def __init__(self, replaces=None, **properties):
            super(VnTextInputMonitor, self).__init__(**properties)
            self.block_release = getattr(replaces, "block_release", False)

        def render(self, width, height, st, at):
            return renpy.Render(width, height)

        def per_interact(self):
            if renpy.game.after_rollback:
                vn_input_clear_focus()
                return
            vn_input_prune_focus()
            vn_input_apply_focus()

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
    vn_parameter_reset_ids = ${pythonLiteral(resettable.map(variable => variable.id))}

    def vn_input_page_state():
        screens = vn_input_screens()
        return (tuple(vn_ui_open_pages.items()), tuple(screen.screen_name for screen in screens))

    def vn_input_screens():
        return [screen for entry in renpy.game.context().scene_lists.layers.get("screens", []) if entry.tag for screen in [renpy.get_screen(entry.tag)] if screen is not None]

    def vn_input_available(component_id, rows=None, get=None):
        if not vn_input_focus_allowed(component_id, rows, get):
            return False
        screens = vn_input_screens()
        source = next((i for i, screen in enumerate(screens) if "vn_component_" + component_id + "_edit" in screen.widgets), None)
        return source is not None and not any(screen.modal for screen in screens[source + 1:])

    def vn_input_focus_affected(component_id, component_ids):
        if component_ids is None: return True
        current, seen = component_id, set()
        while current and current not in seen:
            if current in component_ids: return True
            seen.add(current)
            current = vn_ui_parents.get(current)
        return False

    def vn_input_clear_focus(component_ids=None):
        pending = VnInputFocusRequests.pending
        if pending and vn_input_focus_affected(pending["component"], component_ids): VnInputFocusRequests.pending = None
        current, active = renpy.get_editable_input_value()
        if active and isinstance(current, VnParameterInput) and vn_input_focus_affected(current.component_id, component_ids):
            # Programmatic cancellation is never a user submission.
            renpy.set_editable_input_value(current, False)

    def vn_input_focus_allowed(component_id, rows=None, get=None):
        if not vn_ui_control_available(component_id, rows, get): return False
        info = vn_ui_controls[component_id]
        page = info["pageId"]
        if page in vn_ui_open_pages and not vn_ui_page_interactive(page): return False
        screens = vn_input_screens()
        names = info.get("screens", []) if page.startswith("ui:") else ["vn_blueprint_pages"] if page in vn_ui_open_pages else ["vn_minigame_custom"]
        source = next((i for i, screen in enumerate(screens) if "vn_component_" + component_id + "_edit" in screen.widgets or screen.screen_name[0] in names), None)
        if source is None:
            # A just-opened authored page may not have been reconstructed yet.
            # Its permanent host is at zorder 65; an existing higher modal wins.
            return page in vn_ui_open_pages and not any(screen.modal and screen.zorder >= 65 for screen in screens)
        return not any(screen.modal for screen in screens[source + 1:])

    def vn_input_request_focus(component_id, focused=True):
        info = vn_ui_controls.get(component_id)
        if not isinstance(focused, bool) or not info or not info.get("textInput"):
            raise Exception("焦点操作需要有效的文字输入控件和开关值。")
        if renpy.game.after_rollback: return False
        task = vn_bp_task_create(info["pageId"])
        if not vn_bp_task_alive(task) or focused and not vn_input_focus_allowed(component_id): return False
        VnInputFocusRequests.serial += 1
        VnInputFocusRequests.pending = {"component": component_id, "focused": focused, "task": task, "serial": VnInputFocusRequests.serial}
        renpy.restart_interaction()
        # Accepted means queued, not that the editable input has already changed.
        return True

    def vn_input_prepare_prune(rows=None, get=None):
        pending = VnInputFocusRequests.pending
        clear_pending = bool(pending and (not vn_bp_task_alive(pending["task"]) or pending["focused"] and not vn_input_focus_allowed(pending["component"], rows, get)))
        current, active = renpy.get_editable_input_value()
        clear_current = bool(active and isinstance(current, VnParameterInput) and current.component_id and not vn_input_available(current.component_id, rows, get))
        return pending, clear_pending, current, clear_current

    def vn_input_prune_focus(prepared=None):
        if prepared is not None:
            pending, clear_pending, current, clear_current = prepared
            if clear_pending and VnInputFocusRequests.pending is pending: VnInputFocusRequests.pending = None
            if clear_current and renpy.get_editable_input_value()[0] is current: renpy.set_editable_input_value(current, False)
            return
        pending = VnInputFocusRequests.pending
        if pending and (not vn_bp_task_alive(pending["task"]) or pending["focused"] and not vn_input_focus_allowed(pending["component"])):
            VnInputFocusRequests.pending = None
        current, active = renpy.get_editable_input_value()
        if active and isinstance(current, VnParameterInput) and current.component_id and not vn_input_available(current.component_id):
            renpy.set_editable_input_value(current, False)

    def vn_input_apply_focus():
        pending = VnInputFocusRequests.pending
        if not pending: return
        if not vn_bp_task_alive(pending["task"]):
            VnInputFocusRequests.pending = None
            return
        component_id = pending["component"]
        current, active = renpy.get_editable_input_value()
        if not pending["focused"]:
            VnInputFocusRequests.pending = None
            if active and isinstance(current, VnParameterInput) and current.component_id == component_id:
                renpy.set_editable_input_value(current, False)
            return
        if not vn_input_focus_allowed(component_id):
            VnInputFocusRequests.pending = None
            return
        widget = next((screen.widgets.get("vn_component_" + component_id) for screen in vn_input_screens() if "vn_component_" + component_id in screen.widgets), None)
        value = getattr(widget, "value", None)
        # OnShow can run while its screen is still being reconstructed. Wait for
        # registration by that same live page, not by a replacement page/token.
        # This uses normal per_interact refreshes, never a polling task or thread.
        if not isinstance(value, VnParameterInput): return
        VnInputFocusRequests.pending = None
        if vn_input_available(component_id): renpy.set_editable_input_value(value, True)

    def vn_input_after_load():
        vn_input_clear_focus()

    config.after_load_callbacks.append(vn_input_after_load)
    config.start_callbacks.append(vn_input_after_load)
    config.always_shown_screens.append("vn_text_input_events")

    def vn_parameter_get(parameter_id):
        info = vn_parameter_info[parameter_id]
        owner = persistent if info["persistent"] else renpy.store
        return getattr(owner, "vn_var_" + parameter_id, info["initial"])

    def vn_parameter_value_valid(info, value):
        kind = info["type"]
        return isinstance(value, bool) if kind == "boolean" else isinstance(value, str) if kind in ("string", "asset") else isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)

    def vn_parameter_validate_values(values):
        for parameter_id, value in values.items():
            info = vn_parameter_info.get(parameter_id)
            if info is None: raise Exception("来源参数已不存在，请重新选择。")
            if not vn_parameter_value_valid(info, value):
                raise Exception(info["name"] + "的参数类型不匹配。")

    def vn_parameter_commit_values(values, animation=False):
        persistent_changed = False
        pending = set(getattr(vn_parameter_commit_values, "pending", ()))
        for parameter_id, value in values.items():
            info = vn_parameter_info[parameter_id]
            if not animation: vn_ui_parameter_stop_animations(parameter_id)
            previous = vn_parameter_get(parameter_id)
            changed = not vn_ui_property_values_equal(previous, value)
            if changed:
                owner = persistent if info["persistent"] else renpy.store
                setattr(owner, "vn_var_" + parameter_id, value)
            if info["persistent"]:
                if animation:
                    if changed: pending.add(parameter_id)
                else:
                    pending.discard(parameter_id)
                    persistent_changed = True
        vn_parameter_commit_values.pending = pending
        if persistent_changed:
            renpy.retain_after_load()
            renpy.save_persistent()

    def vn_parameter_flush_animations(force=False):
        pending = set(getattr(vn_parameter_commit_values, "pending", ()))
        if not pending: return
        active = set()
        if not force:
            for component_id, property in vn_ui_animations:
                control = vn_ui_property_controls.get(component_id, {}).get(property)
                if control and control.get("mode") == "sync": active.add(control["parameterId"])
        # Persist completed/stopped animations once, not at every 60 Hz sample.
        if pending - active:
            renpy.retain_after_load()
            renpy.save_persistent()
            vn_parameter_commit_values.pending = pending & active

    def vn_parameter_animation_save_reset():
        vn_parameter_flush_animations(True)
        vn_parameter_commit_values.pending = set()

    config.quit_callbacks.append(vn_parameter_animation_save_reset)
    config.after_load_callbacks.append(vn_parameter_animation_save_reset)
    config.start_callbacks.append(vn_parameter_animation_save_reset)

    def vn_parameter_set(parameter_id, value, refresh=True, _ui_animation=False):
        values = {parameter_id: value}
        vn_parameter_validate_values(values)
        changes = vn_ui_property_validate_changes(values)
        vn_parameter_commit_values(values, _ui_animation)
        vn_ui_property_changes_applied(changes)
        if refresh: renpy.restart_interaction()

    def vn_parameter_asset_valid(info, value):
        assets = globals().get("vn_bp_assets", {})
        return value == "" or isinstance(value, str) and value in assets and assets[value]["kind"] == info.get("assetKind", "image")

    def vn_parameter_repair_assets():
        # Later builds can change a parameter's type or remove an asset. Keep
        # compatible player values; repair only values the new type cannot use.
        changed = False
        for parameter_id, info in vn_parameter_info.items():
            # Explicit property sources report invalid saved values at their
            # use site. Never silently replace those values with an initial.
            if vn_ui_parameter_readers.get(parameter_id): continue
            value = vn_parameter_get(parameter_id)
            if vn_parameter_value_valid(info, value) and (info["type"] != "asset" or vn_parameter_asset_valid(info, value)):
                continue
            owner = persistent if info["persistent"] else renpy.store
            initial = info["initial"]
            if info["type"] == "asset" and not vn_parameter_asset_valid(info, initial): initial = ""
            vn_ui_parameter_stop_animations(parameter_id)
            setattr(owner, "vn_var_" + parameter_id, initial)
            changed = changed or info["persistent"]
        if changed:
            renpy.save_persistent()

    config.start_callbacks.append(vn_parameter_repair_assets)
    config.after_load_callbacks.append(vn_parameter_repair_assets)

    def vn_parameter_prepare_settings_reset():
        values = {parameter_id: vn_parameter_info[parameter_id]["initial"] for parameter_id in vn_parameter_reset_ids}
        vn_parameter_validate_values(values)
        changes = vn_ui_property_validate_changes(values)
        return values, changes

    def vn_parameter_reset_settings(refresh=True, _prepared=None):
        values, changes = vn_parameter_prepare_settings_reset() if _prepared is None else _prepared
        vn_parameter_commit_values(values)
        vn_ui_property_changes_applied(changes)
        if refresh:
            renpy.restart_interaction()

    def vn_parameter_ratio(parameter_id):
        info = vn_parameter_info[parameter_id]
        return max(0.0, min(1.0, (vn_parameter_get(parameter_id) - info["min"]) / max(0.001, info["max"] - info["min"])))

    class VnParameterValue(BarValue, FieldEquality):
        equality_fields = ("parameter_id", "reverse", "component_id", "screen_available")
        def __init__(self, parameter_id, reverse=False, component_id=None, screen_available=None):
            self.component_id, self.screen_available = component_id, screen_available
            self.parameter_id = parameter_id
            self.reverse = reverse
        def get_adjustment(self):
            if self.component_id: return vn_ui_control_bar_adjustment(self.component_id, self.changed, self.reverse, self.screen_available)
            info = vn_parameter_info[self.parameter_id]
            span = max(0.0, info["max"] - info["min"])
            current = vn_parameter_get(self.parameter_id)
            value = max(0, min(info["max"], current) - info["min"])
            return ui.adjustment(adjustable=span > 0, range=span or 1.0, value=span - value if self.reverse else value, changed=self.changed, step=info["step"])
        def changed(self, value):
            if self.component_id: return vn_ui_control_bar_changed(self.component_id, value, self.reverse)
            info = vn_parameter_info[self.parameter_id]
            span = info["max"] - info["min"]
            if span <= 0: return
            ratio = 1.0 - value / span if self.reverse else value / span
            vn_parameter_set(self.parameter_id, vn_ui_range_user_value(info, ratio))
        def get_style(self):
            return "slider", "vslider"

    class VnParameterInput(InputValue, FieldEquality):
        equality_fields = ("parameter_id", "component_id")
        default = False
        def __init__(self, parameter_id, component_id=None):
            self.component_id = component_id
            self.parameter_id = parameter_id
        def get_text(self):
            return str(vn_ui_control_get(self.component_id) if self.component_id else vn_parameter_get(self.parameter_id))
        def set_text(self, text):
            # Ren'Py calls changed() when an InputValue refreshes its display as
            # well as on user edits. Do not commit a display-only override back
            # to the source or synthesize an event during that refresh.
            if text == self.get_text():
                return
            if self.component_id:
                vn_ui_control_set(self.component_id, text[:int(vn_ui_get(self.component_id, "maxLength"))])
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

screen vn_parameter_control(parameter_id, width=700, height=95, font_size=26, color="#ffffff", font=${pythonLiteral(font)}, caption=None, component_id=None, layout_rows=None):
    $ screen_available = vn_ui_control_available(component_id, layout_rows)
    $ identity = "vn_component_" + component_id if component_id else "vn_parameter_" + parameter_id
    $ info = vn_parameter_info[parameter_id]
    $ value = vn_ui_control_get(component_id) if component_id else vn_parameter_get(parameter_id)
    $ options = vn_ui_control_options(component_id) if component_id and vn_ui_controls[component_id].get("choice") else [dict(label=entry, value=entry) for entry in (info.get("setting") or {}).get("options") or []]
    $ is_choice = vn_ui_controls[component_id].get("choice", False) if component_id else bool(options)
    $ options_key = vn_ui_control_options_key(component_id) if component_id and is_choice else None
    $ options_task = vn_bp_task_create(vn_ui_controls[component_id]["pageId"], create_native=False) if component_id and is_choice else None
    # The author sizes this as one control. Bound its label and input separately
    # so the native button padding cannot grow through the next layout row.
    $ title_height = max(1, min(int(height * 0.4), int(font_size * 1.25)))
    $ gap = min(6, max(0, int(height * 0.06)))
    $ body_height = max(1, height - title_height - gap)
    $ title_size = max(1, min(font_size, int(title_height * 0.8)))
    $ body_size = max(1, min(font_size, int(body_height * 0.7)))
    fixed:
        id (identity + "_bounds")
        xysize (width, height)
        clipping True
        text (caption or info["name"]) substitute False font font size title_size color color xmaximum width ymaximum title_height layout "nobreak"
        if info["type"] == "boolean":
            textbutton ("开启" if value else "关闭") action (Function(vn_ui_control_set, component_id, not value) if component_id else Function(vn_parameter_set, parameter_id, not value)) sensitive screen_available selected bool(value) text_font font text_size body_size text_color color id (identity + "_toggle") ypos (title_height + gap) ysize body_height yminimum 0 padding (min(8, int(width * 0.1)), 0) text_yalign 0.5
        elif info["type"] == "number":
            bar value VnParameterValue(parameter_id, component_id=component_id, screen_available=screen_available) xsize width ysize max(1, min(body_height, int(height * 0.25))) ypos (title_height + gap) id identity
        elif is_choice:
            $ scrollbar_height = max(1, min(8, int(body_height * 0.2)))
            $ choice_height = max(1, body_height - scrollbar_height)
            viewport:
                id (identity + "_options_view")
                xpos 0
                ypos (title_height + gap)
                xysize (width, body_height)
                scrollbars "horizontal"
                scrollbar_ysize scrollbar_height
                scrollbar_unscrollable "hide"
                mousewheel "horizontal-change"
                draggable True
                hbox:
                    spacing min(12, int(width * 0.03))
                    for option_index, option in enumerate(options):
                        textbutton vn_ui_literal(option["label"]) action (VnSelectControlOption(component_id, option_index, options_key, options_task, screen_available) if component_id else Function(vn_parameter_set, parameter_id, option["value"])) selected vn_preference_equal(value, option["value"]) text_font font text_size max(1, min(body_size, int(choice_height * 0.7))) text_color color text_layout "nobreak" substitute False id (identity + "_option_" + str(option_index)) ysize choice_height yminimum 0 padding (min(8, int(width * 0.1)), 0) text_yalign 0.5
        else:
            $ input_value = VnParameterInput(parameter_id, component_id)
            button:
                action input_value.Enable()
                sensitive screen_available
                id (identity + "_edit")
                ypos (title_height + gap)
                xysize (width, body_height)
                padding (0, 0)
                yminimum 0
                clipping True
                fixed:
                    xysize (width, body_height)
                    input value input_value length (int(vn_ui_get(component_id, "maxLength")) if component_id else 200) font font size body_size color color id identity yalign 0.5
                    if component_id and not value and vn_ui_get(component_id, "placeholder"):
                        text vn_ui_literal(vn_ui_get(component_id, "placeholder")) substitute False font font size body_size color color at Transform(alpha=0.5) xmaximum width yalign 0.5

`;
}
