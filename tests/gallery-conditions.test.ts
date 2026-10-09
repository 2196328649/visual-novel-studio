import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema, type Condition, type UiComponent } from '../src/core/model';
import { galleryEntries, galleryRuntimeEntries, galleryUnlockedAssets } from '../src/core/gallery';
import { galleryPreviewAction } from '../src/core/gallery-preview';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { linePreviewSnapshot } from '../src/core/line-preview';
import { validateProject } from '../src/core/validate';
import { compileProject } from '../src/runtime/compiler';
import { editTextDocument, refreshTextReferenceNames, textDocument } from '../src/core/text-document';

const progressCondition = (operator: 'gt' | 'gte' | 'lt', value: number): Condition => ({ kind: 'compare', variableId: 'progress', operator, value });
function fixture(initial = 0) {
  const project = createProject();
  project.parameterSets = [{ id: 'progress_set', name: '剧情进度', kind: 'story' }];
  project.variables.push({ id: 'progress', name: '章节进度', type: 'number', initial, persistent: true, parameterSetId: 'progress_set' });
  project.assets = ['a', 'b', 'c'].map(id => ({ id, name: id, kind: 'image', category: 'scene', path: 'assets/' + id + '.png' }));
  const component: UiComponent = { id: 'gallery', kind: 'galleryGrid', page: 'gallery', text: '', x: 0, y: 0, width: 1, height: 1, list: { galleryGroups: [{ id: 'group', name: '章节 CG', assetIds: ['a', 'b', 'c'], unlockWhen: progressCondition('gte', 2), variantUnlockWhen: { b: progressCondition('gt', 2) } }] } };
  project.ui.components.push(component);
  return { project, component };
}

test('parameter gallery conditions honor strict comparisons, group inheritance and variant overrides after save', () => {
  const { project, component } = fixture();
  const saved = projectSchema.parse(JSON.parse(JSON.stringify(project))), group = galleryEntries(saved, component)[0];
  assert.deepEqual(galleryUnlockedAssets(component, group, ['a', 'b', 'c'], { progress: 1 }), []);
  assert.deepEqual(galleryUnlockedAssets(component, group, [], { progress: 2 }), ['a', 'c']);
  assert.deepEqual(galleryUnlockedAssets(component, group, [], { progress: 3 }), ['a', 'b', 'c']);
  assert.deepEqual(galleryUnlockedAssets(component, group, []), []);
  const view = galleryPreviewAction(saved, component, { pages: {} }, { action: 'open', groupId: 'group' }, [], { progress: 2 });
  assert.deepEqual(view.detail?.assetIds, ['a', 'c']);
  const entries = galleryRuntimeEntries(saved, component);
  assert.equal(entries[0].variants[1].unlockWhen?.kind, 'compare');
  assert.deepEqual(validateProject(saved).filter(d => d.severity === 'error'), []);
});

test('flat galleries use parameter conditions per picture while unconfigured pictures keep seen unlocks', () => {
  const { project, component } = fixture();
  component.list = { assetIds: ['a', 'b'], galleryUnlockWhen: { a: progressCondition('gt', 2) } };
  const groups = galleryEntries(project, component);
  assert.deepEqual(groups.map(group => galleryUnlockedAssets(component, group, ['a', 'b'], { progress: 2 })), [[], ['b']]);
  assert.deepEqual(groups.map(group => galleryUnlockedAssets(component, group, [], { progress: 3 })), [['a'], []]);
});

test('large galleries with conditions compile as bounded source lines without duplicate authoring data', () => {
  const { project, component } = fixture();
  project.ui.pages = { gallery: { layout: 'custom' } };
  component.list!.galleryGroups = Array.from({ length: 256 }, (_, index) => ({
    id: 'group_' + index, name: '第 ' + index + ' 组', assetIds: ['a', 'b', 'c'], unlockWhen: progressCondition('gte', 2),
  }));
  const compiled = compileProject(project);
  assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), []);
  const screens = compiled.files['game/screens.rpy'];
  assert.doesNotMatch(screens, /"galleryGroups":/);
  assert.match(screens, /vn_gallery_options_gallery = \{\n/);
  assert.match(screens, /"variableId": "progress", "operator": "gte", "value": 2/);
  assert.ok(screens.split('\n').every(line => line.length < 8192));
});

test('conditional progress assignments advance once, retain higher progress and round-trip through text', () => {
  for (const initial of [0, 2, 5]) {
    const { project } = fixture(initial);
    const parsed = applyTextScript(project, '@设置：如果 章节进度 < 2，章节进度 = 2\n旁白：已经进入第2章。\n@返回标题界面');
    assert.deepEqual(parsed.issues, []);
    const passage = parsed.project.nodes.find(node => node.kind === 'passage')!;
    const selection = { nodeId: passage.id, lineId: passage.lines[0].id };
    assert.equal(linePreviewSnapshot(parsed.project, selection).context.variables.progress, Math.max(initial, 2));
    const saved = projectSchema.parse(parsed.project), restored = applyTextScript(saved, projectToText(saved));
    assert.deepEqual(restored.issues, []);
    assert.deepEqual(restored.project.nodes, parsed.project.nodes);
    const compiled = compileProject(restored.project);
    assert.deepEqual(compiled.diagnostics.filter(d => d.severity === 'error'), []);
    assert.match(compiled.files['game/story.rpy'], /if \(persistent\.vn_var_progress < 2\):\n        \$ persistent\.vn_var_progress = 2/);
    assert.match(compiled.files['game/screens.rpy'], /vn_gallery_unlocked\(variant\)/);
    assert.match(compiled.files['game/screens.rpy'], /"unlockWhen": \{"kind": "compare", "variableId": "progress", "operator": "gt", "value": 2\}/);
  }
});

test('missing and wrongly typed gallery parameters are reported at the owning component', () => {
  const { project, component } = fixture();
  component.list!.galleryGroups![0].unlockWhen = { kind: 'compare', variableId: 'missing', operator: 'gte', value: 2 };
  const error = validateProject(project).find(d => d.severity === 'error' && d.ui?.componentId === component.id);
  assert.ok(error);
  const invalid = applyTextScript(project, '@设置：如果 章节进度 > 是，章节进度 = 2');
  assert.equal(invalid.issues[0].sourceLine, 1);
  assert.match(invalid.issues[0].message, /类型不匹配/);
});

test('conditional assignments hide stable parameter references and retain them while editing thresholds', () => {
  const { project } = fixture();
  const source = '@设置：如果 章节进度【progress】 < 2，章节进度 = 2';
  const document = textDocument(source);
  assert.equal(document.text, '@设置：如果 章节进度 < 2，章节进度 = 2');
  const index = document.text.indexOf('< 2') + 2;
  const edited = editTextDocument(document, { start: index, end: index + 1, text: '3' });
  assert.equal(edited, source.replace('< 2', '< 3'));
  assert.deepEqual(applyTextScript(project, edited).issues, []);
  project.variables.find(variable => variable.id === 'progress')!.name = '最高章节进度';
  const renamed = refreshTextReferenceNames(project, source);
  assert.match(renamed, /如果 最高章节进度【progress】 < 2/);
  assert.equal(textDocument('@如果：章节进度【progress】 < 2，章节进度 = 2').text, '@如果：章节进度 < 2，章节进度 = 2');
  assert.equal(textDocument('@设置：如果 章节进度【progress】 < 2，记录 = "文本【literal】"').text, '@设置：如果 章节进度 < 2，记录 = "文本【literal】"');
});
