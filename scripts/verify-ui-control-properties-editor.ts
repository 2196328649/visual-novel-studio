import assert from 'node:assert/strict';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { projectSchema, type BlueprintNode } from '../src/core/model';
import { saveProject } from '../src/desktop/project-store';
import { compileProject } from '../src/runtime/compiler';
import { createUiControlPropertyFixture, uiControlPropertyFixturePng } from './lib/ui-control-property-fixture';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { fitBlueprintCanvas } from './lib/blueprint-canvas';
import { openUiPreviewWindow } from './lib/ui-preview-window';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

if (process.env.VNS_INSTALLED_EXE) throw new Error('This acceptance uses an isolated development editor, never the installed application.');
const root = path.resolve('.'), output = path.resolve('artifacts/ui-control-properties-editor', new Date().toISOString().replaceAll(':', '-'));
const f = createUiControlPropertyFixture(), projectFile = path.join(output, 'project/project.vns.json');
let server: ViteDevServer | undefined, app: ElectronApplication | undefined, page!: Page, preview: Page | undefined, phase = 'setup';
const checks: string[] = [], errors: string[] = [], processes: { pid?: number; exited: boolean }[] = [];
const report: Record<string, unknown> = { status: 'running', checks, errors, processes };
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const inspector = () => page.locator('.blueprint-properties');
const card = (id: string) => page.locator('.react-flow__node[data-id="' + id + '"]');
async function save() {
  const uiSave = page.getByRole('button', { name: '保存界面', exact: true });
  if (await uiSave.isVisible() && await uiSave.isEnabled()) await uiSave.click();
  await page.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page.locator('.dirty-dot')).toHaveCount(0);
  return read();
}
async function launch(devUrl: string) {
  app = await launchDesktopFixture({ root, profile: path.join(output, 'profile'), projectFile, devUrl });
  page = await app.firstWindow(); page.setDefaultTimeout(18000); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(f.project.name, { timeout: 45000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1700, 1000));
}
async function close() {
  const problems: string[] = [];
  if (preview && !preview.isClosed()) {
    try {
      await preview.getByRole('button', { name: '关闭预览', exact: true }).click();
      await expect.poll(() => preview!.isClosed()).toBe(true);
    } catch (error) { problems.push('Preview did not close normally: ' + String(error)); }
  }
  if (!app) { preview = undefined; if (problems.length) throw new Error(problems.join('\n')); return; }
  const owned = app, child = owned.process();
  const exited = () => child.exitCode !== null || child.signalCode !== null;
  // Keep ownership until the child really exits. A failed preview or save prompt
  // cannot prevent cleanup of this isolated fixture, or lose the retry handle.
  // Quit through the editor's normal path (unsaved fixture edits are discarded by the fixture).
  // app.exit() after a closed UI preview window crashes Electron during shutdown on Windows.
  if (!exited()) await owned.evaluate(({ app }) => app.quit()).catch(() => undefined);
  try {
    await expect.poll(exited, { timeout: 15000 }).toBe(true);
  } catch (error) {
    problems.push('Editor required forced termination: ' + String(error));
    if (!exited()) child.kill();
    try { await expect.poll(exited, { timeout: 15000 }).toBe(true); }
    catch (exitError) { problems.push(String(exitError)); }
  }
  const state = processes.find(record => record.pid === child.pid);
  if (state) state.exited = exited(); else processes.push({ pid: child.pid, exited: exited() });
  if (exited()) { if (app === owned) app = undefined; preview = undefined; }
  else problems.push('Owned editor process is still alive; its handle and directories were retained.');
  if (problems.length) throw new Error(problems.join('\n'));
}
async function openGraph() {
  await page.locator('[data-workspace-tab="blueprint"]').click(); await page.getByLabel('演出目标', { exact: true }).selectOption('graph:' + f.editGraph.id);
  if (!await inspector().isVisible()) await page.getByRole('button', { name: '展开蓝图属性', exact: true }).click();
}
async function select(node: BlueprintNode) {
  await fitBlueprintCanvas(page); await card(node.id).locator('.graph-node-title strong').click();
  await inspector().getByRole('button', { name: '节点参数', exact: true }).click();
}
async function enterDesign() {
  await page.locator('.view-tabs').getByRole('button', { name: '界面', exact: true }).click();
  await page.getByLabel('界面编辑模式').getByRole('button', { name: '设计', exact: true }).click();
  await page.getByLabel('设计页面', { exact: true }).selectOption(f.page.id);
}
try {
  await fs.mkdir(path.join(output, 'project/assets'), { recursive: true });
  await fs.writeFile(path.join(output, 'project/assets/control-track.png'), uiControlPropertyFixturePng()); await saveProject(projectFile, f.project);
  server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/work/**', '**/resources/**', '**/release/**'] } } });
  await server.listen(); const devUrl = 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port;
  await launch(devUrl); await openGraph();
  const field = (node: BlueprintNode, name: string) => inspector().getByLabel(name === '界面组件' ? name : node.name + ' · ' + name, { exact: true });
  const savedNode = (saved: Awaited<ReturnType<typeof read>>, id: string) => saved.blueprints.find(graph=>graph.id===f.editGraph.id)!.nodes.find(node=>node.id===id)!;
  phase = 'typed current values and write policy'; await select(f.editorSet);
  const property = field(f.editorSet, '组件属性');
  await expect(property.locator('option[value="numberValue"]')).toHaveCount(1);
  await expect(property.locator('option[value="stringValue"]')).toHaveCount(0);
  await expect(property.locator('option[value="minimum"]')).toHaveCount(1);
  await expect(property.locator('option[value="sourceMinimum"]')).toHaveCount(0);
  await property.selectOption('normalizedValue'); await field(f.editorSet, '属性值').fill('0.4'); await field(f.editorSet, '属性值').press('Tab');
  await field(f.editorSet, '赋值方式').selectOption('source'); let saved = await save();
  assert.equal(savedNode(saved,f.editorSet.id).properties.writeMode,'source');
  assert.equal(savedNode(saved,f.editorSet.id).pins.find(pin=>pin.id==='value')!.dataType,'number');
  await page.getByRole('button',{name:'撤销',exact:true}).click(); saved=await save(); assert.equal(savedNode(saved,f.editorSet.id).properties.writeMode,'override');
  await page.getByRole('button',{name:'重做',exact:true}).click(); saved=await save(); assert.equal(savedNode(saved,f.editorSet.id).properties.writeMode,'source');
  await select(f.editorGet); await expect(field(f.editorGet,'组件属性')).toHaveValue('focused');
  saved=await save(); assert.equal(savedNode(saved,f.editorGet.id).pins.find(pin=>pin.id==='value')!.dataType,'boolean');
  await field(f.editorGet,'界面组件').selectOption('choices'); await field(f.editorGet,'组件属性').selectOption('optionLabel'); saved=await save();
  assert.equal(savedNode(saved,f.editorGet.id).pins.find(pin=>pin.id==='value')!.dataType,'string');
  await close(); await launch(devUrl); await openGraph(); await select(f.editorSet);
  await expect(field(f.editorSet,'赋值方式')).toHaveValue('source'); await expect(field(f.editorSet,'组件属性')).toHaveValue('normalizedValue');
  await expect(field(f.editorSet,'属性值')).toHaveValue('0.4');
  checks.push('控件类型决定当前值/范围/选项能力；赋值方式一次撤销重做、类型化引脚与保存重开均保持。');

  phase='design capability and input fields'; await enterDesign(); await page.locator('[data-hierarchy-id="input"]').click();
  await expect(page.getByLabel('输入最大长度',{exact:true})).toHaveValue('6'); await expect(page.getByLabel('输入占位文字',{exact:true})).toHaveValue('请输入名字');
  const capabilities=page.getByLabel('控件蓝图能力',{exact:true}); await capabilities.locator('summary').click();
  await expect(capabilities.locator('[data-ui-property-capability="focused"]')).toContainText('只读');
  await expect(capabilities.locator('[data-ui-property-capability="stringValue"]')).toContainText('绑定源');
  await expect(capabilities.locator('[data-ui-property-capability="numberValue"]')).toHaveCount(0);
  for(const [width,height] of [[1700,1000],[1024,768]]) {
    await app!.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setContentSize(size[0],size[1]),[width,height]);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true); await page.screenshot({path:path.join(output,'control-capabilities-'+width+'.png')});
  }
  const beforePreview=await fs.readFile(projectFile,'utf8');
  phase='actual control preview'; preview=await openUiPreviewWindow(app!,page); preview.setDefaultTimeout(18000); preview.on('pageerror',error=>errors.push(error.message));
  await app!.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().endsWith('#ui-preview'))!.setContentSize(1220,850));
  const target=(id:string)=>preview!.locator('[data-preview-component="'+id+'"]');
  const input=target('input').getByRole('textbox'), slider=target('slider').locator('input[type="range"]'), mirror=target('mirror').locator('input[type="range"]');
  const mode=target('choices').getByRole('combobox');
  const parameter=(name:string)=>preview!.getByLabel('预演参数 '+name,{exact:true});
  await target('temporary').click(); await expect(slider).toHaveValue('0'); await expect(mirror).toHaveValue('30');
  await expect(input).toHaveValue(''); await expect(input).toHaveAttribute('placeholder','蓝图占位 🦊'); await expect(input).toHaveAttribute('data-max-length','4');
  await expect(mode).toHaveValue('困难'); await expect(parameter('共享数值')).toHaveValue('30'); await expect(parameter('输入文字')).toHaveValue('原值');
  await expect(parameter('用户改值次数')).toHaveValue('0'); await expect(parameter('用户提交次数')).toHaveValue('0');
  await expect(target('slider').locator('.ui-preference-fill')).toHaveCSS('background-color','rgb(221, 119, 34)');
  await preview.screenshot({path:path.join(output,'temporary-values-preview.png')});
  await target('source').click(); await expect(slider).toHaveValue('60'); await expect(mirror).toHaveValue('60'); await expect(input).toHaveValue('源🦊'); await expect(mode).toHaveValue('旁观');
  await target('reset').click(); await expect(slider).toHaveValue('60'); await expect(parameter('用户改值次数')).toHaveValue('0');
  await input.fill('A🦊BCX'); await expect(input).toHaveValue('A🦊BC'); await expect(parameter('输入文字')).toHaveValue('A🦊BC');
  await input.press('Enter'); await expect(parameter('用户提交次数')).toHaveValue('1'); await expect(input).not.toBeFocused();
  const bounds=(await slider.boundingBox())!; await preview.mouse.click(bounds.x+bounds.width*.65,bounds.y+bounds.height*.5);
  await expect.poll(async()=>await slider.inputValue()===await mirror.inputValue()).toBe(true);
  await mode.selectOption('简单'); await target('toggle').getByRole('checkbox').check();
  const changed=await parameter('用户改值次数').inputValue(); assert.ok(Number(changed)>=4);
  await target('lock').click(); await expect(input).toBeDisabled(); await expect(slider).toBeDisabled(); await expect(mode).toBeDisabled();
  await target('source').click(); await expect(parameter('用户改值次数')).toHaveValue(changed); await expect(slider).toHaveValue('60');
  await preview.screenshot({path:path.join(output,'readonly-program-assignment.png')});
  await preview.getByRole('button',{name:'恢复测试值',exact:true}).click(); await expect(input).toBeEnabled(); await expect(input).toHaveValue('原值'); await expect(slider).toHaveValue('30');
  await expect(parameter('用户改值次数')).toHaveValue('0'); assert.equal(await fs.readFile(projectFile,'utf8'),beforePreview);
  checks.push('真实输入框、下拉框、开关和滑条使用有效覆盖值；程序赋值/别名重置不触发用户事件，Unicode 长度、只读及恢复测试值不改工程。');
  await close(); saved=await read(); assert.deepEqual(compileProject(saved).diagnostics.filter(issue=>issue.severity==='error'),[]);
  assert.deepEqual(errors,[]); report.status='passed';
} catch (error) {
  report.status = 'failed'; report.error = error instanceof Error ? error.stack : String(error);
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined); process.exitCode = 1;
} finally {
  try { await close(); } catch (error) { report.status = 'failed'; report.closeError = String(error); process.exitCode = 1; }
  try { await server?.close(); } catch (error) { report.status = 'failed'; report.serverError = String(error); process.exitCode = 1; }
  try {
    if (app) throw new Error('Cannot remove an isolated fixture while its owned editor is still running.');
    if (await fs.stat(output).catch(() => undefined)) {
      const cleanup = await cleanVerificationDirectories(output, ['project', 'profile']); report.cleanup = cleanup;
      if (cleanup.errors.length) throw new Error('Fixture cleanup did not finish.');
    }
  } catch (error) { report.status = 'failed'; report.cleanupError = String(error); process.exitCode = 1; }
  report.phase = phase; await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(path.join(output, 'report.json')); if (report.error) console.error(report.error);
}
