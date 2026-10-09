import { expect } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject } from '../src/core/model';
import { exportSettings } from '../src/core/export-settings';
import { launchDesktopFixture } from './lib/desktop-fixture';

// Run only after the user has explicitly accepted the linked Android SDK terms.
if (!process.argv.includes('--accept-android-license')) throw new Error('需要明确的 Android SDK 许可确认。');
const root = path.resolve('.'), output = process.env.VNS_ANDROID_VERIFY_ROOT ?? await fs.mkdtemp('E:/VNSAndroid-');
const profile = path.join(output, 'profile'), projectFile = path.join(output, 'project/project.vns.json');
await fs.mkdir(path.dirname(projectFile), { recursive: true });
const existing = await fs.readFile(projectFile, 'utf8').catch(() => undefined);
const project = existing ? JSON.parse(existing) : createProject('Android 实际导出验收');
if (!existing) {
  project.exportSettings = { ...exportSettings(project), platform: 'android', fileName: 'AndroidAcceptance' };
  await fs.writeFile(projectFile, JSON.stringify(project));
}
await fs.writeFile(path.join(root, 'artifacts/android-active.json'), JSON.stringify({ output, profile, projectFile }, null, 2));
const app = await launchDesktopFixture({ root, profile, projectFile }); const page = await app.firstWindow();
try {
  await expect(page.locator('.project-title strong')).toHaveText(project.name);
  await page.exposeFunction('recordAndroidSetup', async (state: unknown) => { await fs.writeFile(path.join(output, 'setup-progress.json'), JSON.stringify(state, null, 2)); });
  await page.evaluate(() => window.studio!.onExportSetupProgress!(state => { void (window as any).recordAndroidSetup(state); }));
  await page.locator('.export-button').click();
  await page.getByRole('checkbox', { name: /我已阅读并同意/ }).check();
  await page.getByRole('button', { name: '一键配置', exact: true }).click();
  await expect.poll(async () => (await page.evaluate(() => window.studio!.exportSetupStatus!())).running, { timeout: 1800000, intervals: [2000, 5000] }).toBe(false);
  const status = await page.evaluate(() => window.studio!.exportSetupStatus!());
  await fs.writeFile(path.join(output, 'setup-result.json'), JSON.stringify({ status, environment: await page.evaluate(() => window.studio!.environment()) }, null, 2));
  await page.screenshot({ path: path.join(output, 'setup-result.png') });
  expect(status.phase, status.log).toBe('ready'); console.log(`ANDROID SETUP PASS: ${output}`);
} catch (error) { console.error(error); console.log(output); process.exitCode = 1; }
finally { await app.close(); }
