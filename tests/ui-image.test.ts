import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiImageFixture } from '../scripts/lib/ui-image-fixture';
import { uiImageAsset, uiImageCrop, uiImagePatches, uiImageRequest, acceptUiImageReport } from '../src/core/ui-image';
import { uiProperties, uiPropertyApplies, uiPropertyDefault, uiPropertyValueProblem } from '../src/core/ui-properties';
import { appendUiPreviewEvent, previewUiLogic, uiPreviewInputCount, type UiPreviewEvent } from '../src/core/ui-logic-preview';
import { projectSchema } from '../src/core/model';
import { ensureUiImageEvent } from '../src/core/ui-logic';
import { synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { validateBlueprints } from '../src/core/blueprint-validation';
import { projectForExport } from '../src/core/export-assets';
import { compileProject } from '../src/runtime/compiler';

const click = (name: string): UiPreviewEvent => ({ kind: 'click', componentId: 'image_action_' + name.toLowerCase() });
const sample = (f: ReturnType<typeof createUiImageFixture>, events: UiPreviewEvent[] = []) => previewUiLogic(f.project, f.page.components, f.page.id, {}, events, { timed: true, trace: true, host: 'story' });
const feedback = (preview: ReturnType<typeof sample>, componentId = 'picture', status: 'loaded' | 'failed' = 'loaded'): Extract<UiPreviewEvent, { kind: 'image' }> => {
  const request = preview.imageRequests[componentId];
  return { kind: 'image', componentId, pageInstance: request.pageInstance, sequence: request.sequence, assetId: request.assetId, status, width: status === 'loaded' ? 64 : 0, height: status === 'loaded' ? 32 : 0, error: status === 'failed' ? '图片无法读取或解码。' : '' };
};

// Source only. Execute with the rest of the un-deferred work at final acceptance.
test('image properties have typed capabilities and survive schema round trips', () => {
  const f = createUiImageFixture(), image = f.page.components[0];
  image.imageEffects = { cropX: .25, cropY: 0, cropWidth: .5, cropHeight: 1, flipX: true, flipY: false, tint: '#12345680' };
  const saved = projectSchema.parse(JSON.parse(JSON.stringify(f.project)));
  assert.deepEqual(saved.ui.customPages.find(p => p.id === f.page.id)!.components[0].imageEffects, image.imageEffects);
  for (const property of ['imageCropX', 'imageCropY', 'imageCropWidth', 'imageCropHeight', 'imageFlipX', 'imageFlipY', 'imageTint', 'imageStatus', 'imageError', 'imageSource', 'imageSourceWidth', 'imageSourceHeight'] as const) {
    assert.equal(uiPropertyApplies(image, property, f.project), true); assert.equal(uiPropertyApplies(f.page.components[1], property, f.project), false);
    assert.equal(uiProperties[property].animated, false); assert.equal(uiProperties[property].preview && uiProperties[property].runtime, true);
  }
  assert.equal(uiPropertyDefault(f.project, image, 'imageCropX'), .25);
  assert.ok(uiPropertyValueProblem(f.project, 'imageCropX', 1.01)); assert.ok(uiPropertyValueProblem(f.project, 'imageCropWidth', Infinity));
  assert.equal(uiPropertyValueProblem(f.project, 'imageCropWidth', 0), undefined);
  assert.equal(uiPropertyValueProblem(f.project, 'imageTint', '#abcdef80'), undefined); assert.ok(uiPropertyValueProblem(f.project, 'imageTint', 'red'));
});

test('source pixel cropping intersects the source and supports a transparent empty area', () => {
  assert.deepEqual(uiImageCrop(64, 32, { cropX: .25, cropWidth: .5 }), { x: 16, y: 0, width: 32, height: 32 });
  assert.deepEqual(uiImageCrop(64, 32, { cropX: .75, cropY: .5, cropWidth: 1, cropHeight: 1 }), { x: 48, y: 16, width: 16, height: 16 });
  assert.equal(uiImagePatches(uiImageCrop(64, 32, { cropWidth: 0 }), 320, 200).length, 0);
  assert.deepEqual(uiImagePatches(uiImageCrop(64, 32), 200, 200, 'contain')[0].target, { x: 0, y: 50, width: 200, height: 100 });
  assert.deepEqual(uiImagePatches(uiImageCrop(64, 32), 200, 200, 'cover')[0].target, { x: -100, y: 0, width: 400, height: 200 });
});

test('nine-slice uses cropped source borders and never creates overlapping cuts for tiny boxes', () => {
  const source = uiImageCrop(64, 32, { cropX: .25, cropWidth: .5 });
  const patches = uiImagePatches(source, 160, 90, 'nineSlice', { left: 8, right: 8, top: 6, bottom: 6 });
  assert.equal(patches.length, 9); assert.deepEqual(patches[0].source, { x: 16, y: 0, width: 8, height: 6 });
  assert.deepEqual(patches[4].target, { x: 8, y: 6, width: 144, height: 78 });
  for (const size of [1, 2, 3, 5, 17]) {
    const tiny = uiImagePatches({ x: 0, y: 0, width: size, height: size }, size, size, 'nineSlice');
    assert.equal(tiny.reduce((total, patch) => total + patch.target.width * patch.target.height, 0), size * size);
    for (const patch of tiny) assert.ok(patch.source.width > 0 && patch.source.height > 0 && patch.target.width > 0 && patch.target.height > 0);
  }
});

test('requests accept one typed terminal result and reject stale assets, pages, sequences and invalid sizes', () => {
  const a = uiImageRequest(undefined, 'a', 1), next = uiImageRequest(a, 'b', 1), returned = uiImageRequest(next, 'a', 1);
  assert.equal(uiImageRequest(a, 'a', 1), a); assert.equal(returned.sequence, 3);
  const report = { pageInstance: 1, sequence: 1, assetId: 'a', status: 'loaded' as const, width: 64, height: 32 };
  assert.equal(acceptUiImageReport(returned, report), undefined); assert.equal(acceptUiImageReport(uiImageRequest(a, 'a', 2), report), undefined);
  assert.equal(acceptUiImageReport(a, { ...report, width: 0 }), undefined);
  const loaded = acceptUiImageReport(a, report)!; assert.equal(loaded.status, 'loaded'); assert.equal(acceptUiImageReport(loaded, report), undefined);
  const cleared = uiImageRequest(a, '', 1); assert.equal(cleared.status, 'empty'); assert.equal(acceptUiImageReport(cleared, report), undefined);
  const inherited = uiImageRequest(undefined, 'hover', 1, 'a'); assert.equal(uiImageRequest(inherited, 'hover', 1, 'b').sequence, 2);
});

test('registered assets do not fake load success; real feedback supplies snapshot outputs exactly once', () => {
  const f = createUiImageFixture(), original = structuredClone(f.project), initial = sample(f);
  assert.equal(initial.imageRequests.picture.status, 'loading'); assert.equal(initial.variables.image_loaded, 0);
  const report = feedback(initial), result = sample(f, [report, report, click('observe')]);
  assert.equal(result.incomplete, false); assert.equal(result.variables.image_loaded, 1); assert.equal(result.variables.image_failed, 0);
  assert.equal(result.variables.image_event_width, 64); assert.equal(result.variables.image_event_height, 32); assert.equal(result.variables.image_event_error, '');
  assert.equal(result.variables.image_status, 'loaded'); assert.equal(result.variables.image_width, 64); assert.equal(result.variables.image_height, 32);
  assert.deepEqual(f.project, original);
});

test('effects and fit preserve load identity; source replacement and restore reject old callbacks', () => {
  const f = createUiImageFixture(), initial = sample(f), report = feedback(initial);
  const effects = sample(f, [report, click('effects'), click('nineSlice')]);
  assert.equal(effects.imageRequests.picture.sequence, initial.imageRequests.picture.sequence); assert.equal(effects.variables.image_loaded, 1);
  const rendered = effects.components.find(row => row.component.id === 'picture')!.component;
  assert.equal(rendered.imageEffects?.cropX, .25); assert.equal(rendered.imageEffects?.flipX, true); assert.equal(rendered.imageEffects?.tint, '#80ffff80');
  const changed = sample(f, [report, click('swap'), report]); assert.equal(changed.imageRequests.picture.status, 'loading'); assert.equal(changed.variables.image_loaded, 1);
  const restored = sample(f, [report, click('swap'), click('restore'), report]); assert.equal(restored.imageRequests.picture.sequence, 3); assert.equal(restored.imageRequests.picture.status, 'loading');
  assert.equal(sample(f, [report, click('clear'), report]).imageRequests.picture.status, 'empty');
});

test('failure is a snapshot event, not an exception or a successful registered resource', () => {
  const f = createUiImageFixture(), pending = sample(f, [click('fail')]), report = feedback(pending, 'picture', 'failed');
  const result = sample(f, [click('fail'), report, click('observe')]);
  assert.equal(result.incomplete, false); assert.equal(result.variables.image_loaded, 0); assert.equal(result.variables.image_failed, 1);
  assert.equal(result.variables.image_status, 'failed'); assert.equal(result.variables.image_event_width, 0); assert.match(String(result.variables.image_event_error), /无法/);
  const reset = sample(f, [click('fail'), report, click('reset')]); assert.equal(reset.imageRequests.picture.status, 'loading'); assert.equal(reset.imageRequests.picture.assetId, 'picture_a');
});

test('state images follow inherited buttons while image effects do not transform the hierarchy', () => {
  const f = createUiImageFixture(), image = f.page.components.find(c => c.id === 'picture_state')!;
  assert.equal(uiImageAsset(image, 'hover'), 'picture_b'); assert.equal(uiImageAsset({ ...image, parentId: undefined }, 'hover'), 'picture_a');
  const initial = sample(f), hovered = sample(f, [{ kind: 'button', componentId: 'picture_parent', trigger: 'hover' }]);
  assert.equal(initial.imageRequests.picture_state.assetId, 'picture_a'); assert.equal(hovered.imageRequests.picture_state.assetId, 'picture_b');
  assert.equal(hovered.imageRequests.picture_state.sequence, 2);
  const before = initial.components.find(row => row.component.id === 'picture')!.component, after = sample(f, [click('effects')]).components.find(row => row.component.id === 'picture')!.component;
  for (const property of ['x', 'y', 'width', 'height'] as const) assert.equal(after[property], before[property]);
});

test('load feedback is not user input and can complete under a modal child', () => {
  const f = createUiImageFixture(), initial = sample(f), report = feedback(initial);
  const result = sample(f, [click('child'), report]); assert.equal(result.pageId, f.child.id); assert.equal(result.variables.image_loaded, 1);
  const closed = sample(f, [click('close'), report]); assert.equal(closed.variables.image_loaded, 0); assert.equal(closed.imageRequests.picture, undefined);
  let events: UiPreviewEvent[] = [];
  for (let i = 0; i < 300; i++) events = appendUiPreviewEvent(events, { ...report, componentId: 'image_' + i });
  events = appendUiPreviewEvent(events, click('observe'));
  assert.equal(events.length, 301); assert.equal(uiPreviewInputCount(events), 1); assert.equal(appendUiPreviewEvent(events, events[0]), events);
});

test('image events use the common authoring and compiler paths, preserve resources and reject unsupported targets', () => {
  const f = createUiImageFixture(), before = f.graph.nodes.length;
  assert.equal(ensureUiImageEvent(f.project, f.graph, 'picture', f.page.id, 'loaded').id, f.eventRoots.loaded.id); assert.equal(f.graph.nodes.length, before);
  assert.deepEqual(f.eventRoots.loaded.pins.filter(pin => pin.direction === 'output').map(pin => [pin.id, pin.dataType]), [['exec', 'exec'], ['assetId', 'asset'], ['error', 'string'], ['width', 'number'], ['height', 'number']]);
  assert.deepEqual(validateBlueprints(f.project).filter(issue => issue.severity === 'error'), []);
  for (const id of ['picture_a', 'picture_b', 'picture_broken']) assert.ok(projectForExport(f.project).assets.some(asset => asset.id === id));
  const compiled = compileProject(f.project); assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), []);
  const source = Object.values(compiled.files).join('\n'); assert.match(source, /VnUiImageSurface/); assert.match(source, /vn_ui_image_poll/); assert.match(source, /vn_ui_image_release/); assert.match(source, /vn_bp_event_values/);
  f.eventRoots.loaded.properties.componentId = 'picture_parent'; synchronizeBlueprintSignatures(f.project);
  assert.ok(validateBlueprints(f.project).some(issue => issue.nodeId === f.eventRoots.loaded.id));
  f.editorSet.properties.property = 'imageStatus'; synchronizeBlueprintSignatures(f.project);
  assert.ok(validateBlueprints(f.project).some(issue => issue.nodeId === f.editorSet.id && /只读/.test(issue.message)));
});
