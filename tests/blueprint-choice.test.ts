import test from 'node:test';
import assert from 'node:assert/strict';
import { blueprintNodeDefaults, connectBlueprintPins, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { prepareBlueprintInsertion } from '../src/core/blueprint-insertion';
import { blueprintChoiceDefinition, blueprintChoicePins, blueprintChoicePinId, blueprintChoiceDefaultCases, evaluateBlueprintChoice, selectBlueprintChoice } from '../src/core/blueprint-choice';
import { createBlueprintChoiceFixture } from '../scripts/lib/blueprint-choice-fixture';
import { previewActionContext, expandPreviewActions } from '../src/core/preview-actions';
import { previewUiLogic } from '../src/core/ui-logic-preview';
import { BlueprintTraceRecorder } from '../src/core/blueprint-trace';
import { blueprintStaticOutput, unknownBlueprintValue, type StaticValueContext } from '../src/core/blueprint-static-values';
import { blueprintCapabilitySummary } from '../src/core/blueprint-capabilities';
import { validateBlueprints } from '../src/core/blueprint-validation';
import { mutateProject } from '../src/core/project-mutation';
import { projectSchema } from '../src/core/model';
import { projectForExport } from '../src/core/export-assets';
import { compileProject } from '../src/runtime/compiler';

for (const type of ['switchValue', 'selectByKey'] as const) test(type + ' has stable typed cases and a separate default', () => {
  const node = blueprintNodeDefaults(type);
  assert.deepEqual(blueprintChoiceDefinition(node).problems, []); assert.deepEqual(node.pins, blueprintChoicePins(node));
  assert.ok(node.pins.some(pin => pin.id === 'case_a')); assert.ok(node.pins.some(pin => pin.id === 'default'));
  assert.equal(node.pins.some(pin => pin.dataType === 'exec'), type === 'switchValue');
});

test('typed keys and zero/false/empty results match in connected execution and page callbacks', () => {
  const f = createBlueprintChoiceFixture(), before = structuredClone(f.project);
  assert.deepEqual(validateBlueprints(f.project), []);
  for (const entry of f.cases) {
    const context = previewActionContext(f.project); context.trace = new BlueprintTraceRecorder();
    expandPreviewActions(f.project, [{ kind: 'blueprint', blueprintId: entry.group.graph.id, inputs: { key: entry.key } }], context);
    assert.equal(context.incomplete, false, entry.id); assert.equal(context.variables[entry.group.resultVariable], entry.expected, entry.id); assert.equal(context.variables[entry.group.routeVariable], entry.route, entry.id);
    const inputs = context.trace.snapshot().entries.filter(item => item.kind === 'input' && item.nodeId === entry.group.select.id);
    assert.deepEqual(inputs.map(item => item.pinId), ['key', entry.route === 'default' ? 'default' : blueprintChoicePinId(entry.route)]);
    const preview = previewUiLogic(f.project, f.page.components, f.page.id, {}, [{ kind: 'click', componentId: entry.buttonId }], { trace: true });
    assert.equal(preview.incomplete, false); assert.equal(preview.variables[entry.group.resultVariable], entry.expected); assert.equal(preview.variables[entry.group.routeVariable], entry.route);
  }
  assert.deepEqual(f.project, before);
});

test('selection evaluates a key once and never evaluates unused candidates or default', () => {
  const node = blueprintNodeDefaults('selectByKey'); node.properties.case_a = 0;
  const reads: string[] = [];
  assert.deepEqual(evaluateBlueprintChoice(node, pin => { reads.push(pin); if (pin === 'key') return 'A'; if (pin === 'case_a') return 0; throw new Error('Unused input was evaluated: ' + pin); }), { ok: true, value: 0, pinId: 'case_a' });
  assert.deepEqual(reads, ['key', 'case_a']);
  const result = evaluateBlueprintChoice(node, pin => pin === 'key' ? 'A' : false); assert.equal(result.ok, false);
  assert.equal(selectBlueprintChoice(node, true).ok, false); assert.equal(selectBlueprintChoice(node, 1).ok, false);
});

test('duplicate keys, incompatible types, invalid names and unknown versions remain repairable data', () => {
  for (const change of [
    { cases: JSON.stringify([{ id: 'a', name: 'one', key: 'A' }, { id: 'b', name: 'two', key: 'A' }]) },
    { keyType: 'number' }, { cases: JSON.stringify([{ id: 'a', name: '', key: 'A' }]) }, { keyType: 'object' }, { valueType: 'exec' }, { choiceVersion: 7 }, { cases: '{broken' },
  ]) {
    const node = blueprintNodeDefaults('selectByKey'); Object.assign(node.properties, change); const before = structuredClone(node);
    assert.ok(blueprintChoiceDefinition(node).problems.length); assert.equal(evaluateBlueprintChoice(node, () => 'A').ok, false); assert.deepEqual(node, before);
  }
  const numeric = blueprintNodeDefaults('switchValue'); numeric.properties.keyType = 'number'; numeric.properties.cases = JSON.stringify([{ id: 'a', name: 'zero', key: 0 }]);
  assert.deepEqual(selectBlueprintChoice(numeric, -0), { ok: true, caseId: 'a', pinId: 'case_a' }); assert.equal(selectBlueprintChoice(numeric, false).ok, false); assert.equal(selectBlueprintChoice(numeric, '0').ok, false); assert.equal(selectBlueprintChoice(numeric, Infinity).ok, false);
});

test('rename/reorder preserve identities; delete and type edits affect only declared pins in one transaction', () => {
  const f = createBlueprintChoiceFixture(), g = f.groups[0], original = f.project;
  const reordered = mutateProject(original, draft => {
    const node = draft.blueprints.find(graph => graph.id === g.graph.id)!.nodes.find(node => node.id === g.select.id)!;
    const rows = blueprintChoiceDefinition(node).cases!; rows.reverse(); rows[0].name = '改名后的分支'; node.properties.cases = JSON.stringify(rows); synchronizeBlueprintSignatures(draft, original);
  });
  const nextGraph = reordered.blueprints.find(graph => graph.id === g.graph.id)!;
  assert.equal(nextGraph.links, g.graph.links); assert.equal(reordered.blueprints[1], original.blueprints[1]);
  assert.deepEqual(nextGraph.nodes.find(node => node.id === g.select.id)!.pins.filter(pin => pin.id.startsWith('case_')).map(pin => pin.id), ['case_hard', 'case_a', 'case_empty']);
  assert.equal(nextGraph.nodes.find(node => node.id === g.select.id)!.properties.case_empty, 0);
  const deleted = mutateProject(reordered, draft => {
    const node = draft.blueprints.find(graph => graph.id === g.graph.id)!.nodes.find(node => node.id === g.branch.id)!;
    node.properties.cases = JSON.stringify(blueprintChoiceDefinition(node).cases!.filter(row => row.id !== 'a')); synchronizeBlueprintSignatures(draft, reordered);
  });
  assert.equal(deleted.blueprints[0].links.length, nextGraph.links.length - 1); assert.ok(!deleted.blueprints[0].links.some(link => link.fromNodeId === g.branch.id && link.fromPinId === 'case_a'));
  const typed = mutateProject(original, draft => { draft.blueprints[0].nodes.find(node => node.id === g.select.id)!.properties.valueType = 'boolean'; synchronizeBlueprintSignatures(draft, original); });
  assert.equal(typed.blueprints[0].links, g.graph.links); assert.equal(typed.blueprints[0].nodes.find(node => node.id === g.select.id)!.properties.case_empty, 0);
  assert.ok(validateBlueprints(typed).some(issue => issue.nodeId === g.select.id)); assert.equal(g.select.properties.valueType, 'number');
  assert.deepEqual(projectSchema.parse(JSON.parse(JSON.stringify(reordered))).blueprints[0], JSON.parse(JSON.stringify(nextGraph)));
});

test('static analysis prunes only known choices and observes all possible dynamic dependencies', () => {
  const f = createBlueprintChoiceFixture(), group = f.groups[0], seen: string[] = [];
  const context: StaticValueContext = { project: f.project, graph: group.graph, inputs: new Map([['key', 'A']]), results: new Map(), onRead: node => seen.push(node.id), uiValue: () => unknownBlueprintValue };
  assert.equal(blueprintStaticOutput(context, group.select, 'result'), 1);
  context.inputs = new Map<string, typeof unknownBlueprintValue>([['key', unknownBlueprintValue]]); assert.equal(blueprintStaticOutput(context, group.select, 'result'), unknownBlueprintValue);
  const bad = blueprintNodeDefaults('getMinigameValue'); group.graph.nodes.push(bad); assert.equal(connectBlueprintPins(group.graph, bad.id, 'value', group.select.id, 'case_hard'), undefined);
  assert.ok(!blueprintCapabilitySummary(f.project, group.graph, { key: 'A' }).required.includes('minigame'));
  assert.ok(blueprintCapabilitySummary(f.project, group.graph, { key: '困难' }).required.includes('minigame'));
  const dialogue = blueprintNodeDefaults('startDialogue'); group.graph.nodes.push(dialogue);
  group.graph.links = group.graph.links.filter(link => link.fromNodeId !== group.branch.id || link.fromPinId !== 'case_hard');
  assert.equal(connectBlueprintPins(group.graph, group.branch.id, 'case_hard', dialogue.id, 'exec_in'), undefined);
  assert.ok(!blueprintCapabilitySummary(f.project, group.graph, { key: 'A' }).required.includes('dialogue'));
  assert.ok(blueprintCapabilitySummary(f.project, group.graph, { key: '困难' }).required.includes('dialogue'));
});

test('drag-from-pin prepares compatible typed choices without mutating the candidate or graph', () => {
  const f = createBlueprintChoiceFixture(), group = f.groups[1], node = blueprintNodeDefaults('selectByKey'), before = structuredClone(node);
  const candidate = prepareBlueprintInsertion(f.project, group.graph, node, { nodeId: group.read.id, pinId: 'value', direction: 'output' });
  assert.equal(candidate.problem, undefined); assert.equal(candidate.node.properties.keyType, 'number'); assert.deepEqual(blueprintChoiceDefinition(candidate.node).cases, blueprintChoiceDefaultCases('number')); assert.deepEqual(node, before);
});

test('choice-only resource references remain exportable and compile to lazy native expressions', () => {
  const f = createBlueprintChoiceFixture(), group = f.groups[0], compiled = compileProject(f.project), before = structuredClone(f.project);
  assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), []); assert.deepEqual(f.project, before);
  const code = Object.values(compiled.files).join('\n'); assert.match(code, /vn_bp_choice_value\(/); assert.match(code, /lambda:/); assert.match(code, /def vn_bp_choice_match/);
  f.project.ui.disabledPages = ['gallery'];
  f.project.assets.push({ id: 'unused_choice_asset', name: 'Unused', kind: 'image', path: 'assets/unused.png' });
  f.project.assets.push({ id: 'choice_only_asset', name: 'Choice asset', kind: 'image', path: 'assets/choice.png' });
  group.select.properties.valueType = 'asset'; group.select.properties.case_a = 'choice_only_asset'; group.select.properties.case_empty = ''; group.select.properties.case_hard = ''; group.select.properties.default = ''; synchronizeBlueprintSignatures(f.project);
  const exported = projectForExport(f.project);
  assert.ok(exported.assets.some(asset => asset.id === 'choice_only_asset'));
  assert.ok(!exported.assets.some(asset => asset.id === 'unused_choice_asset'));
});
