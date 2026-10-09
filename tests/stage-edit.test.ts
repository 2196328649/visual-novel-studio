import { addProjectGraphs, projectGraphs } from '../src/core/project-resources';
import { arrangePerformanceTimeline, performanceTimeline } from '../src/core/performance-timeline';
import test from 'node:test';
import assert from 'node:assert/strict';
import { actionSchema, createProject, projectSchema, type StageAction } from '../src/core/model';
import { projectToText, applyTextScript, textCommandAction } from '../src/core/text-script';
import { compileProject } from '../src/runtime/compiler';
import { editTextDocument, textDocument } from '../src/core/text-document';
import { linePreviewSnapshot, linePlaybackPlan, sampleLinePlayback } from '../src/core/line-preview';
import { moveStageActor, setStageAction, stageEditedProject } from '../src/core/stage-edit';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';

const show: Extract<StageAction, { kind: 'show' }> = { kind: 'show', characterId: 'sly', expressionId: 'normal', x: .5, y: 1, scale: .8, layer: 10, transition: 'dissolve' };
test('scene entry motion edits persist at the playhead in the actual inherited scene or blueprint source', () => {
  for (const inheritedScene of [false, true]) for (const mode of ['direct', 'entry-call', 'scene-blueprint'] as const) for (const laterLine of [false, true]) {
    const { project, node } = fixture();
    const scene = project.scenes.find(scene => scene.id === node.sceneId)!;
    const animation: Extract<StageAction, { kind: 'animate' }> = { kind: 'animate', characterId: 'sly', wait: !laterLine, repeat: false, keyframes: [{ x: .9, y: 1, scale: .8, rotation: 0, opacity: 1, duration: 3, easing: 'linear' }] };
    scene.entryActions = [{ ...show, transition: 'none' }];
    const graph = blueprintFromPerformance(project, [animation], '入口移动');
    if (mode === 'direct') scene.entryActions.push(animation);
    else {
      addProjectGraphs(project, graph);
      if (mode === 'entry-call') scene.entryActions.push({ kind: 'blueprint', blueprintId: graph.id });
      else scene.blueprintId = graph.id;
    }
    if (inheritedScene) {
      project.scenes.push({ id: 'child', name: '继承场景', chapterId: scene.chapterId, baseSceneId: scene.id });
      node.sceneId = 'child';
    }
    node.lines[0].actions = laterLine ? [{ kind: 'pause', seconds: .5 }] : [];
    const selection = { nodeId: node.id, lineId: laterLine ? 'two' : 'one' };
    project.scriptText = { format: 'vns-text-1', content: projectToText(project) };
    const originalLines = structuredClone(node.lines);
    let notice: string | undefined;
    const edited = stageEditedProject(project, draft => { notice = moveStageActor(draft, selection, 'sly', { x: .6, rotation: 25, opacity: .4 }, 1000); })!;
    assert.ok(edited, `${mode}, inherited=${inheritedScene}, later=${laterLine}`);
    assert.match(notice!, mode === 'direct' ? /场景入口/ : /共享演出/);
    const saved = projectSchema.parse(JSON.parse(JSON.stringify(edited.project)));
    const restored = applyTextScript(saved, edited.source).project;
    assert.deepEqual(restored.nodes.find(item => item.id === node.id), { ...node, lines: originalLines });
    if (inheritedScene) assert.equal(restored.scenes.find(item => item.id === 'child')!.entryActions, undefined);
    const action = mode === 'direct' ? restored.scenes.find(item => item.id === scene.id)!.entryActions![1] : JSON.parse(String(projectGraphs(restored).find(item => item.id === graph.id)!.nodes.find(item => item.type === 'savedAction')!.properties.action));
    assert.deepEqual(action.curves.x.map((frame: { at: number }) => frame.at), [0, laterLine ? 1.5 : 1, 3]);
    const snapshot = linePreviewSnapshot(restored, selection);
    const pose = sampleLinePlayback(snapshot.before, linePlaybackPlan(snapshot.before, snapshot.actions), 1000).state.actors.get('sly')!;
    assert.equal(pose.x, .6); assert.equal(pose.rotation, 25); assert.equal(pose.opacity, .4);
  }
});

test('nested blueprint animation edits reach the saved source for current and inherited motion', () => {
  for (const inherited of [false, true]) {
    const { project, selection } = fixture();
    const animation: Extract<StageAction, { kind: 'animate' }> = { kind: 'animate', characterId: 'sly', wait: false, repeat: false, keyframes: [{ x: .9, y: 1, scale: .8, rotation: 0, opacity: 1, duration: 3, easing: 'linear' }] };
    const graph = blueprintFromPerformance(project, [animation], '共享移动'); addProjectGraphs(project, graph);
    const wrapper = blueprintFromPerformance(project, [{ kind: 'blueprint', blueprintId: graph.id }], '包装'); addProjectGraphs(project, wrapper);
    const call: StageAction = { kind: 'blueprint', blueprintId: wrapper.id };
    findLine(project, 'one').actions = [{ ...show, transition: 'none' }, ...(inherited ? [call, { kind: 'pause' as const, seconds: .5 }] : [])];
    findLine(project, 'two').actions = inherited ? [] : [call];
    project.scriptText = { format: 'vns-text-1', content: projectToText(project) };
    let notice: string | undefined;
    const edited = stageEditedProject(project, draft => { notice = moveStageActor(draft, selection, 'sly', { x: .6 }, 1000); })!;
    assert.match(notice!, /共享演出/);
    const source = projectGraphs(edited.project).find(item => item.id === graph.id)!.nodes.find(node => node.type === 'savedAction')!;
    const action = JSON.parse(String(source.properties.action));
    assert.deepEqual(action.curves.x.map((frame: { at: number }) => frame.at), [0, inherited ? 1.5 : 1, 3]);
    const restored = applyTextScript(edited.project, edited.source).project;
    const snapshot = linePreviewSnapshot(restored, selection);
    assert.equal(sampleLinePlayback(snapshot.before, linePlaybackPlan(snapshot.before, snapshot.actions), 1000).state.actors.get('sly')!.x, .6);
  }
});
test('inherited motion retains its exact authored origin despite identical animations elsewhere', () => {
  const { project, selection } = fixture();
  const action: Extract<StageAction, { kind: 'animate' }> = { kind: 'animate', characterId: 'sly', wait: false, repeat: false, keyframes: [{ x: .8, y: 1, scale: .8, rotation: 0, opacity: 1, duration: 4, easing: 'linear' }] };
  const first = findLine(project, 'one');
  first.actions = [{ ...show, transition: 'none' }, structuredClone(action), { kind: 'pause', seconds: 1 }, structuredClone(action), { kind: 'pause', seconds: .5 }];
  const snapshot = linePreviewSnapshot(project, selection), motion = snapshot.before.motions.get('sly')!;
  assert.ok(motion);
  assert.equal(motion.elapsed, .5);
  assert.deepEqual(snapshot.context.actionOrigins?.get(motion.action), { nodeId: selection.nodeId, lineId: 'one', actionIndex: 3, direct: true });
  const current = findLine(project, 'two'); current.actions = [structuredClone(action)];
  const second = linePreviewSnapshot(project, selection);
  assert.deepEqual(second.context.actionOrigins?.get(second.actions[0]), { nodeId: selection.nodeId, lineId: 'two', actionIndex: 0, direct: true });
});

test('inherited motion edit writes the source animation at accumulated time and preserves current dialogue', () => {
  const { project, selection } = fixture();
  const prior = findLine(project, 'one'), current = structuredClone(findLine(project, 'two'));
  prior.actions = [{ ...show, transition: 'none' }, { kind: 'animate', characterId: 'sly', wait: false, repeat: false, keyframes: [{ x: .9, y: .5, scale: .8, rotation: 0, opacity: 1, duration: 3, easing: 'linear' }] }, { kind: 'pause', seconds: .5 }];
  project.scriptText = { format: 'vns-text-1', content: projectToText(project) };
  let notice: string | undefined;
  const edited = stageEditedProject(project, draft => { notice = moveStageActor(draft, selection, 'sly', { x: .65 }, 1000); })!;
  assert.match(notice!, /前文动画.*1.50/);
  assert.deepEqual(findLine(edited.project, 'two'), current);
  const animation = findLine(edited.project, 'one').actions[1];
  assert.equal(animation.kind, 'animate'); if (animation.kind !== 'animate') throw new Error('Missing animation');
  assert.deepEqual(animation.curves?.x?.map(key => [key.at, key.value]), [[0, .5], [1.5, .65], [3, .9]]);
  const restored = applyTextScript(edited.project, edited.source).project;
  const snapshot = linePreviewSnapshot(restored, selection);
  const sample = sampleLinePlayback(snapshot.before, linePlaybackPlan(snapshot.before, snapshot.actions), 1000).state.actors.get('sly')!;
  assert.equal(sample.x, .65); assert.equal(sample.y, .75);
});
test('timed inherited static actor editing writes only the current line and roundtrips text', () => {
  const { project, selection } = fixture();
  const original = structuredClone(findLine(project, 'one'));
  const edited = stageEditedProject(project, draft => moveStageActor(draft, selection, 'sly', { x: .25 }, 500))!;
  assert.deepEqual(findLine(edited.project, 'one'), original);
  const action = findLine(edited.project, 'two').actions[0];
  assert.equal(action.kind, 'animate'); if (action.kind !== 'animate') throw new Error('Missing animation');
  assert.equal(action.wait, false);
  assert.deepEqual(action.curves?.x?.map(frame => [frame.at, frame.value]), [[0, .5], [.5, .25]]);
  const restored = applyTextScript(edited.project, edited.source).project;
  assert.deepEqual(findLine(restored, 'two').actions, findLine(edited.project, 'two').actions);
  const snapshot = linePreviewSnapshot(restored, selection);
  assert.equal(sampleLinePlayback(snapshot.before, linePlaybackPlan(snapshot.before, snapshot.actions), 500).state.actors.get('sly')!.x, .25);
});

test('stage rotation and opacity insert only their current-time curves and preserve position and endpoint', () => {
  const { project, selection } = fixture();
  const line = findLine(project, selection.lineId);
  line.actions = [{ kind: 'animate', characterId: 'sly', repeat: false, wait: false, keyframes: [{ x: .9, y: .5, scale: 1, rotation: 40, opacity: .8, duration: 2, easing: 'linear' }] }];
  project.scriptText = { format: 'vns-text-1', content: projectToText(project) };
  const original = structuredClone(line.actions[0]);
  const edited = stageEditedProject(project, draft => moveStageActor(draft, selection, 'sly', { rotation: -30, opacity: .25 }, 1000))!;
  const restored = applyTextScript(projectSchema.parse(JSON.parse(JSON.stringify(edited.project))), edited.source).project;
  const action = findLine(restored, selection.lineId).actions[0];
  assert.equal(action.kind, 'animate'); if (action.kind !== 'animate' || original.kind !== 'animate') return;
  assert.deepEqual(action.keyframes, original.keyframes);
  assert.deepEqual(Object.keys(action.curves!).sort(), ['opacity', 'rotation']);
  assert.deepEqual(action.curves?.rotation?.map(frame => [frame.at, frame.value]), [[0, 0], [1, -30], [2, 40]]);
  assert.deepEqual(action.curves?.opacity?.map(frame => [frame.at, frame.value]), [[0, 1], [1, .25], [2, .8]]);
  const snapshot = linePreviewSnapshot(restored, selection);
  const pose = sampleLinePlayback(snapshot.before, linePlaybackPlan(snapshot.before, snapshot.actions), 1000).state.actors.get('sly')!;
  assert.equal(pose.rotation, -30); assert.equal(pose.opacity, .25); assert.equal(pose.x, .7);
});

test('idle rotation and opacity editing preserves static appearance through save and text reload', () => {
  const { project, selection } = fixture();
  const original = structuredClone(findLine(project, 'one'));
  const rotated = stageEditedProject(project, draft => moveStageActor(draft, selection, 'sly', { rotation: 15 }))!;
  const faded = stageEditedProject(rotated.project, draft => moveStageActor(draft, selection, 'sly', { opacity: .3 }))!;
  const restored = applyTextScript(projectSchema.parse(JSON.parse(JSON.stringify(faded.project))), faded.source).project;
  assert.deepEqual(findLine(restored, 'one'), original);
  assert.equal(findLine(restored, selection.lineId).actions.length, 1);
  const pose = linePreviewSnapshot(restored, selection).after.actors.get('sly')!;
  assert.equal(pose.rotation, 15); assert.equal(pose.opacity, .3); assert.equal(pose.x, .5);
});
test('timed static actor edit creates nonblocking motion after appearance without moving later actions', () => {
  const { project, selection } = fixture(), line = findLine(project, selection.lineId);
  line.actions = [{ ...show, duration: .5, wait: true }, { kind: 'pause', seconds: 2 }, { kind: 'hide', characterId: 'sly', transition: 'none' }];
  const before = linePreviewSnapshot(project, selection);
  const oldPlan = linePlaybackPlan(before.before, before.actions);
  moveStageActor(project, selection, 'sly', { x: .8 }, 1500);
  const animation = line.actions[1]; assert.equal(animation.kind, 'animate');
  if (animation.kind !== 'animate') throw new Error('Missing inserted animation');
  assert.equal(animation.wait, false);
  assert.deepEqual(animation.curves?.x?.map(frame => [frame.at, frame.value]), [[0, .5], [1, .8]]);
  const after = linePreviewSnapshot(project, selection), plan = linePlaybackPlan(after.before, after.actions);
  assert.equal(plan.steps.at(-1)!.at, oldPlan.steps.at(-1)!.at);
  assert.equal(sampleLinePlayback(after.before, plan, 1500).state.actors.get('sly')!.x, .8);
  moveStageActor(project, selection, 'sly', { x: .7 }, 1500);
  assert.equal(line.actions.filter(action => action.kind === 'animate').length, 1);
  assert.ok(projectSchema.safeParse(project).success);
});
test('timed stage edit targets the active animation after a wait, not a later animation', () => {
  const { project, selection } = fixture();
  const line = findLine(project, selection.lineId);
  const frame = { x: .8, y: 1, scale: .8, rotation: 0, opacity: 1, duration: 2, easing: 'linear' as const };
  line.actions = [{ ...show, transition: 'none' }, { kind: 'pause', seconds: 1 }, { kind: 'animate', characterId: 'sly', wait: true, repeat: false, keyframes: [frame] }, { kind: 'animate', characterId: 'sly', wait: true, repeat: false, keyframes: [{ ...frame, x: .1 }] }];
  moveStageActor(project, selection, 'sly', { x: .6 }, 1500);
  const first = line.actions[2], later = line.actions[3];
  assert.ok(first.kind === 'animate' && later.kind === 'animate');
  assert.deepEqual(first.curves?.x?.map(key => key.at), [0, .5, 2]);
  assert.equal(later.curves, undefined);
  const snapshot = linePreviewSnapshot(project, selection);
  assert.equal(sampleLinePlayback(snapshot.before, linePlaybackPlan(snapshot.before, snapshot.actions), 1500).state.actors.get('sly')!.x, .6);
});
function fixture() {
  const project = createProject('舞台合并');
  project.characters = [{ id: 'sly', name: '苏怜烟', color: '#abcabc', expressions: [{ id: 'normal', name: '通常', assetId: 'portrait' }, { id: 'smile', name: '微笑', assetId: 'portrait' }] }];
  project.assets = [{ id: 'portrait', name: '立绘', kind: 'image', category: 'portrait', path: 'actor.png' }, { id: 'night', name: '夜景', kind: 'image', category: 'scene', path: 'night.png' }, { id: 'voice', name: '原配音', kind: 'audio', category: 'voice', path: 'voice.ogg' }, { id: 'newvoice', name: '新配音', kind: 'audio', category: 'voice', path: 'new.ogg' }];
  const node = project.nodes.find(node => node.kind === 'passage')!;
  node.lines = [{ id: 'one', text: '相同的台词', actions: [structuredClone(show)] }, { id: 'two', text: '相同的台词', actions: [], voiceId: 'voice' }];
  project.scriptText = { format: 'vns-text-1', content: projectToText(project).replace('旁白：相同的台词', '旁白：相同的台词\n\n') };
  return { project, node, selection: { nodeId: node.id, lineId: 'two' } };
}
const findLine = (project: ReturnType<typeof fixture>['project'], id: string) => project.nodes.flatMap(node => node.kind === 'passage' ? node.lines : []).find(line => line.id === id)!;

test('editing an inherited actor affects only the selected duplicate dialogue and preserves raw surrounding text', () => {
  const { project, selection } = fixture();
  const original = project.scriptText!.content;
  const edited = stageEditedProject(project, draft => moveStageActor(draft, selection, 'sly', { x: .2, y: .7 }))!;
  assert.ok(edited);
  assert.equal(project.scriptText!.content, original);
  assert.deepEqual(findLine(edited.project, 'one').actions, [show]);
  assert.equal(linePreviewSnapshot(edited.project, selection).after.actors.get('sly')!.x, .2);
  const beforeSuffix = original.slice(original.lastIndexOf('旁白：相同的台词'));
  assert.equal(edited.source.slice(edited.source.lastIndexOf('旁白：相同的台词')), beforeSuffix);
  assert.ok(edited.source.startsWith(original.slice(0, original.indexOf('@对白标记：two'))));
  assert.equal(findLine(edited.project, 'two').voiceId, 'voice');
  assert.equal(textDocument(edited.source, edited.sourceMap).text.includes('【'), false);
  const reloaded = applyTextScript(JSON.parse(JSON.stringify(edited.project)), edited.source);
  assert.deepEqual(findLine(reloaded.project, 'two'), findLine(edited.project, 'two'));
});

test('stage editing applies a current unsaved text draft without dropping new dialogue', () => {
  const { project, selection } = fixture();
  project.scriptText!.content = project.scriptText!.content.replace('旁白：相同的台词\n\n', '旁白：刚刚输入的新内容\n\n');
  const result = stageEditedProject(project, draft => setStageAction(draft, selection, { kind: 'camera', x: .1, y: -.1, zoom: 1.3, rotation: 15, duration: .5, wait: true, easing: 'easeout' }))!;
  assert.equal(findLine(result.project, 'one').text, '刚刚输入的新内容');
  assert.ok(result.source.includes('旁白：刚刚输入的新内容\n\n'));
  assert.equal(linePreviewSnapshot(result.project, selection).after.camera.rotation, 15);
  assert.equal(applyTextScript(result.project, result.source).issues.length, 0);
});

test('jump previews never take the dialogue anchor or receive a target dialogue performance edit', () => {
  const { project, node } = fixture();
  node.lines[0].actions = [];
  project.scriptText!.content = projectToText(project);
  const parsed = applyTextScript(project, project.scriptText!.content);
  const reference = parsed.sourceMap.find(location => location.reference && location.nodeId === node.id && location.lineId === 'one');
  assert.ok(reference, 'the start jump can preview its target');
  const document = textDocument(project.scriptText!.content, parsed.sourceMap);
  const anchor = document.anchors.find(anchor => anchor.text.includes('one'))!;
  assert.equal(document.text.slice(anchor.start, anchor.end), '旁白：相同的台词');
  const jump = project.scriptText!.content.split('\n').find(line => line.startsWith('@跳转：'))!;
  const edited = stageEditedProject(project, draft => setStageAction(draft, { nodeId: node.id, lineId: 'one' }, { kind: 'pause', seconds: .3 }))!;
  assert.ok(edited.source.includes(jump));
  assert.match(edited.source, /@对白标记：one\n@等待：0\.3\n旁白：相同的台词/);
  assert.deepEqual(findLine(edited.project, 'one').actions, [{ kind: 'pause', seconds: .3 }]);
  assert.deepEqual(findLine(edited.project, 'two'), findLine(project, 'two'));
});

test('a drag edits the final keyframe and keeps intermediate motion, expression and appearance', () => {
  const { project, node, selection } = fixture();
  node.lines[1].actions = [{ kind: 'animate', characterId: 'sly', repeat: true, wait: false, keyframes: [{ x: .3, y: .6, scale: .7, rotation: 10, opacity: .6, duration: .5, easing: 'easein' }, { x: .8, y: .9, scale: .9, rotation: 20, opacity: .8, duration: 1, easing: 'easeout' }] }];
  project.scriptText!.content = projectToText(project);
  const original = structuredClone(node.lines[1].actions[0]);
  const result = stageEditedProject(project, draft => moveStageActor(draft, selection, 'sly', { x: .4, y: .5 }))!;
  const action = findLine(result.project, 'two').actions[0];
  assert.equal(action.kind, 'animate');
  if (action.kind !== 'animate' || original.kind !== 'animate') return;
  assert.deepEqual(action.keyframes[0], original.keyframes[0]);
  assert.deepEqual(action.keyframes[1], { ...original.keyframes[1], x: .4, y: .5 });
  assert.equal(action.repeat, true);
  const changedExpression = stageEditedProject(result.project, draft => moveStageActor(draft, selection, 'sly', { expressionId: 'smile' }))!;
  const snapshot = linePreviewSnapshot(changedExpression.project, selection), plan = linePlaybackPlan(snapshot.before, snapshot.actions);
  const animation = plan.steps.find(step => step.action.kind === 'animate')!;
  const final = sampleLinePlayback(snapshot.before, plan, animation.at + animation.duration - .0001).state.actors.get('sly')!;
  assert.equal(final.expressionId, 'smile'); assert.ok(Math.abs(final.rotation - 20) < 1e-6); assert.ok(Math.abs(final.opacity - .8) < 1e-6); assert.ok(Math.abs(final.x - .4) < 1e-6);
});

test('stage geometry edits change independent curve destinations without changing earlier keys or other instances', () => {
  const { project, node, selection } = fixture();
  const animation: Extract<StageAction, { kind: 'animate' }> = { kind: 'animate', characterId: 'sly', repeat: false, wait: true, keyframes: [{ x: .8, y: .9, scale: 1, rotation: 20, opacity: .8, duration: 3, easing: 'linear' }], curves: { x: [{ at: 3, value: .8, easing: 'linear' }, { at: 0, value: .2, easing: 'linear' }], scale: [{ at: 0, value: .5, easing: 'linear' }, { at: 2, value: 1.2, easing: 'ease' }], rotation: [{ at: 3, value: 40, easing: 'linear' }] } };
  node.lines[1].actions = [animation, { ...show, instanceId: 'sibling', transition: 'none' }];
  project.scriptText!.content = projectToText(project);
  const result = stageEditedProject(project, draft => moveStageActor(draft, selection, 'sly', { x: .4, y: .6, scale: .7 }))!;
  assert.ok(result);
  const changed = findLine(result.project, 'two').actions[0];
  assert.equal(changed.kind, 'animate');
  if (changed.kind !== 'animate') return;
  assert.equal(changed.keyframes[0].x, .8);
  assert.equal(changed.keyframes[0].y, .6);
  assert.equal(changed.keyframes[0].scale, 1);
  assert.deepEqual(changed.curves?.x, [{ at: 3, value: .4, easing: 'linear' }, { at: 0, value: .2, easing: 'linear' }]);
  assert.deepEqual(changed.curves?.rotation, animation.curves?.rotation);
  assert.equal(changed.curves?.scale?.[1].value, .7);
  assert.deepEqual(findLine(result.project, 'two').actions[1], node.lines[1].actions[1]);
  const final = linePreviewSnapshot(result.project, selection).after.actors.get('sly')!;
  assert.equal(final.x, .4); assert.equal(final.y, .6); assert.equal(final.scale, .7); assert.equal(final.rotation, 40);
});

test('hide and show preserve earlier authored actions but determine the final visible actor', () => {
  const { project, node, selection } = fixture();
  node.lines[1].actions = [structuredClone(show), { kind: 'hide', characterId: 'sly', transition: 'fade' }, { ...show, x: .8 }];
  setStageAction(project, selection, { kind: 'hide', characterId: 'sly', transition: 'dissolve' });
  assert.equal(node.lines[1].actions.length, 4);
  assert.equal(linePreviewSnapshot(project, selection).after.actors.size, 0);
  setStageAction(project, selection, { ...show, x: .2 });
  assert.equal(linePreviewSnapshot(project, selection).after.actors.get('sly')!.x, .2);
  assert.equal(node.lines[1].actions[0].kind, 'show');
});

test('voice replacement and removal do not duplicate directives or affect another line', () => {
  const { project, selection } = fixture();
  const result = stageEditedProject(project, draft => { findLine(draft, selection.lineId).voiceId = 'newvoice'; })!;
  assert.equal((result.source.match(/@配音：/g) ?? []).length, 1);
  assert.equal(findLine(result.project, 'two').voiceId, 'newvoice');
  const removed = stageEditedProject(result.project, draft => { findLine(draft, selection.lineId).voiceId = undefined; })!;
  assert.equal(removed.source.includes('@配音：'), false);
  assert.equal(findLine(removed.project, 'two').voiceId, undefined);
});

test('editing interaction bounds retains their instance binding and the surrounding source', () => {
  const { project, node } = fixture();
  project.nodes.push({ id: 'click', kind: 'interaction', name: '检查窗户', sceneId: node.sceneId, x: 0, y: 0, prompt: '', timeoutSeconds: 0, showHints: true, hotspots: [{ id: 'window', name: '窗户', x: .1, y: .2, width: .2, height: .3 }] });
  project.scriptText!.content = projectToText(project);
  const result = stageEditedProject(project, draft => { const interaction = draft.nodes.find(node => node.id === 'click'); if (interaction?.kind === 'interaction') interaction.hotspots[0].x = .4; })!;
  assert.equal(result.source, project.scriptText!.content);
  const interaction = result.project.nodes.find(node => node.id === 'click');
  assert.equal(interaction?.kind === 'interaction' && interaction.hotspots[0].x, .4);
});

test('invalid source is left untouched by visual editing', () => {
  const { project, selection } = fixture();
  project.scriptText!.content += '\n@不存在的指令：测试';
  const source = project.scriptText!.content;
  assert.equal(stageEditedProject(project, draft => moveStageActor(draft, selection, 'sly', { x: .1 })), undefined);
  assert.equal(project.scriptText!.content, source);
});

test('offscreen positions survive stage editing, schema validation, text round trips and runtime compilation', () => {
  const { project, selection } = fixture();
  const result = stageEditedProject(project, draft => moveStageActor(draft, selection, 'sly', { x: -.25, y: 1.4 }))!;
  const saved = projectSchema.parse(JSON.parse(JSON.stringify(result.project)));
  const restored = applyTextScript(saved, result.source);
  const pose = linePreviewSnapshot(restored.project, selection).after.actors.get('sly')!;
  assert.equal(pose.x, -.25); assert.equal(pose.y, 1.4);
  const compiled = compileProject(restored.project);
  assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), []);
  assert.match(compiled.files['game/story.rpy'], /vn_bp_show\("sly", "normal", -0\.25, 1\.4, 0\.8, 10,.*transitions=\{"enter": \{"mode": "move", "duration": 0.5\}/);
  const simple = textCommandAction(project, '@显示角色：苏怜烟，通常，-0.25，0.8');
  assert.equal(simple?.kind === 'show' && simple.x, -.25);
  const camera = textCommandAction(project, '@镜头：-2，3，1，0.5');
  assert.equal(camera?.kind === 'camera' && camera.x, -2);
  assert.equal(camera?.kind === 'camera' && camera.y, 3);
});

test('vertical stage edits remain editable show commands through text edits and save round trips', () => {
  const { project, node } = fixture();
  const selection = { nodeId: node.id, lineId: 'one' };
  const moved = stageEditedProject(project, draft => moveStageActor(draft, selection, 'sly', { y: 1.4 }))!;
  const document = textDocument(moved.source, moved.sourceMap);
  const command = '@显示角色：角色=苏怜烟，表情=通常，缩放=0.8，纵向位置=1.4';
  assert.ok(document.text.includes(command));
  assert.doesNotMatch(document.text, /@演出实例/);
  const scaleAt = document.text.indexOf(command) + command.indexOf('0.8');
  const source = editTextDocument(document, { start: scaleAt, end: scaleAt + 3, text: '0.6' });
  const edited = applyTextScript(moved.project, source);
  assert.deepEqual(edited.issues, []);
  assert.deepEqual(findLine(edited.project, 'one').actions, [{ ...show, y: 1.4, scale: .6 }]);
  const saved = projectSchema.parse(JSON.parse(JSON.stringify(edited.project)));
  const restored = applyTextScript(saved, projectToText(saved));
  assert.deepEqual(findLine(restored.project, 'one').actions, [{ ...show, y: 1.4, scale: .6 }]);
  assert.deepEqual(findLine(restored.project, 'two'), findLine(project, 'two'));
  assert.match(compileProject(restored.project).files['game/story.rpy'], /vn_stage\(0\.5, 1\.4, 0\.6\)/);
});

test('inherited positions, layers and transitions stay explicit instead of replacing show with a snapshot', () => {
  const { project, selection } = fixture();
  const moved = stageEditedProject(project, draft => moveStageActor(draft, selection, 'sly', { y: -.2, layer: 25 }))!;
  assert.match(textDocument(moved.source, moved.sourceMap).text, /@显示角色：角色=苏怜烟，表情=通常，缩放=0\.8，纵向位置=-0\.2，图层=25，入场过渡=移动，入场秒数=0\.5，表情切换过渡=移动，表情切换秒数=0\.5/);
  assert.doesNotMatch(moved.source, /@演出实例/);
  assert.deepEqual(findLine(applyTextScript(moved.project, moved.source).project, 'two').actions, [{ ...show, y: -.2, layer: 25, actorTransitions: { enter: { mode: 'move', duration: .5 }, expression: { mode: 'move', duration: .5 } } }]);
});

test('legacy show snapshots retain their vertical position when edited back into explicit text', () => {
  const { project, node } = fixture();
  node.lines[0].actions = [{ ...show, y: 1.3 }];
  project.scriptText!.content = projectToText(project).replace(/^@显示角色：.*$/m, '@演出实例：第一行【one】 使用【legacy_performance】');
  const moved = stageEditedProject(project, draft => moveStageActor(draft, { nodeId: node.id, lineId: 'one' }, 'sly', { x: .3 }))!;
  assert.match(textDocument(moved.source).text, /@显示角色：角色=苏怜烟，表情=通常，横向位置=0\.3，缩放=0\.8，纵向位置=1\.3/);
  assert.deepEqual(findLine(moved.project, 'one').actions, [{ ...show, x: .3, y: 1.3 }]);
});

test('show character accepts vertical coordinates and round trips all display parameters', () => {
  const { project, node } = fixture();
  for (const command of ['显示角色']) {
    assert.deepEqual(textCommandAction(project, `@${command}：苏怜烟，通常，0.5，0.8`), show);
    assert.deepEqual(textCommandAction(project, `@${command}：苏怜烟，通常，0.5，0.8，0`), { ...show, y: 0 });
    assert.deepEqual(textCommandAction(project, `@${command}：苏怜烟，通常，0.5，0.8，-2，0，入场过渡=立即`), { ...show, y: -2, layer: 0, actorTransitions: { enter: { mode: 'none', duration: .5 } } });
    for (const invalid of ['NaN', 'Infinity', '-Infinity', '不是数值']) assert.equal(textCommandAction(project, `@${command}：苏怜烟，通常，0.5，0.8，${invalid}`), undefined);
  }
  for (const transition of ['none', 'dissolve', 'fade', 'move'] as const) {
    node.lines[0].actions = [{ ...show, y: 1.5, layer: 33, actorTransitions: { enter: { mode: transition, duration: .5 } } }];
    const source = projectToText(project);
    assert.doesNotMatch(source, /@演出实例/);
    assert.deepEqual(findLine(applyTextScript(project, source).project, 'one').actions, node.lines[0].actions);
  }
});

test('offscreen keyframes keep their exact positions, while non-finite coordinates remain invalid', () => {
  const { project, node, selection } = fixture();
  node.lines[1].actions = [{ kind: 'animate', characterId: 'sly', repeat: false, wait: false, keyframes: [{ x: -2, y: -.5, scale: .8, rotation: 0, opacity: 1, duration: .2, easing: 'ease' }, { x: .5, y: 1, scale: .8, rotation: 0, opacity: 1, duration: .2, easing: 'ease' }] }];
  project.scriptText!.content = projectToText(project);
  const result = stageEditedProject(project, draft => moveStageActor(draft, selection, 'sly', { x: 2.5, y: 1.5 }))!;
  const saved = projectSchema.parse(JSON.parse(JSON.stringify(result.project)));
  const action = findLine(saved, selection.lineId).actions[0];
  assert.equal(action.kind, 'animate');
  if (action.kind !== 'animate') return;
  assert.equal(action.keyframes[0].x, -2); assert.equal(action.keyframes[0].y, -.5);
  assert.equal(action.keyframes[1].x, 2.5); assert.equal(action.keyframes[1].y, 1.5);
  assert.match(compileProject(saved).files['game/story.rpy'], /xpos 2\.500000 ypos 1\.500000/);
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.equal(actionSchema.safeParse({ ...show, x: value }).success, false);
    assert.equal(actionSchema.safeParse({ ...action, keyframes: [{ ...action.keyframes[0], y: value }] }).success, false);
  }
});


test('editing during dissolve or fade retains transition and downstream timing for line and scene sources', () => {
  for (const transition of ['dissolve', 'fade'] as const) for (const entry of [false, true]) for (const wait of [false, true]) {
    const { project, selection, node } = fixture(); if (entry) selection.lineId = node.lines[0].id;
    const line = findLine(project, selection.lineId), scene = project.scenes.find(s => s.id === node.sceneId)!;
    const actions: StageAction[] = [{ ...show, transition, duration: 2, wait }, { kind: 'pause', seconds: 3 }];
    if (entry) { scene.entryActions = actions; line.actions = []; } else line.actions = actions;
    const before = linePreviewSnapshot(project, selection), oldPlan = linePlaybackPlan(before.before, before.actions);
    moveStageActor(project, selection, 'sly', { x: .7, rotation: 20 }, 1000);
    assert.equal(actions.length, wait ? 4 : 3, JSON.stringify({ transition, entry, wait })); assert.equal(actions[0].kind, 'show'); if (actions[0].kind === 'show') { assert.equal(actions[0].transition, transition); assert.equal(actions[0].wait, false); }
    const restored = applyTextScript(projectSchema.parse(project), projectToText(project)).project;
    const after = linePreviewSnapshot(restored, selection), plan = linePlaybackPlan(after.before, after.actions);
    assert.equal(plan.dialogueAt, oldPlan.dialogueAt); assert.equal(plan.steps.at(-1)!.at, oldPlan.steps.at(-1)!.at);
    const sample = (ms: number) => sampleLinePlayback(after.before, plan, ms);
    assert.equal(sample(1000).state.actors.get('sly')!.x, .7); assert.equal(sample(1000).state.actors.get('sly')!.rotation, 20);
    assert.equal(sample(1000).transition?.type, transition); assert.equal(sample(1000).transition?.progress, .5);
    assert.equal(sample(2000).state.actors.get('sly')!.x, .5);
    moveStageActor(restored, selection, 'sly', { x: .6 }, 500);
    const again = linePreviewSnapshot(restored, selection);assert.equal(sampleLinePlayback(again.before, linePlaybackPlan(again.before, again.actions), 500).state.actors.get('sly')!.x, .6);
    assert.equal(compileProject(restored).diagnostics.filter(d=>d.severity==='error').length,0);
  }
});


test('move entrance editing materializes the preview path while preserving unedited properties and timing', () => {
  for (const existing of [false, true]) for (const wait of [false, true]) {
    const {project,node,selection}=fixture();selection.lineId=node.lines[0].id;
    const line=findLine(project,selection.lineId);
    line.actions=[...(existing?[{...show,x:.1,y:.8,scale:.5,transition:'none' as const}]:[]),{...show,transition:'move',duration:2,wait},{kind:'pause',seconds:3}];
    const snapshot=linePreviewSnapshot(project,selection),oldPlan=linePlaybackPlan(snapshot.before,snapshot.actions);
    const sample=(before:typeof snapshot,ms:number)=>sampleLinePlayback(before.before,linePlaybackPlan(before.before,before.actions),ms).state.actors.get('sly')!;
    moveStageActor(project,selection,'sly',{x:.7},1000);
    const restored=applyTextScript(projectSchema.parse(project),projectToText(project)).project,after=linePreviewSnapshot(restored,selection);
    assert.equal(linePlaybackPlan(after.before,after.actions).dialogueAt,oldPlan.dialogueAt);
    assert.equal(sample(after,1000).x,.7);assert.equal(sample(after,2000).x,.5);
    for(const ms of [0,100,500,1000,1500,2000])for(const key of ['y','scale','opacity'] as const)assert.ok(Math.abs(sample(after,ms)[key]-sample(snapshot,ms)[key])<1e-9,key);
    assert.ok(!after.actions.some(a=>a.kind==='show'&&a.transition==='move'));
    assert.equal(compileProject(restored).diagnostics.filter(d=>d.severity==='error').length,0);
  }
});


test('cross-line entrance edits write back to original line or inherited scene and preserve timing', () => {
  for (const transition of ['move', 'dissolve', 'fade'] as const) for (const sceneSource of [false, true]) for (const existing of [false, true]) {
    const { project, node, selection } = fixture();
    const scene = project.scenes.find(scene => scene.id === node.sceneId)!;
    const actions: StageAction[] = [
      ...(existing ? [{ ...show, x: .1, y: .8, scale: .5, transition: 'none' as const, lifetime: 'persistent' as const }] : []),
      { ...show, transition, duration: 2, wait: false, lifetime: 'persistent' },
    ];
    if (sceneSource) {
      scene.entryActions = actions;
      project.scenes.push({ id: 'child', name: '子场景', chapterId: scene.chapterId, baseSceneId: scene.id });
      node.sceneId = 'child';
      node.lines[0].actions = [{ kind: 'pause', seconds: .5 }];
    } else node.lines[0].actions = [...actions, { kind: 'pause', seconds: .5 }];
    project.scriptText!.content = projectToText(project);
    const original = linePreviewSnapshot(project, selection);
    const edited = stageEditedProject(project, draft => moveStageActor(draft, selection, 'sly', { x: .7 }, 500))!;
    assert.ok(edited);
    const restored = applyTextScript(projectSchema.parse(JSON.parse(JSON.stringify(edited.project))), edited.source).project;
    assert.deepEqual(findLine(restored, 'two').actions, []);
    const source = sceneSource ? restored.scenes.find(s => s.id === scene.id)!.entryActions! : findLine(restored, 'one').actions;
    const animation = source.find(action => action.kind === 'animate')!;
    assert.deepEqual(animation.curves!.x!.map(frame => frame.at), [0, 1, 2]);
    if (sceneSource) assert.equal(restored.scenes.find(s => s.id === 'child')!.entryActions, undefined);
    const snapshot = linePreviewSnapshot(restored, selection);
    const sample = (snap: typeof snapshot, ms: number) => sampleLinePlayback(snap.before, linePlaybackPlan(snap.before, snap.actions), ms).state.actors.get('sly')!;
    assert.equal(sample(snapshot, 500).x, .7);
    assert.equal(sample(snapshot, 1500).x, .5);
    for (const ms of [0, 100, 500, 1000, 1500]) for (const key of ['y', 'scale', 'opacity'] as const) assert.ok(Math.abs(sample(snapshot, ms)[key] - sample(original, ms)[key]) < 1e-9);
    moveStageActor(restored, selection, 'sly', { x: .6 }, 750);
    assert.equal(sample(linePreviewSnapshot(restored, selection), 750).x, .6);
    assert.equal(source.filter(action => action.kind === 'animate').length, 1);
    assert.equal(compileProject(restored).diagnostics.filter(d => d.severity === 'error').length, 0);
    const first = linePreviewSnapshot(restored, { nodeId: node.id, lineId: 'one' });
    assert.equal(linePlaybackPlan(first.before, first.actions).dialogueAt, 500);
  }
});


test('blueprint show entrance edits preserve calls, flow, timing and cross-line source ownership', () => {
  for (const transition of ['move','dissolve','fade'] as const) for (const later of [false,true]) for (const timeline of [false,true]) for (const wait of [false,true]) {
    if(later && (transition!=='move' || timeline || wait))continue;
    const {project,node,selection}=fixture();
    const graph=blueprintFromPerformance(project,[{...show,transition,duration:2,wait,lifetime:'persistent'},{kind:'pause',seconds:.5}],'入场来源');
    addProjectGraphs(project, graph);
    if(timeline){const model=performanceTimeline(project,graph);arrangePerformanceTimeline(project,graph,model.clips,model.tracks);}
    node.lines[0].actions=[{kind:'blueprint',blueprintId:graph.id}];node.lines[1].actions=[];
    selection.lineId=later?'two':'one';
    const original=linePreviewSnapshot(project,selection),oldPlan=linePlaybackPlan(original.before,original.actions),links=structuredClone(graph.links),lines=structuredClone(node.lines);
    project.scriptText!.content=projectToText(project);
    const edited=stageEditedProject(project,draft=>moveStageActor(draft,selection,'sly',{x:.7},250))!;assert.ok(edited);
    const saved=applyTextScript(projectSchema.parse(JSON.parse(JSON.stringify(edited.project))),edited.source).project;
    assert.deepEqual(saved.nodes.find(n=>n.id===node.id)!.kind==='passage'&&(saved.nodes.find(n=>n.id===node.id) as typeof node).lines,lines);
    assert.deepEqual(projectGraphs(saved).find(g=>g.id===graph.id)!.links,links);
    const snapshot=linePreviewSnapshot(saved,selection),plan=linePlaybackPlan(snapshot.before,snapshot.actions);
    assert.equal(plan.dialogueAt,oldPlan.dialogueAt);
    assert.equal(sampleLinePlayback(snapshot.before,plan,250).state.actors.get('sly')!.x,.7);
    moveStageActor(saved,selection,'sly',{x:.6},300);
    assert.equal(projectGraphs(saved).length,projectGraphs(project).length+1);
    const again=linePreviewSnapshot(saved,selection);
    assert.equal(sampleLinePlayback(again.before,linePlaybackPlan(again.before,again.actions),300).state.actors.get('sly')!.x,.6);
    assert.deepEqual(compileProject(saved).diagnostics.filter(d=>d.severity==='error'),[]);
  }
});
