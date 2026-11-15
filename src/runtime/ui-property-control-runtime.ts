import { allUiComponents, declaredUiComponents, type Project } from '../core/model';
import { uiProperties, type UiProperty } from '../core/ui-properties';
import { uiPropertyControlKey, uiPropertyControlSourceProblem } from '../core/ui-property-control';
import { pythonLiteral } from './literals';

/** Parameter controls share one write boundary with blueprints, input and animations. */
export function createUiPropertyControlRuntime(project: Project): string {
  const records = Object.fromEntries(declaredUiComponents(project).filter(component => Object.keys(component.propertyControls ?? {}).length).map(component => {
    const entries = Object.entries(component.propertyControls ?? {}).map(([property, control]) => {
      const key = Object.hasOwn(uiProperties, property) ? uiPropertyControlKey(project, component, property as UiProperty) : property;
      return [key, { ...control, property: key, problem: uiPropertyControlSourceProblem(project, component, property, control) }];
    });
    // Conflicting aliases retain an explicit diagnostic on their canonical entry.
    return [component.id, Object.fromEntries(entries)];
  }));
  return `    vn_ui_property_controls = ${pythonLiteral(records)}
    vn_ui_property_active_components = frozenset(${pythonLiteral(allUiComponents(project).map(component => component.id))})
    vn_ui_parameter_readers = {}
    for vn_pc_component, vn_pc_entries in vn_ui_property_controls.items():
        for vn_pc_property, vn_pc_control in vn_pc_entries.items():
            if isinstance(vn_pc_control.get("parameterId"), str):
                vn_ui_parameter_readers.setdefault(vn_pc_control["parameterId"], []).append((vn_pc_component, vn_pc_property))

    def vn_ui_property_control(component_id, property):
        entries = vn_ui_property_controls.get(component_id)
        if not entries: return None
        info = vn_ui_controls.get(component_id)
        key = info["primary"] if info and property in vn_ui_control_value_properties else property
        control = entries.get(key)
        if control is not None and control.get("problem"):
            raise Exception("控件属性参数关联无效：" + control["problem"])
        return control

    def vn_ui_property_user_writable(component_id, property):
        control = vn_ui_property_control(component_id, property)
        return control is None or control["mode"] != "follow"

    def vn_ui_property_values_equal(left, right):
        return left == right and isinstance(left, bool) == isinstance(right, bool)

    def vn_ui_property_validate_value(component_id, property, value):
        info = vn_ui_property_info.get(property)
        if not info or property not in vn_ui_allowed_properties.get(component_id, ()):
            raise Exception("蓝图引用的组件或属性不存在，或此组件不支持所选属性。")
        if property in vn_ui_layout_fields and vn_ui_layout_meta[component_id]["version"] != 1:
            raise Exception("控件布局版本暂不支持；请在编辑器明确恢复原始布局数据。")
        if not info.get("writable", False):
            raise Exception("此属性是只读的运行观察值，不能赋值。")
        kind = info["type"]
        valid = isinstance(value, bool) if kind == "boolean" else isinstance(value, str) if kind == "string" else not isinstance(value, bool) and isinstance(value, (int, float))
        if valid and kind == "number":
            valid = (info.get("min") is None or value >= info["min"]) and (info.get("max") is None or value <= info["max"]) and __import__("math").isfinite(value) and (not info.get("integer") or int(value) == value)
        if valid and kind == "string" and info.get("max") is not None: valid = len(value) <= info["max"]
        if valid and info.get("options"): valid = value in info["options"]
        if valid and info.get("color"): valid = __import__("re").fullmatch(r"#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?", value) is not None
        if not valid:
            raise Exception(info.get("invalidMessage") or "“" + info["name"] + "”的属性值类型、范围或格式不符合要求。")
        if info.get("resource") and value: vn_bp_asset(value, info["resource"])

    def vn_ui_property_control_raw(component_id, property, control=None, parameter_values=None, local_values=None):
        control = vn_ui_property_control(component_id, property) if control is None else control
        parameter_id = control["parameterId"]
        if parameter_id not in vn_parameter_info:
            raise Exception("控件属性的来源参数已不存在，请重新选择来源。")
        value = parameter_values[parameter_id] if parameter_values is not None and parameter_id in parameter_values else vn_parameter_get(parameter_id)
        vn_ui_property_validate_value(component_id, control["property"], value)
        if control["property"] == "spineSkin" and value:
            source = vn_ui_property_candidate(component_id, "spineAsset", parameter_values, local_values)
            asset = vn_spine_assets.get(source)
            if not asset or value not in asset["spine"]["skins"]:
                raise Exception("来源参数指定的皮肤不属于当前骨骼素材。")
        return value

    def vn_ui_property_control_read(component_id, property, control=None, parameter_values=None, local_values=None):
        control = vn_ui_property_control(component_id, property) if control is None else control
        value = vn_ui_property_control_raw(component_id, property, control, parameter_values, local_values)
        info = vn_ui_controls.get(component_id)
        if info and control["property"] == info["primary"] and not vn_ui_control_valid_value(component_id, value, source_read=True, parameter_values=parameter_values, local_values=local_values):
            raise Exception("控件属性的来源参数不符合当前选项或输入长度要求。")
        return value

    def vn_ui_property_candidate(component_id, property, parameter_values=None, local_values=None):
        control = vn_ui_property_control(component_id, property)
        if control is not None:
            return vn_ui_property_control_raw(component_id, property, control, parameter_values, local_values)
        key = (component_id, property)
        if local_values is not None and key in local_values: return local_values[key]
        return vn_ui_get(component_id, property)

    def vn_ui_property_page_active(page_id):
        if page_id in vn_ui_open_pages: return True
        if page_id in vn_ui_native_page_screens:
            return vn_ui_native_page_displayable(page_id) is not None
        context = vn_minigame_context or {}
        return vn_minigame_finished is None and vn_minigames.get(context.get("minigameId"), {}).get("uiPageId") == page_id

    def vn_ui_property_validate_changes(parameter_values, local_values=None, targets=(), strict_controls=False):
        local_values = local_values or {}
        targets = set(targets)
        affected = set(local_values) | targets
        pages = {}
        for parameter_id in parameter_values:
            for component_id, property in vn_ui_parameter_readers.get(parameter_id, ()):
                if component_id not in vn_ui_property_active_components: continue
                page = vn_ui_component_pages[component_id]
                if page not in pages: pages[page] = vn_ui_property_page_active(page)
                if pages[page]: affected.add((component_id, property))
        # Changing the asset must also validate a retained parameter skin,
        # even when the batch never writes that parameter itself.
        for component_id, property in tuple(affected):
            if property == "spineAsset" and vn_ui_property_control(component_id, "spineSkin") is not None:
                affected.add((component_id, "spineSkin"))
        changes = []
        components = set()
        for component_id, property in affected:
            control = vn_ui_property_control(component_id, property)
            if control is not None:
                value = vn_ui_property_control_raw(component_id, property, control, parameter_values, local_values)
                previous = vn_parameter_get(control["parameterId"])
            else:
                value = local_values[component_id, property]
                previous = vn_ui_get(component_id, property)
            vn_ui_property_validate_value(component_id, property, value)
            changed = not vn_ui_property_values_equal(previous, value)
            # A same-value shared parameter is not a request to inspect or
            # adopt an unrelated media record. Explicit media writes still are.
            validate_media = not strict_controls or (component_id, property) in targets or changed
            if validate_media and property in ("video", "videoLoop"):
                record = vn_ui_video_states.get(component_id)
                if record is not None and vn_ui_video_problem(record): raise Exception(vn_ui_video_problem(record))
            # Native state/version checks still run, while membership reads
            # the complete candidate asset instead of the old live source.
            if validate_media: vn_ui_spine_validate_change(component_id, property, "" if property == "spineSkin" else value)
            if property == "spineSkin" and value:
                asset = vn_spine_assets.get(vn_ui_property_candidate(component_id, "spineAsset", parameter_values, local_values))
                if not asset or value not in asset["spine"]["skins"]:
                    raise Exception("当前骨骼素材没有所选皮肤；空值表示默认皮肤。")
            components.add(component_id)
            if changed:
                changes.append((component_id, property, previous, value))
        for component_id in components:
            info = vn_ui_controls.get(component_id)
            if not info: continue
            properties = {prop for identity, prop in affected if identity == component_id}
            if info.get("range") and properties.intersection(vn_ui_control_range_fields):
                vn_ui_control_validate_range(component_id, vn_ui_control_range(component_id, parameter_values=parameter_values, local_values=local_values))
            if properties.intersection((info["primary"], "maxLength")):
                control = vn_ui_property_control(component_id, info["primary"])
                if control is not None:
                    vn_ui_property_control_read(component_id, info["primary"], control, parameter_values, local_values)
                elif strict_controls:
                    value = vn_ui_property_candidate(component_id, info["primary"], parameter_values, local_values)
                    if not vn_ui_control_valid_value(component_id, value, source_read=True, parameter_values=parameter_values, local_values=local_values):
                        raise Exception("控件值不符合本次设置后的选项或输入长度要求。")
        return changes

    def vn_ui_property_changes_applied(changes, prepared_effects=None):
        images, videos, spines, cancel = set(), set(), set(), set()
        layout = False
        for component_id, property, previous, value in changes:
            if property == "image": images.add(component_id)
            if property in ("video", "videoLoop"): videos.add(component_id)
            if property in ("spineAsset", "spineSkin", "spineLoop", "spineSpeed"): spines.add(component_id)
            layout = layout or property in vn_ui_layout_fields or property in ("x", "y", "width", "height", "visible", "enabled", "readOnly")
            if property in ("visible", "enabled") and not value or property == "readOnly" and value: cancel.add(component_id)
        if prepared_effects is not None: images.update(prepared_effects["images"])
        for component_id in images: vn_ui_image_invalidate(component_id)
        if prepared_effects is None:
            for component_id in videos: vn_ui_video_sync(component_id)
            for component_id in spines: vn_ui_spine_sync(component_id)
        else:
            for component_id, record in prepared_effects["videos"].items(): vn_ui_video_store(component_id, record)
            for component_id, record in prepared_effects["spines"].items(): vns_spine._store(component_id, record)
        if cancel: vn_ui_cancel_pointer(cancel)
        if prepared_effects is not None: vn_ui_layout_changed(prepared_effects["layout"])
        elif layout: vn_ui_layout_changed()

    def vn_ui_property_prepare_local_values(local_values):
        # A newly selected rig starts with its default skin unless this same
        # transaction supplies one, or an explicit parameter controls it.
        for (component_id, property), value in tuple(local_values.items()):
            if property == "spineAsset" and not vn_ui_property_values_equal(vn_ui_get(component_id, property), value):
                if (component_id, "spineSkin") not in local_values and vn_ui_property_control(component_id, "spineSkin") is None:
                    local_values[component_id, "spineSkin"] = ""

    def vn_ui_property_prepare(assignments):
        assignments = tuple(assignments)
        parameter_values, local_values = {}, {}
        for component_id, property, value in assignments:
            vn_ui_property_validate_value(component_id, property, value)
            control = vn_ui_property_control(component_id, property)
            if control is not None:
                if control["mode"] == "follow":
                    raise Exception("“" + vn_ui_property_info[control["property"]]["name"] + "”正单向跟随参数；请修改来源参数或切换控制方式。")
                parameter_id = control["parameterId"]
                if parameter_id in parameter_values and not vn_ui_property_values_equal(parameter_values[parameter_id], value):
                    raise Exception("多项属性正同步同一参数，不能在同一次操作中写入不同的值。")
                parameter_values[parameter_id] = value
            else:
                local_values[component_id, property] = value
        vn_parameter_validate_values(parameter_values)
        vn_ui_property_prepare_local_values(local_values)
        changes = vn_ui_property_validate_changes(parameter_values, local_values, ((component_id, property) for component_id, property, value in assignments))
        return parameter_values, local_values, changes

    def vn_ui_property_commit(prepared, animation=False, notify=True, clear_overrides=(), preferences=()):
        parameter_values, local_values, changes = prepared
        overrides = {}
        for (component_id, property), value in local_values.items():
            override = overrides.setdefault(component_id, dict(vn_ui_overrides.get(component_id, {})))
            override[property] = value
        # Saved temporary overrides must never compete with an explicit source.
        for parameter_id in parameter_values:
            for component_id, property in vn_ui_parameter_readers.get(parameter_id, ()):
                if property in vn_ui_overrides.get(component_id, {}) or component_id in overrides:
                    overrides.setdefault(component_id, dict(vn_ui_overrides.get(component_id, {}))).pop(property, None)
        for component_id, property in clear_overrides:
            overrides.setdefault(component_id, dict(vn_ui_overrides.get(component_id, {}))).pop(property, None)
        if not animation:
            for component_id, property in set(local_values) | set(clear_overrides):
                vn_ui_animations.pop((component_id, property), None)
        for component_id, override in overrides.items():
            vn_ui_overrides[component_id] = override
        for preference in preferences: vn_preference_commit(preference)
        vn_parameter_commit_values(parameter_values, animation)
        if notify: vn_ui_property_changes_applied(changes)
        return changes

    def vn_ui_property_apply(assignments, animation=False, notify=True):
        return vn_ui_property_commit(vn_ui_property_prepare(assignments), animation, notify)

    def vn_ui_parameter_stop_animations(parameter_id):
        for key, state in list(vn_ui_animations.items()):
            entries = vn_ui_property_controls.get(key[0], {})
            control = entries.get(key[1])
            if control and control.get("mode") == "sync" and control.get("parameterId") == parameter_id:
                vn_ui_animations.pop(key, None)

    def vn_ui_property_animation_claim(component_id, property):
        control = vn_ui_property_control(component_id, property)
        if control is not None:
            if control["mode"] == "follow":
                raise Exception("此属性正单向跟随参数，不能用蓝图动画直接修改。")
            vn_ui_parameter_stop_animations(control["parameterId"])
        vn_ui_animations.pop((component_id, property), None)

`;
}
