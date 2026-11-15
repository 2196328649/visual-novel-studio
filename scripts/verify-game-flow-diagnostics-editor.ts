import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject, type BlueprintGraph, type BlueprintNode } from '../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { addGameFlowStep, createCustomUiPage } from '../src/core/game-flow';
import { flowStepNodeId } from '../src/core/game-flow-graph';
import { compileProject } from '../src/runtime/compiler';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

if (process.env.VNS_INSTALLED_EXE) throw new Error('This regression verifies the development build, never an installed release.');
const root = path.resolve('.'), output = path.join(root, 'artifacts/game-flow-diagnostics-editor', new Date().toISOString().replaceAll(':', '-'));
const projectFile = path.join(output, 'project/project.vns.json');
await fs.mkdir(path.dirname(projectFile), { recursive: true });
const p = createProject('启动路径诊断导航验收');
p.variables.push({ id: 'startup_value', name: '启动数值', type: 'number', initial: 0, persistent: false });
const pageWithIssues = createCustomUiPage(p, '待修复的启动页'), eventGraph = p.blueprints.find(graph => graph.uiPageId === pageWithIssues.id)!;
eventGraph.links = [];
const helper = createBlueprintGraph('function', '内部初始化模块'); p.blueprints.push(helper);
function node(graph: BlueprintGraph, type: BlueprintNode['type'], properties: BlueprintNode['properties'] = {}) {
  const node = blueprintNodeDefaults(type); Object.assign(node.properties, properties); graph.nodes.push(node); return node;
}
function wire(graph: BlueprintGraph, from: BlueprintNode, to: BlueprintNode, output = 'exec_out', input = 'exec_in') {
  synchronizeBlueprintSignatures(p);
  const error = connectBlueprintPins(graph, from.id, from.type.startsWith('event') && output === 'exec_out' ? 'exec' : output, to.id, input);
  if (error) throw new Error(error);
}
// A title host has no current dialogue character. Exercise the generic host
// capability diagnostic, not the legacy minigame compatibility surface.
const currentCharacter = node(helper, 'showCharacter'), write = node(helper, 'setVariable', { variableId: 'startup_value' });
wire(helper, helper.nodes[0], currentCharacter); wire(helper, currentCharacter, write);
const call = node(eventGraph, 'callFunction', { graphId: helper.id }); wire(eventGraph, eventGraph.nodes[0], call);
const timer = node(eventGraph, 'eventTimer', { pageId: pageWithIssues.id }), dialogue = node(eventGraph, 'startDialogue'); wire(eventGraph, timer, dialogue);
const pageStep = addGameFlowStep(p, 'beforeTitle', { kind: 'page', pageId: pageWithIssues.id });
const controls = createCustomUiPage(p, '按钮操作检查'), badButton = controls.components[1];
badButton.name = '不应跳转的开始按钮'; badButton.clickMode = 'replace'; badButton.action = 'start';
addGameFlowStep(p, 'beforeNewGame', { kind: 'page', pageId: controls.id });
synchronizeBlueprintSignatures(p);
const diagnostics = compileProject(p).diagnostics;
const nestedIssue = diagnostics.find(issue => issue.code === 'gameFlow.path.capability' && issue.nodeId === currentCharacter.id)!;
const pageIssue = diagnostics.find(issue => issue.code === 'gameFlow.path.capability' && issue.nodeId === dialogue.id)!;
const exitIssue = diagnostics.find(issue => issue.code === 'gameFlow.path.noCompletion' && issue.gameFlow?.stepId === pageStep.id)!;
const controlIssue = diagnostics.find(issue => issue.code === 'gameFlow.path.jump' && issue.ui?.componentId === badButton.id)!;
expect([nestedIssue, pageIssue, exitIssue, controlIssue].every(Boolean)).toBe(true);
await saveProject(projectFile, p);
const original = await fs.readFile(projectFile, 'utf8');
const checks: string[] = [], errors: string[] = [], processes: { pid?: number; alive: boolean }[] = [];
let app: ElectronApplication | undefined, page: Page | undefined, phase = 'launch', failure: string | undefined;
async function open() {
  app = await launchDesktopFixture({ root, profile: path.join(output, 'profile'), projectFile });
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(p.name);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 960));
}
async function close() {
  if (!app) return;
  const pid = app.process().pid; await app.close(); app = undefined;
  let alive = false; if (pid) try { process.kill(pid, 0); alive = true; } catch { /* Process exited. */ }
  processes.push({ pid, alive }); expect(alive).toBe(false);
}
async function locate(message: string) {
  if (!await page!.locator('.problems-panel').isVisible()) await page!.locator('.status-bar > button').first().click();
  const row = page!.locator('.problems-panel .diagnostic-main').filter({ hasText: message });
  await expect(row).toHaveCount(1); await row.click();
  await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  expect(await fs.readFile(projectFile, 'utf8')).toBe(original);
}
try {
  await open();
  phase = 'nested module';
  await locate(nestedIssue.message);
  await expect(page!.locator('.react-flow__node[data-id="' + currentCharacter.id + '"]')).toHaveClass(/selected/);
  await expect(page!.locator('.problems-panel .diagnostic-main').filter({ hasText: nestedIssue.message })).toContainText('内部初始化模块');
  await page!.screenshot({ path: path.join(output, 'nested-module-node.png') });
  checks.push('启动页经嵌套通用蓝图产生的当前台词角色能力错误定位到实际节点，而不是游戏流程步骤。');

  phase = 'owned UI graph';
  await locate(pageIssue.message);
  await expect(page!.locator('.ui-event-library')).toBeVisible();
  await expect(page!.locator('.react-flow__node[data-id="' + dialogue.id + '"]')).toHaveClass(/selected/);
  await page!.screenshot({ path: path.join(output, 'page-event-node.png') });
  checks.push('页面事件内部错误进入所属页面的事件工作区并保留精确选中节点。');

  phase = 'missing completion';
  await locate(exitIssue.message);
  await expect(page!.getByRole('region', { name: '流程图', exact: true })).toBeVisible();
  await expect(page!.locator('.react-flow__node[data-id="' + flowStepNodeId(pageStep.id) + '"]')).toHaveClass(/selected/);
  await expect(page!.getByLabel('节点页面')).toHaveValue(pageWithIssues.id);
  checks.push('没有具体错误节点的完成出口警告仍定位到统一流程画布中的准确页面步骤。');

  phase = 'component action';
  await locate(controlIssue.message);
  await expect(page!.locator('[data-component-id="' + badButton.id + '"].selected, .ui-event-components [data-ui-component-id="' + badButton.id + '"][aria-pressed="true"]')).toHaveCount(1);
  checks.push('按钮的生命周期跳转错误定位到正确自定义页面和控件。');
  for (const width of [1280, 1024]) {
    await app!.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 900), width);
    await expect.poll(() => page!.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    await page!.screenshot({ path: path.join(output, 'component-diagnostic-' + width + '.png') });
  }
  checks.push('1280 和 1024 像素窗口没有页面级横向溢出，诊断与属性定位可见。');

  phase = 'reopen';
  await close(); await open(); await locate(nestedIssue.message);
  await expect(page!.locator('.react-flow__node[data-id="' + currentCharacter.id + '"]')).toHaveClass(/selected/);
  expect(await fs.readFile(projectFile, 'utf8')).toBe(original);
  checks.push('关闭并重开隔离工程后诊断和节点定位保持一致；查看与导航没有改写工程或制造草稿。');
  expect(errors).toEqual([]);
} catch (error) {
  failure = String(error); await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined); console.error(phase, error);
} finally {
  try { await close(); } catch (error) { failure ??= String(error); }
  await fs.writeFile(path.join(output, 'processes.json'), JSON.stringify(processes, null, 2));
  try { const cleanup = await cleanVerificationDirectories(output, ['project', 'profile']); expect(cleanup.errors).toEqual([]); } catch (error) { failure ??= String(error); }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: failure ? 'failed' : 'passed', phase, checks, errors, failure, diagnostics, projectFile, packaged: false, userProjectModified: false }, null, 2));
}
console.log((failure ? 'FAIL: ' : 'PASS: ') + path.join(output, 'report.json'));
if (failure) process.exitCode = 1;
