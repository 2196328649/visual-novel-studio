import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProject, editableUiComponent, effectiveUiComponents, projectSchema, type Diagnostic, type Project, type UiComponent } from '../src/core/model';
import { projectDraftSchema } from '../src/core/project-draft-schema';
import { applyUiDraft } from '../src/core/ui-draft';
import { duplicateUiSubtree } from '../src/core/ui-hierarchy';
import { createContentFolder, moveContent, removeContentSelection } from '../src/core/content-browser';
import { projectForExport } from '../src/core/export-assets';
import { validateProject } from '../src/core/validate';
import { autosaveProject, loadProject, parseProject, saveProject } from '../src/desktop/project-store';

const parts = ['chapter', 'caption', 'number', 'navigation', 'historyName', 'historyText'] as const;
const owners = ['base', 'derived', 'custom'] as const;
type Owner = typeof owners[number];
type TextStyles = NonNullable<NonNullable<UiComponent['list']>['textStyles']>;

function install(project: Project, owner: Owner, textStyles?: TextStyles) {
  // A custom panel can retain temporarily inapplicable list settings; resource
  // safety must still see them instead of silently clearing authored data.
  const component: UiComponent = {
    id: `list_${owner}`, kind: owner === 'custom' ? 'panel' : 'saveSlots', page: owner === 'custom' ? 'custom' : 'save',
    text: '', x: .1, y: .1, width: .8, height: .7,
    list: textStyles ? { textStyles } : {},
  };
  const location: NonNullable<Diagnostic['ui']> = { page: component.page, componentId: component.id };
  if (owner === 'base') project.ui.components = [component];
  else if (owner === 'derived') {
    project.ui.instances = [{ id: 'parent_scheme', name: '父方案', components: [] }, {
      id: 'derived_scheme', name: '派生方案', baseUiId: 'parent_scheme', components: [component],
    }];
    location.instanceId = 'derived_scheme';
  } else {
    project.ui.customPages = [{ id: 'custom_page', name: '自定义页面', modal: true, components: [component] }];
    location.customPageId = 'custom_page';
  }
  return { component, location };
}

function fixture() {
  const project = createProject('列表部件字体保存');
  project.assets.push({ id: 'legacy_font', name: '旧分页字体', kind: 'font', path: 'assets/legacy.ttf' });
  for (const owner of owners) {
    const styles: TextStyles = {};
    for (const [index, part] of parts.entries()) {
      const id = `font_${owner}_${part.toLowerCase()}`;
      project.assets.push({ id, name: id, kind: 'font', path: `assets/${id}.ttf` });
      styles[part] = { fontAssetId: id, fontSize: 24 + index, textColor: '#5273b9', align: index % 2 ? 'right' : 'center' };
    }
    const { component } = install(project, owner, styles);
    Object.assign(component.list!, { summaryFontSize: 19, pageFontAssetId: 'legacy_font', pageFontSize: 21, historyNameFontSize: 29, numberTextColor: '#123456' });
  }
  return project;
}

test('list text styles survive project, draft and migration parsing without replacing legacy fallbacks', () => {
  const project = fixture(), before = structuredClone(project.ui);
  for (const parsed of [projectSchema.parse(project), projectDraftSchema.parse(project), parseProject(JSON.parse(JSON.stringify(project))).project]) {
    assert.deepEqual(parsed.ui, before);
  }
  assert.deepEqual(project.ui, before);

  const legacy = createProject();
  const { component } = install(legacy, 'base');
  component.list = { summaryFontSize: 17, pageFontSize: 20, pageFontAssetId: 'legacy_font', historyNameFontSize: 26 };
  const parsed = parseProject(legacy).project.ui.components[0];
  assert.deepEqual(parsed.list, component.list, 'opening older data does not synthesize overrides that mask later defaults');
  assert.equal(parsed.list!.textStyles, undefined);

  const sparse = createProject(); install(sparse, 'base', { caption: { fontSize: 37 } });
  assert.deepEqual(projectSchema.parse(sparse).ui.components[0].list!.textStyles, { caption: { fontSize: 37 } });
});

test('every list text font is validated and locates its base, derived or custom owner', () => {
  for (const owner of owners) for (const part of parts) for (const kind of ['missing', 'image', 'font'] as const) {
    const project = createProject(), { location } = install(project, owner, { [part]: { fontAssetId: 'part_font' } });
    if (kind !== 'missing') project.assets.push({ id: 'part_font', name: '部件字体', kind, path: `assets/part.${kind === 'font' ? 'ttf' : 'png'}` });
    const diagnostics = validateProject(project).filter(item => item.message.startsWith('素材不存在或格式不匹配：'));
    assert.equal(diagnostics.length, kind === 'font' ? 0 : 1, `${owner}/${part}/${kind}`);
    if (kind !== 'font') {
      assert.equal(diagnostics[0].severity, 'error');
      assert.deepEqual(diagnostics[0].ui, location);
      assert.match(diagnostics[0].help!, /定位控件/);
    }
  }
});

test('fonts referenced only by list parts block atomic folder deletion until their overrides are cleared', () => {
  for (const owner of owners) for (const part of parts) {
    const project = createProject(), { component } = install(project, owner, { [part]: { fontAssetId: 'used_font', fontSize: 37 } });
    project.assets = [
      { id: 'used_font', name: '在用字体', kind: 'font', path: 'assets/used.ttf' },
      { id: 'spare_font', name: '闲置字体', kind: 'font', path: 'assets/spare.ttf' },
    ];
    const folder = createContentFolder(project, '部件字体')!;
    moveContent(project, ['asset:used_font', 'asset:spare_font'], folder);
    const before = structuredClone(project);
    assert.throws(() => removeContentSelection(project, ['folder:' + folder]), /仍被.*在用字体/, `${owner}/${part}`);
    assert.deepEqual(project, before, 'no partial removal of the unreferenced sibling');
    delete component.list!.textStyles![part]!.fontAssetId;
    assert.equal(removeContentSelection(project, ['folder:' + folder]), 2);
    assert.equal(component.list!.textStyles![part]!.fontSize, 37, 'clearing a resource reference preserves other style fields');
  }
});

test('release selection keeps all list-part fonts, including dormant schemes, and removes unrelated fonts', () => {
  const project = fixture();
  project.assets.push({ id: 'unused_font', name: '未用字体', kind: 'font', path: 'assets/unused.ttf' });
  assert.equal(project.ui.activeInstanceId, undefined, 'the derived scheme is not active');
  const before = structuredClone(project), selected = projectForExport(project);
  assert.deepEqual(selected.assets.map(asset => asset.id), project.assets.filter(asset => asset.id !== 'unused_font').map(asset => asset.id));
  assert.deepEqual(selected.ui, project.ui);
  assert.deepEqual(project, before);
});

test('subtree copies and first inherited edits detach nested list styles while preserving font identities', () => {
  const project = fixture(), original = project.ui.components[0], before = structuredClone(original.list);
  const [copy] = duplicateUiSubtree(project.ui.components, original.id, () => 'copied_list');
  assert.deepEqual(copy.list, original.list);
  copy.list!.textStyles!.caption!.fontSize = 43;
  assert.deepEqual(original.list, before);
  assert.equal(copy.list!.textStyles!.caption!.fontAssetId, original.list!.textStyles!.caption!.fontAssetId);

  project.ui.instances = [{ id: 'local_scheme', name: '本地方案', components: [] }];
  project.ui.activeInstanceId = 'local_scheme';
  const local = editableUiComponent(project.ui, original.id)!;
  assert.deepEqual(local.list, original.list);
  local.list!.textStyles!.chapter!.fontSize = 51;
  assert.deepEqual(original.list, before);
  assert.equal(effectiveUiComponents(project.ui)[0].list!.textStyles!.chapter!.fontSize, 51);
  assert.deepEqual(effectiveUiComponents({ ...project.ui, activeInstanceId: undefined })[0].list, before);
});

test('UI draft merging preserves independent part edits and external font metadata changes', () => {
  const base = fixture(), current = structuredClone(base), value = structuredClone(base);
  current.ui.components[0].list!.textStyles!.chapter!.fontSize = 44;
  current.assets.find(asset => asset.id === 'font_base_caption')!.name = '已重命名的摘要字体';
  value.ui.components[0].list!.textStyles!.caption!.textColor = '#f1e2d3';
  delete value.ui.components[0].list!.textStyles!.navigation!.fontAssetId;
  const merged = applyUiDraft(current, { base, value });
  assert.equal(merged.ui.components[0].list!.textStyles!.chapter!.fontSize, 44);
  assert.equal(merged.ui.components[0].list!.textStyles!.caption!.textColor, '#f1e2d3');
  assert.equal(merged.ui.components[0].list!.textStyles!.navigation!.fontAssetId, undefined);
  assert.equal(merged.ui.components[0].list!.pageFontAssetId, 'legacy_font');
  assert.equal(merged.assets.find(asset => asset.id === 'font_base_caption')!.name, '已重命名的摘要字体');
});

test('save-as, folder relocation, reopen and crash-recovery drafts preserve list text fonts and style values', async t => {
  const parent = await fs.realpath(os.tmpdir()), directory = await fs.mkdtemp(path.join(parent, 'vns-list-text-'));
  t.after(async () => {
    const target = await fs.realpath(directory), relative = path.relative(parent, target);
    assert.ok(relative.startsWith('vns-list-text-') && !relative.includes(path.sep));
    await fs.rm(target, { recursive: true, force: true });
  });
  const project = fixture(), before = structuredClone(project), source = path.join(directory, 'source'), destination = path.join(directory, 'copy');
  await fs.mkdir(path.join(source, 'assets'), { recursive: true });
  for (const asset of project.assets) await fs.writeFile(path.join(source, asset.path), `font-fixture:${asset.id}`);
  const sourceFile = path.join(source, 'project.vns.json'), file = path.join(destination, 'project.vns.json');
  const saved = await saveProject(sourceFile, project);
  assert.deepEqual(project, before, 'saving does not mutate the editor snapshot');
  assert.deepEqual(saved.project.ui, project.ui);
  assert.ok(saved.project.assets.every(asset => asset.path.startsWith('assets/字体/')), 'resource layout moves files while their stable IDs remain in each part');
  const sourceBytes = await fs.readFile(sourceFile);
  const copied = await saveProject(file, saved.project, source), reopened = await loadProject(file);
  assert.deepEqual(copied.project.ui, project.ui);
  assert.deepEqual(reopened.project.ui, project.ui);
  for (const asset of reopened.project.assets) assert.equal(await fs.readFile(path.join(destination, asset.path), 'utf8'), `font-fixture:${asset.id}`);

  const draft = structuredClone(reopened.project);
  draft.ui.customPages[0].components[0].list!.textStyles!.historyText!.fontSize = 39;
  draft.ui.instances![1].components[0].list!.textStyles!.caption!.align = 'left';
  await fs.utimes(file, new Date(0), new Date(0));
  await autosaveProject(file, reopened.project, true, { uiDraft: draft, projectDirty: false });
  const recovered = await loadProject(file);
  assert.equal(recovered.recovered, true);
  assert.deepEqual(recovered.project.ui, reopened.project.ui);
  assert.deepEqual(recovered.uiDraft!.ui, draft.ui);
  assert.deepEqual(await fs.readFile(sourceFile), sourceBytes, 'save-as and recovery leave the source project intact');
});
