import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { projectSchema } from '../src/core/model';
import { builtinUiPages } from '../src/core/ui-page-catalog';
import { uiControlDefinition } from '../src/core/ui-control-properties';
import { galleryLayout } from '../src/core/gallery-layout';
import { softTextBackdrop } from '../src/core/ui-text-effects';
import { projectGraphs } from '../src/core/project-resources';
import { listUiParameterBindings } from '../src/core/ui-parameter-links';
import { createUiParameterBinding } from '../src/core/ui-logic';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { createUiInspectorGeneralizationFixture } from './lib/ui-inspector-generalization-fixture';
import { uiFixturePng } from './lib/ui-fixture-image';
import { openDisclosureAncestors } from './lib/ui-disclosures';

// Run only after all implementation is complete and `pnpm build` has passed.
// This deliberately opens the built renderer, not a second Vite compilation.
if (process.env.VNS_INSTALLED_EXE) throw new Error('This acceptance uses an isolated development editor, never the installed application.');
const root = path.resolve('.');
const output = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? 'artifacts/ui-inspector-generalization-2026-11-08', 'generalization-editor-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const relativeOutput = path.relative(root, output);
assert.ok(relativeOutput && !path.isAbsolute(relativeOutput) && relativeOutput !== '..' && !relativeOutput.startsWith('..' + path.sep),
  'VNS_ARTIFACT_ROOT must keep acceptance output inside this checkout.');
const projectFile = path.join(output, 'project', 'project.vns.json');
const sourceFile = path.resolve(process.env.VNS_AUTHOR_PROJECT ?? '../我的视觉小说1/project.vns.json');
const profile = path.join(output, 'profile');
const fixture = createUiInspectorGeneralizationFixture();
// Search checks a visible soft-backdrop control without authoring fixture values
// during navigation; the default/no-shadow case is covered by the flow suite.
fixture.project.ui.components.find(item => item.id === 'qa_flow')!.style = { ...softTextBackdrop };
// Existing projects can contain both an independent generated link and a
// customized program. Merely opening their inspector must keep both intact.
const legacyBindingGraph = createUiParameterBinding(fixture.project, 'qa_text', 'visible', 'qa_boolean', 'ui:main');
legacyBindingGraph.name = '可转换的旧显示联动';
const customBindingGraph = createUiParameterBinding(fixture.project, 'qa_text', 'visible', 'qa_link_visible', 'ui:main');
customBindingGraph.name = '保留的自定义显示联动';
customBindingGraph.nodes.find(node => node.type === 'eventTimer')!.properties.interval = .125;
const checks: { name: string; status: 'passed'; durationMs: number }[] = [];
const errors: string[] = [], processes: { pid: number | undefined; exited: boolean }[] = [];
const evidence: Record<string, unknown> = {};
const report: Record<string, unknown> = {
  status: 'running', projectFile, sourceFile, temporaryPaths: [path.dirname(projectFile), profile],
  checks, errors, processes, evidence, compiledBuild: true,
};
let app: ElectronApplication | undefined, page: Page | undefined, phase = 'setup', failure: unknown;
let sourceHash: string | undefined;
const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const component = (project: Awaited<ReturnType<typeof read>>, id: string) => {
  const result = project.ui.components.find(item => item.id === id);
  assert.ok(result, 'Fixture component still exists: ' + id); return result;
};
const inspectorShell = () => page!.locator('.ui-inspector');
// Entering a collection part or flow object keeps the root mounted but hidden so local
// drafts survive. Assertions and edits must address only the active view.
const inspector = () => inspectorShell().locator('.ui-inspector-view:not([hidden])');
const group = (id: string) => inspector().locator(`[data-ui-inspector-group="${id}"]`);
const field = (name: string) => inspector().getByLabel(name, { exact: true });
const canvas = (id: string) => page!.locator(`.ui-canvas [data-component-id="${id}"]`);
const search = () => inspectorShell().getByLabel('搜索控件属性', { exact: true });
const state = () => field('外观预览状态');
const part = () => inspectorShell().locator('select:is([aria-label="编辑列表部件"],[aria-label="当前列表部件"]):visible');
const settle = async () => page!.evaluate(async () => {
  await document.fonts.ready;
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
});
async function openGroup(id: string, open = true) {
  const target = group(id); await expect(target).toHaveCount(1);
  await openDisclosureAncestors(target);
  if (await target.evaluate(element => (element as HTMLDetailsElement).open) !== open) await target.locator(':scope > summary').click();
  await expect(target).toHaveJSProperty('open', open); return target;
}
async function reveal(target: Locator) {
  await expect(target).toHaveCount(1);
  await openDisclosureAncestors(target);
  await expect(target).toBeVisible(); return target;
}
async function number(name: string, value: string) {
  const target = await reveal(field(name)); await target.fill(value); await target.press('Tab');
}
async function doubleClickCanvasPart(id: string, name: string) {
  const target = canvas(id).locator(`[data-collection-part="${name}"]`).first();
  await target.scrollIntoViewIfNeeded(); await settle();
  const bounds = await target.boundingBox(); assert.ok(bounds && bounds.width > 0 && bounds.height > 0);
  // Real pointer input exercises canvas capture through its transform overlay.
  // Locator force/dispatch would bypass the hit testing used by an author.
  await page!.mouse.dblclick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect(part()).toHaveValue(name);
  await expect(inspectorShell()).toHaveAttribute('data-ui-inspector-part', name);
  await openGroup('part-layout'); await openGroup('part-appearance');
}
async function enterPart(name: string) {
  if (await inspectorShell().getAttribute('data-ui-inspector-part') === null) {
    await openGroup('appearance');
    if (await part().inputValue() === name) await inspector().getByRole('button', { name: '编辑条目部件', exact: true }).click();
    else await part().selectOption(name);
  } else await part().selectOption(name);
  await expect(inspectorShell()).toHaveAttribute('data-ui-inspector-part', name);
  await openGroup('part-layout'); await openGroup('part-appearance');
}
async function returnRoot() {
  await inspectorShell().getByRole('button', { name: '返回整个控件', exact: true }).click();
  await settle();
  assert.equal(await inspectorShell().getAttribute('data-ui-inspector-part'), null);
}
async function select(id: string) {
  const target = fixture.project.ui.components.find(item => item.id === id)!;
  const picker = page!.getByLabel('设计页面', { exact: true });
  if (await picker.inputValue() !== target.page) {
    if (await picker.locator(`option[value="${target.page}"]`).count()) await picker.selectOption(target.page);
    else {
      await page!.getByRole('button', { name: '更多内置页面', exact: true }).click();
      if (target.page === 'chapterTitle') {
        const old = page!.locator('.ui-page-library details').filter({ hasText: '旧版章节布局' });
        if (await old.getAttribute('open') === null) await old.locator(':scope > summary').click();
        await page!.getByRole('button', { name: '编辑旧版章节布局', exact: true }).click();
      } else {
        const name = builtinUiPages[target.page as keyof typeof builtinUiPages].name;
        await page!.getByRole('button', { name: '编辑' + name, exact: true }).click();
      }
    }
  }
  await page!.locator(`[data-hierarchy-id="${id}"]`).click();
  await expect(page!.locator(`[data-hierarchy-id="${id}"]`)).toHaveAttribute('aria-selected', 'true');
  await settle();
}
async function save() {
  const button = page!.getByRole('button', { name: '保存界面', exact: true });
  if (await button.isEnabled()) await button.click();
  await expect(page!.locator('.ui-save-status')).toHaveText('已保存', { timeout: 30000 });
  await expect(button).toBeDisabled();
  return read();
}
async function undo() { await page!.getByRole('button', { name: '撤销', exact: true }).click(); await settle(); }
async function redo() { await page!.getByRole('button', { name: '重做', exact: true }).click(); await settle(); }
async function screenshot(name: string) {
  await settle();
  // Native capture avoids font-wait/screenshot timeouts at high Windows scaling.
  const data = await app!.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  await fs.writeFile(path.join(output, name + '.png'), Buffer.from(data, 'base64'));
}
async function launch() {
  app = await launchDesktopFixture({ root, projectFile, profile });
  processes.push({ pid: app.process().pid, exited: false });
  page = await app.firstWindow(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window.isMaximized()) window.unmaximize();
    window.setContentSize(1440, 960); window.webContents.setBackgroundThrottling(false);
  });
  await expect(page.locator('.project-title strong')).toHaveText(fixture.project.name, { timeout: 45000 });
  await page.locator('[data-workspace-tab="ui"]').click();
  await page.evaluate('globalThis.__name = value => value');
}
async function close() {
  if (!app) return;
  const owned = app, child = owned.process();
  const exited = () => child.exitCode !== null || child.signalCode !== null;
  try { await owned.close(); }
  finally {
    await expect.poll(exited, { timeout: 15000 }).toBe(true);
    const record = processes.find(item => item.pid === child.pid); if (record) record.exited = exited();
    if (exited()) { app = undefined; page = undefined; }
  }
}
async function check(name: string, work: () => Promise<void>) {
  phase = name; const started = Date.now(); await work();
  checks.push({ name, status: 'passed', durationMs: Date.now() - started });
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log('通过：' + name);
}
const rootGroups = ['content', 'layout', 'visibility', 'appearance', 'interaction'] as const;
async function rootOpenState() {
  return inspector().locator(rootGroups.map(id => `[data-ui-inspector-group="${id}"]`).join(',')).evaluateAll(elements => Object.fromEntries(elements.map(element => [element.getAttribute('data-ui-inspector-group'), (element as HTMLDetailsElement).open])));
}
async function assertNoAuthoringChange(before: Awaited<ReturnType<typeof read>>) {
  await expect(page!.getByRole('button', { name: '保存界面', exact: true })).toBeDisabled();
  assert.deepEqual((await read()).ui, before.ui, 'Presentation-only operations must not author UI values.');
}
async function layoutEvidence() {
  return inspector().evaluate(element => {
    const viewport = element.closest<HTMLElement>('.inspector-scroll')!;
    const bounds = viewport.getBoundingClientRect();
    const visible = (item: HTMLElement) => {
      const rect = item.getBoundingClientRect();
      if (!rect.width || !rect.height || getComputedStyle(item).visibility === 'hidden') return false;
      for (let ancestor = item.closest('details'); ancestor; ancestor = ancestor.parentElement?.closest('details') ?? null) {
        if (!ancestor.open && !ancestor.querySelector(':scope > summary')?.contains(item)) return false;
      }
      return true;
    };
    const fields = Array.from(element.querySelectorAll<HTMLElement>('input,select,textarea,summary,.field-label')).filter(visible).map(item => {
      const rect = item.getBoundingClientRect();
      return { label: item.getAttribute('aria-label') ?? item.textContent?.trim().slice(0, 70), tag: item.tagName, x: rect.x, right: rect.right, width: rect.width, y: rect.y, height: rect.height };
    });
    return { width: viewport.clientWidth, scrollWidth: viewport.scrollWidth, height: viewport.clientHeight, scrollHeight: viewport.scrollHeight, scrollTop: viewport.scrollTop, left: bounds.left, right: bounds.right, fields };
  });
}
async function assertFits() {
  const layout = await layoutEvidence();
  assert.ok(layout.scrollWidth <= layout.width + 1, 'Inspector horizontal overflow: ' + JSON.stringify(layout));
  const outside = layout.fields.filter(item => item.x < layout.left - 2 || item.right > layout.right + 2);
  assert.deepEqual(outside, [], 'Visible property controls must fit inside the inspector.');
  return layout;
}
async function textContrast() {
  const result = await inspector().evaluate(element => {
    const pixel = document.createElement('canvas'); pixel.width = 1; pixel.height = 1;
    const context = pixel.getContext('2d', { willReadFrequently: true })!;
    const color = (value: string) => {
      context.clearRect(0, 0, 1, 1); context.fillStyle = value; context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    };
    const over = (foreground: number[], background: number[]) => foreground.slice(0, 3).map((value, index) => value * foreground[3] / 255 + background[index] * (1 - foreground[3] / 255));
    const luminance = (rgb: number[]) => rgb.slice(0, 3).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const visible = (item: HTMLElement) => {
      const rect = item.getBoundingClientRect();
      if (!rect.width || !rect.height || !item.textContent?.trim() || getComputedStyle(item).visibility === 'hidden') return false;
      for (let ancestor = item.closest('details'); ancestor; ancestor = ancestor.parentElement?.closest('details') ?? null) {
        if (!ancestor.open && !ancestor.querySelector(':scope > summary')?.contains(item)) return false;
      }
      return true;
    };
    return Array.from(element.querySelectorAll<HTMLElement>('.field-label,.ui-group-title,.ui-design-field-heading > label,.ui-design-source,.ui-collection-source,.ui-collection-scope > span')).filter(visible).map(item => {
      const ancestors: Element[] = [];
      for (let current: Element | null = item; current; current = current.parentElement) ancestors.unshift(current);
      const background = ancestors.reduce((behind, current) => over(color(getComputedStyle(current).backgroundColor), behind), [255, 255, 255]);
      const foreground = over(color(getComputedStyle(item).color), background);
      const a = luminance(foreground), b = luminance(background);
      return { text: item.textContent!.trim().slice(0, 70), foreground, background, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
    });
  });
  assert.ok(result.length > 0, 'The inspector must expose readable field labels.');
  for (const value of result) assert.ok(value.ratio >= 4.5, 'Property label contrast: ' + JSON.stringify(value));
  return result;
}

try {
  await fs.mkdir(path.dirname(projectFile), { recursive: true });
  sourceHash = sha256(await fs.readFile(sourceFile)); report.sourceSha256Before = sourceHash;
  report.rendererIndexSha256 = sha256(await fs.readFile(path.join(root, 'dist', 'index.html')));
  report.desktopMainSha256 = sha256(await fs.readFile(path.join(root, 'dist-desktop', 'main.cjs')));
  await fs.writeFile(projectFile, JSON.stringify(fixture.project, null, 2));
  for (const asset of fixture.project.assets) await fs.writeFile(path.join(path.dirname(projectFile), asset.path), uiFixturePng());
  await launch();

  await check('分层分组编辑与同类按钮的状态、任务位置连续', async () => {
    await select('qa_button_a');
    for (const id of rootGroups) await expect(group(id)).toHaveCount(1);
    await openGroup('content', false); await openGroup('layout'); await openGroup('appearance'); await openGroup('interaction', false);
    const original = await save();
    await field('位置尺寸单位').selectOption('pixel');
    await expect(field('宽度 px')).toHaveValue('409.6');
    await state().selectOption('hover');
    await expect(inspector().locator('[data-ui-appearance-preview]')).toHaveAttribute('data-preview-state', 'hover');
    await expect(canvas('qa_button_a')).toHaveAttribute('data-preview-state', 'hover');
    await field('字号').click();
    await settle(); const before = await layoutEvidence();
    await select('qa_button_b');
    await expect(group('appearance')).toHaveJSProperty('open', true); await expect(state()).toHaveValue('hover');
    await expect(field('位置尺寸单位')).toHaveValue('pixel');
    await expect(field('宽度 px')).toHaveValue('409.6');
    const after = await layoutEvidence();
    assert.ok(Math.abs(after.scrollTop - before.scrollTop) <= 48, 'Switching comparable buttons must retain the current appearance task: ' + JSON.stringify({ before: before.scrollTop, after: after.scrollTop }));
    if (before.scrollTop > 80) assert.ok(after.scrollTop > 40, 'A same-kind selection must not force the inspector back to its beginning.');
    await assertNoAuthoringChange(original); evidence.continuity = { before, after };
    await screenshot('01-button-continuity');
  });

  await check('属性搜索临时打开匹配组，清除恢复折叠且不写工程', async () => {
    await select('qa_button_a');
    await openGroup('content'); await openGroup('layout', false); await openGroup('appearance', false); await openGroup('interaction', false);
    const original = await save(), before = await rootOpenState();
    await search().fill('阴影');
    await expect(group('appearance')).toBeVisible(); await expect(group('appearance')).toHaveJSProperty('open', true);
    await expect(group('appearance')).toHaveAttribute('data-search-match', 'true');
    await expect(group('content')).toBeHidden();
    await inspectorShell().getByRole('button', { name: '清除属性搜索', exact: true }).click();
    assert.deepEqual(await rootOpenState(), before, 'Search must not overwrite saved disclosure preferences.');
    await search().fill('不存在的属性_987654321');
    for (const id of rootGroups) await expect(group(id)).toBeHidden();
    await inspectorShell().getByRole('button', { name: '清除属性搜索', exact: true }).click();
    assert.deepEqual(await rootOpenState(), before);
    await assertNoAuthoringChange(original); evidence.searchRestore = before;
  });

  await check('完整中文属性名可搜索，输入模式和控件能力不显示无效组', async () => {
    const cases: { id: string; query: string; group: string; nested?: string; visibleField?: string; flowView?: 'base' | 'sources' }[] = [
      { id: 'qa_button_a', query: '阴影柔化', group: 'appearance' },
      { id: 'qa_panel_child', query: '父对象', group: 'layout' },
      { id: 'qa_input', query: '输入最大长度', group: 'content', visibleField: '输入最大长度' },
      { id: 'qa_slider', query: '滑条尺寸', group: 'appearance', visibleField: '滑块宽度' },
      { id: 'qa_save', query: '对白摘要字体', group: 'appearance' },
      { id: 'qa_flow', query: '黑底柔和度', group: 'flow-base-text-effects', visibleField: '黑底柔和度', flowView: 'base' },
      { id: 'qa_flow', query: '水平连线图片', group: 'flow-layout', nested: 'flow-layout-line-images' },
      { id: 'qa_flow', query: '显示竖向滚动条', group: 'flow-browsing', nested: 'flow-layout-scroll-region', visibleField: '显示竖向滚动条' },
      { id: 'qa_flow', query: '当前位置标记', group: 'flow-browsing', nested: 'flow-player-current-marker' },
      { id: 'qa_flow', query: '查找剧情来源', group: 'flow-sources', visibleField: '查找剧情来源', flowView: 'sources' },
    ];
    const original = await save();
    for (const item of cases) {
      await select(item.id);
      if (item.flowView) {
        await openGroup(item.flowView === 'base' ? 'flow-style' : 'flow-sources-entry');
        await group(item.flowView === 'base' ? 'flow-style' : 'flow-sources-entry').getByRole('button', { name: item.flowView === 'base' ? /^本图基础外观/ : '管理显示的剧情', exact: item.flowView !== 'base' }).click();
        await expect(inspectorShell()).toHaveAttribute('data-ui-flow-view', item.flowView);
        const retained = inspectorShell().locator('[data-ui-inspector-view="component"]');
        await expect(retained).toBeHidden(); await expect(retained).toHaveJSProperty('inert', true);
      }
      await search().fill(item.query);
      await expect(group(item.group)).toBeVisible();
      await expect(group(item.group)).toHaveAttribute('data-search-match', 'true');
      await expect(group(item.group)).toHaveJSProperty('open', true);
      if (item.nested) {
        await expect(group(item.nested)).toBeVisible();
        await expect(group(item.nested)).toHaveJSProperty('open', true);
      }
      if (item.visibleField) await expect(field(item.visibleField)).toBeVisible();
      await inspectorShell().getByRole('button', { name: '清除属性搜索', exact: true }).click();
    }
    await select('qa_progress'); await search().fill('字体'); await expect(group('appearance')).toBeHidden();
    await inspectorShell().getByRole('button', { name: '清除属性搜索', exact: true }).click();
    await select('qa_input'); await search().fill('滑块宽度'); await expect(group('appearance')).toBeHidden();
    await inspectorShell().getByRole('button', { name: '清除属性搜索', exact: true }).click();
    await assertNoAuthoringChange(original); evidence.fullSearchLabels = cases;
  });

  await check('有效默认色、透明与RGBA、单项恢复和撤销', async () => {
    await select('qa_button_a'); await openGroup('appearance'); await state().selectOption('hover');
    await expect(field('背景颜色颜色值')).toHaveValue('#aa3311');
    await expect(inspector().locator('[data-ui-design-source="hoverBackground"]')).toContainText('普通');
    await openGroup('appearance-frame');
    await expect(field('边框颜色颜色值')).toHaveValue('#ffffff');
    assert.equal(component(await save(), 'qa_button_a').style?.hoverBackground, undefined);
    await select('qa_text'); await openGroup('appearance');
    await expect(field('背景颜色颜色值')).toHaveValue('#00000000');
    await expect(canvas('qa_text')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await field('背景颜色颜色值').fill('#12345680'); await field('背景颜色颜色值').press('Tab');
    const color = await canvas('qa_text').evaluate(element => getComputedStyle(element).backgroundColor);
    const rgba = (color.match(/[\d.]+/g) ?? []).map(Number);
    assert.deepEqual(rgba.slice(0, 3), [18, 52, 86]); assert.ok(Math.abs(rgba[3] - 128 / 255) < .005, color);
    await inspector().getByRole('button', { name: '恢复背景颜色', exact: true }).click();
    await expect(field('背景颜色颜色值')).toHaveValue('#00000000');
    await undo(); await expect(field('背景颜色颜色值')).toHaveValue('#12345680');
    await inspector().getByRole('button', { name: '背景颜色无填充', exact: true }).click();
    assert.equal(component(await save(), 'qa_text').style?.background, '#00000000', 'Explicit transparency must remain distinguishable from an unset field.');
    await field('背景颜色颜色值').fill('#12345680'); await field('背景颜色颜色值').press('Tab');
    assert.equal(component(await save(), 'qa_text').style?.background, '#12345680');
    await inspector().getByRole('button', { name: '恢复背景颜色', exact: true }).click(); await save();
    assert.equal(component(await read(), 'qa_text').style?.background, undefined);
    evidence.rgba = { entered: '#12345680', displayed: color }; await screenshot('02-transparent-default');
  });

  await check('字号显示实际高度限制，单项恢复不改背景与其他状态', async () => {
    await select('qa_button_a'); await openGroup('appearance'); await state().selectOption('hover');
    const before = component(await save(), 'qa_button_a');
    await number('字号', '50'); await expect(inspector()).toContainText(/设置\s*50.*当前显示.*受高度限制/);
    await expect(field('字号')).toHaveValue('50');
    await inspector().getByRole('button', { name: '恢复字号', exact: true }).click();
    await expect(field('字号')).toHaveValue('28');
    const saved = component(await save(), 'qa_button_a'); assert.deepEqual(saved, before);
    await expect(state()).toHaveValue('hover');
  });

  await check('单项及本组恢复只改外观，图片适配保留且可一次撤销', async () => {
    await select('qa_image'); await openGroup('content'); await openGroup('appearance'); await openGroup('visibility');
    const original = component(await save(), 'qa_image');
    await inspector().getByRole('button', { name: '恢复背景颜色', exact: true }).click();
    await expect(field('背景颜色颜色值')).toHaveValue('#00000000');
    await expect(field('图片缩放')).toHaveValue('cover'); await expect(canvas('qa_image')).toHaveCSS('opacity', '0.8');
    await undo(); await expect(field('背景颜色颜色值')).toHaveValue('#11223380');
    await inspector().getByRole('button', { name: '恢复本组外观', exact: true }).click();
    await expect(field('图片缩放')).toHaveValue('cover');
    await expect(canvas('qa_image')).toHaveCSS('opacity', '0.8');
    await undo(); await expect(field('背景颜色颜色值')).toHaveValue('#11223380'); await expect(canvas('qa_image')).toHaveCSS('opacity', '0.8');
    await redo(); const saved = component(await save(), 'qa_image');
    assert.equal(saved.style?.imageFit, 'cover'); assert.equal(saved.style?.opacity, .8); assert.equal(saved.style?.background, undefined); assert.equal(saved.assetId, original.assetId);
    await inspector().getByRole('button', { name: '恢复控件不透明度 %', exact: true }).click();
    await expect(canvas('qa_image')).toHaveCSS('opacity', '1'); await expect(field('图片缩放')).toHaveValue('cover');
    await undo(); await expect(canvas('qa_image')).toHaveCSS('opacity', '0.8'); await redo();
    const resetOpacity = component(await save(), 'qa_image');
    assert.equal(resetOpacity.style?.opacity, undefined);
    assert.deepEqual({ ...resetOpacity, style: { ...resetOpacity.style, opacity: saved.style?.opacity } }, saved, 'Common opacity reset changes no functional appearance or content field.');
    for (const id of ['qa_panel', 'qa_progress']) {
      await select(id); await openGroup('appearance');
      await expect(inspector().getByRole('combobox', { name: '普通图片', exact: true })).toHaveCount(0);
      await expect(inspector().locator('[data-ui-design-field="font"]')).toHaveCount(0);
      await expect(inspector().locator('[data-ui-design-field="fontSize"]')).toHaveCount(0);
    }
  });

  await check('设置选项与输入入口完整，失效参数引用不假选音乐音量', async () => {
    await select('qa_choice'); await openGroup('content');
    await expect(field('玩家设置')).toHaveValue('skipAll');
    await openGroup('control-choice-options');
    await reveal(field('选项 1 文字')); await expect(field('选项 1 文字')).toHaveValue('只跳已读');
    await field('选项 1 文字').fill('仅跳过已读'); await field('选项 1 文字').press('Tab');
    await undo(); await expect(field('选项 1 文字')).toHaveValue('只跳已读');
    await redo();
    assert.equal(component(await save(), 'qa_choice').selector?.options[0].label, '仅跳过已读');
    await field('选项 1 文字').fill('只跳已读'); await field('选项 1 文字').press('Tab'); await save();
    await select('qa_input'); await openGroup('content');
    await expect(field('玩家设置')).toHaveValue('parameter:qa_text'); await expect(field('输入占位文字')).toHaveValue('请输入姓名');
    await expect(inspectorShell().locator('.ui-inspector-object > strong')).toHaveText('文字输入框');
    await field('玩家设置').selectOption('parameter:qa_option');
    await expect(inspectorShell().locator('.ui-inspector-object > strong')).toHaveText('选项组');
    await expect(field('输入占位文字')).toHaveCount(0);
    await expect(group('content')).toContainText('2 个选项');
    await undo(); await expect(field('玩家设置')).toHaveValue('parameter:qa_text');
    await expect(field('输入占位文字')).toHaveValue('请输入姓名'); await save();
    await select('qa_missing'); await openGroup('content');
    const original = await save();
    await expect(field('玩家设置')).toHaveValue('parameter:deleted_number');
    await expect(field('玩家设置').locator('option:checked')).toContainText('参数已删除');
    assert.equal(uiControlDefinition(original, component(original, 'qa_missing')), undefined);
    assert.equal(component(original, 'qa_missing').preference, undefined);
    await assertNoAuthoringChange(original); await screenshot('03-missing-binding');
  });

  await check('数值绑定切到文字或开关时原子清除不适用范围，一次撤销恢复', async () => {
    await select('qa_rebind'); await openGroup('content');
    const before = component(await save(), 'qa_rebind');
    for (const target of ['qa_text', 'qa_boolean']) {
      await field('玩家设置').selectOption('parameter:' + target);
      if (target === 'qa_text') await expect(field('输入占位文字')).toHaveValue('保留输入设置');
      else await expect(field('输入占位文字')).toHaveCount(0);
      await expect(field('控件范围下限')).toHaveCount(0);
      await undo();
      await openGroup('content'); await expect(field('玩家设置')).toHaveValue('parameter:qa_number');
      await reveal(field('控件范围下限')); await expect(field('控件范围下限')).toHaveValue('20');
      await expect(field('控件范围上限')).toHaveValue('80'); await expect(field('用户调整步长')).toHaveValue('10');
      await redo(); const saved = component(await save(), 'qa_rebind');
      assert.equal(saved.parameterId, target); assert.equal(saved.preference, undefined); assert.equal(saved.controlRange, undefined);
      assert.equal(saved.selector, undefined); assert.deepEqual(saved.style, before.style); assert.deepEqual(saved.input, before.input);
      // Saving intentionally ends the current UI undo history. Restore the
      // fixture through normal controls before checking the next source type.
      await field('玩家设置').selectOption('parameter:qa_number');
      const range = inspector().locator('.ui-control-range');
      if (await range.getAttribute('open') === null) await range.locator(':scope > summary').click();
      await number('控件范围下限', '20'); await number('控件范围上限', '80'); await number('用户调整步长', '10');
      await inspector().getByRole('button', { name: '应用整个控件范围', exact: true }).click();
      assert.deepEqual(component(await save(), 'qa_rebind'), before);
    }
  });

  await check('滑条内容与外观分开，范围草稿不因搜索丢失且整组提交', async () => {
    await select('qa_slider'); await openGroup('content'); await openGroup('appearance');
    await expect(group('content').getByLabel('玩家设置', { exact: true })).toBeVisible();
    await expect(group('content').getByLabel('滑块宽度', { exact: true })).toHaveCount(0);
    await openGroup('control-slider-size');
    await reveal(group('appearance').getByLabel('滑块宽度', { exact: true }));
    await expect(group('appearance').getByLabel('玩家设置', { exact: true })).toHaveCount(0);
    const range = inspector().locator('.ui-control-range');
    if (await range.getAttribute('open') === null) await range.locator(':scope > summary').click();
    const original = await save();
    await number('控件范围下限', '2');
    await expect(inspector().getByRole('button', { name: '应用整个控件范围', exact: true })).toBeDisabled();
    await assertNoAuthoringChange(original);
    await search().fill('位置');
    await expect(group('content')).toBeHidden();
    await inspectorShell().getByRole('button', { name: '清除属性搜索', exact: true }).click();
    await expect(field('控件范围下限')).toHaveValue('2');
    await number('控件范围下限', '0.2'); await number('控件范围上限', '0.8'); await number('用户调整步长', '0.1');
    await assertNoAuthoringChange(original);
    await inspector().getByRole('button', { name: '应用整个控件范围', exact: true }).click();
    await undo(); await expect(field('控件范围下限')).toHaveValue('0'); await expect(field('控件范围上限')).toHaveValue('1');
    await redo(); let saved = await save(); assert.deepEqual(component(saved, 'qa_slider').controlRange, { min: .2, max: .8, step: .1 });
    assert.deepEqual(saved.variables, original.variables); assert.deepEqual(saved.playerDefaults, original.playerDefaults);
    await inspector().getByRole('button', { name: '恢复绑定源范围', exact: true }).click(); saved = await save(); assert.equal(component(saved, 'qa_slider').controlRange, undefined);
    await screenshot('04-slider-sections');
  });

  await check('只有点击事件的按钮摘要对应实际逻辑', async () => {
    await select('qa_event_button'); await openGroup('interaction', false);
    const summary = await group('interaction').locator(':scope > summary').innerText();
    assert.match(summary, /事件|逻辑|点击/); assert.doesNotMatch(summary, /未绑定行为|未绑定点击/);
    await openGroup('interaction'); await expect(field('点击行为')).toHaveValue('');
    evidence.eventSummary = summary;
  });

  await check('显示条件先编辑草稿，应用与清除可撤销，快捷键使用统一键名', async () => {
    await select('qa_event_button'); await openGroup('visibility'); await openGroup('interaction-condition-visibleWhen');
    const original = await save();
    await inspector().getByRole('button', { name: '添加显示条件', exact: true }).click();
    await assertNoAuthoringChange(original);
    await inspector().getByRole('button', { name: '应用显示条件', exact: true }).click();
    await expect(group('interaction-condition-visibleWhen').locator(':scope > summary')).toContainText('可调整数值等于45');
    await undo(); await expect(inspector().getByRole('button', { name: '添加显示条件', exact: true })).toBeVisible();
    await redo(); await inspector().getByRole('button', { name: '清除显示条件', exact: true }).click();
    await undo(); await expect(group('interaction-condition-visibleWhen').locator(':scope > summary')).toContainText('可调整数值等于45');
    await redo(); assert.deepEqual(component(await save(), 'qa_event_button'), component(original, 'qa_event_button'));
    await openGroup('interaction'); await openGroup('interaction-shortcut');
    for (const key of ['K_a', 'K_9', 'K_F12', 'K_SPACE', 'K_RETURN', 'K_ESCAPE', 'K_UP']) await expect(field('按钮快捷键').locator(`option[value="${key}"]`)).toHaveCount(1);
    await field('按钮快捷键').selectOption('K_F12'); await undo(); await expect(field('按钮快捷键')).toHaveValue('');
    await redo(); assert.equal(component(await save(), 'qa_event_button').shortcut, 'K_F12');
    await field('按钮快捷键').selectOption(''); await save();
    await expect(group('interaction').locator(':scope > summary')).toContainText('点击 → 执行事件');
  });

  await check('属性右键与来源摘要一致，显式转换旧联动，换源与解除保留参数和自定义蓝图', async () => {
    await select('qa_text'); await openGroup('property-binding');
    const original = await save(), initialGraphs = projectGraphs(original);
    const beforeBindings = listUiParameterBindings(original, 'qa_text', 'ui:main');
    assert.equal(beforeBindings.find(item => item.graphId === legacyBindingGraph.id)?.managed, true);
    assert.equal(beforeBindings.find(item => item.graphId === customBindingGraph.id)?.managed, false);
    const references = group('property-binding').locator('.ui-property-control-references');
    if (await references.getAttribute('open') === null) await references.locator(':scope > summary').click();
    await expect(references).toContainText(legacyBindingGraph.name); await expect(references).toContainText(customBindingGraph.name);
    await assertNoAuthoringChange(original);

    const dialog = () => page!.getByRole('dialog', { name: '属性控制设置', exact: true });
    const row = () => group('property-binding').locator('[data-linked-property="visible"]');
    const openVisibleMenu = async () => {
      await openGroup('visibility'); await openGroup('interaction-condition-visibleWhen');
      const label = inspector().locator('[data-ui-property="visible"] .field-label');
      await label.click({ button: 'right' });
      await expect(page!.getByRole('menuitem', { name: '关联参数…', exact: true })).toBeVisible();
    };
    await openVisibleMenu(); await page!.getByRole('menuitem', { name: '关联参数…', exact: true }).click();
    await expect(dialog().getByLabel('控制方式', { exact: true })).toHaveValue('default');
    await dialog().getByRole('button', { name: '取消', exact: true }).click();
    await assertNoAuthoringChange(original); assert.deepEqual(projectGraphs(await read()), initialGraphs);
    await openVisibleMenu(); await page!.getByRole('menuitem', { name: '关联参数…', exact: true }).click();
    await dialog().getByLabel('控制方式', { exact: true }).selectOption('follow');
    await dialog().getByLabel('来源参数', { exact: true }).selectOption('qa_boolean');
    await dialog().getByRole('button', { name: '应用设置', exact: true }).click();
    await expect(dialog()).toHaveCount(0); await openGroup('property-binding'); await expect(row()).toContainText('跟随：显示提示');
    await expect(references).not.toContainText(legacyBindingGraph.name); await expect(references).toContainText(customBindingGraph.name);
    // Saving accepts the UI draft and clears its undo history. Exercise both
    // directions first; the disabled Save button after undo proves the whole
    // draft (including both old graphs) equals the saved baseline again.
    await undo(); await expect(row()).toHaveCount(0);
    await expect(references).toContainText(legacyBindingGraph.name); await expect(references).toContainText(customBindingGraph.name);
    await assertNoAuthoringChange(original);
    assert.deepEqual(projectGraphs(await read()), initialGraphs, 'Undo restores the exact original legacy graph and removes the new source without rewriting the saved project.');
    await redo(); await expect(row()).toContainText('跟随：显示提示');
    const created = await save(), retainedGraphs = initialGraphs.filter(item => item.id !== legacyBindingGraph.id);
    assert.deepEqual(projectGraphs(created), retainedGraphs, 'Only explicitly replaced independent legacy links are removed.');
    assert.deepEqual(component(created, 'qa_text'), { ...component(original, 'qa_text'), propertyControls: { visible: { mode: 'follow', parameterId: 'qa_boolean' } } });
    assert.deepEqual(created.variables, original.variables);
    await row().getByRole('button', { name: '编辑显示控制', exact: true }).click();
    await dialog().getByLabel('控制方式', { exact: true }).selectOption('sync');
    await dialog().getByLabel('来源参数', { exact: true }).selectOption('qa_link_visible');
    await dialog().getByRole('button', { name: '应用设置', exact: true }).click();
    await expect(row()).toContainText('同步：备用显示开关');
    await undo(); await expect(row()).toContainText('跟随：显示提示');
    await redo(); const replaced = await save();
    assert.deepEqual(component(replaced, 'qa_text').propertyControls?.visible, { mode: 'sync', parameterId: 'qa_link_visible' });
    assert.deepEqual(projectGraphs(replaced), retainedGraphs); assert.deepEqual(replaced.variables, original.variables);
    await openVisibleMenu(); await page!.getByRole('menuitem', { name: '默认设置', exact: true }).click();
    await openGroup('property-binding'); await expect(row()).toHaveCount(0);
    await undo(); await expect(row()).toContainText('同步：备用显示开关');
    await redo(); const detached = await save();
    assert.deepEqual(projectGraphs(detached), retainedGraphs); assert.deepEqual(detached.variables, original.variables);
    assert.deepEqual(detached.ui, original.ui);
    evidence.parameterLink = { convertedGraphId: legacyBindingGraph.id, preservedCustomGraphId: customBindingGraph.id, from: 'qa_boolean', to: 'qa_link_visible', modes: ['follow', 'sync', 'default'], detached: true };
  });

  await check('父容器排列说明保留真实附加偏移，查询布局不改变现有几何', async () => {
    await select('qa_panel_child'); await openGroup('layout');
    const original = await save(), before = await canvas('qa_panel_child').boundingBox();
    await expect(inspector()).toContainText('排列中的附加偏移');
    await expect(field('横向附加偏移 %')).toHaveValue('3');
    await expect(field('纵向附加偏移 %')).toHaveValue('4');
    await openGroup('layout-transform');
    await expect(inspector().locator('[data-ui-layout-property="anchorX"]')).toBeVisible();
    await search().fill('轴心');
    await expect(group('layout')).toHaveJSProperty('open', true);
    await expect(inspector().locator('[data-ui-layout-property="pivotX"]')).toBeVisible();
    await inspectorShell().getByRole('button', { name: '清除属性搜索', exact: true }).click();
    const after = await canvas('qa_panel_child').boundingBox(); assert.deepEqual(after, before);
    await assertNoAuthoringChange(original);
    await select('qa_panel'); await openGroup('children'); await openGroup('layout-children');
    await expect(inspector().locator('[data-ui-layout-property="layoutFlow"] select')).toHaveValue('horizontal');
    await expect(inspector().locator('[data-ui-layout-property="childGap"] input')).toHaveValue('8');
    evidence.parentLayout = { before, after };
  });

  await check('存档显示开关覆盖自定义文字，部件编辑和单次撤销范围准确', async () => {
    await select('qa_save');
    await page!.getByRole('button', { name: '画布预览', exact: true }).click();
    await page!.getByLabel('存档预览内容', { exact: true }).selectOption('filled');
    await page!.getByRole('button', { name: '关闭画布预览', exact: true }).click();
    await openGroup('content');
    const text = fixture.project.nodes.flatMap(node => node.kind === 'passage' ? node.lines.map(line => line.text) : [])[0];
    await expect(canvas('qa_save')).toContainText(text); await expect(canvas('qa_save')).toContainText('验收章节');
    const before = component(await save(), 'qa_save');
    await field('显示条目文字').uncheck();
    await expect(canvas('qa_save')).not.toContainText(text); await expect(canvas('qa_save')).not.toContainText('验收章节');
    await undo(); await expect(field('显示条目文字')).toBeChecked(); await expect(canvas('qa_save')).toContainText(text);
    assert.deepEqual(component(await save(), 'qa_save'), before);
    await doubleClickCanvasPart('qa_save', 'caption');
    await expect(inspectorShell().locator('.ui-inspector-part-scope')).toContainText('每个存档格');
    await number('对白摘要字号', '31');
    await undo(); await expect(field('对白摘要字号')).toHaveValue('23');
    await redo(); await expect(field('对白摘要字号')).toHaveValue('31');
    await inspector().getByRole('button', { name: '恢复对白摘要字号', exact: true }).click();
    await expect(field('对白摘要字号')).toHaveValue('23');
    await undo(); await expect(field('对白摘要字号')).toHaveValue('31');
    await enterPart('thumbnail');
    const thumbnail = canvas('qa_save').locator('[data-collection-part="thumbnail"]').first();
    const geometryBefore = await thumbnail.boundingBox(); assert.ok(geometryBefore);
    await field('自定义缩略图位置').check();
    const geometryAfter = await thumbnail.boundingBox(); assert.ok(geometryAfter);
    for (const axis of ['x', 'y', 'width', 'height'] as const) assert.ok(Math.abs(geometryAfter[axis] - geometryBefore[axis]) < 1.5, `Enabling custom thumbnail ${axis} should preserve its visible position.`);
    await undo(); await expect(field('自定义缩略图位置')).not.toBeChecked();
    const saved = component(await save(), 'qa_save');
    assert.equal(saved.list?.thumbnail, undefined); assert.equal(saved.list?.textStyles?.caption?.fontSize, 31);
    assert.deepEqual({ ...saved.list, textStyles: undefined }, { ...before.list, textStyles: undefined }, 'Editing the caption must not rewrite unrelated template parts.');
    assert.equal(saved.list?.summaryFontSize, 23, 'The legacy caption size is preserved as the inherited value.');
    await enterPart('caption');
    evidence.saveThumbnailGeometry = { before: geometryBefore, after: geometryAfter };
    evidence.saveCaption = saved.list; await screenshot('05-save-caption-part');
    await returnRoot();
  });

  await check('历史滚动条有默认及自定义入口，取消后真正恢复默认', async () => {
    await select('qa_history'); await openGroup('collection-layout'); await openGroup('appearance');
    await expect(group('collection-layout').getByLabel('每页行数', { exact: true })).toHaveCount(0);
    await doubleClickCanvasPart('qa_history', 'historyText');
    await expect(field('对白正文字号')).toBeVisible();
    await enterPart('historyScrollbar');
    await expect(field('历史滚动条样式')).toHaveValue('default');
    const before = component(await save(), 'qa_history');
    await field('历史滚动条样式').selectOption('custom');
    await expect(field('自定义滚动条位置')).toHaveCount(0);
    await expect(field('滚动条横向 %')).toBeVisible();
    await expect(canvas('qa_history').locator('[data-history-viewport]')).toHaveCSS('scrollbar-width', 'none');
    // The mode selector is the sole custom/default switch in the part layout.
    await field('历史滚动条样式').selectOption('default');
    await expect(field('历史滚动条样式')).toHaveValue('default');
    await expect(canvas('qa_history').locator('[data-history-viewport]')).not.toHaveCSS('scrollbar-width', 'none');
    await undo(); await expect(field('历史滚动条样式')).toHaveValue('custom');
    await redo(); const saved = component(await save(), 'qa_history'); assert.equal(saved.list?.historyScrollbar, undefined);
    assert.deepEqual(saved.list, before.list);
    await screenshot('06-history-default-scrollbar');
    await returnRoot();
  });

  await check('图鉴默认两行与预览一致，独立内容管理可编辑并撤销', async () => {
    await select('qa_gallery'); await openGroup('content'); await openGroup('collection-layout');
    await expect(field('每页行数')).toHaveValue('2');
    await expect(inspector()).not.toContainText('每页行数为 0 时');
    let original = await save(); assert.equal(component(original, 'qa_gallery').list?.rows, undefined);
    assert.equal(galleryLayout(original, component(original, 'qa_gallery')).cells.length, 6);
    await expect(canvas('qa_gallery').locator('[data-gallery-group]')).toHaveCount(6);
    await number('每页行数', '3');
    await expect(canvas('qa_gallery').locator('[data-gallery-group]')).toHaveCount(7);
    await undo(); await save(); await expect(field('每页行数')).toHaveValue('2');
    original = await save();
    await inspector().getByRole('button', { name: '管理图鉴内容', exact: true }).click();
    const dialog = page!.getByRole('dialog', { name: '管理图鉴内容', exact: true }); await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '关闭内容管理', exact: true }).click();
    await assertNoAuthoringChange(original);
    await inspector().getByRole('button', { name: '管理图鉴内容', exact: true }).click();
    await dialog.getByLabel('启用图鉴分组', { exact: true }).check();
    const originalName = await dialog.getByLabel('分组名称', { exact: true }).inputValue();
    await dialog.getByLabel('分组名称', { exact: true }).fill('内容管理验收组'); await dialog.getByLabel('分组名称', { exact: true }).press('Tab');
    await screenshot('07-gallery-content-manager');
    await dialog.getByRole('button', { name: '关闭内容管理', exact: true }).click();
    await undo();
    await inspector().getByRole('button', { name: '管理图鉴内容', exact: true }).click();
    await expect(dialog.getByLabel('分组名称', { exact: true })).toHaveValue(originalName);
    await dialog.getByRole('button', { name: '关闭内容管理', exact: true }).click();
    await redo(); assert.equal(component(await save(), 'qa_gallery').list?.galleryGroups?.[0].name, '内容管理验收组');
    await inspector().getByRole('button', { name: '管理图鉴内容', exact: true }).click();
    await dialog.getByLabel('启用图鉴分组', { exact: true }).uncheck();
    await dialog.getByRole('button', { name: '关闭内容管理', exact: true }).click();
    assert.equal(component(await save(), 'qa_gallery').list?.galleryGroups, undefined);
  });

  await check('23类控件属性入口可达，特殊控件保留专用编辑', async () => {
    const inventory: unknown[] = [];
    assert.equal(new Set(fixture.representatives.map(item => item.kind)).size, 23);
    for (const item of fixture.representatives) {
      await select(item.id);
      await expect(search()).toBeVisible();
      await expect(inspector().locator('[data-ui-inspector-region="common"] [data-ui-inspector-group="children"]')).toHaveCount(1);
      await expect(inspector().locator('[data-ui-inspector-region="function"] [data-ui-inspector-group="children"]')).toHaveCount(0);
      if (item.kind === 'flowchart') {
        for (const id of ['flow-mode', 'flow-content', 'flow-style', 'flow-layout', 'flow-browsing', 'flow-player', 'flow-sources-entry']) await expect(group(id)).toHaveCount(1);
        await expect(inspector()).not.toContainText('共享样式');
      } else {
        for (const id of rootGroups) await expect(group(id)).toHaveCount(1);
      }
      const layout = await assertFits();
      const groups = await inspector().locator('[data-ui-inspector-group]').evaluateAll(elements => elements.map(element => ({
        id: element.getAttribute('data-ui-inspector-group'), open: (element as HTMLDetailsElement).open, title: element.querySelector(':scope > summary')?.textContent,
      })));
      inventory.push({ id: item.id, kind: item.kind, groups, layout });
    }
    evidence.inventory = inventory;
  });

  await check('220、280、360像素属性栏在明暗主题均无横向溢出', async () => {
    const layouts: unknown[] = [];
    for (const theme of ['黑白', '亮白']) {
      await page!.getByRole('button', { name: '作品设置', exact: true }).click();
      await page!.getByRole('button', { name: '编辑器外观', exact: true }).click();
      await page!.getByRole('group', { name: '编辑器配色', exact: true }).getByRole('button', { name: new RegExp('^' + theme) }).click();
      await page!.getByRole('button', { name: '关闭作品设置', exact: true }).click();
      for (const width of [220, 280, 360]) {
        const bounds = await page!.locator('[data-dock-panel="inspector"]').boundingBox();
        const divider = await page!.getByRole('separator', { name: '调整右侧面板宽度', exact: true }).boundingBox();
        assert.ok(bounds && divider);
        const x = divider.x + divider.width / 2, y = divider.y + Math.min(100, divider.height / 2);
        await page!.mouse.move(x, y); await page!.mouse.down(); await page!.mouse.move(x + bounds.width - width, y, { steps: 4 }); await page!.mouse.up();
        await settle();
        const actual = await page!.locator('[data-dock-panel="inspector"]').boundingBox();
        assert.ok(actual && Math.abs(actual.width - width) <= 8, `Cannot exercise requested ${width}px panel: ${actual?.width}`);
        for (const id of ['qa_button_a', 'qa_slider', 'qa_save']) {
          await select(id); await openGroup('layout'); await openGroup('appearance');
          if (id === 'qa_button_a') await state().selectOption('hover');
          if (id === 'qa_save') await enterPart('caption');
          layouts.push({ theme, requestedWidth: width, id, layout: await assertFits(), contrast: await textContrast() });
          if (id === 'qa_save') await returnRoot();
        }
        await screenshot(`08-${theme === '亮白' ? 'light' : 'dark'}-${width}`);
      }
    }
    evidence.responsive = layouts;
  });

  await check('保存重开保留部件、适配与绑定，UI操作没有意外覆盖其他控件', async () => {
    const before = await save(); await close(); await launch();
    const after = await read(); assert.deepEqual(after.ui, before.ui); assert.deepEqual(after.variables, before.variables);
    await select('qa_save'); await enterPart('caption');
    await expect(field('对白摘要字号')).toHaveValue('31');
    await returnRoot();
    await select('qa_image'); await openGroup('content'); await expect(field('图片缩放')).toHaveValue('cover');
    await select('qa_missing'); await openGroup('content'); await expect(field('玩家设置')).toHaveValue('parameter:deleted_number');
    await select('qa_rebind'); await openGroup('content'); await expect(field('玩家设置')).toHaveValue('parameter:qa_number');
    assert.deepEqual(component(after, 'qa_rebind').controlRange, { min: 20, max: 80, step: 10 });
    await select('qa_button_a'); await openGroup('appearance'); await state().selectOption('hover');
    assert.equal(component(after, 'qa_button_a').style?.hoverBackground, undefined); assert.equal(component(after, 'qa_button_a').style?.background, '#aa3311');
    await screenshot('09-reopened');
    evidence.finalSavedUiSha256 = sha256(JSON.stringify(after.ui));
  });
  assert.deepEqual(errors, [], 'Renderer must not raise runtime errors.');
  report.status = 'passed';
} catch (error) {
  failure = error; report.status = 'failed'; report.phase = phase; report.error = String(error);
  if (app && page && !page.isClosed()) await screenshot('failure').catch(capture => { report.captureError = String(capture); });
} finally {
  try { await close(); }
  catch (error) { report.status = 'failed'; report.closeError = String(error); failure ??= error; }
  try {
    const after = sha256(await fs.readFile(sourceFile)); report.sourceSha256After = after;
    if (sourceHash !== undefined) assert.equal(after, sourceHash, 'Author project was changed during isolated acceptance.');
  } catch (error) { report.status = 'failed'; report.sourceProtectionError = String(error); failure ??= error; }
  try {
    // The shared cleanup helper resolves every target and rejects traversal or
    // junctions outside this run before removing either temporary directory.
    if (app || processes.some(record => !record.exited)) throw new Error('Owned fixture process remains alive; temporary directories were retained.');
    report.cleanup = await cleanVerificationDirectories(output, ['project', 'profile']);
    assert.deepEqual((report.cleanup as { errors: unknown[] }).errors, []);
  } catch (error) { report.status = 'failed'; report.cleanupError = String(error); failure ??= error; }
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(output);
}
if (failure) throw failure;
