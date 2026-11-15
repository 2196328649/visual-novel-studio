import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject, projectSchema, type UiComponent } from '../src/core/model';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { storyMenuEntries } from '../src/core/story-menu';
import { editStoryFlowEntry, editStoryFlowSource, storyFlowOwner, storyFlowSources, storyFlowSourceEditable } from '../src/core/story-flow-authoring';
import { flowCaptionSlot, flowNodeAppearance } from '../src/core/flow-style';
import { storyFlowDefaults, storyFlowDirectoryLayout, storyFlowLayout } from '../src/core/story-flow';
import { applyUiDraft } from '../src/core/ui-draft';
import { mutateProject } from '../src/core/project-mutation';
import { compileProject } from '../src/runtime/compiler';

const component: UiComponent = { id: 'map', page: 'flowchart', kind: 'flowchart', text: '', x: 0, y: 0, width: 1, height: 1, list: { layout: 'flow' } };
const fixture = () => {
  const parsed = applyTextScript(createProject(), '#章节：章节标题\n#小章节(流程图=是)：小节标题\n旁白：正文\n#段落(流程图=是)：分支入口\n旁白：分支\n#章节：第二章\n旁白：收尾');
  assert.deepEqual(parsed.issues, []);
  parsed.project.ui.flowStyles = [{ id: 'shared', name: '共用' }];
  parsed.project.ui.components.push(component);
  return parsed.project;
};

test('selected node content resolves its current chapter/scene/node owner and survives text round-trip', () => {
  const project = fixture(), entry = storyMenuEntries(project, 'flowchart')[0];
  assert.equal(entry.owner?.kind, 'scene');
  editStoryFlowEntry(project, entry.id, { name: '记 第一回｜{醉梦}', styleId: 'shared' });
  assert.equal(project.chapters[0].flowchart?.name, undefined);
  assert.equal(storyFlowOwner(project, entry.owner)?.flowchart?.name, '记 第一回｜{醉梦}');
  const chapterSource = storyFlowSources(project).find(source => source.owner.id === project.chapters[0].id)!;
  assert.deepEqual(chapterSource.overriddenBy, entry.owner);
  editStoryFlowSource(project, entry.owner!, { visible: false });
  editStoryFlowEntry(project, entry.id, { name: '章节新标题', styleId: 'shared' });
  assert.equal(project.chapters[0].flowchart?.name, '章节新标题');
  assert.equal(storyFlowOwner(project, entry.owner)?.flowchart?.name, '记 第一回｜{醉梦}');
  const reopened = projectSchema.parse(JSON.parse(JSON.stringify(project)));
  const reparsed = applyTextScript(reopened, projectToText(reopened));
  assert.deepEqual(reparsed.issues, []);
  assert.deepEqual(storyMenuEntries(reparsed.project, 'flowchart'), storyMenuEntries(project, 'flowchart'));
});

test('restoring shared fields inherits the component identically before and after serialization', () => {
  const project = fixture();
  const c = { ...component, style: { fontSize: 41, textColor: '#112233', align: 'right' as const, captionParts: [{ fontSize: 21 }, {}] } };
  project.ui.flowStyles![0].style = { fontSize: undefined, textColor: undefined, align: undefined, captionParts: undefined };
  const before = flowNodeAppearance(project, c, { styleId: 'shared' });
  const after = flowNodeAppearance(projectSchema.parse(JSON.parse(JSON.stringify(project))), c, { styleId: 'shared' });
  assert.deepEqual(before.style, after.style);
  assert.equal(before.style?.fontSize, 41); assert.equal(before.style?.align, 'right');
  assert.deepEqual(before.style?.captionParts, c.style.captionParts);
  project.ui.flowStyles![0].style!.captionParts = [];
  assert.deepEqual(flowNodeAppearance(project, c, { styleId: 'shared' }).style?.captionParts, []);
  project.ui.flowStyles![0].style!.captionParts = [{}];
  assert.deepEqual(flowNodeAppearance(project, c, { styleId: 'shared' }).style?.captionParts, [{}]);
  const slots = [{ fontSize: 15 }, { fontSize: 45 }];
  assert.equal(flowCaptionSlot(slots, 1, 0)?.fontSize, 45);
  assert.deepEqual([0, 1, 2].map(index => flowCaptionSlot(slots, 3, index)?.fontSize), [15, 15, 45]);
});

test('internal or standalone nodes cannot acquire unsavable metadata through the source picker', () => {
  const project = fixture(), sceneId = project.scenes[0].id;
  project.nodes.push({ id: 'standalone', sceneId, name: '独立演出', kind: 'passage', x: 0, y: 0, lines: [{ id: 'silent', text: '', silent: true, actions: [] }] });
  project.nodes.push({ id: 'internal', sceneId, name: '内部跳转', kind: 'jump', target: project.entryId, x: 0, y: 0, textHeading: false });
  for (const id of ['standalone', 'internal']) {
    assert.equal(storyFlowSourceEditable(project, { kind: 'node', id }), false);
    assert.equal(storyFlowSources(project).some(source => source.owner.id === id), false);
    editStoryFlowSource(project, { kind: 'node', id }, { visible: true, name: '不应写入' });
    assert.equal(project.nodes.find(node => node.id === id)!.flowchart, undefined);
  }
  project.nodes.at(-1)!.flowchart = { visible: true, name: '旧入口' };
  const existing = storyFlowSources(project).find(source => source.owner.id === 'internal')!;
  assert.equal(existing.visible, true); assert.equal(existing.editable, false);
  editStoryFlowEntry(project, 'internal', { name: '不应写入' });
  assert.equal(project.nodes.at(-1)!.flowchart?.name, '旧入口');
  const first = storyMenuEntries(project, 'flowchart')[0];
  editStoryFlowEntry(project, first.id, { name: '正常修改小节' });
  const reparsed = applyTextScript(project, projectToText(project));
  assert.deepEqual(reparsed.issues, []);
  assert.equal(reparsed.project.nodes.find(node => node.id === 'internal')?.flowchart?.name, '旧入口');
  // The appended fixture nodes are regrouped by chapter when serialized.
  assert.deepEqual(new Map(storyMenuEntries(reparsed.project, 'flowchart').map(entry => [entry.id, entry])), new Map(storyMenuEntries(project, 'flowchart').map(entry => [entry.id, entry])));
});

test('UI content and shared style draft merge preserves unrelated story edits and late assets', () => {
  const base = fixture(), entry = storyMenuEntries(base, 'flowchart')[0];
  const value = mutateProject(base, draft => {
    editStoryFlowEntry(draft, entry.id, { name: '新名', styleId: 'shared' });
    draft.ui.flowStyles![0].style = { textColor: '#abcdef' };
  });
  const current = mutateProject(base, draft => {
    draft.assets.push({ id: 'late_font', name: '新字体', path: 'font.ttf', kind: 'font' });
    draft.nodes.find(node => node.kind === 'passage')!.lines[0].text = '并发编辑正文';
  });
  const merged = applyUiDraft(current, { base, value });
  assert.equal(storyFlowOwner(merged, entry.owner)?.flowchart?.name, '新名');
  assert.equal(merged.assets.at(-1)?.id, 'late_font');
  assert.equal(merged.nodes.find(node => node.kind === 'passage')!.lines[0].text, '并发编辑正文');
  assert.equal(merged.ui.flowStyles![0].style?.textColor, '#abcdef');
  assert.equal(storyFlowOwner(base, entry.owner)?.flowchart?.name, undefined);
});

test('branch default geometry ignores directory rows and columns without clearing them', () => {
  const project = fixture(), graph = storyFlowLayout(project, component);
  assert.ok(graph.nodes.every(node => node.width === storyFlowDefaults.itemWidth && node.height === storyFlowDefaults.itemHeight));
  const directory = { ...component, list: { ...component.list, rows: 3, columns: 2 } };
  assert.deepEqual(storyFlowLayout(project, directory), graph);
  assert.equal(directory.list.rows, 3);
});

test('directory samples use actual automatic cell geometry and reserve navigation space', () => {
  const project = fixture(); project.width = 1000; project.height = 600;
  const c = { ...component, list: { layout: 'grid' as const, rows: 2, columns: 2 } };
  const layout = storyFlowDirectoryLayout(project, c);
  assert.equal(layout.cellWidth, 494); assert.equal(layout.cellHeight, 268); assert.equal(layout.viewHeight, 548);
  const custom = storyFlowDirectoryLayout(project, { ...c, list: { ...c.list, navigationRect: { x: 0, y: .9, width: 1, height: .1 } } });
  assert.equal(custom.cellHeight, 294); assert.equal(custom.viewHeight, 600);
  const scrolling = storyFlowDirectoryLayout(project, { ...c, list: { ...c.list, rows: 0 }, style: { fontSize: 64 } });
  assert.equal(scrolling.cellWidth, 486); assert.equal(scrolling.cellHeight, 92);
});

test('generated map styles pass alignment and omit empty optional slot values', () => {
  const project = fixture(), entry = storyMenuEntries(project, 'flowchart')[0];
  editStoryFlowEntry(project, entry.id, { name: '一｜二', styleId: 'shared' });
  project.ui.flowStyles![0].style = { align: 'left', captionParts: [{ fontSize: 16 }, {}] };
  const compiled = compileProject(project);
  assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), []);
  assert.ok(compiled.files['game/screens.rpy'].includes('"captionParts": [{"size": 16}, {}]'));
  assert.ok(compiled.files['game/screens.rpy'].includes('"align": "left"'));
});
