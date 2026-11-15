import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProject, effectiveUiComponents, type Project, type UiComponent } from '../src/core/model';
import { createBlueprintGraph, blueprintNodeDefaults } from '../src/core/blueprint';
import { blueprintCommandReference, renameBlueprint, resolveBlueprintCall } from '../src/core/blueprint-names';
import { projectContent, removeContentSelection, renameContent, createContentFolder, moveContent } from '../src/core/content-browser';
import { applyUiDraft } from '../src/core/ui-draft';
import { loadProject, saveProject } from '../src/desktop/project-store';
import { createUiResourceMigrationFixture } from '../scripts/lib/ui-resource-migration-fixture';

const image = (): UiComponent => ({ id: 'bound_image', page: 'preferences', kind: 'image', text: '', x: 0, y: 0, width: 1, height: 1 });
test('all un-deferred UI reference locations protect assets and deletion remains atomic', () => {
  const references: Record<string, (project: Project) => void> = {
    base: p => { p.ui.components = [{ ...image(), assetId: 'used' }]; },
    parent: p => { p.ui.instances = [{ id: 'parent', name: '原方案', components: [{ ...image(), assetId: 'used' }] }]; },
    derived: p => { p.ui.instances = [{ id: 'parent', name: '原方案', components: [image()] }, { id: 'derived', name: '派生方案', baseUiId: 'parent', components: [{ ...image(), assetId: 'used' }] }]; },
    videoPoster: p => { p.ui.components = [{ ...image(), kind: 'video', posterId: 'used' }]; },
    stateSkin: p => { p.ui.components = [{ ...image(), kind: 'button', skin: { idle: 'used' } }]; },
    pageBackground: p => { p.ui.customPages = [{ id: 'page', name: '页面', modal: true, backgroundId: 'used', components: [] }]; },
    schemePage: p => { p.ui.instances = [{ id: 'derived', name: '方案', components: [], pages: { preferences: { backgroundId: 'used' } } }]; },
    pageInput: p => { p.ui.pageInterfaces = { 'ui:preferences': { version: 1, inputs: [{ id: 'picture', name: '图片', dataType: 'asset', direction: 'input', required: false, defaultValue: 'used' }], outputs: [] } }; },
    graphInput: p => { const g = createBlueprintGraph('function', '公开素材'); g.exposedInputs = [{ id: 'picture', name: '图片', dataType: 'asset', direction: 'input', required: false, defaultValue: 'used' }]; p.blueprints.push(g); },
    graphProperty: p => { const g = createBlueprintGraph('function', '动态换图'), n = blueprintNodeDefaults('setUiProperty'); n.properties = { componentId: 'bound_image', property: 'imageAssetId', value: 'used' }; g.nodes.push(n); p.blueprints.push(g); p.ui.components = [image()]; },
    savedAction: p => { const g = createBlueprintGraph('function', '保存动作'), n = blueprintNodeDefaults('savedAction'); n.properties.action = JSON.stringify({ kind: 'background', assetId: 'used', transition: 'none' }); g.nodes.push(n); p.blueprints.push(g); },
  };
  for (const [name, apply] of Object.entries(references)) {
    const p = createProject(); p.assets.push({ id: 'used', name: '在用', kind: 'image', path: 'used.png' }, { id: 'unused', name: '闲置', kind: 'image', path: 'unused.png' }); apply(p);
    const folder = createContentFolder(p, '待删除')!; moveContent(p, ['asset:used', 'asset:unused'], folder);
    const before = structuredClone(p); assert.throws(() => removeContentSelection(p, ['folder:' + folder]), /仍被/, name); assert.deepEqual(p, before, name + ': no partial deletion');
  }
});
test('legacy named commands in effects, saved script text and scene-action nodes block graph deletion', () => {
  for (const command of ['@旧模块', '@稳定名', '@蓝图：稳定名', '@通用蓝图："稳定名"，数值=0', '@动作：@稳定名', '/场景蓝图：稳定名']) {
    for (const where of ['script', 'effect', 'node']) {
      const p = createProject(), g = createBlueprintGraph('function', '旧模块'); g.id = 'kept_module'; g.callName = '稳定名'; p.blueprints.push(g);
      if (where === 'script') p.scriptText = { format: 'vns-text-1', content: command };
      else if (where === 'effect') p.effects.push({ id: 'effect_owner', name: '外部演出', commands: [command] });
      else { const caller = createBlueprintGraph('function', '调用者'), n = blueprintNodeDefaults('sceneAction'); n.properties.command = command; caller.nodes.push(n); p.blueprints.push(caller); }
      const before = structuredClone(p); assert.equal(blueprintCommandReference(p.blueprints, command)?.id, g.id);
      assert.throws(() => removeContentSelection(p, ['blueprint:' + g.id]), /仍被/, where + ': ' + command); assert.deepEqual(p, before);
    }
  }
  const f = createUiResourceMigrationFixture(); assert.equal(blueprintCommandReference(f.project.blueprints, '旁白：@稳定调用'), undefined); assert.equal(blueprintCommandReference(f.project.blueprints, '// @稳定调用'), undefined);
  assert.equal(removeContentSelection(f.project, ['blueprint:' + f.module.id, 'blueprint:' + f.caller.id]), 2, 'Removing an entire caller/callee selection is allowed.');
});
test('renaming resources while UI drafts exist preserves stable references, call aliases, public pins and independent edits', () => {
  const f = createUiResourceMigrationFixture(), base = f.project, current = structuredClone(base), value = structuredClone(base);
  renameContent(current, projectContent(current).find(row => row.id === 'resource_used')!, '新图片名');
  renameBlueprint(current, f.module.id, { name: '新模块显示名' });
  value.blueprints.find(graph => graph.id === f.cases[2].graph.id)!.nodes.find(node => node.id === f.cases[2].event.id)!.name = '派生草稿点击';
  value.ui.instances![1].components.push({ ...f.controls[0], x: .37 });
  const merged = applyUiDraft(current, { base, value });
  assert.equal(merged.assets[0].id, 'resource_used'); assert.equal(merged.assets[0].name, '新图片名'); assert.equal(merged.assets[0].path, 'assets/used.png');
  assert.equal(resolveBlueprintCall(merged.blueprints, '稳定调用')?.id, f.module.id);
  assert.deepEqual(merged.blueprints.find(graph => graph.id === f.module.id)!.exposedInputs, f.module.exposedInputs);
  assert.equal(merged.blueprints.find(graph => graph.id === f.cases[2].graph.id)!.nodes.find(node => node.id === f.cases[2].event.id)!.name, '派生草稿点击');
  merged.ui.activeInstanceId = 'resource_derived'; assert.equal(effectiveUiComponents(merged.ui).find(component => component.id === 'resource_image')!.assetId, 'resource_used');
  const removed = structuredClone(current); removed.assets = []; const dangling = applyUiDraft(removed, { base, value });
  assert.equal(dangling.assets.length, 0, 'A draft must never recreate a deleted external resource.'); assert.equal(dangling.ui.instances![1].components[0].assetId, 'resource_used', 'Keep the broken stable reference visible for repair.');
});
test('resource rename/delete and derived edits survive whole-project save/reopen without replacing IDs', async t => {
  const parent = await fs.realpath(os.tmpdir()), directory = await fs.mkdtemp(path.join(parent, 'vns-ui-resource-migration-'));
  t.after(async () => { const target = await fs.realpath(directory), relative = path.relative(parent, target); assert.ok(relative.startsWith('vns-ui-resource-migration-') && !relative.includes(path.sep)); await fs.rm(target, { recursive: true, force: true }); });
  const f = createUiResourceMigrationFixture(), p = f.project, file = path.join(directory, 'project.vns.json');
  renameContent(p, projectContent(p).find(row => row.id === 'resource_used')!, '持久新名');
  removeContentSelection(p, ['asset:resource_unused']); p.ui.activeInstanceId = 'resource_derived';
  const saved = await saveProject(file, p), reopened = await loadProject(file);
  assert.deepEqual(reopened.project.ui, saved.project.ui); assert.deepEqual(reopened.project.blueprints, saved.project.blueprints);
  assert.deepEqual(reopened.project.assets.map(asset => [asset.id, asset.name, asset.path]), [['resource_used', '持久新名', 'assets/used.png']]);
  assert.equal(resolveBlueprintCall(reopened.project.blueprints, '稳定调用')?.id, f.module.id);
});
