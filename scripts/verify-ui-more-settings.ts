import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { uiMoreSettingsFixture } from './lib/ui-more-settings-fixture';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openUiPreviewWindow, showUiPreviewTestData } from './lib/ui-preview-window';

const root = path.resolve('.'), output = path.join(root, 'artifacts/ui-more-settings', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
for (const mode of ['custom', 'replaced'] as const) {
  const folder = path.join(output, mode); await fs.mkdir(folder, { recursive: true });
  const project = uiMoreSettingsFixture(mode), original = JSON.stringify(project), projectFile = path.join(folder, 'project.vns.json');
  await fs.writeFile(projectFile, original);
  const app = await launchDesktopFixture({ root, projectFile, profile: path.join(folder, 'profile') }), editor = await app.firstWindow(); let page = editor;
  page.setDefaultTimeout(10000); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const button = (name: string) => page.getByRole('button', { name, exact: true }); let preview = page.locator('.ui-logic-preview-frame');
  const control = (name: string) => preview.getByLabel(name, { exact: true }), click = (name: string) => preview.getByRole('button', { name, exact: true }).click();
  try {
    await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 }); await page.locator('[data-workspace-tab="ui"]').click();
    await page.getByLabel('设计页面', { exact: true }).selectOption({ label: '设置' });
    await expect(page.locator('.ui-parameter-more')).toBeVisible(); await expect(page.locator('.ui-preferences-default')).toHaveCount(0);
    await page.screenshot({ path: path.join(folder, 'design.png') });
    await page.getByLabel('界面编辑模式').getByRole('button', { name: '事件图', exact: true }).click(); await page.getByLabel('事件图页面').selectOption('ui:main'); page = await openUiPreviewWindow(app, editor); await showUiPreviewTestData(page); preview = page.locator('.ui-logic-preview-frame');
    await click('蓝图打开设置'); await expect(page.getByLabel('当前预演页面')).toHaveText('设置');
    await expect(page.getByLabel('预演参数 剧情计数', { exact: true })).toHaveValue('3');
    if (mode === 'custom') await expect(preview.getByLabel('标准设置滚动区域')).toHaveCount(0);
    await preview.getByRole('button', { name: '更多设置', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(folder, 'shortcut.png') }); await click('更多设置'); await expect(page.getByLabel('当前预演页面')).toHaveText('更多设置');
    await expect(preview.locator('[data-preview-component="placed_control"]')).toHaveCount(0); await expect(control('隐藏设置')).toHaveCount(0); await expect(control('已放置参数')).toHaveCount(0);
    await control('字幕字号').fill('44'); await control('显示提示').uncheck(); await control('字幕语言').selectOption('English'); await control('称呼').fill('Guest'); await control('称呼').press('Enter');
    await expect(page.getByLabel('预演参数 剧情计数', { exact: true })).toHaveValue('3');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('#ui-preview'))!.setSize(1024, 768)); await control('提示停留时长').scrollIntoViewIfNeeded(); await control('提示停留时长').fill('18');
    const scroll = preview.getByLabel('标准设置滚动区域'); assert.ok(await scroll.evaluate(el => el.scrollHeight > el.clientHeight && el.scrollWidth <= el.clientWidth + 1));
    assert.ok(await page.locator('.ui-logic-preview-body').evaluate(el => el.scrollWidth <= el.clientWidth + 1)); await expect(control('提示停留时长')).toBeInViewport();
    await page.screenshot({ path: path.join(folder, 'more-settings-narrow.png') });
    await preview.getByLabel('参数联动预演画面').focus(); await page.keyboard.press('Escape'); await expect(page.getByLabel('当前预演页面')).toHaveText('设置');
    await click('更多设置'); await expect(control('字幕字号')).toHaveValue('44'); await expect(control('显示提示')).not.toBeChecked(); await expect(control('字幕语言')).toHaveValue('English'); await expect(control('称呼')).toHaveValue('Guest'); await expect(control('提示停留时长')).toHaveValue('18');
    await click('返回设置'); await click('恢复初始设置'); await click('取消'); await click('更多设置'); await expect(control('字幕字号')).toHaveValue('44');
    await preview.getByLabel('参数联动预演画面').click({ button: 'right', position: { x: 5, y: 5 } }); await expect(page.getByLabel('当前预演页面')).toHaveText('设置');
    await click('恢复初始设置'); await click('确认'); await click('更多设置'); await expect(control('字幕字号')).toHaveValue('25'); await expect(control('显示提示')).toBeChecked(); await expect(control('字幕语言')).toHaveValue('中文'); await expect(control('称呼')).toHaveValue('Player');
    await click('返回设置'); await click('完成设置'); await expect(page.getByLabel('当前预演页面')).toHaveText('标题'); await expect(page.getByLabel('预演参数 剧情计数', { exact: true })).toHaveValue('9');
    await expect(editor.locator('.dirty-dot')).toHaveCount(0); await expect(editor.getByRole('button',{name:'保存界面',exact:true})).toBeDisabled(); assert.equal(await fs.readFile(projectFile, 'utf8'), original); assert.deepEqual(errors, []);
  } catch (error) { await page.screenshot({ path: path.join(folder, 'failure.png') }).catch(() => undefined); throw error; }
  finally { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => undefined); await app.close(); }
}
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', renderer: 'dist', modes: ['custom', 'replaced'], checks: [
  '设计画布与预演按实际替换规则显示入口', '入口在作者整页面板之上', '更多设置排除隐藏与已放置参数', '数值/开关/选项/文字实际交互与跨页保留',
  '1024窗口滚动及横向边界', '按钮/Escape/右键返回设置', '恢复初始设置取消和确认', '返回设置不提前恢复蓝图，完成菜单后继续', '工程与UI草稿不变',
] }, null, 2)); console.log(output);
