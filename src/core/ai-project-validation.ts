import { blueprintScreens, blueprintTypeNames } from './blueprint';
import { blueprintAssetInputFilters } from './blueprint-assets';
import { findFlowStep, flowNodeIds, flowSourcePhase, gameFlowSteps } from './game-flow-graph';
import { gameFlowPhaseNames } from './game-flow-schema';
import { gameFlowTransitionSupport } from './game-flow-transitions';
import { declaredUiComponents, type BlueprintPin, type Diagnostic, type Project, type TextPresentation } from './model';
import { projectGraphs } from './project-resources';
import { builtinTextPresets } from './text-presentation';
import { uiPage } from './ui-pages';
import { uiPageInterface, uiPageInterfaceKnown, uiPageParameterDefault } from './ui-page-interface';
import { validateProject } from './validate';
import type { AiProjectPath } from './ai-project-privacy';

export interface AiProjectDiagnostic extends Diagnostic {
  projectPath?: AiProjectPath;
  /** Internal comparison value; omit this from model-facing diagnostics. */
  projectValue?: string | number | boolean;
}

/** AI must not introduce references that merely fall back in the player. Existing
 * author drafts remain repairable; only added errors block a batch or proposal. */
function textPresetDiagnostics(project: Project): AiProjectDiagnostic[] {
  const issues: AiProjectDiagnostic[] = [], presets = project.textPresets ?? [];
  const assets = new Map(project.assets.map(asset => [asset.id, asset]));
  const ids = new Map<string, number>(), names = new Map<string, number>();
  for (const preset of [...builtinTextPresets, ...presets]) {
    ids.set(preset.id, (ids.get(preset.id) ?? 0) + 1);
    const name = preset.name.trim(); names.set(name, (names.get(name) ?? 0) + 1);
  }
  const add = (path: AiProjectPath, value: string, code: string, message: string, location: Partial<Diagnostic> = {}) => {
    issues.push({ ...location, severity: 'error', code: 'ai.textPreset.' + code, projectPath: path, projectValue: value, message });
  };
  const checkStyle = (look: TextPresentation | undefined, path: AiProjectPath, label: string, location: Partial<Diagnostic> = {}) => {
    if (!look) return;
    if (look.presetId && !builtinTextPresets.some(preset => preset.id === look.presetId) && presets.filter(preset => preset.id === look.presetId).length !== 1) {
      add([...path, 'presetId'], look.presetId, 'reference', `${label}引用的文字演出预设不存在或不唯一：${look.presetId}。`, location);
    }
    if (look.fontAssetId && assets.get(look.fontAssetId)?.kind !== 'font') {
      add([...path, 'fontAssetId'], look.fontAssetId, 'font', `${label}需要有效的字体素材：${look.fontAssetId}。`, location);
    }
    if (look.typeSoundId && assets.get(look.typeSoundId)?.kind !== 'audio') {
      add([...path, 'typeSoundId'], look.typeSoundId, 'sound', `${label}需要有效的打字音素材：${look.typeSoundId}。`, location);
    }
  };
  for (const preset of presets) {
    const path: AiProjectPath = ['textPresets', { id: preset.id }];
    if (ids.get(preset.id)! > 1) add([...path, 'id'], preset.id, 'id', `文字演出预设标识重复或与内置预设冲突：${preset.id}。`);
    if (names.get(preset.name.trim())! > 1) add([...path, 'name'], preset.name.trim(), 'name', `文字演出预设名称重复或与内置预设冲突：${preset.name.trim()}。`);
    checkStyle(preset.style, [...path, 'style'], `文字演出预设“${preset.name}”`);
  }
  for (const character of project.characters) {
    checkStyle(character.textPresentation, ['characters', { id: character.id }, 'textPresentation'], `角色“${character.name}”`);
  }
  for (const node of project.nodes) if (node.kind === 'passage') for (const line of node.lines) {
    checkStyle(line.textPresentation, ['nodes', { id: node.id }, 'lines', { id: line.id }, 'textPresentation'], '台词', { nodeId: node.id, lineId: line.id });
  }
  return issues;
}

/** Step arguments use the declared interface, not coercion or stale names. Page
 * calls without an interface keep their released untyped-input behavior. */
function gameFlowReferenceDiagnostics(project: Project): AiProjectDiagnostic[] {
  const issues: AiProjectDiagnostic[] = [], graphs = projectGraphs(project);
  const resources = {
    asset: new Set(project.assets.map(item => item.id)), scene: new Set(project.scenes.map(item => item.id)),
    character: new Set(project.characters.map(item => item.id)), component: new Set(declaredUiComponents(project).map(item => item.id)),
  };
  const valueValid = (pin: BlueprintPin, value: unknown) => {
    if (value === undefined) return !pin.required;
    if (pin.dataType === 'any') return ['string', 'number', 'boolean'].includes(typeof value) && (typeof value !== 'number' || Number.isFinite(value));
    if (pin.dataType === 'number') return typeof value === 'number' && Number.isFinite(value);
    if (pin.dataType === 'string' || pin.dataType === 'boolean') return typeof value === pin.dataType;
    if (pin.dataType === 'exec' || typeof value !== 'string') return false;
    if (value === '') return !pin.required;
    if (pin.dataType === 'ui') return Object.hasOwn(blueprintScreens, value) || !!uiPage(project, value);
    return resources[pin.dataType].has(value);
  };
  for (const phase of ['beforeTitle', 'beforeNewGame'] as const) for (const step of gameFlowSteps(project, phase)) {
    const stepPath: AiProjectPath = phase === 'beforeTitle' ? ['gameFlow', 'beforeTitle', 'steps', { id: step.id }] : ['gameFlow', 'beforeNewGame', { id: step.id }];
    const referenceProblem = (field: string, value: string, message: string) => issues.push({ severity: 'error', code: 'ai.gameFlow.reference.' + field,
      gameFlow: { phase, stepId: step.id }, projectPath: [...stepPath, field], projectValue: value, message: gameFlowPhaseNames[phase] + '：' + message });
    if (step.kind === 'video') {
      if (!project.assets.some(asset => asset.id === step.assetId && asset.kind === 'video')) referenceProblem('assetId', step.assetId, `步骤“${step.id}”需要有效的视频素材：${step.assetId}。`);
      continue;
    }
    const graph = step.kind === 'blueprint' ? graphs.find(item => item.id === step.graphId) : undefined;
    const definition = step.kind === 'page' ? uiPageInterface(project, step.pageId) : undefined;
    if (step.kind === 'blueprint' && !graph) referenceProblem('graphId', step.graphId, `步骤“${step.id}”调用的蓝图不存在：${step.graphId}。`);
    if (step.kind === 'page' && !uiPage(project, step.pageId)) referenceProblem('pageId', step.pageId, `步骤“${step.id}”引用的页面不存在：${step.pageId}。`);
    if (step.kind === 'blueprint' && !graph || step.kind === 'page' && (!definition || !uiPageInterfaceKnown(definition))) continue;
    const pins = graph?.exposedInputs ?? definition!.inputs, supplied = step.inputs ?? {};
    const path: AiProjectPath = [...stepPath, 'inputs'];
    const label = `${gameFlowPhaseNames[phase]}“${step.name || graph?.name || (step.kind === 'page' ? uiPage(project, step.pageId)?.name : undefined) || step.id}”`;
    const add = (id: string, value: string | number | boolean | undefined, code: string, message: string) => issues.push({ severity: 'error', code: 'ai.gameFlow.input.' + code,
      gameFlow: { phase, stepId: step.id }, projectPath: [...path, id], projectValue: value, message: label + message });
    for (const id of Object.keys(supplied)) if (!pins.some(pin => pin.id === id)) add(id, supplied[id], 'unknown', `的输入已不存在：${id}。请在同一批修改中更新调用参数。`);
    for (const pin of pins) {
      const provided = Object.hasOwn(supplied, pin.id);
      if (!provided && pin.required && pin.defaultValue === undefined) { add(pin.id, undefined, 'required', `缺少必填输入“${pin.name}”。`); continue; }
      const value = provided ? supplied[pin.id] : graph ? pin.defaultValue : uiPageParameterDefault(pin as NonNullable<typeof definition>['inputs'][number]);
      if (!valueValid(pin, value)) { add(pin.id, value, 'value', `的“${pin.name}”需要有效的${blueprintTypeNames[pin.dataType]}：${(JSON.stringify(value) ?? '未设置').slice(0, 200)}。`); continue; }
      if (graph && pin.dataType === 'asset' && typeof value === 'string' && value) {
        const asset = project.assets.find(item => item.id === value);
        const filters = blueprintAssetInputFilters(project, graph, pin);
        // Mixed consumers may belong to different branches. Match the editor's
        // agreed static restriction without inferring one from a default asset.
        const kind = filters.length && filters.every(filter => filter.kind === filters[0].kind) ? filters[0].kind : undefined;
        if (asset && kind && kind !== 'all' && kind !== asset.kind) add(pin.id, value, 'assetKind', `的“${pin.name}”素材格式与实际使用位置不符：${value}。`);
      }
    }
  }
  for (const [source, target] of Object.entries(project.gameFlow?.connections ?? {})) {
    const phase = flowSourcePhase(project, source);
    const location: NonNullable<Diagnostic['gameFlow']> = { phase: phase ?? 'beforeTitle', stepId: findFlowStep(project, source)?.step.id };
    if (!phase) issues.push({ severity: 'error', code: 'ai.gameFlow.connection.source', gameFlow: location,
      projectPath: ['gameFlow', 'connections', source], projectValue: target, message: `游戏流程连线的来源不存在或没有继续出口：${source}。` });
    if (target !== flowNodeIds.title && target !== flowNodeIds.story && !findFlowStep(project, target)) issues.push({ severity: 'error', code: 'ai.gameFlow.connection.target', gameFlow: location,
      projectPath: ['gameFlow', 'connections', source], projectValue: target, message: `游戏流程连线的目标不存在或不是可接入节点：${target}。` });
  }
  for (const source of Object.keys(project.gameFlow?.transitions ?? {})) {
    const support = gameFlowTransitionSupport(project, source);
    if (!support.supported) issues.push({ severity: 'error', code: 'ai.gameFlow.transition.source', projectPath: ['gameFlow', 'transitions', source], projectValue: source,
      message: `游戏流程过渡的来源“${source}”不支持继续过渡：${support.reason}` });
  }
  return issues;
}

export function aiProjectDiagnostics(project: Project): AiProjectDiagnostic[] {
  return [...validateProject(project), ...textPresetDiagnostics(project), ...gameFlowReferenceDiagnostics(project)];
}

/** Location and multiplicity matter: an old bad module/control cannot excuse a
 * different bad one, or another identical error at the same location. */
export function addedAiProjectErrors(before: readonly AiProjectDiagnostic[], after: readonly AiProjectDiagnostic[]): AiProjectDiagnostic[] {
  const key = (issue: AiProjectDiagnostic) => JSON.stringify([issue.code, issue.nodeId, issue.lineId, issue.assetId, issue.sourceLine, issue.setting,
    issue.gameFlow?.phase, issue.gameFlow?.stepId, issue.ui?.page, issue.ui?.componentId, issue.ui?.instanceId, issue.ui?.customPageId,
    issue.projectPath, issue.projectPath ? issue.projectValue : issue.message]);
  const existing = new Map<string, number>();
  for (const issue of before) if (issue.severity === 'error') { const id = key(issue); existing.set(id, (existing.get(id) ?? 0) + 1); }
  return after.filter(issue => {
    if (issue.severity !== 'error') return false;
    const id = key(issue), remaining = existing.get(id) ?? 0;
    if (!remaining) return true;
    existing.set(id, remaining - 1); return false;
  });
}

export function assertNoNewAiProjectErrors(before: Project, after: Project, prefix: string) {
  const added = addedAiProjectErrors(aiProjectDiagnostics(before), aiProjectDiagnostics(after));
  if (added.length) throw new Error(prefix + added[0].message);
}
