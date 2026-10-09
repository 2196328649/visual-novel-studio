import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, type PerformancePlayback } from '../src/core/model';
import { createVisualObject } from '../src/core/visual-object';
import { initialPreviewStage, linePlaybackPlan, linePreviewSnapshot } from '../src/core/line-preview';
import { followingPerformancePreview, samplePerformanceTransition } from '../src/core/performance-preview';

test('outgoing preview holds the terminal image through black, then reveals the following frame', () => {
  const before = initialPreviewStage(), object = createVisualObject('solid'); object.duration = 2;
  const plan = linePlaybackPlan(before, [object]);
  const settings: PerformancePlayback = { transition: { mode: 'color', outDuration: .4, hold: .2, inDuration: .4, color: '#000000' } };
  const fadeOut = samplePerformanceTransition(before, plan, settings, 2200);
  assert.equal(fadeOut.showingNext, false); assert.ok(Math.abs(fadeOut.coverOpacity - .5) < .001);
  assert.equal(fadeOut.sample.visuals[0].object.instanceId, object.instanceId);
  assert.equal(samplePerformanceTransition(before, plan, settings, 2500).coverOpacity, 1);
  const fadeIn = samplePerformanceTransition(before, plan, settings, 2800);
  assert.equal(fadeIn.showingNext, true); assert.ok(Math.abs(fadeIn.coverOpacity - .5) < .001);
  assert.ok(Math.abs(samplePerformanceTransition(before, plan, settings, 3000).coverOpacity) < .001);
});

test('following dialogue inherits actors but not finished performance objects', () => {
  const project = createProject(), node = project.nodes.find(node => node.kind === 'passage')!;
  const object = createVisualObject('solid'); object.duration = 1;
  node.lines = [{ id: 'intro', text: '', silent: true, actions: [object] }, { id: 'dialogue', text: 'After intro', actions: [] }];
  const next = followingPerformancePreview(project, { nodeId: node.id, lineId: 'intro' }, {});
  assert.equal('line' in next && next.line?.id, 'dialogue');
  assert.equal(next.sample.state.visuals.size, 0);
  assert.equal(linePreviewSnapshot(project, { nodeId: node.id, lineId: 'dialogue' }).before.visuals.size, 0);
});

test('outgoing dissolve and return-title previews use their configured duration and menu background', () => {
  const project = createProject(); project.ui.menuBackgroundId = 'title';
  const next = followingPerformancePreview(project, { nodeId: project.entryId, lineId: '' }, { onComplete: 'title' });
  assert.equal('title' in next && next.title, true); assert.equal(next.sample.state.backgroundId, 'title');
  const sample = samplePerformanceTransition(initialPreviewStage(), { steps: [], until: 1000, dialogueAt: 1000 }, { transition: { mode: 'dissolve', outDuration: 1, hold: 0, inDuration: 0, color: '#000000' } }, 1500);
  assert.equal(sample.showingNext, true); assert.equal(sample.previousOpacity, .5); assert.equal(sample.duration, 1000);
});

test('chapter exit reveals the following dialogue after its blocking background transition', () => {
  for (const transition of ['dissolve', 'fade'] as const) {
    const project = createProject(), node = project.nodes.find(node => node.kind === 'passage')!;
    project.ui.background = '#e3dfca';
    const chapter = { ...createVisualObject('solid'), duration: 7, chapterPresentation: true };
    node.lines = [
      { id: 'intro', text: '', silent: true, actions: [chapter] },
      { id: 'dialogue', text: '章节后的台词', actions: [{ kind: 'background', assetId: 'banquet', transition, duration: .5, wait: true }] },
    ];
    const before = structuredClone(project);
    const next = followingPerformancePreview(project, { nodeId: node.id, lineId: 'intro' }, { transition: { mode: 'color', color: '#000000', outDuration: .5, hold: 0, inDuration: .5 } });
    assert.ok('line' in next);
    assert.equal(next.sample.state.backgroundId, 'banquet');
    assert.equal('transition' in next.sample ? next.sample.transition : undefined, undefined);
    assert.equal(next.sample.state.transitionMotion, undefined);
    assert.equal(next.sample.visuals.length, 0);
    assert.equal('line' in next && next.line?.text, '章节后的台词');
    assert.deepEqual(project, before);
  }
});
