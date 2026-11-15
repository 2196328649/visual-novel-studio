import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema } from '../src/core/model';

const accepts = (edit: (project: ReturnType<typeof createProject>) => void) => {
  const project = createProject(); edit(project);
  return projectSchema.safeParse(project).success;
};

test('authored numbers only reject values that cannot work, not arbitrary style limits', () => {
  assert.ok(accepts(p => { p.ui.fontSize = 120; }), 'large global font size');
  assert.ok(accepts(p => { p.ui.fontSize = 8; }), 'small global font size');
  assert.ok(accepts(p => { p.ui.dialogueHeight = 0.9; }), 'tall dialogue box');
  assert.ok(accepts(p => { p.width = 7680; p.height = 4320; }), '8K resolution');
  assert.ok(accepts(p => { p.ui.pages = { ...p.ui.pages, main: { ...p.ui.pages?.main, appearance: { fontSize: 100 } } }; }), 'large page font size');

  assert.ok(!accepts(p => { p.ui.fontSize = 0; }), 'zero font size');
  assert.ok(!accepts(p => { p.ui.fontSize = 12.5; }), 'fractional font size');
  assert.ok(!accepts(p => { p.ui.dialogueHeight = 0; }), 'zero dialogue height');
  assert.ok(!accepts(p => { p.ui.dialogueHeight = 1.5; }), 'dialogue taller than the screen');
  assert.ok(!accepts(p => { p.width = 0; }), 'zero resolution');
  assert.ok(!accepts(p => { p.ui.pages = { ...p.ui.pages, main: { ...p.ui.pages?.main, appearance: { fontSize: -4 } } }; }), 'negative page font size');
});
