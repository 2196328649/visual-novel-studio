import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { parseProject } from '../src/desktop/project-store';
import { flowNodeAppearance } from '../src/core/flow-style';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openDisclosureAncestors } from './lib/ui-disclosures';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { sha256 } from './lib/text-typography';
import { flowTextBackdropFixture, assertBacking, cropPng } from './lib/flow-text-backdrop-fixture';

const root = path.resolve('.'), output = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? 'artifacts/flow-text-backdrop-editor',
  'backdrop-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const relativeOutput = path.relative(root, output);
assert.ok(relativeOutput && !path.isAbsolute(relativeOutput) && relativeOutput !== '..' && !relativeOutput.startsWith('..' + path.sep), 'Acceptance output must remain inside this checkout.');
const originalFile = path.resolve('../我的视觉小说1/project.vns.json'), original = await fs.readFile(originalFile);
const { project, file, entries } = await flowTextBackdropFixture(path.join(output, 'project'));
const checks: string[] = [], evidence: Record<string, unknown> = {}, errors: string[] = [];
let app: ElectronApplication | undefined, page: Page | undefined, phase = 'launch';
const save = async () => { await page!.getByRole('button', { name: '保存界面', exact: true }).click(); await expect(page!.locator('.ui-save-status')).toHaveText('已保存'); };
const read = async () => JSON.parse(await fs.readFile(file, 'utf8')) as typeof project;
const inspector = () => page!.locator('.ui-inspector[data-ui-flow-view]');
const view = () => inspector().locator('.ui-inspector-view:not([hidden])');
const field = (name: string) => view().getByLabel(name, { exact: true });
const group = (id: string) => view().locator(`[data-ui-inspector-group="${id}"]`);
const openGroup = async (id: string) => { await openDisclosureAncestors(group(id).locator(':scope > summary')); };
const map = async () => {
  if (await inspector().getAttribute('data-ui-flow-view') !== 'map') await inspector().getByRole('button', { name: '返回整张图设置', exact: true }).click();
  await expect(inspector()).toHaveAttribute('data-ui-flow-view', 'map');
};
const base = async () => {
  await map(); await openGroup('flow-style'); await view().getByRole('button', { name: /^本图基础外观/ }).click();
  await expect(inspector()).toHaveAttribute('data-ui-flow-view', 'base');
};
const preset = async (id: string) => {
  await map(); await openGroup('flow-style'); await view().getByRole('button', { name: '管理全部外观预设', exact: true }).click();
  await expect(inspector()).toHaveAttribute('data-ui-flow-view', 'preset'); await field('编辑节点外观预设').selectOption(id);
};
const resetShadow = async () => {
  await group('flow-preset-text-effects').locator('.flow-style-shadow-mode').click({ button: 'right' });
  const menu = page!.getByRole('menu', { name: '参数操作', exact: true });
  await expect(menu.getByRole('menuitem', { name: '来源：此预设单独设置', exact: true })).toBeDisabled();
  await menu.getByRole('menuitem', { name: '恢复本图基础文字黑底与阴影', exact: true }).click();
};
async function launch() {
  app = await launchDesktopFixture({ root, projectFile: file, profile: path.join(output, 'profile') });
  page = await app.firstWindow(); page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(project.name);
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.webContents.setBackgroundThrottling(false); if (window.isMaximized()) window.unmaximize(); window.setContentSize(1650, 1120); });
  await page.locator('[data-workspace-tab="ui"]').click();
  await page.getByLabel('设计页面', { exact: true }).selectOption('flowchart');
  await page.locator('[data-hierarchy-id="ai_flowchart_items"]').click();
  await page.getByLabel('画面缩放比例', { exact: true }).selectOption('75');
  await page.evaluate(async () => { await document.fonts.ready; });
}
try {
  // This is read-only parsing, never loadProject on the author's real directory.
  const real = parseProject(JSON.parse(original.toString('utf8'))).project, map = real.ui.components.find(c => c.id === 'ai_flowchart_items')!;
  evidence.realProject = [map.style, ...real.ui.flowStyles!.map(style => flowNodeAppearance(real, map, { styleId: style.id }).style)].map(style => ({ blur: style?.shadowBlur, spread: style?.shadowSpread, opacity: style?.shadowOpacity }));
  const rawReal = JSON.parse(original.toString('utf8')) as typeof project;
  const rawRealMap = rawReal.ui.components.find(c => c.id === 'ai_flowchart_items')!;
  assert.deepEqual(map.style, rawRealMap.style);
  assert.deepEqual(real.ui.flowStyles, rawReal.ui.flowStyles);
  // The author's already-current project stores spread 4. Spread 5 belongs to
  // the intentionally authored override in the isolated old-release fixture.
  for (const look of [map, ...real.ui.flowStyles!]) { assert.equal(look.style!.shadowOpacity, .9); assert.equal(look.style!.shadowSpread, 4); }
  const migrated = parseProject(structuredClone(project)).project;
  assert.equal(migrated.ui.components[0].style!.shadowSpread, 4);
  assert.equal(migrated.ui.flowStyles![0].style!.shadowSpread, 5);
  for (const look of [migrated.ui.components[0], ...migrated.ui.flowStyles!]) { assert.equal(look.style!.shadowBlur, 14); assert.equal(look.style!.shadowOpacity, .9); }
  evidence.fixtureMigration = [migrated.ui.components[0], ...migrated.ui.flowStyles!].map(look => ({ id: look.id, spread: look.style!.shadowSpread, opacity: look.style!.shadowOpacity }));
  await launch();
  phase = 'migration, real pixels and caption fitting';
  await base();
  await expect(field('基础文字黑底方式')).toHaveValue('soft');
  await expect(field('黑底柔和度')).toHaveValue('14');
  await expect(field('基础黑底不透明度')).toHaveValue('90');
  const canvas = page!.locator('[data-component-id="ai_flowchart_items"]');
  for (const zoom of ['75', '50']) {
    await page!.getByLabel('画面缩放比例', { exact: true }).selectOption(zoom);
    await page!.mouse.move(5, 5);
    for (const [index, entry] of entries.entries()) {
      const node = canvas.locator(`[data-flow-node="${entry.id}"]`);
      await node.scrollIntoViewIfNeeded();
      const on = PNG.sync.read(await node.screenshot({ path: path.join(output, `${zoom}-${index}-backing.png`) }));
      const bounds = await node.evaluate(el => { const box = el.getBoundingClientRect(); return [...el.querySelectorAll<HTMLElement>('[data-flow-part]')].map(part => { const r = part.getBoundingClientRect(); return { x: r.x - box.x, y: r.y - box.y, width: r.width, height: r.height }; }); });
      const hide = await page!.addStyleTag({ content: '[data-flow-caption-shadow] { visibility: hidden !important; }' });
      const off = PNG.sync.read(await node.screenshot({ path: path.join(output, `${zoom}-${index}-no-backing.png`) })); await hide.evaluate(el => (el as HTMLElement).remove());
      evidence[`${zoom}-${index}`] = assertBacking(on, off, `${zoom}-${index}`);
      if (index < 3) {
        const ratio = on.width / ((await node.boundingBox())!.width);
        evidence[`${zoom}-${index}-parts`] = bounds.map((rect, part) => {
          const crop = { x: (rect.x - 5) * ratio, y: (rect.y - 5) * ratio, width: (rect.width + 10) * ratio, height: (rect.height + 10) * ratio };
          return assertBacking(cropPng(on, crop), cropPng(off, crop), `${zoom}-${index}-part-${part}`);
        });
      }
      const effects = await node.locator('[data-flow-caption]').evaluate(el => { const style = getComputedStyle(el), shadow = getComputedStyle(el.querySelector('[data-flow-caption-shadow]')!); return { fit: Number(style.getPropertyValue('--flow-caption-fit')), stroke: parseFloat(shadow.webkitTextStrokeWidth), blur: parseFloat(shadow.filter.match(/[\d.]+/)?.[0] ?? '0') }; });
      const spread = index === 0 || index === 3 ? 5 : 4;
      assert.ok(Math.abs(effects.fit * effects.stroke - spread * 2 * Number(zoom) / 100) < .2, JSON.stringify(effects));
    }
  }
  checks.push('真实工程已保存的4px黑底只读解析保持不变；隔离旧版fixture升级基础及共享阴影并保留显式扩展5，三种底图、大小分段、长标题及75%/50%缩放的实际像素通过。');

  phase = 'shortcut, inheritance, undo and saving';
  await field('基础文字黑底方式').selectOption('none');
  await expect(field('基础文字黑底方式')).toHaveValue('none');
  await field('基础文字黑底方式').selectOption('custom');
  await expect(field('基础阴影不透明度')).toHaveValue('0');
  await field('基础文字黑底方式').selectOption('soft');
  await expect(field('基础黑底不透明度')).toHaveValue('90');
  await page!.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(field('基础文字黑底方式')).toHaveValue('none');
  await field('基础文字黑底方式').selectOption('soft');
  await preset('ai_flow_main');
  await expect(field('预设文字黑底方式')).toHaveValue('soft');
  await expect(field('预设黑底厚度')).toHaveValue('5');
  await resetShadow();
  await expect(field('预设黑底厚度')).toHaveValue('4');
  await field('预设文字黑底方式').selectOption('none');
  await expect(canvas.locator(`[data-flow-node="${entries[0].id}"] [data-flow-caption-shadow]`)).toHaveCount(0);
  await field('预设文字黑底方式').selectOption('soft');
  await expect(canvas.locator(`[data-flow-node="${entries[0].id}"] [data-flow-caption-shadow]`)).toHaveCount(1);
  await save();
  const saved = await read();
  assert.equal(saved.ui.flowStyles![0].style!.shadowOpacity, .9);
  assert.deepEqual(saved.ui.flowStyles![0].style!.captionParts, project.ui.flowStyles![0].style!.captionParts);
  const otherVisuals = (style: typeof map.style) => { const copy = { ...style }; for (const key of ['shadowX', 'shadowY', 'shadowBlur', 'shadowSpread', 'shadowColor', 'shadowOpacity'] as const) delete copy[key]; return copy; };
  assert.deepEqual(otherVisuals(saved.ui.flowStyles![0].style), otherVisuals(project.ui.flowStyles![0].style));
  // The section button clears the same six shadow fields, keeping every other
  // visual group and all preset identity/references unchanged.
  await view().getByRole('button', { name: '恢复本组文字黑底与阴影', exact: true }).click();
  await expect(group('flow-preset-text-effects').locator('.flow-style-shadow-mode')).toHaveAttribute('data-flow-field-source', '沿用本图基础阴影');
  // Accepting a UI draft clears its undo stack. Exercise undo before saving,
  // then apply the reset again to verify its persisted scope independently.
  await page!.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(group('flow-preset-text-effects').locator('.flow-style-shadow-mode')).toHaveAttribute('data-flow-field-source', '此预设单独设置');
  if (await page!.getByRole('button', { name: '保存界面', exact: true }).isEnabled()) await save();
  assert.deepEqual(await read(), saved);
  await view().getByRole('button', { name: '恢复本组文字黑底与阴影', exact: true }).click();
  await save(); const reset = await read();
  const { style: beforeStyle, ...beforePreset } = saved.ui.flowStyles![0], { style: resetStyle, ...resetPreset } = reset.ui.flowStyles![0];
  assert.deepEqual(resetPreset, beforePreset);
  assert.deepEqual(otherVisuals(resetStyle), otherVisuals(beforeStyle));
  for (const key of ['shadowX', 'shadowY', 'shadowBlur', 'shadowSpread', 'shadowColor', 'shadowOpacity'] as const) assert.equal(resetStyle?.[key], undefined);
  await expect(field('预设黑底厚度')).toHaveValue('4');
  await page!.screenshot({ path: path.join(output, 'restored-editor.png') });
  await app!.close(); app = undefined;
  await launch();
  await expect(page!.locator('[data-flow-caption-shadow]').first()).toBeVisible();
  await base(); await expect(field('基础黑底不透明度')).toHaveValue('90');
  checks.push('基础及预设的无/柔边/自定义入口、精确右键恢复、组恢复、撤销、保存和重开保留黑底；字体、分段、底图及其他外观未改。');

  phase = 'recovery draft keeps new backing and authored edits';
  await app!.close(); app = undefined;
  const primary = JSON.stringify(project), draft = structuredClone(project);
  draft.ui.components[0].style!.shadowY = -.5;
  draft.ui.components[0].style!.captionParts = [{}, {}];
  await fs.writeFile(file, primary); await fs.utimes(file, new Date(0), new Date(0));
  const recovery = JSON.stringify({ savedAt: Date.now(), project, uiDraft: draft, projectDirty: true });
  await fs.writeFile(file + '.autosave', recovery);
  await launch();
  await base();
  await expect(field('基础文字黑底方式')).toHaveValue('custom');
  await expect(field('阴影垂直偏移')).toHaveValue('-0.5');
  await expect(field('阴影柔化')).toHaveValue('14');
  await expect(field('基础阴影不透明度')).toHaveValue('90');
  assert.equal(await fs.readFile(file, 'utf8'), primary);
  await preset('ai_flow_memory');
  await expect(field('预设文字黑底方式')).toHaveValue('soft');
  await expect(field('预设黑底柔和度')).toHaveValue('14');
  checks.push('自动恢复草稿不会盖回旧黑底，草稿中的-0.5偏移及分段修改保留；打开不写主工程文件。');
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, evidence, errors, sourceHash: sha256(original) }, null, 2));
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, error: String(error), checks, evidence, errors }, null, 2)); throw error;
} finally {
  await app?.close();
  assert.equal(sha256(await fs.readFile(originalFile)), sha256(original));
  const cleanup = await cleanVerificationDirectories(output, ['project', 'profile']); assert.deepEqual(cleanup.errors, []);
  console.log(output);
}
