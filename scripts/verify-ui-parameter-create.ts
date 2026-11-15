import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createProject, projectSchema } from '../src/core/model';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

if (process.env.VNS_INSTALLED_EXE) throw new Error('This acceptance uses the current development build in an isolated fixture.');
const root = path.resolve('.'), output = path.join(root, 'artifacts/ui-property-control-2026-11-09', 'parameter-create-' + new Date().toISOString().replaceAll(':', '-'));
const project = createProject('属性关联创建参数验收');
project.ui.components.push({ id: 'title_probe', kind: 'text', page: 'main', text: '测试标题', x: .1, y: .1, width: .5, height: .1 });
const projectFile = path.join(output, 'project/project.vns.json'), shots = path.join(output, 'shots');
const authorProject = path.resolve(root, '../我的视觉小说1/project.vns.json');
const digest = async () => createHash('sha256').update(await fs.readFile(authorProject)).digest('hex');
const authorBefore = await digest();
const checks: string[] = [], errors: string[] = [];
let app: ElectronApplication | undefined, page: Page | undefined, phase = 'setup';
const report: Record<string, unknown> = { status: 'running', checks, errors, authorBefore };
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const modes = () => page!.getByLabel('属性控制方式', { exact: true });
const openBindings = async () => {
  const bindings = page!.getByRole('button', { name: '参数绑定', exact: true });
  if (await bindings.getAttribute('aria-expanded') !== 'true') await bindings.click();
};
const enter = async () => {
  await page!.locator('[data-workspace-tab="ui"]').click();
  await page!.getByLabel('界面编辑模式').getByRole('button', { name: '事件图', exact: true }).click();
  await page!.getByLabel('事件图页面').selectOption('ui:main'); await openBindings();
  await page!.getByLabel('联动组件', { exact: true }).selectOption('title_probe');
};
const createForm = async (property: string, mode: 'follow' | 'sync' = 'follow') => {
  await page!.getByLabel('联动属性', { exact: true }).selectOption(property);
  await modes().selectOption(mode);
  await page!.getByRole('button', { name: '新建参数并联动', exact: true }).click();
};
const save = async () => {
  await page!.getByRole('button', { name: '保存界面', exact: true }).click();
  await expect(page!.getByRole('button', { name: '保存工程', exact: true })).toBeEnabled();
  await page!.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  return read();
};

try {
  await fs.mkdir(path.dirname(projectFile), { recursive: true }); await fs.mkdir(shots, { recursive: true });
  await fs.writeFile(projectFile, JSON.stringify(project));
  app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') });
  page = await app.firstWindow(); page.setDefaultTimeout(18000); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1500, 960));
  await enter();

  phase = 'cancel-and-history';
  await expect(modes()).toHaveValue('default');
  await createForm('visible');
  await page.getByLabel('新参数名称', { exact: true }).fill('标题开关');
  await page.getByLabel('新参数初始值', { exact: true }).uncheck();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByLabel('联动参数', { exact: true }).locator('option')).toHaveCount(1);
  await page.getByRole('button', { name: '新建参数并联动', exact: true }).click();
  await page.getByLabel('新参数名称', { exact: true }).fill('标题开关');
  await page.getByLabel('新参数初始值', { exact: true }).uncheck();
  await page.getByRole('button', { name: '创建参数并联动', exact: true }).click();
  await expect(page.getByLabel('联动参数', { exact: true }).locator('option:checked')).toHaveText('标题开关');
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(modes()).toHaveValue('default');
  await modes().selectOption('follow');
  await expect(page.getByLabel('联动参数', { exact: true }).locator('option')).toHaveCount(1);
  // Deselecting the pending mode makes the external redo state visible again.
  await page.getByLabel('联动属性', { exact: true }).selectOption('text');
  await page.getByLabel('联动属性', { exact: true }).selectOption('visible');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(modes()).toHaveValue('follow');
  await expect(page.getByLabel('联动参数', { exact: true }).locator('option:checked')).toHaveText('标题开关');
  assert.equal((await read()).variables.length, 0);
  await page.locator('[data-workspace-tab="script"]').click();
  await page.getByRole('dialog', { name: '保存界面修改' }).getByRole('button', { name: '不保存', exact: true }).click();
  await enter();
  await expect(modes()).toHaveValue('default');
  await expect(page.getByRole('button', { name: '创建页面事件图', exact: true })).toBeVisible();
  checks.push('取消不创建参数；单次撤销/重做和放弃草稿同时处理参数与属性关联，未创建蓝图');

  phase = 'numeric-and-string-parameters';
  await createForm('opacity', 'sync');
  await page.getByLabel('新参数名称', { exact: true }).fill('标题透明度');
  await page.getByLabel('新参数初始值', { exact: true }).fill('2');
  await page.getByLabel('新参数名称', { exact: true }).click();
  await expect(page.getByRole('button', { name: '创建参数并联动', exact: true })).toBeDisabled();
  await page.getByLabel('新参数初始值', { exact: true }).fill('0.4');
  await page.getByLabel('新参数所属参数集', { exact: true }).selectOption('parameters_game');
  await page.screenshot({ path: path.join(shots, 'new-parameter-form.png') });
  await page.getByRole('button', { name: '创建参数并联动', exact: true }).click();
  const saved = await save(), opacity = saved.variables.find(variable => variable.name === '标题透明度')!;
  assert.equal(saved.variables.length, 1); assert.equal(opacity.type, 'number'); assert.equal(opacity.initial, .4); assert.equal(opacity.persistent, true);
  assert.deepEqual(saved.ui.components.find(component => component.id === 'title_probe')!.propertyControls?.opacity, { mode: 'sync', parameterId: opacity.id });
  assert.equal(saved.blueprints.length, 0);
  await page.getByRole('button', { name: '新建参数并联动', exact: true }).click();
  await page.getByLabel('新参数名称', { exact: true }).fill('标题透明度');
  await expect(page.getByRole('button', { name: '创建参数并联动', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await createForm('text');
  await page.getByLabel('新参数名称', { exact: true }).fill('动态标题');
  await page.getByLabel('新参数初始值', { exact: true }).fill('由参数决定的标题');
  await page.getByRole('button', { name: '创建参数并联动', exact: true }).click();
  const final = await save(), text = final.variables.find(variable => variable.name === '动态标题')!;
  assert.equal(final.variables.length, 2); assert.equal(text.type, 'string'); assert.equal(text.initial, '由参数决定的标题'); assert.equal(text.persistent, false);
  assert.equal(final.blueprints.length, 0);
  assert.deepEqual(final.ui.components.find(component => component.id === 'title_probe')!.propertyControls?.text, { mode: 'follow', parameterId: text.id });
  checks.push('数值范围/重复名称校验；同步数值与跟随文字保存；参数集持久化语义保留');

  phase = 'restore-and-reopen';
  await modes().selectOption('default');
  await page.getByRole('button', { name: '恢复默认设置', exact: true }).click();
  const restored = await save(), component = restored.ui.components.find(item => item.id === 'title_probe')!;
  assert.equal(component.propertyControls?.text, undefined); assert.equal(component.text, '测试标题'); assert.deepEqual(restored.variables, final.variables);
  await page.screenshot({ path: path.join(shots, 'parameter-created.png') });
  await page.reload(); await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await enter(); await page.getByLabel('联动属性', { exact: true }).selectOption('opacity');
  await expect(modes()).toHaveValue('sync');
  await expect(page.getByLabel('联动参数', { exact: true }).locator('option:checked')).toHaveText('标题透明度');
  await page.getByLabel('联动属性', { exact: true }).selectOption('text'); await expect(modes()).toHaveValue('default');
  assert.deepEqual(errors, []);
  checks.push('解除关联恢复原设计文字、保留参数；保存重开保留两种来源状态');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.phase = phase; report.error = String(error);
  if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
  throw error;
} finally {
  let exited = true;
  if (app) {
    const child = app.process(), hasExited = () => child.exitCode !== null || child.signalCode !== null;
    await app.close().catch(error => errors.push('关闭隔离编辑器失败：' + String(error)));
    if (!hasExited()) {
      child.kill();
      await expect.poll(hasExited, { timeout: 15000 }).toBe(true).catch(error => errors.push('隔离编辑器仍在运行：' + String(error)));
    }
    exited = hasExited(); report.process = { pid: child.pid, exited };
  }
  await fs.mkdir(output, { recursive: true });
  await fs.copyFile(projectFile, path.join(output, 'saved-evidence.json')).catch(() => undefined);
  const cleanup = exited ? await cleanVerificationDirectories(output, ['project', 'profile']) : { removed: [], absent: [], errors: [{ path: output, error: '隔离编辑器仍在运行，保留其临时工程和profile。' }] };
  report.cleanup = cleanup; report.authorAfter = await digest();
  if (report.authorAfter !== authorBefore || cleanup.errors.length || errors.length) report.status = 'failed';
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  assert.equal(report.authorAfter, authorBefore); assert.deepEqual(cleanup.errors, []); assert.deepEqual(errors, []);
  console.log(output);
}
