import { addProjectGraphs, withProjectGraphs, projectGraphs } from '../src/core/project-resources';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject, projectSchema, type StageAction } from '../src/core/model';
import { parseProject } from '../src/desktop/project-store';
import { applyTextScript, projectToText, textCommandAction } from '../src/core/text-script';
import { compileProject } from '../src/runtime/compiler';
import { createChapterPerformance, chapterImagePerformanceId, normalizeGeneratedChapterBlueprints } from '../src/core/chapter-performances';
import { availablePerformanceBlueprints } from '../src/core/builtin-performances';
import { blueprintFromPerformance, exposePerformanceInputs, performanceInputs, rawSavedBlueprintAction } from '../src/core/blueprint-authoring';
import { arrangePerformanceTimeline, performanceTimeline } from '../src/core/performance-timeline';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';

test('legacy captions and unlocks become ordinary performances without replacing a text draft', () => {
  const project = createProject('迁移');
  project.assets.push({ id: 'gallery_image', name: '图鉴图片', kind: 'image', path: 'image.png' });
  const end = project.nodes.find(node => node.kind === 'end')!;
  const raw = { ...project, nodes: project.nodes.map(node => node.id === end.id ? { ...node, text: '已保存的字幕', mode: 'caption', unlockIds: ['gallery_image'] } : node),
    scriptText: { format: 'vns-text-1', content: `#章节：草稿章节\n#小章节：草稿场景\n#段落：尚未应用的段落\n旁白：保留这句新写的台词。\n@节点标记：收尾【${end.id}】\n@结局："草稿字幕\\n第二行"\n@解锁CG：图鉴图片【gallery_image】\n` },
  };
  const before = structuredClone(raw), loaded = parseProject(raw);
  assert.equal(loaded.migrated, true); assert.deepEqual(raw, before);
  const performance = loaded.project.nodes.find(node => node.id === end.id);
  assert.ok(performance?.kind === 'passage');
  assert.deepEqual(performance.lines[0].actions[0], { kind: 'unlock', assetId: 'gallery_image' });
  assert.equal(loaded.project.nodes.find(node => node.id === performance.next)?.kind, 'end');
  const source = loaded.project.scriptText!.content;
  assert.match(source, /保留这句新写的台词/); assert.match(source, /草稿字幕\\n第二行/);
  assert.doesNotMatch(source, /@结局[：:]|@解锁CG/);
  const parsed = applyTextScript(loaded.project, source);
  assert.deepEqual(parsed.issues, []);
  const migrated = parsed.project.nodes.find(node => node.id === end.id);
  assert.ok(migrated?.kind === 'passage');
  assert.ok(migrated.lines[0].actions.some(action => action.kind === 'blueprint' && action.inputs?.caption === '草稿字幕\n第二行'));
  assert.equal(parseProject(loaded.project).migrated, false);
  const compiled = compileProject(loaded.project);
  assert.deepEqual(compiled.diagnostics.filter(d => d.severity === 'error'), []);
  assert.match(compiled.files['game/story.rpy'], /vn_unlock\("gallery_image"\)/);
  assert.doesNotMatch(Object.values(compiled.files).join('\n'), /vn_ending/);
});

test('the retired caption command is no longer an authoring command', () => {
  const project = createProject();
  assert.ok(applyTextScript(project, '@结局：旧字幕').issues.some(issue => issue.severity === 'error'));
  assert.doesNotMatch(projectToText(project), /@结局[：:]/);
});

test('legacy endings with long shared ID prefixes reserve distinct generated identities', () => {
  const project = createProject(), prefix = 'a'.repeat(61);
  const raw = { ...project, entryId: prefix + 'one', nodes: ['one', 'two'].map(name => ({
    id: prefix + name, name, kind: 'end', sceneId: project.scenes[0].id, x: 0, y: 0, text: name,
  })) };
  const migrated = parseProject(raw).project;
  const identities = migrated.nodes.flatMap(node => [node.id, ...(node.kind === 'passage' ? node.lines.map(line => line.id) : [])]);
  assert.equal(new Set(identities).size, identities.length);
  const passages = migrated.nodes.filter(node => node.kind === 'passage');
  assert.notEqual(passages[0].next, passages[1].next);
  for (const passage of passages) assert.equal(migrated.nodes.find(node => node.id === passage.next)?.kind, 'end');
  assert.equal(parseProject(migrated).migrated, false);
  const restored = applyTextScript(migrated, projectToText(migrated));
  assert.deepEqual(restored.issues, []);
  const identitiesAndContent = (value: typeof migrated) => value.nodes.map(node => ({ id: node.id, kind: node.kind,
    ...(node.kind === 'passage' ? { next: node.next, lines: node.lines } : {}) }));
  assert.deepEqual(identitiesAndContent(restored.project), identitiesAndContent(migrated));
});

test('chapter presets retain separately editable music and background bindings', () => {
  const project = createProject();
  project.assets.push({ id: 'background', name: 'Background', kind: 'image', path: 'bg.png' }, { id: 'music', name: 'Music', kind: 'audio', path: 'music.ogg' });
  const graph = createChapterPerformance(project, 'text', { kind: 'chapter', title: 'Title', subtitle: '', duration: 7, backgroundId: 'background', soundId: 'music', effect: 'ink' });
  addProjectGraphs(project, graph);
  assert.ok(graph.exposedInputs.some(pin => pin.id === 'sound' && pin.defaultValue === 'music'));
  assert.ok(graph.exposedInputs.some(pin => pin.id === 'background' && pin.defaultValue === 'background'));
  const actions = expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: graph.id }], previewActionContext(project));
  assert.ok(actions.some(action => action.kind === 'sound' && action.assetId === 'music'));
  assert.equal(performanceTimeline(project, graph).until, 7);
});

test('chapter presets expose only the active title format and use editable objects', () => {
  const project = createProject();
  project.assets.push({ id: 'title_image', name: '章节题图', kind: 'image', path: 'title.png' });
  for (const mode of ['text', 'image'] as const) {
    const graph = createChapterPerformance(project, mode);
    assert.equal(graph.chapterVariant, mode);
    assert.equal(graph.nodes.some(node => node.type === 'showChapter'), false);
    assert.ok(graph.nodes.some(node => rawSavedBlueprintAction(node)?.kind === 'visual'));
    assert.ok(graph.exposedInputs.some(pin => pin.id === (mode === 'image' ? 'title_image' : 'title')));
    assert.equal(graph.exposedInputs.some(pin => pin.id === (mode === 'image' ? 'title' : 'title_image')), false);
    assert.ok(projectSchema.safeParse(withProjectGraphs({ ...project }, [graph])).success);
    const parsed = applyTextScript(project, `@${graph.name}\n@独立演出：章节\n@返回标题界面`);
    assert.deepEqual(parsed.issues, []);
    assert.ok(projectGraphs(parsed.project).some(item => item.id === graph.id));
    const timeline = performanceTimeline(withProjectGraphs({ ...project }, [graph]), graph);
    assert.equal(timeline.reason, undefined); assert.equal(timeline.until, 7);
    const actions = expandPreviewActions(withProjectGraphs({ ...project }, [graph]), [{ kind: 'blueprint', blueprintId: graph.id }], previewActionContext(project));
    const walk = (action: StageAction): StageAction[] => [action, ...(action.kind === 'visual' ? (action.children ?? []).flatMap(walk) : [])];
    const objects = actions.flatMap(walk).filter(action => action.kind === 'visual');
    assert.ok(objects.some(action => action.content === 'particles' && action.glyphParticles));
    assert.ok(objects.some(action => action.curves?.dissolveStrength?.at(-1)?.value === -1));
  }
  assert.ok(availablePerformanceBlueprints(project).some(graph => graph.name === '章节进入演出文字版'));
});

test('chapter presets respect an explicitly configured fade instead of replacing it', () => {
  const project = createProject(); project.ui.chapterTransition = { effect: 'fade' };
  const graph = createChapterPerformance(project, 'text'); addProjectGraphs(project, graph);
  const actions = expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: graph.id }], previewActionContext(project));
  assert.equal(JSON.stringify(actions).includes('glyphParticles'), false);
});

test('bare chapter entry calls the image timeline preset and keeps its full name usable', () => {
  const project = createProject();
  for (const name of ['章节进入演出', '章节进入演出图片版']) {
    const action = textCommandAction(project, '@' + name);
    assert.equal(action?.kind, 'blueprint');
    assert.equal(action?.kind === 'blueprint' && action.blueprintId, chapterImagePerformanceId);
    const parsed = applyTextScript(project, '@' + name + '\n旁白：进入章节。');
    assert.deepEqual(parsed.issues, []);
    const owner = projectGraphs(parsed.project).find(graph => graph.id === chapterImagePerformanceId)!;
    assert.equal(owner.chapterVariant, 'image');
    const child = projectGraphs(parsed.project).find(graph => graph.id === owner.nodes.find(node => node.type === 'callFunction')?.properties.graphId)!;
    assert.ok(child.timelineComponent && child.timeline);
  }
});

test('image chapter alias never replaces an authored name or call name', () => {
  for (const useCallName of [false, true]) {
    const project = createProject();
    const authored = blueprintFromPerformance(project, [{ kind: 'pause', seconds: .7 }], useCallName ? '我的章节图' : '章节进入演出');
    if (useCallName) authored.callName = '章节进入演出';
    addProjectGraphs(project, authored);
    const action = textCommandAction(project, '@章节进入演出');
    assert.equal(action?.kind === 'blueprint' && action.blueprintId, authored.id);
    const explicit = textCommandAction(project, '@章节进入演出图片版');
    assert.equal(explicit?.kind === 'blueprint' && explicit.blueprintId, chapterImagePerformanceId);
    const parsed = applyTextScript(project, '@章节进入演出图片版\n@章节进入演出\n旁白：保留作者演出。');
    assert.deepEqual(parsed.issues, []);
    const preserved = textCommandAction(parsed.project, '@章节进入演出');
    assert.equal(preserved?.kind === 'blueprint' && preserved.blueprintId, authored.id);
    assert.deepEqual(projectGraphs(parsed.project).find(graph => graph.id === authored.id), authored);
    assert.equal(projectGraphs(parsed.project).find(graph => graph.id === chapterImagePerformanceId)?.callName, '章节进入演出图片版');
  }
});

test('generated image chapters migrate in place while dynamic arguments are preserved', () => {
  const project = createProject();
  project.assets.push({ id: 'title_image', name: '题图', kind: 'image', path: 'title.png' });
  const action: StageAction = { kind: 'chapter', title: '图片模式的标题', subtitle: '说明', titleImageId: 'title_image', duration: 7, effect: 'ink' };
  const graph = blueprintFromPerformance(project, [action], '章节进入演出');
  exposePerformanceInputs(graph, performanceInputs(graph).filter(pin => pin.pinId !== 'wait'));
  const timeline = performanceTimeline(project, graph); arrangePerformanceTimeline(project, graph, timeline.clips, timeline.tracks);
  addProjectGraphs(project, graph);
  const id = graph.id, blocked = structuredClone(project);
  blocked.scriptText = { format: 'vns-text-1', content: '@章节进入演出：动效=淡入淡出' };
  assert.equal(normalizeGeneratedChapterBlueprints(blocked), false);
  assert.equal(normalizeGeneratedChapterBlueprints(project), true);
  assert.equal(projectGraphs(project)[0].id, id); assert.equal(projectGraphs(project)[0].name, '章节进入演出');
  assert.equal(projectGraphs(project)[0].nodes.some(node => node.type === 'showChapter'), false);
  assert.equal(normalizeGeneratedChapterBlueprints(project), false);
  const actions = expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: id }], previewActionContext(project));
  assert.ok(actions.some(action => action.kind === 'visual' && action.chapterPresentation));
  assert.ok(projectSchema.safeParse(project).success);
  assert.ok(textCommandAction(project, '@章节进入演出'));
});
