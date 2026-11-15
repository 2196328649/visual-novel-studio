import type { BlueprintGraph, BlueprintNode, Project } from './model';
import { projectGraphs } from './project-resources';
import { blueprintExecutionOutputs } from './blueprint-execution-ports';
import { selectBlueprintChoice } from './blueprint-choice';
import { blueprintStaticInput, blueprintStaticOutput, unknownBlueprintValue as unknown, type StaticBlueprintValue, type StaticValueContext } from './blueprint-static-values';

export interface BlueprintClosureProblem { graphId: string; nodeId?: string; kind: 'missingModule' | 'missingEntry' | 'recursion' | 'limit' }
/** Restricted-operation audits use actual execution ports and lazy data reads.
 * Root module inputs stay unknown; only explicit inner arguments can prune paths.
 * This is not a state simulator and does not infer a variable's current value. */
export function visitBlueprintOperationClosure(project: Project, rootGraph: BlueprintGraph, rootNode: BlueprintNode | undefined, visit: (graph: BlueprintGraph, node: BlueprintNode, executing: boolean) => void, options: {
  followTasks?: boolean; onGraph?: (graph: BlueprintGraph) => void;
} = {}): BlueprintClosureProblem[] {
  const graphs = new Map(projectGraphs(project).map(graph => [graph.id, graph]));
  const problems: BlueprintClosureProblem[] = [], seen = new Set<string>(), contexts = new Set<string>();
  const enter = (graph: BlueprintGraph, root: BlueprintNode | undefined, inputs: Map<string, StaticBlueprintValue>, stack: string[]) => {
    if (stack.includes(graph.id)) { problems.push({ graphId: graph.id, nodeId: root?.id, kind: 'recursion' }); return; }
    if (!root) { problems.push({ graphId: graph.id, kind: 'missingEntry' }); return; }
    const key = JSON.stringify([graph.id, root.id, [...inputs].map(([id, value]) => [id, value === unknown ? ['unknown'] : value === undefined ? ['absent'] : value])]);
    if (contexts.has(key)) return;
    if (contexts.size >= 512) { problems.push({ graphId: graph.id, nodeId: root.id, kind: 'limit' }); return; }
    contexts.add(key); options.onGraph?.(graph);
    const nodes = new Map(graph.nodes.map(node => [node.id, node]));
    const reportRead = (node: BlueprintNode) => {
      const readKey = key + ':data:' + node.id;
      if (seen.has(readKey)) return;
      seen.add(readKey); visit(graph, node, false);
      if (node.type === 'getVariable' && node.properties.scope === 'page') blueprintStaticInput(values, node, 'pageId');
    };
    const values: StaticValueContext = { project, graph, inputs, results: new Map(), onRead: reportRead, uiValue: () => unknown };
    const read = (node: BlueprintNode, pin: string) => blueprintStaticInput(values, node, pin);
    const fallingThrough = new Map<string, boolean>(), active = new Set<string>();
    const walk = (node: BlueprintNode, entry = 'exec_in'): boolean => {
      const execKey = key + ':exec:' + node.id + ':' + entry;
      if (fallingThrough.has(execKey)) return fallingThrough.get(execKey)!;
      // A controller feedback edge can revisit this operation. Do not infer
      // termination from a cycle; its validity is audited separately.
      if (active.has(execKey)) return true;
      active.add(execKey); visit(graph, node, true);
      const done = (fallsThrough: boolean) => { active.delete(execKey); fallingThrough.set(execKey, fallsThrough); return fallsThrough; };
      if (node.pins.every(pin => pin.dataType !== 'exec')) { for (const pin of node.pins.filter(pin => pin.direction === 'output')) blueprintStaticOutput(values, node, pin.id); return done(true); }
      for (const pin of node.pins.filter(pin => pin.direction === 'input' && pin.dataType !== 'exec')) read(node, pin.id);
      if (['callFunction', 'callMacro', ...(options.followTasks ? ['startTask', 'debounce'] : [])].includes(node.type)) {
        const id = String(node.properties.graphId ?? ''), target = graphs.get(id);
        if (!target) problems.push({ graphId: graph.id, nodeId: node.id, kind: 'missingModule' });
        else {
          const arguments_ = new Map(target.exposedInputs.map((pin, index) => {
            let value = read(node, 'arg_' + pin.id); if (value === undefined) value = read(node, 'arg_' + index);
            return [pin.id, value === undefined ? pin.defaultValue : value] as const;
          }));
          enter(target, target.nodes.find(node => node.type === 'event'), arguments_, [...stack, graph.id]);
        }
      }
      if (['return', 'finishMinigame', 'switchScene'].includes(node.type)) return done(false);
      const follow = (pin: string) => {
        const link = graph.links.find(link => link.fromNodeId === node.id && link.fromPinId === pin);
        const next = link && nodes.get(link.toNodeId);
        return next ? walk(next, link!.toPinId) : true;
      };
      let ports = blueprintExecutionOutputs(node, entry);
      if (node.type === 'sequence') {
        for (const pin of ports) if (!follow(pin)) return done(false);
        return done(true);
      }
      if (node.type === 'branch') { const condition = read(node, 'condition'); if (typeof condition === 'boolean') ports = [condition ? 'true' : 'false']; }
      else if (node.type === 'switchValue') {
        const keyValue = read(node, 'key');
        if (keyValue !== unknown) { const selected = selectBlueprintChoice(node, keyValue); if (selected.ok) ports = [selected.pinId]; }
      } else if (node.type === 'forLoop') {
        const first = read(node, 'first_index'), last = read(node, 'last_index');
        const known = typeof first === 'number' && typeof last === 'number' && Number.isInteger(first) && Number.isInteger(last);
        if (known && last < first) return done(follow('completed'));
        const bodyReturns = !follow('loop_body');
        if (known && bodyReturns) return done(false);
        return done(follow('completed'));
      }
      // Visit every possible port, including alternatives after a return. Only
      // the enclosing sequence may stop when all alternatives return.
      const outcomes = ports.map(follow);
      return done(!outcomes.length || outcomes.some(Boolean));
    };
    walk(root);
  };
  enter(rootGraph, rootNode, new Map(rootGraph.exposedInputs.map(pin => [pin.id, unknown])), []);
  return problems;
}
