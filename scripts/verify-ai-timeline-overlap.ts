import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { expect, type Page } from '@playwright/test';
import { aiTimelineOverlapFixture } from './lib/ai-timeline-overlap-fixture';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { defaultAiConfig } from '../src/core/ai';
import { createUiEventGraph } from '../src/core/ui-logic';
import { blueprintNodeDefaults, callablePins, connectBlueprintPins } from '../src/core/blueprint';
import { performanceTimeline } from '../src/core/performance-timeline';

const root = path.resolve('.'), output = path.join(root, 'artifacts/ai-timeline-overlap', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true }); const reports = [];
for (const workspace of ['timeline', 'ui'] as const) {
  const folder = path.join(output, workspace), profile = path.join(folder, 'profile'), projectFile = path.join(folder, 'project.vns.json'); await fs.mkdir(profile, { recursive: true });
  const { project, graph, first, gap } = aiTimelineOverlapFixture();
  let callId: string | undefined;
  if (workspace === 'ui') {
    const owner = createUiEventGraph(project, 'ui:main', '标题'), call = blueprintNodeDefaults('callFunction'); callId = call.id;
    call.properties = { graphId: graph.id, wait: false }; call.pins = callablePins(graph); call.x = 460; call.y = 60; owner.nodes.push(call);
    assert.equal(connectBlueprintPins(owner, owner.nodes[0].id, 'exec', call.id, 'exec_in'), undefined);
  }
  const original = JSON.stringify(project); await fs.writeFile(projectFile, original);
  const duration = { kind: 'editProject', path: ['blueprints', { id: graph.id }, 'nodes', { id: first }, 'properties', 'object_duration'], action: 'set', value: 5 };
  const move = { kind: 'editProject', path: ['blueprints', { id: graph.id }, 'nodes', { id: gap.id }, 'properties', 'seconds'], action: 'set', value: 5 };
  let mode: 'reject' | 'repair' = 'reject', requests = 0, repaired = false; const validationMessages: string[] = [], serverErrors: string[] = [];
  const server = createServer(async (req, res) => {
    try {
      let raw = ''; for await (const chunk of req) raw += chunk; const body = JSON.parse(raw), last = body.messages.at(-1).content as string; requests++;
      if (last.startsWith('编辑器校验未通过')) { validationMessages.push(last); assert.match(last, /同一轨道的片段不能重叠/); if (mode === 'repair') repaired = true; }
      const response = { message: repaired ? '延长第一张并将第二张移动到第5秒，作为一组修改。' : '延长第一张到5秒。', operations: repaired ? [duration, move] : [duration] };
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) }, finish_reason: 'stop' }] }));
    } catch (error) { serverErrors.push(String(error)); res.statusCode = 500; res.end(String(error)); }
  }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  await fs.writeFile(path.join(profile, 'ai-settings.json'), JSON.stringify({ version: 1, config: { ...defaultAiConfig, baseUrl: 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/v1', model: 'local-mock', rememberKey: false } }));
  const app = await launchDesktopFixture({ root, projectFile, profile }), page = await app.firstWindow(); let assistant: Page | undefined;
  page.setDefaultTimeout(10000); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const current = async () => (await assistant!.evaluate(async () => (await window.studio!.getAiContext!())!.project));
  const model = async () => { const p = await current(); return performanceTimeline(p, p.blueprints.find(g => g.id === graph.id)!); };
  const send = async (text: string) => { await assistant!.getByLabel('发给 AI 的内容', { exact: true }).fill(text); await assistant!.getByRole('button', { name: '发送', exact: true }).click(); };
  try {
    await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
    if (workspace === 'timeline') { await page.locator('[data-workspace-tab="blueprint"]').click(); await page.getByLabel('演出目标').selectOption('graph:' + graph.id); }
    else { await page.locator('[data-workspace-tab="ui"]').click(); await page.getByLabel('界面编辑模式').getByRole('button', { name: '事件图', exact: true }).click(); await page.getByLabel('事件图页面').selectOption('ui:main'); await page.getByRole('button', { name: '框选全部节点', exact: true }).click(); await page.locator('.react-flow__node[data-id="' + callId + '"] .graph-node-title').dblclick(); }
    await page.locator('.timeline-clip[data-node-id="' + first + '"]').click(); const opened = app.waitForEvent('window'); await page.getByRole('button', { name: 'AI 助手', exact: true }).click(); assistant = await opened;
    const before = await current(); await send('将第一张延长到5秒，先检查同轨片段。');
    await expect(assistant.getByRole('alert')).toContainText('同一轨道的片段不能重叠'); assert.equal(requests, 3); assert.deepEqual(await current(), before); await expect(assistant.getByRole('region', { name: 'AI 建议修改' })).toHaveCount(0);
    mode = 'repair'; await send('将第一张延长到5秒，同时移动第二张，保持同轨不重叠。');
    const proposal = assistant.getByRole('region', { name: 'AI 建议修改' }).last(); await expect(proposal).toContainText('待应用修改 · 2 项'); assert.ok(repaired); assert.equal(requests, 5);
    await proposal.getByLabel('应用建议 2', { exact: true }).uncheck(); await proposal.getByRole('button', { name: '应用选中的 1 项修改', exact: true }).click();
    await expect(assistant.getByRole('alert')).toContainText('同一轨道的片段不能重叠'); assert.deepEqual(await current(), before); await expect(proposal).toContainText('待应用修改');
    await assistant.screenshot({ path: path.join(folder, 'partial-rejected.png') });
    await proposal.getByLabel('应用建议 2', { exact: true }).check(); await proposal.getByRole('button', { name: '应用选中的 2 项修改', exact: true }).click(); await expect(proposal).toContainText('已应用修改');
    await expect.poll(async () => (await model()).clips.map(c => [c.at, c.duration])).toEqual([[0, 5], [5, 1]]); assert.equal((await model()).tracks.length, 1); assert.equal(await fs.readFile(projectFile, 'utf8'), original);
    await page.locator('.timeline-clip[data-node-id="' + first + '"]').click(); await page.keyboard.press('Control+z'); await expect.poll(async () => (await model()).clips.map(c => [c.at, c.duration])).toEqual([[0, 2], [3, 1]]);
    await page.keyboard.press('Control+y'); await expect.poll(async () => (await model()).clips.map(c => [c.at, c.duration])).toEqual([[0, 5], [5, 1]]);
    await page.getByRole('button', { name: workspace === 'ui' ? '保存界面' : '保存工程', exact: true }).click();
    await expect.poll(async () => JSON.parse(await fs.readFile(projectFile, 'utf8')).blueprints.find((g: any) => g.id === graph.id).nodes.find((n: any) => n.id === first).properties.object_duration).toBe(5);
    await page.screenshot({ path: path.join(folder, 'applied-timeline.png') }); assert.deepEqual(errors, []); assert.deepEqual(serverErrors, []);
    reports.push({ workspace, projectFile, requests, validationMessages: validationMessages.length });
  } catch (error) { await page.screenshot({ path: path.join(folder, 'failure.png') }).catch(() => undefined); await assistant?.screenshot({ path: path.join(folder, 'failure-assistant.png') }).catch(() => undefined); console.error(folder); throw error; }
  finally { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => undefined); await app.close(); server.closeAllConnections(); server.close(); }
}
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', compiled: true, externalApiCalled: false, reports, checks: ['无效建议经两次修正仍失败时不生成可应用结果', '服务返回具体冲突后整批修正', '取消关联修改后应用被拒且状态不变', '完整修改保留单轨且首尾相接', '普通时间轴与UI时间轴草稿', '撤销重做和显式保存'] }, null, 2)); console.log(output);
