import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { projectSchema } from '../src/core/model';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { createUiInspectorGeneralizationFixture } from './lib/ui-inspector-generalization-fixture';
import { uiFixturePng } from './lib/ui-fixture-image';

if (process.env.VNS_INSTALLED_EXE) throw new Error('This acceptance uses the locally compiled development build, not an installed executable.');

const root = path.resolve('.');
const artifactRoot = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? 'artifacts/editor-ux-2026-11-12');
const output = path.join(artifactRoot, 'editor-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const projectDir = path.join(output, 'project');
const projectFile = path.join(projectDir, 'project.vns.json');
const shots = path.join(output, 'shots');
const authorProject = path.resolve(root, '../我的视觉小说1/project.vns.json');
const digest = async (file: string) => createHash('sha256').update(await fs.readFile(file)).digest('hex');
const authorBefore = await digest(authorProject);
const checks: string[] = [], errors: string[] = [], geometryEvidence: Record<string, unknown>[] = [];
const report: Record<string, unknown> = { status: 'running', checks, errors, geometryEvidence, authorBefore, launchMode: 'compiled development build' };
let app: ElectronApplication | undefined, page: Page | undefined, traceStarted = false, phase = 'setup';

const fixture = createUiInspectorGeneralizationFixture();
const project = fixture.project;
project.parameterSets = [...(project.parameterSets ?? []), {
  id: 'qa_ux_set', name: '验收状态分组', kind: 'story', defaults: { persistent: false, resetWithSettings: false },
}];
project.variables.push(
  { id: 'qa_param_a', name: '目标甲', type: 'string', initial: 'A', persistent: false, resetWithSettings: false, parameterSetId: 'qa_ux_set' },
  { id: 'qa_param_b', name: '目标乙', type: 'string', initial: 'B', persistent: false, resetWithSettings: false, parameterSetId: 'qa_ux_set' },
  { id: 'qa_param_c', name: '目标丙', type: 'string', initial: 'C', persistent: false, resetWithSettings: false, parameterSetId: 'qa_ux_set' },
);
const checkedProject = projectSchema.parse(project);
const readProject = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const paramWorkspace = () => page!.locator('.parameter-sets-workspace');
const parameterSearch = () => paramWorkspace().getByLabel('搜索参数集或参数', { exact: true });
const parameterRow = (id: string) => paramWorkspace().locator(`[data-parameter-id="${id}"]`);
const parameterSetCard = (id: string) => paramWorkspace().locator(`[data-parameter-set-id="${id}"]`);
const inspectorGroup = (id: string) => page!.locator(`.ui-inspector [data-ui-inspector-group="${id}"]`);

async function setTheme(theme: '黑白' | '亮白') {
  await page!.getByRole('button', { name: '作品设置', exact: true }).click();
  const settings = page!.getByRole('dialog', { name: '作品设置', exact: true });
  await settings.getByRole('button', { name: '编辑器外观', exact: true }).click();
  const card = settings.locator('.editor-theme-picker').getByRole('button', { name: new RegExp(theme) });
  await card.click();
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  await settings.getByRole('button', { name: '完成', exact: true }).click();
  await expect(page!.locator('html')).toHaveAttribute('data-editor-light', theme === '亮白' ? 'true' : 'false');
}

async function setInspectorWidth(width: number) {
  const dock = page!.locator('.ui-dock');
  const panel = dock.locator('[data-dock-panel="inspector"]');
  const separator = dock.locator('.performance-dock-divider.divider-right');
  const start = await panel.boundingBox();
  const handle = await separator.boundingBox();
  assert(start && handle, 'UI dock inspector and resize separator must be visible');
  const delta = width - start.width;
  const x = handle.x + handle.width / 2, y = handle.y + handle.height / 2;
  await page!.mouse.move(x, y);
  await page!.mouse.down();
  await page!.mouse.move(x - delta, y, { steps: 5 });
  await page!.mouse.up();
  // Dock sizing uses a percentage of its root, including the divider gutters.
  // Correct the measured remainder through another real divider drag.
  const actualStart = (await panel.boundingBox())!.width;
  if (Math.abs(actualStart - width) > .5) {
    const next = (await separator.boundingBox())!;
    await page!.mouse.move(next.x + next.width / 2, y);
    await page!.mouse.down();
    await page!.mouse.move(next.x + next.width / 2 + actualStart - width, y, { steps: 2 });
    await page!.mouse.up();
  }
  await expect.poll(async () => (await panel.boundingBox())?.width ?? 0).toBeGreaterThan(width - 2);
  await expect.poll(async () => (await panel.boundingBox())?.width ?? 0).toBeLessThan(width + 2);
  const actual = (await panel.boundingBox())!.width;
  assert(Math.abs(actual - width) <= 1, `Inspector should measure ${width}px ±1px; actual ${actual}px`);
}

async function assertInputTextFits(input: ReturnType<Page['locator']>, expected: string, info: string) {
  await expect(input).toHaveValue(expected);
  const metric = await input.evaluate((element, text) => {
    const field = element as HTMLInputElement, css = getComputedStyle(field);
    const context = document.createElement('canvas').getContext('2d')!;
    context.font = css.font || `${css.fontSize} ${css.fontFamily}`;
    const number = (value: string) => Number.parseFloat(value) || 0;
    const available = field.clientWidth
      - number(css.borderLeftWidth) - number(css.borderRightWidth)
      - number(css.paddingLeft) - number(css.paddingRight) - 16;
    return { available, measured: context.measureText(text).width, clientWidth: field.clientWidth, font: context.font, text: field.value };
  }, expected);
  assert(metric.available >= metric.measured + 2,
    `${info}: content ${metric.available.toFixed(2)}px must fit ${expected} (${metric.measured.toFixed(2)}px), including a 16px spinner estimate`);
  geometryEvidence.push({ info, ...metric });
}

async function editGeometry(unit: 'percent' | 'pixel') {
  const geometry = inspectorGroup('layout').locator('.ui-inspector-geometry');
  await geometry.getByLabel('位置尺寸单位', { exact: true }).selectOption(unit);
  const suffix = unit === 'pixel' ? 'px' : '%';
  const inputs = {
    x: geometry.getByLabel(`横向位置 ${suffix}`, { exact: true }),
    y: geometry.getByLabel(`纵向位置 ${suffix}`, { exact: true }),
    width: geometry.getByLabel(`宽度 ${suffix}`, { exact: true }),
    height: geometry.getByLabel(`高度 ${suffix}`, { exact: true }),
  };
  const values = unit === 'pixel'
    ? { x: '-123.4567', y: '0', width: '4096', height: '1024' }
    : { x: '-123.4567', y: '0.125', width: '42.5', height: '12.75' };
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    await inputs[key].fill(values[key]);
    await assertInputTextFits(inputs[key], values[key], `${unit} ${key}`);
  }
  const duplicates = await geometry.locator('.ui-inspector-number > span').count();
  assert.equal(duplicates, 0, 'Geometry field labels are outside the numeric input');
  for (const suffixNode of await geometry.locator('.ui-inspector-number > small').all()) await expect(suffixNode).toHaveText(suffix);
}

async function enterUi() {
  await page!.locator('[data-workspace-tab="ui"]').click();
  await page!.getByLabel('界面编辑模式').getByRole('button', { name: '设计', exact: true }).click();
}

async function closeOwnedApp() {
  if (!app) return;
  const owned = app, child = owned.process();
  const exited = () => child.exitCode !== null || child.signalCode !== null;
  await owned.close();
  await expect.poll(exited, { timeout: 15000 }).toBe(true);
  report.process = { pid: child.pid, exited: exited() };
  app = undefined;
  page = undefined;
}

try {
  await fs.mkdir(projectDir, { recursive: true });
  await fs.mkdir(shots, { recursive: true });
  const image = uiFixturePng();
  for (const asset of checkedProject.assets) await fs.writeFile(path.join(projectDir, asset.path), image);
  await fs.writeFile(projectFile, JSON.stringify(checkedProject));

  app = await launchDesktopFixture({ root, profile: path.join(output, 'profile'), projectFile });
  page = await app.firstWindow();
  page.setDefaultTimeout(18000);
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(checkedProject.name, { timeout: 45000 });
  await page.evaluate('globalThis.__name = value => value');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 960));
  await expect.poll(() => page!.evaluate(() => Math.max(Math.abs(innerWidth - 1440), Math.abs(innerHeight - 960)))).toBeLessThanOrEqual(1);
  await app.context().tracing.start({ screenshots: true, snapshots: true, sources: false });
  traceStarted = true;

  phase = 'geometry-width-theme-and-units';
  await enterUi();
  await page.locator('[data-hierarchy-id="qa_text"]').click();
  await expect(page.locator('.ui-inspector')).toHaveAttribute('data-ui-inspector-kind', 'text');
  for (const theme of ['黑白', '亮白'] as const) {
    await setTheme(theme);
    for (const width of [220, 280, 360]) {
      await setInspectorWidth(width);
      await editGeometry('percent');
      await editGeometry('pixel');
      await page.screenshot({ path: path.join(shots, `geometry-${theme}-${width}.png`) });
      const savedWidth = (await page.locator('.ui-dock [data-dock-panel="inspector"]').boundingBox())!.width;
      assert(Math.abs(savedWidth - width) <= 1);
    }
  }
  checks.push('220/280/360px 属性面板在深浅主题下均可编辑百分比和像素；负数、小数、0、1024px、4096px完整显示，按字体实测内容宽度扣除边框、内边距及spinner估算。');
  await page.getByRole('button', { name: '保存界面', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存界面', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.locator('.dirty-dot')).toHaveCount(0);

  phase = 'ui-save-page-context-through-parameters';
  await page.locator('[data-workspace-tab="variables"]').click();
  await parameterSearch().fill('可调整数值');
  await page.locator('[data-parameter-set-id="parameters_story"]').click();
  await expect(paramWorkspace().locator('.parameter-detail h2')).toHaveText('可调整数值');
  const parameterControls = paramWorkspace().locator('details.parameter-advanced').filter({ hasText: '界面控件（可选）' });
  await parameterControls.locator(':scope > summary').click();
  await parameterControls.locator('[data-parameter-control-action="locate"]').click();
  await expect(page.getByLabel('设计页面', { exact: true })).toHaveValue('preferences');
  await expect(page.getByLabel('控件显示名称', { exact: true })).toHaveValue('类型转换控件');
  await page.getByLabel('设计页面', { exact: true }).selectOption('save');
  await page.locator('[data-hierarchy-id="qa_save"]').click();
  await expect(page.locator('.ui-inspector')).toHaveAttribute('data-ui-inspector-kind', 'saveSlots');
  await expect(page.getByLabel('控件显示名称', { exact: true })).toHaveValue('存档槽 · 验收');
  await expect(page.locator('.ui-scroll [data-component-id="qa_save"]')).toBeVisible();
  await page.locator('[data-workspace-tab="variables"]').click();
  await parameterSearch().waitFor({ state: 'visible' });
  await page.locator('[data-workspace-tab="ui"]').click();
  await expect(page.getByLabel('设计页面', { exact: true })).toHaveValue('save');
  await expect(page.locator('.ui-inspector')).toHaveAttribute('data-ui-inspector-kind', 'saveSlots');
  await expect(page.getByLabel('控件显示名称', { exact: true })).toHaveValue('存档槽 · 验收');
  await expect(page.locator('[data-hierarchy-id="qa_save"]')).toHaveClass(/selected/);
  await expect(page.locator('.ui-scroll [data-component-id="qa_save"]')).toBeVisible();
  await expect(page.locator('.ui-scroll .ui-main-menu')).toHaveCount(0);
  await page.screenshot({ path: path.join(shots, 'save-page-restored-after-parameters.png') });
  checks.push('参数详情定位 qa_rebind 后，手动切到存档页选择 qa_save，再经参数集返回时恢复最新页面、控件与画布。');

  phase = 'parameter-overview-search-enter-match';
  await page.locator('[data-workspace-tab="variables"]').click();
  await parameterSearch().fill('目标乙');
  await expect(parameterSetCard('qa_ux_set')).toBeVisible();
  await expect(paramWorkspace().locator('[data-parameter-set-id]')).toHaveCount(1);
  await parameterSetCard('qa_ux_set').click();
  await expect(parameterSearch()).toHaveValue('目标乙');
  await expect(parameterRow('qa_param_b')).toHaveClass(/selected/);
  await expect(paramWorkspace().locator('.parameter-table [data-parameter-id]')).toHaveCount(1);
  await expect(paramWorkspace().locator('.parameter-detail h2')).toHaveText('目标乙');
  await page.screenshot({ path: path.join(shots, 'search-overview-hit-detail.png') });
  checks.push('总览搜索非首个参数后进入其参数集，查询、列表选中行和右侧详情保持同一命中。');
  await parameterSearch().fill('');
  await parameterRow('qa_param_a').click();
  await parameterSearch().fill('目标乙');
  await expect(parameterRow('qa_param_a')).toHaveCount(0);
  await expect(parameterRow('qa_param_b')).toHaveClass(/selected/);
  await expect(paramWorkspace().locator('.parameter-detail h2')).toHaveText('目标乙');
  checks.push('已选 A 时在组内搜索 B，隐藏 A 的详情立即退出；活动列表与详情一致。');

  phase = 'parameter-empty-search-and-clear';
  await parameterSearch().fill('确实不存在的验收词');
  await expect(paramWorkspace().locator('.parameter-empty[role="status"]')).toContainText('没有匹配的参数');
  await paramWorkspace().locator('.workspace-toolbar button[aria-label="清除搜索"]').click();
  await expect(parameterSearch()).toHaveValue('');
  await expect(paramWorkspace().locator('.parameter-table [data-parameter-id]')).toHaveCount(3);
  await expect(parameterRow('qa_param_a')).toHaveClass(/selected/);
  checks.push('无匹配参数时显示明确状态与清除操作；清除后恢复完整列表。');

  phase = 'builtin-preference-search';
  await paramWorkspace().locator('.workspace-toolbar').getByRole('button', { name: '参数集', exact: true }).click();
  await parameterSearch().fill('文字速度');
  await expect(parameterSetCard('parameters_game')).toBeVisible();
  await parameterSetCard('parameters_game').click();
  await expect(parameterSearch()).toHaveValue('文字速度');
  await expect(paramWorkspace().locator('[data-builtin-preference="textSpeed"]')).toHaveClass(/selected/);
  await expect(paramWorkspace().locator('.parameter-table [data-parameter-id], .parameter-table [data-builtin-preference]')).toHaveCount(1);
  await expect(paramWorkspace().locator('.parameter-detail h2')).toHaveText('文字速度');
  const preferenceName = paramWorkspace().getByLabel('显示名称', { exact: true });
  await preferenceName.fill('读字节奏');
  await expect(preferenceName).toBeFocused();
  await expect(parameterSearch()).toHaveValue('');
  await expect(paramWorkspace().locator('.parameter-detail h2')).toHaveText('读字节奏');
  await parameterSearch().fill('读字节奏');
  await paramWorkspace().getByRole('button', { name: '恢复这一项的默认设置', exact: true }).click();
  await expect(parameterSearch()).toHaveValue('');
  await expect(paramWorkspace().locator('.parameter-detail h2')).toHaveText('文字速度');
  checks.push('总览搜索内置偏好，改为不匹配名称保持输入焦点；恢复默认名称后也保留该设置详情。');

  phase = 'rename-search-and-focus';
  await paramWorkspace().locator('.workspace-toolbar').getByRole('button', { name: '参数集', exact: true }).click();
  await parameterSearch().fill('目标甲');
  await parameterSetCard('qa_ux_set').click();
  const nameInput = paramWorkspace().getByLabel('参数名称', { exact: true });
  await expect(nameInput).toHaveValue('目标甲');
  await nameInput.fill('目标甲更名');
  await nameInput.press('Enter');
  await expect(nameInput).toHaveValue('目标甲更名');
  await expect(nameInput).toBeFocused();
  await expect(parameterSearch()).toHaveValue('目标甲');
  await expect(parameterRow('qa_param_a')).toBeVisible();
  await expect(paramWorkspace().locator('.parameter-detail h2')).toHaveText('目标甲更名');
  await nameInput.fill('已改名甲');
  await nameInput.press('Enter');
  await expect(nameInput).toHaveValue('已改名甲');
  await expect(nameInput).toBeFocused();
  await expect(parameterSearch()).toHaveValue('');
  await expect(paramWorkspace().locator('.parameter-table [data-parameter-id]')).toHaveCount(3);
  checks.push('重命名后搜索命中和详情即时更新，编辑输入仍保持焦点。');

  phase = 'tab-focus-delete-and-next-focus';
  await parameterRow('qa_param_a').click();
  await page.keyboard.press('Tab');
  await expect(parameterRow('qa_param_b')).toBeFocused();
  await expect(parameterRow('qa_param_b')).toHaveClass(/selected/);
  await expect(paramWorkspace().locator('.parameter-detail h2')).toHaveText('目标乙');
  await page.keyboard.press('Delete');
  const deleteDialog = page.getByRole('dialog', { name: '删除参数', exact: true });
  await expect(deleteDialog).toContainText('删除“目标乙”');
  await deleteDialog.getByRole('button', { name: '确认删除参数', exact: true }).click();
  await expect(parameterRow('qa_param_b')).toHaveCount(0);
  await expect(parameterRow('qa_param_c')).toBeFocused();
  await expect(paramWorkspace().locator('.parameter-detail h2')).toHaveText('目标丙');
  await page.screenshot({ path: path.join(shots, 'delete-next-focus.png') });
  checks.push('Tab 将焦点移至 B 后 Delete 删除 B 而非旧选中的 A，删除后将焦点和详情交给下一行 C。');

  phase = 'undo-save-reopen';
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(parameterRow('qa_param_b')).toBeVisible();
  await expect(parameterRow('qa_param_a')).toBeVisible();

  phase = 'context-delete-previous-and-cancel-focus';
  await parameterRow('qa_param_c').click({ button: 'right' });
  await page.getByRole('menu', { name: '参数操作', exact: true }).getByRole('menuitem', { name: '删除参数', exact: true }).click();
  await expect(deleteDialog).toContainText('删除“目标丙”');
  await deleteDialog.getByRole('button', { name: '确认删除参数', exact: true }).click();
  await expect(parameterRow('qa_param_c')).toHaveCount(0);
  await expect(parameterRow('qa_param_b')).toBeFocused();
  await expect(paramWorkspace().locator('.parameter-detail h2')).toHaveText('目标乙');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(parameterRow('qa_param_c')).toBeVisible();
  await parameterSearch().fill('目标丙');
  await parameterRow('qa_param_c').click();
  await page.keyboard.press('Delete');
  await deleteDialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(parameterRow('qa_param_c')).toBeFocused();
  await expect(paramWorkspace().locator('.parameter-detail h2')).toHaveText('目标丙');
  checks.push('右键删除末行后焦点与详情回到上一行；取消删除时恢复原参数行焦点且数据不变。');

  phase = 'delete-last-filtered-row-focus';
  await page.keyboard.press('Delete');
  await deleteDialog.getByRole('button', { name: '确认删除参数', exact: true }).click();
  await expect(parameterSearch()).toHaveValue('目标丙');
  await expect(paramWorkspace().locator('.parameter-table [data-parameter-id]')).toHaveCount(0);
  await expect(paramWorkspace().locator('.parameter-detail h2')).toHaveText('没有匹配的参数');
  await expect(paramWorkspace().locator('.parameter-add-kinds button').first()).toBeFocused();
  await page.screenshot({ path: path.join(shots, 'delete-last-filtered-row-focus.png') });
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(parameterRow('qa_param_c')).toHaveClass(/selected/);
  await expect(paramWorkspace().locator('.parameter-detail h2')).toHaveText('目标丙');
  await parameterSearch().fill('');
  await expect(paramWorkspace().locator('.parameter-table [data-parameter-id]')).toHaveCount(3);
  checks.push('删除最后一个搜索命中后保留查询、显示空状态并聚焦新增按钮；撤销恢复匹配行，其他参数保留。');

  phase = 'undo-save-reopen';
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  let saved = await readProject();
  assert.equal(saved.parameterSets?.find(set => set.id === 'qa_ux_set')?.name, '验收状态分组');
  assert.equal(saved.variables.find(variable => variable.id === 'qa_param_a')?.name, '已改名甲');
  assert.equal(saved.variables.find(variable => variable.id === 'qa_param_b')?.name, '目标乙');
  const rebind = saved.ui.components.find(component => component.id === 'qa_rebind');
  assert.equal(rebind?.kind === 'preferenceChoice' ? rebind.parameterId : undefined, 'qa_number');
  await page.reload();
  await expect(page.locator('.project-title strong')).toHaveText(checkedProject.name, { timeout: 45000 });
  await page.evaluate('globalThis.__name = value => value');
  await page.locator('[data-workspace-tab="variables"]').click();
  await parameterSearch().fill('目标乙');
  await parameterSetCard('qa_ux_set').click();
  await expect(parameterRow('qa_param_b')).toHaveClass(/selected/);
  await expect(paramWorkspace().locator('.parameter-detail h2')).toHaveText('目标乙');
  saved = await readProject();
  assert.equal(saved.variables.find(variable => variable.id === 'qa_param_b')?.initial, 'B');
  const reopenedRebind = saved.ui.components.find(component => component.id === 'qa_rebind');
  assert.equal(reopenedRebind?.kind === 'preferenceChoice' ? reopenedRebind.parameterId : undefined, 'qa_number');
  await page.screenshot({ path: path.join(shots, 'undo-save-reopen.png') });
  checks.push('撤销恢复 B 后保存并重开，参数组、名称、初值及原控件引用均保留。');

  phase = 'asset-popup-scroll-anchor-and-dismiss';
  await enterUi();
  await page.getByLabel('设计页面', { exact: true }).selectOption('main');
  await page.locator('[data-hierarchy-id="qa_image"]').click();
  await expect(page.locator('.ui-inspector')).toHaveAttribute('data-ui-inspector-kind', 'image');
  const assetInput = page.getByRole('combobox', { name: '图片素材', exact: true });
  await assetInput.focus();
  await assetInput.fill('本地检查');
  await expect(assetInput).toHaveAttribute('aria-expanded', 'true');
  const listbox = () => page!.getByRole('listbox', { name: '图片素材搜索结果', exact: true });
  await expect(listbox()).toHaveCount(1);
  await expect.poll(() => listbox().locator('img').first().evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(8);
  const scrollMetrics = await listbox().evaluate(element => ({ scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }));
  assert(scrollMetrics.scrollHeight > scrollMetrics.clientHeight, 'Asset suggestions should scroll independently');
  const selectedBeforeScroll = await listbox().getByRole('option').evaluateAll(elements => elements.findIndex(element => element.getAttribute('aria-selected') === 'true'));
  const popupBefore = await listbox().boundingBox(), anchorBefore = await assetInput.boundingBox();
  assert(popupBefore && anchorBefore);
  await page.mouse.move(popupBefore.x + popupBefore.width / 2, popupBefore.y + popupBefore.height / 2);
  await page.mouse.wheel(0, 150);
  await expect.poll(() => listbox().evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await expect(assetInput).toHaveAttribute('aria-expanded', 'true');
  const selectedAfterScroll = await listbox().getByRole('option').evaluateAll(elements => elements.findIndex(element => element.getAttribute('aria-selected') === 'true'));
  assert.equal(selectedAfterScroll, selectedBeforeScroll);
  const inspectorScroll = page.locator('.ui-inspector-shell > .inspector-scroll');
  const scrollBounds = await inspectorScroll.boundingBox(); assert(scrollBounds);
  await page.mouse.move(scrollBounds.x + 5, scrollBounds.y + 150);
  await page.mouse.wheel(0, -70);
  await expect.poll(async () => Math.abs(((await assetInput.boundingBox())?.y ?? anchorBefore.y) - anchorBefore.y)).toBeGreaterThan(20);
  await expect.poll(async () => {
    const popup = await listbox().boundingBox(), anchor = await assetInput.boundingBox();
    return popup && anchor ? Math.abs((popup.y - anchor.y) - (popupBefore.y - anchorBefore.y)) : Number.POSITIVE_INFINITY;
  }).toBeLessThan(2);
  await page.screenshot({ path: path.join(shots, 'asset-popup-following-anchor.png') });
  checks.push('素材建议列表内部滚动不关闭、不选择资源；检查器滚动后弹层仍跟随锚点定位。');

  phase = 'asset-popup-ime-composition';
  const optionA = listbox().getByRole('option').nth(0);
  await expect(optionA).toHaveAttribute('aria-selected', 'true');
  await assetInput.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '拼' })));
  for (const key of ['Enter', 'ArrowDown', 'ArrowUp', 'Escape'] as const) {
    await page.keyboard.press(key);
    await expect(assetInput).toHaveAttribute('aria-expanded', 'true');
    await expect(listbox()).toHaveCount(1);
    await expect(optionA).toHaveAttribute('aria-selected', 'true');
    await expect(assetInput).toHaveValue('本地检查');
  }
  await assetInput.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '拼' })));
  await page.keyboard.press('ArrowDown');
  await expect(listbox().getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(assetInput).toHaveAttribute('aria-expanded', 'false');
  await expect(assetInput).toHaveValue('本地检查图片 2');
  checks.push('合成 compositionstart 期间 Enter、上下键和 Escape 都不提交、不移动选择也不关闭；compositionend 后正常键盘选择恢复。该合成事件仅模拟事件语义，不代表操作系统 IME。');

  phase = 'asset-popup-anchor-out-of-view';
  await assetInput.focus();
  await assetInput.fill('本地检查');
  await expect(assetInput).toHaveAttribute('aria-expanded', 'true');
  await page.mouse.move(scrollBounds.x + 5, scrollBounds.y + 150);
  await page.mouse.wheel(0, -1600);
  await expect.poll(() => assetInput.getAttribute('aria-expanded')).toBe('false');
  await expect(listbox()).toHaveCount(0);
  await page.screenshot({ path: path.join(shots, 'asset-popup-dismissed-anchor-out-of-view.png') });
  checks.push('素材选择锚点滚出属性面板可视范围后，搜索弹层关闭并从页面移除。');
  await page.getByRole('button', { name: '保存界面', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存界面', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  const savedImage = (await readProject()).ui.components.find(component => component.id === 'qa_image');
  assert.equal(savedImage?.assetId, 'qa_image_2', 'The committed resource must come from the normal post-composition keyboard selection');

  assert.deepEqual(errors, []);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.phase = phase;
  report.error = error instanceof Error ? error.stack : String(error);
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
  process.exitCode = 1;
} finally {
  if (traceStarted && app) {
    await app.context().tracing.stop({ path: path.join(output, 'trace.zip') }).catch(error => {
      errors.push('Playwright trace could not be saved: ' + String(error));
      report.status = 'failed';
    });
    traceStarted = false;
  }
  try { await closeOwnedApp(); }
  catch (error) { report.status = 'failed'; report.closeError = String(error); process.exitCode = 1; }
  try {
    report.authorAfter = await digest(authorProject);
    assert.equal(report.authorAfter, authorBefore, 'The author project is read-only for this fixture');
    if (app) throw new Error('The fixture editor is still running; retain its owned profile and project.');
    const cleanup = await cleanVerificationDirectories(output, ['project', 'profile']);
    report.cleanup = cleanup;
    if (cleanup.errors.length) throw new Error('Fixture cleanup did not finish: ' + JSON.stringify(cleanup.errors));
  } catch (error) {
    report.status = 'failed'; report.cleanupError = String(error); process.exitCode = 1;
  }
  if (errors.length) { report.status = 'failed'; process.exitCode = 1; }
  report.phase = phase;
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(path.join(output, 'report.json'));
  if (report.error) console.error(report.error);
}
