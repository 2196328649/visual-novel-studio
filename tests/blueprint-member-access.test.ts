import test from 'node:test';
import assert from 'node:assert/strict';
import { BLUEPRINT_MEMBER_MIME, blueprintMemberAccess, parseBlueprintMemberReference, type BlueprintMemberAction, type BlueprintMemberReference } from '../src/core/blueprint-member-access';
import { blueprintNodeDefaults, blueprintPin, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures, type BlueprintDataType } from '../src/core/blueprint';
import { createBlueprintVariable } from '../src/core/blueprint-state';
import { createProject, projectSchema, type BlueprintGraph, type BlueprintNode, type Project, type VariableValue } from '../src/core/model';
import { previewActionContext, previewActionRunner, expandPreviewActions } from '../src/core/preview-actions';
import { validateBlueprints } from '../src/core/blueprint-validation';
import { uiPageInputValues, uiPageOutputDefaults } from '../src/core/ui-page-interface';
import { uiPageCompletion } from '../src/core/ui-page-session';
import { addProjectGraphs, projectGraphs } from '../src/core/project-resources';
import { compileProject } from '../src/runtime/compiler';

function fixture() {
  const project = createProject('蓝图成员闭环'); project.id = 'member_access_project';
  const graph = createBlueprintGraph('function', '所属蓝图'); graph.id = 'member_owner';
  const other = createBlueprintGraph('function', '其他蓝图'); other.id = 'member_other';
  project.blueprints = [graph, other];
  return { project, graph, other };
}
type ReferenceFields<T = BlueprintMemberReference> = T extends BlueprintMemberReference ? Omit<T, 'version' | 'projectId'> : never;
const reference = (project: Project, fields: ReferenceFields) => parseBlueprintMemberReference(JSON.stringify({ version: 1, projectId: project.id, ...fields }));
function memberAction(project: Project, graph: BlueprintGraph, ref: BlueprintMemberReference, operation: 'read' | 'write') {
  const action = blueprintMemberAccess(project, graph, ref).actions.find(action => action.action === operation);
  assert.ok(action, `成员没有${operation}操作`); return action;
}
function insert(project: Project, graph: BlueprintGraph, action: BlueprintMemberAction) {
  const node = blueprintNodeDefaults(action.type); node.properties = { ...node.properties, ...action.properties }; graph.nodes.push(node);
  synchronizeBlueprintSignatures(project); return node;
}
function wire(graph: BlueprintGraph, from: BlueprintNode, to: BlueprintNode, fromPin = 'value', toPin = 'value') {
  assert.equal(connectBlueprintPins(graph, from.id, fromPin, to.id, toPin), undefined);
}
function chain(graph: BlueprintGraph, ...nodes: BlueprintNode[]) {
  for (let index = 1; index < nodes.length; index++) wire(graph, nodes[index - 1], nodes[index], nodes[index - 1].type === 'event' ? 'exec' : 'exec_out', 'exec_in');
}
function run(project: Project, graph: BlueprintGraph, inputs?: Record<string, VariableValue>, context = previewActionContext(project)) {
  const runner = previewActionRunner(project, [{ kind: 'blueprint', blueprintId: graph.id, inputs }], context);
  for (let step = runner.iterator.next(); !step.done; step = runner.iterator.next()) assert.fail('成员读写不应请求页面打开、等待或交互。');
  assert.equal(context.incomplete, false); assert.equal(runner.failed(), false); return { context, outputs: runner.outputs(graph.id) };
}

test('drag identities reject malformed owners and ignore cached names, values, and node recipes', () => {
  const { project, graph } = fixture();
  const variable = createBlueprintVariable(project, { scope: 'call', graphId: graph.id }, '当前定义', 'number', 0);
  const ref = parseBlueprintMemberReference(JSON.stringify({ version: 1, projectId: project.id, kind: 'variable', id: variable.id, scope: 'call', graphId: graph.id, name: '旧名称', initial: 77, type: 'switchScene', properties: { sceneId: 'other' } }));
  assert.equal(BLUEPRINT_MEMBER_MIME, 'application/vns-blueprint-member');
  assert.equal('properties' in ref, false); assert.equal('initial' in ref, false);
  const access = blueprintMemberAccess(project, graph, ref);
  assert.equal(access.name, '当前定义'); assert.equal(access.actions[1].properties.value, 0);
  for (const value of [null, [], {}, { version: 2, projectId: project.id, kind: 'input', id: 'x', graphId: graph.id }, { version: 1, projectId: project.id, kind: 'input', id: 'x' }, { version: 1, projectId: project.id, kind: 'pageInput', id: 'x', pageId: '' }, { version: 1, projectId: project.id, kind: 'variable', id: 'x', scope: 'call' }, { version: 1, projectId: project.id, kind: 'variable', id: 'x', scope: 'page' }, { version: 1, projectId: project.id, kind: 'variable', id: 'x', scope: ['project'] }]) assert.throws(() => parseBlueprintMemberReference(JSON.stringify(value)), /成员|输入|页面|变量/);
  assert.throws(() => parseBlueprintMemberReference('{'), /无法读取/);
});

test('local members use fresh definitions and execute false, zero, and empty defaults after save/reopen', () => {
  for (const [dataType, value, previous] of [['boolean', false, true], ['number', 0, 9], ['string', '', '旧值']] as const) {
    const { project, graph } = fixture();
    const variable = createBlueprintVariable(project, { scope: 'call', graphId: graph.id }, '局部值', dataType, previous);
    const ref = reference(project, { kind: 'variable', scope: 'call', graphId: graph.id, id: variable.id });
    const oldGraph = structuredClone(graph), before = JSON.stringify(project);
    assert.equal(blueprintMemberAccess(project, graph, ref).dataType, dataType); assert.equal(JSON.stringify(project), before);
    variable.initial = value; variable.name = '新局部值';
    const fresh = blueprintMemberAccess(project, oldGraph, ref); assert.equal(fresh.name, '新局部值');
    const write = insert(project, graph, fresh.actions.find(action => action.action === 'write')!);
    const read = insert(project, graph, memberAction(project, graph, ref, 'read'));
    graph.exposedOutputs = [blueprintPin('answer', '返回值', 'output', dataType, previous)];
    const output = insert(project, graph, memberAction(project, graph, reference(project, { kind: 'output', graphId: graph.id, id: 'answer' }), 'write'));
    wire(graph, read, output); chain(graph, graph.nodes[0], write, output);
    assert.equal(read.pins.find(pin => pin.id === 'value')?.dataType, dataType);
    assert.equal(write.properties.value, value);
    const restored = projectSchema.parse(JSON.parse(JSON.stringify(project))), restoredGraph = restored.blueprints.find(item => item.id === graph.id)!;
    assert.equal(run(restored, restoredGraph).outputs.answer, value);
    assert.equal(run(restored, restoredGraph).outputs.answer, value);
    assert.deepEqual(validateBlueprints(restored).filter(issue => issue.severity === 'error'), []);
  }
});

test('blueprint input and output members preserve caller values and return stable typed results', () => {
  for (const [dataType, supplied, initial] of [['boolean', false, true], ['number', 0, 9], ['string', '', '默认']] as const) {
    const { project, graph } = fixture();
    graph.exposedInputs = [blueprintPin('provided', '调用输入', 'input', dataType, initial)];
    graph.exposedOutputs = [blueprintPin('returned', '返回结果', 'output', dataType, initial)];
    const inputRef = reference(project, { kind: 'input', graphId: graph.id, id: 'provided' }), outputRef = reference(project, { kind: 'output', graphId: graph.id, id: 'returned' });
    assert.deepEqual(blueprintMemberAccess(project, graph, inputRef).actions.map(action => action.action), ['read']);
    assert.deepEqual(blueprintMemberAccess(project, graph, outputRef).actions.map(action => action.action), ['write']);
    const read = insert(project, graph, memberAction(project, graph, inputRef, 'read'));
    const output = insert(project, graph, memberAction(project, graph, outputRef, 'write'));
    wire(graph, read, output); chain(graph, graph.nodes[0], output);
    assert.equal(run(project, graph, { provided: supplied }).outputs.returned, supplied);
    assert.equal(run(project, graph).outputs.returned, initial);
    graph.exposedOutputs[0].defaultValue = supplied;
    assert.equal(memberAction(project, graph, outputRef, 'write').properties.value, supplied);
    const compiled = compileProject(project);
    assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), []);
    assert.ok(compiled.files['game/story.rpy'].includes('vn_bp_in_' + graph.id + '_provided'));
    assert.ok(compiled.files['game/story.rpy'].includes('vn_bp_out_' + graph.id + '_returned'));
  }
});

test('resource inputs are typed references that connect to their real actions and survive reload', () => {
  const { project } = fixture();
  project.assets.push({ id: 'member_image', name: '背景图片', kind: 'image', path: 'member.png' });
  project.characters.push({ id: 'member_actor', name: '角色', color: '#ffffff', expressions: [{ id: 'member_expression', name: '通常', assetId: 'member_image' }] });
  project.ui.components.push({ id: 'member_control', name: '标题文字', text: '标题', page: 'main', kind: 'text', x: 0, y: 0, width: .2, height: .1 });
  const examples: [BlueprintDataType, VariableValue, BlueprintNode['type'], string][] = [
    ['scene', project.scenes[0].id, 'switchScene', 'sceneId'], ['character', 'member_actor', 'showCharacter', 'characterId'],
    ['ui', 'ui:preferences', 'showUiPage', 'pageId'], ['component', 'member_control', 'setUiProperty', 'componentId'], ['asset', 'member_image', 'showBackground', 'assetId'],
  ];
  for (const [dataType, value, nodeType, input] of examples) {
    const graph = createBlueprintGraph('function', '引用' + dataType); graph.id = 'resource_' + dataType; project.blueprints.push(graph);
    const id = 'input_' + dataType; graph.exposedInputs.push(blueprintPin(id, '引用' + dataType, 'input', dataType, value));
    const reader = insert(project, graph, memberAction(project, graph, reference(project, { kind: 'input', graphId: graph.id, id }), 'read'));
    const consumer = blueprintNodeDefaults(nodeType); Object.assign(consumer.properties, nodeType === 'showCharacter' ? { expressionId: 'member_expression', wait: false } : nodeType === 'setUiProperty' ? { property: 'text', value: '新标题' } : nodeType === 'showUiPage' ? { pageId: 'ui:preferences' } : nodeType === 'showBackground' ? { wait: false } : {});
    graph.nodes.push(consumer); synchronizeBlueprintSignatures(project); wire(graph, reader, consumer, 'value', input);
    chain(graph, graph.nodes[0], consumer);
    assert.equal(reader.pins.find(pin => pin.id === 'value')?.dataType, dataType);
  }
  const before = JSON.stringify(project), restored = projectSchema.parse(JSON.parse(before));
  assert.equal(JSON.stringify(project), before);
  for (const [dataType, value] of examples) assert.equal(restored.blueprints.find(item => item.id === 'resource_' + dataType)!.exposedInputs.find(pin => pin.dataType === dataType)?.defaultValue, value);
  assert.deepEqual(validateBlueprints(restored).filter(issue => issue.severity === 'error'), []);
  const compiled = compileProject(restored); assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), []);
  assert.match(compiled.files['game/story.rpy'], /vn_bp_scene_label\(vn_bp_in_resource_scene_input_scene\)/);
  assert.match(compiled.files['game/story.rpy'], /vn_ui_set\(vn_bp_in_resource_component_input_component,/);
  for (const dataType of ['character', 'asset'] as const) {
    const graph = restored.blueprints.find(item => item.id === 'resource_' + dataType)!, context = previewActionContext(restored);
    const actions = expandPreviewActions(restored, [{ kind: 'blueprint', blueprintId: graph.id }], context);
    assert.equal(context.incomplete, false);
    assert.ok(actions.some(action => dataType === 'asset' ? action.kind === 'background' && action.assetId === 'member_image' : action.kind === 'show' && action.characterId === 'member_actor'));
  }
});

test('page members work from another graph with an explicit page and preserve result completion semantics', () => {
  const { project, graph, other } = fixture(); graph.uiPageId = 'ui:main';
  project.ui.pageInterfaces = { 'ui:main': { version: 1, inputs: [], outputs: [] } };
  const supplied = { flag: false, count: 0, text: '' };
  for (const [id, dataType, initial] of [['flag', 'boolean', true], ['count', 'number', 9], ['text', 'string', '默认']] as const) {
    project.ui.pageInterfaces['ui:main'].inputs.push({ id, name: id, direction: 'input', dataType, required: false, defaultValue: initial });
    project.ui.pageInterfaces['ui:main'].outputs.push({ id: id + '_result', name: id + '结果', direction: 'output', dataType, required: false, defaultValue: initial });
  }
  const outputValues: Record<string, VariableValue> = { ...uiPageOutputDefaults(project, 'ui:main') };
  const inputValues = uiPageInputValues(project, 'ui:main', supplied);
  let tail = other.nodes[0];
  for (const id of ['flag', 'count', 'text'] as const) {
    const inputRef = reference(project, { kind: 'pageInput', pageId: 'ui:main', id });
    const outputRef = reference(project, { kind: 'pageOutput', pageId: 'ui:main', id: id + '_result' });
    assert.deepEqual(blueprintMemberAccess(project, other, inputRef).actions.map(action => action.action), ['read']);
    assert.deepEqual(blueprintMemberAccess(project, other, outputRef).actions.map(action => action.action), ['read', 'write']);
    const read = insert(project, other, memberAction(project, other, inputRef, 'read'));
    const write = insert(project, other, memberAction(project, other, outputRef, 'write'));
    wire(other, read, write); chain(other, tail, write); tail = write;
    const resultRead = insert(project, other, memberAction(project, other, outputRef, 'read'));
    const outputType = resultRead.pins.find(pin => pin.id === 'value')!.dataType;
    other.exposedOutputs.push(blueprintPin('observed_' + id, '已暂存' + id, 'output', outputType, supplied[id]));
    const observed = insert(project, other, memberAction(project, other, reference(project, { kind: 'output', graphId: other.id, id: 'observed_' + id }), 'write'));
    wire(other, resultRead, observed); chain(other, tail, observed); tail = observed;
    assert.equal(write.properties.pageId, 'ui:main');
    assert.equal(read.pins.find(pin => pin.id === 'value')?.dataType, typeof supplied[id]);
  }
  const context = previewActionContext(project);
  context.pageInterface = { phase: () => undefined, get: (page, direction, id) => page === 'ui:main' ? (direction === 'inputs' ? inputValues : outputValues)[id] : undefined, setOutput: (page, id, value) => { if (page !== 'ui:main') return false; outputValues[id] = value; return true; }, preventClose: () => false };
  assert.deepEqual(run(project, other, undefined, context).outputs, { observed_flag: false, observed_count: 0, observed_text: '' });
  assert.deepEqual(outputValues, { flag_result: false, count_result: 0, text_result: '' });
  assert.deepEqual(uiPageCompletion(project, 'ui:main', '完成', 'completed', outputValues).outputs, outputValues);
  assert.deepEqual(uiPageCompletion(project, 'ui:main', '取消', 'cancelled', outputValues).outputs, uiPageOutputDefaults(project, 'ui:main'));
  const compiled = compileProject(project);
  assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), []);
  assert.match(compiled.files['game/story.rpy'], /vn_ui_interface_get\("ui:main", "inputs", "flag", "boolean"\)/);
  assert.match(compiled.files['game/story.rpy'], /vn_ui_interface_set_output\("ui:main", "flag_result",/);
});

test('page state and persistent project members retain their distinct storage and fresh defaults', () => {
  const { project, graph, other } = fixture();
  const page = createBlueprintVariable(project, { scope: 'page', pageId: 'ui:main' }, '页面计数', 'number', 0);
  project.variables.push({ id: 'shared_member', name: '作品值', type: 'number', initial: 0, persistent: false }, { id: 'player_member', name: '玩家值', type: 'boolean', initial: false, persistent: true });
  const pageRef = reference(project, { kind: 'variable', scope: 'page', pageId: 'ui:main', id: page.id });
  const pageWrite = insert(project, other, memberAction(project, other, pageRef, 'write'));
  const pageRead = insert(project, other, memberAction(project, other, pageRef, 'read'));
  const projectRef = reference(project, { kind: 'variable', scope: 'project', id: 'shared_member' }), playerRef = reference(project, { kind: 'variable', scope: 'player', id: 'player_member' });
  const sharedWrite = insert(project, other, memberAction(project, other, projectRef, 'write'));
  const playerWrite = insert(project, other, memberAction(project, other, playerRef, 'write'));
  wire(other, pageRead, sharedWrite); chain(other, other.nodes[0], pageWrite, sharedWrite, playerWrite);
  let pageValue: VariableValue = 17;
  const context = previewActionContext(project); context.variables.player_member = true;
  context.pageState = { get: (pageId, id) => pageId === 'ui:main' && id === page.id ? pageValue : undefined, set: (pageId, id, value) => { if (pageId !== 'ui:main' || id !== page.id) return false; pageValue = value; return true; } };
  run(project, other, undefined, context);
  assert.equal(pageValue, 0); assert.equal(context.variables.shared_member, 0); assert.equal(context.variables.player_member, false);
  project.variables.find(variable => variable.id === 'shared_member')!.initial = 23;
  assert.equal(memberAction(project, graph, projectRef, 'write').properties.value, 23);
  const compiled = compileProject(project);
  assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), []);
  assert.match(compiled.files['game/story.rpy'], /vn_ui_state_set\("ui:main",/);
});

test('owner, scope, deletion and interface-version checks reject identities without changing the graph', () => {
  const { project, graph, other } = fixture();
  const local = createBlueprintVariable(project, { scope: 'call', graphId: graph.id }, '同名', 'number', 0);
  createBlueprintVariable(project, { scope: 'call', graphId: other.id }, '同名', 'number', 9);
  graph.exposedInputs = [blueprintPin('input', '同名', 'input', 'number', 0)]; other.exposedInputs = [blueprintPin('input', '同名', 'input', 'number', 9)];
  graph.exposedOutputs = [blueprintPin('output', '结果', 'output', 'number', 0)];
  project.variables.push({ id: 'shared', name: '共享', type: 'boolean', initial: false, persistent: false });
  project.ui.pageInterfaces = { 'ui:main': { version: 1, inputs: [{ id: 'page_input', name: '同名', direction: 'input', dataType: 'number', required: false, defaultValue: 0 }], outputs: [] } };
  const localRef = reference(project, { kind: 'variable', scope: 'call', graphId: graph.id, id: local.id });
  const inputRef = reference(project, { kind: 'input', graphId: graph.id, id: 'input' });
  const outputRef = reference(project, { kind: 'output', graphId: graph.id, id: 'output' });
  const pageRef = reference(project, { kind: 'pageInput', pageId: 'ui:main', id: 'page_input' });
  const before = JSON.stringify(project);
  for (const ref of [localRef, inputRef, outputRef]) assert.throws(() => blueprintMemberAccess(project, other, ref), /所属蓝图/);
  assert.throws(() => blueprintMemberAccess(project, graph, { ...inputRef, projectId: 'other_project' }), /跨工程/);
  assert.throws(() => blueprintMemberAccess(project, graph, reference(project, { kind: 'variable', scope: 'player', id: 'shared' })), /作用域已变化/);
  assert.throws(() => blueprintMemberAccess(project, graph, reference(project, { kind: 'pageInput', pageId: 'missing', id: 'page_input' })), /页面已不存在/);
  assert.equal(JSON.stringify(project), before);
  graph.localVariables = []; graph.exposedInputs = []; graph.exposedOutputs = [];
  for (const ref of [localRef, inputRef, outputRef]) assert.throws(() => blueprintMemberAccess(project, graph, ref), /定义已不存在/);
  project.ui.pageInterfaces['ui:main'].version = 2;
  assert.throws(() => blueprintMemberAccess(project, graph, pageRef), /版本不受支持/);
  project.ui.pageInterfaces['ui:main'].version = 1; project.ui.pageInterfaces['ui:main'].inputs[0].id = 'replacement';
  assert.throws(() => blueprintMemberAccess(project, graph, pageRef), /定义已不存在/);
  project.blueprints = project.blueprints.filter(item => item.id !== graph.id);
  assert.throws(() => blueprintMemberAccess(project, graph, pageRef), /当前蓝图已不存在/);
});

test('timeline resources use their own current interface instead of a same-name ordinary blueprint', () => {
  const { project, graph } = fixture();
  const timeline = createBlueprintGraph('effect', graph.name); timeline.timelineComponent = true;
  timeline.exposedInputs = [blueprintPin('input', '输入', 'input', 'number', 0)]; addProjectGraphs(project, timeline);
  const ref = reference(project, { kind: 'input', graphId: timeline.id, id: 'input' });
  const read = insert(project, timeline, memberAction(project, timeline, ref, 'read'));
  assert.equal(read.pins.find(pin => pin.id === 'value')?.dataType, 'number');
  assert.throws(() => blueprintMemberAccess(project, graph, ref), /所属蓝图/);
  const restored = projectSchema.parse(JSON.parse(JSON.stringify(project))), current = projectGraphs(restored).find(item => item.id === timeline.id)!;
  assert.equal(blueprintMemberAccess(restored, current, ref).name, '输入');
});

test('project media parameters remain asset references and retain consumer media-kind diagnostics', () => {
  const { project, graph } = fixture();
  project.assets.push({ id: 'member_image', name: '图片', kind: 'image', path: 'member.png' });
  project.variables.push({ id: 'image_member', name: '背景引用', type: 'asset', assetKind: 'image', initial: 'member_image', persistent: false });
  const ref = reference(project, { kind: 'variable', scope: 'project', id: 'image_member' });
  const access = blueprintMemberAccess(project, graph, ref); assert.equal(access.dataType, 'asset');
  const write = insert(project, graph, memberAction(project, graph, ref, 'write'));
  const read = insert(project, graph, memberAction(project, graph, ref, 'read'));
  const background = blueprintNodeDefaults('showBackground'); background.properties.wait = false; graph.nodes.push(background); synchronizeBlueprintSignatures(project);
  wire(graph, read, background, 'value', 'assetId'); chain(graph, graph.nodes[0], write, background);
  const context = previewActionContext(project); context.variables.image_member = '';
  const actions = expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: graph.id }], context);
  assert.equal(context.incomplete, false); assert.equal(context.variables.image_member, 'member_image');
  assert.ok(actions.some(action => action.kind === 'background' && action.assetId === 'member_image'));
  assert.deepEqual(validateBlueprints(project).filter(issue => issue.severity === 'error'), []);
  const music = blueprintNodeDefaults('playMusic'); graph.nodes.push(music); synchronizeBlueprintSignatures(project); wire(graph, read, music, 'value', 'assetId');
  assert.ok(validateBlueprints(project).some(issue => issue.nodeId === music.id && /素材类型不匹配/.test(issue.message)));
  assert.equal(write.properties.value, 'member_image');
});
