import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, type Project, type BlueprintNode } from '../src/core/model';
import { blueprintNodeDefaults, blueprintPin, callablePins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { mutateProject } from '../src/core/project-mutation';
import { currentScriptText } from '../src/core/script-text';

function fixture() {
  const project = createProject();
  const module = createBlueprintGraph('function', '模块'); module.id = 'module';
  module.exposedInputs = [blueprintPin('amount', '数量', 'input', 'number', 2)];
  module.exposedOutputs = [blueprintPin('result', '结果', 'output', 'number')];
  const read = blueprintNodeDefaults('getInput'); read.id = 'read'; read.properties.inputId = 'amount';
  module.nodes.push(read);
  const caller = createBlueprintGraph('function', '调用方'); caller.id = 'caller';
  const call = blueprintNodeDefaults('callFunction'); call.id = 'call'; call.properties = { graphId: module.id, arg_amount: 5 }; call.pins = callablePins(module);
  const literal = blueprintNodeDefaults('literal'); literal.id = 'literal'; literal.properties.value = 3;
  const saved = blueprintNodeDefaults('savedAction'); saved.id = 'saved'; saved.properties.action = JSON.stringify({kind:'blueprint',blueprintId:module.id,inputs:{amount:7}});
  caller.nodes.push(call, literal, saved);
  caller.links.push({id:'input_wire',fromNodeId:literal.id,fromPinId:'value',toNodeId:call.id,toPinId:'arg_amount'});
  const unrelated = createBlueprintGraph('function', '无关图'); unrelated.id = 'unrelated'; unrelated.nodes.push(blueprintNodeDefaults('math'));
  project.blueprints.push(module, caller, unrelated);
  const passage = project.nodes.find(node => node.kind === 'passage');
  if (passage?.kind === 'passage') passage.lines[0].actions.push({kind:'blueprint',blueprintId:module.id,inputs:{amount:11}});
  synchronizeBlueprintSignatures(project);
  return project;
}
function edit(project: Project, change: (draft: Project) => void, incremental = true) {
  return mutateProject(project, draft => { change(draft); synchronizeBlueprintSignatures(draft, incremental ? project : undefined); });
}
function node(project: Project, id: string): BlueprintNode { return project.blueprints.flatMap(graph => graph.nodes).find(node => node.id === id)!; }
function parity(project: Project, change: (draft: Project) => void) {
  const next = edit(project, change); assert.deepEqual(next, edit(project, change, false)); return next;
}

test('normalized full synchronization is a no-op, not a replacement of caller pins and links', () => {
  const project = fixture();
  const result = mutateProject(project, draft => synchronizeBlueprintSignatures(draft));
  assert.equal(result, project);
});

test('movement retains all interfaces and unrelated graph/card identities', () => {
  const project = fixture(), call = node(project, 'call');
  const next = parity(project, draft => { node(draft, 'call').x += 80; });
  assert.equal(next.blueprints[0], project.blueprints[0]);
  assert.equal(next.blueprints[2], project.blueprints[2]);
  assert.equal(next.blueprints[1].links, project.blueprints[1].links);
  assert.equal(node(next, 'call').pins, call.pins);
  assert.equal(node(next, 'literal'), node(project, 'literal'));
  assert.equal(next.nodes, project.nodes);
});

test('changing one literal does not rewrite the caller beside it', () => {
  const project = fixture();
  const next = parity(project, draft => { node(draft, 'literal').properties.value = 8; });
  assert.equal(node(next, 'call'), node(project, 'call'));
  assert.equal(next.blueprints[0], project.blueprints[0]);
  assert.equal(next.blueprints[1].links, project.blueprints[1].links);
});

test('interface type/name changes update readers and callers but retain invalid wires and values', () => {
  const project = fixture();
  const next = parity(project, draft => { Object.assign(draft.blueprints[0].exposedInputs[0], { dataType:'string',name:'文字',defaultValue:'例子' }); });
  assert.equal(node(next, 'read').pins.find(pin=>pin.id==='value')?.dataType, 'string');
  assert.equal(node(next, 'call').pins.find(pin=>pin.id==='arg_amount')?.name, '文字');
  assert.equal(node(next, 'call').properties.arg_amount, 5);
  assert.equal(next.blueprints[1].links, project.blueprints[1].links);
  assert.equal(node(next, 'literal'), node(project, 'literal'));
  assert.equal(next.blueprints[2], project.blueprints[2]);
  assert.equal(project.blueprints[0].exposedInputs[0].dataType, 'number');
});

test('interface deletion prunes the exact caller input, saved action and story argument atomically', () => {
  const project = fixture();
  const next = parity(project, draft => { draft.blueprints[0].exposedInputs = []; });
  assert.equal(next.blueprints[1].links.length, 0);
  assert.equal(node(next, 'call').properties.arg_amount, undefined);
  assert.equal(JSON.parse(String(node(next,'saved').properties.action)).inputs, undefined);
  for (const passage of next.nodes) if (passage.kind === 'passage') for (const line of passage.lines) for (const action of line.actions) if (action.kind==='blueprint' && action.blueprintId==='module') assert.equal(action.inputs, undefined);
  assert.equal(node(next, 'literal'), node(project, 'literal'));
  assert.equal(project.blueprints[1].links.length, 1);
  assert.equal(node(project,'call').properties.arg_amount,5);
});

test('link insertion/removal updates only the affected dynamic page interface', () => {
  const project = fixture(), graph = project.blueprints[1];
  const page = blueprintNodeDefaults('showUiPage'); page.id = 'page'; page.properties.pageId = 'ui:preferences'; graph.nodes.push(page);
  synchronizeBlueprintSignatures(project);
  assert.equal(page.pins.some(pin=>pin.id==='saveMode'), false);
  const wired = parity(project, draft => { draft.blueprints[1].links.push({id:'page_wire',fromNodeId:'literal',fromPinId:'value',toNodeId:'page',toPinId:'pageId'}); });
  assert.equal(node(wired,'page').pins.some(pin=>pin.id==='saveMode'), true);
  assert.equal(node(wired,'call'),node(project,'call'));
  const removed = parity(wired, draft => { draft.blueprints[1].links = draft.blueprints[1].links.filter(link=>link.id!=='page_wire'); });
  assert.equal(node(removed,'page').pins.some(pin=>pin.id==='saveMode'), false);
});

test('legacy positional inputs migrate without deleting legitimate numeric stable IDs', () => {
  const project = fixture();
  node(project,'call').properties = {graphId:'module',arg_0:42};
  project.blueprints[1].links[0].toPinId = 'arg_0';
  synchronizeBlueprintSignatures(project);
  assert.equal(node(project,'call').properties.arg_amount,42);
  assert.equal(project.blueprints[1].links[0].toPinId,'arg_amount');
  project.blueprints[0].exposedInputs.push(blueprintPin('0','数值标识','input','number',0));
  node(project,'call').properties.arg_0 = 23;
  synchronizeBlueprintSignatures(project);
  assert.equal(node(project,'call').properties.arg_0,23);
  assert.equal(node(project,'call').properties.arg_amount,42);
  const next = parity(project, draft => { draft.blueprints[0].exposedInputs.reverse(); });
  assert.equal(node(next,'call').properties.arg_0,23);
  assert.equal(node(next,'call').properties.arg_amount,42);
});

test('global state type edits take the conservative path and still preserve unrelated data', () => {
  const project = fixture();
  project.variables.push({id:'typed',name:'测试值',type:'number',initial:0,persistent:false});
  const reader = blueprintNodeDefaults('getVariable'); reader.id='state'; reader.properties.variableId='typed'; project.blueprints[2].nodes.push(reader);
  synchronizeBlueprintSignatures(project);
  const next = parity(project, draft => { const value=draft.variables.find(v=>v.id==='typed')!;value.type='string';value.initial='新'; });
  assert.equal(node(next,'state').pins.find(pin=>pin.id==='value')?.dataType,'string');
  assert.equal(node(next,'call'),node(project,'call'));
});

test('dialogue prose and text presentation retain every blueprint interface and match full synchronization', () => {
  const project = fixture();
  for (const change of [
    (draft: Project) => { const passage = draft.nodes.find(node => node.kind === 'passage')!; passage.lines[0].text += '新的台词'; },
    (draft: Project) => { const passage = draft.nodes.find(node => node.kind === 'passage')!; passage.lines[0].textPresentation = { sizeScale: 1.4 }; },
    (draft: Project) => { draft.scriptText = currentScriptText('旁白：文本草稿'); },
  ]) {
    const next = parity(project, change);
    assert.equal(next.blueprints, project.blueprints);
    assert.equal(next.timelinePresets, project.timelinePresets);
    assert.equal(node(next, 'call').pins, node(project, 'call').pins);
  }
});

test('new, edited and duplicated story calls still prune arguments without an interface edit', () => {
  const project = fixture();
  const next = parity(project, draft => {
    const passage = draft.nodes.find(node => node.kind === 'passage')!;
    const existing = passage.lines[0].actions.find(action => action.kind === 'blueprint')!;
    if (existing.kind === 'blueprint') existing.inputs = { amount: 11, obsolete: 30 };
    passage.lines.push({ id: 'new_line', text: '新句', actions: [{ kind: 'blueprint', blueprintId: 'module', inputs: { amount: 8, stale: 2 } }] });
    draft.nodes.push({ ...structuredClone(project.nodes.find(node => node.kind === 'passage')!), id: 'copied_node', lines: [{ id: 'copied_line', text: '复制', actions: [{ kind: 'blueprint', blueprintId: 'module', inputs: { obsolete: 5 } }] }] });
  });
  assert.equal(next.blueprints, project.blueprints);
  const calls = next.nodes.flatMap(node => node.kind === 'passage' ? node.lines.flatMap(line => line.actions.filter(action => action.kind === 'blueprint')) : []);
  assert.deepEqual(calls.map(action => action.kind === 'blueprint' ? action.inputs : undefined), [{ amount: 11 }, { amount: 8 }, undefined]);
});
