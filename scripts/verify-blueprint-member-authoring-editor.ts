import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { createProject, projectSchema, type BlueprintNode, type Project, type VariableValue } from '../src/core/model';
import { blueprintNodeDefaults, createBlueprintGraph, synchronizeBlueprintSignatures, type BlueprintDataType } from '../src/core/blueprint';
import { BLUEPRINT_MEMBER_MIME, type BlueprintMemberReference } from '../src/core/blueprint-member-access';
import { createUiEventGraph } from '../src/core/ui-logic';
import { uiPageInterface } from '../src/core/ui-page-interface';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { fitBlueprintCanvas } from './lib/blueprint-canvas';
import { openDisclosureAncestors } from './lib/ui-disclosures';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

// Authoring acceptance only. The coordinator runs this after all product work,
// type checking, tests and the unified source build. Real member drags use mouse
// input; only cross-owner payload rejection is a synthetic drop boundary.
// Never open or edit the real author project, historical cleanup paths or games.
if (process.env.VNS_INSTALLED_EXE) throw new Error('Use the isolated compiled source editor for member authoring acceptance.');
const root = path.resolve('.');
const artifactRoot = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? 'artifacts/event-graph-left-sidebar-2026-11-12');
const output = path.join(artifactRoot, 'member-authoring-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const projectFile = path.join(output, 'fixture/project.vns.json'), profile = path.join(output, 'profile');
const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const typeNames: Record<Exclude<BlueprintDataType, 'exec'>, string> = { boolean: '开关', number: '数值', string: '文字', asset: '素材引用', scene: '场景引用', character: '角色引用', ui: '页面引用', component: '控件引用', any: '任意值' };

function fixture() {
  const project = createProject('蓝图成员创建与整行拖放验收'); project.id = 'blueprint_member_authoring_acceptance';
  project.width = 1280; project.height = 720;
  project.assets = [{ id: 'member_portrait', name: '验收立绘素材', kind: 'image', category: 'portrait', path: 'portrait.svg', width: 180, height: 300 }];
  project.characters = [{ id: 'member_actor', name: '验收角色甲', color: '#ffffff', expressions: [{ id: 'member_expression', name: '正面', assetId: 'member_portrait' }] }];
  const first = project.scenes[0]; first.name = '故事开始小章节';
  project.scenes.push({ id: 'member_scene', name: '目标小章节', chapterId: first.chapterId });
  project.nodes.push({ id: 'member_scene_start', kind: 'start', name: '目标入口', sceneId: 'member_scene', x: 40, y: 100, next: 'member_scene_end' }, { id: 'member_scene_end', kind: 'end', name: '目标结束', sceneId: 'member_scene', x: 400, y: 100 });
  project.variables = [{ id: 'member_shared', name: '作品共享开关', type: 'boolean', initial: false, persistent: false }];
  project.ui.customPages = [{ id: 'member_page', name: '成员验收页面', modal: true, components: [{ id: 'member_text', name: '页面提示文字', kind: 'text', page: 'custom', text: '成员默认值与拖放', x: .1, y: .2, width: .7, height: .2 }] }];
  project.ui.pageVariables = { member_page: [{ id: 'member_page_state', name: '页面局部数值', type: 'number', initial: 0 }] };
  const graph = createBlueprintGraph('function', '成员验收普通蓝图'); graph.id = 'member_graph';
  const jump = Object.assign(blueprintNodeDefaults('switchScene'), { id: 'member_switch', name: '切换到输入场景', x: 520, y: 250 });
  jump.properties.sceneId = 'member_scene'; graph.nodes.push(jump);
  const other = createBlueprintGraph('function', '跨蓝图拒绝目标'); other.id = 'member_other';
  project.blueprints = [graph, other];
  const pageGraph = createUiEventGraph(project, 'member_page', '成员验收页面'); pageGraph.id = 'member_page_graph';
  synchronizeBlueprintSignatures(project); return projectSchema.parse(project);
}
const initial = fixture();
let app: ElectronApplication | undefined, page: Page | undefined, failure: unknown, phase = '准备', traceRunning = false, launchNumber = 0;
const checks: { name: string; durationMs: number }[] = [], pageErrors: string[] = [], traces: string[] = [], processes: { pid?: number; exited: boolean }[] = [];
const evidence: Record<string, unknown> = { realMouseDrags: [], dragStarts: [], syntheticRejections: [], layouts: [], inspectorLayouts: [], referenceClears: [] };
const report: Record<string, unknown> = { status: 'running', renderer: 'compiled source editor', artifactRoot, checks, pageErrors, traces, processes, evidence,
  limits: ['仅验证编辑与保存，不启动原生游戏。', '真实拖放覆盖名称、类型标记和行内留白；跨蓝图用保存的真实 MIME 数据复投检查边界。', 'IME 用浏览器 composition 事件检查提交保护，不操作系统输入法。'], temporaryPaths: [path.dirname(projectFile), profile] };
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const button = (name: string) => page!.getByRole('button', { name, exact: true });
const properties = () => page!.getByRole('complementary', { name: '蓝图属性', exact: true });
const variablePanel = () => properties().getByRole('region', { name: '蓝图变量', exact: true });
const inputPanel = () => properties().getByRole('region', { name: '输入参数', exact: true });
const outputPanel = () => properties().getByRole('region', { name: '输出结果', exact: true });
const pageDock = () => page!.getByLabel('界面事件图工作区', { exact: true });
const pageSidebar = () => pageDock().getByRole('complementary', { name: '我的界面与详情', exact: true });
const pageDirectory = () => pageDock().getByRole('region', { name: '我的界面目录', exact: true });
// Activity retains previously visited editors. Only the current detail is actionable.
const pageDetails = () => pageDock().locator('.ui-event-detail-host > .ui-event-detail:visible');
const pageGraphInputs = () => pageDetails().getByRole('region', { name: '调用输入', exact: true });
const pageInterface = () => pageDirectory().getByRole('region', { name: '页面输入与结果', exact: true });
const pageVariables = () => pageDirectory().getByRole('region', { name: '蓝图变量', exact: true });
const pageDirection = (direction: 'inputs' | 'outputs') => pageInterface().locator(`[data-page-parameter-direction="${direction}"]`);
const memberRow = (id: string, panel?: Locator) => (panel ?? page!.locator('.blueprint-workspace')).locator(`[data-blueprint-member-id="${id}"]`);
const card = (id: string) => page!.locator(`.react-flow__node[data-id="${id}"]`);
const memberMenu = () => page!.getByRole('dialog', { name: '蓝图成员操作', exact: true });
const settle = () => page!.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
function graph(value: Project, id: string) { const found = value.blueprints.find(item => item.id === id); assert.ok(found, 'Expected graph: ' + id); return found; }
function nodesFor(value: Project, graphId: string, type: BlueprintNode['type'], property: string, id: string) { return graph(value, graphId).nodes.filter(node => node.type === type && node.properties[property] === id); }
async function fingerprints() {
  const html = await fs.readFile(path.join(root, 'dist/index.html'), 'utf8');
  const files = ['dist/index.html', 'dist-desktop/main.cjs', 'dist-desktop/preload.cjs', ...[...html.matchAll(/(?:src|href)="(\.\/assets\/[^"?#]+\.(?:js|css))"/g)].map(match => 'dist/' + match[1].slice(2))];
  assert.ok(files.some(file => file.startsWith('dist/assets/') && file.endsWith('.js')), 'Build all member authoring changes before acceptance.');
  return Promise.all([...new Set(files)].map(async file => ({ file, sha256: hash(await fs.readFile(path.join(root, file))) })));
}
async function writeReport() { await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); }
async function launch() {
  app = await launchDesktopFixture({ root, projectFile, profile }); processes.push({ pid: app.process().pid, exited: false }); launchNumber++;
  page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', error => pageErrors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; if (window.isMaximized()) window.unmaximize(); window.setContentSize(1600, 1000); window.webContents.setBackgroundThrottling(false); });
  await expect(page.locator('.project-title strong')).toHaveText(initial.name, { timeout: 45000 });
  assert.equal(path.resolve(fileURLToPath(page.url())), path.join(root, 'dist/index.html')); report.rendererUrl = page.url();
  await page.evaluate('globalThis.__name = value => value'); await page.context().tracing.start({ screenshots: true, snapshots: true, sources: false }); traceRunning = true;
}
async function close() {
  if (!app) return;
  const owned = app, child = owned.process(), exited = () => child.exitCode !== null || child.signalCode !== null;
  let traceFailure: unknown;
  if (traceRunning && page) {
    const name = 'trace-' + String(launchNumber).padStart(2, '0') + '.zip';
    try { await page.context().tracing.stop({ path: path.join(output, name) }); traces.push(name); }
    catch (error) { traceFailure = error; report.traceError = String(error); }
    traceRunning = false;
  }
  try { await owned.close(); } finally {
    await expect.poll(exited, { timeout: 15000 }).toBe(true);
    const record = processes.find(item => item.pid === child.pid); if (record) record.exited = exited();
    if (exited()) { app = undefined; page = undefined; }
  }
  if (traceFailure) throw traceFailure;
}
async function screenshot(name: string) {
  await settle(); const image = await app!.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  await fs.writeFile(path.join(output, name + '.png'), Buffer.from(image, 'base64'));
}
async function check(name: string, work: () => Promise<void>) {
  phase = name; const start = Date.now(); await work(); checks.push({ name, durationMs: Date.now() - start }); await writeReport(); console.log('通过：' + name);
}
async function save() { await button('保存工程').click(); await expect(page!.locator('.dirty-dot')).toHaveCount(0); await settle(); return read(); }
async function saveUi() {
  if (await button('保存界面').isEnabled()) await button('保存界面').click();
  await expect(page!.locator('.ui-save-status')).toHaveText('已保存', { timeout: 30000 }); await expect(button('保存界面')).toBeDisabled(); return read();
}
async function openGraph(id = 'member_graph') {
  await page!.locator('[data-workspace-tab="blueprint"]').click(); await page!.getByLabel('蓝图资源', { exact: true }).selectOption('graph:' + id);
  await expect(properties()).toBeVisible(); await fitBlueprintCanvas(page!); await settle();
  await assertInspectorLeft('普通蓝图-' + id);
}
async function openTab(name: '节点参数' | '变量' | '输入与输出') { await properties().locator('.blueprint-property-tabs').getByRole('button', { name, exact: true }).click(); }
async function openPageGraph() {
  await page!.locator('[data-workspace-tab="ui"]').click(); await page!.getByLabel('界面编辑模式', { exact: true }).getByRole('button', { name: '事件图', exact: true }).click();
  await page!.getByLabel('事件图页面', { exact: true }).selectOption('member_page'); await page!.getByLabel('当前页面事件图', { exact: true }).selectOption('member_page_graph');
  await fitBlueprintCanvas(page!); await settle(); await pageDirectory().getByRole('button', { name: '本图设置', exact: true }).click();
  await assertPageInspectorLeft('页面事件图-member_page_graph');
}
async function assertInspectorLeft(description: string) {
  await expect(properties()).toBeVisible(); await expect(properties().locator('.blueprint-property-tabs > button')).toHaveText(['节点参数', '输入与输出', '变量']);
  const inspector = await properties().boundingBox(), canvas = await page!.locator('.flow-container').boundingBox(); assert.ok(inspector); assert.ok(canvas);
  assert.ok(inspector.width > 0 && inspector.x + inspector.width <= canvas.x + 2, description + ': blueprint inspector must be on the left of the canvas.');
  assert.ok(inspector.y < canvas.y + canvas.height && inspector.y + inspector.height > canvas.y, description + ': inspector and canvas must share the workspace height.');
  (evidence.inspectorLayouts as unknown[]).push({ description, inspector, canvas, leftOfCanvas: true });
}
async function assertPageInspectorLeft(description: string) {
  await expect(pageSidebar()).toBeVisible(); await expect(pageDock().locator('.ui-event-sidebar')).toHaveCount(1);
  await expect(pageDetails()).toHaveCount(1); await expect(pageDock().locator('.blueprint-property-tabs')).toHaveCount(0);
  await expect(pageDock().locator('[data-dock-slot="right"]')).toHaveCount(0);
  const inspector = await pageSidebar().boundingBox(), canvas = await page!.locator('.flow-container').boundingBox(); assert.ok(inspector); assert.ok(canvas);
  const directory = await pageDirectory().boundingBox(), details = await pageDock().getByRole('region', { name: '详情', exact: true }).boundingBox(); assert.ok(directory); assert.ok(details);
  assert.ok(inspector.width > 0 && inspector.x + inspector.width <= canvas.x + 2, description + ': the single event sidebar must remain left of the canvas.');
  assert.ok(inspector.y < canvas.y + canvas.height && inspector.y + inspector.height > canvas.y, description + ': sidebar and canvas share the workspace height.');
  assert.ok(directory.y + directory.height <= details.y + 2, description + ': member directory is above the unique detail editor.');
  assert.ok(directory.x + directory.width <= canvas.x + 2 && details.x + details.width <= canvas.x + 2, description + ': both member navigation and details stay on the left.');
  (evidence.inspectorLayouts as unknown[]).push({ description, inspector, canvas, directory, details, leftOfCanvas: true, singleSidebar: true });
}
async function setInspectorWidth(width: 220 | 280 | 360) {
  const separator = page!.getByRole('separator', { name: '调整蓝图属性宽度', exact: true });
  await separator.focus(); await separator.press('Home');
  for (let index = 0; index < Math.abs(width - 280) / 10; index++) await separator.press(width > 280 ? 'ArrowRight' : 'ArrowLeft');
  await expect(separator).toHaveAttribute('aria-valuenow', String(width)); await settle();
  await expect.poll(async () => Math.abs((await properties().boundingBox())!.width - width), { message: 'The left inspector width follows its accessible separator value.' }).toBeLessThanOrEqual(2);
  await assertInspectorLeft('普通蓝图左栏-' + width + 'px'); return separator;
}
async function unfold(panel: Locator) {
  const toggle = panel.locator(':scope > .ui-library-heading .ui-library-toggle');
  if (await toggle.count() && await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
}
async function chooseType(label: string, type: Exclude<BlueprintDataType, 'exec'>, owner: Locator) {
  const trigger = owner.getByRole('combobox', { name: label, exact: true }); await trigger.click();
  const options = page!.getByRole('listbox', { name: label + '选项', exact: true }); await expect(options).toBeVisible();
  await options.getByRole('option', { name: typeNames[type], exact: true }).click(); await expect(options).toBeHidden();
  await expect(trigger).toContainText(typeNames[type]);
}
async function enterValue(owner: Locator, label: string, type: Exclude<BlueprintDataType, 'exec'>, value: VariableValue) {
  if (type === 'asset') {
    await owner.getByRole('button', { name: '浏览' + label, exact: true }).click();
    const browser = page!.getByRole('dialog', { name: label + '资源浏览器', exact: true }); await expect(browser).toBeVisible();
    await browser.getByRole('button', { name: '预览资源 验收立绘素材', exact: true }).dblclick(); await expect(browser).toHaveCount(0);
  } else if (['boolean', 'scene', 'character', 'ui', 'component'].includes(type)) {
    const select = owner.getByRole('combobox', { name: label, exact: true }); await expect(select).toHaveJSProperty('tagName', 'SELECT'); await select.selectOption(String(value));
  } else {
    const input = owner.getByRole(type === 'number' ? 'spinbutton' : 'textbox', { name: label, exact: true }); await input.fill(String(value)); await input.press('Tab');
  }
}
async function createVariable(name: string, type: 'boolean' | 'number' | 'string', value: VariableValue, owner = variablePanel()) {
  const inDirectory = await owner.evaluate(element => element.classList.contains('ui-event-member-directory'));
  await owner.getByRole('button', { name: '新建变量', exact: true }).click(); const form = (inDirectory ? pageDetails() : owner).getByRole('form', { name: '创建状态变量', exact: true });
  await form.getByRole('textbox', { name: '变量名称', exact: true }).fill(name); await chooseType('变量类型', type, form); await enterValue(form, '变量初始值', type, value);
  await form.getByRole('button', { name: '创建变量', exact: true }).click(); await expect(form).toHaveCount(0);
  const row = owner.locator('[data-state-variable-id]').filter({ has: page!.getByRole('button', { name: '编辑变量 ' + name, exact: true }) }); await expect(row).toHaveCount(1);
  const id = await row.getAttribute('data-state-variable-id'); assert.ok(id); return id;
}
async function createInterface(direction: 'input' | 'output', name: string, type: Exclude<BlueprintDataType, 'exec'>, value: VariableValue) {
  await openTab('输入与输出'); const owner = direction === 'input' ? inputPanel() : outputPanel(), prefix = direction === 'input' ? '输入参数' : '输出结果', short = direction === 'input' ? '输入' : '输出';
  await owner.getByRole('button', { name: '添加' + short, exact: true }).click(); const form = owner.getByRole('form', { name: '创建' + prefix, exact: true });
  await form.getByRole('textbox', { name: '新' + prefix + '名称', exact: true }).fill(name); await chooseType('新' + prefix + '类型', type, form);
  const useDefault = form.getByLabel('新' + prefix + '使用默认值', { exact: true });
  if (['asset', 'scene', 'character', 'ui', 'component'].includes(type)) {
    await expect(useDefault).not.toBeChecked();
    await expect(type === 'asset' ? form.getByRole('button', { name: '浏览新' + prefix + '默认值', exact: true }) : form.getByRole('combobox', { name: '新' + prefix + '默认值', exact: true })).toBeVisible();
  } else { await openDisclosureAncestors(useDefault); await useDefault.setChecked(true); }
  await enterValue(form, '新' + prefix + '默认值', type, value);
  await expect(useDefault).toBeChecked();
  if (type === 'scene') {
    const selected = form.getByRole('combobox', { name: '新' + prefix + '默认值', exact: true });
    await expect(selected).toHaveValue(String(value)); await selected.selectOption(''); await expect(selected).toBeVisible(); await expect(selected).toHaveValue(''); await expect(useDefault).toBeChecked();
    await selected.selectOption(String(value)); await expect(useDefault).toBeChecked();
    (evidence.referenceClears as unknown[]).push({ surface: direction + '-draft', type, clearedValue: '', defaultRemainsEnabled: true, restoredValue: value });
  }
  await form.getByRole('button', { name: '创建' + short, exact: true }).click(); await expect(form).toHaveCount(0);
  const row = owner.locator('[data-interface-pin-id]').filter({ has: page!.getByRole('button', { name: '编辑' + prefix + ' ' + name, exact: true }) });
  const id = await row.getAttribute('data-interface-pin-id'); assert.ok(id); return id;
}
async function createPageParameter(direction: 'inputs' | 'outputs', name: string, type: Exclude<BlueprintDataType, 'exec' | 'any'>, value: VariableValue) {
  await unfold(pageInterface()); const owner = pageDirection(direction); await owner.getByRole('button', { name: '新增', exact: true }).click();
  const form = pageDetails().getByRole('form', { name: '创建页面参数', exact: true }); await form.getByRole('textbox', { name: '页面参数名称', exact: true }).fill(name);
  await chooseType('页面参数类型', type, form); await enterValue(form, '页面参数默认值', type, value); await form.getByRole('button', { name: '创建参数', exact: true }).click(); await expect(form).toHaveCount(0);
  const row = owner.locator('[data-page-parameter-id]').filter({ has: page!.getByRole('button', { name: '编辑' + (direction === 'inputs' ? '页面输入' : '页面结果') + ' ' + name, exact: true }) });
  const id = await row.getAttribute('data-page-parameter-id'); assert.ok(id); return id;
}
async function idsOnCanvas() { return page!.locator('.react-flow__node').evaluateAll(items => items.map(item => item.getAttribute('data-id')!)); }
async function newNode(before: string[]) {
  await expect.poll(async () => (await idsOnCanvas()).filter(id => !before.includes(id)).length).toBe(1);
  const id = (await idsOnCanvas()).find(id => !before.includes(id)); assert.ok(id); return id;
}
async function emptyPoint() {
  const point = await page!.locator('.flow-container').evaluate(element => {
    const bounds = element.getBoundingClientRect();
    for (const fy of [.65, .35, .8, .2, .5]) for (const fx of [.45, .65, .25, .8, .15]) {
      const x = bounds.left + bounds.width * fx, y = bounds.top + bounds.height * fy;
      const hit = document.elementFromPoint(x, y);
      if (hit?.classList.contains('react-flow__pane')) return { x, y };
    }
    return undefined;
  }); assert.ok(point, 'Expected an actual empty canvas point for member drop.'); return point;
}
async function realDrag(id: string, origin: 'name' | 'badge' | 'blank', owner: Locator, modifier?: 'Control' | 'Alt') {
  const row = memberRow(id, owner), target = row.locator('.blueprint-member-select'); await target.scrollIntoViewIfNeeded(); await expect(target).toHaveAttribute('draggable', 'true');
  const source = origin === 'badge' ? target.locator('.blueprint-member-type') : origin === 'name' ? target.locator('.blueprint-member-label') : target;
  const bounds = await source.boundingBox(); assert.ok(bounds);
  const start = { x: bounds.x + (origin === 'blank' ? 3 : Math.min(bounds.width / 2, 32)), y: bounds.y + bounds.height / 2 }, destination = await emptyPoint();
  const hit = await target.evaluate((element, point) => {
    const top = document.elementFromPoint(point.x, point.y);
    return { matches: !!top && (top === element || element.contains(top)), tag: top?.tagName, className: top?.getAttribute('class'), memberId: top?.closest('[data-blueprint-member-id]')?.getAttribute('data-blueprint-member-id'), bounds: element.getBoundingClientRect().toJSON() };
  }, start);
  (evidence.dragStarts as unknown[]).push({ id, origin, modifier: modifier ?? null, start, destination, hit });
  assert.equal(hit.matches, true, 'Real drag must start on the intended visible member: ' + JSON.stringify(hit));
  await target.evaluate(element => {
    (window as unknown as { __memberDragEvidence: unknown }).__memberDragEvidence = undefined;
    // React delegates dragstart on #root. A later listener on the same root
    // reads the MIME after the product handler has populated DataTransfer.
    element.closest('#root')!.addEventListener('dragstart', event => {
      const dragEvent = event as DragEvent;
      const transfer = dragEvent.dataTransfer;
      (window as unknown as { __memberDragEvidence: unknown }).__memberDragEvidence = transfer ? { types: [...transfer.types], mime: transfer.getData('application/vns-blueprint-member'), trusted: dragEvent.isTrusted } : undefined;
    }, { once: true });
  });
  const before = await idsOnCanvas(); if (modifier) await page!.keyboard.down(modifier);
  try {
    await page!.mouse.move(start.x, start.y); await page!.mouse.down(); await page!.mouse.move(start.x - 10, start.y + 2, { steps: 3 });
    await page!.mouse.move(destination.x, destination.y, { steps: 12 }); await page!.mouse.up();
  } finally { if (modifier) await page!.keyboard.up(modifier); }
  const drag = await page!.evaluate(() => (window as unknown as { __memberDragEvidence: { types: string[]; mime: string; trusted: boolean } }).__memberDragEvidence);
  assert.ok(drag, 'Native mouse gesture must dispatch dragstart.'); assert.equal(drag.trusted, true); assert.ok(drag.types.includes(BLUEPRINT_MEMBER_MIME));
  const reference = JSON.parse(drag.mime) as BlueprintMemberReference; assert.equal(reference.id, id); assert.equal(reference.projectId, initial.id); assert.equal(reference.version, 1);
  (evidence.realMouseDrags as unknown[]).push({ id, origin, modifier: modifier ?? null, reference, trusted: true }); return { before, reference, raw: drag.mime };
}
async function chooseMember(action: 'read' | 'write') { await expect(memberMenu()).toBeVisible(); await memberMenu().locator(`[data-node-picker-item="${action}-member"]`).click(); await expect(memberMenu()).toHaveCount(0); }
async function syntheticDrop(raw: string) {
  const point = await emptyPoint(); await page!.locator('.flow-container').evaluate((element, { raw, point }) => {
    const transfer = new DataTransfer(); transfer.setData('application/vns-blueprint-member', raw);
    element.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: point.x, clientY: point.y }));
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: point.x, clientY: point.y }));
  }, { raw, point }); await settle();
}
async function assertAdded(before: string[], graphId: string, type: BlueprintNode['type'], property: string, id: string, dataType: BlueprintDataType) {
  const added = await newNode(before), value = graphId === 'member_page_graph' ? await saveUi() : await save();
  const node = graph(value, graphId).nodes.find(item => item.id === added); assert.ok(node); assert.equal(node.type, type); assert.equal(node.properties[property], id);
  assert.equal(node.pins.find(pin => pin.id === 'value')?.dataType, dataType); return node;
}
async function keyboardAction(row: Locator, name: string) {
  const inDirectory = await row.evaluate(element => !!element.closest('.ui-event-member-directory'));
  if (inDirectory) { const select = row.locator('.blueprint-member-select'); await select.focus(); await select.press('Enter'); }
  const action = (inDirectory ? pageDetails() : row).getByRole('button', { name, exact: true }); await action.focus(); await expect(action).toBeFocused(); await action.press('Enter');
}
async function setTheme(name: string, id: string) {
  await button('作品设置').click(); const dialog = page!.getByRole('dialog', { name: '作品设置', exact: true }); await dialog.getByRole('button', { name: '编辑器外观', exact: true }).click();
  await dialog.getByRole('group', { name: '编辑器配色', exact: true }).getByRole('button', { name: new RegExp('^' + name) }).click();
  await expect(page!.locator('html')).toHaveAttribute('data-editor-theme', id); await dialog.getByRole('button', { name: '完成', exact: true }).click(); await settle();
}
async function assertLayout(owner: Locator, description: string) {
  const layout = await owner.evaluate(element => {
    const root = element.getBoundingClientRect();
    const controls = [...element.querySelectorAll<HTMLElement>('input,select,button,textarea')].filter(item => item.getClientRects().length).map(item => {
      const bounds = item.getBoundingClientRect(); return { label: item.getAttribute('aria-label') ?? item.textContent?.trim(), left: bounds.left, right: bounds.right, width: bounds.width };
    }); return { width: element.clientWidth, scrollWidth: element.scrollWidth, left: root.left, right: root.right, controls };
  });
  assert.ok(layout.scrollWidth <= layout.width + 2, description + ': no horizontal overflow ' + JSON.stringify(layout));
  assert.deepEqual(layout.controls.filter(item => item.width > 0 && (item.left < layout.left - 2 || item.right > layout.right + 2)), [], description);
  assert.equal(await page!.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  (evidence.layouts as unknown[]).push({ description, ...layout });
}
async function assertIdentityRow(form: Locator, nameLabel: string, typeLabel: string, description: string) {
  const identity = form.locator('.blueprint-member-draft-identity'); await expect(identity).toBeVisible();
  const name = await identity.getByRole('textbox', { name: nameLabel, exact: true }).boundingBox();
  const type = await identity.getByRole('combobox', { name: typeLabel, exact: true }).boundingBox(); assert.ok(name); assert.ok(type);
  assert.ok(name.x + name.width <= type.x + 2, description + ': type follows name without overlap.');
  assert.ok(Math.abs(name.y + name.height / 2 - type.y - type.height / 2) <= 2, description + ': name and type share one row.');
  (evidence.layouts as unknown[]).push({ description, name, type, sameRow: true });
}

const variableIds: Record<string, string> = {}, inputIds: Record<string, string> = {}, outputIds: Record<string, string> = {}, pageInputIds: Record<string, string> = {}, pageOutputIds: Record<string, string> = {};
let retainedLayout: { normalInspectorWidth: number; pageSidebarWidth: number; pageDirectoryRatio: number } | undefined;
let inputPayload = '', outputPayload = '', callPayload = '';
try {
  await fs.mkdir(path.dirname(projectFile), { recursive: true }); report.fingerprintsBefore = await fingerprints();
  await fs.writeFile(path.join(path.dirname(projectFile), 'portrait.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="300"><rect width="180" height="300" fill="#c06070"/></svg>');
  await saveProject(projectFile, initial); await fs.copyFile(projectFile, path.join(output, 'input-project.json')); await launch(); await openGraph();

  await check('普通蓝图新建变量明文创建取消、空名称禁止提交、Esc不写工程', async () => {
    await openTab('变量'); await variablePanel().getByRole('button', { name: '新建变量', exact: true }).click();
    const form = variablePanel().getByRole('form', { name: '创建状态变量', exact: true }); await expect(form.getByRole('textbox', { name: '变量名称', exact: true })).toBeFocused();
    await expect(form.getByRole('button', { name: '创建变量', exact: true })).toBeDisabled(); await expect(form.getByRole('button', { name: '创建变量', exact: true })).toHaveText(/创建/);
    await expect(form.getByRole('button', { name: '取消', exact: true })).toHaveText('取消'); await form.getByRole('textbox', { name: '变量名称', exact: true }).fill('取消临时定义');
    await screenshot('01-variable-creation'); await form.getByRole('textbox', { name: '变量名称', exact: true }).press('Escape'); await expect(form).toHaveCount(0);
    await expect(variablePanel().getByRole('button', { name: '新建变量', exact: true })).toBeFocused(); assert.deepEqual(graph(await read(), 'member_graph').localVariables, initial.blueprints[0].localVariables);
  });
  await check('类型选择器键盘导航、Esc与Tab及外点焦点、IME回车不创建', async () => {
    await variablePanel().getByRole('button', { name: '新建变量', exact: true }).click(); const form = variablePanel().getByRole('form', { name: '创建状态变量', exact: true });
    const name = form.getByRole('textbox', { name: '变量名称', exact: true }), type = form.getByRole('combobox', { name: '变量类型', exact: true });
    await type.focus(); await type.press('Space'); const list = page!.getByRole('listbox', { name: '变量类型选项', exact: true }); await expect(list.getByRole('option')).toHaveCount(3);
    await page!.keyboard.press('End'); await page!.keyboard.press('Enter'); await expect(type).toContainText('文字');
    await type.click(); await page!.keyboard.press('Escape'); await expect(list).toBeHidden(); await expect(type).toBeFocused(); await expect(form).toBeVisible();
    await type.click(); await page!.keyboard.press('Tab'); await expect(list).toBeHidden(); await expect(form.getByRole('textbox', { name: '变量初始值', exact: true })).toBeFocused();
    await type.click(); await page!.keyboard.press('Shift+Tab'); await expect(list).toBeHidden(); await expect(name).toBeFocused();
    await type.click(); await expect(list).toBeVisible(); await type.click(); await expect(list).toBeHidden(); await expect(type).toBeFocused();
    await type.click(); await name.click(); await expect(list).toBeHidden(); await settle(); await expect(name).toBeFocused();
    evidence.nativePopoverFocus = { escapeReturnsTo: '变量类型', tabContinuesTo: '变量初始值', shiftTabContinuesTo: '变量名称', secondTriggerClickCloses: true, outsideClickKeepsFocusOn: '变量名称' };
    await name.fill('中文合成输入'); await name.evaluate(element => { element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '中文' })); element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', isComposing: true, keyCode: 229 })); });
    await expect(form).toBeVisible(); await expect(variablePanel().getByRole('button', { name: '编辑变量 中文合成输入', exact: true })).toHaveCount(0);
    await name.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中文合成输入' })));
    await name.press('Escape'); await expect(form).toHaveCount(0); assert.equal(graph(await read(), 'member_graph').localVariables?.length ?? 0, 0);
  });
  await check('false、0、空文字变量创建各自可撤销并保存不改类型', async () => {
    for (const [key, name, type, value] of [['false', '局部开关', 'boolean', false], ['zero', '局部数值', 'number', 0], ['empty', '局部文字', 'string', '']] as const) {
      const id = await createVariable(name, type, value); variableIds[key] = id; await button('撤销').click(); await expect(memberRow(id, variablePanel())).toHaveCount(0);
      await button('重做').click(); await expect(memberRow(id, variablePanel())).toBeVisible();
    }
    const saved = await save(); for (const [key, type, value] of [['false', 'boolean', false], ['zero', 'number', 0], ['empty', 'string', '']] as const) {
      const variable = graph(saved, 'member_graph').localVariables!.find(item => item.id === variableIds[key]); assert.ok(variable); assert.equal(variable.type, type); assert.equal(variable.initial, value);
    } await screenshot('02-three-variable-defaults');
  });
  await check('输入创建紧凑布局、类型说明解释场景小章节、三个零值默认均保存', async () => {
    await openTab('输入与输出'); await inputPanel().getByRole('button', { name: '添加输入', exact: true }).click(); const form = inputPanel().getByRole('form', { name: '创建输入参数', exact: true });
    await form.getByRole('combobox', { name: '新输入参数类型', exact: true }).click(); const list = page!.getByRole('listbox', { name: '新输入参数类型选项', exact: true });
    await expect(list.getByRole('option', { name: '场景引用', exact: true })).toContainText(/剧情目录|小章节/); await expect(list.getByRole('option', { name: '页面引用', exact: true })).toContainText(/页面|界面/);
    await screenshot('03-type-meaning-examples'); await page!.keyboard.press('Escape'); await form.getByRole('button', { name: '取消', exact: true }).click();
    for (const [key, name, type, value] of [['false', '输入开关', 'boolean', false], ['zero', '输入数值', 'number', 0], ['empty', '输入文字', 'string', '']] as const) inputIds[key] = await createInterface('input', name, type, value);
    const saved = await save(); for (const [key, value] of [['false', false], ['zero', 0], ['empty', '']] as const) assert.equal(graph(saved, 'member_graph').exposedInputs.find(pin => pin.id === inputIds[key])?.defaultValue, value);
  });
  await check('场景角色页面控件素材输入默认值选择实际对象且类型保存', async () => {
    for (const [type, name, value] of [['scene', '目标场景输入', 'member_scene'], ['character', '角色输入', 'member_actor'], ['ui', '页面输入', 'member_page'], ['component', '控件输入', 'member_text'], ['asset', '素材输入', 'member_portrait']] as const) {
      inputIds[type] = await createInterface('input', name, type, value);
    }
    const saved = await save(); for (const [type, value] of [['scene', 'member_scene'], ['character', 'member_actor'], ['ui', 'member_page'], ['component', 'member_text'], ['asset', 'member_portrait']] as const) {
      const pin = graph(saved, 'member_graph').exposedInputs.find(pin => pin.id === inputIds[type]); assert.ok(pin); assert.equal(pin.dataType, type); assert.equal(pin.defaultValue, value);
    } await screenshot('04-reference-inputs');
  });
  await check('输出定义创建及明确设置按钮支持键盘', async () => {
    for (const [key, name, type, value] of [['false', '开关返回值', 'boolean', false], ['zero', '数值返回值', 'number', 0], ['empty', '文字返回值', 'string', ''], ['scene', '场景返回值', 'scene', 'member_scene']] as const) outputIds[key] = await createInterface('output', name, type, value);
    await memberRow(outputIds.scene, outputPanel()).getByRole('button', { name: '编辑输出结果 场景返回值', exact: true }).click();
    const detail = outputPanel().locator(`[data-interface-details-id="${outputIds.scene}"]`), reference = detail.getByRole('combobox', { name: '场景返回值的默认值', exact: true });
    const useDefault = detail.getByRole('checkbox', { name: '场景返回值使用默认值', exact: true });
    await expect(reference).toHaveValue('member_scene'); await reference.selectOption(''); await expect(reference).toBeVisible(); await expect(reference).toHaveValue(''); await expect(useDefault).toBeChecked();
    assert.equal(graph(await save(), 'member_graph').exposedOutputs.find(pin => pin.id === outputIds.scene)?.defaultValue, '');
    await useDefault.setChecked(false); await expect(useDefault).not.toBeChecked(); await expect(reference).toBeVisible();
    assert.equal(graph(await save(), 'member_graph').exposedOutputs.find(pin => pin.id === outputIds.scene)?.defaultValue, undefined);
    await reference.selectOption('member_scene'); await expect(useDefault).toBeChecked(); assert.equal(graph(await save(), 'member_graph').exposedOutputs.find(pin => pin.id === outputIds.scene)?.defaultValue, 'member_scene');
    (evidence.referenceClears as unknown[]).push({ surface: 'output-detail', type: 'scene', clearedValue: '', defaultRemainsEnabled: true, checkboxDisablesDefault: true, pickerRemainsVisible: true, restoredValue: 'member_scene' });
    const row = memberRow(outputIds.zero, outputPanel()), before = await idsOnCanvas(); await keyboardAction(row, '写入输出 数值返回值');
    const node = await assertAdded(before, 'member_graph', 'setOutput', 'outputId', outputIds.zero, 'number'); assert.equal(node.properties.value, 0);
    const saved = await read(); for (const [key, type, value] of [['false', 'boolean', false], ['zero', 'number', 0], ['empty', 'string', ''], ['scene', 'scene', 'member_scene']] as const) {
      const pin = graph(saved, 'member_graph').exposedOutputs.find(pin => pin.id === outputIds[key]); assert.ok(pin); assert.equal(pin.dataType, type); assert.equal(pin.defaultValue, value);
    }
  });
  await check('变量名称真实拖入普通蓝图弹读取设置，选择读取保留false', async () => {
    await openTab('变量'); const drag = await realDrag(variableIds.false, 'name', variablePanel()); callPayload = drag.raw;
    assert.equal(drag.reference.kind, 'variable'); assert.equal('scope' in drag.reference && drag.reference.scope, 'call');
    await expect(memberMenu().locator('[data-node-picker-item="read-member"]')).toBeEnabled(); await expect(memberMenu().locator('[data-node-picker-item="write-member"]')).toBeEnabled();
    await screenshot('05-variable-drag-choice'); await chooseMember('read'); await assertAdded(drag.before, 'member_graph', 'getVariable', 'variableId', variableIds.false, 'boolean');
  });
  await check('变量类型标记真实拖放设置，初始零不丢失', async () => {
    await openTab('变量'); const drag = await realDrag(variableIds.zero, 'badge', variablePanel()); await chooseMember('write');
    const node = await assertAdded(drag.before, 'member_graph', 'setVariable', 'variableId', variableIds.zero, 'number'); assert.equal(node.properties.value, 0);
  });
  await check('变量行内留白可拖；Ctrl读取Alt设置不弹额外菜单', async () => {
    for (const [modifier, type] of [['Control', 'getVariable'], ['Alt', 'setVariable']] as const) {
      await openTab('变量'); const drag = await realDrag(variableIds.empty, 'blank', variablePanel(), modifier); await expect(memberMenu()).toHaveCount(0);
      const node = await assertAdded(drag.before, 'member_graph', type, 'variableId', variableIds.empty, 'string'); if (type === 'setVariable') assert.equal(node.properties.value, '');
    }
  });
  await check('输入整行拖放直接读取，五类引用生成准确类型引脚；Alt仍读取', async () => {
    for (const [type, origin] of [['scene', 'badge'], ['character', 'name'], ['ui', 'blank'], ['component', 'badge'], ['asset', 'name']] as const) {
      await openTab('输入与输出'); const drag = await realDrag(inputIds[type], origin, inputPanel()); if (type === 'scene') inputPayload = drag.raw;
      await expect(memberMenu()).toHaveCount(0); await assertAdded(drag.before, 'member_graph', 'getInput', 'inputId', inputIds[type], type);
    }
    await openTab('输入与输出'); const drag = await realDrag(inputIds.zero, 'blank', inputPanel(), 'Alt'); await assertAdded(drag.before, 'member_graph', 'getInput', 'inputId', inputIds.zero, 'number');
    await screenshot('06-typed-input-getters');
  });
  await check('输出名称与留白拖放直接写入；Ctrl没有读取能力时仍默认写入', async () => {
    await openTab('输入与输出'); let drag = await realDrag(outputIds.scene, 'name', outputPanel()); outputPayload = drag.raw;
    await expect(memberMenu()).toHaveCount(0); await assertAdded(drag.before, 'member_graph', 'setOutput', 'outputId', outputIds.scene, 'scene');
    await openTab('输入与输出'); drag = await realDrag(outputIds.zero, 'blank', outputPanel(), 'Control'); await expect(memberMenu()).toHaveCount(0);
    const node = await assertAdded(drag.before, 'member_graph', 'setOutput', 'outputId', outputIds.zero, 'number'); assert.equal(node.properties.value, 0);
  });
  await check('场景输入的数据引脚真实接入切换场景，保留场景身份', async () => {
    const current = await read(), getter = nodesFor(current, 'member_graph', 'getInput', 'inputId', inputIds.scene)[0]; assert.ok(getter);
    await fitBlueprintCanvas(page!); await card(getter.id).locator('.react-flow__handle[data-handleid="value"]').click(); await card('member_switch').locator('.react-flow__handle[data-handleid="sceneId"]').click();
    const saved = await save(); assert.ok(graph(saved, 'member_graph').links.some(link => link.fromNodeId === getter.id && link.fromPinId === 'value' && link.toNodeId === 'member_switch' && link.toPinId === 'sceneId'));
    assert.equal(graph(saved, 'member_graph').exposedInputs.find(pin => pin.id === inputIds.scene)?.defaultValue, 'member_scene');
    evidence.sceneConnection = { sceneId: 'member_scene', getterId: getter.id, targetNodeId: 'member_switch', inputPin: 'sceneId', nativeExecution: false }; await screenshot('07-scene-input-wire');
  });
  await check('真实成员数据跨蓝图复投拒绝输入输出调用变量且不添加节点', async () => {
    await openGraph('member_other'); const before = await save();
    for (const raw of [inputPayload, outputPayload, callPayload]) {
      assert.ok(raw); const ids = await idsOnCanvas(); await syntheticDrop(raw); await expect(memberMenu()).toHaveCount(0);
      await expect(page!.locator('.blueprint-status')).toContainText(/所属蓝图|只能用于/); assert.deepEqual(await idsOnCanvas(), ids);
      (evidence.syntheticRejections as unknown[]).push({ reference: JSON.parse(raw), reason: 'cross-graph-owner', realDragSourceCaptured: true });
    }
    assert.deepEqual(await save(), before);
  });
  await check('页面输入结果复用类型选择器，false零空与实际对象默认保存', async () => {
    await openPageGraph();
    for (const [key, name, type, value] of [['false', '页面输入开关', 'boolean', false], ['zero', '页面输入零值', 'number', 0], ['empty', '页面输入空文字', 'string', ''], ['scene', '页面输入场景', 'scene', 'member_scene'], ['ui', '页面输入目标页', 'ui', 'member_page'], ['component', '页面输入控件', 'component', 'member_text']] as const) pageInputIds[key] = await createPageParameter('inputs', name, type, value);
    for (const [key, name, type, value] of [['false', '页面结果开关', 'boolean', false], ['zero', '页面结果零值', 'number', 0], ['empty', '页面结果空文字', 'string', '']] as const) pageOutputIds[key] = await createPageParameter('outputs', name, type, value);
    const saved = await saveUi(); for (const [key, value] of [['false', false], ['zero', 0], ['empty', ''], ['scene', 'member_scene'], ['ui', 'member_page'], ['component', 'member_text']] as const) assert.equal(uiPageInterface(saved, 'member_page')!.inputs.find(pin => pin.id === pageInputIds[key])?.defaultValue, value);
    for (const [key, type, value] of [['false', 'boolean', false], ['zero', 'number', 0], ['empty', 'string', '']] as const) {
      const parameter = uiPageInterface(saved, 'member_page')!.outputs.find(pin => pin.id === pageOutputIds[key]); assert.ok(parameter); assert.equal(parameter.dataType, type); assert.equal(parameter.defaultValue, value);
    }
    await screenshot('08-page-interface-defaults');
  });
  await check('页面输入直接读取、结果普通菜单与Ctrl读取Alt设置，明确按钮键盘可用', async () => {
    await unfold(pageInterface()); let drag = await realDrag(pageInputIds.scene, 'badge', pageDirection('inputs'), 'Alt');
    await expect(memberMenu()).toHaveCount(0); await assertAdded(drag.before, 'member_page_graph', 'getPageInput', 'parameterId', pageInputIds.scene, 'scene');
    drag = await realDrag(pageOutputIds.zero, 'name', pageDirection('outputs')); await chooseMember('read'); await assertAdded(drag.before, 'member_page_graph', 'getPageOutput', 'parameterId', pageOutputIds.zero, 'number');
    for (const [modifier, type, origin] of [['Control', 'getPageOutput', 'badge'], ['Alt', 'setPageOutput', 'blank']] as const) {
      drag = await realDrag(pageOutputIds.empty, origin, pageDirection('outputs'), modifier); await expect(memberMenu()).toHaveCount(0);
      const node = await assertAdded(drag.before, 'member_page_graph', type, 'parameterId', pageOutputIds.empty, 'string'); if (type === 'setPageOutput') assert.equal(node.properties.value, '');
    }
    const row = memberRow(pageInputIds.zero, pageDirection('inputs')), before = await idsOnCanvas(); await keyboardAction(row, '读取页面输入 页面输入零值');
    await assertAdded(before, 'member_page_graph', 'getPageInput', 'parameterId', pageInputIds.zero, 'number'); await screenshot('09-page-member-drags');
  });
  await check('作品变量在普通图和页面图统一读写，页面变量整行拖入不改默认', async () => {
    await unfold(pageVariables()); await pageVariables().getByLabel('状态列表作用域', { exact: true }).selectOption('project');
    let drag = await realDrag('member_shared', 'badge', pageVariables()); await chooseMember('write'); let node = await assertAdded(drag.before, 'member_page_graph', 'setVariable', 'variableId', 'member_shared', 'boolean'); assert.equal(node.properties.scope, 'project'); assert.equal(node.properties.value, false);
    await pageVariables().getByLabel('状态列表作用域', { exact: true }).selectOption('page'); await pageVariables().getByLabel('状态所属页面', { exact: true }).selectOption('member_page');
    drag = await realDrag('member_page_state', 'blank', pageVariables(), 'Control'); node = await assertAdded(drag.before, 'member_page_graph', 'getVariable', 'variableId', 'member_page_state', 'number'); assert.equal(node.properties.pageId, 'member_page');
    await saveUi(); await openGraph(); await openTab('变量'); await variablePanel().getByLabel('状态列表作用域', { exact: true }).selectOption('project');
    drag = await realDrag('member_shared', 'name', variablePanel()); await chooseMember('read'); node = await assertAdded(drag.before, 'member_graph', 'getVariable', 'variableId', 'member_shared', 'boolean'); assert.equal(node.properties.scope, 'project');
    await openTab('变量'); await variablePanel().getByLabel('状态列表作用域', { exact: true }).selectOption('project');
    const before = await idsOnCanvas(); await keyboardAction(memberRow('member_shared', variablePanel()), '设置 作品共享开关'); await assertAdded(before, 'member_graph', 'setVariable', 'variableId', 'member_shared', 'boolean');
    assert.equal((await read()).ui.pageVariables?.member_page[0].initial, 0);
  });
  await check('蓝图属性居左，折叠调宽后真实拖放；窄栏双主题无溢出及名称类型同行', async () => {
    await openTab('变量'); await variablePanel().getByLabel('状态列表作用域', { exact: true }).selectOption('call');
    await setInspectorWidth(360);
    await variablePanel().getByRole('button', { name: '新建变量', exact: true }).click(); let wideForm = variablePanel().getByRole('form', { name: '创建状态变量', exact: true });
    await assertIdentityRow(wideForm, '变量名称', '变量类型', '变量360px名称与类型同行'); await wideForm.getByRole('button', { name: '取消', exact: true }).click();
    await openTab('输入与输出'); await inputPanel().getByRole('button', { name: '添加输入', exact: true }).click(); wideForm = inputPanel().getByRole('form', { name: '创建输入参数', exact: true });
    await assertIdentityRow(wideForm, '新输入参数名称', '新输入参数类型', '输入360px名称与类型同行'); await wideForm.getByRole('button', { name: '取消', exact: true }).click(); await openTab('变量');
    await setInspectorWidth(220); const beforeCollapse = await save(), expandedCanvas = await page!.locator('.flow-container').boundingBox(); assert.ok(expandedCanvas);
    await button('收起蓝图属性').click(); await expect(properties()).toHaveCount(0); await expect(button('展开蓝图属性')).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(async () => (await page!.locator('.flow-container').boundingBox())!.width).toBeGreaterThan(expandedCanvas.width + 150);
    await screenshot('10-inspector-collapsed-left'); await button('展开蓝图属性').click(); await expect(properties()).toBeVisible();
    await expect(page!.getByRole('separator', { name: '调整蓝图属性宽度', exact: true })).toHaveAttribute('aria-valuenow', '220'); await assertInspectorLeft('普通蓝图左栏折叠恢复');
    assert.deepEqual(await save(), beforeCollapse); await openTab('变量');
    for (const [name, id] of [['黑白', 'codexDark'], ['亮白', 'codexLight']] as const) {
      await setTheme(name, id); await assertInspectorLeft('普通蓝图左栏220px-' + id); await variablePanel().getByRole('button', { name: '新建变量', exact: true }).click(); await assertLayout(variablePanel(), '普通蓝图220px-' + id);
      const form = variablePanel().getByRole('form', { name: '创建状态变量', exact: true }); await expect(form.getByRole('button', { name: '创建变量', exact: true })).toBeVisible(); await expect(form.getByRole('button', { name: '取消', exact: true })).toBeVisible();
      await screenshot('10-variable-narrow-' + id); await form.getByRole('button', { name: '取消', exact: true }).click();
      await openTab('输入与输出'); await inputPanel().getByRole('button', { name: '添加输入', exact: true }).click(); await assertLayout(inputPanel(), '输入接口220px-' + id); await screenshot('11-interface-narrow-' + id);
      await inputPanel().getByRole('form', { name: '创建输入参数', exact: true }).getByRole('button', { name: '取消', exact: true }).click();
      const drag = await realDrag(inputIds.scene, id === 'codexDark' ? 'badge' : 'blank', inputPanel(), 'Control'); await expect(memberMenu()).toHaveCount(0);
      await assertAdded(drag.before, 'member_graph', 'getInput', 'inputId', inputIds.scene, 'scene'); await assertInspectorLeft('普通蓝图左栏220px真实拖入-' + id); await openTab('变量');
    }
    await setInspectorWidth(360); await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1180, 850)); await openPageGraph(); await unfold(pageInterface());
    const leftSeparator = pageDock().getByRole('separator', { name: '调整事件图左栏宽度', exact: true });
    const heightSeparator = pageDock().getByRole('separator', { name: '调整目录与详情高度', exact: true });
    await expect(leftSeparator).toHaveAttribute('aria-valuenow', '340'); await expect(heightSeparator).toHaveAttribute('aria-valuenow', '32');
    await expect(pageDock().getByRole('separator', { name: '调整右侧面板宽度', exact: true })).toHaveCount(0);
    await leftSeparator.focus(); await leftSeparator.press('ArrowRight'); await expect(leftSeparator).toHaveAttribute('aria-valuenow', '348');
    await leftSeparator.press('ArrowLeft'); await expect(leftSeparator).toHaveAttribute('aria-valuenow', '340');
    const beforePageFold = await saveUi(), fold = pageInterface().locator(':scope > .ui-library-heading .ui-library-toggle');
    await fold.click(); await expect(fold).toHaveAttribute('aria-expanded', 'false'); await expect(pageDirection('inputs')).toBeHidden();
    await fold.click(); await expect(fold).toHaveAttribute('aria-expanded', 'true'); await expect(pageDirection('inputs')).toBeVisible();
    assert.deepEqual(await saveUi(), beforePageFold);
    await pageDock().getByRole('button', { name: '恢复默认事件图布局', exact: true }).click();
    await expect(leftSeparator).toHaveAttribute('aria-valuenow', '340'); await expect(heightSeparator).toHaveAttribute('aria-valuenow', '32'); await assertPageInspectorLeft('页面事件图恢复默认布局');
    await leftSeparator.focus(); await leftSeparator.press('Home'); await expect(leftSeparator).toHaveAttribute('aria-valuenow', '280');
    for (const [name, id] of [['黑白', 'codexDark'], ['亮白', 'codexLight']] as const) {
      await setTheme(name, id); await assertPageInspectorLeft('页面事件图左栏280px-' + id);
      await pageDirectory().getByRole('button', { name: '本图设置', exact: true }).click();
      await pageGraphInputs().getByRole('button', { name: '添加调用输入', exact: true }).click(); await assertLayout(pageGraphInputs(), '页面事件图左输入窄窗口-' + id); await screenshot('12-page-left-inspector-' + id);
      await pageGraphInputs().getByRole('form', { name: '创建调用输入', exact: true }).getByRole('button', { name: '取消', exact: true }).click();
      await unfold(pageVariables()); await pageVariables().getByLabel('状态列表作用域', { exact: true }).selectOption('page');
      await pageVariables().getByLabel('状态所属页面', { exact: true }).selectOption('member_page');
      await memberRow('member_page_state', pageVariables()).locator('.blueprint-member-select').click();
      await assertLayout(pageVariables(), '页面事件图变量目录窄窗口-' + id); await assertLayout(pageDetails(), '页面事件图变量详情窄窗口-' + id);
      let drag = await realDrag('member_page_state', id === 'codexDark' ? 'name' : 'badge', pageVariables(), 'Control'); await expect(memberMenu()).toHaveCount(0);
      const node = await assertAdded(drag.before, 'member_page_graph', 'getVariable', 'variableId', 'member_page_state', 'number'); assert.equal(node.properties.pageId, 'member_page');
      assert.equal((await read()).ui.pageVariables?.member_page[0].initial, 0); await assertPageInspectorLeft('页面左属性变量真实拖入-' + id);
      await pageDirection('inputs').getByRole('button', { name: '新增', exact: true }).click(); await assertLayout(pageInterface(), '页面接口目录窄窗口-' + id); await assertLayout(pageDetails(), '页面接口详情窄窗口-' + id); await screenshot('12-page-interface-narrow-' + id);
      await pageDetails().getByRole('form', { name: '创建页面参数', exact: true }).getByRole('button', { name: '取消', exact: true }).click();
      drag = await realDrag(pageInputIds.scene, id === 'codexDark' ? 'badge' : 'blank', pageDirection('inputs'), 'Control'); await expect(memberMenu()).toHaveCount(0);
      await assertAdded(drag.before, 'member_page_graph', 'getPageInput', 'parameterId', pageInputIds.scene, 'scene'); await assertPageInspectorLeft('页面分类折叠调宽后真实拖入-' + id);
    }
    retainedLayout = { normalInspectorWidth: 360, pageSidebarWidth: 280, pageDirectoryRatio: 32 }; evidence.retainedLayout = retainedLayout; await saveUi();
  });
  await check('保存重开保留变量接口实际对象、零值及生成节点引脚，浏览不改工程', async () => {
    const before = await read(); await close(); await launch(); await openGraph(); await openTab('变量');
    assert.ok(retainedLayout); await expect(page!.getByRole('separator', { name: '调整蓝图属性宽度', exact: true })).toHaveAttribute('aria-valuenow', String(retainedLayout.normalInspectorWidth));
    for (const id of Object.values(variableIds)) await expect(memberRow(id, variablePanel())).toBeVisible(); await openTab('输入与输出');
    for (const id of Object.values(inputIds)) await expect(memberRow(id, inputPanel())).toHaveCount(1);
    await openPageGraph(); await expect(pageDock().getByRole('separator', { name: '调整事件图左栏宽度', exact: true })).toHaveAttribute('aria-valuenow', String(retainedLayout.pageSidebarWidth));
    await expect(pageDock().getByRole('separator', { name: '调整目录与详情高度', exact: true })).toHaveAttribute('aria-valuenow', String(retainedLayout.pageDirectoryRatio));
    await expect(pageDock().getByRole('separator', { name: '调整右侧面板宽度', exact: true })).toHaveCount(0);
    await unfold(pageInterface()); for (const id of Object.values(pageInputIds)) await expect(memberRow(id, pageDirection('inputs'))).toHaveCount(1);
    const saved = await read(); assert.deepEqual(saved, before); assert.equal(graph(saved, 'member_graph').localVariables!.find(variable => variable.id === variableIds.false)?.initial, false);
    assert.equal(graph(saved, 'member_graph').localVariables!.find(variable => variable.id === variableIds.zero)?.initial, 0); assert.equal(graph(saved, 'member_graph').localVariables!.find(variable => variable.id === variableIds.empty)?.initial, '');
    for (const [type, id] of Object.entries(inputIds).filter(([type]) => ['scene', 'character', 'ui', 'component', 'asset'].includes(type))) {
      const getter = nodesFor(saved, 'member_graph', 'getInput', 'inputId', id)[0]; assert.ok(getter); assert.equal(getter.pins.find(pin => pin.id === 'value')?.dataType, type);
    }
    evidence.members = { variableIds, inputIds, outputIds, pageInputIds, pageOutputIds }; await fs.copyFile(projectFile, path.join(output, 'saved-project.json')); await screenshot('13-reopened-members');
  });
  assert.equal(checks.length, 18); assert.deepEqual(pageErrors, []); report.status = 'passed';
} catch (error) {
  failure = error; report.status = 'failed'; report.phase = phase; report.error = String(error);
  if (app && page) await screenshot('failure').catch(error => { report.screenshotError = String(error); });
} finally {
  await close().catch(error => { failure ??= error; report.status = 'failed'; report.closeError = String(error); });
  try { report.fingerprintsAfter = await fingerprints(); assert.deepEqual(report.fingerprintsAfter, report.fingerprintsBefore); }
  catch (error) { failure ??= error; report.status = 'failed'; report.buildIntegrityError = String(error); }
  await fs.mkdir(output, { recursive: true }); await writeReport();
  if (!app && processes.every(item => item.exited)) {
    try {
      const cleanup = await cleanVerificationDirectories(output, ['fixture', 'profile']); report.cleanup = cleanup; assert.deepEqual(cleanup.errors, []);
      await Promise.all(cleanup.removed.map(async target => { await assert.rejects(fs.stat(target), { code: 'ENOENT' }); }));
    } catch (error) { failure ??= error; report.status = 'failed'; report.cleanupError = String(error); }
  } else { failure ??= new Error('An owned acceptance process did not exit.'); report.status = 'failed'; report.cleanupSkipped = 'Owned process still present'; }
  await writeReport(); console.log(output);
}
if (failure) throw failure;
