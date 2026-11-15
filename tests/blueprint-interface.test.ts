import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blueprintNodeDefaults, blueprintPin, callablePins, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { applyBlueprintInterfaceChange, inspectBlueprintInterfaceChange, type BlueprintInterfaceChange } from '../src/core/blueprint-interface';
import { blueprintUsages } from '../src/core/blueprint-usages';
import { createProject, projectSchema } from '../src/core/model';
import { mutateProject } from '../src/core/project-mutation';
import { validateBlueprints } from '../src/core/blueprint-validation';

function fixture() {
  const project = createProject(), module = createBlueprintGraph('macro', '数值模块'), caller = createBlueprintGraph('function', '调用者');
  module.exposedInputs = [blueprintPin('amount', '数量', 'input', 'number', 2)];
  module.exposedOutputs = [blueprintPin('answer', '结果', 'output', 'number', 0)];
  const read = blueprintNodeDefaults('getInput'); read.properties.inputId = 'amount';
  const write = blueprintNodeDefaults('setOutput'); write.properties.outputId = 'answer';
  module.nodes.push(read, write);
  const call = blueprintNodeDefaults('callMacro'); call.properties = { graphId: module.id, arg_amount: 0 }; call.pins = callablePins(module);
  const value = blueprintNodeDefaults('literal'); value.properties.value = 5; value.pins[0].dataType = 'number';
  const consumer = blueprintNodeDefaults('delay');
  caller.nodes.push(call, value, consumer); project.blueprints = [module, caller]; synchronizeBlueprintSignatures(project);
  connectBlueprintPins(module, module.nodes[0].id, 'exec', write.id, 'exec_in'); connectBlueprintPins(module, read.id, 'value', write.id, 'value');
  connectBlueprintPins(caller, caller.nodes[0].id, 'exec', call.id, 'exec_in'); connectBlueprintPins(caller, value.id, 'value', call.id, 'arg_amount');
  connectBlueprintPins(caller, call.id, 'exec_out', consumer.id, 'exec_in'); connectBlueprintPins(caller, call.id, 'out_answer', consumer.id, 'seconds');
  return { project, module, caller, call, value, read, write, consumer };
}

test('module and pin descriptions survive serialization without rewriting legacy projects', () => {
  const { project, module, caller, call } = fixture();
  module.description = '输入数量，返回结果。'; module.exposedInputs[0].description = '可以为零，单位：个';
  synchronizeBlueprintSignatures(project);
  const parsed = projectSchema.parse(JSON.parse(JSON.stringify(project)));
  assert.equal(parsed.blueprints[0].description, module.description);
  assert.equal(parsed.blueprints[1].nodes.find(n => n.id === call.id)?.pins.find(p => p.id === 'arg_amount')?.description, module.exposedInputs[0].description);
  assert.equal(caller.nodes[0].pins[0].description, undefined);
  const legacy = createProject(); assert.equal(projectSchema.parse(legacy).blueprints[0]?.description, undefined);
});

test('renaming and changing defaults preserve stable wires and explicit zero overrides', () => {
  const { project, module, caller, call } = fixture(), links = structuredClone(caller.links);
  const change: BlueprintInterfaceChange = { kind: 'update', direction: 'input', pinId: 'amount', patch: { name: '次数', defaultValue: 7, description: '说明' } };
  const before = JSON.stringify(project), plan = inspectBlueprintInterfaceChange(project, module.id, change);
  assert.equal(JSON.stringify(project), before); assert.equal(plan.requiresConfirmation, false);
  applyBlueprintInterfaceChange(project, module.id, change);
  assert.deepEqual(caller.links, links); assert.equal(call.properties.arg_amount, 0);
  assert.equal(call.pins.find(pin => pin.id === 'arg_amount')?.name, '次数');
  assert.equal(call.pins.find(pin => pin.id === 'arg_amount')?.defaultValue, 7);
});

test('removing an input previews the wire, override and internal reader, and rejects unconfirmed or stale edits atomically', () => {
  const { project, module, caller, call, value, read } = fixture();
  const change: BlueprintInterfaceChange = { kind: 'remove', direction: 'input', pinId: 'amount' };
  const plan = inspectBlueprintInterfaceChange(project, module.id, change), before = JSON.stringify(project);
  assert.equal(plan.impacts.filter(item => item.kind === 'removedLink').length, 1);
  assert.ok(plan.impacts.some(item => item.kind === 'removedValue'));
  assert.ok(plan.impacts.some(item => item.kind === 'missingParameter' && item.location.kind === 'blueprint' && item.location.nodeId === read.id));
  assert.throws(() => applyBlueprintInterfaceChange(project, module.id, change), /查看最新影响/);
  assert.equal(JSON.stringify(project), before);
  const second = blueprintNodeDefaults('callMacro'); second.properties.graphId = module.id; second.pins = callablePins(module); caller.nodes.push(second);
  connectBlueprintPins(caller, value.id, 'value', second.id, 'arg_amount');
  const updated = JSON.stringify(project);
  assert.throws(() => applyBlueprintInterfaceChange(project, module.id, change, plan.confirmationKey), /查看最新影响/);
  assert.equal(JSON.stringify(project), updated);
  const fresh = inspectBlueprintInterfaceChange(project, module.id, change); applyBlueprintInterfaceChange(project, module.id, change, fresh.confirmationKey);
  assert.equal(module.exposedInputs.length, 0); assert.equal(call.properties.arg_amount, undefined);
  assert.equal(caller.links.some(link => link.toPinId === 'arg_amount'), false);
  assert.ok(validateBlueprints(project).some(issue => issue.nodeId === read.id));
});

test('input type changes report caller and internal invalid wires while keeping their identities', () => {
  const { project, module, caller } = fixture(), links = structuredClone(caller.links);
  const change: BlueprintInterfaceChange = { kind: 'update', direction: 'input', pinId: 'amount', patch: { dataType: 'boolean', defaultValue: false } };
  const plan = inspectBlueprintInterfaceChange(project, module.id, change);
  assert.equal(plan.impacts.filter(item => item.kind === 'invalidLink').length, 2);
  applyBlueprintInterfaceChange(project, module.id, change, plan.confirmationKey);
  assert.deepEqual(caller.links, links); assert.ok(validateBlueprints(project).some(issue => /开关|数值/.test(issue.message)));
});

test('removing outputs reports fan-out and internal writer and works through an immutable history edit', () => {
  const { project, module, caller, call, consumer } = fixture();
  const second = blueprintNodeDefaults('delay'); caller.nodes.push(second); connectBlueprintPins(caller, call.id, 'out_answer', second.id, 'seconds');
  const change: BlueprintInterfaceChange = { kind: 'remove', direction: 'output', pinId: 'answer' }, before = JSON.stringify(project);
  const plan = inspectBlueprintInterfaceChange(project, module.id, change);
  assert.equal(plan.impacts.filter(item => item.kind === 'removedLink').length, 2);
  assert.ok(plan.impacts.some(item => item.kind === 'missingParameter'));
  const next = mutateProject(project, draft => { applyBlueprintInterfaceChange(draft, module.id, change, plan.confirmationKey); });
  assert.equal(JSON.stringify(project), before);
  assert.ok(!next.blueprints[1].links.some(link => link.fromPinId === 'out_answer'));
  assert.ok(next.blueprints[1].links.some(link => link.toNodeId === consumer.id && link.toPinId === 'exec_in'));
});

test('new required inputs and changed unconnected values list all affected call sites', () => {
  const { project, module, caller, call } = fixture();
  caller.links = caller.links.filter(link => link.toPinId !== 'arg_amount');
  const add: BlueprintInterfaceChange = { kind: 'add', direction: 'input', pin: { id: 'required_value', name: '必填文字', direction: 'input', dataType: 'string', required: true } };
  assert.ok(inspectBlueprintInterfaceChange(project, module.id, add).impacts.some(item => item.kind === 'invalidValue'));
  const change: BlueprintInterfaceChange = { kind: 'update', direction: 'input', pinId: 'amount', patch: { dataType: 'boolean', defaultValue: false } };
  assert.ok(inspectBlueprintInterfaceChange(project, module.id, change).impacts.some(item => item.kind === 'invalidValue'));
  assert.equal(call.properties.arg_amount, 0);
  assert.throws(() => applyBlueprintInterfaceChange(project, module.id, { kind: 'add', direction: 'output', pin: module.exposedInputs[0] }), /标识重复/);
  assert.throws(() => applyBlueprintInterfaceChange(project, module.id, { kind: 'update', direction: 'input', pinId: 'amount', patch: { name: '' } }), /名称不能为空/);
});

test('call site inventory includes timeline calls, story, effects, startup, native/custom UI and inherited schemes without writes', () => {
  const { project, module, caller, call } = fixture(), passage = project.nodes.find(node => node.kind === 'passage')!;
  if (passage.kind !== 'passage') throw new Error('No passage');
  const action = { kind: 'blueprint' as const, blueprintId: module.id, inputs: { amount: 0 } };
  passage.lines[0].actions = [action]; project.scenes[0].entryActions = [action];
  project.effects = [{ id: 'interface_effect', name: '效果', commands: [], actions: [action] }];
  const timeline = createBlueprintGraph('effect', '时间轴调用'); timeline.timeline = { tracks: [], clips: [] }; const timelineCall = { ...structuredClone(call), id: 'timeline_call' }; timeline.nodes.push(timelineCall); (project.timelinePresets ??= []).push(timeline);
  project.ui.components = [{ id: 'native_button', name: '原生按钮', text: '调用', page: 'main', kind: 'button', x: 0, y: 0, width: .2, height: .1, action: 'blueprint', blueprintId: module.id }];
  project.ui.instances = [{ id: 'derived_scheme', name: '继承方案', components: [] }];
  project.ui.customPages = [{ id: 'usage_page', name: '自定义页', modal: true, background: '#000000', onShowBlueprintId: module.id, components: [] }];
  project.gameFlow = { schemaVersion: 1, beforeTitle: { repeat: 'launch', revision: '1', steps: [{ id: 'startup', kind: 'blueprint', graphId: module.id, allowSkip: false, inputs: { amount: 0 } }] }, beforeNewGame: [] };
  const before = JSON.stringify(project), uses = blueprintUsages(project, module.id);
  assert.equal(JSON.stringify(project), before); assert.equal(new Set(uses.map(use => use.key)).size, uses.length);
  assert.equal(uses.filter(use => use.location.kind === 'blueprint').length, 2);
  assert.equal(uses.filter(use => use.location.kind === 'ui').length, 3);
  for (const kind of ['story', 'scene', 'effect', 'gameFlow']) assert.ok(uses.some(use => use.location.kind === kind), kind);
  assert.equal(uses.find(use => use.location.kind === 'story')?.inputs?.amount, 0);
  const direct = uses.find(use => use.location.kind === 'blueprint' && use.location.graphId === caller.id)!;
  assert.equal(direct.inputs?.amount, 0); assert.deepEqual(direct.linkedInputs, ['amount']);
});
