import { blueprintInputValue } from './blueprint';
import type { BlueprintGraph, BlueprintLink, BlueprintNode } from './model';

export const encapsulationEvents = new Set<BlueprintNode['type']>(['event', 'eventClick', 'eventButton', 'eventValueChanged', 'eventTextCommitted', 'eventImage', 'eventVideo', 'eventSpine', 'eventKey', 'eventTimer', 'eventPage']);
export const encapsulationResultNodes = new Set<BlueprintNode['type']>(['callFunction', 'callMacro', 'showUiPage', 'forLoop', 'startTask', 'debounce', 'waitTask', 'cancelTask', 'focusUiComponent']);
const intersect = (a: Set<string>, b: Set<string>) => new Set([...a].filter(key => b.has(key)));
const join = (a: Set<string> | undefined, b: Set<string> | undefined) => a && b ? intersect(a, b) : a ?? b;
class OutputUseError extends Error { constructor(message: string, readonly nodeId?: string) { super(message); } }

/** Prove reads of each extracted result occur after the call and before a live source is overwritten.
 * Exec links alone are not a CFG: sequence branches return, and counted loops can run zero times.
 * Interpret those structured continuations, with a descending must-availability fixed point for loops.
 */
export function encapsulationOutputUseError(graph: BlueprintGraph, selected: Set<string>, entryNodeId: string, exit: BlueprintLink | undefined,
  outputs: readonly { key: string; links: readonly BlueprintLink[] }[]): { message: string; nodeId?: string } | undefined {
  if (!outputs.length) return;
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const exec = new Map<string, BlueprintLink>(), data = new Map<string, BlueprintLink>();
  for (const link of graph.links) {
    const isExec = nodes.get(link.fromNodeId)!.pins.find(pin => pin.id === link.fromPinId)!.dataType === 'exec';
    (isExec ? exec : data).set(isExec ? link.fromNodeId + ':' + link.fromPinId : link.toNodeId + ':' + link.toPinId, link);
  }
  const keys = new Set(outputs.map(output => output.key));
  const inputs = (node: BlueprintNode) => node.pins.filter(pin => pin.direction === 'input' && pin.dataType !== 'exec')
    .flatMap(pin => { const link = data.get(node.id + ':' + pin.id); return link ? [link] : []; });
  const readCache = new Map<string, Set<string>>();
  const boundaryReads = (nodeId: string, pinId: string, seen = new Set<string>()): Set<string> => {
    const key = nodeId + ':' + pinId;
    if (keys.has(key)) return new Set([key]);
    if (readCache.has(key)) return readCache.get(key)!;
    if (seen.has(key)) return new Set();
    const node = nodes.get(nodeId)!;
    // A result register is read now, but its inputs were evaluated when that node executed.
    if (encapsulationResultNodes.has(node.type)) return new Set();
    const active = new Set(seen).add(key), result = new Set<string>();
    for (const link of inputs(node)) for (const needed of boundaryReads(link.fromNodeId, link.fromPinId, active)) result.add(needed);
    readCache.set(key, result); return result;
  };
  const consumers = new Map<string, Set<string>>();
  for (const node of graph.nodes.filter(node => !selected.has(node.id) && node.pins.some(pin => pin.direction === 'input' && pin.dataType === 'exec'))) {
    const reads = new Set(inputs(node).flatMap(link => [...boundaryReads(link.fromNodeId, link.fromPinId)]));
    if (reads.size) consumers.set(node.id, reads);
  }
  // Only unexecuted data expressions are live. A selected call's stored result does not become
  // stale merely because the original arguments to that call are subsequently changed.
  const overwritten = new Map<string, Set<string>>();
  const sourceCache = new Map<string, Set<string>>();
  const liveSources = (nodeId: string, seen = new Set<string>()): Set<string> => {
    if (seen.has(nodeId)) return new Set();
    if (sourceCache.has(nodeId)) return sourceCache.get(nodeId)!;
    const node = nodes.get(nodeId)!;
    if (encapsulationResultNodes.has(node.type)) return new Set(selected.has(nodeId) ? [] : [nodeId]);
    const active = new Set(seen).add(nodeId), result = new Set<string>();
    for (const link of inputs(node)) for (const source of liveSources(link.fromNodeId, active)) result.add(source);
    sourceCache.set(nodeId, result); return result;
  };
  for (const output of outputs) for (const source of liveSources(output.links[0].fromNodeId)) {
    const affected = overwritten.get(source) ?? new Set<string>(); affected.add(output.key); overwritten.set(source, affected);
  }
  const invalidate = (available: Set<string>, nodeId: string) => new Set([...available].filter(key => !overwritten.get(nodeId)?.has(key)));
  const seenConsumers = new Set<string>(); let visits = 0;
  const follow = (node: BlueprintNode, pin: string, available: Set<string>, stack: Set<string>): Set<string> | undefined => {
    const link = exec.get(node.id + ':' + pin); return link ? walk(link.toNodeId, available, stack) : available;
  };
  const walk = (id: string, available: Set<string>, stack: Set<string>): Set<string> | undefined => {
    if (stack.has(id) || ++visits > 4096) throw new OutputUseError('输出的执行路径存在循环或过于复杂，无法证明读取顺序。请分批封装。', id);
    const node = nodes.get(id)!, active = new Set(stack).add(id);
    if (selected.has(id)) {
      if (id !== entryNodeId) throw new OutputUseError('输出使用路径从片段中途进入，请重新选择完整片段。', id);
      const completed = new Set(keys);
      return exit ? walk(exit.toNodeId, completed, active) : completed;
    }
    if (consumers.has(id)) {
      seenConsumers.add(id);
      if ([...consumers.get(id)!].some(key => !available.has(key))) throw new OutputUseError('“' + node.name + '”的输出读取不一定在用户节点调用完成之后，或外部来源已再次执行。请调整执行顺序，或把使用节点一并选择。', id);
    }
    const after = invalidate(available, id);
    if (['return', 'switchScene', 'finishMinigame'].includes(node.type)) return;
    if (node.type === 'switchValue') return node.pins.filter(pin => pin.direction === 'output' && pin.dataType === 'exec').map(pin => follow(node, pin.id, after, active)).reduce<Set<string> | undefined>(join, undefined);
    if (node.type === 'branch' || node.type === 'confirmMessage') {
      const pins = node.type === 'branch' ? ['true', 'false'] : ['yes', 'no'];
      return join(follow(node, pins[0], after, active), follow(node, pins[1], after, active));
    }
    if (node.type === 'sequence') {
      let state: Set<string> | undefined = after;
      for (const pin of node.pins.filter(pin => pin.direction === 'output' && pin.dataType === 'exec')) {
        if (!state) break; state = follow(node, pin.id, state, active);
      }
      return state;
    }
    if (node.type === 'forLoop') {
      const first = data.has(node.id + ':first_index') ? undefined : blueprintInputValue(node, 'first_index');
      const last = data.has(node.id + ':last_index') ? undefined : blueprintInputValue(node, 'last_index');
      const count = typeof first === 'number' && Number.isFinite(first) && typeof last === 'number' && Number.isFinite(last) ? Math.max(0, Math.trunc(last) - Math.trunc(first) + 1) : undefined;
      if (count === 0) return follow(node, 'completed', after, active);
      let entry = after, tail: Set<string> | undefined;
      for (;;) {
        const body = follow(node, 'loop_body', entry, active);
        tail = body && invalidate(body, id); // Incrementing the index also changes live expressions.
        const next = join(after, tail)!;
        if (next.size === entry.size && [...next].every(key => entry.has(key))) break;
        entry = next;
      }
      // A proven positive constant range must execute its body. The last call
      // result survives an index increment; live index expressions still do not.
      const completed = count !== undefined ? tail : join(after, tail);
      return completed && follow(node, 'completed', completed, active);
    }
    const pins = node.pins.filter(pin => pin.direction === 'output' && pin.dataType === 'exec');
    if (pins.length > 1) throw new OutputUseError('暂不能证明此节点之后的输出读取顺序：' + node.name, id);
    return pins.length ? follow(node, pins[0].id, after, active) : after;
  };
  try {
    for (const event of graph.nodes.filter(node => encapsulationEvents.has(node.type))) walk(event.id, new Set(), new Set());
    const missing = [...consumers.keys()].find(id => !seenConsumers.has(id));
    if (missing) throw new OutputUseError('有未接入事件入口的输出使用节点，无法确认它会在用户节点调用之后读取。请连接执行路径，或把使用节点一并选择。', missing);
  } catch (error) {
    if (error instanceof OutputUseError) return { message: error.message, nodeId: error.nodeId };
    throw error;
  }
}
