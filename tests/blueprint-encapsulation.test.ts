import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, makeId, projectSchema, type BlueprintGraph, type BlueprintNode, type Project, type VariableValue } from '../src/core/model';
import { blueprintNodeDefaults, blueprintPin, callablePins, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { encapsulateBlueprintSelection, inspectBlueprintEncapsulation } from '../src/core/blueprint-encapsulation';
import { assignBlueprintGroup, blueprintGroup } from '../src/core/blueprint-authoring';
import { compileProject } from '../src/runtime/compiler';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { validateBlueprints } from '../src/core/blueprint-validation';
import { mutateProject } from '../src/core/project-mutation';
import { applyUiDraft } from '../src/core/ui-draft';

function kit() {
  const project = createProject('封装验收');
  project.variables = ['result', 'second', 'sum'].map(id => ({ id, name: id, type: 'number' as const, initial: 0, persistent: false }));
  const graph = createBlueprintGraph('function', '原调用流程'); project.blueprints.push(graph);
  const node = (g: BlueprintGraph, type: BlueprintNode['type'], properties: Record<string, VariableValue> = {}) => {
    const n = blueprintNodeDefaults(type, g.nodes.length); Object.assign(n.properties, properties);
    if (type === 'callFunction' || type === 'callMacro') n.pins = callablePins(project.blueprints.find(x => x.id === properties.graphId));
    g.nodes.push(n); return n;
  };
  const wire = (g: BlueprintGraph, a: BlueprintNode, b: BlueprintNode, from = a.type === 'event' ? 'exec' : 'exec_out', to = 'exec_in') => {
    const error = connectBlueprintPins(g, a.id, from, b.id, to); assert.equal(error, undefined);
  };
  const chain = (g: BlueprintGraph, ...nodes: BlueprintNode[]) => { for (let i = 1; i < nodes.length; i++) wire(g, nodes[i - 1], nodes[i]); };
  const sample = (p: Project, inputs: Record<string, VariableValue> = {}) => {
    const before = structuredClone(p), context = previewActionContext(p);
    const actions = expandPreviewActions(p, [{ kind: 'blueprint', blueprintId: graph.id, inputs }], context);
    assert.equal(context.incomplete, false); assert.deepEqual(p, before);
    return { variables: context.variables, actions };
  };
  return { project, graph, node, wire, chain, sample };
}
function valueFixture() {
  const k = kit(), { project, graph, node, wire, chain } = k;
  const identity = createBlueprintGraph('function', '值传递'); project.blueprints.push(identity);
  identity.exposedInputs.push(blueprintPin('amount', '数值', 'input', 'number', 3));
  identity.exposedOutputs.push(blueprintPin('result', '结果', 'output', 'number', 0));
  const read = node(identity, 'getInput', { inputId: 'amount' }), output = node(identity, 'setOutput', { outputId: 'result' });
  wire(identity, read, output, 'value', 'value'); chain(identity, identity.nodes[0], output);
  graph.exposedInputs.push(blueprintPin('amount', '数值', 'input', 'number', 3));
  const input = node(graph, 'getInput', { inputId: 'amount' });
  const call = node(graph, 'callFunction', { graphId: identity.id }), delay = node(graph, 'delay', { seconds: .2 });
  const math = node(graph, 'math', { operation: 'multiply' }), first = node(graph, 'setVariable', { variableId: 'result' }), second = node(graph, 'setVariable', { variableId: 'second' });
  chain(graph, graph.nodes[0], call, delay, first, second);
  wire(graph, input, call, 'value', 'arg_amount'); wire(graph, input, math, 'value', 'b');
  wire(graph, call, math, 'out_result', 'a'); wire(graph, math, first, 'result', 'value'); wire(graph, math, second, 'result', 'value');
  synchronizeBlueprintSignatures(project);
  return { ...k, identity, input, call, delay, math, first, second, selection: [call.id, delay.id, math.id] };
}

test('encapsulation deduplicates typed boundary inputs, preserves output fanout and is one detached edit', () => {
  const f = valueFixture(), before = structuredClone(f.project);
  const plan = inspectBlueprintEncapsulation(f.project, f.graph.id, f.selection);
  assert.equal(plan.ok, true); if (!plan.ok) return;
  assert.equal(plan.inputs.length, 1); assert.equal(plan.outputs.length, 1);
  assert.equal(plan.inputs[0].dataType, 'number'); assert.equal(plan.inputs[0].defaultValue, 3);
  assert.equal(plan.outputs[0].links.length, 2); assert.deepEqual(f.project, before);
  const original = f.sample(f.project, { amount: 4 });
  const result = encapsulateBlueprintSelection(f.project, f.graph.id, f.selection, '平方用户节点');
  assert.equal(result.module.kind, 'macro'); assert.equal(result.caller.type, 'callMacro');
  assert.equal(result.inputs, 1); assert.equal(result.outputs, 1);
  assert.ok(f.selection.every(id => result.module.nodes.some(n => n.id === id)));
  assert.ok(f.selection.every(id => !result.source.nodes.some(n => n.id === id)));
  assert.deepEqual(f.sample(f.project, { amount: 4 }), original); assert.equal(original.variables.result, 16);
  assert.deepEqual(validateBlueprints(f.project).filter(d => d.severity === 'error'), []);
  assert.deepEqual(compileProject(f.project).diagnostics.filter(d => d.severity === 'error'), []);
  const restored = projectSchema.parse(JSON.parse(JSON.stringify(f.project)));
  assert.deepEqual(f.sample(restored, { amount: 5 }).variables, { result: 25, second: 25, sum: 0 });
  assert.deepEqual(before.blueprints.find(g => g.id === f.identity.id), f.project.blueprints.find(g => g.id === f.identity.id));
});

test('closed branches keep both paths and their common continuation', () => {
  const f = kit(), { project, graph, node, wire, chain } = f;
  graph.exposedInputs.push(blueprintPin('condition', '选择', 'input', 'boolean', true));
  const input = node(graph, 'getInput', { inputId: 'condition' }), branch = node(graph, 'branch');
  const yes = node(graph, 'setVariable', { variableId: 'result', value: 11 }), no = node(graph, 'setVariable', { variableId: 'result', value: 22 });
  const after = node(graph, 'setVariable', { variableId: 'second', value: 1 });
  chain(graph, graph.nodes[0], branch); wire(graph, input, branch, 'value', 'condition');
  wire(graph, branch, yes, 'true'); wire(graph, branch, no, 'false'); wire(graph, yes, after); wire(graph, no, after);
  synchronizeBlueprintSignatures(project);
  const expected = [false, true].map(condition => f.sample(project, { condition }));
  encapsulateBlueprintSelection(project, graph.id, [branch.id, yes.id, no.id], '完整分支');
  assert.deepEqual([false, true].map(condition => f.sample(project, { condition })), expected);
});

test('loop bodies and sequential subflows remain internal and preserve their order', () => {
  const f = kit(), { project, graph, node, wire, chain } = f;
  const sequence = node(graph, 'sequence'), first = node(graph, 'setVariable', { variableId: 'second', value: 8 });
  const loop = node(graph, 'forLoop', { firstIndex: 1, lastIndex: 3 }), read = node(graph, 'getVariable', { variableId: 'sum' });
  const add = node(graph, 'math'), write = node(graph, 'setVariable', { variableId: 'sum' }), after = node(graph, 'setVariable', { variableId: 'result', value: 1 });
  chain(graph, graph.nodes[0], sequence); wire(graph, sequence, first, 'then_0'); wire(graph, sequence, loop, 'then_1');
  wire(graph, loop, write, 'loop_body'); wire(graph, read, add, 'value', 'a'); wire(graph, loop, add, 'index', 'b'); wire(graph, add, write, 'result', 'value'); wire(graph, loop, after, 'completed');
  synchronizeBlueprintSignatures(project); const expected = f.sample(project);
  encapsulateBlueprintSelection(project, graph.id, [sequence, first, loop, read, add, write].map(n => n.id), '计数模块');
  assert.deepEqual(f.sample(project), expected); assert.equal(expected.variables.sum, 6); assert.equal(expected.variables.second, 8);
  assert.deepEqual(compileProject(project).diagnostics.filter(d => d.severity === 'error'), []);
});

test('a tail fragment without an outgoing exec wire still returns to its original caller', () => {
  const f = kit(); const n = f.node(f.graph, 'setVariable', { variableId: 'result', value: 7 }); f.chain(f.graph, f.graph.nodes[0], n);
  synchronizeBlueprintSignatures(f.project); const before = f.sample(f.project);
  encapsulateBlueprintSelection(f.project, f.graph.id, [n.id], '末尾模块'); assert.deepEqual(f.sample(f.project), before);
});

function reject(f: ReturnType<typeof kit>, selected: string[], pattern: RegExp) {
  const before = structuredClone(f.project), plan = inspectBlueprintEncapsulation(f.project, f.graph.id, selected);
  assert.equal(plan.ok, false); if (!plan.ok) assert.match(plan.message, pattern);
  assert.throws(() => encapsulateBlueprintSelection(f.project, f.graph.id, selected, '拒绝后不得残留'), pattern);
  assert.deepEqual(f.project, before);
}

test('page events, original interface nodes, terminal control and data-only fragments are explained and unchanged', () => {
  for (const type of ['eventClick', 'getInput', 'setOutput', 'return', 'switchScene', 'finishMinigame', 'literal'] as const) {
    const f = kit(), n = f.node(f.graph, type);
    reject(f, [n.id], type === 'eventClick' ? /事件入口/ : type === 'literal' ? /只含数据节点/ : /依赖原图接口|结束当前流程/);
  }
  const f = kit(); reject(f, [makeId('missing')], /变化或删除/);
  f.graph.timelineComponent = true; reject(f, [f.graph.nodes[0].id], /时间轴或组合/);
});

test('multiple control targets and a missing branch path are never silently flattened', () => {
  const f = kit(), b = f.node(f.graph, 'branch'), yes = f.node(f.graph, 'delay'), no = f.node(f.graph, 'delay');
  f.chain(f.graph, f.graph.nodes[0], b); f.wire(f.graph, b, yes, 'true'); f.wire(f.graph, b, no, 'false');
  reject(f, [b.id], /多个不同的后续目标/);
  f.graph.links = f.graph.links.filter(l => l.fromPinId !== 'false'); reject(f, [b.id], /有的路径/);
});

test('partial loop bodies and sequence continuations outside the selection are rejected', () => {
  const loopFixture = kit(), loop = loopFixture.node(loopFixture.graph, 'forLoop'), body = loopFixture.node(loopFixture.graph, 'delay');
  loopFixture.chain(loopFixture.graph, loopFixture.graph.nodes[0], loop); loopFixture.wire(loopFixture.graph, loop, body, 'loop_body');
  reject(loopFixture, [loop.id], /循环体不能越过/);
  const f = kit(), sequence = f.node(f.graph, 'sequence'), outside = f.node(f.graph, 'delay'), inside = f.node(f.graph, 'delay');
  f.chain(f.graph, f.graph.nodes[0], sequence); f.wire(f.graph, sequence, outside, 'then_0'); f.wire(f.graph, sequence, inside, 'then_1');
  reject(f, [sequence.id, inside.id], /依次执行.*中途/);
});

test('mutable incoming values must remain at their original evaluation point', () => {
  const f = kit(), wait = f.node(f.graph, 'delay', { seconds: .2 }), read = f.node(f.graph, 'getVariable', { variableId: 'sum' }), write = f.node(f.graph, 'setVariable', { variableId: 'result' });
  f.chain(f.graph, f.graph.nodes[0], wait, write); f.wire(f.graph, read, write, 'value', 'value'); synchronizeBlueprintSignatures(f.project);
  reject(f, [wait.id, write.id], /实时读取状态/);
  const before = f.sample(f.project); encapsulateBlueprintSelection(f.project, f.graph.id, [wait.id, read.id, write.id], '内部读取'); assert.deepEqual(f.sample(f.project), before);
});

test('mutable outgoing values and conditional execution results cannot become eager defaults', () => {
  const f = kit(), read = f.node(f.graph, 'getVariable', { variableId: 'sum' }), wait = f.node(f.graph, 'delay'), write = f.node(f.graph, 'setVariable', { variableId: 'result' });
  f.chain(f.graph, f.graph.nodes[0], wait, write); f.wire(f.graph, read, write, 'value', 'value'); synchronizeBlueprintSignatures(f.project);
  reject(f, [read.id, wait.id], /依赖实时状态/);
  const g = valueFixture(), branch = g.node(g.graph, 'branch'), other = g.node(g.graph, 'delay');
  g.graph.links = g.graph.links.filter(l => !(l.fromNodeId === g.graph.nodes[0].id || l.fromNodeId === g.call.id && l.fromPinId === 'exec_out'));
  g.chain(g.graph, g.graph.nodes[0], branch); g.wire(g.graph, branch, g.call, 'true'); g.wire(g.graph, branch, other, 'false'); g.wire(g.graph, g.call, g.delay); g.wire(g.graph, other, g.delay);
  reject(g, [branch.id, other.id, ...g.selection], /每条完成路径/);
});

test('failed naming or candidate validation leaves all graphs and content assignments untouched', () => {
  const f = valueFixture(); assignBlueprintGroup(f.project, f.graph.id, '玩法/复用');
  const before = structuredClone(f.project);
  assert.throws(() => encapsulateBlueprintSelection(f.project, f.graph.id, f.selection, f.identity.name), /已被其他蓝图使用/);
  assert.deepEqual(f.project, before);
  const result = encapsulateBlueprintSelection(f.project, f.graph.id, f.selection, '分组模块');
  assert.equal(blueprintGroup(f.project, result.module.id), blueprintGroup(before, f.graph.id));
  const broken = valueFixture(); broken.call.properties.graphId = 'missing_graph'; const brokenBefore = structuredClone(broken.project);
  assert.throws(() => encapsulateBlueprintSelection(broken.project, broken.graph.id, broken.selection, '不能引入无效模块'), /不能安全封装/);
  assert.deepEqual(broken.project, brokenBefore);
});


test('encapsulation works through immutable drafts and UI save merges without touching unrelated imports', () => {
  const f = valueFixture(), original = structuredClone(f.project);
  const value = mutateProject(f.project, draft => { encapsulateBlueprintSelection(draft, f.graph.id, f.selection, '草稿模块'); });
  assert.deepEqual(f.project, original); assert.equal(value.nodes, f.project.nodes);
  const current = mutateProject(f.project, draft => { draft.name = '外部名称'; draft.assets.push({ id: 'external_image', name: '外部素材', kind: 'image', path: 'assets/external.png' }); });
  const merged = applyUiDraft(current, { base: f.project, value });
  assert.equal(merged.name, '外部名称'); assert.equal(merged.assets, current.assets);
  assert.ok(merged.blueprints.some(g => g.name === '草稿模块'));
  assert.deepEqual(f.sample(merged, { amount: 6 }).variables, { result: 36, second: 36, sum: 0 });
  assert.deepEqual(f.project, original);
});

test('data leaving then reentering the region is rejected before it becomes a call cycle', () => {
  const f = kit(), math = f.node(f.graph, 'math', { a: 1, b: 2 }), outside = f.node(f.graph, 'math', { b: 2 });
  const delay = f.node(f.graph, 'delay'), write = f.node(f.graph, 'setVariable', { variableId: 'result' });
  f.chain(f.graph, f.graph.nodes[0], delay, write); f.wire(f.graph, math, outside, 'result', 'a'); f.wire(f.graph, outside, write, 'result', 'value');
  synchronizeBlueprintSignatures(f.project); reject(f, [math.id, delay.id, write.id], /数据先流出再流入/);
});

test('partial computation with a possibly invalid divisor is not evaluated earlier at the module boundary', () => {
  const f = kit(), math = f.node(f.graph, 'math', { operation: 'divide', a: 1, b: 0 }), delay = f.node(f.graph, 'delay');
  f.chain(f.graph, f.graph.nodes[0], delay); f.wire(f.graph, math, delay, 'result', 'seconds');
  reject(f, [delay.id], /重新求值/);
});

test('several paths may share one entry, but disconnected selected work is rejected', () => {
  const f = kit(), branch = f.node(f.graph, 'branch'), write = f.node(f.graph, 'setVariable', { variableId: 'result', value: 9 });
  f.chain(f.graph, f.graph.nodes[0], branch); f.wire(f.graph, branch, write, 'true'); f.wire(f.graph, branch, write, 'false');
  synchronizeBlueprintSignatures(f.project); const before = f.sample(f.project);
  encapsulateBlueprintSelection(f.project, f.graph.id, [write.id], '共享入口模块'); assert.deepEqual(f.sample(f.project), before);
  const g = valueFixture(), loose = g.node(g.graph, 'delay'); reject(g, [...g.selection, loose.id], /不属于同一执行片段/);
});

function constantBoundary() {
  const f = kit(), { graph, node, chain, wire } = f;
  const delay = node(graph, 'delay', { seconds: .1 }), literal = node(graph, 'literal', { value: 7 });
  literal.pins[0].dataType = 'number';
  const first = node(graph, 'setVariable', { variableId: 'result' }), second = node(graph, 'setVariable', { variableId: 'second' });
  synchronizeBlueprintSignatures(f.project);
  chain(graph, graph.nodes[0], delay, first, second); wire(graph, literal, first, 'value', 'value'); wire(graph, literal, second, 'value', 'value');
  return { ...f, delay, literal, first, second, selection: [delay.id, literal.id] };
}

test('a pure output cannot be read before the extracted call, including through data expressions', () => {
  for (const indirect of [false, true]) {
    const f = constantBoundary(), { graph, chain, wire } = f;
    graph.links = graph.links.filter(l => !['exec', 'exec_out'].includes(l.fromPinId));
    chain(graph, graph.nodes[0], f.first, f.delay, f.second);
    if (indirect) {
      const math = f.node(graph, 'math', { b: 1 }); wire(graph, f.literal, math, 'value', 'a'); wire(graph, math, f.first, 'result', 'value');
    }
    assert.equal(f.sample(f.project).variables.result, indirect ? 8 : 7);
    reject(f, f.selection, /调用.*之后|调用前|读取/);
  }
});

test('outputs cannot leak into a different event invocation or a branch that bypasses the call', () => {
  const event = constantBoundary(); event.graph.links = event.graph.links.filter(l => !(l.toNodeId === event.first.id && l.toPinId === 'exec_in'));
  event.wire(event.graph, event.delay, event.second);
  const click = event.node(event.graph, 'eventClick'); event.wire(event.graph, click, event.first, 'exec');
  reject(event, event.selection, /调用.*之后|调用前|读取/);
  const branch = constantBoundary(), choice = branch.node(branch.graph, 'branch', { condition: false });
  branch.wire(branch.graph, branch.graph.nodes[0], choice); branch.wire(branch.graph, choice, branch.delay, 'true'); branch.wire(branch.graph, choice, branch.first, 'false');
  reject(branch, branch.selection, /调用.*之后|调用前|读取/);
});

test('a later sequence branch may consume a tail-fragment result after its call has returned', () => {
  const f = constantBoundary(), sequence = f.node(f.graph, 'sequence');
  f.graph.links = f.graph.links.filter(l => !(l.toPinId === 'exec_in' && [f.delay.id, f.first.id].includes(l.toNodeId)));
  f.wire(f.graph, f.graph.nodes[0], sequence); f.wire(f.graph, sequence, f.delay, 'then_0'); f.wire(f.graph, sequence, f.first, 'then_1');
  const expected = f.sample(f.project); encapsulateBlueprintSelection(f.project, f.graph.id, f.selection, '顺序尾段结果');
  assert.deepEqual(f.sample(f.project), expected); assert.equal(expected.variables.result, 7);
});

test('a loop-body call does not dominate the completed path when the loop can execute zero times', () => {
  const f = constantBoundary(), loop = f.node(f.graph, 'forLoop', { firstIndex: 1, lastIndex: 0 });
  f.graph.links = f.graph.links.filter(l => !(l.toPinId === 'exec_in' && [f.delay.id, f.first.id].includes(l.toNodeId)));
  f.wire(f.graph, f.graph.nodes[0], loop); f.wire(f.graph, loop, f.delay, 'loop_body'); f.wire(f.graph, loop, f.first, 'completed');
  reject(f, f.selection, /调用.*之后|调用前|读取/);
});

test('external loop state changed after capture cannot silently turn a live expression into a stale result', () => {
  const f = kit(), loop = f.node(f.graph, 'forLoop', { firstIndex: 1, lastIndex: 2 });
  const delay = f.node(f.graph, 'delay'), math = f.node(f.graph, 'math', { b: 10 }), sink = f.node(f.graph, 'setVariable', { variableId: 'result' });
  f.chain(f.graph, f.graph.nodes[0], delay, loop); f.wire(f.graph, loop, sink, 'completed'); f.wire(f.graph, loop, math, 'index', 'a'); f.wire(f.graph, math, sink, 'result', 'value');
  reject(f, [delay.id, math.id], /调用.*之后|读取|变化|过期/);
});

test('an already produced return value stays valid when only its original input source changes later', () => {
  const f = valueFixture(), loop = f.node(f.graph, 'forLoop', { firstIndex: 1, lastIndex: 2 });
  // Capture a real loop value, not an unavailable pre-execution output that
  // happens to fall back to a module default in the preview interpreter.
  f.graph.links = f.graph.links.filter(link => !(link.toPinId === 'exec_in' && [f.call.id, f.first.id].includes(link.toNodeId)));
  f.wire(f.graph, f.graph.nodes[0], loop); f.wire(f.graph, loop, f.call, 'loop_body');
  f.wire(f.graph, loop, f.call, 'index', 'arg_amount'); f.wire(f.graph, loop, f.first, 'completed');
  const expected = f.sample(f.project); assert.equal(expected.variables.result, 6);
  encapsulateBlueprintSelection(f.project, f.graph.id, [f.call.id, f.delay.id], '固定调用结果');
  assert.deepEqual(f.sample(f.project), expected);
});


test('loop analysis rechecks reads on later iterations, not only on the first pass', () => {
  const f = valueFixture(), { graph, node, wire } = f;
  graph.links = graph.links.filter(l => graph.nodes.find(n => n.id === l.fromNodeId)!.pins.find(p => p.id === l.fromPinId)!.dataType !== 'exec');
  const setup = node(graph, 'sequence'), rest = node(graph, 'sequence'), loop = node(graph, 'forLoop', { firstIndex: 1, lastIndex: 3 }), body = node(graph, 'sequence');
  f.first.name = '下一次循环读取';
  wire(graph, graph.nodes[0], setup); wire(graph, setup, f.call, 'then_0'); wire(graph, setup, rest, 'then_1');
  wire(graph, rest, f.delay, 'then_0'); wire(graph, rest, loop, 'then_1'); wire(graph, loop, body, 'loop_body'); wire(graph, loop, f.second, 'completed');
  wire(graph, body, f.first, 'then_0'); wire(graph, body, f.call, 'then_1');
  const plan = inspectBlueprintEncapsulation(f.project, graph.id, [f.delay.id, f.math.id]);
  assert.equal(plan.ok, false); if (!plan.ok) { assert.equal(plan.nodeId, f.first.id); assert.match(plan.message, /读取/); }
  reject(f, [f.delay.id, f.math.id], /读取/);
});

test('a loop may call the extracted fragment afresh before each consumer', () => {
  const f = constantBoundary(), loop = f.node(f.graph, 'forLoop', { firstIndex: 1, lastIndex: 3 });
  f.graph.links = f.graph.links.filter(l => l.toNodeId !== f.second.id); f.second.properties.value = 5;
  f.wire(f.graph, f.graph.nodes[0], loop); f.wire(f.graph, loop, f.delay, 'loop_body'); f.wire(f.graph, loop, f.second, 'completed');
  const expected = f.sample(f.project); encapsulateBlueprintSelection(f.project, f.graph.id, f.selection, '每次循环求值');
  assert.deepEqual(f.sample(f.project), expected); assert.equal(expected.variables.result, 7); assert.equal(expected.variables.second, 5);
});

test('untyped numeric or boolean operations cannot be moved ahead of a possibly skipped use', () => {
  for (const type of ['math', 'not'] as const) {
    const f = kit(); f.graph.exposedInputs.push(blueprintPin('unknown', '未限定类型', 'input', 'any', '文字'));
    const input = f.node(f.graph, 'getInput', { inputId: 'unknown' }), expression = f.node(f.graph, type), delay = f.node(f.graph, 'delay');
    synchronizeBlueprintSignatures(f.project); f.chain(f.graph, f.graph.nodes[0], delay); f.wire(f.graph, input, expression, 'value', 'a');
    if (type === 'math') { f.wire(f.graph, expression, delay, 'result', 'seconds'); reject(f, [delay.id], /无效计算/); }
    else {
      const branch = f.node(f.graph, 'branch'); f.wire(f.graph, delay, branch); f.wire(f.graph, expression, branch, 'result', 'condition');
      reject(f, [delay.id, expression.id], /无效计算/);
    }
  }
});

test('duplicate inputs and data cycles are explained without mutating an imported graph', () => {
  const duplicate = constantBoundary(), wire = duplicate.graph.links.find(l => l.toNodeId === duplicate.first.id && l.toPinId === 'value')!;
  duplicate.graph.links.push({ ...wire, id: makeId('bplink') }); reject(duplicate, duplicate.selection, /同一个数据输入/);
  const cycle = constantBoundary(), a = cycle.node(cycle.graph, 'math'), b = cycle.node(cycle.graph, 'math');
  cycle.wire(cycle.graph, a, b, 'result', 'a'); cycle.graph.links.push({ id: makeId('bplink'), fromNodeId: b.id, fromPinId: 'result', toNodeId: a.id, toPinId: 'a' });
  reject(cycle, cycle.selection, /数据连线存在循环/);
});

test('shared data diamonds are memoized rather than exponentially reanalyzed in the dialog', { timeout: 5000 }, () => {
  const f = kit(); let previous = f.node(f.graph, 'math', { operation: 'min', a: 1, b: 1 });
  for (let i = 0; i < 40; i++) { const next = f.node(f.graph, 'math', { operation: 'min' }); f.wire(f.graph, previous, next, 'result', 'a'); f.wire(f.graph, previous, next, 'result', 'b'); previous = next; }
  const delay = f.node(f.graph, 'delay'); f.chain(f.graph, f.graph.nodes[0], delay); f.wire(f.graph, previous, delay, 'result', 'seconds');
  assert.equal(inspectBlueprintEncapsulation(f.project, f.graph.id, [delay.id]).ok, true);
});

test('saved actions, text commands and effect-contained calls retain explicit resource references', () => {
  const f = kit(), target = createBlueprintGraph('function', '隐藏调用'); f.project.blueprints.push(target);
  target.exposedInputs.push(blueprintPin('amount', '数值', 'input', 'number', 0));
  const input = f.node(target, 'getInput', { inputId: 'amount' }), write = f.node(target, 'setVariable', { variableId: 'sum' });
  f.chain(target, target.nodes[0], write); f.wire(target, input, write, 'value', 'value');
  const effectId = makeId('effect'); f.project.effects.push({ id: effectId, name: '隐藏引用演出', commands: [], actions: [{ kind: 'blueprint', blueprintId: target.id, inputs: { amount: 9 } }, { kind: 'pause', seconds: .03 }] });
  const text = f.node(f.graph, 'sceneAction', { command: '@等待：0.2' });
  const saved = f.node(f.graph, 'savedAction', { action: JSON.stringify({ kind: 'blueprint', blueprintId: target.id, inputs: { amount: 7 } }) });
  const effect = f.node(f.graph, 'effect', { effectId }), after = f.node(f.graph, 'setVariable', { variableId: 'result', value: 1 });
  f.chain(f.graph, f.graph.nodes[0], text, saved, effect, after); synchronizeBlueprintSignatures(f.project);
  const expected = f.sample(f.project), savedReference = saved.properties.action;
  const result = encapsulateBlueprintSelection(f.project, f.graph.id, [text.id, saved.id, effect.id], '含隐藏资源引用的模块');
  assert.deepEqual(f.sample(f.project), expected); assert.equal(expected.variables.sum, 9);
  assert.equal(result.module.nodes.find(n => n.id === saved.id)!.properties.action, savedReference);
  assert.deepEqual(compileProject(f.project).diagnostics.filter(d => d.severity === 'error'), []);
});
