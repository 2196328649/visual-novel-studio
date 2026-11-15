import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject, projectSchema, type UiComponent } from '../src/core/model';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { editTextDocument, refreshTextReferenceNames, textDocument } from '../src/core/text-document';
import { textAssistance } from '../src/core/text-completion';
import { storyMenuEntries } from '../src/core/story-menu';
import { storyFlowLayout } from '../src/core/story-flow';
import { editPlayerFlowEntry } from '../src/core/player-flow-authoring';
import { flowNodeAppearance, flowStyleUsages, renameFlowStyleReferences } from '../src/core/flow-style';
import { compileProject } from '../src/runtime/compiler';
import { pythonLiteral } from '../src/runtime/literals';

const component: UiComponent = { id: 'flow', page: 'flowchart', kind: 'flowchart', text: '', x: 0, y: 0, width: 1, height: 1, list: { layout: 'flow' } };
function fixture() {
  const p = createProject();
  p.ui.flowStyles = [{ id: 'main_style', name: '主线框', style: { textColor: '#ffffff', background: '#555555', shadowBlur: 7, shadowOpacity: .4 } }, { id: 'memory_style', name: '回忆，旧事', style: { textColor: '#ccccee', background: '#776688' } }];
  p.ui.components.push(component); return p;
}
test('named styles survive parsing, hidden references, chapter renaming and save/reopen', () => {
  const parsed = applyTextScript(fixture(), '#章节(样式=主线框):归\n旁白：开头\n#小章节(流程图=是，样式="回忆，旧事"):旧事\n旁白：回忆');
  assert.deepEqual(parsed.issues, []);
  const p = projectSchema.parse(JSON.parse(JSON.stringify(parsed.project))), raw = projectToText(p), doc = textDocument(raw);
  assert.equal(p.chapters[0].flowchart?.styleId, 'main_style');
  assert.ok(raw.includes('主线框【main_style】')); assert.ok(!doc.text.includes('【main_style】'));
  const offset = doc.text.indexOf('旧事\n');
  const changed = editTextDocument(doc, { start: offset, end: offset + 2, text: '往事' });
  const reopened = applyTextScript(p, changed); assert.deepEqual(reopened.issues, []);
  assert.deepEqual(storyMenuEntries(p, 'flowchart').map(e => e.styleId), ['main_style', 'memory_style']);
  assert.deepEqual(storyFlowLayout(reopened.project, component).nodes.map(n => n.styleId), ['main_style', 'memory_style']);
  p.ui.flowStyles![0].name = '主线';
  const renamed = refreshTextReferenceNames(p, raw);
  assert.ok(renamed.includes('主线【main_style】'));
  assert.deepEqual(applyTextScript(p, renamed).issues, []);
});

test('heading completion offers style names, IDs and searchable Chinese parameters', () => {
  const p = fixture(), source = '#章节(样式=zhux):归', at = source.indexOf(')');
  const result = textAssistance(p, source, at, true)!;
  assert.equal(result.items[0].label, '主线框'); assert.ok(result.items[0].insertText.includes('main_style'));
  const empty = '#章节()：归';
  assert.ok(textAssistance(p, empty, empty.indexOf(')'), true)!.items.some(item => item.label === '样式'));
});

test('renaming a manually typed style protects quotes and leaves narrative text intact', () => {
  const p = fixture(), source = '#章节(样式=主线框):归\n旁白：主线框';
  p.ui.flowStyles![0].name = '主线 "返乡"，归';
  const changed = renameFlowStyleReferences(source, 'main_style', '主线框', p.ui.flowStyles![0].name);
  const refreshed = refreshTextReferenceNames(p, changed);
  const result = applyTextScript(p, refreshed);
  assert.deepEqual(result.issues, []); assert.equal(result.project.chapters[0].flowchart?.styleId, 'main_style');
  assert.ok(refreshed.endsWith('旁白：主线框'));
});

test('missing or ambiguous styles are diagnosed and same-entry scene overrides stay coherent', () => {
  const p = fixture();
  for (const value of ['不存在', '12', '主线框【missing】']) assert.equal(applyTextScript(p, `#章节(样式=${value}):归\n旁白：正文`).issues.length, 1);
  p.ui.flowStyles!.push({ id: 'duplicate', name: '主线框' });
  assert.equal(projectSchema.safeParse(p).success, false);
  assert.equal(applyTextScript(p, '#章节(样式=主线框):归\n旁白：正文').issues.length, 1);
  p.ui.flowStyles!.pop();
  const parsed = applyTextScript(p, '#章节(样式=主线框):归\n#小章节(流程图=是):旧事\n旁白：正文');
  assert.deepEqual(parsed.issues, []);
  assert.equal(storyMenuEntries(parsed.project, 'flowchart')[0].styleId, undefined);
});

test('shared style changes reach every matching entry and compile with state colors and native text effects', () => {
  const parsed = applyTextScript(fixture(), '#章节(样式=主线框):归\n旁白：开头\n#章节(样式=主线框):离\n旁白：结尾');
  parsed.project.ui.flowStyles![0].style = { textColor: '#aabbcc', disabledTextColor: '#333333', hoverBackground: '#223344', borderWidth: 2, borderColor: '#888888', shadowBlur: 7, shadowOpacity: .4 };
  const graph = storyFlowLayout(parsed.project, component);
  assert.ok(graph.nodes.every(node => flowNodeAppearance(parsed.project, component, node).style?.textColor === '#aabbcc'));
  const compiled = compileProject(parsed.project);
  assert.deepEqual(compiled.diagnostics.filter(d => d.severity === 'error'), []);
  assert.ok(compiled.files['game/screens.rpy'].includes('"flowLooks"'));
  assert.ok(compiled.files['game/screens.rpy'].includes('#aabbcc'));
});

test('flow node letter spacing reaches map and directory markup, including explicit zero', () => {
  const p = fixture();
  const component = p.ui.components[0]!;
  p.ui.components[0] = { ...component, style: { letterSpacing: -4, captionParts: [{ letterSpacing: 1 }, {}] } };
  p.ui.flowStyles![0].style = { letterSpacing: 2.5, captionParts: [{ letterSpacing: 0 }, { letterSpacing: -1.25 }] };
  const parsed = applyTextScript(p, '#章节(样式=主线框):归\n旁白：开头');
  assert.deepEqual(parsed.issues, []);
  const project = parsed.project;
  const look = flowNodeAppearance(project, project.ui.components[0]!, { kind: 'passage', styleId: 'main_style' });
  assert.equal(look.style?.letterSpacing, 2.5);
  assert.deepEqual(look.style?.captionParts?.map(part => part.letterSpacing), [0, -1.25]);

  const screens = compileProject(project).files['game/screens.rpy'];
  const flowEntry = storyMenuEntries(project, 'flowchart').find(entry => entry.styleId === 'main_style')!;
  const flowLooksStart = screens.indexOf('"flowLooks": {');
  const flowGraphStart = screens.indexOf(', "flowGraph": ', flowLooksStart);
  assert.ok(flowLooksStart >= 0 && flowGraphStart > flowLooksStart);
  const flowLooks = screens.slice(flowLooksStart, flowGraphStart);
  assert.ok(flowLooks.includes(`${pythonLiteral(flowEntry.id)}: {"node": `));
  assert.ok(flowLooks.includes(`"style": ${pythonLiteral(look.style)}`));
  const captionParts = look.style?.captionParts?.map(part => Object.fromEntries(Object.entries({
    size: part.fontSize,
    color: part.color,
    gap: part.gap,
    letterSpacing: part.letterSpacing,
  }).filter(([, value]) => value !== undefined)));
  assert.ok(flowLooks.includes(`"captionParts": ${pythonLiteral(captionParts)}`));
});

test('style usages include base, overridden, inactive, custom-page, and sleeping local references', () => {
  const project = fixture(), flow = project.ui.components[0]!, nodeId = project.nodes[0]!.id;
  project.chapters[0]!.flowchart = { styleId: 'main_style' };
  project.scenes[0]!.flowchart = { styleId: 'main_style' };
  project.nodes[0]!.flowchart = { styleId: 'main_style' };
  const withEntry = (id: string, name: string, mode: 'custom' | 'script' = 'custom'): UiComponent => ({
    ...component,
    id,
    list: { layout: 'flow', flowContent: { mode, custom: { entries: [{ nodeId, name, styleId: 'main_style' }] } } },
  });
  flow.list!.flowContent = { mode: 'custom', custom: { entries: [
    { nodeId, owner: { kind: 'node', id: nodeId }, name: '当前自定义标题', styleId: 'main_style' },
  ] } };
  project.ui.components.push({ ...component, id: 'flow_sleeping', list: { layout: 'flow', flowContent: { mode: 'script', custom: { entries: [
    { nodeId: 'missing_node', name: '休眠自定义标题', styleId: 'main_style' },
  ] } } } });
  const active = withEntry('flow', '覆盖方案标题');
  const inactive = withEntry('flow', '未激活标题');
  const customPage = withEntry('flow', '自定义页标题');
  project.ui.instances = [
    { id: 'active_scheme', name: '当前方案', components: [active] },
    { id: 'inactive_scheme', name: '未激活方案', components: [inactive] },
  ];
  project.ui.activeInstanceId = 'active_scheme';
  project.ui.customPages = [{ id: 'custom_page', name: '附加页', components: [customPage], modal: true }];

  const usages = flowStyleUsages(project, 'main_style');
  const custom = usages.filter(item => 'componentId' in item);

  assert.equal(usages.length, 8, 'chapter, scene and node metadata counts remain intact alongside five local references');
  assert.equal(custom.length, 5, 'base, active override, inactive scheme, custom page, and dormant entries all protect their saved style');
  assert.deepEqual(custom.map(item => item.id), [
    `theme:${project.id}:flow:${nodeId}`,
    `theme:${project.id}:flow_sleeping:missing_node`,
    `instance:active_scheme:flow:${nodeId}`,
    `instance:inactive_scheme:flow:${nodeId}`,
    `customPage:custom_page:flow:${nodeId}`,
  ]);
  assert.deepEqual(custom.map(item => item.name), [
    '基础方案 · flow · 当前自定义标题',
    '基础方案 · flow_sleeping · 休眠自定义标题',
    '当前方案 · flow · 覆盖方案标题',
    '未激活方案 · flow · 未激活标题',
    '附加页 · flow · 自定义页标题',
  ]);
  assert.deepEqual(custom.map(item => item.container), [
    { kind: 'theme', id: project.id },
    { kind: 'theme', id: project.id },
    { kind: 'instance', id: 'active_scheme' },
    { kind: 'instance', id: 'inactive_scheme' },
    { kind: 'customPage', id: 'custom_page' },
  ]);
  assert.equal(usages.filter(item => !('componentId' in item)).length, 3, 'metadata refs are not duplicated by custom controls');

  project.ui.flowStyles![0].name = '改名预设';
  assert.equal(flowStyleUsages(project, 'main_style').length, 8, 'renaming keeps references keyed by stable styleId');
  assert.equal(editPlayerFlowEntry(flow, nodeId, { styleId: undefined }), true);
  const sleeping = project.ui.components.at(-1)!;
  assert.equal(editPlayerFlowEntry(sleeping, 'missing_node', { styleId: undefined }), true, 'inactive custom entries can still clear their saved preset');
  assert.equal(editPlayerFlowEntry(active, nodeId, { styleId: undefined }), true, 'overrides retain independent local references');
  assert.equal(editPlayerFlowEntry(inactive, nodeId, { styleId: undefined }), true, 'inactive schemes retain independent local references');
  assert.equal(editPlayerFlowEntry(customPage, nodeId, { styleId: undefined }), true, 'custom pages retain independent local references');
  assert.equal(flowStyleUsages(project, 'main_style').length, 3);
  delete project.chapters[0]!.flowchart!.styleId;
  delete project.scenes[0]!.flowchart!.styleId;
  delete project.nodes[0]!.flowchart!.styleId;
  assert.deepEqual(flowStyleUsages(project, 'main_style'), [], 'after every exact reference is cleared the preset is removable');
});
