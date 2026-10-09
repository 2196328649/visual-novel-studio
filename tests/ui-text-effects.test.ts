import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject, projectSchema, type UiComponent } from '../src/core/model';
import { uiTextOutlines } from '../src/core/ui-text-effects';
import { createScreens } from '../src/runtime/screens';
import { uiTextShadow } from '../src/renderer/UiAppearance';

test('text effects survive saving and agree between preview and runtime', () => {
  const project = createProject('文字效果');
  const component: UiComponent = { id: 'shadow_text', kind: 'text', page: 'main', text: '阴影', x: 0, y: 0, width: 0.5, height: 0.1 };
  project.ui.components.push(component);
  component.style = { ...component.style, outlineWidth: 1, outlineOpacity: 0.5, shadowX: -2, shadowY: 3, shadowOpacity: 0.7 };
  const saved = projectSchema.parse(JSON.parse(JSON.stringify(project)));
  const restored = saved.ui.components.find(c => c.id === component.id)!;
  assert.deepEqual(uiTextOutlines(restored), [[1, '#00000080', 0, 0], [0, '#000000b3', -2, 3]]);
  assert.ok(uiTextShadow(restored, 0.5)?.includes('-1px 1.5px 0 #000000b3'));
  assert.ok(createScreens(saved).includes('outlines [[1, "#00000080", 0, 0], [0, "#000000b3", -2, 3]]'));
  restored.style = {};
  assert.deepEqual(uiTextOutlines(restored), []);
  assert.equal(uiTextShadow(restored, 1), undefined);
});
