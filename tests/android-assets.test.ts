import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, type Asset } from '../src/core/model';
import { androidAssets } from '../src/runtime/android-assets';
import { compileProject } from '../src/runtime/compiler';

test('Android maps Unicode resource paths without changing the authored project or identities', () => {
  const project = createProject();
  project.assets = [
    { id: 'portrait', kind: 'image', name: '王生', path: 'assets/王生/通常.png', width: 100, height: 200 },
    { id: 'voice', kind: 'audio', name: '中文配音', path: 'assets/声音/台词.ogg' },
    { id: 'font', kind: 'font', name: '字体', path: 'assets/字体.ttf' },
    { id: 'clip', kind: 'video', name: '视频', path: 'assets/片头.webm' },
    { id: 'script', kind: 'script', name: '小游戏', path: 'scripts/小游戏.rpy' },
    { id: 'ascii', kind: 'image', name: '已有资源', path: 'assets/ascii.png' },
  ];
  const before = JSON.stringify(project), result = androidAssets(project);
  assert.equal(JSON.stringify(project), before);
  assert.equal(result.project.id, project.id);
  assert.deepEqual(result.project.assets.map(a => a.name), project.assets.map(a => a.name));
  assert.ok(result.files.every(file => /^[\x20-\x7e]+$/.test(file.destination)));
  assert.equal(result.project.assets[5].path, 'assets/ascii.png');
  assert.match(result.project.assets[4].path, /^scripts\/vns_android_[a-f0-9]+\.rpy$/);
  assert.deepEqual(androidAssets(project), result, 'rebuilding keeps resource paths stable for saved displayables');
  assert.equal(compileProject(result.project).diagnostics.filter(d => d.severity === 'error').length, 0);
  assert.match(result.runtime, /config.file_open_callback = vn_android_open_asset/);
  assert.match(result.runtime, /config.loadable_callback = vn_android_asset_loadable/);
  for (const [oldPath, newPath] of Object.entries(result.aliases)) {
    assert.ok(result.runtime.includes(oldPath)); assert.ok(result.runtime.includes(newPath));
  }
});

test('Android maps grouped Spine files while retaining atlas page names and order', () => {
  const project = createProject();
  const spine: Asset = { id: 'animation', name: '标题动画', kind: 'spine', path: 'assets/动画/skeleton.json', spine: {
    version: '4.2', atlasPath: 'assets/动画/skeleton.atlas',
    pages: [{ name: '纹理.png', path: 'assets/动画/纹理.png', width: 100, height: 100 }],
    animations: [], skins: ['default'], bounds: { x: 0, y: 0, width: 100, height: 100 },
  } };
  project.assets = [spine];
  const result = androidAssets(project), mapped = result.project.assets[0];
  assert.equal(result.files.length, 3);
  assert.equal(mapped.spine!.pages[0].name, '纹理.png');
  assert.ok([mapped.path, mapped.spine!.atlasPath, mapped.spine!.pages[0].path].every(p => !/[^\x20-\x7e]/.test(p)));
  assert.deepEqual(spine.spine!.pages[0].path, 'assets/动画/纹理.png');
});

test('Android detects collisions with existing generated-looking paths and does not add needless runtime', () => {
  const project = createProject();
  project.assets = [{ id: 'first', name: '中文', kind: 'image', path: 'assets/中文.png' }];
  const destination = androidAssets(project).files[0].destination;
  project.assets.push({ id: 'second', name: 'Conflict', kind: 'image', path: destination });
  assert.throws(() => androidAssets(project), /路径冲突/);
  project.assets = [project.assets[1]];
  assert.equal(androidAssets(project).runtime, '');
});
