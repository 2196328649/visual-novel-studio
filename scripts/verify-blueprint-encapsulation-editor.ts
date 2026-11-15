import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBlueprintEncapsulationFixture } from './lib/blueprint-encapsulation-fixture';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { fitBlueprintCanvas } from './lib/blueprint-canvas';
import { projectSchema } from '../src/core/model';
import { compileProject } from '../src/runtime/compiler';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { saveProject } from '../src/desktop/project-store';
import { cleanVerificationDirectories, type VerificationCleanup } from './lib/verification-cleanup';

if (process.env.VNS_INSTALLED_EXE) throw new Error('Only the isolated development editor is permitted.');
const root = path.resolve('.'), output = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? path.join(root, 'artifacts'), 'blueprint-encapsulation-editor', new Date().toISOString().replaceAll(':', '-'));
const builtRenderer = process.env.VNS_VERIFY_BUILT_RENDERER === '1';
const fixture = createBlueprintEncapsulationFixture(), { project, cache, events, close: closeNode } = fixture;
project.name = '用户节点封装验收';
const unsafe = createBlueprintGraph('function', '输出顺序边界'), unsafeDelay = blueprintNodeDefaults('delay'), unsafeValue = blueprintNodeDefaults('literal'), unsafeRead = blueprintNodeDefaults('setVariable');
unsafeDelay.x = 900; unsafeValue.x = 900; unsafeValue.y = 320; unsafeRead.x = 450;
unsafeValue.properties.value = 7; unsafeValue.pins[0].dataType = 'number'; unsafeRead.properties.variableId = project.variables.find(v => v.type === 'number')!.id;
unsafe.nodes.push(unsafeRead, unsafeDelay, unsafeValue); project.blueprints.push(unsafe); synchronizeBlueprintSignatures(project);
for (const [from, pin, to, target] of [[unsafe.nodes[0].id, 'exec', unsafeRead.id, 'exec_in'], [unsafeRead.id, 'exec_out', unsafeDelay.id, 'exec_in'], [unsafeValue.id, 'value', unsafeRead.id, 'value']]) expect(connectBlueprintPins(unsafe, from, pin, to, target)).toBeUndefined();
const projectFile = path.join(output, 'project/project.vns.json');
await fs.mkdir(path.dirname(projectFile), { recursive: true }); await saveProject(projectFile, project);
let server: ViteDevServer | undefined;
if (!builtRenderer) { server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/resources/**', '**/release/**', '**/work/**'] } } }); await server.listen(); }
const devUrl = server ? 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port : undefined;
let app: ElectronApplication | undefined, page: Page | undefined, phase = 'launch', failure: string | undefined;
let cleanup: VerificationCleanup | undefined;
const checks: string[] = [], errors: string[] = [], processes: { pid?: number; alive: boolean }[] = [];
const graphNode = (id: string) => page!.locator('.react-flow__node[data-id="' + id + '"]');
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const dialog = () => page!.getByRole('dialog', { name: '封装为用户节点', exact: true });
const record = (value: string) => { checks.push(value); console.log('PASS ' + checks.length + ': ' + value); };
async function launch() {
  app = await launchDesktopFixture({ root, profile: path.join(output, 'profile'), projectFile, devUrl, sdkRoot: 'E:/Tools/renpy-8.5.3-sdk' });
  page = await app.firstWindow(); page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(project.name);
  if (builtRenderer) expect(fileURLToPath(page.url())).toBe(path.join(root, 'dist/index.html'));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 1000));
}
async function close() {
  if (!app) return;
  const pid = app.process().pid; await app.close();
  let alive = false; if (pid) try { process.kill(pid, 0); alive = true; } catch { /* Isolated process exited. */ }
  processes.push({ pid, alive }); expect(alive).toBe(false); app = undefined;
}
async function fit() { await fitBlueprintCanvas(page!); }
async function openGraph(id: string) {
  await page!.locator('[data-workspace-tab="blueprint"]').click();
  await page!.getByLabel('蓝图资源', { exact: true }).selectOption('graph:' + id); await fit();
}
async function save(ui = false) {
  if (ui) { await page!.getByRole('button', { name: '保存界面', exact: true }).click(); await expect(page!.locator('.ui-save-status')).toHaveText('已保存'); await expect(page!.getByRole('button', { name: '保存界面', exact: true })).toBeDisabled(); }
  await page!.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page!.locator('.dirty-dot')).toHaveCount(0); return read();
}
async function enterPage() {
  await page!.locator('.view-tabs').getByRole('button', { name: '界面', exact: true }).click();
  await page!.getByLabel('界面编辑模式').getByRole('button', { name: '设计', exact: true }).click();
  await page!.getByLabel('设计页面', { exact: true }).selectOption(fixture.root.id);
  await page!.getByLabel('界面编辑模式').getByRole('button', { name: '事件图', exact: true }).click();
  await expect(page!.getByLabel('当前页面事件图', { exact: true })).toHaveValue(events.id); await fit();
}
async function marquee(ids: string[]) {
  await page!.locator('.blueprint-workspace .workspace-toolbar').click({ position: { x: 80, y: 20 } }); await page!.keyboard.press('Escape');
  const boxes = await Promise.all(ids.map(id => graphNode(id).boundingBox())); expect(boxes.every(Boolean)).toBe(true);
  const x1 = Math.min(...boxes.map(b => b!.x)) - 12, y1 = Math.min(...boxes.map(b => b!.y)) - 12;
  const x2 = Math.max(...boxes.map(b => b!.x + b!.width)) + 12, y2 = Math.max(...boxes.map(b => b!.y + b!.height)) + 12;
  await page!.mouse.move(x1, y1); await page!.mouse.down(); await page!.mouse.move(x2, y2, { steps: 16 }); await page!.mouse.up();
  await expect.poll(async () => (await page!.locator('.react-flow__node.selected').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-id')))).sort()).toEqual([...ids].sort());
}
async function begin() { await page!.getByRole('button', { name: '封装所选节点', exact: true }).click(); await expect(dialog()).toBeVisible(); }
try {
  await launch(); await openGraph(cache.id);
  const original = await read(), originalBytes = await fs.readFile(projectFile, 'utf8');
  phase = 'reject original event';
  await graphNode(cache.nodes[0].id).locator('.graph-node-title strong').click(); await begin();
  await expect(dialog().getByRole('alert')).toContainText('事件入口属于原图或页面');
  await expect(dialog().getByRole('button', { name: '创建并替换', exact: true })).toBeDisabled();
  await dialog().getByRole('button', { name: '取消', exact: true }).focus(); await page!.keyboard.press('Delete');
  await expect(page!.locator('.react-flow__node')).toHaveCount(cache.nodes.length);
  await page!.screenshot({ path: path.join(output, 'event-rejected.png') });
  await dialog().getByRole('button', { name: '取消', exact: true }).click();
  expect(await fs.readFile(projectFile, 'utf8')).toBe(originalBytes);
  await expect(graphNode(cache.nodes[0].id)).toHaveClass(/selected/);
  record('页面/调用事件入口明确拒绝；对话框 Delete 不误删画布，取消后选择和工程保持不变。');

  phase = 'reject output before call'; await openGraph(unsafe.id); await marquee([unsafeDelay.id, unsafeValue.id]); await begin();
  await expect(dialog().getByRole('alert')).toContainText('调用完成之后');
  await expect(dialog().getByRole('button', { name: '创建并替换', exact: true })).toBeDisabled();
  await page!.screenshot({ path: path.join(output, 'output-order-rejected.png') }); await page!.keyboard.press('Escape');
  await expect(dialog()).toHaveCount(0); expect(await fs.readFile(projectFile, 'utf8')).toBe(originalBytes); await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  record('输出在调用前被读取时，真实编辑器明确拒绝；Escape 退出不改变节点、连线、工程文件或历史。');

  phase = 'marquee selection'; await openGraph(cache.id);
  const selection = fixture.selections.find(s => s.graphId === cache.id)!.nodeIds; await marquee(selection);
  await begin(); await expect(dialog().getByRole('heading', { name: '输入参数 · 2', exact: true })).toBeVisible();
  await expect(dialog().getByRole('heading', { name: '输出结果 · 1', exact: true })).toBeVisible();
  await dialog().getByLabel('用户节点名称', { exact: true }).fill(fixture.identity.name);
  await expect(dialog().getByRole('alert')).toContainText('已被其他蓝图使用');
  await expect(dialog().getByRole('button', { name: '创建并替换', exact: true })).toBeDisabled();
  const nameInput = dialog().getByLabel('用户节点名称', { exact: true }); await nameInput.fill('计值等待用户节点');
  await nameInput.press('End'); await nameInput.pressSequentially('x'); await nameInput.press('Control+z'); await expect(nameInput).toHaveValue('计值等待用户节点');
  await nameInput.press('Control+y'); await expect(nameInput).toHaveValue('计值等待用户节点x'); await nameInput.fill('计值等待用户节点');
  await expect(page!.locator('.react-flow__node')).toHaveCount(cache.nodes.length); await expect(dialog().getByRole('button', { name: '创建并替换', exact: true })).toHaveClass(/\bprimary\b/);
  for (const width of [1280, 1024]) {
    await app!.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 900), width);
    await expect.poll(() => page!.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    const bounds = (await dialog().getByRole('button', { name: '创建并替换', exact: true }).boundingBox())!;
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(900);
    await page!.screenshot({ path: path.join(output, 'boundary-dialog-' + width + '.png') });
  }
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 1000));
  await dialog().getByRole('button', { name: '创建并替换', exact: true }).click(); await expect(dialog()).toHaveCount(0);
  await expect(page!.locator('.react-flow__node')).toHaveCount(cache.nodes.length - selection.length + 1);
  const callerId = (await page!.locator('.react-flow__node.selected').getAttribute('data-id'))!;
  let saved = await save(), module = saved.blueprints.find(g => g.name === '计值等待用户节点')!;
  expect(module).toBeTruthy(); expect(module.kind).toBe('macro'); expect(module.exposedInputs).toHaveLength(2); expect(module.exposedOutputs).toHaveLength(1);
  expect(selection.every(id => module.nodes.some(n => n.id === id))).toBe(true);
  expect(saved.blueprints.find(g => g.id === cache.id)!.nodes.find(n => n.id === callerId)?.properties.graphId).toBe(module.id);
  expect(compileProject(saved).diagnostics.filter(d => d.severity === 'error')).toEqual([]);
  record('真实框选片段提取两个输入和一个输出；重复名称阻止提交，1024/1280 对话框可见且无页面级溢出，替换后编译通过。');

  phase = 'one-step undo and redo';
  await page!.getByRole('button', { name: '撤销', exact: true }).click(); saved = await save();
  expect(saved.blueprints).toEqual(original.blueprints);
  await page!.getByRole('button', { name: '重做', exact: true }).click(); saved = await save();
  expect(saved.blueprints.find(g => g.id === module.id)).toEqual(module);
  const beforeNavigation = await fs.readFile(projectFile, 'utf8');
  await fit(); await graphNode(callerId).locator('.graph-node-title strong').dblclick();
  await expect(page!.getByLabel('蓝图资源', { exact: true })).toHaveValue('graph:' + module.id);
  await page!.getByRole('button', { name: '输入与输出', exact: true }).click();
  await expect(page!.locator('[data-interface-pin-id]')).toHaveCount(3);
  for (const [direction, pins] of [['input', module.exposedInputs], ['output', module.exposedOutputs]] as const) {
    const section = page!.locator('[data-interface-direction="' + direction + '"]');
    for (const pin of pins) {
      const member = section.locator('[data-interface-pin-id="' + pin.id + '"]').getByRole('button');
      await member.click(); await expect(member).toHaveAttribute('aria-pressed', 'true');
      await expect(section.locator('.blueprint-interface-card')).toHaveCount(1);
      await expect(section.locator('[data-interface-details-id="' + pin.id + '"]')).toBeVisible();
      await expect(section.getByLabel(pin.name + '的数据类型', { exact: true })).toHaveValue(pin.dataType);
      const usesDefault = section.getByLabel(pin.name + '使用默认值', { exact: true });
      if (pin.defaultValue === undefined) { await expect(usesDefault).not.toBeChecked(); await expect(section.getByLabel(pin.name + '的默认值', { exact: true })).toHaveCount(0); }
      else { await expect(usesDefault).toBeChecked(); await expect(section.getByLabel(pin.name + '的默认值', { exact: true })).toHaveValue(String(pin.defaultValue)); }
    }
  }
  await page!.screenshot({ path: path.join(output, 'generated-module-interface.png') });
  expect(await fs.readFile(projectFile, 'utf8')).toBe(beforeNavigation);
  record('原图替换和新模块一次撤销/重做完整恢复；双击进入模块后逐个选中三个真实参数，类型和默认值正确，每组只展开当前项。');

  phase = 'UI draft encapsulation'; await enterPage();
  await graphNode(closeNode.id).locator('.graph-node-title strong').click(); await begin();
  await dialog().getByLabel('用户节点名称', { exact: true }).fill('界面关闭用户节点');
  await dialog().getByRole('button', { name: '创建并替换', exact: true }).click();
  const uiCallerId = (await page!.locator('.react-flow__node.selected').getAttribute('data-id'))!;
  await expect(graphNode(closeNode.id)).toHaveCount(0);
  await page!.getByRole('button', { name: /^撤销/ }).click(); await expect(graphNode(closeNode.id)).toHaveCount(1);
  await page!.getByRole('button', { name: /^重做/ }).click(); await expect(graphNode(uiCallerId)).toHaveCount(1);
  saved = await save(true);
  const uiModule = saved.blueprints.find(g => g.name === '界面关闭用户节点')!; expect(uiModule).toBeTruthy();
  expect(saved.blueprints.find(g => g.id === events.id)?.uiPageId).toBe(fixture.root.id);
  expect(uiModule.nodes.some(n => n.id === closeNode.id)).toBe(true);
  expect(compileProject(saved).diagnostics.filter(d => d.severity === 'error')).toEqual([]);
  await page!.screenshot({ path: path.join(output, 'page-event-encapsulated.png') });
  record('页面事件图保留归属和触发入口，只封装关闭动作；界面草稿内一次撤销/重做，保存时新模块与原事件图一同持久化。');

  phase = 'reopen'; const persisted = await fs.readFile(projectFile, 'utf8');
  await close(); await launch(); await openGraph(cache.id); await expect(graphNode(callerId)).toHaveCount(1);
  await enterPage(); await expect(graphNode(uiCallerId)).toHaveCount(1); await expect(graphNode(closeNode.id)).toHaveCount(0);
  await expect(page!.getByRole('button', { name: '保存界面', exact: true })).toBeDisabled(); expect(await fs.readFile(projectFile, 'utf8')).toBe(persisted);
  expect(errors).toEqual([]);
  record('关闭重开后普通图与页面草稿的模块、引脚与连线全部保留；浏览不产生未保存改动或脚本异常。');
} catch (error) {
  failure = String(error); console.error(phase, error); await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
} finally {
  try { await close(); } catch (error) { failure ??= String(error); }
  try { await server?.close(); } catch (error) { failure ??= 'Server cleanup: ' + String(error); }
  try { if (app) throw new Error('Fixture is still running.'); cleanup = await cleanVerificationDirectories(output, ['project', 'profile']); expect(cleanup.errors).toEqual([]); } catch (error) { failure ??= 'Directory cleanup: ' + String(error); }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: failure || errors.length ? 'failed' : 'passed', renderer: builtRenderer ? 'built' : 'development', phase, checks, errors, processes, failure, projectFile, cleanup }, null, 2));
}
if (failure || errors.length) process.exitCode = 1;
console.log('Report: ' + path.join(output, 'report.json'));
