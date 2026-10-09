import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { expect } from '@playwright/test';
import { createProject, type UiComponent } from '../src/core/model';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openUiPreviewWindow } from './lib/ui-preview-window';

const root = path.resolve('.'), output = path.join(root, 'artifacts/ui-design-return', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(path.join(output, 'assets'), { recursive: true });
const image = new PNG({ width: 240, height: 160 });
for (let i = 0; i < image.data.length; i += 4) { image.data[i] = 25; image.data[i + 1] = 205; image.data[i + 2] = 100; image.data[i + 3] = 255; }
await fs.writeFile(path.join(output, 'assets/card.png'), PNG.sync.write(image));
const project = createProject('设计与事件图往返验收'); project.width = 1280; project.height = 720;
project.assets.push({ id: 'card', name: '实际画布图片', kind: 'image', path: 'assets/card.png' });
const components: UiComponent[] = [
 { id: 'image', kind: 'image', page: 'main', text: '', assetId: 'card', x: .08, y: .16, width: .3, height: .4 },
 { id: 'title', kind: 'text', page: 'main', text: '返回设计仍可见', x: .44, y: .16, width: .47, height: .14, style: { fontSize: 36, textColor: '#ffffff' } },
 { id: 'button', kind: 'button', page: 'main', text: '实际可编辑按钮', x: .44, y: .4, width: .35, height: .12, style: { fontSize: 28, background: '#54657b' } },
 { id: 'progress', kind: 'progress', page: 'main', text: '', value: .6, x: .1, y: .7, width: .7, height: .08 },
 { id: 'settings_title', kind: 'text', page: 'preferences', text: '设置页仍可见', x: .2, y: .2, width: .6, height: .15 },
];
project.ui.components = components; project.ui.pages = { ...project.ui.pages, main: { layout: 'custom', background: '#192734' }, preferences: { layout: 'custom' } };
project.ui.customPages = [{ id: 'custom_return', name: '自定义往返页', background: '#234132', modal: true, components: [{ id: 'custom_text', kind: 'text', page: 'custom', text: '自定义页仍可见', x: .1, y: .2, width: .8, height: .2 }] }];
const projectFile = path.join(output, 'project.vns.json'), original = JSON.stringify(project); await fs.writeFile(projectFile, original);
const app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') }), editor = await app.firstWindow(), errors: string[] = [];
editor.on('pageerror', error => errors.push(error.message)); app.on('window', page => page.on('pageerror', error => errors.push(error.message)));
const mode = (name: string) => editor.getByLabel('界面编辑模式').getByRole('button', { name, exact: true });
const measure = () => editor.locator('.ui-canvas').evaluate(canvas => ({ canvas: { width: canvas.clientWidth, height: canvas.clientHeight }, components: [...canvas.querySelectorAll<HTMLElement>('[data-component-id]')].map(c => ({ id: c.dataset.componentId, width: c.getBoundingClientRect().width, height: c.getBoundingClientRect().height, fontSize: getComputedStyle(c).fontSize })) }));
const visible = async (ids: string[]) => {
 await expect(editor.locator('.ui-canvas')).toBeVisible();
 await expect.poll(async () => { const state = await measure(); return ids.every(id => { const component = components.find(c => c.id === id); return state.components.some(c => c.id === id && c.width > 5 && c.height > 5 && (!component || Math.abs(c.width - state.canvas.width * component.width) < 1)); }); }).toBe(true);
 const state = await measure();
 for (const id of ids) { const component = components.find(c => c.id === id); if (component) assert.ok(Math.abs(state.components.find(c => c.id === id)!.width - state.canvas.width * component.width) < 1); }
};
try {
 await expect(editor.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 }); await editor.locator('[data-workspace-tab="ui"]').click();
 await visible(['image', 'title', 'button', 'progress']); const before = await measure(); await editor.screenshot({ path: path.join(output, 'before.png') });
 await mode('事件图').click(); await expect(editor.locator('.ui-canvas')).toHaveCount(0); await mode('设计').click();
 await editor.screenshot({ path: path.join(output, 'after-return.png') });
 if (process.argv.includes('--reproduce')) {
  const after = await measure(); assert.ok(after.components.some(c => c.width < 1 && c.height < 1), '旧版本必须实际复现零尺寸控件');
  assert.equal(await fs.readFile(projectFile, 'utf8'), original);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'reproduced', before, after, diskUnchanged: true }, null, 2));
 } else {
  await visible(['image', 'title', 'button', 'progress']);
  const painted = PNG.sync.read(await editor.locator('.ui-canvas').screenshot({ path: path.join(output, 'painted-canvas.png') }));
  let green = 0; for (let i = 0; i < painted.data.length; i += 4) if (painted.data[i] < 40 && painted.data[i + 1] > 190 && painted.data[i + 2] > 80 && painted.data[i + 2] < 120) green++;
  assert.ok(green > 1000, '图片必须实际绘制，不能仅以DOM存在证明可见');
  for (let i = 0; i < 4; i++) { await mode('事件图').click(); await mode('设计').click(); await visible(['image', 'title', 'button', 'progress']); }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1024, 768)); await visible(['image', 'title', 'button', 'progress']); await editor.screenshot({ path: path.join(output, 'narrow.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1480, 960)); await visible(['image', 'title', 'button', 'progress']);
  await editor.locator('[data-hierarchy-id="title"]').click(); await editor.getByLabel('文字', { exact: true }).fill('往返后仍能修改'); await expect(editor.locator('[data-component-id="title"]')).toHaveText('往返后仍能修改');
  await mode('事件图').click(); await mode('设计').click(); await visible(['image', 'title', 'button', 'progress']); await expect(editor.locator('[data-component-id="title"]')).toHaveText('往返后仍能修改');
  assert.equal(await fs.readFile(projectFile, 'utf8'), original); await editor.getByRole('button', { name: '撤销', exact: true }).click();
  const preview = await openUiPreviewWindow(app, editor); await mode('事件图').click(); await mode('设计').click(); await visible(['image', 'title', 'button', 'progress']); await expect(preview.getByLabel('参数联动预演画面')).toContainText('返回设计仍可见');
  await mode('事件图').click(); await editor.getByLabel('事件图页面').selectOption('ui:preferences'); await mode('设计').click(); await visible(['settings_title']);
  await mode('事件图').click(); await editor.getByLabel('事件图页面').selectOption('custom_return'); await mode('设计').click(); await visible(['custom_text']);
  await mode('事件图').click(); await editor.getByLabel('事件图页面').selectOption('ui:main');
  await editor.locator('[data-workspace-tab="assets"]').click(); await expect.poll(() => app.windows().length).toBe(1); await editor.locator('[data-workspace-tab="ui"]').click(); await mode('设计').click(); await visible(['image', 'title', 'button', 'progress']);
  await editor.locator('[data-hierarchy-id="title"]').click(); await editor.getByLabel('文字', { exact: true }).fill('往返后保存'); await editor.getByRole('button', { name: '保存界面', exact: true }).click();
  const saved = JSON.parse(await fs.readFile(projectFile, 'utf8')); assert.equal(saved.ui.components.find((c: UiComponent) => c.id === 'title').text, '往返后保存'); assert.deepEqual(saved.assets, project.assets);
  await editor.reload(); await expect(editor.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 }); await editor.locator('[data-workspace-tab="ui"]').click(); await mode('事件图').click(); await mode('设计').click(); await visible(['image', 'title', 'button', 'progress']);
  await expect(editor.locator('[data-component-id="title"]')).toHaveText('往返后保存'); assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', compiledBuild: true, before, after: await measure(), checks: ['普通与多次设计/事件图往返', '实际图片绘制与控件尺寸比例', '窄窗口与恢复宽窗口', '草稿修改/撤销/显式保存重开', '独立预览打开时往返', '设置页与自定义页往返', '首次从事件图返回设计', '工程与素材保留'], errors }, null, 2));
 }
} catch (error) { await editor.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined); await fs.writeFile(path.join(output, 'failure.txt'), String(error)); throw error; }
finally { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => undefined); await app.close(); console.log(output); }
