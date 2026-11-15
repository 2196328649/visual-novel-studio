import assert from 'node:assert/strict';
import { createProject, newNode, type BlueprintGraph, type BlueprintNode, type UiComponent } from '../../src/core/model';
import { blueprintNodeDefaults, blueprintPin, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../../src/core/blueprint';
import { createCustomUiPage } from '../../src/core/game-flow';

/** Re-entrant calls to one authored module from two ordinary UI callbacks. */
export function createBlueprintInvocationFixture() {
  const project = createProject('蓝图调用临时数据隔离');
  project.id = 'blueprint_invocation_lifecycle';
  for (const id of ['ready', 'done_a', 'done_b', 'snapshot_a', 'snapshot_b', 'cache_a', 'cache_b', 'loop_a', 'loop_b']) {
    project.variables.push({ id, name: id, type: 'number', initial: 0, persistent: false });
  }
  for (const id of ['page_a', 'page_b']) project.variables.push({ id, name: id, type: 'string', initial: '', persistent: false });
  const graph = (name: string) => { const g = createBlueprintGraph('function', name); project.blueprints.push(g); return g; };
  const node = (g: BlueprintGraph, type: BlueprintNode['type'], properties: BlueprintNode['properties'] = {}) => {
    const n = blueprintNodeDefaults(type); Object.assign(n.properties, properties); g.nodes.push(n); return n;
  };
  const wire = (g: BlueprintGraph, from: BlueprintNode, to: BlueprintNode, output = 'exec_out', input = 'exec_in') => {
    synchronizeBlueprintSignatures(project);
    assert.equal(connectBlueprintPins(g, from.id, from.type.startsWith('event') && output === 'exec_out' ? 'exec' : output, to.id, input), undefined);
  };
  const chain = (g: BlueprintGraph, ...nodes: BlueprintNode[]) => nodes.slice(1).forEach((n, i) => wire(g, nodes[i], n));
  const mark = (g: BlueprintGraph, variableId: string, value: number | string) => node(g, 'setVariable', { variableId, value });
  const increment = (g: BlueprintGraph, id: string, value?: BlueprintNode, output = 'value') => {
    const read = node(g, 'getVariable', { variableId: id }), add = node(g, 'math', { b: 1 }), write = mark(g, id, 0);
    wire(g, read, add, 'value', 'a'); if (value) wire(g, value, add, output, 'b'); wire(g, add, write, 'result', 'value'); return write;
  };
  const input = (g: BlueprintGraph, id: string, type: 'number' | 'boolean' | 'ui', initial: number | boolean | string) => {
    g.exposedInputs.push(blueprintPin(id, id, 'input', type, initial)); return node(g, 'getInput', { inputId: id });
  };
  const output = (g: BlueprintGraph, type: 'number' | 'string' = 'number') => {
    g.exposedOutputs.push(blueprintPin('value', '返回值', 'output', type, type === 'number' ? 0 : '')); return node(g, 'setOutput', { outputId: 'value' });
  };
  const wait = (g: BlueprintGraph, seconds: BlueprintNode) => { const n = node(g, 'delay'); wire(g, seconds, n, 'value', 'seconds'); return n; };
  const root = createCustomUiPage(project, '调用隔离控制页'); root.components[0].y = .08;
  const childA = createCustomUiPage(project, '调用 A 的返回页'), childB = createCustomUiPage(project, '调用 B 的返回页');
  for (const [page, result] of [[childA, 'A'], [childB, 'B']] as const) {
    const events = project.blueprints.find(g => g.uiPageId === page.id)!;
    events.nodes.find(n => n.type === 'closeUiPage')!.properties.result = result;
  }
  const snapshot = graph('先写输出再等待');
  const amount = input(snapshot, 'amount', 'number', 1), seconds = input(snapshot, 'seconds', 'number', .8), result = output(snapshot);
  wire(snapshot, amount, result, 'value', 'value'); chain(snapshot, snapshot.nodes[0], result, increment(snapshot, 'ready'), wait(snapshot, seconds), node(snapshot, 'return'));
  const identity = graph('值传递'); const identityInput = input(identity, 'amount', 'number', 1), identityOutput = output(identity);
  wire(identity, identityInput, identityOutput, 'value', 'value'); chain(identity, identity.nodes[0], identityOutput);
  const cache = graph('嵌套返回值跨等待');
  const cacheAmount = input(cache, 'amount', 'number', 1), cacheSeconds = input(cache, 'seconds', 'number', .8), cached = node(cache, 'callFunction', { graphId: identity.id }), cacheResult = output(cache);
  wire(cache, cacheAmount, cached, 'value', 'arg_amount'); wire(cache, cached, cacheResult, 'out_value', 'value');
  chain(cache, cache.nodes[0], cached, increment(cache, 'ready'), wait(cache, cacheSeconds), cacheResult);
  const loops = graph('循环计数跨等待');
  const loopCount = input(loops, 'amount', 'number', 3), loopSeconds = input(loops, 'seconds', 'number', .3), which = input(loops, 'second', 'boolean', false);
  const loop = node(loops, 'forLoop', { firstIndex: 1 }), pause = wait(loops, loopSeconds), branch = node(loops, 'branch');
  wire(loops, loopCount, loop, 'value', 'last_index'); wire(loops, which, branch, 'value', 'condition');
  chain(loops, loops.nodes[0], increment(loops, 'ready'), loop); wire(loops, loop, pause, 'loop_body'); wire(loops, pause, branch);
  wire(loops, branch, increment(loops, 'loop_b', loop, 'index'), 'true'); wire(loops, branch, increment(loops, 'loop_a', loop, 'index'), 'false');
  const pages = graph('页面返回值跨等待');
  const target = input(pages, 'page', 'ui', childA.id), pageSeconds = input(pages, 'seconds', 'number', .8);
  const show = node(pages, 'showUiPage', { wait: true, interfacePageId: childA.id }), pageResult = output(pages, 'string');
  wire(pages, target, show, 'value', 'pageId'); wire(pages, show, pageResult, 'result', 'value');
  chain(pages, pages.nodes[0], show, increment(pages, 'ready'), wait(pages, pageSeconds), pageResult);
  const callers: Record<string, BlueprintGraph> = {};
  const button = (id: string, text: string, x: number, y: number, blueprintId: string): UiComponent =>
    ({ id, kind: 'button', page: 'custom', text, x, y, width: .36, height: .075, action: 'blueprint', blueprintId });
  for (const [kind, module, y] of [['snapshot', snapshot, .24], ['cache', cache, .36], ['loop', loops, .48], ['page', pages, .60]] as const) {
    for (const suffix of ['a', 'b'] as const) {
      const second = suffix === 'b'; const g = graph(kind + ' 调用 ' + suffix.toUpperCase()); callers[kind + '_' + suffix] = g;
      const call = node(g, 'callFunction', { graphId: module.id, arg_amount: kind === 'loop' ? second ? 1 : 3 : second ? 22 : 11, arg_seconds: second ? 0 : kind === 'loop' ? .3 : .8, arg_second: second, arg_page: second ? childB.id : childA.id });
      const done = mark(g, 'done_' + suffix, 1);
      if (kind === 'loop') chain(g, g.nodes[0], call, done);
      else { const capture = mark(g, kind + '_' + suffix, kind === 'page' ? '' : 0); wire(g, call, capture, 'out_value', 'value'); chain(g, g.nodes[0], call, capture, done); }
      root.components.push(button('invoke_' + kind + '_' + suffix, kind + ' / ' + suffix.toUpperCase(), second ? .53 : .08, y, g.id));
    }
  }
  const open = graph('等待调用隔离页'); chain(open, open.nodes[0], node(open, 'showUiPage', { pageId: root.id, wait: true }));
  const intro = project.nodes.find(n => n.kind === 'passage')!; assert.equal(intro.kind, 'passage'); intro.lines[0].text = '准备检查调用隔离。';
  const interactive = newNode('passage', project.scenes[0].id); assert.equal(interactive.kind, 'passage');
  Object.assign(interactive, { id: 'invocation_interactive', next: intro.id }); interactive.lines[0].text = '调用隔离检查已返回。'; interactive.lines[0].actions = [{ kind: 'blueprint', blueprintId: open.id }];
  const storyCall = graph('剧情中的可保存调用');
  chain(storyCall, storyCall.nodes[0], node(storyCall, 'showUiPage', { pageId: root.id, wait: false }), node(storyCall, 'callFunction', { graphId: callers.cache_a.id }));
  const saved = newNode('passage', project.scenes[0].id); assert.equal(saved.kind, 'passage');
  Object.assign(saved, { id: 'invocation_saved', next: intro.id }); saved.lines[0].text = '可保存调用已完成。'; saved.lines[0].actions = [{ kind: 'blueprint', blueprintId: storyCall.id }];
  project.nodes.push(interactive, saved); synchronizeBlueprintSignatures(project);
  return { project, root, childA, childB, snapshot, identity, cache, loops, pages, callers, interactive, saved };
}
