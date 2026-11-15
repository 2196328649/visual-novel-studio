import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createProject, projectSchema, type Project, type UiComponent } from '../src/core/model';
import { createUiEventGraph } from '../src/core/ui-logic';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openDisclosureAncestors } from './lib/ui-disclosures';
import { openUiPageOptions } from './lib/ui-design-controls';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

// Pending acceptance: implement everything, build once in the coordinating chat,
// then run this script serially. It never builds, starts Vite/a game, accesses the
// real author's project, scans historical artifacts, or launches external AI.
if (process.env.VNS_INSTALLED_EXE) throw new Error('会话验收仅允许隔离的源码构建版。');
if (process.env.VNS_TEST_ROOT) throw new Error('请清除 VNS_TEST_ROOT，原生保存必须使用本次 A/B 文件。');
const root = path.resolve('.');
assert.equal(root.toLowerCase(), path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..').toLowerCase(), '请从 editor 工作区运行。');
const roundRoot = path.resolve(root, 'artifacts/overall-review-2026-11-13');
const sessionRoot = path.resolve(roundRoot, 'session-editor');
const requestedRoot = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? sessionRoot);
assert.ok([roundRoot, sessionRoot].some(candidate => candidate.toLowerCase() === requestedRoot.toLowerCase()),
  'VNS_ARTIFACT_ROOT 必须是本轮 overall-review-2026-11-13 或其 session-editor 目录。');
const output = path.resolve(sessionRoot, new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const projectADir = path.resolve(output, 'project-a'), projectBDir = path.resolve(output, 'project-b'), profile = path.resolve(output, 'profile');
const screenshotDir = path.resolve(output, 'screenshots'), evidenceDir = path.resolve(output, 'saved-project-evidence');
const inside = (parent: string, child: string) => {
  const relative = path.relative(parent, child);
  return !!relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};
assert.ok(inside(root, output) && inside(sessionRoot, output));
for (const target of [projectADir, projectBDir, profile, screenshotDir, evidenceDir]) assert.ok(inside(output, target), '产物必须位于本次唯一目录：' + target);

const ids = {
  set: 'session_parameters', rename: 'session_parameter_name', title: 'session_common_title',
  schemeA: 'session_scheme_a', schemeB: 'session_scheme_b', onlyA: 'session_only_a', onlyB: 'session_only_b',
  baseGraphA: 'session_base_graph_a', activeGraphA: 'session_active_graph_a', activeGraphB: 'session_active_graph_b',
  input: 'session_linked_input', originalInput: 'session_input_original', inputText: 'session_input_text',
  length3: 'session_input_length_3', length1: 'session_input_length_1',
};
const labels = {
  parameterAfter: '原生关闭提交的参数名', uiTextAfter: '原生关闭合并的界面文字', uiNameAfter: '原生关闭提交的控件名',
  directoryAfter: 'resources/session-assets', unfinished: '尚未创建的变量表单',
  bSaved: '工程 B 活动方案保存后的文字', bRecovered: '工程 B 活动方案恢复草稿的文字', rejected: '不得残留的短长度参数',
};
interface Fixture { project: Project; file: string }
function fixture(which: 'A' | 'B'): Fixture {
  const project = createProject('整体会话验收工程 ' + which);
  project.id = 'overall_session_' + which.toLowerCase(); project.width = 1280; project.height = 720;
  project.assets = []; project.ui.customPages = []; project.blueprints = [];
  project.resourceSettings = { importMode: 'copy', directory: 'assets', syncFolders: false };
  project.parameterSets = [{ id: ids.set, name: '会话参数', kind: 'story', defaults: { persistent: false, resetWithSettings: false } }];
  project.variables = [{ id: ids.rename, name: '原参数名称', type: 'string', initial: '', persistent: false, parameterSetId: ids.set }];
  const title: UiComponent = { id: ids.title, name: which + ' 基础标题控件', kind: 'text', page: 'main', text: '工程 ' + which + ' 基础标题', x: .1, y: .12, width: .7, height: .13 };
  project.ui.components = [title];
  project.ui.pages = { main: { layout: 'custom' }, preferences: { layout: 'custom' } };
  // The A base graph must be authored BEFORE setting activeInstanceId: inspecting
  // this resource sets the temporary UI preview override to the empty string.
  if (which === 'A') {
    const base = createUiEventGraph(project, 'ui:main', '工程 A 基础界面入口'); base.id = ids.baseGraphA;
    assert.equal(base.uiInstanceId, 'base');
  } else {
    project.variables.push(
      { id: ids.originalInput, name: '保留的输入默认来源', type: 'string', initial: '', persistent: false, parameterSetId: ids.set },
      { id: ids.inputText, name: '三个 Unicode 字符', type: 'string', initial: '你😀好', persistent: false, parameterSetId: ids.set },
      { id: ids.length3, name: '当前长度三', type: 'number', initial: 3, persistent: false, parameterSetId: ids.set },
      { id: ids.length1, name: '短长度一', type: 'number', initial: 1, persistent: false, parameterSetId: ids.set },
    );
    project.ui.components.push({ id: ids.input, name: '组合属性输入框', kind: 'preferenceChoice', page: 'preferences', text: '输入文字',
      parameterId: ids.originalInput, input: { maxLength: 1, placeholder: '输入内容' }, x: .12, y: .2, width: .7, height: .14,
      propertyControls: { stringValue: { mode: 'sync', parameterId: ids.inputText }, maxLength: { mode: 'follow', parameterId: ids.length3 } } });
  }
  const schemeId = which === 'A' ? ids.schemeA : ids.schemeB;
  project.ui.instances = [{ id: schemeId, name: '工程 ' + which + ' 活动方案', components: [
    { ...title, name: which + ' 活动标题控件', text: '工程 ' + which + ' 活动标题' },
    { id: which === 'A' ? ids.onlyA : ids.onlyB, name: which + ' 活动方案独有控件', kind: 'text', page: 'main', text: which + ' 专有控件可见', x: .1, y: .4, width: .7, height: .13 },
  ] }];
  project.ui.activeInstanceId = schemeId;
  const activeGraph = createUiEventGraph(project, 'ui:main', '工程 ' + which + ' 活动界面入口');
  activeGraph.id = which === 'A' ? ids.activeGraphA : ids.activeGraphB;
  return { project: projectSchema.parse(project), file: path.resolve(which === 'A' ? projectADir : projectBDir, 'project.vns.json') };
}
const fixtureA = fixture('A'), fixtureB = fixture('B');
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const read = async (fixture: Fixture) => projectSchema.parse(JSON.parse(await fs.readFile(fixture.file, 'utf8')));
const bytes = (fixture: Fixture) => fs.readFile(fixture.file, 'utf8');
const recovery = async (fixture: Fixture) => JSON.parse(await fs.readFile(fixture.file + '.autosave', 'utf8')) as { project: Project; uiDraft?: Project; projectDirty?: boolean };
const localComponent = (project: Project, schemeId: string, componentId: string) => {
  const item = project.ui.instances?.find(scheme => scheme.id === schemeId)?.components.find(component => component.id === componentId);
  assert.ok(item, '预期方案控件必须存在：' + schemeId + '/' + componentId); return item;
};
const variableName = (project: Project, id: string) => project.variables.find(variable => variable.id === id)?.name;
interface NativeSnapshot { dirty: boolean; project: Project }
interface NativeLog {
  closeRequests: { snapshot: NativeSnapshot | null; completed?: boolean }[];
  dialogs: { title: string; message: string; buttons: string[]; response: number }[];
  opens: { title: string; filePaths: string[] }[];
}
const checks: { name: string; durationMs: number }[] = [], errors: string[] = [];
const processes: { launch: number; pid?: number; exited: boolean }[] = [];
const childProcesses = new WeakMap<ElectronApplication, ReturnType<ElectronApplication['process']>>();
function ownedProcess(owned: ElectronApplication) {
  const child = childProcesses.get(owned); assert.ok(child, '必须在窗口退出前保存自有子进程。'); return child;
}
const traces: string[] = [], screenshots: { file: string; width: number; height: number }[] = [];
const savedEvidence: string[] = [], nativeLogs: string[] = [];
const evidence: Record<string, unknown> = {};
const report: Record<string, unknown> = { status: 'running', renderer: 'compiled source editor', checks, errors, processes, traces, screenshots, savedEvidence, nativeLogs, evidence,
  temporaryPaths: [projectADir, projectBDir, profile],
  limits: ['只使用本次 A/B 新工程及 profile；不读取真实作者工程或历史 artifacts。', '原生对话框仅替换操作系统选择，studio:open/close-save 保留真实处理器。', '截图最长边不超过 1280 像素；保留报告、trace、原生请求及保存工程证据。'] };
let app: ElectronApplication | undefined, page: Page | undefined, active = fixtureA;
let launchNumber = 0, traceRunning = false, phase = '准备', failure: unknown, nativeLogFile = '';
const button = (name: string) => page!.getByRole('button', { name, exact: true });
const mode = (name: string) => page!.getByLabel('界面编辑模式', { exact: true }).getByRole('button', { name, exact: true });
const hierarchy = (id: string) => page!.locator(`.ui-hierarchy [data-hierarchy-id="${id}"]`);
const inspector = () => page!.locator('.ui-inspector-view:not([hidden])');
const propertyField = (property: string) => inspector().locator(`.field[data-ui-property="${property}"]`);
const source = (property: string) => propertyField(property).locator('.ui-property-control-value');
const propertyDialog = () => page!.getByRole('dialog', { name: '属性控制设置', exact: true });
const propertyMenu = () => page!.getByRole('menu', { name: '属性控制菜单', exact: true });
const persistReport = () => fs.writeFile(path.resolve(output, 'report.json'), JSON.stringify(report, null, 2));
const settle = () => page!.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
async function check(name: string, work: () => Promise<void>) {
  phase = name; const start = Date.now(); await work(); checks.push({ name, durationMs: Date.now() - start });
  await persistReport(); console.log('通过：' + name);
}
async function buildFingerprints() {
  const html = await fs.readFile(path.resolve(root, 'dist/index.html'), 'utf8');
  const files = ['dist/index.html', 'dist-desktop/main.cjs', 'dist-desktop/preload.cjs',
    ...[...html.matchAll(/(?:src|href)="(\.\/assets\/[^"?#]+\.(?:js|css))"/g)].map(match => 'dist/' + match[1].slice(2))];
  assert.ok(files.some(file => file.startsWith('dist/assets/') && file.endsWith('.js')), '必须先完成统一构建。');
  return Promise.all([...new Set(files)].map(async file => ({ file, sha256: hash(await fs.readFile(path.resolve(root, file))) })));
}
async function saveEvidence(name: string, fixture = active) {
  const file = path.resolve(evidenceDir, name + '.json'); await fs.writeFile(file, JSON.stringify(await read(fixture), null, 2));
  savedEvidence.push(path.relative(output, file)); return file;
}
async function screenshot(name: string) {
  assert.ok(app && page && !page.isClosed());
  // Native capture avoids touching DOM focus in the regression's critical interval.
  const capture = await app.evaluate(async ({ BrowserWindow }, url) => {
    const window = BrowserWindow.getAllWindows().find(item => item.webContents.getURL() === url); if (!window) throw new Error('未找到自有验收窗口。');
    let image = await window.webContents.capturePage(); const original = image.getSize(), factor = Math.min(1, 1280 / Math.max(original.width, original.height));
    if (factor < 1) image = image.resize({ width: Math.max(1, Math.round(original.width * factor)), height: Math.max(1, Math.round(original.height * factor)), quality: 'good' });
    return { png: image.toPNG().toString('base64'), ...image.getSize() };
  }, page.url());
  assert.ok(Math.max(capture.width, capture.height) <= 1280);
  const file = path.resolve(screenshotDir, name + '.png'); await fs.writeFile(file, Buffer.from(capture.png, 'base64'));
  screenshots.push({ file: path.relative(output, file), width: capture.width, height: capture.height });
}
async function stopTrace(reason: string) {
  if (!traceRunning || !page) return;
  const file = 'trace-' + String(launchNumber).padStart(2, '0') + '-' + reason + '.zip';
  await page.context().tracing.stop({ path: path.resolve(output, file) }); traces.push(file); traceRunning = false;
}
async function installNativeObservers() {
  nativeLogFile = path.resolve(output, 'native-session-' + String(launchNumber).padStart(2, '0') + '.json'); nativeLogs.push(path.relative(output, nativeLogFile));
  await app!.evaluate(async ({ dialog, ipcMain }, logFile) => {
    const nativeFs = process.getBuiltinModule('fs');
    const state = (globalThis as any).__overallSession = {
      response: 2, hold: false, release: undefined as undefined | (() => void), openFile: '',
      closeRequests: [] as NativeLog['closeRequests'], dialogs: [] as NativeLog['dialogs'], opens: [] as NativeLog['opens'],
    };
    // Synchronous writes finish before a saved window can exit. Live observers
    // therefore never read a truncated JSON file during the close handshake.
    const persist = () => nativeFs.writeFileSync(logFile, JSON.stringify({ closeRequests: state.closeRequests, dialogs: state.dialogs, opens: state.opens }, null, 2));
    const originalClose = (ipcMain as any)._invokeHandlers.get('studio:close-save');
    if (typeof originalClose !== 'function') throw new Error('未找到真实 studio:close-save 处理器。');
    ipcMain.removeHandler('studio:close-save');
    ipcMain.handle('studio:close-save', async (...args) => {
      const entry = { snapshot: args[1], completed: false }; state.closeRequests.push(entry); persist();
      const result = await originalClose(...args); entry.completed = true; persist(); return result;
    });
    dialog.showMessageBox = (async (_window: unknown, options: any) => {
      const response = state.response;
      state.dialogs.push({ title: options.title, message: options.message, buttons: options.buttons ?? [], response }); persist();
      if (options.title !== '保存工程') return { response: 0, checkboxChecked: false };
      if (state.hold) await new Promise<void>(resolve => { state.release = resolve; });
      return { response, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
    dialog.showOpenDialog = (async (_window: unknown, options: any) => {
      if (options.title !== '打开作品' || !state.openFile) throw new Error('未预设打开作品路径，拒绝其他原生选择。');
      const filePaths = [state.openFile]; state.opens.push({ title: options.title, filePaths }); persist();
      return { canceled: false, filePaths };
    }) as typeof dialog.showOpenDialog;
    persist();
  }, nativeLogFile);
}
async function launch(fixture = active) {
  assert.equal(app, undefined, '旧夹具必须先退出。'); active = fixture;
  app = await launchDesktopFixture({ root, projectFile: fixture.file, profile, devUrl: '', confirmClose: true }); launchNumber++;
  childProcesses.set(app, app.process());
  processes.push({ launch: launchNumber, pid: ownedProcess(app).pid, exited: false });
  page = await app.firstWindow(); page.setDefaultTimeout(18000); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(fixture.project.name, { timeout: 45000 });
  assert.equal(path.resolve(fileURLToPath(page.url())), path.resolve(root, 'dist/index.html'), '必须加载完成后的 dist。');
  await page.evaluate('globalThis.__name = value => value');
  await app.evaluate(({ BrowserWindow }) => {
    (globalThis as any).__name = (value: unknown) => value;
    const window = BrowserWindow.getAllWindows()[0]; if (window.isMinimized()) window.restore(); if (window.isMaximized()) window.unmaximize();
    window.setContentSize(1280, 900); window.webContents.setBackgroundThrottling(false); window.show(); window.focus();
  });
  await expect.poll(() => page!.evaluate(() => Math.max(Math.abs(innerWidth - 1280), Math.abs(innerHeight - 900)))).toBeLessThanOrEqual(2);
  await page.context().tracing.start({ screenshots: true, snapshots: true, sources: false }); traceRunning = true;
  await installNativeObservers(); report.rendererUrl = page.url();
}
async function markExited(owned: ElectronApplication) {
  const child = ownedProcess(owned); await expect.poll(() => child.exitCode !== null || child.signalCode !== null, { timeout: 20000 }).toBe(true);
  const processRecord = processes.find(item => item.launch === launchNumber); assert.ok(processRecord); processRecord.exited = true;
  app = undefined; page = undefined;
}
async function closeOwned() {
  if (!app) return; const owned = app; let traceFailure: unknown;
  try { await stopTrace('teardown'); } catch (error) { traceFailure = error; report.traceError = String(error); traceRunning = false; }
  try { await owned.close(); } finally { await markExited(owned); }
  if (traceFailure) throw traceFailure;
}
const nativeLog = async (): Promise<NativeLog> => {
  // While the owned process is alive, serialize the in-memory record on its
  // event loop. After exit, the synchronously persisted file is the evidence.
  if (app && ownedProcess(app).exitCode === null && ownedProcess(app).signalCode === null) {
    return app.evaluate(() => { const state = (globalThis as any).__overallSession; return { closeRequests: state.closeRequests, dialogs: state.dialogs, opens: state.opens }; });
  }
  return JSON.parse(await fs.readFile(nativeLogFile, 'utf8'));
};
async function requestNativeClose(response: 0 | 1 | 2, hold = false) {
  await app!.evaluate(({ BrowserWindow }, options) => {
    const state = (globalThis as any).__overallSession; state.response = options.response; state.hold = options.hold; state.release = undefined;
    const windows = BrowserWindow.getAllWindows(); if (windows.length !== 1) throw new Error('仅允许关闭本次单个夹具窗口。'); windows[0].close();
  }, { response, hold });
}
async function cancelNativeClose(verify: (snapshot: NativeSnapshot) => void) {
  const before = await nativeLog(); await requestNativeClose(2);
  await expect.poll(async () => { const log = await nativeLog(); return log.closeRequests.length === before.closeRequests.length + 1 && log.closeRequests.at(-1)?.completed; }, { timeout: 15000 }).toBe(true);
  const after = await nativeLog(); assert.equal(after.closeRequests.length, before.closeRequests.length + 1); assert.equal(after.dialogs.length, before.dialogs.length + 1);
  assert.deepEqual(after.dialogs.at(-1)?.buttons, ['保存', '不保存', '取消']); assert.equal(after.dialogs.at(-1)?.title, '保存工程'); assert.equal(after.dialogs.at(-1)?.response, 2);
  const snapshot = after.closeRequests.at(-1)?.snapshot; assert.ok(snapshot && snapshot.dirty); verify(snapshot);
  assert.ok(app && !page!.isClosed() && ownedProcess(app).exitCode === null, '取消必须保留自有窗口。'); await expect(page!.locator('.dirty-dot')).toHaveCount(1);
  return after;
}
async function saveViaNativeClose(verify: (snapshot: NativeSnapshot) => void) {
  const owned = app!; const before = await nativeLog(); await requestNativeClose(0, true);
  await expect.poll(async () => (await nativeLog()).dialogs.length).toBe(before.dialogs.length + 1);
  const log = await nativeLog(), snapshot = log.closeRequests.at(-1)?.snapshot;
  assert.ok(snapshot && snapshot.dirty); assert.equal(log.closeRequests.length, before.closeRequests.length + 1);
  assert.equal(log.dialogs.at(-1)?.title, '保存工程'); assert.equal(log.dialogs.at(-1)?.response, 0); verify(snapshot);
  await stopTrace('native-save-close');
  await owned.evaluate(() => { const state = (globalThis as any).__overallSession; if (!state.release) throw new Error('原生保存提示尚未等待响应。'); state.release(); });
  await markExited(owned);
  await expect.poll(async () => fs.stat(active.file + '.autosave').then(() => false).catch(error => { if (error.code === 'ENOENT') return true; throw error; })).toBe(true);
}
async function openDesign(pageId = 'main') {
  await page!.locator('[data-workspace-tab="ui"]').click(); await mode('设计').click();
  await page!.getByLabel('设计页面', { exact: true }).selectOption(pageId); await settle();
}
async function selectControl(id: string) { await hierarchy(id).click(); await expect(hierarchy(id)).toHaveAttribute('aria-selected', 'true'); }
async function revealEventDirectory() {
  const rail = button('展开事件图左栏'); if (await rail.isVisible()) await rail.click();
  const toggle = page!.locator('.ui-event-sidebar:visible .ui-event-directory-toggle');
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  await expect(page!.locator('.ui-event-directory-scroll:visible')).toHaveCount(1);
}
async function inspectScheme(expected: string) {
  const menu = await openUiPageOptions(page!, '界面方案'); await expect(menu.getByLabel('选择界面实例', { exact: true })).toHaveValue(expected);
  const text = await menu.locator('.ui-scheme-options > summary').innerText(); await menu.getByRole('button', { name: '关闭页面选项', exact: true }).click(); return text;
}
async function editText(value: string) {
  const field = inspector().getByLabel('文字', { exact: true }); await openDisclosureAncestors(field); await field.fill(value); await field.press('Tab'); await settle();
}
async function saveUi() {
  await button('保存界面').click(); await expect(button('保存界面')).toBeDisabled({ timeout: 45000 });
  await expect(page!.locator('.dirty-dot')).toHaveCount(0); return read(active);
}
async function selectParameter() {
  await page!.locator('[data-workspace-tab="variables"]').click();
  const workspace = page!.locator('.parameter-sets-workspace'), back = workspace.getByRole('button', { name: '参数集', exact: true });
  if (await back.count()) await back.click(); await workspace.locator(`[data-parameter-set-id="${ids.set}"]`).click();
  await workspace.locator(`[data-parameter-id="${ids.rename}"]`).click(); return page!.getByRole('complementary', { name: '参数设置', exact: true }).getByLabel('参数名称', { exact: true });
}
async function inspectABaseResource() {
  const before = await bytes(fixtureA); await page!.locator('[data-workspace-tab="assets"]').click();
  const browser = page!.getByRole('region', { name: '资源管理器', exact: true });
  await browser.getByLabel('搜索资源和蓝图', { exact: true }).fill('工程 A 基础界面入口');
  await browser.locator(`[data-content-key="blueprint:${ids.baseGraphA}"]`).dblclick();
  await expect(page!.getByLabel('事件图页面', { exact: true })).toHaveValue('ui:main');
  await expect(page!.getByLabel('当前页面事件图', { exact: true })).toHaveValue(ids.baseGraphA);
  await expect(page!.getByLabel('选择界面实例', { exact: true })).toHaveValue('');
  await mode('设计').click(); await expect(page!.getByLabel('设计页面', { exact: true })).toHaveValue('main');
  assert.ok((await inspectScheme('')).includes('基础界面'));
  await expect(hierarchy(ids.onlyA)).toHaveCount(0); await expect(page!.locator(`.ui-canvas [data-component-id="${ids.title}"]`)).toContainText('工程 A 基础标题');
  assert.equal(await bytes(fixtureA), before); assert.equal((await read(fixtureA)).ui.activeInstanceId, ids.schemeA); await expect(page!.locator('.dirty-dot')).toHaveCount(0);
}
async function openProjectB() {
  await app!.evaluate((_electron, file) => { (globalThis as any).__overallSession.openFile = file; }, fixtureB.file);
  await button('打开工程').click(); await expect(page!.locator('.project-title strong')).toHaveText(fixtureB.project.name, { timeout: 45000 }); active = fixtureB;
  const log = await nativeLog(); assert.deepEqual(log.opens.at(-1), { title: '打开作品', filePaths: [fixtureB.file] });
  // The actual main-process open handler must update its session too. A renderer
  // bridge replacement would not prove adoption or subsequent save destination.
  await openDesign(); assert.ok((await inspectScheme(ids.schemeB)).includes('工程 B 活动方案'));
  await expect(hierarchy(ids.onlyB)).toBeVisible(); await expect(hierarchy(ids.onlyA)).toHaveCount(0);
  await expect(page!.locator(`.ui-canvas [data-component-id="${ids.onlyB}"]`)).toContainText('B 专有控件可见');
}
async function revealProperty(property: string) {
  const field = propertyField(property); await expect(field).toHaveCount(1); await openDisclosureAncestors(field); await field.scrollIntoViewIfNeeded(); return field;
}
async function openPropertyMenu(property: string) {
  await (await revealProperty(property)).locator('.field-label').click({ button: 'right' }); await expect(propertyMenu()).toBeVisible();
}
async function openPropertyDialog(property: string) {
  await openPropertyMenu(property); await propertyMenu().getByRole('menuitem', { name: '关联参数…', exact: true }).click(); await expect(propertyDialog()).toBeVisible();
}
async function assertCombinationUnchanged(before: Project) {
  await expect(button('保存界面')).toBeDisabled(); await expect(page!.locator('.dirty-dot')).toHaveCount(0); assert.deepEqual(await read(fixtureB), before);
  const scheme = before.ui.instances!.find(instance => instance.id === ids.schemeB)!; assert.equal(scheme.components.some(component => component.id === ids.input), false, '拒绝操作不能创建继承覆盖。');
}

try {
  await fs.mkdir(output, { recursive: true });
  for (const dir of [projectADir, projectBDir, screenshotDir, evidenceDir]) await fs.mkdir(dir, { recursive: true });
  report.buildBefore = await buildFingerprints();
  await saveProject(fixtureA.file, fixtureA.project); await saveProject(fixtureB.file, fixtureB.project);
  await saveEvidence('00-a-authored', fixtureA); await saveEvidence('00-b-authored', fixtureB); await launch(fixtureA);

  await check('已保存工程仅填写聚焦参数名，原生关闭取消会提交失焦并询问保存', async () => {
    const before = await bytes(fixtureA), field = await selectParameter(); await expect(page!.locator('.dirty-dot')).toHaveCount(0);
    await field.fill(labels.parameterAfter); await expect(field).toBeFocused(); await expect(page!.locator('.dirty-dot')).toHaveCount(0);
    assert.equal(variableName(await read(fixtureA), ids.rename), '原参数名称'); assert.equal(await bytes(fixtureA), before);
    await screenshot('01-focused-parameter-before-native-close'); await expect(field).toBeFocused();
    evidence.focusedParameter = await cancelNativeClose(snapshot => { assert.equal(snapshot.project.id, fixtureA.project.id); assert.equal(variableName(snapshot.project, ids.rename), labels.parameterAfter); });
    assert.equal(await bytes(fixtureA), before); await expect(field).toHaveValue(labels.parameterAfter); await screenshot('02-native-cancel-keeps-parameter-edit');
  });
  await check('参数失焦提交后的第二次原生关闭保存，写入正确文件并退出，重开保留新名', async () => {
    await saveViaNativeClose(snapshot => assert.equal(variableName(snapshot.project, ids.rename), labels.parameterAfter));
    assert.equal(variableName(await read(fixtureA), ids.rename), labels.parameterAfter); await saveEvidence('01-a-native-parameter-saved', fixtureA);
    await launch(fixtureA); await expect(await selectParameter()).toHaveValue(labels.parameterAfter); await expect(page!.locator('.dirty-dot')).toHaveCount(0);
    await screenshot('03-reopened-parameter-name');
  });
  await check('已有界面草稿与聚焦层级重命名通过真实原生关闭一并提交，取消保持磁盘原文', async () => {
    const before = await bytes(fixtureA); await openDesign(); await selectControl(ids.title); await editText(labels.uiTextAfter); await expect(button('保存界面')).toBeEnabled();
    await hierarchy(ids.title).press('F2'); const name = hierarchy(ids.title).getByLabel('控件名称', { exact: true });
    await name.fill(labels.uiNameAfter); await expect(name).toBeFocused(); assert.equal(await bytes(fixtureA), before);
    await screenshot('04-ui-draft-and-focused-hierarchy-name'); await expect(name).toBeFocused();
    evidence.focusedUiDraft = await cancelNativeClose(snapshot => { const component = localComponent(snapshot.project, ids.schemeA, ids.title); assert.equal(component.name, labels.uiNameAfter); assert.equal(component.text, labels.uiTextAfter); assert.equal(snapshot.project.ui.activeInstanceId, ids.schemeA); });
    assert.equal(await bytes(fixtureA), before); await expect(hierarchy(ids.title)).toContainText(labels.uiNameAfter); await expect(button('保存界面')).toBeEnabled(); await screenshot('05-cancel-keeps-merged-ui-draft');
  });
  await check('原生关闭保存合并界面草稿及层级失焦名称，基础界面不变且重开无恢复副本', async () => {
    await saveViaNativeClose(snapshot => { const component = localComponent(snapshot.project, ids.schemeA, ids.title); assert.equal(component.name, labels.uiNameAfter); assert.equal(component.text, labels.uiTextAfter); });
    const saved = await read(fixtureA); assert.equal(localComponent(saved, ids.schemeA, ids.title).name, labels.uiNameAfter); assert.equal(localComponent(saved, ids.schemeA, ids.title).text, labels.uiTextAfter);
    assert.deepEqual(saved.ui.components, fixtureA.project.ui.components); await saveEvidence('02-a-native-ui-saved', fixtureA);
    await launch(fixtureA); await openDesign(); await selectControl(ids.title); await expect(page!.locator('.ui-inspector').getByLabel('控件显示名称', { exact: true })).toHaveValue(labels.uiNameAfter);
    const text = inspector().getByLabel('文字', { exact: true }); await openDisclosureAncestors(text); await expect(text).toHaveValue(labels.uiTextAfter); await expect(button('保存界面')).toBeDisabled(); await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  });
  await check('作品设置资源文件夹保持聚焦时原生关闭仍读取失焦提交，取消及保存目的地正确', async () => {
    const before = await bytes(fixtureA); await button('作品设置').click(); const settings = page!.getByRole('dialog', { name: '作品设置', exact: true });
    await settings.getByRole('button', { name: '资源管理', exact: true }).click(); const field = settings.getByLabel('项目资源文件夹', { exact: true });
    await field.fill(labels.directoryAfter); await expect(field).toBeFocused(); await expect(page!.locator('.dirty-dot')).toHaveCount(0); await screenshot('06-focused-resource-directory'); await expect(field).toBeFocused();
    evidence.focusedResources = await cancelNativeClose(snapshot => assert.equal(snapshot.project.resourceSettings?.directory, labels.directoryAfter)); assert.equal(await bytes(fixtureA), before);
    await saveViaNativeClose(snapshot => assert.equal(snapshot.project.resourceSettings?.directory, labels.directoryAfter));
    assert.equal((await read(fixtureA)).resourceSettings?.directory, labels.directoryAfter); await saveEvidence('03-a-native-resource-directory-saved', fixtureA); await launch(fixtureA);
  });
  await check('未提交的新建变量表单失焦不会自动创建变量，干净工程原生关闭无需保存提示', async () => {
    const before = await bytes(fixtureA); await openDesign(); await mode('事件图').click(); await page!.getByLabel('事件图页面', { exact: true }).selectOption('ui:main'); await revealEventDirectory();
    const variables = page!.locator('.ui-event-directory-scroll').getByRole('region', { name: '蓝图变量', exact: true });
    const fold = variables.locator(':scope > .ui-library-heading .ui-library-toggle'); if (await fold.getAttribute('aria-expanded') === 'false') await fold.click();
    await variables.getByLabel('状态列表作用域', { exact: true }).selectOption('project'); await variables.getByRole('button', { name: '新建变量', exact: true }).click();
    const form = page!.locator('.ui-event-detail:visible').getByRole('form', { name: '创建状态变量', exact: true }); const field = form.getByLabel('变量名称', { exact: true });
    await field.fill(labels.unfinished); await expect(field).toBeFocused(); await expect(form.getByRole('button', { name: '创建变量', exact: true })).toBeEnabled(); await expect(page!.locator('.dirty-dot')).toHaveCount(0);
    await screenshot('07-unsubmitted-variable-form'); await expect(field).toBeFocused(); await stopTrace('unfinished-variable-close'); await expect(field).toBeFocused(); const owned = app!; await requestNativeClose(0); await markExited(owned);
    const log = await nativeLog(); assert.equal(log.dialogs.length, 0); assert.equal(log.closeRequests.length, 1); assert.equal(log.closeRequests[0].snapshot?.dirty, false);
    assert.equal(log.closeRequests[0].snapshot?.project.variables.some(variable => variable.name === labels.unfinished), false); assert.equal(await bytes(fixtureA), before); evidence.unfinishedVariable = log;
    await launch(fixtureA); assert.equal((await read(fixtureA)).variables.some(variable => variable.name === labels.unfinished), false); await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  });
  await check('资源管理器检查 A 基础事件图仅改变预览方案，真实打开 B 使用 B 活动方案和专有控件', async () => {
    await inspectABaseResource(); await screenshot('08-a-base-preview-active-scheme-remains-on-disk'); const beforeA = await bytes(fixtureA), beforeB = await bytes(fixtureB);
    await openProjectB(); await expect(page!.locator('.dirty-dot')).toHaveCount(0); assert.equal(await bytes(fixtureA), beforeA); assert.equal(await bytes(fixtureB), beforeB);
    evidence.adoption = { aPreview: '', aDiskActive: (await read(fixtureA)).ui.activeInstanceId, bPreview: ids.schemeB, bDiskActive: (await read(fixtureB)).ui.activeInstanceId, realNativeOpen: (await nativeLog()).opens.at(-1) };
    await screenshot('09-b-active-scheme-after-native-open');
  });
  await check('B 活动方案编辑保存落到 B 方案及 B 文件，基础界面和 A 文件保持原内容，重开一致', async () => {
    const beforeA = await bytes(fixtureA), beforeB = await read(fixtureB); await selectControl(ids.title); await editText(labels.bSaved); const saved = await saveUi();
    assert.equal(saved.id, fixtureB.project.id); assert.equal(saved.ui.activeInstanceId, ids.schemeB); assert.equal(localComponent(saved, ids.schemeB, ids.title).text, labels.bSaved);
    assert.deepEqual(saved.ui.components, beforeB.ui.components); assert.equal(await bytes(fixtureA), beforeA); await saveEvidence('04-b-active-scheme-saved', fixtureB);
    await closeOwned(); await launch(fixtureB); await openDesign(); await inspectScheme(ids.schemeB); await expect(hierarchy(ids.onlyB)).toBeVisible(); await selectControl(ids.title);
    const text = inspector().getByLabel('文字', { exact: true }); await openDisclosureAncestors(text); await expect(text).toHaveValue(labels.bSaved); await expect(button('保存界面')).toBeDisabled(); await screenshot('10-b-active-scheme-reopened');
  });
  await check('A 基础检查状态下真实打开带 UI 恢复草稿的 B，仍显示活动 B 草稿且保存不覆盖基础界面', async () => {
    const before = await bytes(fixtureB); await editText(labels.bRecovered);
    await expect.poll(async () => (await recovery(fixtureB).catch(() => undefined))?.uiDraft?.ui.instances?.find(scheme => scheme.id === ids.schemeB)?.components.find(component => component.id === ids.title)?.text, { timeout: 20000 }).toBe(labels.bRecovered);
    const recovered = await recovery(fixtureB); assert.equal(recovered.projectDirty, false); assert.equal(localComponent(recovered.project, ids.schemeB, ids.title).text, labels.bSaved); assert.equal(await bytes(fixtureB), before);
    const recoveryFile = path.resolve(evidenceDir, '05-b-ui-recovery-envelope.json'); await fs.writeFile(recoveryFile, JSON.stringify(recovered, null, 2)); savedEvidence.push(path.relative(output, recoveryFile));
    await closeOwned(); await launch(fixtureA); await inspectABaseResource(); await openProjectB(); await selectControl(ids.title); const text = inspector().getByLabel('文字', { exact: true });
    await openDisclosureAncestors(text); await expect(text).toHaveValue(labels.bRecovered); await expect(button('保存界面')).toBeEnabled(); await expect(page!.locator('.dirty-dot')).toHaveCount(1); assert.equal(await bytes(fixtureB), before);
    await screenshot('11-b-recovered-draft-after-a-base-inspection'); const saved = await saveUi(); assert.equal(localComponent(saved, ids.schemeB, ids.title).text, labels.bRecovered); assert.deepEqual(saved.ui.components, fixtureB.project.ui.components);
    await saveEvidence('06-b-recovered-active-scheme-saved', fixtureB);
  });
  await check('右键长度属性改短来源或恢复默认会明示拒绝，应用禁用且不留下参数及继承覆盖', async () => {
    const before = await read(fixtureB); assert.equal(Array.from(before.variables.find(variable => variable.id === ids.inputText)!.initial as string).length, 3);
    await openDesign('preferences'); await selectControl(ids.input); await revealProperty('stringValue'); await expect(source('stringValue')).toHaveText('同步：三个 Unicode 字符'); await revealProperty('maxLength'); await expect(source('maxLength')).toHaveText('跟随：当前长度三');
    await openPropertyDialog('maxLength'); await propertyDialog().getByLabel('来源参数', { exact: true }).selectOption(ids.length1);
    await expect(propertyDialog().getByRole('alert')).toContainText(/文字|关联/); await expect(propertyDialog().getByRole('alert')).toContainText(/长度|上限/); await expect(propertyDialog().getByRole('button', { name: '应用设置', exact: true })).toBeDisabled(); await screenshot('12-short-length-link-refused');
    await propertyDialog().getByLabel('控制方式', { exact: true }).selectOption('default'); await expect(propertyDialog().getByRole('alert')).toContainText(/长度|上限/); await expect(propertyDialog().getByRole('button', { name: '应用设置', exact: true })).toBeDisabled();
    await propertyDialog().getByLabel('控制方式', { exact: true }).selectOption('follow'); await propertyDialog().getByRole('button', { name: '新建参数并关联', exact: true }).click();
    await propertyDialog().getByLabel('新参数名称', { exact: true }).fill(labels.rejected); await propertyDialog().getByLabel('新参数初始值', { exact: true }).fill('1'); await propertyDialog().getByLabel('新参数初始值', { exact: true }).press('Tab');
    await expect(propertyDialog().getByRole('alert')).toContainText(/长度|上限/); await expect(propertyDialog().getByRole('button', { name: '应用设置', exact: true })).toBeDisabled(); await propertyDialog().getByRole('button', { name: '取消', exact: true }).click();
    await assertCombinationUnchanged(before); await expect(source('maxLength')).toHaveText('跟随：当前长度三');
    await openPropertyMenu('maxLength'); await propertyMenu().getByRole('menuitem', { name: '默认设置', exact: true }).click();
    await expect(page!.locator('.ui-inspector .ui-property-control-notice').filter({ hasText: /长度|上限/ })).toBeVisible(); await expect(source('maxLength')).toHaveText('跟随：当前长度三'); await assertCombinationUnchanged(before); await page!.keyboard.press('Escape');
    evidence.propertyMenu = { unicodeCharacters: 3, authoredLimit: 1, activeLimit: 3, shorterSource: ids.length1, rejectedNewParameter: labels.rejected, defaultRemovalRefused: true };
  });
  await check('事件图属性关联面板同样拒绝缩短及恢复默认，新建短参数仍不可提交且无隐藏覆盖', async () => {
    const before = await read(fixtureB); await mode('事件图').click(); await page!.getByLabel('事件图页面', { exact: true }).selectOption('ui:preferences'); await revealEventDirectory();
    await page!.locator('.ui-event-directory-links').getByRole('button', { name: '属性关联', exact: true }).click(); const detail = page!.locator('.ui-event-detail:visible');
    await detail.getByLabel('联动组件', { exact: true }).selectOption(ids.input); await detail.getByLabel('联动属性', { exact: true }).selectOption('maxLength');
    await detail.getByLabel('联动参数', { exact: true }).selectOption(ids.length1); await expect(detail.getByRole('alert')).toContainText(/长度|上限/); await expect(detail.getByRole('button', { name: '应用关联', exact: true })).toBeDisabled();
    await detail.getByLabel('属性控制方式', { exact: true }).selectOption('default'); await expect(detail.getByRole('alert')).toContainText(/长度|上限/); await expect(detail.getByRole('button', { name: '恢复默认设置', exact: true })).toBeDisabled();
    await detail.getByLabel('属性控制方式', { exact: true }).selectOption('follow'); await detail.getByRole('button', { name: '新建参数并联动', exact: true }).click();
    const form = detail.getByRole('form', { name: '新建联动参数', exact: true }); await form.getByLabel('新参数名称', { exact: true }).fill(labels.rejected); await form.getByLabel('新参数初始值', { exact: true }).fill('1'); await form.getByLabel('新参数初始值', { exact: true }).press('Tab');
    await expect(form.getByRole('status')).toContainText(/长度|上限/); await expect(form.getByRole('button', { name: '创建参数并联动', exact: true })).toBeDisabled(); await screenshot('13-event-binding-short-limit-refused');
    await form.getByRole('button', { name: '取消', exact: true }).click(); await assertCombinationUnchanged(before); await button('保存工程').click(); await expect(page!.locator('.dirty-dot')).toHaveCount(0);
    const saved = await read(fixtureB); assert.deepEqual(saved.ui, before.ui); assert.deepEqual(saved.variables, before.variables); assert.deepEqual(saved.blueprints, before.blueprints);
    assert.equal(saved.variables.some(variable => variable.name === labels.rejected), false); await saveEvidence('07-b-rejected-controls-final', fixtureB); evidence.eventBindings = { shortSourceRefused: true, defaultRefused: true, shortNewParameterRefused: true, inheritedOverrideAbsent: true };
  });
  await check('最终保存重开验证组合来源和活动 B 保留，没有隐藏参数、方案覆盖或渲染错误', async () => {
    const before = await read(fixtureB), beforeA = await bytes(fixtureA); await closeOwned(); await launch(fixtureB); await openDesign('preferences'); await inspectScheme(ids.schemeB); await selectControl(ids.input);
    await revealProperty('stringValue'); await expect(source('stringValue')).toHaveText('同步：三个 Unicode 字符'); await revealProperty('maxLength'); await expect(source('maxLength')).toHaveText('跟随：当前长度三'); await assertCombinationUnchanged(before);
    assert.equal(await bytes(fixtureA), beforeA); await screenshot('14-reopened-combination-keeps-valid-sources'); await saveEvidence('08-a-final', fixtureA); await saveEvidence('08-b-final', fixtureB);
    assert.deepEqual(errors, [], '桌面渲染器不得发生运行时错误。'); report.buildAfter = await buildFingerprints(); assert.deepEqual(report.buildAfter, report.buildBefore, '验收中不得改变统一构建。');
  });
  assert.equal(checks.length, 12); report.status = 'passed';
} catch (error) {
  failure = error; report.status = 'failed'; report.phase = phase; report.error = error instanceof Error ? error.stack : String(error);
  if (app && page && !page.isClosed()) await screenshot('failure').catch(capture => { report.captureError = String(capture); });
} finally {
  try { await closeOwned(); } catch (error) { failure ??= error; report.status = 'failed'; report.closeError = String(error); }
  try {
    await fs.mkdir(output, { recursive: true });
    if (app || processes.some(item => !item.exited)) throw new Error('自有夹具进程仍在运行，保留其目录并报告。');
    // Resolve every explicitly owned absolute target BEFORE recursive cleanup.
    const physicalWorkspace = await fs.realpath(root), physicalOutput = await fs.realpath(output), physicalSessionRoot = await fs.realpath(sessionRoot);
    assert.ok(inside(physicalWorkspace, physicalOutput) && inside(physicalSessionRoot, physicalOutput), '清理目录必须仍位于本轮 session-editor 内。');
    for (const target of [projectADir, projectBDir, profile]) {
      assert.ok(path.isAbsolute(target) && inside(output, target));
      const resolved = await fs.realpath(target).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
      if (resolved) assert.ok(inside(physicalOutput, resolved), '拒绝清理本次输出之外的目录：' + resolved);
    }
    report.cleanup = await cleanVerificationDirectories(output, ['project-a', 'project-b', 'profile']);
    assert.deepEqual((report.cleanup as { errors: unknown[] }).errors, []);
  } catch (error) { failure ??= error; report.status = 'failed'; report.cleanupError = String(error); }
  await fs.mkdir(output, { recursive: true }); await persistReport(); console.log(path.resolve(output, 'report.json'));
}
if (failure) throw failure;
