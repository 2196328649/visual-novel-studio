import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiPropertyFixture } from '../scripts/lib/ui-property-fixture';
import { previewUiLogic, type UiPreviewEvent } from '../src/core/ui-logic-preview';
import { uiProperties, uiPropertyDefaults, uiPropertyDefault, uiPropertyValueProblem, uiPropertySources, uiPropertyFallbacks } from '../src/core/ui-properties';
import { synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { validateBlueprints } from '../src/core/blueprint-validation';
import { createUiParameterBinding } from '../src/core/ui-logic';
import { projectForExport } from '../src/core/export-assets';
import { compileProject } from '../src/runtime/compiler';

function sample(f: ReturnType<typeof createUiPropertyFixture>, events: UiPreviewEvent[]) {
  return previewUiLogic(f.project, f.page.components, f.page.id, {}, events, { trace: true });
}
function equal(actual: unknown, expected: unknown) {
  if (typeof expected === 'number') assert.ok(typeof actual === 'number' && Math.abs(actual - expected) < 1e-8, String(actual) + ' != ' + expected);
  else assert.equal(actual, expected);
}

test('ordinary property matrix reads actual values and default geometry without mutating the design', () => {
  const f = createUiPropertyFixture(), original = structuredClone(f.project);
  const result = sample(f, [{ kind: 'click', componentId: 'apply' }]);
  assert.equal(result.incomplete, false);
  for (const record of f.records) equal(result.variables[record.variableId], record.expected);
  const caption = result.components.find(row => row.component.id === 'caption')!.component;
  equal(caption.x, .3); equal(caption.width, .2);
  assert.equal(caption.style?.shadowBlur, 4); assert.equal(caption.style?.shadowOpacity, .25);
  assert.equal(result.components.find(row => row.component.id === 'bottom')?.component.style?.hoverBackground, '#224466');
  assert.equal(result.components.find(row => row.component.id === 'frame')?.component.style?.background, '#12223380');
  assert.deepEqual(f.project, original);
  assert.equal(uiPropertyDefault(f.project, f.page.components[1], 'screenX'), 320);
});

test('single-field reset keeps other state colors, media and geometry overrides', () => {
  const f = createUiPropertyFixture(), result = sample(f, [{ kind: 'click', componentId: 'apply' }, { kind: 'click', componentId: 'swap' }, { kind: 'click', componentId: 'reset' }]);
  assert.equal(result.incomplete, false);
  const component = (id: string) => result.components.find(row => row.component.id === id)!.component;
  assert.equal(component('caption').style?.textColor, '#ddeeff');
  assert.equal(component('caption').style?.hoverTextColor, '#f040d0');
  assert.equal(component('caption').style?.shadowOpacity, .25);
  assert.equal(component('frame').style?.borderWidth, 0); assert.equal(component('frame').style?.background, '#12223380');
  assert.equal(component('probe').clickSoundId, 'click_tone');
  assert.equal(component('bottom').layer, 20);
  assert.ok(result.components.findIndex(row => row.component.id === 'bottom') < result.components.findIndex(row => row.component.id === 'top'));
});

test('layer order stays inside a parent subtree and its background/foreground group', () => {
  const f = createUiPropertyFixture(), result = sample(f, [{ kind: 'click', componentId: 'swap' }]);
  const index = (id: string) => result.components.findIndex(row => row.component.id === id);
  assert.ok(index('top') < index('bottom'));
  assert.ok(index('decoration') < index('frame')); assert.ok(index('frame') < index('caption'));
  assert.ok(index('caption') < index('top'));
  const defaults = uiPropertyDefaults(f.project, f.page.components);
  assert.equal(defaults.bottom.layer, 20); assert.equal(defaults.frame.layer, 0);
  assert.equal(defaults.caption.layer, 1); assert.equal(defaults.caption.screenWidth, 384);
});

test('pointer observations are read-only and accepted-click feedback is not synthesized by press/cancel', () => {
  const f = createUiPropertyFixture();
  const apply: UiPreviewEvent = { kind: 'click', componentId: 'apply' };
  const result = sample(f, [apply, { kind: 'button', componentId: 'probe', trigger: 'hover' }, { kind: 'button', componentId: 'probe', trigger: 'press' }, { kind: 'button', componentId: 'probe', trigger: 'release', inside: true }, { kind: 'button', componentId: 'probe', trigger: 'unhover' }]);
  assert.equal(result.incomplete, false);
  assert.equal(result.variables.probe_hover, true); assert.equal(result.variables.probe_down, true);
  assert.equal(result.variables.probe_up, false); assert.equal(result.variables.probe_unhover, false);
  assert.deepEqual(result.clickFeedback.map(event => event.assetId), ['', 'click_tone']);
  const cancelled = sample(f, [apply, { kind: 'button', componentId: 'probe', trigger: 'press' }, { kind: 'button', componentId: 'probe', trigger: 'cancel' }, { kind: 'button', componentId: 'probe', trigger: 'release', inside: true }]);
  assert.deepEqual(cancelled.clickFeedback.map(event => event.assetId), ['']);
  const outside = sample(f, [apply, { kind: 'button', componentId: 'probe', trigger: 'press' }, { kind: 'button', componentId: 'probe', trigger: 'release', inside: false }]);
  assert.deepEqual(outside.clickFeedback.map(event => event.assetId), ['']);
});

test('read-only observations are rejected by authoring, graph validation and preview writes', () => {
  const f = createUiPropertyFixture();
  f.editorSet.properties = { componentId: 'probe', property: 'pressed', value: false }; synchronizeBlueprintSignatures(f.project);
  assert.ok(validateBlueprints(f.project).some(issue => issue.nodeId === f.editorSet.id && /只读/.test(issue.message)));
  const before = structuredClone(f.project);
  assert.throws(() => createUiParameterBinding(f.project, 'probe', 'pressed', 'probe_down', f.page.id), /类型不匹配/);
  assert.deepEqual(f.project, before);
  const reachable = f.graph.nodes.find(node => node.type === 'setUiProperty')!;
  reachable.properties = { componentId: 'probe', property: 'hovered', value: true }; synchronizeBlueprintSignatures(f.project);
  assert.equal(sample(f, [{ kind: 'click', componentId: 'apply' }]).incomplete, true);
  for (const property of ['hovered', 'pressed', 'screenX', 'screenY', 'screenWidth', 'screenHeight'] as const) assert.equal(uiProperties[property].writable, false);
});

test('color alpha, ranges, capability sources and blueprint-only sound collection are explicit', () => {
  const f = createUiPropertyFixture();
  assert.equal(uiPropertyValueProblem(f.project, 'background', '#12345680'), undefined);
  assert.ok(uiPropertyValueProblem(f.project, 'background', '#12345'));
  assert.ok(uiPropertyValueProblem(f.project, 'borderWidth', -1)); assert.equal(uiPropertyValueProblem(f.project, 'borderWidth', 33), undefined); assert.ok(uiPropertyValueProblem(f.project, 'shadowBlur', Infinity));
  assert.ok(uiPropertyValueProblem(f.project, 'clickSound', 'missing'));
  assert.ok(projectForExport(f.project).assets.some(asset => asset.id === 'click_tone'));
  assert.ok(uiPropertySources(f.page.components[6], 'background').some(source => source.includes('页面实例覆盖')));
  const compiled = compileProject(f.project);
  assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), []);
  const source = Object.values(compiled.files).join('\n');
  assert.match(source, /for _vn_component index _vn_component in vn_ui_layer_order/);
  assert.match(source, /use expression .*_component_/);
  assert.match(source, /vn_ui_box[(]/);
  assert.match(source, /此属性是只读的运行观察值/);
  assert.match(source, /vn_ui_play_click/);
});


test('progress fill remains independent of the track and hover background', () => {
  const f = createUiPropertyFixture(), component = { id: 'fill', kind: 'progress' as const, page: 'custom' as const, text: '', x: 0, y: 0, width: 1, height: .1, style: { background: '#122233', hoverBackground: '#445566' } };
  assert.equal(uiPropertyDefault(f.project, component, 'selectedBackground'), f.project.ui.accent);
  assert.deepEqual(uiPropertyFallbacks(component, 'selectedBackground'), []);
  const authored = { ...component, style: { ...component.style, selectedBackground: '#aaccee' } };
  assert.equal(uiPropertyDefault(f.project, authored, 'selectedBackground'), '#aaccee');
});
