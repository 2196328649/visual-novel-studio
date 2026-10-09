import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { expect, type Page } from '@playwright/test';
import { blueprintActionInputsFixture } from './lib/blueprint-action-inputs-fixture';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { createUiEventGraph } from '../src/core/ui-logic';
import { blueprintNodeDefaults, callablePins, connectBlueprintPins, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { rawSavedBlueprintAction } from '../src/core/blueprint-authoring';
import { timelineNodeActions } from '../src/core/performance-timeline';

const root = path.resolve('.'), output = path.join(root, 'artifacts/blueprint-action-inputs', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true }); const reports = [];
for (const workspace of ['timeline', 'ui'] as const) {
  const folder = path.join(output, workspace), projectFile = path.join(folder, 'project.vns.json'); await fs.mkdir(folder, { recursive: true });
  const { project, graph, pictureId, soundId } = blueprintActionInputsFixture();
  for (const [id, rgb] of [['red', [237, 48, 64]], ['blue', [48, 93, 237]], ['green', [48, 237, 64]]] as const) {
    const png = new PNG({ width: 16, height: 16 }); for (let i = 0; i < png.data.length; i += 4) { png.data[i] = rgb[0]; png.data[i + 1] = rgb[1]; png.data[i + 2] = rgb[2]; png.data[i + 3] = 255; }
    await fs.writeFile(path.join(folder, id + '.png'), PNG.sync.write(png));
  }
  for (const [id, seconds] of [['source_audio', 10], ['bound_audio', 12]] as const) {
    const samples = seconds * 8000, wav = Buffer.alloc(44 + samples * 2);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
    for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(i * Math.PI / 20) * 500), 44 + i * 2);
    await fs.writeFile(path.join(folder, id + '.wav'), wav);
  }
  let callId: string | undefined;
  if (workspace === 'ui') {
    const owner = createUiEventGraph(project, 'ui:main', '标题'), call = blueprintNodeDefaults('callFunction'); callId = call.id;
    call.properties = { graphId: graph.id, wait: false }; call.pins = callablePins(graph); call.x = 460; call.y = 60; owner.nodes.push(call); connectBlueprintPins(owner, owner.nodes[0].id, 'exec', call.id, 'exec_in');
  }
  synchronizeBlueprintSignatures(project);
  const original = JSON.stringify(project); await fs.writeFile(projectFile, original);
  const app = await launchDesktopFixture({ root, projectFile, profile: path.join(folder, 'profile') }), page = await app.firstWindow(); page.setDefaultTimeout(10000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); let assistant: Page | undefined;
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  const node = (id: string) => page.locator('.react-flow__node[data-id="' + id + '"]');
  const current = async () => (await assistant!.evaluate(async () => (await window.studio!.getAiContext!())!.project));
  const state = async (id: string) => { const p = await current(), g = p.blueprints.find(g => g.id === graph.id)!, n = g.nodes.find(n => n.id === id)!; return { graph: g, node: n, raw: rawSavedBlueprintAction(n)!, resolved: timelineNodeActions(p, g, n)[0] }; };
  const set = async (label: string, value: string) => { const field = page.getByLabel('蓝图属性').getByLabel(label, { exact: true }); await field.fill(value); await field.press('Tab'); };
  const open = async () => {
    if (workspace === 'timeline') { await page.locator('[data-workspace-tab="blueprint"]').click(); await page.getByLabel('演出目标').selectOption('graph:' + graph.id); }
    else { await page.locator('[data-workspace-tab="ui"]').click(); await page.getByLabel('界面编辑模式').getByRole('button', { name: '事件图', exact: true }).click(); await page.getByLabel('事件图页面').selectOption('ui:main'); await button('框选全部节点').click(); await node(callId!).locator('.graph-node-title').dblclick(); }
    await button('查看组件连线').click(); await button('框选全部节点').click();
    if (workspace === 'ui') await expect(button('保存界面')).toBeDisabled();
  };
  try {
    await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 }); await open();
    const opened = app.waitForEvent('window'); await button('AI 助手').click(); assistant = await opened;
    await node(pictureId).locator('.graph-node-title').click(); await expect(page.getByLabel('对象持续秒数', { exact: true })).toHaveValue('3');
    await set('对象名称', '保留输入图片'); await set('对象宽度 %', '50');
    let picture = await state(pictureId); assert.ok(picture.raw.kind === 'visual' && picture.resolved.kind === 'visual');
    assert.deepEqual([picture.raw.assetId, picture.raw.duration, picture.node.properties.object_assetId, picture.node.properties.object_duration], ['red', 3, 'green', 6]);
    assert.deepEqual([picture.resolved.assetId, picture.resolved.duration, picture.resolved.curves!.x!.at(-1)!.at], ['blue', 6, 6]);
    // UI history intentionally groups repeated edits within 700 ms; separate this action.
    await page.waitForTimeout(750); await set('对象持续秒数', '4'); await expect.poll(async () => (await state(pictureId)).node.properties.object_duration).toBeUndefined();
    await button('框选全部节点').focus(); await page.keyboard.press('Control+z'); await expect.poll(async () => (await state(pictureId)).node.properties.object_duration).toBe(6);
    await page.keyboard.press('Control+y'); await expect.poll(async () => (await state(pictureId)).resolved.kind === 'visual' ? ((await state(pictureId)).resolved as any).duration : -1).toBe(4);
    await page.keyboard.press('Control+z'); await expect.poll(async () => (await state(pictureId)).node.properties.object_duration).toBe(6);
    await button('框选全部节点').click(); await node(soundId).locator('.graph-node-title').click();
    await expect(page.getByLabel('音频片段时长', { exact: true })).toHaveValue('3'); await expect(page.getByLabel('音频截取起点', { exact: true })).toHaveValue('1'); await expect(page.getByLabel('音频片段音量', { exact: true })).toHaveValue('100');
    await set('音频片段名称', '保留输入声音'); await set('音频淡入秒数', '0.2');
    let sound = await state(soundId); assert.ok(sound.raw.kind === 'audioClip' && sound.resolved.kind === 'audioClip');
    assert.deepEqual([sound.raw.duration, sound.raw.offset, sound.raw.volume, sound.raw.sourceDuration], [3, 1, 1, 10]);
    assert.deepEqual([sound.resolved.assetId, sound.resolved.duration, sound.resolved.offset, sound.resolved.volume, sound.resolved.fadeIn], ['bound_audio', 4, 2, .3, .2]);
    await page.waitForTimeout(750); await set('音频片段音量', '80'); await expect.poll(async () => (await state(soundId)).node.properties.clip_volume).toBeUndefined();
    await button('框选全部节点').focus(); await page.keyboard.press('Control+z'); await expect.poll(async () => (await state(soundId)).node.properties.clip_volume).toBe(.3);
    await page.keyboard.press('Control+y'); await expect.poll(async () => (await state(soundId)).node.properties.clip_volume).toBeUndefined();
    await button('返回时间轴编辑').click(); await page.getByLabel('轨道缩放', { exact: true }).selectOption('60');
    const ruler = await page.getByLabel('时间标尺', { exact: true }).boundingBox(); assert.ok(ruler); await page.mouse.click(ruler.x + 130 + 3 * 60, ruler.y + 12);
    const visual = page.locator('[data-visual-instance="bound_picture"]'); await expect(visual).toBeVisible();
    await expect.poll(async () => Number((await visual.locator(':scope > g').getAttribute('transform'))?.match(/^translate\(([-\d.]+)/)?.[1])).toBeCloseTo(project.width * .5, 2);
    const png = PNG.sync.read(await page.locator('.text-stage').screenshot()); let blue = 0; for (let i = 0; i < png.data.length; i += 4) if (png.data[i] < 100 && png.data[i + 1] < 140 && png.data[i + 2] > 180) blue++; assert.ok(blue > 1000);
    assert.equal(await fs.readFile(projectFile, 'utf8'), original); await button(workspace === 'ui' ? '保存界面' : '保存工程').click();
    await expect.poll(async () => JSON.parse(await fs.readFile(projectFile, 'utf8')).blueprints).toEqual((await current()).blueprints);
    const saved = JSON.parse(await fs.readFile(projectFile, 'utf8')); assert.deepEqual(saved.blueprints.find((g: any) => g.id === graph.id).links.filter((l: any) => l.toPinId === 'object_assetId' || l.toPinId === 'clip_assetId'), graph.links.filter(l => l.toPinId === 'object_assetId' || l.toPinId === 'clip_assetId'));
    await page.reload(); await expect(page.locator('.project-title strong')).toHaveText(project.name); await open(); await node(pictureId).locator('.graph-node-title').click(); await expect(page.getByLabel('对象持续秒数', { exact: true })).toHaveValue('3');
    await page.screenshot({ path: path.join(folder, 'saved-source-inspector.png') }); assert.deepEqual(errors, []); reports.push({ workspace, projectFile, bluePixels: blue });
  } catch (error) { await page.screenshot({ path: path.join(folder, 'failure.png') }).catch(() => undefined); console.error(folder); throw error; }
  finally { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => undefined); await app.close(); }
}
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', compiled: true, reports, checks: ['原始图片与音频参数可见', '改名/尺寸/淡入保留无关输入和源时钟', '修改对应时长/音量只清该项覆盖', '撤销重做', '实际蓝色图片和中点位置', '数据线保留及显式保存重开'] }, null, 2)); console.log(output);
