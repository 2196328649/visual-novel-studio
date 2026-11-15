import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { createProject, projectSchema, type Project, type StageAction } from '../src/core/model';
import { actorKey } from '../src/core/actor-instance';
import { blueprintNodeDefaults, callablePins, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { actionText, applyTextScript, projectToText } from '../src/core/text-script';
import { linePreviewSnapshot } from '../src/core/line-preview';
import { validateProject } from '../src/core/validate';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { fitBlueprintCanvas } from './lib/blueprint-canvas';
import { openStageEditing, openStoryMode } from './lib/story-workspace';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

// Run after the coordinator builds all completed changes. Do not use Vite,
// installed binaries, or the author's editable project as this fixture.
if (process.env.VNS_INSTALLED_EXE) throw new Error('Use the compiled development editor for this acceptance.');
const root = path.resolve('.');
const output = path.resolve('artifacts/actor-slots-continuity-2026-11-10', 'editor-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const authorFile = path.resolve(process.env.VNS_AUTHOR_PROJECT ?? '../我的视觉小说1/project.vns.json');
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const ids = { hero: 'number_hero', friend: 'number_friend', staticGraph: 'number_static_graph', dynamicGraph: 'number_dynamic_graph', callerGraph: 'number_caller_graph', show: 'number_show', hide: 'number_hide', caller: 'number_call_node' } as const;

function projectBase(name: string) {
  const project = createProject(name); project.width = 960; project.height = 540;
  project.assets = ['hero', 'friend'].map(name => ({ id: name + '_portrait', name: name + '立绘', kind: 'image' as const, path: name + '.png', width: 120, height: 220 }));
  project.characters = [
    { id: ids.hero, name: '鸢', color: '#ffffff', expressions: [{ id: 'hero_normal', name: '通常', assetId: 'hero_portrait' }] },
    { id: ids.friend, name: '赵老头', color: '#ffffff', expressions: [{ id: 'friend_normal', name: '通常', assetId: 'friend_portrait' }] },
  ];
  project.playerDefaults = { masterVolume: 0 };
  return project;
}
function stageFixture() {
  const project = projectBase('角色固定编号与兼容验收'); project.id = 'actor_number_stage_qa';
  const passage = project.nodes.find(node => node.kind === 'passage')!;
  passage.lines = [
    { id: 'number_add', text: '通过舞台依次添加三个鸢、两个赵老头。', actions: [] },
    { id: 'number_hide', text: '隐藏第一个之后，其余角色保留编号。', actions: [] },
    { id: 'number_legacy', text: '旧实例保留名称并继续独立控制。', actions: [{ kind: 'show', characterId: ids.hero, expressionId: 'hero_normal', instanceId: 'legacy_left', lifetime: 'persistent', x: .15, y: 1, scale: 1, layer: 10, transition: 'none' }] },
  ];
  project.scriptText = { format: 'vns-text-1', content: projectToText(project) };
  return { project: projectSchema.parse(project), passageId: passage.id };
}
function blueprintFixture() {
  const project = projectBase('角色编号蓝图与调用验收'); project.id = 'actor_number_blueprint_qa';
  const graph = createBlueprintGraph('function', '角色编号蓝图'); graph.id = ids.staticGraph;
  const show = blueprintNodeDefaults('showCharacter');
  Object.assign(show, { id: ids.show, name: '显示指定角色', x: 350, y: 0 });
  Object.assign(show.properties, { characterId: ids.hero, expressionId: 'hero_normal', instanceId: '2', lifetime: 'persistent', transition: 'none', duration: 0, presetId: '' });
  const hide = blueprintNodeDefaults('hideCharacter');
  Object.assign(hide, { id: ids.hide, name: '隐藏指定角色', x: 750, y: 0 });
  Object.assign(hide.properties, { characterId: ids.hero, instanceId: '2', transition: 'none', duration: 0 });
  graph.nodes.push(show, hide);
  assert.equal(connectBlueprintPins(graph, graph.nodes[0].id, 'exec', show.id, 'exec_in'), undefined);
  assert.equal(connectBlueprintPins(graph, show.id, 'exec_out', hide.id, 'exec_in'), undefined);

  const dynamic = createBlueprintGraph('effect', '按编号显示发言人'); dynamic.id = ids.dynamicGraph;
  const target = blueprintNodeDefaults('showCharacter'); target.x = 420; target.y = 0;
  Object.assign(target.properties, { characterId: '', expressionId: '', lifetime: 'persistent', transition: 'none', duration: 0, presetId: '' });
  const pin = target.pins.find(pin => pin.id === 'instanceId')!;
  dynamic.exposedInputs = [{ ...pin, id: 'slot', name: '第几个', defaultValue: '2' }];
  const read = blueprintNodeDefaults('getInput'); read.x = 0; read.y = 220;
  read.properties.inputId = 'slot'; read.pins[0].dataType = 'string';
  dynamic.nodes.push(target, read);
  assert.equal(connectBlueprintPins(dynamic, dynamic.nodes[0].id, 'exec', target.id, 'exec_in'), undefined);
  assert.equal(connectBlueprintPins(dynamic, read.id, 'value', target.id, 'instanceId'), undefined);

  const caller = createBlueprintGraph('function', '公开编号调用'); caller.id = ids.callerGraph;
  const call = blueprintNodeDefaults('callFunction');
  Object.assign(call, { id: ids.caller, name: '调用编号演出', x: 400, y: 0, pins: callablePins(dynamic) });
  Object.assign(call.properties, { graphId: dynamic.id, arg_slot: '2' }); caller.nodes.push(call);
  assert.equal(connectBlueprintPins(caller, caller.nodes[0].id, 'exec', call.id, 'exec_in'), undefined);
  project.blueprints = [graph, dynamic, caller];
  const passage = project.nodes.find(node => node.kind === 'passage')!;
  passage.lines = [{ id: 'number_call', speakerId: ids.hero, text: '公开编号控制当前台词角色。', actions: [{ kind: 'blueprint', blueprintId: dynamic.id, inputs: { slot: '2' } }] }];
  synchronizeBlueprintSignatures(project);
  project.scriptText = { format: 'vns-text-1', content: projectToText(project) };
  return { project: projectSchema.parse(project), passageId: passage.id };
}
const stage = stageFixture(), blueprint = blueprintFixture();
type Fixture = { project: Project; passageId: string; file: string; profile: string };
const fixtures: Record<'stage' | 'blueprint', Fixture> = {
  stage: { ...stage, file: path.join(output, 'stage-project/project.vns.json'), profile: path.join(output, 'stage-profile') },
  blueprint: { ...blueprint, file: path.join(output, 'blueprint-project/project.vns.json'), profile: path.join(output, 'blueprint-profile') },
};
let active = fixtures.stage, app: ElectronApplication | undefined, page: Page | undefined;
let phase = 'prepare', failure: unknown, authorHash: string | undefined, traceRunning = false, run = 0;
const checks: { name: string; durationMs: number }[] = [], errors: string[] = [], traces: string[] = [];
const processes: { pid?: number; exited: boolean }[] = [], evidence: Record<string, unknown> = {};
const report: Record<string, unknown> = { status: 'running', renderer: 'compiled', checks, errors, traces, processes, evidence, temporaryPaths: Object.values(fixtures).flatMap(fixture => [path.dirname(fixture.file), fixture.profile]) };
const button = (name: string) => page!.getByRole('button', { name, exact: true });
const preview = () => page!.locator('.story-preview-content');
const actor = (characterId: string, instanceId = '') => preview().locator(`.text-stage-actor[data-character-id="${characterId}"][data-instance-id="${instanceId}"]`);
const choices = () => preview().getByLabel('舞台选择角色', { exact: true });
const row = (id: string) => page!.locator('#line-' + id);
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(active.file, 'utf8')));
const line = (project: Project, id: string) => {
  const passage = project.nodes.find(node => node.id === active.passageId); assert.ok(passage?.kind === 'passage');
  const result = passage.lines.find(line => line.id === id); assert.ok(result); return result;
};
const settle = () => page!.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
async function builtFiles() {
  const html = await fs.readFile(path.join(root, 'dist/index.html'), 'utf8');
  const entry = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).main as string;
  const files = ['dist/index.html', entry, ...[...html.matchAll(/(?:src|href)="(\.\/assets\/[^"?#]+\.(?:js|css))"/g)].map(match => 'dist/' + match[1].slice(2))];
  assert.ok(files.some(file => file.startsWith('dist/assets/') && file.endsWith('.js')));
  return Promise.all([...new Set(files)].map(async file => ({ file, sha256: sha256(await fs.readFile(path.join(root, file))) })));
}
async function launch(fixture = active) {
  active = fixture; app = await launchDesktopFixture({ root, projectFile: fixture.file, profile: fixture.profile });
  processes.push({ pid: app.process().pid, exited: false }); page = await app.firstWindow(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message)); run++;
  await page.context().tracing.start({ screenshots: true, snapshots: true, sources: false }); traceRunning = true;
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]; if (window.isMaximized()) window.unmaximize();
    window.setContentSize(1520, 980); window.webContents.setBackgroundThrottling(false);
  });
  await expect(page.locator('.project-title strong')).toHaveText(fixture.project.name, { timeout: 45000 });
  assert.equal(path.resolve(fileURLToPath(page.url())), path.join(root, 'dist/index.html'));
  await page.evaluate('globalThis.__name = value => value'); await settle();
}
async function close() {
  if (!app) return;
  const owned = app, child = owned.process(), exited = () => child.exitCode !== null || child.signalCode !== null;
  let traceError: unknown;
  if (traceRunning && page) {
    const name = `trace-${String(run).padStart(2, '0')}.zip`;
    try { await page.context().tracing.stop({ path: path.join(output, name) }); traces.push(name); }
    catch (error) { traceError = error; report.traceError = String(error); }
    traceRunning = false;
  }
  try { await owned.close(); }
  finally {
    await expect.poll(exited, { timeout: 15000 }).toBe(true);
    const process = processes.find(process => process.pid === child.pid); if (process) process.exited = exited();
    if (exited()) { app = undefined; page = undefined; }
  }
  if (traceError) throw traceError;
}
async function screenshot(name: string) {
  await settle();
  const encoded = await app!.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  await fs.writeFile(path.join(output, name + '.png'), Buffer.from(encoded, 'base64'));
}
async function check(name: string, work: () => Promise<void>) {
  phase = name; const started = Date.now(); await work(); checks.push({ name, durationMs: Date.now() - started });
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log('通过：' + name);
}
async function save() { await button('保存工程').click(); await expect(page!.locator('.dirty-dot')).toHaveCount(0); const project = await read(); assert.deepEqual(validateProject(project).filter(issue => issue.severity === 'error'), []); return project; }
async function editNumber(field: Locator, value: string) { await field.fill(value); await field.press('Tab'); }
async function selectLine(id: string) { await row(id).locator('textarea').click(); await settle(); }
async function addActor(characterId: string, instanceId: string, position: number) {
  await preview().getByLabel('舞台添加角色', { exact: true }).selectOption(characterId);
  await expect(actor(characterId, instanceId)).toBeVisible();
  await expect(choices()).toHaveValue(actorKey({ characterId, instanceId: instanceId || undefined }));
  await preview().getByLabel('舞台显示范围', { exact: true }).selectOption('persistent');
  await editNumber(preview().getByLabel('角色横向位置 %', { exact: true }), String(position));
}
async function chooseGraph(id: string) {
  await page!.locator('[data-workspace-tab="blueprint"]').click();
  await page!.getByLabel('蓝图资源', { exact: true }).selectOption('graph:' + id); await fitBlueprintCanvas(page!);
}
const graphNode = (id: string) => page!.locator(`.performance-workspace .react-flow__node[data-id="${id}"]`);
const graphProperties = () => page!.getByRole('complementary', { name: '蓝图属性', exact: true });

try {
  await fs.mkdir(output, { recursive: true }); authorHash = sha256(await fs.readFile(authorFile)); report.authorSha256Before = authorHash;
  report.buildBefore = await builtFiles();
  for (const [name, fixture] of Object.entries(fixtures)) {
    assert.deepEqual(validateProject(fixture.project).filter(issue => issue.severity === 'error'), []);
    await fs.mkdir(path.dirname(fixture.file), { recursive: true });
    for (const [name, color] of [['hero', [195, 65, 85]], ['friend', [60, 170, 110]]] as const) {
      const png = new PNG({ width: 120, height: 220 });
      for (let at = 0; at < png.data.length; at += 4) { png.data[at] = color[0]; png.data[at + 1] = color[1]; png.data[at + 2] = color[2]; png.data[at + 3] = 255; }
      await fs.writeFile(path.join(path.dirname(fixture.file), name + '.png'), PNG.sync.write(png));
    }
    await saveProject(fixture.file, fixture.project); await fs.copyFile(fixture.file, path.join(output, name + '-input-project.json'));
  }
  await launch(fixtures.stage); await openStoryMode(page!, 'script'); await selectLine('number_add'); await openStageEditing(page!);
  await check('同角色依次添加第1、2、3个，不同角色从第1个独立编号', async () => {
    await addActor(ids.hero, '', 20); await addActor(ids.hero, '2', 45); await addActor(ids.hero, '3', 70);
    await addActor(ids.friend, '', 35); await addActor(ids.friend, '2', 85);
    await expect(preview().locator('.text-stage-actor')).toHaveCount(5);
    const labels = await choices().locator('option').allTextContents();
    for (const [name, number] of [['鸢', 1], ['鸢', 2], ['鸢', 3], ['赵老头', 1], ['赵老头', 2]] as const) assert.ok(labels.some(label => label.includes(name) && new RegExp('第\\s*' + number + '\\s*个').test(label)), name + ' number ' + number);
    evidence.initialChoices = labels; await save(); await screenshot('01-numbered-actors');
  });
  await check('显示角色使用第几个，非法整数草稿不会改成另一个角色', async () => {
    await row('number_add').locator('.line-effect-chip[data-action-kind="show"]').nth(2).click();
    const fields = row('number_add').getByRole('region', { name: '编辑显示角色', exact: true });
    const number = fields.getByRole('spinbutton', { name: '第几个', exact: true }); await expect(number).toHaveValue('3');
    for (const value of ['0', '-1', '1.5', '9007199254740992', '']) { await editNumber(number, value); await expect(number).toHaveValue('3'); }
    const saved = await save(), action = line(saved, 'number_add').actions[2]; assert.ok(action.kind === 'show'); assert.equal(action.instanceId, '3');
    await expect(fields.getByLabel('实例 ID', { exact: true })).toHaveCount(0); await screenshot('02-number-field');
    await fields.getByRole('button', { name: '收起演出编辑', exact: true }).click();
  });
  await check('隐藏第1个后第2和第3个不变，新增使用第4个', async () => {
    await selectLine('number_hide'); await choices().selectOption(ids.hero); await preview().getByRole('button', { name: '隐藏角色', exact: true }).click();
    await expect(actor(ids.hero)).toHaveCount(0); await expect(actor(ids.hero, '2')).toBeVisible(); await expect(actor(ids.hero, '3')).toBeVisible();
    await addActor(ids.hero, '4', 58); await expect(actor(ids.hero)).toHaveCount(0); await expect(preview().locator('.text-stage-actor')).toHaveCount(5);
    const labels = await choices().locator('option').allTextContents(); evidence.afterHideChoices = labels;
    assert.ok(!labels.some(label => label.includes('鸢') && /第\s*1\s*个/.test(label)));
    await row('number_hide').locator('.line-effect-chip[data-action-kind="hide"]').click();
    const fields = row('number_hide').getByRole('region', { name: '编辑隐藏角色', exact: true });
    await expect(fields.getByRole('spinbutton', { name: '第几个', exact: true })).toHaveValue('1');
    await fields.getByRole('button', { name: '收起演出编辑', exact: true }).click(); await save(); await screenshot('03-hidden-first-stable-numbers');
  });
  await check('角色动画按编号控制第2个，不改第3个及其他角色的第2个', async () => {
    await choices().selectOption(actorKey({ characterId: ids.hero, instanceId: '2' }));
    const details = preview().locator('details.preview-stage-details').filter({ has: page!.locator('summary', { hasText: '角色关键帧' }) });
    if (await details.getAttribute('open') === null) await details.locator('summary').click();
    await details.getByRole('button', { name: '添加角色动画', exact: true }).click();
    await expect(details.getByRole('spinbutton', { name: '第几个', exact: true })).toHaveValue('2');
    const before = await actor(ids.hero, '3').getAttribute('style'), friendBefore = await actor(ids.friend, '2').getAttribute('style');
    await editNumber(preview().getByLabel('角色横向位置 %', { exact: true }), '48');
    expect(await actor(ids.hero, '3').getAttribute('style')).toBe(before); expect(await actor(ids.friend, '2').getAttribute('style')).toBe(friendBefore);
    const saved = await save(), animation = line(saved, 'number_hide').actions.find((action): action is Extract<StageAction, { kind: 'animate' }> => action.kind === 'animate');
    assert.ok(animation); assert.equal(animation.characterId, ids.hero); assert.equal(animation.instanceId, '2'); await screenshot('04-numbered-animation');
  });
  await check('旧实例明确显示旧名称，编辑其他字段及保存重开不自动编号', async () => {
    await selectLine('number_legacy'); await row('number_legacy').locator('.line-effect-chip[data-action-kind="show"]').click();
    const fields = row('number_legacy').getByRole('region', { name: '编辑显示角色', exact: true });
    const legacy = fields.getByRole('combobox', { name: '第几个', exact: true }); await expect(legacy).toHaveValue('legacy_left');
    await expect(legacy.locator('option:checked')).toHaveText('旧实例：legacy_left');
    await choices().selectOption('instance:legacy_left'); await editNumber(preview().getByLabel('角色横向位置 %', { exact: true }), '12');
    await expect(legacy).toHaveValue('legacy_left');
    await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1100, 760)); await settle();
    const sizing = await fields.locator('.actor-instance-field').evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth }));
    assert.ok(sizing.scroll <= sizing.client + 2, 'Legacy selector fits the narrow property field.'); evidence.narrowField = sizing;
    await screenshot('05-legacy-narrow'); await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1520, 980));
    const saved = await save(); await fs.copyFile(active.file, path.join(output, 'stage-saved-project.json'));
    const actorCommands = ['number_add', 'number_hide', 'number_legacy'].flatMap(id => line(saved, id).actions.map(action => actionText(saved, action))).join('\n');
    assert.ok(actorCommands.includes('实例ID=legacy_left')); assert.ok(actorCommands.includes('第几个=2')); assert.ok(actorCommands.includes('第几个=4'));
    await fs.writeFile(path.join(output, 'saved-actor-commands.txt'), actorCommands);
    // Stage edits may use an explicit performance reference in the main script.
    // Re-read that actual saved source instead of requiring inline commands.
    const restored = applyTextScript(saved, saved.scriptText!.content);
    assert.deepEqual(restored.issues.filter(issue => issue.severity === 'error'), []);
    assert.ok(line(restored.project, 'number_legacy').actions.some(action => action.kind === 'show' && action.instanceId === 'legacy_left'));
    const keys = [...linePreviewSnapshot(saved, { nodeId: active.passageId, lineId: 'number_hide' }).after.actors.keys()];
    assert.ok(!keys.includes(ids.hero)); assert.ok(keys.includes(actorKey({ characterId: ids.hero, instanceId: '2' }))); assert.ok(keys.includes(actorKey({ characterId: ids.friend, instanceId: '2' })));
    evidence.savedStageActorKeys = keys; await screenshot('05-legacy-compatibility');
    await close(); await launch(fixtures.stage); await openStoryMode(page!, 'script'); await selectLine('number_hide'); await openStageEditing(page!);
    await expect(actor(ids.hero)).toHaveCount(0); await expect(actor(ids.hero, '2')).toBeVisible(); await expect(actor(ids.hero, '3')).toBeVisible(); await expect(actor(ids.hero, '4')).toBeVisible();
    await selectLine('number_legacy'); await expect(actor(ids.hero, 'legacy_left')).toBeVisible(); await screenshot('06-stage-reopened');
  });
  await close(); await launch(fixtures.blueprint);
  await check('台词调用的公开编号可修改，并作用于当前台词角色', async () => {
    await openStoryMode(page!, 'script'); await selectLine('number_call');
    await row('number_call').locator('.line-effect-chip[data-action-kind="blueprint"]').click();
    const call = row('number_call').locator('.blueprint-call-inputs');
    await expect(call.getByRole('checkbox', { name: '单独设置第几个', exact: true })).toBeChecked();
    await editNumber(call.getByRole('spinbutton', { name: '第几个', exact: true }), '3');
    await expect(actor(ids.hero, '3')).toBeVisible(); await expect(actor(ids.hero, '2')).toHaveCount(0);
    const saved = await save(), action = line(saved, 'number_call').actions[0]; assert.ok(action.kind === 'blueprint'); assert.equal(action.inputs?.slot, '3'); await screenshot('07-dialogue-call-number');
  });
  await check('显示与隐藏蓝图节点的卡片、右侧属性使用同一个数字字段', async () => {
    await chooseGraph(ids.staticGraph); await graphNode(ids.show).locator('.graph-node-title strong').click();
    await expect(graphProperties().getByRole('spinbutton', { name: '第几个', exact: true })).toHaveValue('2');
    await expect(graphProperties().getByLabel('显示范围', { exact: true })).toHaveValue('persistent');
    await editNumber(graphProperties().getByRole('spinbutton', { name: '第几个', exact: true }), '3');
    await expect(graphNode(ids.show).getByRole('spinbutton', { name: '显示指定角色 · 第几个', exact: true })).toHaveValue('3');
    await graphNode(ids.hide).locator('.graph-node-title strong').click();
    await editNumber(graphNode(ids.hide).getByRole('spinbutton', { name: '隐藏指定角色 · 第几个', exact: true }), '3');
    await expect(graphProperties().getByRole('spinbutton', { name: '第几个', exact: true })).toHaveValue('3');
    const saved = await save(), graph = saved.blueprints.find(graph => graph.id === ids.staticGraph)!;
    for (const id of [ids.show, ids.hide]) { const node = graph.nodes.find(node => node.id === id)!; assert.equal(node.properties.instanceId, '3'); assert.equal(node.pins.find(pin => pin.id === 'instanceId')?.name, '第几个'); }
    await screenshot('08-blueprint-number-fields');
  });
  await check('蓝图调用节点公开编号保持字符串接口，保存重开仍为第3个', async () => {
    await chooseGraph(ids.callerGraph); await graphNode(ids.caller).locator('.graph-node-title strong').click();
    await editNumber(graphNode(ids.caller).getByRole('spinbutton', { name: '调用编号演出 · 第几个', exact: true }), '3');
    const saved = await save(), caller = saved.blueprints.find(graph => graph.id === ids.callerGraph)!.nodes.find(node => node.id === ids.caller)!;
    assert.equal(caller.properties.arg_slot, '3'); assert.equal(caller.pins.find(pin => pin.id === 'arg_slot')?.dataType, 'string');
    await fs.copyFile(active.file, path.join(output, 'blueprint-saved-project.json')); await screenshot('09-blueprint-call-number');
    await close(); await launch(fixtures.blueprint); await openStoryMode(page!, 'script'); await selectLine('number_call');
    await expect(actor(ids.hero, '3')).toBeVisible();
    await chooseGraph(ids.staticGraph); await graphNode(ids.show).locator('.graph-node-title strong').click();
    await expect(graphProperties().getByRole('spinbutton', { name: '第几个', exact: true })).toHaveValue('3'); await screenshot('10-blueprint-reopened');
  });
  assert.equal(checks.length, 8); assert.deepEqual(errors, []); report.buildAfter = await builtFiles(); assert.deepEqual(report.buildAfter, report.buildBefore); report.status = 'passed';
} catch (error) {
  failure = error; report.status = 'failed'; report.phase = phase; report.error = String(error);
  if (app && page && !page.isClosed()) await screenshot('failure').catch(capture => { report.captureError = String(capture); });
} finally {
  try { await close(); } catch (error) { report.status = 'failed'; report.closeError = String(error); failure ??= error; }
  try { report.authorSha256After = sha256(await fs.readFile(authorFile)); if (authorHash !== undefined) assert.equal(report.authorSha256After, authorHash); }
  catch (error) { report.status = 'failed'; report.authorProtectionError = String(error); failure ??= error; }
  try {
    if (app || processes.some(process => !process.exited)) throw new Error('Owned fixture remains active; keep its directories.');
    report.cleanup = await cleanVerificationDirectories(output, ['stage-project', 'stage-profile', 'blueprint-project', 'blueprint-profile']);
    assert.deepEqual((report.cleanup as { errors: unknown[] }).errors, []);
  } catch (error) { report.status = 'failed'; report.cleanupError = String(error); failure ??= error; }
  await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(output);
}
if (failure) throw failure;
