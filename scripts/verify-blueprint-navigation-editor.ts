import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBlueprintEncapsulationFixture, encapsulateInvocationFixture } from './lib/blueprint-encapsulation-fixture';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { fitBlueprintCanvas } from './lib/blueprint-canvas';
import { projectSchema } from '../src/core/model';
import { projectGraphs } from '../src/core/project-resources';
import { projectToText } from '../src/core/text-script';
import { sameProjectValue } from '../src/core/project-history';
import { saveProject } from '../src/desktop/project-store';
import { compileProject } from '../src/runtime/compiler';
import { cleanVerificationDirectories, type VerificationCleanup } from './lib/verification-cleanup';

if (process.env.VNS_INSTALLED_EXE) throw new Error('Only the isolated development editor is permitted.');
const root = path.resolve('.'), output = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? path.join(root, 'artifacts'), 'blueprint-navigation-editor', new Date().toISOString().replaceAll(':', '-'));
const builtRenderer = process.env.VNS_VERIFY_BUILT_RENDERER === '1';
const fixture = createBlueprintEncapsulationFixture(), extracted = encapsulateInvocationFixture(fixture), { project } = fixture;
const cache = extracted.find(value => value.source.id === fixture.cache.id)!, pageCall = extracted.find(value => value.source.id === fixture.events.id)!;
const innerCall = cache.module.nodes.find(node => node.type === 'callFunction')!;
project.name = '模块往返导航验收';
for (const [index, node] of fixture.identity.nodes.entries()) { node.x = index * 430; node.y = 0; }
const transientPassage = project.nodes.find(node => node.kind === 'passage')!;
if (transientPassage.kind !== 'passage') throw new Error('Missing story fixture.');
transientPassage.lines[0].text = '临时图导航用例'; transientPassage.lines[0].actions = [{ kind: 'blueprint', blueprintId: fixture.identity.id }, { kind: 'pause', seconds: .1 }];
const projectFile = path.join(output, 'project/project.vns.json'); await fs.mkdir(path.dirname(projectFile), { recursive: true }); await saveProject(projectFile, project);
let server: ViteDevServer | undefined, devUrl: string | undefined;
let app: ElectronApplication | undefined, page: Page | undefined, phase = 'launch', failure: string | undefined;
let cleanup: VerificationCleanup | undefined;
const checks: string[] = [], errors: string[] = [], processes: { pid?: number; alive: boolean }[] = [];
const navigationBoundaries: { label: string; dirty: number }[] = [];
let textBaseline: { changedFields: string[]; source: string; graphIds: string[]; storyIds: string[] } | undefined;
const graphNode = (id: string) => page!.locator('.react-flow__node[data-id="' + id + '"]');
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const record = (value: string) => { checks.push(value); console.log('PASS ' + checks.length + ': ' + value); };
const back = () => page!.getByRole('button', { name: '返回调用位置', exact: true });
async function navigationBoundary(label: string) {
  const entry = { label, dirty: await page!.locator('.dirty-dot').count() };
  navigationBoundaries.push(entry); console.log('Navigation boundary: ' + JSON.stringify(entry));
  await expect(page!.locator('.dirty-dot'), label).toHaveCount(0);
}
async function launch() {
  if (!builtRenderer && !server) {
    server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/resources/**', '**/release/**', '**/work/**'] } } });
    await server.listen(); devUrl = 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port;
  }
  app = await launchDesktopFixture({ root, profile: path.join(output, 'profile'), projectFile, devUrl, sdkRoot: 'E:/Tools/renpy-8.5.3-sdk' });
  page = await app.firstWindow(); page.setDefaultTimeout(14000); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 }); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 1000));
  if (builtRenderer) expect(fileURLToPath(page.url())).toBe(path.join(root, 'dist/index.html'));
}
async function close() {
  if (!app) return; const pid = app.process().pid; await app.close();
  let alive = false; if (pid) try { process.kill(pid, 0); alive = true; } catch { /* Expected process exit. */ }
  processes.push({ pid, alive }); expect(alive).toBe(false); app = undefined;
}
async function fit() { await fitBlueprintCanvas(page!); }
async function openGraph(id: string) { await page!.locator('[data-workspace-tab="blueprint"]').click(); await page!.getByLabel('蓝图资源', { exact: true }).selectOption('graph:' + id); await fit(); }
async function save(ui = false) {
  if (ui) { await page!.getByRole('button', { name: '保存界面', exact: true }).click(); await expect(page!.locator('.ui-save-status')).toHaveText('已保存'); await expect(page!.getByRole('button', { name: '保存界面', exact: true })).toBeDisabled(); }
  await page!.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page!.locator('.dirty-dot')).toHaveCount(0); return read();
}
async function canvas() {
  return {
    nodes: (await page!.locator('.react-flow__node.selected').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-id')))).sort(),
    edges: (await page!.locator('.react-flow__edge.selected').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-id')))).sort(),
    transform: await page!.locator('.react-flow__viewport').evaluate(element => { const matrix = new DOMMatrix(getComputedStyle(element).transform); return [matrix.a, matrix.d, matrix.e, matrix.f]; }),
  };
}
async function restored(expected: Awaited<ReturnType<typeof canvas>>) {
  try { await expect.poll(async () => { const actual = await canvas(); return JSON.stringify(actual.nodes) === JSON.stringify(expected.nodes) && JSON.stringify(actual.edges) === JSON.stringify(expected.edges) && actual.transform.every((value, index) => Math.abs(value - expected.transform[index]) < .1); }).toBe(true); }
  catch (error) { const evidence = { phase, expected, actual: await canvas() }; console.error('Canvas mismatch', evidence); await fs.writeFile(path.join(output, 'canvas-mismatch.json'), JSON.stringify(evidence, null, 2)); throw error; }
}
async function enterPage() {
  await page!.locator('.view-tabs').getByRole('button', { name: '界面', exact: true }).click();
  await page!.getByLabel('界面编辑模式').getByRole('button', { name: '设计', exact: true }).click(); await page!.getByLabel('设计页面', { exact: true }).selectOption(fixture.root.id); await page!.getByLabel('界面编辑模式').getByRole('button', { name: '事件图', exact: true }).click();
  await expect(page!.getByLabel('当前页面事件图', { exact: true })).toHaveValue(fixture.events.id); await fit();
}
try {
  await launch(); await openGraph(cache.source.id); const original = await read(), originalBytes = await fs.readFile(projectFile, 'utf8');
  phase = 'nested navigation'; await graphNode(cache.caller.id).locator('.graph-node-title strong').click();
  const box = (await graphNode(cache.caller.id).boundingBox())!; await page!.mouse.move(box.x + box.width / 2, box.y + 20); await page!.mouse.wheel(0, -120); await page!.waitForTimeout(300);
  const parentView = await canvas(); await graphNode(cache.caller.id).locator('.graph-node-title strong').dblclick();
  await expect(page!.getByLabel('蓝图资源', { exact: true })).toHaveValue('graph:' + cache.module.id); await expect(back()).toBeVisible(); await fit();
  await graphNode(innerCall.id).locator('.graph-node-title strong').click();
  const companion = cache.module.nodes.find(node => node.type === 'delay')!; await graphNode(companion.id).locator('.graph-node-title strong').click({ modifiers: ['Control'] });
  await expect(page!.locator('.react-flow__node.selected')).toHaveCount(2); const moduleView = await canvas();
  await page!.getByRole('button', { name: '编辑“' + fixture.identity.name + '”', exact: true }).click();
  await expect(page!.getByLabel('蓝图资源', { exact: true })).toHaveValue('graph:' + fixture.identity.id); await expect(page!.getByRole('navigation', { name: '模块调用导航' })).toContainText(cache.module.name);
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1024, 900));
  await expect.poll(() => page!.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await page!.screenshot({ path: path.join(output, 'nested-navigation-1024.png') }); await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 1000));
  await fit(); await graphNode(fixture.identity.nodes[0].id).locator('.graph-node-title strong').click();
  const nodeName = page!.getByLabel('节点名称', { exact: true }); await nodeName.fill('导航内的修改'); await nodeName.press('Alt+ArrowLeft');
  await expect(page!.getByLabel('蓝图资源', { exact: true })).toHaveValue('graph:' + fixture.identity.id);
  await back().click(); await expect(page!.getByLabel('蓝图资源', { exact: true })).toHaveValue('graph:' + cache.module.id); await restored(moduleView);
  await back().focus(); await page!.keyboard.press('Alt+ArrowLeft');
  await expect(page!.getByLabel('蓝图资源', { exact: true })).toHaveValue('graph:' + cache.source.id); await restored(parentView); await expect(back()).toHaveCount(0);
  expect(await fs.readFile(projectFile, 'utf8')).toBe(originalBytes); let saved = await save();
  expect(saved.blueprints.find(g => g.id === fixture.identity.id)!.nodes[0].name).toBe('导航内的修改');
  await page!.getByRole('button', { name: '撤销', exact: true }).click(); saved = await save(); expect(saved.blueprints).toEqual(original.blueprints);
  await page!.screenshot({ path: path.join(output, 'original-canvas-restored.png') });
  record('双击与属性面板进入模块共用两层历史；逐级返回恢复节点选择和缩放/平移，Alt+← 不抢输入框，返回不撤销编辑或产生历史项。');

  phase = 'saved page return'; await enterPage(); await graphNode(pageCall.caller.id).locator('.graph-node-title strong').click(); const pageView = await canvas();
  await graphNode(pageCall.caller.id).locator('.graph-node-title strong').dblclick(); await expect(back()).toBeVisible(); await back().click();
  await expect(page!.getByLabel('当前页面事件图', { exact: true })).toHaveValue(fixture.events.id); await restored(pageView); await expect(page!.getByRole('button', { name: '保存界面', exact: true })).toBeDisabled();
  record('页面调用进入公共模块后返回同一页面事件图和原选择，浏览不会制造界面草稿或写盘。');

  phase = 'new module in unsaved page';
  await page!.getByRole('button', { name: '封装所选节点', exact: true }).click();
  const dialog = page!.getByRole('dialog', { name: '封装为用户节点', exact: true }); await dialog.getByLabel('用户节点名称', { exact: true }).fill('仅草稿中的导航模块'); await dialog.getByRole('button', { name: '创建并替换', exact: true }).click();
  const newCallerId = (await page!.locator('.react-flow__node.selected').getAttribute('data-id'))!; await graphNode(newCallerId).locator('.graph-node-title strong').dblclick();
  const leave = page!.getByRole('dialog', { name: '保存界面修改', exact: true }); await expect(leave).toBeVisible(); await leave.getByRole('button', { name: '取消', exact: true }).click();
  await expect(graphNode(newCallerId)).toHaveClass(/selected/); await expect(back()).toHaveCount(0); expect((await read()).blueprints.some(g => g.name === '仅草稿中的导航模块')).toBe(false);
  await graphNode(newCallerId).locator('.graph-node-title strong').dblclick(); await leave.getByRole('button', { name: '保存并继续', exact: true }).click();
  await expect.poll(async () => (await read()).blueprints.some(g => g.name === '仅草稿中的导航模块'), { message: 'Save-and-continue must finish persisting the new module before reading its ID.' }).toBe(true);
  saved = await read(); const newModule = saved.blueprints.find(g => g.name === '仅草稿中的导航模块')!; expect(newModule).toBeTruthy();
  await expect(page!.getByLabel('蓝图资源', { exact: true })).toHaveValue('graph:' + newModule.id); await expect(back()).toBeVisible();
  await back().click(); await expect(page!.getByLabel('当前页面事件图', { exact: true })).toHaveValue(fixture.events.id); await expect(graphNode(newCallerId)).toHaveClass(/selected/);
  expect(compileProject(saved).diagnostics.filter(d => d.severity === 'error')).toEqual([]);
  record('页面草稿中新建的模块先受保存提示保护；取消保留原选择且不记访问，保存后使用最新工程快照进入，再返回准确调用节点。');

  phase = 'discarded draft target'; const beforeDiscard = await fs.readFile(projectFile, 'utf8');
  await page!.getByRole('button', { name: '封装所选节点', exact: true }).click(); await dialog.getByLabel('用户节点名称', { exact: true }).fill('将被放弃的模块'); await dialog.getByRole('button', { name: '创建并替换', exact: true }).click();
  const discardedCaller = (await page!.locator('.react-flow__node.selected').getAttribute('data-id'))!; await graphNode(discardedCaller).locator('.graph-node-title strong').dblclick(); await leave.getByRole('button', { name: '不保存', exact: true }).click();
  await expect(graphNode(newCallerId)).toHaveCount(1); await expect(graphNode(discardedCaller)).toHaveCount(0); await expect(back()).toHaveCount(0);
  await expect(page!.getByRole('button', { name: '保存界面', exact: true })).toBeDisabled(); expect(await fs.readFile(projectFile, 'utf8')).toBe(beforeDiscard);
  record('放弃草稿同时删除其新模块时拒绝过期目标，不跳到其他蓝图、不残留返回条、不改写工程。');

  phase = 'transient performance'; await navigationBoundary('before script entry'); await page!.locator('[data-workspace-tab="script"]').click();
  await navigationBoundary('after script entry');
  await page!.locator('#line-' + transientPassage.lines[0].id + ' textarea').click();
  await navigationBoundary('after selecting transient dialogue');
  // The whole-line entry lives in text mode; module rows edit individual actions.
  await page!.getByRole('button', { name: '文本编辑', exact: true }).click();
  const performanceLine = page!.locator('.passage-performance-line[data-line-id="' + transientPassage.lines[0].id + '"]');
  await expect(performanceLine).toContainText('临时图导航用例');
  // The older fixture has no stored text. Its first apply is preparation, not
  // a navigation change: persist the actual UI synchronization before proving
  // that entering and returning from the temporary graph is read-only.
  const beforeTextSync = await read(), baselineSource = beforeTextSync.scriptText?.content ?? projectToText(beforeTextSync);
  await page!.getByRole('button', { name: '应用到项目', exact: true }).click();
  await page!.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  const synchronized = await read();
  const projectKeys = new Set([...Object.keys(beforeTextSync), ...Object.keys(synchronized)] as (keyof typeof synchronized)[]);
  const changedFields = [...projectKeys].filter(key => !sameProjectValue(beforeTextSync[key], synchronized[key]));
  textBaseline = { changedFields, source: synchronized.scriptText?.content ?? '', graphIds: projectGraphs(synchronized).map(graph => graph.id), storyIds: synchronized.nodes.map(node => node.id) };
  await fs.writeFile(path.join(output, 'text-baseline-before.json'), JSON.stringify(beforeTextSync, null, 2));
  await fs.writeFile(path.join(output, 'text-baseline-after.json'), JSON.stringify(synchronized, null, 2));
  expect(changedFields.every(key => key === 'scriptText')).toBe(true);
  expect(synchronized.scriptText).toMatchObject({ format: 'vns-text-1', content: baselineSource, standaloneSyntax: 'module-names', performanceSyntax: 'explicit', playbackSyntax: 'inline' });
  expect(projectGraphs(synchronized)).toEqual(projectGraphs(beforeTextSync));
  expect(synchronized.nodes).toEqual(beforeTextSync.nodes);
  await expect(performanceLine).toContainText('临时图导航用例');
  await navigationBoundary('before whole-line performance entry');
  await performanceLine.getByRole('button', { name: '在蓝图中编辑演出', exact: true }).click();
  await navigationBoundary('after whole-line performance entry');
  // This fixture calls an ordinary function plus a pause. It cannot become a
  // timeline clip, so both the entry and return must remain in the graph editor.
  const resource = page!.getByLabel('蓝图资源', { exact: true });
  await expect(resource).toHaveValue(/^graph:.+/); await expect(resource).not.toHaveValue('graph:' + fixture.identity.id);
  await expect(page!.getByLabel('时间轴预设', { exact: true })).toHaveCount(0);
  await expect(page!.getByRole('button', { name: '查看组件连线', exact: true })).toHaveCount(0);
  await expect(page!.getByRole('region', { name: '蓝图工作区', exact: true })).toBeVisible();
  const temporaryGraph = (await resource.inputValue()).slice(6);
  expect(projectGraphs(await read()).some(g => g.id === temporaryGraph)).toBe(false); await fit();
  const temporaryCall = page!.locator('.react-flow__node').filter({ has: page!.locator('.node-kind-callFunction') }).first(); await temporaryCall.locator('.graph-node-title strong').click();
  const temporaryView = await canvas(), beforeTemporary = await fs.readFile(projectFile, 'utf8');
  await navigationBoundary('before transient module entry');
  await temporaryCall.locator('.graph-node-title strong').dblclick(); await expect(resource).toHaveValue('graph:' + fixture.identity.id); await navigationBoundary('inside transient module'); await expect(back()).toBeVisible(); await back().click();
  await expect(resource).toHaveValue('graph:' + temporaryGraph); await expect(page!.getByLabel('时间轴预设', { exact: true })).toHaveCount(0); await restored(temporaryView);
  expect(await fs.readFile(projectFile, 'utf8')).toBe(beforeTemporary); await navigationBoundary('after transient return');
  await page!.screenshot({ path: path.join(output, 'transient-performance-restored.png') });
  record('尚未物化的整行演出可进入模块再返回，生成图和节点 ID 不变；仅导航不会安装临时图、改写原行或弄脏工程。');

  phase = 'materialize transient edit and undo';
  const beforeMaterialize = await read(), moving = (await temporaryCall.locator('.graph-node-title').boundingBox())!;
  await page!.mouse.move(moving.x + moving.width / 2, moving.y + moving.height / 2); await page!.mouse.down();
  await page!.mouse.move(moving.x + moving.width / 2 + 55, moving.y + moving.height / 2 + 35, { steps: 6 }); await page!.mouse.up();
  await expect(page!.locator('.dirty-dot')).toHaveCount(1); await page!.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  const materialized = await read(); expect(materialized.blueprints.some(g => g.id === temporaryGraph)).toBe(true);
  expect(materialized.nodes.find(n => n.id === transientPassage.id)).not.toEqual(beforeMaterialize.nodes.find(n => n.id === transientPassage.id));
  expect(compileProject(materialized).diagnostics.filter(d => d.severity === 'error')).toEqual([]);
  await page!.getByRole('button', { name: '撤销', exact: true }).click(); await page!.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  const unmade = await read(); expect(projectGraphs(unmade).some(g => g.id === temporaryGraph)).toBe(false);
  expect(unmade.nodes.find(n => n.id === transientPassage.id)).toEqual(beforeMaterialize.nodes.find(n => n.id === transientPassage.id));
  expect(unmade.scriptText).toEqual(beforeMaterialize.scriptText);
  record('临时演出图仅在实际编辑时物化，并同步原行文本；一次撤销同时恢复原演出与文本，不影响命名模块的独立提交。');

  phase = 'reopen'; const persisted = await fs.readFile(projectFile, 'utf8'); await close(); await launch(); await openGraph(cache.source.id); await expect(back()).toHaveCount(0);
  expect(await fs.readFile(projectFile, 'utf8')).toBe(persisted); expect(errors).toEqual([]); record('重新打开工程不带入过期导航历史，无脚本异常；隔离编辑器正常退出。');
} catch (error) { failure = String(error); console.error(phase, error); await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined); }
finally {
  try { await close(); } catch (error) { failure ??= String(error); }
  try { await server?.close(); } catch (error) { failure ??= 'Server cleanup: ' + String(error); }
  try {
    if (app || processes.some(process => process.alive)) throw new Error('Fixture process did not exit; preserve its directories.');
    cleanup = await cleanVerificationDirectories(output, ['project', 'profile']); expect(cleanup.errors).toEqual([]);
  } catch (error) { failure ??= 'Directory cleanup: ' + String(error); }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: failure || errors.length ? 'failed' : 'passed', renderer: builtRenderer ? 'built' : 'development', phase, checks, errors, processes, failure, projectFile, cleanup, navigationBoundaries, textBaseline }, null, 2));
}
if (failure || errors.length) process.exitCode = 1; console.log('Report: ' + path.join(output, 'report.json'));
