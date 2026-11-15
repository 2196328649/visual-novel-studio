import assert from 'node:assert/strict';
import { createProject, newNode, type BlueprintGraph, type BlueprintNode, type UiComponent } from '../../src/core/model';
import { blueprintNodeDefaults, blueprintPin, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../../src/core/blueprint';
import { createCustomUiPage } from '../../src/core/game-flow';

/** One authored fixture for interpreter, desktop authoring, and real Ren'Py checks. */
export function createBlueprintFlowControlFixture() {
  const project = createProject('通用状态控制节点验收'); project.id = 'blueprint_flow_control_lifecycle';
  const counters = ['once_hits', 'once_blocked', 'once_resets', 'gate_hits', 'gate_blocked', 'gate_updates', 'local_hits', 'local_blocked', 'shared_hits', 'shared_blocked', 'wait_started', 'wait_done', 'wait_blocked', 'saved_hits', 'saved_blocked', 'saved_done', 'native_done', 'rearm_hits', 'rearm_blocked', 'rearm_done', 'busy_hits', 'busy_blocked', 'busy_done'];
  project.variables.push(...counters.map(id => ({ id, name: id, type: 'number' as const, initial: 0, persistent: false })));
  const graph = (name: string) => { const value = createBlueprintGraph('function', name); project.blueprints.push(value); return value; };
  const node = (g: BlueprintGraph, type: BlueprintNode['type'], properties: BlueprintNode['properties'] = {}) => { const value = blueprintNodeDefaults(type, g.nodes.length); Object.assign(value.properties, properties); g.nodes.push(value); return value; };
  const wire = (g: BlueprintGraph, a: BlueprintNode, b: BlueprintNode, from = 'exec_out', to = 'exec_in') => {
    synchronizeBlueprintSignatures(project); assert.equal(connectBlueprintPins(g, a.id, a.type.startsWith('event') && from === 'exec_out' ? 'exec' : from, b.id, to), undefined);
  };
  const chain = (g: BlueprintGraph, ...items: BlueprintNode[]) => items.slice(1).forEach((next, index) => wire(g, items[index], next));
  const increment = (g: BlueprintGraph, variableId: string) => {
    const read = node(g, 'getVariable', { variableId }), add = node(g, 'math', { b: 1 }), write = node(g, 'setVariable', { variableId, value: 0 });
    wire(g, read, add, 'value', 'a'); wire(g, add, write, 'result', 'value'); return write;
  };
  const root = createCustomUiPage(project, '执行一次与门控'), child = createCustomUiPage(project, '第二个页面实例');
  root.components[0].y = .03; root.components[1].y = .87; child.components[0].y = .1;
  const pageGraph = project.blueprints.find(g => g.uiPageId === root.id)!;
  project.ui.pageVariables = { [root.id]: [{ id: 'counter', name: '页面计数', type: 'number', initial: 0 }] };
  let buttonIndex = 0;
  const button = (id: string, text: string, page = root): UiComponent => {
    const index = buttonIndex++, value: UiComponent = { id, text, kind: 'button', page: 'custom', x: .07 + index % 3 * .3, y: .18 + Math.floor(index / 3) * .092, width: .26, height: .075 };
    page.components.push(value); return value;
  };
  const event = (id: string, text: string, control: BlueprintNode, entry = 'exec_in') => { const component = button(id, text); const start = node(pageGraph, 'eventClick', { componentId: component.id }); wire(pageGraph, start, control, 'exec', entry); return component; };
  const once = node(pageGraph, 'doOnce', { scope: 'page', pageId: root.id });
  const gate = node(pageGraph, 'gate', { scope: 'page', pageId: root.id });
  event('control_once_a', '执行一次 / A', once); event('control_once_b', '执行一次 / B', once); event('control_once_reset', '重置执行一次', once, 'reset');
  event('control_gate_enter', '尝试进入门', gate); event('control_gate_open', '打开门', gate, 'open'); event('control_gate_close', '关闭门', gate, 'close');
  event('control_gate_toggle', '切换门', gate, 'toggle'); event('control_gate_reset', '重置门', gate, 'reset');
  const count = increment(pageGraph, 'once_hits'); wire(pageGraph, once, count); chain(pageGraph, count, node(pageGraph, 'setVariable', { scope: 'page', pageId: root.id, variableId: 'counter', value: 7 }));
  wire(pageGraph, once, increment(pageGraph, 'once_blocked'), 'blocked'); wire(pageGraph, once, increment(pageGraph, 'once_resets'), 'updated');
  wire(pageGraph, gate, increment(pageGraph, 'gate_hits')); wire(pageGraph, gate, increment(pageGraph, 'gate_blocked'), 'blocked'); wire(pageGraph, gate, increment(pageGraph, 'gate_updates'), 'updated');

  const local = graph('本次调用内执行一次');
  const sequence = node(local, 'sequence'); sequence.pins.push(blueprintPin('then_2', '重置后再执行', 'output'));
  const loop = node(local, 'forLoop', { firstIndex: 1, lastIndex: 3 }), localOnce = node(local, 'doOnce');
  chain(local, local.nodes[0], sequence); wire(local, sequence, loop, 'then_0'); wire(local, loop, localOnce, 'loop_body');
  wire(local, sequence, localOnce, 'then_1', 'reset'); wire(local, sequence, localOnce, 'then_2');
  wire(local, localOnce, increment(local, 'local_hits')); wire(local, localOnce, increment(local, 'local_blocked'), 'blocked');
  const localButton = button('control_local', '调用内循环与重置'); localButton.action = 'blueprint'; localButton.blueprintId = local.id;

  const shared = graph('共享的页面执行一次'); shared.exposedInputs.push(blueprintPin('page', '目标页面', 'input', 'ui', root.id));
  const target = node(shared, 'getInput', { inputId: 'page' }), sharedOnce = node(shared, 'doOnce', { scope: 'page', pageId: root.id });
  wire(shared, target, sharedOnce, 'value', 'pageId'); chain(shared, shared.nodes[0], sharedOnce);
  wire(shared, sharedOnce, increment(shared, 'shared_hits')); wire(shared, sharedOnce, increment(shared, 'shared_blocked'), 'blocked');
  for (const page of [root, child]) {
    const caller = graph('共享模块 · ' + page.name), call = node(caller, 'callFunction', { graphId: shared.id, arg_page: page.id }); chain(caller, caller.nodes[0], call);
    const component: UiComponent = page === root ? button('control_shared_root', '共享模块 / 本页') : { id: 'control_shared_child', text: '共享模块 / 子页', kind: 'button' as const, page: 'custom' as const, x: .3, y: .4, width: .4, height: .1 };
    component.action = 'blueprint'; component.blueprintId = caller.id; if (page === child) child.components.push(component);
  }
  const showChild = node(pageGraph, 'showUiPage', { pageId: child.id, wait: true }); event('control_child', '打开第二个页面', showChild);
  const waitingOnce = node(pageGraph, 'doOnce', { scope: 'page', pageId: root.id });
  event('control_wait_a', '执行一次并等待 / A', waitingOnce); event('control_wait_b', '执行一次并等待 / B', waitingOnce);
  chain(pageGraph, waitingOnce, increment(pageGraph, 'wait_started'), node(pageGraph, 'delay', { seconds: 1.6 }), increment(pageGraph, 'wait_done'));
  wire(pageGraph, waitingOnce, increment(pageGraph, 'wait_blocked'), 'blocked');

  const savedCall = graph('调用状态跨等待存读档'), savedLoop = node(savedCall, 'forLoop', { firstIndex: 1, lastIndex: 2 }), savedOnce = node(savedCall, 'doOnce');
  chain(savedCall, savedCall.nodes[0], savedLoop); wire(savedCall, savedLoop, savedOnce, 'loop_body');
  chain(savedCall, savedOnce, increment(savedCall, 'saved_hits'), node(savedCall, 'delay', { seconds: 1.6 }));
  wire(savedCall, savedOnce, increment(savedCall, 'saved_blocked'), 'blocked'); wire(savedCall, savedLoop, increment(savedCall, 'saved_done'), 'completed');
  const open = graph('打开控制验收页面'); chain(open, open.nodes[0], node(open, 'showUiPage', { pageId: root.id, wait: true }));
  const intro = project.nodes.find(n => n.kind === 'passage')!; assert.equal(intro.kind, 'passage'); intro.lines[0].text = '准备检查状态控制节点。';
  const interactive = newNode('passage', project.scenes[0].id), saved = newNode('passage', project.scenes[0].id); assert.equal(interactive.kind, 'passage'); assert.equal(saved.kind, 'passage');
  Object.assign(interactive, { id: 'control_interactive', next: intro.id }); interactive.lines[0].text = '状态控制页面已返回。'; interactive.lines[0].actions = [{ kind: 'blueprint', blueprintId: open.id }];
  Object.assign(saved, { id: 'control_saved', next: intro.id }); saved.lines[0].text = '调用控制状态已完成。'; saved.lines[0].actions = [{ kind: 'blueprint', blueprintId: savedCall.id }]; project.nodes.push(interactive, saved);
  const nativeGraph = graph('设置模板门控'); nativeGraph.kind = 'ui'; nativeGraph.uiPageId = 'ui:preferences'; nativeGraph.uiInstanceId = 'base';
  const nativeOnce = node(nativeGraph, 'doOnce', { scope: 'page', pageId: 'ui:preferences' });
  project.ui.components.push({ id: 'control_native_once', text: '模板页面执行一次', page: 'preferences', kind: 'button', x: .6, y: .07, width: .34, height: .08 });
  chain(nativeGraph, node(nativeGraph, 'eventClick', { componentId: 'control_native_once' }), nativeOnce, increment(nativeGraph, 'once_hits'));
  wire(nativeGraph, nativeOnce, increment(nativeGraph, 'once_blocked'), 'blocked');
  project.ui.components.push({ id: 'control_native_close', text: '关闭模板页面', page: 'preferences', kind: 'button', x: .6, y: .17, width: .34, height: .08 });
  chain(nativeGraph, node(nativeGraph, 'eventClick', { componentId: 'control_native_close' }), node(nativeGraph, 'closeUiPage', { pageId: 'ui:preferences', result: 'native-ok', reason: 'completed' }));
  const openNative = node(pageGraph, 'showUiPage', { pageId: 'ui:preferences', wait: true }); event('control_native', '打开设置模板', openNative); chain(pageGraph, openNative, increment(pageGraph, 'native_done'));
  const initials = graph('非默认初始开关'), initialSequence = node(initials, 'sequence');
  for (let index = 2; index < 8; index++) initialSequence.pins.push(blueprintPin('then_' + index, '第 ' + (index + 1) + ' 步', 'output'));
  const initiallyUsed = node(initials, 'doOnce', { initiallyClosed: true }), initiallyOpen = node(initials, 'gate', { initiallyClosed: false });
  chain(initials, initials.nodes[0], initialSequence);
  const operations = [[initiallyUsed, 'exec_in'], [initiallyUsed, 'reset'], [initiallyUsed, 'exec_in'], [initiallyOpen, 'exec_in'], [initiallyOpen, 'close'], [initiallyOpen, 'exec_in'], [initiallyOpen, 'reset'], [initiallyOpen, 'exec_in']] as const;
  operations.forEach(([control, entry], index) => wire(initials, initialSequence, control, 'then_' + index, entry));
  for (const [control, prefix] of [[initiallyUsed, 'once'], [initiallyOpen, 'gate']] as const) {
    wire(initials, control, increment(initials, prefix + '_hits')); wire(initials, control, increment(initials, prefix + '_blocked'), 'blocked');
    wire(initials, control, increment(initials, prefix === 'once' ? 'once_resets' : 'gate_updates'), 'updated');
  }
  const initialButton = button('control_initials', '检查初始开关'); initialButton.action = 'blueprint'; initialButton.blueprintId = initials.id;
  const rearm = node(pageGraph, 'doOnce', { scope: 'page', pageId: root.id });
  event('control_rearm_a', '完成后自动重置 / A', rearm); event('control_rearm_b', '完成后自动重置 / B', rearm);
  const rearmWait = node(pageGraph, 'delay', { seconds: .8 }); chain(pageGraph, rearm, increment(pageGraph, 'rearm_hits'), rearmWait);
  wire(pageGraph, rearmWait, rearm, 'exec_out', 'reset'); wire(pageGraph, rearm, increment(pageGraph, 'rearm_done'), 'updated'); wire(pageGraph, rearm, increment(pageGraph, 'rearm_blocked'), 'blocked');
  const busy = node(pageGraph, 'gate', { scope: 'page', pageId: root.id, initiallyClosed: false }), busySequence = node(pageGraph, 'sequence');
  event('control_busy_a', '工作期间关门 / A', busy); event('control_busy_b', '工作期间关门 / B', busy); wire(pageGraph, busy, busySequence);
  wire(pageGraph, busySequence, busy, 'then_0', 'close');
  const busyStart = increment(pageGraph, 'busy_hits'), busyEnd = increment(pageGraph, 'busy_done');
  wire(pageGraph, busySequence, busyStart, 'then_1'); chain(pageGraph, busyStart, node(pageGraph, 'delay', { seconds: .8 }), busyEnd); wire(pageGraph, busyEnd, busy, 'exec_out', 'open');
  wire(pageGraph, busy, increment(pageGraph, 'busy_blocked'), 'blocked');
  synchronizeBlueprintSignatures(project);
  return { project, root, child, pageGraph, once, gate, waitingOnce, local, localOnce, shared, sharedOnce, savedCall, savedOnce, interactive, saved, nativeGraph, nativeOnce, initials, initiallyUsed, initiallyOpen, rearm, busy, node, graph, wire, chain, increment };
}
