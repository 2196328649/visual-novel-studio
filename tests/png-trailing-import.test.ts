import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { createProject } from '../src/core/model';
import { importAssetPaths } from '../src/desktop/asset-import';
import { AssetDiscovery } from '../src/desktop/asset-discovery';
import { disposeImageMetadataWorkers, pngMetadataAsync } from '../src/desktop/image-metadata-worker-pool';
import { pngMetadata } from '../src/desktop/png-metadata';
import { assetSourcePath, importAsset, loadProject, saveProject } from '../src/desktop/project-store';

after(() => disposeImageMetadataWorkers());

function picture() {
  const image = new PNG({ width: 12, height: 18 });
  for (let y = 3; y < 15; y++) for (let x = 2; x < 10; x++) {
    const offset = (y * image.width + x) * 4;
    image.data.set([80, 140, 200, 255], offset);
  }
  return PNG.sync.write(image);
}

function crc(bytes: Buffer) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function textChunk(text: string) {
  const contents = Buffer.from('tEXt' + text), length = contents.length - 4;
  const chunk = Buffer.alloc(length + 12);
  chunk.writeUInt32BE(length, 0); contents.copy(chunk, 4); chunk.writeUInt32BE(crc(contents), length + 8);
  return chunk;
}

const suffix = Buffer.from('\0exported metadata\xffIEND\0', 'latin1');
const idFor = (bytes: Buffer) => 'asset_' + createHash('sha256').update(bytes).digest('hex').slice(0, 24);

test('完整PNG结束后的附加数据不妨碍元数据读取，worker不改写输入', async () => {
  const original = picture(), bytes = Buffer.concat([original, suffix]), before = Buffer.from(bytes);
  const expected = pngMetadata(original);
  assert.deepEqual(expected, { width: 12, height: 18, visibleBounds: { x: 2, y: 3, width: 8, height: 12 } });
  assert.deepEqual(pngMetadata(bytes), expected);
  assert.deepEqual(await pngMetadataAsync(bytes), expected);
  assert.deepEqual(bytes, before);
});

test('仅按完整chunk定位结束，文字元数据内的IEND和正常CRC不被误切割', () => {
  const original = picture();
  const withText = Buffer.concat([original.subarray(0, 33), textChunk('note\0IEND is part of this metadata'), original.subarray(33), suffix]);
  assert.deepEqual(pngMetadata(withText), pngMetadata(original));
  const invalidCrc = Buffer.from(original); invalidCrc[invalidCrc.length - 1] ^= 1;
  assert.throws(() => pngMetadata(Buffer.concat([invalidCrc, suffix])), /CRC/i);
  assert.throws(() => pngMetadata(Buffer.concat([original.subarray(0, original.length - 12), textChunk('note\0IEND')])));
  assert.throws(() => pngMetadata(original.subarray(0, original.length - 2)));
});

test('复制、引用与重复导入保留完整原字节、内容ID和保存重开记录', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vns-png-trailing-import-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const bytes = Buffer.concat([picture(), suffix]), source = path.join(directory, '原图.png');
  await fs.writeFile(source, bytes);
  for (const mode of ['copy', 'reference'] as const) {
    const destination = path.join(directory, mode), project = createProject('PNG尾部数据');
    project.resourceSettings = { directory: 'assets', importMode: mode };
    const imported = await importAssetPaths(destination, project, [source]);
    assert.deepEqual(imported.report.errors, []); assert.equal(imported.report.imported, 1);
    const asset = imported.project.assets[0];
    assert.equal(asset.id, idFor(bytes)); assert.equal(asset.width, 12); assert.equal(asset.height, 18);
    assert.deepEqual(await fs.readFile(assetSourcePath(destination, asset)), bytes);
    if (mode === 'reference') {
      assert.equal(asset.externalPath, source);
      await assert.rejects(fs.access(path.join(destination, asset.path)), { code: 'ENOENT' });
    }
    const duplicate = await importAssetPaths(destination, imported.project, [source]);
    assert.equal(duplicate.report.duplicates, 1); assert.equal(duplicate.project.assets.length, 1);
    assert.deepEqual(duplicate.report.errors, []);
    const file = path.join(destination, 'project.vns.json'); await saveProject(file, imported.project);
    const reopened = await loadProject(file);
    assert.equal(reopened.project.assets[0].id, asset.id);
    assert.deepEqual(await fs.readFile(assetSourcePath(destination, reopened.project.assets[0])), bytes);
  }
  assert.deepEqual(await fs.readFile(source), bytes);
});

test('损坏或未复制完的PNG导入失败时不留下目标文件，之后仍能导入有效图片', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vns-png-trailing-reject-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const original = picture(), badCrc = Buffer.from(original); badCrc[badCrc.length - 1] ^= 1;
  const badImageData = Buffer.from(original); badImageData[badImageData.indexOf(Buffer.from('IDAT')) + 4] ^= 1;
  const inputs = [original.subarray(0, original.length - 2), Buffer.concat([badCrc, suffix]), Buffer.concat([badImageData, suffix])];
  for (const [index, bytes] of inputs.entries()) {
    const source = path.join(directory, `坏图${index}.png`), destination = path.join(directory, `project${index}`);
    await fs.writeFile(source, bytes);
    await assert.rejects(importAsset(destination, source));
    await assert.rejects(fs.access(path.join(destination, 'assets', '未分类', idFor(bytes) + '.png')), { code: 'ENOENT' });
    await assert.rejects(fs.access(destination), { code: 'ENOENT' });
    assert.deepEqual(await fs.readFile(source), bytes);
  }
  const source = path.join(directory, '好图.png'); await fs.writeFile(source, original);
  const imported = await importAsset(path.join(directory, 'good'), source);
  assert.equal(imported.width, 12); assert.equal(imported.height, 18);
});

test('目录内已有的未登记PNG可自动发现，保留原路径和字节且二次扫描不重复', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vns-png-trailing-discovery-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const bytes = Buffer.concat([picture(), suffix]), relative = 'assets/未分类/' + idFor(bytes) + '.png';
  await fs.mkdir(path.dirname(path.join(directory, relative)), { recursive: true });
  await fs.writeFile(path.join(directory, relative), bytes);
  const before = await fs.stat(path.join(directory, relative)), project = createProject(), discovery = new AssetDiscovery();
  const result = await discovery.scan(directory, project);
  assert.ok(result); assert.equal(result.assets.length, project.assets.length + 1);
  const asset = result.assets.find(item => item.id === idFor(bytes))!;
  assert.ok(asset); assert.equal(asset.path, relative); assert.equal(asset.externalPath, undefined);
  assert.deepEqual(await fs.readFile(path.join(directory, relative)), bytes);
  assert.equal((await fs.stat(path.join(directory, relative))).mtimeMs, before.mtimeMs);
  assert.equal(await discovery.scan(directory, result), undefined);
  const existing = await importAsset(directory, path.join(directory, relative));
  assert.equal(existing.id, asset.id);
  assert.equal((await fs.stat(path.join(directory, relative))).mtimeMs, before.mtimeMs);
});
