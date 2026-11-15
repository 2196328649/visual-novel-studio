import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiVideoFixture } from '../scripts/lib/ui-video-fixture';
import { uiVideoRequest, controlUiVideo, suspendUiVideo, acceptUiVideoReport, uiVideoObservation, uiVideoRequestProblem, type UiVideoReport, type UiVideoRequest } from '../src/core/ui-video';
import { appendUiPreviewEvent, previewUiLogic, uiPreviewInputCount, type UiPreviewEvent } from '../src/core/ui-logic-preview';
import { uiProperties, uiPropertyApplies, uiPropertyDefault, uiPropertyValueProblem } from '../src/core/ui-properties';
import { ensureUiVideoEvent } from '../src/core/ui-logic';
import { projectSchema } from '../src/core/model';
import { synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { validateBlueprints } from '../src/core/blueprint-validation';
import { blueprintTaskOperationSupported } from '../src/core/blueprint-tasks';
import { projectForExport } from '../src/core/export-assets';
import { compileProject } from '../src/runtime/compiler';

// Source only: run with the whole un-deferred implementation at final acceptance.
const click = (name: string): UiPreviewEvent => ({ kind: 'click', componentId: 'video_action_' + name });
const sample = (f: ReturnType<typeof createUiVideoFixture>, events: UiPreviewEvent[] = []) => previewUiLogic(f.project, f.page.components, f.page.id, {}, events, { timed: true, trace: true, host: 'story' });
const report = (r: UiVideoRequest, status: UiVideoReport['status'], changes: Partial<UiVideoReport> = {}): UiVideoReport => ({ pageInstance: r.pageInstance, assetId: r.assetId, sourceSequence: r.sourceSequence, sequence: r.sequence, sample: r.lastSample + 1, status, ...changes });
const feedback = (p: ReturnType<typeof sample>, status: UiVideoReport['status'], changes: Partial<UiVideoReport> = {}, componentId = 'movie'): Extract<UiPreviewEvent, { kind: 'video' }> => ({ kind: 'video', componentId, ...report(p.videoRequests[componentId], status, changes) });

test('video capability catalog is typed, resource-aware, non-animated and read-only where observed', () => {
  const f = createUiVideoFixture(), movie = f.movie;
  for (const property of ['video', 'videoPoster', 'videoLoop'] as const) { assert.ok(uiPropertyApplies(movie, property, f.project)); assert.equal(uiProperties[property].writable, true); assert.equal(uiProperties[property].animated, false); }
  for (const property of ['videoStatus', 'videoPosition', 'videoDuration', 'videoDurationKnown', 'videoProgress', 'videoPlaying', 'videoPaused', 'videoError', 'videoCanSeek'] as const) {
    assert.ok(uiPropertyApplies(movie, property, f.project)); assert.equal(uiProperties[property].writable, false); assert.equal(uiProperties[property].bindable, false); assert.equal(uiProperties[property].reset, 'none');
  }
  assert.equal(uiPropertyApplies(f.page.components[2], 'video', f.project), false);
  assert.equal(uiPropertyDefault(f.project, movie, 'video'), 'movie_a');
  assert.equal(uiPropertyValueProblem(f.project, 'video', ''), undefined);
  assert.ok(uiPropertyValueProblem(f.project, 'video', 'movie_poster'));
  assert.equal(uiPropertyDefault(f.project, movie, 'videoCanSeek'), false);
  const parsed = projectSchema.parse(JSON.parse(JSON.stringify(f.project))); assert.equal(parsed.ui.customPages.find(p => p.id === f.page.id)!.components[0].loop, false);
});

test('source generations reject A-B-A callbacks, old page reports, unsafe samples and malformed observations', () => {
  const a = uiVideoRequest(undefined, 'a', false, 1), b = uiVideoRequest(a, 'b', false, 1), again = uiVideoRequest(b, 'a', false, 1);
  assert.equal(uiVideoRequest(a, 'a', false, 1), a); assert.equal(again.sourceSequence, 3);
  assert.equal(acceptUiVideoReport(again, report(a, 'ended')), undefined);
  assert.equal(acceptUiVideoReport(uiVideoRequest(a, 'a', false, 2), report(a, 'failed')), undefined);
  for (const invalid of [{ sample: 0 }, { sample: Infinity }, { position: -1 }, { duration: NaN }, { duration: 0, durationKnown: true }, { error: 4 }]) assert.equal(acceptUiVideoReport(a, report(a, 'progress', invalid as Partial<UiVideoReport>)), undefined);
  assert.throws(() => uiVideoRequest(a, 'a', false, -1));
  assert.throws(() => controlUiVideo({ ...a, version: 8 } as unknown as UiVideoRequest, 'play'));
  assert.ok(uiVideoRequestProblem({ ...a, sequence: Number.MAX_SAFE_INTEGER + 1 }));
  assert.throws(() => controlUiVideo({ ...a, sequence: Number.MAX_SAFE_INTEGER }, 'stop'));
});

test('metadata and real playback are distinct; unknown duration is not a zero-duration completed file', () => {
  let r = uiVideoRequest(undefined, 'a', false, 1);
  assert.equal(uiVideoObservation(r, 'videoPlaying'), false); assert.equal(uiVideoObservation(r, 'videoDurationKnown'), false);
  r = acceptUiVideoReport(r, report(r, 'metadata', { duration: 2, durationKnown: true }))!;
  assert.equal(r.status, 'loading'); assert.equal(r.duration, 2);
  r = acceptUiVideoReport(r, report(r, 'playing', { position: .5 }))!;
  assert.equal(uiVideoObservation(r, 'videoProgress'), .25); assert.equal(uiVideoObservation(r, 'videoPlaying'), true);
  r = acceptUiVideoReport(r, report(r, 'progress', { durationKnown: false, duration: 0, position: .8 }))!;
  assert.equal(r.duration, 0); assert.equal(r.position, .8); assert.equal(uiVideoObservation(r, 'videoProgress'), 0);
  const ended = acceptUiVideoReport(r, report(r, 'ended', { position: 1 }))!;
  assert.equal(ended.status, 'ended'); assert.equal(acceptUiVideoReport(ended, report(ended, 'ended')), undefined);
});

test('pause, suspension, stop and restart have separate semantics and invalidate old commands', () => {
  let r = uiVideoRequest(undefined, 'a', false, 1); r = acceptUiVideoReport(r, report(r, 'playing', { position: .6, duration: 2 }))!;
  const playing = r; r = controlUiVideo(r, 'pause', true); assert.equal(r.position, .6); assert.equal(r.mode, 'paused');
  assert.equal(acceptUiVideoReport(r, report(playing, 'ended')), undefined);
  r = suspendUiVideo(r, true); r = suspendUiVideo(r, false); assert.equal(r.mode, 'paused'); assert.equal(r.status, 'paused');
  r = controlUiVideo(r, 'pause', false); assert.equal(r.status, 'loading'); assert.equal(r.position, .6);
  const source = r.sourceSequence; r = controlUiVideo(r, 'stop'); assert.equal(r.position, 0); assert.equal(r.status, 'stopped');
  assert.equal(acceptUiVideoReport(r, report(r, 'ended')), undefined);
  r = controlUiVideo(r, 'play', false); assert.ok(r.sourceSequence > source); assert.equal(r.position, 0);
  const suspended = suspendUiVideo(r, true); assert.equal(suspended.status, 'paused'); assert.equal(suspendUiVideo(suspended, false).status, 'loading');
  const empty = uiVideoRequest(r, '', false, 1); assert.equal(empty.status, 'empty'); assert.throws(() => controlUiVideo(empty, 'play'));
});

test('loop toggles preserve position and do not report a terminal event at a loop boundary', () => {
  let r = uiVideoRequest(undefined, 'a', false, 1); r = acceptUiVideoReport(r, report(r, 'playing', { position: .8, duration: 2 }))!;
  const loop = uiVideoRequest(r, 'a', true, 1); assert.equal(loop.sourceSequence, r.sourceSequence); assert.equal(loop.position, .8);
  assert.equal(acceptUiVideoReport(loop, report(loop, 'ended')), undefined);
  const wrapped = acceptUiVideoReport(loop, report(loop, 'progress', { position: .1 }))!; assert.equal(wrapped.position, .1);
  const once = uiVideoRequest(wrapped, 'a', false, 1); assert.equal(acceptUiVideoReport(once, report(once, 'ended', { position: 2 }))!.status, 'ended');
});

test('preview time never manufactures media events; actual reports produce typed, once-only snapshots', () => {
  const f = createUiVideoFixture(), original = structuredClone(f.project), initial = sample(f);
  assert.equal(initial.videoRequests.movie.status, 'loading'); assert.equal(initial.variables.video_ended, 0);
  const clock = sample(f, [{ kind: 'advance', seconds: 8 }]); assert.equal(clock.videoRequests.movie.status, 'loading'); assert.equal(clock.variables.video_ended, 0);
  const start = feedback(initial, 'playing', { duration: 2, position: .4 }), playing = sample(f, [start]);
  const end = feedback(playing, 'ended', { position: 2 }), ended = sample(f, [start, end, end, click('observe')]);
  assert.equal(ended.incomplete, false); assert.equal(ended.variables.video_ended, 1); assert.equal(ended.variables.video_failed, 0);
  assert.equal(ended.variables.video_event_asset, 'movie_a'); assert.equal(ended.variables.video_event_position, 2); assert.equal(ended.variables.video_event_duration, 2); assert.equal(ended.variables.video_event_known, true);
  assert.equal(ended.variables.video_status, 'ended'); assert.equal(ended.variables.video_progress, 1); assert.equal(ended.variables.video_can_seek, false);
  assert.deepEqual(f.project, original);
});

test('preview source changes, same-source assignments, reset and hidden/paused states preserve identities correctly', () => {
  const f = createUiVideoFixture(), initial = sample(f), start = feedback(initial, 'playing', { duration: 2, position: .4 });
  const same = sample(f, [start, click('same')]); assert.equal(same.videoRequests.movie.sourceSequence, initial.videoRequests.movie.sourceSequence); assert.equal(same.videoRequests.movie.position, .4);
  const changed = sample(f, [start, click('swap'), click('restore'), start]); assert.equal(changed.videoRequests.movie.assetId, 'movie_a'); assert.equal(changed.videoRequests.movie.status, 'loading'); assert.equal(changed.videoRequests.movie.sourceSequence, 3);
  const hidden = sample(f, [start, click('hide')]); assert.equal(hidden.videoRequests.movie.suspended, true); assert.equal(hidden.videoRequests.movie.status, 'paused');
  const shown = sample(f, [start, click('pause'), click('hide'), click('show')]); assert.equal(shown.videoRequests.movie.mode, 'paused'); assert.equal(shown.videoRequests.movie.position, .4);
  const reset = sample(f, [start, click('pause'), click('reset')]); assert.equal(reset.videoRequests.movie.mode, 'playing'); assert.equal(reset.videoRequests.movie.position, 0); assert.ok(reset.videoRequests.movie.sourceSequence > initial.videoRequests.movie.sourceSequence);
  assert.equal(sample(f, [start, click('clear')]).videoRequests.movie.status, 'empty'); assert.equal(sample(f, [start, click('stop')]).variables.video_ended, 0);
  assert.equal(hidden.videoRequests.movie_mirror.mode, 'playing'); assert.equal(hidden.videoRequests.movie_mirror.suspended, false);
});

test('failed playback is a real event; clearing and stopping do not fabricate completion', () => {
  const f = createUiVideoFixture(), pending = sample(f, [click('fail')]), failure = feedback(pending, 'failed', { error: '无法解码' });
  const failed = sample(f, [click('fail'), failure, failure, click('observe')]); assert.equal(failed.incomplete, false); assert.equal(failed.variables.video_failed, 1); assert.equal(failed.variables.video_ended, 0); assert.equal(failed.variables.video_event_error, '无法解码'); assert.equal(failed.variables.video_status, 'failed');
  const old = sample(f); assert.equal(sample(f, [click('close'), feedback(old, 'ended')]).variables.video_ended, 0);
  assert.equal(sample(f, [click('close')]).videoRequests.movie, undefined);
});

test('modal child does not hide its parent; native menu suspension and background commands share page state', () => {
  const f = createUiVideoFixture(), first = sample(f), end = feedback(first, 'ended', { position: 2, duration: 2 });
  const child = sample(f, [click('child'), end]); assert.equal(child.pageId, f.child.id); assert.equal(child.variables.video_ended, 1); assert.equal(child.videoRequests.movie.suspended, false);
  const native = sample(f, [click('native')]); assert.equal(native.pageId, 'ui:preferences'); assert.equal(native.videoRequests.movie.suspended, true); assert.equal(native.videoRequests.movie_native.assetId, 'movie_b');
  const job = sample(f, [click('background'), { kind: 'advance', seconds: .3 }]); assert.equal(job.incomplete, false); assert.equal(job.variables.video_job_done, true); assert.equal(job.videoRequests.movie.assetId, 'movie_b'); assert.equal(job.videoRequests.movie.mode, 'paused');
});

test('media feedback has a separate budget and coalesces only consecutive equivalent progress', () => {
  const f = createUiVideoFixture(), initial = sample(f), event = feedback(initial, 'progress', { position: .1 });
  let events: UiPreviewEvent[] = [event]; events = appendUiPreviewEvent(events, feedback(initial, 'progress', { sample: 2, position: .2 })); assert.equal(events.length, 1); assert.equal(uiPreviewInputCount(events), 0);
  events = appendUiPreviewEvent(events, click('observe')); events = appendUiPreviewEvent(events, feedback(initial, 'progress', { sample: 3, position: .3 })); assert.equal(events.length, 3); assert.equal(uiPreviewInputCount(events), 1);
  const unchanged = appendUiPreviewEvent(events, events[2]); assert.equal(unchanged, events);
  for (let i = 0; i < 300; i++) events = appendUiPreviewEvent(events, { ...event, componentId: 'media_' + i });
  assert.equal(uiPreviewInputCount(events), 1);
});

test('author shortcuts, event signatures, resource closure and both compiler paths support video operations', () => {
  const f = createUiVideoFixture(), count = f.graph.nodes.length;
  assert.equal(ensureUiVideoEvent(f.project, f.graph, 'movie', f.page.id, 'ended').id, f.eventRoots.ended.id); assert.equal(f.graph.nodes.length, count);
  assert.deepEqual(f.eventRoots.ended.pins.filter(p => p.direction === 'output').map(p => [p.id, p.dataType]), [['exec', 'exec'], ['assetId', 'asset'], ['position', 'number'], ['duration', 'number'], ['durationKnown', 'boolean'], ['error', 'string']]);
  assert.deepEqual(validateBlueprints(f.project).filter(issue => issue.severity === 'error'), []);
  for (const id of ['movie_a', 'movie_b', 'movie_broken', 'movie_poster']) assert.ok(projectForExport(f.project).assets.some(asset => asset.id === id));
  for (const name of ['play', 'pause', 'stop']) assert.equal(blueprintTaskOperationSupported(f.mutations[name]), true);
  const compiled = compileProject(f.project); assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), []);
  const source = Object.values(compiled.files).join('\n'); for (const symbol of ['VnUiVideoSurface', 'vn_ui_video_control', 'vn_ui_video_poll', 'vn_ui_video_release', 'vn_ui_video_recovery']) assert.ok(source.includes(symbol));
  f.eventRoots.ended.properties.componentId = 'video_action_play'; synchronizeBlueprintSignatures(f.project); assert.ok(validateBlueprints(f.project).some(issue => issue.nodeId === f.eventRoots.ended.id));
  f.editorSet.properties.property = 'videoPosition'; synchronizeBlueprintSignatures(f.project); assert.ok(validateBlueprints(f.project).some(issue => issue.nodeId === f.editorSet.id && /只读/.test(issue.message)));
});

test('native video pause pins its accepted position across late decoder samples and paused restoration', () => {
  const compiled = compileProject(createUiVideoFixture().project);
  const source = Object.values(compiled.files).join('\n');
  assert.ok(source.includes('if operation == "pause" and (value is None or value):\n                renpy.music.set_pause(True, channel=vn_ui_videos[component_id]["channel"])'));
  assert.ok(source.includes('if not flow_held and row["mode"] != "paused" and position is not None and type(position) in (int, float) and math.isfinite(position):'));
});
