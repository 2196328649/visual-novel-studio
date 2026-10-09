import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema, type UiComponent } from '../src/core/model';
import { uiHoverSound } from '../src/core/ui-sound';
import { validateProject } from '../src/core/validate';
import { createUiRuntime } from '../src/runtime/ui-runtime';

test('UI hover sound inherits, overrides, silences and validates actual audio references', () => {
  const p = createProject('UI feedback');
  p.assets.push({ id: 'hover', kind: 'audio', name: 'hover', path: 'assets/hover.ogg' }, { id: 'title', kind: 'audio', name: 'title', path: 'assets/title.ogg' });
  p.ui.hoverSoundId = 'hover';
  const c: UiComponent = { id: 'button', kind: 'button', page: 'main', text: 'Test', x: 0, y: 0, width: .2, height: .1 };
  p.ui.components.push(c);
  assert.equal(uiHoverSound(p, c), 'hover');
  c.hoverSoundId = 'title';
  assert.equal(uiHoverSound(p, c), 'title');
  c.hoverSoundId = null;
  assert.equal(uiHoverSound(p, c), undefined);
  assert.equal(projectSchema.parse(p).ui.components.find(c => c.id === 'button')?.hoverSoundId, null);
  c.hoverSoundId = 'missing';
  assert.equal(uiHoverSound(p, c), undefined);
  assert.ok(validateProject(p).some(d => d.message.includes('missing')));
});

test('runtime keeps menu feedback on its own sfx channel and retains explicit silent overrides', () => {
  const p = createProject('UI feedback');
  p.assets.push({ id: 'hover', kind: 'audio', name: 'hover', path: 'assets/hover.ogg' });
  p.ui.hoverSoundId = 'hover';
  p.ui.components.push({ id: 'silent', kind: 'button', page: 'main', text: 'Quiet', hoverSoundId: null, x: 0, y: 0, width: .2, height: .1 });
  const runtime = createUiRuntime(p);
  assert.match(runtime, /"silent": None/);
  assert.match(runtime, /register_channel\("vn_ui_feedback", mixer="sfx"/);
  assert.match(runtime, /properties\["hover_sound"\] = None/);
  assert.match(runtime, /vn_ui_hover_sound = "assets\/hover.ogg"/);
});
