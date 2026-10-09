import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema, visualObjectSchema } from '../src/core/model';
import { applyVisualInputs, createVisualObject, retimeVisualObject, visualInputFields, visualCurve, visualDissolve, visualParticles, visualPose } from '../src/core/visual-object';
import { blueprintFromPerformance, exposePerformanceInputs, performanceInputs } from '../src/core/blueprint-authoring';
import { arrangePerformanceTimeline, performanceTimeline } from '../src/core/performance-timeline';
import { initialPreviewStage, linePlaybackPlan, linePreviewSnapshot, sampleLinePlayback } from '../src/core/line-preview';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { compileProject } from '../src/runtime/compiler';
import { projectToText, applyTextScript } from '../src/core/text-script';
import { validateProject } from '../src/core/validate';
import { visualGlyphParticles } from '../src/core/visual-glyph-particles';
import { synchronizeBlueprintSignatures } from '../src/core/blueprint';

test('glyph particle seeds persist, distinguish instances and remain stable under retiming and blueprint inputs', () => {
  const object = createVisualObject('particles');
  object.glyphParticles = { assetId: 'glyph', count: 200, emissionStart: 0, timeScale: 1, motionScale: 1, sizeScale: 1, rect: { x: 0, y: 0, width: 1, height: 1 } };
  const points: [number, number][] = [[.1, .2], [.3, .4], [.5, .6]];
  const sample = (value: typeof object, time = 2) => visualGlyphParticles(value, time, points, 64, 64, 1280, 720);
  const legacy = sample(object);
  assert.deepEqual(sample({ ...object, glyphParticles: { ...object.glyphParticles, seed: 0 } }), legacy);
  for (const seed of [1, 17, 1000000]) {
    const changed = applyVisualInputs(object, { glyphSeed: seed });
    const restored = visualObjectSchema.parse(JSON.parse(JSON.stringify(changed)));
    assert.equal(restored.glyphParticles!.seed, seed);
    assert.deepEqual(sample(restored), sample(changed));
    assert.notDeepEqual(sample(restored), legacy);
    assert.deepEqual(sample(retimeVisualObject(restored, 6), 4), sample(restored));
  }
  assert.equal(object.glyphParticles.seed, undefined);
  for (const seed of [-1, .5, 1000001, Infinity]) assert.equal(visualObjectSchema.safeParse({ ...object, glyphParticles: { ...object.glyphParticles, seed } }).success, false);
  const project = createProject(), graph = blueprintFromPerformance(project, [object]); project.blueprints.push(graph);
  exposePerformanceInputs(graph, performanceInputs(graph).filter(field => field.pinId === 'object_glyphSeed'));
  const expanded = expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: graph.id, inputs: { [graph.exposedInputs[0].id]: 17 } }], previewActionContext(project));
  const action = expanded.find(action => action.kind === 'visual')!;
  assert.equal(action.glyphParticles!.seed, 17);
  assert.deepEqual(sample(action), sample(applyVisualInputs(object, { glyphSeed: 17 })));
});

test('proportional retiming preserves nested poses, dissolve, ripple phase and particle trajectories', () => {
  const group = createVisualObject('group'), child = createVisualObject('particles');
  child.startAt = .5;
  child.curves = { x: [{ at: 0, value: .1, easing: 'linear' }, { at: 2, value: .8, easing: 'outquad' }], rippleSpeed: [{ at: 0, value: 2, easing: 'linear' }, { at: 3, value: 1, easing: 'linear' }] };
  child.dissolve = { start: .5, end: 2, from: 1, to: -1 };
  child.ripple = { strength: .01, speed: 2 };
  child.glyphParticles = { assetId: 'glyph', count: 2, emissionStart: 1, timeScale: 2, sizeScale: 1, motionScale: 1, rect: { x: 0, y: 0, width: 1, height: 1 } };
  group.children = [child];
  for (const ratio of [.5, 2, 3]) {
    const changed = retimeVisualObject(group, group.duration * ratio), nested = changed.children![0];
    assert.equal(nested.startAt, .5 * ratio);
    for (const t of [.1, .6, 1.2, 2.5]) {
      assert.ok(Math.abs(visualPose(nested, t * ratio).x - visualPose(child, t).x) < 1e-9);
      assert.ok(Math.abs(visualDissolve(nested, t * ratio) - visualDissolve(child, t)) < 1e-9);
      assert.ok(Math.abs(visualCurve(nested, 'rippleSpeed', t * ratio, 1) * t * ratio - visualCurve(child, 'rippleSpeed', t, 1) * t) < 1e-9);
      const a = visualParticles(nested, t * ratio), b = visualParticles(child, t);
      a.forEach((particle, index) => { for (const key of ['x', 'y', 'opacity', 'size'] as const) assert.ok(Math.abs(particle[key] - b[index][key]) < 1e-8); });
      const points = [[.3, .5], [.6, .5]] as [number, number][];
      const glyphA = visualGlyphParticles(nested, t * ratio, points, 100, 100, 1000, 500), glyphB = visualGlyphParticles(child, t, points, 100, 100, 1000, 500);
      glyphA.forEach((particle, index) => { for (const key of ['x', 'y', 'opacity', 'size'] as const) assert.ok(Math.abs(particle[key] - glyphB[index][key]) < 1e-8); });
    }
  }
  assert.equal(group.duration, 3); assert.equal(child.startAt, .5);
  for (const invalid of [-1, NaN, Infinity]) assert.throws(() => retimeVisualObject(group, invalid));
  const zero = retimeVisualObject(group, 0);
  assert.equal(zero.duration, 0); assert.equal(zero.retimeBasisDuration, 3);
  assert.deepEqual(zero.children, group.children);
  const saved = JSON.parse(JSON.stringify(zero));
  for (const duration of [1.5, 3, 6]) assert.deepEqual(retimeVisualObject(saved, duration), JSON.parse(JSON.stringify(retimeVisualObject(group, duration))));
});

test('zero duration recovery persists through schema, text and blueprint overrides without losing edits', () => {
  const group = createVisualObject('group'); group.retimeOnDuration = true;
  const child = createVisualObject('solid'); child.retimeOnDuration = true; child.startAt = .5;
  child.keyframes.push({ ...child.keyframes[0], x: .8, duration: 2 });
  group.children = [retimeVisualObject(child, 0)];
  const project = createProject(), node = project.nodes.find(node => node.kind === 'passage')!;
  node.lines[0].actions = [retimeVisualObject(group, 0)];
  const saved = projectSchema.parse(JSON.parse(JSON.stringify(project)));
  const restored = applyTextScript(saved, projectToText(saved)).project;
  const restoredNode = restored.nodes.find(item => item.id === node.id)!;
  assert.equal(restoredNode.kind, 'passage'); if (restoredNode.kind !== 'passage') return;
  const zero = restoredNode.lines[0].actions[0];
  assert.equal(zero.kind, 'visual'); if (zero.kind !== 'visual') return;
  zero.children![0].keyframes[1].x = .7;
  const scales = new Map<string, number>();
  const twice = applyVisualInputs(zero, { duration: 6 }, scales);
  assert.equal(twice.retimeBasisDuration, undefined);
  assert.equal(scales.get(group.instanceId), 2);
  assert.equal(twice.children![0].duration, 0);
  assert.equal(twice.children![0].retimeBasisDuration, 6);
  assert.equal(twice.children![0].startAt, 1);
  const recoveredChild = retimeVisualObject(twice.children![0], 3);
  assert.equal(recoveredChild.keyframes[1].duration, 2);
  assert.equal(recoveredChild.keyframes[1].x, .7);
  const childDuration = visualInputFields(zero).find(field => field.path.length > 1 && field.path.at(-1) === 'duration')!.key;
  const overrides = applyVisualInputs(zero, { [childDuration]: 1.5, duration: 6 });
  assert.equal(overrides.children![0].duration, 3);
  assert.equal(overrides.children![0].keyframes[1].duration, 2);
  assert.equal(overrides.children![0].retimeBasisDuration, undefined);
  assert.deepEqual(retimeVisualObject(retimeVisualObject(twice, 0), 6), twice);
  const fresh = { ...createVisualObject('solid'), duration: 0 };
  assert.deepEqual(retimeVisualObject(fresh, 2), { ...fresh, duration: 2 });
});

test('duration inputs retime opted-in compositions after child overrides and preserve saved defaults', () => {
  const group = createVisualObject('group'); group.retimeOnDuration = true;
  const child = createVisualObject('text'); child.startAt = .5; group.children = [child];
  const fields = visualInputFields(group), values = Object.fromEntries(fields.map(field => [field.key, field.value]));
  values.duration = 6;
  const result = applyVisualInputs(group, values);
  assert.equal(result.duration, 6); assert.equal(result.children![0].duration, 6); assert.equal(result.children![0].startAt, 1);
  const childDuration = fields.find(field => field.path.length > 1 && field.path.at(-1) === 'duration')!.key;
  const overridden = applyVisualInputs(group, { ...values, [childDuration]: 1 });
  assert.equal(overridden.children![0].duration, 2);
  assert.equal(group.duration, 3); assert.equal(child.duration, 3);
  const project = createProject(), graph = blueprintFromPerformance(project, [group]); project.blueprints.push(graph);
  exposePerformanceInputs(graph, performanceInputs(graph).filter(field => field.pinId === 'object_duration'));
  const action = expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: graph.id, inputs: { [graph.exposedInputs[0].id]: 6 } }], previewActionContext(project)).find(action => action.kind === 'visual')!;
  assert.equal(action.children![0].duration, 6); assert.equal(action.children![0].startAt, 1);
  projectSchema.parse(project);
});

test('removing a nested object removes its stale pins, overrides and links while retaining siblings', () => {
  const project = createProject(), group = createVisualObject('group');
  const first = createVisualObject('text'), second = createVisualObject('text');
  first.name = first.text = '删除对象'; second.name = second.text = '保留对象'; group.children = [first, second];
  const graph = blueprintFromPerformance(project, [group]); project.blueprints.push(graph);
  const node = graph.nodes.find(node => node.type === 'savedAction')!;
  const removedId = 'object_' + visualInputFields(group).find(field => field.value === first.text)!.key;
  const retainedId = 'object_' + visualInputFields(group).find(field => field.value === second.text)!.key;
  exposePerformanceInputs(graph, performanceInputs(graph).filter(field => [removedId, retainedId].includes(field.pinId)));
  const removedInput = graph.exposedInputs[0].id, retainedInput = graph.exposedInputs[1].id;
  const passage = project.nodes.find(node => node.kind === 'passage')!;
  passage.lines[0].actions = [{ kind: 'blueprint', blueprintId: graph.id, inputs: { [removedInput]: '无用调用值', [retainedInput]: '有效调用值' } }];
  node.properties[removedId] = '过期覆盖'; node.properties[retainedId] = '保留覆盖';
  group.children = [second]; node.properties.action = JSON.stringify(group);
  synchronizeBlueprintSignatures(project);
  assert.ok(!node.pins.some(pin => pin.id === removedId));
  assert.equal(node.properties[removedId], undefined);
  assert.ok(!graph.links.some(link => link.toNodeId === node.id && link.toPinId === removedId));
  assert.ok(node.pins.some(pin => pin.id === retainedId));
  assert.equal(node.properties[retainedId], '保留覆盖');
  assert.ok(graph.links.some(link => link.toNodeId === node.id && link.toPinId === retainedId));
  assert.ok(node.pins.some(pin => pin.id === 'exec_in'));
  assert.deepEqual(graph.exposedInputs.map(pin => pin.id), [retainedInput]);
  assert.ok(!graph.nodes.some(node => node.type === 'getInput' && node.properties.inputId === removedInput));
  assert.deepEqual(passage.lines[0].actions[0], { kind: 'blueprint', blueprintId: graph.id, inputs: { [retainedInput]: '有效调用值' } });
  projectSchema.parse(project);
});

test('a deleted visual field does not remove an input still consumed by a sibling', () => {
  const project = createProject(), group = createVisualObject('group');
  const first = createVisualObject('text'), second = createVisualObject('text');
  first.text = '第一'; second.text = '第二'; group.children = [first, second];
  const graph = blueprintFromPerformance(project, [group]); project.blueprints.push(graph);
  const node = graph.nodes.find(node => node.type === 'savedAction')!;
  const ids = [first, second].map(child => 'object_' + visualInputFields(group).find(field => field.value === child.text)!.key);
  exposePerformanceInputs(graph, performanceInputs(graph).filter(field => field.pinId === ids[0]));
  const originalLink = graph.links.find(link => link.toPinId === ids[0])!;
  graph.links.push({ ...originalLink, id: 'shared-reader-link', toPinId: ids[1] });
  const inputId = graph.exposedInputs[0].id;
  group.children = [second]; node.properties.action = JSON.stringify(group);
  synchronizeBlueprintSignatures(project);
  assert.equal(graph.exposedInputs[0].id, inputId);
  assert.ok(graph.nodes.some(node => node.type === 'getInput' && node.properties.inputId === inputId));
  assert.ok(graph.links.some(link => link.id === 'shared-reader-link'));
  assert.ok(!graph.links.some(link => link.toPinId === ids[0]));
});

test('visual objects retain identities, keyframes and lifetimes through timelines and text', () => {
  const project = createProject();
  const object = createVisualObject('text');
  object.text = '标题';
  object.keyframes.push({ ...object.keyframes[0], x: .9, opacity: 0, duration: 2, easing: 'linear' });
  assert.equal(visualPose(object, 1).x, .7);
  assert.equal(visualPose(object, 1).opacity, .5);
  const graph = blueprintFromPerformance(project, [object]); project.blueprints.push(graph);
  const model = performanceTimeline(project, graph);
  assert.equal(model.until, 3);
  arrangePerformanceTimeline(project, graph, model.clips, model.tracks);
  const node = project.nodes.find(n => n.kind === 'passage')!;
  if (node.kind !== 'passage') throw Error('missing passage');
  node.lines[0].actions = [{ kind: 'blueprint', blueprintId: graph.id }];
  const read = applyTextScript(project, projectToText(project));
  assert.deepEqual(read.issues, []);
  const restored = projectSchema.parse(JSON.parse(JSON.stringify(read.project)));
  const actions = expandPreviewActions(restored, [{ kind: 'blueprint', blueprintId: graph.id }], previewActionContext(restored));
  const before = initialPreviewStage(), plan = linePlaybackPlan(before, actions);
  assert.equal(sampleLinePlayback(before, plan, 1000).visuals[0].object.instanceId, object.instanceId);
  assert.equal(sampleLinePlayback(before, plan, 3000).visuals.length, 0);
  const compiled = compileProject(restored);
  assert.deepEqual(compiled.diagnostics.filter(d => d.severity === 'error'), []);
  assert.ok(compiled.files['game/story.rpy'].includes('vn_show_visual('));
});

test('particle seed determines repeatable positions and size/alpha over age', () => {
  const object = createVisualObject('particles');
  const first = visualParticles(object, .7);
  assert.deepEqual(first, visualParticles(structuredClone(object), .7));
  assert.equal(first.length, object.particles!.count);
  assert.ok(first.every(p => p.size >= 1 && p.size <= 6 && p.opacity >= 0 && p.opacity <= 1));
  object.particles!.seed++;
  assert.notDeepEqual(first, visualParticles(object, .7));
});

test('independent property curves preserve other animation and use absolute times and target easing', () => {
  const object = createVisualObject('text');
  object.keyframes.push({ ...object.keyframes[0], y: .9, duration: 2, easing: 'linear' });
  object.curves = {
    x: [{ at: 2, value: 1, easing: 'outquad' }, { at: 0, value: 0, easing: 'linear' }],
    opacity: [{ at: .5, value: 1, easing: 'linear' }, { at: 1.5, value: 0, easing: 'linear' }],
    dissolveStrength: [{ at: 0, value: 1, easing: 'linear' }, { at: 2, value: -1, easing: 'outquad' }],
  };
  assert.equal(visualPose(object, 1).x, .75);
  assert.equal(visualPose(object, 1).y, .7);
  assert.equal(visualPose(object, 1).opacity, .5);
  assert.equal(visualDissolve(object, 1), -.5);
  assert.equal(visualPose(object, -1).x, 0);
  assert.equal(visualPose(object, 3).x, 1);
  assert.equal(visualCurve(object, 'rippleSpeed', 1, 2), 2);
  const project = createProject();
  const passage = project.nodes.find(node => node.kind === 'passage')!;
  if (passage.kind !== 'passage') throw Error('missing passage');
  passage.lines[0].actions = [object];
  const restored = projectSchema.parse(JSON.parse(JSON.stringify(project)));
  const restoredPassage = restored.nodes.find(node => node.id === passage.id)!;
  assert.ok(restoredPassage.kind === 'passage');
  assert.deepEqual(restoredPassage.lines[0].actions[0], JSON.parse(JSON.stringify(object)));
  object.curves.x = [{ at: 0, value: .1, easing: 'linear' }, { at: 0, value: .4, easing: 'linear' }, { at: 1, value: .8, easing: 'linear' }];
  assert.equal(visualPose(object, 0).x, .4);
  assert.ok(Math.abs(visualPose(object, .5).x - .6) < 1e-10);
});

test('exposed visual content and duration drive preview and native scheduling', () => {
  const project = createProject(), object = createVisualObject('text');
  const graph = blueprintFromPerformance(project, [object]); project.blueprints.push(graph);
  const model = performanceTimeline(project, graph); arrangePerformanceTimeline(project, graph, model.clips, model.tracks);
  exposePerformanceInputs(graph, performanceInputs(graph).filter(pin => ['object_duration', 'object_text'].includes(pin.pinId)));
  const inputs = Object.fromEntries(graph.exposedInputs.map(pin => [pin.id, pin.dataType === 'number' ? 7 : '第二章']));
  const context = previewActionContext(project);
  const actions = expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: graph.id, inputs }], context);
  const visual = actions.find(a => a.kind === 'visual')!;
  assert.equal(visual.duration, 7); assert.equal(visual.text, '第二章'); assert.equal(context.incomplete, false);
  assert.equal(linePlaybackPlan(initialPreviewStage(), actions).until, 7000);
  const compiled = compileProject(project);
  assert.deepEqual(compiled.diagnostics.filter(d => d.severity === 'error'), []);
  const duration = graph.exposedInputs.find(pin => pin.dataType === 'number')!;
  assert.ok(compiled.files['game/story.rpy'].includes('"duration": vn_bp_in_' + graph.id + '_' + duration.id));
  const node = graph.nodes.find(node => node.type === 'savedAction')!;
  assert.ok(compiled.files['game/story.rpy'].includes('float(vn_bp_visual_' + node.id + '["duration"])'));
});

test('nonblocking visual instances survive subsequent lines and expire after known waits', () => {
  const project = createProject(), object = createVisualObject('text');
  object.duration = 4;
  const passage = project.nodes.find(node => node.kind === 'passage')!;
  assert.ok(passage.kind === 'passage');
  passage.lines = [
    { id: 'first', text: '演出随对白继续', actions: [object, { kind: 'pause', seconds: 1 }] },
    { id: 'second', text: '下一句', actions: [{ kind: 'pause', seconds: 1 }] },
    { id: 'third', text: '仍在显示', actions: [] },
    { id: 'fourth', text: '', silent: true, actions: [{ kind: 'pause', seconds: 3 }] },
    { id: 'fifth', text: '已经到期', actions: [] },
  ];
  const snapshot = linePreviewSnapshot(project, { nodeId: passage.id, lineId: 'third' });
  assert.equal(snapshot.before.visuals.get(object.instanceId)?.elapsed, 2);
  const plan = linePlaybackPlan(snapshot.before, snapshot.actions);
  assert.equal(plan.until, 2000);
  assert.equal(sampleLinePlayback(snapshot.before, plan, 1000).visuals[0].elapsed, 3);
  assert.equal(sampleLinePlayback(snapshot.before, plan, 2000).visuals.length, 0);
  assert.equal(snapshot.before.visuals.get(object.instanceId)?.elapsed, 2, 'sampling must not mutate earlier snapshots');
  assert.equal(linePreviewSnapshot(project, { nodeId: passage.id, lineId: 'fifth' }).before.visuals.size, 0);
  const replacement = { ...object, text: '替换', duration: 1 };
  const replaced = sampleLinePlayback(snapshot.before, linePlaybackPlan(snapshot.before, [replacement]), 500);
  assert.equal(replaced.visuals.length, 1);
  assert.equal(replaced.visuals[0].elapsed, .5);
  assert.equal(replaced.visuals[0].object.text, '替换');
  const cleared = sampleLinePlayback(snapshot.before, linePlaybackPlan(snapshot.before, [{ kind: 'background', assetId: 'background', transition: 'none' }]), 0);
  assert.equal(cleared.visuals.length, 0);
});

test('nested composition retains child timing and reports missing nested assets', () => {
  const project = createProject(), group = createVisualObject('group'), nested = createVisualObject('group'), title = createVisualObject('text');
  title.startAt = 1.5; title.text = '组合标题';
  nested.children = [title]; group.children = [createVisualObject('solid'), nested];
  const passage = project.nodes.find(node => node.kind === 'passage')!;
  assert.ok(passage.kind === 'passage'); passage.lines[0].actions = [group];
  const restored = projectSchema.parse(JSON.parse(JSON.stringify(project)));
  const restoredPassage = restored.nodes.find(node => node.id === passage.id)!;
  assert.ok(restoredPassage.kind === 'passage');
  assert.deepEqual(restoredPassage.lines[0].actions, JSON.parse(JSON.stringify([group])));
  const compiled = compileProject(restored);
  assert.deepEqual(compiled.diagnostics.filter(d => d.severity === 'error'), []);
  assert.ok(compiled.files['game/story.rpy'].includes('组合标题'));
  nested.children.push(createVisualObject('image', 'missing_nested_image'));
  assert.ok(validateProject(project).some(d => d.message.includes('missing_nested_image')));
});

test('glyph particles start on sampled source pixels and respect emission timing', () => {
  const object = createVisualObject('particles');
  object.glyphParticles = { assetId: 'glyph', count: 2, emissionStart: 1, timeScale: 1, motionScale: 0, sizeScale: 1, rect: { x: .1, y: .2, width: .8, height: .4 } };
  const points: [number, number][] = [[.25, .75]];
  assert.ok(visualGlyphParticles(object, .9, points, 100, 100, 1000, 500).every(p => p.opacity === 0));
  const at = visualGlyphParticles(object, 1, points, 100, 100, 1000, 500);
  assert.equal(at[0].opacity, 1);
  assert.equal(at[1].opacity, 0);
  assert.ok(Math.abs(at[0].x - .45) < 1e-9);
  assert.ok(Math.abs(at[0].y - .5) < 1e-9);
  assert.deepEqual(visualGlyphParticles(object, 2, [], 100, 100, 1000, 500), []);
  assert.ok(visualGlyphParticles(object, 8, points, 100, 100, 1000, 500).every(p => p.opacity === 0));
});

test('nested object inputs keep stable identities across child order and blueprint calls', () => {
  const project = createProject(), group = createVisualObject('group'), first = createVisualObject('text'), second = createVisualObject('text');
  first.text = '初始'; second.text = '另一个'; group.children = [first, second];
  const key = visualInputFields(group).find(field => field.value === '初始')!.key;
  assert.ok(('object_' + key).length <= 64);
  group.children.reverse();
  assert.equal(visualInputFields(group).find(field => field.value === '初始')!.key, key);
  assert.equal(applyVisualInputs(group, { [key]: '改写' }).children![1].text, '改写');
  assert.equal(first.text, '初始');
  const graph = blueprintFromPerformance(project, [group]); project.blueprints.push(graph);
  exposePerformanceInputs(graph, performanceInputs(graph).filter(field => field.pinId === 'object_' + key));
  const actions = expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: graph.id, inputs: { [graph.exposedInputs[0].id]: '调用标题' } }], previewActionContext(project));
  const result = actions.find(action => action.kind === 'visual')!;
  assert.equal(result.children![1].text, '调用标题');
  assert.equal(result.children![0].text, '另一个');
  assert.deepEqual(compileProject(project).diagnostics.filter(d => d.severity === 'error'), []);
});
