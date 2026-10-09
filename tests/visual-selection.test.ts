import test from 'node:test';
import assert from 'node:assert/strict';
import { createVisualObject } from '../src/core/visual-object';
import { visualInstancePath } from '../src/core/visual-selection';

test('nested selection follows identity through reorder, reparenting and removal', () => {
  const root = createVisualObject('group'), group = createVisualObject('group');
  const selected = createVisualObject('text'), sibling = createVisualObject('text');
  root.children = [selected, sibling, group];
  assert.deepEqual(visualInstancePath(root, selected.instanceId), [0]);
  root.children.reverse();
  assert.deepEqual(visualInstancePath(root, selected.instanceId), [2]);
  root.children.pop(); group.children = [selected];
  assert.deepEqual(visualInstancePath(root, selected.instanceId), [0, 0]);
  group.children = [];
  assert.equal(visualInstancePath(root, selected.instanceId), undefined);
  assert.deepEqual(visualInstancePath(root, root.instanceId), []);
});

test('ambiguous identities cannot silently select an unrelated object', () => {
  const root = createVisualObject('group'), child = createVisualObject('text');
  root.children = [child, structuredClone(child)];
  assert.equal(visualInstancePath(root, child.instanceId), undefined);
});
