import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject, projectSchema, type UiComponent } from '../src/core/model';
import { softShadowOutlines, uiTextOutlines, uiTextShadow } from '../src/core/ui-text-effects';
import { createScreens } from '../src/runtime/screens';

test('text effects survive saving and agree between preview and runtime', () => {
  const project = createProject('文字效果');
  const component: UiComponent = { id: 'shadow_text', kind: 'text', page: 'main', text: '阴影', x: 0, y: 0, width: 0.5, height: 0.1 };
  project.ui.components.push(component);
  component.style = { ...component.style, outlineWidth: 1, outlineOpacity: 0.5, shadowX: -2, shadowY: 3, shadowOpacity: 0.7 };
  const saved = projectSchema.parse(JSON.parse(JSON.stringify(project)));
  const restored = saved.ui.components.find(c => c.id === component.id)!;
  assert.deepEqual(uiTextOutlines(restored), [[1, '#00000080', 0, 0], [0, '#000000b3', -2, 3]]);
  assert.ok(uiTextShadow(restored, 0.5)?.includes('-1px 1.5px 0 #000000b3'));
  assert.match(createScreens(saved), /outlines vn_ui_outlines\(/);
  restored.style = {};
  assert.deepEqual(uiTextOutlines(restored), []);
  assert.equal(uiTextShadow(restored, 1), undefined);
});


test('runtime RGBA text colors multiply field opacity exactly once', () => {
  // RGBA comes from a private runtime snapshot; it is not an authored RGB field.
  const component = { style: { outlineWidth: 2, outlineColor: '#33669980', outlineOpacity: .5, shadowX: 3, shadowY: -4, shadowColor: '#abcdef80', shadowOpacity: .25 } };
  assert.deepEqual(uiTextOutlines(component), [[2, '#33669940', 0, 0], [0, '#abcdef20', 3, -4]]);
  assert.ok(uiTextShadow(component, .5)?.includes('1.5px -2px 0 #abcdef20'));
  assert.ok(uiTextShadow({ style: { ...component.style, shadowBlur: 6 } }, .5)?.includes('1.5px -2px 3px #abcdef20'));
  const contours = softShadowOutlines(6, '#abcdef80', .75);
  assert.ok(contours.length > 1);
  assert.ok(contours.every(([, color]) => /^#[0-9a-f]{8}$/i.test(color)));
  const composited = contours.reduce((covered, [, color]) => covered + (1 - covered) * parseInt(color.slice(7), 16) / 255, 0);
  assert.ok(Math.abs(composited - .75 * 128 / 255) < .01, 'contours must compose to the effective source alpha, not an alpha multiplied per layer');
  assert.deepEqual(softShadowOutlines(6, '#abcdef00', 1), []);
});
