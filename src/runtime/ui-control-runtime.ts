import { uiControlOptionsRuntime } from './ui-control-options-runtime';
import { uiControlOptionsKey } from '../core/ui-control-options';
import { projectGraphs } from '../core/project-resources';
import { declaredUiComponents, type Project } from '../core/model';
import { uiControlValueType, uiTextInput } from '../core/ui-control-events';
import { uiControlDefinition, uiControlPrimaryProperty, uiControlValueProperties } from '../core/ui-control-properties';
import { uiEventInActiveInstance, uiGraphOnPage } from '../core/ui-logic';
import { pythonLiteral } from './literals';

export function createUiControlRuntime(project:Project,pageScreens:Readonly<Partial<Record<string,readonly string[]>>>) {
 const controls=Object.fromEntries(declaredUiComponents(project).filter(c=>uiControlValueType(project,c)).map(c=>{
  const pageId=c.page==='custom'?project.ui.customPages.find(p=>p.components.some(n=>n.id===c.id))!.id:'ui:'+c.page;
  const handlers=projectGraphs(project).flatMap(g=>uiGraphOnPage(project,g,pageId)?g.nodes.filter(n=>n.type==='eventValueChanged'&&n.properties.componentId===c.id&&uiEventInActiveInstance(project,n)).map(n=>[g.id,n.id]):[]);
  const commits=uiTextInput(project,c)?projectGraphs(project).flatMap(g=>uiGraphOnPage(project,g,pageId)?g.nodes.filter(n=>n.type==='eventTextCommitted'&&n.properties.componentId===c.id&&uiEventInActiveInstance(project,n)).map(n=>[g.id,n.id]):[]):[];
  const definition = uiControlDefinition(project, c)!;
  return [c.id,{...definition,optionsKey:uiControlOptionsKey(definition.options),primary:uiControlPrimaryProperty(definition),pageId,screens:pageScreens[c.page]??[],handlers,commits}];
 }));
 return `    vn_ui_controls = ${pythonLiteral(controls)}

    vn_ui_control_value_properties = ${pythonLiteral(uiControlValueProperties)}

${uiControlOptionsRuntime}

    def vn_ui_control_available(component_id, layout_rows=None, get=None):
        get = get or vn_ui_get
        if component_id is None:
            return True
        return component_id in vn_ui_controls and vn_ui_component_available(component_id, layout_rows, get) and not get(component_id, "readOnly") and vn_ui_property_user_writable(component_id, vn_ui_controls[component_id]["primary"])

    def vn_ui_control_source(component_id):
        info = vn_ui_controls[component_id]
        return vn_parameter_get(info["parameterId"]) if info.get("parameterId") else vn_preference_get(info["preference"], info.get("characterId"))

    vn_ui_control_range_fields = {"minimum": "min", "maximum": "max", "step": "step"}

    def vn_ui_control_range(component_id, overrides=None, parameter_values=None, local_values=None):
        info = vn_ui_controls.get(component_id)
        if not info or info["type"] != "number": raise Exception("范围只适用于已绑定的数值控件。")
        values = vn_ui_overrides.get(component_id, {}) if overrides is None else overrides
        result = {}
        controlled = False
        for prop, field in vn_ui_control_range_fields.items():
            control = vn_ui_property_control(component_id, prop)
            if control is not None:
                controlled = True
                result[field] = vn_ui_property_control_raw(component_id, prop, control, parameter_values, local_values)
            elif local_values is not None and (component_id, prop) in local_values: result[field] = local_values[component_id, prop]
            else: result[field] = values.get(prop, info["range"][field])
        if controlled:
            vn_ui_control_validate_range(component_id, result)
        return result

    def vn_ui_control_validate_range(component_id, span):
        info = vn_ui_controls.get(component_id)
        if not info or info["type"] != "number": raise Exception("范围只适用于已绑定的数值控件。")
        if not all(not isinstance(value, bool) and isinstance(value, (int, float)) and __import__("math").isfinite(value) for value in span.values()):
            raise Exception("控件范围与步长必须是有限数值。")
        if span["min"] > span["max"]: raise Exception("控件范围下限不能大于上限；跨越原范围时请一次设置整个范围。")
        if not __import__("math").isfinite(span["max"] - span["min"]): raise Exception("控件范围跨度过大。")
        if span["step"] <= 0: raise Exception("控件步长必须大于 0。")
        if span["max"] > span["min"] and span["step"] / (span["max"] - span["min"]) == 0: raise Exception("控件步长相对范围过小，无法表示用户调整。")
        limit = vn_preference_info.get(info.get("preference"), {}).get("limit")
        if limit and (span["min"] < limit["min"] or limit.get("max") is not None and span["max"] > limit["max"]):
            raise Exception("控件范围不能超过玩家设置的引擎边界。")

    def vn_ui_control_set_range(component_id, minimum, maximum, step):
        span = {"min": minimum, "max": maximum, "step": step}
        vn_ui_control_validate_range(component_id, span)
        vn_ui_property_apply([(component_id, "minimum", minimum), (component_id, "maximum", maximum), (component_id, "step", step)])
        renpy.retain_after_load()
        renpy.restart_interaction()

    def vn_ui_control_reset_range(component_id):
        vn_ui_control_range(component_id)
        values = dict(vn_ui_overrides.get(component_id, {}))
        for field in vn_ui_control_range_fields: values.pop(field, None)
        vn_ui_control_validate_range(component_id, vn_ui_control_range(component_id, values))
        vn_ui_overrides[component_id] = values
        renpy.retain_after_load()
        renpy.restart_interaction()

    def vn_ui_control_get(component_id, span=None):
        info = vn_ui_controls[component_id]
        override = vn_ui_overrides.get(component_id, {})
        control = vn_ui_property_control(component_id, info["primary"])
        value = vn_ui_property_control_read(component_id, info["primary"], control) if control is not None else override[info["primary"]] if info["primary"] in override else vn_ui_control_source(component_id)
        if info["type"] != "number": return value
        span = vn_ui_control_range(component_id) if span is None else span
        if control is not None: vn_ui_control_validate_range(component_id, span)
        if info.get("instantAtEnd"):
            if value == 0: return 0 if span["min"] == 0 else span["max"]
            if span["min"] == 0: return max(min(1, span["max"]), min(span["max"], value))
        return max(span["min"], min(span["max"], value))

    def vn_ui_range_travel(span, instant_at_end=False):
        instant = bool(instant_at_end and span["min"] == 0 and span["max"] > 0)
        start = min(1, span["max"]) if instant else span["min"]
        travel = 0 if span["max"] == span["min"] else span["max"] - start + (min(span["step"], span["max"]) if instant else 0)
        return start, travel, instant

    def vn_ui_control_travel(component_id):
        return vn_ui_range_travel(vn_ui_control_range(component_id), vn_ui_controls[component_id].get("instantAtEnd", False))

    def vn_ui_range_from_ratio(span, ratio, instant_at_end=False):
        start, travel, instant = vn_ui_range_travel(span, instant_at_end)
        return 0 if instant and ratio == 1 else min(span["max"], start + ratio * travel)

    def vn_ui_range_decimals(number):
        digits, _, exponent = repr(float(number)).partition("e")
        return max(0, len(digits.partition(".")[2]) - int(exponent or 0))

    def vn_ui_range_user_value(span, ratio, instant_at_end=False):
        ratio = max(0.0, min(1.0, ratio))
        start, travel, instant = vn_ui_range_travel(span, instant_at_end)
        value = vn_ui_range_from_ratio(span, ratio, instant_at_end)
        if 0 < ratio < 1 and travel > 0:
            count = (value - start) / span["step"]
            value = start + __import__("math").floor(count + .5) * span["step"] if __import__("math").isfinite(count) else value
            # Round to the step's precision so 35 steps of 0.01 give 0.35, not 0.35000000000000003.
            value = round(value, min(15, max(vn_ui_range_decimals(start), vn_ui_range_decimals(span["step"]))))
            value = max(start, min(span["max"], value))
        return value

    def vn_ui_control_ratio(component_id):
        value = vn_ui_control_get(component_id)
        start, travel, instant = vn_ui_control_travel(component_id)
        return vn_ui_range_ratio(value, start, travel, instant)

    def vn_ui_range_ratio(value, start, travel, instant):
        if travel == 0: return 0
        return 1 if instant and value == 0 else max(0.0, min(1.0, (value - start) / travel))

    def vn_ui_control_from_ratio(component_id, ratio):
        return vn_ui_range_from_ratio(vn_ui_control_range(component_id), ratio, vn_ui_controls[component_id].get("instantAtEnd", False))

    def vn_ui_control_bar_adjustment(component_id, changed, reverse=False, screen_available=None):
        # One synchronous read; bindings are still validated by the usual
        # getters, and no values are retained across input or parameter writes.
        span = vn_ui_control_range(component_id)
        start, travel, instant = vn_ui_range_travel(span, vn_ui_controls[component_id].get("instantAtEnd", False))
        ratio = vn_ui_range_ratio(vn_ui_control_get(component_id, span), start, travel, instant)
        available = vn_ui_control_available(component_id) if screen_available is None else screen_available
        return ui.adjustment(adjustable=available and travel > 0, range=1.0, value=1.0 - ratio if reverse else ratio, changed=changed, step=min(1.0, span["step"] / travel) if travel else 1.0)

    def vn_ui_control_bar_changed(component_id, ratio, reverse=False):
        if not vn_ui_control_available(component_id): return
        ratio = max(0.0, min(1.0, 1.0 - ratio if reverse else ratio))
        span = vn_ui_control_range(component_id)
        start, travel, instant = vn_ui_range_travel(span, vn_ui_controls[component_id].get("instantAtEnd", False))
        if travel == 0: return
        # No writes or callbacks occur after the fresh availability check.
        # Reuse it within this action instead of resolving the page twice.
        _vn_ui_control_set_checked(component_id, vn_ui_range_user_value(span, ratio, vn_ui_controls[component_id].get("instantAtEnd", False)))

    def vn_ui_control_property(component_id, property):
        info = vn_ui_controls[component_id]
        if property == info["primary"]: return vn_ui_control_get(component_id)
        if property == "normalizedValue": return vn_ui_control_ratio(component_id)
        if property in vn_ui_control_range_fields: return vn_ui_control_range(component_id)[vn_ui_control_range_fields[property]]
        if property in ("sourceMinimum", "sourceMaximum", "sourceStep"): return info["sourceRange"][{"sourceMinimum": "min", "sourceMaximum": "max", "sourceStep": "step"}[property]]
        if property == "optionCount": return len(vn_ui_control_options(component_id))
        if property in ("optionIndex", "optionLabel"):
            value = vn_ui_control_get(component_id)
            options = vn_ui_control_options(component_id)
            index = next((i for i, option in enumerate(options) if vn_preference_equal(option["value"], value)), -1)
            return index if property == "optionIndex" else options[index]["label"] if index >= 0 else ""
        if property == "focused":
            current, active = renpy.get_editable_input_value()
            return bool(active and isinstance(current, VnParameterInput) and current.component_id == component_id and vn_input_available(component_id))

    def vn_ui_control_valid_value(component_id, value, source_read=False, parameter_values=None, local_values=None):
        info = vn_ui_controls[component_id]
        kind = info["type"]
        valid = isinstance(value, bool) if kind == "boolean" else isinstance(value, str) if kind == "string" else not isinstance(value, bool) and isinstance(value, (int, float)) and __import__("math").isfinite(value)
        span = vn_ui_control_range(component_id, parameter_values=parameter_values, local_values=local_values) if info.get("range") else None
        if valid and span and not source_read: valid = span["min"] <= value <= span["max"]
        if valid and info.get("choice"): valid = any(vn_preference_equal(value, option["value"]) for option in vn_ui_control_options(component_id))
        if valid and info["textInput"]: valid = len(value) <= vn_ui_property_candidate(component_id, "maxLength", parameter_values, local_values)
        return bool(valid)

    def vn_ui_control_assign(component_id, property, value, write_mode="override"):
        info = vn_ui_controls[component_id]
        if write_mode not in ("source", "override"): raise Exception("请选择临时覆盖或修改绑定源。")
        control = vn_ui_property_control(component_id, property)
        if control is not None and control["mode"] == "follow":
            raise Exception("此控件值正单向跟随参数；请修改来源参数或切换控制方式。")
        if property == "normalizedValue":
            value = vn_ui_control_from_ratio(component_id, value)
        elif property == "optionIndex":
            options = vn_ui_control_options(component_id)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not __import__("math").isfinite(value) or int(value) != value or not 0 <= value < len(options):
                raise Exception("选项索引必须指向现有选项；-1 只表示当前值没有匹配项。")
            value = options[int(value)]["value"]
        if not vn_ui_control_valid_value(component_id, value): raise Exception("控件值的类型、范围、选项或输入长度不符合绑定要求。")
        if control is not None:
            vn_ui_property_apply([(component_id, info["primary"], value)])
            return
        override = dict(vn_ui_overrides.get(component_id, {}))
        if write_mode == "source":
            if info.get("parameterId"): vn_parameter_set(info["parameterId"], value, False)
            else: vn_preference_set(info["preference"], value, info.get("characterId"), False)
            override.pop(info["primary"], None)
        elif write_mode == "override": override[info["primary"]] = value
        else: raise Exception("请选择临时覆盖或修改绑定源。")
        vn_ui_overrides[component_id] = override

    def vn_ui_control_set(component_id, value):
        if not vn_ui_control_available(component_id): return
        _vn_ui_control_set_checked(component_id, value)

    def _vn_ui_control_set_checked(component_id, value):
        previous = vn_ui_control_get(component_id)
        vn_ui_control_assign(component_id, vn_ui_controls[component_id]["primary"], value, "source")
        current = vn_ui_control_get(component_id)
        renpy.restart_interaction()
        if not vn_preference_equal(previous, current):
            vn_ui_control_emit(component_id, "handlers", {"value": current, "previous": previous})

    def vn_ui_slider_options(component_id, authored):
        if component_id is None: return authored
        result = dict(authored)
        for field in ("trackHeight", "thumbWidth", "thumbHeight", "reverse", "showLabel", "trackColor", "fillColor", "thumbColor"):
            result[field] = vn_ui_get(component_id, "slider" + field[0].upper() + field[1:])
        result["trackPath"] = vn_bp_optional_asset(vn_ui_get(component_id, "sliderTrackImage"), "image")
        result["fillPath"] = vn_bp_optional_asset(vn_ui_get(component_id, "sliderFillImage"), "image")
        thumb = dict(authored.get("thumb") or {})
        for state, property in (("idle", "sliderThumbImage"), ("hover", "sliderHoverThumbImage"), ("pressed", "sliderPressedThumbImage"), ("disabled", "sliderDisabledThumbImage")):
            thumb[state] = vn_bp_optional_asset(vn_ui_get(component_id, property), "image")
        result["thumb"] = thumb
        return result

    def vn_ui_control_commit(component_id, method):
        if method in ("enter", "focusLost") and vn_ui_control_available(component_id):
            vn_ui_control_emit(component_id, "commits", {"value": vn_ui_control_get(component_id), "method": method})

    def vn_ui_control_emit(component_id, handler_key, payload):
        focus = vn_ui_focus_snapshot()
        task = vn_bp_task_create(vn_ui_controls[component_id]["pageId"])
        for graph_id, node_id in vn_ui_controls[component_id][handler_key]:
            if not vn_bp_task_alive(task):
                break
            vn_run_blueprint(graph_id, node_id, {node_id: payload}, page_id=vn_ui_controls[component_id]["pageId"])
        # Ren'Py clears parent focus when a callback context returns. Preserve
        # input continuity if the source is still available on the same screen.
        # Only resolve layout when focus actually needs restoring. A callback
        # can change geometry or close the page, so this check must remain fresh.
        if focus is not None and renpy.display.focus.get_focused() is None and vn_ui_control_available(component_id):
            vn_ui_restore_focus(focus)
`;
}
