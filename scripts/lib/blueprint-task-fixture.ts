import assert from 'node:assert/strict';
import { createProject, newNode, type BlueprintGraph, type BlueprintNode, type UiComponent } from '../../src/core/model';
import { blueprintNodeDefaults, blueprintPin, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../../src/core/blueprint';
import { createCustomUiPage } from '../../src/core/game-flow';

/** Shared authored source: repeated event, concurrent waits, cancellation and result snapshots. */
export function createBlueprintTaskFixture() {
  const project = createProject('通用节流防抖与任务验收'); project.id = 'blueprint_cooperative_tasks';
  for (const id of ['started','finished','payload','last_value','throttled','throttle_pass','throttle_reset','await_value','await_done','await_cancelled','await_missing','await_failed','call_done','native_done']) project.variables.push({ id, name: id, type: 'number', initial: 0, persistent: false });
  project.variables.push({ id: 'quiet', name: '防抖安静秒数', type: 'number', initial: .3, persistent: false }, { id: 'duration', name: '任务运行秒数', type: 'number', initial: .4, persistent: false }, { id: 'handle', name: '任务标识', type: 'string', initial: '', persistent: false }, { id: 'reason', name: '任务返回原因', type: 'string', initial: '', persistent: false }, { id: 'cancelled', name: '本次取消', type: 'boolean', initial: false, persistent: false });
  const graph = (name: string) => { const g = createBlueprintGraph('function', name); project.blueprints.push(g); return g; };
  const node = (g: BlueprintGraph, type: BlueprintNode['type'], properties: BlueprintNode['properties'] = {}) => { const n = blueprintNodeDefaults(type, g.nodes.length); Object.assign(n.properties, properties); g.nodes.push(n); return n; };
  const wire = (g: BlueprintGraph, a: BlueprintNode, b: BlueprintNode, from = 'exec_out', to = 'exec_in') => { synchronizeBlueprintSignatures(project); assert.equal(connectBlueprintPins(g, a.id, a.type.startsWith('event') && from === 'exec_out' ? 'exec' : from, b.id, to), undefined); };
  const chain = (g: BlueprintGraph, ...nodes: BlueprintNode[]) => nodes.slice(1).forEach((n, i) => wire(g, nodes[i], n));
  const increment = (g: BlueprintGraph, id: string) => { const read = node(g, 'getVariable', { variableId: id }), add = node(g, 'math', { b: 1 }), set = node(g, 'setVariable', { variableId: id }); wire(g, read, add, 'value', 'a'); wire(g, add, set, 'result', 'value'); return set; };
  const worker = graph('可等待的通用任务模块');
  worker.exposedInputs = [blueprintPin('payload_input', '输入快照', 'input', 'number', 0), blueprintPin('duration_input', '工作秒数', 'input', 'number', .4)];
  worker.exposedOutputs = [blueprintPin('value_output', '输入原值', 'output', 'number', -1), blueprintPin('false_output', '明确的否', 'output', 'boolean', true), blueprintPin('empty_output', '明确的空文字', 'output', 'string', '默认')];
  const input = node(worker, 'getInput', { inputId: 'payload_input' }), duration = node(worker, 'getInput', { inputId: 'duration_input' }), delay = node(worker, 'delay'), write = node(worker, 'setVariable', { variableId: 'last_value' }), output = node(worker, 'setOutput', { outputId: 'value_output' });
  wire(worker, duration, delay, 'value', 'seconds'); wire(worker, input, write, 'value', 'value'); wire(worker, input, output, 'value', 'value');
  chain(worker, worker.nodes[0], increment(worker, 'started'), delay, write, increment(worker, 'finished'), output, node(worker, 'setOutput', { outputId: 'false_output', value: false }), node(worker, 'setOutput', { outputId: 'empty_output', value: '' }));
  const page = createCustomUiPage(project, '通用任务工作台'), pageGraph = project.blueprints.find(g => g.uiPageId === page.id)!;
  page.components[0].y = .02; page.components[1].y = .88;
  let buttonIndex = 0;
  const button = (id: string, text: string, target = page, eventGraph = pageGraph) => { const i = buttonIndex++, component: UiComponent = { id, text, kind: 'button', page: target === page ? 'custom' : 'preferences', x: .06 + (i % 3) * .31, y: .14 + Math.floor(i / 3) * .12, width: .28, height: .095 }; target.components.push(component); return node(eventGraph, 'eventClick', { componentId: id }); };
  const launch = (g: BlueprintGraph, type: 'startTask' | 'debounce', pageId?: string, conflict = 'parallel') => {
    const task = node(g, type, { graphId: worker.id, scope: pageId ? 'page' : 'call', ...(pageId ? { pageId } : {}), seconds: type === 'debounce' ? .3 : 0, conflict });
    if (type === 'debounce') wire(g, node(g, 'getVariable', { variableId: 'quiet' }), task, 'value', 'seconds');
    wire(g, node(g, 'getVariable', { variableId: 'payload' }), task, 'value', 'arg_payload_input'); wire(g, node(g, 'getVariable', { variableId: 'duration' }), task, 'value', 'arg_duration_input'); return task;
  };
  const storeHandle = (g: BlueprintGraph, task: BlueprintNode) => { const write = node(g, 'setVariable', { variableId: 'handle' }); wire(g, task, write); wire(g, task, write, 'handle', 'value'); return write; };
  const debounce = launch(pageGraph, 'debounce', page.id); chain(pageGraph, button('task_debounce', '反复点击防抖'), increment(pageGraph, 'payload'), debounce); storeHandle(pageGraph, debounce);
  const parallel = launch(pageGraph, 'startTask', page.id); storeHandle(pageGraph, parallel);
  chain(pageGraph, button('task_slow', '启动长任务 / 1'), node(pageGraph, 'setVariable', { variableId: 'payload', value: 1 }), node(pageGraph, 'setVariable', { variableId: 'duration', value: 1.4 }), parallel);
  chain(pageGraph, button('task_fast', '启动短任务 / 2'), node(pageGraph, 'setVariable', { variableId: 'payload', value: 2 }), node(pageGraph, 'setVariable', { variableId: 'duration', value: .2 }), parallel);
  const latest = node(pageGraph, 'getVariable', { variableId: 'handle' }), cancel = node(pageGraph, 'cancelTask'), cancelled = node(pageGraph, 'setVariable', { variableId: 'cancelled' });
  chain(pageGraph, button('task_cancel', '取消最新任务'), cancel, cancelled); wire(pageGraph, latest, cancel, 'value', 'handle'); wire(pageGraph, cancel, cancelled, 'cancelled', 'value');
  const wait = node(pageGraph, 'waitTask', { graphId: worker.id }), accepted = node(pageGraph, 'setVariable', { variableId: 'await_value' });
  wire(pageGraph, button('task_await', '等待最新任务'), wait); wire(pageGraph, latest, wait, 'value', 'handle'); wire(pageGraph, wait, accepted, 'completed'); wire(pageGraph, wait, accepted, 'out_value_output', 'value'); chain(pageGraph, accepted, increment(pageGraph, 'await_done'));
  for (const reason of ['cancelled', 'missing', 'failed'] as const) wire(pageGraph, wait, increment(pageGraph, 'await_' + reason), reason);
  const throttle = node(pageGraph, 'throttle', { scope: 'page', pageId: page.id, seconds: .5 }); wire(pageGraph, button('task_throttle', '节流尝试'), throttle); wire(pageGraph, button('task_throttle_reset', '重置冷却'), throttle, 'exec', 'reset');
  wire(pageGraph, throttle, increment(pageGraph, 'throttle_pass')); wire(pageGraph, throttle, increment(pageGraph, 'throttled'), 'blocked'); wire(pageGraph, throttle, increment(pageGraph, 'throttle_reset'), 'updated');
  const ignore = launch(pageGraph, 'startTask', page.id, 'ignore'); wire(pageGraph, button('task_ignore', '仍在运行则忽略'), ignore); storeHandle(pageGraph, ignore);
  const replace = launch(pageGraph, 'startTask', page.id, 'replace'); chain(pageGraph, button('task_replace', '只保留最新任务'), increment(pageGraph, 'payload'), replace); storeHandle(pageGraph, replace);
  const orphan = graph('调用结束取消未完成任务'), orphanStart = launch(orphan, 'startTask'); wire(orphan, orphan.nodes[0], orphanStart); wire(pageGraph, button('task_orphan', '调用返回取消子任务'), node(pageGraph, 'callFunction', { graphId: orphan.id }));
  const call = graph('调用内并行后等待结果'), callStart = launch(call, 'startTask'), callWait = node(call, 'waitTask', { graphId: worker.id }); chain(call, call.nodes[0], callStart, callWait); wire(call, callStart, callWait, 'handle', 'handle'); wire(call, callWait, increment(call, 'call_done'), 'completed');
  wire(pageGraph, button('task_call', '调用内等待结果'), node(pageGraph, 'callFunction', { graphId: call.id }));
  const nested = graph('任务嵌套调用结果'); nested.exposedInputs = structuredClone(worker.exposedInputs); nested.exposedOutputs = structuredClone(worker.exposedOutputs);
  const nestedWorker = node(nested, 'callFunction', { graphId: worker.id }); wire(nested, nested.nodes[0], nestedWorker);
  for (const pin of nested.exposedInputs) wire(nested, node(nested, 'getInput', { inputId: pin.id }), nestedWorker, 'value', 'arg_' + pin.id);
  let previous = nestedWorker;
  for (const pin of nested.exposedOutputs) { const output = node(nested, 'setOutput', { outputId: pin.id }); wire(nested, previous, output); wire(nested, nestedWorker, output, 'out_' + pin.id, 'value'); previous = output; }
  const nestedLaunch = node(pageGraph, 'startTask', { scope: 'page', pageId: page.id, graphId: nested.id, arg_payload_input: 7, arg_duration_input: .4 }); wire(pageGraph, button('task_nested', '独立任务中的嵌套调用'), nestedLaunch); storeHandle(pageGraph, nestedLaunch);
  const animated = graph('可取消的属性动画任务'), animation = node(animated, 'animateUiProperty', { componentId: page.components[0].id, property: 'opacity', value: 0, duration: 1.2, wait: true, easing: 'linear' }); chain(animated, animated.nodes[0], animation, increment(animated, 'finished'));
  const animationLaunch = node(pageGraph, 'startTask', { scope: 'page', pageId: page.id, graphId: animated.id }); wire(pageGraph, button('task_animation', '取消正在播放的动画'), animationLaunch); storeHandle(pageGraph, animationLaunch);
  const nativeGraph = graph('设置模板的防抖任务'); nativeGraph.kind = 'ui'; nativeGraph.uiPageId = 'ui:preferences'; nativeGraph.uiInstanceId = 'base';
  project.ui.components.push({ id: 'task_native_debounce', text: '模板页面防抖', page: 'preferences', kind: 'button', x: .6, y: .06, width: .32, height: .08 }, { id: 'task_native_close', text: '关闭模板页面', page: 'preferences', kind: 'button', x: .6, y: .16, width: .32, height: .08 });
  const nativeDebounce = launch(nativeGraph, 'debounce', 'ui:preferences'); chain(nativeGraph, node(nativeGraph, 'eventClick', { componentId: 'task_native_debounce' }), increment(nativeGraph, 'payload'), nativeDebounce); storeHandle(nativeGraph, nativeDebounce);
  chain(nativeGraph, node(nativeGraph, 'eventClick', { componentId: 'task_native_close' }), node(nativeGraph, 'closeUiPage', { pageId: 'ui:preferences', reason: 'completed', result: 'native' }));
  const nativeOpen = node(pageGraph, 'showUiPage', { pageId: 'ui:preferences', wait: true }); chain(pageGraph, button('task_native', '打开系统设置模板'), nativeOpen, increment(pageGraph, 'native_done'));
  const open = graph('打开任务工作台'); chain(open, open.nodes[0], node(open, 'showUiPage', { pageId: page.id, wait: true }));
  const intro = project.nodes.find(n => n.kind === 'passage')!; assert.equal(intro.kind, 'passage'); intro.lines[0].text = '准备验收通用任务。';
  const interactive = newNode('passage', project.scenes[0].id), saved = newNode('passage', project.scenes[0].id); assert.equal(interactive.kind, 'passage'); assert.equal(saved.kind, 'passage');
  Object.assign(interactive, { id: 'tasks_interactive', next: intro.id }); interactive.lines[0].text = '通用任务页面已返回。'; interactive.lines[0].actions = [{ kind: 'blueprint', blueprintId: open.id }];
  Object.assign(saved, { id: 'tasks_saved_call', next: intro.id }); saved.lines[0].text = '调用内任务已完成。'; saved.lines[0].actions = [{ kind: 'blueprint', blueprintId: call.id }]; project.nodes.push(interactive, saved);
  // Dismissing the introductory dialogue creates a real player rollback point.
  // Jump() out of its first interaction does not complete that checkpoint.
  intro.next = saved.id;
  synchronizeBlueprintSignatures(project);
  return { project, page, pageGraph, worker, debounce, parallel, cancel, wait, throttle, ignore, replace, orphan, orphanStart, call, callStart, callWait, nested, nestedLaunch, animated, animationLaunch, nativeGraph, nativeDebounce, interactive, saved, graph, node, wire, chain, increment };
}
