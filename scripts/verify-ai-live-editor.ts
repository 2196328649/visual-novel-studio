import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import { createProject, type Project } from '../src/core/model';
import { createUiEventGraph } from '../src/core/ui-logic';
import { performanceTimeline } from '../src/core/performance-timeline';
import { validateProject } from '../src/core/validate';
import { compileProject } from '../src/runtime/compiler';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { liveAiProvider } from './lib/live-ai-provider';
import { aiTimelineOverlapFixture } from './lib/ai-timeline-overlap-fixture';

const scenario = process.argv[2] ?? 'timeline';
if (!['timeline', 'ui'].includes(scenario)) throw Error('Use timeline or ui.');
const root = path.resolve('.'), output = path.join(root, 'artifacts/ai-live-editor', new Date().toISOString().replaceAll(':', '-') + '-' + scenario);
const provider = await liveAiProvider(); if (!provider) throw Error('Set VNS_LIVE_AI_TOKEN_FILE to the supplied test configuration.');
await fs.mkdir(output, { recursive: true }); const projectFile = path.join(output, 'project.vns.json');
const fixture = aiTimelineOverlapFixture();
const project = scenario === 'timeline' ? fixture.project : createProject('真实AI控件事件验收');
if (scenario === 'ui') {
  project.ui.pages = { ...project.ui.pages, main: { layout: 'custom' } };
  project.ui.components.push(
    { id: 'live_trigger', kind: 'button', page: 'main', name: '执行测试', text: '执行测试', x: .1, y: .2, width: .3, height: .12 },
    { id: 'live_status', kind: 'text', page: 'main', name: '状态提示', text: '等待操作', x: .1, y: .45, width: .5, height: .12 },
    { id: 'live_unrelated', kind: 'text', page: 'main', name: '保留文字', text: '这项保持原样', x: .1, y: .7, width: .5, height: .12 });
  createUiEventGraph(project, 'ui:main', '标题');
}
const original = JSON.stringify(project); await fs.writeFile(projectFile, original);
const app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') }), page = await app.firstWindow();
page.setDefaultTimeout(15000); let assistant: Page | undefined, phase = 'launch';
const errors: string[] = [], checks: string[] = [];
const report: Record<string, unknown> = { status: 'running', externalApiCalled: true, compiled: true, scenario, projectFile, model: provider.model, checks };
const saveReport = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ ...report, phase }, null, 2));
const stage = async (next: string) => { phase = next; console.log(next); await saveReport(); };
const current = () => assistant!.evaluate(async () => (await window.studio!.getAiContext!())!.project);
const button = (name: string) => page.getByRole('button', { name, exact: true });
const layout = (p: Project) => { const model = performanceTimeline(p, p.blueprints.find(g => g.id === fixture.graph.id)!); return { tracks: model.tracks.length, clips: model.clips.map(c => [c.at, c.duration]) }; };
const open = async () => {
  await page.locator('[data-workspace-tab="' + (scenario === 'timeline' ? 'blueprint' : 'ui') + '"]').click();
  if (scenario === 'timeline') { await page.getByLabel('演出目标').selectOption('graph:' + fixture.graph.id); await page.locator('.timeline-clip[data-node-id="' + fixture.first + '"]').click(); }
  else { await page.getByLabel('界面编辑模式').getByRole('button', { name: '事件图', exact: true }).click(); await page.getByLabel('事件图页面').selectOption('ui:main'); await page.locator('[data-ui-component-id="live_trigger"]').click(); }
};
try {
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 }); page.on('pageerror', e => errors.push(e.message));
  await page.evaluate(config => window.studio!.saveAiConfig!(config), provider); await open();
  const opened = app.waitForEvent('window'); await button('AI 助手').click(); assistant = await opened;
  const before = await current();
  const prompt = scenario === 'timeline'
    ? '把当前选中的“第一张”片段从2秒延长到5秒，并将同轨的“第二张”片段移动到第5秒开始，保持它的1秒时长。两张仍在同一轨道，首尾相接不能重叠。保留颜色、其他演出参数和所有其他内容。请实际提出工程修改建议。'
    : '给当前标题页面的“执行测试”按钮添加点击事件：点击后把“状态提示”的文字改为“按钮已执行”，再把该文字的不透明度设为50%。用当前页面的控件事件图和执行连线实现，复用已有页面事件图。控件在点击前仍显示原始内容，保持原布局和“保留文字”不变。请实际提出工程修改建议。';
  report.prompt = prompt; await stage('requesting'); const start = Date.now();
  await assistant.getByLabel('发给 AI 的内容', { exact: true }).fill(prompt); await assistant.getByRole('button', { name: '发送', exact: true }).click();
  await expect.poll(async () => {
    const alerts = await assistant!.getByRole('alert').allTextContents(); if (alerts.some(Boolean)) throw Error(alerts.join('\n'));
    return assistant!.locator('.ai-proposal').count();
  }, { timeout: 600000, intervals: [1000, 2000, 3000] }).toBe(1);
  report.generationSeconds = Math.round((Date.now() - start) / 1000);
  const proposal = assistant.locator('.ai-proposal').last();
  await fs.writeFile(path.join(output, 'proposal.txt'), await proposal.innerText()); await assistant.screenshot({ path: path.join(output, 'proposal.png') });
  assert.deepEqual(await current(), before); assert.equal(await fs.readFile(projectFile, 'utf8'), original);
  await stage('applying'); await proposal.getByRole('button', { name: /^应用(选中的|创作方案)/ }).click(); await expect(proposal).toContainText(/已应用(修改|创作方案)/);
  await expect.poll(async () => JSON.stringify((await current()).blueprints)).not.toBe(JSON.stringify(before.blueprints));
  const applied = await current(); await fs.writeFile(path.join(output, 'applied.vns.json'), JSON.stringify(applied, null, 2));
  assert.deepEqual(validateProject(applied).filter(d => d.severity === 'error'), []);
  assert.deepEqual(applied.ui.components, before.ui.components); assert.deepEqual(applied.nodes, before.nodes); assert.deepEqual(applied.assets, before.assets);
  if (scenario === 'timeline') assert.deepEqual(layout(applied), { tracks: 1, clips: [[0, 5], [5, 1]] });
  else {
    const graph = applied.blueprints.find(g => g.uiPageId === 'ui:main')!;
    assert.ok(graph.nodes.some(n => n.type === 'eventClick' && n.properties.componentId === 'live_trigger'));
    await button('框选全部节点').click(); await button('交互预演').click(); const frame = page.locator('.ui-logic-preview-frame');
    await expect(frame.getByText('等待操作', { exact: true })).toBeVisible(); await frame.getByRole('button', { name: '执行测试', exact: true }).click();
    await expect(frame.getByText('按钮已执行', { exact: true })).toBeVisible(); await expect(frame.getByText('这项保持原样', { exact: true })).toBeVisible();
    const opacity = await frame.getByText('按钮已执行', { exact: true }).evaluate(el => { let value = 1; for (let item: Element | null = el; item && !item.classList.contains('ui-logic-preview-frame'); item = item.parentElement) value *= Number(getComputedStyle(item).opacity); return value; });
    assert.equal(opacity, .5); await page.screenshot({ path: path.join(output, 'preview-click.png') }); await button('交互预演').click();
    checks.push('真实按钮预演点击后文字及50%不透明度生效，点击前和无关控件保留');
  }
  checks.push('真实服务读取工程并生成可应用建议，应用前不改变草稿或磁盘');
  await stage('history'); await button(scenario === 'ui' ? '框选全部节点' : '查看组件连线').focus(); await page.keyboard.press('Control+z');
  await expect.poll(async () => (await current()).blueprints).toEqual(before.blueprints);
  await page.keyboard.press('Control+y'); await expect.poll(async () => (await current()).blueprints).toEqual(applied.blueprints);
  assert.equal(await fs.readFile(projectFile, 'utf8'), original); await button(scenario === 'ui' ? '保存界面' : '保存工程').click();
  await expect.poll(async () => JSON.parse(await fs.readFile(projectFile, 'utf8')).blueprints).toEqual(applied.blueprints);
  const saved = JSON.parse(await fs.readFile(projectFile, 'utf8')); assert.ok(compileProject(saved).files['game/story.rpy']);
  await page.reload(); await expect(page.locator('.project-title strong')).toHaveText(project.name); await open();
  if (scenario === 'ui') await expect(button('保存界面')).toBeDisabled();
  await page.screenshot({ path: path.join(output, 'saved-editor.png') }); checks.push('实际撤销重做、显式保存重开及编译通过');
  if (scenario === 'timeline') checks.push('同轨片段0–5秒及5–6秒，保留其他字段和内容');
  assert.deepEqual(errors, []); report.status = 'passed'; await stage('complete');
} catch (error) {
  const message = String(error).replaceAll(provider.apiKey ?? '', '[redacted]'); report.status = 'failed'; report.error = message;
  await saveReport(); await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined); await assistant?.screenshot({ path: path.join(output, 'failure-assistant.png') }).catch(() => undefined);
  console.error(message); process.exitCode = 1;
} finally {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => undefined); await app.close(); console.log(output);
}
