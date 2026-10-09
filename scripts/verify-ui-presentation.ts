import { openStoryMode } from './lib/story-workspace';
import { chromium, expect, type Page } from '@playwright/test';
import { createServer } from 'vite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectSchema, type Project } from '../src/core/model';
import type { StudioBridge } from '../src/core/bridge';
import { compileProject } from '../src/runtime/compiler';

declare global { interface Window { __presentation: { snapshot?: () => { project: Project; dirty: boolean }; saved?: Project } } }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'artifacts/ui-presentation-verification', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const initial = projectSchema.parse(JSON.parse(await fs.readFile(path.join(root, 'resources/templates/aihong/project.vns.json'), 'utf8')));
const dialogue = initial.ui.components.find(c => c.page === 'say' && c.binding === 'dialogue')!;
initial.ui.components.push({ id: 'test_cover', page: 'say', kind: 'panel', text: '遮挡面板', x: dialogue.x, y: dialogue.y, width: dialogue.width, height: dialogue.height, layer: 999, style: { background: '#293946', opacity: 0.15 } });
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/resources/**', '**/release/**'] } } });
await server.listen(); const address = server.httpServer!.address(); if (!address || typeof address === 'string') throw new Error('No test server');
const browser = await chromium.launch(process.env.VNS_BROWSER_PATH ? { executablePath: process.env.VNS_BROWSER_PATH, headless: true } : { channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();
const errors: string[] = [], checks: string[] = [];
page.on('pageerror', error => errors.push(error.message));
page.on('dialog', dialog => dialog.accept());
await page.addInitScript((initial: Project) => {
  Object.defineProperty(window, '__name', { value: new Function('target', 'return target'), configurable: true });
  const harness: Window['__presentation'] = {}; window.__presentation = harness;
  const bridge: StudioBridge = {
    getInitial: async () => ({ project: JSON.parse(localStorage.getItem('presentation-test-project') ?? JSON.stringify(initial)), path: 'verification/project.vns.json', recovered: false }),
    create: async name => ({ project: { ...initial, name }, path: null, recovered: false }), open: async () => null,
    save: async project => { harness.saved = structuredClone(project); localStorage.setItem('presentation-test-project', JSON.stringify(project)); return { project, path: 'verification/project.vns.json', recovered: false }; },
    autosave: async () => ({ savedAt: Date.now() }), importAssets: async () => null, importText: async () => null,
    preview: async () => ({ ok: true, diagnostics: [], log: '' }), exportGame: async () => null,
    checkExport: async project => ({ platform: project.exportSettings?.platform ?? 'windows', ready: true, checks: [], diagnostics: [] }),
    assetUrl: relative => `/resources/templates/aihong/${relative}`, environment: async () => ({ sdkPath: null, appVersion: 'workbench-test' }),
    onRuntimeEvent: () => () => undefined, onCloseRequested: snapshot => { harness.snapshot = snapshot; return () => undefined; },
  }; window.studio = bridge;
}, initial);
const snapshot = () => page.evaluate(() => window.__presentation.snapshot!().project);
const row = (id: string) => page.locator(`[data-hierarchy-id="${id}"]`);
const widget = (id: string) => page.locator(`[data-component-id="${id}"]`);
async function uiPage(name: string) {
  await page.getByRole('button', { name: '界面', exact: true }).click();
  await page.locator('.ui-toolbar').getByRole('button', { name, exact: true }).click();
}
try {
  await page.goto(`http://127.0.0.1:${address.port}`);
  await expect(page.locator('.project-title strong')).toHaveText(initial.name);
  await uiPage('对话');
  await expect(page.locator('.sidebar')).not.toBeVisible();
  await expect(page.locator('.app-header .view-tabs').getByRole('button', { name: '界面', exact: true })).toHaveClass(/active/);
  await expect(page.getByRole('button', { name: '展开剧情目录', exact: true })).toHaveCount(0);
  await expect(page.locator('.view-tabs .tabs button')).toHaveText(['剧本', '蓝图', '界面', '素材', '角色', '状态']);
  await openStoryMode(page, 'text');
  await expect(page.locator('.sidebar')).toBeVisible();
  await uiPage('对话');
  await expect(page.locator('.sidebar')).not.toBeVisible();
  checks.push('界面工作区显示层级、画布和属性；资源页与各编辑页同排，剧情目录只出现在剧本和文本内。');
  await expect(page.getByRole('complementary', { name: '控件层级' })).toBeVisible();
  await row(dialogue.id).click();
  await expect(widget(dialogue.id)).toHaveClass(/selected/);
  await expect(page.getByLabel('控件名称', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '新建界面实例', exact: true }).click();
  await row(dialogue.id).click();
  await row(dialogue.id).press('F2');
  await page.locator('.ui-hierarchy').getByLabel('控件名称', { exact: true }).fill('对白正文 · 测试');
  await page.locator('.ui-hierarchy').getByLabel('控件名称', { exact: true }).press('Enter');
  await expect(row(dialogue.id)).toContainText('覆盖');
  let project = await snapshot();
  expect(project.ui.components.find(c => c.id === dialogue.id)?.name).toBeUndefined();
  expect(project.ui.instances?.at(-1)?.components.find(c => c.id === dialogue.id)?.name).toBe('对白正文 · 测试');
  await page.getByLabel('搜索控件', { exact: true }).fill('对白正文');
  await expect(page.locator('.ui-hierarchy-row')).toHaveCount(1);
  await page.getByLabel('搜索控件', { exact: true }).fill('');
  await row(dialogue.id).getByRole('button', { name: /在画布隐藏/ }).click();
  await expect(widget(dialogue.id)).toHaveCount(0);
  project = await snapshot();
  const compiled = compileProject(project);
  expect(compiled.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
  expect(compiled.files['game/screens.rpy']).toContain(`id "vn_component_${dialogue.id}"`);
  checks.push('层级搜索可选中被遮挡的控件；重命名和隐藏继承控件只创建本地覆盖，游戏控件仍保留。');

  await row('test_cover').click();
  await row('test_cover').getByRole('button', { name: /^锁定/ }).click();
  await expect(widget('test_cover')).toHaveCSS('pointer-events', 'none');
  await page.getByRole('button', { name: '在列表中下移', exact: true }).click();
  project = await snapshot();
  const covered = project.ui.instances?.at(-1)?.components.find(c => c.id === 'test_cover')!;
  expect(covered.editor?.locked).toBe(true); expect(covered.layer).toBe(999); expect(covered.editor?.listOrder).toBeDefined();
  expect(project.ui.instances?.at(-1)?.components.length).toBe(2);
  await row('test_cover').getByRole('button', { name: /^在画布隐藏/ }).click();
  const picture = initial.ui.components.find(c => c.page === 'say' && c.kind === 'image')!;
  // Both rows must be visible before pressing the mouse. Scrolling the drop
  // target after mouse-down moves a different row under Chromium's drag origin.
  await row(picture.id).scrollIntoViewIfNeeded();
  await row(dialogue.id).dragTo(row(picture.id));
  await expect.poll(async () => { const order = await page.locator('.ui-hierarchy-row').evaluateAll(rows => rows.map(row => row.getAttribute('data-hierarchy-id'))); return order.indexOf(dialogue.id) > order.indexOf(picture.id); }).toBe(true);
  expect((await snapshot()).ui.instances?.at(-1)?.components.length).toBe(2);
  await page.screenshot({ path: path.join(output, 'hierarchy.png') });
  checks.push('锁定控件不拦截画布点击；组件列表可排序且保留显示层级。');

  const replacement = initial.assets.find(a => a.kind === 'image' && a.width && a.width > 900 && a.id !== picture.assetId)!;
  await row(picture.id).click();
  const prior = await page.getByLabel('图片素材', { exact: true }).inputValue();
  await page.getByRole('button', { name: '浏览图片素材', exact: true }).click();
  await page.getByLabel('可选素材分类').selectOption('all');
  await expect(page.getByRole('dialog', { name: '图片素材资源浏览器' })).toBeVisible();
  await expect.poll(() => page.locator('.asset-picker-card-image img').evaluateAll(images => images.filter(i => (i as HTMLImageElement).naturalWidth > 0).length)).toBeGreaterThan(3);
  await page.screenshot({ path: path.join(output, 'asset-browser.png') });
  await page.getByLabel('搜索可选资源').fill(replacement.name);
  await page.getByRole('button', { name: `预览资源 ${replacement.name}`, exact: true }).click();
  await expect(page.locator('.asset-picker-detail > strong')).toHaveText(replacement.name);
  await expect(page.getByLabel('图片素材', { exact: true })).toHaveValue(prior);
  await page.getByRole('button', { name: `预览资源 ${replacement.name}`, exact: true }).dblclick();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('图片素材', { exact: true })).toHaveValue(replacement.id);
  await page.getByLabel('图片素材', { exact: true }).selectOption(prior);
  await page.getByRole('button', { name: '浏览图片素材', exact: true }).click();
  await page.getByLabel('搜索可选资源').press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('图片素材', { exact: true })).toHaveValue(prior);
  checks.push('资源浏览器显示真实缩略图与尺寸；搜索、单击大图、双击使用和 Escape 取消均通过。');

  await openStoryMode(page, 'text');
  const openingLine = initial.nodes.find(n => n.id === 'opening');
  if (openingLine?.kind !== 'passage') throw new Error('No opening');
  const sourceInput = page.getByLabel('中文文本剧本', { exact: true });
  await sourceInput.evaluate((element, text) => { const input = element as HTMLTextAreaElement; const offset = input.value.indexOf(text); input.focus(); input.setSelectionRange(offset, offset); }, openingLine.lines[0].text);
  await sourceInput.press('ArrowRight');
  const stage = page.locator('.text-stage');
  const previewText = page.locator(`[data-preview-component-id="${dialogue.id}"]`);
  await expect(previewText).toBeVisible();
  const opening = initial.nodes.find(n => n.id === 'opening');
  if (opening?.kind !== 'passage') throw new Error('No opening');
  await expect(previewText).toContainText(opening.lines[0].text);
  await expect(page.getByLabel('试听音乐：花街柳巷')).toHaveAttribute('src', /ai_story_music_wine.ogg/);
  await expect(page.locator('.ui-dialogue-preview .ui-skin-image').first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const layout = await previewText.evaluate(element => { const r = element.getBoundingClientRect(), outer = element.closest('.text-stage')!.getBoundingClientRect(), style = getComputedStyle(element); return { x: (r.x - outer.x) / outer.width, y: (r.y - outer.y) / outer.height, width: r.width / outer.width, font: style.fontFamily, size: parseFloat(style.fontSize) / outer.width }; });
  expect(layout.x).toBeCloseTo(dialogue.x, 3); expect(layout.y).toBeCloseTo(dialogue.y, 3); expect(layout.width).toBeCloseTo(dialogue.width, 3);
  expect(layout.font).toContain('vns_'); expect(layout.size).toBeCloseTo((dialogue.style?.fontSize ?? initial.ui.fontSize) / initial.width, 4);
  await stage.screenshot({ path: path.join(output, 'text-dialogue.png') });
  await expect(stage.locator('.text-stage-background')).toHaveAttribute('src', /ai_story_banquet.png/);
  checks.push('文本预览读取自定义对话皮肤、字体、位置和等待图标，设计隐藏不会影响预览；蓝图 BGM 可试听。');

  await uiPage('章节标题');
  await page.getByRole('button', { name: '播放进场', exact: true }).click();
  await expect(page.getByLabel('章节进场预览', { exact: true })).toHaveClass(/effect-ink/);
  await page.waitForTimeout(450);
  await page.locator('.ui-canvas').screenshot({ path: path.join(output, 'chapter-reveal.png') });
  await page.waitForTimeout(950);
  await page.locator('.ui-canvas').screenshot({ path: path.join(output, 'chapter-preview.png') });
  await expect(page.getByLabel('章节进场预览', { exact: true })).toHaveCount(0, { timeout: 6000 });
  await page.getByLabel('预览章节', { exact: true }).selectOption('ai_title_two');
  await expect(page.locator('.ui-canvas .ui-chapter-text img')).toHaveAttribute('src', /ai_presentation_title_two.png/);
  await expect(page.locator('.chapter-backdrop-card').first()).toHaveCSS('mask-image', /ai_presentation_mask.png/);
  await page.locator('.ui-canvas').screenshot({ path: path.join(output, 'chapter-two-design.png') });
  checks.push('两章可切换，章节进场预览会播放并回到设计状态。');
  for (const viewport of [{ width: 1366, height: 768 }, { width: 1100, height: 740 }]) {
    await page.setViewportSize(viewport);
    await expect(page.locator('.sidebar')).not.toBeVisible();
    await expect.poll(async () => (await page.locator('.ui-canvas').boundingBox())!.width).toBeGreaterThan(450);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(output, `layout-${viewport.width}.png`) });
  }
  checks.push('1366 和 1100 宽度下控件层级与画布可用，页面没有整体横向溢出。');
  expect(errors).toEqual([]);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, errors }, null, 2));
  console.log(`PASS: ${checks.length} authoring checks. ${output}`);
} catch (error) {
  await fs.writeFile(path.join(output, 'failure-project.json'), JSON.stringify(await snapshot(), null, 2)).catch(() => undefined);
  await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => undefined);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', checks, errors, error: String(error) }, null, 2));
  console.error(error); console.log(output); process.exitCode = 1;
} finally { await browser.close(); await server.close(); }
