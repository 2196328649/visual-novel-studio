import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject, projectSchema } from '../src/core/model';
import { createMediaVisual } from '../src/core/media-command';
import { canonicalImageVisual, imageTransform } from '../src/core/image-transform';
import { actionText, textCommandAction } from '../src/core/text-script';
import { setVisualPropertiesAt, visualPose } from '../src/core/visual-object';

const fixture = () => {
  const project = createProject(); project.width = 800; project.height = 450;
  project.assets = [{ id: 'image', name: '图片', kind: 'image', path: 'image.png', width: 160, height: 90 }];
  return project;
};
test('image axes are independent after fit and survive text and schema round trips', () => {
  const project = fixture(), image = createMediaVisual('image', 'image', { scaleX: .3, scaleY: .6, rotation: 90 });
  const source = actionText(project, image);
  assert.match(source, /"缩放":\[0.3,0.6\]/); assert.doesNotMatch(source, /尺寸|宽度|高度/);
  assert.deepEqual(textCommandAction(project, source, true), image);
  const node = project.nodes.find(node => node.kind === 'passage')!;
  node.lines[0].actions = [image];
  const reopened = projectSchema.parse(JSON.parse(JSON.stringify(project))).nodes.find(item => item.id === node.id);
  assert.ok(reopened?.kind === 'passage'); assert.deepEqual(reopened.lines[0].actions[0], image);
  image.keyframes[0].scaleX = .8;
  assert.equal(visualPose(image, 0).scaleX, .8); assert.equal(visualPose(image, 0).scaleY, .6);
});
test('axis animation edits preserve the other axis and retain curve endpoints', () => {
  const image = createMediaVisual('image', 'image', { duration: 2, scaleX: .5, scaleY: .8 });
  image.keyframes.push({ ...image.keyframes[0], scaleX: 1.5, duration: 2 });
  assert.equal(visualPose(image, 1).scaleX, 1); assert.equal(visualPose(image, 1).scaleY, .8);
  setVisualPropertiesAt(image, 1, { scaleX: 1.2 });
  assert.equal(visualPose(image, 0).scaleX, .5); assert.equal(visualPose(image, 1).scaleX, 1.2); assert.equal(visualPose(image, 2).scaleX, 1.5);
  assert.equal(visualPose(image, 1).scaleY, .8);
});
test('replacing a fitted size with axis scale preserves the visible image geometry', () => {
  const project = fixture();
  const fitted = canonicalImageVisual(project, createMediaVisual('image', 'image', { width: .2, height: .8, scale: 1.5 }))!;
  assert.equal(fitted.width, 1); assert.equal(fitted.height, 1);
  assert.ok(Math.abs(imageTransform(fitted).scaleX - .3) < 1e-12); assert.ok(Math.abs(imageTransform(fitted).scaleY - .3) < 1e-12);
  const stretched = canonicalImageVisual(project, createMediaVisual('image', 'image', { width: .2, height: .8, scale: 1.5, fit: 'stretch' }))!;
  assert.ok(Math.abs(imageTransform(stretched).scaleX - .3) < 1e-12); assert.ok(Math.abs(imageTransform(stretched).scaleY - 1.2) < 1e-12);
  assert.equal(canonicalImageVisual(project, createMediaVisual('image', 'image', { width: .2, height: .8, fit: 'cover' })), undefined);
});
