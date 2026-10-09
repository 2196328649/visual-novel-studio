import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema } from '../src/core/model';
import { addProjectGraphs, blueprintResources, graphResourceKey, normalizeProjectResources, projectGraphs, withProjectGraphs } from '../src/core/project-resources';
import { createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { addTimelineComponent, createTimelinePreset } from '../src/core/timeline-component';
import { insertTimelineAction } from '../src/core/performance-timeline';
import { availablePerformanceBlueprints, installPerformanceBlueprint } from '../src/core/builtin-performances';
import { chapterBlueprintPair, createChapterPerformance } from '../src/core/chapter-performances';
import { textCommandAction } from '../src/core/text-script';
import { projectContent, contentRemovalSelection, removeContentSelection, renameContent } from '../src/core/content-browser';
import { queryContent } from '../src/core/content-query';
import { compileProject } from '../src/runtime/compiler';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { parseProject } from '../src/desktop/project-store';

test('timelines have their own library, content type, filter and persisted identity', () => {
  const project = createProject(), owner = createBlueprintGraph('effect', '章节逻辑');
  addProjectGraphs(project, owner);
  const { timeline } = addTimelineComponent(project, owner.id);
  assert.deepEqual(project.blueprints.map(graph => graph.id), [owner.id]);
  assert.deepEqual(project.timelinePresets?.map(graph => graph.id), [timeline.id]);
  const reopened = parseProject(JSON.parse(JSON.stringify(project))).project;
  assert.deepEqual(blueprintResources(reopened).map(graph => graph.id), [owner.id]);
  assert.deepEqual(queryContent(reopened, projectContent(reopened), { kinds: ['timeline'], query: '', scope: 'all' }).visible.map(item => item.key), ['timeline:' + timeline.id]);
  assert.deepEqual(queryContent(reopened, projectContent(reopened), { kinds: ['blueprint'], query: '', scope: 'all' }).visible.map(item => item.key), ['blueprint:' + owner.id]);
  assert.equal(reopened.timelinePresets?.[0].name, timeline.name);
});

test('normalization keeps timeline defaults, folder placement, favorites and call bindings', () => {
  const project = createProject(), timeline = createTimelinePreset(project);
  timeline.exposedInputs = [{ id: 'duration', name: '时长', direction: 'input', dataType: 'number', required: false, defaultValue: 7 }];
  project.blueprints.push(timeline);
  project.contentBrowser = { folders: [{ id: 'chapter', name: '章节' }], assignments: { ['blueprint:' + timeline.id]: 'chapter' }, favorites: ['blueprint:' + timeline.id] };
  assert.equal(normalizeProjectResources(project), true);
  assert.equal(normalizeProjectResources(project), false);
  assert.deepEqual(project.contentBrowser.assignments, { ['timeline:' + timeline.id]: 'chapter' });
  assert.deepEqual(project.contentBrowser.favorites, ['timeline:' + timeline.id]);
  assert.equal(projectSchema.parse(project).timelinePresets?.[0].exposedInputs[0].defaultValue, 7);
  project.scriptText = { format: 'vns-text-1', content: '@' + timeline.name + '\n旁白：新的时间轴预设' };
  renameContent(project, projectContent(project).find(item => item.id === timeline.id)!, '标题时间轴');
  assert.equal(textCommandAction(project, project.scriptText.content.split('\n')[0])?.kind, 'blueprint');
  assert.equal(project.scriptText.content.split('\n')[1], '旁白：新的时间轴预设');
  assert.equal(graphResourceKey(timeline), 'timeline:' + timeline.id);
});

test('separated timeline calls retain defaults in editor preview, transient overrides and native output', () => {
  const project = createProject(), owner = createBlueprintGraph('effect', '入场');
  project.assets = [{ id: 'picture', name: '默认背景', kind: 'image', path: 'picture.png' }];
  addProjectGraphs(project, owner);
  const { timeline } = addTimelineComponent(project, owner.id);
  insertTimelineAction(project, timeline, { kind: 'background', assetId: 'picture', transition: 'none' }, 0);
  synchronizeBlueprintSignatures(project);
  const context = previewActionContext(project);
  assert.ok(expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: owner.id }], context).some(action => action.kind === 'background' && action.assetId === 'picture'));
  assert.equal(context.incomplete, false);
  const preview = withProjectGraphs(project, projectGraphs(project).map(graph => graph.id === timeline.id ? { ...graph, name: '临时预览' } : graph));
  assert.equal(preview.timelinePresets?.[0].name, '临时预览');
  assert.equal(project.timelinePresets?.[0].name, timeline.name);
  const compiled = compileProject(project).files['game/story.rpy'];
  assert.ok(compiled.includes('label vn_blueprint_' + timeline.id));
  assert.ok(compiled.includes('call vn_blueprint_' + timeline.id));
});

test('an authored image chapter alias wins over built-in defaults after separate-resource reload', () => {
  const project = createProject();
  project.assets = [{ id: 'title_art', name: '章节题图', kind: 'image', path: 'title.png' }];
  const [owner, child] = chapterBlueprintPair(createChapterPerformance(project, 'image'));
  owner.id = 'authored_chapter'; owner.exposedInputs.find(pin => pin.name === '时长')!.defaultValue = 9;
  child.exposedInputs.find(pin => pin.name === '时长')!.defaultValue = 9;
  addProjectGraphs(project, owner, child);
  const reopened = parseProject(JSON.parse(JSON.stringify(project))).project;
  const graph = availablePerformanceBlueprints(reopened).find(graph => graph.callName === '章节进入演出')!;
  assert.equal(graph.id, owner.id); assert.equal(graph.name, '章节进入演出图片版');
  assert.equal(graph.exposedInputs.find(pin => pin.name === '时长')?.defaultValue, 9);
  installPerformanceBlueprint(reopened, graph);
  assert.equal(projectGraphs(reopened).filter(graph => graph.id === owner.id).length, 1);
  assert.ok(reopened.timelinePresets?.some(graph => graph.id === child.id));
});

test('recursive removal includes filtered descendants, deduplicates overlap and allows internal references', () => {
  const project = createProject(), owner = createBlueprintGraph('effect', '只在文件夹内使用');
  project.assets = [{ id: 'picture', name: '隐藏图片', kind: 'image', path: 'picture.png' }];
  addProjectGraphs(project, owner);
  const { timeline } = addTimelineComponent(project, owner.id);
  insertTimelineAction(project, timeline, { kind: 'background', assetId: 'picture', transition: 'none' }, 0);
  project.contentBrowser = { folders: [{ id: 'root', name: '待删除' }, { id: 'child', name: '内层', parentId: 'root' }, { id: 'keep', name: '保留' }], assignments: { ['blueprint:' + owner.id]: 'root', ['timeline:' + timeline.id]: 'child', 'asset:picture': 'child' }, favorites: ['timeline:' + timeline.id, 'asset:picture'] };
  const selection = ['folder:root', 'folder:child', 'blueprint:' + owner.id];
  assert.equal(queryContent(project, projectContent(project), { kinds: ['blueprint'], query: '', scope: 'folder', folderId: 'root' }).visible.length, 1);
  const removal = contentRemovalSelection(project, selection);
  assert.equal(removal.items.length, 3); assert.equal(removal.folders.length, 2);
  assert.equal(removeContentSelection(project, selection), 3);
  assert.deepEqual(project.assets, []); assert.deepEqual(projectGraphs(project), []);
  assert.deepEqual(project.contentBrowser, { folders: [{ id: 'keep', name: '保留' }], assignments: {}, favorites: [] });
});

test('a text draft calling a timeline protects it and its entire folder atomically', () => {
  const project = createProject(), timeline = createTimelinePreset(project, '不能删除');
  addProjectGraphs(project, timeline);
  project.contentBrowser = { folders: [{ id: 'folder', name: '待删除' }], assignments: { ['timeline:' + timeline.id]: 'folder' }, favorites: [] };
  project.scriptText = { format: 'vns-text-1', content: '@不能删除' };
  const before = structuredClone(project);
  assert.throws(() => removeContentSelection(project, ['folder:folder']), /仍被/);
  assert.deepEqual(project, before);
});
