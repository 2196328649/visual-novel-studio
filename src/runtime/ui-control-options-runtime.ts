import type { BlueprintNode } from '../core/model';
import { maxUiControlOptions, maxUiControlOptionLabel, uiControlOptionsVersion, uiControlOptionEditInputs } from '../core/ui-control-options';
import { pythonLiteral as py } from './literals';

/** Foreground and cooperative tasks compile the same active operands. */
export function uiControlOptionEditExpression(node: BlueprintNode, value: (pin: string) => string): string {
  const arguments_ = uiControlOptionEditInputs(node).map(pin => (pin === 'toIndex' ? 'to_index' : pin) + '=' + value(pin));
  return 'vn_ui_control_edit_options(' + [value('componentId'), py(node.properties.operation ?? 'insert'), 'value_type=' + py(node.properties.valueType ?? 'string'), 'version=' + py(node.properties.optionsVersion ?? uiControlOptionsVersion), ...arguments_].join(', ') + ')';
}

/** Lists are page-owned, copy-on-write saved data, never persistent settings. */
export const uiControlOptionsRuntime = `    def vn_ui_control_option_info(component_id, value_type=None):
        info = vn_ui_controls.get(component_id)
        if not info or not info.get("choice"):
            raise Exception("选项操作只适用于选择控件，不能把自由输入框或滑条变成列表。")
        if value_type is not None and (value_type not in ("string", "number", "boolean") or value_type != info["type"]):
            raise Exception("选项值类型与目标控件的绑定类型不匹配。")
        return info

    def vn_ui_control_options(component_id):
        info = vn_ui_control_option_info(component_id)
        record = vn_ui_control_option_overrides.get(component_id)
        if record is None: return info["options"]
        if (not isinstance(record, dict) or isinstance(record.get("version"), bool) or record.get("version") != ${uiControlOptionsVersion}):
            raise Exception("保存的控件选项版本不受支持；原记录保留，可明确恢复设计选项。")
        return record["options"]

    def vn_ui_control_options_key(component_id):
        # Cached once on edit/compile, not re-serialized for every row and frame.
        vn_ui_control_options(component_id)
        record = vn_ui_control_option_overrides.get(component_id)
        return record["key"] if record is not None else vn_ui_controls[component_id]["optionsKey"]

    def vn_ui_control_option_index(value, name):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not __import__("math").isfinite(value) or int(value) != value or abs(value) > 9007199254740991:
            raise Exception(name + "必须是有限安全整数。")
        return int(value)

    def vn_ui_control_option(component_id, index, value_type, version=${uiControlOptionsVersion}):
        if isinstance(version, bool) or version != ${uiControlOptionsVersion}: raise Exception("选项节点版本不受支持。")
        vn_ui_control_option_info(component_id, value_type)
        options = vn_ui_control_options(component_id)
        index = vn_ui_control_option_index(index, "选项索引")
        if 0 <= index < len(options):
            return dict(found=True, label=options[index]["label"], value=options[index]["value"])
        return dict(found=False, label="", value=0 if value_type == "number" else False if value_type == "boolean" else "")

    def vn_ui_control_option_validate(info, label, value):
        kind = info["type"]
        valid = isinstance(value, bool) if kind == "boolean" else isinstance(value, str) if kind == "string" else not isinstance(value, bool) and isinstance(value, (int, float)) and __import__("math").isfinite(value)
        if not valid: raise Exception("选项值必须符合绑定类型，数值必须有限。")
        preference = vn_preference_info.get(info.get("preference"))
        if preference and (kind == "number" and not preference["min"] <= value <= preference["max"] or preference.get("options") and value not in preference["options"]):
            raise Exception("选项值超出玩家设置的引擎边界或可用值。")
        if not isinstance(label, str) or not 1 <= len(label) <= ${maxUiControlOptionLabel}:
            raise Exception("选项标签需要 1～${maxUiControlOptionLabel} 个 Unicode 字符。")

    def vn_ui_control_close_popup(component_id):
        popup = renpy.get_screen("vn_preference_popup")
        if popup is not None and popup.scope.get("component_id") == component_id:
            renpy.hide_screen("vn_preference_popup")

    def vn_ui_control_reset_options(component_id):
        previous = vn_ui_control_option_overrides.get(component_id)
        if previous is not None and (not isinstance(previous, dict) or isinstance(previous.get("version"), bool) or previous.get("version") != ${uiControlOptionsVersion}):
            # Explicit recovery retains the unsupported record, not just a warning.
            vn_ui_control_option_recovery[component_id] = previous
        vn_ui_control_option_overrides.pop(component_id, None)
        vn_ui_control_close_popup(component_id)

    def vn_ui_control_edit_options(component_id, operation, value_type="string", index=None, to_index=None, label=None, value=None, version=${uiControlOptionsVersion}):
        if isinstance(version, bool) or version != ${uiControlOptionsVersion}: raise Exception("选项节点版本不受支持。")
        info = vn_ui_control_option_info(component_id)
        if operation not in ("insert", "replace", "remove", "move", "clear", "reset"):
            raise Exception("请选择有效的选项操作。")
        if operation == "reset":
            vn_ui_control_reset_options(component_id)
        else:
            source = vn_ui_control_options(component_id)
            next_options = [dict(option) for option in source]
            if operation == "clear": next_options = []
            else:
                index = vn_ui_control_option_index(index, "选项索引")
                if index < 0 or index > len(source) or operation != "insert" and index == len(source):
                    raise Exception("选项索引超出当前列表；插入可使用数量作为末尾索引。")
                if operation == "insert" and len(source) >= ${maxUiControlOptions}:
                    raise Exception("每个控件最多 ${maxUiControlOptions} 个运行时选项。")
                if operation in ("insert", "replace"):
                    vn_ui_control_option_info(component_id, value_type)
                    vn_ui_control_option_validate(info, label, value)
                    entry = dict(label=label, value=value)
                    if operation == "insert": next_options.insert(index, entry)
                    else: next_options[index] = entry
                elif operation == "remove": next_options.pop(index)
                else:
                    target = vn_ui_control_option_index(to_index, "目标索引")
                    if not 0 <= target < len(source): raise Exception("目标索引必须指向移动后的有效位置。")
                    next_options.insert(target, next_options.pop(index))
            key = __import__("json").dumps([[option["label"], option["value"]] for option in next_options], ensure_ascii=False, allow_nan=False, separators=(",", ":"))
            vn_ui_control_option_overrides[component_id] = dict(version=${uiControlOptionsVersion}, options=next_options, key=key)
            vn_ui_control_close_popup(component_id)
        renpy.retain_after_load()
        renpy.restart_interaction()

    def vn_ui_control_show_popup(component_id=None, **arguments):
        task = vn_bp_task_create(vn_ui_controls[component_id]["pageId"]) if component_id else None
        if component_id and (not vn_ui_control_available(component_id) or not vn_bp_task_alive(task) or not vn_ui_control_options(component_id)): return
        renpy.show_screen("vn_preference_popup", component_id=component_id, source_task=task, **arguments)
        renpy.restart_interaction()

    def vn_ui_control_prepare_popup_prune(rows=None, get=None):
        popup = renpy.get_screen("vn_preference_popup")
        component_id = popup.scope.get("component_id") if popup is not None else None
        close = bool(component_id and (not vn_ui_controls.get(component_id, {}).get("choice") or popup.scope.get("source_task") is None or not vn_bp_task_alive(popup.scope.get("source_task")) or not vn_ui_control_available(component_id, rows, get)))
        return popup, close

    def vn_ui_control_prune_popup(prepared=None):
        if prepared is not None:
            popup, close = prepared
            if close and renpy.get_screen("vn_preference_popup") is popup: renpy.hide_screen("vn_preference_popup")
            return
        popup = renpy.get_screen("vn_preference_popup")
        component_id = popup.scope.get("component_id") if popup is not None else None
        if component_id and (not vn_ui_controls.get(component_id, {}).get("choice") or popup.scope.get("source_task") is None or not vn_bp_task_alive(popup.scope.get("source_task")) or not vn_ui_control_available(component_id)):
            renpy.hide_screen("vn_preference_popup")

    class VnSelectControlOption(Action, DictEquality):
        def __init__(self, component_id, index, options_key, task, screen_available=None):
            self.component_id, self.index, self.options_key, self.task = component_id, index, options_key, task
            # Only the displayed sensitivity uses this evaluation's boolean. Never
            # keep the complete page geometry on an Action/BarValue or in a save.
            self.screen_available = screen_available

        def option(self, screen=False):
            available = self.screen_available if screen and self.screen_available is not None else vn_ui_control_available(self.component_id)
            if self.task is None or not vn_bp_task_alive(self.task) or not available: return None
            if vn_ui_control_options_key(self.component_id) != self.options_key: return None
            options = vn_ui_control_options(self.component_id)
            return options[self.index] if 0 <= self.index < len(options) else None

        def sensitive_option(self, entry):
            if entry is None or not vn_ui_control_valid_value(self.component_id, entry["value"]): return False
            info = vn_ui_controls[self.component_id]
            return VnSetPreference(info["preference"], entry["value"], info.get("characterId"), self.component_id).get_sensitive(True) if info.get("preference") else True

        def get_sensitive(self):
            return self.sensitive_option(self.option(screen=True))

        def get_selected(self):
            entry = self.option(screen=True)
            return entry is not None and vn_preference_equal(vn_ui_control_get(self.component_id), entry["value"])

        def __call__(self):
            # A retained pre-scroll/pre-load action cannot bypass live geometry,
            # modal, task, options-key or source validation at dispatch time.
            entry = self.option()
            if self.sensitive_option(entry): vn_ui_control_set(self.component_id, entry["value"])

`;
