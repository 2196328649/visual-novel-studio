import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/core/model';
import { blueprintNodeDefaults, blueprintPin, callablePins, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { prepareBlueprintInsertion } from '../src/core/blueprint-insertion';
import { blueprintCapabilityCheck } from '../src/core/blueprint-capabilities';

function fixture() {
  const project = createProject(), caller = createBlueprintGraph('ui', '调用者'), callee = createBlueprintGraph('function', '有条件的模块');
  project.blueprints.push(caller, callee); callee.exposedInputs.push(blueprintPin('enabled', '启用', 'input', 'boolean', true));
  const read = blueprintNodeDefaults('getInput'), branch = blueprintNodeDefaults('branch'), bad = blueprintNodeDefaults('startDialogue'); read.properties.inputId = 'enabled';
  callee.nodes.push(read, branch, bad); synchronizeBlueprintSignatures(project);
  connectBlueprintPins(callee, callee.nodes[0].id, 'exec', branch.id, 'exec_in');
  connectBlueprintPins(callee, read.id, 'value', branch.id, 'condition'); connectBlueprintPins(callee, branch.id, 'true', bad.id, 'exec_in');
  const candidate = blueprintNodeDefaults('callFunction'); candidate.properties.graphId = callee.id; candidate.pins = callablePins(callee);
  return { project, caller, callee, candidate };
}

test('palette and insertion preflight use a pending data argument rather than the module default', () => {
  const { project, caller, candidate } = fixture(), literal = blueprintNodeDefaults('literal');
  literal.properties.value = false; literal.pins[0].dataType = 'boolean'; caller.nodes.push(literal);
  const before = structuredClone(project), source = structuredClone(candidate);
  assert.match(blueprintCapabilityCheck(project, candidate, 'ui').problem!, /当前台词/);
  const insertion = prepareBlueprintInsertion(project, caller, candidate, { nodeId: literal.id, pinId: 'value', direction: 'output' });
  assert.equal(insertion.problem, undefined); assert.equal(insertion.destination?.id, 'arg_enabled');
  assert.equal(blueprintCapabilityCheck(project, insertion.node, 'ui', insertion.graph).problem, undefined);
  assert.deepEqual(project, before); assert.deepEqual(candidate, source);
  literal.properties.value = true;
  const unsafe = prepareBlueprintInsertion(project, caller, candidate, { nodeId: literal.id, pinId: 'value', direction: 'output' });
  assert.match(blueprintCapabilityCheck(project, unsafe.node, 'ui', unsafe.graph).problem!, /当前台词/);
});

test('pending runtime arguments are not substituted with caller defaults', () => {
  const { project, caller, candidate } = fixture(); caller.exposedInputs.push(blueprintPin('flag', '开关', 'input', 'boolean', false));
  const read = blueprintNodeDefaults('getInput'); read.properties.inputId = 'flag'; caller.nodes.push(read); synchronizeBlueprintSignatures(project);
  const insertion = prepareBlueprintInsertion(project, caller, candidate, { nodeId: read.id, pinId: 'value', direction: 'output' });
  assert.equal(insertion.problem, undefined);
  assert.match(blueprintCapabilityCheck(project, insertion.node, 'ui', insertion.graph).problem!, /当前台词/);
});

test('backward drag adapts a new literal without changing the existing consumer', () => {
  const { project, caller } = fixture(), branch = blueprintNodeDefaults('branch'); caller.nodes.push(branch);
  const source = blueprintNodeDefaults('literal'), before = structuredClone(project), original = structuredClone(source);
  const insertion = prepareBlueprintInsertion(project, caller, source, { nodeId: branch.id, pinId: 'condition', direction: 'input' });
  assert.equal(insertion.problem, undefined); assert.equal(insertion.node.pins[0].dataType, 'boolean'); assert.equal(insertion.node.properties.value, false);
  assert.deepEqual(insertion.graph.links.map(l => [l.fromNodeId, l.toNodeId, l.toPinId]), [[source.id, branch.id, 'condition']]);
  assert.deepEqual(project, before); assert.deepEqual(source, original);
});

test('incompatible or disappeared wire origins are rejected without inserting anything', () => {
  const { project, caller, candidate } = fixture(), text = blueprintNodeDefaults('literal'); caller.nodes.push(text);
  const before = structuredClone(project);
  for (const pinId of ['value', 'missing']) {
    const insertion = prepareBlueprintInsertion(project, caller, candidate, { nodeId: text.id, pinId, direction: 'output' });
    assert.match(insertion.problem!, /没有兼容/); assert.deepEqual(insertion.graph.links, caller.links);
  }
  assert.deepEqual(project, before);
});
