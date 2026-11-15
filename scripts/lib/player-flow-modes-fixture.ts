import assert from 'node:assert/strict';
import { createProject, projectSchema, type Project, type StoryNode, type UiComponent } from '../../src/core/model';
import type { PlayerFlowContent } from '../../src/core/player-flow-content';
import { applyTextScript, projectToText } from '../../src/core/text-script';
import { storyMenuEntries, type StoryMenuEntry } from '../../src/core/story-menu';
import { storyFlowLayout } from '../../src/core/story-flow';

export const playerFlowModesIds = {
  copy: 'flow_modes_copy',
  empty: 'flow_modes_empty',
  repair: 'flow_modes_repair',
  missingNode: 'flow_modes_removed_node',
  missingOwner: 'flow_modes_removed_owner',
  choice: 'flow_modes_choice',
  firstPreset: 'flow_modes_main_style',
  secondPreset: 'flow_modes_alt_style',
  inherited: 'flow_modes_inherited',
  parentScheme: 'flow_modes_parent_scheme',
  activeScheme: 'flow_modes_active_scheme',
  project: 'flow_modes_acceptance',
} as const;

export interface PlayerFlowModesFixture {
  project: Project;
  entries: StoryMenuEntry[];
  first: StoryMenuEntry;
  second: StoryMenuEntry;
  third: StoryMenuEntry;
  fourth: StoryMenuEntry;
  fifth: StoryMenuEntry;
  paragraph: StoryMenuEntry;
  originalScript: string;
  expectedLegacyLayout: ReturnType<typeof storyFlowLayout>;
}

const map = (id: string, name: string, x: number, flowContent?: PlayerFlowContent, y = .04, height = .88): UiComponent => ({
  id, name, kind: 'flowchart', page: 'flowchart', text: '', x, y, width: .3, height,
  list: { layout: 'flow', itemWidth: 286, itemHeight: 72, gapX: 54, gapY: 42, flowShowControls: false, flowShowVerticalScrollbar: false,
    ...(flowContent ? { flowContent } : {}) },
  style: { fontSize: 28, textColor: '#edf2ed', background: '#263b3a', borderWidth: 1, borderColor: '#79958b', radius: 4 },
});

function setNext(node: StoryNode, next: string): StoryNode {
  assert.ok(node.kind === 'start' || node.kind === 'passage' || node.kind === 'set' || node.kind === 'call', `Expected a next-bearing entry node, received ${node.kind}.`);
  return { ...node, next };
}

export function createPlayerFlowModesFixture(): PlayerFlowModesFixture {
  const parsed = applyTextScript(createProject('玩家剧情图双模式验收'), [
    '#章节：第一章',
    '#小章节(流程图=是)：天台入口',
    '旁白：风从旧城的屋檐间吹过。',
    '#段落(流程图=是)：做出选择',
    '旁白：要沿着哪条路继续？',
    '#章节：第二章',
    '#小章节(流程图=是)：回廊入口',
    '旁白：回廊尽头亮着一盏灯。',
    '#章节：第三章',
    '#小章节(流程图=是)：旧书库入口',
    '旁白：尘埃落在摊开的书页上。',
    '#章节：第四章',
    '#小章节(流程图=是)：河岸入口',
    '旁白：河水把夜色带向远处。',
    '#章节：第五章',
    '#小章节(流程图=是)：归途入口',
    '旁白：天亮前还有一段路。',
  ].join('\n'));
  assert.deepEqual(parsed.issues, []);

  const project = parsed.project;
  project.id = playerFlowModesIds.project;
  project.width = 1920;
  project.height = 1080;
  project.resourceSettings = { importMode: 'copy', directory: 'assets', syncFolders: false };
  project.ui.pages = { ...project.ui.pages, flowchart: { layout: 'custom', background: '#192321' } };
  project.ui.flowStyles = [
    { id: playerFlowModesIds.firstPreset, name: '旧工程主线', style: { fontSize: 36, background: '#284b49', textColor: '#eff7f1' } },
    { id: playerFlowModesIds.secondPreset, name: '旧工程支线', style: { fontSize: 30, background: '#4b3b2d', textColor: '#f6e9d4' } },
  ];

  const entries = storyMenuEntries(project, 'flowchart');
  assert.ok(entries.length >= 6, 'Fixture needs multiple chapter, scene, and paragraph entries.');
  const chapterEntries = entries.filter(entry => entry.owner?.kind !== 'node');
  const paragraph = entries.find(entry => entry.owner?.kind === 'node');
  const [first, second, third, fourth, fifth] = chapterEntries;
  assert.ok(first && second && third && fourth && fifth && paragraph);
  assert.equal(paragraph.owner?.kind, 'node');

  for (const [entry, styleId] of [[first, playerFlowModesIds.firstPreset], [second, playerFlowModesIds.secondPreset], [third, playerFlowModesIds.firstPreset]] as const) {
    const owner = entry.owner?.kind === 'chapter' ? project.chapters.find(item => item.id === entry.owner!.id)
      : entry.owner?.kind === 'scene' ? project.scenes.find(item => item.id === entry.owner!.id)
      : entry.owner?.kind === 'node' ? project.nodes.find(item => item.id === entry.owner!.id) : undefined;
    assert.ok(owner);
    owner.flowchart = { ...owner.flowchart, styleId };
  }
  if (paragraph.owner?.kind !== 'node') throw new Error('Fixture paragraph must have a node owner.');
  const paragraphOwner = project.nodes.find(item => item.id === paragraph.owner!.id)!;
  paragraphOwner.flowchart = { ...paragraphOwner.flowchart, name: '被原工程保留的段落', styleId: playerFlowModesIds.secondPreset };

  const firstNode = project.nodes.find(node => node.id === first.id)!;
  const branch: StoryNode = { id: playerFlowModesIds.choice, sceneId: firstNode.sceneId, name: '真实剧情分支', x: 0, y: 0,
    kind: 'choice', textHeading: false, prompt: '继续前往哪里？', choices: [
      { id: 'flow_modes_left', text: '去回廊', target: second.id },
      { id: 'flow_modes_right', text: '去书库', target: third.id },
    ] };
  project.nodes = project.nodes.map(node => node.id === first.id ? setNext(node, playerFlowModesIds.choice) : node);
  project.nodes = project.nodes.map(node => node.id === second.id ? setNext(node, fourth.id) : node);
  project.nodes.push(branch);
  project.entryId = first.id;

  project.ui.components = [
    map(playerFlowModesIds.copy, '旧版剧情图 · 复制', .02),
    map(playerFlowModesIds.empty, '旧版剧情图 · 空图', .35),
    map(playerFlowModesIds.repair, '旧自定义图 · 缺失入口', .68, {
      mode: 'custom',
      custom: { entries: [
        { nodeId: playerFlowModesIds.missingNode, owner: { kind: 'node', id: playerFlowModesIds.missingOwner }, name: '保留的孤立剧情', styleId: playerFlowModesIds.secondPreset, action: 'inspect' },
        { nodeId: fifth.id, owner: { kind: 'node', id: playerFlowModesIds.missingOwner }, name: '保留的缺失来源', styleId: playerFlowModesIds.firstPreset, action: 'replay' },
      ], positions: {
        [playerFlowModesIds.missingNode]: { x: 840, y: 320 },
        [fifth.id]: { x: 1040, y: 480 },
      } },
    }),
    map(playerFlowModesIds.inherited, '基础方案原始剧情图', .02, undefined, .52, .42),
  ];
  project.ui.instances = [
    { id: playerFlowModesIds.parentScheme, name: '父级界面方案', components: [map(playerFlowModesIds.inherited, '父方案剧情图', .02, undefined, .52, .42)] },
    { id: playerFlowModesIds.activeScheme, name: '活动派生方案', baseUiId: playerFlowModesIds.parentScheme, components: [] },
  ];
  assert.equal(project.ui.components[0].list?.flowContent, undefined, 'The legacy copy fixture must omit the new property.');
  assert.equal(project.ui.components[1].list?.flowContent, undefined, 'The legacy empty fixture must omit the new property.');

  project.scriptText!.content = projectToText(project);
  const normalized = projectSchema.parse(JSON.parse(JSON.stringify(project)));
  const normalizedEntries = storyMenuEntries(normalized, 'flowchart');
  const normalizedFirst = normalizedEntries.find(entry => entry.id === first.id)!;
  const originalScript = normalized.scriptText!.content;
  return {
    project: normalized,
    entries: normalizedEntries,
    first: normalizedFirst,
    second: normalizedEntries.find(entry => entry.id === second.id)!,
    third: normalizedEntries.find(entry => entry.id === third.id)!,
    fourth: normalizedEntries.find(entry => entry.id === fourth.id)!,
    fifth: normalizedEntries.find(entry => entry.id === fifth.id)!,
    paragraph: normalizedEntries.find(entry => entry.id === paragraph.id)!,
    originalScript,
    expectedLegacyLayout: storyFlowLayout(normalized, normalized.ui.components[0]),
  };
}
