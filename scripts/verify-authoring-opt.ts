import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { createServer } from 'vite';
import { PNG } from 'pngjs';
import { createProject, projectSchema, type UiComponent } from '../src/core/model';
import { createBlueprintGraph } from '../src/core/blueprint';
import { projectToText } from '../src/core/text-script';
import { currentScriptText } from '../src/core/script-text';
import type { RuntimeEvent } from '../src/core/bridge';
import { enterFixtureProject, installedExecutable, launchDesktopFixture } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';

const root = path.resolve('.'), output = path.join(root, 'artifacts/authoring-opt-20261009', new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 6));
const projectFile = path.join(output, 'project/project.vns.json');
await fs.mkdir(path.dirname(projectFile), { recursive: true });
const project = createProject('统一资源与试玩验收'); project.width = 1280; project.height = 720;
const button = (id: string, page: UiComponent['page'], text: string, x: number, y: number, action: UiComponent['action'], extra: Partial<UiComponent> = {}): UiComponent => ({ id, name: text, kind: 'button', page, text, action, x, y, width: .5, height: .14, style: { fontSize: 28, background: '#256a86', textColor: '#ffffff' }, ...extra });
project.ui.pages = { ...project.ui.pages, main: { layout: 'custom', background: '#132738' }, preferences: { layout: 'custom', background: '#20322f' } };
project.ui.components = [button('qa_preferences', 'main', '打开设置', .25, .4, 'preferences'), button('qa_enable', 'preferences', '开启语音延续', .1, .3, 'setPlayerPreference', { width: .38, preference: 'voiceSustain', preferenceValue: true }), button('qa_disable', 'preferences', '关闭语音延续', .52, .3, 'setPlayerPreference', { width: .38, preference: 'voiceSustain', preferenceValue: false }), button('qa_return', 'preferences', '返回标题', .25, .65, 'return')];
project.ui.customPages = [{ id: 'qa_overlay', name: '覆盖弹窗验收', modal: true, background: '#24323b', components: [button('qa_overlay_control', 'custom', '覆盖画布控件', 0, 0, 'return', { width: 1, height: 1, layer: 30 })] }];
project.variables = [{ id: 'qa_score', name: '验收数值', type: 'number', initial: 42, persistent: false, parameterSetId: 'qa_set' }];
project.parameterSets = [{ id: 'qa_set', name: '验收参数集', kind: 'story' }];
const passage = project.nodes.find(node => node.kind === 'passage')!; passage.lines[0].text = '自动保存前';
const graph = createBlueprintGraph('effect', '验收蓝图'); graph.id = 'qa_graph'; project.blueprints = [graph];
await fs.mkdir(path.join(path.dirname(projectFile), 'assets'), { recursive: true });
const png = new PNG({ width: 16, height: 9 }); png.data.fill(255);
await fs.writeFile(path.join(path.dirname(projectFile), 'assets/image.png'), PNG.sync.write(png));
for (const [name, width, height] of [['portrait', 9, 24], ['panorama', 64, 9]] as const) {
  const image = new PNG({ width, height });
  for (let offset = 0; offset < image.data.length; offset += 4) { image.data[offset] = 82; image.data[offset + 1] = 143; image.data[offset + 2] = 188; image.data[offset + 3] = 160; }
  await fs.writeFile(path.join(path.dirname(projectFile), `assets/${name}.png`), PNG.sync.write(image));
}
const wav = Buffer.alloc(44 + 22050 * 2); wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(22050, 24); wav.writeUInt32LE(44100, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
await fs.writeFile(path.join(path.dirname(projectFile), 'assets/audio.wav'), wav);
await fs.mkdir(path.join(path.dirname(projectFile), 'scripts'), { recursive: true });
await fs.writeFile(path.join(path.dirname(projectFile), 'scripts/observe.rpy'), `init 1001 python:
    import json as qa_json
    qa_last_state = None
    qa_state_number = 0
    def qa_observe_menu():
        global qa_last_state, qa_state_number
        state = dict(main=renpy.get_screen("main_menu") is not None, preferences=renpy.get_screen("preferences") is not None, voiceSustain=vn_preference_get("voiceSustain"))
        if state != qa_last_state:
            qa_last_state = state
            qa_state_number += 1
            print("VNS_QA_STATE:" + qa_json.dumps(state), flush=True)
            renpy.screenshot(renpy.config.basedir + "/qa-menu-" + str(qa_state_number) + ".png")
    config.periodic_callbacks.append(qa_observe_menu)
`);
project.assets = [{ id: 'qa_image', name: '验收图片', kind: 'image', path: 'assets/image.png' }, { id: 'qa_audio', name: '验收音频', kind: 'audio', path: 'assets/audio.wav' }, { id: 'qa_observe', name: '菜单验收探针', kind: 'script', path: 'scripts/observe.rpy' }, { id: 'qa_portrait', name: '竖幅透明图片与很长的资源名称不会改变卡片尺寸', kind: 'image', path: 'assets/portrait.png' }, { id: 'qa_panorama', name: '宽幅透明图片', kind: 'image', path: 'assets/panorama.png' }];
project.contentBrowser = { folders: [{ id: 'qa_mixed', name: '验收混合资源' }, { id: 'qa_nested', name: '深层文件夹', parentId: 'qa_mixed' }], assignments: { 'asset:qa_image': 'qa_mixed', 'asset:qa_portrait': 'qa_mixed', 'asset:qa_panorama': 'qa_mixed', 'asset:qa_audio': 'qa_nested', 'blueprint:qa_graph': 'qa_nested' }, favorites: [] };
project.scriptText = currentScriptText(projectToText(project));
await fs.writeFile(projectFile, JSON.stringify(projectSchema.parse(project), null, 2));
const server = installedExecutable ? undefined : await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/resources/**', '**/release/**', '**/work/**'] } } });
await server?.listen();
let app: ElectronApplication | undefined, page: Page | undefined, phase = 'launch';
const checks: string[] = [], errors: string[] = [], nativeEvidence: unknown[] = [], layoutEvidence: unknown[] = [];
const measureCards = (browser: Locator) => browser.locator('.content-items [data-content-key]').evaluateAll(elements => elements.map(element => {
  const [card, thumbnail, name, glyph] = [element, element.querySelector('.content-thumbnail'), element.querySelector('strong'), element.querySelector('.content-type-icon')].map(target => target ? { width: target.getBoundingClientRect().width, height: target.getBoundingClientRect().height } : undefined);
  const image = element.querySelector<HTMLImageElement>('.content-thumbnail img');
  return { key: (element as HTMLElement).dataset.contentKey, card: card!, thumbnail: thumbnail!, name: name!, glyph, image: image ? { loaded: image.complete && image.naturalWidth > 0, fit: getComputedStyle(image).objectFit } : undefined };
}));
const checkGrid = async (browser: Locator) => {
  await expect.poll(() => browser.locator('.content-thumbnail img').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  const cards = await measureCards(browser); assert.ok(cards.length);
  const glyphs = cards.flatMap(card => card.glyph ?? []);
  for (const card of cards) {
    assert.deepEqual(card.card, cards[0].card, card.key); assert.deepEqual(card.thumbnail, cards[0].thumbnail, card.key); assert.equal(card.name.height, 32, card.key);
    assert.ok(Math.abs(card.thumbnail.width - card.thumbnail.height) < .5, JSON.stringify(card));
    if (card.glyph) { assert.deepEqual(card.glyph, glyphs[0], card.key); assert.ok(Math.abs(card.glyph.width - card.glyph.height) < .5); }
    if (card.image) { assert.equal(card.image.loaded, true); assert.equal(card.image.fit, 'contain'); }
  }
  return cards;
};
const saved = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const native = (hwnd: string, command = 'inspect', x = 0, y = 0) => new Promise<any>((resolve, reject) => {
  assert.match(hwnd, /^\d+$/);
  const child = spawn(path.join(root, 'resources/runtime/lib/py3-windows-x86_64/python.exe'), [path.join(root, 'scripts/lib/native-preview.py'), hwnd, command, String(x), String(y)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = ''; child.stdout.on('data', data => out += data); child.stderr.on('data', data => err += data); child.once('error', reject); child.once('close', code => code === 0 ? resolve(JSON.parse(out)) : reject(new Error(err)));
});
try {
  app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile'), devUrl: server ? 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port : undefined });
  page = await app.firstWindow(); const currentPage = page;
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, powerSaveBlocker }) => { powerSaveBlocker.start('prevent-display-sleep'); const window = BrowserWindow.getAllWindows()[0]; window.setContentSize(1500, 940); window.restore(); window.focus(); });
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await page.evaluate(() => { const state = window as any; state.__authoringEvents = []; window.studio!.onRuntimeEvent(event => state.__authoringEvents.push(event)); });
  const events = () => currentPage.evaluate(() => (window as any).__authoringEvents as RuntimeEvent[]);
  const menuState = async () => { const value = (await events()).filter(event => event.kind === 'log' && event.message.startsWith('VNS_QA_STATE:')).at(-1); return value ? JSON.parse(value.message.slice('VNS_QA_STATE:'.length)) : {}; };
  const clickTab = async (id: string) => currentPage.locator(`[data-workspace-tab="${id}"]`).click();
  const menu = (label: string) => currentPage.getByRole('menuitem', { name: label, exact: true });
  phase = 'resource filters'; await clickTab('assets');
  const browser = page.getByRole('region', { name: '资源管理器' });
  await expect(browser).toBeVisible();
  await expect(page.getByText('所有蓝图', { exact: true })).toHaveCount(0);
  await expect(page.getByText('素材文件', { exact: true })).toHaveCount(0);
  await expect(page.getByText('工程条目', { exact: true })).toHaveCount(0);
  await browser.getByRole('button', { name: '类型筛选' }).click();
  await browser.getByLabel('筛选蓝图', { exact: true }).check(); await browser.getByLabel('筛选音频', { exact: true }).check();
  await browser.getByLabel('搜索资源和蓝图').fill('验收');
  const cards = browser.locator('.content-items [data-content-key]');
  await expect(cards).toHaveCount(1); await browser.locator('[data-content-key="folder:qa_mixed"]').dblclick();
  await expect(cards).toHaveCount(1); await browser.locator('[data-content-key="folder:qa_nested"]').dblclick();
  await expect(cards).toHaveCount(2);
  await browser.getByRole('button', { name: '全部匹配', exact: true }).click(); await expect(cards).toHaveCount(2);
  await browser.getByLabel('筛选图片', { exact: true }).check(); await expect(cards).toHaveCount(5);
  await browser.getByRole('button', { name: '在文件夹内', exact: true }).click(); await expect(cards).toHaveCount(2);
  await expect(browser.getByLabel('筛选图片', { exact: true })).toBeChecked();
  await browser.getByRole('button', { name: '全部匹配', exact: true }).click();
  await page.screenshot({ path: path.join(output, '01-unified-filters.png') });
  checks.push('资源树统一，类型可多选；层级模式保留匹配祖先，全部匹配平铺所有所选类型。');
  phase = 'resource tile layout';
  await checkGrid(browser);
  await browser.getByRole('button', { name: '显示全部类型', exact: true }).click(); await browser.getByLabel('搜索资源和蓝图').fill('');
  await browser.locator('.content-breadcrumb').getByRole('button', { name: '项目资源', exact: true }).click();
  await browser.getByRole('button', { name: '类型筛选' }).click();
  await browser.locator('[data-content-key="folder:qa_mixed"]').dblclick();
  const regularCards = await checkGrid(browser); assert.ok(regularCards.some(card => card.key?.startsWith('folder:'))); assert.ok(regularCards.some(card => card.key === 'asset:qa_portrait'));
  await page.screenshot({ path: path.join(output, '01-resource-grid.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1180, 820));
  assert.deepEqual((await checkGrid(browser)).map(card => card.card), regularCards.map(card => card.card));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1500, 940));
  const tileSize = browser.getByRole('slider', { name: '资源缩略图大小' }); await tileSize.press('End');
  await expect(tileSize).toHaveValue('192'); const largeCards = await checkGrid(browser); assert.ok(largeCards[0].card.width > regularCards[0].card.width);
  await tileSize.press('Home'); await tileSize.press('ArrowRight'); await tileSize.press('ArrowRight'); await expect(tileSize).toHaveValue('128');
  await browser.getByRole('button', { name: '列表视图', exact: true }).click();
  const rows = await measureCards(browser);
  for (const row of rows) { assert.equal(row.card.height, 42); assert.deepEqual(row.thumbnail, { width: 30, height: 30 }); if (row.glyph) assert.deepEqual(row.glyph, { width: 20, height: 20 }); }
  await page.screenshot({ path: path.join(output, '01-resource-list.png') });
  await browser.getByRole('button', { name: '缩略图视图', exact: true }).click(); await checkGrid(browser);
  layoutEvidence.push({ regularCards, largeCards, rows });
  checks.push('文件夹、图片、蓝图等资源卡片等宽等高，预览框为正方形，图标同尺寸；长名称和横竖图片不撑开卡片，窗口缩放不拉伸，缩略图滑块和固定行高列表有效。');
  phase = 'resource dock'; await clickTab('script'); await page.keyboard.press('Control+Space');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1100, 720));
  const dock = page.locator('.content-dock'); await expect(dock).toBeVisible();
  const resize = dock.getByRole('separator', { name: '调整资源管理器高度' });
  for (let index = 0; index < 5; index++) await resize.press('ArrowDown');
  await dock.getByRole('button', { name: '类型筛选' }).click(); await dock.getByLabel('筛选蓝图', { exact: true }).check(); await dock.getByRole('button', { name: '全部匹配', exact: true }).click();
  const dockBounds = await dock.locator('.content-items').boundingBox(); assert.ok(dockBounds && dockBounds.height >= 50, JSON.stringify(dockBounds));
  await expect(dock.locator('.content-items [data-content-key="blueprint:qa_graph"]')).toBeVisible();
  assert.deepEqual((await checkGrid(dock))[0].card, regularCards[0].card);
  await page.screenshot({ path: path.join(output, '01-resource-dock.png') });
  await page.keyboard.press('Control+Space'); await expect(dock).toHaveCount(0);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1500, 940));
  checks.push('底部资源管理器在较小高度展开筛选后仍可查看和选择资源。');

  phase = 'parameter context menus'; await clickTab('variables');
  await page.locator('[data-parameter-set-id="qa_set"]').click({ button: 'right' }); await menu('重命名').click();
  await page.getByLabel('新名称', { exact: true }).fill('已重命名参数集'); await page.getByRole('dialog', { name: '重命名', exact: true }).getByRole('button', { name: '确定', exact: true }).click();
  await expect(page.locator('[data-parameter-set-id="qa_set"] strong')).toHaveText('已重命名参数集');
  await page.locator('[data-parameter-set-id="qa_set"]').click({ button: 'right' }); await menu('复制').click();
  await page.locator('.parameter-set-cards').click({ button: 'right', position: { x: 10, y: 500 } }); await menu('粘贴').click();
  await expect(page.locator('.parameter-table > button')).toHaveCount(1);
  await page.locator('.parameter-table > button').click(); await page.keyboard.press('Control+d');
  await expect(page.locator('.parameter-table > button')).toHaveCount(2);
  await page.locator('.parameter-table > button').last().click(); await page.keyboard.press('F2');
  await page.getByLabel('新名称', { exact: true }).fill('键盘重命名参数'); await page.keyboard.press('Enter');
  await expect(page.locator('.parameter-table > button').filter({ hasText: '键盘重命名参数' })).toHaveCount(1);
  await page.locator('.parameter-table > button').last().click(); await page.keyboard.press('Delete');
  await page.getByRole('dialog', { name: '删除参数', exact: true }).getByRole('button', { name: '确认删除参数' }).click();
  await expect(page.locator('.parameter-table > button')).toHaveCount(1); await page.keyboard.press('Control+z'); await expect(page.locator('.parameter-table > button')).toHaveCount(2);
  await page.locator('.parameter-sets-workspace').getByRole('button', { name: '参数集', exact: true }).click(); await page.locator('[data-parameter-set-id="qa_set"]').click();
  const originalRow = page.locator('[data-parameter-id="qa_score"]'); await originalRow.click({ button: 'right' }); await menu('剪切').click();
  await page.locator('.parameter-sets-workspace').getByRole('button', { name: '参数集', exact: true }).click(); await page.locator('[data-parameter-set-id="parameters_story"]').click();
  await page.locator('.parameter-table > header').click({ button: 'right' }); await menu('粘贴').click();
  await expect(page.locator('[data-parameter-id="qa_score"]')).toBeVisible();
  await page.locator('[data-parameter-id="qa_score"]').click({ button: 'right' }); await menu('移至参数集…').click(); await menu('游戏设置').click();
  await expect(page.locator('[data-parameter-id="qa_score"]')).toBeVisible();
  await page.locator('.builtin-parameters > summary').click(); await page.getByLabel('初始音乐音量', { exact: true }).fill('0.41'); await page.getByLabel('初始音乐音量', { exact: true }).press('Tab');
  await page.keyboard.press('Control+s'); await expect(page.locator('.dirty-dot')).toHaveCount(0);
  const parameterSaved = await saved(); assert.equal(parameterSaved.variables.find(variable => variable.id === 'qa_score')!.parameterSetId, 'parameters_game'); assert.equal(parameterSaved.variables.find(variable => variable.id === 'qa_score')!.persistent, false); assert.equal(parameterSaved.playerDefaults?.musicVolume, .41);
  await page.locator('.parameter-sets-workspace').getByRole('button', { name: '参数集', exact: true }).click(); await page.locator('[data-parameter-set-id="parameters_game"]').click({ button: 'right' }); await expect(menu('移除分组（保留参数）')).toBeDisabled(); await page.keyboard.press('Escape');
  await page.screenshot({ path: path.join(output, '02-parameter-sets.png') });
  checks.push('参数集右键重命名、复制粘贴，参数快捷键复制/重命名/删除/撤销、剪切和跨集移动有效，内置组受保护。');

  phase = 'selected control save dialog'; await clickTab('ui');
  const selectOverlay = async () => { await currentPage.getByLabel('设计页面', { exact: true }).selectOption('custom'); await currentPage.getByLabel('选择自定义页面', { exact: true }).selectOption('qa_overlay'); await currentPage.locator('[data-hierarchy-id="qa_overlay_control"]').click(); };
  await selectOverlay(); await page.getByLabel('控件显示名称', { exact: true }).fill('取消时保留');
  const beforeBounds = await page.locator('.ui-canvas [data-component-id="qa_overlay_control"]').boundingBox();
  await clickTab('assets'); const saveDialog = page.getByRole('dialog', { name: '保存界面修改', exact: true }); await expect(saveDialog).toBeVisible();
  assert.equal(await saveDialog.getByRole('button', { name: '取消', exact: true }).evaluate(element => { const r = element.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('button') === element; }), true);
  await page.screenshot({ path: path.join(output, '03-modal-over-selected-control.png') });
  await saveDialog.getByRole('button', { name: '取消', exact: true }).click(); await expect(saveDialog).toHaveCount(0); assert.deepEqual(await page.locator('.ui-canvas [data-component-id="qa_overlay_control"]').boundingBox(), beforeBounds);
  await clickTab('assets'); await saveDialog.getByRole('button', { name: '不保存', exact: true }).click(); await expect(browser).toBeVisible();
  await clickTab('ui'); await selectOverlay(); await page.getByLabel('控件显示名称', { exact: true }).fill('保存后继续'); await clickTab('assets'); await saveDialog.getByRole('button', { name: '保存并继续', exact: true }).click(); await expect(browser).toBeVisible();
  assert.equal((await saved()).ui.customPages.find(p => p.id === 'qa_overlay')!.components[0].name, '保存后继续');
  checks.push('整画布控件选中时，保存提示框取消、不保存、保存并继续都可实际点击，控件不会被误拖动。');

  phase = 'save before preview'; await openStoryMode(page, 'text');
  const text = page.locator('textarea.text-source-input'); await text.fill((await text.inputValue()).replace('自动保存前', '自动保存后的台词'));
  await clickTab('ui'); await page.getByLabel('设计页面', { exact: true }).selectOption('main'); await page.locator('[data-hierarchy-id="qa_preferences"]').click(); await page.getByLabel('控件显示名称', { exact: true }).fill('试玩前自动保存的按钮');
  const diskBefore = await fs.readFile(projectFile, 'utf8');
  await app.evaluate(({ ipcMain }) => { const state = globalThis as any; state.qaSaveHandler = (ipcMain as any)._invokeHandlers.get('studio:save'); ipcMain.removeHandler('studio:save'); ipcMain.handle('studio:save', () => { throw new Error('qa-save-failure'); }); });
  await page.getByRole('button', { name: '试玩', exact: true }).click(); await expect(page.getByText(/启动试玩失败：.*qa-save-failure/)).toBeVisible();
  await expect(page.locator('.play-workspace')).toHaveCount(0); assert.equal(await fs.readFile(projectFile, 'utf8'), diskBefore);
  await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('studio:save'); ipcMain.handle('studio:save', () => null); });
  await page.getByRole('button', { name: '试玩', exact: true }).click(); await expect(page.getByText('已取消保存，未启动试玩', { exact: true })).toBeVisible(); await expect(page.locator('.play-workspace')).toHaveCount(0);
  await app.evaluate(({ ipcMain }) => { const state = globalThis as any; ipcMain.removeHandler('studio:save'); ipcMain.handle('studio:save', state.qaSaveHandler); });
  assert.equal((await events()).filter(event => event.kind === 'preview').length, 0);
  for (const mode of ['embedded', 'window'] as const) {
    phase = 'native preview ' + mode;
    if (mode === 'window') { await page.getByRole('button', { name: '作品设置', exact: true }).click(); await page.getByRole('button', { name: '试玩设置', exact: true }).click(); await page.getByLabel('试玩方式', { exact: true }).selectOption('window'); await page.getByRole('button', { name: '完成', exact: true }).click(); }
    await page.getByRole('button', { name: '试玩', exact: true }).click();
    await expect(page.locator('.play-workspace')).toHaveAttribute('data-preview-state', /running|failed/, { timeout: 60000 });
    assert.equal(await page.locator('.play-workspace').getAttribute('data-preview-state'), 'running', await page.locator('.play-workspace').innerText());
    const event = (await events()).filter(event => event.kind === 'preview' && event.phase === 'running').at(-1)!; assert.ok(event.windowId); const hwnd = event.windowId;
    await expect.poll(async () => (await native(hwnd)).visible).toBe(true); await expect.poll(async () => (await menuState()).main).toBe(true);
    const savedPreview = await saved(); assert.ok(savedPreview.scriptText?.content.includes('自动保存后的台词')); assert.equal(savedPreview.ui.components.find(component => component.id === 'qa_preferences')!.name, '试玩前自动保存的按钮'); assert.equal(savedPreview.playerDefaults?.musicVolume, .41);
    await native(hwnd, 'focus'); await native(hwnd, 'click', .5, .47); await expect.poll(async () => (await menuState()).preferences).toBe(true);
    await native(hwnd, 'click', .29, .37); await expect.poll(async () => (await menuState()).voiceSustain).toBe(true);
    await page.getByRole('button', { name: '返回编辑', exact: true }).click(); await expect(page.locator('.play-workspace')).toHaveCount(0); await expect.poll(async () => (await native(hwnd)).visible).toBe(false); await expect.poll(async () => (await native(hwnd)).enabled).toBe(false);
    await page.getByRole('button', { name: '返回试玩画面', exact: true }).click(); await expect(page.locator('.play-workspace')).toHaveAttribute('data-preview-state', 'running'); await expect.poll(async () => (await native(hwnd)).visible).toBe(true); await expect.poll(async () => (await native(hwnd)).enabled).toBe(true);
    await native(hwnd, 'focus'); await native(hwnd, 'click', .71, .37); await expect.poll(async () => (await menuState()).voiceSustain).toBe(false);
    await clickTab('assets'); await expect(browser).toBeVisible(); await expect.poll(async () => (await native(hwnd)).visible).toBe(false);
    await page.getByRole('button', { name: '返回试玩画面', exact: true }).click(); await expect.poll(async () => (await native(hwnd)).visible).toBe(true);
    await page.getByRole('button', { name: '项目窗口', exact: true }).click(); await expect(page.locator('.project-browser')).toBeVisible(); await expect.poll(async () => (await native(hwnd)).exists).toBe(false); await expect(page.locator('.play-workspace')).toHaveCount(0);
    nativeEvidence.push({ mode, event, closed: await native(hwnd), menu: await menuState() });
    await page.screenshot({ path: path.join(output, '04-project-window-' + mode + '.png') });
    await page.getByRole('button', { name: '返回当前工程', exact: true }).click();
    checks.push(mode + '：实际鼠标可打开游戏设置并改变选项；返回编辑/切换资源隐藏并暂停，返回试玩恢复输入，项目窗口关闭游戏进程。');
  }
  await page.reload(); await enterFixtureProject(page, projectFile); await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await page.getByRole('button', { name: '作品设置', exact: true }).click(); await page.getByRole('button', { name: '试玩设置', exact: true }).click(); await expect(page.getByLabel('试玩方式', { exact: true })).toHaveValue('window'); await page.getByRole('button', { name: '完成', exact: true }).click();
  checks.push('试玩前保存文本、界面草稿、玩家默认值；保存失败/取消不启动，试玩方式重开工程后保留。');
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, errors, nativeEvidence, layoutEvidence }, null, 2));
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  const runtime = await page?.evaluate(() => ((window as any).__authoringEvents ?? []).slice(-50)).catch(() => []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, error: String(error), checks, errors, nativeEvidence, runtime }, null, 2)); throw error;
} finally {
  await page?.evaluate(() => window.studio?.controlPreview?.('stop')).catch(() => {});
  await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {});
  await app?.close().catch(() => {}); await server?.close(); console.log(output);
}

