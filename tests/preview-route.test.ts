import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, nodeSchema } from '../src/core/model';
import { previewRoute } from '../src/core/preview-route';
import { linePreviewSnapshot } from '../src/core/line-preview';
import { moveStageActor } from '../src/core/stage-edit';

function fixture(specs: Record<string, unknown>[]) {
  const project = createProject();
  project.nodes = specs.map(spec => nodeSchema.parse({ name: spec.id, sceneId: project.scenes[0].id, x: 0, y: 0, ...spec }));
  project.entryId = project.nodes[0].id;
  return project;
}
const passage = (id: string, background: string, next?: string) => ({ id, kind: 'passage', next, lines: [{ id: `${id}_line`, text: id, actions: [{ kind: 'background', assetId: background, transition: 'none' }] }] });
const compare = { kind: 'compare', variableId: 'score', operator: 'gte', value: 2 };

test('preview follows a reachable menu route without accumulating the sibling branch', () => {
  const project = fixture([
    { id: 'menu', kind: 'choice', prompt: '', choices: [{ id: 'left', text: '左路', target: 'a' }, { id: 'right', text: '右路', target: 'b' }] },
    passage('a', 'day', 'merge'), passage('b', 'night', 'merge'),
    { id: 'merge', kind: 'passage', lines: [{ id: 'merge_line', text: '', actions: [] }] },
  ]);
  const snapshot = linePreviewSnapshot(project, { nodeId: 'merge', lineId: 'merge_line' });
  assert.equal(snapshot.before.backgroundId, 'day');
  assert.match(snapshot.routeNote, /左路/);
  assert.deepEqual(previewRoute(project, 'merge')?.nodes.map(node => node.id), ['menu', 'a', 'merge']);
  assert.equal(linePreviewSnapshot(project, { nodeId: 'b', lineId: 'b_line' }).before.backgroundId, undefined);
  const right = linePreviewSnapshot(project, { nodeId: 'merge', lineId: 'merge_line', routeChoices: { 'menu:0': 'right' } });
  assert.equal(right.before.backgroundId, 'night');
  assert.match(right.routeNote, /所选示例路径.*右路/);
  assert.deepEqual(right.routeDecisions[0], { key: 'menu:0', nodeId: 'menu', name: 'menu', selected: 'right', options: [{ id: 'left', label: '左路' }, { id: 'right', label: '右路' }] });
  const impossible = linePreviewSnapshot(project, { nodeId: 'a', lineId: 'a_line', routeChoices: { 'menu:0': 'right' } });
  assert.equal(impossible.before.backgroundId, undefined);
  assert.match(impossible.routeNote, /符合所选分支/);
});

test('repeated choices have separate history entries and constrained loops stay bounded', () => {
  const project = fixture([
    { id: 'menu', kind: 'choice', prompt: '', choices: [{ id: 'again', text: '再来', target: 'round' }, { id: 'done', text: '离开', target: 'target' }] },
    passage('round', 'night', 'menu'), passage('target', 'day'),
  ]);
  const route = previewRoute(project, 'target', { 'menu:0': 'again', 'menu:1': 'done' });
  assert.deepEqual(route?.nodes.map(node => node.id), ['menu', 'round', 'menu', 'target']);
  assert.deepEqual(route?.decisions.map(item => [item.key, item.selected]), [['menu:0', 'again'], ['menu:1', 'done']]);
  assert.equal(previewRoute(project, 'target', { 'menu:0': 'missing' }), undefined);
  const target = project.nodes.at(-1)!; target.id = 'unreachable';
  assert.equal(previewRoute(project, 'target', { 'menu:0': 'again' }), undefined);
});

test('editing inherited animation uses the selected route and preserves the other branch', () => {
  const project = fixture([
    { id: 'menu', kind: 'choice', prompt: '', choices: [{ id: 'left', text: '左路', target: 'a' }, { id: 'right', text: '右路', target: 'b' }] },
    passage('a', 'day', 'merge'), passage('b', 'night', 'merge'),
    { id: 'merge', kind: 'passage', lines: [{ id: 'merge_line', text: '', actions: [] }] },
  ]);
  for (const node of project.nodes) if (node.kind === 'passage' && node.id !== 'merge') node.lines[0].actions.push(
    { kind: 'show', characterId: 'actor', expressionId: 'normal', x: node.id === 'a' ? .1 : .8, y: 1, scale: 1, layer: 0, transition: 'none' },
    { kind: 'animate', characterId: 'actor', repeat: false, wait: false, keyframes: [{ x: .5, y: 1, scale: 1, rotation: 0, opacity: 1, duration: 3, easing: 'linear' }] },
    { kind: 'pause', seconds: .5 },
  );
  const untouched = structuredClone(project.nodes[1]);
  const selection = { nodeId: 'merge', lineId: 'merge_line', routeChoices: { 'menu:0': 'right' } };
  moveStageActor(project, selection, 'actor', { x: .6 }, 500);
  assert.deepEqual(project.nodes[1], untouched);
  const changed = project.nodes[2]; assert.equal(changed.kind, 'passage'); if (changed.kind !== 'passage') return;
  const animation = changed.lines[0].actions[2]; assert.equal(animation.kind, 'animate'); if (animation.kind !== 'animate') return;
  assert.deepEqual(animation.curves?.x?.map(frame => [frame.at, frame.value]), [[0, .8], [1, .6], [3, .5]]);
});

test('bounded loops preserve variable state and select the correct conditional route', () => {
  const project = fixture([
    { id: 'increment', kind: 'set', variableId: 'score', operation: 'add', value: 1, next: 'check' },
    { id: 'check', kind: 'condition', condition: compare, yes: 'target', no: 'increment' },
    passage('target', 'day'),
  ]);
  project.variables = [{ id: 'score', name: 'Score', type: 'number', initial: 0, persistent: false }];
  assert.deepEqual(previewRoute(project, 'target')?.nodes.map(node => node.id), ['increment', 'check', 'increment', 'check', 'target']);
  assert.equal(linePreviewSnapshot(project, { nodeId: 'target', lineId: 'target_line' }).context.variables.score, 2);
  const condition = project.nodes[1];
  if (condition.kind === 'condition') condition.yes = 'increment';
  assert.equal(previewRoute(project, 'target'), undefined);
});

test('calls return to their continuation and carry the subroutine stage', () => {
  const project = fixture([
    { id: 'call', kind: 'call', target: 'sub', next: 'target' },
    { id: 'target', kind: 'passage', lines: [{ id: 'target_line', text: '', actions: [] }] },
    passage('sub', 'sub_background', 'return'), { id: 'return', kind: 'return' },
  ]);
  assert.deepEqual(previewRoute(project, 'target')?.nodes.map(node => node.id), ['call', 'sub', 'return', 'target']);
  assert.equal(linePreviewSnapshot(project, { nodeId: 'target', lineId: 'target_line' }).before.backgroundId, 'sub_background');
});

test('unreachable authoring passages remain editable without unrelated inherited state', () => {
  const project = fixture([passage('entry', 'unrelated'), passage('target', 'local')]);
  const snapshot = linePreviewSnapshot(project, { nodeId: 'target', lineId: 'target_line' });
  assert.equal(snapshot.before.backgroundId, undefined);
  assert.equal(snapshot.after.backgroundId, 'local');
  assert.match(snapshot.routeNote, /未找到/);
  assert.equal(snapshot.context.incomplete, true);
});

test('disabled menu choices and inactive interaction hotspots do not form preview routes', () => {
  const project = fixture([
    { id: 'menu', kind: 'choice', prompt: '', choices: [{ id: 'hidden', text: '隐藏', target: 'target', condition: compare }, { id: 'shown', text: '继续', target: 'interaction' }] },
    { id: 'interaction', kind: 'interaction', prompt: '', hotspots: [{ id: 'spot', name: '热点', x: 0, y: 0, width: 1, height: 1, target: 'target', characterId: 'absent' }], timeout: 'target', timeoutSeconds: 0 },
    passage('target', 'day'),
  ]);
  project.variables = [{ id: 'score', name: 'Score', type: 'number', initial: 0, persistent: false }];
  assert.equal(previewRoute(project, 'target'), undefined);
  const interaction = project.nodes[1];
  if (interaction.kind === 'interaction') interaction.timeoutSeconds = 1;
  assert.equal(previewRoute(project, 'target', { 'menu:0': 'hidden' }), undefined);
  assert.deepEqual(previewRoute(project, 'target')?.choices, ['继续', 'interaction：超时']);
  assert.deepEqual(previewRoute(project, 'target')?.decisions[1].options, [{ id: 'timeout', label: 'interaction：超时' }]);
});
