import { addProjectGraphs, projectGraphs } from '../src/core/project-resources';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema } from '../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { addTimelineComponent, isTimelineComponent, useTimelineDefault } from '../src/core/timeline-component';
import { insertTimelineAction } from '../src/core/performance-timeline';
import { exposePerformanceInputs, performanceInputs } from '../src/core/blueprint-authoring';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { compileProject } from '../src/runtime/compiler';

function fixture() {
  const project = createProject();
  project.assets = ['default_image', 'override_image'].map(id => ({ id, name: id, kind: 'image', path: id + '.png' }));
  const owner = createBlueprintGraph('effect', '组合演出'); addProjectGraphs(project, owner);
  const after = blueprintNodeDefaults('delay'); after.properties.seconds = .4; owner.nodes.push(after);
  connectBlueprintPins(owner, owner.nodes[0].id, 'exec', after.id, 'exec_in');
  const { timeline, node } = addTimelineComponent(project, owner.id, owner.nodes[0].id);
  const clip = insertTimelineAction(project, timeline, { kind: 'background', assetId: 'default_image', transition: 'none', wait: false }, .75);
  exposePerformanceInputs(timeline, [performanceInputs(timeline).find(field => field.nodeId === clip && field.pinId === 'assetId')!]);
  synchronizeBlueprintSignatures(project);
  const passage = project.nodes.find(node => node.kind === 'passage')!;
  passage.lines[0].actions = [{ kind: 'blueprint', blueprintId: owner.id }];
  return { project, owner, timeline, node, after };
}

test('timeline component keeps owner logic and timing, uses default assets when no value is passed', () => {
  const { project, owner, timeline, node, after } = fixture();
  assert.equal(isTimelineComponent(timeline), true);
  assert.equal(isTimelineComponent(owner), false);
  assert.ok(owner.links.some(link => link.fromNodeId === node.id && link.toNodeId === after.id));
  const context = previewActionContext(project);
  const actions = expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: owner.id }], context);
  assert.equal(context.incomplete, false);
  assert.deepEqual(actions.filter(action => action.kind === 'background').map(action => action.assetId), ['default_image']);
  assert.equal(actions[0].kind, 'pause');
  assert.equal(actions[0].kind === 'pause' && actions[0].seconds, .75);
  assert.equal(projectGraphs(projectSchema.parse(project)).find(graph => graph.id === timeline.id)?.timelineComponent, true);
  const compiled = compileProject(project);
  assert.ok(compiled.files['game/story.rpy']);
  assert.ok(compiled.files['game/story.rpy'].includes(`call vn_blueprint_${timeline.id}`));
});

test('blueprint asset wires override one timeline input and explicit empty does not restore its default', () => {
  const { project, owner, timeline, node } = fixture();
  const literal = blueprintNodeDefaults('literal');
  literal.properties.value = 'override_image'; literal.pins[0].dataType = 'asset'; owner.nodes.push(literal);
  const argument = 'arg_' + timeline.exposedInputs[0].id;
  assert.equal(connectBlueprintPins(owner, literal.id, literal.pins[0].id, node.id, argument), undefined);
  const assets = () => expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: owner.id }], previewActionContext(project)).filter(action => action.kind === 'background').map(action => action.assetId);
  assert.deepEqual(assets(), ['override_image']);
  literal.properties.value = '';
  assert.deepEqual(assets(), []);
  assert.equal(timeline.exposedInputs[0].defaultValue, 'default_image');
  const story = compileProject(project).files['game/story.rpy'];
  assert.ok(!story.includes('or "default_image"'));
  owner.links = owner.links.filter(link => link.toNodeId !== node.id || link.toPinId !== argument);
  assert.deepEqual(assets(), ['default_image']);
});

test('canceling a timeline parameter keeps its authored default and removes obsolete call pins', () => {
  const { project, owner, timeline, node } = fixture();
  const exposed = timeline.exposedInputs[0]; exposed.defaultValue = 'override_image';
  const clip = timeline.nodes.find(item => item.type === 'showBackground')!;
  useTimelineDefault(timeline, clip.id, 'assetId');
  synchronizeBlueprintSignatures(project);
  assert.equal(timeline.exposedInputs.length, 0);
  assert.equal(clip.properties.assetId, 'override_image');
  assert.equal(node.pins.some(pin => pin.id === 'arg_' + exposed.id), false);
  const result = expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: owner.id }], previewActionContext(project));
  assert.equal(result.find(action => action.kind === 'background')?.assetId, 'override_image');
});
