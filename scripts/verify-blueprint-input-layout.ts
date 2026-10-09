import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { expect, type Page } from '@playwright/test';
import { blueprintActionInputsFixture } from './lib/blueprint-action-inputs-fixture';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { createUiEventGraph } from '../src/core/ui-logic';
import { blueprintNodeDefaults, callablePins, connectBlueprintPins, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { timelineNodeActions } from '../src/core/performance-timeline';
import type { Project } from '../src/core/model';

const root = path.resolve('.'), output = path.join(root, 'artifacts/blueprint-input-layout', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true }); const reports = [];
for (const workspace of ['timeline', 'ui'] as const) {
  const folder = path.join(output, workspace), projectFile = path.join(folder, 'project.vns.json'); await fs.mkdir(folder, { recursive: true });
  const { project, graph, pictureId, soundId } = blueprintActionInputsFixture(); project.name = '连续公开时间轴参数验收';
  const oldReaders = new Set(graph.nodes.filter(node => node.type === 'getInput').map(node => node.id));
  graph.nodes = graph.nodes.filter(node => !oldReaders.has(node.id)); graph.links = graph.links.filter(link => !oldReaders.has(link.fromNodeId)); graph.exposedInputs = [];
  for (const id of ['red', 'blue', 'green']) {
    const png = new PNG({ width: 16, height: 16 });
    for (let i = 0; i < png.data.length; i += 4) { png.data[i] = id === 'red' ? 237 : 48; png.data[i + 1] = id === 'green' ? 237 : 48; png.data[i + 2] = id === 'blue' ? 237 : 48; png.data[i + 3] = 255; }
    await fs.writeFile(path.join(folder, id + '.png'), PNG.sync.write(png));
  }
  for (const id of ['source_audio', 'bound_audio']) {
    const wav = Buffer.alloc(44 + 12 * 8000 * 2); wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
    await fs.writeFile(path.join(folder, id + '.wav'), wav);
  }
  let callId: string | undefined;
  if (workspace === 'ui') {
    const owner = createUiEventGraph(project, 'ui:main', '标题'), call = blueprintNodeDefaults('callFunction'); callId = call.id;
    call.properties = { graphId: graph.id, wait: false }; call.pins = callablePins(graph); call.x = 460; call.y = 60; owner.nodes.push(call); connectBlueprintPins(owner, owner.nodes[0].id, 'exec', call.id, 'exec_in');
  }
  synchronizeBlueprintSignatures(project);
  const original = JSON.stringify(project); await fs.writeFile(projectFile, original);
  const actions = (p: Project) => { const g = p.blueprints.find(g => g.id === graph.id)!; return [pictureId, soundId].map(id => timelineNodeActions(p, g, g.nodes.find(n => n.id === id)!)); };
  const beforeActions = actions(project), beforeNodes = structuredClone(graph.nodes);
  const app = await launchDesktopFixture({ root, projectFile, profile: path.join(folder, 'profile') }), page = await app.firstWindow(); page.setDefaultTimeout(10000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); let assistant: Page | undefined;
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  const node = (id: string) => page.locator('.react-flow__node[data-id="' + id + '"]');
  const current = async () => assistant!.evaluate(async () => (await window.studio!.getAiContext!())!.project);
  const currentGraph = async () => (await current()).blueprints.find(g => g.id === graph.id)!;
  const open = async () => {
    if (workspace === 'timeline') { await page.locator('[data-workspace-tab="blueprint"]').click(); await page.getByLabel('演出目标').selectOption('graph:' + graph.id); }
    else { await page.locator('[data-workspace-tab="ui"]').click(); await page.getByLabel('界面编辑模式').getByRole('button', { name: '事件图', exact: true }).click(); await page.getByLabel('事件图页面').selectOption('ui:main'); await button('框选全部节点').click(); await node(callId!).locator('.graph-node-title').dblclick(); }
    if (workspace === 'ui') await expect(button('保存界面')).toBeDisabled();
  };
  const expose = async (nodeId: string, label: string, count: number) => {
    await page.locator('.timeline-clip[data-node-id="' + nodeId + '"]').click();
    const details = page.locator('.timeline-clip-parameters'); if (await details.getAttribute('open') === null) await details.locator('summary').click();
    const row = details.locator('.timeline-parameter').filter({ has: page.locator(':scope > span', { hasText: label }) });
    await row.getByRole('button', { name: '设为参数', exact: true }).click();
    await expect.poll(async () => (await currentGraph()).exposedInputs.length).toBe(count);
    assert.deepEqual(actions(await current()), beforeActions);
  };
  const verifyBoxes = async () => {
    await button('框选全部节点').click();
    await expect.poll(async () => page.locator('.react-flow__node').count()).toBe((await currentGraph()).nodes.length);
    const boxes = await page.locator('.react-flow__node').evaluateAll(nodes => nodes.map(el => ({ id: el.getAttribute('data-id')!, read: !!el.querySelector('.node-kind-getInput'), ...el.getBoundingClientRect().toJSON() })));
    for (const read of boxes.filter(box => box.read)) for (const other of boxes.filter(box => box.id !== read.id)) assert.ok(read.right <= other.left || read.left >= other.right || read.bottom <= other.top || read.top >= other.bottom, 'Displayed reader overlaps node: ' + read.id + ' / ' + other.id);
    for (const read of (await currentGraph()).nodes.filter(n => n.type === 'getInput')) await node(read.id).locator('.graph-node-title').click();
    return boxes;
  };
  try {
    await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 }); await open();
    const opened = app.waitForEvent('window'); await button('AI 助手').click(); assistant = await opened;
    await expose(pictureId, '对象图片', 1); await expose(pictureId, '对象时长', 2); await expose(soundId, '音频素材', 3);
    assert.deepEqual((await currentGraph()).nodes.filter(n => beforeNodes.some(b => b.id === n.id)), beforeNodes);
    await button('查看组件连线').click(); await verifyBoxes();
    const first = (await currentGraph()).nodes.find(n => n.type === 'getInput')!, title = await node(first.id).locator('.graph-node-title').boundingBox(); assert.ok(title);
    await page.mouse.move(title.x + 40, title.y + title.height / 2); await page.mouse.down(); await page.mouse.move(title.x - 70, title.y - 30, { steps: 8 }); await page.mouse.up();
    await expect.poll(async () => (await currentGraph()).nodes.find(n => n.id === first.id)!.x).not.toBe(first.x);
    const moved = structuredClone((await currentGraph()).nodes);
    await button('返回时间轴编辑').click(); await page.waitForTimeout(750); await expose(soundId, '片段音量', 4);
    assert.deepEqual((await currentGraph()).nodes.slice(0, moved.length), moved);
    await page.getByLabel('时间轴画布', { exact: true }).focus(); await page.keyboard.press('Control+z'); await expect.poll(async () => (await currentGraph()).exposedInputs.length).toBe(3);
    await page.keyboard.press('Control+y'); await expect.poll(async () => (await currentGraph()).exposedInputs.length).toBe(4);
    await button('查看组件连线').click(); const boxes = await verifyBoxes();
    const g = await currentGraph(); assert.equal(g.links.filter(l => g.nodes.some(n => n.type === 'getInput' && n.id === l.fromNodeId)).length, 4);
    assert.deepEqual(actions(await current()), beforeActions);
    if (callId) { const call = (await current()).blueprints.flatMap(g => g.nodes).find(n => n.id === callId)!; for (const pin of g.exposedInputs) assert.ok(call.pins.some(p => p.id === 'arg_' + pin.id), 'parent input missing'); }
    assert.equal(await fs.readFile(projectFile, 'utf8'), original); await button(workspace === 'ui' ? '保存界面' : '保存工程').click();
    await expect.poll(async () => JSON.parse(await fs.readFile(projectFile, 'utf8')).blueprints).toEqual((await current()).blueprints);
    await page.reload(); await expect(page.locator('.project-title strong')).toHaveText(project.name); await open();
    const reopened = app.waitForEvent('window'); await button('AI 助手').click(); assistant = await reopened;
    await button('查看组件连线').click(); await verifyBoxes();
    assert.deepEqual((await currentGraph()).nodes, g.nodes); assert.deepEqual((await currentGraph()).links, g.links);
    await page.screenshot({ path: path.join(folder, 'saved-parameter-nodes.png') }); assert.deepEqual(errors, []);
    reports.push({ workspace, projectFile, boxes, nodes: g.nodes.map(n => ({ id: n.id, name: n.name, x: n.x, y: n.y })) });
  } catch (error) { await page.screenshot({ path: path.join(folder, 'failure.png') }).catch(() => undefined); console.error(folder); throw error; }
  finally { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => undefined); await app.close(); }
}
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', compiled: true, checks: ['连续公开图片、时长、音频及音量', '实际节点矩形不重叠且可点击', '保留已有节点及实际拖动位置', '数据接线及有效演出不变', '撤销重做', 'UI外层同步输入及无假草稿', '显式保存重开'], reports }, null, 2)); console.log(output);
