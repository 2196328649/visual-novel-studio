import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PNG } from 'pngjs';
import { expect } from '@playwright/test';
import { createProject, type Asset, type StageAction } from '../src/core/model';
import { createVisualObject } from '../src/core/visual-object';
import { blueprintFromPerformance, exposePerformanceInputs, performanceInputs } from '../src/core/blueprint-authoring';
import { synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';
import { writeTestTone } from './lib/test-tone';

const root = path.resolve('.'), output = path.resolve('artifacts/asset-type-filters', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const project = createProject('素材格式筛选验收');
const png = new PNG({ width: 64, height: 64 }); png.data.fill(255);
await fs.writeFile(path.join(output, 'image.png'), PNG.sync.write(png));
await fs.copyFile(path.resolve('../renpy/common/DejaVuSans.ttf'), path.join(output, 'font.ttf'));
await writeTestTone(path.join(output, 'sound.wav'), .2);
execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:size=64x64:rate=10', '-t', '0.2', '-c:v', 'libvpx', '-an', path.join(output, 'video.webm')], { windowsHide: true });
project.assets = [
  { id: 'image', name: '测试图片', kind: 'image', category: 'scene', path: 'image.png' },
  { id: 'font', name: '测试字体', kind: 'font', category: 'font', path: 'font.ttf' },
  { id: 'sound', name: '测试音效', kind: 'audio', category: 'sound', path: 'sound.wav' },
  { id: 'music', name: '测试音乐', kind: 'audio', category: 'bgm', path: 'sound.wav' },
  { id: 'video', name: '测试视频', kind: 'video', category: 'video', path: 'video.webm' },
];
const actions: StageAction[] = [createVisualObject('video', 'video'), { ...createVisualObject('text'), fontAssetId: 'font' }, { kind: 'sound', assetId: 'sound' }, { kind: 'background', assetId: 'image', transition: 'none' }];
const child = blueprintFromPerformance(project, actions, '内部素材演出'); project.blueprints.push(child);
for (const [pinId, name] of [['object_assetId', '视频'], ['object_fontAssetId', '字体'], ['assetId', '音效']]) {
  exposePerformanceInputs(child, [{ ...performanceInputs(child).find(f => f.pinId === pinId)!, name }]);
}
synchronizeBlueprintSignatures(project);
const owner = blueprintFromPerformance(project, [{ kind: 'blueprint', blueprintId: child.id }], '素材格式验收'); project.blueprints.push(owner);
exposePerformanceInputs(owner, performanceInputs(owner).filter(f => f.dataType === 'asset')); synchronizeBlueprintSignatures(project);
const direct = actions.map((a, i) => blueprintFromPerformance(project, [a], '直接素材' + i)); project.blueprints.push(...direct);
const projectFile = path.join(output, 'project.vns.json'); await fs.writeFile(projectFile, JSON.stringify(project));
const app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') }), page = await app.firstWindow();
const checks: string[] = [], errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
try {
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await page.locator('[data-workspace-tab="blueprint"]').click();
  await page.getByLabel('演出目标', { exact: true }).selectOption('graph:' + owner.id);
  const expand = page.getByRole('button', { name: '展开蓝图属性', exact: true }); if (await expand.isVisible()) await expand.click();
  await page.getByRole('button', { name: '输入与输出', exact: true }).click();
  const checkPicker = async (label: string, kind: Asset['kind'], category?: string) => {
    await page.getByRole('button', { name: '浏览' + label, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: label + '资源浏览器', exact: true });
    const selector = dialog.getByLabel('可选素材分类', { exact: true });
    if (category) await expect(selector).toHaveValue(category);
    await selector.selectOption('all');
    const names = await dialog.locator('button[aria-label^="预览资源 "]').evaluateAll(es => es.map(e => e.getAttribute('aria-label')!.replace('预览资源 ', '')));
    assert.deepEqual(names.sort(), project.assets.filter(a => a.kind === kind).map(a => a.name).sort(), label);
    await dialog.getByLabel('搜索可选资源').fill('不存在的素材');
    await expect(dialog.locator('button[aria-label^="预览资源 "]')).toHaveCount(0);
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    checks.push(label + '：类型、全部分类、空搜索结果正确');
  };
  for (const [name, kind, category] of [['视频', 'video', 'video'], ['字体', 'font', 'font'], ['音效', 'audio', 'sound']] as const) await checkPicker(name + '的默认值', kind, category);
  for (const [i, pin, kind, category] of [[0, 'object_assetId', 'video', 'video'], [1, 'object_fontAssetId', 'font', 'font'], [2, 'assetId', 'audio', 'sound'], [3, 'assetId', 'image', 'scene']] as const) {
    const graph = direct[i], node = graph.nodes[1];
    await page.getByLabel('演出目标', { exact: true }).selectOption('graph:' + graph.id);
    await page.getByRole('button', { name: '框选全部节点', exact: true }).click();
    const label = node.name + ' · ' + node.pins.find(p => p.id === pin)!.name;
    await checkPicker(label, kind, category);
    if (i >= 2) {
      await page.locator(`.react-flow__node[data-id="${node.id}"] .graph-node-title`).click();
      await checkPicker(i === 2 ? '音效素材' : '背景素材', kind, category);
    }
  }
  await openStoryMode(page, 'text');
  const input = page.getByLabel('中文文本剧本', { exact: true });
  for (const [name, kind, category] of [['视频', 'video', 'video'], ['字体', 'font', 'font'], ['音效', 'audio', 'sound']] as const) {
    await input.fill('@素材格式验收：' + name + '='); await input.press('End'); await input.press('Control+Space');
    await checkPicker(name, kind, category);
  }
  await page.screenshot({ path: path.join(output, 'verified.png') });
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, errors }, null, 2));
} catch (error) { await page.screenshot({ path: path.join(output, 'failure.png') }); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', checks, errors, error: String(error) }, null, 2)); throw error; }
finally { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => undefined); await app.close(); console.log(output); }
