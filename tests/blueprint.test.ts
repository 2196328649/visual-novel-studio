import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { blueprintNodeDefaults, blueprintPin, callablePins, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { createProject, projectSchema } from '../src/core/model';
import { validateBlueprints } from '../src/core/blueprint-validation';
import { compileProject } from '../src/runtime/compiler';
import { blueprintVerificationProject } from '../scripts/fixtures/blueprint-project';

const sample = projectSchema.parse(JSON.parse(readFileSync(new URL('../resources/example/project.vns.json', import.meta.url), 'utf8')));

test('blueprint character positions accept coordinates outside the screen', () => {
  const project = blueprintVerificationProject(sample);
  const node = project.blueprints.flatMap(graph => graph.nodes).find(node => node.id === 'bp_show')!;
  node.properties.x = -.5; node.properties.y = 1.4;
  assert.deepEqual(validateBlueprints(project).filter(issue => issue.severity === 'error'), []);
  assert.equal(projectSchema.safeParse(project).success, true);
  const story = compileProject(project).files['game/story.rpy'];
  assert.match(story, /vn_bp_position\(x, "角色横向位置"\)/);
  assert.match(story, /vn_bp_position\(y, "角色纵向位置"\)/);
  node.properties.y = Infinity;
  assert.ok(validateBlueprints(project).some(issue => issue.nodeId === node.id && /纵向位置/.test(issue.message)));
});

test('Chinese semantic nodes, typed reusable calls, nested loops and resource links compile together', () => {
  const project = blueprintVerificationProject(sample);
  const original = JSON.stringify(project);
  const result = compileProject(project);
  assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
  assert.equal(JSON.stringify(project), original);
  assert.deepEqual(compileProject(project), result);
  const story = result.files['game/story.rpy'];
  for (const nodeId of ['bp_background', 'bp_show', 'bp_music', 'bp_sound', 'bp_open_menu', 'bp_hide', 'bp_stop', 'bp_transfer_scene']) {
    assert.ok(Object.values(result.sourceMap).some(origin => origin.nodeId === nodeId), `Missing source mapping for ${nodeId}`);
  }
  assert.match(story, /transform vn_animate_/);
  assert.match(story, /vn_bp_number/);
  assert.match(story, /while vn_bp_index_bp_outer <= vn_bp_last_bp_outer:\n        \$ vn_bp_index_bp_inner/);
  assert.match(story, /\$ vn_bp_result_bp_call_first_doubled = vn_bp_out_bp_values_doubled/);
  assert.match(story, /\$ vn_var_first_result = vn_bp_result_bp_call_first_doubled/);
  assert.match(story, /call vn_blueprint_bp_values\(2, False, "雨夜"\)/);
  assert.match(story, /call vn_blueprint_bp_values\(5, True, ""\)/);
  assert.match(result.files['game/screens.rpy'], /vn_music_entries/);
});

test('interface edits synchronize every caller and migrate positional values and connections', () => {
  const project = createProject();
  const macro = createBlueprintGraph('macro', '等待');
  macro.exposedInputs = [blueprintPin('seconds', '秒数', 'input', 'number', 1)];
  const caller = createBlueprintGraph('function', '参数调用');
  const a = blueprintNodeDefaults('callMacro');
  a.properties = { graphId: macro.id, arg_0: 0 };
  a.pins = [blueprintPin('exec_in', '执行', 'input'), blueprintPin('arg_0', '旧参数', 'input', 'number'), blueprintPin('exec_out', '完成', 'output')];
  const b = structuredClone(a); b.id = 'second_call'; b.properties.arg_0 = 2;
  const literal = blueprintNodeDefaults('literal'); literal.properties.value = 3; literal.pins[0].dataType = 'number';
  caller.nodes.push(a, b, literal);
  assert.equal(connectBlueprintPins(caller, literal.id, 'value', a.id, 'arg_0'), undefined);
  project.blueprints = [macro, caller];
  synchronizeBlueprintSignatures(project);
  assert.equal(a.properties.arg_seconds, 0);
  assert.equal(b.properties.arg_seconds, 2);
  assert.equal(a.properties.arg_0, undefined);
  assert.equal(caller.links[0].toPinId, 'arg_seconds');
  macro.exposedInputs[0].name = '等待时长'; macro.exposedInputs[0].defaultValue = 4; macro.exposedInputs[0].required = true;
  synchronizeBlueprintSignatures(project);
  for (const call of [a, b]) assert.deepEqual(call.pins.find(pin => pin.id === 'arg_seconds'), { ...macro.exposedInputs[0], id: 'arg_seconds' });
  assert.equal(caller.links[0].toPinId, 'arg_seconds');
  macro.exposedInputs = [];
  synchronizeBlueprintSignatures(project);
  assert.equal(caller.links.length, 0);
  assert.equal(a.pins.some(pin => pin.id === 'arg_seconds'), false);
  assert.equal(a.properties.arg_seconds, undefined);
});

test('removing a blueprint input clears overrides in all authoring locations', () => {
  const project = createProject(), graph = createBlueprintGraph('effect', '可复用演出');
  graph.exposedInputs = [blueprintPin('kept', '保留', 'input', 'number', 1)];
  const call = () => ({ kind: 'blueprint' as const, blueprintId: graph.id, inputs: { kept: 0, removed: 12 } });
  const passage = project.nodes.find(node => node.kind === 'passage')!;
  passage.lines[0].actions = [call()];
  project.scenes[0].entryActions = [call()];
  project.effects = [{ id: 'example_effect', name: '演出', commands: [], actions: [call()] }];
  project.characters = [{ id: 'speaker', name: '角色', color: '#ffffff', expressions: [], features: [{ id: 'feature', name: '功能', actions: [call()] }] }];
  const caller = createBlueprintGraph('effect', '封装');
  const saved = blueprintNodeDefaults('savedAction'); saved.properties.action = JSON.stringify(call()); caller.nodes.push(saved);
  project.blueprints = [graph, caller];
  synchronizeBlueprintSignatures(project);
  const actions = [passage.lines[0].actions[0], project.scenes[0].entryActions[0], project.effects[0].actions![0], project.characters[0].features![0].actions![0], JSON.parse(String(saved.properties.action))];
  for (const action of actions) assert.deepEqual(action.inputs, { kept: 0 });
});

test('required call values preserve false, zero and empty text with their real types', () => {
  const project = createProject();
  const macro = createBlueprintGraph('macro', '必填参数');
  macro.exposedInputs = [blueprintPin('number', '数量', 'input', 'number'), blueprintPin('flag', '开关', 'input', 'boolean'), blueprintPin('text', '文字', 'input', 'string')].map(pin => ({ ...pin, required: true }));
  const caller = createBlueprintGraph('function', '参数调用');
  const call = blueprintNodeDefaults('callMacro'); call.properties.graphId = macro.id; call.pins = callablePins(macro); caller.nodes.push(call);
  project.blueprints = [macro, caller];
  assert.equal(validateBlueprints(project).filter(issue => /必填/.test(issue.message)).length, 3);
  Object.assign(call.properties, { arg_number: 0, arg_flag: false, arg_text: '' });
  assert.deepEqual(validateBlueprints(project), []);
  call.properties.arg_number = '0';
  assert.ok(validateBlueprints(project).some(issue => /数量.*数值/.test(issue.message) && issue.nodeId === call.id));
});

test('execution pins reject any data and cycle connections without changing authored links', () => {
  const graph = createBlueprintGraph('function', '连线');
  const a = blueprintNodeDefaults('delay'); const b = blueprintNodeDefaults('delay'); const literal = blueprintNodeDefaults('literal');
  literal.pins[0].dataType = 'any'; graph.nodes.push(a, b, literal);
  assert.equal(connectBlueprintPins(graph, graph.nodes[0].id, 'exec', a.id, 'exec_in'), undefined);
  assert.equal(connectBlueprintPins(graph, a.id, 'exec_out', b.id, 'exec_in'), undefined);
  const before = JSON.stringify(graph.links);
  assert.match(connectBlueprintPins(graph, literal.id, 'value', a.id, 'exec_in')!, /不能传给执行/);
  assert.match(connectBlueprintPins(graph, b.id, 'exec_out', a.id, 'exec_in')!, /循环/);
  assert.equal(JSON.stringify(graph.links), before);
  assert.equal(connectBlueprintPins(graph, graph.nodes[0].id, 'exec', b.id, 'exec_in'), undefined);
  assert.equal(graph.links.filter(link => link.fromNodeId === graph.nodes[0].id).length, 1);
});

test('missing resources, invalid numbers and raw screen names identify the responsible blueprint node', () => {
  const project = blueprintVerificationProject(sample);
  const main = project.blueprints!.find(graph => graph.id === 'bp_main')!;
  const show = main.nodes.find(node => node.id === 'bp_show')!;
  show.properties.expressionId = 'missing'; show.properties.scale = Number.NaN;
  const music = main.nodes.find(node => node.id === 'bp_sound')!; music.properties.assetId = project.assets.find(asset => asset.kind === 'image')!.id;
  const menu = project.blueprints!.find(graph => graph.id === 'bp_menu')!.nodes.find(node => node.type === 'uiAction')!; menu.properties.screen = 'preferences; arbitrary';
  const diagnostics = validateBlueprints(project);
  assert.ok(diagnostics.some(issue => issue.nodeId === show.id && /表情/.test(issue.message)));
  assert.ok(diagnostics.some(issue => issue.nodeId === show.id && /角色大小/.test(issue.message)));
  assert.ok(diagnostics.some(issue => issue.nodeId === music.id && /音频/.test(issue.message)));
  assert.ok(diagnostics.some(issue => issue.nodeId === menu.id));
  assert.deepEqual(compileProject(project).files, {});
});

test('invalid imported data cycles and recursive user nodes are diagnosed before preview', () => {
  const project = createProject(); const graph = createBlueprintGraph('macro', '循环调用');
  const call = blueprintNodeDefaults('callMacro'); call.properties.graphId = graph.id; call.pins = callablePins(graph); graph.nodes.push(call);
  const a = blueprintNodeDefaults('math'); const b = blueprintNodeDefaults('math'); graph.nodes.push(a, b);
  graph.links = [{ id: 'cycle_a', fromNodeId: a.id, fromPinId: 'result', toNodeId: b.id, toPinId: 'a' }, { id: 'cycle_b', fromNodeId: b.id, fromPinId: 'result', toNodeId: a.id, toPinId: 'a' }];
  project.blueprints = [graph];
  const diagnostics = validateBlueprints(project);
  assert.ok(diagnostics.some(issue => /数据线互相依赖/.test(issue.message)));
  assert.ok(diagnostics.some(issue => /循环调用/.test(issue.message)));
});

test('maximum declared inputs and outputs fit in a callable signature and round-trip through project files', () => {
  const project = createProject(); const macro = createBlueprintGraph('macro', '完整接口'); const caller = createBlueprintGraph('function', '调用完整接口');
  macro.exposedInputs = Array.from({ length: 128 }, (_, i) => blueprintPin(`in_${i}`, `参数 ${i}`, 'input', 'number', i));
  macro.exposedOutputs = Array.from({ length: 32 }, (_, i) => blueprintPin(`out_${i}`, `结果 ${i}`, 'output', 'number', 0));
  macro.exposedInputs[0].id = 'i'.repeat(64);
  const call = blueprintNodeDefaults('callMacro'); call.properties.graphId = macro.id; call.pins = callablePins(macro); caller.nodes.push(call); project.blueprints = [macro, caller];
  assert.equal(call.pins.length, 162);
  assert.deepEqual(projectSchema.parse(JSON.parse(JSON.stringify(project))).blueprints, project.blueprints);
  assert.deepEqual(validateBlueprints(project), []);
});
