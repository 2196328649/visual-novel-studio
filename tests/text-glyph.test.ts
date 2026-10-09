import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema, visualObjectSchema } from '../src/core/model';
import { createVisualObject, applyVisualInputs, visualInputFields } from '../src/core/visual-object';
import { compileProject } from '../src/runtime/compiler';
import { applyTextScript, projectToText } from '../src/core/text-script';

test('text glyphs preserve text inputs through project and script roundtrips without an image', () => {
  const object = createVisualObject('particles');
  object.glyphParticles = { source: 'text', count: 200, emissionStart: 0, timeScale: 1, motionScale: 1, sizeScale: 1, rect: { x: 0, y: 0, width: 1, height: 1 } };
  const fields = visualInputFields(object);
  assert.ok(fields.some(field => field.key === 'text'));
  assert.ok(fields.some(field => field.key === 'fontSize'));
  assert.ok(!fields.some(field => field.key === 'glyphAssetId'));
  const changed = applyVisualInputs(object, { text: '春日\n{Chapter} <1>', fontSize: 48 });
  const project = createProject();
  const passage = project.nodes.find(node => node.kind === 'passage')!;
  passage.lines[0].actions = [changed];
  const restored = applyTextScript(projectSchema.parse(project), projectToText(project)).project;
  assert.deepEqual(restored.nodes.find(node => node.kind === 'passage')!.lines[0].actions, [visualObjectSchema.parse(changed)]);
  assert.equal(compileProject(restored).diagnostics.filter(item => item.severity === 'error').length, 0);
  assert.equal(object.text, '');
  const image = { ...object, glyphParticles: { ...object.glyphParticles, source: undefined, assetId: 'legacy' } };
  assert.equal(visualInputFields(image).find(field => field.key === 'glyphAssetId')?.value, 'legacy');
  assert.ok(!visualInputFields(image).some(field => field.key === 'text'));
});

test('empty visual font inputs preserve authored defaults and never create invalid empty asset ids', () => {
  for (const fontAssetId of [undefined, 'authored_font']) {
    const object = { ...createVisualObject('text'), fontAssetId };
    const result = applyVisualInputs(object, { fontAssetId: '' });
    assert.equal(result.fontAssetId, fontAssetId);
    assert.ok(visualObjectSchema.safeParse(result).success);
    assert.equal(applyVisualInputs(object, { fontAssetId: 'new_font' }).fontAssetId, 'new_font');
  }
});
