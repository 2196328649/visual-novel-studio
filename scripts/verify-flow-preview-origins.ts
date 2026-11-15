import { openUiPageOptions } from './lib/ui-design-controls';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject, projectSchema } from '../src/core/model';
import type { RuntimeEvent } from '../src/core/bridge';
import { addGameFlowStep, createCustomUiPage } from '../src/core/game-flow';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openUiPreviewWindow } from './lib/ui-preview-window';

declare global { interface Window { __flowOriginEvents: RuntimeEvent[] } }
const root = path.resolve('.'), output = path.join(root, 'artifacts/flow-preview-origins', new Date().toISOString().replaceAll(':', '-'));
const profile = path.join(output, 'profile'), projectFile = path.join(output, 'project/project.vns.json');
const project = createProject('流程预览起点验收'); project.id = 'preview_origin_verification'; project.ui.disabledPages = ['gallery'];
project.variables = [{ id: 'visits', name: '启动执行次数', type: 'number', initial: 0, persistent: true }];
const graph = createBlueprintGraph('function', '记录启动'); project.blueprints.push(graph);
const read = blueprintNodeDefaults('getVariable'), add = blueprintNodeDefaults('math'), write = blueprintNodeDefaults('setVariable');
read.properties.variableId = 'visits'; add.properties = { operation: 'add', b: 1 }; write.properties.variableId = 'visits';
graph.nodes.push(read, add, write); synchronizeBlueprintSignatures(project);
connectBlueprintPins(graph, graph.nodes[0].id, 'exec', write.id, 'exec_in');
connectBlueprintPins(graph, read.id, 'value', add.id, 'a'); connectBlueprintPins(graph, add.id, 'result', write.id, 'value');
addGameFlowStep(project, 'beforeTitle', { kind: 'blueprint', graphId: graph.id });
const custom = createCustomUiPage(project, '启动提示');
addGameFlowStep(project, 'beforeTitle', { kind: 'page', pageId: custom.id, completion: 'auto', duration: .1 });
project.gameFlow!.beforeTitle.repeat = 'profile';
await fs.mkdir(path.dirname(projectFile), { recursive: true }); await saveProject(projectFile, project);

const checks: string[] = [], errors: string[] = [];
const sessions: { origin: string; id: string; savedir: string; visits: number }[] = [];
let app: ElectronApplication | undefined, editor: Page | undefined, popup: Page | undefined, phase = 'launch', failure: string | undefined;
const saveRoot = path.join(profile, 'preview-saves', project.id);
const workspace = () => editor!.getByRole('region', { name: '实时试玩工作区' });
const originNote = (page = editor!) => page.getByRole('note', { name: '预览起点', exact: true });
async function inspectSession(origin: 'launch' | 'title', visits: number) {
  // A restart initially still displays the old running session while Save/Build
  // is pending. Wait for this run's native readiness, not that stale UI state.
  await expect.poll(() => editor!.evaluate(previous => [...window.__flowOriginEvents].reverse().find(event => event.kind === 'preview' && event.phase === 'running' && !previous.includes(event.sessionId ?? ''))?.sessionId, sessions.map(s => s.id)), { timeout: 60000, message: 'A new native preview session must reach running' }).toBeTruthy();
  await expect(workspace()).toHaveAttribute('data-preview-state', 'running');
  await expect(originNote()).toHaveAttribute('data-preview-origin', origin);
  const id = (await editor!.evaluate(() => [...window.__flowOriginEvents].reverse().find(event => event.kind === 'preview' && event.phase === 'running')!.sessionId))!;
  await expect.poll(() => editor!.evaluate(id => [...window.__flowOriginEvents].reverse().find(event => event.sessionId === id && event.variables)?.variables?.visits, id)).toBe(visits);
  const generated = await fs.readFile(path.join(profile, 'builds', project.id, 'preview', id, 'game/01-vn-game-flow.rpy'), 'utf8');
  expect(generated).toContain(`renpy.session.setdefault("vn_flow_skip_title_once", ${origin === 'title' ? 'True' : 'False'})`);
  expect(generated).toContain('vn_flow_preview = True');
  sessions.push({ origin, id, savedir: path.join(saveRoot, id), visits });
}
async function start(origin: 'launch' | 'title', visits: number) {
  await editor!.getByLabel('预览流程起点', { exact: true }).selectOption(origin);
  await expect(originNote()).toContainText(origin === 'launch' ? '从启动预览' : '从标题预览');
  await inspectSession(origin, visits);
}
async function stop() {
  await editor!.locator('.play-toolbar').getByRole('button', { name: /^停止/ }).click();
  await expect(workspace()).toHaveCount(0);
}
async function size(width: number, height: number, preview = false) {
  await app!.evaluate(({ BrowserWindow }, { width, height, preview }) => {
    const window = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#ui-preview') === preview)!;
    window.setSize(width, height);
  }, { width, height, preview });
}

try {
  app = await launchDesktopFixture({ root, profile, projectFile, sdkRoot: process.env.VNS_RENPY_SDK ?? 'E:/Tools/renpy-8.5.3-sdk' });
  app.on('window', page => page.on('pageerror', error => errors.push(error.message)));
  editor = await app.firstWindow(); editor.on('pageerror', error => errors.push(error.message));
  await expect(editor.locator('.project-title strong')).toHaveText(project.name);
  await editor.evaluate(() => { window.__flowOriginEvents = []; window.studio!.onRuntimeEvent(event => window.__flowOriginEvents.push(event)); });
  await editor.locator('.view-tabs').getByRole('button', { name: '流程图', exact: true }).click();
  phase = 'launch preview'; await start('launch', 1);
  for (const width of [1024, 1280, 1920]) {
    await size(width, 850); await expect(originNote()).toBeVisible();
    expect(await editor.locator('body').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await editor.screenshot({ path: path.join(output, `launch-${width}.png`) });
  }
  checks.push('从启动预览真实执行启动节点；三个常用窗口宽度显示起点和剧情入口且无横向溢出。');
  await stop(); await size(1280, 850);
  phase = 'title preview'; await start('title', 0);
  await expect(originNote()).toContainText('之后返回标题仍按启动节点的执行策略运行');
  await editor.screenshot({ path: path.join(output, 'title-1280.png') });
  checks.push('从标题预览实际跳过首次启动内容，显示一次性跳过说明，而非仅改变文案。');
  phase = 'restart keeps origin';
  await editor.locator('.play-toolbar').getByRole('button', { name: '重新运行', exact: true }).click();
  await inspectSession('title', 0);
  checks.push('重新运行保留标题起点，生成新会话，仍不误播标题前内容。');
  await stop();
  phase = 'fresh launch preview'; await start('launch', 1); await stop();
  expect(new Set(sessions.map(s => s.id)).size).toBe(4);
  expect((await fs.readdir(saveRoot)).sort()).toEqual(sessions.map(s => s.id).sort());
  for (const session of sessions) expect((await fs.stat(path.join(session.savedir, 'persistent'))).isFile()).toBe(true);
  checks.push('四次真实试玩使用四个独立存档目录；再次启动预览重新执行玩家首次内容，不沿用上次试玩标记。');

  phase = 'page preview';
  await editor.locator('.view-tabs').getByRole('button', { name: '界面', exact: true }).click();
  await editor.getByLabel('设计页面', { exact: true }).selectOption('main');
  popup = await openUiPreviewWindow(app, editor);
  await expect(originNote(popup)).toHaveAttribute('data-preview-origin', 'page');
  await expect(originNote(popup)).toContainText('从当前页面预览：标题');
  await expect(originNote(popup)).toContainText('不执行完整的启动、新游戏和剧情流程');
  await editor.getByLabel('设计页面', { exact: true }).selectOption(custom.id);
  await expect(originNote(popup)).toContainText('从当前页面预览：启动提示');
  for (const width of [760, 1200]) {
    await size(width, 700, true); await expect(originNote(popup)).toBeVisible();
    expect(await popup.locator('body').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await popup.screenshot({ path: path.join(output, `page-${width}.png`) });
  }
  await openUiPageOptions(editor); await editor.getByLabel('自定义页面名称', { exact: true }).fill('未保存的页面名');
  await expect(originNote(popup)).toContainText('从当前页面预览：未保存的页面名');
  const saved = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
  expect(saved.ui.customPages.find(p => p.id === custom.id)?.name).toBe('启动提示');
  expect(saved.variables.find(v => v.id === 'visits')?.initial).toBe(0);
  expect((await fs.readdir(saveRoot)).length).toBe(4);
  checks.push('页面预览始终标注局部范围，随页面切换和未保存改名更新；不写回工程、不启动游戏会话。');
  await popup.getByRole('button', { name: '关闭预览', exact: true }).click();
  await expect.poll(() => app!.windows().length).toBe(1);
  expect(errors).toEqual([]);
} catch (error) {
  failure = String(error); console.error(phase + ': ' + failure);
  const events = await editor?.evaluate(() => window.__flowOriginEvents?.slice(-80)).catch(() => undefined);
  await fs.writeFile(path.join(output, 'runtime-events.json'), JSON.stringify(events ?? [], null, 2));
  await editor?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
  process.exitCode = 1;
} finally {
  await editor?.evaluate(() => window.studio?.controlPreview?.('stop')).catch(() => undefined);
  const child = app?.process(); await app?.close().catch(error => { failure ??= String(error); process.exitCode = 1; });
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: failure ? 'failed' : 'passed', phase, checks, sessions, errors, error: failure }, null, 2));
  await fs.writeFile(path.join(output, 'cleanup.json'), JSON.stringify({ editorPid: child?.pid, editorExited: child?.exitCode !== null, editorExitCode: child?.exitCode, nativeStopAwaited: true }, null, 2));
  console.log((failure ? 'FAIL: ' : 'PASS: ') + path.join(output, 'report.json'));
}
