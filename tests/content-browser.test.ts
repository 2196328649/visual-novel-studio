import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema } from '../src/core/model';
import { createBlueprintGraph } from '../src/core/blueprint';
import { contentState, createContentFolder, folderTrail, moveContent, moveContentFolder, moveContentSelection, projectContent, removeContentFolder, removeContentSelection, renameContent } from '../src/core/content-browser';

test('content organization persists without changing resource identities, physical paths or blueprint references', () => {
  const project = createProject();
  project.assets.push({ id: 'shared', name: '方院', kind: 'image', path: 'assets/scene.png' });
  const graph = createBlueprintGraph('function', '换景'); graph.id = 'shared'; project.blueprints.push(graph);
  const root = createContentFolder(project, '场景')!, child = createContentFolder(project, '第一章', root)!;
  moveContent(project, ['asset:shared'], child); moveContent(project, ['blueprint:shared'], root);
  contentState(project).favorites = ['asset:shared', 'blueprint:shared'];
  renameContent(project, projectContent(project).find(item => item.key === 'asset:shared')!, '雨中方院');
  const reopened = projectSchema.parse(JSON.parse(JSON.stringify(project)));
  assert.equal(reopened.assets[0].path, 'assets/scene.png');
  assert.equal(reopened.assets[0].id, 'shared'); assert.equal(reopened.assets[0].name, '雨中方院');
  assert.equal(reopened.blueprints[0].name, '换景');
  assert.deepEqual(reopened.contentBrowser, JSON.parse(JSON.stringify(project.contentBrowser)));
  assert.deepEqual(folderTrail(reopened, child).map(folder => folder.name), ['场景', '第一章']);
  moveContent(reopened, ['not-a-resource'], root);
  assert.equal(reopened.contentBrowser!.assignments['not-a-resource'], undefined);
});

test('folders reject cycles and sibling collisions and deleting one removes its complete subtree', () => {
  const project = createProject(); project.assets.push({ id: 'picture', name: '图', path: 'image.png', kind: 'image' });
  const parent = createContentFolder(project, '剧情')!, child = createContentFolder(project, '场景', parent)!;
  const sibling = createContentFolder(project, '场景')!;
  moveContent(project, ['asset:picture'], parent);
  assert.equal(createContentFolder(project, '场景'), undefined);
  assert.equal(moveContentFolder(project, parent, child), false);
  assert.equal(moveContentFolder(project, child, child), false);
  assert.equal(moveContentFolder(project, child), false);
  assert.equal(moveContentFolder(project, child, 'missing'), false);
  removeContentFolder(project, parent);
  assert.equal(project.assets.length, 0);
  assert.equal(project.contentBrowser!.assignments['asset:picture'], undefined);
  assert.equal(project.contentBrowser!.folders.find(folder => folder.id === child), undefined);
  assert.equal(project.contentBrowser!.folders.find(folder => folder.id === sibling)!.name, '场景');
  assert.equal(project.contentBrowser!.folders.length, 1);
});

test('older projects need no migration and damaged folder chains cannot trap the resource browser', () => {
  const project = projectSchema.parse(createProject()); assert.equal(project.contentBrowser, undefined);
  project.contentBrowser = { folders: [{ id: 'first', name: '甲', parentId: 'second' }, { id: 'second', name: '乙', parentId: 'first' }], assignments: {}, favorites: [] };
  assert.equal(folderTrail(project, 'first').length, 2);
  assert.equal(folderTrail(project, 'missing').length, 0);
});

test('recursive deletion protects references outside the selection and never partly removes a folder', () => {
  const project = createProject();
  project.assets.push({ id: 'used', name: '在用图片', path: 'assets/used.png', kind: 'image' }, { id: 'unused', name: '闲置图片', path: 'assets/unused.png', kind: 'image' });
  const folder = createContentFolder(project, '素材')!;
  moveContent(project, ['asset:used', 'asset:unused'], folder);
  const passage = project.nodes.find(node => node.kind === 'passage')!;
  passage.lines[0].actions.push({ kind: 'background', assetId: 'used', transition: 'none' });
  const before = structuredClone(project);
  assert.throws(() => removeContentSelection(project, ['asset:used', 'asset:unused', 'folder:' + folder]), /仍被/);
  assert.deepEqual(project, before);
  assert.throws(() => removeContentSelection(project, ['asset:unused', 'folder:' + folder]), /仍被/);
  assert.deepEqual(project, before);
  removeContentSelection(project, ['asset:unused']);
  assert.deepEqual(project.assets.map(asset => asset.id), ['used']);
  assert.equal(project.assets[0].path, 'assets/used.png');
  assert.equal(project.contentBrowser!.assignments['asset:used'], folder);
  assert.equal(project.contentBrowser!.assignments['asset:unused'], undefined);
  assert.equal(passage.lines[0].actions.at(-1)!.kind, 'background');
});

test('mixed folder and resource moves retain identities and blueprint renaming updates invocations only', () => {
  const project = createProject(), graph = createBlueprintGraph('effect', '庭院入场');
  project.blueprints.push(graph);
  project.scriptText = { format: 'vns-text-1', content: '@庭院入场\n旁白：庭院入场' };
  const child = createContentFolder(project, '演出')!, destination = createContentFolder(project, '章节')!;
  const other = createContentFolder(project, '图片', child)!;
  assert.equal(moveContentSelection(project, ['folder:' + child, 'folder:' + other, 'blueprint:' + graph.id], destination), 2);
  assert.deepEqual(folderTrail(project, other).map(folder => folder.name), ['章节', '演出', '图片']);
  renameContent(project, projectContent(project).find(item => item.id === graph.id)!, '雨中入场');
  assert.match(project.scriptText.content, /@雨中入场【/);
  assert.match(project.scriptText.content, /旁白：庭院入场/);
  assert.equal(project.contentBrowser!.assignments['blueprint:' + graph.id], destination);
});
