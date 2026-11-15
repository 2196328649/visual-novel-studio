import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { createProject, projectSchema, type Project, type UiComponent, type Variable } from '../src/core/model';
import { blueprintNodeDefaults, createBlueprintGraph } from '../src/core/blueprint';
import { playerPreferenceKeys } from '../src/core/preferences';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openDisclosureAncestors } from './lib/ui-disclosures';
import { openUiPreviewForTest } from './lib/ui-preview-window';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

// Pending acceptance: run only after all parameter work, unified checks and the
// source build are complete. This script never builds, starts Vite, runs a game,
// or loads the author's project. Saved JSON supplies independent expectations;
// no parameter mutation/default-resolution helpers are used as the oracle.
if (process.env.VNS_INSTALLED_EXE) throw new Error('Use the isolated compiled source editor.');
const root = path.resolve('.');
const output = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? 'artifacts/parameter-generalization-2026-11-11',
  'editor-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const relativeOutput = path.relative(root, output);
if (!relativeOutput || relativeOutput === '..' || relativeOutput.startsWith('..' + path.sep) || path.isAbsolute(relativeOutput)) {
  throw new Error('The acceptance run must be inside this workspace.');
}
const projectFile = path.join(output, 'fixture/project.vns.json'), profile = path.join(output, 'profile');
const authorFile = path.resolve(process.env.VNS_AUTHOR_PROJECT ?? '../我的视觉小说1/project.vns.json');
assert.notEqual(authorFile.toLowerCase(), projectFile.toLowerCase());
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

function fixture(): Project {
  const project = createProject('通用参数集桌面验收'); project.id = 'parameter_generalization_acceptance';
  project.width = 1280; project.height = 720;
  project.resourceSettings = { importMode: 'copy', directory: 'assets', syncFolders: false };
  project.parameterSets = [
    { id: 'pg_a', name: '剧情与界面甲', kind: 'story', defaults: { persistent: false, resetWithSettings: false } },
    { id: 'pg_b', name: '任意用途乙', kind: 'story', defaults: { persistent: true, resetWithSettings: true } },
    // Deliberately keep old members without explicit reset. Their old effective
    // reset is true even when persistent is false; organization must preserve it.
    { id: 'pg_legacy', name: '旧设置分类', kind: 'settings' },
  ];
  project.variables = [
    { id: 'pg_zero', name: '零值数值', type: 'number', initial: 0, persistent: false, resetWithSettings: false, parameterSetId: 'pg_a' },
    { id: 'pg_false', name: '关闭开关', type: 'boolean', initial: false, persistent: true, resetWithSettings: false, parameterSetId: 'pg_a' },
    { id: 'pg_empty', name: '空文字参数', type: 'string', initial: '', persistent: false, resetWithSettings: true, parameterSetId: 'pg_a' },
    { id: 'pg_legacy_move', name: '旧本机记录', type: 'boolean', initial: false, persistent: true, parameterSetId: 'pg_legacy' },
    { id: 'pg_legacy_default', name: '旧存档参数', type: 'number', initial: 0, persistent: false, parameterSetId: 'pg_legacy' },
  ];
  project.ui.pages = { main: { layout: 'custom' } };
  project.ui.components = [
    { id: 'pg_title', name: '空标题', kind: 'text', page: 'main', text: '', style: { opacity: 0 }, x: .1, y: .1, width: .6, height: .1 },
    { id: 'pg_button', name: '隐藏按钮', kind: 'button', page: 'main', text: '隐藏按钮',
      visibleWhen: { kind: 'compare', variableId: 'pg_false', operator: 'eq', value: true }, x: .1, y: .3, width: .3, height: .1 },
  ];
  project.ui.customPages = [{ id: 'pg_custom', name: '自定义参数页面', modal: true, components: [
    { id: 'pg_reference_text', name: '文字引用', kind: 'text', page: 'custom', text: '作者默认文字', x: .1, y: .1, width: .6, height: .1,
      propertyControls: { text: { mode: 'follow', parameterId: 'pg_empty' } } },
    { id: 'pg_reference_button', name: '开关引用', kind: 'button', page: 'custom', text: '引用按钮', x: .1, y: .25, width: .3, height: .1,
      propertyControls: { visible: { mode: 'follow', parameterId: 'pg_false' } } },
  ] }];
  const graph = createBlueprintGraph('function', '通用参数验收蓝图'); graph.id = 'pg_graph';
  const reader = blueprintNodeDefaults('getVariable'); reader.id = 'pg_reference_reader';
  reader.properties = { variableId: 'pg_legacy_move', scope: 'player' }; reader.x = 360; reader.y = 160;
  graph.nodes.push(reader); project.blueprints = [graph];
  return projectSchema.parse(project);
}

const authored = fixture();
let app: ElectronApplication | undefined, page: Page | undefined, preview: Page | undefined;
let phase = '准备', failure: unknown, authorHash: string | undefined, traceRunning = false, launchNumber = 0;
let baseline: Project, finalSaved: Project, newSetId = '', addedNumberId = '', addedBooleanId = '', addedStringId = '';
let defaultsMemberId = '', blueprintPlayerId = '', blueprintProjectId = '', opacityId = '', linkedTextId = '', linkedFalseId = '';
const checks: { name: string; durationMs: number }[] = [], errors: string[] = [], traces: string[] = [];
const processes: { pid?: number; exited: boolean }[] = [];
const screenshots: string[] = [];
const evidence: Record<string, unknown> = { operations: [], layouts: [], creation: [], controls: [] };
const report: Record<string, unknown> = { status: 'running', renderer: 'compiled source editor', checks, errors, traces, screenshots, processes, evidence,
  authorFile, temporaryPaths: [path.dirname(projectFile), profile],
  limits: ['只验收编辑、保存和独立界面预演；游戏存档与本机运行行为由运行时专项验收。', '作者工程只计算前后摘要，未复制或加载。', '只清理本次fixture和profile，保留报告、截图及trace。'] };
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const button = (name: string) => page!.getByRole('button', { name, exact: true });
const workspace = () => page!.locator('.parameter-sets-workspace');
const detail = () => page!.getByRole('complementary', { name: '参数设置', exact: true });
const setConfig = () => page!.getByRole('region', { name: '参数集配置', exact: true });
const row = (id: string) => workspace().locator(`[data-parameter-id="${id}"]`);
const card = (id: string) => workspace().locator(`[data-parameter-set-id="${id}"]`);
const createDialog = () => page!.getByRole('dialog', { name: '新建参数集', exact: true });
const propertyDialog = () => page!.getByRole('dialog', { name: '属性控制设置', exact: true });
const variable = (project: Project, id: string): Variable => {
  const found = project.variables.find(item => item.id === id); assert.ok(found, 'Expected parameter ' + id); return found;
};
const set = (project: Project, id: string) => {
  const found = project.parameterSets?.find(item => item.id === id); assert.ok(found, 'Expected group ' + id); return found;
};
const components = (project: Project): UiComponent[] => [...project.ui.components, ...project.ui.customPages.flatMap(item => item.components)];
const component = (project: Project, id: string) => {
  const found = components(project).find(item => item.id === id); assert.ok(found, 'Expected control ' + id); return found;
};
const policies = (project: Project, ids = project.variables.map(item => item.id)) => ids.map(id => {
  const item = variable(project, id); return { id: item.id, name: item.name, type: item.type, initial: item.initial, persistent: item.persistent, resetWithSettings: item.resetWithSettings };
});
const references = (project: Project) => ({
  controls: components(project).filter(item => ['pg_reference_text', 'pg_reference_button'].includes(item.id)).map(item => ({ id: item.id, propertyControls: item.propertyControls })),
  reader: project.blueprints.find(item => item.id === 'pg_graph')!.nodes.find(item => item.id === 'pg_reference_reader')!.properties,
});
const settle = () => page!.evaluate(async () => {
  await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
});
const writeReport = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
async function fingerprints() {
  const html = await fs.readFile(path.join(root, 'dist/index.html'), 'utf8');
  const files = ['dist/index.html', 'dist-desktop/main.cjs', 'dist-desktop/preload.cjs',
    ...[...html.matchAll(/(?:src|href)="(\.\/assets\/[^"?#]+\.(?:js|css))"/g)].map(match => 'dist/' + match[1].slice(2))];
  assert.ok(files.some(file => file.startsWith('dist/assets/') && file.endsWith('.js')), 'Build the completed implementation before acceptance.');
  return Promise.all([...new Set(files)].map(async file => ({ file, sha256: digest(await fs.readFile(path.join(root, file))) })));
}
async function size(width: number, height: number) {
  await app!.evaluate(({ BrowserWindow }, dimensions) => {
    const window = BrowserWindow.getAllWindows().find(item => !item.webContents.getURL().endsWith('#ui-preview'))!;
    if (window.isMinimized()) window.restore(); if (window.isMaximized()) window.unmaximize();
    window.setContentSize(dimensions.width, dimensions.height); window.webContents.setBackgroundThrottling(false);
  }, { width, height });
  await expect.poll(() => page!.evaluate(requested => Math.max(Math.abs(innerWidth - requested.width), Math.abs(innerHeight - requested.height)), { width, height })).toBeLessThanOrEqual(1);
  await settle();
}
async function launch() {
  app = await launchDesktopFixture({ root, projectFile, profile, devUrl: '' }); processes.push({ pid: app.process().pid, exited: false }); launchNumber++;
  page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(authored.name, { timeout: 45000 });
  assert.equal(path.resolve(fileURLToPath(page.url())), path.join(root, 'dist/index.html')); report.rendererUrl = page.url();
  await page.evaluate('globalThis.__name = value => value'); await size(1600, 1000);
  await page.context().tracing.start({ screenshots: true, snapshots: true, sources: false }); traceRunning = true;
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
    if (exited()) { app = undefined; page = undefined; preview = undefined; }
  }
  if (traceFailure) throw traceFailure;
}
async function screenshot(name: string, surface = page!) {
  const url = surface.url();
  const png = await app!.evaluate(async ({ BrowserWindow }, url) => {
    const window = BrowserWindow.getAllWindows().find(item => item.webContents.getURL() === url)!;
    return (await window.webContents.capturePage()).toPNG().toString('base64');
  }, url);
  await fs.writeFile(path.join(output, name + '.png'), Buffer.from(png, 'base64')); screenshots.push(name + '.png');
}
async function check(name: string, run: () => Promise<void>) {
  phase = name; const start = Date.now(); await run(); checks.push({ name, durationMs: Date.now() - start }); await writeReport(); console.log('通过：' + name);
}
async function save() {
  const uiSave = button('保存界面');
  if (await uiSave.isVisible() && await uiSave.isEnabled()) await uiSave.click();
  await button('保存工程').click(); await expect(page!.locator('.dirty-dot')).toHaveCount(0); await settle(); return read();
}
async function openSets() {
  await page!.locator('[data-workspace-tab="variables"]').click();
  await expect(workspace()).toBeVisible();
}
async function listSets() {
  await openSets(); const back = workspace().getByRole('button', { name: '参数集', exact: true });
  if (await back.count()) await back.click(); await expect(workspace().locator('.parameter-set-cards')).toBeVisible();
}
async function openSet(id: string) { await listSets(); await card(id).click(); await expect(setConfig()).toBeVisible(); }
async function selectParameter(id: string, setId: string) { await openSet(setId); await row(id).click(); await expect(detail()).toBeVisible(); }
async function editText(owner: Locator, label: string, value: string) {
  const field = owner.getByLabel(label, { exact: true }); await field.fill(value); await field.press('Tab'); await settle();
}
async function reset(owner: Locator, label: string, checked: boolean) {
  const checkbox = owner.getByLabel(label, { exact: true }); await openDisclosureAncestors(checkbox); await checkbox.setChecked(checked);
}
async function groupDefaults(storage: 'save' | 'local', participating: boolean) {
  const storageField = setConfig().getByLabel('新参数默认保存方式', { exact: true });
  await openDisclosureAncestors(storageField); await storageField.selectOption(storage);
  await reset(setConfig(), '新参数默认参与恢复初始设置', participating);
}
async function moveParameter(id: string, source: string, destination: string) {
  await selectParameter(id, source); const picker = detail().getByLabel('所属参数集', { exact: true });
  await openDisclosureAncestors(picker); await picker.selectOption(destination); await expect(row(id)).toBeVisible();
}
async function add(kind: 'number' | 'boolean' | 'string', name: string) {
  await workspace().locator('.parameter-add-kinds').getByRole('button', { name: { number: '数值', boolean: '开关', string: '文字' }[kind], exact: true }).click();
  const selected = workspace().locator('.parameter-table button.selected'); const id = await selected.getAttribute('data-parameter-id'); assert.ok(id);
  await editText(detail(), '参数名称', name); return id;
}
async function openUi(pageId: string) {
  await page!.locator('[data-workspace-tab="ui"]').click();
  await page!.getByLabel('界面编辑模式', { exact: true }).getByRole('button', { name: '设计', exact: true }).click();
  await page!.getByLabel('设计页面', { exact: true }).selectOption(pageId); await settle();
}
async function selectUi(id: string) {
  await page!.locator(`[data-hierarchy-id="${id}"]`).locator('.ui-hierarchy-caption').click();
  await expect(page!.locator(`[data-hierarchy-id="${id}"]`)).toHaveAttribute('aria-selected', 'true');
}
async function openProperty(property: 'opacity' | 'visible') {
  const group = page!.locator('.ui-inspector-view:not([hidden]) [data-ui-inspector-group="visibility"]');
  await openDisclosureAncestors(group); if (await group.getAttribute('open') === null) await group.locator(':scope > summary').click();
  if (property === 'visible') {
    const condition = group.locator('[data-ui-inspector-group="interaction-condition-visibleWhen"]');
    await openDisclosureAncestors(condition); if (await condition.getAttribute('open') === null) await condition.locator(':scope > summary').click();
  }
  const field = page!.locator(`.ui-inspector-view:not([hidden]) .field[data-ui-property="${property}"]`);
  await openDisclosureAncestors(field); await field.scrollIntoViewIfNeeded();
  await field.locator('.field-label').click({ button: 'right' });
  await page!.getByRole('menu', { name: '属性控制菜单', exact: true }).getByRole('menuitem', { name: '关联参数…', exact: true }).click();
  await expect(propertyDialog()).toBeVisible(); await propertyDialog().getByRole('button', { name: '新建参数并关联', exact: true }).click();
}
async function openBindings(property: string) {
  await page!.getByLabel('界面编辑模式', { exact: true }).getByRole('button', { name: '事件图', exact: true }).click();
  await page!.getByLabel('事件图页面', { exact: true }).selectOption('ui:main');
  const toggle = button('参数绑定'); if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await page!.getByLabel('联动组件', { exact: true }).selectOption(property === 'visible' ? 'pg_button' : 'pg_title');
  await page!.getByLabel('联动属性', { exact: true }).selectOption(property);
  await page!.getByLabel('属性控制方式', { exact: true }).selectOption('follow');
  await button('新建参数并联动').click(); return page!.getByRole('form', { name: '新建联动参数', exact: true });
}
async function assertFits(target: Locator, description: string) {
  const result = await target.evaluate(element => {
    const outer = element.getBoundingClientRect();
    const controls = [...element.querySelectorAll<HTMLElement>('button,input,select,textarea,summary')].filter(control => {
      const rect = control.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && !control.closest('[hidden],[inert]');
    }).map(control => { const rect = control.getBoundingClientRect(); return {
      label: control.getAttribute('aria-label') ?? control.textContent?.trim(), left: rect.left, right: rect.right, width: rect.width, height: rect.height,
    }; });
    return { description: '', viewport: { width: innerWidth, height: innerHeight }, left: outer.left, right: outer.right,
      clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, documentWidth: document.documentElement.scrollWidth, controls };
  });
  result.description = description;
  assert.ok(result.documentWidth <= result.viewport.width + 1 && result.scrollWidth <= result.clientWidth + 1, description + ': no horizontal overflow.');
  assert.ok(result.left >= -1 && result.right <= result.viewport.width + 1, description + ': surface stays in the viewport.');
  assert.deepEqual(result.controls.filter(item => item.left < result.left - 1 || item.right > result.right + 1), [], description + ': visible controls fit the surface.');
  (evidence.layouts as unknown[]).push(result);
}

try {
  await fs.mkdir(output, { recursive: true }); authorHash = digest(await fs.readFile(authorFile)); report.authorSha256Before = authorHash;
  report.buildBefore = await fingerprints(); baseline = (await saveProject(projectFile, authored)).project;
  await launch();

  await check('参数集只有一种新建入口，分组无用途选择，内置设置保持独立参数行', async () => {
    await listSets(); await expect(workspace().getByRole('button', { name: '新建参数集', exact: true })).toHaveCount(1);
    await expect(page!.getByRole('button', { name: '新建设置分组', exact: true })).toHaveCount(0);
    const cards = workspace().locator('.parameter-set-cards'); await cards.click({ button: 'right', position: { x: 4, y: 4 } });
    const menu = page!.getByRole('menu', { name: '参数操作', exact: true });
    await expect(menu.getByRole('menuitem', { name: '新建参数集', exact: true })).toHaveCount(1);
    await expect(menu.getByRole('menuitem', { name: '新建设置分组', exact: true })).toHaveCount(0); await page!.keyboard.press('Escape');
    await openSet('parameters_game'); await expect(workspace().locator('[data-builtin-preference]')).toHaveCount(playerPreferenceKeys.length);
    await expect(page!.getByLabel('参数集用途', { exact: true })).toHaveCount(0); assert.deepEqual(await read(), baseline);
    await screenshot('01-unified-entry');
  });

  await check('新建参数集名称校验，按钮取消与Escape均不写工程或新增历史', async () => {
    await listSets(); const bytes = await fs.readFile(projectFile, 'utf8'), ids = baseline.parameterSets!.map(item => item.id);
    for (const via of ['button', 'escape'] as const) {
      await workspace().getByRole('button', { name: '新建参数集', exact: true }).click();
      await createDialog().getByLabel('参数集名称', { exact: true }).fill(via === 'button' ? '剧情与界面甲' : '取消后不创建');
      if (via === 'button') { await createDialog().getByRole('button', { name: '创建参数集', exact: true }).click(); await expect(createDialog().getByRole('alert')).toContainText('同名'); }
      await createDialog().getByLabel('新参数默认保存方式', { exact: true }).selectOption('local');
      await reset(createDialog(), '新参数默认参与恢复初始设置', true);
      if (via === 'button') await createDialog().getByRole('button', { name: '取消', exact: true }).click(); else await page!.keyboard.press('Escape');
      await expect(createDialog()).toHaveCount(0); await expect(page!.locator('.dirty-dot')).toHaveCount(0);
      assert.equal(await fs.readFile(projectFile, 'utf8'), bytes); assert.deepEqual((await read()).parameterSets!.map(item => item.id), ids);
      await expect(workspace().getByRole('button', { name: '新建参数集', exact: true })).toBeFocused();
    }
  });

  await check('新参数集明确名称和本机不恢复默认，创建可单次撤销重做', async () => {
    await workspace().getByRole('button', { name: '新建参数集', exact: true }).click();
    await createDialog().getByLabel('参数集名称', { exact: true }).fill('混合用途参数集');
    await createDialog().getByLabel('新参数默认保存方式', { exact: true }).selectOption('local');
    await reset(createDialog(), '新参数默认参与恢复初始设置', false);
    await createDialog().getByRole('button', { name: '创建参数集', exact: true }).click();
    const created = await save(); newSetId = created.parameterSets!.find(item => item.name === '混合用途参数集')!.id;
    assert.deepEqual(set(created, newSetId).defaults, { persistent: true, resetWithSettings: false }); assert.equal(set(created, newSetId).kind, 'story');
    await button('撤销').click(); const undone = await save(); assert.equal(undone.parameterSets?.some(item => item.id === newSetId), false);
    await button('重做').click(); const redone = await save(); assert.deepEqual(set(redone, newSetId), set(created, newSetId));
    assert.deepEqual(redone.variables, baseline.variables); await openSet(newSetId);
  });

  await check('数值0、开关false和空文字创建保留原值，统一采用组的新建默认', async () => {
    addedNumberId = await add('number', '新零值'); addedBooleanId = await add('boolean', '新关闭'); addedStringId = await add('string', '新空文字');
    const saved = await save();
    for (const [id, type, value] of [[addedNumberId, 'number', 0], [addedBooleanId, 'boolean', false], [addedStringId, 'string', '']] as const) {
      const item = variable(saved, id); assert.equal(item.type, type); assert.equal(item.initial, value);
      assert.equal(item.parameterSetId, newSetId); assert.equal(item.persistent, true); assert.equal(item.resetWithSettings, false);
    }
    assert.equal(components(saved).filter(item => [addedNumberId, addedBooleanId, addedStringId].includes(item.parameterId ?? '')).length, 0);
    (evidence.creation as unknown[]).push({ surface: 'parameter-library', values: policies(saved, [addedNumberId, addedBooleanId, addedStringId]) });
    await screenshot('02-zero-false-empty');
  });

  await check('每参数保存方式与恢复独立，四种组合可编辑且一次撤销只还原本次更改', async () => {
    await selectParameter('pg_zero', 'pg_a');
    await detail().getByLabel('保存方式', { exact: true }).selectOption('local');
    let saved = await save(); assert.equal(variable(saved, 'pg_zero').persistent, true); assert.equal(variable(saved, 'pg_zero').resetWithSettings, false);
    await reset(detail(), '参与恢复初始设置', true); saved = await save();
    assert.equal(variable(saved, 'pg_zero').persistent, true); assert.equal(variable(saved, 'pg_zero').resetWithSettings, true);
    await button('撤销').click(); saved = await save(); assert.equal(variable(saved, 'pg_zero').persistent, true); assert.equal(variable(saved, 'pg_zero').resetWithSettings, false);
    await button('重做').click(); await detail().getByLabel('保存方式', { exact: true }).selectOption('save'); saved = await save();
    assert.equal(variable(saved, 'pg_zero').persistent, false); assert.equal(variable(saved, 'pg_zero').resetWithSettings, true);
    await reset(detail(), '参与恢复初始设置', false); saved = await save();
    assert.equal(variable(saved, 'pg_zero').persistent, false); assert.equal(variable(saved, 'pg_zero').resetWithSettings, false);
    assert.equal(variable(saved, 'pg_zero').initial, 0); assert.deepEqual(references(saved), references(baseline));
    (evidence.operations as unknown[]).push({ operation: 'independent-policies', final: policies(saved, ['pg_zero']) });
  });

  await check('修改分组新建默认保留全部现有成员，后续新成员才采用新默认', async () => {
    await openSet(newSetId); const before = await read(); await groupDefaults('save', true); const changed = await save();
    assert.deepEqual(policies(changed), policies(before)); assert.deepEqual(set(changed, newSetId).defaults, { persistent: false, resetWithSettings: true });
    defaultsMemberId = await add('number', '默认更改后的新参数'); const saved = await save();
    assert.equal(variable(saved, defaultsMemberId).persistent, false); assert.equal(variable(saved, defaultsMemberId).resetWithSettings, true);
    assert.equal(variable(saved, defaultsMemberId).initial, 0); assert.deepEqual(policies(saved, before.variables.map(item => item.id)), policies(before));
  });

  await check('旧设置成员移入普通分组固化原恢复行为，保留false、本机保存、ID及蓝图引用', async () => {
    await selectParameter('pg_legacy_move', 'pg_legacy');
    await openDisclosureAncestors(detail().getByLabel('参与恢复初始设置', { exact: true }));
    await expect(detail().getByLabel('参与恢复初始设置', { exact: true })).toBeChecked();
    assert.equal(variable(await read(), 'pg_legacy_move').resetWithSettings, undefined, 'Opening an old member must not materialize its reset policy.');
    await moveParameter('pg_legacy_move', 'pg_legacy', 'pg_a'); const saved = await save();
    const moved = variable(saved, 'pg_legacy_move'); assert.equal(moved.parameterSetId, 'pg_a');
    assert.equal(moved.id, 'pg_legacy_move'); assert.equal(moved.initial, false); assert.equal(moved.persistent, true); assert.equal(moved.resetWithSettings, true);
    assert.deepEqual(references(saved), references(baseline));
    // The old member was only viewed before the move; its checked checkbox did
    // not write an explicit reset value into the project.
    (evidence.operations as unknown[]).push({ operation: 'legacy-move', before: variable(baseline, 'pg_legacy_move'), after: moved });
  });

  await check('旧分组默认改为不恢复，原随存档成员仍参与恢复且移出后保持', async () => {
    await openSet('pg_legacy'); await groupDefaults('local', false); let saved = await save();
    const old = variable(saved, 'pg_legacy_default'); assert.equal(old.persistent, false); assert.equal(old.initial, 0); assert.equal(old.resetWithSettings, true);
    assert.deepEqual(set(saved, 'pg_legacy').defaults, { persistent: true, resetWithSettings: false });
    await moveParameter('pg_legacy_default', 'pg_legacy', 'pg_b'); saved = await save();
    assert.equal(variable(saved, 'pg_legacy_default').persistent, false); assert.equal(variable(saved, 'pg_legacy_default').resetWithSettings, true);
    assert.deepEqual(references(saved), references(baseline));
  });

  await check('移动与重命名只整理分组，原成员值、保存、恢复及引用ID不变', async () => {
    const before = await read(); await moveParameter('pg_empty', 'pg_a', 'pg_b');
    await editText(setConfig(), '参数集名称', '重命名后的任意分组'); await editText(detail(), '参数名称', '空文字已改名');
    const saved = await save(); assert.equal(set(saved, 'pg_b').id, 'pg_b'); assert.equal(variable(saved, 'pg_empty').id, 'pg_empty');
    assert.deepEqual({ ...variable(saved, 'pg_empty'), name: variable(before, 'pg_empty').name, parameterSetId: variable(before, 'pg_empty').parameterSetId }, variable(before, 'pg_empty'));
    assert.deepEqual(policies(saved, before.variables.filter(item => item.id !== 'pg_empty').map(item => item.id)), policies(before, before.variables.filter(item => item.id !== 'pg_empty').map(item => item.id)));
    assert.deepEqual(references(saved), references(before)); await screenshot('03-group-organization');
  });

  await check('移除分组保留成员并移至故事状态，撤销重做均保留值与引用', async () => {
    await openSet('pg_b'); const before = await read(), members = before.variables.filter(item => item.parameterSetId === 'pg_b').map(item => item.id);
    await workspace().getByRole('button', { name: '移除分组并将参数移至故事状态', exact: true }).click();
    let saved = await save(); assert.equal(saved.parameterSets?.some(item => item.id === 'pg_b'), false);
    assert.deepEqual(policies(saved), policies(before)); for (const id of members) assert.equal(variable(saved, id).parameterSetId, 'parameters_story');
    assert.deepEqual(references(saved), references(before));
    await button('撤销').click(); saved = await save(); assert.deepEqual(set(saved, 'pg_b'), set(before, 'pg_b'));
    for (const id of members) assert.deepEqual(variable(saved, id), variable(before, id));
    await button('重做').click(); saved = await save(); assert.equal(saved.parameterSets?.some(item => item.id === 'pg_b'), false);
    assert.deepEqual(policies(saved), policies(before)); assert.deepEqual(references(saved), references(before));
  });

  await check('自定义参数不自动进入默认游戏设置，设计及独立预演均无更多设置入口', async () => {
    const before = await read(), bytes = await fs.readFile(projectFile, 'utf8'); await openUi('preferences');
    await expect(page!.locator('.ui-parameter-more')).toHaveCount(0);
    await expect(page!.locator('.ui-canvas').getByText('更多设置', { exact: true })).toHaveCount(0);
    for (const item of before.variables) await expect(page!.locator('.ui-canvas').getByText(item.name, { exact: true })).toHaveCount(0);
    preview = await openUiPreviewForTest(app!, page!, errors); await expect(preview.getByLabel('当前预演页面', { exact: true })).toHaveText('设置');
    const frame = preview.locator('.ui-logic-preview-frame');
    await expect(frame.getByLabel('标准设置滚动区域', { exact: true })).toBeVisible();
    await expect(frame.getByRole('button', { name: '更多设置', exact: true })).toHaveCount(0);
    for (const item of before.variables) await expect(frame.getByLabel(item.name, { exact: true })).toHaveCount(0);
    await screenshot('04-settings-no-automatic-parameters', preview); await preview.close(); preview = undefined;
    assert.equal(await fs.readFile(projectFile, 'utf8'), bytes); assert.deepEqual(await read(), before);
  });

  await check('显式添加参数控件可选标题、设置或自定义页面，同页再次定位不重复添加', async () => {
    const before = await read(), createdIds: string[] = [];
    for (const target of ['ui:main', 'ui:preferences', 'pg_custom']) {
      await selectParameter(addedBooleanId, newSetId); const picker = detail().getByLabel('目标界面', { exact: true }); await openDisclosureAncestors(picker);
      await picker.selectOption(target); await detail().locator('[data-parameter-control-action="create"]').click();
      await expect(page!.getByLabel('设计页面', { exact: true })).toHaveValue(target.startsWith('ui:') ? target.slice(3) : target);
      const saved = await save(), added = components(saved).filter(item => item.parameterId === addedBooleanId);
      assert.equal(added.length, createdIds.length + 1); const addedControl = added.find(item => !createdIds.includes(item.id))!; createdIds.push(addedControl.id);
      if (target === 'pg_custom') assert.ok(saved.ui.customPages.find(item => item.id === target)!.components.some(item => item.id === addedControl.id));
      else assert.equal(addedControl.page, target.slice(3));
      assert.deepEqual(policies(saved), policies(before));
      await selectParameter(addedBooleanId, newSetId); await openDisclosureAncestors(detail().getByLabel('目标界面', { exact: true }));
      await detail().getByLabel('目标界面', { exact: true }).selectOption(target);
      await expect(detail().locator('[data-parameter-control-action="create"]')).toHaveCount(0);
      await detail().locator('[data-parameter-control-action="locate"]').click();
      await expect(page!.locator(`[data-hierarchy-id="${addedControl.id}"]`)).toHaveAttribute('aria-selected', 'true');
      assert.equal(components(await read()).filter(item => item.parameterId === addedBooleanId).length, createdIds.length);
    }
    (evidence.controls as unknown[]).push({ parameterId: addedBooleanId, ids: createdIds, pages: ['ui:main', 'ui:preferences', 'pg_custom'] });
    await screenshot('05-explicit-custom-page-control');
  });

  await check('蓝图新建按作用域决定保存、换组不改恢复，取消不写且0和false保留', async () => {
    await page!.locator('[data-workspace-tab="blueprint"]').click(); await page!.getByLabel('蓝图资源', { exact: true }).selectOption('graph:pg_graph');
    const properties = page!.getByRole('complementary', { name: '蓝图属性', exact: true });
    await properties.locator('.blueprint-property-tabs').getByRole('button', { name: '变量', exact: true }).click();
    const owner = properties.getByRole('region', { name: '蓝图变量', exact: true });
    for (const scope of ['player', 'project'] as const) {
      await owner.getByLabel('状态列表作用域', { exact: true }).selectOption(scope); await owner.getByRole('button', { name: '新建变量', exact: true }).click();
      let form = owner.getByRole('form', { name: '创建状态变量', exact: true });
      await form.getByLabel('变量名称', { exact: true }).fill('取消的蓝图变量'); await form.getByLabel('变量所属参数集', { exact: true }).selectOption(newSetId);
      await reset(form, '新变量参与恢复初始设置', true); await form.getByRole('button', { name: '取消', exact: true }).click();
      assert.equal((await read()).variables.some(item => item.name === '取消的蓝图变量'), false);
      await expect(owner.getByRole('button', { name: '编辑变量 取消的蓝图变量', exact: true })).toHaveCount(0);
      await owner.getByRole('button', { name: '新建变量', exact: true }).click(); form = owner.getByRole('form', { name: '创建状态变量', exact: true });
      const name = scope === 'player' ? '蓝图本机不恢复' : '蓝图存档参与恢复'; await form.getByLabel('变量名称', { exact: true }).fill(name);
      await expect(form.getByLabel('新变量保存方式', { exact: true })).toHaveText(scope === 'player' ? '保存在本机' : '随存档保存');
      await form.getByLabel('变量所属参数集', { exact: true }).selectOption(newSetId);
      const participation = scope === 'project'; await reset(form, '新变量参与恢复初始设置', participation);
      await form.getByLabel('变量所属参数集', { exact: true }).selectOption('pg_a');
      if (participation) await expect(form.getByLabel('新变量参与恢复初始设置', { exact: true })).toBeChecked();
      else await expect(form.getByLabel('新变量参与恢复初始设置', { exact: true })).not.toBeChecked();
      if (scope === 'project') {
        await form.getByRole('combobox', { name: '变量类型', exact: true }).click();
        await page!.getByRole('listbox', { name: '变量类型选项', exact: true }).getByRole('option', { name: '数值', exact: true }).click();
        await form.getByLabel('变量初始值', { exact: true }).fill('0');
      } else await form.getByLabel('变量初始值', { exact: true }).selectOption('false');
      await form.getByRole('button', { name: '创建变量', exact: true }).click();
      const saved = await save(), item = saved.variables.find(item => item.name === name)!; assert.ok(item);
      assert.equal(item.persistent, scope === 'player'); assert.equal(item.resetWithSettings, participation); assert.equal(item.parameterSetId, 'pg_a');
      assert.equal(item.initial, scope === 'player' ? false : 0);
      if (scope === 'player') blueprintPlayerId = item.id; else blueprintProjectId = item.id;
      await expect(owner.locator(`[data-state-details-id="${item.id}"]`)).toContainText(scope === 'player' ? '保存在本机' : '随存档保存');
    }
    (evidence.creation as unknown[]).push({ surface: 'blueprint', values: policies(await read(), [blueprintPlayerId, blueprintProjectId]) });
  });

  await check('属性右键新建0值，换组不改草稿配置，采用默认为显式动作，取消与撤销保持原设置', async () => {
    await openUi('main'); await selectUi('pg_title'); const before = await read();
    await openProperty('opacity'); await propertyDialog().getByLabel('新参数名称', { exact: true }).fill('取消的透明度');
    await propertyDialog().getByLabel('新参数所属参数集', { exact: true }).selectOption(newSetId);
    await expect(propertyDialog().getByLabel('新参数保存方式', { exact: true })).toHaveValue('save');
    await reset(propertyDialog(), '新参数参与恢复初始设置', false);
    await propertyDialog().getByRole('button', { name: '采用分组新建默认', exact: true }).click();
    await expect(propertyDialog().getByLabel('新参数保存方式', { exact: true })).toHaveValue('save');
    await expect(propertyDialog().getByLabel('新参数参与恢复初始设置', { exact: true })).toBeChecked();
    await propertyDialog().getByLabel('新参数所属参数集', { exact: true }).selectOption('pg_a');
    await expect(propertyDialog().getByLabel('新参数保存方式', { exact: true })).toHaveValue('save');
    await expect(propertyDialog().getByLabel('新参数参与恢复初始设置', { exact: true })).toBeChecked();
    await propertyDialog().getByRole('button', { name: '取消', exact: true }).click(); assert.deepEqual(await read(), before);
    await openProperty('opacity'); await propertyDialog().getByLabel('新参数名称', { exact: true }).fill('属性创建零透明度');
    await propertyDialog().getByLabel('新参数初始值', { exact: true }).fill('0');
    await propertyDialog().getByLabel('新参数保存方式', { exact: true }).selectOption('local');
    await reset(propertyDialog(), '新参数参与恢复初始设置', false);
    await propertyDialog().getByLabel('新参数所属参数集', { exact: true }).selectOption(newSetId);
    await expect(propertyDialog().getByLabel('新参数保存方式', { exact: true })).toHaveValue('local');
    await expect(propertyDialog().getByLabel('新参数参与恢复初始设置', { exact: true })).not.toBeChecked();
    await propertyDialog().getByRole('button', { name: '应用设置', exact: true }).click();
    const source = page!.locator('.ui-inspector-view:not([hidden]) .field[data-ui-property="opacity"] .ui-property-control-value');
    await expect(source).toHaveText('跟随：属性创建零透明度');
    // Saving accepts the UI draft and resets its local history. Exercise the
    // author's one-step undo/redo while the atomic creation is still a draft.
    await button('撤销').click(); await expect(source).toHaveCount(0);
    await expect(page!.getByLabel('控件不透明度 %', { exact: true })).toHaveValue('0');
    assert.deepEqual(await read(), before);
    await button('重做').click(); await expect(source).toHaveText('跟随：属性创建零透明度');
    const saved = await save(); opacityId = saved.variables.find(item => item.name === '属性创建零透明度')!.id;
    assert.equal(variable(saved, opacityId).initial, 0); assert.equal(variable(saved, opacityId).persistent, true); assert.equal(variable(saved, opacityId).resetWithSettings, false);
    assert.deepEqual(component(saved, 'pg_title').propertyControls?.opacity, { mode: 'follow', parameterId: opacityId });
    assert.equal(component(saved, 'pg_title').style?.opacity, 0);
    assert.deepEqual({ ...component(saved, 'pg_title'), propertyControls: component(before, 'pg_title').propertyControls },
      { ...component(before, 'pg_title'), propertyControls: component(before, 'pg_title').propertyControls });
  });

  await check('嵌入联动新建空文字与false保持独立配置，Escape取消不创建隐藏蓝图', async () => {
    const before = await read(); let form = await openBindings('text');
    await form.getByLabel('新参数名称', { exact: true }).fill('取消的联动'); await form.getByLabel('新参数所属参数集', { exact: true }).selectOption(newSetId);
    await form.getByLabel('新参数保存方式', { exact: true }).selectOption('local'); await reset(form, '新参数参与恢复初始设置', true);
    await form.getByLabel('新参数名称', { exact: true }).press('Escape'); await expect(form).toHaveCount(0); assert.deepEqual(await read(), before);
    for (const property of ['text', 'visible'] as const) {
      form = await openBindings(property); const name = property === 'text' ? '联动空文字' : '联动关闭';
      await form.getByLabel('新参数名称', { exact: true }).fill(name);
      if (property === 'text') await form.getByLabel('新参数初始值', { exact: true }).fill('');
      else await form.getByLabel('新参数初始值', { exact: true }).uncheck();
      await form.getByLabel('新参数保存方式', { exact: true }).selectOption(property === 'text' ? 'local' : 'save');
      await reset(form, '新参数参与恢复初始设置', property === 'visible');
      await form.getByLabel('新参数所属参数集', { exact: true }).selectOption(newSetId);
      await expect(form.getByLabel('新参数保存方式', { exact: true })).toHaveValue(property === 'text' ? 'local' : 'save');
      if (property === 'visible') await expect(form.getByLabel('新参数参与恢复初始设置', { exact: true })).toBeChecked();
      else await expect(form.getByLabel('新参数参与恢复初始设置', { exact: true })).not.toBeChecked();
      await form.getByRole('button', { name: '创建参数并联动', exact: true }).click(); const saved = await save();
      const item = saved.variables.find(item => item.name === name)!; assert.ok(item);
      assert.equal(item.initial, property === 'text' ? '' : false); assert.equal(item.persistent, property === 'text'); assert.equal(item.resetWithSettings, property === 'visible');
      assert.equal(item.parameterSetId, newSetId); assert.deepEqual(component(saved, property === 'text' ? 'pg_title' : 'pg_button').propertyControls?.[property], { mode: 'follow', parameterId: item.id });
      if (property === 'text') assert.equal(component(saved, 'pg_title').text, '');
      else assert.deepEqual(component(saved, 'pg_button').visibleWhen, component(before, 'pg_button').visibleWhen);
      assert.deepEqual(saved.blueprints, before.blueprints, 'Property links do not manufacture a hidden graph.');
      if (property === 'text') linkedTextId = item.id; else linkedFalseId = item.id;
    }
    const saved = await read(), bytes = await fs.readFile(projectFile, 'utf8');
    await page!.getByLabel('界面编辑模式', { exact: true }).getByRole('button', { name: '设计', exact: true }).click();
    await page!.getByLabel('设计页面', { exact: true }).selectOption('main');
    preview = await openUiPreviewForTest(app!, page!, errors);
    await expect(preview.getByLabel('当前预演页面', { exact: true })).toHaveText('标题');
    await expect(preview.getByLabel('预演参数 属性创建零透明度', { exact: true })).toHaveValue('0');
    await expect(preview.getByLabel('预演参数 联动空文字', { exact: true })).toHaveValue('');
    await expect(preview.getByLabel('预演参数 联动关闭', { exact: true })).toHaveValue('false');
    await expect(preview.locator('[data-preview-component="pg_title"]')).toHaveCSS('opacity', '0');
    await expect(preview.locator('[data-preview-component="pg_button"]')).toHaveCount(0);
    await screenshot('08-zero-false-empty-independent-preview', preview); await preview.close(); preview = undefined;
    assert.equal(await fs.readFile(projectFile, 'utf8'), bytes); assert.deepEqual(await read(), saved);
    (evidence.creation as unknown[]).push({ surface: 'ui-source-and-binding', values: policies(await read(), [opacityId, linkedTextId, linkedFalseId]) });
  });

  await check('保存重开保留全部ID及配置，明暗主题1024窄窗中的详情和新建框不横向溢出', async () => {
    finalSaved = await save(); const bytes = await fs.readFile(projectFile, 'utf8'); report.fixtureSha256BeforeReopen = digest(bytes);
    await close(); await launch(); assert.equal(await fs.readFile(projectFile, 'utf8'), bytes); assert.deepEqual(await read(), finalSaved);
    for (const [name, theme] of [['黑白', 'codexDark'], ['亮白', 'codexLight']] as const) {
      await button('作品设置').click(); const settings = page!.getByRole('dialog', { name: '作品设置', exact: true });
      await settings.getByRole('button', { name: '编辑器外观', exact: true }).click();
      await settings.getByRole('group', { name: '编辑器配色', exact: true }).getByRole('button', { name: new RegExp('^' + name) }).click();
      await expect(page!.locator('html')).toHaveAttribute('data-editor-theme', theme); await settings.getByRole('button', { name: '完成', exact: true }).click();
      await size(1024, 768); await selectParameter(addedBooleanId, newSetId);
      await reset(detail(), '参与恢复初始设置', false); await openDisclosureAncestors(detail().getByLabel('目标界面', { exact: true }));
      await assertFits(workspace(), theme + '参数集工作区'); await assertFits(detail(), theme + '参数详情'); await screenshot('06-' + theme + '-narrow-detail');
      await listSets(); await workspace().getByRole('button', { name: '新建参数集', exact: true }).click();
      await createDialog().getByLabel('参数集名称', { exact: true }).fill('窄窗口中的参数集名称和保存恢复配置');
      await reset(createDialog(), '新参数默认参与恢复初始设置', true); await assertFits(createDialog(), theme + '新建参数集');
      await screenshot('07-' + theme + '-narrow-create'); await createDialog().getByRole('button', { name: '取消', exact: true }).click();
      assert.equal(await fs.readFile(projectFile, 'utf8'), bytes); await size(1600, 1000);
    }
    assert.deepEqual(await read(), finalSaved); report.fixtureSha256AfterReopen = digest(await fs.readFile(projectFile, 'utf8'));
    assert.deepEqual(references(finalSaved), references(baseline));
    evidence.finalParameters = policies(finalSaved); evidence.finalGroups = finalSaved.parameterSets;
  });

  assert.equal(checks.length, 16); assert.deepEqual(errors, [], 'The editor and independent preview must not raise runtime errors.');
  report.buildAfter = await fingerprints(); assert.deepEqual(report.buildAfter, report.buildBefore, 'The compiled build must stay unchanged throughout acceptance.');
  report.status = 'passed';
} catch (error) {
  failure = error; report.status = 'failed'; report.phase = phase; report.error = String(error);
  if (app && page && !page.isClosed()) await screenshot('failure').catch(capture => { report.captureError = String(capture); });
  if (app && preview && !preview.isClosed()) await screenshot('failure-preview', preview).catch(capture => { report.previewCaptureError = String(capture); });
} finally {
  try { await close(); } catch (error) { failure ??= error; report.status = 'failed'; report.closeError = String(error); }
  try {
    const after = digest(await fs.readFile(authorFile)); report.authorSha256After = after;
    if (authorHash !== undefined) assert.equal(after, authorHash, 'The author project changed during isolated acceptance.');
  } catch (error) { failure ??= error; report.status = 'failed'; report.authorProtectionError = String(error); }
  try {
    await fs.mkdir(output, { recursive: true });
    if (app || processes.some(item => !item.exited)) throw new Error('An owned fixture process remains alive; retain its directories.');
    report.cleanup = await cleanVerificationDirectories(output, ['fixture', 'profile']);
    assert.deepEqual((report.cleanup as { errors: unknown[] }).errors, []);
  } catch (error) { failure ??= error; report.status = 'failed'; report.cleanupError = String(error); }
  await fs.mkdir(output, { recursive: true }); await writeReport(); console.log(output);
}
if (failure) throw failure;
