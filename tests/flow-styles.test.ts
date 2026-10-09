import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject, projectSchema, type UiComponent } from '../src/core/model';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { editTextDocument, refreshTextReferenceNames, textDocument } from '../src/core/text-document';
import { textAssistance } from '../src/core/text-completion';
import { storyMenuEntries } from '../src/core/story-menu';
import { storyFlowLayout } from '../src/core/story-flow';
import { flowNodeAppearance, renameFlowStyleReferences } from '../src/core/flow-style';
import { compileProject } from '../src/runtime/compiler';

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
