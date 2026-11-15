import { blueprintNumericCatalog, isBlueprintNumericType } from './blueprint-numeric';
import { isBlueprintFlowControl } from './blueprint-flow-control';
import { blueprintStateScope } from './blueprint-state';
import { cloneData } from './project-mutation';
import { blueprintGraphSchema, makeId, maxBlueprintInputs, maxBlueprintOutputs, type BlueprintGraph, type BlueprintLink, type BlueprintNode, type BlueprintPin, type Project, type VariableValue } from './model';
import { blueprintInputValue, blueprintNodeDefaults, blueprintOutputLabel, blueprintPinsCompatible, callablePins, createBlueprintGraph, defaultBlueprintValue, synchronizeBlueprintNodeValuePins } from './blueprint';
import { blueprintNameError } from './blueprint-names';
import { assignBlueprintGroup, blueprintGroup } from './blueprint-authoring';
import { blueprintStaticOutput, unknownBlueprintValue, type StaticValueContext } from './blueprint-static-values';
import { validateBlueprints } from './blueprint-validation';
import { encapsulationEvents as events, encapsulationResultNodes as produced, encapsulationOutputUseError } from './blueprint-encapsulation-dataflow';
import { isTimelineResource, projectGraphs, setProjectGraphs, withProjectGraphs } from './project-resources';

export interface EncapsulationPort {
  key: string;
  name: string;
  dataType: BlueprintPin['dataType'];
  defaultValue?: VariableValue;
  links: BlueprintLink[];
}
export type BlueprintEncapsulation = { ok: false; message: string; nodeId?: string } | {
  ok: true;
  graph: BlueprintGraph;
  selectedIds: string[];
  entryNodeId: string;
  entries: BlueprintLink[];
  exits: BlueprintLink[];
  inputs: EncapsulationPort[];
  outputs: EncapsulationPort[];
};
const pure = new Set([...Object.keys(blueprintNumericCatalog), 'math', 'compare', 'select', 'selectByKey', 'not', 'and', 'or', 'xor', 'formatText']);
const intersection = (a: Set<string>, b: Set<string>) => new Set([...a].filter(id => b.has(id)));
interface Outcome { fall?: Set<string>; exit?: Set<string> }
function merge(a: Outcome, b: Outcome): Outcome {
  const result: Outcome = {};
  for (const key of ['fall', 'exit'] as const) result[key] = a[key] && b[key] ? intersection(a[key]!, b[key]!) : a[key] ?? b[key];
  return result;
}

/** Read-only SESE-region analysis. Reject ambiguous control/value boundaries instead of changing their meaning. */
export function inspectBlueprintEncapsulation(project: Project, graphId: string, selection: readonly string[]): BlueprintEncapsulation {
  const graph = projectGraphs(project).find(g => g.id === graphId);
  const fail = (message: string, nodeId?: string): BlueprintEncapsulation => ({ ok: false, message, nodeId });
  if (!graph) return fail('原蓝图已不存在，请重新选择。');
  if (isTimelineResource(graph) || graph.visualComposition) return fail('时间轴或组合请使用原有的预设/组合封装入口，不能按普通执行片段封装。');
  const selected = new Set(selection), nodes = new Map(graph.nodes.map(n => [n.id, n]));
  if (!selected.size) return fail('先选择需要封装的执行节点及其数据节点。');
  if ([...selected].some(id => !nodes.has(id))) return fail('部分所选节点已变化或删除，请重新选择。');
  const picked = graph.nodes.filter(n => selected.has(n.id));
  const event = picked.find(n => events.has(n.type));
  if (event) return fail('事件入口属于原图或页面。请保留入口，只选择它后面的执行片段。', event.id);
  const control = picked.find(node => isBlueprintFlowControl(node.type) || ['throttle', 'startTask', 'debounce'].includes(node.type));
  if (control) return fail('状态型节点依赖本次调用或页面实例的原有身份，请留在封装边界之外；可以单独封装它后面的执行片段。', control.id);
  const scoped = picked.find(n => ['getInput', 'setOutput', 'return', 'switchScene', 'finishMinigame'].includes(n.type) || ['getVariable', 'setVariable'].includes(n.type) && blueprintStateScope(project, n) === 'call');
  if (scoped) return fail('“' + scoped.name + '”依赖原图接口或直接结束当前流程，请留在封装边界之外。', scoped.id);
  const executable = (n: BlueprintNode) => n.pins.some(p => p.direction === 'input' && p.dataType === 'exec');
  if (!picked.some(executable)) return fail('只含数据节点的选择不能变成执行型用户节点，请一并选择使用这些值的执行节点。');
  for (const link of graph.links) {
    const from = nodes.get(link.fromNodeId)?.pins.find(p => p.id === link.fromPinId), to = nodes.get(link.toNodeId)?.pins.find(p => p.id === link.toPinId);
    if (!from || !to || !blueprintPinsCompatible(from, to)) return fail('原图存在失效或类型不匹配的连线，请先修复或断开。');
  }
  const isExec = (link: BlueprintLink) => nodes.get(link.fromNodeId)?.pins.find(p => p.id === link.fromPinId)?.dataType === 'exec';
  const entering = graph.links.filter(l => !selected.has(l.fromNodeId) && selected.has(l.toNodeId));
  const leaving = graph.links.filter(l => selected.has(l.fromNodeId) && !selected.has(l.toNodeId));
  const entries = entering.filter(isExec), exits = leaving.filter(isExec);
  if (!entries.length || new Set(entries.map(l => l.toNodeId + ':' + l.toPinId)).size !== 1) return fail('请选择只有一个执行入口的连续片段；多个来源可以汇入同一个入口。');
  if (new Set(exits.map(l => l.toNodeId + ':' + l.toPinId)).size > 1) return fail('片段有多个不同的后续目标。请把分支汇合部分一并选择，再封装为一个继续出口。');
  const entryNodeId = entries[0].toNodeId;
  const next = new Map<string, BlueprintLink>();
  for (const link of graph.links.filter(isExec)) {
    const key = link.fromNodeId + ':' + link.fromPinId;
    if (next.has(key)) return fail('同一个执行出口有多条连线，请先修复。', link.fromNodeId);
    next.set(key, link);
  }
  const before = new Map<string, Set<string>>(), reached = new Set<string>();
  let visits = 0;
  const follow = (node: BlueprintNode, pin: string, available: Set<string>, stack: Set<string>): Outcome => {
    const link = next.get(node.id + ':' + pin);
    if (!link) return { fall: available };
    return selected.has(link.toNodeId) ? walk(link.toNodeId, available, stack) : { exit: available };
  };
  const walk = (id: string, available: Set<string>, stack: Set<string>): Outcome => {
    if (stack.has(id) || ++visits > 4096) throw new Error('执行边界存在循环或过于复杂，请使用计数循环或分批封装。');
    const node = nodes.get(id)!;
    reached.add(id); before.set(id, before.has(id) ? intersection(before.get(id)!, available) : new Set(available));
    const active = new Set(stack).add(id), after = new Set(available).add(id);
    if (node.type === 'switchValue') return node.pins.filter(pin => pin.direction === 'output' && pin.dataType === 'exec').map(pin => follow(node, pin.id, after, active)).reduce<Outcome>(merge, {});
    if (node.type === 'branch' || node.type === 'confirmMessage') {
      const pins = node.type === 'branch' ? ['true', 'false'] : ['yes', 'no'];
      return merge(follow(node, pins[0], after, active), follow(node, pins[1], after, active));
    }
    if (node.type === 'forLoop') {
      const body = follow(node, 'loop_body', after, active);
      if (body.exit) throw new Error('循环体不能越过封装边界；请把每次执行的完整部分一并选择。');
      // The body can run zero times; none of its outputs is definitely produced.
      return follow(node, 'completed', after, active);
    }
    if (node.type === 'sequence') {
      const pins = node.pins.filter(p => p.direction === 'output' && p.dataType === 'exec');
      let state: Outcome = { fall: after };
      for (const [index, pin] of pins.entries()) {
        if (!state.fall) break;
        const part = follow(node, pin.id, state.fall, active);
        if (part.exit && pins.slice(index + 1).some(p => next.has(node.id + ':' + p.id))) throw new Error('“依次执行”的中途不能越过边界后再回到所选片段，请扩大选择。');
        state = merge({ exit: state.exit }, part);
      }
      return state;
    }
    const pins = node.pins.filter(p => p.direction === 'output' && p.dataType === 'exec');
    if (pins.length > 1) throw new Error('此节点的执行出口暂不能安全封装：' + node.name);
    return pins.length ? follow(node, pins[0].id, after, active) : { fall: after };
  };
  let outcome: Outcome;
  try { outcome = walk(entryNodeId, new Set(), new Set()); } catch (error) { return fail((error as Error).message); }
  if (picked.some(n => executable(n) && !reached.has(n.id))) return fail('选择中包含不属于同一执行片段的节点，请分开封装。');
  if (outcome.exit && outcome.fall) return fail('有的路径会继续到边界外，有的会直接结束。请补齐汇合路径，避免封装后误执行后续节点。');
  const terminal = outcome.exit ?? outcome.fall ?? new Set<string>();
  const dataLinks = graph.links.filter(l => !isExec(l));
  const incomingData = new Map(dataLinks.map(l => [l.toNodeId + ':' + l.toPinId, l]));
  if (incomingData.size !== dataLinks.length) return fail('同一个数据输入有多条连线，请先修复，避免封装时更换其来源。');
  const checkedData = new Set<string>(), activeData = new Set<string>();
  const acyclicData = (id: string): boolean => {
    if (activeData.has(id)) return false; if (checkedData.has(id)) return true; activeData.add(id);
    for (const pin of nodes.get(id)!.pins.filter(p => p.direction === 'input' && p.dataType !== 'exec')) {
      const link = incomingData.get(id + ':' + pin.id); if (link && !acyclicData(link.fromNodeId)) return false;
    }
    activeData.delete(id); checkedData.add(id); return true;
  };
  if (graph.nodes.some(node => !acyclicData(node.id))) return fail('数据连线存在循环，请先修复，不能封装为互相依赖的输入和输出。');
  const dependencies = (node: BlueprintNode, pinId: string, all = new Set<string>()): Set<string> => {
    if (all.has(node.id)) return all;
    all.add(node.id);
    if (produced.has(node.type)) return all;
    for (const pin of node.pins.filter(p => p.direction === 'input' && p.dataType !== 'exec')) {
      const link = incomingData.get(node.id + ':' + pin.id);
      if (link) dependencies(nodes.get(link.fromNodeId)!, link.fromPinId, all);
    }
    return all;
  };
  let staticReads = 0;
  const staticContext: StaticValueContext = { project, graph, inputs: new Map<string, VariableValue | undefined>(), results: new Map<string, VariableValue | undefined>(), onRead: () => { if (++staticReads > 4096) throw new Error('静态求值超过分析上限。'); }, uiValue: () => unknownBlueprintValue };
  const inputType = (node: BlueprintNode, pin: string): string => {
    const link = incomingData.get(node.id + ':' + pin);
    if (!link) return typeof blueprintInputValue(node, pin);
    const source = nodes.get(link.fromNodeId)!;
    return source.type === 'literal' ? typeof source.properties.value : source.pins.find(p => p.id === link.fromPinId)!.dataType;
  };
  const stableValues = new Map<string, boolean>();
  const stable = (node: BlueprintNode, pinId: string, seen = new Set<string>()): boolean => {
    if (seen.has(node.id)) return false;
    const key = node.id + ':' + pinId; if (stableValues.has(key)) return stableValues.get(key)!;
    if (['literal', 'getInput', 'event', 'eventValueChanged', 'eventTextCommitted', 'eventImage', 'eventVideo', 'eventSpine'].includes(node.type) || produced.has(node.type)) return true;
    if (!pure.has(node.type)) return false;
    const active = new Set(seen).add(node.id);
    // Untyped inputs may legitimately contain text, numbers, or switches. Moving a guarded
    // numeric/boolean operation to the call boundary must not make it fail on a skipped path.
    if (isBlueprintNumericType(node.type) || node.type === 'selectByKey') {
      try { if (blueprintStaticOutput(staticContext, node, pinId) === unknownBlueprintValue) return false; }
      catch { return false; }
    }
    if (node.type === 'math' && ['a', 'b'].some(pin => inputType(node, pin) !== 'number')) return false;
    if (['not', 'and', 'or', 'xor'].includes(node.type) && (node.type === 'not' ? ['a'] : ['a', 'b']).some(pin => inputType(node, pin) !== 'boolean')) return false;
    if (node.type === 'compare' && !['eq', 'ne'].includes(String(node.properties.operator ?? 'eq'))) {
      const a = inputType(node, 'a'), b = inputType(node, 'b'); if (a !== b || !['number', 'string'].includes(a)) return false;
    }
    if (node.type === 'math' && ['divide', 'div', '/', 'modulo', 'mod', '%'].includes(String(node.properties.operation ?? node.properties.operator))) {
      const denominator = incomingData.get(node.id + ':b');
      try {
        const divisor = denominator ? blueprintStaticOutput(staticContext, nodes.get(denominator.fromNodeId)!, denominator.fromPinId) : blueprintInputValue(node, 'b');
        if (typeof divisor !== 'number' || !Number.isFinite(divisor) || !divisor) return false;
      } catch { return false; }
    }
    const result = node.pins.filter(p => p.direction === 'input' && p.dataType !== 'exec').every(pin => {
      const link = incomingData.get(node.id + ':' + pin.id);
      return !link || stable(nodes.get(link.fromNodeId)!, link.fromPinId, active);
    });
    stableValues.set(key, result); return result;
  };
  for (const link of entering.filter(l => !isExec(l))) {
    const source = nodes.get(link.fromNodeId)!;
    if ([...dependencies(source, link.fromPinId)].some(id => selected.has(id))) return fail('数据先流出再流入所选片段，会形成调用的数据循环。请把相关数据节点一并选择。', source.id);
    if (!stable(source, link.fromPinId)) return fail('输入“' + blueprintOutputLabel(project, graph, source, link.fromPinId) + '”会实时读取状态，或重新求值可能触发无效计算，不能提前到调用入口。请把该值的读取/计算节点一起选中。', source.id);
  }
  for (const node of picked.filter(executable)) for (const pin of node.pins.filter(p => p.direction === 'input' && p.dataType !== 'exec')) {
    const link = incomingData.get(node.id + ':' + pin.id); if (!link) continue;
    const missing = [...dependencies(nodes.get(link.fromNodeId)!, link.fromPinId)].find(id => selected.has(id) && produced.has(nodes.get(id)!.type) && !before.get(node.id)?.has(id));
    if (missing) return fail('片段在某条路径中读取了尚未执行的节点结果，请先补齐执行顺序。', node.id);
  }
  for (const link of leaving.filter(l => !isExec(l))) {
    const source = nodes.get(link.fromNodeId)!;
    if (!stable(source, link.fromPinId)) return fail('输出“' + blueprintOutputLabel(project, graph, source, link.fromPinId) + '”依赖实时状态或可能触发无效计算，不能提前固定为返回值。请把使用它的节点一并选择。', source.id);
    if ([...dependencies(source, link.fromPinId)].some(id => selected.has(id) && produced.has(nodes.get(id)!.type) && !terminal.has(id))) return fail('输出结果并非每条完成路径都会产生，请先在分支内明确赋值或扩大选择。', source.id);
  }
  const ports = (links: BlueprintLink[], direction: 'input' | 'output'): EncapsulationPort[] => {
    const groups = new Map<string, EncapsulationPort>(), names = new Set<string>();
    for (const link of links) {
      const key = link.fromNodeId + ':' + link.fromPinId, existing = groups.get(key);
      if (existing) { existing.links.push(link); continue; }
      const source = nodes.get(link.fromNodeId)!, pin = source.pins.find(p => p.id === link.fromPinId)!;
      const base = (source.type === 'getInput' ? graph.exposedInputs.find(p => p.id === source.properties.inputId)?.name : pin.name) || (direction === 'input' ? '输入' : '结果');
      let name = base.slice(0, 110), suffix = 2; while (names.has(name)) name = base.slice(0, 110) + ' ' + suffix++;
      names.add(name);
      const defaultValue = source.type === 'literal' ? source.properties.value : source.type === 'getInput' ? graph.exposedInputs.find(p => p.id === source.properties.inputId)?.defaultValue : pin.defaultValue;
      groups.set(key, { key, name, dataType: pin.dataType, defaultValue, links: [link] });
    }
    return [...groups.values()];
  };
  const inputs = ports(entering.filter(l => !isExec(l)), 'input'), outputs = ports(leaving.filter(l => !isExec(l)), 'output');
  const outputUseError = encapsulationOutputUseError(graph, selected, entryNodeId, exits[0], outputs);
  if (outputUseError) return fail(outputUseError.message, outputUseError.nodeId);
  if (inputs.length > maxBlueprintInputs || outputs.length > maxBlueprintOutputs) return fail('跨边界参数过多，请分批封装。');
  if (picked.length + inputs.length + outputs.length + 3 > 512) return fail('加上入口和参数节点后超过 512 个节点，请缩小选择。');
  return { ok: true, graph, selectedIds: [...selected], entryNodeId, entries, exits, inputs, outputs };
}

/** Apply as one history edit. Build and validate detached graphs before touching the draft. */
export function encapsulateBlueprintSelection(project: Project, graphId: string, selection: readonly string[], name: string) {
  const plan = inspectBlueprintEncapsulation(project, graphId, selection);
  if (!plan.ok) throw new Error(plan.message);
  const module = createBlueprintGraph('macro', name.trim());
  const nameError = blueprintNameError(project, module.id, module.name);
  if (nameError) throw new Error(nameError);
  const picked = new Set(plan.selectedIds), moved = cloneData(plan.graph.nodes.filter(n => picked.has(n.id)));
  const minX = Math.min(...moved.map(n => n.x)), minY = Math.min(...moved.map(n => n.y));
  for (const node of moved) { node.x = node.x - minX + 680; node.y = node.y - minY + 80; }
  const event = module.nodes[0], sequence = blueprintNodeDefaults('sequence');
  event.x = 20; event.y = 80; sequence.x = 350; sequence.y = 80;
  module.nodes.push(sequence, ...moved);
  module.links = cloneData(plan.graph.links.filter(l => picked.has(l.fromNodeId) && picked.has(l.toNodeId)));
  const wire = (graph: BlueprintGraph, from: string, fromPin: string, to: string, toPin: string) => graph.links.push({ id: makeId('bplink'), fromNodeId: from, fromPinId: fromPin, toNodeId: to, toPinId: toPin });
  wire(module, event.id, 'exec', sequence.id, 'exec_in'); wire(module, sequence.id, 'then_0', plan.entryNodeId, plan.entries[0].toPinId);
  const caller = blueprintNodeDefaults('callMacro'); caller.name = module.name; caller.properties.graphId = module.id; caller.x = minX; caller.y = minY;
  const source: BlueprintGraph = { ...plan.graph, nodes: [...plan.graph.nodes.filter(n => !picked.has(n.id)), caller], links: plan.graph.links.filter(l => !picked.has(l.fromNodeId) && !picked.has(l.toNodeId)) };
  source.links.push(...plan.entries.map(l => ({ ...l, toNodeId: caller.id, toPinId: 'exec_in' })));
  if (plan.exits[0]) wire(source, caller.id, 'exec_out', plan.exits[0].toNodeId, plan.exits[0].toPinId);
  for (const [index, port] of plan.inputs.entries()) {
    const pin: BlueprintPin = { id: makeId('bpin'), name: port.name, direction: 'input', dataType: port.dataType, defaultValue: port.defaultValue, required: port.defaultValue === undefined };
    module.exposedInputs.push(pin);
    const reader = blueprintNodeDefaults('getInput'); reader.name = '输入 · ' + pin.name; reader.properties.inputId = pin.id; reader.x = 350; reader.y = 280 + index * 56;
    synchronizeBlueprintNodeValuePins(project, module, reader); module.nodes.push(reader);
    const old = port.links[0]; source.links.push({ ...old, toNodeId: caller.id, toPinId: 'arg_' + pin.id });
    for (const link of port.links) wire(module, reader.id, 'value', link.toNodeId, link.toPinId);
  }
  const captureX = Math.max(...moved.map(n => n.x)) + 370;
  let previous = sequence, previousPin = 'then_1';
  for (const [index, port] of plan.outputs.entries()) {
    const pin: BlueprintPin = { id: makeId('bpout'), name: port.name, direction: 'output', dataType: port.dataType, defaultValue: port.defaultValue ?? defaultBlueprintValue(port.dataType), required: false };
    module.exposedOutputs.push(pin);
    const capture = blueprintNodeDefaults('setOutput'); capture.name = '输出 · ' + pin.name; capture.properties.outputId = pin.id; capture.x = captureX + index * 350; capture.y = 80;
    synchronizeBlueprintNodeValuePins(project, module, capture); module.nodes.push(capture);
    wire(module, previous.id, previousPin, capture.id, 'exec_in'); previous = capture; previousPin = 'exec_out';
    const old = port.links[0]; wire(module, old.fromNodeId, old.fromPinId, capture.id, 'value');
    source.links.push(...port.links.map(l => ({ ...l, fromNodeId: caller.id, fromPinId: 'out_' + pin.id })));
  }
  const end = blueprintNodeDefaults('return'); end.x = captureX + plan.outputs.length * 350; end.y = 80; module.nodes.push(end); wire(module, previous.id, previousPin, end.id, 'exec_in');
  caller.pins = callablePins(module);
  blueprintGraphSchema.parse(module); blueprintGraphSchema.parse(source);
  const graphs = [...projectGraphs(project).map(g => g.id === graphId ? source : g), module];
  const candidate = withProjectGraphs(project, graphs);
  candidate.contentBrowser = cloneData(project.contentBrowser);
  assignBlueprintGroup(candidate, module.id, blueprintGroup(project, graphId));
  const existing = new Set(validateBlueprints(project).filter(d => d.severity === 'error').map(d => d.nodeId + ':' + d.message));
  const failure = validateBlueprints(candidate).find(d => d.severity === 'error' && !existing.has(d.nodeId + ':' + d.message));
  if (failure) throw new Error('不能安全封装：' + failure.message);
  setProjectGraphs(project, graphs); project.contentBrowser = candidate.contentBrowser;
  return { module, caller, source, inputs: plan.inputs.length, outputs: plan.outputs.length };
}
