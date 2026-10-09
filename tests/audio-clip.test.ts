import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema } from '../src/core/model';
import { applyAudioClipInputs, audioClipDurationLimit, createAudioClip, patchAudioClipNode } from '../src/core/audio-clip';
import { blueprintFromPerformance, exposePerformanceInputs, performanceInputs } from '../src/core/blueprint-authoring';
import { arrangePerformanceTimeline, insertTimelineAction, performanceTimeline, timelineNodeActions } from '../src/core/performance-timeline';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { initialPreviewStage, linePlaybackPlan, linePlaybackAudio } from '../src/core/line-preview';
import { carryPreviewAudio, previewAudioAt, previewAudioGain, previewClipGain } from '../src/core/preview-audio';
import { compileProject } from '../src/runtime/compiler';
import { canLaunchTimeline } from '../src/core/timeline-launch';

test('audio clips retain finite lengths, find same-track gaps and survive saving as callable timelines', () => {
  const project = createProject(); project.assets.push({ id: 'sound', name: 'Sound', kind: 'audio', path: 'sound.wav' });
  const graph = blueprintFromPerformance(project, []); project.blueprints.push(graph);
  insertTimelineAction(project, graph, createAudioClip('sound', 'First', 4), 0);
  insertTimelineAction(project, graph, createAudioClip('sound', 'Second', 2), 1);
  const model = performanceTimeline(project, graph);
  assert.deepEqual(model.clips.map(c => [c.at, c.duration]), [[0, 4], [4, 2]]);
  const snapshot = structuredClone(graph);
  assert.throws(() => arrangePerformanceTimeline(project, graph, model.clips.map(c => ({ ...c, at: 0 })), model.tracks), /重叠/);
  assert.deepEqual(graph, snapshot);
  assert.deepEqual(performanceTimeline(projectSchema.parse(JSON.parse(JSON.stringify(project))), graph).clips, model.clips);
});

test('audio input overrides preserve source limits, choose audio assets and control preview/native duration', () => {
  const project = createProject(); project.assets.push({ id: 'one', name: 'One', kind: 'audio', path: 'one.wav' }, { id: 'two', name: 'Two', kind: 'audio', path: 'two.wav' });
  const clip = { ...createAudioClip('one', 'Clip', 5), offset: 1, duration: 3 };
  assert.equal(applyAudioClipInputs(clip, { duration: 99, offset: 2 }).duration, 3);
  assert.equal(applyAudioClipInputs(clip, { assetId: 'two', duration: 9 }).sourceDuration, undefined);
  assert.throws(() => applyAudioClipInputs(clip, { volume: 2 }));
  const graph = blueprintFromPerformance(project, [clip]); project.blueprints.push(graph);
  const model = performanceTimeline(project, graph); arrangePerformanceTimeline(project, graph, model.clips, model.tracks);
  exposePerformanceInputs(graph, performanceInputs(graph).filter(p => ['clip_assetId', 'clip_duration'].includes(p.pinId)));
  assert.equal(canLaunchTimeline(project, graph), true);
  const inputs = Object.fromEntries(graph.exposedInputs.map(p => [p.id, p.dataType === 'asset' ? 'two' : 7]));
  const context = previewActionContext(project), actions = expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: graph.id, inputs }], context);
  assert.equal(context.incomplete, false); const resolved = actions.find(a => a.kind === 'audioClip')!;
  assert.equal(resolved.assetId, 'two'); assert.equal(resolved.duration, 7);
  const plan = linePlaybackPlan(initialPreviewStage(), actions); assert.equal(plan.until, 7000);
  const compiled = compileProject(project); assert.deepEqual(compiled.diagnostics.filter(d => d.severity === 'error'), []);
  assert.match(compiled.files['game/story.rpy'], /vn_audio_clip_play\(vn_audio_clip_inputs/);
});

test('parallel audio, including repeated sources, survives seeking/carry and ends at the clip boundary', () => {
  const project = createProject(), clip = { ...createAudioClip('tone', 'Tone', 5), offset: 1, duration: 3, fadeIn: 1, fadeOut: 1, volume: .6 };
  const plan = linePlaybackPlan(initialPreviewStage(), [clip, clip, { kind: 'music', assetId: 'bgm', loop: true, fade: 0 }, { kind: 'stopMusic', fade: 0 }]);
  const events = linePlaybackAudio(initialPreviewStage(), plan);
  const active = previewAudioAt(events, 2500); assert.equal(active.length, 2);
  assert.notEqual(active[0].source.key, active[1].source.key);
  for (const { source } of active) {
    assert.equal(source.offset, 1000);
    assert.equal(previewAudioGain(2500, source.at, source.fade!) * previewClipGain(2500, source), .5);
  }
  const carried = carryPreviewAudio(events, 2000);
  assert.equal(previewAudioAt(carried, 999).length, 2);
  assert.deepEqual(previewAudioAt(carried, 1000), []);
  const next = linePlaybackAudio({ ...initialPreviewStage(), audio: carried }, linePlaybackPlan(initialPreviewStage(), [clip]));
  assert.equal(previewAudioAt(next, 100).length, 3);
  assert.equal(previewAudioAt(next, 1000).length, 1);
});

test('editing audio with bound sources and offsets retains input identity and uses the effective trim limit', () => {
  const project=createProject(); project.assets.push({id:'short',name:'Short',kind:'audio',path:'short.wav'},{id:'long',name:'Long',kind:'audio',path:'long.wav'});
  const graph=blueprintFromPerformance(project,[{...createAudioClip('short','Clip',4),duration:1}]);project.blueprints.push(graph);
  const node=graph.nodes.find(n=>n.type==='savedAction')!;
  exposePerformanceInputs(graph,performanceInputs(graph).filter(p=>p.pinId==='clip_assetId'||p.pinId==='clip_offset'));
  const asset=graph.exposedInputs.find(p=>p.dataType==='asset')!,offset=graph.exposedInputs.find(p=>p.dataType==='number')!;
  asset.defaultValue='long';offset.defaultValue=2;node.properties.clip_volume=.35;
  const resolve=()=>timelineNodeActions(project,graph,node).find(a=>a.kind==='audioClip')!;
  assert.equal(audioClipDurationLimit(resolve()),Infinity);
  const links=structuredClone(graph.links),inputs=structuredClone(graph.exposedInputs);
  patchAudioClipNode(node,{duration:7});patchAudioClipNode(node,{name:'Renamed'});
  assert.equal(resolve().duration,7);assert.equal(resolve().offset,2);assert.equal(resolve().volume,.35);assert.equal(resolve().assetId,'long');
  assert.equal(JSON.parse(String(node.properties.action)).assetId,'short');assert.equal(JSON.parse(String(node.properties.action)).offset,0);
  assert.deepEqual(graph.links,links);assert.deepEqual(graph.exposedInputs,inputs);
  asset.defaultValue='short';offset.defaultValue=3;
  assert.equal(audioClipDurationLimit(resolve()),1);assert.equal(resolve().duration,1);
  const saved=projectSchema.parse(JSON.parse(JSON.stringify(project))),resolved=timelineNodeActions(saved,saved.blueprints[0],saved.blueprints[0].nodes.find(n=>n.id===node.id)!).find(a=>a.kind==='audioClip')!;
  assert.equal(resolved.duration,1);assert.equal(resolved.offset,3);assert.deepEqual(compileProject(saved).diagnostics.filter(d=>d.severity==='error'),[]);
});

test('audio field patches preserve unrelated literals and reject invalid edits without changing the node', () => {
 const project=createProject(),graph=blueprintFromPerformance(project,[createAudioClip('source','Clip',4)]),node=graph.nodes[1];
 node.properties.clip_volume=.4;node.properties.clip_offset=1;
 patchAudioClipNode(node,{volume:.6});assert.equal(node.properties.clip_volume,undefined);assert.equal(node.properties.clip_offset,1);
 const before=structuredClone(node);assert.throws(()=>patchAudioClipNode(node,{duration:-1}));assert.deepEqual(node,before);
});
