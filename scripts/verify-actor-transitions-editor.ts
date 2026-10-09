import { createShowCharacterFixture } from './lib/show-character-fixture';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { PNG } from 'pngjs';
import { createProject, projectSchema } from '../src/core/model';
import { projectToText } from '../src/core/text-script';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';

const root = path.resolve('.'), output = path.join(root, 'artifacts/actor-transitions-editor', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(path.join(output, 'screenshots'), { recursive: true });
const project = createProject('角色过渡与演出设置验收');
project.assets = [{ id: 'portrait', name: '立绘', kind: 'image', path: 'portrait.svg', width: 180, height: 300 }];
await fs.writeFile(path.join(output, 'portrait.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="300"><rect width="180" height="300" fill="#c05060"/></svg>');
project.characters = [{ id: 'hero', name: '角色甲', color: '#ffffff', expressions: [{ id: 'normal', name: '默认', assetId: 'portrait' }] }];
project.assets.push({ id: 'green', name: '新表情', kind: 'image', path: 'green.svg', width: 180, height: 300 });
project.characters[0].expressions.push({ id: 'green', name: '新表情', assetId: 'green' });
await fs.writeFile(path.join(output, 'green.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="300"><rect width="180" height="300" fill="#30d046"/></svg>');
project.blueprints = [createShowCharacterFixture()];
const node = project.nodes.find(n => n.kind === 'passage')!;
project.entryId = node.id;
node.lines = [
  { id: 'first', speakerId: 'hero', text: '测试入场与离场设置。', actions: [{ kind: 'show', characterId: 'hero', expressionId: 'normal', x: .5, y: 1, scale: 1, layer: 10, lifetime: 'line', transition: 'dissolve' }] },
  { id: 'second', speakerId: 'hero', text: '测试本次蓝图调用设置。', actions: [{ kind: 'blueprint', blueprintId: 'fixture_show_character' }] },
  ...['normal', 'green'].map((expressionId, index) => ({ id: 'blend_' + index, speakerId: 'hero', text: '表情混合测试' + index, actions: [{ kind: 'show' as const, characterId: 'hero', expressionId, x: .5, y: 1, scale: 1, layer: 10, lifetime: 'line' as const, transition: 'dissolve' as const, actorTransitions: { expression: { mode: 'dissolve' as const, duration: .4 } } }] })),
];
project.scriptText = { format: 'vns-text-1', content: projectToText(project) };
const projectFile = path.join(output, 'project.vns.json');
await fs.writeFile(projectFile, JSON.stringify(projectSchema.parse(project)));
const app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') });
const page = await app.firstWindow(), errors: string[] = [];
page.on('pageerror', e => errors.push(e.message));
try {
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 960));
  await openStoryMode(page, 'script');
  await page.locator('#line-first textarea').click();
  const panel = page.locator('.story-preview-content .passage-performances');
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel('角色过渡 · 入场过渡', { exact: true })).toBeVisible();
  await panel.getByLabel('角色过渡 · 入场过渡', { exact: true }).selectOption('move');
  await panel.getByLabel('角色过渡 · 入场过渡时长', { exact: true }).fill('0.6');
  await panel.getByLabel('角色过渡 · 入场过渡时长', { exact: true }).press('Tab');
  await panel.getByLabel('角色过渡 · 离场过渡', { exact: true }).selectOption('dissolve');
  await panel.getByLabel('角色过渡 · 离场过渡时长', { exact: true }).fill('0.8');
  await panel.getByLabel('角色过渡 · 离场过渡时长', { exact: true }).press('Tab');
  await page.screenshot({ path: path.join(output, 'screenshots', 'module-settings.png') });
  await openStoryMode(page, 'text');
  const input = page.getByLabel('中文文本剧本', { exact: true });
  const selectFirst = async () => {
    const text = await input.inputValue(), line = text.slice(0, text.indexOf('测试入场')).split('\n').length;
    await page.getByRole('button', { name: '转到第 ' + line + ' 行', exact: true }).click();
  };
  const toggle = page.getByRole('button', { name: '隐藏演出', exact: true });
  for (const hidden of [false, true]) {
    if (await toggle.getAttribute('aria-pressed') !== String(hidden)) await toggle.click();
    await selectFirst();
    await expect(panel).toBeVisible();
    await expect(panel.getByLabel('角色过渡 · 入场过渡', { exact: true })).toHaveValue('move');
    await page.screenshot({ path: path.join(output, 'screenshots', hidden ? 'text-hidden.png' : 'text-visible.png') });
  }
  if (await toggle.getAttribute('aria-pressed') === 'true') await toggle.click();
  const validText = await input.inputValue();
  await input.fill(validText + '\n@显示角色：不存在的角色');
  await selectFirst();
  await expect(panel.getByRole('status')).toContainText('文本中有未完成或无效的指令');
  await input.fill(validText); await selectFirst();
  await panel.getByRole('button', { name: /^编辑显示角色/ }).first().click();
  await expect(panel.getByLabel('角色过渡 · 入场过渡', { exact: true })).toHaveValue('move');
  await openStoryMode(page, 'script');
  await page.locator('#line-second textarea').click();
  await panel.getByLabel('本次角色过渡 · 表情切换过渡', { exact: true }).selectOption('fade');
  await panel.getByLabel('本次角色过渡 · 表情切换过渡时长', { exact: true }).fill('0.3');
  await panel.getByLabel('本次角色过渡 · 表情切换过渡时长', { exact: true }).press('Tab');
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  const saved = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8'))), passage = saved.nodes.find(n => n.id === node.id)!;
  assert.ok(passage.kind === 'passage');
  const first = passage.lines[0].actions[0], second = passage.lines[1].actions[0];
  assert.ok(first.kind === 'show' && second.kind === 'blueprint');
  assert.deepEqual(first.actorTransitions, { enter: { mode: 'move', duration: .6 }, exit: { mode: 'dissolve', duration: .8 } });
  assert.deepEqual(second.actorTransitions, { expression: { mode: 'fade', duration: .3 } });
  await page.locator('#line-blend_1 textarea').click();
  const seek = page.getByLabel('定位演出时间（秒）', { exact: true });
  await seek.fill('0.2'); await seek.press('Tab');
  const blend = page.locator('.story-preview-content .actor-crossfade');
  await expect(blend).toBeVisible();
  await expect(blend.locator('.text-stage-actor')).toHaveCount(2);
  const style = await page.addStyleTag({ content: '.ui-dialogue-preview { visibility: hidden !important; }' });
  const png = PNG.sync.read(await blend.screenshot({ path: path.join(output, 'screenshots', 'expression-midpoint.png') }));
  const at = (Math.floor(png.height * .9) * png.width + Math.floor(png.width * .5)) * 4;
  const actual = [...png.data.subarray(at, at + 3)];
  assert.ok(actual.every((value, index) => Math.abs(value - [120, 144, 83][index]) <= 3), 'crossfade matches native premultiplied colors: ' + actual);
  await style.evaluate(element => element.parentNode?.removeChild(element));
  await page.reload();
  await expect(page.locator('.project-title strong')).toHaveText(project.name);
  await openStoryMode(page, 'script');
  await page.locator('#line-first textarea').click();
  await expect(panel.getByLabel('角色过渡 · 离场过渡时长', { exact: true })).toHaveValue('0.8');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1100, 720));
  const fields = panel.locator('.actor-transition-fields');
  await fields.scrollIntoViewIfNeeded();
  assert.ok(await fields.evaluate(e => e.scrollWidth <= e.clientWidth + 2));
  await page.screenshot({ path: path.join(output, 'screenshots', 'small-window.png') });
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks: ['module panel visible and editable', 'text panel visible with commands shown or hidden', 'three phase fields and call override save/reopen', 'small window fields fit'], errors }, null, 2));
} catch (error) { await page.screenshot({ path: path.join(output, 'screenshots', 'failure.png') }).catch(() => undefined); throw error; }
finally { await app.close(); console.log(output); }
