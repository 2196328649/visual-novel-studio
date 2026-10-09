import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import { nestedTimelineEditFixture } from './lib/nested-timeline-edit-fixture';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { exposePerformanceInputs, performanceInputs } from '../src/core/blueprint-authoring';
import { blueprintNodeDefaults, callablePins, connectBlueprintPins, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { createUiEventGraph } from '../src/core/ui-logic';
import { performanceTimeline } from '../src/core/performance-timeline';

const root = path.resolve('.'), output = path.join(root, 'artifacts/nested-timeline-edits', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true }); const reports = [];
for (const workspace of ['timeline', 'ui'] as const) {
  const folder = path.join(output, workspace), projectFile = path.join(folder, 'project.vns.json'); await fs.mkdir(folder, { recursive: true });
  const { project, parent, child, clipId, callId, secondId } = nestedTimelineEditFixture();
  exposePerformanceInputs(child, performanceInputs(child).filter(p => p.nodeId === clipId && p.pinId === 'object_duration'));
  let eventCall: string | undefined;
  if (workspace === 'ui') {
    const owner = createUiEventGraph(project, 'ui:main', '标题'), call = blueprintNodeDefaults('callFunction'); eventCall = call.id;
    call.properties = { graphId: parent.id, wait: false }; call.pins = callablePins(parent); call.x = 460; call.y = 60; owner.nodes.push(call);
    assert.equal(connectBlueprintPins(owner, owner.nodes[0].id, 'exec', call.id, 'exec_in'), undefined);
  }
  synchronizeBlueprintSignatures(project);
  const original = JSON.stringify(project); await fs.writeFile(projectFile, original);
  const app = await launchDesktopFixture({ root, projectFile, profile: path.join(folder, 'profile') }), page = await app.firstWindow();
  page.setDefaultTimeout(10000); const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); let assistant: Page | undefined;
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  const clip = (id: string) => page.locator('.timeline-clip[data-node-id="' + id + '"]');
  const context = () => assistant!.evaluate(async () => (await window.studio!.getAiContext!())!);
  const model = async (id: string) => { const p = (await context()).project; return performanceTimeline(p, p.blueprints.find(g => g.id === id)!); };
  const fill = async (name: string, value: string) => { const field = page.getByLabel(name, { exact: true }); await field.fill(value); await field.press('Tab'); };
  try {
    await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
    if (workspace === 'timeline') { await page.locator('[data-workspace-tab="blueprint"]').click(); await page.getByLabel('演出目标').selectOption('graph:' + parent.id); }
    else { await page.locator('[data-workspace-tab="ui"]').click(); await page.getByLabel('界面编辑模式').getByRole('button', { name: '事件图', exact: true }).click(); await page.getByLabel('事件图页面').selectOption('ui:main'); await button('框选全部节点').click(); await page.locator('.react-flow__node[data-id="' + eventCall + '"] .graph-node-title').dblclick(); }
    await clip(callId).dblclick(); await clip(clipId).click();
    const opened = app.waitForEvent('window'); await button('AI 助手').click(); assistant = await opened;
    const before = (await context()).project.blueprints;
    const rejected = async () => { await expect(page.getByText(/时间轴“外层时间轴”.*同一轨道/).first()).toBeVisible(); assert.deepEqual((await context()).project.blueprints, before); await expect(clip(clipId)).toHaveAttribute('data-duration', '2'); };
    await fill('片段显示时长', '6'); await rejected(); await expect(page.getByLabel('片段显示时长', { exact: true })).toHaveValue('2');
    await button('时间轴属性').click();
    const parameter = page.locator('.timeline-public-parameter .timeline-parameter-default input'); await parameter.fill('6'); await parameter.press('Tab'); await rejected(); await expect(parameter).toHaveValue('2');
    await page.getByRole('tab', { name: '片段属性', exact: true }).click();
    await page.getByLabel('轨道缩放', { exact: true }).selectOption('60'); await page.getByLabel('时间轴吸附', { exact: true }).uncheck();
    const handle = clip(clipId).locator('.timeline-resize'); await handle.hover(); const box = await handle.boundingBox(); assert.ok(box);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 240, box.y + box.height / 2, { steps: 20 });
    await expect.poll(async () => Number(await clip(clipId).getAttribute('data-duration'))).toBeGreaterThan(4);
    await page.mouse.up(); await rejected();
    const head = page.getByRole('slider', { name: '时间轴播放头', exact: true }); await head.focus(); await page.keyboard.press('Home');
    for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowRight');
    await button('添加片段').click(); await page.locator('.timeline-add-menu').getByRole('button', { name: '文字片段', exact: true }).click(); await rejected();
    assert.equal((await context()).selectedBlueprint?.nodeId, clipId); await expect(page.locator('.timeline-clip')).toHaveCount(1);
    await page.screenshot({ path: path.join(folder, 'rejected-insert.png') });
    // Close the still-open add menu, retained so a rejected action can be corrected.
    await button('添加片段').click(); await clip(clipId).click(); await fill('片段显示时长', '3');
    await expect(clip(clipId)).toHaveAttribute('data-duration', '3'); await clip(clipId).click(); await page.keyboard.press('Control+z'); await expect(clip(clipId)).toHaveAttribute('data-duration', '2');
    await page.keyboard.press('Control+y'); await expect(clip(clipId)).toHaveAttribute('data-duration', '3');
    await button('返回上层时间轴').click(); await clip(secondId).click(); await fill('片段开始秒数', '6');
    await expect.poll(async () => (await model(parent.id)).clips.map(c => [c.at, c.duration])).toEqual([[0, 3], [6, 1]]);
    await clip(callId).dblclick(); await clip(clipId).click(); await fill('片段显示时长', '6'); await expect(clip(clipId)).toHaveAttribute('data-duration', '6');
    await button('返回上层时间轴').click(); await expect.poll(async () => (await model(parent.id)).clips.map(c => [c.at, c.duration])).toEqual([[0, 6], [6, 1]]); assert.equal((await model(parent.id)).tracks.length, 1);
    assert.equal(await fs.readFile(projectFile, 'utf8'), original);
    await button(workspace === 'ui' ? '保存界面' : '保存工程').click();
    await expect.poll(async () => JSON.parse(await fs.readFile(projectFile, 'utf8')).blueprints).toEqual((await context()).project.blueprints);
    await page.screenshot({ path: path.join(folder, 'saved-parent.png') }); assert.deepEqual(errors, []);
    reports.push({ workspace, projectFile });
  } catch (error) { await page.screenshot({ path: path.join(folder, 'failure.png') }).catch(() => undefined); console.error(folder); throw error; }
  finally { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => undefined); await app.close(); }
}
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', compiled: true, reports, checks: ['子片段时长与公开默认值拒绝外层冲突', '真实拖动裁剪被拒并恢复', '新片段被拒且保留原选择', '有效修改与无多余撤销记录', '先调整外层空位后延长成功', '上层保持单轨并显式保存'] }, null, 2)); console.log(output);
