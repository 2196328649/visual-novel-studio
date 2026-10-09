import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import { aiTimelineOverlapFixture } from './lib/ai-timeline-overlap-fixture';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { createUiEventGraph } from '../src/core/ui-logic';
import { blueprintNodeDefaults, callablePins, connectBlueprintPins } from '../src/core/blueprint';
import { exposePerformanceInputs, performanceInputs } from '../src/core/blueprint-authoring';
import { performanceTimeline } from '../src/core/performance-timeline';

const root = path.resolve('.'), output = path.join(root, 'artifacts/timeline-node-edits', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true }); const reports = [];
for (const workspace of ['timeline', 'ui'] as const) for (const mode of ['inline', 'public'] as const) {
  const folder = path.join(output, workspace + '-' + mode), projectFile = path.join(folder, 'project.vns.json'); await fs.mkdir(folder, { recursive: true });
  const { project, graph, first, gap } = aiTimelineOverlapFixture();
  const firstNode = graph.nodes.find(n => n.id === first)!;
  let readId: string | undefined, dataLinkId: string | undefined;
  const literal = blueprintNodeDefaults('literal'); literal.name = '冲突时长'; literal.properties.value = 5; literal.pins[0].dataType = 'number';
  if (mode === 'public') {
    exposePerformanceInputs(graph, performanceInputs(graph).filter(p => p.nodeId === first && p.pinId === 'object_duration'));
    // Removing the public binding would expose this conflicting fallback.
    firstNode.properties.object_duration = 5;
    readId = graph.nodes.find(n => n.type === 'getInput')!.id;
    dataLinkId = graph.links.find(l => l.toNodeId === first && l.toPinId === 'object_duration')!.id;
    graph.nodes.push(literal);
    graph.nodes.find(n => n.type === 'event')!.y = -240;
    graph.nodes.find(n => n.id === readId)!.y = 60;
    literal.x = 40; literal.y = 400;
  }
  let callId: string | undefined;
  if (workspace === 'ui') {
    const owner = createUiEventGraph(project, 'ui:main', '标题'), call = blueprintNodeDefaults('callFunction'); callId = call.id;
    call.properties = { graphId: graph.id, wait: false }; call.pins = callablePins(graph); call.x = 460; call.y = 60; owner.nodes.push(call);
    assert.equal(connectBlueprintPins(owner, owner.nodes[0].id, 'exec', call.id, 'exec_in'), undefined);
  }
  await fs.writeFile(projectFile, JSON.stringify(project));
  const app = await launchDesktopFixture({ root, projectFile, profile: path.join(folder, 'profile') }), page = await app.firstWindow();
  page.setDefaultTimeout(10000); const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); let assistant: Page | undefined;
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  const current = async () => (await assistant!.evaluate(async () => (await window.studio!.getAiContext!())!.project));
  const currentGraph = async () => (await current()).blueprints.find(g => g.id === graph.id)!;
  const model = async () => { const p = await current(); return performanceTimeline(p, p.blueprints.find(g => g.id === graph.id)!); };
  const node = (id: string) => page.locator('.react-flow__node[data-id="' + id + '"]');
  const rejected = async (before: Awaited<ReturnType<typeof currentGraph>>) => {
    await expect(page.locator('.blueprint-status')).toContainText('同一轨道的片段不能重叠');
    assert.deepEqual(await currentGraph(), before);
  };
  try {
    await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
    if (workspace === 'timeline') { await page.locator('[data-workspace-tab="blueprint"]').click(); await page.getByLabel('演出目标').selectOption('graph:' + graph.id); }
    else { await page.locator('[data-workspace-tab="ui"]').click(); await page.getByLabel('界面编辑模式').getByRole('button', { name: '事件图', exact: true }).click(); await page.getByLabel('事件图页面').selectOption('ui:main'); await button('框选全部节点').click(); await node(callId!).locator('.graph-node-title').dblclick(); }
    const opened = app.waitForEvent('window'); await button('AI 助手').click(); assistant = await opened;
    await button('查看组件连线').click(); await button('框选全部节点').click();
    const before = await currentGraph();
    if (mode === 'inline') {
      const duration = node(first).getByLabel(firstNode.name + ' · ' + firstNode.pins.find(p => p.id === 'object_duration')!.name, { exact: true });
      await duration.fill('5'); await duration.press('Tab'); await rejected(before); await expect(duration).toHaveValue('2');
      await node(first).locator('.graph-node-title').click();
      const inspector = page.getByLabel('蓝图属性').getByLabel('对象持续秒数', { exact: true });
      await inspector.fill('5'); await inspector.press('Tab'); await rejected(before); await expect(inspector).toHaveValue('2');
      const gapField = node(gap.id).getByLabel(gap.name + ' · 秒数', { exact: true });
      await gapField.fill('5'); await gapField.press('Tab');
      await expect.poll(async () => (await model()).clips[1].at).toBe(5);
      await duration.fill('5'); await duration.press('Tab');
      await expect.poll(async () => (await model()).clips.map(c => [c.at, c.duration])).toEqual([[0, 5], [5, 1]]);
      await button('返回时间轴编辑').click(); await page.locator('.timeline-clip[data-node-id="' + first + '"]').click();
      await page.keyboard.press('Control+z'); await expect.poll(async () => (await model()).clips.map(c => [c.at, c.duration])).toEqual([[0, 2], [5, 1]]);
      await page.keyboard.press('Control+z'); await expect.poll(async () => (await model()).clips.map(c => [c.at, c.duration])).toEqual([[0, 2], [3, 1]]);
      await page.keyboard.press('Control+y'); await page.keyboard.press('Control+y');
      await expect.poll(async () => (await model()).clips.map(c => [c.at, c.duration])).toEqual([[0, 5], [5, 1]]);
    } else {
      await node(first).locator('.graph-node-title').click();
      await button('输入与输出').click();
      const field = page.getByLabel(graph.exposedInputs[0].name + '的默认值', { exact: true });
      await field.fill('5'); await field.press('Tab'); await rejected(before); await expect(field).toHaveValue('2');
      await button('连线').click(); await page.locator('.connection-list [data-link-id="' + dataLinkId + '"]').click(); await button('断开此连线').click(); await rejected(before);
      // Delete must preserve both selection and graph when it would reveal overlap.
      await page.locator('.connection-list [data-link-id="' + dataLinkId + '"]').click();
      await button('框选全部节点').click(); await node(readId!).locator('.graph-node-title').click(); await page.keyboard.press('Delete'); await rejected(before);
      await expect(node(readId!)).toHaveClass(/selected/);
      // A new data wire replacing the valid duration binding must also be rejected.
      await button('连线').click(); await page.locator('.connection-list [data-link-id="' + dataLinkId + '"]').click();
      await expect(page.locator('.blueprint-status')).not.toContainText('同一轨道的片段不能重叠');
      await button('框选全部节点').click();
      const source = node(literal.id).locator('.react-flow__handle[data-handleid="value"]');
      const target = node(first).locator('.react-flow__handle[data-handleid="object_duration"]');
      await source.dragTo(target); await rejected(before);
      await page.screenshot({ path: path.join(folder, 'rejected-wire.png') });
      await button('输入与输出').click(); await field.fill('2.5'); await field.press('Tab'); await expect.poll(async () => (await model()).clips[0].duration).toBe(2.5);
      await button('返回时间轴编辑').click(); await page.locator('.timeline-clip[data-node-id="' + first + '"]').click(); await page.keyboard.press('Control+z'); await expect.poll(async () => (await model()).clips[0].duration).toBe(2);
      await page.keyboard.press('Control+y'); await expect.poll(async () => (await model()).clips[0].duration).toBe(2.5);
    }
    await button(workspace === 'ui' ? '保存界面' : '保存工程').click();
    await expect.poll(async () => JSON.parse(await fs.readFile(projectFile, 'utf8')).blueprints.find((g: any) => g.id === graph.id)).toEqual(await currentGraph());
    await page.screenshot({ path: path.join(folder, 'saved-timeline.png') }); assert.deepEqual(errors, []);
    reports.push({ workspace, mode, projectFile, checks: mode === 'inline' ? ['节点内时长拒绝', '属性时长拒绝', '配套移位成功', '拒绝不占撤销记录', '保存'] : ['公开默认值拒绝', '断线拒绝', '删除来源拒绝且保留选择', '实际拖线拒绝', '有效默认值可撤销重做保存'] });
  } catch (error) { await page.screenshot({ path: path.join(folder, 'failure.png') }).catch(() => undefined); console.error(folder); throw error; }
  finally { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => undefined); await app.close(); }
}
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', compiled: true, reports }, null, 2)); console.log(output);
