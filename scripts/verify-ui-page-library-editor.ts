import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { projectSchema } from '../src/core/model';
import { synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { parseProject } from '../src/desktop/project-store';
import { chapterEditorEntries } from '../src/core/ui-page-authoring';
import { collectUiPageUsages } from '../src/core/ui-page-usages';
import { timelineWrapperCall } from '../src/core/timeline-component';
import { projectGraphs } from '../src/core/project-resources';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openUiPageSettings } from './lib/ui-design-controls';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

if (process.env.VNS_INSTALLED_EXE) throw new Error('Use the isolated development editor.');
const root = path.resolve('.'), output = path.resolve('artifacts/ui-page-library-editor', new Date().toISOString().replaceAll(':', '-'));
const directory = path.join(output, 'project'), projectFile = path.join(directory, 'project.vns.json');
const realFile = path.resolve('../我的视觉小说1/project.vns.json');
const checks: string[] = [], errors: string[] = [], processes: { pid?: number; exited: boolean }[] = [];
const processEvents: { time: string; event: string; detail: unknown }[] = [];
const report: Record<string, unknown> = { status: 'running', renderer: 'built', checks, errors, processes, processEvents };
let app: ElectronApplication | undefined, page: Page | undefined, phase = 'setup';
const button = (name: string) => page!.getByRole('button', { name, exact: true });
const picker = () => page!.getByLabel('设计页面', { exact: true });
const library = () => page!.getByRole('dialog', { name: '更多内置页面', exact: true });
const mode = (name: string) => page!.getByLabel('界面编辑模式').getByRole('button', { name, exact: true });
const disk = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const hash = async (file: string) => createHash('sha256').update(await fs.readFile(file)).digest('hex');
const record = (name: string) => { checks.push(name); console.log('PASS ' + checks.length + ': ' + name); };
async function more() { await button('更多内置页面').click(); await expect(library()).toBeVisible(); return library(); }
async function size(width: number, height: number) {
  const win = await app!.browserWindow(page!);
  await win.evaluate((window, value) => { if (window.isMaximized()) window.unmaximize(); window.setContentSize(value.width, value.height); }, { width, height });
  await expect.poll(() => page!.evaluate(width => Math.abs(innerWidth - width), width)).toBeLessThanOrEqual(2);
}
async function launch() {
  app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') });
  const event = (name: string, detail: unknown) => processEvents.push({ time: new Date().toISOString(), event: name, detail });
  app.process().on('exit', (code, signal) => event('exit', { code, signal }));
  app.process().stdout?.on('data', data => event('stdout', String(data)));
  app.process().stderr?.on('data', data => event('stderr', String(data)));
  await app.evaluate(({ app, BrowserWindow }) => {
    app.on('child-process-gone', (_event, details) => console.error('fixture-child-process-gone', details));
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.on('render-process-gone', (_event, details) => console.error('fixture-render-process-gone', details));
      window.on('closed', () => console.error('fixture-window-closed'));
    }
  });
  page = await app.firstWindow(); page.on('crash', () => event('page-crash', phase)); page.on('close', () => event('page-close', phase));
  page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText('内置页面整理验收', { timeout: 45000 });
  assert.ok(page.url().startsWith('file:')); await size(1440, 960); await page.locator('[data-workspace-tab="ui"]').click(); await mode('设计').click();
}
async function close() {
  if (!app) return;
  const child = app.process(); await app.close();
  await expect.poll(() => child.exitCode !== null || child.signalCode !== null, { timeout: 5000 }).toBe(true);
  const exited = child.exitCode !== null || child.signalCode !== null;
  processes.push({ pid: child.pid, exited }); assert.ok(exited); app = undefined;
}
try {
  await fs.mkdir(output, { recursive: true });
  report.realProjectBefore = await hash(realFile);
  const real = parseProject(JSON.parse(await fs.readFile(realFile, 'utf8'))).project;
  const t0 = performance.now(), realUsages = collectUiPageUsages(real);
  report.realProjectReadOnly = { usageAnalysisMs: performance.now() - t0, pages: [...realUsages].map(([page, usages]) => ({ page, entries: usages.filter(use => !use.reference && !use.inactive).length, references: usages.filter(use => use.reference || use.inactive).length })), chapters: chapterEditorEntries(real) };
  await fs.cp(path.join(root, 'resources/templates/aihong'), directory, { recursive: true });
  const project = parseProject(JSON.parse(await fs.readFile(projectFile, 'utf8'))).project; project.name = '内置页面整理验收';
  // Complete the template's existing node-pin upgrades before taking the data
  // preservation baseline; the application's normal edit pipeline does this too.
  synchronizeBlueprintSignatures(project);
  project.ui.components.push({ id: 'library_disabled_target', name: '停用页面绑定', page: 'main', kind: 'button', text: '旧角色音量入口', action: 'voiceSettings', x: .8, y: .9, width: .17, height: .05 });
  await fs.writeFile(projectFile, JSON.stringify(project, null, 2));
  const original = await disk(), originalBytes = await fs.readFile(projectFile, 'utf8');
  await launch(); await openUiPageSettings(page!);

  phase = 'common and spare pages';
  let values = await picker().locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value));
  assert.ok(!values.includes('pause') && !values.includes('chapterTitle') && !values.includes('voiceSettings'));
  assert.ok(values.includes('main') && values.includes('messageBox') && values.includes('flowchart'));
  await expect(picker().locator('option[value="messageBox"]')).toHaveText('确认对话框');
  await picker().selectOption('@more'); await expect(library()).toBeVisible(); await expect(picker()).toHaveValue('main');
  await page!.keyboard.press('Escape'); await expect(library()).toBeHidden(); await expect(button('更多内置页面')).toBeFocused();
  await more(); await library().getByRole('button', { name: '编辑暂停菜单', exact: true }).click();
  await expect(picker()).toHaveValue('pause'); await expect(picker()).toBeFocused();
  await mode('事件图').click(); await expect(page!.getByLabel('事件图页面', { exact: true })).toHaveValue('ui:pause');
  await mode('设计').click(); await expect(picker()).toHaveValue('pause');
  await expect(button('保存界面')).toBeDisabled(); assert.equal(await fs.readFile(projectFile, 'utf8'), originalBytes);
  record('常用列表隐藏备用和旧章节页；从下拉框或图标均能打开页面库，备用页跨设计/事件图保留且浏览不改工程。');

  phase = 'usage locations';
  await openUiPageSettings(page!); await expect(button('查看页面使用位置')).toContainText('尚未接入');
  await button('查看页面使用位置').click(); const usages = page!.getByRole('dialog', { name: '页面使用位置', exact: true });
  await expect(usages).toContainText('尚未接入'); await page!.keyboard.press('Escape');
  await picker().selectOption('preferences'); await openUiPageSettings(page!);
  await expect(button('查看页面使用位置')).toContainText('Esc'); await button('查看页面使用位置').click();
  await expect(usages).toContainText('Esc / 鼠标右键'); await expect(usages).toContainText('按钮');
  await usages.getByRole('button', { name: /^Esc \/ 鼠标右键打开/ }).click();
  const global = page!.getByRole('dialog', { name: '作品设置', exact: true }); await expect(global).toBeVisible();
  await expect(global.getByLabel('菜单快捷键打开', { exact: true })).toHaveValue('preferences');
  await global.getByRole('button', { name: '完成', exact: true }).click();
  await picker().selectOption('main'); await page!.locator('[data-hierarchy-id="library_disabled_target"]').click();
  await expect(page!.getByLabel('点击行为', { exact: true }).locator('option:checked')).toContainText('页面已停用');
  record('暂停页没有固定入口，设置页列出 Esc 和真实按钮；可定位到全局菜单设置，旧按钮明确显示停用状态。');

  phase = 'enable and history';
  await more(); await library().getByRole('button', { name: '启用并编辑角色音量', exact: true }).click();
  await expect(picker()).toHaveValue('voiceSettings'); await expect(button('保存界面')).toBeEnabled();
  await button('撤销').click(); await expect(picker()).toHaveValue('main'); await expect(button('保存界面')).toBeDisabled();
  await button('重做').click(); await expect(button('保存界面')).toBeEnabled();
  await more(); await library().getByRole('button', { name: '编辑角色音量', exact: true }).click(); await expect(picker()).toHaveValue('voiceSettings');
  const savingStarted = performance.now(); await button('保存界面').click();
  await expect(page!.locator('.ui-save-status')).toHaveAttribute('data-dirty', 'false', { timeout: 60000 });
  report.saveMs = performance.now() - savingStarted;
  const saved = await disk(); assert.ok(!saved.ui.disabledPages?.includes('voiceSettings'));
  assert.deepEqual(saved.ui.components, original.ui.components); assert.deepEqual(saved.ui.pages, original.ui.pages);
  assert.deepEqual(saved.nodes, original.nodes); assert.deepEqual(saved.blueprints, original.blueprints); assert.deepEqual(saved.timelinePresets, original.timelinePresets);
  await close(); await launch();
  values = await picker().locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value)); assert.ok(values.includes('voiceSettings'));
  record('启用仅改停用清单，可撤销、重做、保存重开；控件、外观、剧本和时间轴数据保持一致。');

  phase = 'responsive library and legacy page';
  for (const width of [1440, 1024]) {
    await size(width, width === 1024 ? 768 : 960); await more();
    await expect.poll(() => library().evaluate(element => {
      const bounds = element.getBoundingClientRect(); return element.scrollWidth <= element.clientWidth + 1 && bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight;
    })).toBe(true);
    await expect.poll(() => page!.locator('.ui-editor-header').evaluate(element => element.scrollWidth <= element.clientWidth + 1 && element.getBoundingClientRect().height <= 44.5)).toBe(true);
    await page!.screenshot({ path: path.join(output, 'library-' + width + '.png') });
    await page!.keyboard.press('Escape'); await expect(button('更多内置页面')).toBeFocused();
  }
  await more(); await library().getByText('旧版章节布局', { exact: true }).click();
  await library().getByRole('button', { name: '编辑旧版章节布局', exact: true }).click();
  await expect(picker()).toHaveValue('chapterTitle'); await expect(page!.locator('.ui-legacy-page-note')).toContainText('不会同步到已生成的时间轴');
  await expect(button('保存界面')).toBeDisabled();
  record('1440 和 1024 窗口工具栏、页面库无横向溢出，Esc 可关闭回焦；旧章节页显示作用范围提醒。');

  phase = 'chapter timeline';
  const chapter = chapterEditorEntries(await disk()).find(entry => entry.used)!; assert.ok(chapter);
  const graph = projectGraphs(saved).find(graph => graph.id === chapter.id)!;
  const timelineId = timelineWrapperCall(saved, graph)?.timelineId ?? graph.id;
  const beforeOpen = await fs.readFile(projectFile, 'utf8');
  await more(); const chapterButton = library().getByRole('button').filter({ hasText: chapter.name });
  await expect(chapterButton).toHaveCount(1); await chapterButton.click();
  await expect(page!.getByRole('region', { name: '演出工作区', exact: true })).toBeVisible();
  await expect(page!.getByLabel('演出目标', { exact: true })).toHaveValue('graph:' + timelineId);
  await expect(page!.locator('.performance-workspace-timeline')).toBeVisible();
  await page!.screenshot({ path: path.join(output, 'chapter-timeline.png') });
  assert.equal(await fs.readFile(projectFile, 'utf8'), beforeOpen);
  record('章节入口按实际资源 ID 打开正在使用的子时间轴，未生成新预设，也未改变剧本调用。');
  assert.deepEqual(errors, []); report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.phase = phase; report.error = String(error); console.error(error); process.exitCode = 1;
  report.failureUi = await page?.locator('body').ariaSnapshot().catch(() => undefined);
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
} finally {
  try { await close(); report.realProjectAfter = await hash(realFile); assert.equal(report.realProjectAfter, report.realProjectBefore); }
  catch (error) { report.status = 'failed'; report.teardownError = String(error); process.exitCode = 1; }
  await fs.copyFile(projectFile, path.join(output, 'saved.project.json')).catch(() => undefined);
  try { report.cleanup = await cleanVerificationDirectories(output, ['project', 'profile']); assert.deepEqual((report.cleanup as { errors: unknown[] }).errors, []); }
  catch (error) { report.status = 'failed'; report.cleanupError = String(error); process.exitCode = 1; }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(path.join(output, 'report.json'));
}
