import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { expect, type Page } from '@playwright/test';
import { createProject, type BlueprintGraph } from '../src/core/model';
import { createBlueprintGraph, blueprintNodeDefaults, connectBlueprintPins, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { createUiEventGraph } from '../src/core/ui-logic';
import { defaultAiConfig } from '../src/core/ai';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';

const root = path.resolve('.'), output = path.join(root, 'artifacts/ai-graph-selection', new Date().toISOString().replaceAll(':', '-'));
const profile = path.join(output, 'profile'), projectFile = path.join(output, 'project/project.vns.json'); await fs.mkdir(profile, { recursive: true });
const project = createProject('AI 多选与连线验收'); project.variables.push({ id: 'counter', name: '计数', type: 'number', initial: 0, persistent: false });
function populate(graph: BlueprintGraph) {
 const nodes = [1, 2, 3].map(value => { const n = blueprintNodeDefaults('setVariable'); n.name = '同名节点'; n.properties = { variableId: 'counter', value }; return n; });
 const read = blueprintNodeDefaults('getVariable'); read.properties.variableId = 'counter';
 graph.nodes.push(...nodes, read);
 graph.nodes.forEach((n, i) => { n.x = [0, 370, 740, 740, 0][i]; n.y = i < 3 ? 0 : 430; });
 connectBlueprintPins(graph, graph.nodes[0].id, 'exec', nodes[0].id, 'exec_in'); connectBlueprintPins(graph, nodes[0].id, 'exec_out', nodes[1].id, 'exec_in'); connectBlueprintPins(graph, read.id, 'value', nodes[1].id, 'value'); connectBlueprintPins(graph, read.id, 'value', nodes[2].id, 'value');
 return { graph, a: nodes[0], b: nodes[1], c: nodes[2], read, exec: graph.links[1], data: graph.links[2] };
}
const first = populate(createBlueprintGraph('function', '普通节点蓝图')); project.blueprints.push(first.graph);
project.ui.components = [{ id: 'caption', name: '提示文字', kind: 'text', page: 'main', text: '文字', x: .2, y: .2, width: .4, height: .1 }];
const ui = populate(createUiEventGraph(project, 'ui:main', '标题页面'));
synchronizeBlueprintSignatures(project); await saveProject(projectFile, project);
let mode: 'move' | 'rewire' | 'disconnect' | 'mixed' = 'move', target = first;
let hold = true, release: (() => void) | undefined, waiting = false;
const captures: any[] = [], reads: any[] = [], serverErrors: string[] = [];
const server = createServer(async (req, res) => {
 try {
  let raw = ''; for await (const chunk of req) raw += chunk; const body = JSON.parse(raw), content: string = body.messages.at(-1).content;
  let answer: unknown;
  if (!content.startsWith('以下为只读工程数据')) {
   const data = JSON.parse(content.slice(content.indexOf('\n{') + 1)); captures.push({ mode, selection: data.selectedBlueprint });
   assert.equal(data.selectedBlueprint.graphId, target.graph.id);
   if (hold) { waiting = true; await new Promise<void>(resolve => { release = resolve; }); hold = false; }
   answer = { operations: [], read: [{ kind: 'selectedBlueprint', elements: 'nodes', limit: 10 }, { kind: 'selectedBlueprint', elements: 'links', limit: 10 }, { kind: 'project', path: ['blueprints', { id: target.graph.id }, 'links'], limit: 100 }] };
  } else {
   const results = JSON.parse(content.slice(content.indexOf('\n') + 1)); reads.push(results);
   assert.ok(results.every((r: any) => !r.error), JSON.stringify(results));
   const nodes = results[0].result.items, links = results[1].result.items, allLinks = results[2].result.items;
   const set = (kind: string, id: string, field: string, value: unknown) => ({ kind: 'editProject', path: ['blueprints', { id: target.graph.id }, kind, { id }, field], action: 'set', value });
   const remove = (kind: string, id: string) => ({ kind: 'editProject', path: ['blueprints', { id: target.graph.id }, kind, { id }], action: 'remove' });
   let operations;
   if (mode === 'move') { assert.deepEqual(nodes.map((n: any) => n.id).sort(), [target.a.id, target.b.id].sort()); operations = nodes.map((n: any) => set('nodes', n.id, 'x', n.x + 120)); }
   else if (mode === 'rewire') { assert.equal(nodes.length, 0); assert.deepEqual(links.map((l: any) => l.id), [target.exec.id]); operations = [set('links', links[0].id, 'toNodeId', target.c.id)]; }
   else if (mode === 'disconnect') { assert.equal(nodes.length, 0); assert.deepEqual(links.map((l: any) => l.id), [target.data.id]); operations = [remove('links', links[0].id)]; }
   else { assert.deepEqual(nodes.map((n: any) => n.id), [target.a.id]); const ids = new Set(nodes.map((n: any) => n.id)); operations = [...allLinks.filter((l: any) => ids.has(l.fromNodeId) || ids.has(l.toNodeId) || links.some((s: any) => s.id === l.id)).map((l: any) => remove('links', l.id)), ...nodes.map((n: any) => remove('nodes', n.id))]; }
   answer = { message: '仅修改读取到的选择，其他节点和连线保持原状。', operations };
  }
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) }, finish_reason: 'stop' }] }));
 } catch (error) { serverErrors.push(String(error)); console.error('Mock provider:', error); res.statusCode = 500; res.end(String(error)); }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening'); const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
await fs.writeFile(path.join(profile, 'ai-settings.json'), JSON.stringify({ version: 1, config: { ...defaultAiConfig, baseUrl: base + '/v1', model: 'local-selection-mock', rememberKey: false } }));
const app = await launchDesktopFixture({ root, projectFile, profile }), page = await app.firstWindow(); let assistant: Page | undefined;
const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
const node = (id: string) => page.locator('.react-flow__node[data-id="' + id + '"]');
const snapshot = async () => (await assistant!.evaluate(async () => (await window.studio?.getAiContext?.())?.project))!;
const current = async () => (await snapshot()).blueprints.find(g => g.id === target.graph.id)!;
const selection = async () => (await assistant!.evaluate(async () => (await window.studio?.getAiContext?.())?.selectedBlueprint))!;
const fit = async () => { await page.getByRole('button', { name: '框选全部节点', exact: true }).click(); await page.waitForTimeout(260); };
const clear = async () => { await page.getByRole('button', { name: '框选全部节点', exact: true }).focus(); await page.keyboard.press('Escape'); await expect(page.locator('.react-flow__node.selected')).toHaveCount(0); await expect(page.locator('.react-flow__edge.selected')).toHaveCount(0); };
const chooseNodes = async (ids: string[]) => { await clear(); await fit(); await node(ids[0]).locator('.graph-node-title').click(); for (const id of ids.slice(1)) await node(id).locator('.graph-node-title').click({ modifiers: ['Control'] }); await expect(page.locator('.react-flow__node.selected')).toHaveCount(ids.length); await expect.poll(async () => (await selection()).nodeIds?.slice().sort()).toEqual(ids.slice().sort()); };
const wire = async (id: string, add = false) => { await fit(); const p = await page.locator('.react-flow__edge[data-id="' + id + '"] .react-flow__edge-path').evaluate((el: SVGPathElement) => { const pt = el.getPointAtLength(el.getTotalLength() * .5), matrix = el.getScreenCTM()!; return { x: pt.x * matrix.a + pt.y * matrix.c + matrix.e, y: pt.x * matrix.b + pt.y * matrix.d + matrix.f }; }); if (add) await page.keyboard.down('Control'); await page.mouse.click(p.x, p.y); if (add) await page.keyboard.up('Control'); await expect.poll(async () => (await selection()).linkIds).toContain(id); };
const send = async (prompt: string) => { await assistant!.getByLabel('发给 AI 的内容', { exact: true }).fill(prompt); await assistant!.getByRole('button', { name: '发送', exact: true }).click(); };
const apply = async () => { const before = JSON.stringify(await current()); const proposal = assistant!.getByRole('region', { name: 'AI 建议修改' }).last(); await assistant!.getByRole('button', { name: /应用选中的/ }).last().click(); await expect(proposal).toContainText('已应用修改'); await expect.poll(async () => JSON.stringify(await current())).not.toBe(before); };
const undo = async () => { await page.getByRole('button', { name: '框选全部节点', exact: true }).focus(); await page.keyboard.press('Control+z'); };
const redo = async () => { await page.keyboard.press('Control+y'); };
try {
 await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
 await page.locator('[data-workspace-tab="blueprint"]').click(); await page.getByLabel('演出目标', { exact: true }).selectOption('graph:' + first.graph.id);
 const opened = app.waitForEvent('window'); await page.getByRole('button', { name: 'AI 助手', exact: true }).click(); assistant = await opened;
 await chooseNodes([first.a.id, first.b.id]); await expect(assistant.getByLabel('当前工程上下文')).toContainText('2 个节点'); await assistant.screenshot({ path: path.join(output, 'selected-nodes-context.png') });
 await send('把选中的节点向右移动120，保留其他内容'); await expect.poll(() => waiting).toBe(true);
 await chooseNodes([first.c.id]); release!(); await apply();
 let updated = await current(); assert.equal(updated.nodes.find(n => n.id === first.a.id)!.x, first.a.x + 120); assert.equal(updated.nodes.find(n => n.id === first.b.id)!.x, first.b.x + 120); assert.deepEqual(updated.nodes.find(n => n.id === first.c.id), first.c); assert.deepEqual(updated.links, first.graph.links);
 await undo(); await expect.poll(async () => (await current()).nodes).toEqual(first.graph.nodes); await redo(); await expect.poll(async () => (await current()).nodes.find(n => n.id === first.a.id)!.x).toBe(first.a.x + 120);
 mode = 'rewire'; await wire(first.exec.id); await expect.poll(async () => (await selection()).nodeIds).toEqual([]); await send('把选中的执行线改接到第三个节点'); await apply();
 assert.equal((await current()).links.find(l => l.id === first.exec.id)!.toNodeId, first.c.id); assert.deepEqual((await current()).links.filter(l => l.id !== first.exec.id), first.graph.links.filter(l => l.id !== first.exec.id)); await undo();
 mode = 'disconnect'; await wire(first.data.id); const beforeDisconnect = await current(); await send('只删除选中的数据连线'); await apply(); assert.deepEqual((await current()).nodes, beforeDisconnect.nodes); assert.deepEqual((await current()).links, first.graph.links.filter(l => l.id !== first.data.id)); await undo();
 mode = 'mixed'; await chooseNodes([first.a.id]); await wire(first.data.id, true); await send('删除所选节点与连线，并处理该节点的关联连线'); await apply(); assert.deepEqual((await current()).nodes.map(n => n.id), first.graph.nodes.filter(n => n.id !== first.a.id).map(n => n.id)); assert.deepEqual((await current()).links, first.graph.links.slice(3)); await undo();
 await page.screenshot({ path: path.join(output, 'ordinary-graph.png') });
 // The same real selection path must remain inside the UI draft.
 target = ui; mode = 'move'; await page.locator('[data-workspace-tab="ui"]').click(); await page.getByLabel('界面编辑模式').getByRole('button', { name: '事件图', exact: true }).click(); await page.getByLabel('当前页面事件图', { exact: true }).selectOption(ui.graph.id);
 await chooseNodes([ui.c.id]); await page.getByLabel('节点名称', { exact: true }).fill('手动修改保留');
 const beforeUi = await current(), diskBefore = await fs.readFile(projectFile, 'utf8'); await chooseNodes([ui.a.id, ui.b.id]); await send('把所选节点右移120'); await apply(); assert.equal((await current()).nodes.find(n => n.id === ui.c.id)!.name, '手动修改保留'); assert.equal(await fs.readFile(projectFile, 'utf8'), diskBefore);
 await undo(); await expect.poll(async () => (await current()).nodes).toEqual(beforeUi.nodes); await redo(); await expect.poll(async () => (await current()).nodes.find(n => n.id === ui.a.id)!.x).toBe(ui.a.x + 120);
 await page.getByRole('button', { name: '保存界面', exact: true }).click(); await expect(page.locator('.workspace-toolbar').getByText('已保存', { exact: true })).toBeVisible();
 mode = 'disconnect'; await wire(ui.data.id); await send('删除选中的数据线'); await apply(); await page.screenshot({ path: path.join(output, 'ui-draft.png') }); await assistant.screenshot({ path: path.join(output, 'assistant-selection.png') });
 await page.locator('[data-workspace-tab="script"]').click(); await page.getByRole('dialog', { name: '保存界面修改', exact: true }).getByRole('button', { name: '不保存', exact: true }).click(); assert.deepEqual((await current()).links, ui.graph.links);
 const stored = JSON.parse(await fs.readFile(projectFile, 'utf8')); assert.equal(stored.blueprints.find((g: BlueprintGraph) => g.id === ui.graph.id).nodes.find((n: any) => n.id === ui.c.id).name, '手动修改保留');
 assert.deepEqual(errors, []); assert.deepEqual(serverErrors, []); assert.ok(reads.length >= 6);
 await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', compiled: true, externalApiCalled: false, captures, checks: ['多节点真实选择与上下文数量', '请求期间换选择不改变建议范围', '按真实ID移动同名节点且无关内容不变', '执行线改接保留ID', '只删数据线保留节点', '混合选择删除关联线并一次撤销', '高级UI手动草稿/AI应用/撤销重做/保存/放弃'] }, null, 2)); console.log(output);
} catch (error) { release?.(); console.error(output); await fs.writeFile(path.join(output, 'debug.json'), JSON.stringify({captures, reads, serverErrors}, null, 2)); await page.screenshot({ path: path.join(output, 'failure.png') }); await assistant?.screenshot({ path: path.join(output, 'failure-assistant.png') }); throw error; }
finally { release?.(); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => undefined); await app.close(); server.closeAllConnections(); server.close(); }
