import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { loadProject, saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';

const root = path.resolve('.'), output = path.join(root, 'artifacts/module-theme', new Date().toISOString().replaceAll(':', '-'));
const projectFile = path.join(output, 'project/project.vns.json'), template = path.join(root, 'resources/templates/aihong');
const project = (await loadProject(path.join(template, 'project.vns.json'))).project;
await saveProject(projectFile, project, template);
const app = await launchDesktopFixture({ root, profile: path.join(output, 'profile'), projectFile });
const page = await app.firstWindow(), errors: string[] = [], measurements: unknown[] = [];
page.on('pageerror', error => errors.push(error.message));
let phase = 'launch';
const measure = async (label: string, selectors: string[]) => {
  await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation instanceof CSSTransition).map(animation => animation.finished.catch(() => undefined))));
  const values = await page.evaluate(selectors => {
    const rgb = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number);
    const lum = (value: number[]) => value.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    return selectors.flatMap(selector => Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(el => el.getClientRects().length && !el.closest(':disabled')).map(element => {
      const foreground = rgb(getComputedStyle(element).color);
      let parent: HTMLElement | null = element, background: number[] = [];
      while (parent) { background = rgb(getComputedStyle(parent).backgroundColor); if (background.length === 3 || background[3] >= .99) break; parent = parent.parentElement; }
      const a = lum(foreground), b = lum(background);
      return { selector, text: element.textContent?.slice(0, 40), foreground, background, contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
    }));
  }, selectors);
  expect(values.length).toBeGreaterThan(0);
  measurements.push({ label, values });
  for (const value of values) expect(value.contrast, `${label}: ${JSON.stringify(value)}`).toBeGreaterThanOrEqual(4.5);
};
try {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 1050));
  await openStoryMode(page, 'script');
  await page.evaluate('globalThis.__name = (value) => value');
  for (const [id, label] of [['codexLight', '亮白'], ['codexDark', '黑白'], ['ue5', '石墨'], ['studio', '蓝灰'], ['custom', '自定义']] as const) {
    phase = id;
    await page.getByRole('button', { name: '作品设置', exact: true }).click();
    await page.getByRole('button', { name: '编辑器外观', exact: true }).click();
    await page.getByRole('button', { name: new RegExp(`^${label}`) }).click();
    if (id === 'custom') for (const [name, color] of Object.entries({ 工作区背景: '#ffffff', 面板: '#000000', 工具栏: '#ffffff', 输入框: '#ffffff', 按钮与悬浮层: '#ffffff', 文字: '#ffffff', 次要文字: '#ffffff', 重点色: '#ffffff', 选中背景: '#ffffff' })) {
      await page.getByLabel(`自定义${name}`, { exact: true }).fill(color);
    }
    await page.getByRole('button', { name: '关闭作品设置', exact: true }).click();
    await page.locator('#line-opening_line_1 .dialogue-input').focus();
    await page.locator('.text-source-panel .script-scroll').evaluate(el => { el.scrollTop = 150; });
    await measure(id + '-normal', ['.line-top > select', '.line-effect-chip > span', '.line-effect-chip > small', '.line-effect-placeholder', '.line-number', '.passage-heading-row .icon-button', '.passage-header strong', '.dialogue-input']);
    await page.locator('.text-source-panel').screenshot({ path: path.join(output, `${id}-module.png`) });
    const chip = page.locator('.line-effect-chip').first();
    await chip.hover();
    await measure(id + '-hover', ['.line-effect-chip:hover > span', '.line-effect-chip:hover > small']);
    await chip.click();
    await expect(page.locator('.line-effect-editor')).toBeVisible();
    await measure(id + '-expanded', ['.line-effect-chip.active > span', '.line-effect-chip.active > small', '.line-effect-editor .action-editor-header > strong', '.line-effect-editor label', '.line-effect-editor input', '.line-effect-editor select', '.line-effect-editor .ui-asset-thumbnail']);
    await page.locator('.text-source-panel').screenshot({ path: path.join(output, `${id}-expanded.png`) });
    await page.locator('.line-effect-editor .ui-asset-thumbnail').first().click();
    await expect(page.getByRole('dialog', { name: '背景素材资源浏览器', exact: true })).toBeVisible();
    await page.mouse.move(0, 0);
    await measure(id + '-assets', ['.asset-picker-dialog > header strong', '.asset-picker-dialog > header span', '.asset-picker-search', '.asset-picker-dialog input', '.asset-picker-dialog select', '.asset-picker-folders > button', '.asset-picker-folders small', '.asset-picker-group > h3', '.asset-picker-card > span:not(.asset-picker-card-image)', '.asset-picker-card > small', '.asset-picker-detail > strong', '.asset-picker-detail > span', '.asset-picker-detail > small', '.asset-picker-detail > code', '.asset-picker-dialog > footer > button']);
    await page.locator('.asset-picker-dialog').screenshot({ path: path.join(output, `${id}-assets.png`) });
    await page.locator('.asset-picker-card.selected').hover();
    await measure(id + '-asset-hover', ['.asset-picker-card.selected:hover > span:not(.asset-picker-card-image)', '.asset-picker-card.selected:hover > small']);
    await page.getByRole('button', { name: '关闭资源浏览器', exact: true }).click();
    await page.getByRole('button', { name: '收起演出编辑', exact: true }).click();
    await page.locator('#line-opening_line_1').getByRole('button', { name: '为第1行添加效果', exact: true }).click();
    await expect(page.getByRole('menu', { name: '添加本行演出' })).toBeVisible();
    await measure(id + '-menu', ['.line-effect-menu > button:not(:disabled)']);
    await page.locator('.text-source-panel').screenshot({ path: path.join(output, `${id}-menu.png`) });
    await page.keyboard.press('Escape');
    await page.locator('#node-opening').getByRole('button', { name: '段落属性', exact: true }).click();
    await expect(page.locator('.module-node-properties')).toBeVisible();
    await measure(id + '-properties', ['.module-node-properties .field-label', '.module-node-properties input', '.module-node-properties select']);
    await page.locator('#node-opening').getByRole('button', { name: '段落属性', exact: true }).click();
  }
  expect(errors).toEqual([]);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', measurements, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png') });
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, error: String(error), measurements, errors }, null, 2));
  throw error;
} finally { await app.close(); console.log(output); }
