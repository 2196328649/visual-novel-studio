import { addProjectGraphs, projectGraphs } from '../src/core/project-resources';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema, type VisualObject } from '../src/core/model';
import { chapterComposition, normalizeChapterCompositions } from '../src/core/chapter-composition';
import { chapterFrame, chapterPresentation } from '../src/core/chapter';
import { visualDissolve, visualPose } from '../src/core/visual-object';
import { chapterCompositionBlueprint } from '../src/core/chapter-composition-blueprint';
import { parseProject } from '../src/desktop/project-store';
import { compileProject } from '../src/runtime/compiler';

test('chapter particle color survives project loading and conversion without changing opacity', () => {
  for (const color of [undefined, '#bcbcbc', '#d96231']) {
    const source = createProject(); source.ui.chapterTransition = { particleColor: color };
    const project = projectSchema.parse(JSON.parse(JSON.stringify(source)));
    const chapter = { title: '标题', subtitle: '', duration: 7, effect: 'ink' as const, titleImageId: 'title' };
    const root = chapterComposition(project, chapter).actions.at(-1) as VisualObject;
    const particle = root.children![1].children!.find(child => child.glyphParticles)!;
    assert.equal(chapterPresentation(project, chapter).particleColor, color ?? '#ffffff');
    assert.equal(particle.color, color ?? '#ffffff');
    assert.equal(visualPose(particle, 3).opacity, 1);
  }
});

test('chapter composition preserves surface, title motion and dissolve at arbitrary durations', () => {
  for (const effect of ['ink', 'fade', 'none'] as const) for (const duration of [3.5, 7, 10]) {
    const project = createProject(), original = JSON.stringify(project);
    const result = chapterComposition(project, { title: '第一章', subtitle: '', duration, effect, titleImageId: 'title', backgroundId: 'background' });
    assert.equal(JSON.stringify(project), original);
    const root = result.actions.at(-1) as VisualObject, presence = root.children![1];
    const title = presence.children!.find(child => child.name === '章节标题')!;
    for (let i = 0; i <= 100; i++) {
      const time = duration * i / 100, expected = chapterFrame(i / 100, effect);
      assert.ok(Math.abs(visualPose(root, time).opacity - expected.surface) < 1e-9, `${effect} ${time} surface`);
      assert.equal(visualPose(presence, time).opacity, 1);
      assert.ok(Math.abs(visualPose(title, time).x - (title.keyframes[0].x + expected.shift * .5)) < 1e-9, `${effect} ${time} x`);
      assert.ok(Math.abs(visualPose(title, time).opacity - expected.alpha) < 1e-9, `${effect} ${time} alpha`);
      assert.ok(Math.abs(visualDissolve(title, time) - expected.strength) < 1e-9, `${effect} ${time} dissolve`);
    }
    const passage = project.nodes.find(node => node.kind === 'passage')!;
    assert.ok(passage.kind === 'passage'); passage.lines[0].actions = result.actions;
    assert.ok(projectSchema.safeParse(project).success);
  }
});

test('old generated chapter fades migrate without changing identities, bindings or authored content', () => {
  const project = createProject();
  const { graph } = chapterCompositionBlueprint(project, { title: '保留标题', subtitle: '保留副标题', duration: 7, effect: 'ink' });
  addProjectGraphs(project, graph);
  const node = graph.nodes.find(node => node.type === 'savedAction')!;
  const root = JSON.parse(String(node.properties.action)) as VisualObject;
  root.children![1].curves = root.curves; delete root.curves; delete root.chapterPresentation;
  root.children![1].children![0].color = '#123456';
  node.properties.action = JSON.stringify(root);
  const snapshot = JSON.stringify(project), properties = { ...node.properties };
  const loaded = parseProject(project);
  assert.equal(loaded.migrated, true);
  assert.equal(JSON.stringify(project), snapshot);
  const migratedGraph = projectGraphs(loaded.project)[0], migratedNode = migratedGraph.nodes.find(candidate => candidate.id === node.id)!;
  const migrated = JSON.parse(String(migratedNode.properties.action)) as VisualObject;
  assert.deepEqual({ ...migratedGraph, nodes: [] }, { ...graph, nodes: [] });
  assert.deepEqual({ ...migratedNode, properties: {} }, { ...node, properties: {} });
  assert.deepEqual({ ...migratedNode.properties, action: undefined }, { ...properties, action: undefined });
  assert.deepEqual(migrated.curves, root.children![1].curves);
  assert.equal(migrated.chapterPresentation, true); delete migrated.chapterPresentation;
  migrated.children![1].curves = migrated.curves; delete migrated.curves;
  assert.deepEqual(migrated, root);
  assert.equal(normalizeChapterCompositions(loaded.project), false);
  assert.equal(parseProject(loaded.project).migrated, false);
  assert.deepEqual(compileProject(project).files, compileProject(loaded.project).files);
  assert.equal(JSON.stringify(project), snapshot);
});

test('chapter fade compatibility preserves manually edited opacity curves', () => {
  for (const edit of ['curve', 'rootOpacity', 'blackCurve', 'presenceOpacity'] as const) {
    const project = createProject();
    const root = chapterComposition(project, { title: '手工动画', subtitle: '', duration: 7, effect: 'fade' }).actions.at(-1) as VisualObject;
    const presence = root.children![1];
    presence.curves = root.curves; delete root.curves;
    if (edit === 'curve') presence.curves!.opacity![1].value = 0.6;
    if (edit === 'rootOpacity') root.keyframes[0].opacity = 0.5;
    if (edit === 'blackCurve') root.children![0].curves = { opacity: [{ at: 0, value: .4, easing: 'linear' }] };
    if (edit === 'presenceOpacity') presence.keyframes[0].opacity = 0.4;
    const node = project.nodes.find(node => node.kind === 'passage')!;
    node.lines[0].actions = [root];
    const snapshot = JSON.stringify(project);
    assert.equal(normalizeChapterCompositions(project), false, edit);
    assert.equal(JSON.stringify(project), snapshot, edit);
  }
});

test('chapter compositions generated before duration retiming also repair their black base', () => {
  const project = createProject();
  const root = chapterComposition(project, { title: '早期章节', subtitle: '', duration: 7, effect: 'ink' }).actions.at(-1) as VisualObject;
  root.children![1].curves = root.curves; delete root.curves; delete root.retimeOnDuration; delete root.chapterPresentation;
  project.scenes[0].entryActions = [root];
  assert.equal(normalizeChapterCompositions(project), true);
  assert.equal(visualPose(root, 0).opacity, 0);
  assert.equal(visualPose(root, 7).opacity, 0);
  assert.equal(root.retimeOnDuration, undefined);
  assert.equal(root.chapterPresentation, true);
});
