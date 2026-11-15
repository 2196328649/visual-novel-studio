import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { createProject, projectSchema } from '../src/core/model';
import type { ProjectSession } from '../src/core/bridge';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openDisclosureAncestors } from './lib/ui-disclosures';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

// Pending acceptance: run only after the coordinator completes all changes,
// typechecks/tests and builds. This script never builds or opens a real work.
// Only this fixture's source reads and save entry are delayed; the real import,
// save, resource copy and reopen handlers remain in use.
if (process.env.VNS_INSTALLED_EXE || process.env.VNS_TEST_ROOT) throw new Error('请使用源码构建版，并清除 VNS_INSTALLED_EXE / VNS_TEST_ROOT。');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
assert.equal(path.resolve(process.cwd()).toLowerCase(), root.toLowerCase(), '请从 editor 工作区运行。');
const roundRoot = path.join(root, 'artifacts/code-health-review-2026-11-14');
const sessionRoot = path.join(roundRoot, 'session-editor');
const requestedRoot = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? sessionRoot);
assert.ok([roundRoot, sessionRoot].some(candidate => candidate.toLowerCase() === requestedRoot.toLowerCase()), 'VNS_ARTIFACT_ROOT 必须属于本轮会话验收。');
const output = path.join(sessionRoot, `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`);
const projectADir = path.join(output, 'project-a'), projectBDir = path.join(output, 'project-b');
const profile = path.join(output, 'profile'), temp = path.join(output, 'temp');
const evidenceDir = path.join(output, 'evidence'), screenshotsDir = path.join(output, 'screenshots');
const projectAFile = path.join(projectADir, 'project.vns.json'), projectBFile = path.join(projectBDir, 'project.vns.json');
const controlId = 'session_concurrency_image';
const inside = (parent: string, child: string) => {
  const relative = path.relative(parent, child);
  return !!relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
for (const target of [projectADir, projectBDir, profile, temp, evidenceDir, screenshotsDir]) assert.ok(inside(output, target));
assert.ok(inside(sessionRoot, output) && inside(root, output));

async function prepareOutput() {
  const workspace = await fs.realpath(root);
  let current = root;
  for (const part of path.relative(root, output).split(path.sep)) {
    current = path.join(current, part);
    const info = await fs.lstat(current).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
    if (current === output) assert.equal(info, undefined, '每次验收必须使用全新目录。');
    if (info) assert.ok(info.isDirectory() && !info.isSymbolicLink(), '不得进入目录链接：' + current);
    else await fs.mkdir(current);
    assert.ok(inside(workspace, await fs.realpath(current)));
  }
  for (const target of [projectADir, projectBDir, temp, evidenceDir, screenshotsDir]) await fs.mkdir(target);
}

function image(color: [number, number, number]) {
  const png = new PNG({ width: 96, height: 72 });
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) png.data.set([...color, 255], (y * png.width + x) * 4);
  return PNG.sync.write(png);
}
const firstBytes = image([35, 115, 200]), secondBytes = image([195, 80, 60]);
const firstSource = path.join(temp, '第一张隔离图片.png'), secondSource = path.join(temp, '第二张隔离图片.png'), invalidSource = path.join(temp, '无效隔离图片.png');
const firstId = 'asset_' + hash(firstBytes).slice(0, 24), secondId = 'asset_' + hash(secondBytes).slice(0, 24);
const project = createProject('异步会话互斥验收');
project.id = 'session_concurrency_' + randomUUID().slice(0, 8); project.assets = []; project.blueprints = []; project.characters = [];
project.ui.instances = []; project.ui.activeInstanceId = undefined; project.ui.customPages = [];
project.ui.components = [{ id: controlId, name: '互斥验收图片', kind: 'image', page: 'main', text: '', x: .15, y: .18, width: .6, height: .6 }];
project.ui.pages = { main: { layout: 'custom' } };
project.resourceSettings = { importMode: 'copy', directory: 'assets', syncFolders: false };

interface NativeLog {
  imports: { projectId: string; completed: boolean; resultPath?: string | null; error?: string }[];
  saves: { projectId: string; saveAs: boolean; completed: boolean; resultPath?: string | null; error?: string }[];
  opens: { title: string; canceled: boolean; filePaths: string[] }[];
  saveDialogs: { title: string; filePath: string }[];
  reads: { source: string; held: boolean; completed: boolean }[];
}
interface SessionConcurrencyGate extends NativeLog {
  source: string;
  cancelImport: boolean;
  delayRead: boolean;
  holdSave: boolean;
  readRelease?: () => void;
  saveRelease?: () => void;
  persist?: () => void;
}
const checks: { name: string; durationMs: number }[] = [], errors: string[] = [], screenshots: unknown[] = [], traces: string[] = [];
const heldEditingAvailability: { uiDraft: boolean; modal: boolean; externalPropertyInDialog: boolean; ordinaryEdit: string }[] = [];
const processes: { launch: number; pid?: number; exited: boolean; exitCode?: number | null; signalCode?: string | null }[] = [];
const report: Record<string, unknown> = { status: 'running', output, checks, errors, screenshots, traces, processes,
  heldEditingAvailability,
  temporaryPaths: [projectADir, projectBDir, profile, temp],
  limits: ['仅本次新工程、两张合成PNG及独立profile；不读取真实作品或历史artifacts。', '真实import/save处理器和原生模态关闭契约保留；验收只替换操作系统文件选择与延迟隔离文件读取。', '素材读取暂停期间原生模态保持打开，外部属性不能普通编辑；不绕过模态，也不声称已验收导入期间新增普通编辑。', '重开后的预览验证为编辑器画布及素材详情的Chromium图片解码。'] };
let app: ElectronApplication | undefined, page: Page | undefined, child: ChildProcess | undefined, traceStarted = false;
let activeFile = projectAFile, nativeLogFile = '';
const persist = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const button = (name: string) => page!.getByRole('button', { name, exact: true });
const picker = () => page!.getByRole('dialog', { name: '图片素材资源浏览器', exact: true });
const status = () => page!.locator('.status-message');
const canvasImage = () => page!.locator(`.ui-canvas [data-component-id="${controlId}"] img`);
const readProject = async (file = activeFile) => projectSchema.parse(JSON.parse(await fs.readFile(file, 'utf8')));
const getSession = () => page!.evaluate(() => window.studio!.getInitial());
const sameLocation = (session: ProjectSession, file: string) => assert.equal(path.resolve(session.path!).toLowerCase(), file.toLowerCase());
async function check(name: string, work: () => Promise<void>) {
  report.phase = name; const started = Date.now(); await work(); checks.push({ name, durationMs: Date.now() - started });
  await persist(); console.log('通过：' + name);
}
async function screenshot(name: string) {
  if (!app || !page || page.isClosed()) return;
  const capture = await app.evaluate(async ({ BrowserWindow }, url) => {
    const window = BrowserWindow.getAllWindows().find(item => item.webContents.getURL() === url);
    if (!window) throw new Error('未找到自有验收窗口。');
    let image = await window.webContents.capturePage(); const size = image.getSize(), factor = Math.min(1, 1280 / Math.max(size.width, size.height));
    if (factor < 1) image = image.resize({ width: Math.max(1, Math.round(size.width * factor)), height: Math.max(1, Math.round(size.height * factor)), quality: 'good' });
    return { png: image.toPNG().toString('base64'), ...image.getSize() };
  }, page.url());
  assert.ok(Math.max(capture.width, capture.height) <= 1280);
  const file = path.join(screenshotsDir, name + '.png'); await fs.writeFile(file, Buffer.from(capture.png, 'base64'));
  screenshots.push({ file: path.relative(output, file), width: capture.width, height: capture.height });
}
async function installObservers() {
  nativeLogFile = path.join(output, `native-${processes.length}.json`);
  await app!.evaluate(({ dialog, ipcMain }, options) => {
    const nativeFs = process.getBuiltinModule('fs');
    const state: SessionConcurrencyGate = (globalThis as any).__sessionConcurrency = {
      source: '', cancelImport: false, delayRead: false, holdSave: false, readRelease: undefined as undefined | (() => void), saveRelease: undefined as undefined | (() => void),
      imports: [] as NativeLog['imports'], saves: [] as NativeLog['saves'], opens: [] as NativeLog['opens'], saveDialogs: [] as NativeLog['saveDialogs'], reads: [] as NativeLog['reads'],
    };
    const persistNative = () => nativeFs.writeFileSync(options.logFile, JSON.stringify({ imports: state.imports, saves: state.saves, opens: state.opens, saveDialogs: state.saveDialogs, reads: state.reads }, null, 2));
    state.persist = persistNative;
    const handlers = (ipcMain as any)._invokeHandlers;
    for (const [channel, entries] of [['studio:import', state.imports], ['studio:save', state.saves]] as const) {
      const original = handlers.get(channel);
      if (typeof original !== 'function') throw new Error('缺少真实处理器：' + channel);
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, async (...args) => {
        const entry: any = { projectId: args[1]?.id, completed: false, ...(channel === 'studio:save' ? { saveAs: !!args[2] } : {}) };
        entries.push(entry); persistNative();
        try {
          if (channel === 'studio:save' && state.holdSave) {
            state.holdSave = false; await new Promise<void>(resolve => { state.saveRelease = resolve; });
          }
          const result = await original(...args); entry.resultPath = result?.path; return result;
        } catch (error) { entry.error = String(error); throw error; }
        finally { entry.completed = true; persistNative(); }
      });
    }
    const originalRead = nativeFs.promises.readFile.bind(nativeFs.promises);
    (nativeFs.promises as any).readFile = async (...args: any[]) => {
      const file = String(args[0]), normalized = file.replaceAll('\\', '/').toLowerCase();
      if (normalized !== state.source.replaceAll('\\', '/').toLowerCase()) return (originalRead as any)(...args);
      const entry = { source: file, held: state.delayRead, completed: false }; state.reads.push(entry); persistNative();
      try {
        if (state.delayRead) { state.delayRead = false; await new Promise<void>(resolve => { state.readRelease = resolve; }); }
        return await (originalRead as any)(...args);
      } finally { entry.completed = true; persistNative(); }
    };
    dialog.showOpenDialog = (async (_window: unknown, settings: any) => {
      if (settings.title !== '选择项目外素材') throw new Error('拒绝未预设的原生打开对话框：' + settings.title);
      const canceled = state.cancelImport, filePaths = canceled ? [] : [state.source];
      state.opens.push({ title: settings.title, canceled, filePaths }); persistNative(); return { canceled, filePaths };
    }) as typeof dialog.showOpenDialog;
    dialog.showSaveDialog = (async (_window: unknown, settings: any) => {
      if (settings.title !== '保存作品') throw new Error('拒绝未预设的保存对话框：' + settings.title);
      state.saveDialogs.push({ title: settings.title, filePath: options.saveAsFile }); persistNative();
      return { canceled: false, filePath: options.saveAsFile };
    }) as typeof dialog.showSaveDialog;
    persistNative();
  }, { logFile: nativeLogFile, saveAsFile: projectBFile });
}
async function nativeLog(): Promise<NativeLog> {
  if (!app) return JSON.parse(await fs.readFile(nativeLogFile, 'utf8'));
  return app.evaluate(() => {
    const state = (globalThis as any).__sessionConcurrency;
    return { imports: state.imports, saves: state.saves, opens: state.opens, saveDialogs: state.saveDialogs, reads: state.reads };
  });
}
async function configureImport(source: string, delayRead = false, cancelImport = false) {
  await app!.evaluate((_electron, options) => {
    const state = (globalThis as any).__sessionConcurrency;
    if (state.readRelease) throw new Error('上次延迟读取尚未结束。');
    Object.assign(state, options);
  }, { source, delayRead, cancelImport });
}
async function releasePending() {
  if (!app) return;
  await app.evaluate(() => {
    const state = (globalThis as any).__sessionConcurrency;
    const readRelease = state?.readRelease, saveRelease = state?.saveRelease;
    if (state) { state.readRelease = undefined; state.saveRelease = undefined; }
    readRelease?.(); saveRelease?.();
  });
}
async function launch(file = activeFile) {
  assert.equal(app, undefined); activeFile = file;
  app = await launchDesktopFixture({ root, profile, projectFile: file, devUrl: '' }); child = app.process();
  processes.push({ launch: processes.length + 1, pid: child.pid, exited: false });
  page = await app.firstWindow(); page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  assert.equal(path.resolve(fileURLToPath(page.url())).toLowerCase(), path.join(root, 'dist/index.html').toLowerCase(), '必须使用最终统一构建。');
  await page.evaluate('globalThis.__name = value => value');
  await app.evaluate(({ BrowserWindow }) => {
    (globalThis as any).__name = (value: unknown) => value;
    const window = BrowserWindow.getAllWindows()[0]; if (window.isMaximized()) window.unmaximize();
    window.setContentSize(1280, 900); window.webContents.setBackgroundThrottling(false); window.show(); window.focus();
  });
  await page.context().tracing.start({ screenshots: true, snapshots: true, sources: false }); traceStarted = true;
  await installObservers();
  await page.locator('[data-workspace-tab="ui"]').click();
  await page.getByLabel('界面编辑模式', { exact: true }).getByRole('button', { name: '设计', exact: true }).click();
  await page.getByLabel('设计页面', { exact: true }).selectOption('main');
  const hierarchy = page.locator(`.ui-hierarchy [data-hierarchy-id="${controlId}"]`);
  await hierarchy.click(); await expect(hierarchy).toHaveAttribute('aria-selected', 'true');
}
async function closeOwned() {
  if (!app) return;
  const owned = app, ownedChild = child!; const failures: unknown[] = [];
  try { await releasePending(); }
  catch (error) { failures.push(error); report.releaseError = String(error); }
  if (traceStarted) {
    const trace = `trace-${processes.length}.zip`;
    try { await owned.context().tracing.stop({ path: path.join(output, trace) }); traces.push(trace); }
    catch (error) { failures.push(error); report.traceError = String(error); }
    traceStarted = false;
  }
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([owned.close(), new Promise<never>((_, reject) => {
      closeTimer = setTimeout(() => reject(new Error('自有验收编辑器关闭超时。')), 15000);
    })]);
  } catch (error) { failures.push(error); }
  finally { if (closeTimer) clearTimeout(closeTimer); }
  const exited = () => ownedChild.exitCode !== null || ownedChild.signalCode !== null;
  try { await expect.poll(exited, { timeout: 20000 }).toBe(true); } catch (error) { failures.push(error); }
  Object.assign(processes.at(-1)!, { exited: exited(), exitCode: ownedChild.exitCode, signalCode: ownedChild.signalCode });
  if (exited()) { app = undefined; page = undefined; child = undefined; }
  if (failures.length) throw new AggregateError(failures, '自有验收进程或trace关闭失败。');
}
async function openPicker() {
  const trigger = button('浏览图片素材'); await openDisclosureAncestors(trigger); await trigger.click(); await expect(picker()).toBeVisible();
}
async function startImport(source: string, hold = false, cancel = false) {
  await configureImport(source, hold, cancel); await openPicker();
  await picker().getByRole('button', { name: '选择项目外素材', exact: true }).click();
}
async function assertDecoded(selectedId: string) {
  await expect(canvasImage()).toHaveCount(1);
  await expect.poll(() => canvasImage().evaluate(element => ({ complete: (element as HTMLImageElement).complete, width: (element as HTMLImageElement).naturalWidth, height: (element as HTMLImageElement).naturalHeight }))).toEqual({ complete: true, width: 96, height: 72 });
  const input = page!.getByRole('combobox', { name: '图片素材', exact: true });
  await openDisclosureAncestors(input); await expect(input).toHaveValue(selectedId === firstId ? '第一张隔离图片' : '第二张隔离图片');
}
async function saveAndWait() {
  const count = (await nativeLog()).saves.length;
  await page!.keyboard.press('Control+s');
  await expect.poll(async () => { const log = await nativeLog(); return log.saves.length === count + 1 && log.saves.at(-1)?.completed; }).toBe(true);
  await expect(button('保存工程')).toBeEnabled(); await expect(page!.locator('.dirty-dot')).toHaveCount(0);
}
async function assertImportBlocksSave(source: string, uiDraft: boolean) {
  const beforeLog = await nativeLog(), beforeSession = await getSession(), beforeFile = await fs.readFile(activeFile, 'utf8');
  if (uiDraft) await expect(button('保存界面')).toBeEnabled();
  await startImport(source, true);
  await expect.poll(async () => (await nativeLog()).reads.some(entry => entry.source.toLowerCase() === source.toLowerCase() && entry.held && !entry.completed)).toBe(true);
  await expect(status()).toContainText('导入项目外素材');
  const heldEditing = {
    uiDraft,
    modal: await picker().evaluate(element => element instanceof HTMLDialogElement && element.open && element.matches(':modal')),
    externalPropertyInDialog: await page!.getByLabel('图片缩放', { exact: true }).evaluate(element => !!element.closest('dialog')),
    ordinaryEdit: '未执行；原生模态阻止外部属性的普通编辑，浏览器内搜索和筛选只改变浏览状态。',
  };
  heldEditingAvailability.push(heldEditing);
  assert.equal(heldEditing.modal, true, '延迟读取期间应保留真实素材浏览器模态。');
  assert.equal(heldEditing.externalPropertyInDialog, false, '普通图片属性应位于素材浏览器模态外。');
  await page!.keyboard.press('Control+Shift+s');
  await expect(status()).toContainText('正在导入项目外素材，请等待完成后再试。');
  // The UI response proves the shortcut ran. There is no time-based race here:
  // the source read remains gated until all absence assertions are complete.
  const during = await nativeLog(); assert.equal(during.saves.length, beforeLog.saves.length); assert.equal(during.saveDialogs.length, beforeLog.saveDialogs.length);
  const heldSession = await getSession(); sameLocation(heldSession, activeFile);
  assert.equal(heldSession.project.id, beforeSession.project.id);
  assert.deepEqual(heldSession.project.assets, beforeSession.project.assets);
  if (!uiDraft) assert.deepEqual(heldSession, beforeSession);
  // A recovery write already queued before busy became visible may update the
  // draft envelope. It must not change the active work or save its main file.
  assert.equal(await fs.readFile(activeFile, 'utf8'), beforeFile);
  await expect(picker().getByRole('button', { name: '取消', exact: true })).toBeDisabled();
  await screenshot(uiDraft ? '04-draft-import-blocks-save' : '03-clean-import-blocks-save');
  await releasePending();
  await expect(picker()).toHaveCount(0); await expect(button('保存工程')).toBeEnabled();
  const log = await nativeLog(); assert.equal(log.imports.length, beforeLog.imports.length + 1); assert.equal(log.imports.at(-1)?.completed, true);
  sameLocation(await getSession(), activeFile);
  await assertDecoded(source === firstSource ? firstId : secondId);
}
async function assertSameEventSavesOnce(uiDraft: boolean) {
  if (uiDraft) await expect(button('保存界面')).toBeEnabled();
  const before = (await nativeLog()).saves.length;
  await app!.evaluate(() => { (globalThis as any).__sessionConcurrency.holdSave = true; });
  await page!.evaluate(() => {
    const target = document.activeElement ?? document.body;
    for (let i = 0; i < 2; i++) target.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', ctrlKey: true, bubbles: true, cancelable: true }));
  });
  await expect(status()).toContainText(uiDraft ? '正在保存界面，请等待完成后再试。' : '正在保存工程，请等待完成后再试。');
  await expect.poll(async () => (await nativeLog()).saves.length).toBe(before + 1);
  await screenshot(uiDraft ? '05-same-event-ui-save' : '07-same-event-project-save');
  await releasePending();
  await expect.poll(async () => (await nativeLog()).saves.at(-1)?.completed).toBe(true);
  await expect(page!.locator('.dirty-dot')).toHaveCount(0); await expect(button('保存工程')).toBeEnabled();
  assert.equal((await nativeLog()).saves.length, before + 1);
}

await prepareOutput();
try {
  const html = await fs.readFile(path.join(root, 'dist/index.html'), 'utf8');
  const buildFiles = ['dist/index.html', 'dist-desktop/main.cjs', 'dist-desktop/preload.cjs', ...[...html.matchAll(/(?:src|href)="(\.\/assets\/[^"?#]+\.(?:js|css))"/g)].map(match => 'dist/' + match[1].slice(2))];
  assert.ok(buildFiles.some(file => file.startsWith('dist/assets/') && file.endsWith('.js')));
  report.build = await Promise.all([...new Set(buildFiles)].map(async file => ({ file, sha256: hash(await fs.readFile(path.join(root, file))) })));
  await fs.writeFile(firstSource, firstBytes); await fs.writeFile(secondSource, secondBytes); await fs.writeFile(invalidSource, firstBytes.subarray(0, 28));
  await fs.writeFile(path.join(evidenceDir, 'first-source.png'), firstBytes); await fs.writeFile(path.join(evidenceDir, 'second-source.png'), secondBytes);
  await saveProject(projectAFile, projectSchema.parse(project)); await fs.copyFile(projectAFile, path.join(evidenceDir, 'before.project.json'));
  await persist(); await launch();
  await check('项目外素材取消后释放主操作，随后普通保存成功', async () => {
    await startImport(firstSource, false, true);
    await expect.poll(async () => (await nativeLog()).imports.at(-1)?.completed).toBe(true);
    await expect(picker().getByRole('button', { name: '取消', exact: true })).toBeEnabled();
    await picker().getByRole('button', { name: '取消', exact: true }).click();
    await saveAndWait(); assert.equal((await getSession()).project.assets.length, 0); await screenshot('01-cancel-releases-operation');
  });
  await check('坏图片的真实导入失败后释放主操作，随后保存成功', async () => {
    await startImport(invalidSource);
    await expect(picker().getByRole('alert')).toBeVisible();
    await expect(picker().getByRole('button', { name: '取消', exact: true })).toBeEnabled();
    await picker().getByRole('button', { name: '取消', exact: true }).click();
    await saveAndWait(); assert.equal((await getSession()).project.assets.length, 0); await screenshot('02-failure-releases-operation');
  });
  await check('无界面草稿时延迟导入阻止Ctrl+Shift+S，工程会话及文件保持原值', () => assertImportBlocksSave(firstSource, false));
  await check('已有界面草稿时延迟导入同样阻止Ctrl+Shift+S，导入完成自动选用图片', () => assertImportBlocksSave(secondSource, true));
  await check('同一事件周期两次Ctrl+S只发一次界面保存，保存后导入和引用齐全', async () => {
    await assertSameEventSavesOnce(true);
    const saved = await readProject(); assert.equal(saved.ui.components.find(item => item.id === controlId)?.assetId, secondId);
    assert.deepEqual(new Set(saved.assets.map(item => item.id)), new Set([firstId, secondId]));
    await fs.copyFile(activeFile, path.join(evidenceDir, 'a-after-import.project.json'));
  });
  await check('导入结束后另存为成功，两项相对素材都复制至新工程目录', async () => {
    const count = (await nativeLog()).saves.length; await page!.keyboard.press('Control+Shift+s');
    await expect.poll(async () => { const log = await nativeLog(); return log.saves.length === count + 1 && log.saves.at(-1)?.completed; }).toBe(true);
    await expect(button('保存工程')).toBeEnabled(); sameLocation(await getSession(), projectBFile); activeFile = projectBFile;
    const saved = await readProject(); assert.equal(saved.id, project.id); assert.equal(saved.ui.components.find(item => item.id === controlId)?.assetId, secondId);
    for (const [id, bytes] of [[firstId, firstBytes], [secondId, secondBytes]] as const) {
      const asset = saved.assets.find(item => item.id === id); assert.ok(asset && !asset.externalPath);
      const file = path.resolve(projectBDir, asset.path); assert.ok(inside(projectBDir, file)); assert.deepEqual(await fs.readFile(file), bytes);
    }
    await assertDecoded(secondId); await fs.copyFile(activeFile, path.join(evidenceDir, 'b-save-as.project.json')); await screenshot('06-save-as-copied-assets');
  });
  await check('同一事件周期两次Ctrl+S也只发一次普通工程保存', () => assertSameEventSavesOnce(false));
  await check('放弃界面草稿后继续打开工程，操作锁先释放再执行后续打开', async () => {
    const fit = page!.getByLabel('图片缩放', { exact: true });
    await openDisclosureAncestors(fit); await fit.selectOption('stretch');
    await expect(button('保存界面')).toBeEnabled();
    await button('打开工程').click();
    const leave = page!.getByRole('dialog', { name: '保存界面修改', exact: true }); await expect(leave).toBeVisible();
    await app!.evaluate(({ dialog }, file) => {
      const original = dialog.showOpenDialog;
      dialog.showOpenDialog = (async (...args: any[]) => {
        const options = args.at(-1);
        if (options.title === '打开作品') {
          const state = (globalThis as any).__sessionConcurrency;
          state.opens.push({ title: options.title, canceled: false, filePaths: [file] });
          state.persist();
          return { canceled: false, filePaths: [file] };
        }
        return (original as any)(...args);
      }) as typeof dialog.showOpenDialog;
    }, projectAFile);
    // Project A also contains the two imports but the UI accepts its own first
    // saved location. Reopening it exercises the actual continuation and IPC.
    await leave.getByRole('button', { name: '不保存', exact: true }).click();
    await expect(leave).toHaveCount(0);
    await expect.poll(async () => (await getSession()).path?.toLowerCase()).toBe(projectAFile.toLowerCase());
    await expect(button('保存工程')).toBeEnabled(); await expect(page!.locator('.dirty-dot')).toHaveCount(0);
    activeFile = projectAFile; await screenshot('08-discard-continues-open');
  });
  await check('关闭并重开另存工程，界面图片与资源详情实际解码成功', async () => {
    await closeOwned(); await launch(projectBFile); sameLocation(await getSession(), projectBFile); await assertDecoded(secondId);
    await expect(page!.locator('.dirty-dot')).toHaveCount(0); await screenshot('08-reopened-canvas');
    await page!.locator('[data-workspace-tab="assets"]').click();
    const browser = page!.getByRole('region', { name: '资源管理器', exact: true }).filter({ visible: true });
    await browser.getByLabel('资源显示范围', { exact: true }).selectOption('all');
    const card = browser.locator(`[data-content-key="asset:${secondId}"]`); await card.dblclick();
    const detail = page!.getByRole('dialog', { name: '资源详情 第二张隔离图片', exact: true }); await expect(detail).toBeVisible();
    await expect.poll(() => detail.locator('img').evaluate(element => ({ complete: (element as HTMLImageElement).complete, width: (element as HTMLImageElement).naturalWidth, height: (element as HTMLImageElement).naturalHeight }))).toEqual({ complete: true, width: 96, height: 72 });
    await screenshot('09-reopened-resource-detail'); await detail.getByRole('button', { name: '关闭资源预览', exact: true }).click();
    await fs.copyFile(activeFile, path.join(evidenceDir, 'b-reopened.project.json'));
  });
  assert.deepEqual(errors, []); assert.equal(checks.length, 9); report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error instanceof Error ? error.stack : String(error); process.exitCode = 1;
  await screenshot('failure').catch(() => undefined);
} finally {
  try { await closeOwned(); } catch (error) { report.status = 'failed'; report.closeError = String(error); process.exitCode = 1; }
  try {
    if (app || processes.some(item => !item.exited)) throw new Error('尚未确认自有验收进程退出，保留临时目录。');
    const cleanup = await cleanVerificationDirectories(output, ['project-a', 'project-b', 'profile', 'temp']); report.cleanup = cleanup; assert.deepEqual(cleanup.errors, []);
  } catch (error) { report.status = 'failed'; report.cleanupError = String(error); process.exitCode = 1; }
  await persist(); console.log((report.status === 'passed' ? 'PASS: ' : 'FAIL: ') + path.join(output, 'report.json'));
  if (report.error) console.error(report.error);
}
