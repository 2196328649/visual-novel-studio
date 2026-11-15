import { effectiveUiComponents, type Diagnostic, type Project, type StageAction, type UiComponent, type VariableValue } from './model';
import { projectGraphs } from './project-resources';
import { textCommandAction } from './text-script';
import { gameFlowPhaseNames, type GameFlowPhase } from './game-flow-schema';
import { uiPageNames } from './ui-names';

export type BlueprintUsageLocation =
  | { kind: 'blueprint'; graphId: string; nodeId: string }
  | { kind: 'story'; nodeId: string; lineId?: string; actionIndex?: number }
  | { kind: 'scene'; sceneId: string }
  | { kind: 'character'; characterId: string; featureId?: string }
  | { kind: 'effect'; effectId: string }
  | { kind: 'minigame'; minigameId: string }
  | { kind: 'ui'; target: NonNullable<Diagnostic['ui']> }
  | { kind: 'gameFlow'; phase: GameFlowPhase; stepId: string };
export interface BlueprintUsage {
  key: string; label: string; location: BlueprintUsageLocation;
  /** Explicit arguments only: inherited defaults must not masquerade as overrides. */
  inputs?: Record<string, VariableValue>; linkedInputs?: string[]; outputOnly?: boolean;
}

/** Authored direct call sites and event bindings, not an assertion that every site is reachable. */
export function blueprintUsages(project: Project, graphId: string): BlueprintUsage[] {
  const usages: BlueprintUsage[] = [], graphs = projectGraphs(project), target = graphs.find(graph => graph.id === graphId);
  const add = (id: unknown, usage: BlueprintUsage) => { if (id === graphId) usages.push(usage); };
  const action = (value: StageAction | undefined, usage: BlueprintUsage) => {
    if (value?.kind === 'blueprint') add(value.blueprintId, { ...usage, inputs: value.inputs && { ...value.inputs } });
  };
  for (const graph of graphs) for (const node of graph.nodes) {
    const usage: BlueprintUsage = { key: 'node:' + graph.id + ':' + node.id, label: graph.name + ' / ' + node.name, location: { kind: 'blueprint', graphId: graph.id, nodeId: node.id } };
    if (['callFunction', 'callMacro', 'startTask', 'debounce', 'waitTask'].includes(node.type)) {
      const inputs: Record<string, VariableValue> = {};
      for (const [index, pin] of (target?.exposedInputs ?? []).entries()) {
        const value = node.properties['arg_' + pin.id] ?? node.properties['arg_' + index];
        if (value !== undefined) inputs[pin.id] = value;
      }
      const linkedInputs = graph.links.filter(link => link.toNodeId === node.id && link.toPinId.startsWith('arg_')).map(link => {
        const id = link.toPinId.slice(4);
        return /^\d+$/.test(id) ? target?.exposedInputs[Number(id)]?.id ?? id : id;
      });
      add(node.properties.graphId, { ...usage, inputs, linkedInputs, ...(node.type === 'waitTask' ? { outputOnly: true } : {}) });
    } else if (node.type === 'savedAction') {
      try { action(JSON.parse(String(node.properties.action)) as StageAction, usage); } catch { /* Malformed commands stay in diagnostics. */ }
    } else if (node.type === 'sceneAction') action(textCommandAction(project, String(node.properties.command ?? '')), usage);
  }
  for (const node of project.nodes) if (node.kind === 'passage') for (const line of node.lines) line.actions.forEach((value, index) => action(value, {
    key: 'story:' + node.id + ':' + line.id + ':' + index, label: '剧本 / ' + node.name + ' / ' + (line.text.slice(0, 36) || '空台词') + ' / 演出 ' + (index + 1),
    location: { kind: 'story', nodeId: node.id, lineId: line.id, actionIndex: index },
  }));
  for (const scene of project.scenes) {
    const usage: BlueprintUsage = { key: 'scene:' + scene.id, label: '场景 / ' + scene.name, location: { kind: 'scene', sceneId: scene.id } };
    add(scene.blueprintId, { ...usage, inputs: scene.parameters && { ...scene.parameters } });
    scene.entryActions?.forEach((value, index) => action(value, { ...usage, key: usage.key + ':entry:' + index, label: usage.label + ' / 进入演出 ' + (index + 1) }));
  }
  for (const character of project.characters) {
    const usage: BlueprintUsage = { key: 'character:' + character.id, label: '角色 / ' + character.name, location: { kind: 'character', characterId: character.id } };
    add(character.blueprintId, usage);
    for (const feature of character.features ?? []) feature.actions?.forEach((value, index) => action(value, {
      key: usage.key + ':' + feature.id + ':' + index, label: usage.label + ' / ' + feature.name + ' / 演出 ' + (index + 1), location: { kind: 'character', characterId: character.id, featureId: feature.id },
    }));
  }
  for (const effect of project.effects) {
    const usage: BlueprintUsage = { key: 'effect:' + effect.id, label: '演出效果 / ' + effect.name, location: { kind: 'effect', effectId: effect.id } };
    effect.actions?.forEach((value, index) => action(value, { ...usage, key: usage.key + ':action:' + index, label: usage.label + ' / 演出 ' + (index + 1) }));
    effect.commands.forEach((command, index) => action(textCommandAction(project, command), { ...usage, key: usage.key + ':command:' + index, label: usage.label + ' / 指令 ' + (index + 1) }));
  }
  for (const definition of project.minigames) if (definition.mode === 'blueprint') add(definition.blueprintId, {
    key: 'minigame:' + definition.id, label: '小游戏 / ' + definition.name, location: { kind: 'minigame', minigameId: definition.id },
  });
  const component = (c: UiComponent, prefix: string, label: string, target: NonNullable<Diagnostic['ui']>) => {
    const usage: BlueprintUsage = { key: prefix + ':' + c.id, label: label + ' / ' + (c.name || c.text || c.id), location: { kind: 'ui', target: { ...target, componentId: c.id } } };
    if (c.action === 'blueprint') add(c.blueprintId, { ...usage, key: usage.key + ':action', label: usage.label + ' / 点击动作' });
    for (const [event, name] of [['beforeClick', '点击前'], ['onClick', '点击时'], ['onShow', '显示时']] as const) add(c.events?.[event], { ...usage, key: usage.key + ':' + event, label: usage.label + ' / ' + name });
  };
  for (const scheme of [{ id: undefined, name: '基础界面' }, ...(project.ui.instances ?? [])]) {
    const prefix = 'ui:' + (scheme.id ?? 'base');
    for (const c of effectiveUiComponents({ ...project.ui, activeInstanceId: scheme.id })) component(c, prefix, scheme.name + ' / ' + uiPageNames[c.page], { page: c.page, instanceId: scheme.id });
    if ('blueprintId' in scheme) add(scheme.blueprintId, { key: prefix + ':show', label: scheme.name + ' / 方案显示事件', location: { kind: 'ui', target: { page: 'main', instanceId: scheme.id } } });
  }
  for (const page of project.ui.customPages) {
    const target: NonNullable<Diagnostic['ui']> = { page: 'custom', customPageId: page.id }, prefix = 'page:' + page.id;
    add(page.onShowBlueprintId, { key: prefix + ':show', label: page.name + ' / 页面显示时', location: { kind: 'ui', target } });
    for (const c of page.components) component(c, prefix, page.name, target);
  }
  for (const phase of ['beforeTitle', 'beforeNewGame'] as const) {
    const steps = phase === 'beforeTitle' ? project.gameFlow?.beforeTitle.steps : project.gameFlow?.beforeNewGame;
    for (const step of steps ?? []) if (step.kind === 'blueprint') add(step.graphId, {
      key: 'flow:' + phase + ':' + step.id, label: gameFlowPhaseNames[phase] + ' / ' + (step.name || target?.name || step.id),
      location: { kind: 'gameFlow', phase, stepId: step.id }, inputs: step.inputs && { ...step.inputs },
    });
  }
  return usages;
}
