import { projectGraphs } from '../src/core/project-resources';
import assert from 'node:assert/strict';
import test from 'node:test';
import { promises as fs } from 'node:fs';
import { projectSchema } from '../src/core/model';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { performanceWorkspaceDraft } from '../src/core/performance-workspace';
import { performanceTimeline } from '../src/core/performance-timeline';
import { compileProject } from '../src/runtime/compiler';
import { parseProject } from '../src/desktop/project-store';
import { endingPerformanceId } from '../src/core/builtin-performances';
import { prepareAihongAuthoring } from '../scripts/lib/aihong-authoring';
import { galleryEntries, galleryUnlockedAssets } from '../src/core/gallery';
import { linePreviewSnapshot } from '../src/core/line-preview';

test('the bundled template opens on current syntax and remains unchanged when timelines are viewed', async () => {
  const project = projectSchema.parse(JSON.parse(await fs.readFile(new URL('../resources/templates/aihong/project.vns.json', import.meta.url), 'utf8')));
  const source = project.scriptText!.content;
  assert.equal(source, projectToText(project));
  assert.doesNotMatch(source, /@实例[:：]|@章节标题[:：]|@结局[:：]|@解锁CG[:：]/);
  assert.equal((source.match(/@条件[:：]/g) ?? []).length, 2);
  assert.equal((source.match(/@结局演出/g) ?? []).length, 3);
  assert.equal((source.match(/@返回标题界面/g) ?? []).length, 3);
  const before = structuredClone(project);
  for (const nodeId of ['ai_title_one', 'ai_title_two']) {
    const workspace = performanceWorkspaceDraft(project, { nodeId });
    const graph = projectGraphs(workspace.project).find(graph => graph.id === workspace.target?.graphId);
    assert.ok(graph);
    assert.equal(performanceTimeline(workspace.project, graph).until, 7);
    assert.equal(workspace.project, project);
  }
  assert.deepEqual(project, before);
  const parsed = applyTextScript(project, source);
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.project.nodes)), JSON.parse(JSON.stringify(project.nodes)));
  for (const id of ['ai_ending_shelter', 'ai_ending_dream', 'ai_ending_boat']) {
    const node = project.nodes.find(node => node.id === id);
    assert.ok(node?.kind === 'passage');
    const action = node.lines[0].actions[0];
    assert.ok(action.kind === 'blueprint' && action.blueprintId === endingPerformanceId);
    assert.equal(typeof action.inputs?.caption, 'string');
    const next = project.nodes.find(item => item.id === node.next);
    assert.ok(next?.kind === 'end');
    assert.equal('unlockIds' in next || 'text' in next || 'mode' in next, false);
  }
  prepareAihongAuthoring(project);
  assert.deepEqual(project, before);
  const saved = parseProject(JSON.parse(JSON.stringify(project)));
  assert.equal(saved.migrated, false);
  assert.equal(saved.project.scriptText!.content, source);
  assert.deepEqual(compileProject(saved.project).diagnostics.filter(issue => issue.severity === 'error'), []);
});

test('sample gallery follows displayed backgrounds while ending parameters preserve higher progress', async () => {
  const project = projectSchema.parse(JSON.parse(await fs.readFile(new URL('../resources/templates/aihong/project.vns.json', import.meta.url), 'utf8')));
  const gallery = project.ui.components.find(component => component.id === 'ai_gallery_items')!;
  const groups = galleryEntries(project, gallery);
  assert.equal(groups.length, 8);
  assert.equal(groups.reduce((count, group) => count + group.assetIds.length, 0), 8);
  for (const id of ['ai_chapter_progress', 'ai_ending_shelter_reached', 'ai_ending_dream_reached', 'ai_ending_boat_reached']) {
    const variable = project.variables.find(variable => variable.id === id)!;
    assert.equal(variable.persistent, true);
    assert.equal(variable.parameterSetId, 'ai_progress_parameters');
  }
  for (const group of groups) {
    assert.equal(group.unlockWhen, undefined);
    assert.deepEqual(galleryUnlockedAssets(gallery, group, [], { ai_chapter_progress: 5 }), []);
    assert.deepEqual(galleryUnlockedAssets(gallery, group, group.assetIds), group.assetIds);
    assert.ok(JSON.stringify([project.nodes, project.scenes, projectGraphs(project)]).includes(group.assetIds[0]));
  }
  for (const ending of ['shelter', 'dream', 'boat']) {
    const node = project.nodes.find(node => node.id === 'ai_ending_' + ending);
    assert.ok(node?.kind === 'passage');
    const values = linePreviewSnapshot(project, { nodeId: node.id, lineId: node.lines[0].id }).context.variables;
    assert.equal(values.ai_chapter_progress, 2);
    for (const other of ['shelter', 'dream', 'boat']) assert.equal(values['ai_ending_' + other + '_reached'], other === ending);
  }
  project.variables.find(variable => variable.id === 'ai_chapter_progress')!.initial = 5;
  const opening = project.nodes.find(node => node.id === 'opening'); assert.ok(opening?.kind === 'passage');
  assert.equal(linePreviewSnapshot(project, { nodeId: opening.id, lineId: opening.lines[0].id }).context.variables.ai_chapter_progress, 5);
});

