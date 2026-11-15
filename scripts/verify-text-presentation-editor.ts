import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { projectSchema } from '../src/core/model';
import { loadProject, saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

// Authoring a line's text look from the per-line effects: presets, duration speed,
// entrance and loop effects, live preview, saving a preset and the text-mode command.
const root = path.resolve('.');
const artifactRoot = process.env.VNS_ARTIFACT_ROOT ? path.resolve(process.env.VNS_ARTIFACT_ROOT) : path.join(root, 'artifacts');
const output = path.join(artifactRoot, 'text-presentation-editor', new Date().toISOString().replaceAll(':', '-'));
const projectFile = path.join(output, 'project/project.vns.json'), template = path.join(root, 'resources/templates/aihong');
await saveProject(projectFile, (await loadProject(path.join(template, 'project.vns.json'))).project, template);
const app = await launchDesktopFixture({ root, profile: path.join(output, 'profile'), projectFile });
const page = await app.firstWindow(), errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
const checks: string[] = [];
try {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 1050));
  await openStoryMode(page, 'script');
  const row = page.locator('#line-opening_line_1');
  // Stage actions stay above the line; the arrow opens only the dialogue's text settings below it.
  await expect(row.getByRole('region', { name: '第1行台词文字演出', exact: true })).toHaveCount(0);
  await expect(row.locator('.line-effect-chip').first()).toBeVisible();
  await expect(row.locator('.line-expand > span')).toHaveCount(0);
  await row.getByRole('button', { name: '展开第1行台词文字演出', exact: true }).click();
  const editor = row.getByRole('region', { name: '第1行台词文字演出', exact: true });
  const inputBox = (await row.locator('.dialogue-input').boundingBox())!, panelBox = (await editor.boundingBox())!;
  assert.ok(panelBox.y >= inputBox.y + inputBox.height, JSON.stringify({ inputBox, panelBox }));
  const stripBox = (await row.locator('.line-effect-strip').boundingBox())!;
  assert.ok(stripBox.y + stripBox.height <= inputBox.y);
  await expect(editor.locator('.line-effect-chip')).toHaveCount(0);
  await expect(editor.getByRole('tab', { name: /^舞台演出|^配音$/ })).toHaveCount(0);
  await expect(row.getByRole('button', { name: '为第1行添加效果', exact: true })).toBeVisible();
  checks.push('舞台演出常驻台词上方，箭头只展开台词下方的文字设置，不计算舞台动作数量');
  await editor.getByRole('tab', { name: '文字样式', exact: true }).click();
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel('文字演出效果预览', { exact: true })).toBeVisible();
  checks.push('台词箭头打开文字演出，面板内有效果预览');

  await editor.getByLabel('文字演出预设', { exact: true }).selectOption('builtin_text_whisper');
  await expect(row.locator('.line-expand')).toHaveAttribute('title', /低语/);
  await expect(editor.getByLabel('斜体', { exact: true })).toBeChecked();
  checks.push('套用内置预设后出现“文字”标签，字段显示预设值');

  const tab = (name: string) => editor.getByRole('tab', { name, exact: true }).click();
  await tab('播放速度');
  await editor.getByLabel('显示方式', { exact: true }).selectOption('duration');
  const duration = editor.getByLabel('整句时长（秒）', { exact: true });
  await duration.fill('2.5'); await duration.press('Tab');
  await expect(editor.getByRole('status').filter({ hasText: /整句目标 2\.5 秒，实际约 2\.5 秒完成/ })).toBeVisible();
  await tab('文字动画');
  await editor.getByLabel('入场效果', { exact: true }).selectOption('drop');
  await editor.getByLabel('持续效果', { exact: true }).selectOption('wave');
  await expect(editor.locator('.text-look-row.is-set')).toHaveCount(2);
  await tab('文字样式');
  await editor.getByLabel('文字颜色', { exact: true }).fill('#ff0000');
  await expect(editor.locator('.text-look-row.is-set')).toHaveCount(1);
  await expect(editor.locator('.text-look-tabs .is-set')).toHaveCount(3);
  checks.push('按时长显示、入场与持续效果、颜色在预设基础上单独调整，并标记为已设置');

  const preview = page.locator('.ui-dialogue-preview .styled-text').first();
  await expect(preview).toHaveAttribute('data-text-loop', 'wave');
  assert.equal(await preview.evaluate(node => getComputedStyle(node).color), 'rgb(255, 0, 0)');
  assert.equal(await preview.evaluate(node => getComputedStyle(node).fontStyle), 'italic');
  assert.equal(await preview.evaluate(node => getComputedStyle(node.closest('.ui-text-content, .ui-dialogue-native')!).overflowY), 'visible');
  checks.push('剧本预览中的台词使用相同的颜色、斜体与波浪效果，动效不会让预览出现滚动条');

  // A field's reset arrow returns it to the preset.
  await editor.locator('.text-look-row.is-set', { has: page.getByLabel('文字颜色', { exact: true }) }).getByRole('button', { name: '恢复为继承值', exact: true }).click();
  await expect(editor.locator('.text-look-row.is-set')).toHaveCount(0);
  assert.equal(await preview.evaluate(node => getComputedStyle(node).color), 'rgb(185, 195, 214)');
  await editor.getByLabel('文字颜色', { exact: true }).fill('#ff0000');
  checks.push('单项恢复回到预设值');

  await editor.getByRole('button', { name: '存为预设', exact: true }).click();
  await editor.getByLabel('新预设名称', { exact: true }).fill('心声');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editor.getByLabel('文字演出预设', { exact: true }).locator('option:checked')).toHaveText('心声');
  await expect(editor.locator('.text-look-tabs .is-set')).toHaveCount(0);
  await expect(row.locator('.line-expand')).toHaveAttribute('title', /心声/);
  checks.push('存为预设后本句改为引用新预设');

  await page.screenshot({ path: path.join(output, 'module.png') });
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  const saved = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
  const preset = saved.textPresets?.find(item => item.name === '心声');
  assert.ok(preset);
  assert.deepEqual(preset.style, { sizeScale: .85, color: '#ff0000', italic: true, speed: 'duration', cps: 12, entrance: 'drop', entranceTime: .4, duration: 2.5, loop: 'wave' });
  const line = saved.nodes.flatMap(node => node.kind === 'passage' ? node.lines : []).find(item => item.id === 'opening_line_1');
  assert.deepEqual(line?.textPresentation, { presetId: preset.id });
  checks.push('保存后工程记录预设与本句引用');

  // Part-line effects: select words in the dialogue box and style only them.
  await row.getByRole('button', { name: '收起第1行台词文字演出', exact: true }).click();
  const box = row.locator('.dialogue-input');
  const words = line!.text;
  const from = 2, to = 5, picked = Array.from(words).slice(from, to).join('');
  // Select the words the way an author does: click in, move to them, extend with Shift.
  await box.click();
  await page.keyboard.press('Control+Home');
  for (let step = 0; step < from; step++) await page.keyboard.press('ArrowRight');
  for (let step = from; step < to; step++) await page.keyboard.press('Shift+ArrowRight');
  const toolbar = row.getByRole('toolbar', { name: '选中文字效果', exact: true });
  await expect(toolbar).toBeVisible();
  await expect(toolbar.locator('.text-selection-words')).toHaveText(picked);
  await toolbar.getByLabel('局部文字颜色', { exact: true }).fill('#00ff00');
  await toolbar.getByLabel('局部粗体', { exact: true }).click();
  await toolbar.getByLabel('局部入场效果', { exact: true }).selectOption('slam');
  await toolbar.getByLabel('局部持续效果', { exact: true }).selectOption('shake');
  const pause = toolbar.getByLabel('在选中文字前停顿（秒）', { exact: true });
  await pause.fill('0.8'); await pause.press('Tab');
  await expect(row.locator('.line-expand')).toHaveAttribute('title', /局部 2/);
  checks.push('选中台词中的几个字后出现工具条，可设置颜色、粗体、入场、抖动和停顿');

  const styledWord = page.locator('.ui-dialogue-preview .styled-char-loop[data-text-span]');
  await expect(styledWord).toHaveCount(to - from);
  assert.equal(await styledWord.first().evaluate(node => getComputedStyle(node).color), 'rgb(0, 255, 0)');
  await expect(styledWord.first()).toHaveAttribute('data-text-loop', 'shake');
  checks.push('剧本预览只给选中的字加颜色与抖动');

  // Typing in front of the words keeps the effect on the same words.
  await box.evaluate(node => { const area = node as HTMLTextAreaElement; area.focus(); area.setSelectionRange(0, 0); });
  await page.keyboard.type('唉，');
  await editor.getByRole('tab', { name: /^局部效果/ }).click();
  const list = page.locator('.text-mark-list');
  await expect(list.locator('[data-text-mark="span"] strong')).toHaveText(picked);
  await expect(list.locator('[data-text-mark="pause"]')).toHaveCount(1);
  checks.push('在前面输入文字后，效果仍在原来的字上，并列在“局部效果”中');
  await page.screenshot({ path: path.join(output, 'part-line.png') });

  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  const marked = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8'))).nodes.flatMap(node => node.kind === 'passage' ? node.lines : []).find(item => item.id === 'opening_line_1')!;
  assert.equal(marked.text, '唉，' + words);
  assert.deepEqual(marked.textSpans, [{ start: from + 2, end: to + 2, style: { color: '#00ff00', bold: true, entrance: 'slam', loop: 'shake' } }]);
  assert.deepEqual(marked.textPauses, [{ at: from + 2, seconds: .8 }]);
  checks.push('保存后局部效果按字位置记录');

  // Screen text is placed by dragging it on the preview.
  await editor.getByRole('tab', { name: '位置', exact: true }).click();
  await editor.getByLabel('显示位置', { exact: true }).selectOption('screen');
  const screenText = page.locator('.dialogue-screen-text.is-draggable');
  await expect(screenText).toBeVisible();
  const stage = (await page.locator('.ui-dialogue-preview').first().boundingBox())!;
  const drag = async (dx: number, dy: number) => {
    const area = (await screenText.boundingBox())!, x = area.x + area.width / 2, y = area.y + area.height / 2;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y + dy, { steps: 6 }); await page.mouse.up();
  };
  const placed = async () => {
    await page.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page.locator('.dirty-dot')).toHaveCount(0);
    const file = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
    const { x, y, width } = file.nodes.flatMap(node => node.kind === 'passage' ? node.lines : []).find(item => item.id === 'opening_line_1')!.textPresentation!;
    return { x, y, width };
  };
  await drag(stage.width * .2, stage.height * .1);
  const moved = await placed();
  assert.ok(Math.abs(moved.x! - .7) < .01 && Math.abs(moved.y! - .6) < .01, JSON.stringify(moved));
  // Nearly back at the centre, the text snaps onto it.
  await drag(-stage.width * .2 + 3, -stage.height * .1 - 2);
  assert.deepEqual(await placed(), { x: .5, y: .5, width: moved.width });
  await screenText.focus(); await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await placed()).x).toBe(.505);
  // The side handle changes the width around the centre.
  const before = (await screenText.boundingBox())!;
  await screenText.hover();
  const handle = (await screenText.locator('.dialogue-screen-handle.is-right').boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down(); await page.mouse.move(handle.x + handle.width / 2 - stage.width * .1, handle.y + handle.height / 2, { steps: 5 }); await page.mouse.up();
  const resized = await placed();
  assert.ok(Math.abs(resized.width! - (before.width / stage.width - .2)) < .02, JSON.stringify(resized));
  assert.equal(resized.x, .505);
  await expect(editor.getByLabel('横向位置 %', { exact: true })).toHaveValue('50.5');
  checks.push('画面文字可在预览中拖动、吸附中线、方向键微调、拖手柄改宽度，属性面板同步');
  await page.screenshot({ path: path.join(output, 'screen-drag.png') });

  // A typing sound comes from the asset browser and rides with the line.
  await editor.getByRole('tab', { name: '打字音', exact: true }).click();
  await editor.getByRole('button', { name: /打字音/ }).first().click();
  const sounds = page.getByRole('dialog', { name: '打字音资源浏览器', exact: true });
  await expect(sounds).toBeVisible();
  await sounds.locator('.asset-picker-card[aria-pressed="false"]').first().dblclick();
  await expect(editor.getByLabel('每隔几个字响一次', { exact: true })).toHaveValue('2');
  await editor.getByLabel('每隔几个字响一次', { exact: true }).fill('3'); await editor.getByLabel('每隔几个字响一次', { exact: true }).press('Tab');
  await editor.getByLabel('音量 %', { exact: true }).fill('50'); await editor.getByLabel('音量 %', { exact: true }).press('Tab');
  await expect(row.locator('.line-expand')).toHaveAttribute('title', /打字音/);
  await page.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page.locator('.dirty-dot')).toHaveCount(0);
  const withSound = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8'))).nodes.flatMap(node => node.kind === 'passage' ? node.lines : []).find(item => item.id === 'opening_line_1')!.textPresentation!;
  assert.ok(withSound.typeSoundId); assert.equal(withSound.typeSoundEvery, 3); assert.equal(withSound.typeSoundVolume, .5);
  checks.push('打字音可从素材中选择，并设置间隔和音量');

  // The animator: start from a named effect and adjust it; exits work the same way.
  await editor.getByRole('tab', { name: '文字动画', exact: true }).click();
  await editor.locator('summary').filter({ hasText: /^调整入场动画/ }).click();
  await expect(editor.getByLabel('入场纵向位移', { exact: true })).toHaveValue('-36');
  await editor.getByLabel('入场旋转角度', { exact: true }).fill('90'); await editor.getByLabel('入场旋转角度', { exact: true }).press('Tab');
  await editor.getByLabel('入场缩放 %', { exact: true }).fill('50'); await editor.getByLabel('入场缩放 %', { exact: true }).press('Tab');
  await editor.getByLabel('入场运动曲线', { exact: true }).selectOption('back');
  await editor.getByLabel('入场顺序', { exact: true }).selectOption('center');
  await editor.getByRole('tab', { name: '文字退场', exact: true }).click();
  await editor.getByLabel('退场效果', { exact: true }).selectOption('rise');
  await editor.getByLabel('退场总时长（秒）', { exact: true }).fill('0.8'); await editor.getByLabel('退场总时长（秒）', { exact: true }).press('Tab');
  await editor.locator('summary').filter({ hasText: /^调整退场动画/ }).click();
  await editor.getByLabel('退场顺序', { exact: true }).selectOption('random');
  await page.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page.locator('.dirty-dot')).toHaveCount(0);
  const animated = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8'))).nodes.flatMap(node => node.kind === 'passage' ? node.lines : []).find(item => item.id === 'opening_line_1')!.textPresentation!;
  assert.deepEqual(animated.entranceAnimation, { rotation: 90, scale: .5, easing: 'back', order: 'center' });
  assert.deepEqual([animated.exit, animated.exitTotal, animated.exitAnimation], ['rise', .8, { order: 'random' }]);
  checks.push('入场和退场都能从预设效果出发，调整旋转、缩放、曲线和顺序，只保存改过的项目');
  // The sample plays the exit too: after its hold, characters are moving out and then gone.
  const sampleChars = editor.locator('.text-look-sample .styled-char');
  await editor.getByRole('button', { name: '重播', exact: true }).click();
  await expect.poll(async () => sampleChars.evaluateAll(nodes => nodes.filter(node => (node as HTMLElement).style.opacity === '0').length), { timeout: 15000 }).toBeGreaterThan(0);
  await page.screenshot({ path: path.join(output, 'animator.png') });
  // Choosing another effect starts over, and the panel says so.
  await editor.getByRole('tab', { name: '文字动画', exact: true }).click();
  await editor.getByLabel('入场效果', { exact: true }).selectOption('fade');
  await expect(editor.locator('summary').filter({ hasText: /^调整入场动画$/ })).toBeVisible();
  await page.getByRole('button', { name: '撤销', exact: true }).first().click();
  await expect(editor.locator('summary').filter({ hasText: /^调整入场动画 · 已调整$/ })).toBeVisible();
  checks.push('换效果时清除旧调整，可撤销');

  await openStoryMode(page, 'text');
  await expect(page.locator('.text-source-panel')).toContainText(`@文字演出：预设=心声【${preset.id}】`);
  await expect(page.locator('.text-source-panel')).toContainText(`〖停顿=0.8〗〖${picked}｜颜色=#00ff00，粗体，入场=逐字砸入，持续效果=抖动〗`);
  await expect(page.locator('.text-source-panel')).toContainText('入场旋转=90');
  await expect(page.locator('.text-source-panel')).toContainText('退场=逐字飘起，退场总时长=0.8，退场顺序=随机');
  await page.screenshot({ path: path.join(output, 'text.png') });
  checks.push('文本模式显示 @文字演出 指令与〖〗局部效果标记');
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks }, null, 2));
} finally {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => undefined);
  await app.close();
  const cleanup = await cleanVerificationDirectories(output, ['project', 'profile']);
  assert.deepEqual(cleanup.errors, []);
  console.log(output);
}
