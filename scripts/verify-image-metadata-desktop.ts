import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createProject, projectSchema } from '../src/core/model';
import { pngMetadata } from '../src/desktop/png-metadata';
import { installedExecutable, launchDesktopFixture } from './lib/desktop-fixture';

const root = path.resolve('.');
const output = path.join(root, 'artifacts/image-metadata-desktop', new Date().toISOString().replaceAll(':', '-'));
const directory = path.join(output, 'project'), incoming = path.join(output, 'incoming');
await fs.mkdir(directory, { recursive: true }); await fs.mkdir(incoming);
const makePng = (width: number, height: number, transparent = false) => {
  const png = new PNG({ width, height }); png.data.fill(0);
  if (!transparent) for (let y = 30; y < height - 40; y++) for (let x = 20; x < width - 50; x++) png.data.set([80, 140, 210, 255], (y * width + x) * 4);
  return PNG.sync.write(png);
};
const legacy = makePng(320, 240), picture = makePng(2048, 2048), transparent = makePng(256, 192, true);
await fs.writeFile(path.join(directory, 'legacy.png'), legacy);
const sources = ['incomplete.png', 'large.png', 'transparent.png'].map(name => path.join(incoming, name));
await fs.writeFile(sources[0], picture.subarray(0, 35));
await fs.writeFile(sources[1], picture); await fs.writeFile(sources[2], transparent);
const project = createProject('PNG 后台导入验收');
project.assets = [{ id: 'legacy', name: '旧版立绘', kind: 'image', path: 'legacy.png' }];
project.characters = [{ id: 'actor', name: '角色', color: '#ffffff', defaultExpressionId: 'expression', expressions: [{ id: 'expression', name: '默认', assetId: 'legacy' }] }];
const projectFile = path.join(directory, 'project.vns.json');
await fs.writeFile(projectFile, JSON.stringify(project));
let app: ElectronApplication | undefined, page: Page | undefined;
const checks: string[] = [], errors: string[] = [];
try {
  app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') });
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  const initial = await page.evaluate(() => window.studio!.getInitial());
  const metadata = (asset: typeof project.assets[number]) => ({ width: asset.width, height: asset.height, visibleBounds: asset.visibleBounds });
  assert.deepEqual(metadata(initial.project.assets.find(asset => asset.id === 'legacy')!), pngMetadata(legacy));
  checks.push('打开缺少元数据的旧版立绘后，后台分析得到正确尺寸和透明边界。');
  await app.evaluate(({ nativeImage }) => {
    const state = globalThis as any, original = nativeImage.createFromPath;
    state.pngNativeDecodeCalls = 0;
    nativeImage.createFromPath = file => {
      if (/\.png$/i.test(file)) state.pngNativeDecodeCalls++;
      return original(file);
    };
  });
  const result = await page.evaluate(async ({ project, sources }) => {
    const imported = await window.studio!.importAssets(project, { paths: sources });
    if (!imported) throw new Error('导入未完成。');
    const saved = await window.studio!.save(imported.project);
    if (!saved) throw new Error('保存未完成。');
    return { ...imported, project: saved.project };
  }, { project: initial.project, sources });
  assert.equal(result.importReport?.imported, 2);
  assert.equal(result.importReport?.errors.length, 1);
  assert.match(result.importReport!.errors[0], /incomplete\.png/);
  assert.deepEqual(metadata(result.project.assets.find(asset => asset.name === 'large')!), pngMetadata(picture));
  assert.deepEqual(metadata(result.project.assets.find(asset => asset.name === 'transparent')!), pngMetadata(transparent));
  assert.equal(await app.evaluate(() => (globalThis as any).pngNativeDecodeCalls), 0);
  checks.push('真实 IPC 导入 2048×2048 PNG 和全透明 PNG；损坏图片单独报告，队列继续处理，主线程没有重复原生解码。');
  const saved = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
  assert.deepEqual(saved.assets, projectSchema.parse(JSON.parse(JSON.stringify(result.project))).assets);
  await page.reload(); await expect(page.locator('.project-title strong')).toHaveText(project.name);
  const reopened = await page.evaluate(() => window.studio!.getInitial());
  assert.deepEqual(JSON.parse(JSON.stringify(reopened.project.assets)), saved.assets);
  checks.push('保存和重开后尺寸、透明边界和导入结果一致。');
  assert.deepEqual(errors, []);
  const child = app.process(); await app.close(); app = undefined;
  assert.ok(child.exitCode !== null || child.signalCode !== null);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', installedExecutable, checks, errors, fixtureExited: true }, null, 2));
  console.log(output);
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', installedExecutable, checks, errors, error: String(error) }, null, 2));
  console.error(output); throw error;
} finally { await app?.close(); }
