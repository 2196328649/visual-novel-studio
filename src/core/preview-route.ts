import { effectiveScene, targets, type Condition, type Project, type StoryNode, type VariableValue } from './model';
import { createPreviewActionExpander, previewActionContext } from './preview-actions';

export type PreviewRouteChoices = Record<string, string>;
export interface PreviewRouteDecision { key: string; nodeId: string; name: string; selected: string; options: { id: string; label: string }[] }

export function matches(condition: Condition, values: Record<string, VariableValue>): boolean {
  if (condition.kind === 'not') return !matches(condition.condition, values);
  if (condition.kind === 'all') return condition.conditions.every(item => matches(item, values));
  if (condition.kind === 'any') return condition.conditions.some(item => matches(item, values));
  if (condition.kind !== 'compare') return false;
  const left = values[condition.variableId], right = condition.value;
  return condition.operator === 'eq' ? left === right : condition.operator === 'ne' ? left !== right : condition.operator === 'gt' ? Number(left) > Number(right) : condition.operator === 'gte' ? Number(left) >= Number(right) : condition.operator === 'lt' ? Number(left) < Number(right) : Number(left) <= Number(right);
}

/** Find a valid route to an authoring target, tracking calls and deterministic variables. */
export function previewRoute(project: Project, targetId: string, preferences: PreviewRouteChoices = {}, expandActions = createPreviewActionExpander(project)) {
  type Candidate = { id: string; path: StoryNode[]; stack: string[]; context: ReturnType<typeof previewActionContext>; sceneId?: string; choices: string[]; decisions: PreviewRouteDecision[] };
  const nodes = new Map(project.nodes.map(node => [node.id, node]));
  const pending: Candidate[] = [{ id: project.entryId, path: [], stack: [], context: previewActionContext(project), choices: [], decisions: [] }];
  const visited = new Set<string>();
  for (let cursor = 0; cursor < pending.length && cursor < 4096; cursor++) {
    const current = pending[cursor], node = nodes.get(current.id); if (!node) continue;
    if (node.id === targetId) return { nodes: [...current.path, node], choices: current.choices, decisions: current.decisions, incomplete: current.context.incomplete };
    const signature = JSON.stringify([node.id, current.stack, current.context.variables, [...current.context.actors], current.context.incomplete, current.sceneId, Object.keys(preferences).length ? current.decisions.map(item => item.key) : undefined]);
    if (visited.has(signature)) continue; visited.add(signature);
    const context = { ...current.context, variables: { ...current.context.variables }, actors: new Map(current.context.actors) };
    let sceneId = current.sceneId;
    if (node.kind === 'set' && (!node.when || matches(node.when, context.variables))) {
      const previous = context.variables[node.variableId];
      context.variables[node.variableId] = node.operation === 'add' ? Number(previous) + Number(node.value) : node.value;
    }
    if (node.kind === 'passage') {
      const scene = effectiveScene(project, node.sceneId);
      for (const line of node.lines) {
        context.speakerId = line.speakerId;
        const entry = sceneId !== node.sceneId ? [...(scene?.entryActions ?? []), ...(scene?.blueprintId ? [{ kind: 'blueprint' as const, blueprintId: scene.blueprintId }] : [])] : [];
        sceneId = node.sceneId;
        expandActions([...entry, ...line.actions], context);
        if (!line.silent) for (const [id, actor] of context.actors) if (actor.lifetime === 'line') context.actors.delete(id);
      }
    }
    if (node.kind === 'jump' && node.sceneTransition) sceneId = undefined;
    if (node.kind === 'minigame' && node.template === 'custom') context.incomplete = true;
    const enqueue = (id: string | undefined, stack = current.stack, choice?: string, decision?: PreviewRouteDecision) => { if (id && stack.length <= 32 && pending.length < 4096) pending.push({ id, path: [...current.path, node], stack, context, sceneId, choices: choice ? [...current.choices, choice] : current.choices, decisions: decision ? [...current.decisions, decision] : current.decisions }); };
    const branch = (options: { id: string; label: string; target?: string }[]) => {
      const key = `${node.id}:${current.decisions.filter(item => item.nodeId === node.id).length}`;
      const available = options.filter(option => option.target);
      for (const option of available) if (preferences[key] === undefined || preferences[key] === option.id) {
        enqueue(option.target, current.stack, option.label, { key, nodeId: node.id, name: node.name, selected: option.id, options: available.map(({ id, label }) => ({ id, label })) });
      }
    };
    if (node.kind === 'condition') enqueue(matches(node.condition, context.variables) ? node.yes : node.no);
    else if (node.kind === 'choice') {
      branch(node.choices.filter(choice => !choice.condition || matches(choice.condition, context.variables)).map(choice => ({ id: choice.id, label: choice.text, target: choice.target })));
    }
    else if (node.kind === 'interaction') {
      branch([
        ...node.hotspots.filter(hotspot => (!hotspot.condition || matches(hotspot.condition, context.variables)) && (!hotspot.characterId || [...context.actors.values()].some(actor => actor.characterId === hotspot.characterId))).map(hotspot => ({ id: `hotspot:${hotspot.id}`, label: `${node.name}：${hotspot.name}`, target: hotspot.target })),
        ...(node.timeoutSeconds > 0 ? [{ id: 'timeout', label: `${node.name}：超时`, target: node.timeout }] : []),
        { id: 'cancel', label: `${node.name}：取消`, target: node.cancel },
      ]);
    }
    else if (node.kind === 'call') enqueue(node.target, [...current.stack, node.next ?? '']);
    else if (node.kind === 'return') enqueue(current.stack.at(-1), current.stack.slice(0, -1));
    else if (node.kind === 'minigame') branch(targets(node).map(edge => ({ id: edge.port, label: `${node.name}：${edge.port}`, target: edge.target })));
    else for (const edge of targets(node)) enqueue(edge.target);
  }
  return undefined;
}
