import assert from 'node:assert/strict';
import { createProject, newNode, type BlueprintGraph, type BlueprintNode, type UiComponent, type UiPageParameter, type VariableValue } from '../../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../../src/core/blueprint';
import { createCustomUiPage } from '../../src/core/game-flow';
import { uiPage, uiPages } from '../../src/core/ui-pages';
import { uiPageParameterTypes } from '../../src/core/ui-page-interface';

/** Author data shared by interpreter, editor, and real Ren'Py acceptance. */
export function createUiPageInterfaceFixture({ allMenus = false }: { allMenus?: boolean } = {}) {
  const project = createProject('统一页面接口与生命周期验收'); project.id = 'page_interface_acceptance';
  const counters = ['created_count', 'shown_count', 'focus_count', 'blur_count', 'request_count', 'closed_count', 'resumed_count', 'already_count', 'input_seen', 'closed_input', 'closed_number', 'result_number', 'request_delay'];
  for (const id of counters) project.variables.push({ id, name: id, type: 'number', initial: 0, persistent: false });
  for (const id of ['closed_flag', 'result_flag', 'veto', 'ask_confirm']) project.variables.push({ id, name: id, type: 'boolean', initial: id === 'closed_flag' || id === 'result_flag', persistent: false });
  for (const id of ['order', 'closed_text', 'result_text', 'result_reason', 'duplicate_reason']) project.variables.push({ id, name: id, type: 'string', initial: '', persistent: false });
  const graph = (name: string) => { const g = createBlueprintGraph('function', name); project.blueprints.push(g); return g; };
  const node = (g: BlueprintGraph, type: BlueprintNode['type'], properties: BlueprintNode['properties'] = {}) => { const n = blueprintNodeDefaults(type, g.nodes.length); Object.assign(n.properties, properties); g.nodes.push(n); return n; };
  const wire = (g: BlueprintGraph, a: BlueprintNode, b: BlueprintNode, from = 'exec_out', to = 'exec_in') => { synchronizeBlueprintSignatures(project); assert.equal(connectBlueprintPins(g, a.id, a.type.startsWith('event') && from === 'exec_out' ? 'exec' : from, b.id, to), undefined); };
  const chain = (g: BlueprintGraph, ...items: BlueprintNode[]) => items.slice(1).forEach((item, i) => wire(g, items[i], item));
  const increment = (g: BlueprintGraph, id: string) => { const read = node(g, 'getVariable', { variableId: id }), add = node(g, 'math', { b: 1 }), set = node(g, 'setVariable', { variableId: id }); wire(g, read, add, 'value', 'a'); wire(g, add, set, 'result', 'value'); return set; };
  const order = (g: BlueprintGraph, value: string) => { const read = node(g, 'getVariable', { variableId: 'order' }), text = node(g, 'formatText', { format: '{value}' + value }), set = node(g, 'setVariable', { variableId: 'order' }); wire(g, read, text, 'value', 'value'); wire(g, text, set, 'text', 'value'); return set; };
  const parent = createCustomUiPage(project, '调用者页面'), child = createCustomUiPage(project, '有类型接口的页面');
  const parentGraph = project.blueprints.find(g => g.uiPageId === parent.id)!, childGraph = project.blueprints.find(g => g.uiPageId === child.id)!;
  for (const page of [parent, child]) { page.components[0].y = .02; page.components[1].y = .88; }
  project.assets.push({ id: 'page_only_asset', name: '页面接口独占引用', kind: 'image', path: 'assets/interface.png', width: 1, height: 1 });
  project.characters.push({ id: 'page_character', name: '引用角色', color: '#ffffff', expressions: [] });
  const supplied: Record<string, VariableValue> = { number: 0, boolean: false, string: '', asset: 'page_only_asset', scene: project.scenes[0].id, character: 'page_character', ui: parent.id, component: parent.components[1].id };
  const inputs: UiPageParameter[] = Object.entries(uiPageParameterTypes).map(([type, name]) => ({ id: type, name: name + '输入', dataType: type as UiPageParameter['dataType'], direction: 'input', required: false, defaultValue: type === 'number' ? 17 : type === 'boolean' ? true : type === 'string' ? '输入默认' : supplied[type] }));
  const outputs: UiPageParameter[] = inputs.map(pin => ({ ...pin, id: pin.id + '_result', name: pin.name.replace('输入', '结果'), direction: 'output', defaultValue: pin.dataType === 'number' ? -7 : pin.dataType === 'boolean' ? true : pin.dataType === 'string' ? '输出默认' : '' }));
  project.ui.pageInterfaces = {};
  const attach = (pageId: string, g: BlueprintGraph, components: UiComponent[], prefix: string) => {
    project.ui.pageInterfaces![pageId] = { version: 1, inputs: structuredClone(inputs), outputs: structuredClone(outputs) };
    const descriptor = uiPage(project, pageId)!;
    g.uiPageId = pageId; if (descriptor.template) g.uiInstanceId = 'base';
    const button = (suffix: string, text: string, action?: UiComponent['action']) => { const i = components.filter(c => c.id.startsWith(prefix)).length; const c: UiComponent = { id: prefix + suffix, name: text, text, page: descriptor.kind, kind: 'button', x: .08 + (i % 3) * .31, y: .19 + Math.floor(i / 3) * .14, width: .27, height: .105, ...(action ? { action } : {}) }; components.push(c); return c; };
    const event = (suffix: string, text: string) => node(g, 'eventClick', { componentId: button(suffix, text).id });
    const life = (phase: string) => node(g, 'eventPage', { pageId, phase });
    const created = life('created'), readInput = node(g, 'getPageInput', { pageId, parameterId: 'number' }), inputSeen = node(g, 'setVariable', { variableId: 'input_seen' });
    wire(g, readInput, inputSeen, 'value', 'value'); chain(g, created, increment(g, 'created_count'), order(g, 'C'), inputSeen);
    chain(g, g.nodes.find(n => n.type === 'event')!, increment(g, 'shown_count'), order(g, 'S'));
    chain(g, life('focusGained'), increment(g, 'focus_count'), order(g, 'F'));
    const blur = life('focusLost'); chain(g, blur, increment(g, 'blur_count'), order(g, 'L'));
    const requested = life('closeRequested'), wait = node(g, 'delay'), condition = node(g, 'branch'), prevent = node(g, 'preventPageClose', { pageId });
    wire(g, node(g, 'getVariable', { variableId: 'request_delay' }), wait, 'value', 'seconds'); wire(g, node(g, 'getVariable', { variableId: 'veto' }), condition, 'value', 'condition');
    const ask = node(g, 'branch'), confirm = node(g, 'confirmMessage', { message: '确认关闭当前页面？' });
    wire(g, node(g, 'getVariable', { variableId: 'ask_confirm' }), ask, 'value', 'condition');
    chain(g, requested, increment(g, 'request_count'), order(g, 'R'), wait, ask); wire(g, ask, condition, 'false'); wire(g, ask, confirm, 'true'); wire(g, confirm, condition, 'yes'); wire(g, confirm, prevent, 'no'); wire(g, condition, prevent, 'true');
    const closed = life('closed'), closedInput = node(g, 'setVariable', { variableId: 'closed_input' }); wire(g, readInput, closedInput, 'value', 'value');
    let previous = order(g, 'X'); chain(g, closed, increment(g, 'closed_count'), previous, closedInput); previous = closedInput;
    for (const [id, variable] of [['number', 'closed_number'], ['boolean', 'closed_flag'], ['string', 'closed_text']]) { const read = node(g, 'getPageOutput', { pageId, parameterId: id + '_result' }), set = node(g, 'setVariable', { variableId: variable }); wire(g, read, set, 'value', 'value'); chain(g, previous, set); previous = set; }
    const module = graph('嵌套读写页面接口 · ' + descriptor.name); let tail = module.nodes[0];
    for (const pin of inputs) { const read = node(module, 'getPageInput', { pageId, parameterId: pin.id }), set = node(module, 'setPageOutput', { pageId, parameterId: pin.id + '_result' }); wire(module, read, set, 'value', 'value'); wire(module, tail, set); tail = set; }
    const stage = event('stage', '暂存所有输入为结果'); chain(g, stage, node(g, 'callFunction', { graphId: module.id }));
    const complete = node(g, 'closeUiPage', { pageId, result: '完成', reason: 'completed' }); wire(g, event('complete', '正常完成'), complete);
    const override = node(g, 'closeUiPage', { pageId, result: '覆盖', reason: 'completed', out_number_result: 9 }); wire(g, event('override', '覆盖数值结果'), override);
    const cancel = node(g, 'closeUiPage', { pageId, result: '取消', reason: 'cancelled' }); wire(g, event('cancel', '取消并丢弃部分结果'), cancel);
    const duplicate = node(g, 'showUiPage', { pageId, wait: true, arg_number: 55 }), duplicateReason = node(g, 'setVariable', { variableId: 'duplicate_reason' }); wire(g, duplicate, duplicateReason, 'reason', 'value'); chain(g, event('duplicate', '重复打开当前页面'), duplicate, increment(g, 'already_count'), duplicateReason);
    if (descriptor.template) button('back', '系统返回', 'return');
    else wire(g, event('parent', '关闭上层并强制清理子页'), node(g, 'closeUiPage', { pageId: parent.id, reason: 'completed' }));
    return { pageId, graph: g, components, prefix, created, blur, requested, wait, prevent, closed, readInput, module, complete, override, cancel, duplicate };
  };
  const childHooks = attach(child.id, childGraph, child.components, 'pi_child_');
  child.components.push({ id: 'pi_child_action_return', name: '按钮直接关闭', text: '按钮直接关闭', kind: 'button', page: 'custom', action: 'return', x: .68, y: .76, width: .27, height: .1 });
  let buttonCount = 0;
  const openFromParent = (pageId: string, prefix: string) => {
    const i = buttonCount++, button: UiComponent = { id: prefix, text: '打开 · ' + uiPage(project, pageId)!.name, kind: 'button', page: 'custom', x: .06 + (i % 3) * .31, y: .16 + Math.floor(i / 3) * .13, width: .28, height: .10 }; parent.components.push(button);
    const open = node(parentGraph, 'showUiPage', { pageId, wait: true, ...Object.fromEntries(Object.entries(supplied).map(([id, value]) => ['arg_' + id, value])) });
    chain(parentGraph, node(parentGraph, 'eventClick', { componentId: button.id }), open);
    let previous = open;
    for (const [pin, variable] of [['out_number_result', 'result_number'], ['out_boolean_result', 'result_flag'], ['out_string_result', 'result_text'], ['reason', 'result_reason']]) { const set = node(parentGraph, 'setVariable', { variableId: variable }); wire(parentGraph, open, set, pin, 'value'); wire(parentGraph, previous, set); previous = set; }
    wire(parentGraph, previous, increment(parentGraph, 'resumed_count')); return { open, button };
  };
  const childOpen = openFromParent(child.id, 'pi_open_child');
  const menus = uiPages(project).filter(page => page.menuScreen && (allMenus || ['ui:preferences', 'ui:staff'].includes(page.id))).map(page => {
    const g = graph('模板接口事件 · ' + page.name); g.kind = 'ui'; const components: UiComponent[] = [];
    const hooks = attach(page.id, g, components, 'pi_' + page.kind.toLowerCase() + '_'); project.ui.components.push(...components);
    (project.ui.pages ??= {})[page.kind] = { ...project.ui.pages?.[page.kind], layout: 'custom' };
    return { ...hooks, screen: page.menuScreen!, ...openFromParent(page.id, 'pi_open_' + page.kind.toLowerCase()) };
  });
  const preferences = menus.find(page => page.pageId === 'ui:preferences')!;
  project.ui.components.push({ id: 'pi_replace_menu', text: '替换为制作人员模板', kind: 'button', page: 'preferences', action: 'staff', x: .68, y: .68, width: .27, height: .10 });
  const open = graph('打开页面接口验收'); chain(open, open.nodes[0], node(open, 'showUiPage', { pageId: parent.id, wait: true }));
  const intro = project.nodes.find(n => n.kind === 'passage')!; assert.equal(intro.kind, 'passage'); intro.lines[0].text = '准备验收统一页面接口。';
  const interactive = newNode('passage', project.scenes[0].id); assert.equal(interactive.kind, 'passage'); Object.assign(interactive, { id: 'page_interface_interactive', next: intro.id }); interactive.lines[0].text = '页面接口验收已返回。'; interactive.lines[0].actions = [{ kind: 'blueprint', blueprintId: open.id }]; project.nodes.push(interactive);
  const savedCall = graph('可保存的基础调用页面'), savedOpen = node(savedCall, 'showUiPage', { pageId: child.id, wait: true, ...Object.fromEntries(Object.entries(supplied).map(([id, value]) => ['arg_' + id, value])) });
  wire(savedCall, savedCall.nodes[0], savedOpen); let savedTail = savedOpen;
  for (const [pin, variable] of [['out_number_result', 'result_number'], ['out_boolean_result', 'result_flag'], ['out_string_result', 'result_text'], ['reason', 'result_reason']]) { const set = node(savedCall, 'setVariable', { variableId: variable }); wire(savedCall, savedOpen, set, pin, 'value'); wire(savedCall, savedTail, set); savedTail = set; }
  wire(savedCall, savedTail, increment(savedCall, 'resumed_count'));
  const saved = newNode('passage', project.scenes[0].id); assert.equal(saved.kind, 'passage'); Object.assign(saved, { id: 'page_interface_saved', next: intro.id }); saved.lines[0].text = '存档页面已返回。'; saved.lines[0].actions = [{ kind: 'blueprint', blueprintId: savedCall.id }]; project.nodes.push(saved);
  synchronizeBlueprintSignatures(project);
  return { saved, savedCall, savedOpen, project, parent, child, parentGraph, childGraph, childHooks, childOpen, menus, preferences, open, interactive, supplied, inputs, outputs, graph, node, wire, chain, increment, attach };
}

// A locally specified, transparent PNG; materialized only inside an isolated acceptance run.
export const pageInterfacePng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
