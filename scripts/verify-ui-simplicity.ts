import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { expect } from '@playwright/test';
import { createProject, projectSchema } from '../src/core/model';
import { createBlueprintGraph } from '../src/core/blueprint';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openUiPreviewWindow } from './lib/ui-preview-window';
import { clickUiButtonEvent, openContentFilters, openDisclosure } from './lib/ui-disclosures';

const root = path.resolve('.');
const output = path.join(root, 'artifacts/ui-simplicity', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(path.join(output, 'assets'), { recursive: true });
const picture = new PNG({ width: 320, height: 180 });
for (let y = 0; y < picture.height; y++) for (let x = 0; x < picture.width; x++) {
  const i = (y * picture.width + x) * 4;
  picture.data[i] = 30 + Math.round(x / 4);
  picture.data[i + 1] = 100 + Math.round(y / 3);
  picture.data[i + 2] = 160;
  picture.data[i + 3] = 255;
}
await fs.writeFile(path.join(output, 'assets/picture.png'), PNG.sync.write(picture));
const project = createProject('简洁界面操作验收');
project.assets.push({ id: 'picture', kind: 'image', name: '示例图片', path: 'assets/picture.png' });
project.characters.push({ id: 'speaker', name: '小林', color: '#91b9d9', expressions: [{ id: 'normal', name: '普通', assetId: 'picture' }] });
project.variables.push({ id: 'relationship', name: '好感度', type: 'number', initial: 1, persistent: false });
const passage = project.nodes.find(n => n.kind === 'passage')!;
if (passage.kind === 'passage') { passage.lines[0].text = '选择页面，调整控件，然后在独立窗口预览。'; passage.lines[0].speakerId = 'speaker'; }
project.blueprints.push(createBlueprintGraph('effect', '示例演出'));
project.ui.pages = { main: { layout: 'custom' }, say: { layout: 'custom' }, preferences: { layout: 'custom' } };
project.ui.components = [
  { id: 'title', kind: 'text', page: 'main', text: '简单的页面', x: .1, y: .12, width: .8, height: .15, style: { fontSize: 42 } },
  { id: 'trigger', name: '开始按钮', kind: 'button', page: 'main', text: '开始故事', action: 'start', x: .35, y: .5, width: .3, height: .12 },
  { id: 'dialogue_background', kind: 'image', page: 'say', assetId: 'picture', text: '', x: .05, y: .7, width: .9, height: .25 },
  { id: 'setting_title', kind: 'text', page: 'preferences', text: '游戏设置', x: .1, y: .1, width: .8, height: .15 },
];
const projectFile = path.join(output, 'project.vns.json');
await fs.writeFile(projectFile, JSON.stringify(projectSchema.parse(project)));
const app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') });
const page = await app.firstWindow(); page.setDefaultTimeout(12000);
const errors: string[] = [], checks: string[] = [], layouts: unknown[] = [];
page.on('pageerror', error => errors.push(error.message));
const button = (name: string) => page.getByRole('button', { name, exact: true });
const mode = (name: string) => page.getByLabel('界面编辑模式').getByRole('button', { name, exact: true });
const tab = (id: string) => page.locator(`[data-workspace-tab="${id}"]`);
const saveUi = async () => { await button('保存界面').click(); await expect(button('保存界面')).toBeDisabled(); };
const settings = () => page.getByRole('dialog', { name: '作品设置', exact: true });
const theme = async (light: boolean) => {
  await button('作品设置').click(); await settings().getByRole('button', { name: '编辑器外观', exact: true }).click();
  await settings().locator('.editor-theme-card').filter({ hasText: light ? '亮白' : '黑白' }).click();
  await settings().getByRole('button', { name: '完成', exact: true }).click();
};
const inspect = process.argv.includes('--inspect');
try {
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  for (const [width, height, light] of [[1480, 960, false], [1024, 768, true]] as const) {
    await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h), [width, height]);
    await theme(light);
    for (const id of ['script', 'flowchart', 'blueprint', 'ui', 'assets', 'characters', 'variables']) {
      await tab(id).click();
      if (id === 'ui') { await mode('设计').click(); await page.locator('[data-hierarchy-id="trigger"]').click(); }
      if (id === 'characters') await page.locator('[data-character-id="speaker"]').click();
      const state = await page.evaluate(() => ({
        width: innerWidth, height: innerHeight, theme: document.documentElement.dataset.editorTheme,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        toolbars: [...document.querySelectorAll<HTMLElement>('.content-toolbar, .text-editor-toolbar, .ui-toolbar, .workspace-toolbar')].filter(el => el.getBoundingClientRect().width > 0).map(el => ({ name: el.className, width: el.clientWidth, content: el.scrollWidth })),
      }));
      assert.ok(state.overflow <= 1, `${id}: ${JSON.stringify(state)}`);
      layouts.push({ workspace: id, ...state });
      await page.screenshot({ path: path.join(output, `${id}-${width}.png`) });
    }
  }
  if (!inspect) {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1480, 960)); await theme(false);
    await tab('script').click();
    const files = page.locator('.toolbar-menu > summary').filter({ hasText: '文本文件' });
    await expect(button('导入文本')).toBeHidden(); await files.focus(); await page.keyboard.press('Enter');
    await expect(button('导入文本')).toBeVisible(); await expect(button('导出文本')).toBeVisible();
    await page.keyboard.press('Escape'); await expect(button('导入文本')).toBeHidden(); await expect(files).toBeFocused();
    await files.click(); await page.locator('.text-source-panel .text-panel-heading strong').click(); await expect(button('导入文本')).toBeHidden();
    await files.click(); await button('导出文本').click();
    await expect(page.getByRole('dialog', { name: '导出文本', exact: true })).toBeVisible();
    await page.getByRole('dialog', { name: '导出文本', exact: true }).getByRole('button', { name: '取消', exact: true }).click();
    await expect(button('导出文本')).toBeHidden(); checks.push('文本文件菜单键盘打开/Esc回焦/点击外部关闭、真实导出入口');
    await tab('blueprint').click();
    const graphs = page.getByLabel('演出目标', { exact: true }); await expect(graphs).toHaveValue('graph:' + project.blueprints[0].id);
    await expect(page.getByLabel('选择通用蓝图', { exact: true })).toHaveCount(0); await expect(button('新建蓝图')).toHaveCount(1);
    await button('新建蓝图').click(); const addedGraphId = (await graphs.inputValue()).slice(6);
    assert.notEqual(addedGraphId, project.blueprints[0].id); await expect(page.locator('.react-flow__node')).not.toHaveCount(0);
    await graphs.selectOption('graph:' + project.blueprints[0].id); await expect(graphs).toHaveValue('graph:' + project.blueprints[0].id);
    checks.push('蓝图统一选择和新建入口、实际创建和切换保留节点');
    await tab('ui').click(); await mode('设计').click();
    const pages = page.getByLabel('设计页面', { exact: true }); await expect(pages).toHaveValue('main');
    await page.locator('[data-hierarchy-id="trigger"]').click();
    await expect(page.getByLabel('文字', { exact: true })).toBeVisible();
    await expect(page.getByLabel('横向位置 %', { exact: true })).toBeVisible(); await expect(page.getByLabel('宽度 %', { exact: true })).toBeVisible();
    await expect(page.getByLabel('点击事件蓝图', { exact: true })).toBeHidden();
    const preview = await openUiPreviewWindow(app, page);
    await page.getByLabel('文字', { exact: true }).fill('编辑后同步'); await page.getByLabel('宽度 %', { exact: true }).fill('36');
    await expect(preview.getByLabel('参数联动预演画面')).toContainText('编辑后同步');
    await button('撤销').click(); await expect(page.getByLabel('宽度 %', { exact: true })).toHaveValue('30');
    await button('重做').click(); await expect(page.getByLabel('宽度 %', { exact: true })).toHaveValue('36');
    await openDisclosure(page, '高级事件绑定'); await expect(page.getByLabel('点击事件蓝图', { exact: true })).toBeVisible();
    await openDisclosure(page, '图片皮肤与详细外观'); await openDisclosure(page, '按钮状态颜色');
    await expect(page.getByLabel('按下背景', { exact: true })).toBeVisible(); await saveUi();
    await mode('事件图').click(); await page.locator('[data-ui-component-id="trigger"]').click();
    await expect(button('点击时 · OnClicked')).toBeVisible(); await expect(button('悬停时 · OnHovered')).toBeHidden();
    await clickUiButtonEvent(page, '悬停时 · OnHovered'); await expect(page.locator('.node-kind-eventButton')).toHaveCount(1);
    await clickUiButtonEvent(page, '悬停时 · OnHovered'); await expect(page.locator('.node-kind-eventButton')).toHaveCount(1);
    await saveUi(); await mode('设计').click();
    await expect(page.locator('[data-component-id="trigger"]')).toContainText('编辑后同步');
    assert.ok(await page.locator('[data-component-id="trigger"]').evaluate(el => el.getBoundingClientRect().width > 50));
    await pages.selectOption('say'); await page.locator('[data-hierarchy-id="dialogue_background"]').click();
    const checkbox = page.getByLabel('跟随玩家对话框透明度', { exact: true }); await expect(checkbox).not.toBeChecked();
    const help = page.locator('summary[aria-label="跟随玩家对话框透明度说明"]');
    await help.click(); await expect(help.locator('..').locator('small')).toBeVisible(); await expect(checkbox).not.toBeChecked();
    await help.focus(); await page.keyboard.press('Enter'); await expect(help.locator('..').locator('small')).toBeHidden(); await expect(checkbox).not.toBeChecked();
    await checkbox.locator('..').locator('.field-label').click(); await expect(checkbox).toBeChecked();
    await saveUi(); await pages.selectOption('preferences'); await expect(preview.getByLabel('参数联动预演画面')).toContainText('游戏设置');
    await pages.selectOption('main'); await page.screenshot({ path: path.join(output, 'design-final.png') });
    await tab('assets').click(); await expect.poll(() => app.windows().length).toBe(1);
    checks.push('设计页面下拉、常用属性、高级分组、事件创建与重复定位、撤销重做、草稿预览、切换返回、保存');
    checks.push('说明鼠标与键盘展开、标签点击、说明点击不改变复选框');

    const browser = page.getByRole('region', { name: '资源管理器', exact: true });
    await expect(browser.getByLabel('资源类型')).toBeHidden(); await openContentFilters(browser);
    await browser.getByLabel('资源类型').selectOption('image'); await expect(browser.locator('[data-content-key^="asset:"]')).toHaveCount(1);
    await browser.getByLabel('资源排序').selectOption('kind'); await browser.locator('.content-filter-toggle').click();
    await expect(browser.locator('.content-filter-toggle')).toContainText('图片'); await expect(browser.locator('.content-filter-toggle')).toContainText('按类型');
    await openContentFilters(browser); await browser.getByRole('button', { name: '清除筛选', exact: true }).click();
    await expect(browser.getByLabel('资源类型')).toHaveValue('all'); await expect(browser.getByLabel('资源排序')).toHaveValue('name');
    checks.push('素材筛选与排序按需展开、活动筛选提示、实际过滤和恢复');

    await tab('characters').click(); await page.locator('[data-character-id="speaker"]').click();
    await expect(page.getByLabel('角色名称', { exact: true })).toBeVisible(); await expect(page.getByLabel('表情名称', { exact: true })).toBeVisible();
    await expect(page.getByLabel('头顶位置 %', { exact: true })).toBeHidden(); await expect(page.getByLabel('基础角色', { exact: true })).toBeHidden();
    await openDisclosure(page, '默认立绘构图'); await page.getByLabel('头顶位置 %', { exact: true }).fill('18');
    await openDisclosure(page, '角色站位预设'); await page.getByLabel('默认站位预设', { exact: true }).selectOption('left');
    await openDisclosure(page, '继承与蓝图'); await expect(page.getByLabel('角色蓝图', { exact: true })).toBeVisible();
    checks.push('角色名称与表情优先、构图/站位/继承展开后可编辑');

    await tab('variables').click(); await page.locator('.parameter-set-card').filter({ hasText: '故事状态' }).click();
    await page.locator('.parameter-table button').filter({ hasText: '好感度' }).click();
    const parameters = page.getByLabel('参数设置', { exact: true });
    await parameters.getByLabel('名称', { exact: true }).fill('关系值'); await parameters.getByLabel('状态值', { exact: true }).fill('5');
    await expect(parameters.getByLabel('跨存档保留', { exact: true })).toBeHidden(); await openDisclosure(page, '分组与存储');
    await parameters.getByLabel('跨存档保留', { exact: true }).check();
    await openDisclosure(page, '参数集设置'); await expect(page.getByLabel('参数集名称', { exact: true })).toBeVisible();
    checks.push('参数名称和初始值直接编辑、分组与存储展开编辑');

    await button('作品设置').click(); const dialog = settings();
    await expect(dialog.getByText(/普通顺序剧情通常不用手写/)).toBeHidden(); await openDisclosure(page, '入口指令说明');
    await expect(dialog.getByText(/普通顺序剧情通常不用手写/)).toBeVisible();
    await dialog.getByRole('button', { name: '试玩设置', exact: true }).click();
    await expect(dialog.getByLabel('试玩方式', { exact: true })).toBeVisible(); await expect(dialog.getByLabel('关系值', { exact: true })).toBeHidden();
    await openDisclosure(page, '测试初始状态'); await dialog.getByLabel('关系值', { exact: true }).fill('9');
    await expect(dialog.locator('summary').filter({ hasText: '测试初始状态' })).toContainText('已调整 1 项');
    await dialog.getByRole('button', { name: '完成', exact: true }).click(); await button('保存工程').click();
    await expect(page.locator('.project-title .dirty-dot')).toHaveCount(0);
    const saved = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
    assert.equal(saved.variables[0].name, '关系值'); assert.equal(saved.variables[0].initial, 5); assert.equal(saved.variables[0].persistent, true);
    assert.equal(saved.characters[0].portraitFraming?.top, .18); assert.equal(saved.characters[0].defaultDisplayPresetId, 'left');
    assert.equal(saved.ui.components.find(c => c.id === 'trigger')!.width, .36); assert.equal(saved.ui.components.find(c => c.id === 'dialogue_background')!.style?.playerOpacity, true);
    await page.reload(); await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
    await tab('ui').click(); await mode('事件图').click(); await mode('设计').click();
    await expect(page.locator('[data-component-id="trigger"]')).toContainText('编辑后同步');
    checks.push('作品与试玩设置按需展开、测试值不修改初始值、工程保存重开和设计返回');
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: inspect ? 'inspected' : 'passed', renderer: 'dist', checks, layouts, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
  await fs.writeFile(path.join(output, 'failure.txt'), String(error)); throw error;
} finally {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => undefined);
  await app.close(); console.log(output);
}
