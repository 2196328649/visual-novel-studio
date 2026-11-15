import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBlueprintStateFixture } from './lib/blueprint-state-fixture';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { fitBlueprintCanvas } from './lib/blueprint-canvas';
import { projectSchema, type Project, type BlueprintVariable, type VariableValue } from '../src/core/model';
import { saveProject } from '../src/desktop/project-store';
import { compileProject } from '../src/runtime/compiler';
import { cleanVerificationDirectories, type VerificationCleanup } from './lib/verification-cleanup';

if (process.env.VNS_INSTALLED_EXE) throw new Error('Only isolated development verification is permitted.');
const root = path.resolve('.'), output = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? path.join(root, 'artifacts'), 'blueprint-state-editor', new Date().toISOString().replaceAll(':', '-'));
const builtRenderer = process.env.VNS_VERIFY_BUILT_RENDERER === '1';
const fixture = createBlueprintStateFixture(), { project, cache, pageGraphs } = fixture;
const projectFile = path.join(output, 'project/project.vns.json'); await fs.mkdir(path.dirname(projectFile), { recursive: true }); await saveProject(projectFile, project);
let server: ViteDevServer | undefined;
if (!builtRenderer) { server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/resources/**', '**/release/**', '**/work/**'] } } }); await server.listen(); }
const devUrl = server ? 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port : undefined;
let app: ElectronApplication | undefined, page: Page | undefined, phase = 'launch', failure: string | undefined, failureScreenshotError: string | undefined;
let cleanup: VerificationCleanup | undefined;
const checks: string[] = [], errors: string[] = [], processes: { pid?: number; alive: boolean }[] = [];
const node = (id: string) => page!.locator('.react-flow__node[data-id="' + id + '"]');
const dialog = () => page!.getByRole('dialog', { name: '确认状态修改', exact: true });
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const record = (text: string) => { checks.push(text); console.log('PASS ' + checks.length + ': ' + text); };
async function launch() {
  app = await launchDesktopFixture({ root, profile: path.join(output, 'profile'), projectFile, devUrl, sdkRoot: 'E:/Tools/renpy-8.5.3-sdk' });
  page = await app.firstWindow(); page.setDefaultTimeout(14000); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 }); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 1000));
  if (builtRenderer) expect(fileURLToPath(page.url())).toBe(path.join(root, 'dist/index.html'));
}
async function close() {
  if (!app) return; const pid = app.process().pid; await app.close();
  let alive = false; if (pid) try { process.kill(pid, 0); alive = true; } catch { /* Isolated process exited. */ }
  processes.push({ pid, alive }); expect(alive).toBe(false); app = undefined;
}
async function openGraph(id: string) {
  await page!.locator('[data-workspace-tab="blueprint"]').click(); await page!.getByLabel('蓝图资源', { exact: true }).selectOption('graph:' + id); await fitBlueprintCanvas(page!);
}
async function state() { await inspector().getByRole('button', { name: '变量', exact: true }).click(); await expect(panel()).toBeVisible(); }
async function save(ui = false) {
  if (ui) { await page!.getByRole('button', { name: '保存界面', exact: true }).click(); await expect(page!.locator('.ui-save-status')).toHaveText('已保存'); await expect(page!.getByRole('button', { name: '保存界面', exact: true })).toBeDisabled(); }
  await page!.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page!.locator('.dirty-dot')).toHaveCount(0); return read();
}
const inspector = () => page!.locator('.blueprint-properties');
const panel = () => inspector().locator('.blueprint-state-panel');
const library = () => page!.locator('.ui-event-library .blueprint-state-panel');
const row = (area: Locator, id: string) => area.locator('[data-state-variable-id="' + id + '"]');
const definition = (area: Locator, id: string) => area.locator('[data-state-details-id="' + id + '"]');
const graph = (saved: Project) => saved.blueprints.find(graph => graph.id === cache.id)!;
const captured = cache.localVariables!.find(variable => variable.id === 'captured')!;
const stateTypeNames: Record<BlueprintVariable['type'], string> = { boolean: '开关', number: '数值', string: '文字' };
async function chooseStateType(area: Locator, label: string, type: BlueprintVariable['type']) {
  await area.getByRole('combobox', { name: label, exact: true }).click();
  const options = area.getByRole('listbox', { name: label + '选项', exact: true });
  await expect(options).toBeVisible();
  await options.getByRole('option', { name: stateTypeNames[type], exact: true }).click();
  await expect(options).toBeHidden();
}
async function createVariable(area: Locator, name: string, type: BlueprintVariable['type'], initial: VariableValue) {
  await area.getByRole('button', { name: '新建变量', exact: true }).click();
  await area.getByLabel('变量名称', { exact: true }).fill(name); await chooseStateType(area, '变量类型', type);
  const input = area.getByLabel('变量初始值', { exact: true });
  if (type === 'boolean') await input.selectOption(String(initial)); else { await input.fill(String(initial)); await input.press('Tab'); }
  await area.getByRole('button', { name: '创建变量', exact: true }).click(); await expect(area.getByRole('form', { name: '创建状态变量', exact: true })).toHaveCount(0);
  await expect(area.locator('.blueprint-member-select').and(area.getByRole('button', { name: '编辑变量 ' + name, exact: true }))).toBeFocused();
  for (const action of ['读取', '设置']) await expect(area.getByRole('button', { name: action + ' ' + name, exact: true })).toBeEnabled();
}
async function editDefinition(area: Locator, id: string) {
  const select = row(area, id).locator('.blueprint-member-select');
  await expect(select).toHaveAccessibleName(/^编辑变量 /);
  if (await select.getAttribute('aria-pressed') !== 'true') await select.click();
  await expect(select).toHaveAttribute('aria-pressed', 'true');
  await expect(definition(area, id)).toBeVisible();
  await expect(area.locator('.blueprint-state-definition')).toHaveCount(1);
}
async function enterPage(id: string, graphId: string) {
  await page!.locator('.view-tabs').getByRole('button', { name: '界面', exact: true }).click();
  await page!.getByLabel('界面编辑模式').getByRole('button', { name: '设计', exact: true }).click();
  await page!.getByLabel('设计页面', { exact: true }).selectOption(id.startsWith('ui:') ? id.slice(3) : id);
  await page!.getByLabel('界面编辑模式').getByRole('button', { name: '事件图', exact: true }).click();
  await page!.getByLabel('当前页面事件图', { exact: true }).selectOption(graphId); await expect(library()).toBeVisible();
}

try {
  await launch(); await openGraph(cache.id); await state(); const original = await read();
  await expect(panel().getByLabel('状态列表作用域')).toHaveValue('call');
  expect(await panel().getByLabel('状态列表作用域').locator('option').allTextContents()).toEqual(['本次调用', '页面实例', '作品状态', '玩家设置']);
  await editDefinition(panel(), 'captured'); await expect(panel().getByLabel('状态初始值 ' + captured.name)).toHaveValue('-99');
  record('普通蓝图使用四种生命周期，没有自定义界面或小游戏专属作用域。');

  phase = 'cancel draft and search without edits';
  const initialBytes = await fs.readFile(projectFile, 'utf8');
  await panel().getByRole('button', { name: '新建变量', exact: true }).click();
  await expect(panel().getByLabel('变量名称', { exact: true })).toBeFocused();
  await expect(panel().getByRole('button', { name: '创建变量', exact: true })).toBeDisabled();
  await panel().getByLabel('变量名称', { exact: true }).fill('取消的变量');
  await panel().getByRole('button', { name: '取消', exact: true }).click();
  await expect(panel().getByRole('form', { name: '创建状态变量', exact: true })).toHaveCount(0);
  await panel().getByRole('button', { name: '新建变量', exact: true }).click();
  await panel().getByLabel('变量名称', { exact: true }).fill('不应跨作用域提交');
  await panel().getByLabel('状态列表作用域', { exact: true }).selectOption('page');
  await expect(panel().getByRole('form', { name: '创建状态变量', exact: true })).toHaveCount(0);
  await panel().getByLabel('状态列表作用域', { exact: true }).selectOption('call');
  const search = panel().getByLabel('搜索变量', { exact: true });
  await search.fill('不存在的变量'); await expect(panel().locator('[data-state-variable-id]')).toHaveCount(0);
  await search.fill('快照'); await expect(row(panel(), captured.id)).toBeVisible();
  await search.fill(''); await editDefinition(panel(), captured.id);
  await expect(page!.locator('.dirty-dot')).toHaveCount(0); expect(await fs.readFile(projectFile, 'utf8')).toBe(initialBytes);
  record('加号只建立临时新项，取消和切换作用域不残留变量；搜索与成员选择不修改工程。');

  phase = 'name draft, composition and atomic rename';
  const stateName = panel().getByLabel('状态名称 ' + captured.name, { exact: true });
  await stateName.fill(''); await stateName.press('Tab'); await expect(stateName).toHaveAttribute('aria-invalid', 'true');
  await expect(page!.locator('.dirty-dot')).toHaveCount(0); await stateName.focus(); await stateName.press('Escape');
  await expect(stateName).toHaveValue(captured.name);
  const cdp = await page!.context().newCDPSession(page!);
  try {
    await stateName.focus(); await stateName.press('Control+a');
    await cdp.send('Input.imeSetComposition', { text: '中文候选', selectionStart: 4, selectionEnd: 4 });
    await expect(stateName).toHaveValue('中文候选'); await stateName.press('Enter');
    await expect(page!.locator('.dirty-dot')).toHaveCount(0);
    expect(await fs.readFile(projectFile, 'utf8')).toBe(initialBytes);
    await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
  } finally { await cdp.detach(); }
  await stateName.press('Escape'); await expect(stateName).toHaveValue(captured.name);
  await stateName.fill('重命名快照'); await stateName.press('Enter');
  await expect(panel().getByLabel('状态名称 重命名快照', { exact: true })).toBeFocused();
  let renamed = await save(); expect(graph(renamed).localVariables!.find(variable => variable.id === captured.id)?.name).toBe('重命名快照');
  expect(graph(renamed).nodes).toEqual(graph(original).nodes); expect(graph(renamed).links).toEqual(graph(original).links);
  await page!.getByRole('button', { name: '撤销', exact: true }).click(); renamed = await save();
  expect(graph(renamed)).toEqual(graph(original));
  record('名称允许临时清空，空名不落盘；Chromium输入法候选回车不提交，完整改名一次撤销且保留节点引用。');

  phase = 'create and read/write'; await createVariable(panel(), '验收局部', 'number', 0);
  let saved = await save(); const local = graph(saved).localVariables!.find(variable => variable.name === '验收局部')!;
  expect(local.initial).toBe(0); expect(saved.variables).toEqual(original.variables); expect(saved.ui.pageVariables).toEqual(original.ui.pageVariables);
  await page!.getByRole('button', { name: '撤销', exact: true }).click(); saved = await save(); expect(graph(saved).localVariables).toEqual(graph(original).localVariables);
  await page!.getByRole('button', { name: '重做', exact: true }).click(); saved = await save(); expect(graph(saved).localVariables!.find(variable => variable.id === local.id)).toEqual(local);
  await editDefinition(panel(), captured.id); await editDefinition(panel(), local.id);
  const selectedMember = row(panel(), local.id).locator('.blueprint-member-select');
  await expect(selectedMember).toHaveAccessibleName('编辑变量 验收局部');
  await selectedMember.focus(); await selectedMember.press('ArrowUp');
  await expect(row(panel(), captured.id).locator('.blueprint-member-select')).toHaveAccessibleName('编辑变量 ' + captured.name);
  await expect(row(panel(), captured.id).locator('.blueprint-member-select')).toHaveAttribute('aria-pressed', 'true');
  await page!.keyboard.press('ArrowDown'); await expect(selectedMember).toHaveAttribute('aria-pressed', 'true');
  await expect(panel().locator('.blueprint-state-definition')).toHaveCount(1); await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  await page!.screenshot({ path: path.join(output, 'variable-members.png') });
  await panel().getByRole('button', { name: '读取 验收局部', exact: true }).click(); saved = await save();
  const readNode = graph(saved).nodes.find(item => item.type === 'getVariable' && item.properties.variableId === local.id)!;
  expect(readNode.properties.scope).toBe('call');
  await expect(inspector().getByLabel(readNode.name + ' · 状态作用域', { exact: true })).toHaveValue('call');
  await inspector().getByLabel(readNode.name + ' · 状态作用域', { exact: true }).selectOption('page');
  saved = await save(); expect(graph(saved).nodes.find(item => item.id === readNode.id)!.pins.some(pin => pin.id === 'pageId')).toBe(true);
  await inspector().getByLabel(readNode.name + ' · 状态作用域', { exact: true }).selectOption('call');
  await inspector().getByLabel(readNode.name + ' · 状态变量', { exact: true }).selectOption(local.id);
  await state(); await panel().getByRole('button', { name: '设置 验收局部', exact: true }).click(); saved = await save();
  const writeNode = graph(saved).nodes.find(item => item.type === 'setVariable' && item.properties.variableId === local.id)!;
  expect(writeNode.properties.value).toBe(0); expect(writeNode.properties.scope).toBe('call');
  expect(graph(saved).nodes.find(item => item.id === readNode.id)!.pins.some(pin => pin.id === 'pageId')).toBe(false);
  record('创建局部数值、读写节点和切换作用域真实保存；零值不丢失，页面引脚仅在页面作用域出现。');

  phase = 'type impact and cancellation'; await state(); await editDefinition(panel(), 'captured'); const beforeType = await read();
  await chooseStateType(panel(), '状态类型 ' + captured.name, 'boolean'); await expect(dialog()).toBeVisible();
  await expect(dialog()).toContainText(cache.name); await expect(dialog()).toContainText('已有写入值与连线保持原样');
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1024, 768));
  const confirmBounds = (await dialog().getByRole('button', { name: '确认修改', exact: true }).boundingBox())!;
  expect(confirmBounds.y + confirmBounds.height).toBeLessThanOrEqual(768); expect(await page!.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page!.screenshot({ path: path.join(output, 'state-impact-1024.png') });
  await dialog().getByRole('button', { name: '取消', exact: true }).focus(); await page!.keyboard.press('Delete'); await page!.keyboard.press('Escape');
  await expect(dialog()).toHaveCount(0); expect(graph(await read())).toEqual(graph(beforeType));
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 1000));
  await chooseStateType(panel(), '状态类型 ' + captured.name, 'boolean'); await dialog().getByRole('button', { name: '确认修改', exact: true }).click();
  saved = await save(); expect(graph(saved).localVariables!.find(variable => variable.id === 'captured')).toMatchObject({ type: 'boolean', initial: false });
  expect(graph(saved).links).toEqual(graph(beforeType).links); expect(compileProject(saved).diagnostics.some(issue => issue.severity === 'error')).toBe(true);
  await page!.getByRole('button', { name: '撤销', exact: true }).click(); saved = await save(); expect(graph(saved)).toEqual(graph(beforeType));
  await page!.getByRole('button', { name: '重做', exact: true }).click(); saved = await save(); expect(graph(saved).localVariables![0].type).toBe('boolean');
  await page!.getByRole('button', { name: '撤销', exact: true }).click(); await save();
  record('类型影响列出引用；1024 宽弹窗可操作，取消/Delete/Escape 无副作用，类型变更保留连线并支持一次撤销重做。');

  phase = 'delete, reopen and repair'; await state(); await editDefinition(panel(), local.id); await definition(panel(), local.id).getByRole('button', { name: '删除变量', exact: true }).click();
  await expect(dialog()).toContainText('引用位置 · 2'); await dialog().getByRole('button', { name: '确认修改', exact: true }).click();
  saved = await save(); expect(graph(saved).localVariables!.some(variable => variable.id === local.id)).toBe(false); expect(graph(saved).nodes.some(item => item.id === readNode.id)).toBe(true);
  await page!.getByRole('button', { name: '撤销', exact: true }).click(); saved = await save(); expect(graph(saved).localVariables!.some(variable => variable.id === local.id)).toBe(true);
  await page!.getByRole('button', { name: '重做', exact: true }).click(); await save(); await close(); await launch(); await openGraph(cache.id);
  for (const item of [readNode, writeNode]) {
    await fitBlueprintCanvas(page!); await node(item.id).locator('.graph-node-title strong').click();
    await inspector().getByRole('button', { name: '节点参数', exact: true }).click();
    await expect(inspector().getByLabel(item.name + ' · 状态变量', { exact: true })).toHaveValue(local.id);
    await inspector().getByLabel(item.name + ' · 状态变量', { exact: true }).selectOption('captured');
  }
  saved = await save(); expect(compileProject(saved).diagnostics.filter(issue => issue.severity === 'error')).toEqual([]);
  expect(saved.scriptText?.content).toBe(original.scriptText?.content);
  record('删除保留失效读写节点，可撤销重做；带失效引用的工程保存重开后可在原节点重新选变量修复，不改写剧本。');

  phase = 'state navigation restore';
  // Newly created unconnected nodes may cover the fixture's call node. Arrange
  // through the real editor, then save before testing read-only navigation.
  await page!.getByRole('button', { name: '自动排列蓝图', exact: true }).click();
  await expect(page!.getByRole('button', { name: '自动排列蓝图', exact: true })).toBeEnabled();
  await fitBlueprintCanvas(page!); await save(); await state();
  const call = cache.nodes.find(item => item.type === 'callFunction')!, beforeNav = await fs.readFile(projectFile, 'utf8');
  await node(call.id).locator('.graph-node-title strong').dblclick(); await expect(page!.getByRole('button', { name: '返回调用位置', exact: true })).toBeVisible();
  await page!.getByRole('button', { name: '返回调用位置', exact: true }).click(); await expect(panel()).toBeVisible();
  expect(await fs.readFile(projectFile, 'utf8')).toBe(beforeNav); record('打开嵌套模块后返回原调用位置会恢复“变量”页签，查看与导航不修改工程。');

  phase = 'template page state and draft history';
  const templateGraph = pageGraphs.find(item => item.uiPageId === 'ui:preferences')!;
  await enterPage('ui:preferences', templateGraph.id);
  await expect(library().getByLabel('状态列表作用域')).toHaveValue('page');
  await expect(library().getByLabel('状态所属页面')).toHaveValue('ui:preferences');
  const beforeTemplate = await fs.readFile(projectFile, 'utf8');
  await createVariable(library(), '同名页面开关', 'boolean', false);
  await expect(library().getByRole('button', { name: '读取 同名页面开关', exact: true })).toBeVisible();
  expect(await fs.readFile(projectFile, 'utf8')).toBe(beforeTemplate);
  await page!.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(library().getByRole('button', { name: '读取 同名页面开关', exact: true })).toHaveCount(0);
  await page!.getByRole('button', { name: '重做', exact: true }).click();
  saved = await save(true);
  const templateVariable = saved.ui.pageVariables!['ui:preferences'].find(variable => variable.name === '同名页面开关')!;
  expect(templateVariable.initial).toBe(false); expect(saved.variables).toEqual(original.variables);
  await library().getByRole('button', { name: '读取 同名页面开关', exact: true }).click();
  saved = await save(true);
  const templateRead = saved.blueprints.find(item => item.id === templateGraph.id)!.nodes.find(item => item.properties.variableId === templateVariable.id)!;
  expect(templateRead.properties).toMatchObject({ scope: 'page', pageId: 'ui:preferences' });
  await page!.getByRole('button', { name: '自动排列蓝图', exact: true }).click();
  await expect(page!.getByRole('button', { name: '自动排列蓝图', exact: true })).toBeEnabled();
  await fitBlueprintCanvas(page!); await save(true);
  record('内置模板使用同一页面实例状态面板；定义先留在界面草稿，一次撤销重做，保存后读节点保留明确页面与假值。');

  phase = 'authored page uses the same state interface';
  const authoredGraph = pageGraphs.find(item => item.uiPageId === fixture.root.id)!;
  await enterPage(fixture.root.id, authoredGraph.id);
  await expect(library().getByLabel('状态所属页面')).toHaveValue(fixture.root.id);
  await expect(row(library(), templateVariable.id)).toHaveCount(0);
  await createVariable(library(), '同名页面开关', 'boolean', true);
  await createVariable(library(), '空文字结果', 'string', ''); saved = await save(true);
  const authoredVariable = saved.ui.pageVariables![fixture.root.id].find(variable => variable.name === '同名页面开关')!;
  expect(authoredVariable.id).not.toBe(templateVariable.id); expect(authoredVariable.initial).toBe(true);
  expect(saved.ui.pageVariables![fixture.root.id].find(variable => variable.name === '空文字结果')!.initial).toBe('');
  expect(saved.ui.pageVariables!['ui:preferences'].find(variable => variable.id === templateVariable.id)!.initial).toBe(false);
  await library().getByRole('button', { name: '设置 同名页面开关', exact: true }).click(); saved = await save(true);
  expect(saved.blueprints.find(item => item.id === authoredGraph.id)!.nodes.find(item => item.properties.variableId === authoredVariable.id)!.properties).toMatchObject({ scope: 'page', pageId: fixture.root.id, value: true });
  record('新增页面与内置模板共用读写和保存入口；页面之间允许同名定义但 ID、初始值和节点所属页面互不串用，空文字原样保存。');

  phase = 'project and player lifetimes';
  await library().getByLabel('状态列表作用域').selectOption('project'); await createVariable(library(), '验收作品状态', 'number', 0);
  await library().getByLabel('状态列表作用域').selectOption('player'); await createVariable(library(), '验收玩家设置', 'boolean', false);
  saved = await save(true);
  expect(saved.variables.find(variable => variable.name === '验收作品状态')).toMatchObject({ persistent: false, initial: 0 });
  expect(saved.variables.find(variable => variable.name === '验收玩家设置')).toMatchObject({ persistent: true, initial: false });
  expect(saved.minigames).toEqual(original.minigames);
  record('作品状态与跨存档玩家设置仍接入原参数集，保留零/假初值；不生成小游戏定义或新的专属设置。');

  phase = 'saved project reopens cleanly'; await close(); await launch(); await enterPage('ui:preferences', templateGraph.id);
  await expect(row(library(), templateVariable.id)).toBeVisible();
  await expect(row(library(), authoredVariable.id)).toHaveCount(0);
  await fitBlueprintCanvas(page!); await editDefinition(library(), templateVariable.id);
  await row(library(), templateVariable.id).scrollIntoViewIfNeeded();
  await expect(library().getByLabel('状态初始值 同名页面开关', { exact: true })).toHaveValue('false');
  await expect(page!.getByRole('button', { name: '保存界面', exact: true })).toBeDisabled();
  saved = await read(); expect(compileProject(saved).diagnostics.filter(issue => issue.severity === 'error')).toEqual([]);
  expect(saved.scriptText?.content).toBe(original.scriptText?.content); expect(errors).toEqual([]);
  await page!.screenshot({ path: path.join(output, 'template-page-state-reopened.png') });
  record('保存重开后页面定义、引用和作用域完整保留，浏览不制造脏状态，原剧本文本未改写，无脚本异常且最终编译无错误。');
} catch (error) {
  failure = (error instanceof Error ? error.stack ?? error.message : String(error));
  console.error('FAIL [' + phase + ']: ' + failure);
  await page?.screenshot({ path: path.join(output, 'failure.png'), timeout: 10000, animations: 'disabled' }).catch(error => { failureScreenshotError = String(error); });
} finally {
  try { await close(); } catch (error) { failure ??= 'Fixture cleanup: ' + String(error); }
  try { await server?.close(); } catch (error) { failure ??= 'Server cleanup: ' + String(error); }
  try { if (app) throw new Error('Fixture is still running.'); cleanup = await cleanVerificationDirectories(output, ['project', 'profile']); expect(cleanup.errors).toEqual([]); } catch (error) { failure ??= 'Directory cleanup: ' + String(error); }
  const report = { status: failure || errors.length ? 'failed' : 'passed', renderer: builtRenderer ? 'built' : 'development', phase, checks, errors, failure, failureScreenshotError, processes, projectFile, cleanup };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log('Report: ' + path.join(output, 'report.json'));
  if (report.status !== 'passed') process.exitCode = 1;
}
