import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema, type VisualObject } from '../src/core/model';
import { chapterBlueprintPair, createChapterPerformance } from '../src/core/chapter-performances';
import { chapterCompositionBlueprint } from '../src/core/chapter-composition-blueprint';
import { upgradeChapterPresetTypography } from '../src/core/chapter-preset-typography';
import { rawSavedBlueprintAction, updateSavedBlueprintAction } from '../src/core/blueprint-authoring';
import { visualInputFields } from '../src/core/visual-object';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { parseProject } from '../src/desktop/project-store';
import { compileProject } from '../src/runtime/compiler';

function fixture() {
  const project = createProject();
  project.ui.chapterTransition = { effect: 'ink', particles: true };
  project.blueprints.push(...chapterBlueprintPair(createChapterPerformance(project, 'text')));
  return project;
}
const walk = (object: VisualObject): VisualObject[] => [object, ...(object.children?.flatMap(walk) ?? [])];
const children = (project: ReturnType<typeof fixture>) => expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: project.blueprints[0].id }], previewActionContext(project)).filter(a => a.kind === 'visual').flatMap(walk);

test('editable chapter era text and its particles share italic glyphs through save and compilation', () => {
  const project = projectSchema.parse(JSON.parse(JSON.stringify(fixture())));
  const objects = children(project), era = objects.filter(object => object.name === '右侧字' || object.name === '右侧字字形粒子');
  assert.equal(era.length, 2);
  for (const object of era) {
    assert.equal(object.textItalic, true);
    assert.ok(object.keyframes.every(frame => frame.rotation === 0));
  }
  assert.ok(objects.filter(object => !era.includes(object)).every(object => !object.textItalic));
  assert.deepEqual(compileProject(project).diagnostics.filter(item => item.severity === 'error'), []);
});

test('shared chapter typography parameters can turn italics on and off for both text and emission', () => {
  const project = createProject();
  const graph = chapterCompositionBlueprint(project, { title: '春日', subtitle: '1645', duration: 7, effect: 'ink' }, undefined, { fourPartText: true }).graph;
  project.blueprints.push(graph);
  const pin = graph.exposedInputs.find(pin => pin.name === '右侧字斜体')!;
  assert.equal(pin.dataType, 'boolean');
  for (const italic of [true, false]) {
    const output = expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: graph.id, inputs: { [pin.id]: italic } }], previewActionContext(project)).filter(a => a.kind === 'visual').flatMap(walk);
    const pair = output.filter(object => object.text === '1645');
    assert.equal(pair.length, 2);
    assert.ok(pair.every(object => object.textItalic === italic));
  }
});

test('legacy chapter upgrade changes only missing era typography and new pins, once', () => {
  const project = fixture(), [owner, graph] = project.blueprints;
  owner.chapterPresetRevision = graph.chapterPresetRevision = 2;
  const node = graph.nodes.find(node => node.type === 'savedAction')!;
  const root = rawSavedBlueprintAction(node) as VisualObject;
  for (const object of walk(root)) delete object.textItalic;
  const era = walk(root).find(object => object.name === '右侧字')!;
  era.text = '自定义纪年'; era.fontSize = 37; era.keyframes[0].x += .03;
  era.curves!.x![1].value += .07;
  node.properties.action = JSON.stringify(root);
  const italicPins = new Set(visualInputFields(root).filter(field => field.path.at(-1) === 'textItalic').map(field => 'object_' + field.key));
  node.pins = node.pins.filter(pin => !italicPins.has(pin.id));
  const before = structuredClone(project);
  assert.equal(upgradeChapterPresetTypography(project), true);
  const updated = rawSavedBlueprintAction(node) as VisualObject;
  assert.equal(walk(updated).filter(object => object.textItalic).length, 2);
  const stripped = structuredClone(project), strippedNode = stripped.blueprints[1].nodes.find(item => item.id === node.id)!;
  const strippedAction = rawSavedBlueprintAction(strippedNode) as VisualObject;
  for (const object of walk(strippedAction)) delete object.textItalic;
  strippedNode.properties.action = JSON.stringify(strippedAction);
  strippedNode.pins = strippedNode.pins.filter(pin => !italicPins.has(pin.id));
  stripped.blueprints.forEach(graph => graph.chapterPresetRevision = 2);
  assert.deepEqual(stripped, before);
  const once = structuredClone(project);
  assert.equal(upgradeChapterPresetTypography(project), false);
  assert.deepEqual(project, once);
  assert.ok(children(parseProject(project).project).filter(object => object.name === '右侧字' || object.name === '右侧字字形粒子').every(object => object.textItalic));
});

test('explicit upright text and customized chapter layouts survive the typography upgrade', () => {
  const project = fixture(), [owner, graph] = project.blueprints;
  owner.chapterPresetRevision = graph.chapterPresetRevision = 2;
  const node = graph.nodes.find(node => node.type === 'savedAction')!;
  const root = rawSavedBlueprintAction(node) as VisualObject;
  const era = walk(root).find(object => object.name === '右侧字')!;
  const emitter = walk(root).find(object => object.name === '右侧字字形粒子')!;
  era.textItalic = false; delete emitter.textItalic;
  updateSavedBlueprintAction(node, root);
  assert.equal(upgradeChapterPresetTypography(project), true);
  assert.ok(children(project).filter(object => object.name === era.name || object.name === emitter.name).every(object => object.textItalic === false));
  owner.chapterPresetRevision = graph.chapterPresetRevision = 2;
  era.name = '自定义右栏'; node.properties.action = JSON.stringify(root);
  const before = structuredClone(project);
  assert.equal(upgradeChapterPresetTypography(project), false);
  assert.deepEqual(project, before);
});
