import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlueprintTaskBoundaryFixture } from '../scripts/lib/blueprint-task-boundary-fixture';
import { blueprintPin } from '../src/core/blueprint';
import { blueprintTaskProblems } from '../src/core/blueprint-tasks';
import { visitBlueprintOperationClosure } from '../src/core/blueprint-operation-closure';
import type { BlueprintGraph } from '../src/core/model';

function fixture() { const f = createBlueprintTaskBoundaryFixture(); return { ...f, root: f.graph('被检查的调用入口') }; }
function collect(f: ReturnType<typeof fixture>, root: BlueprintGraph = f.root) {
  const reads: string[] = [], executions: string[] = [];
  const problems = visitBlueprintOperationClosure(f.project, root, root.nodes[0], (_graph, node, executing) => (executing ? executions : reads).push(node.id));
  return { reads, executions, problems };
}

test('task restrictions prune constant branches and ignore unrelated event entry points', () => {
  const f = fixture(), branch = f.node(f.root, 'branch', { condition: false }); f.wire(f.root, f.root.nodes[0], branch);
  const unsafe = f.node(f.root, 'showUiPage', { pageId: f.page.id }); f.wire(f.root, branch, unsafe, 'true');
  f.wire(f.root, f.node(f.root, 'eventClick', { componentId: f.page.components[1].id }), f.node(f.root, 'confirmMessage'));
  assert.deepEqual(blueprintTaskProblems(f.project, f.root.id), []);
  branch.properties.condition = true; assert.ok(blueprintTaskProblems(f.project, f.root.id).some(issue => issue.nodeId === unsafe.id));
});

test('unknown root arguments are never replaced by their safe-looking default values', () => {
  const f = fixture(); f.root.exposedInputs = [blueprintPin('flag', '开关', 'input', 'boolean', false)];
  const branch = f.node(f.root, 'branch'), unsafe = f.node(f.root, 'showUiPage', { pageId: f.page.id });
  f.wire(f.root, f.root.nodes[0], branch); f.wire(f.root, f.node(f.root, 'getInput', { inputId: 'flag' }), branch, 'value', 'condition'); f.wire(f.root, branch, unsafe, 'true');
  assert.ok(blueprintTaskProblems(f.project, f.root.id).some(issue => issue.nodeId === unsafe.id));
});

test('nested explicit arguments prune unreachable operations without leaking across call contexts', () => {
  const f = fixture(), child = f.graph('按显式参数分支'); child.exposedInputs = [blueprintPin('flag', '开关', 'input', 'boolean', true)];
  const branch = f.node(child, 'branch'), unsafe = f.node(child, 'showUiPage', { pageId: f.page.id });
  f.wire(child, child.nodes[0], branch); f.wire(child, f.node(child, 'getInput', { inputId: 'flag' }), branch, 'value', 'condition'); f.wire(child, branch, unsafe, 'true');
  const call = f.node(f.root, 'callFunction', { graphId: child.id, arg_flag: false }); f.wire(f.root, f.root.nodes[0], call);
  assert.deepEqual(blueprintTaskProblems(f.project, f.root.id), []);
  f.wire(f.root, call, f.node(f.root, 'callFunction', { graphId: child.id, arg_flag: true }));
  assert.ok(blueprintTaskProblems(f.project, f.root.id).some(issue => issue.graphId === child.id && issue.nodeId === unsafe.id));
});

test('a stable Switch selects only its actual route', () => {
  const f = fixture(), branch = f.node(f.root, 'switchValue', { key: 'A' }), unsafe = f.node(f.root, 'showUiPage', { pageId: f.page.id });
  f.wire(f.root, f.root.nodes[0], branch); f.wire(f.root, branch, unsafe, 'case_b');
  assert.deepEqual(blueprintTaskProblems(f.project, f.root.id), []);
  branch.properties.key = 'B'; assert.ok(blueprintTaskProblems(f.project, f.root.id).some(issue => issue.nodeId === unsafe.id));
});

test('AND and OR audit only operands that can actually be read', () => {
  for (const type of ['and', 'or'] as const) {
    const f = fixture(), logic = f.node(f.root, type, { a: type === 'or' }), branch = f.node(f.root, 'branch'), read = f.node(f.root, 'getUiProperty', { componentId: f.page.components[0].id, property: 'visible' });
    f.wire(f.root, f.root.nodes[0], branch); f.wire(f.root, logic, branch, 'result', 'condition'); f.wire(f.root, read, logic, 'value', 'b');
    assert.ok(!collect(f).reads.includes(read.id)); logic.properties.a = type !== 'or'; assert.ok(collect(f).reads.includes(read.id));
  }
});

test('Select By Key and Select audit the selected data rather than every connected value', () => {
  const f = fixture(), selected = f.node(f.root, 'selectByKey', { key: 'A', valueType: 'boolean', case_a: true }), branch = f.node(f.root, 'branch');
  const read = f.node(f.root, 'getUiProperty', { componentId: f.page.components[0].id, property: 'visible' });
  f.wire(f.root, f.root.nodes[0], branch); f.wire(f.root, selected, branch, 'result', 'condition'); f.wire(f.root, read, selected, 'value', 'case_b');
  assert.ok(!collect(f).reads.includes(read.id)); selected.properties.key = 'B'; assert.ok(collect(f).reads.includes(read.id));
  const ordinary = f.node(f.root, 'select', { condition: false, false_value: false });
  f.root.links = f.root.links.filter(link => !(link.toNodeId === branch.id && link.toPinId === 'condition'));
  f.wire(f.root, ordinary, branch, 'result', 'condition'); f.wire(f.root, read, ordinary, 'value', 'true_value');
  assert.ok(!collect(f).reads.includes(read.id)); ordinary.properties.condition = true; assert.ok(collect(f).reads.includes(read.id));
});

test('reading an unexecuted call output never executes its module or reads its arguments', () => {
  const f = fixture(), unsafe = f.graph('未执行模块'); unsafe.exposedInputs = [blueprintPin('arg', '参数', 'input', 'boolean', false)]; unsafe.exposedOutputs = [blueprintPin('result', '返回值', 'output', 'boolean', false)];
  f.wire(unsafe, unsafe.nodes[0], f.node(unsafe, 'showUiPage', { pageId: f.page.id }));
  const call = f.node(f.root, 'callFunction', { graphId: unsafe.id }), branch = f.node(f.root, 'branch');
  const read = f.node(f.root, 'getUiProperty', { componentId: f.page.components[0].id, property: 'visible' });
  f.wire(f.root, read, call, 'value', 'arg_arg'); f.wire(f.root, call, branch, 'out_result', 'condition'); f.wire(f.root, f.root.nodes[0], branch);
  assert.deepEqual(blueprintTaskProblems(f.project, f.root.id), []); assert.ok(!collect(f).reads.includes(read.id)); assert.ok(!collect(f).executions.includes(call.id));
});

test('an empty loop excludes its body but a dynamic range cannot prove the body unreachable', () => {
  const f = fixture(), loop = f.node(f.root, 'forLoop', { firstIndex: 5, lastIndex: 3 }), unsafe = f.node(f.root, 'showUiPage', { pageId: f.page.id });
  f.wire(f.root, f.root.nodes[0], loop); f.wire(f.root, loop, unsafe, 'loop_body'); assert.deepEqual(blueprintTaskProblems(f.project, f.root.id), []);
  f.wire(f.root, f.node(f.root, 'getVariable', { variableId: 'short_done' }), loop, 'value', 'first_index');
  assert.ok(blueprintTaskProblems(f.project, f.root.id).some(issue => issue.nodeId === unsafe.id));
});

test('a Sequence cannot execute later steps after an unconditional return', () => {
  const f = fixture(), sequence = f.node(f.root, 'sequence'), unsafe = f.node(f.root, 'showUiPage', { pageId: f.page.id });
  f.wire(f.root, f.root.nodes[0], sequence); f.wire(f.root, sequence, f.node(f.root, 'return'), 'then_0'); f.wire(f.root, sequence, unsafe, 'then_1');
  f.root.links.reverse(); // authored pin order, not link insertion order
  assert.deepEqual(blueprintTaskProblems(f.project, f.root.id), []);
});

test('a conditional return only stops Sequence when every possible branch returns', () => {
  const f = fixture(), sequence = f.node(f.root, 'sequence'), branch = f.node(f.root, 'branch'), unsafe = f.node(f.root, 'showUiPage', { pageId: f.page.id });
  f.root.exposedInputs = [blueprintPin('flag', '动态条件', 'input', 'boolean', false)];
  f.wire(f.root, f.root.nodes[0], sequence); f.wire(f.root, sequence, branch, 'then_0'); f.wire(f.root, sequence, unsafe, 'then_1');
  f.wire(f.root, f.node(f.root, 'getInput', { inputId: 'flag' }), branch, 'value', 'condition'); f.wire(f.root, branch, f.node(f.root, 'return'), 'true');
  assert.ok(blueprintTaskProblems(f.project, f.root.id).some(issue => issue.nodeId === unsafe.id));
  f.wire(f.root, branch, f.node(f.root, 'return'), 'false'); assert.deepEqual(blueprintTaskProblems(f.project, f.root.id), []);
});

test('returning inside a known nonempty loop stops its completed route, not a parent caller', () => {
  const f = fixture(), loop = f.node(f.root, 'forLoop', { firstIndex: 0, lastIndex: 2 }), unsafe = f.node(f.root, 'showUiPage', { pageId: f.page.id });
  f.wire(f.root, f.root.nodes[0], loop); f.wire(f.root, loop, f.node(f.root, 'return'), 'loop_body'); f.wire(f.root, loop, unsafe, 'completed');
  assert.deepEqual(blueprintTaskProblems(f.project, f.root.id), []);
  const parent = f.graph('返回调用者'); f.chain(parent, parent.nodes[0], f.node(parent, 'callFunction', { graphId: f.root.id }), f.node(parent, 'showUiPage', { pageId: f.page.id }));
  assert.ok(blueprintTaskProblems(f.project, parent.id).some(issue => issue.graphId === parent.id && issue.message.includes('前台')));
});

test('missing entries, missing modules and recursive tasks remain explicit failures', () => {
  const f = fixture(); f.wire(f.root, f.root.nodes[0], f.node(f.root, 'callFunction', { graphId: 'missing_graph' }));
  assert.ok(collect(f).problems.some(problem => problem.kind === 'missingModule'));
  f.root.nodes.splice(0, 1); assert.ok(visitBlueprintOperationClosure(f.project, f.root, undefined, () => {}).some(problem => problem.kind === 'missingEntry'));
  const recursive = f.graph('递归后台工作'); f.wire(recursive, recursive.nodes[0], f.node(recursive, 'startTask', { graphId: recursive.id }));
  assert.ok(blueprintTaskProblems(f.project, recursive.id).some(problem => problem.message.includes('递归')));
});
