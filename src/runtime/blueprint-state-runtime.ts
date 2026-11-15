import type { BlueprintVariable, Project } from '../core/model';
import { projectGraphs } from '../core/project-resources';
import { uiPages } from '../core/ui-pages';
import { pythonLiteral } from './literals';

/** Scalar state is copy-on-write rollback/save data, never a module singleton. */
export function createBlueprintStateRuntime(project: Project): string {
  const definitions = (variables: BlueprintVariable[]) => Object.fromEntries(variables.map(variable => [variable.id, { name: variable.name, type: variable.type, initial: variable.initial }]));
  return `default vn_ui_state_records = {}

init python:
    vn_bp_state_definitions = ${pythonLiteral(Object.fromEntries(projectGraphs(project).map(graph => [graph.id, definitions(graph.localVariables ?? [])])))}
    vn_ui_state_definitions = ${pythonLiteral(Object.fromEntries(uiPages(project).map(page => [page.id, definitions(project.ui.pageVariables?.[page.id] ?? [])])))}

    def vn_state_valid(definition, value):
        kind = definition.get("type")
        return isinstance(value, bool) if kind == "boolean" else isinstance(value, str) if kind == "string" else not isinstance(value, bool) and isinstance(value, (int, float)) and __import__("math").isfinite(value)

    def vn_state_definition(definitions, owner, variable_id, expected_type=None):
        definition = definitions.get(owner, {}).get(variable_id)
        if definition is None:
            raise Exception("状态定义已不存在，请重新选择变量。")
        if expected_type is not None and definition.get("type") != expected_type:
            raise Exception("目标页面的状态类型与蓝图声明不匹配，请重新选择兼容的页面或变量。")
        return definition

    def vn_bp_state_get(graph_id, variable_id):
        definition = vn_state_definition(vn_bp_state_definitions, graph_id, variable_id)
        frame = vn_bp_frame or {}
        if frame and frame.get("graph") != graph_id:
            raise Exception("调用局部状态不能跨调用帧读取。")
        value = frame.get("locals", {}).get(variable_id, definition["initial"])
        # A pre-feature save may have no locals, or a previous definition type.
        return value if vn_state_valid(definition, value) else definition["initial"]

    def vn_bp_state_set(graph_id, variable_id, value):
        global vn_bp_frame
        definition = vn_state_definition(vn_bp_state_definitions, graph_id, variable_id)
        if not vn_state_valid(definition, value):
            raise Exception("调用局部状态的值与声明类型不匹配。")
        if vn_bp_frame is None:
            vn_bp_frame = dict(graph=graph_id, values={}, locals={}, legacyValues=True)
        if vn_bp_frame.get("graph") != graph_id:
            raise Exception("调用局部状态不能跨调用帧写入。")
        values = dict(vn_bp_frame.get("locals", {}))
        values[variable_id] = value
        vn_bp_frame = dict(vn_bp_frame, locals=values)
        renpy.retain_after_load()
        return value

    def vn_ui_state_owner(page_id):
        if (vn_ui_lifecycle_context or {}).get("phase") == "closed" and vn_ui_lifecycle_context.get("page") == page_id:
            raise Exception("页面已释放，关闭完成事件只能读取结果快照，不能访问同名新实例状态。")
        # A suspended callback can never switch to a newly reopened instance.
        task = vn_bp_task if vn_bp_task and vn_bp_task.get("page") == page_id else vn_bp_task_create(page_id)
        if not task or task.get("page") != page_id or not vn_bp_task_alive(task):
            raise Exception("页面实例状态只能在该页面仍打开时访问。")
        native = task.get("native")
        if native:
            return task, ("native", page_id, native["token"])
        legacy = task.get("minigame")
        if legacy is not None:
            return task, ("legacy", page_id) + tuple(legacy)
        return task, ("page", page_id, task.get("pageToken"))

    def vn_ui_state_get(page_id, variable_id, expected_type=None):
        definition = vn_state_definition(vn_ui_state_definitions, page_id, variable_id, expected_type)
        task, key = vn_ui_state_owner(page_id)
        value = vn_ui_state_records.get(key, {}).get("values", {}).get(variable_id, definition["initial"])
        return value if vn_state_valid(definition, value) else definition["initial"]

    def vn_ui_state_set(page_id, variable_id, value, expected_type=None):
        global vn_ui_state_records
        definition = vn_state_definition(vn_ui_state_definitions, page_id, variable_id, expected_type)
        if not vn_state_valid(definition, value):
            raise Exception("页面实例状态的值与声明类型不匹配。")
        task, key = vn_ui_state_owner(page_id)
        values = dict(vn_ui_state_records.get(key, {}).get("values", {}))
        values[variable_id] = value
        records = dict(vn_ui_state_records)
        records[key] = dict(records.get(key, {}), task=task, page=page_id, values=values)
        vn_ui_state_records = records
        renpy.retain_after_load()
        renpy.restart_interaction()
        return value

    def vn_ui_state_prune():
        global vn_ui_state_records
        expired = [key for key, record in vn_ui_state_records.items() if record.get("page") not in vn_ui_state_definitions or not vn_bp_task_alive(record.get("task"))]
        if expired:
            vn_ui_state_records = {key: value for key, value in vn_ui_state_records.items() if key not in expired}
`;
}
