import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { projectSchema, type BlueprintNode, type Project } from '../src/core/model';
import { createUiSpineFixture, writeUiSpineFixtureAssets } from './lib/ui-spine-fixture';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { fitBlueprintCanvas } from './lib/blueprint-canvas';
import { openDisclosureAncestors } from './lib/ui-disclosures';
import { setUiCanvasPreview } from './lib/ui-design-controls';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

// Run after the final build, without another native UI acceptance competing for focus.
if (process.env.VNS_INSTALLED_EXE) throw new Error('Spine speed acceptance requires the isolated final source build.');
const root = path.resolve('.');
const output = path.resolve('artifacts/ui-property-control-2026-11-09', 'spine-speed-editor-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const projectFile = path.join(output, 'project/project.vns.json'), legacyFile = path.join(output, 'legacy-project/project.vns.json');
const authorFile = path.resolve(process.env.VNS_AUTHOR_PROJECT ?? '../我的视觉小说1/project.vns.json');
const temporaryNames = ['project', 'profile', 'legacy-project', 'legacy-profile'];
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const fixture = createUiSpineFixture();
fixture.project.name = '骨骼速度边界验收'; fixture.project.id = 'ui_spine_speed_boundary';
fixture.rig.spine = { ...fixture.rig.spine, speed: 1, autoplay: true, loop: true };
// Only this script's in-memory authoring graph is narrowed to the two entry points.
fixture.editGraph.nodes = [fixture.editGraph.nodes[0]]; fixture.editGraph.links = [];
const speedNode = fixture.node(fixture.editGraph, 'setSpineSpeed', { componentId: fixture.rig.id, speed: 1 });
const propertyNode = fixture.node(fixture.editGraph, 'setUiProperty', { componentId: fixture.rig.id, property: 'spineSpeed', value: 1 });
fixture.next(fixture.editGraph, fixture.editGraph.nodes[0], speedNode); fixture.next(fixture.editGraph, speedNode, propertyNode);
fixture.editGraph.nodes.forEach((node, index) => { node.x = 20 + index * 430; node.y = 80; });
const original = projectSchema.parse(fixture.project), legacy = structuredClone(original);
legacy.id = 'ui_spine_speed_legacy'; legacy.name = '旧骨骼速度修复验收';
legacy.ui.customPages.find(item => item.id === fixture.page.id)!.components.find(item => item.id === fixture.rig.id)!.spine!.speed = 1e9;
const checks: { name: string; durationMs: number }[] = [], errors: string[] = [], processes: { pid?: number; exited: boolean }[] = [];
const evidence: Record<string, unknown> = {};
const report: Record<string, unknown> = { status: 'running', compiledBuild: true, checks, errors, processes, evidence, authorFile, temporaryPaths: temporaryNames.map(name => path.join(output, name)) };
let app: ElectronApplication | undefined, page: Page | undefined, activeFile = projectFile, phase = 'setup', authorHash: string | undefined, failure: unknown;
const persistReport = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const read = async (): Promise<Project> => projectSchema.parse(JSON.parse(await fs.readFile(activeFile, 'utf8')));
const rig = (project: Project) => project.ui.customPages.find(item => item.id === fixture.page.id)!.components.find(item => item.id === fixture.rig.id)!;
const savedNode = (project: Project, node: BlueprintNode) => project.blueprints.find(item => item.id === fixture.editGraph.id)!.nodes.find(item => item.id === node.id)!;
const ui = () => page!.locator('.ui-inspector');
const speedField = () => ui().locator('.ui-inspector-view:not([hidden]) .field[data-ui-property="spineSpeed"]');
const speedInput = () => speedField().getByRole('spinbutton');
const canvas = () => page!.locator('.ui-canvas [data-component-id="rig"] canvas');
const card = (node: BlueprintNode) => page!.locator('.react-flow__node[data-id="' + node.id + '"]');
const blueprintInspector = () => page!.locator('.blueprint-properties');
const dialog = () => page!.getByRole('dialog', { name: '属性控制设置', exact: true });
const settle = () => page!.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
async function launch(old = false) {
  activeFile = old ? legacyFile : projectFile;
  app = await launchDesktopFixture({ root, projectFile: activeFile, profile: path.join(output, old ? 'legacy-profile' : 'profile') });
  processes.push({ pid: app.process().pid, exited: false });
  page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]; if (window.isMaximized()) window.unmaximize();
    window.setContentSize(1600, 1000); window.webContents.setBackgroundThrottling(false);
  });
  await expect(page.locator('.project-title strong')).toHaveText(old ? legacy.name : original.name, { timeout: 45000 });
  assert.equal(new URL(page.url()).protocol, 'file:', 'Acceptance must exercise the built renderer, never Vite.');
  await page.evaluate('globalThis.__name = value => value');
}
async function close() {
  if (!app) return;
  const owned = app, child = owned.process(), exited = () => child.exitCode !== null || child.signalCode !== null;
  try { await owned.close(); }
  finally {
    await expect.poll(exited, { timeout: 15000 }).toBe(true);
    const record = processes.find(item => item.pid === child.pid); if (record) record.exited = exited();
    if (exited()) { app = undefined; page = undefined; }
  }
}
async function screenshot(name: string) {
  const url = page!.url();
  const data = await app!.evaluate(async ({ BrowserWindow }, url) => (await BrowserWindow.getAllWindows().find(item => item.webContents.getURL() === url)!.webContents.capturePage()).toPNG().toString('base64'), url);
  await fs.writeFile(path.join(output, name + '.png'), Buffer.from(data, 'base64'));
}
async function check(name: string, run: () => Promise<void>) {
  phase = name; const start = Date.now(); await run(); checks.push({ name, durationMs: Date.now() - start });
  await persistReport(); console.log('通过：' + name);
}
async function design() {
  await page!.locator('[data-workspace-tab="ui"]').click();
  await page!.getByLabel('界面编辑模式').getByRole('button', { name: '设计', exact: true }).click();
  await page!.getByLabel('设计页面', { exact: true }).selectOption(fixture.page.id);
  await page!.locator('[data-hierarchy-id="rig"]').click(); await settle();
  const content = ui().locator('.ui-inspector-view:not([hidden]) [data-ui-inspector-group="content"]');
  await openDisclosureAncestors(content);
  if (await content.getAttribute('open') === null) await content.locator(':scope > summary').click();
  await expect(speedInput()).toBeVisible(); await speedInput().scrollIntoViewIfNeeded();
}
async function saveUi() {
  const button = page!.getByRole('button', { name: '保存界面', exact: true });
  if (await button.isEnabled()) await button.click();
  await expect(page!.locator('.ui-save-status')).toHaveText('已保存', { timeout: 30000 }); await expect(button).toBeDisabled(); return read();
}
async function saveGraph() {
  await page!.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page!.locator('.dirty-dot')).toHaveCount(0, { timeout: 30000 }); return read();
}
async function accept(input: Locator, value: number) {
  await input.fill(String(value)); await input.press('Enter'); await input.press('Tab');
  await expect(input).toHaveValue(String(value)); await expect(input).toHaveAttribute('aria-invalid', 'false');
}
async function reject(input: Locator, draft: string, retained: number, commit: 'enter' | 'blur', blurTarget?: Locator) {
  await input.fill(draft);
  if (commit === 'enter') await input.press('Enter'); else if (blurTarget) await blurTarget.click(); else await input.press('Tab');
  await expect(input).not.toBeFocused(); await expect(input).toHaveValue(String(retained)); await expect(input).toHaveAttribute('aria-invalid', 'true');
  const description = await input.getAttribute('aria-describedby'); assert.ok(description, 'Rejected input needs an accessible explanation.');
  const message = page!.locator('[id=' + JSON.stringify(description) + ']'); await expect(message).toBeVisible(); await expect(message).toContainText('0～32');
  return { draft, commit, retained, message: await message.innerText() };
}
async function openGraph(node: BlueprintNode) {
  await page!.locator('[data-workspace-tab="blueprint"]').click(); await page!.getByLabel('演出目标', { exact: true }).selectOption('graph:' + fixture.editGraph.id);
  if (!await blueprintInspector().isVisible()) await page!.getByRole('button', { name: '展开蓝图属性', exact: true }).click();
  await fitBlueprintCanvas(page!); await card(node).locator('.graph-node-title strong').click();
  await blueprintInspector().getByRole('button', { name: '节点参数', exact: true }).click();
  await expect(blueprintInspector().getByRole('spinbutton')).toHaveCount(1);
}
async function canvasPixels() {
  return canvas().evaluate(element => {
    const target = element as HTMLCanvasElement, gl = target.getContext('webgl');
    if (!gl || gl.isContextLost()) throw new Error('Live Spine WebGL context is unavailable.');
    const pixels = new Uint8Array(target.width * target.height * 4); gl.readPixels(0, 0, target.width, target.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let colored = 0, hash = 2166136261;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] > 64 && pixels[index] > 100 && pixels[index] > pixels[index + 1] * 1.2) colored++;
      for (let channel = 0; channel < 4; channel++) hash = Math.imul(hash ^ pixels[index + channel], 16777619);
    }
    return { width: target.width, height: target.height, colored, hash: hash >>> 0, time: Number(target.dataset.spineTime), state: target.dataset.spineState };
  });
}

try {
  await fs.mkdir(output, { recursive: true });
  authorHash = digest(await fs.readFile(authorFile)); report.authorSha256Before = authorHash;
  for (const [file, project] of [[projectFile, original], [legacyFile, legacy]] as const) {
    await writeUiSpineFixtureAssets(path.dirname(file)); await fs.writeFile(file, JSON.stringify(project, null, 2));
  }
  await launch();
  await check('设计速度9与32可以保存重开，原有骨骼设置完整保留', async () => {
    await design();
    for (const value of [9, 32]) {
      await accept(speedInput(), value); const saved = await saveUi();
      assert.deepEqual(rig(saved).spine, { ...rig(original).spine, speed: value });
      await close(); await launch(); await design(); await expect(speedInput()).toHaveValue(String(value));
    }
    await screenshot('01-design-speed-32'); evidence.designAccepted = { values: [9, 32], savedAndReopened: true };
  });
  await check('非法速度保持原值；右键新建参数不裁剪、不误提交且关联可一次撤销', async () => {
    await accept(speedInput(), 9); const before = await saveUi(), rejections = [];
    rejections.push(await reject(speedInput(), '33', 9, 'enter'));
    await expect(page!.getByRole('button', { name: '保存界面', exact: true })).toBeDisabled();
    rejections.push(await reject(speedInput(), '1e9', 9, 'blur', ui().getByLabel('控件显示名称', { exact: true })));
    assert.deepEqual(await saveUi(), before); await screenshot('02-design-invalid-retains-9');
    await speedInput().press('Escape');
    await speedField().locator('.field-label').click({ button: 'right' });
    await page!.getByRole('menu', { name: '属性控制菜单', exact: true }).getByRole('menuitem', { name: '关联参数…', exact: true }).click();
    await dialog().getByRole('button', { name: '新建参数并关联', exact: true }).click();
    await dialog().getByLabel('控制方式', { exact: true }).selectOption('sync');
    await dialog().getByLabel('新参数名称', { exact: true }).fill('速度边界同步参数');
    const initial = dialog().getByLabel('新参数初始值', { exact: true });
    rejections.push(await reject(initial, '33', 9, 'enter')); await expect(dialog()).toBeVisible();
    assert.deepEqual(await read(), before, 'Rejected Enter must not submit or create a parameter.');
    rejections.push(await reject(initial, '1e9', 9, 'blur', dialog().getByLabel('新参数名称', { exact: true })));
    await expect(dialog()).toBeVisible(); await expect(speedField().locator('.ui-property-control-value')).toHaveCount(0);
    await screenshot('03-parameter-invalid-retains-9');
    await initial.fill('9'); await dialog().getByLabel('新参数名称', { exact: true }).click(); await expect(initial).toHaveAttribute('aria-invalid', 'false');
    await dialog().getByRole('button', { name: '应用设置', exact: true }).click(); await expect(dialog()).toHaveCount(0);
    await expect(speedField().locator('.ui-property-control-value')).toHaveText('同步：速度边界同步参数');
    // Saving the UI establishes a new draft baseline; exercise atomic undo first.
    await page!.getByRole('button', { name: '撤销', exact: true }).click(); await expect(speedInput()).toHaveValue('9');
    await expect(speedField().locator('.ui-property-control-value')).toHaveCount(0);
    await expect(page!.getByRole('button', { name: '保存界面', exact: true })).toBeDisabled();
    assert.deepEqual(await read(), before, 'One undo must restore the saved draft without writing an orphan parameter.');
    await page!.getByRole('button', { name: '重做', exact: true }).click();
    await expect(speedField().locator('.ui-property-control-value')).toHaveText('同步：速度边界同步参数');
    const linked = await saveUi(), added = linked.variables.filter(item => !before.variables.some(previous => previous.id === item.id));
    assert.equal(added.length, 1); assert.equal(added[0].initial, 9); assert.equal(added[0].type, 'number');
    assert.deepEqual(rig(linked).propertyControls?.spineSpeed, { mode: 'sync', parameterId: added[0].id }); assert.equal(rig(linked).spine?.speed, 9);
    evidence.rejectionsAndAtomicParameter = { rejections, parameterId: added[0].id, initial: 9, oneUndoRemovesParameterAndAssociation: true, redoSavedTogether: true };
  });
  await check('蓝图调速与设置spineSpeed共享范围，面板和卡片均保留被拒绝前的值', async () => {
    const results = [];
    for (const [node, property] of [[speedNode, 'speed'], [propertyNode, 'value']] as const) {
      await openGraph(node); const input = blueprintInspector().getByRole('spinbutton');
      for (const value of [9, 32]) { await accept(input, value); assert.equal(savedNode(await saveGraph(), node).properties[property], value); }
      await accept(input, 9); const before = await saveGraph();
      const enter = await reject(input, '33', 9, 'enter'); assert.deepEqual(await saveGraph(), before);
      const inline = card(node).getByRole('spinbutton'); await expect(inline).toHaveValue('9');
      const blur = await reject(inline, '1e9', 9, 'blur', card(node).locator('.graph-node-title strong'));
      await expect(input).toHaveValue('9'); assert.deepEqual(await saveGraph(), before);
      await screenshot('04-blueprint-' + node.type); results.push({ nodeType: node.type, accepted: [9, 32], enter, blur });
    }
    await close(); await launch();
    for (const node of [speedNode, propertyNode]) { await openGraph(node); await expect(blueprintInspector().getByRole('spinbutton')).toHaveValue('9'); }
    evidence.blueprintEntrypoints = results;
  });
  await check('旧1e9速度工程可诊断与编辑，修复后同一WebGL画布继续绘制和播放', async () => {
    await close(); activeFile = legacyFile; const beforeOpen = await fs.readFile(legacyFile); await launch(true); await design();
    await expect(speedInput()).toHaveValue('1000000000'); await expect(speedInput()).toHaveAttribute('aria-invalid', 'true');
    await expect(canvas()).toHaveAttribute('data-spine-state', 'failed', { timeout: 30000 });
    await expect(page!.locator('.ui-canvas [data-component-id="rig"] .spine-preview-error')).toContainText('0～32');
    await page!.locator('.status-bar').getByRole('button').first().click();
    const diagnostic = page!.locator('.problems-panel .diagnostic-item[data-component-id="rig"]').filter({ hasText: '骨骼播放速度需要 0～32' });
    await expect(diagnostic).toHaveCount(1); evidence.legacyDiagnostic = await diagnostic.innerText();
    await screenshot('05-legacy-speed-diagnostic'); await page!.getByRole('button', { name: '关闭问题面板', exact: true }).click();
    await setUiCanvasPreview(page!, '按钮预览状态', 'hover');
    assert.equal(digest(await fs.readFile(legacyFile)), digest(beforeOpen), 'Opening and inspecting invalid old data must not rewrite it.');
    const existingCanvas = await canvas().elementHandle(); assert.ok(existingCanvas);
    try {
      await accept(speedInput(), 1);
      await expect(canvas()).toHaveAttribute('data-spine-state', 'playing', { timeout: 30000 });
      await expect(page!.locator('.ui-canvas [data-component-id="rig"] .spine-preview-error')).toHaveCount(0);
      assert.equal(await existingCanvas.evaluate(element => element.isConnected && element === document.querySelector('.ui-canvas [data-component-id="rig"] canvas')), true, 'Repair must recover the mounted preview without replacing its canvas.');
      const first = await canvasPixels(); assert.ok(first.colored > 100, 'Recovered WebGL must contain the real orange Spine fixture.');
      await expect.poll(async () => {
        const sample = await canvasPixels(); return sample.colored > 100 && sample.hash !== first.hash && Math.abs(sample.time - first.time) > .03;
      }, { timeout: 10000, intervals: [80, 120, 200] }).toBe(true);
      const second = await canvasPixels(), repaired = await saveUi(); assert.equal(rig(repaired).spine?.speed, 1);
      await page!.locator('.status-bar').getByRole('button').first().click(); await expect(diagnostic).toHaveCount(0);
      await page!.getByRole('button', { name: '关闭问题面板', exact: true }).click(); await screenshot('06-legacy-speed-webgl-recovered');
      evidence.legacyRecovery = { retainedOnOpen: 1e9, corrected: 1, sameCanvas: true, first, second, diagnosticCleared: true };
    } finally { await existingCanvas.dispose(); }
  });
  assert.deepEqual(errors, [], 'Spine rejection and repair must not raise unhandled renderer errors.'); report.status = 'passed';
} catch (error) {
  failure = error; report.status = 'failed'; report.phase = phase; report.error = error instanceof Error ? error.stack : String(error);
  if (app && page && !page.isClosed()) await screenshot('failure').catch(capture => { report.captureError = String(capture); });
} finally {
  try { await close(); } catch (error) { report.status = 'failed'; report.closeError = String(error); failure ??= error; }
  try {
    const after = digest(await fs.readFile(authorFile)); report.authorSha256After = after;
    if (authorHash !== undefined) assert.equal(after, authorHash, 'Acceptance must not modify the author project.');
  } catch (error) { report.status = 'failed'; report.sourceProtectionError = String(error); failure ??= error; }
  try {
    if (app || processes.some(item => !item.exited)) throw new Error('Owned editor remains alive; preserve its fixture directories.');
    report.cleanup = await cleanVerificationDirectories(output, temporaryNames);
    assert.deepEqual((report.cleanup as { errors: unknown[] }).errors, []);
  } catch (error) { report.status = 'failed'; report.cleanupError = String(error); failure ??= error; }
  await fs.mkdir(output, { recursive: true }); await persistReport(); console.log(path.join(output, 'report.json'));
}
if (failure) throw failure;
