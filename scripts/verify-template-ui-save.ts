import { expect } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { launchDesktopFixture } from './lib/desktop-fixture';
import type { Project } from '../src/core/model';

const root = path.resolve('.'), output = path.join(root, 'artifacts/template-ui-save', new Date().toISOString().replaceAll(':', '-'));
const app = await launchDesktopFixture({ root, profile: path.join(output, 'profile'), projectHub: true });
const page = await app.firstWindow(), errors: string[] = [];
page.setDefaultTimeout(20000);
page.on('pageerror', error => errors.push(error.message));
try {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
  await page.getByRole('button', { name: '模板库', exact: true }).click();
  await page.getByRole('button', { name: '新建模板', exact: true }).click();
  await page.getByLabel('模板名称', { exact: true }).fill('界面模板');
  await page.getByRole('button', { name: '创建并编辑模板', exact: true }).click();
  await expect(page.locator('.template-editing-badge')).toBeVisible();
  const template = await page.evaluate(() => window.studio!.getInitial());
  await page.locator('[data-workspace-tab="ui"]').click();
  const layout = page.getByLabel('当前页面布局', { exact: true });
  await layout.selectOption('custom');
  await expect(page.locator('.dirty-dot')).toBeVisible();
  const before = JSON.parse(await fs.readFile(template.path!, 'utf8')) as Project;
  await page.getByRole('button', { name: '保存并返回模板库', exact: true }).click();
  await expect(page.getByRole('heading', { name: '管理你的模板' })).toBeVisible();
  const after = JSON.parse(await fs.readFile(template.path!, 'utf8')) as Project;
  expect(after.ui).not.toEqual(before.ui);
  await page.getByRole('article', { name: '模板 界面模板', exact: true }).getByRole('button', { name: '打开编辑', exact: true }).click();
  await page.locator('[data-workspace-tab="ui"]').click();
  await expect(layout).toHaveValue('custom');
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  await page.screenshot({ path: path.join(output, 'saved-ui-template.png') });
  expect(errors).toEqual([]);
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ status: 'passed', checks: ['保存并返回模板库保留尚未单独保存的界面草稿；重开后布局设置一致'], errors }, null, 2));
  console.log(output);
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
  throw error;
} finally { await app.close(); }
