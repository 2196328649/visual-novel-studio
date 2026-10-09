import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject } from '../src/core/model';
import { createBlueprintGraph } from '../src/core/blueprint';
import { moveContent, moveContentFolder, projectContent } from '../src/core/content-browser';
import { queryContent } from '../src/core/content-query';

function fixture() {
  const project = createProject('统一资源');
  project.assets = [
    { id: 'image', name: '开场图片', kind: 'image', path: 'image.png' },
    { id: 'audio', name: '开场音频', kind: 'audio', path: 'audio.ogg' },
    { id: 'root', name: '根目录图片', kind: 'image', path: 'root.png' },
  ];
  const graph = createBlueprintGraph('effect', '开场蓝图');
  graph.id = 'graph'; project.blueprints = [graph];
  project.contentBrowser = {
    folders: [{ id: 'opening', name: '开场' }, { id: 'nested', name: '动画', parentId: 'opening' }, { id: 'empty', name: '空文件夹' }],
    assignments: { 'asset:image': 'opening', 'asset:audio': 'nested', 'blueprint:graph': 'nested' },
    favorites: ['blueprint:graph'],
  };
  return project;
}

test('multiple types include blueprints and media together with one search', () => {
  const project = fixture();
  const result = queryContent(project, projectContent(project), { kinds: ['blueprint', 'audio'], query: '开场', scope: 'all' });
  assert.deepEqual(result.visible.map(item => item.id).sort(), ['audio', 'graph']);
  assert.equal(result.childFolders.length, 0);
});

test('folder filtering preserves matching ancestors and never flattens nested results', () => {
  const project = fixture(), items = projectContent(project);
  const options = { kinds: ['blueprint'] as const, query: '开场', scope: 'folder' as const };
  const root = queryContent(project, items, { ...options, kinds: [...options.kinds] });
  assert.equal(root.visible.length, 0);
  assert.deepEqual(root.childFolders.map(folder => folder.id), ['opening']);
  const parent = queryContent(project, items, { ...options, kinds: [...options.kinds], folderId: 'opening' });
  assert.equal(parent.visible.length, 0);
  assert.deepEqual(parent.childFolders.map(folder => folder.id), ['nested']);
  const child = queryContent(project, items, { ...options, kinds: [...options.kinds], folderId: 'nested' });
  assert.deepEqual(child.visible.map(item => item.id), ['graph']);
});

test('clearing types restores all kinds; favorites and folder switching retain independent constraints', () => {
  const project = fixture(), items = projectContent(project);
  assert.deepEqual(queryContent(project, items, { kinds: [], query: '开场', scope: 'all' }).visible.map(item => item.id).sort(), ['audio', 'graph', 'image', project.scenes[0].id].sort());
  assert.deepEqual(queryContent(project, items, { kinds: ['blueprint', 'audio'], query: '', scope: 'favorites' }).visible.map(item => item.id), ['graph']);
  assert.deepEqual(queryContent(project, items, { kinds: [], query: '', scope: 'folder' }).childFolders.map(folder => folder.id), ['opening', 'empty']);
});

test('one folder accepts media and blueprints without assigning an incompatible asset category', () => {
  const project = fixture();
  project.contentBrowser!.folders[0].category = 'scene';
  assert.equal(moveContent(project, ['blueprint:graph', 'asset:audio', 'asset:image'], 'opening'), 3);
  assert.equal(project.assets[0].category, 'scene');
  assert.notEqual(project.assets[1].category, 'scene');
  assert.equal(project.contentBrowser!.assignments['blueprint:graph'], 'opening');
  assert.equal(moveContentFolder(project, 'empty', 'opening'), true);
});
