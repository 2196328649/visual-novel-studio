import type { BlueprintNode } from '../core/model';
import { blueprintUiPropertyDefinition, maxBlueprintUiPropertyRows } from '../core/blueprint-ui-property-batch';
import { pythonLiteral as py } from './literals';

/** Python constructs this list completely before entering the write boundary. */
export function uiPropertyWriteExpression(node: BlueprintNode, value: (pin: string) => string): string {
  const definition = blueprintUiPropertyDefinition(node);
  if (definition.problems.length || !definition.rows?.length) throw new Error('设置组件属性无效：' + (definition.problems.join('；') || '请至少添加一项属性。'));
  if (definition.legacy) {
    const row = definition.rows[0];
    return 'vn_ui_set(' + [value('componentId'), py(row.property), value(row.id), py(row.writeMode)].join(', ') + ')';
  }
  const rows = definition.rows.map(row => '(' + [py(row.property), value(row.id), py(row.writeMode)].join(', ') + ')');
  return 'vn_ui_set_many(' + value('componentId') + ', [' + rows.join(', ') + '])';
}

/** A batch owns one prepared state; no single-property setter runs during preparation. */
export const uiPropertyBatchRuntime = `    def vn_ui_property_batch_put(values, key, value, message):
        if key in values and not vn_ui_property_values_equal(values[key], value):
            raise Exception(message)
        values[key] = value

    def vn_ui_property_preference_key(info):
        key = info.get("preference")
        return (key, info.get("characterId") or "" if key == "characterVolume" else None)

    def vn_ui_property_batch_getter(parameter_values, local_values):
        def condition_value(condition):
            if type(condition) is bool: return condition
            kind = condition["kind"]
            if kind == "not": return not condition_value(condition["condition"])
            if kind == "all": return all(condition_value(item) for item in condition["conditions"])
            if kind == "any": return any(condition_value(item) for item in condition["conditions"])
            parameter_id = condition["variableId"]
            left = parameter_values[parameter_id] if parameter_id in parameter_values else vn_parameter_get(parameter_id)
            right, operation = condition["value"], condition["operator"]
            if operation == "eq": return left == right
            if operation == "ne": return left != right
            if operation == "gt": return left > right
            if operation == "gte": return left >= right
            if operation == "lt": return left < right
            return left <= right

        def get(component_id, property, fallback=None, raw_layout=False):
            control = vn_ui_property_control(component_id, property)
            if control is not None:
                return vn_ui_property_control_raw(component_id, property, control, parameter_values, local_values)
            if (component_id, property) in local_values: return local_values[component_id, property]
            override = vn_ui_overrides.get(component_id, {})
            if property in override: return override[property]
            condition = vn_ui_condition_definitions.get(component_id, {}).get(property)
            if condition is not None: return condition_value(condition)
            binding = vn_ui_asset_bindings.get(component_id)
            if binding and property == binding["property"] and binding["parameterId"] in parameter_values:
                value = parameter_values[binding["parameterId"]]
                asset = vn_bp_assets.get(value) if isinstance(value, str) and value else None
                return value if asset and asset["kind"] == binding["kind"] else vn_ui_defaults[component_id][property]
            if property == "spineSkin" and get(component_id, "spineAsset") != vn_spine_components[component_id].get("assetId"):
                return ""
            # Scroll requests are raw here. Reading their effective observation
            # would recursively resolve the old layout instead of this candidate.
            return vn_ui_get(component_id, property, fallback, raw_layout)
        return get

    def vn_ui_property_batch_effects(component_id, parameter_values, candidates, targets):
        import builtins
        get = vn_ui_property_batch_getter(parameter_values, candidates)
        pages = {page for page in vn_ui_layout_pages if vn_ui_property_page_active(page)}
        # An unopened target must still be able to render when later displayed.
        pages.add(vn_ui_component_pages.get(component_id))
        identities = [identity for page in vn_ui_layout_pages if page in pages for identity in vn_ui_layout_pages[page]]
        try:
            layout_rows = vn_ui_layout_resolve(identities, get)
        except (OverflowError, ValueError):
            raise Exception("本次设置后的布局计算超出有限数值范围；请缩小位置、尺寸、旋转或缩放。")
        def finite(value):
            if isinstance(value, builtins.dict): return all(finite(item) for item in value.values())
            if isinstance(value, (builtins.tuple, builtins.list)): return all(finite(item) for item in value)
            return not isinstance(value, (int, float)) or __import__("math").isfinite(value)
        if not finite(layout_rows):
            raise Exception("本次设置后的布局计算超出有限数值范围；请缩小位置、尺寸、旋转或缩放。")
        previous_rows = {}
        for page in pages:
            try:
                previous_rows.update(vn_ui_layout_resolve(vn_ui_layout_pages.get(page, ())))
            except (OverflowError, ValueError):
                # A valid candidate may repair this page's old geometry;
                # other pages still compare against their effective layout.
                pass
        effects = dict(images=set(), videos={}, spines={}, layout=vn_ui_layout_prepare_change(layout_rows, get))
        geometry_fields = ("width", "height", "matrix", "renderMatrix", "localRenderMatrix", "clipPolygons", "visiblePolygon", "clippedOut", "visible")
        for identity in identities:
            if identity in vn_ui_images and get(identity, "image") != vn_ui_get(identity, "image"):
                effects["images"].add(identity)
            collection = vn_ui_videos if identity in vn_ui_videos else vn_spine_components if identity in vn_spine_components else None
            if collection is None: continue
            prefix = "video" if identity in vn_ui_videos else "spine"
            # Compare two effective configurations, never an old request with
            # the candidate: polling may have an unrelated request pending.
            # Explicit media fields still validate their target at equal values.
            explicit = any(target == identity and property.startswith(prefix) for target, property in targets)
            fields = ("visible",) + tuple(property for property in vn_ui_allowed_properties[identity] if property.startswith(prefix) and vn_ui_property_info[property].get("writable"))
            previous, candidate = previous_rows.get(identity), layout_rows.get(identity)
            changed = explicit or any(not vn_ui_property_values_equal(vn_ui_get(identity, property), get(identity, property)) for property in fields)
            if not changed:
                changed = previous is None or candidate is None or any(previous[field] != candidate[field] for field in geometry_fields)
            if not changed: continue
            task = vn_bp_task_create(collection[identity]["pageId"], create_native=False)
            if vn_ui_image_owner(task) is None: continue
            if identity in vn_ui_videos:
                effects["videos"][identity] = vn_ui_video_snapshot(identity, task, layout_rows, strict=True, get=get)
            else:
                effects["spines"][identity] = vns_spine.snapshot(identity, task, layout_rows, strict=True, get=get, assigned=set(candidates) | targets)
        return effects

    def vn_ui_property_batch_prepare(component_id, writes):
        import builtins
        if not isinstance(component_id, str) or component_id not in vn_ui_defaults:
            raise Exception("蓝图引用的界面组件不存在。")
        # Store.list is RevertableList. The Python bases accept it and native
        # lists from external callers without consuming arbitrary iterables.
        if not isinstance(writes, (builtins.list, builtins.tuple)) or not 1 <= len(writes) <= ${maxBlueprintUiPropertyRows}:
            raise Exception("一次设置需要 1～${maxBlueprintUiPropertyRows} 项属性。")
        info = vn_ui_controls.get(component_id)
        rows, keys = [], set()
        for row in writes:
            if not isinstance(row, (builtins.tuple, builtins.list)) or len(row) != 3 or not isinstance(row[0], str):
                raise Exception("组件属性批量写入格式无效。")
            property, value, write_mode = row
            vn_ui_property_validate_value(component_id, property, value)
            if write_mode not in ("override", "source"):
                raise Exception("请选择临时覆盖或修改绑定源。")
            canonical = info["primary"] if info and property in vn_ui_control_value_properties else property
            if canonical in keys:
                raise Exception("同一次设置不能重复写入同一属性；当前值、比例和选项索引属于同一项。")
            keys.add(canonical)
            control = vn_ui_property_control(component_id, canonical)
            if control is not None and control["mode"] == "follow":
                raise Exception("“" + vn_ui_property_info[canonical]["name"] + "”正单向跟随参数；本次设置不会写入任何一项。")
            if write_mode == "source" and control is None and not (info and canonical == info["primary"]):
                raise Exception("此属性没有可写的控件值绑定源。")
            rows.append((property, canonical, value, write_mode, control))

        parameter_values, local_values, source_values, preference_values = {}, {}, {}, {}
        clear_overrides = set()
        def prepare_value(row, value):
            property, canonical, original, write_mode, control = row
            vn_ui_property_validate_value(component_id, canonical, value)
            if control is not None:
                vn_ui_property_batch_put(parameter_values, control["parameterId"], value, "多项属性正同步同一参数，不能在同一次操作中写入不同的值。")
            elif write_mode == "source":
                if info.get("parameterId"):
                    vn_ui_property_batch_put(parameter_values, info["parameterId"], value, "多项属性正写入同一参数，不能在同一次操作中写入不同的值。")
                else:
                    vn_ui_property_batch_put(preference_values, vn_ui_property_preference_key(info), value, "多项属性正写入同一玩家设置，不能在同一次操作中写入不同的值。")
                source_values[component_id, canonical] = value
                clear_overrides.add((component_id, canonical))
            else:
                local_values[component_id, canonical] = value

        # Bounds may themselves write a parameter read by another bound. Gather
        # all non-ratio writes first, then resolve ratios against that candidate.
        ratios, ratio_ranges = [], {}
        for row in rows:
            property, canonical, value, write_mode, control = row
            if property == "normalizedValue":
                ratios.append(row)
                continue
            if property == "optionIndex":
                options = vn_ui_control_options(component_id)
                if not 0 <= value < len(options):
                    raise Exception("选项索引必须指向现有选项；-1 只表示当前值没有匹配项。")
                value = options[int(value)]["value"]
            prepare_value(row, value)
        for row in ratios:
            span = vn_ui_control_range(component_id, parameter_values=parameter_values, local_values=local_values)
            vn_ui_control_validate_range(component_id, span)
            ratio_ranges[row[1]] = span
            prepare_value(row, vn_ui_range_from_ratio(span, row[2], info.get("instantAtEnd", False)))

        vn_parameter_validate_values(parameter_values)
        preferences = [vn_preference_validate(key, value, character_id, require_available=True) for (key, character_id), value in preference_values.items()]
        vn_ui_property_prepare_local_values(local_values)
        candidates = dict(local_values)
        candidates.update(source_values)
        # Explicit legacy source writes clear only their own override. Other
        # active readers keep theirs; those reading the source validate its new
        # text/options while numeric readers retain display-only clamping.
        for identity, reader in vn_ui_controls.items():
            parameter_id = reader.get("parameterId")
            preference_key = vn_ui_property_preference_key(reader)
            if parameter_id not in parameter_values and (parameter_id is not None or preference_key not in preference_values): continue
            if identity not in vn_ui_property_active_components or not vn_ui_property_page_active(vn_ui_component_pages[identity]): continue
            primary = reader["primary"]
            if vn_ui_property_control(identity, primary) is not None or (identity, primary) in candidates: continue
            if primary in vn_ui_overrides.get(identity, {}): continue
            if parameter_id in parameter_values: candidates[identity, primary] = parameter_values[parameter_id]
            elif not parameter_id and preference_key in preference_values: candidates[identity, primary] = preference_values[preference_key]

        for row in rows:
            property, canonical, original, write_mode, control = row
            if info and canonical == info["primary"]:
                value = vn_ui_property_candidate(component_id, canonical, parameter_values, candidates)
                if not vn_ui_control_valid_value(component_id, value, parameter_values=parameter_values, local_values=candidates):
                    raise Exception("控件值的类型、范围、选项或输入长度不符合本次设置后的绑定要求。")
                if property == "normalizedValue":
                    span = vn_ui_control_range(component_id, parameter_values=parameter_values, local_values=candidates)
                    if span != ratio_ranges[canonical]:
                        raise Exception("当前值的同步参数同时改变了比例范围；请改用实际当前数值设置。")
        targets = {(component_id, canonical) for property, canonical, value, write_mode, control in rows}
        changes = vn_ui_property_validate_changes(parameter_values, candidates, targets, strict_controls=True)
        effects = vn_ui_property_batch_effects(component_id, parameter_values, candidates, targets)
        return (parameter_values, local_values, changes), preferences, clear_overrides, effects

    def vn_ui_set_many(component_id, writes):
        prepared, preferences, clear_overrides, effects = vn_ui_property_batch_prepare(component_id, writes)
        # Do not sample live animations between RHS evaluation and commit. A
        # successful assignment takes ownership; rejection changes no driver.
        vn_ui_property_commit(prepared, notify=False, clear_overrides=clear_overrides, preferences=preferences)
        vn_ui_property_changes_applied(prepared[2], effects)
        vn_parameter_flush_animations()
        renpy.retain_after_load()
        renpy.restart_interaction()

`;
