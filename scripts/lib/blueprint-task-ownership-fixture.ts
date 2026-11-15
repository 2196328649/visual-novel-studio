import assert from 'node:assert/strict';
import { createProject, type BlueprintGraph, type BlueprintNode, type UiComponent, type VariableValue } from '../../src/core/model';
import { blueprintNodeDefaults, blueprintPin, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../../src/core/blueprint';
import { createUiEventGraph, ensureUiClickEvent } from '../../src/core/ui-logic';

/** Capacity, completion ordering, dependency cycles and exact resource owners. */
export function createBlueprintTaskOwnershipFixture() {
  const project = createProject('任务容量、依赖与所有者'); project.id = 'task_ownership_fixture'; project.width = 1280; project.height = 720;
  for (const [id, initial] of Object.entries({ ownership_assigned: 0, ownership_blocked: 0, ownership_last: '', ownership_first: '', ownership_old: '', ownership_replace: '', ownership_ignore: '',
    ownership_delay: 60, ownership_parent: '', ownership_call_child: '', ownership_page_child: '', ownership_side_effect: 0, ownership_late: 0,
    ownership_a: '', ownership_b: '', ownership_c: '', ownership_resumes: 0, ownership_animation: '', ownership_wait_cancelled: 0, ownership_wait_completed: 0 })) {
    project.variables.push({ id, name: id, type: typeof initial as 'number' | 'string', initial, persistent: false });
  }
  const components: UiComponent[] = [
    { id: 'ownership_target_a', page: 'custom', kind: 'panel', text: '', x: .08, y: .04, width: .32, height: .18, style: { background: '#e3a34a' } },
    { id: 'ownership_target_b', page: 'custom', kind: 'panel', text: '', x: .6, y: .04, width: .32, height: .18, style: { background: '#4da8d6' } },
  ];
  const page = { id: 'ownership_page', name: '任务所有者场景', modal: true, background: '#223442', components }; project.ui.customPages.push(page);
  let serial = 0;
  const graph = (name: string) => { const g = createBlueprintGraph('function', name); project.blueprints.push(g); return g; };
  const node = (owner: BlueprintGraph, type: BlueprintNode['type'], properties: Record<string, VariableValue> = {}) => {
    const n = blueprintNodeDefaults(type); n.id = 'ownership_node_' + ++serial; Object.assign(n.properties, properties); n.x = 80 + serial % 5 * 340; n.y = 200 + Math.floor(serial / 5) * 240;
    owner.nodes.push(n); synchronizeBlueprintSignatures(project); return n;
  };
  const wire = (g: BlueprintGraph, a: BlueprintNode, b: BlueprintNode, from = 'exec_out', to = 'exec_in') => { synchronizeBlueprintSignatures(project); assert.equal(connectBlueprintPins(g, a.id, a.type.startsWith('event') && from === 'exec_out' ? 'exec' : from, b.id, to), undefined); };
  const chain = (g: BlueprintGraph, ...nodes: BlueprintNode[]) => nodes.slice(1).forEach((n, i) => wire(g, nodes[i], n));
  const increment = (g: BlueprintGraph, id: string) => { const read = node(g, 'getVariable', { variableId: id }), add = node(g, 'math', { b: 1 }), set = node(g, 'setVariable', { variableId: id }); wire(g, read, add, 'value', 'a'); wire(g, add, set, 'result', 'value'); return set; };
  const storeHandle = (g: BlueprintGraph, task: BlueprintNode, id: string) => { const set = node(g, 'setVariable', { variableId: id }); wire(g, task, set); wire(g, task, set, 'handle', 'value'); return set; };
  const pageGraph = createUiEventGraph(project, page.id, '容量与所有权事件');
  const actions = [['fill', '安排 128 个任务'], ['single', '额外安排一个'], ['old', '延迟完成的早期任务'], ['replace', '替换本节点任务'], ['ignore', '忽略本节点重入'],
    ['cycles', '三任务依赖环'], ['parent', '嵌套父任务与子任务'], ['cancelParent', '取消父任务'], ['clip', '多轨等待任务'], ['override', '替换其中一轨'],
    ['cancelAnimation', '取消旧动画任务'], ['detached', '完成后的动画继续'], ['wait', '外部等待动画任务'], ['close', '关闭所有者页面']] as const;
  const event = (name: typeof actions[number][0]) => ensureUiClickEvent(project, pageGraph, 'ownership_action_' + name.toLowerCase(), page.id);
  page.components.push(...actions.map(([id, text], i): UiComponent => ({ id: 'ownership_action_' + id.toLowerCase(), page: 'custom', kind: 'button', text, x: .035 + i % 4 * .245, y: .3 + Math.floor(i / 4) * .16, width: .22, height: .12, style: { fontSize: 20 }, ...(id === 'close' ? { action: 'return' as const } : {}) })));
  const fast = graph('立即完成的标量结果'); fast.exposedOutputs = [blueprintPin('false_value', '明确否', 'output', 'boolean', true), blueprintPin('empty_value', '明确空文字', 'output', 'string', '默认')];
  chain(fast, fast.nodes[0], node(fast, 'setOutput', { outputId: 'false_value', value: false }), node(fast, 'setOutput', { outputId: 'empty_value', value: '' }));
  const launch = (g: BlueprintGraph, target: BlueprintGraph, options: Record<string, VariableValue> = {}) => node(g, 'startTask', { graphId: target.id, scope: 'page', pageId: page.id, seconds: 0, conflict: 'parallel', ...options });
  const mass = node(pageGraph, 'forLoop', { firstIndex: 0, lastIndex: 127 }), massStart = launch(pageGraph, fast);
  wire(pageGraph, event('fill'), mass); wire(pageGraph, mass, massStart, 'loop_body'); wire(pageGraph, node(pageGraph, 'getVariable', { variableId: 'ownership_delay' }), massStart, 'value', 'seconds');
  const massStore = storeHandle(pageGraph, massStart, 'ownership_last'); wire(pageGraph, massStore, increment(pageGraph, 'ownership_assigned')); wire(pageGraph, massStart, increment(pageGraph, 'ownership_blocked'), 'blocked');
  const starts: Record<string, BlueprintNode> = { fill: massStart };
  for (const name of ['single', 'old', 'replace', 'ignore'] as const) {
    const start = starts[name] = launch(pageGraph, fast, { seconds: name === 'old' ? 30 : 60, conflict: name === 'replace' ? 'replace' : name === 'ignore' ? 'ignore' : 'parallel' });
    wire(pageGraph, event(name), start); const store = storeHandle(pageGraph, start, name === 'single' ? 'ownership_first' : 'ownership_' + name);
    wire(pageGraph, store, increment(pageGraph, 'ownership_assigned')); wire(pageGraph, start, increment(pageGraph, 'ownership_blocked'), 'blocked');
  }
  const cycles = ['a', 'b', 'c'].map(name => graph('等待依赖 ' + name)), cycleWaits: BlueprintNode[] = [];
  let cycleTail = event('cycles');
  for (const [i, target] of cycles.entries()) {
    const start = launch(pageGraph, target); wire(pageGraph, cycleTail, start); cycleTail = storeHandle(pageGraph, start, 'ownership_' + ['a', 'b', 'c'][i]);
    const wait = node(target, 'waitTask', { graphId: cycles[(i + 1) % 3].id }); cycleWaits.push(wait);
    wire(target, target.nodes[0], wait); wire(target, node(target, 'getVariable', { variableId: 'ownership_' + ['b', 'c', 'a'][i] }), wait, 'value', 'handle');
    wire(target, wait, increment(target, 'ownership_resumes'), 'completed'); wire(target, wait, increment(target, 'ownership_resumes'), 'failed');
  }
  const leaf = graph('子任务延迟结果'); leaf.exposedOutputs = structuredClone(fast.exposedOutputs);
  chain(leaf, leaf.nodes[0], node(leaf, 'delay', { seconds: 1 }), node(leaf, 'setOutput', { outputId: 'false_value', value: false }), node(leaf, 'setOutput', { outputId: 'empty_value', value: '' }));
  const inner = graph('嵌套调用帧持有的子任务'); inner.exposedInputs = [blueprintPin('lifetime', '父任务等待秒数', 'input', 'number', 10)];
  const callChild = launch(inner, leaf, { scope: 'call', pageId: '' }), pageChild = launch(inner, leaf);
  chain(inner, inner.nodes[0], node(inner, 'setVariable', { variableId: 'ownership_side_effect', value: 42 }), callChild);
  const ownStore = storeHandle(inner, callChild, 'ownership_call_child'); wire(inner, ownStore, pageChild);
  const detachedStore = storeHandle(inner, pageChild, 'ownership_page_child'), hold = node(inner, 'delay'); wire(inner, detachedStore, hold);
  wire(inner, node(inner, 'getInput', { inputId: 'lifetime' }), hold, 'value', 'seconds'); wire(inner, hold, increment(inner, 'ownership_late'));
  const parent = graph('父任务调用嵌套模块'); parent.exposedInputs = structuredClone(inner.exposedInputs);
  const innerCall = node(parent, 'callFunction', { graphId: inner.id }); wire(parent, parent.nodes[0], innerCall); wire(parent, node(parent, 'getInput', { inputId: 'lifetime' }), innerCall, 'value', 'arg_lifetime');
  const parentStart = starts.parent = launch(pageGraph, parent, { arg_lifetime: 10 }); wire(pageGraph, event('parent'), parentStart); storeHandle(pageGraph, parentStart, 'ownership_parent');
  const cancel = (name: 'cancelParent' | 'cancelAnimation', variableId: string) => { const stop = node(pageGraph, 'cancelTask'); wire(pageGraph, event(name), stop); wire(pageGraph, node(pageGraph, 'getVariable', { variableId }), stop, 'value', 'handle'); return stop; };
  cancel('cancelParent', 'ownership_parent'); cancel('cancelAnimation', 'ownership_animation');
  const clip = { id: 'ownership_clip', name: '双轨动画', pageId: page.id, duration: 2, tracks: ['a', 'b'].map(name => ({ id: 'ownership_track_' + name, componentId: 'ownership_target_' + name, property: 'opacity' as const,
    keys: [{ id: 'ownership_key_' + name + '_0', time: 0, value: 1, easing: 'linear' as const }, { id: 'ownership_key_' + name + '_1', time: 2, value: 0, easing: 'linear' as const }] })) };
  project.ui.animations ??= []; project.ui.animations.push(clip);
  const animated = graph('等待双轨动画任务'); chain(animated, animated.nodes[0], node(animated, 'playUiAnimation', { animationId: clip.id, playMode: 'forward', loops: 1, speed: 1, fromCurrent: false, wait: true }), increment(animated, 'ownership_late'));
  const animationStart = starts.clip = launch(pageGraph, animated); wire(pageGraph, event('clip'), animationStart); storeHandle(pageGraph, animationStart, 'ownership_animation');
  wire(pageGraph, event('override'), node(pageGraph, 'animateUiProperty', { componentId: 'ownership_target_a', property: 'opacity', value: 1, duration: .4, wait: false }));
  const detachedAnimation = graph('任务正常返回后动画继续'); detachedAnimation.exposedInputs = [blueprintPin('hold', '任务尾部等待', 'input', 'number', .15)];
  const detachedHold = node(detachedAnimation, 'delay'); wire(detachedAnimation, node(detachedAnimation, 'getInput', { inputId: 'hold' }), detachedHold, 'value', 'seconds');
  chain(detachedAnimation, detachedAnimation.nodes[0], node(detachedAnimation, 'animateUiProperty', { componentId: 'ownership_target_a', property: 'opacity', value: 0, duration: 1, wait: false }), detachedHold);
  const detachedStart = starts.detached = launch(pageGraph, detachedAnimation); wire(pageGraph, event('detached'), detachedStart); storeHandle(pageGraph, detachedStart, 'ownership_animation');
  const wait = node(pageGraph, 'waitTask', { graphId: animated.id }); wire(pageGraph, event('wait'), wait); wire(pageGraph, node(pageGraph, 'getVariable', { variableId: 'ownership_animation' }), wait, 'value', 'handle');
  wire(pageGraph, wait, increment(pageGraph, 'ownership_wait_cancelled'), 'cancelled'); wire(pageGraph, wait, increment(pageGraph, 'ownership_wait_completed'), 'completed');
  const open = graph('打开任务所有者场景'); chain(open, open.nodes[0], node(open, 'showUiPage', { pageId: page.id, wait: true }));
  const passage = project.nodes.find(n => n.kind === 'passage'); if (!passage || passage.kind !== 'passage') throw Error('Missing passage'); passage.lines[0].text = '任务所有者页关闭后继续。'; passage.lines[0].actions = [{ kind: 'blueprint', blueprintId: open.id }];
  synchronizeBlueprintSignatures(project);
  return { project, page, pageGraph, fast, mass, massStart, starts, cycles, cycleWaits, leaf, inner, innerCall, parent, parentStart, animated, detachedAnimation, clip, wait, open, graph, node, wire, chain };
}
