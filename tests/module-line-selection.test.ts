import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, newNode, type Project } from '../src/core/model';
import { moduleLineSelection } from '../src/renderer/module-line-selection';

function story() {
  const project = createProject('台词选区');
  const node = newNode('passage', project.scenes[0].id);
  if (node.kind !== 'passage') throw new Error('passage expected');
  node.lines = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, text: id, actions: [] }));
  project.nodes = [node]; project.entryId = node.id;
  return { project, nodeId: node.id };
}
function keep(project: Project, ids: string[]) {
  const next = structuredClone(project), node = next.nodes[0];
  if (node.kind !== 'passage') throw new Error('passage expected');
  node.lines = node.lines.filter(line => ids.includes(line.id));
  return next;
}

test('deleting a selected line chooses the following survivor even when earlier lines were removed too', () => {
  const { project, nodeId } = story(), before = structuredClone(project);
  assert.equal(moduleLineSelection(keep(project, ['a', 'c', 'd', 'e']), nodeId, 'b', project), 'c');
  assert.equal(moduleLineSelection(keep(project, ['d', 'e']), nodeId, 'c', project), 'd');
  assert.equal(moduleLineSelection(keep(project, ['a', 'b']), nodeId, 'e', project), 'b');
  assert.deepEqual(project, before);
});

test('undoing a copied or added selected line restores a neighbour; undoing deletion preserves a valid selection', () => {
  const { project, nodeId } = story(), inserted = structuredClone(project), node = inserted.nodes[0];
  if (node.kind !== 'passage') throw new Error('passage expected');
  node.lines.splice(2, 0, { id: 'copy', text: 'b', actions: [] });
  assert.equal(moduleLineSelection(project, nodeId, 'copy', inserted), 'c');
  node.lines.push({ id: 'new', text: '', actions: [] });
  assert.equal(moduleLineSelection(project, nodeId, 'new', inserted), 'e');
  assert.equal(moduleLineSelection(project, nodeId, 'c', keep(project, ['a', 'c', 'd', 'e'])), 'c');
  assert.equal(moduleLineSelection(keep(project, ['a', 'c']), nodeId, 'a', project), 'a');
});

test('an empty or non-passage selection clears the line without borrowing another passage or project', () => {
  const { project, nodeId } = story(), empty = keep(project, []);
  const other = newNode('passage', project.scenes[0].id); empty.nodes.push(other);
  assert.equal(moduleLineSelection(empty, nodeId, 'b', project), undefined);
  assert.equal(moduleLineSelection(project, nodeId, undefined, project), undefined);
  assert.equal(moduleLineSelection(project, 'missing', 'b', project), undefined);
  const changedKind = structuredClone(project); changedKind.nodes[0] = { ...newNode('end', project.scenes[0].id), id: nodeId };
  assert.equal(moduleLineSelection(changedKind, nodeId, 'b', project), undefined);
  const anotherProject = keep(project, ['a', 'c']); anotherProject.id = 'another';
  assert.equal(moduleLineSelection(anotherProject, nodeId, 'b', project), 'a');
});
