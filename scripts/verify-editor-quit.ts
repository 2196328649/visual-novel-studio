import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import { createProject } from '../src/core/model';
import { launchDesktopFixture } from './lib/desktop-fixture';

/** Closing the editor must end its process, with or without unsaved edits.
 * A quit re-issued inside the prevented will-quit turn used to be ignored,
 * leaving a windowless editor running in the background. */
const root = path.resolve('.'), output = path.join(root, 'artifacts/editor-quit', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const projectFile = path.join(output, 'project/project.vns.json');
await fs.mkdir(path.dirname(projectFile), { recursive: true });
await fs.writeFile(projectFile, JSON.stringify(createProject('退出验收')));
const checks: string[] = [];
let app: ElectronApplication | undefined;
try {
  for (const dirty of [false, true]) {
    app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, dirty ? 'profile-dirty' : 'profile-clean') });
    const page = await app.firstWindow();
    await page.locator('[data-workspace-tab]').first().waitFor({ timeout: 60_000 });
    if (dirty) {
      await page.locator('[data-workspace-tab="characters"]').click();
      await page.getByRole('button', { name: '添加角色', exact: true }).click();
    }
    const child = app.process();
    // Playwright's own close asks Electron to quit, like a normal shutdown.
    const close = Object.getPrototypeOf(app).close.bind(app) as () => Promise<void>;
    const started = Date.now();
    const result = await Promise.race([close().then(() => 'closed'), new Promise<string>(resolve => setTimeout(() => resolve('timeout'), 10_000))]);
    assert.equal(result, 'closed', `${dirty ? '有' : '无'}未保存修改时关闭后进程未退出`);
    assert.equal(child.exitCode, 0);
    app = undefined;
    checks.push(`${dirty ? '有' : '无'}未保存修改：关闭后 ${Date.now() - started} ms 内进程以 0 退出`);
  }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks }, null, 2));
  console.log(checks.join('\n'));
} catch (error) {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', checks, error: String(error) }, null, 2));
  throw error;
} finally {
  if (app && app.process().exitCode === null) app.process().kill();
  for (const name of ['project', 'profile-clean', 'profile-dirty']) await fs.rm(path.join(output, name), { recursive: true, force: true }).catch(() => undefined);
  console.log(output);
}
