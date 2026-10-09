import test from 'node:test';
import assert from 'node:assert/strict';
import { blueprintActionInputsFixture } from '../scripts/lib/blueprint-action-inputs-fixture';
import { rawSavedBlueprintAction, updateSavedBlueprintAction } from '../src/core/blueprint-authoring';
import { timelineNodeActions } from '../src/core/performance-timeline';
import { retimeVisualObject, visualPose } from '../src/core/visual-object';
import { projectSchema } from '../src/core/model';
import { blueprintNodeDefaults, synchronizeBlueprintSignatures } from '../src/core/blueprint';

test('raw action inspection ignores ordinary logic nodes and still validates saved actions', () => {
  const logic = blueprintNodeDefaults('callFunction');
  assert.equal(rawSavedBlueprintAction(logic), undefined);
  logic.properties.action = JSON.stringify({ kind: 'pause', seconds: 2 });
  assert.equal(rawSavedBlueprintAction(logic), undefined);
  const saved = blueprintNodeDefaults('savedAction');
  saved.properties.action = logic.properties.action;
  assert.deepEqual(rawSavedBlueprintAction(saved), { kind: 'pause', seconds: 2 });
  saved.properties.action = '{unfinished'; assert.equal(rawSavedBlueprintAction(saved), undefined);
  saved.properties.action = JSON.stringify({ kind: 'pause', seconds: -1 }); assert.equal(rawSavedBlueprintAction(saved), undefined);
});

test('source visual edits retain literal inputs, data links and original animation time', () => {
  const { project, graph, pictureId } = blueprintActionInputsFixture(), node = graph.nodes.find(n => n.id === pictureId)!;
  const raw = rawSavedBlueprintAction(node)!; assert.ok(raw.kind === 'visual'); const before = structuredClone(node), links = structuredClone(graph.links);
  updateSavedBlueprintAction(node, { ...raw, name: '改名图片', width: .5 });
  const updated = rawSavedBlueprintAction(node)!; assert.ok(updated.kind === 'visual');
  assert.equal(updated.duration, 3); assert.equal(updated.assetId, 'red'); assert.deepEqual(updated.curves, raw.curves);
  assert.deepEqual({ ...node.properties, action: before.properties.action }, before.properties); assert.deepEqual(graph.links, links);
  const sample = timelineNodeActions(project, graph, node).find(a => a.kind === 'visual')!;
  assert.equal(sample.duration, 6); assert.equal(sample.assetId, 'blue'); assert.equal(sample.curves!.x!.at(-1)!.at, 6); assert.equal(visualPose(sample, 3).x, .5);
  updateSavedBlueprintAction(node, retimeVisualObject(updated, 4));
  assert.equal(node.properties.object_duration, undefined); assert.equal(node.properties.object_assetId, 'green'); assert.deepEqual(graph.links, links);
  const final = timelineNodeActions(project, graph, node).find(a => a.kind === 'visual')!; assert.equal(final.duration, 4); assert.equal(final.curves!.x!.at(-1)!.at, 4);
});

test('source audio edits patch only changed fields and keep bound source metadata separate', () => {
  const { project, graph, soundId } = blueprintActionInputsFixture(), node = graph.nodes.find(n => n.id === soundId)!;
  const raw = rawSavedBlueprintAction(node)!; assert.ok(raw.kind === 'audioClip'); const before = structuredClone(node), links = structuredClone(graph.links);
  updateSavedBlueprintAction(node, { ...raw, name: '改名声音', fadeIn: .2 });
  assert.deepEqual({ ...node.properties, action: before.properties.action }, before.properties);
  let sample = timelineNodeActions(project, graph, node).find(a => a.kind === 'audioClip')!;
  assert.deepEqual([sample.assetId, sample.duration, sample.offset, sample.volume, sample.fadeIn, sample.sourceDuration], ['bound_audio', 4, 2, .3, .2, undefined]);
  const authored = rawSavedBlueprintAction(node)!; assert.ok(authored.kind === 'audioClip');
  assert.deepEqual([authored.assetId, authored.duration, authored.offset, authored.volume, authored.sourceDuration], ['source_audio', 3, 1, 1, 10]);
  updateSavedBlueprintAction(node, { ...authored, volume: .8 });
  assert.equal(node.properties.clip_volume, undefined); assert.equal(node.properties.clip_offset, 2); assert.equal(node.properties.clip_duration, 4); assert.deepEqual(graph.links, links);
  sample = timelineNodeActions(project, graph, node).find(a => a.kind === 'audioClip')!; assert.equal(sample.volume, .8);
});

test('malformed or different source action types never partially modify the node', () => {
  const { graph, pictureId } = blueprintActionInputsFixture(), node = graph.nodes.find(n => n.id === pictureId)!;
  const raw = rawSavedBlueprintAction(node)!; assert.ok(raw.kind === 'visual'); const before = structuredClone(node);
  assert.throws(() => updateSavedBlueprintAction(node, { ...raw, duration: -1 }));
  assert.deepEqual(node, before);
  assert.throws(() => updateSavedBlueprintAction(node, { kind: 'pause', seconds: 2 }), /类型/); assert.deepEqual(node, before);
});

test('opening a schema-loaded audio graph does not produce a false history edit from pin field order', () => {
  const { project } = blueprintActionInputsFixture(), parsed = projectSchema.parse(project), before = JSON.stringify(parsed);
  synchronizeBlueprintSignatures(parsed);
  assert.equal(JSON.stringify(parsed), before);
});
