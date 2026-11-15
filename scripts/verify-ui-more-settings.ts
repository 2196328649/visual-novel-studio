import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { placeParameterControls, uiMoreSettingsFixture } from './lib/ui-more-settings-fixture';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openUiPreviewForTest } from './lib/ui-preview-window';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

// Keep the historical script name as a regression for the removed automatic menu.
if (process.env.VNS_INSTALLED_EXE) throw new Error('Use the compiled development editor for this acceptance.');
const root = path.resolve('.'), output = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? 'artifacts/parameter-generalization',
  'explicit-controls-editor-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const relative = path.relative(root, output);
if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Acceptance output must stay inside the workspace.');
await fs.mkdir(output, { recursive: true });
const results: Record<string, unknown>[] = [], report: Record<string, unknown> = { status: 'running', renderer: 'dist', results };
let failure: unknown;
try {
  const html = await fs.readFile(path.join(root, 'dist/index.html'), 'utf8');
  const buildFiles = ['dist/index.html', 'dist-desktop/main.cjs', 'dist-desktop/preload.cjs',
    ...[...html.matchAll(/(?:src|href)="(\.\/assets\/[^"?#]+\.(?:js|css))"/g)].map(match => 'dist/' + match[1].slice(2))];
  report.build = Object.fromEntries(await Promise.all(buildFiles.map(async file =>
    [file, createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex')])));
  for (const mode of ['custom', 'replaced'] as const) {
    const folder = path.join(output, mode), shots = path.join(folder, 'shots'), profile = path.join(folder, 'profile'), source = path.join(folder, 'project');
    await fs.mkdir(shots, { recursive: true }); await fs.mkdir(source, { recursive: true });
    const project = uiMoreSettingsFixture(mode); placeParameterControls(project);
    project.resourceSettings = { importMode: 'copy', directory: 'assets', syncFolders: false };
    const original = JSON.stringify(project), projectFile = path.join(source, 'project.vns.json'); await fs.writeFile(projectFile, original);
    const current: Record<string, unknown> = { mode, status: 'running' }; results.push(current);
    let app: ElectronApplication | undefined, page: Page | undefined, closed = true;
    const errors: string[] = [];
    try {
      app = await launchDesktopFixture({ root, projectFile, profile }); closed = false;
      const editor = await app.firstWindow(); page = editor; page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
      await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 }); await page.locator('[data-workspace-tab="ui"]').click();
      assert.equal(path.resolve(fileURLToPath(page.url())), path.join(root, 'dist/index.html'));
      await page.getByLabel('设计页面', { exact: true }).selectOption({ label: '设置' });
      await expect(page.locator('.ui-parameter-more')).toHaveCount(0); await expect(page.locator('.ui-preferences-default')).toHaveCount(0);
      await page.screenshot({ path: path.join(shots, 'design.png') });
      await page.getByLabel('界面编辑模式').getByRole('button', { name: '事件图', exact: true }).click(); await page.getByLabel('事件图页面').selectOption('ui:main');
      page = await openUiPreviewForTest(app, editor, errors); page.setDefaultTimeout(10000);
      const view = page, preview = view.locator('.ui-logic-preview-frame');
      const control = (name: string) => preview.getByLabel(name, { exact: true }), click = (name: string) => preview.getByRole('button', { name, exact: true }).click();
      const variable = (name: string) => view.getByLabel('预演参数 ' + name, { exact: true });
      await click('蓝图打开设置'); await expect(view.getByLabel('当前预演页面')).toHaveText('设置');
      await expect(preview.getByRole('button', { name: '更多设置', exact: true })).toHaveCount(0);
      await expect(variable('剧情计数')).toHaveValue('3'); await expect(control('隐藏设置')).toHaveCount(0);
      await expect(control('已放置参数')).toBeChecked();
      if (mode === 'custom') await expect(preview.getByLabel('标准设置滚动区域')).toHaveCount(0);
      await control('字幕字号').fill('44'); await control('显示提示').uncheck(); await control('字幕语言').selectOption({ label: 'English' });
      await control('称呼').fill('Guest'); await control('称呼').press('Enter'); await control('提示停留时长').fill('18'); await control('已放置参数').uncheck();
      await variable('隐藏设置').selectOption('false');
      await expect(variable('剧情计数')).toHaveValue('3'); await expect(variable('字幕字号')).toHaveValue('44'); await expect(variable('字幕语言')).toHaveValue('English');
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('#ui-preview'))!.setSize(1024, 768));
      await control('提示停留时长').scrollIntoViewIfNeeded(); await expect(control('提示停留时长')).toBeInViewport();
      assert.ok(await view.locator('.ui-logic-preview-body').evaluate(element => element.scrollWidth <= element.clientWidth + 1));
      await view.screenshot({ path: path.join(shots, 'explicit-controls-narrow.png') });
      await click('恢复初始设置'); await click('取消'); await expect(control('字幕字号')).toHaveValue('44'); await expect(variable('隐藏设置')).toHaveValue('false');
      await click('完成设置'); await expect(view.getByLabel('当前预演页面')).toHaveText('标题'); await expect(variable('剧情计数')).toHaveValue('9');
      await click('蓝图打开设置'); await expect(control('称呼')).toHaveValue('Guest'); await expect(control('提示停留时长')).toHaveValue('18');
      await click('恢复初始设置'); await click('确认'); await expect(control('字幕字号')).toHaveValue('25'); await expect(control('显示提示')).toBeChecked();
      await expect(control('字幕语言').locator('option:checked')).toHaveText('中文'); await expect(control('称呼')).toHaveValue('Player');
      await expect(control('已放置参数')).toBeChecked(); await expect(variable('隐藏设置')).toHaveValue('true'); await expect(variable('剧情计数')).toHaveValue('9');
      await preview.getByLabel('参数联动预演画面').focus(); await view.keyboard.press('Escape'); await expect(view.getByLabel('当前预演页面')).toHaveText('标题');
      await click('蓝图打开设置'); await preview.getByLabel('参数联动预演画面').click({ button: 'right', position: { x: 5, y: 5 } });
      await expect(view.getByLabel('当前预演页面')).toHaveText('标题');
      await expect(editor.locator('.dirty-dot')).toHaveCount(0); await expect(editor.getByRole('button', { name: '保存界面', exact: true })).toBeDisabled();
      assert.equal(await fs.readFile(projectFile, 'utf8'), original); assert.deepEqual(errors, []);
      current.status = 'passed'; current.checks = ['无自动菜单或分组', '显式数值/开关/选项/输入', '1024宽度可操作', '确认取消及隐藏变量恢复', '退出菜单才继续蓝图', 'Escape/右键', '预演不写源工程'];
    } catch (error) {
      current.status = 'failed'; current.error = String(error);
      if (page && !page.isClosed()) await page.screenshot({ path: path.join(shots, 'failure.png') }).catch(capture => { current.captureError = String(capture); });
      throw error;
    } finally {
      try { if (app) { await app.close(); closed = true; } }
      finally {
        if (!closed) throw new Error('Owned editor did not close; retain its fixture and profile.');
        current.cleanup = await cleanVerificationDirectories(folder, ['project', 'profile']);
        assert.deepEqual((current.cleanup as { errors: unknown[] }).errors, []);
      }
    }
  }
  report.status = 'passed';
} catch (error) {
  failure = error; report.status = 'failed'; report.error = String(error);
} finally {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(output);
}
if (failure) throw failure;
