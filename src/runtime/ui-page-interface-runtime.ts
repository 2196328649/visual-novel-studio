import type { Project } from '../core/model';
import { uiPages } from '../core/ui-pages';
import { uiPageLifecycleHandlers } from '../core/ui-logic';
import { uiPageLifecyclePhases, uiPageInterface, uiPageParameterDefault, uiPageClosedOperations } from '../core/ui-page-interface';
import { pythonLiteral } from './literals';

/** Saved records share the existing page-token owner; callbacks are not a second state scope. */
export function createUiPageInterfaceRuntime(project: Project): string {
  const definitions = Object.fromEntries(uiPages(project).map(page => {
    const definition = uiPageInterface(project, page.id);
    const parameters = (direction: 'inputs' | 'outputs') => Object.fromEntries((definition?.[direction] ?? []).map(parameter => [parameter.id, { type: parameter.dataType, name: parameter.name, required: parameter.required, hasDefault: parameter.defaultValue !== undefined, initial: uiPageParameterDefault(parameter) }]));
    return [page.id, { version: definition?.version ?? 1, declared: !!definition, inputs: parameters('inputs'), outputs: parameters('outputs') }];
  }));
  const handlers = Object.fromEntries(uiPages(project).map(page => [page.id, Object.fromEntries(Object.keys(uiPageLifecyclePhases).map(phase => [phase, uiPageLifecycleHandlers(project, page.id, phase)]))]));
  return `default vn_ui_interface_records = {}
default vn_ui_interface_recovery = {}
default vn_ui_lifecycle_failures = []
default vn_ui_lifecycle_context = None
default vn_ui_native_open_request = None
default vn_ui_last_page_completion = {}

init python:
    vn_ui_interfaces = ${pythonLiteral(definitions)}
    vn_ui_lifecycle_handlers = ${pythonLiteral(handlers)}

    def vn_ui_interface_definition(page_id):
        definition = vn_ui_interfaces.get(page_id)
        if definition is None or definition.get("version") != 1:
            raise Exception("页面接口不存在或版本不受支持，请在编辑器中修复。")
        return definition

    def vn_ui_interface_valid(kind, value):
        return isinstance(value, bool) if kind == "boolean" else not isinstance(value, bool) and isinstance(value, (int, float)) and __import__("math").isfinite(value) if kind == "number" else isinstance(value, str)

    def vn_ui_interface_check(page_id, contract_id):
        actual = vn_ui_interface_definition(page_id)
        expected = vn_ui_interface_definition(contract_id or page_id)
        for direction in ("inputs", "outputs"):
            for name, parameter in expected[direction].items():
                if actual[direction].get(name, {}).get("type") != parameter["type"]:
                    raise Exception("实际页面的输入或结果与蓝图声明接口不兼容：" + parameter["name"])
        return page_id

    def vn_ui_interface_inputs(page_id, supplied=None, system=False, migrating=False):
        definition = vn_ui_interface_definition(page_id)
        supplied = dict(supplied or {})
        if not definition.get("declared"):
            return supplied
        values = {}
        for name, parameter in definition["inputs"].items():
            if name not in supplied and parameter["required"] and not parameter["hasDefault"] and not migrating:
                raise Exception("缺少页面输入：" + parameter["name"] + ("；系统打开需要接口默认值。" if system else ""))
            value = supplied.get(name, parameter["initial"])
            if not vn_ui_interface_valid(parameter["type"], value):
                if not migrating:
                    raise Exception("页面输入类型不匹配：" + parameter["name"])
                value = parameter["initial"]
            values[name] = value
        if not migrating and any(name not in definition["inputs"] for name in supplied):
            raise Exception("页面输入定义已不存在。")
        return values

    def vn_ui_interface_key(task):
        if task.get("native"):
            return ("native", task["page"], task["native"]["token"])
        if task.get("minigame") is not None:
            return ("legacy", task["page"]) + tuple(task["minigame"])
        return ("page", task["page"], task.get("pageToken"))

    def vn_ui_interface_store(key, record):
        global vn_ui_interface_records
        vn_ui_interface_records = dict(vn_ui_interface_records)
        vn_ui_interface_records[key] = record
        renpy.retain_after_load()
        return record

    def vn_ui_interface_prepare(page_id, inputs=None, system=False, task=None, migrated=False):
        task = task or vn_bp_task_create(page_id)
        key = vn_ui_interface_key(task)
        definition = vn_ui_interface_definition(page_id)
        record = dict(version=1, page=page_id, key=key, task=task, inputs=vn_ui_interface_inputs(page_id, inputs, system, migrated), outputs={name: parameter["initial"] for name, parameter in definition["outputs"].items()}, created=bool(migrated), createdDone=bool(migrated), focused=False, requestSerial=0)
        return vn_ui_interface_store(key, record)

    def vn_ui_interface_record(page_id, readonly=False):
        context = vn_ui_lifecycle_context or {}
        if context.get("phase") == "closed" and context.get("page") == page_id:
            if not readonly:
                raise Exception("关闭完成通知中的页面已经释放；不能写入或取得重新打开的同名实例。")
            return context["snapshot"]
        task, key = vn_ui_state_owner(page_id)
        record = vn_ui_interface_records.get(key)
        if key in vn_ui_interface_recovery:
            raise Exception("存档中的页面接口记录版本不受支持；原记录已隔离保留，请退出页面后重新打开。")
        if record is None:
            # A saved instance from before typed interfaces never replays Created.
            inputs = vn_ui_page_sessions.get(page_id, {}).get("inputs", {})
            record = vn_ui_interface_prepare(page_id, inputs, task=task, migrated=True)
        if record.get("version") != 1:
            raise Exception("存档中的页面接口记录版本不受支持。")
        return record

    def vn_ui_interface_parameter(page_id, direction, name, expected_type=None):
        parameter = vn_ui_interface_definition(page_id)[direction].get(name)
        if parameter is None or expected_type is not None and parameter["type"] != expected_type:
            raise Exception("页面参数已删除或类型与蓝图声明不兼容。")
        return parameter

    def vn_ui_interface_get(page_id, direction, name, expected_type=None):
        parameter = vn_ui_interface_parameter(page_id, direction, name, expected_type)
        value = vn_ui_interface_record(page_id, True)[direction].get(name, parameter["initial"])
        # Older saved values of a changed type use the newly declared default.
        return value if vn_ui_interface_valid(parameter["type"], value) else parameter["initial"]

    def vn_ui_interface_set_output(page_id, name, value, expected_type=None):
        parameter = vn_ui_interface_parameter(page_id, "outputs", name, expected_type)
        if not vn_ui_interface_valid(parameter["type"], value):
            raise Exception("页面结果与声明类型不匹配。")
        record = vn_ui_interface_record(page_id)
        outputs = dict(record["outputs"])
        outputs[name] = value
        vn_ui_interface_store(record["key"], dict(record, outputs=outputs))
        renpy.restart_interaction()
        return value

    def vn_ui_interface_completion(page_id, result="", reason="completed", supplied=None, record=None):
        definition = vn_ui_interface_definition(page_id)
        outputs = {name: parameter["initial"] for name, parameter in definition["outputs"].items()}
        if reason == "completed":
            values = dict((record or {}).get("outputs", {}))
            values.update(supplied or {})
            for name, value in values.items():
                parameter = definition["outputs"].get(name)
                if parameter is None:
                    if name in (supplied or {}):
                        raise Exception("页面返回参数已不存在。")
                    continue
                if not vn_ui_interface_valid(parameter["type"], value):
                    if name in (supplied or {}):
                        raise Exception("页面返回参数类型不匹配。")
                    continue
                outputs[name] = value
        return dict(page=page_id, instanceKey=(record or {}).get("key"), result=str(result), reason=reason, outputs=outputs)

    def vn_ui_interface_result(page_id, completion, expected_key=None):
        completion = completion or {}
        if completion.get("page", page_id) != page_id or expected_key is not None and completion.get("instanceKey") != expected_key:
            return vn_ui_interface_completion(page_id, "", "navigated")
        result = vn_ui_interface_completion(page_id, completion.get("result", ""), completion.get("reason", "navigated"), completion.get("outputs", {}))
        result["instanceKey"] = completion.get("instanceKey")
        return result

    def vn_ui_lifecycle_dispatch(record, phase, completion=None, request_id=None):
        if record["key"] in vn_ui_interface_recovery:
            return
        completion = completion or {}
        snapshot = dict(record, inputs=dict(record.get("inputs", {})), outputs=dict(completion.get("outputs", record.get("outputs", {}))))
        context = dict(page=record["page"], phase=phase, snapshot=snapshot, requestId=request_id, key=record["key"])
        for handler in vn_ui_lifecycle_handlers.get(record["page"], {}).get(phase, []):
            if phase != "closed" and not vn_bp_task_alive(record["task"]):
                break
            event_values = dict(result=completion.get("result", ""), reason=completion.get("reason", ""))
            event_values.update({"out_" + name: value for name, value in snapshot["outputs"].items()})
            try:
                vn_run_blueprint(handler["graphId"], handler["nodeId"], {handler["nodeId"]: event_values}, page_id=record["page"], lifecycle_context=context)
            except Exception as error:
                if phase != "closed":
                    raise
                # A notification cannot prevent teardown, strand callers, or
                # suppress later Closed handlers. Keep visible diagnostics.
                vn_ui_lifecycle_failure(record, phase, handler, error)

    def vn_ui_lifecycle_failure(record, phase, handler, error):
        global vn_ui_lifecycle_failures
        failure = dict(page=record["page"], key=record["key"], phase=phase, graph=handler["graphId"], node=handler["nodeId"], message=str(error))
        vn_ui_lifecycle_failures = (list(vn_ui_lifecycle_failures) + [failure])[-64:]
        renpy.log("VNS 页面生命周期失败：" + str(failure))
        renpy.notify("页面已关闭，但关闭完成事件失败。请查看运行日志。")

    def vn_ui_interface_created(page_id):
        record = vn_ui_interface_record(page_id)
        if record.get("created"):
            return
        record = vn_ui_interface_store(record["key"], dict(record, created=True))
        vn_ui_lifecycle_dispatch(record, "created")
        current = vn_ui_interface_records.get(record["key"])
        if current:
            vn_ui_interface_store(record["key"], dict(current, createdDone=True))

    def vn_ui_interface_for_close(page_id):
        task = vn_bp_task if vn_bp_task and vn_bp_task.get("page") == page_id else vn_bp_task_create(page_id)
        key = vn_ui_interface_key(task)
        record = vn_ui_interface_records.get(key)
        if record is None:
            record = vn_ui_interface_prepare(page_id, vn_ui_page_sessions.get(page_id, {}).get("inputs", {}), task=task, migrated=True)
        return record

    def vn_ui_interface_request_close(page_id, result, reason, supplied=None, force=False):
        record = vn_ui_interface_for_close(page_id)
        key = record["key"]
        if key in vn_ui_interface_recovery:
            # Do not interpret unknown state or execute its callbacks.
            force, result, reason, supplied = True, "", "navigated", None
        if (record.get("closeRequest") or record.get("closing")) and not force:
            return None
        if not force and reason in ("completed", "cancelled"):
            request_id = record.get("requestSerial", 0) + 1
            record = vn_ui_interface_store(key, dict(record, requestSerial=request_id, closeRequest=dict(id=request_id, prevented=False)))
            try:
                vn_ui_lifecycle_dispatch(record, "closeRequested", vn_ui_interface_completion(page_id, result, reason, supplied, record), request_id)
                current = vn_ui_interface_records.get(key)
                if current is None or not vn_bp_task_alive(record["task"]) or (current.get("closeRequest") or {}).get("prevented"):
                    return None
            finally:
                current = vn_ui_interface_records.get(key)
                if current and (current.get("closeRequest") or {}).get("id") == request_id:
                    vn_ui_interface_store(key, dict(current, closeRequest=None))
        record = vn_ui_interface_records.get(key)
        if record is None or not force and not vn_bp_task_alive(record["task"]):
            return None
        completion = vn_ui_interface_completion(page_id, result, reason, supplied, record)
        vn_ui_interface_store(key, dict(record, closing=True, focused=False if force else record.get("focused", False)))
        return completion

    def vn_ui_prevent_page_close(page_id):
        context = vn_ui_lifecycle_context or {}
        if context.get("phase") != "closeRequested" or context.get("page") != page_id:
            return False
        record = vn_ui_interface_records.get(context.get("key"))
        if not record or (record.get("closeRequest") or {}).get("id") != context.get("requestId"):
            return False
        vn_ui_interface_store(record["key"], dict(record, closeRequest=dict(record["closeRequest"], prevented=True)))
        return True

    def vn_ui_interface_end(record, completion):
        global vn_ui_interface_records
        key = record["key"]
        record = vn_ui_interface_records.get(key)
        if record is None:
            return
        # Remove before notifying, so a nested prune cannot notify a second time.
        vn_ui_interface_records = {old_key: value for old_key, value in vn_ui_interface_records.items() if old_key != key}
        renpy.retain_after_load()
        vn_ui_lifecycle_dispatch(record, "closed", completion)

    def vn_ui_interface_blur(record):
        current = vn_ui_interface_records.get(record["key"])
        if current and current.get("focused"):
            current = vn_ui_interface_store(record["key"], dict(current, focused=False))
            vn_ui_lifecycle_dispatch(current, "focusLost")

    def vn_ui_interface_blur_for_close(record):
        try:
            vn_ui_interface_blur(record)
        except BaseException:
            # A failed/aborted ordinary close is retryable. Engine control-flow
            # exceptions are re-raised; a forced teardown may already have ended it.
            current = vn_ui_interface_records.get(record["key"])
            if current:
                vn_ui_interface_store(record["key"], dict(current, closing=False))
            raise

    def vn_ui_lifecycle_focus_key():
        screens = vn_input_screens()
        ranked = []
        visible = vn_ui_visible_page_order()
        for key, record in vn_ui_interface_records.items():
            if vn_ui_page_sessions.get(record["page"], {}).get("opening", {}).get("input") == "none":
                continue
            if record.get("closing") or not record.get("createdDone", record.get("created")) or key in vn_ui_interface_recovery or not vn_bp_task_alive(record["task"]):
                continue
            native = record["task"].get("native")
            screen = vn_ui_native_page_screen(native) if native else renpy.get_screen("vn_blueprint_pages") if record["page"] in visible else renpy.get_screen("vn_minigame_custom") if record["task"].get("minigame") else None
            if screen is None or screen not in screens:
                continue
            index = screens.index(screen)
            if any(other.modal for other in screens[index + 1:]):
                continue
            ranked.append(((index, visible.index(record["page"]) if record["page"] in visible else -1), key))
        return max(ranked, key=lambda item: item[0])[1] if ranked else None

    def vn_ui_lifecycle_tick():
        if getattr(vn_ui_lifecycle_tick, "running", False):
            return
        vn_ui_lifecycle_tick.running = True
        try:
            for key, record in list(vn_ui_interface_records.items()):
                native = record["task"].get("native")
                if native and native.get("navigation") is not None:
                    continue
                if not vn_bp_task_alive(record["task"]):
                    vn_ui_interface_end(record, vn_ui_interface_completion(record["page"], "", "navigated", record=record))
            focused = vn_ui_lifecycle_focus_key()
            for key, record in list(vn_ui_interface_records.items()):
                if record.get("focused") and key != focused:
                    vn_ui_interface_blur(record)
            record = vn_ui_interface_records.get(focused)
            if record and not record.get("focused") and record.get("created") and vn_bp_task_alive(record["task"]):
                record = vn_ui_interface_store(focused, dict(record, focused=True))
                vn_ui_lifecycle_dispatch(record, "focusGained")
        finally:
            vn_ui_lifecycle_tick.running = False

    def vn_ui_lifecycle_require_operation(node_type, scope=None):
        if (vn_ui_lifecycle_context or {}).get("phase") != "closed":
            return
        if node_type in ${pythonLiteral(uiPageClosedOperations)} or scope == "page" and node_type in ("getVariable", "setVariable", "doOnce", "gate", "throttle"):
            raise Exception("页面关闭完成事件只允许同步通知与结果快照读取；等待、导航或页面资源操作请放在打开页面的完成路线。")

    def vn_ui_interfaces_after_load():
        global vn_ui_interface_records, vn_ui_interface_recovery
        records, recovery = {}, dict(vn_ui_interface_recovery)
        for key, record in vn_ui_interface_records.items():
            if not isinstance(record, dict) or record.get("version") != 1:
                recovery[key] = dict(reason="unsupportedInterfaceVersion", record=record)
                continue
            if record.get("page") not in vn_ui_interfaces:
                recovery[key] = dict(reason="missingPage", record=record)
                continue
            task = record.get("task", {})
            native = task.get("native")
            if native and vn_ui_native_page_context(native) is None:
                continue
            if not native and not vn_bp_task_alive(task):
                continue
            # UI callback contexts are not serialized. A pending request cannot
            # trap the restored page in a permanently requesting state.
            records[key] = dict(record, closeRequest=None, closing=False, createdDone=bool(record.get("created")))
        vn_ui_interface_records = records
        vn_ui_interface_recovery = recovery

    config.after_load_callbacks.append(vn_ui_interfaces_after_load)
`;
}
