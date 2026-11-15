import { projectGraphs } from './project-resources';
import { actionSchema, characterFeatureActions, effectiveCharacter, effectiveScene, type BlueprintGraph, type BlueprintNode, type Project, type StageAction, type VariableValue } from './model';
import { blueprintStaticInput, unknownBlueprintValue, type StaticBlueprintValue, type StaticValueContext } from './blueprint-static-values';
import { textCommandAction } from './text-script';
import { actorInstanceNumber, actorInstanceProblem, maxActorInstanceNumber, parseActorInstance } from './actor-instance-identity';

export { actorInstanceNumber, actorInstanceLabel, actorInstanceProblem, parseActorInstance, actorLifetimes, parseActorLifetime, maxActorInstanceNumber } from './actor-instance-identity';

export type ActorReference = { characterId: string; instanceId?: string };
export type ShowActor = Extract<StageAction, { kind: 'show' }>;
/** All three namespaces are disjoint; old tags keep working in saved games. */
export function actorKey({ characterId, instanceId }: ActorReference): string {
  const number = actorInstanceNumber(instanceId);
  return number === 1 ? characterId : number !== undefined ? `actor-number:${characterId}:${number}` : `instance:${instanceId}`;
}
export function actorTag({ characterId, instanceId }: ActorReference): string {
  const number = actorInstanceNumber(instanceId);
  return number === 1 ? `vn_actor_${characterId}` : number !== undefined ? `vn_numbered_actor_${number}_${characterId}` : `vn_instance_${instanceId}`;
}
export const actorReference = ({ characterId, instanceId }: ActorReference): ActorReference => {
  const normalized = parseActorInstance(instanceId);
  return { characterId, ...(normalized ? { instanceId: normalized } : {}) };
};

/** Authored fixed references, including hidden actors and literal call inputs.
 * Unknown runtime values stay unknown; this never executes a graph or a script.
 * Keep caches local so mutable authoring callers cannot reuse stale references. */
export function actorInstanceReferences(project: Project): ActorReference[] {
  const references = new Map<string, ActorReference>();
  const graphs = projectGraphs(project), byGraph = new Map(graphs.map(graph => [graph.id, graph]));
  const contexts = new Set<string>(), effects = new Set<string>(), features = new Set<string>();
  const commands = new Map<string, StageAction | undefined>(), saved = new Map<BlueprintNode, StageAction | undefined>();
  const unknown: typeof unknownBlueprintValue = unknownBlueprintValue;
  const record = (characterId: unknown, instanceId: unknown, speakerId?: string) => {
    if (instanceId === unknown || actorInstanceProblem(instanceId)) return;
    const character = typeof characterId === 'string' ? characterId || speakerId || '' : '';
    // A generic speaker template's implicit default does not reserve #1 for
    // every character. Explicit numbers on a dynamic target are conservative.
    if (!character && (instanceId === undefined || instanceId === '')) return;
    const instance = parseActorInstance(instanceId);
    references.set(JSON.stringify([character, instance ?? '1']), { characterId: character, ...(instance ? { instanceId: instance } : {}) });
  };
  const commandAction = (command: string) => {
    if (!commands.has(command)) commands.set(command, textCommandAction(project, command));
    return commands.get(command);
  };
  const savedAction = (node: BlueprintNode) => {
    if (!saved.has(node)) {
      let action: StageAction | undefined;
      try {
        const raw = JSON.parse(String(node.properties.action));
        if (raw && ['show', 'hide', 'animate', 'blueprint', 'effect', 'characterFeature'].includes(raw.kind)) {
          const parsed = actionSchema.safeParse(raw); if (parsed.success) action = parsed.data;
        }
      } catch { /* Invalid authored actions remain diagnostics. */ }
      saved.set(node, action);
    }
    return saved.get(node);
  };
  const defaults = (graph: BlueprintGraph, supplied?: ReadonlyMap<string, StaticBlueprintValue>) => new Map<string, StaticBlueprintValue>(graph.exposedInputs.map(pin => [pin.id, supplied?.has(pin.id) ? supplied.get(pin.id) : pin.defaultValue]));
  const explicitInputs = (inputs?: Record<string, VariableValue>) => new Map<string, StaticBlueprintValue>(Object.entries(inputs ?? {}));
  const visitAction = (action: StageAction | undefined, speakerId?: string, stack: ReadonlySet<string> = new Set()): void => {
    if (!action) return;
    if (action.kind === 'show' || action.kind === 'hide' || action.kind === 'animate') record(action.characterId, action.instanceId, speakerId);
    else if (action.kind === 'blueprint') {
      const graph = byGraph.get(action.blueprintId);
      if (graph) visitGraph(graph, explicitInputs(action.inputs), speakerId, stack);
    } else if (action.kind === 'effect') {
      const key = JSON.stringify([action.effectId, speakerId]);
      if (effects.has(key)) return; effects.add(key);
      const effect = project.effects.find(effect => effect.id === action.effectId);
      effect?.actions?.forEach(item => visitAction(item, speakerId, stack));
      effect?.commands.forEach(command => visitAction(commandAction(command), speakerId, stack));
    } else if (action.kind === 'characterFeature') {
      const key = JSON.stringify([action.characterId, action.featureId, speakerId]);
      if (features.has(key)) return; features.add(key);
      characterFeatureActions(project, action.characterId, action.featureId).forEach(item => visitAction(item, speakerId, stack));
    }
  };
  const visitGraph = (graph: BlueprintGraph, supplied?: ReadonlyMap<string, StaticBlueprintValue>, speakerId?: string, stack: ReadonlySet<string> = new Set()): void => {
    const inputs = defaults(graph, supplied);
    const key = JSON.stringify([graph.id, speakerId, [...inputs].map(([id, value]) => [id, value === unknown ? ['unknown'] : value === undefined ? ['absent'] : value])]);
    if (contexts.has(key)) return; contexts.add(key);
    // Inspect one recursive call's fixed arguments too, but never expand a cycle.
    const recursive = stack.has(graph.id), next = new Set(stack).add(graph.id);
    const context: StaticValueContext = { project, graph, inputs, results: new Map(), onRead: () => {}, uiValue: () => unknown };
    for (const node of graph.nodes) {
      const read = (pin: string) => blueprintStaticInput(context, node, pin);
      if (node.type === 'showCharacter' || node.type === 'hideCharacter') record(read('characterId'), read('instanceId'), speakerId);
      else if (node.type === 'effect') {
        const effectId = read('effectId');
        if (typeof effectId === 'string') visitAction({ kind: 'effect', effectId }, speakerId, next);
      } else if (node.type === 'savedAction') {
        const action = savedAction(node);
        if (action && (!recursive || action.kind !== 'blueprint')) visitAction(action, speakerId, next);
      } else if (node.type === 'sceneAction') {
        const command = read('command'), action = typeof command === 'string' ? commandAction(command) : undefined;
        if (action && (!recursive || action.kind !== 'blueprint')) visitAction(action, speakerId, next);
      } else if (!recursive && ['callFunction', 'callMacro', 'startTask', 'debounce'].includes(node.type)) {
        const child = byGraph.get(String(node.properties.graphId ?? ''));
        if (!child) continue;
        const arguments_ = new Map<string, StaticBlueprintValue>();
        child.exposedInputs.forEach((pin, index) => {
          const value = read('arg_' + pin.id);
          arguments_.set(pin.id, value === undefined ? read('arg_' + index) ?? pin.defaultValue : value);
        });
        visitGraph(child, arguments_, speakerId, next);
      }
    }
  };
  for (const node of project.nodes) if (node.kind === 'passage') for (const line of node.lines) line.actions.forEach(action => visitAction(action, line.speakerId));
  for (const scene of project.scenes) {
    scene.entryActions?.forEach(action => visitAction(action));
    const resolved = effectiveScene(project, scene.id), graph = resolved?.blueprintId && byGraph.get(resolved.blueprintId);
    if (graph) visitGraph(graph, explicitInputs(resolved?.parameters));
  }
  for (const effect of project.effects) visitAction({ kind: 'effect', effectId: effect.id });
  for (const character of project.characters) for (const feature of effectiveCharacter(project, character.id)?.features ?? []) visitAction({ kind: 'characterFeature', characterId: character.id, featureId: feature.id });
  for (const step of [...(project.gameFlow?.beforeTitle.steps ?? []), ...(project.gameFlow?.beforeNewGame ?? [])]) if (step.kind === 'blueprint') {
    const graph = byGraph.get(step.graphId);
    if (graph) visitGraph(graph, explicitInputs(step.inputs));
  }
  // Unused reusable graphs may already name future actors. Reserve those too.
  for (const graph of graphs) visitGraph(graph);
  return [...references].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, value]) => value);
}

export function actorInstanceIds(project: Project, characterId?: string): string[] {
  const ids = new Set(actorInstanceReferences(project).filter(actor => !characterId || !actor.characterId || actor.characterId === characterId).map(actor => actor.instanceId ?? '1'));
  return [...ids].sort((a, b) => {
    const first = actorInstanceNumber(a), second = actorInstanceNumber(b);
    if (first !== undefined || second !== undefined) return first === undefined ? 1 : second === undefined ? -1 : first - second;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

/** Allocate above fixed references, not above current visibility or layer order. */
export function nextActorInstanceId(project: Project, characterId: string, visibleActors: Iterable<ActorReference> = []): string | undefined {
  let highest = 0;
  for (const id of actorInstanceIds(project, characterId)) highest = Math.max(highest, actorInstanceNumber(id) ?? 0);
  for (const actor of visibleActors) if (actor.characterId === characterId) highest = Math.max(highest, actorInstanceNumber(actor.instanceId) ?? 0);
  if (highest === maxActorInstanceNumber) throw new Error('这个角色已使用最大编号，请选择已有角色编号。');
  return highest === 0 ? undefined : String(highest + 1);
}
