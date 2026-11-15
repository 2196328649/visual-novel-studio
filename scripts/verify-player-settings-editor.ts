import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createProject, projectSchema } from '../src/core/model';
import { playerPreferenceKeys } from '../src/core/preferences';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

// All thirteen system preferences retain their setting semantics. Custom
// variables share the same editor, with independent storage/reset and group defaults.
// Run only after the complete implementation has been built.
if (process.env.VNS_INSTALLED_EXE) throw new Error('Use the isolated compiled development editor.');
const root = path.resolve('.'), output = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? 'artifacts/player-settings-editor',
  'player-settings-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const relativeOutput = path.relative(root, output);
if (!relativeOutput || relativeOutput === '..' || relativeOutput.startsWith('..' + path.sep) || path.isAbsolute(relativeOutput)) {
  throw new Error('The new acceptance run must be inside this workspace.');
}
const projectFile = path.join(output, 'project/project.vns.json'), profile = path.join(output, 'profile');
const project = createProject('游戏设置编辑验收');
let app: ElectronApplication | undefined, page: Page | undefined, phase = 'setup', failure: unknown;
const errors: string[] = [], checks: string[] = [], processes: { pid?: number; exited: boolean; forced?: boolean }[] = [];
const report: Record<string, unknown> = { status: 'running', renderer: 'compiled', checks, errors, processes, temporaryPaths: [path.dirname(projectFile), profile] };
const read = async () => { await page!.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page!.locator('.dirty-dot')).toHaveCount(0); return projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8'))); };
const type = async (label: string, value: string) => { const field = page!.getByLabel(label, { exact: true }); await field.fill(value); await field.press('Tab'); };
const row = (key: string) => page!.locator(`[data-builtin-preference="${key}"]`);
async function close() {
  if (!app) return;
  const owned = app, child = owned.process(), exited = () => child.exitCode !== null || child.signalCode !== null;
  const record = processes.find(item => item.pid === child.pid)!;
  let closeError: unknown;
  try { await owned.close(); await expect.poll(exited, { timeout: 15000 }).toBe(true); }
  catch (error) {
    closeError = error;
    if (!exited()) { record.forced = true; child.kill(); }
    await expect.poll(exited, { timeout: 15000 }).toBe(true);
  } finally {
    record.exited = exited(); if (record.exited) { app = undefined; page = undefined; }
  }
  if (closeError) throw closeError;
}
try {
  await fs.mkdir(path.dirname(projectFile), { recursive: true });
  await fs.writeFile(projectFile, JSON.stringify(projectSchema.parse(project)));
  app = await launchDesktopFixture({ root, profile, projectFile, devUrl: '' });
  processes.push({ pid: app.process().pid, exited: false }); page = await app.firstWindow(); page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  assert.equal(path.resolve(fileURLToPath(page.url())), path.join(root, 'dist/index.html'));
  report.rendererUrl = page.url(); await page.evaluate('globalThis.__name = value => value');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 1050));
  phase = 'all system settings';
  await page.locator('[data-workspace-tab="variables"]').click();
  await page.locator('[data-parameter-set-id="parameters_game"]').click();
  await expect(page.locator('[data-builtin-preference]')).toHaveCount(playerPreferenceKeys.length);
  assert.equal(playerPreferenceKeys.length, 13);
  for (const key of playerPreferenceKeys) await expect(row(key)).toBeVisible();
  await expect(row('textSpeed')).toContainText('35 字/秒');
  await expect(row('musicVolume')).toContainText('100%');
  await expect(page.locator('.builtin-parameters')).toHaveCount(0);
  checks.push('内置设置和自定义参数在同一张参数表里，初始值带单位或百分比');

  phase = 'system text speed ranges';
  await row('textSpeed').click();
  const panel = page.getByLabel('内置设置', { exact: true });
  await expect(panel).toBeVisible();
  await type('显示名称', '打字速度');
  await expect(row('textSpeed')).toContainText('打字速度');
  await type('滑条最大值', '500');
  await expect(panel).toContainText('0 字/秒 ～ 500 字/秒');
  await type('初始文字速度', '400');
  await expect(row('textSpeed')).toContainText('400 字/秒');
  checks.push('文字速度可改名、上限可调到 500，初始值可填到新范围内');

  // Raising the minimum past the maximum moves both, and the initial value stays inside.
  await type('滑条最小值', '600');
  await expect(panel).toContainText('600 字/秒 ～ 601 字/秒');
  await expect(row('textSpeed')).toContainText('600 字/秒');
  await type('滑条最小值', '50');
  await type('滑条最大值', '500');
  await type('滑条步长', '10');
  await expect(panel).toContainText('50 字/秒 ～ 500 字/秒');
  checks.push('最小值超过最大值时另一端跟着移动，初始值自动留在范围内');

  phase = 'system invalid input and volume';
  await type('滑条最小值', '-5');
  await expect(panel.getByRole('alert')).toContainText('不能小于');
  await expect(panel).toContainText('50 字/秒 ～ 500 字/秒');
  await row('musicVolume').click();
  await type('滑条最大值', '150');
  await expect(panel.getByRole('alert')).toContainText('100%');
  await type('滑条最大值', '80');
  await expect(panel).toContainText('0% ～ 80%');
  await expect(row('musicVolume')).toContainText('80%');
  checks.push('只拦截会出错的值（负的文字速度、超过 100% 的音量），并说明原因；音量按百分比输入');

  phase = 'system menu visibility and persistence';
  await row('ambientVolume').click();
  await panel.getByLabel('显示在默认设置菜单', { exact: true }).uncheck();
  await expect(row('ambientVolume')).toContainText('不在菜单显示');
  await page.screenshot({ path: path.join(output, 'builtin-settings.png') });
  const saved = await read();
  assert.deepEqual(saved.playerPreferenceSettings, { textSpeed: { name: '打字速度', min: 50, max: 500, step: 10 }, musicVolume: { max: .8 }, ambientVolume: { visible: false } });
  // The initial value followed the range up to 600, then back down to the new maximum.
  assert.deepEqual(saved.playerDefaults, { textSpeed: 500, musicVolume: .8 });
  checks.push('工程只保存改过的项目');

  phase = 'restore individual system settings';
  await row('ambientVolume').click();
  await panel.getByRole('button', { name: '恢复这一项的默认设置', exact: true }).click();
  await expect(row('ambientVolume')).not.toContainText('不在菜单显示');
  await row('musicVolume').click();
  await panel.getByRole('button', { name: '恢复这一项的默认设置', exact: true }).click();
  await expect(row('musicVolume')).toContainText('100%');
  checks.push('单项可恢复默认');

  // A custom number shares the display format.
  phase = 'custom number display';
  await page.locator('.parameter-add-kinds').getByRole('button', { name: '数值', exact: true }).click();
  const detail = page.getByLabel('参数设置', { exact: true });
  await detail.locator('summary').filter({ hasText: '界面控件' }).click();
  await detail.getByLabel('数值显示方式', { exact: true }).selectOption('percent');
  await type('初始值', '40');
  const added = page.locator('.parameter-table button.selected');
  await expect(added).toContainText('40%');
  await detail.getByLabel('数值显示方式', { exact: true }).selectOption('number');
  await type('数值单位', '点');
  await expect(added).toContainText('0.4 点');
  checks.push('自定义数值参数也能选百分比或单位');

  // A general group declares creation defaults. Each variable owns its behavior.
  phase = 'general group creation defaults';
  await page.locator('.parameter-sets-workspace').getByRole('button', { name: '参数集', exact: true }).click();
  await expect(page.getByRole('button', { name: '新建设置分组', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '新建参数集', exact: true }).click();
  const groupDialog = page.getByRole('dialog', { name: '新建参数集', exact: true });
  await groupDialog.getByLabel('参数集名称', { exact: true }).fill('独立参数分类');
  await expect(groupDialog.getByLabel('新参数默认保存方式', { exact: true })).toHaveValue('save');
  await groupDialog.getByLabel('新参数默认保存方式', { exact: true }).selectOption('local');
  await groupDialog.locator('summary').filter({ hasText: '恢复初始设置' }).click();
  await expect(groupDialog.getByLabel('新参数默认参与恢复初始设置', { exact: true })).not.toBeChecked();
  await groupDialog.getByLabel('新参数默认参与恢复初始设置', { exact: true }).check();
  await groupDialog.getByRole('button', { name: '创建参数集', exact: true }).click();
  await expect(groupDialog).toBeHidden();
  await expect(page.getByLabel('参数集用途', { exact: true })).toHaveCount(0);
  await page.locator('.parameter-add-kinds').getByRole('button', { name: '开关', exact: true }).click();
  await expect(detail.getByLabel('保存方式', { exact: true })).toHaveValue('local');
  const final = await read();
  const group = final.parameterSets?.find(set => set.name === '独立参数分类');
  assert.ok(group);
  assert.deepEqual(group.defaults, { persistent: true, resetWithSettings: true });
  const member = final.variables.find(variable => variable.parameterSetId === group.id);
  assert.equal(member?.persistent, true);
  assert.equal(member?.resetWithSettings, true);
  assert.equal(member?.initial, false);
  assert.equal(final.variables.length, 2);
  assert.deepEqual(final.playerPreferenceSettings, { textSpeed: { name: '打字速度', min: 50, max: 500, step: 10 } });
  checks.push('通用参数集可显式配置新建默认；开关保留false、采用本机保存与恢复配置，系统设置仍保持原行为');
  await page.screenshot({ path: path.join(output, 'settings-group.png') });
  assert.deepEqual(errors, []);
  report.status = 'passed';
  await fs.writeFile(path.join(output, 'saved-evidence.json'), JSON.stringify(final, null, 2));
} catch (error) {
  failure = error; report.status = 'failed'; report.phase = phase; report.error = String(error);
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(capture => { report.captureError = String(capture); });
} finally {
  try { await close(); } catch (error) { report.status = 'failed'; report.closeError = String(error); failure ??= error; }
  try {
    if (app || processes.some(record => !record.exited)) throw new Error('An owned fixture process remains alive; retain its directories.');
    report.cleanup = await cleanVerificationDirectories(output, ['project', 'profile']);
    assert.deepEqual((report.cleanup as { errors: unknown[] }).errors, []);
  } catch (error) { report.status = 'failed'; report.cleanupError = String(error); failure ??= error; }
  await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(output);
}
if (failure) throw failure;
