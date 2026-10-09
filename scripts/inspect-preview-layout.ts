import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';

const root = path.resolve('.');
const output = path.join(root, 'artifacts/preview-layout', new Date().toISOString().replaceAll(':', '-'));
const projectFile = path.join(output, 'project/project.vns.json');
await fs.mkdir(path.dirname(projectFile), { recursive: true });
await fs.copyFile(path.join(process.env.VNS_INSTALL_VERIFY_ROOT!, 'baseline-project.json'), projectFile);
const app = await launchDesktopFixture({ root, profile: path.join(output, 'profile'), projectFile });
const page = await app.firstWindow();
const events: unknown[] = [], snapshots: unknown[] = [];
page.on('dialog', dialog => dialog.accept());
await page.exposeFunction('recordPreviewDiagnostic', (event: unknown) => events.push(event));
await page.evaluate(() => window.studio!.onRuntimeEvent(event => (window as unknown as { recordPreviewDiagnostic(event: unknown): void }).recordPreviewDiagnostic(event)));
const snapshot = async (phase: string) => {
  const state = {
    phase,
    window: await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return { bounds: win.getBounds(), content: win.getContentSize(), minimized: win.isMinimized(), visible: win.isVisible(), focused: win.isFocused() };
    }),
    layout: await page.evaluate(() => ({ viewport: [innerWidth, innerHeight], focus: document.hasFocus(), visibility: document.visibilityState,
      elements: ['.app-shell', '.play-workspace', '.play-body', '.play-screen', '.play-canvas-region', '.play-viewport', '.editor-layout'].map(selector => {
        const el = document.querySelector(selector);
        if (!el) return { selector };
        const style = getComputedStyle(el);
        return { selector, bounds: el.getBoundingClientRect().toJSON(), display: style.display, flex: style.flex, height: style.height, minHeight: style.minHeight };
      }),
    })),
  };
  snapshots.push(state);
  console.log(JSON.stringify(state));
};
try {
  await expect(page.locator('.project-title strong')).toHaveText('安装升级验收');
  await openStoryMode(page, 'text');
  const source = page.getByRole('textbox', { name: '中文文本剧本', exact: true });
  await source.fill((await source.inputValue()).replace('旧版保存的中文对白，升级后继续编辑。', '升级后的中文文本直接参与试玩与导出。'));
  await snapshot('before');
  await page.getByRole('button', { name: '试玩', exact: true }).click();
  await snapshot('after click');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
  await page.waitForTimeout(600);
  await snapshot('minimized during startup');
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.restore(); win.focus(); });
  await page.waitForTimeout(600);
  await snapshot('layout settled');
  await page.waitForTimeout(12000);
  await snapshot('native start');
  await page.screenshot({ path: path.join(output, 'preview.png') });
  await page.getByRole('button', { name: '停止试玩（Shift+F5）', exact: true }).click();
} finally {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ events, snapshots }, null, 2));
  await app.close();
  console.log(output);
}
