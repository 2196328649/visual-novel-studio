import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { createProject, projectSchema } from '../src/core/model';
import { blueprintNodeDefaults, callablePins, connectBlueprintPins, createBlueprintGraph } from '../src/core/blueprint';
import { projectToText } from '../src/core/text-script';
import { validateProject } from '../src/core/validate';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';
import { fitBlueprintCanvas } from './lib/blueprint-canvas';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

// Run only after all changes have been built. Uses its own project and profile.
if (process.env.VNS_INSTALLED_EXE) throw new Error('This acceptance requires the compiled development editor.');
const root = path.resolve('.');
const output = path.resolve('artifacts/actor-transition-labels-2026-11-11', 'editor-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const projectFile = path.join(output, 'fixture/project.vns.json'), profile = path.join(output, 'profile');
const authorFile = path.resolve('../我的视觉小说1/project.vns.json');
const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const project = createProject('角色过渡实际值与来源验收');
project.assets = [{ id: 'portrait', name: '验收立绘', kind: 'image', path: 'portrait.svg', width: 180, height: 300 }];
project.characters = [
  { id: 'plain', name: '普通角色', color: '#ffffff', expressions: [{ id: 'plain_pose', name: '通常', assetId: 'portrait' }] },
  { id: 'configured', name: '已设角色', color: '#ffffff', expressions: [{ id: 'configured_pose', name: '通常', assetId: 'portrait' }], actorTransitions: { enter: { mode: 'move', duration: .8 }, expression: { mode: 'fade', duration: .3 }, exit: { mode: 'none', duration: .9 } } },
  { id: 'legacy', name: '旧工程角色', baseCharacterId: 'configured', color: '#ffffff', expressions: [] },
];
const staticGraph = createBlueprintGraph('effect', '静态角色来源'); staticGraph.id = 'static_graph';
const staticShow = blueprintNodeDefaults('showCharacter'); Object.assign(staticShow, { id: 'static_show', x: 370, y: 0, name: '显示静态角色' });
staticShow.pins.find(pin => pin.id === 'characterId')!.defaultValue = 'configured';
staticShow.pins.find(pin => pin.id === 'duration')!.defaultValue = 1.2;
staticGraph.nodes.push(staticShow); assert.equal(connectBlueprintPins(staticGraph, staticGraph.nodes[0].id, 'exec', staticShow.id, 'exec_in'), undefined);
const dynamicGraph = createBlueprintGraph('effect', '动态角色来源'); dynamicGraph.id = 'dynamic_graph';
const dynamicShow = blueprintNodeDefaults('showCharacter'); Object.assign(dynamicShow, { id: 'dynamic_show', x: 370, y: 0 });
dynamicGraph.nodes.push(dynamicShow); assert.equal(connectBlueprintPins(dynamicGraph, dynamicGraph.nodes[0].id, 'exec', dynamicShow.id, 'exec_in'), undefined);
const durationGraph = createBlueprintGraph('effect', '动态时长来源'); durationGraph.id = 'duration_graph';
const durationShow = blueprintNodeDefaults('showCharacter'); Object.assign(durationShow, { id: 'duration_show', x: 370, y: 0 });
durationShow.properties.characterId = 'plain';
const durationRead = blueprintNodeDefaults('getInput'); Object.assign(durationRead, { x: 0, y: 230 }); durationRead.properties.inputId = 'seconds'; durationRead.pins[0].dataType = 'number';
durationGraph.exposedInputs = [{ id: 'seconds', name: '秒数', direction: 'input', dataType: 'number', defaultValue: .7, required: false }];
durationGraph.nodes.push(durationShow, durationRead);
assert.equal(connectBlueprintPins(durationGraph, durationGraph.nodes[0].id, 'exec', durationShow.id, 'exec_in'), undefined);
assert.equal(connectBlueprintPins(durationGraph, durationRead.id, 'value', durationShow.id, 'duration'), undefined);
const caller = createBlueprintGraph('function', '嵌套调用来源'); caller.id = 'caller_graph';
const call = blueprintNodeDefaults('callFunction'); Object.assign(call, { id: 'call_node', x: 370, y: 0, pins: callablePins(dynamicGraph) }); call.properties.graphId = dynamicGraph.id;
caller.nodes.push(call); assert.equal(connectBlueprintPins(caller, caller.nodes[0].id, 'exec', call.id, 'exec_in'), undefined);
project.blueprints = [staticGraph, dynamicGraph, durationGraph, caller];
const passage = project.nodes.find(node => node.kind === 'passage')!;
passage.lines = [
  { id: 'auto_actor', speakerId: 'configured', text: '自动显示当前说话角色。', actions: [{ kind: 'show', characterId: '', expressionId: '', x: .5, y: 1, scale: 1, layer: 10, lifetime: 'line', transition: 'dissolve' }] },
  { id: 'call_actor', speakerId: 'configured', text: '蓝图内的角色可能由输入决定。', actions: [{ kind: 'blueprint', blueprintId: dynamicGraph.id }] },
];
project.scriptText = { format: 'vns-text-1', content: projectToText(project) };
let app: ElectronApplication | undefined, page: Page | undefined, failure: unknown, phase = 'prepare', authorHash: string | undefined;
const checks: string[] = [], errors: string[] = [];
const report: Record<string, unknown> = { status: 'running', checks, errors, temporaryPaths: [path.dirname(projectFile), profile] };
const mode = (scope: Locator, phase: string, label = '角色过渡') => scope.getByRole('combobox', { name: label + ' · ' + phase, exact: true });
const seconds = (scope: Locator, phase: string, label = '角色过渡') => scope.getByRole('spinbutton', { name: label + ' · ' + phase + '时长', exact: true });
const editSeconds = async (field: Locator, text: string) => { await field.fill(text); await field.press('Tab'); };
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const save = async () => {
  await page!.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  const saved = await read(); assert.deepEqual(validateProject(saved).filter(issue => issue.severity === 'error'), []); return saved;
};
const check = async (name: string, work: () => Promise<void>) => { phase = name; await work(); checks.push(name); console.log('通过：' + name); };
const screenshot = async (name: string) => {
  const image = await app!.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  await fs.writeFile(path.join(output, name + '.png'), Buffer.from(image, 'base64'));
};
const characterPanel = () => page!.getByRole('tabpanel', { name: '角色过渡', exact: true });
const selectCharacter = async (id: string) => {
  await page!.locator('[data-workspace-tab="characters"]').click(); await page!.locator(`.character-item[data-character-id="${id}"]`).click();
  await page!.getByRole('tab', { name: '角色过渡', exact: true }).click();
};
const selectGraph = async (graphId: string, nodeId: string) => {
  await page!.locator('[data-workspace-tab="blueprint"]').click(); await page!.getByLabel('蓝图资源', { exact: true }).selectOption('graph:' + graphId);
  await fitBlueprintCanvas(page!); await page!.locator(`.react-flow__node[data-id="${nodeId}"] .graph-node-title strong`).click();
  return page!.getByRole('complementary', { name: '蓝图属性', exact: true });
};
try {
  await fs.mkdir(path.dirname(projectFile), { recursive: true }); authorHash = digest(await fs.readFile(authorFile)); report.authorSha256Before = authorHash;
  await fs.writeFile(path.join(path.dirname(projectFile), 'portrait.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="300"><rect width="180" height="300" fill="#c05060"/></svg>');
  assert.deepEqual(validateProject(projectSchema.parse(project)).filter(issue => issue.severity === 'error'), []);
  await saveProject(projectFile, project); await fs.copyFile(projectFile, path.join(output, 'input-project.json'));
  const renderer = await fs.readFile(path.join(root, 'dist/index.html')); report.buildHtmlSha256 = digest(renderer);
  app = await launchDesktopFixture({ root, profile, projectFile }); page = await app.firstWindow(); page.setDefaultTimeout(12000);
  report.pid = app.process().pid; page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; if (window.isMaximized()) window.unmaximize(); window.setContentSize(1440, 960); });
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await page.context().tracing.start({ screenshots: true, snapshots: true, sources: false });
  await check('角色面板直接显示三阶段渐变0.5秒，打开和保存不补写覆盖', async () => {
    await selectCharacter('plain'); const panel = characterPanel();
    for (const phase of ['入场过渡', '离场过渡', '表情切换过渡']) {
      await expect(mode(panel, phase)).toHaveValue('dissolve'); await expect(mode(panel, phase).locator('option:checked')).toHaveText('渐变');
      await expect(seconds(panel, phase)).toHaveValue('0.5');
      await expect(panel.getByRole('button', { name: `还原${phase}：渐变，0.5 秒`, exact: true })).toBeDisabled();
    }
    assert.equal(await panel.locator('option').filter({ hasText: /继承|默认/ }).count(), 0);
    assert.equal((await save()).characters.find(character => character.id === 'plain')!.actorTransitions, undefined);
    await screenshot('01-character-explicit-values');
  });
  await check('零秒切换方式不回跳，还原按阶段删除并可撤销', async () => {
    const panel = characterPanel(); await editSeconds(seconds(panel, '入场过渡'), '0'); await mode(panel, '入场过渡').selectOption('move');
    await expect(seconds(panel, '入场过渡')).toHaveValue('0');
    await editSeconds(seconds(panel, '表情切换过渡'), '0.7');
    let saved = await save(); let rules = saved.characters.find(character => character.id === 'plain')!.actorTransitions!;
    assert.deepEqual(rules, { enter: { mode: 'move', duration: 0 }, expression: { mode: 'dissolve', duration: .7 } });
    await panel.getByRole('button', { name: '还原入场过渡：渐变，0.5 秒', exact: true }).click();
    await expect(mode(panel, '入场过渡')).toHaveValue('dissolve'); await expect(seconds(panel, '表情切换过渡')).toHaveValue('0.7');
    await page!.getByRole('button', { name: '撤销', exact: true }).click(); await expect(mode(panel, '入场过渡')).toHaveValue('move'); await expect(seconds(panel, '入场过渡')).toHaveValue('0');
    await page!.getByRole('button', { name: '重做', exact: true }).click();
    await panel.getByRole('button', { name: '还原表情切换过渡：渐变，0.5 秒', exact: true }).click();
    saved = await save(); assert.equal(saved.characters.find(character => character.id === 'plain')!.actorTransitions, undefined);
  });
  await check('旧工程关联显示有效值，立即显示0秒，编辑还原保留旧数据', async () => {
    await selectCharacter('legacy'); const panel = characterPanel();
    await expect(mode(panel, '入场过渡')).toHaveValue('move'); await expect(seconds(panel, '入场过渡')).toHaveValue('0.8');
    await expect(mode(panel, '离场过渡')).toHaveValue('none'); await expect(seconds(panel, '离场过渡')).toHaveValue('0'); await expect(seconds(panel, '离场过渡')).toBeDisabled();
    await expect(panel).toContainText('旧工程保留了与“已设角色”的过渡关联');
    await mode(panel, '入场过渡').selectOption('fade');
    await panel.getByRole('button', { name: '还原入场过渡：移动，0.8 秒', exact: true }).click();
    const saved = await save(); assert.equal(saved.characters.find(character => character.id === 'legacy')!.actorTransitions, undefined);
    assert.equal(saved.characters.find(character => character.id === 'legacy')!.baseCharacterId, 'configured');
    assert.equal(saved.characters.find(character => character.id === 'configured')!.actorTransitions!.exit!.duration, .9);
    await screenshot('02-legacy-effective-values');
  });
  await check('显示角色指令读取当前发言人，显示实际来源并支持覆盖后跟随', async () => {
    await openStoryMode(page!, 'script'); const row = page!.locator('#line-auto_actor'); await row.locator('textarea').click();
    await row.locator('.line-effect-chip[data-action-kind="show"]').click(); const panel = row.getByRole('region', { name: '编辑显示角色', exact: true });
    await expect(mode(panel, '入场过渡').locator('option:checked')).toHaveText('移动，0.8 秒（角色“已设角色”）');
    await expect(seconds(panel, '入场过渡')).toHaveValue('0.8'); await expect(seconds(panel, '表情切换过渡')).toHaveValue('0.3');
    await mode(panel, '入场过渡').selectOption('dissolve'); await editSeconds(seconds(panel, '入场过渡'), '1.1'); await mode(panel, '入场过渡').selectOption('');
    await expect(seconds(panel, '入场过渡')).toHaveValue('0.8'); const saved = await save();
    const node = saved.nodes.find(node => node.id === passage.id)!; assert.ok(node.kind === 'passage');
    const action = node.lines[0].actions[0]; assert.ok(action.kind === 'show'); assert.equal(action.actorTransitions, undefined); assert.equal(action.characterId, '');
    await screenshot('03-action-actual-source');
  });
  await check('蓝图静态角色读取引脚初值，角色规则与节点时长按阶段显示', async () => {
    const panel = await selectGraph('static_graph', 'static_show');
    await expect(mode(panel, '入场过渡').locator('option:checked')).toHaveText('移动，0.8 秒（角色“已设角色”）'); await expect(seconds(panel, '入场过渡')).toHaveValue('0.8');
    await panel.getByLabel('角色', { exact: true }).selectOption('plain');
    await expect(mode(panel, '入场过渡').locator('option:checked')).toHaveText('渐变，1.2 秒（节点设置）'); await expect(seconds(panel, '离场过渡')).toHaveValue('0.5');
    await screenshot('04-blueprint-static-source');
    const card = page!.locator('.react-flow__node[data-id="static_show"]'); await card.locator('.blueprint-node-advanced summary').click();
    await expect(seconds(card, '入场过渡')).toHaveValue('1.2'); await mode(card, '入场过渡').selectOption('move'); await expect(mode(panel, '入场过渡')).toHaveValue('move');
    await mode(panel, '入场过渡').selectOption(''); await expect(mode(card, '入场过渡')).toHaveValue('');
    await save();
  });
  await check('动态角色和时长标明来源，已知离场仍显示0.5秒', async () => {
    let panel = await selectGraph('dynamic_graph', 'dynamic_show');
    await expect(mode(panel, '入场过渡').locator('option:checked')).toHaveText('跟随实际角色与节点设置'); await expect(seconds(panel, '入场过渡')).toHaveValue(''); await expect(seconds(panel, '入场过渡')).toBeDisabled();
    await mode(panel, '入场过渡').selectOption('dissolve'); await editSeconds(seconds(panel, '入场过渡'), '0.6'); await expect(seconds(panel, '入场过渡')).toBeEnabled();
    await mode(panel, '入场过渡').selectOption('');
    panel = await selectGraph('duration_graph', 'duration_show');
    await expect(mode(panel, '入场过渡').locator('option:checked')).toHaveText('跟随节点时长输入'); await expect(seconds(panel, '入场过渡')).toHaveValue('');
    await expect(seconds(panel, '离场过渡')).toHaveValue('0.5'); await expect(seconds(panel, '离场过渡')).toBeEnabled();
    await screenshot('05-blueprint-dynamic-source');
  });
  await check('单次及嵌套蓝图调用说明来源，覆盖保存重开与恢复正确', async () => {
    let panel = await selectGraph('caller_graph', 'call_node');
    await expect(mode(panel, '入场过渡', '本次角色过渡').locator('option:checked')).toHaveText('跟随蓝图内角色与节点设置');
    await expect(seconds(panel, '入场过渡', '本次角色过渡')).toBeDisabled();
    await openStoryMode(page!, 'script'); const row = page!.locator('#line-call_actor'); await row.locator('textarea').click(); await row.locator('.line-effect-chip[data-action-kind="blueprint"]').click();
    panel = row.locator('.actor-transition-fields');
    await expect(mode(panel, '表情切换过渡', '本次角色过渡').locator('option:checked')).toHaveText('跟随蓝图内角色与节点设置');
    await mode(panel, '表情切换过渡', '本次角色过渡').selectOption('fade'); await editSeconds(seconds(panel, '表情切换过渡', '本次角色过渡'), '0.4');
    await save(); await page!.reload(); await expect(page!.locator('.project-title strong')).toHaveText(project.name);
    await openStoryMode(page!, 'script'); await row.locator('textarea').click(); await row.locator('.line-effect-chip[data-action-kind="blueprint"]').click();
    await expect(seconds(panel, '表情切换过渡', '本次角色过渡')).toHaveValue('0.4');
    await mode(panel, '表情切换过渡', '本次角色过渡').selectOption('');
    const saved = await save(), node = saved.nodes.find(node => node.id === passage.id)!; assert.ok(node.kind === 'passage');
    const action = node.lines[1].actions[0]; assert.ok(action.kind === 'blueprint'); assert.equal(action.actorTransitions, undefined);
    assert.equal(saved.blueprints.find(graph => graph.id === 'dynamic_graph')!.nodes.find(node => node.id === 'dynamic_show')!.properties.actorTransitions, '');
    await fs.copyFile(projectFile, path.join(output, 'saved-project.json'));
  });
  await check('窄窗口的方式、时长和还原按钮完整可见', async () => {
    await selectCharacter('plain'); await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1100, 720));
    const panel = characterPanel(); await panel.locator('.actor-transition-fields').scrollIntoViewIfNeeded();
    for (const field of await panel.locator('.actor-transition-fields .field-row').all()) {
      const size = await field.evaluate(element => ({ width: element.clientWidth, content: element.scrollWidth })); assert.ok(size.content <= size.width + 1, JSON.stringify(size));
    }
    for (const button of await panel.locator('.actor-transition-reset').all()) await expect(button).toBeVisible();
    await screenshot('06-character-narrow');
  });
  assert.equal(checks.length, 8); assert.deepEqual(errors, []); assert.equal(digest(await fs.readFile(path.join(root, 'dist/index.html'))), report.buildHtmlSha256);
  report.status = 'passed';
} catch (error) { failure = error; report.status = 'failed'; report.phase = phase; report.error = String(error); if (app && page) await screenshot('failure').catch(() => undefined); }
finally {
  if (page) await page.context().tracing.stop({ path: path.join(output, 'trace.zip') }).catch(error => { report.traceError = String(error); });
  if (app) { const child = app.process(); await app.close(); report.processExited = child.exitCode !== null || child.signalCode !== null; }
  const after = digest(await fs.readFile(authorFile)); report.authorSha256After = after; if (authorHash !== after) { failure ??= new Error('Author project changed during acceptance.'); report.status = 'failed'; }
  await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  if (!app || report.processExited) report.cleanup = await cleanVerificationDirectories(output, ['fixture', 'profile']);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(output);
}
if (failure) throw failure;
