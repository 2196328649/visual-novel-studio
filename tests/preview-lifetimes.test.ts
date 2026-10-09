import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, type StageAction } from '../src/core/model';
import { applyPreviewAction, initialPreviewStage, linePlaybackPlan } from '../src/core/line-preview';
import { createVisualObject } from '../src/core/visual-object';
import { previewLifetimes } from '../src/core/preview-lifetimes';

test('inherited visual lifetimes retain their clock and children clip at replacement', () => {
  const project = createProject(), before = initialPreviewStage();
  const expired = { ...createVisualObject('text'), duration: .5 };
  const child = { ...createVisualObject('solid'), startAt: 1, duration: 5 };
  const group = { ...createVisualObject('group'), duration: 6, children: [expired, child] };
  before.visuals.set(group.instanceId, { object: group, elapsed: 2 });
  const replacement = { ...group, children: [] };
  const plan = linePlaybackPlan(before, [{ kind: 'pause', seconds: 1 }, replacement]);
  const rows = previewLifetimes(project, before, plan, 8000);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(row => [row.instanceId, row.at, row.until, row.inherited, row.end]), [
    [group.instanceId, -2000, 1000, true, 'replaced'], [child.instanceId, -1000, 1000, true, 'replaced'], [group.instanceId, 1000, 7000, false, 'expires'],
  ]);
});

test('actor tracks distinguish explicit hide, inherited persistence and unknown dialogue end', () => {
  const project = createProject(), before = initialPreviewStage();
  const show = (instanceId: string, lifetime?: 'line' | 'persistent'): Extract<StageAction, {kind: 'show'}> => ({ kind: 'show', characterId: 'actor', expressionId: 'face', instanceId, lifetime, x: .5, y: 1, scale: 1, layer: 1, transition: 'none' });
  applyPreviewAction(before, show('from_prior', 'persistent'));
  const actions: StageAction[] = [show('persistent', 'persistent'), show('hidden'), { kind: 'pause', seconds: 1 }, { kind: 'hide', characterId: 'actor', instanceId: 'hidden', transition: 'none' }, show('persistent'), { kind: 'background', assetId: 'bg', transition: 'none' }, show('line', 'line')];
  const plan = linePlaybackPlan(before, actions), rows = previewLifetimes(project, before, plan, 3000);
  assert.equal(rows.find(row => row.end === 'hidden')!.until, 1000);
  assert.equal(rows.filter(row => row.end === 'continues').length, 2);
  assert.equal(rows.find(row => row.inherited)!.end, 'continues');
  assert.equal(rows.find(row => row.end === 'continues')!.until, 3000);
  assert.equal(rows.find(row => row.end === 'line')!.until, 3000);
});

test('background truncates inherited groups and removes children that have not appeared', () => {
  const project = createProject(), before = initialPreviewStage();
  const child = { ...createVisualObject('solid'), startAt: 4 };
  const group = { ...createVisualObject('group'), duration: 10, children: [child] };
  before.visuals.set(group.instanceId, { object: group, elapsed: 1 });
  const rows = previewLifetimes(project, before, linePlaybackPlan(before, [{ kind: 'pause', seconds: 2 }, { kind: 'background', assetId: 'bg', transition: 'none' }]), 5000);
  assert.equal(rows.length, 1); assert.equal(rows[0].until, 2000); assert.equal(rows[0].end, 'background');
});
