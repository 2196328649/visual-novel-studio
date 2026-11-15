import assert from 'node:assert/strict';
import { createProject, projectSchema, type Project, type StoryNode, type UiComponent } from '../../src/core/model';
import { storyMenuEntries, type StoryMenuEntry } from '../../src/core/story-menu';
import { projectToText } from '../../src/core/text-script';
import { currentScriptText } from '../../src/core/script-text';
import { validateProject } from '../../src/core/validate';

export const playerFlowCallsIds = {
  project: 'flow_calls_acceptance', chapter: 'flow_calls_chapter', scene: 'flow_calls_scene',
  script: 'flow_calls_script', custom: 'flow_calls_custom', group: 'flow_calls_end_group',
  a: 'flow_calls_a', b: 'flow_calls_b', c: 'flow_calls_c', end: 'flow_calls_end',
  first: 'flow_calls_first', second: 'flow_calls_second', nested: 'flow_calls_nested', recursive: 'flow_calls_recursive',
  x: 'flow_calls_x', xChoice: 'flow_calls_x_choice', xLeft: 'flow_calls_x_left', xRight: 'flow_calls_x_right',
  xAfter: 'flow_calls_x_after', xReturn: 'flow_calls_x_return',
  y: 'flow_calls_y', yChoice: 'flow_calls_y_choice', yAfter: 'flow_calls_y_after', yReturn: 'flow_calls_y_return',
  preset: 'flow_calls_legacy_style',
} as const;

export const playerFlowCallCardId = (callId: string) => `call:${callId}`;
export const playerFlowCallBodyId = (targetId: string) => `call-body:${targetId}`;

export interface PlayerFlowCallsFixture {
  project: Project;
  entries: StoryMenuEntry[];
  originalScript: string;
  diagnostics: ReturnType<typeof validateProject>;
  rootIds: string[];
  customRootIds: string[];
  xIds: string[];
  yIds: string[];
  rootEdges: [string, string][];
  customRootEdges: [string, string][];
  xEdges: [string, string][];
  yEdges: [string, string][];
}

const map = (id: string, name: string, x: number): UiComponent => ({
  id, name, kind: 'flowchart', page: 'flowchart', text: '', x, y: .05, width: .46, height: .9,
  list: { layout: 'flow', itemWidth: 230, itemHeight: 76, gapX: 42, gapY: 34, columns: 1,
    flowShowControls: false, flowShowVerticalScrollbar: false, lockUnread: false },
  style: { fontSize: 25, textColor: '#edf2ed', background: '#263b3a', borderWidth: 1, borderColor: '#79958b', radius: 4,
    shadowX: 0, shadowY: 0, shadowSpread: 5, shadowBlur: 12, shadowColor: '#000000', shadowOpacity: .68,
    captionParts: [{ fontSize: 26, color: '#e8d6b4', letterSpacing: -1 }, { fontSize: 17, color: '#dce7db', gap: 3 }] },
});

/** Entirely synthetic. Expected cards and edges are authored here, independently
 * of the projection/layout being accepted. The recursive option is inspected in
 * the editor only; no native game is launched by its desktop acceptance. */
export function createPlayerFlowCallsFixture(): PlayerFlowCallsFixture {
  const ids = playerFlowCallsIds;
  const project = createProject('玩家剧情图调用与返回验收');
  project.id = ids.project;
  project.width = 1920;
  project.height = 1080;
  project.resourceSettings = { importMode: 'copy', directory: 'assets', syncFolders: false };
  project.chapters = [{ id: ids.chapter, name: '独立验收章节', flowchart: { visible: false } }];
  project.scenes = [{ id: ids.scene, chapterId: ids.chapter, name: '调用验收场景', flowchart: { visible: false } }];
  project.entryId = ids.a;
  project.ui.pages = { flowchart: { layout: 'custom', background: '#192321' } };
  project.ui.flowStyles = [{ id: ids.preset, name: '旧工程文字与黑底', style: {
    fontSize: 28, textColor: '#fff1cf', shadowSpread: 7, shadowBlur: 10, shadowX: 2, shadowY: -1,
    shadowColor: '#000000', shadowOpacity: .73, captionParts: [{ fontSize: 29, color: '#fff1cf', letterSpacing: -2 }, { fontSize: 18, color: '#b5dfd7', gap: 4 }],
  } }];
  const base = (id: string, name: string, shown = true) => ({ id, name, sceneId: ids.scene, x: 0, y: 0,
    textHeading: true, ...(shown ? { flowchart: { visible: true, name, styleId: ids.preset } } : {}) });
  const passage = (id: string, name: string, text: string, next: string): StoryNode => ({ ...base(id, name), kind: 'passage',
    lines: [{ id: `${id}_line`, text, actions: [] }], next });
  const call = (id: string, name: string, target: string, next: string): StoryNode => ({ ...base(id, name, false), kind: 'call', target, next });
  project.nodes = [
    passage(ids.a, '外层 A', 'A：第一次进入共享正文前。', ids.first),
    call(ids.first, '第一次调用 X', ids.x, ids.b),
    passage(ids.b, '外层 B', 'B：第一次返回后、第二次调用前。', ids.second),
    call(ids.second, '第二次调用 X', ids.x, ids.c),
    passage(ids.c, '外层 C', 'C：第二次返回后。', ids.end),
    { ...base(ids.end, '结束', false), kind: 'end' },
    passage(ids.x, '共享正文 X｜旧版文字〖原样〗', 'X：两个外层调用共用这段正文。', ids.xChoice),
    { ...base(ids.xChoice, 'X 的实际选择'), kind: 'choice', prompt: 'X 中选哪条路？', choices: [
      { id: 'flow_calls_left_option', text: '嵌套调用 Y', target: ids.xLeft },
      { id: 'flow_calls_right_option', text: '直接返回外层', target: ids.xRight },
    ] },
    passage(ids.xLeft, 'X 嵌套路线', 'X：准备进入 Y。', ids.nested),
    call(ids.nested, 'X 内调用 Y', ids.y, ids.xAfter),
    passage(ids.xAfter, 'X 的 Y 返回后续', 'X：从 Y 返回后再继续。', ids.xReturn),
    passage(ids.xRight, 'X 直接返回路线', 'X：这条路线也先到返回节点。', ids.xReturn),
    { ...base(ids.xReturn, 'X 返回调用处'), kind: 'return' },
    passage(ids.y, '共享正文 Y', 'Y：嵌套正文。', ids.yChoice),
    { ...base(ids.yChoice, 'Y 的实际选择'), kind: 'choice', prompt: '检查哪种嵌套导航？', choices: [
      { id: 'flow_calls_y_return_option', text: '返回 X', target: ids.yReturn },
      { id: 'flow_calls_y_recurse_option', text: '再调用已有 X', target: ids.recursive },
    ] },
    call(ids.recursive, 'Y 内递归调用 X', ids.x, ids.yAfter),
    passage(ids.yAfter, 'Y 的递归返回后续', 'Y：递归 X 返回后继续。', ids.yReturn),
    { ...base(ids.yReturn, 'Y 返回调用处'), kind: 'return' },
  ];

  const entries = storyMenuEntries(project, 'flowchart');
  const script = map(ids.script, '跟随剧本 · 调用图', .025);
  // Old roots already supported string-keyed coordinates. No flowContent is
  // present here so opening this control also checks omission compatibility.
  script.list!.flowPositions = {
    [playerFlowCallCardId(ids.first)]: { x: 295, y: 105 },
    [playerFlowCallCardId(ids.second)]: { x: 860, y: 105 },
  };
  const custom = map(ids.custom, '自定义 · 调用图', .515);
  custom.list!.flowContent = { mode: 'custom', custom: {
    entries: entries.map(entry => ({ nodeId: entry.id, owner: entry.owner,
      name: entry.parts?.join('｜') ?? entry.name, styleId: entry.styleId, action: 'inspect' })),
    positions: { [playerFlowCallCardId(ids.first)]: { x: 310, y: 125 }, [playerFlowCallCardId(ids.second)]: { x: 895, y: 125 } },
    groups: [{ id: ids.group, name: '保留的自定义结局组', nodeIds: [ids.c], collapsed: true,
      position: { x: 1190, y: 125 }, positions: { [ids.c]: { x: 155, y: 135 } } }],
  } };
  project.ui.components = [script, custom];
  project.scriptText = currentScriptText(projectToText(project));
  const normalized = projectSchema.parse(JSON.parse(JSON.stringify(project)));
  assert.equal(normalized.scriptText!.content, projectToText(normalized), 'Fixture source text must exactly describe its normalized story.');
  assert.equal(normalized.ui.components[0].list?.flowContent, undefined);
  const first = playerFlowCallCardId(ids.first), second = playerFlowCallCardId(ids.second);
  const nested = playerFlowCallCardId(ids.nested), recursive = playerFlowCallCardId(ids.recursive);
  return {
    project: normalized, entries: storyMenuEntries(normalized, 'flowchart'), originalScript: normalized.scriptText!.content,
    diagnostics: validateProject(normalized),
    rootIds: [ids.a, first, ids.b, second, ids.c], customRootIds: [ids.a, first, ids.b, second, ids.group],
    xIds: [ids.x, ids.xChoice, ids.xLeft, nested, ids.xAfter, ids.xRight, ids.xReturn],
    yIds: [ids.y, ids.yChoice, recursive, ids.yAfter, ids.yReturn],
    rootEdges: [[ids.a, first], [first, ids.b], [ids.b, second], [second, ids.c]],
    customRootEdges: [[ids.a, first], [first, ids.b], [ids.b, second], [second, ids.group]],
    xEdges: [[ids.x, ids.xChoice], [ids.xChoice, ids.xLeft], [ids.xChoice, ids.xRight], [ids.xLeft, nested],
      [nested, ids.xAfter], [ids.xAfter, ids.xReturn], [ids.xRight, ids.xReturn]],
    yEdges: [[ids.y, ids.yChoice], [ids.yChoice, recursive], [ids.yChoice, ids.yReturn], [recursive, ids.yAfter], [ids.yAfter, ids.yReturn]],
  };
}
