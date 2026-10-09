import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createProject, projectSchema } from '../src/core/model';
import { exportSettings } from '../src/core/export-settings';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';

const root = path.resolve('.'), output = path.join(root, 'artifacts/close-save-export', new Date().toISOString().replaceAll(':', '-'));
const directory = path.join(output, 'project'), profile = path.join(output, 'profile'), screenshots = path.join(output, 'screenshots');
await fs.mkdir(directory, { recursive: true }); await fs.mkdir(screenshots);
const project = createProject('关闭保存验收');
project.nodes.find(node => node.kind === 'passage')!.lines[0].text = '已经保存的原始台词。';
project.ui.components.push({ id: 'qa_music', kind: 'musicTrackList', page: 'musicRoom', text: '曲目', x: .1, y: .15, width: .8, height: .6, list: { assetIds: [] } });
const projectFile = path.join(directory, 'project.vns.json');
await fs.writeFile(projectFile, JSON.stringify(project));
const dialogLog = path.join(output, 'dialogs.jsonl'), checks: string[] = [], errors: string[] = [];
let app: ElectronApplication | undefined, page: Page | undefined, phase = 'clean close';
const saved = async (file = projectFile) => projectSchema.parse(JSON.parse(await fs.readFile(file, 'utf8')));
const dialogs = async () => (await fs.readFile(dialogLog, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
async function launch(file = projectFile) {
  app = await launchDesktopFixture({ root, projectFile: file, profile }); page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText((await saved(file)).name, { timeout: 45000 });
  await app.evaluate(({ BrowserWindow, dialog, shell }, log) => {
    const io = process.getBuiltinModule('fs');
    BrowserWindow.getAllWindows()[0].setContentSize(1440, 960);
    const state = globalThis as any;
    state.qaMessages = []; state.qaChoices = []; state.qaSaveChoices = []; state.qaOpened = []; state.qaOpenChoices = [];
    dialog.showMessageBox = (async (...args: any[]) => {
      const options = args.at(-1); state.qaMessages.push(options);
      io.appendFileSync(log, JSON.stringify({ type: 'message', ...options }) + '\n');
      if (options.title !== '保存工程') return { response: 0, checkboxChecked: false };
      const response = state.qaChoices.length ? state.qaChoices.shift() : await new Promise(resolve => { state.qaResolve = resolve; });
      state.qaResolve = undefined;
      return { response, checkboxChecked: false };
    }) as any;
    dialog.showSaveDialog = (async (...args: any[]) => {
      io.appendFileSync(log, JSON.stringify({ type: 'save', ...args.at(-1) }) + '\n');
      const filePath = state.qaSaveChoices.shift(); return { canceled: !filePath, filePath };
    }) as any;
    dialog.showOpenDialog = (async (...args: any[]) => {
      io.appendFileSync(log, JSON.stringify({ type: 'open', ...args.at(-1) }) + '\n');
      const filePath = state.qaOpenChoices.shift(); return { canceled: !filePath, filePaths: filePath ? [filePath] : [] };
    }) as any;
    shell.openPath = async directory => { state.qaOpened.push(directory); return ''; };
  }, dialogLog);
}
async function edit(text: string) {
  await openStoryMode(page!, 'script');
  await page!.getByLabel('第1行对白', { exact: true }).fill(text);
  await expect(page!.locator('.dirty-dot')).toHaveCount(1);
}
async function request() {
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await expect.poll(() => app!.evaluate(() => !!(globalThis as any).qaResolve)).toBe(true);
}
async function decide(response: number, closes: boolean, file?: string | null) {
  const current = app!, closed = closes ? current.waitForEvent('close', { timeout: 25000 }) : undefined;
  await current.evaluate((_electron, data) => {
    const state = globalThis as any;
    if (data.file !== undefined) state.qaSaveChoices.push(data.file);
    state.qaResolve(data.response);
  }, { response, file });
  if (closed) { await closed; app = undefined; }
  else { await expect.poll(() => current.evaluate(() => !!(globalThis as any).qaResolve)).toBe(false); await expect(page!.locator('.dirty-dot')).toHaveCount(1); }
}

try {
  const original = await fs.readFile(projectFile, 'utf8');
  await launch(); await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  const cleanClose = app!.waitForEvent('close', { timeout: 15000 });
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()); await cleanClose; app = undefined;
  assert.deepEqual(await dialogs(), []); assert.equal(await fs.readFile(projectFile, 'utf8'), original);
  checks.push('无修改直接退出，不弹保存提示、不改工程文件。');

  phase = 'cancel and save combined project/UI draft';
  await launch(); await edit('关闭时真正写入工程文件。'); await request();
  let messages = await dialogs(); const prompt = messages.at(-1);
  assert.deepEqual(prompt.buttons, ['保存', '不保存', '取消']); assert.equal(prompt.cancelId, 2); assert.equal(prompt.defaultId, 0);
  await decide(2, false);
  assert.equal(await fs.readFile(projectFile, 'utf8'), original);
  await expect(page!.getByLabel('第1行对白', { exact: true })).toHaveValue('关闭时真正写入工程文件。');
  await page!.locator('[data-workspace-tab="ui"]').click();
  await page!.getByLabel('设计页面', { exact: true }).selectOption('musicRoom');
  await page!.locator('[data-hierarchy-id="qa_music"]').click();
  await page!.getByLabel('音乐列表曲目来源', { exact: true }).selectOption('automatic');
  await page!.screenshot({ path: path.join(screenshots, 'combined-unsaved-changes.png') });
  await request(); await decide(0, true);
  const combined = await saved();
  assert.equal(combined.nodes.find(node => node.kind === 'passage')!.lines[0].text, '关闭时真正写入工程文件。');
  assert.equal(combined.ui.components.find(component => component.id === 'qa_music')!.list?.assetIds, undefined);
  assert.equal((await dialogs()).filter(message => message.title === '保存工程').length, 2, 'One prompt per close attempt, including UI drafts');
  await assert.rejects(fs.access(projectFile + '.autosave'), { code: 'ENOENT' });
  checks.push('取消保留窗口与修改；项目和界面草稿共用一次询问，保存后真实文件包含两者。');

  phase = 'discard and recovery race';
  await launch(); await edit('这条台词必须被放弃。');
  await expect.poll(async () => fs.readFile(projectFile + '.autosave', 'utf8').catch(() => ''), { timeout: 10000 }).toContain('这条台词必须被放弃。');
  await request();
  const pending = await saved(); pending.nodes.find(node => node.kind === 'passage')!.lines[0].text = '这条台词必须被放弃。';
  await page!.evaluate(async project => { await Promise.all([window.studio!.autosave(project), window.studio!.autosave(project)]); }, pending);
  await decide(1, true);
  await assert.rejects(fs.access(projectFile + '.autosave'), { code: 'ENOENT' });
  assert.deepEqual(await saved(), combined);
  await launch(); await openStoryMode(page!, 'script');
  await expect(page!.getByLabel('第1行对白', { exact: true })).toHaveValue('关闭时真正写入工程文件。');
  await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  checks.push('不保存后删除恢复副本，询问期间排队的自动恢复写入也被清理；重新打开没有恢复已放弃内容。');

  phase = 'save-as cancel and save';
  await page!.getByRole('button', { name: '新建工程', exact: true }).click();
  await page!.locator('.dialog').getByLabel('作品名称', { exact: true }).fill('未保存关闭验收');
  await page!.getByRole('button', { name: '创建作品', exact: true }).click();
  await edit('新工程保存分支。'); await request(); await decide(0, false, null);
  await expect(page!.getByLabel('第1行对白', { exact: true })).toHaveValue('新工程保存分支。');
  const draftFile = path.join(output, 'saved-draft', 'project.vns.json');
  await request(); await decide(0, true, draftFile);
  const draft = await saved(draftFile); assert.equal(draft.name, '未保存关闭验收');
  assert.equal(draft.nodes.find(node => node.kind === 'passage')!.lines[0].text, '新工程保存分支。');
  await assert.rejects(fs.access(path.join(profile, 'draft.vns.json.autosave')), { code: 'ENOENT' });
  checks.push('未保存新工程取消另存为后继续编辑，再次选择位置后保存并关闭，草稿恢复文件清理。');

  phase = 'save failure retains work';
  await launch(draftFile); await edit('保存失败后仍保留的修改。');
  const moved = draftFile + '.temporarily-moved'; assert.ok(path.resolve(moved).startsWith(output + path.sep));
  await fs.rename(draftFile, moved);
  try {
    await request(); await decide(0, false);
    await expect.poll(async () => (await dialogs()).some(message => message.title === '未能完成关闭')).toBe(true);
    await expect(page!.getByLabel('第1行对白', { exact: true })).toHaveValue('保存失败后仍保留的修改。');
  } finally { await fs.rename(moved, draftFile); }
  await request(); await decide(0, true);
  assert.equal((await saved(draftFile)).nodes.find(node => node.kind === 'passage')!.lines[0].text, '保存失败后仍保留的修改。');
  checks.push('工程路径失效导致保存失败时窗口和编辑内容保留，恢复路径后可再次保存关闭。');

  phase = 'export cancel and invalid configuration';
  await launch(draftFile); const exporting = await saved(draftFile);
  exporting.exportSettings = exportSettings(exporting);
  const canceled = await page!.evaluate(project => window.studio!.exportGame(project), exporting);
  assert.equal(canceled, null);
  const invalid = structuredClone(exporting); invalid.version = 'bad';
  assert.equal((await page!.evaluate(project => window.studio!.exportGame(project), invalid))?.ok, false);
  assert.deepEqual(await app!.evaluate(() => (globalThis as any).qaOpened), []);

  phase = 'real Windows export and reveal';
  const exportDirectory = path.join(output, 'exports');
  await page!.locator('.export-button').click();
  const settings = page!.getByRole('dialog', { name: '作品设置', exact: true });
  await settings.getByLabel('导出文件位置', { exact: true }).fill(path.join(exportDirectory, '关闭导出验收'));
  await settings.getByLabel('导出文件位置', { exact: true }).press('Tab');
  await expect(settings.getByRole('button', { name: '导出', exact: true })).toBeEnabled({ timeout: 30000 });
  await settings.getByRole('button', { name: '导出', exact: true }).click();
  await expect.poll(() => app!.evaluate(() => (globalThis as any).qaOpened), { timeout: 180000, intervals: [1000, 2000] }).toEqual([exportDirectory]);
  const archives = (await fs.readdir(exportDirectory)).filter(name => name.endsWith('.zip'));
  assert.equal(archives.length, 1); assert.ok((await fs.stat(path.join(exportDirectory, archives[0]))).size > 1_000_000);
  await page!.screenshot({ path: path.join(screenshots, 'export-complete.png') });
  checks.push('通过作品设置实际导出 Windows ZIP，成功后恰好打开一次包含导出文件的目录；取消或失败不打开。');
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, archives, dialogs: await dialogs(), errors }, null, 2));
} catch (error) {
  await page?.screenshot({ path: path.join(screenshots, 'failure.png') }).catch(() => {});
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, checks, error: String(error), errors, dialogs: await dialogs() }, null, 2)); throw error;
} finally {
  await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {});
  await app?.close().catch(() => {}); console.log(output);
}
