import { blueprintTypeNames, defaultBlueprintValue, type BlueprintDataType, type BlueprintNodeType } from './blueprint';
import { validBlueprintStateValue, type BlueprintStateScope } from './blueprint-state';
import type { BlueprintGraph, Project, VariableValue } from './model';
import { projectGraphs } from './project-resources';
import { uiPageInterface, uiPageInterfaceKnown, uiPageParameterDefault } from './ui-page-interface';
import { uiPage } from './ui-pages';

export const BLUEPRINT_MEMBER_MIME = 'application/vns-blueprint-member';
type MemberIdentity = { version: 1; projectId: string; id: string };
export type BlueprintMemberReference = MemberIdentity & (
  | { kind: 'variable'; scope: BlueprintStateScope; graphId?: string; pageId?: string }
  | { kind: 'input'; graphId: string }
  | { kind: 'output'; graphId: string }
  | { kind: 'pageInput'; pageId: string }
  | { kind: 'pageOutput'; pageId: string }
);
export interface BlueprintMemberAction {
  action: 'read' | 'write'; type: BlueprintNodeType; properties: Record<string, VariableValue>; label: string; hint: string;
}
export interface BlueprintMemberAccess { name: string; dataType: BlueprintDataType; actions: BlueprintMemberAction[] }

function memberReference(value: unknown): BlueprintMemberReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('蓝图成员拖动数据无效，请重新拖出成员。');
  const record = value as Record<string, unknown>;
  const text = (key: string) => typeof record[key] === 'string' && (record[key] as string).trim().length > 0;
  if (record.version !== 1 || !text('projectId') || !text('id')) throw new Error('蓝图成员拖动数据版本或标识无效。');
  const identity: MemberIdentity = { version: 1, projectId: record.projectId as string, id: record.id as string };
  if (record.kind === 'input' || record.kind === 'output') {
    if (!text('graphId')) throw new Error('蓝图输入与输出必须有明确的所属蓝图。');
    return { ...identity, kind: record.kind, graphId: record.graphId as string };
  }
  if (record.kind === 'pageInput' || record.kind === 'pageOutput') {
    if (!text('pageId')) throw new Error('页面输入与结果必须有明确的所属页面。');
    return { ...identity, kind: record.kind, pageId: record.pageId as string };
  }
  if (record.kind === 'variable') {
    const scope = record.scope;
    if (typeof scope !== 'string' || !['call', 'page', 'project', 'player'].includes(scope)) throw new Error('变量作用域无效，请重新拖出变量。');
    if (record.graphId !== undefined && !text('graphId') || record.pageId !== undefined && !text('pageId')) throw new Error('变量的所属蓝图或页面标识无效。');
    if (scope === 'call' && !text('graphId')) throw new Error('本次调用变量必须有明确的所属蓝图。');
    if (scope === 'page' && !text('pageId')) throw new Error('页面实例变量必须有明确的所属页面。');
    return { ...identity, kind: 'variable', scope: scope as BlueprintStateScope,
      ...(record.graphId === undefined ? {} : { graphId: record.graphId as string }),
      ...(record.pageId === undefined ? {} : { pageId: record.pageId as string }) };
  }
  throw new Error('蓝图成员类型无效，请重新拖出成员。');
}

/** Drag data contains identity only. Names, types and defaults are read at the drop. */
export function parseBlueprintMemberReference(json: string): BlueprintMemberReference {
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new Error('蓝图成员拖动数据无法读取，请重新拖出成员。'); }
  return memberReference(value);
}

/** Resolve against the latest author snapshot before opening or choosing an action. */
export function blueprintMemberAccess(project: Project, graph: BlueprintGraph, reference: BlueprintMemberReference): BlueprintMemberAccess {
  const ref = memberReference(reference);
  if (ref.projectId !== project.id) throw new Error('不能跨工程使用蓝图成员，请拖出当前工程的成员。');
  const current = projectGraphs(project).find(item => item.id === graph.id);
  if (!current) throw new Error('当前蓝图已不存在，请重新打开蓝图。');
  const localOwner = (ownerId: string | undefined) => {
    if (ownerId !== current.id) throw new Error('本次调用变量、蓝图输入与输出只能用于所属蓝图。');
  };
  const pageOwner = (pageId: string) => {
    if (!uiPage(project, pageId)) throw new Error('成员所属页面已不存在，请重新选择页面。');
  };
  const type = (dataType: BlueprintDataType) => {
    if (dataType === 'exec' || !Object.hasOwn(blueprintTypeNames, dataType)) throw new Error('成员的数据类型无效，请先修复成员定义。');
    return dataType;
  };
  const result = (name: string, dataType: BlueprintDataType, actions: BlueprintMemberAction[]) => ({ name, dataType: type(dataType), actions });
  const action = (operation: BlueprintMemberAction['action'], nodeType: BlueprintNodeType, properties: Record<string, VariableValue>, name: string, hint: string): BlueprintMemberAction => ({ action: operation, type: nodeType, properties, label: `${operation === 'read' ? '读取' : '设置'} ${name}`, hint });

  if (ref.kind === 'variable') {
    if (ref.scope === 'call') localOwner(ref.graphId);
    if (ref.scope === 'page') pageOwner(ref.pageId!);
    const variable = (ref.scope === 'call' ? current.localVariables : ref.scope === 'page' ? project.ui.pageVariables?.[ref.pageId!] : project.variables)?.find(item => item.id === ref.id);
    if (!variable) throw new Error('变量定义已不存在，请重新选择变量。');
    if ((ref.scope === 'project' || ref.scope === 'player') && ('persistent' in variable && variable.persistent) !== (ref.scope === 'player')) throw new Error('变量作用域已变化，请重新拖出变量。');
    if (!validBlueprintStateValue(variable.type, variable.initial)) throw new Error('变量初始值与类型不匹配，请先修复定义。');
    const properties = { variableId: variable.id, scope: ref.scope, ...(ref.scope === 'page' ? { pageId: ref.pageId! } : {}) };
    return result(variable.name, variable.type, [
      action('read', 'getVariable', { ...properties }, variable.name, '读取这个变量的当前值，连接到判断、计算或动作参数。'),
      action('write', 'setVariable', { ...properties, value: variable.initial }, variable.name, '接上执行线写入新值；未修改时使用当前定义的初始值。'),
    ]);
  }
  if (ref.kind === 'input' || ref.kind === 'output') {
    localOwner(ref.graphId);
    const input = ref.kind === 'input', pin = (input ? current.exposedInputs : current.exposedOutputs).find(item => item.id === ref.id);
    if (!pin || pin.direction !== (input ? 'input' : 'output')) throw new Error('蓝图输入或输出定义已不存在或方向已变化。');
    return result(pin.name, pin.dataType, [input
      ? action('read', 'getInput', { inputId: pin.id }, pin.name, '读取调用者传入本蓝图的值；未传入时使用接口默认值。')
      : action('write', 'setOutput', { outputId: pin.id, value: pin.defaultValue ?? defaultBlueprintValue(pin.dataType) }, pin.name, '接上执行线写入本蓝图的返回结果，调用完成后交给调用者。')]);
  }
  pageOwner(ref.pageId);
  const definition = uiPageInterface(project, ref.pageId);
  if (!uiPageInterfaceKnown(definition)) throw new Error('页面接口版本不受支持，请先明确恢复页面接口。');
  const input = ref.kind === 'pageInput', parameter = (input ? definition?.inputs : definition?.outputs)?.find(item => item.id === ref.id);
  if (!parameter || parameter.direction !== (input ? 'input' : 'output')) throw new Error('页面输入或结果定义已不存在或方向已变化。');
  const properties = { pageId: ref.pageId, parameterId: parameter.id };
  return result(parameter.name, parameter.dataType, input
    ? [action('read', 'getPageInput', properties, parameter.name, '读取本次打开页面的输入快照；关闭完成事件仍可读取只读快照。')]
    : [action('read', 'getPageOutput', { ...properties }, parameter.name, '读取该页面本次已写入的结果；关闭完成事件读取只读结果快照。'),
      action('write', 'setPageOutput', { ...properties, value: uiPageParameterDefault(parameter) }, parameter.name, '接上执行线暂存结果；正常完成页面后交给等待者，取消时使用结果默认值。')]);
}
