import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiSpineFixture, spineFixtureAssets } from '../scripts/lib/ui-spine-fixture';
import { acceptUiSpineReport, pauseUiSpine, playUiSpine, resetUiSpine, suspendUiSpine, uiSpineMaximumSpeed, uiSpineNamedChoices, uiSpineObservation, uiSpineObservationProperties, uiSpineRequest, uiSpineRequestProblem, uiSpineSkinProblem, type UiSpineReport, type UiSpineRequest } from '../src/core/ui-spine';
import { appendUiPreviewEvent, previewUiLogic, uiPreviewInputCount, type UiPreviewEvent } from '../src/core/ui-logic-preview';
import { uiProperties, uiPropertyApplies, uiPropertyDefault, uiPropertyPinType, uiPropertyValueProblem } from '../src/core/ui-properties';
import { ensureUiSpineEvent } from '../src/core/ui-logic';
import { projectSchema } from '../src/core/model';
import { synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { validateBlueprints } from '../src/core/blueprint-validation';
import { blueprintTaskOperationSupported } from '../src/core/blueprint-tasks';
import { projectForExport } from '../src/core/export-assets';
import { compileProject } from '../src/runtime/compiler';
import { applyUiDesignProperty } from '../src/core/ui-design-properties';
import { setUiPropertyControl } from '../src/core/ui-property-control';
import { validateProject } from '../src/core/validate';
import { blueprintNumericPresentation } from '../src/core/blueprint-presentation';

// Deferred with the rest of the implementation until the unified acceptance run.
const [asset, replacement] = spineFixtureAssets;
const click = (name: string): UiPreviewEvent => ({ kind: 'click', componentId: 'spine_action_' + name });
const sample = (f: ReturnType<typeof createUiSpineFixture>, events: UiPreviewEvent[] = []) => previewUiLogic(f.project, f.page.components, f.page.id, {}, events, { timed: true, trace: true, host: 'story' });
const report = (r: UiSpineRequest, status: UiSpineReport['status'], changes: Partial<UiSpineReport> = {}): UiSpineReport => ({ pageInstance: r.pageInstance, assetId: r.assetId, animation: r.animation,
  sourceSequence: r.sourceSequence, sequence: r.sequence, sample: r.lastSample + 1, status, position: .4, duration: 2.4, durationKnown: true, ...changes });
const feedback = (p: ReturnType<typeof sample>, status: UiSpineReport['status'], changes: Partial<UiSpineReport> = {}, componentId = 'rig'): UiPreviewEvent => ({ kind: 'spine', componentId, ...report(p.spineRequests[componentId], status, changes) });

test('Spine capability catalog exposes typed assets, non-animated placement and genuine read-only observations', () => {
  const f = createUiSpineFixture();
  for (const property of ['spineAsset', 'spineSkin', 'spineLoop', 'spineSpeed', 'spineFit', 'spineScale', 'spineOriginX', 'spineOriginY', 'spineRotation', 'spineFlipX', 'spineFlipY'] as const) {
    assert.ok(uiPropertyApplies(f.rig, property, f.project)); assert.equal(uiProperties[property].writable, true); assert.equal(uiProperties[property].animated, false);
  }
  for (const property of uiSpineObservationProperties) {
    assert.ok(uiPropertyApplies(f.rig, property, f.project)); assert.equal(uiProperties[property].writable, false); assert.equal(uiProperties[property].bindable, false); assert.equal(uiProperties[property].reset, 'none');
  }
  assert.equal(uiPropertyApplies(f.page.components[2], 'spineAsset', f.project), false);
  assert.equal(uiPropertyPinType('spineAsset'), 'asset'); assert.equal(uiPropertyDefault(f.project, f.rig, 'spineAnimation'), 'swing');
  assert.equal(uiPropertyValueProblem(f.project, 'spineAsset', ''), undefined); assert.ok(uiPropertyValueProblem(f.project, 'spineAsset', 'not_spine'));
  assert.ok(uiPropertyValueProblem(f.project, 'spineSpeed', -1)); assert.equal(uiPropertyValueProblem(f.project, 'spineSpeed', 9), undefined); assert.ok(uiPropertyValueProblem(f.project, 'spineSpeed', NaN));
  assert.match(uiSpineNamedChoices(f.project.assets, 'animation').bounce, /骨骼 b/);
  assert.match(uiSpineNamedChoices(f.project.assets, 'skin').alternate, /骨骼 a/);
  assert.equal(projectSchema.parse(JSON.parse(JSON.stringify(f.project))).ui.customPages[0].components[0].spine?.autoplay, false);
});

test('source generations, command generations and page identities reject obsolete and malformed reports', () => {
  const a = uiSpineRequest(undefined, asset, { animation: 'swing', loop: false }, 1), b = uiSpineRequest(a, replacement, {}, 1), again = uiSpineRequest(b, asset, { animation: 'swing', loop: false }, 1);
  assert.equal(uiSpineRequest(a, asset, { animation: 'swing', loop: false }, 1), a); assert.equal(again.sourceSequence, 3);
  assert.equal(acceptUiSpineReport(again, report(a, 'completed', { position: 2.4 })), undefined);
  assert.equal(acceptUiSpineReport(uiSpineRequest(a, asset, {}, 2), report(a, 'failed')), undefined);
  for (const invalid of [{ sample: 0 }, { sample: Infinity }, { animation: 'old' }, { position: -1 }, { duration: NaN }, { position: 3 }, { durationKnown: false, duration: 2.4 }, { error: 4 }]) {
    assert.equal(acceptUiSpineReport(a, report(a, 'progress', invalid as Partial<UiSpineReport>)), undefined);
  }
  const bad = { ...a, version: 77 } as unknown as UiSpineRequest;
  assert.ok(uiSpineRequestProblem(bad)); assert.throws(() => pauseUiSpine(bad, true)); assert.throws(() => suspendUiSpine(bad, true));
  assert.throws(() => playUiSpine(a, asset, 'missing')); assert.throws(() => playUiSpine(a, replacement, 'bounce'));
  assert.throws(() => pauseUiSpine(a, 'true')); assert.throws(() => uiSpineRequest(a, asset, { speed: -1 }, 1)); assert.doesNotThrow(() => uiSpineRequest(a, asset, { speed: 9 }, 1));
  assert.throws(() => pauseUiSpine({ ...a, sequence: Number.MAX_SAFE_INTEGER }, true));
  assert.equal(uiSpineSkinProblem(asset, ''), undefined); assert.ok(uiSpineSkinProblem(asset, 'missing'));
});

test('skin, loop, speed and pause preserve the current position; only source/restart replaces the track', () => {
  let r = uiSpineRequest(undefined, asset, { animation: 'swing', loop: false }, 1);
  r = acceptUiSpineReport(r, report(r, 'playing'))!; const playing = r;
  r = uiSpineRequest(r, asset, { skin: 'alternate', loop: true, speed: .5 }, 1);
  assert.equal(r.position, .4); assert.equal(r.sourceSequence, playing.sourceSequence); assert.equal(r.skin, 'alternate');
  assert.equal(acceptUiSpineReport(r, report(playing, 'completed', { position: 2.4 })), undefined);
  assert.equal(acceptUiSpineReport(r, report(r, 'completed', { position: 2.4 })), undefined);
  r = pauseUiSpine(r, true); r = suspendUiSpine(r, true); r = suspendUiSpine(r, false);
  assert.equal(r.paused, true); assert.equal(r.position, .4); assert.equal(uiSpineObservation(r, 'spinePlaying'), false);
  r = pauseUiSpine(r, false); assert.equal(r.position, .4);
  r = playUiSpine(r, asset, 'swing', true, false); assert.equal(r.sourceSequence, playing.sourceSequence);
  r = playUiSpine(r, asset, 'swing', false, true); assert.ok(r.sourceSequence > playing.sourceSequence); assert.equal(r.position, 0);
  const completed = acceptUiSpineReport(r, report(r, 'completed', { position: 2.4 }))!;
  assert.equal(completed.status, 'completed'); assert.equal(uiSpineObservation(completed, 'spineProgress'), 1);
  assert.equal(acceptUiSpineReport(completed, report(completed, 'completed', { position: 2.4 })), undefined);
  assert.equal(uiSpineRequest(completed, asset, { loop: true }, 1).status, 'completed');
  assert.equal(uiSpineRequest(completed, undefined, {}, 1).status, 'empty');
});

test('a paused Spine accepts speed nine through its blueprint without advancing or replacing the track', () => {
  const f = createUiSpineFixture(); f.mutations.speed.properties.speed = 9;
  const original = structuredClone(f.project), started = sample(f, [click('play')]);
  const prefix = [click('play'), feedback(started, 'playing'), click('pause')];
  const before = sample(f, prefix), after = sample(f, [...prefix, click('speed'), { kind: 'advance', seconds: 1 }]);
  assert.equal(after.incomplete, false); assert.equal(after.spineRequests.rig.speed, 9);
  assert.equal(after.spineRequests.rig.paused, true); assert.equal(after.spineRequests.rig.position, before.spineRequests.rig.position);
  assert.equal(after.spineRequests.rig.sourceSequence, before.spineRequests.rig.sourceSequence);
  assert.equal(after.variables.spine_completed, 0); assert.deepEqual(f.project, original);
});

test('Spine speed has one explicit native budget across design, parameter association and retained older data', () => {
  const f = createUiSpineFixture();
  assert.equal(uiSpineMaximumSpeed, 32); assert.equal(uiProperties.spineSpeed.max, uiSpineMaximumSpeed);
  for (const speed of [0, 9, 32]) assert.equal(uiPropertyValueProblem(f.project, 'spineSpeed', speed), undefined);
  applyUiDesignProperty(f.project, f.rig, 'spineSpeed', 9);
  for (const speed of [-1, 32.0001, 1e9, 1e308, NaN, Infinity, true, '9']) {
    assert.match(uiPropertyValueProblem(f.project, 'spineSpeed', speed)!, /0～32/);
    assert.throws(() => applyUiDesignProperty(f.project, f.rig, 'spineSpeed', speed), /0～32/);
    assert.equal(f.rig.spine!.speed, 9);
  }
  f.rig.spine!.speed = 1e9;
  const reopened = projectSchema.parse(JSON.parse(JSON.stringify(f.project)));
  assert.equal(reopened.ui.customPages[0].components[0].spine!.speed, 1e9);
  assert.ok(validateProject(reopened).some(issue => issue.severity === 'error' && /0～32/.test(issue.message)));
  applyUiDesignProperty(f.project, f.rig, 'spineSpeed', 32);
  assert.equal(validateProject(f.project).some(issue => /0～32/.test(issue.message)), false);
  f.project.variables.push({ id: 'speed_source', name: '骨骼速度', type: 'number', initial: 1e9, persistent: false });
  const before = structuredClone(f.project);
  assert.throws(() => setUiPropertyControl(f.project, f.rig.id, f.page.id, 'spineSpeed', { mode: 'sync', parameterId: 'speed_source' }), /0～32/);
  assert.deepEqual(f.project, before);
  f.project.variables.at(-1)!.initial = 32;
  assert.doesNotThrow(() => setUiPropertyControl(f.project, f.rig.id, f.page.id, 'spineSpeed', { mode: 'sync', parameterId: 'speed_source' }));
});

test('Spine requests and literal or dynamic blueprint speeds reject unsafe values without replacing a valid track', () => {
  const request = uiSpineRequest(undefined, asset, { speed: 32, autoplay: false }, 1), before = structuredClone(request);
  for (const speed of [32.0001, 1e9, 1e308, NaN, Infinity]) {
    assert.throws(() => uiSpineRequest(request, asset, { speed }, 1), /0～32/);
    assert.match(uiSpineRequestProblem({ ...request, speed })!, /0～32/);
    assert.deepEqual(request, before);
  }
  const f = createUiSpineFixture(); f.mutations.speed.properties.speed = 32;
  assert.equal(blueprintNumericPresentation(f.mutations.speed, 'speed').max, 32);
  assert.equal(sample(f, [click('speed')]).spineRequests.rig.speed, 32);
  f.mutations.speed.properties.speed = 1e9;
  assert.ok(validateBlueprints(f.project).some(issue => issue.nodeId === f.mutations.speed.id && /0～32/.test(issue.message)));
  const literal = sample(f, [click('speed')]); assert.equal(literal.incomplete, true); assert.equal(literal.spineRequests.rig.speed, 1);
  f.project.variables.push({ id: 'speed_input', name: '动态速度', type: 'number', initial: 1e9, persistent: false });
  const read = f.node(f.graph, 'getVariable', { variableId: 'speed_input' }); f.wire(f.graph, read, 'value', f.mutations.speed, 'speed');
  const dynamic = sample(f, [click('speed')]); assert.equal(dynamic.incomplete, true); assert.equal(dynamic.spineRequests.rig.speed, 1);
  assert.equal(dynamic.variables.speed_input, 1e9);
});

test('direct parameter writes validate sync and follow Spine readers atomically and preserve old requests', () => {
  for (const mode of ['sync', 'follow'] as const) {
    const f = createUiSpineFixture();
    f.project.variables.push({ id: 'speed_source', name: '联动骨骼速度', type: 'number', initial: 9, persistent: false });
    f.rig.propertyControls = { spineSpeed: { mode, parameterId: 'speed_source' } };
    const accepted: UiPreviewEvent[] = [{ kind: 'parameter', id: 'speed_source', value: 32 }];
    const before = sample(f, accepted); assert.equal(before.incomplete, false); assert.equal(before.spineRequests.rig.speed, 32);
    for (const value of [32.0001, 1e9, 1e308]) {
      const after = sample(f, [...accepted, { kind: 'parameter', id: 'speed_source', value }]);
      assert.equal(after.incomplete, true); assert.equal(after.variables.speed_source, 32);
      assert.deepEqual(after.spineRequests.rig, before.spineRequests.rig);
    }
    f.mutations.speed.properties.speed = 32;
    const assigned = sample(f, [click('speed')]);
    assert.equal(assigned.variables.speed_source, mode === 'sync' ? 32 : 9);
    assert.equal(assigned.incomplete, mode === 'follow');
  }
});

test('old invalid authored and parameter speeds show a repairable error without a default-speed preview', () => {
  const f = createUiSpineFixture(); f.rig.spine!.speed = 1e9;
  const invalidDesign = sample(f);
  assert.equal(invalidDesign.incomplete, true); assert.equal(invalidDesign.spineRequests.rig, undefined); assert.match(invalidDesign.spineProblems.rig, /0～32/);
  assert.equal(f.rig.spine!.speed, 1e9);
  applyUiDesignProperty(f.project, f.rig, 'spineSpeed', 9);
  const repairedDesign = sample(f); assert.equal(repairedDesign.spineProblems.rig, undefined); assert.equal(repairedDesign.spineRequests.rig.speed, 9);
  f.project.variables.push({ id: 'speed_source', name: '旧参数速度', type: 'number', initial: 9, persistent: false });
  f.rig.propertyControls = { spineSpeed: { mode: 'follow', parameterId: 'speed_source' } };
  const stale = (events: UiPreviewEvent[]) => previewUiLogic(f.project, f.page.components, f.page.id, { speed_source: 1e9 }, events, { timed: true, trace: true, host: 'story' });
  const invalidSource = stale([]);
  assert.equal(invalidSource.spineRequests.rig, undefined); assert.match(invalidSource.spineProblems.rig, /0～32/); assert.equal(invalidSource.variables.speed_source, 1e9);
  const repairedSource = stale([{ kind: 'parameter', id: 'speed_source', value: 9 }]);
  assert.equal(repairedSource.spineProblems.rig, undefined); assert.equal(repairedSource.spineRequests.rig.speed, 9); assert.equal(repairedSource.variables.speed_source, 9);
});

test('zero-duration completion is real and distinct from unknown metadata or a setup pose', () => {
  const unknown = uiSpineRequest(undefined, asset, { loop: false }, 1);
  assert.equal(unknown.durationKnown, false); assert.equal(uiSpineObservation(unknown, 'spineProgress'), 0);
  assert.equal(acceptUiSpineReport(unknown, report(unknown, 'completed', { position: 0, duration: 0, durationKnown: false })), undefined);
  const instant = playUiSpine(unknown, asset, 'instant', false, true);
  const complete = acceptUiSpineReport(instant, report(instant, 'completed', { position: 0, duration: 0 }))!;
  assert.equal(complete.durationKnown, true); assert.equal(uiSpineObservation(complete, 'spineProgress'), 1);
  const poseAsset = { ...asset, spine: { ...asset.spine!, animations: [] } }, pose = uiSpineRequest(undefined, poseAsset, {}, 2);
  assert.equal(acceptUiSpineReport(pose, report(pose, 'ready', { position: 0, duration: 0 }))!.status, 'ready');
  assert.equal(acceptUiSpineReport(pose, report(pose, 'completed', { position: 0, duration: 0 })), undefined);
});

test('preview time never manufactures animation completion; actual reports produce once-only snapshots', () => {
  const f = createUiSpineFixture(), original = structuredClone(f.project), started = sample(f, [click('play')]);
  const clock = sample(f, [click('play'), { kind: 'advance', seconds: 8 }]);
  assert.equal(clock.spineRequests.rig.durationKnown, false); assert.equal(clock.variables.spine_completed, 0);
  const start = feedback(started, 'playing'), playing = sample(f, [click('play'), start]);
  const end = feedback(playing, 'completed', { position: 2.4 }), ended = sample(f, [click('play'), start, end, end, click('observe')]);
  assert.equal(ended.incomplete, false); assert.equal(ended.variables.spine_completed, 1); assert.equal(ended.variables.spine_failed, 0);
  assert.equal(ended.variables.spine_event_asset, 'rig_a'); assert.equal(ended.variables.spine_event_animation, 'swing'); assert.equal(ended.variables.spine_event_skin, 'default');
  assert.equal(ended.variables.spine_event_position, 2.4); assert.equal(ended.variables.spine_event_duration, 2.4);
  assert.equal(ended.variables.spine_status, 'completed'); assert.equal(ended.variables.spine_progress, 1); assert.deepEqual(f.project, original);
});

test('preview same-source writes, skin changes, reset, hide and clear follow the native state contract', () => {
  const f = createUiSpineFixture(), initial = sample(f, [click('play')]), start = feedback(initial, 'playing'), prefix = [click('play'), start];
  const same = sample(f, [...prefix, click('same'), click('skin'), click('transform')]);
  assert.equal(same.spineRequests.rig.sourceSequence, initial.spineRequests.rig.sourceSequence); assert.equal(same.spineRequests.rig.position, .4); assert.equal(same.spineRequests.rig.skin, 'alternate');
  const changed = sample(f, [...prefix, click('skin'), click('swap')]); assert.equal(changed.spineRequests.rig.assetId, 'rig_b'); assert.equal(changed.spineRequests.rig.animation, 'bounce'); assert.equal(changed.spineRequests.rig.skin, '');
  const restored = sample(f, [...prefix, click('swap'), click('restore'), start]); assert.equal(restored.spineRequests.rig.assetId, 'rig_a'); assert.equal(restored.spineRequests.rig.skin, 'default'); assert.equal(restored.spineRequests.rig.position, 0);
  const shown = sample(f, [...prefix, click('pause'), click('hide'), click('show')]); assert.equal(shown.spineRequests.rig.paused, true); assert.equal(shown.spineRequests.rig.position, .4);
  const hidden = sample(f, [...prefix, click('hide')]); assert.equal(hidden.spineRequests.rig.suspended, true); assert.equal(hidden.spineRequests.rig_mirror.suspended, false);
  const reset = sample(f, [...prefix, click('skin'), click('reset')]); assert.equal(reset.spineRequests.rig.paused, true); assert.equal(reset.spineRequests.rig.position, 0); assert.equal(reset.spineRequests.rig.skin, 'default');
  assert.ok(reset.spineRequests.rig.sourceSequence > initial.spineRequests.rig.sourceSequence); assert.equal(reset.variables.spine_completed, 0);
  assert.equal(sample(f, [...prefix, click('clear')]).spineRequests.rig.status, 'empty');
  const manual = same.components.find(c => c.component.id === 'rig')!;
  assert.equal(manual.component.spine?.fit, 'manual'); assert.equal(manual.component.spine?.flipX, true);
});

test('skin rejection is atomic; terminal failures can be reset and stale page callbacks cannot resurrect state', () => {
  const f = createUiSpineFixture(); f.mutations.skin.properties.value = 'missing';
  const rejected = sample(f, [click('skin')]); assert.equal(rejected.incomplete, true); assert.equal(rejected.spineRequests.rig.skin, 'default');
  const pending = sample(f, [click('fail')]), failure = feedback(pending, 'failed', { error: '无法解码骨骼', position: 0, duration: 0, durationKnown: false });
  const failed = sample(f, [click('fail'), failure, failure, click('observe')]);
  assert.equal(failed.variables.spine_failed, 1); assert.equal(failed.variables.spine_event_error, '无法解码骨骼'); assert.equal(failed.variables.spine_status, 'failed');
  const reset = sample(f, [click('fail'), failure, click('reset'), failure]); assert.equal(reset.spineRequests.rig.assetId, 'rig_a'); assert.equal(reset.variables.spine_failed, 1);
  const closed = sample(f, [click('close'), feedback(sample(f), 'failed')]); assert.equal(closed.spineRequests.rig, undefined); assert.equal(closed.variables.spine_failed, 0);
  const original = uiSpineRequest(undefined, asset, {}, 1), renewed = resetUiSpine(original, uiSpineRequest(undefined, asset, {}, 1));
  assert.equal(acceptUiSpineReport(renewed, report(original, 'failed')), undefined);
});

test('modal children keep parent playback; native templates, reopening and background commands use the same protocol', () => {
  const f = createUiSpineFixture(), playing = sample(f, [click('play')]), end = feedback(playing, 'completed', { position: 2.4 });
  const child = sample(f, [click('play'), click('child'), end]); assert.equal(child.variables.spine_completed, 1); assert.equal(child.spineRequests.rig.suspended, false);
  const oldChild = feedback(child, 'completed', { position: 1.2, duration: 1.2 }, 'rig_child');
  const reopened = sample(f, [click('child'), { kind: 'click', componentId: 'spine_child_close' }, click('child'), oldChild]);
  assert.notEqual(reopened.spineRequests.rig_child.pageInstance, child.spineRequests.rig_child.pageInstance); assert.equal(reopened.variables.spine_child_completed, 0);
  const native = sample(f, [click('native')]); assert.equal(native.pageId, 'ui:preferences'); assert.equal(native.spineRequests.rig.suspended, true); assert.equal(native.spineRequests.rig_native.animation, 'quick');
  const job = sample(f, [click('background'), { kind: 'advance', seconds: .3 }]); assert.equal(job.incomplete, false); assert.equal(job.variables.spine_job_done, true); assert.equal(job.spineRequests.rig.animation, 'bounce'); assert.equal(job.spineRequests.rig.paused, true);
});

test('media progress shares its own budget without coalescing across author commands', () => {
  const f = createUiSpineFixture(), initial = sample(f, [click('play')]), event = feedback(initial, 'progress');
  let events = appendUiPreviewEvent([event], feedback(initial, 'progress', { sample: 2, position: .5 })); assert.equal(events.length, 1); assert.equal(uiPreviewInputCount(events), 0);
  events = appendUiPreviewEvent(events, click('pause')); events = appendUiPreviewEvent(events, feedback(initial, 'progress', { sample: 3 })); assert.equal(events.length, 3);
  assert.equal(appendUiPreviewEvent(events, events[2]), events); assert.equal(uiPreviewInputCount(events), 1);
});

test('author shortcuts, typed event pins, resource closure and foreground/background compilers include Spine', () => {
  const f = createUiSpineFixture(), count = f.graph.nodes.length;
  assert.equal(ensureUiSpineEvent(f.project, f.graph, 'rig', f.page.id, 'completed').id, f.eventRoots.completed.id); assert.equal(f.graph.nodes.length, count);
  assert.deepEqual(f.eventRoots.completed.pins.map(p => [p.id, p.dataType]), [['exec', 'exec'], ['assetId', 'asset'], ['animation', 'string'], ['skin', 'string'], ['position', 'number'], ['duration', 'number'], ['error', 'string']]);
  assert.deepEqual(validateBlueprints(f.project).filter(issue => issue.severity === 'error'), []);
  for (const id of ['rig_a', 'rig_b', 'rig_broken']) assert.ok(projectForExport(f.project).assets.some(a => a.id === id));
  for (const name of ['play', 'pause', 'speed']) assert.equal(blueprintTaskOperationSupported(f.mutations[name]), true);
  const compiled = compileProject(f.project); assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), []);
  const source = Object.values(compiled.files).join('\n'); for (const symbol of ['vn_ui_spine_poll', 'vn_ui_spine_release', 'vn_spine_recovery', 'vns_spine.play', 'vns_spine.pause']) assert.ok(source.includes(symbol));
  f.eventRoots.completed.properties.componentId = 'spine_action_play'; synchronizeBlueprintSignatures(f.project); assert.ok(validateBlueprints(f.project).some(issue => issue.nodeId === f.eventRoots.completed.id));
  f.editorSet.properties.property = 'spinePosition'; synchronizeBlueprintSignatures(f.project); assert.ok(validateBlueprints(f.project).some(issue => issue.nodeId === f.editorSet.id && /只读/.test(issue.message)));
});
