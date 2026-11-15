import assert from 'node:assert/strict';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { projectSchema, type BlueprintNode } from '../src/core/model';
import { saveProject } from '../src/desktop/project-store';
import { compileProject } from '../src/runtime/compiler';
import { createUiControlInteractionFixture } from './lib/ui-control-interaction-fixture';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { fitBlueprintCanvas } from './lib/blueprint-canvas';
import { openUiPreviewWindow, showUiPreviewTestData } from './lib/ui-preview-window';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

if (process.env.VNS_INSTALLED_EXE) throw new Error('This acceptance uses an isolated development editor, never the installed application.');
const root = path.resolve('.'), output = path.resolve('artifacts/ui-control-interaction-editor', new Date().toISOString().replaceAll(':', '-'));
const f = createUiControlInteractionFixture(), projectFile = path.join(output, 'project/project.vns.json');
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
  await fs.mkdir(path.join(output,'project'),{recursive:true});await saveProject(projectFile,f.project);
  server=await createServer({root,server:{host:'127.0.0.1',port:0,watch:{ignored:['**/artifacts/**','**/work/**','**/resources/**','**/release/**']}}});
  await server.listen();const devUrl='http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port;
  await launch(devUrl);await openGraph();
  const field=(node:BlueprintNode,name:string)=>inspector().getByLabel(node.name+' · '+name,{exact:true});
  const savedNode=(saved:Awaited<ReturnType<typeof read>>,id:string)=>saved.blueprints.find(graph=>graph.id===f.editGraph.id)!.nodes.find(node=>node.id===id)!;
  phase='range and focus authoring';await select(f.editorRange);
  for(const [name,value] of [['范围下限','100'],['范围上限','200'],['调整步长','25']]){await field(f.editorRange,name).fill(value);await field(f.editorRange,name).press('Tab');}
  let saved=await save();assert.equal(savedNode(saved,f.editorRange.id).properties.minimum,100);assert.equal(savedNode(saved,f.editorRange.id).properties.maximum,200);
  assert.ok(savedNode(saved,f.editorRange.id).pins.filter(pin=>['minimum','maximum','step'].includes(pin.id)).every(pin=>pin.dataType==='number'));
  await select(f.editorFocus);await expect(card(f.editorFocus.id)).toContainText('请求已接受');await field(f.editorFocus,'获取焦点').selectOption('false');saved=await save();
  assert.equal(savedNode(saved,f.editorFocus.id).properties.focused,false);assert.equal(savedNode(saved,f.editorFocus.id).pins.find(pin=>pin.id==='accepted')!.dataType,'boolean');
  await page.getByRole('button',{name:'撤销',exact:true}).click();saved=await save();assert.equal(savedNode(saved,f.editorFocus.id).properties.focused,true);
  await page.getByRole('button',{name:'重做',exact:true}).click();saved=await save();assert.equal(savedNode(saved,f.editorFocus.id).properties.focused,false);
  await close();await launch(devUrl);await openGraph();await select(f.editorRange);await expect(field(f.editorRange,'范围下限')).toHaveValue('100');await expect(field(f.editorRange,'调整步长')).toHaveValue('25');
  await select(f.editorFocus);await expect(field(f.editorFocus,'获取焦点')).toHaveValue('false');
  checks.push('范围数值引脚、焦点请求/接受引脚、撤销重做及保存重开。');

  phase='atomic authored range and capability list';await enterDesign();await page.locator('[data-hierarchy-id="range_slider"]').click();
  const minimum=page.getByLabel('控件范围下限',{exact:true}),maximum=page.getByLabel('控件范围上限',{exact:true}),increment=page.getByLabel('用户调整步长',{exact:true}),apply=page.getByRole('button',{name:'应用整个控件范围',exact:true});
  await expect(minimum).toHaveValue('0');await expect(maximum).toHaveValue('60');
  await minimum.fill('100');await minimum.press('Tab');await expect(apply).toBeDisabled();
  assert.deepEqual((await read()).ui.customPages[0].components[0].controlRange,{min:0,max:60,step:10});
  await maximum.fill('200');await maximum.press('Tab');await increment.fill('25');await increment.press('Tab');await apply.click();saved=await save();
  assert.deepEqual(saved.ui.customPages[0].components[0].controlRange,{min:100,max:200,step:25});
  await page.getByRole('button',{name:'撤销',exact:true}).click();saved=await save();assert.deepEqual(saved.ui.customPages[0].components[0].controlRange,{min:0,max:60,step:10});
  const capabilities=page.getByLabel('控件蓝图能力',{exact:true});if(await capabilities.getAttribute('open')===null)await capabilities.locator(':scope > summary').click();
  await expect(capabilities.locator('[data-ui-property-capability="minimum"]')).toContainText('读 / 写');await expect(capabilities.locator('[data-ui-property-capability="sourceMinimum"]')).toContainText('只读');
  await expect(capabilities.getByLabel('控件蓝图操作')).toContainText('设置控件范围');await expect(capabilities.getByLabel('控件蓝图操作')).not.toContainText('请求输入焦点');
  await page.locator('[data-hierarchy-id="focus_a_input"]').click();if(await capabilities.getAttribute('open')===null)await capabilities.locator(':scope > summary').click();
  await expect(capabilities.locator('[data-ui-property-capability="focused"]')).toContainText('只读');await expect(capabilities.getByLabel('控件蓝图操作')).toContainText('请求输入焦点');
  await expect(capabilities.getByLabel('控件蓝图操作')).not.toContainText('设置控件范围');
  for(const [width,height] of [[1700,1000],[1024,768]]){await app!.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setContentSize(size[0],size[1]),[width,height]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await page.screenshot({path:path.join(output,'range-focus-authoring-'+width+'.png')});}
  saved=await save();checks.push('设计范围一次应用，非法中间草稿不入工程；属性/操作能力按绑定类型展示。');
  const beforePreview=await fs.readFile(projectFile,'utf8');

  phase='actual control ranges';preview=await openUiPreviewWindow(app!,page);preview.setDefaultTimeout(18000);preview.on('pageerror',error=>errors.push(error.message));
  await app!.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().endsWith('#ui-preview'))!.setContentSize(1440,1000));
  await showUiPreviewTestData(preview);await preview.getByLabel('画面缩放比例',{exact:true}).selectOption('fit');
  const target=(id:string)=>preview!.locator('[data-preview-component="'+id+'"]');
  const act=(id:string)=>target('act_'+id).click();
  const parameter=(name:string)=>preview!.getByLabel('预演参数 '+name,{exact:true});
  const slider=target('range_slider').getByRole('slider'),mirror=target('range_mirror').getByRole('slider'),a=target('focus_a_input').getByRole('textbox'),b=target('focus_b_input').getByRole('textbox');
  const reset=async()=>{await preview!.getByRole('button',{name:'恢复测试值',exact:true}).click();await expect(slider).toHaveValue('30');await expect(a).not.toBeFocused();await expect(b).not.toBeFocused();};
  const play=()=>preview!.getByRole('button',{name:'播放计时',exact:true}).click();
  const stop=()=>preview!.getByRole('button',{name:'暂停计时',exact:true}).click();
  await expect(slider).toHaveValue('30');await act('narrow');await expect(slider).toHaveAttribute('min','10');await expect(slider).toHaveAttribute('max','20');await expect(slider).toHaveValue('20');await expect(mirror).toHaveValue('30');await expect(parameter('共享数值')).toHaveValue('30');
  await act('range_reset');await act('override');await act('fixed');await expect(slider).toHaveValue('12');await expect(slider).toBeDisabled();await act('range_reset');await expect(slider).toHaveValue('15');
  await act('wide');await expect(slider).toHaveValue('100');await act('source');await expect(slider).toHaveValue('160');await expect(mirror).toHaveValue('80');await expect(parameter('共享数值')).toHaveValue('160');
  await expect(parameter('用户改值次数')).toHaveValue('0');await expect(parameter('用户提交次数')).toHaveValue('0');await preview.screenshot({path:path.join(output,'range-effective-values.png')});
  await reset();await act('narrow');await slider.press('Home');await expect(slider).toHaveValue('10');await slider.press('ArrowRight');await expect(slider).toHaveValue('12');await slider.press('End');await expect(slider).toHaveValue('20');await expect(parameter('用户改值次数')).toHaveValue('3');
  checks.push('真实滑条采用当前范围、固定值和步长；源/镜像/覆盖分离且程序调整不冒充用户事件。');

  phase='programmatic DOM focus commands';await reset();await preview.getByLabel('按时间预演',{exact:true}).check();await play();await act('chain');
  await expect(parameter('chain_done')).toHaveValue('true');await expect(parameter('chain_a_immediate')).toHaveValue('false');await expect(parameter('chain_a_after')).toHaveValue('true');await expect(parameter('chain_b_after')).toHaveValue('true');await expect(parameter('chain_b_released')).toHaveValue('false');
  await expect(a).not.toBeFocused();await expect(b).not.toBeFocused();await expect(parameter('用户改值次数')).toHaveValue('0');await expect(parameter('用户提交次数')).toHaveValue('0');await stop();
  await preview.screenshot({path:path.join(output,'programmatic-focus-no-submissions.png')});
  // A manual time jump crosses A -> B -> release in one render. Its net command
  // must blur A even if B never appeared as an intermediate DOM frame.
  await reset();await act('chain');await expect(a).toBeFocused();await preview.getByRole('button',{name:'推进 1 秒',exact:true}).click();await expect(parameter('chain_done')).toHaveValue('true');await expect(a).not.toBeFocused();await expect(b).not.toBeFocused();
  await reset();await play();await act('coalesce');await expect(parameter('coalesce_done')).toHaveValue('true');await expect(parameter('coalesce_a')).toHaveValue('false');await expect(parameter('coalesce_b_after_release_a')).toHaveValue('true');await expect(b).toBeFocused();await expect(parameter('用户提交次数')).toHaveValue('0');
  await b.fill('乙X');await b.press('Enter');await expect(parameter('用户改值次数')).toHaveValue('1');await expect(parameter('用户提交次数')).toHaveValue('1');
  await a.focus();const time=()=>preview!.getByLabel('预演时间',{exact:true}).textContent().then(value=>Number.parseFloat(value!));const before=await time();await expect.poll(time).toBeGreaterThan(before+.2);await expect(a).toBeFocused();
  await a.press('Enter');await expect(parameter('用户提交次数')).toHaveValue('2');await stop();
  checks.push('一次性 DOM 焦点命令、跨刷新推进净结果、后请求优先和定向释放；后续真实用户焦点不被旧命令抢回。');

  phase='focus invalidation and page instance boundaries';
  for(const name of ['hide','disable','readonly','modal']){await reset();await play();await act(name);await expect(parameter(name+'_done')).toHaveValue('true');await expect(parameter(name+'_accepted')).toHaveValue(name==='readonly'?'false':'true');await expect(parameter(name+'_after')).toHaveValue('false');await expect(a).not.toBeFocused();await expect(parameter('用户提交次数')).toHaveValue('0');await stop();}
  await reset();await play();await act('fresh');await expect(parameter('fresh_after')).toHaveValue('true');await expect(parameter('fresh_immediate')).toHaveValue('false');const child=target('child_input').getByRole('textbox');await expect(child).toBeFocused();await preview.screenshot({path:path.join(output,'fresh-page-focus.png')});await child.press('Enter');await target('child_close').click();await stop();
  await reset();await play();await act('reopen');await expect(parameter('reopen_done')).toHaveValue('true');await expect(parameter('child_accepted')).toHaveValue('true');await expect(parameter('child_reopened_focus')).toHaveValue('false');await expect(target('child_input').getByRole('textbox')).not.toBeFocused();await target('child_close').click();await stop();
  await reset();await play();await act('native');await expect(parameter('native_after')).toHaveValue('true');const native=target('native_focus_input').getByRole('textbox');await expect(native).toBeFocused();await expect(parameter('native_immediate')).toHaveValue('false');await expect(parameter('用户提交次数')).toHaveValue('0');await preview.screenshot({path:path.join(output,'template-input-focus.png')});await native.press('Enter');await target('native_focus_close').click();await stop();
  await reset();await play();await act('background');await expect(parameter('job_done')).toHaveValue('true');await expect(a).toBeFocused();await expect(slider).toHaveAttribute('min','25');await expect(slider).toHaveAttribute('max','45');await expect(parameter('用户提交次数')).toHaveValue('0');await preview.screenshot({path:path.join(output,'background-range-focus.png')});await a.press('Enter');await stop();
  checks.push('父级隐藏、禁用、只读、模态覆盖和重开取消旧请求；首次构造、内置模板、后台任务共用同一焦点操作。');
  assert.equal(await fs.readFile(projectFile,'utf8'),beforePreview);await close();saved=await read();assert.deepEqual(compileProject(saved).diagnostics.filter(issue=>issue.severity==='error'),[]);assert.deepEqual(errors,[]);report.status='passed';
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
