import { makeId, effectiveUiComponents, localUiComponents, uiComponentLimit, type ParameterSet, type Project, type Variable, type VariableValue } from './model';

export const storyParametersId = 'parameters_story';
export const gameParametersId = 'parameters_game';
export const builtinParameterSets: ParameterSet[] = [
  { id: storyParametersId, name: '故事状态', kind: 'story', description: '好感度、剧情进度和条件等故事参数。' },
  { id: gameParametersId, name: '游戏设置', kind: 'settings', description: '玩家的音量、显示和自定义选项。' },
];
export function parameterSets(project: Project): ParameterSet[] {
  return [...builtinParameterSets.map(builtin => project.parameterSets?.find(set => set.id === builtin.id) ?? builtin), ...(project.parameterSets ?? []).filter(set => !builtinParameterSets.some(builtin => builtin.id === set.id))];
}
export function parameterSetFor(project: Project, variable: Variable): ParameterSet {
  return parameterSets(project).find(set => set.id === (variable.parameterSetId ?? storyParametersId)) ?? builtinParameterSets[0];
}
export function settingsParameters(project: Project): Variable[] {
  const settings = new Set(parameterSets(project).filter(set => set.kind === 'settings').map(set => set.id));
  return project.variables.filter(variable => settings.has(variable.parameterSetId ?? storyParametersId));
}
export function parameterRange(variable: Variable) {
  const min = variable.setting?.min ?? Math.min(0, Number(variable.initial) || 0);
  const max = variable.setting?.max ?? Math.max(100, Number(variable.initial) || 0);
  return { min, max, step: variable.setting?.step ?? 1 };
}
export function validParameterSetting(variable: Variable, value: unknown) {
  if (typeof value !== variable.type) return false;
  if (typeof value === 'number') { const range = parameterRange(variable); return Number.isFinite(value) && value >= range.min && value <= range.max; }
  return variable.type !== 'string' || !variable.setting?.options?.length || variable.setting.options.includes(String(value));
}
export function addParameter(project: Project, setId: string, type: Variable['type'] = 'number') {
  const set = parameterSets(project).find(set => set.id === setId);
  if (!set) throw new Error('参数集不存在。');
  let index = project.variables.length + 1, name = '参数 ' + index;
  while (project.variables.some(variable => variable.name === name)) name = '参数 ' + ++index;
  const variable: Variable = { id: makeId('var'), name, type, initial: type === 'number' ? 0 : type === 'boolean' ? false : '', persistent: set.kind === 'settings', parameterSetId: setId };
  project.variables.push(variable);
  return variable.id;
}
export function removeParameterSet(project: Project, setId: string) {
  if (builtinParameterSets.some(set => set.id === setId)) throw new Error('内置参数集不能移除。');
  project.parameterSets = project.parameterSets?.filter(set => set.id !== setId);
  for (const variable of project.variables) if (variable.parameterSetId === setId) variable.parameterSetId = storyParametersId;
}
function availableName(names: string[], requested: string) {
  const base = requested.trim().slice(0, 110) || '未命名';
  let name = base, suffix = 2;
  while (names.includes(name)) name = `${base} ${suffix++}`;
  return name;
}
export function addParameterSet(project: Project, name = '新参数集', kind: ParameterSet['kind'] = 'story') {
  if ((project.parameterSets?.length ?? 0) >= 128) throw new Error('参数集数量已达上限。');
  const set: ParameterSet = { id: makeId('parameters'), name: availableName(parameterSets(project).map(set => set.name), name), kind };
  (project.parameterSets ??= []).push(set);
  return set.id;
}
export type ParameterClipboard =
  | { kind: 'set'; set: ParameterSet; variables: Variable[] }
  | { kind: 'variable'; variable: Variable; cut?: boolean; projectId: string };

export function copyParameterSet(project: Project, setId: string): ParameterClipboard {
  const set = parameterSets(project).find(set => set.id === setId);
  if (!set) throw new Error('参数集不存在。');
  return structuredClone({ kind: 'set', set, variables: project.variables.filter(variable => parameterSetFor(project, variable).id === setId) });
}
export function copyParameter(project: Project, variableId: string, cut = false): ParameterClipboard {
  const variable = project.variables.find(variable => variable.id === variableId);
  if (!variable) throw new Error('参数不存在。');
  return structuredClone({ kind: 'variable', variable, cut, projectId: project.id });
}
export function moveParameter(project: Project, variableId: string, setId: string) {
  const variable = project.variables.find(variable => variable.id === variableId);
  if (!variable || !parameterSets(project).some(set => set.id === setId)) throw new Error('参数或目标参数集不存在。');
  variable.parameterSetId = setId;
  return variable.id;
}
export function pasteParameter(project: Project, clipboard: ParameterClipboard, setId?: string): { setId: string; variableId?: string } {
  const cloneVariable = (variable: Variable, target: string) => {
    const copy = structuredClone(variable);
    copy.id = makeId('var'); copy.parameterSetId = target;
    copy.name = availableName(project.variables.map(variable => variable.name), variable.name + ' 副本');
    project.variables.push(copy);
    return copy.id;
  };
  if (clipboard.kind === 'set') {
    const id = addParameterSet(project, clipboard.set.name + ' 副本', clipboard.set.kind);
    project.parameterSets!.find(set => set.id === id)!.description = clipboard.set.description;
    const ids = clipboard.variables.map(variable => cloneVariable(variable, id));
    return { setId: id, variableId: ids[0] };
  }
  if (!setId || !parameterSets(project).some(set => set.id === setId)) throw new Error('请先进入目标参数集。');
  if (clipboard.cut) {
    if (clipboard.projectId !== project.id) throw new Error('剪切的参数只能在原工程中移动。');
    return { setId, variableId: moveParameter(project, clipboard.variable.id, setId) };
  }
  return { setId, variableId: cloneVariable(clipboard.variable, setId) };
}
export function createParameterControl(project: Project, parameterId: string) {
  const variable = project.variables.find(variable => variable.id === parameterId);
  if (!variable) throw new Error('参数不存在。');
  const existing = effectiveUiComponents(project.ui).find(component => component.parameterId === parameterId && component.page === 'preferences');
  if (existing) return existing.id;
  const id = makeId('ui'), components = localUiComponents(project.ui);
  if (components.length >= uiComponentLimit) throw new Error('设置界面的控件已达上限，请先移除不需要的控件。');
  components.push({ id, name: variable.name, kind: 'preference', page: 'preferences', parameterId, text: variable.name, x: .12, y: .72, width: .64, height: .12 });
  return id;
}
export function parameterValueText(value: VariableValue) { return typeof value === 'boolean' ? value ? '开启' : '关闭' : String(value); }
