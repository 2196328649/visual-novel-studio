import { cloneData } from "./project-mutation";
import { formatNumber } from './preferences';
import { makeId, effectiveUiComponents, localUiComponents, parameterDefaultsSchema, uiComponentLimit, variableAssetKind, type ParameterAssetKind, type ParameterDefaults, type ParameterSet, type Project, type Variable, type VariableValue } from './model';
import { uiPage } from './ui-pages';

export const storyParametersId = 'parameters_story';
export const gameParametersId = 'parameters_game';
export const builtinParameterSets: ParameterSet[] = [
  { id: storyParametersId, name: '故事状态', kind: 'story', description: '整理好感度、剧情进度和蓝图状态等参数。' },
  { id: gameParametersId, name: '游戏设置', kind: 'settings', description: '内置音量、显示设置，以及自行整理的通用参数。' },
];
export function parameterSets(project: Project): ParameterSet[] {
  return [...builtinParameterSets.map(builtin => project.parameterSets?.find(set => set.id === builtin.id) ?? builtin), ...(project.parameterSets ?? []).filter(set => !builtinParameterSets.some(builtin => builtin.id === set.id))];
}
export function parameterSetFor(project: Project, variable: Variable): ParameterSet {
  return parameterSets(project).find(set => set.id === (variable.parameterSetId ?? storyParametersId)) ?? builtinParameterSets[0];
}
/** Group defaults apply only when creating a variable, never to its later behavior. */
export function parameterSetDefaults(set: ParameterSet): ParameterDefaults {
  return set.defaults ? { ...set.defaults } : { persistent: set.kind === 'settings', resetWithSettings: set.kind === 'settings' };
}
/** Pure compatibility read. Current creation defaults must not change old members. */
export function parameterResetsWithSettings(project: Project, variable: Variable): boolean {
  return variable.resetWithSettings ?? parameterSetFor(project, variable).kind === 'settings';
}
export function parametersResetWithSettings(project: Project): Variable[] {
  const legacySettings = new Set(parameterSets(project).filter(set => set.kind === 'settings').map(set => set.id));
  return project.variables.filter(variable => variable.resetWithSettings ?? legacySettings.has(variable.parameterSetId ?? storyParametersId));
}
function materializeParameterReset(project: Project, variable: Variable) {
  variable.resetWithSettings ??= parameterResetsWithSettings(project, variable);
}
export function changeParameterSetDefaults(project: Project, id: string, defaults: ParameterDefaults) {
  const next = parameterDefaultsSchema.parse(defaults);
  const source = parameterSets(project).find(set => set.id === id);
  if (!source) throw new Error('参数集已不存在。');
  const own = project.parameterSets?.find(set => set.id === id);
  if (!own && (project.parameterSets?.length ?? 0) >= 128) throw new Error('参数集数量已达上限。');
  for (const variable of project.variables) if (parameterSetFor(project, variable).id === id) materializeParameterReset(project, variable);
  const sets = project.parameterSets ??= [];
  if (own) own.defaults = next; else sets.push({ ...source, defaults: next });
}
export function parameterRange(variable: Variable) {
  const min = variable.setting?.min ?? Math.min(0, Number(variable.initial) || 0);
  const max = variable.setting?.max ?? Math.max(100, Number(variable.initial) || 0);
  return { min, max, step: variable.setting?.step ?? 1 };
}
/** One choice per author-facing parameter kind: scalar types plus media kinds. */
export type ParameterKind = 'number' | 'boolean' | 'string' | ParameterAssetKind;
export const parameterKindNames: Record<ParameterKind, string> = { number: '数值', boolean: '开关', string: '文字', image: '图片', audio: '音频', video: '视频' };
export function parameterKind(variable: Pick<Variable, 'type' | 'assetKind'>): ParameterKind {
  return variableAssetKind(variable) ?? variable.type as Exclude<Variable['type'], 'asset'>;
}
export function parameterTypeName(variable: Pick<Variable, 'type' | 'assetKind'>) { return parameterKindNames[parameterKind(variable)]; }
export function parameterNameProblem(project: Project, name: string, id?: string, kind: 'variable' | 'set' = 'variable'): string | undefined {
  const value = name.trim();
  if (!value) return '名称不能为空。';
  if (value.length > 120) return '名称最多 120 字。';
  if (/[\r\n\u0000]/.test(value)) return '名称不能包含换行或空字符。';
  const items = kind === 'set' ? parameterSets(project) : project.variables;
  if (items.some(item => item.id !== id && item.name.trim() === value)) return '已存在同名项目，请换一个名称。';
}
export function renameParameterSet(project: Project, id: string, name: string) {
  const problem = parameterNameProblem(project, name, id, 'set');
  if (problem) throw new Error(problem);
  const source = parameterSets(project).find(set => set.id === id);
  if (!source) throw new Error('参数集已不存在。');
  const own = project.parameterSets?.find(set => set.id === id);
  if (!own && (project.parameterSets?.length ?? 0) >= 128) throw new Error('参数集数量已达上限。');
  const sets = project.parameterSets ??= [];
  if (own) own.name = name.trim(); else sets.push({ ...source, name: name.trim() });
}
/** Stable text references survive renames and never recreate deleted parameters. */
export function parameterReference(variable: Pick<Variable, 'id' | 'name'>) { return `${variable.name}【${variable.id}】`; }
export function parameterAssignment(project: Project, variable: Variable) {
  return '@设置：' + parameterReference(variable) + '=' + JSON.stringify(variable.type === 'asset' ? parameterAssetText(project, variable, variable.initial) : variable.initial);
}
/** Change a parameter's kind; the initial value and kind-specific settings restart. */
export function setParameterKind(variable: Variable, kind: ParameterKind) {
  const asset = kind === 'image' || kind === 'audio' || kind === 'video';
  variable.type = asset ? 'asset' : kind;
  if (asset) variable.assetKind = kind; else delete variable.assetKind;
  variable.initial = kind === 'number' ? 0 : kind === 'boolean' ? false : '';
  variable.setting = undefined;
}
export function addParameter(project: Project, setId: string, kind: ParameterKind = 'number', options: Partial<ParameterDefaults> = {}) {
  const set = parameterSets(project).find(set => set.id === setId);
  if (!set) throw new Error('参数集不存在。');
  const defaults = parameterSetDefaults(set);
  const behavior = parameterDefaultsSchema.parse({ persistent: options.persistent ?? defaults.persistent, resetWithSettings: options.resetWithSettings ?? defaults.resetWithSettings });
  let index = project.variables.length + 1, name = '参数 ' + index;
  while (project.variables.some(variable => variable.name === name)) name = '参数 ' + ++index;
  const variable: Variable = { id: makeId('var'), name, type: 'number', initial: 0, ...behavior, parameterSetId: setId };
  setParameterKind(variable, kind);
  project.variables.push(variable);
  return variable.id;
}
export function removeParameterSet(project: Project, setId: string) {
  if (builtinParameterSets.some(set => set.id === setId)) throw new Error('内置参数集不能移除。');
  if (!project.parameterSets?.some(set => set.id === setId)) throw new Error('参数集已不存在。');
  for (const variable of project.variables) if (variable.parameterSetId === setId) materializeParameterReset(project, variable);
  project.parameterSets = project.parameterSets?.filter(set => set.id !== setId);
  for (const variable of project.variables) if (variable.parameterSetId === setId) variable.parameterSetId = storyParametersId;
}
function availableName(names: string[], requested: string) {
  const base = requested.trim().slice(0, 110) || '未命名';
  let name = base, suffix = 2;
  while (names.includes(name)) name = `${base} ${suffix++}`;
  return name;
}
export function addParameterSet(project: Project, name = '新参数集', kind: ParameterSet['kind'] = 'story', defaults?: ParameterDefaults) {
  if ((project.parameterSets?.length ?? 0) >= 128) throw new Error('参数集数量已达上限。');
  const next = parameterDefaultsSchema.parse(defaults ?? { persistent: kind === 'settings', resetWithSettings: kind === 'settings' });
  const set: ParameterSet = { id: makeId('parameters'), name: availableName(parameterSets(project).map(set => set.name), name), kind, defaults: next };
  (project.parameterSets ??= []).push(set);
  return set.id;
}
export type ParameterClipboard =
  | { kind: 'set'; set: ParameterSet; variables: Variable[] }
  | { kind: 'variable'; variable: Variable; cut?: boolean; projectId: string };

export function copyParameterSet(project: Project, setId: string): ParameterClipboard {
  const set = parameterSets(project).find(set => set.id === setId);
  if (!set) throw new Error('参数集不存在。');
  return cloneData({ kind: 'set', set: { ...set, defaults: parameterSetDefaults(set) }, variables: project.variables
    .filter(variable => parameterSetFor(project, variable).id === setId)
    .map(variable => ({ ...variable, resetWithSettings: parameterResetsWithSettings(project, variable) })) });
}
export function copyParameter(project: Project, variableId: string, cut = false): ParameterClipboard {
  const variable = project.variables.find(variable => variable.id === variableId);
  if (!variable) throw new Error('参数不存在。');
  return cloneData({ kind: 'variable', variable: { ...variable, resetWithSettings: parameterResetsWithSettings(project, variable) }, cut, projectId: project.id });
}
export function moveParameter(project: Project, variableId: string, setId: string) {
  const variable = project.variables.find(variable => variable.id === variableId);
  if (!variable || !parameterSets(project).some(set => set.id === setId)) throw new Error('参数或目标参数集不存在。');
  if (parameterSetFor(project, variable).id === setId) return variable.id;
  materializeParameterReset(project, variable);
  variable.parameterSetId = setId;
  return variable.id;
}
export function pasteParameter(project: Project, clipboard: ParameterClipboard, setId?: string): { setId: string; variableId?: string } {
  const cloneVariable = (variable: Variable, target: string) => {
    const copy = cloneData(variable);
    copy.id = makeId('var'); copy.parameterSetId = target;
    copy.name = availableName(project.variables.map(variable => variable.name), variable.name + ' 副本');
    // Pasting into another project keeps an asset parameter only if that asset exists there.
    if (copy.type === 'asset' && copy.initial && project.assets.find(asset => asset.id === copy.initial)?.kind !== variableAssetKind(copy)) copy.initial = '';
    project.variables.push(copy);
    return copy.id;
  };
  if (clipboard.kind === 'set') {
    const id = addParameterSet(project, clipboard.set.name + ' 副本', clipboard.set.kind, parameterSetDefaults(clipboard.set));
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
/** Addressable pages accepting authored controls; the old chapter layout is edited as a timeline. */
export function parameterControlPageProblem(project: Project, pageId: string): string | undefined {
  const page = uiPage(project, pageId);
  if (!page) return '页面已不存在，请重新选择。';
  if (page.disabled) return '该页面已停用，请先启用或选择其他页面。';
  if (page.kind === 'chapterTitle') return '章节标题已由时间轴编辑，请选择其他页面。';
}
export function createParameterControl(project: Project, parameterId: string, pageId = 'ui:preferences') {
  const variable = project.variables.find(variable => variable.id === parameterId);
  if (!variable) throw new Error('参数不存在。');
  if (variable.type === 'asset') throw new Error('素材参数请通过控件属性关联或蓝图使用。');
  const problem = parameterControlPageProblem(project, pageId);
  if (problem) throw new Error(problem);
  const page = uiPage(project, pageId)!;
  const customPage = !page.template ? project.ui.customPages.find(item => item.id === page.id)! : undefined;
  const effective = customPage?.components ?? effectiveUiComponents(project.ui);
  const existing = effective.find(component => component.parameterId === parameterId && component.page === page.kind && ['preference', 'preferenceChoice'].includes(component.kind));
  if (existing) return existing.id;
  const components = customPage?.components ?? localUiComponents(project.ui);
  if (components.length >= uiComponentLimit) throw new Error('目标界面的控件已达上限，请先移除不需要的控件。');
  const id = makeId('ui');
  components.push({ id, name: variable.name, kind: 'preference', page: page.kind, parameterId, text: variable.name, x: .12, y: .72, width: .64, height: .12 });
  return id;
}
export function parameterValueText(value: VariableValue) { return typeof value === 'boolean' ? value ? '开启' : '关闭' : String(value); }
/** The text-script form of an asset value: its name, 名称【id】 when the name is shared, or 无. */
export function parameterAssetText(project: Project, variable: Variable, value: VariableValue) {
  const asset = value ? project.assets.find(item => item.id === value) : undefined;
  if (!asset) return value ? String(value) : '无';
  return project.assets.filter(item => item.kind === asset.kind && item.name === asset.name).length > 1 ? `${asset.name}【${asset.id}】` : asset.name;
}
/** Resolve an asset name, 名称【id】, id, or 无 for an asset parameter; undefined when not found. */
export function parameterAssetFromText(project: Project, variable: Variable, raw: string): string | undefined {
  const text = raw.trim().startsWith('"') ? (() => { try { return String(JSON.parse(raw.trim())); } catch { return raw.trim(); } })() : raw.trim().replace(/^["“「']|["”」']$/g, '');
  if (!text || text === '无' || text.toLowerCase() === 'none') return '';
  const kind = variableAssetKind(variable), candidates = project.assets.filter(asset => asset.kind === kind);
  const id = text.match(/【([a-z][a-z0-9_]{0,63})】$/)?.[1];
  if (id) return candidates.find(asset => asset.id === id)?.id;
  const named = candidates.filter(asset => asset.name === text);
  return candidates.find(asset => asset.id === text)?.id ?? (named.length === 1 ? named[0].id : undefined);
}
/** A parameter's value as authors read it; asset parameters show the asset name. */
export function parameterDisplayValue(project: Project, variable: Variable, value: VariableValue = variable.initial) {
  if (variable.type === 'number' && typeof value === 'number') return formatNumber(value, variable.setting);
  if (variable.type !== 'asset') return parameterValueText(value);
  return value ? project.assets.find(asset => asset.id === value)?.name ?? '素材已删除' : '无';
}
