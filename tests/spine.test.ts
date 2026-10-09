import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PNG } from 'pngjs';
import { importSpineAsset } from '../src/desktop/spine-import';
import { saveProject, loadProject } from '../src/desktop/project-store';
import { assetFiles, createProject, type Asset } from '../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { compileProject } from '../src/runtime/compiler';
import { spinePlacement } from '../src/core/spine';

const json = { skeleton: { spine: '4.2.43', x: -50, y: -50, width: 100, height: 100 }, bones: [{ name: 'root' }], slots: [{ name: 'body', bone: 'root', attachment: 'tile' }],
  skins: [{ name: 'default', attachments: { body: { tile: { type: 'region', width: 100, height: 100 } } } }],
  animations: { idle: { bones: { root: { rotate: [{ value: 0 }, { time: 1, value: 30 }] } } } } };
const atlas = 'page.png\nsize:128,128\nfilter:Linear,Linear\npma:true\ntile\nbounds:0,0,128,128\n';
const metadata: Asset = { id: 'skeleton', name: '骨骼', kind: 'spine', path: 'assets/rig/skeleton.json', spine: { version: '4.2.43', atlasPath: 'assets/rig/skeleton.atlas', pages: [{ name: 'page.png', path: 'assets/rig/page.png', width: 128, height: 128 }], bounds: { x: -50, y: -50, width: 100, height: 100 }, skins: ['default'], animations: [{ name: 'idle', duration: 1 }] } };

test('Spine import maps renamed images, normalizes PMA once and retains atlas UV dimensions', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vns-spine-import-'));
  const skeleton = path.join(root, '1.bytes'), texture = path.join(root, '1_0.png');
  await fs.writeFile(skeleton, JSON.stringify(json)); await fs.writeFile(path.join(root, '1.atlas.bytes'), atlas);
  const png = new PNG({ width: 64, height: 64 });
  for (let i = 0; i < png.data.length; i += 4) png.data.set([64, 32, 0, 128], i);
  const original = PNG.sync.write(png); await fs.writeFile(texture, original);
  const asset = await importSpineAsset(path.join(root, 'project'), skeleton, undefined, { 'page.png': texture });
  assert.deepEqual(asset.spine?.animations, [{ name: 'idle', duration: 1 }]);
  assert.equal(asset.spine?.pages[0].width, 128);
  assert.equal(asset.spine?.pages[0].sourcePremultipliedAlpha, true);
  const normalized = PNG.sync.read(await fs.readFile(path.join(root, 'project', asset.spine!.pages[0].path)));
  assert.equal(normalized.width, 64);
  assert.deepEqual([...normalized.data.subarray(0, 4)], [128, 64, 0, 128]);
  assert.match(await fs.readFile(path.join(root, 'project', asset.spine!.atlasPath), 'utf8'), /pma:false/);
  assert.deepEqual(await fs.readFile(texture), original);
  const project = createProject('便携骨骼项目'); project.assets.push(asset);
  const saved = await saveProject(path.join(root, 'relocated/project.vns.json'), project, path.join(root, 'project'));
  assert.deepEqual((await loadProject(path.join(root, 'relocated/project.vns.json'))).project.assets, saved.project.assets);
  for (const [index, relative] of assetFiles(saved.project.assets[0]).entries()) assert.deepEqual(await fs.readFile(path.join(root, 'relocated', relative)), await fs.readFile(path.join(root, 'project', assetFiles(asset)[index])));
});

test('Spine import rejects missing textures, unsafe atlas paths and incompatible versions', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vns-spine-errors-'));
  const skeleton = path.join(root, 'rig.json'), atlasPath = path.join(root, 'rig.atlas');
  await fs.writeFile(skeleton, JSON.stringify(json)); await fs.writeFile(atlasPath, atlas);
  await assert.rejects(importSpineAsset(path.join(root, 'project'), skeleton), /找不到图集图片/);
  await fs.writeFile(atlasPath, atlas.replace('page.png', '../page.png'));
  await assert.rejects(importSpineAsset(path.join(root, 'project'), skeleton), /路径不能离开项目目录/);
  await fs.writeFile(skeleton, JSON.stringify({ ...json, skeleton: { spine: '3.8.99' } }));
  await assert.rejects(importSpineAsset(path.join(root, 'project'), skeleton), /当前支持 Spine 4.2/);
});

test('component references and property types pass through reusable blueprint interfaces', () => {
  const project = createProject(); project.assets = [metadata];
  project.ui.components = [{ id: 'title_rig', kind: 'spine', page: 'main', text: '标题动画', assetId: metadata.id, spine: { animation: 'idle' }, x: 0, y: 0, width: 1, height: 1 }];
  const graph = createBlueprintGraph('ui', '动画控制');
  const setter = blueprintNodeDefaults('setUiProperty'), getter = blueprintNodeDefaults('getUiProperty'), pause = blueprintNodeDefaults('pauseSpine'), play = blueprintNodeDefaults('playSpine');
  setter.properties = { componentId: 'title_rig', property: 'opacity', value: 0.25 };
  getter.properties = { componentId: 'title_rig', property: 'visible' };
  pause.properties = { componentId: 'title_rig', paused: false };
  play.properties = { componentId: 'title_rig', animation: 'idle', loop: true, restart: false };
  graph.nodes.push(setter, getter, pause, play); project.blueprints = [graph]; synchronizeBlueprintSignatures(project);
  assert.equal(setter.pins.find(pin => pin.id === 'value')?.dataType, 'number');
  assert.equal(connectBlueprintPins(graph, getter.id, 'value', pause.id, 'paused'), undefined);
  for (const [from, to] of [[graph.nodes[0], setter], [setter, pause], [pause, play]]) assert.equal(connectBlueprintPins(graph, from.id, from.type === 'event' ? 'exec' : 'exec_out', to.id, 'exec_in'), undefined);
  const compiled = compileProject(project); assert.deepEqual(compiled.diagnostics.filter(d => d.severity === 'error'), []);
  assert.match(compiled.files['game/story.rpy'], /vns_spine.pause\("title_rig", vn_ui_get\("title_rig", "visible"\)\)/);
  assert.match(compiled.files['game/story.rpy'], /vns_spine.play\("title_rig", "idle", True, False\)/);
  assert.match(compiled.files['game/screens.rpy'], /vns_spine.player\("title_rig", max\(1, int\(vn_ui_get\("title_rig", "width"\)/);
  assert.doesNotMatch(compiled.files['game/screens.rpy'], /add Movie\(/);
  play.properties.animation = 'missing'; assert.ok(compileProject(project).diagnostics.some(d => d.nodeId === play.id && d.message.includes('没有所选动画')));
});

test('manual placement preserves recovered origin, scale, flip and rotation', () => {
  assert.deepEqual(spinePlacement(metadata, { fit: 'manual', originX: 0.5, originY: 543 / 1080, scale: 0.32, flipX: true, rotation: 15 }, 1920, 1080), { x: 960, y: 543, scaleX: -0.32, scaleY: 0.32, rotation: 15 });
  assert.deepEqual(spinePlacement(metadata, {}, 200, 100), { x: 100, y: 50, scaleX: 0.95, scaleY: 0.95, rotation: 0 });
});
