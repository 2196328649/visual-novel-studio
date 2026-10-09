import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { assetFiles, createProject } from '../src/core/model';
import { assetSourcePath, importAsset, loadProject, saveProject } from '../src/desktop/project-store';
import { importSpineAsset } from '../src/desktop/spine-import';
import { buildProject } from '../src/runtime/service';

const root = path.resolve('.'), output = path.join(root, 'artifacts/reference-export', new Date().toISOString().replaceAll(':', '-'));
const original = path.join(output, 'original'), first = path.join(output, 'first'), second = path.join(output, 'second'), game = path.join(output, 'game');
await fs.mkdir(original, { recursive: true }); await fs.mkdir(first);
const png = new PNG({ width: 64, height: 64 });
for (let i = 0; i < png.data.length; i += 4) png.data.set([64, 32, 0, 128], i);
const bytes = PNG.sync.write(png), image = path.join(original, 'picture.png'); await fs.writeFile(image, bytes);
const json = { skeleton: { spine: '4.2.43', x: -50, y: -50, width: 100, height: 100 }, bones: [{ name: 'root' }], slots: [{ name: 'body', bone: 'root', attachment: 'tile' }], skins: [{ name: 'default', attachments: { body: { tile: { type: 'region', width: 100, height: 100 } } } }], animations: { idle: {} } };
const project = createProject('外部引用打包验收');
project.assets.push(await importAsset(first, image, { mode: 'reference', directory: 'media' }));
for (const pma of [false, true]) {
  const name = pma ? 'premultiplied' : 'ordinary', folder = path.join(original, name); await fs.mkdir(folder);
  await fs.writeFile(path.join(folder, 'skeleton.json'), JSON.stringify(json));
  await fs.writeFile(path.join(folder, 'skeleton.atlas'), `page.png\nsize:64,64\nfilter:Linear,Linear\npma:${pma}\ntile\nbounds:0,0,64,64\n`);
  await fs.writeFile(path.join(folder, 'page.png'), bytes);
  const asset = await importSpineAsset(first, path.join(folder, 'skeleton.json'), undefined, {}, { mode: 'reference', directory: 'media' });
  assert.equal(asset.externalFiles?.[asset.path], path.join(folder, 'skeleton.json'));
  assert.equal(!!asset.externalFiles?.[asset.spine!.pages[0].path], !pma);
  assert.equal(asset.externalFiles?.[asset.spine!.atlasPath], undefined);
  project.assets.push(asset);
}
await saveProject(path.join(first, 'project.vns.json'), project);
await saveProject(path.join(second, 'project.vns.json'), project, first);
const loaded = await loadProject(path.join(second, 'project.vns.json'));
assert.deepEqual(loaded.project.assets.map(asset => asset.externalFiles), project.assets.map(asset => asset.externalFiles));
for (const asset of project.assets) for (const relative of assetFiles(asset)) {
  const external = asset.externalFiles?.[relative] ?? (relative === asset.path ? asset.externalPath : undefined);
  if (external) await assert.rejects(fs.access(path.join(second, relative)), { code: 'ENOENT' });
  else assert.deepEqual(await fs.readFile(path.join(second, relative)), await fs.readFile(path.join(first, relative)));
}
const built = await buildProject({ project: loaded.project, projectDir: second, outputDir: game, sdkRoot: path.join(root, 'resources/runtime') });
assert.equal(built.ok, true, built.log + JSON.stringify(built.diagnostics));
for (const asset of project.assets) for (const relative of assetFiles(asset)) assert.deepEqual(await fs.readFile(path.join(game, 'game', relative)), await fs.readFile(assetSourcePath(second, asset, relative)));
for (const file of ['story.rpy', 'screens.rpy']) assert.ok(!(await fs.readFile(path.join(game, 'game', file), 'utf8')).includes(original.replaceAll('\\', '/')));
assert.deepEqual(await fs.readFile(image), bytes);
const report = { status: 'passed', checks: ['外部图片引用与 Spine 的外部骨骼/图片及本地标准化图集一起另存', '预乘透明图片在本地标准化，原图保持原字节', '另存未复制外部资源，本地配套文件全部复制', '导出复制全部资源到逻辑路径，RenPy 编译通过，脚本不含源目录依赖'] };
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(output);
