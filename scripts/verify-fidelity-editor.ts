import { openDisclosure } from './lib/ui-disclosures';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createServer } from 'vite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { projectSchema } from '../src/core/model';
import { launchDesktopFixture, installedExecutable } from './lib/desktop-fixture';
import { projectToText } from '../src/core/text-script';
import { linePreviewSnapshot } from '../src/core/line-preview';

const root = path.resolve('.'), output = path.join(root, 'artifacts/fidelity-editor-1.3.0', new Date().toISOString().replaceAll(':', '-'));
const template = installedExecutable ? path.join(path.dirname(installedExecutable), 'resources/resources/templates/aihong') : path.join(root, 'resources/templates/aihong');
const directory = path.join(output, 'project'), projectFile = path.join(directory, 'project.vns.json');
await fs.cp(template, directory, { recursive: true });
const project = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8'))); project.id = 'fidelity_editor'; project.name = '1.3.0 界面与构图验收';
const presetCharacter = project.characters.find(c => c.name === '林翩翩')!;
const presetNode = project.nodes.find(n => n.kind === 'passage')!;
for (const [index, line] of presetNode.lines.slice(0, 2).entries()) line.actions.push({ kind: 'show', characterId: presetCharacter.id, expressionId: presetCharacter.expressions[0].id, presetId: index ? 'left' : 'default', x: .5, y: 1, scale: 1, layer: 10, transition: 'none' });
project.scriptText = { format: 'vns-text-1', content: projectToText(project) };
const icon = new PNG({ width: 128, height: 128 });
const colors = [[238, 76, 89], [47, 171, 214], [249, 188, 64], [136, 87, 204]];
for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) { const at = (y * 128 + x) * 4; icon.data.set([...colors[(y >= 64 ? 2 : 0) + (x >= 64 ? 1 : 0)], 255], at); }
await fs.writeFile(path.join(directory, 'assets/fidelity-icon.png'), PNG.sync.write(icon));
project.assets.push({ id: 'fidelity_icon', name: '验收四角图标', kind: 'image', path: 'assets/fidelity-icon.png', width: 128, height: 128, category: 'ui' });
await fs.writeFile(projectFile, JSON.stringify(project, null, 2));
const server = installedExecutable ? undefined : await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/resources/**', '**/release/**'] } } });
await server?.listen();
let app: ElectronApplication | undefined, page: Page | undefined, phase = 'launch';
const checks: string[] = [], errors: string[] = [];
const uiPage = async (name: string) => { await page!.locator('.view-tabs').getByRole('button', { name: '界面', exact: true }).click(); await page!.locator('.ui-toolbar').getByRole('button', { name, exact: true }).click(); };
try {
  app = await launchDesktopFixture({ root, profile: path.join(output, 'profile'), projectFile, devUrl: server ? `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}` : undefined });
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(project.name);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1520, 980));
  phase = 'tooltips and authored save controls';
  await uiPage('对话');
  await page.locator('[data-component-id="ai_dialogue_plotmap"]').hover();
  await expect(page.locator('[data-component-id="ai_dialogue_tooltip"]')).toContainText('流程图(A)');
  await page.locator('.ui-canvas').screenshot({ path: path.join(output, 'dialogue-tooltip.png') });
  expect(await page.getByLabel('添加标准组件').locator('option[value="binding:tooltip"]').count()).toBe(1);
  await uiPage('存读档');
  await page.getByLabel('存档预览内容').selectOption('filled');
  await page.locator('[data-hierarchy-id="ai_save_slots"]').click();
  await page.getByText('存档格内部布局', { exact: true }).click();
  await expect(page.getByLabel('读取按钮使用图片内文字')).toBeChecked();
  await expect(page.getByLabel('保存按钮使用图片内文字')).toBeChecked();
  const saveSkin = project.assets.find(a => a.id === project.ui.components.find(c => c.id === 'ai_save_slots')!.list!.slotSaveSkin!.idle)!.path;
  expect(await page.locator('.ui-canvas img').evaluateAll((images, suffix) => images.some(image => decodeURIComponent((image as HTMLImageElement).src).endsWith(suffix)), saveSkin)).toBe(true);
  await page.locator('.ui-canvas').screenshot({ path: path.join(output, 'save-preview.png') });
  await page.getByLabel('存读档预览页面').selectOption('load');
  expect(await page.locator('.ui-canvas img').evaluateAll((images, suffix) => images.some(image => decodeURIComponent((image as HTMLImageElement).src).endsWith(suffix)), saveSkin)).toBe(false);
  await page.locator('.ui-canvas').screenshot({ path: path.join(output, 'load-preview.png') });
  checks.push('中文悬停提示及添加入口；存读档预览分别显示保存/读取皮肤，皮肤内文字可编辑。');

  phase = 'character default framing';
  await page.locator('.view-tabs').getByRole('button', { name: '角色', exact: true }).click();
  await page.locator('.character-item').filter({ hasText: '林翩翩' }).click();
  await openDisclosure(page, '默认立绘构图');
  await page.getByLabel('头顶位置 %', { exact: true }).fill('18');
  await page.getByLabel('显示立绘高度 %', { exact: true }).fill('70');
  const character = project.characters.find(c => c.name === '林翩翩')!;
  for (const e of [character.expressions[0], character.expressions.at(-1)!]) {
    await page.getByLabel('构图预览表情').selectOption(e.id);
    await expect(page.getByLabel('角色默认构图预览').locator('img')).toBeVisible();
    await page.getByLabel('角色默认构图预览').screenshot({ path: path.join(output, `framing-${e.id}.png`) });
  }
  await openDisclosure(page, '角色站位预设');
  await page.getByLabel('默认站位预设', { exact: true }).selectOption('left');
  await page.getByLabel('编辑站位预设', { exact: true }).selectOption('left');
  await page.getByLabel('预设横向位置 %', { exact: true }).fill('20');
  await page.getByLabel('预设缩放 %', { exact: true }).fill('90');
  await page.getByLabel('预设预览表情', { exact: true }).selectOption(character.expressions.at(-1)!.id);
  await page.getByLabel('角色站位预设预览').screenshot({ path: path.join(output, 'linked-character-preset.png') });
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  const saved = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
  expect(saved.characters.find(c => c.id === character.id)?.portraitFraming).toMatchObject({ top: .18, visibleFraction: .7 });
  expect(saved.characters.find(c => c.id === character.id)?.defaultDisplayPresetId).toBe('left');
  expect(saved.characters.find(c => c.id === character.id)?.displayPresets?.find(p => p.id === 'left')).toMatchObject({ x: .2, scale: .9 });
  const actors = presetNode.lines.slice(0, 2).map(line => linePreviewSnapshot(saved, { nodeId: presetNode.id, lineId: line.id }).after.actors.get(character.id)!);
  expect(actors.map(a => [a.x, a.y, a.scale])[0]).toEqual(actors.map(a => [a.x, a.y, a.scale])[1]);
  expect(actors.map(a => a.presetId)).toEqual(['default', 'left']);
  checks.push('角色默认半身构图可调整、跨表情预览并通过真实保存写入独立工程。');
  checks.push('真实界面修改左站位的横向与缩放、选择角色默认项；两个指令保留不同引用并同时跟随最新预设，保存后仍一致。');

  phase = 'chapter animation preview';
  await uiPage('章节标题');
  await expect(page.locator('.chapter-backdrop-card').first()).toHaveCSS('mask-image', /ai_presentation_mask/);
  await expect(page.locator('.chapter-ripple-scene').first()).toHaveAttribute('data-ripple-ready', 'true');
  await page.getByRole('tab', { name: '游戏设置', exact: true }).click();
  const menuPage = page.getByLabel('菜单快捷键打开', { exact: true });
  await expect(menuPage).toHaveValue('preferences');
  await menuPage.selectOption('pause'); await expect(menuPage).toHaveValue('pause');
  await menuPage.selectOption('preferences');
  const chapterSettings = page.locator('details.ui-property-group').filter({ has: page.locator('summary').filter({ hasText: /^章节进场$/ }) });
  await chapterSettings.locator(':scope > summary').click();
  await chapterSettings.locator('.chapter-composition > summary').click();
  const rippleToggle = page.getByRole('checkbox', { name: '笔触消散时背景轻微波动', exact: true });
  await rippleToggle.uncheck(); await expect(page.locator('.chapter-ripple-scene')).toHaveCount(0);
  await rippleToggle.check(); await expect(page.locator('.chapter-ripple-scene')).toHaveAttribute('data-ripple-ready', 'true');
  await expect(page.getByLabel('波动幅度', { exact: true })).toBeVisible();
  checks.push('菜单快捷键页面可选；章节背景波动可以从真实游戏设置中关闭和恢复，并重新生成可见 WebGL 画面。');
  await page.getByRole('button', { name: '播放进场', exact: true }).click();
  const preview = page.getByLabel('章节进场预览', { exact: true });
  await expect(preview.locator('.chapter-ripple-scene')).toHaveAttribute('data-ripple-ready', 'true');
  for (const [label, time] of [['fade', .45], ['enter', 1.2], ['wind', 3.2], ['leave', 6.0]] as const) {
    await expect.poll(async () => Number(await preview.getAttribute('data-elapsed')), { intervals: [20], timeout: 6000 }).toBeGreaterThanOrEqual(time);
    if (label === 'wind') expect(await preview.locator('.chapter-preview-particle').count()).toBeGreaterThan(0);
    await page.locator('.ui-canvas').screenshot({ path: path.join(output, `chapter-${label}.png`) });
  }
  await expect(preview).toHaveCount(0, { timeout: 6000 });
  checks.push('实际编辑器 WebGL 编译原作水波参数成功，连续播放全屏渐变、左侧题字入场及从题字发出的白色粒子，再回到设计画布。');

  phase = 'adaptive icon preview';
  await page.locator('.export-button').click();
  const settings = page.getByRole('dialog', { name: '作品设置', exact: true });
  await settings.getByRole('button', { name: '浏览游戏图标', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '游戏图标资源浏览器', exact: true });
  await picker.getByRole('button', { name: '预览资源 验收四角图标', exact: true }).click();
  await picker.getByRole('button', { name: '使用所选资源', exact: true }).click();
  await settings.getByRole('button', { name: /^Android APK/ }).click();
  const circle = settings.getByLabel('Android 圆形图标预览', { exact: true });
  for (const scale of [100, 50]) {
    await settings.getByLabel('图案大小 %', { exact: true }).fill(String(scale));
    const bytes = await circle.screenshot({ path: path.join(output, `android-circle-${scale}.png`) }), png = PNG.sync.read(bytes);
    let left = png.width, right = -1;
    for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) { const at = (y * png.width + x) * 4; if (colors.some(color => color.every((v, c) => Math.abs(png.data[at + c] - v) <= 2))) { left = Math.min(left, x); right = Math.max(right, x); } }
    expect((right - left + 1) / png.width).toBeGreaterThan(scale / 100 * .60);
    expect((right - left + 1) / png.width).toBeLessThan(scale / 100 * .70);
  }
  await settings.screenshot({ path: path.join(output, 'icon-settings.png') });
  await settings.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  const final = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
  expect(final.exportSettings?.iconAssetId).toBe('fidelity_icon'); expect(final.exportSettings?.android.iconScale).toBe(.5);
  checks.push('图标通过真实资源选择器配置；圆形裁切内四角完整，100%/50%预览尺寸与生成几何一致并保存。');
  expect(errors).toEqual([]);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', installedExecutable, checks, errors }, null, 2));
  console.log('REPORT ' + path.join(output, 'report.json'));
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, checks, errors, error: String(error) }, null, 2));
  console.error(phase + ': ' + String(error)); process.exitCode = 1;
} finally { await app?.close(); await server?.close(); }
