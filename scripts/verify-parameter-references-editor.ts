import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createProject, newNode, projectSchema, type Project } from '../src/core/model';
import { blueprintNodeDefaults, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { parameterUsages } from '../src/core/parameter-usages';
import { projectToText } from '../src/core/text-script';
import { currentScriptText } from '../src/core/script-text';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

// Run only after the complete implementation has been built; all edits and
// scheme navigation remain within this script's own project and profile.
if (process.env.VNS_INSTALLED_EXE) throw new Error('Use the isolated compiled development editor.');
const root = path.resolve('.'), output = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? 'artifacts/parameter-references-editor',
  'parameter-references-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const relativeOutput = path.relative(root, output);
if (!relativeOutput || relativeOutput === '..' || relativeOutput.startsWith('..' + path.sep) || path.isAbsolute(relativeOutput)) {
  throw new Error('The new acceptance run must be inside this workspace.');
}
const projectFile = path.join(output, 'project/project.vns.json'), profile = path.join(output, 'profile');
const p = createProject('参数引用与导航验收');
p.variables = [{ id: 'score', name: '好感度', type: 'number', initial: 5, persistent: false }, { id: 'replacement', name: '备用数值', type: 'number', initial: 10, persistent: true }];
const set = newNode('set', p.scenes[0].id, 'score'); assert.equal(set.kind, 'set');
set.name = '增加好感'; set.value = 2; set.operation = 'add'; set.next = p.nodes.find(node => node.kind === 'end')!.id;
p.nodes.find(node => node.kind === 'passage')!.next = set.id; p.nodes.push(set);
const graph = createBlueprintGraph('function', '参数读取模块'), reader = blueprintNodeDefaults('getVariable');
reader.properties = { variableId: 'score', scope: 'project' }; graph.nodes.push(reader); p.blueprints.push(graph);
p.ui.components.push({ id: 'bound_control', name: '参数滑条', kind: 'preference', parameterId: 'score', text: '好感度', page: 'preferences', x: .1, y: .1, width: .6, height: .12 });
p.ui.instances = [{ id: 'source_scheme', name: '引用来源方案', components: [{ id: 'scheme_control', name: '方案滑条', kind: 'preference', parameterId: 'score', text: '方案参数', page: 'preferences', x: .1, y: .3, width: .6, height: .12 }] }, { id: 'derived_scheme', name: '派生方案', baseUiId: 'source_scheme', components: [] }];
p.ui.activeInstanceId = 'derived_scheme'; p.ui.disabledPages = [...new Set([...(p.ui.disabledPages ?? []), 'preferences' as const])];
synchronizeBlueprintSignatures(p); p.scriptText = currentScriptText(projectToText(p));
let app: ElectronApplication | undefined, page: Page | undefined, phase = 'setup', failure: unknown;
const checks: string[] = [], errors: string[] = [];
const processes: { pid?: number; exited: boolean; forced?: boolean }[] = [];
const report: Record<string, unknown> = { status: 'running', renderer: 'compiled', checks, errors, processes,
  temporaryPaths: [path.dirname(projectFile), profile] };
const button = (name: string) => page!.getByRole('button', { name, exact: true });
const detail = () => page!.getByRole('complementary', { name: '参数设置', exact: true });
const disk = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const record = (message: string) => { checks.push(message); console.log('PASS: ' + message); };
async function launch() {
  app = await launchDesktopFixture({ root, projectFile, profile, devUrl: '' });
  processes.push({ pid: app.process().pid, exited: false }); page = await app.firstWindow();
  page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(p.name, { timeout: 45000 });
  assert.equal(path.resolve(fileURLToPath(page.url())), path.join(root, 'dist/index.html'));
  report.rendererUrl = page.url(); await page.evaluate('globalThis.__name = value => value');
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.webContents.setBackgroundThrottling(false); window.setContentSize(1440, 960); });
}
async function close() {
  if (!app) return;
  const owned = app, child = owned.process(), exited = () => child.exitCode !== null || child.signalCode !== null;
  const record = processes.find(item => item.pid === child.pid)!;
  let closeError: unknown;
  try { await owned.close(); await expect.poll(exited, { timeout: 15000 }).toBe(true); }
  catch (error) {
    closeError = error;
    if (!exited()) { record.forced = true; child.kill(); }
    await expect.poll(exited, { timeout: 15000 }).toBe(true);
  } finally {
    record.exited = exited(); if (record.exited) { app = undefined; page = undefined; }
  }
  if (closeError) throw closeError;
}
async function parameter(id = 'score') {
  await page!.locator('[data-workspace-tab="variables"]').click();
  if (await page!.locator('.parameter-set-card').count()) await page!.locator('[data-parameter-set-id="parameters_story"]').click();
  await page!.locator(`[data-parameter-id="${id}"]`).click();
  await expect(detail()).toBeVisible();
}
async function save() { await button('保存工程').click(); await expect(page!.locator('.dirty-dot')).toHaveCount(0, { timeout: 45000 }); return disk(); }
async function references() { const group = detail().locator('details').filter({ has: page!.locator(':scope > summary', { hasText: '分组与引用' }) }); if (await group.getAttribute('open') === null) await group.locator('summary').click(); return group; }
async function undo() { await button('撤销').click(); }
try {
  await fs.mkdir(path.dirname(projectFile), { recursive: true }); await saveProject(projectFile, p);
  await launch(); await parameter();
  const original = await fs.readFile(projectFile, 'utf8');
  phase = 'invalid names and IME';
  const name = detail().getByLabel('参数名称', { exact: true });
  for (const invalid of ['', '备用数值']) {
    await name.fill(invalid); await name.press('Tab'); await expect(name).toHaveAttribute('aria-invalid', 'true');
    await expect(page!.locator('.dirty-dot')).toHaveCount(0); assert.equal(await fs.readFile(projectFile, 'utf8'), original);
    await name.focus(); await name.press('Escape'); await expect(name).toHaveValue('好感度');
  }
  await name.fill('中文候选');
  await name.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, keyCode: 229, bubbles: true });
  await expect(page!.locator('.dirty-dot')).toHaveCount(0); await name.press('Escape');
  await name.fill('亲密度'); await name.press('Control+s');
  await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  await expect.poll(async () => (await disk()).variables[0].name).toBe('亲密度');
  assert.match((await disk()).scriptText!.content, /亲密度【score】/);
  await undo(); await expect(detail().getByLabel('参数名称', { exact: true })).toHaveValue('好感度'); await save();
  record('属性名称拦截空白和重名，中文候选回车不提交；Ctrl+S保存已输入的新名称，一次撤销还原。');

  phase = 'context rename';
  await page!.locator('[data-parameter-id="score"]').click({ button: 'right' });
  await page!.getByRole('menuitem', { name: '重命名', exact: true }).click();
  const rename = page!.getByRole('dialog', { name: '重命名', exact: true });
  await rename.getByLabel('新名称').fill('备用数值'); await rename.getByRole('button', { name: '确定', exact: true }).click(); await expect(rename.getByRole('alert')).toBeVisible();
  await page!.keyboard.press('Escape'); await expect(rename).toBeHidden(); await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  record('右键改名共用校验，Esc取消且不写入工程。');

  phase = 'read-only reference navigation';
  const beforeNavigation = await fs.readFile(projectFile, 'utf8');
  for (const kind of ['story', 'blueprint', 'base-ui', 'scheme-ui']) {
    await parameter(); const group = await references();
    const text = kind === 'story' ? '增加好感' : kind === 'blueprint' ? '参数读取模块' : kind === 'base-ui' ? '基础界面' : '引用来源方案';
    await group.getByRole('button').filter({ hasText: text }).click();
    if (kind === 'story') await expect(page!.locator(`.react-flow__node[data-id="${set.id}"]`)).toHaveClass(/selected/);
    else if (kind === 'blueprint') await expect(page!.locator(`.react-flow__node[data-id="${reader.id}"]`)).toHaveClass(/selected/);
    else {
      await expect(page!.getByLabel('设计页面', { exact: true })).toHaveValue('preferences');
      await expect(page!.locator('.ui-legacy-page-note')).toContainText('此页面已停用');
      await expect(page!.locator(`[data-hierarchy-id="${kind === 'base-ui' ? 'bound_control' : 'scheme_control'}"]`)).toBeVisible();
      await expect(button('保存界面')).toBeDisabled();
    }
    await expect(page!.locator('.dirty-dot')).toHaveCount(0); assert.equal(await fs.readFile(projectFile, 'utf8'), beforeNavigation);
  }
  record('剧情、蓝图、基础界面与方案引用均精确定位；停用页可修复但不会启用，也不改变游戏使用的方案。');

  phase = 'storage and type';
  await parameter(); await detail().getByLabel('保存方式', { exact: true }).selectOption('local');
  let saved = await save(); assert.equal(saved.variables.find(variable => variable.id === 'score')!.persistent, true);
  assert.equal(saved.blueprints.find(item => item.id === graph.id)!.nodes.find(item => item.id === reader.id)!.properties.scope, 'player');
  await undo(); saved = await save(); assert.equal(saved.variables.find(variable => variable.id === 'score')!.persistent, false);
  assert.equal(saved.blueprints.find(item => item.id === graph.id)!.nodes.find(item => item.id === reader.id)!.properties.scope, 'project');
  await detail().getByLabel('参数类型', { exact: true }).selectOption('boolean');
  const change = page!.getByRole('dialog', { name: '更改参数类型', exact: true });
  await expect(change).toContainText('增加好感'); await expect(change).toContainText('方案滑条');
  await change.getByRole('button', { name: '确认更改类型', exact: true }).click();
  await expect(detail().getByLabel('参数类型', { exact: true })).toHaveValue('boolean');
  await undo(); await expect(detail().getByLabel('参数类型', { exact: true })).toHaveValue('number'); await save();
  record('切换存储同步显式读取作用域；改类型展示受影响引用，确认与撤销保留原引用。');

  phase = 'replace and undo';
  await detail().getByRole('button', { name: '删除参数', exact: true }).click();
  const deletion = page!.getByRole('dialog', { name: '删除参数', exact: true });
  await deletion.getByLabel('引用如何处理').selectOption('replacement'); await deletion.getByRole('button', { name: '替换引用并删除', exact: true }).click();
  saved = await save(); assert.equal(saved.variables.some(variable => variable.id === 'score'), false); assert.equal(parameterUsages(saved, 'score').length, 0);
  assert.ok(parameterUsages(saved, 'replacement').length >= 4);
  assert.equal(saved.ui.instances?.find(instance => instance.id === 'derived_scheme')?.components.length, 0);
  await undo(); await expect(detail().getByLabel('参数名称', { exact: true })).toHaveValue('好感度');
  saved = await save(); assert.ok(parameterUsages(saved, 'score').length >= 4);
  await button('重做').click(); saved = await save(); assert.equal(parameterUsages(saved, 'score').length, 0);
  await undo(); await save();
  record('同类型替换一次更新全部直接引用，删除、撤销、重做均完整；派生方案不产生多余覆盖。');

  phase = 'unapplied text';
  await page!.locator('[data-workspace-tab="script"]').click();
  await page!.getByLabel('剧本编辑模式').getByRole('button', { name: '文本编辑', exact: true }).click();
  const text = page!.getByRole('textbox', { name: '中文文本剧本', exact: true }); await expect(text).toBeVisible();
  const raw = await text.inputValue(); await text.fill(raw + '\n旁白：这是未应用文本，必须保留。\n@设置：好感度=17');
  await parameter(); await detail().getByLabel('参数名称', { exact: true }).fill('文本中的新名称'); await detail().getByLabel('参数名称', { exact: true }).press('Enter');
  saved = await save(); assert.match(saved.scriptText!.content, /这是未应用文本，必须保留/); assert.match(saved.scriptText!.content, /@设置：文本中的新名称【score】=17/);
  await references(); await detail().getByRole('button', { name: /剧本文本.*17/ }).click();
  await expect(page!.getByRole('textbox', { name: '中文文本剧本', exact: true })).toHaveValue(/这是未应用文本，必须保留/);
  record('参数改名与保存保留未应用文本，只更新引用操作数；文本引用可以回到原编辑位置。');

  phase = 'responsive appearance';
  await parameter(); await references();
  for (const theme of ['亮白', '黑白']) {
    await button('作品设置').click(); const settings = page!.getByRole('dialog', { name: '作品设置', exact: true });
    await settings.getByRole('button', { name: '编辑器外观', exact: true }).click(); await settings.locator('.editor-theme-card').filter({ hasText: theme }).click(); await settings.getByRole('button', { name: '完成', exact: true }).click();
    for (const width of [1440, 1024]) {
      await app!.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 960), width);
      await expect.poll(() => page!.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page!.screenshot({ path: path.join(output, `references-${theme}-${width}.png`) });
    }
  }
  await save(); await close(); await launch(); await parameter();
  await expect(detail().getByLabel('参数名称', { exact: true })).toHaveValue('文本中的新名称');
  await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  record('1440/1024宽度的深浅主题无页面横向溢出；保存重开保留参数和未应用文本。');
  assert.deepEqual(errors, []); report.status = 'passed';
  await fs.writeFile(path.join(output, 'saved-evidence.json'), JSON.stringify(await disk(), null, 2));
} catch (error) {
  failure = error; report.status = 'failed'; report.phase = phase; report.error = String(error); console.error(phase, error);
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
} finally {
  try { await close(); } catch (error) { report.status = 'failed'; report.closeError = String(error); failure ??= error; }
  try {
    if (app || processes.some(record => !record.exited)) throw new Error('An owned fixture process remains alive; retain its directories.');
    report.cleanup = await cleanVerificationDirectories(output, ['project', 'profile']);
    assert.deepEqual((report.cleanup as { errors: unknown[] }).errors, []);
  } catch (error) { report.status = 'failed'; report.cleanupError = String(error); failure ??= error; }
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(output);
}
if (failure) throw failure;
