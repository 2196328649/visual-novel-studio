import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthoringIndexCache } from '../src/core/authoring-index';
import { allUiComponents, createProject, declaredUiComponents, uiComponentSchema, type Project } from '../src/core/model';
import { uiPageComponents } from '../src/core/ui-logic';
import { mutateProject } from '../src/core/project-mutation';
import { blueprintInputSource, blueprintNodeDefaults, blueprintNodeSummary, blueprintOutputLabel, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { BlueprintViewCache } from '../src/renderer/blueprint-view';

function fixture() {
  const project = createProject('索引缓存');
  const component = (id: string, page: 'say' | 'custom' = 'say') => uiComponentSchema.parse({ id, name: id, page, kind: 'button', x: 0, y: 0, width: .2, height: .1 });
  project.assets = [{ id: 'image', name: '画面', kind: 'image', path: 'assets/image.png' }, { id: 'sound', name: '声音', kind: 'audio', path: 'assets/sound.ogg' }];
  project.ui.components = [component('root'), { ...component('child'), parentId: 'root' }, component('kept')];
  project.ui.instances = [
    { id: 'original', name: '原方案', components: [{ ...component('kept'), name: '原方案按钮' }] },
    { id: 'derived', name: '派生方案', baseUiId: 'original', hiddenComponentIds: ['root'], components: [{ ...component('late_child'), parentId: 'root' }] },
  ];
  project.ui.customPages = [{ id: 'custom_page', name: '通用页面', modal: true, components: [component('custom_control', 'custom')] }];
  project.ui.activeInstanceId = 'derived';
  project.blueprints = [createBlueprintGraph('function', '索引调用')];
  return project;
}

test('indexed effective, declared, page and owner identities match uncached authoring semantics', () => {
  const project = fixture(), index = new AuthoringIndexCache({ assumeImmutable: true }).ui(project);
  assert.deepEqual(index.all, allUiComponents(project));
  assert.deepEqual([...index.declaredById.values()], declaredUiComponents(project));
  for (const page of ['ui:say', 'custom_page', 'ui:main', 'missing']) assert.deepEqual(index.byPage.get(page) ?? [], uiPageComponents(project, page));
  assert.equal(index.byId.get('root'), undefined); assert.equal(index.byId.get('child'), undefined); assert.equal(index.byId.get('late_child'), undefined);
  assert.equal(index.byId.get('kept')?.name, '原方案按钮');
  assert.equal(index.customPageByComponentId.get('custom_control'), project.ui.customPages[0]);
  assert.equal(index.customPageById.get('custom_page'), project.ui.customPages[0]);
});

test('graph, parameter and theme-only edits reuse both index axes instead of rescanning resources', () => {
  const project = fixture(), cache = new AuthoringIndexCache({ assumeImmutable: true });
  const ui = cache.ui(project), assets = cache.assets(project);
  const edited = mutateProject(project, draft => { draft.blueprints[0].nodes[0].x += 20; draft.ui.fontSize += 1; draft.name = '局部更新'; });
  assert.notEqual(edited, project); assert.notEqual(edited.ui, project.ui);
  for (let i = 0; i < 500; i++) { assert.equal(cache.ui(edited), ui); assert.equal(cache.assets(edited), assets); }
  assert.equal(cache.ui(project), ui); assert.equal(cache.assets(project), assets);
});

test('switching schemes and undoing edits reuses the exact appropriate inheritance index', () => {
  const project = fixture(), cache = new AuthoringIndexCache({ assumeImmutable: true }), derived = cache.ui(project);
  const base = mutateProject(project, draft => { delete draft.ui.activeInstanceId; }), original = mutateProject(base, draft => { draft.ui.activeInstanceId = 'original'; });
  assert.equal(cache.ui(base).byId.get('kept')?.name, 'kept'); assert.ok(cache.ui(base).byId.has('child'));
  assert.equal(cache.ui(original).byId.get('kept')?.name, '原方案按钮'); assert.ok(cache.ui(original).byId.has('root'));
  const restored = mutateProject(original, draft => { draft.ui.activeInstanceId = 'derived'; });
  assert.equal(cache.ui(restored), derived); assert.equal(cache.assets(restored), cache.assets(project));
  const broken = mutateProject(base, draft => { draft.ui.activeInstanceId = 'deleted_scheme'; });
  assert.equal(cache.ui(broken), cache.ui(base));
});

test('component, inheritance, page rename and page ownership changes invalidate UI but not assets', () => {
  let project = fixture(); const cache = new AuthoringIndexCache({ assumeImmutable: true }), assets = cache.assets(project);
  const changes: ((draft: Project) => void)[] = [
    draft => { draft.ui.instances![0].components[0].name = '改名'; },
    draft => { draft.ui.instances![1].hiddenComponentIds = []; },
    draft => { draft.ui.customPages[0].name = '重命名页面'; },
    draft => { draft.ui.customPages.push({ id: 'destination', name: '新归属', modal: false, components: draft.ui.customPages[0].components.splice(0, 1) }); },
    draft => { draft.ui.components[2].page = 'main'; },
    draft => { draft.ui.instances![1].baseUiId = undefined; },
  ];
  for (const change of changes) {
    const old = cache.ui(project); project = mutateProject(project, change);
    const current = cache.ui(project); assert.notEqual(current, old);
    assert.deepEqual(current.all, allUiComponents(project)); assert.equal(cache.assets(project), assets);
  }
  assert.equal(cache.ui(project).customPageByComponentId.get('custom_control')?.id, 'destination');
  assert.equal(cache.ui(project).byPage.get('ui:main')?.[0].id, 'kept');
});

test('asset rename, path/kind change and deletion replace only the asset index', () => {
  const project = fixture(), cache = new AuthoringIndexCache({ assumeImmutable: true }), assets = cache.assets(project), ui = cache.ui(project);
  assert.deepEqual(assets.byKind.get('image')?.map(asset => asset.id), ['image']);
  const renamed = mutateProject(project, draft => { Object.assign(draft.assets[0], { name: '新名称', path: 'assets/new.webm', kind: 'video' }); });
  const next = cache.assets(renamed); assert.notEqual(next, assets); assert.equal(cache.ui(renamed), ui);
  assert.equal(next.byId.get('image')?.name, '新名称'); assert.equal(next.byId.get('image')?.path, 'assets/new.webm');
  assert.equal(next.byKind.get('image'), undefined); assert.equal(next.byKind.get('video')?.[0], renamed.assets[0]);
  const removed = mutateProject(renamed, draft => { draft.assets.splice(0, 1); });
  assert.equal(cache.assets(removed).byId.has('image'), false); assert.equal(cache.assets(project), assets);
});

test('default mutable callers see in-place renames, additions, hiding and deletions', () => {
  const project = fixture(), cache = new AuthoringIndexCache(); cache.ui(project); cache.assets(project);
  project.assets[0] = { ...project.assets[0], name: '即时改名' };
  project.ui.instances![0].components[0] = { ...project.ui.instances![0].components[0], name: '即时按钮' };
  project.ui.instances![1].hiddenComponentIds = [];
  assert.equal(cache.assets(project).byId.get('image')?.name, '即时改名');
  assert.equal(cache.ui(project).byId.get('kept')?.name, '即时按钮'); assert.ok(cache.ui(project).byId.has('root'));
  project.ui.customPages[0].components.length = 0; project.assets.shift();
  assert.equal(cache.ui(project).byId.has('custom_control'), false); assert.equal(cache.assets(project).byId.has('image'), false);
});

test('indexed labels and connected source summaries remain equivalent before and after resource edits', () => {
  const project = fixture(), graph = project.blueprints[0], indexes = new AuthoringIndexCache({ assumeImmutable: true });
  const source = blueprintNodeDefaults('literal'); source.pins[0].dataType = 'component'; source.properties.value = 'kept';
  const property = blueprintNodeDefaults('getUiProperty'); property.properties.componentId = 'root';
  const image = blueprintNodeDefaults('showBackground'); image.properties.assetId = 'image';
  graph.nodes.push(source, property, image); synchronizeBlueprintSignatures(project);
  assert.equal(connectBlueprintPins(graph, source.id, 'value', property.id, 'componentId'), undefined);
  for (const current of [project, mutateProject(project, draft => { draft.assets[0].name = '新画面'; draft.ui.instances![0].components[0].name = '新控件'; })]) {
    const target = current.blueprints[0];
    for (const node of target.nodes) {
      assert.equal(blueprintNodeSummary(current, target, node, indexes), blueprintNodeSummary(current, target, node));
      for (const pin of node.pins.filter(pin => pin.direction === 'output')) assert.equal(blueprintOutputLabel(current, target, node, pin.id, indexes), blueprintOutputLabel(current, target, node, pin.id));
    }
    assert.deepEqual(blueprintInputSource(current, target, property.id, 'componentId', indexes), blueprintInputSource(current, target, property.id, 'componentId'));
  }
  const view = new BlueprintViewCache({ assumeImmutable: true }), edit = () => {}, toggle = () => {}, collapsed = new Set<string>();
  const first = view.update(project, graph, [], edit, collapsed, toggle);
  const changed = mutateProject(project, draft => { draft.assets[0].name = '缓存后的新画面'; });
  const second = view.update(changed, changed.blueprints[0], [], edit, collapsed, toggle);
  assert.equal(second[0].data, first[0].data); assert.equal(second.at(-1)?.data.summary, '缓存后的新画面');
});
