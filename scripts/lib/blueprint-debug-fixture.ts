import { createBlueprintTaskFixture } from './blueprint-task-fixture';
import { synchronizeBlueprintSignatures } from '../../src/core/blueprint';

/** Same graph runs as a normal call, nested call and page-owned background task. */
export function createBlueprintDebugFixture() {
  const f = createBlueprintTaskFixture(); f.project.id = 'blueprint_debug_fixture'; f.project.name = '原生蓝图调试验收';
  const graph = f.graph('调试父调用'), first = f.node(graph, 'setVariable', { variableId: 'payload', value: 0 }); first.name = '调试开始写入';
  const call = f.node(graph, 'callFunction', { graphId: f.worker.id, arg_payload_input: 0, arg_duration_input: .35 }); call.name = '调试嵌套调用';
  const zero = f.node(graph, 'setVariable', { variableId: 'await_value' }); zero.name = '观察零结果';
  const no = f.node(graph, 'setVariable', { variableId: 'cancelled' }); no.name = '观察否结果';
  const empty = f.node(graph, 'setVariable', { variableId: 'reason' }); empty.name = '观察空文本结果';
  const random = f.node(graph, 'random', { min: 1, max: 10 }), compare = f.node(graph, 'compare', { valueType: 'number', operator: 'gt', b: 0 });
  const and = f.node(graph, 'and', { a: false }), lazy = f.node(graph, 'setVariable', { variableId: 'cancelled' }); lazy.name = '短路跳过随机数';
  const done = f.node(graph, 'setVariable', { variableId: 'call_done', value: 1 }); done.name = '调试调用完成';
  f.chain(graph, graph.nodes[0], first, call, zero, no, empty, lazy, done);
  f.wire(graph, call, zero, 'out_value_output', 'value'); f.wire(graph, call, no, 'out_false_output', 'value'); f.wire(graph, call, empty, 'out_empty_output', 'value');
  f.wire(graph, random, compare, 'value', 'a'); f.wire(graph, compare, and, 'result', 'b'); f.wire(graph, and, lazy, 'result', 'value');
  const workerFirst = f.worker.nodes.find(node => node.type === 'setVariable' && node.properties.variableId === 'started')!;
  const workerDelay = f.worker.nodes.find(node => node.type === 'delay')!;
  const workerWrite = f.worker.nodes.find(node => node.type === 'setVariable' && node.properties.variableId === 'last_value')!;
  workerFirst.name = '工作模块首次写入'; workerDelay.name = '工作模块可暂停等待'; workerWrite.name = '工作模块等待后写入';
  synchronizeBlueprintSignatures(f.project);
  return { ...f, rootGraph: graph, rootFirst: first, rootCall: call, rootZero: zero, rootDone: done, lazyRandom: random, workerFirst, workerDelay, workerWrite };
}
