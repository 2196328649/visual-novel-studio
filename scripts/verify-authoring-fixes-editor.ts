import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { createProject, effectiveCharacter, projectSchema, type BlueprintGraph, type Project, type StageAction, type StoryNode } from '../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { validateBlueprints } from '../src/core/blueprint-validation';
import { validPlayerPreference } from '../src/core/preferences';
import { effectiveTextStyle, textRuntimeLook } from '../src/core/text-presentation';
import { projectToText } from '../src/core/text-script';
import { createVisualObject } from '../src/core/visual-object';
import { validateProject } from '../src/core/validate';
import { saveProject } from '../src/desktop/project-store';
import { fitBlueprintCanvas } from './lib/blueprint-canvas';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';
import { openDisclosureAncestors } from './lib/ui-disclosures';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

// Execute only after the coordinator has finished all product changes and built
// them together. This tests repaired behavior, unlike the historical diagnostic.
// Review issues 3 and 8 have their own state/history acceptance; they are omitted.
if (process.env.VNS_INSTALLED_EXE) throw new Error('Use the compiled source editor for this isolated acceptance.');
const root = path.resolve('.');
const output = path.resolve('artifacts/authoring-fixes-2026-11-11', 'editor-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const projectFile = path.join(output, 'fixture/project.vns.json');
const profile = path.join(output, 'profile');
const authorFile = path.resolve('../我的视觉小说1/project.vns.json');
const digest = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

function connect(graph: BlueprintGraph, from: string, fromPin: string, to: string, toPin: string) {
  assert.equal(connectBlueprintPins(graph, from, fromPin, to, toPin), undefined);
}
function namedNode(type: Parameters<typeof blueprintNodeDefaults>[0], id: string, name: string, x: number, y = 0) {
  return Object.assign(blueprintNodeDefaults(type), { id, name, x, y });
}
function fixture() {
  const project = createProject('编辑一致性修复验收'); project.id = 'authoring_fixes_20261111';
  project.assets = [
    { id: 'portrait', kind: 'image', category: 'portrait', name: '验收立绘', path: 'portrait.svg', width: 180, height: 300 },
    { id: 'inherited_click', kind: 'audio', category: 'sound', name: '角色打字音', path: 'inherited.wav' },
    { id: 'local_click', kind: 'audio', category: 'sound', name: '单句打字音', path: 'local.wav' },
    { id: 'fixture_video', kind: 'video', category: 'video', name: '验收短视频', path: 'clip.webm', width: 160, height: 90 },
  ];
  project.characters = [
    { id: 'actor_a', name: '角色甲', color: '#ffffff', expressions: [{ id: 'a_pose', name: '甲的表情', assetId: 'portrait' }], textPresentation: { typeSoundId: 'inherited_click', typeSoundEvery: 2, typeSoundVolume: .45 } },
    { id: 'actor_b', name: '角色乙', color: '#ffffff', expressions: [{ id: 'b_pose', name: '乙的表情', assetId: 'portrait' }] },
    { id: 'legacy_parent', name: '旧关联上级', color: '#ffffff', expressions: [{ id: 'parent_first', name: '正面', assetId: 'portrait' }, { id: 'parent_second', name: '惊讶', assetId: 'portrait' }], defaultExpressionId: 'parent_second', blueprintId: 'legacy_graph', features: [{ id: 'legacy_feature', name: '旧抖动', actions: [{ kind: 'pause', seconds: .01 }] }] },
    { id: 'legacy_child', name: '旧关联下级', color: '#ffffff', expressions: [], baseCharacterId: 'legacy_parent' },
    { id: 'legacy_grandchild', name: '旧关联孙级', color: '#ffffff', expressions: [], baseCharacterId: 'legacy_child' },
  ];
  project.textPresets = [{ id: 'sound_look', name: '保留文字样式', style: { color: '#f5d08a' } }];

  const preferences = createBlueprintGraph('effect', '玩家数值检查'); preferences.id = 'preference_graph';
  const speed = namedNode('setPlayerPreference', 'speed_node', '文字速度检查', 350); speed.properties = { preference: 'textSpeed', value: 1000 };
  const delay = namedNode('setPlayerPreference', 'delay_node', '自动间隔检查', 700); delay.properties = { preference: 'autoForwardTime', value: 60 };
  preferences.nodes.push(speed, delay); connect(preferences, preferences.nodes[0].id, 'exec', speed.id, 'exec_in'); connect(preferences, speed.id, 'exec_out', delay.id, 'exec_in');

  const actors = createBlueprintGraph('effect', '接线角色检查'); actors.id = 'actor_graph';
  const show = namedNode('showCharacter', 'dynamic_show', '动态显示检查', 370);
  Object.assign(show.properties, { characterId: 'actor_a', expressionId: 'a_pose' });
  const actorValue = namedNode('literal', 'actor_value', '实际角色乙', 0, 220); actorValue.properties.value = 'actor_b'; actorValue.pins[0].dataType = 'character';
  const presetValue = namedNode('literal', 'preset_value', '实际中间站位', 0, 430); presetValue.properties.value = 'center'; presetValue.pins[0].dataType = 'string';
  actors.nodes.push(show, actorValue, presetValue); connect(actors, actors.nodes[0].id, 'exec', show.id, 'exec_in');
  connect(actors, actorValue.id, 'value', show.id, 'characterId'); connect(actors, presetValue.id, 'value', show.id, 'presetId');

  const dynamic = createBlueprintGraph('effect', '运行时角色检查'); dynamic.id = 'runtime_actor_graph';
  const runtimeShow = namedNode('showCharacter', 'runtime_show', '运行时显示检查', 390);
  Object.assign(runtimeShow.properties, { characterId: 'actor_a', expressionId: 'a_pose', presetId: '' });
  dynamic.exposedInputs = [{ ...runtimeShow.pins.find(pin => pin.id === 'characterId')!, id: 'actor_input', name: '调用者角色', defaultValue: 'actor_b' }];
  const actorInput = namedNode('getInput', 'runtime_input', '读取调用者角色', 0, 220); actorInput.properties.inputId = 'actor_input'; actorInput.pins[0].dataType = 'character';
  dynamic.nodes.push(runtimeShow, actorInput); connect(dynamic, dynamic.nodes[0].id, 'exec', runtimeShow.id, 'exec_in'); connect(dynamic, actorInput.id, 'value', runtimeShow.id, 'characterId');

  const positions = createBlueprintGraph('effect', '横坐标与站位检查'); positions.id = 'position_graph';
  const positionShow = namedNode('showCharacter', 'position_show', '横坐标显示检查', 390);
  Object.assign(positionShow.properties, { characterId: 'actor_a', expressionId: 'a_pose', presetId: '', scale: 6, layer: 150 });
  const xValue = namedNode('literal', 'x_value', '实际横坐标', 0, 220); xValue.properties.value = .4; xValue.pins[0].dataType = 'number';
  positions.nodes.push(positionShow, xValue); connect(positions, positions.nodes[0].id, 'exec', positionShow.id, 'exec_in'); connect(positions, xValue.id, 'value', positionShow.id, 'x');

  const ranges = createBlueprintGraph('effect', '角色合法数值检查'); ranges.id = 'actor_range_graph';
  const small = namedNode('showCharacter', 'small_actor', '小角色检查', 360), large = namedNode('showCharacter', 'large_actor', '大角色检查', 740);
  Object.assign(small.properties, { characterId: 'actor_a', expressionId: 'a_pose', presetId: '', scale: .01, layer: -10 });
  Object.assign(large.properties, { characterId: 'actor_a', expressionId: 'a_pose', presetId: '', scale: 12, layer: -5 });
  ranges.nodes.push(small, large); connect(ranges, ranges.nodes[0].id, 'exec', small.id, 'exec_in'); connect(ranges, small.id, 'exec_out', large.id, 'exec_in');

  const legacy = createBlueprintGraph('effect', '旧角色附加蓝图'); legacy.id = 'legacy_graph';
  const legacyDelay = namedNode('delay', 'legacy_delay', '旧等待', 350); legacyDelay.properties.seconds = .01;
  legacy.nodes.push(legacyDelay); connect(legacy, legacy.nodes[0].id, 'exec', legacyDelay.id, 'exec_in');
  project.blueprints = [preferences, actors, dynamic, positions, ranges, legacy];

  const passage = project.nodes.find(node => node.kind === 'passage')!;
  const image = createVisualObject('image', 'portrait'), video = createVisualObject('video', 'fixture_video');
  image.instanceId = 'audit_image'; video.instanceId = 'audit_video'; video.sourceDuration = .5; video.duration = .5; video.muted = true;
  for (const object of [image, video]) object.visualTransitions = { enter: { mode: 'dissolve', duration: 0 }, exit: { mode: 'dissolve', duration: 0 }, replace: { mode: 'dissolve', duration: 0 } };
  passage.lines = [
    { id: 'audit_line', speakerId: 'actor_a', text: '本句静音与角色继承应当是两个操作。', actions: [], textPresentation: { presetId: 'sound_look', speed: 'cps', cps: 15, typeSoundId: 'local_click', typeSoundEvery: 3, typeSoundVolume: .65 } },
    { id: 'inherited_sound_line', speakerId: 'actor_a', text: '没有本地声音引用的台词也可以明确静音。', actions: [], textPresentation: { speed: 'cps', cps: 15 } },
    { id: 'image_line', text: '图片三种过渡保留作者设置的零秒。', actions: [image] },
    { id: 'video_line', text: '视频三种过渡也保留零秒。', actions: [video] },
    { id: 'hide_line', text: '隐藏对象的离场同样可以为零秒。', actions: [{ kind: 'hideVisual', instanceId: image.instanceId, exitTransition: { mode: 'dissolve', duration: 0 } }] },
    { id: 'legacy_line', speakerId: 'legacy_child', text: '旧工程已经保存的角色功能仍可阅读和移除。', actions: [{ kind: 'characterFeature', characterId: 'legacy_child', featureId: 'legacy_feature' }] },
  ];
  const scene = project.scenes[0], nextScene = { id: 'scene_second', name: '过渡目标二', chapterId: scene.chapterId }, lastScene = { id: 'scene_third', name: '过渡目标三', chapterId: scene.chapterId };
  project.scenes.push(nextScene, lastScene);
  const extra: StoryNode[] = [
    { id: 'jump_zero', kind: 'jump', name: '已有零秒转场', sceneId: scene.id, x: 580, y: 310, target: 'second_start', sceneTransition: { mode: 'dissolve', duration: 0, color: '#000000', fromSceneId: scene.id, toSceneId: nextScene.id } },
    { id: 'jump_empty', kind: 'jump', name: '尚未设置转场', sceneId: scene.id, x: 580, y: 520, target: 'second_start' },
    { id: 'second_start', kind: 'start', name: '目标二入口', sceneId: nextScene.id, x: 40, y: 120, next: 'second_end' },
    { id: 'second_end', kind: 'end', name: '目标二结束', sceneId: nextScene.id, x: 360, y: 120 },
    { id: 'third_start', kind: 'start', name: '目标三入口', sceneId: lastScene.id, x: 40, y: 120, next: 'third_end' },
    { id: 'third_end', kind: 'end', name: '目标三结束', sceneId: lastScene.id, x: 360, y: 120 },
  ];
  project.nodes.push(...extra); passage.next = 'jump_zero';
  synchronizeBlueprintSignatures(project);
  project.scriptText = { format: 'vns-text-1', content: projectToText(project) };
  return { project: projectSchema.parse(project), passageId: passage.id };
}

const { project, passageId } = fixture();
let app: ElectronApplication | undefined, page: Page | undefined, failure: unknown;
let phase = '准备隔离工程', authorBefore: string | undefined, traceRunning = false, launchNumber = 0;
const checks: { name: string; issues: number[]; durationMs: number; evidence: unknown }[] = [];
const pageErrors: string[] = [], traces: string[] = [];
const processes: { pid?: number; exited: boolean }[] = [];
const report: Record<string, unknown> = { status: 'running', renderer: 'compiled source editor', coveredIssues: [1, 2, 4, 5, 6, 7, 9, 10, 11, 12], excludedIssues: [3, 8], checks, pageErrors, traces, processes,
  limits: ['使用有效的静音 WAV 检查编辑、保存与生成的打字音数据；不验证扬声器出声。', '本脚本未启动原生游戏；执行路径由协调者的独立验收覆盖。'], temporaryPaths: [path.dirname(projectFile), profile] };
const button = (name: string) => page!.getByRole('button', { name, exact: true });
const row = (id: string) => page!.locator('#line-' + id);
const card = (id: string) => page!.locator('.react-flow__node[data-id="' + id + '"]');
const characterPanel = () => page!.getByRole('region', { name: '角色编辑工作区', exact: true });
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
function line(value: Project, id: string) {
  const passage = value.nodes.find(node => node.id === passageId); assert.ok(passage?.kind === 'passage');
  const found = passage.lines.find(line => line.id === id); assert.ok(found, 'Missing line ' + id); return found;
}
function graphNode(value: Project, graphId: string, nodeId: string) {
  const graph = value.blueprints.find(item => item.id === graphId); assert.ok(graph);
  const found = graph.nodes.find(item => item.id === nodeId); assert.ok(found); return found;
}
function character(value: Project, id: string) { const found = value.characters.find(item => item.id === id); assert.ok(found); return found; }
function jump(value: Project, id: string) { const found = value.nodes.find(item => item.id === id); assert.ok(found?.kind === 'jump'); return found; }
function visual(value: Project, id: string) { const found = line(value, id).actions[0]; assert.ok(found?.kind === 'visual'); return found; }
const settle = () => page!.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
async function writeReport() { await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); }
async function save() { await button('保存工程').click(); await expect(page!.locator('.dirty-dot')).toHaveCount(0); return read(); }
async function undo() { await button('撤销').click(); await settle(); }
async function selectNode(graphId: string, nodeId: string) {
  await page!.locator('[data-workspace-tab="blueprint"]').click();
  await page!.getByLabel('蓝图资源', { exact: true }).selectOption('graph:' + graphId);
  await fitBlueprintCanvas(page!); await card(nodeId).locator('.graph-node-title strong').click();
  return page!.getByRole('complementary', { name: '蓝图属性', exact: true });
}
async function selectCharacter(id: string) {
  await page!.locator('[data-workspace-tab="characters"]').click(); await page!.locator('.character-item[data-character-id="' + id + '"]').click();
  await characterPanel().getByRole('tab', { name: '外观与表情', exact: true }).click(); return characterPanel();
}
async function soundEditor(id: string, number: number) {
  await openStoryMode(page!, 'script'); await row(id).locator('textarea').click();
  const editor = row(id).getByRole('region', { name: `第${number}行台词文字演出`, exact: true });
  if (!await editor.isVisible()) await row(id).getByRole('button', { name: `展开第${number}行台词文字演出`, exact: true }).click();
  await editor.getByRole('tab', { name: '打字音', exact: true }).click(); return editor;
}
async function visualEditor(id: string, kind: StageAction['kind']) {
  await openStoryMode(page!, 'script'); await row(id).locator('textarea').click();
  const chip = row(id).locator('.line-effect-chip[data-action-kind="' + kind + '"]');
  if (await chip.getAttribute('aria-expanded') !== 'true') await chip.click();
  return kind === 'visual' ? row(id).getByRole('region', { name: '演出对象属性', exact: true }) : row(id).locator('.line-effect-editor');
}
async function openJump(id: string) {
  await openStoryMode(page!, 'script'); await page!.locator('#node-' + id + ' .node-summary').click();
  const dialog = page!.getByRole('dialog', { name: '编辑模块内容', exact: true }); await expect(dialog).toBeVisible(); return dialog;
}
async function saveJump(dialog: Locator) { await dialog.getByRole('button', { name: '完成', exact: true }).click(); await expect(dialog).toHaveCount(0); return save(); }
async function screenshot(name: string) {
  await settle();
  const encoded = await app!.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  await fs.writeFile(path.join(output, name + '.png'), Buffer.from(encoded, 'base64'));
}
async function check(name: string, issues: number[], work: () => Promise<unknown>) {
  phase = name; const started = Date.now(), evidence = await work(); checks.push({ name, issues, durationMs: Date.now() - started, evidence });
  await writeReport(); console.log('通过：' + name);
}
async function fingerprints() {
  const html = await fs.readFile(path.join(root, 'dist/index.html'), 'utf8');
  const entry = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).main as string;
  const files = ['dist/index.html', entry, 'dist-desktop/preload.cjs', ...[...html.matchAll(/(?:src|href)="(\.\/assets\/[^"?#]+\.(?:js|css))"/g)].map(match => 'dist/' + match[1].slice(2))];
  assert.ok(files.some(file => file.startsWith('dist/assets/') && file.endsWith('.js')));
  return Promise.all([...new Set(files)].map(async file => ({ file, sha256: digest(await fs.readFile(path.join(root, file))) })));
}
async function launch() {
  app = await launchDesktopFixture({ root, projectFile, profile }); page = await app.firstWindow(); page.setDefaultTimeout(15000);
  processes.push({ pid: app.process().pid, exited: false }); launchNumber++;
  page.on('pageerror', error => pageErrors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; if (window.isMaximized()) window.unmaximize(); window.setContentSize(1600, 1000); window.webContents.setBackgroundThrottling(false); });
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  assert.equal(path.resolve(fileURLToPath(page.url())), path.join(root, 'dist/index.html'));
  report.rendererUrl = page.url(); await page.evaluate('globalThis.__name = value => value');
  await page.context().tracing.start({ screenshots: true, snapshots: true, sources: false }); traceRunning = true; await settle();
}
async function close() {
  if (!app) return;
  const owned = app, child = owned.process(), exited = () => child.exitCode !== null || child.signalCode !== null;
  let traceFailure: unknown;
  if (traceRunning && page) {
    const name = 'trace-' + String(launchNumber).padStart(2, '0') + '.zip';
    try { await page.context().tracing.stop({ path: path.join(output, name) }); traces.push(name); }
    catch (error) { traceFailure = error; report.traceError = String(error); }
    traceRunning = false;
  }
  try { await owned.close(); }
  finally {
    await expect.poll(exited, { timeout: 15000 }).toBe(true);
    const record = processes.find(item => item.pid === child.pid); if (record) record.exited = exited();
    if (exited()) { app = undefined; page = undefined; }
  }
  if (traceFailure) throw traceFailure;
}
function soundSnapshot(value: Project, id: string) {
  const selected = line(value, id), effective = effectiveTextStyle(value, selected);
  return { own: selected.textPresentation, effective, generated: textRuntimeLook(value, effective, selected.text)?.typeSound };
}

try {
  await fs.mkdir(path.dirname(projectFile), { recursive: true }); authorBefore = digest(await fs.readFile(authorFile)); report.authorSha256Before = authorBefore;
  report.fingerprintsBefore = await fingerprints();
  await fs.writeFile(path.join(path.dirname(projectFile), 'portrait.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="300"><rect width="180" height="300" fill="#c06070"/></svg>');
  // Silent, valid PCM WAVs make resource selection deterministic without audio output.
  const wav = Buffer.alloc(44 + 1600); wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(1600, 40);
  for (const file of ['inherited.wav', 'local.wav']) await fs.writeFile(path.join(path.dirname(projectFile), file), wav);
  execFileSync(process.env.VNS_FFMPEG ?? 'ffmpeg', ['-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x536894:s=160x90:r=12:d=0.5', '-c:v', 'libvpx', '-pix_fmt', 'yuv420p', '-an', path.join(path.dirname(projectFile), 'clip.webm')], { windowsHide: true, timeout: 30000 });
  // The mismatched expression is deliberate: it must remain diagnosable until
  // an actual user edit repairs it. No fixture helper silently replaces it.
  const initialIssues = validateProject(project); report.initialDiagnostics = initialIssues;
  assert.ok(initialIssues.some(issue => issue.code === 'blueprint-actor-expression' && issue.nodeId === 'dynamic_show' && issue.severity === 'error'));
  assert.deepEqual(initialIssues.filter(issue => issue.severity === 'error' && !(issue.code === 'blueprint-actor-expression' && issue.nodeId === 'dynamic_show')), []);
  await saveProject(projectFile, project); await fs.copyFile(projectFile, path.join(output, 'input-project.json')); await launch();

  await check('实际接线角色的表情在卡片和右栏一致，保留并修复旧错误引用', [1], async () => {
    const panel = await selectNode('actor_graph', 'dynamic_show'), right = panel.getByRole('combobox', { name: '表情', exact: true });
    const inline = card('dynamic_show').getByRole('combobox', { name: '动态显示检查 · 表情', exact: true });
    for (const field of [right, inline]) {
      await expect(field).toHaveValue('a_pose'); await expect(field.locator('option[value="a_pose"]')).toHaveText('不属于当前角色 · a_pose');
      await expect(field.locator('option[value="b_pose"]')).toHaveText('乙的表情'); await expect(field.locator('option').filter({ hasText: '甲的表情' })).toHaveCount(0);
    }
    await expect(panel.locator('small[role="status"]').filter({ hasText: '不属于实际角色“角色乙”' })).toHaveCount(1);
    await expect(card('dynamic_show').locator('small[role="status"]').filter({ hasText: '不属于实际角色“角色乙”' })).toHaveCount(1);
    const before = await save(); assert.equal(graphNode(before, 'actor_graph', 'dynamic_show').properties.expressionId, 'a_pose');
    await screenshot('01-connected-expression-before'); await right.selectOption('b_pose'); await expect(inline).toHaveValue('b_pose');
    const saved = await save(), current = graphNode(saved, 'actor_graph', 'dynamic_show');
    assert.equal(current.properties.characterId, 'actor_a'); assert.equal(current.properties.expressionId, 'b_pose');
    assert.ok(saved.blueprints.find(graph => graph.id === 'actor_graph')!.links.some(link => link.fromNodeId === 'actor_value' && link.toNodeId === current.id && link.toPinId === 'characterId'));
    assert.equal(graphNode(saved, 'actor_graph', 'actor_value').properties.value, 'actor_b');
    assert.deepEqual(validateBlueprints(saved).filter(issue => issue.nodeId === current.id && issue.code === 'blueprint-actor-expression'), []);
    await screenshot('02-connected-expression-fixed'); return { savedFallback: current.properties.characterId, actual: 'actor_b', expression: current.properties.expressionId };
  });

  await check('真正动态角色保留自由表情输入，不把公开默认值当实际角色', [1], async () => {
    const panel = await selectNode('runtime_actor_graph', 'runtime_show');
    const right = panel.getByRole('textbox', { name: '表情', exact: true }), inline = card('runtime_show').getByRole('textbox', { name: '运行时显示检查 · 表情', exact: true });
    await expect(right).toHaveValue('a_pose'); await expect(inline).toHaveValue('a_pose');
    await expect(panel.getByRole('combobox', { name: '表情', exact: true })).toHaveCount(0);
    await expect(panel.locator('small[role="status"]').filter({ hasText: '表情“a_pose”会原样匹配实际角色' })).toHaveCount(1);
    await expect(card('runtime_show').locator('small[role="status"]').filter({ hasText: '表情“a_pose”会原样匹配实际角色' })).toHaveCount(1);
    await screenshot('03-runtime-expression-source'); await right.fill(''); await right.press('Tab'); await expect(inline).toHaveValue('');
    const saved = await save(), graph = saved.blueprints.find(graph => graph.id === 'runtime_actor_graph')!;
    assert.equal(graph.exposedInputs[0].defaultValue, 'actor_b'); assert.equal(graphNode(saved, graph.id, 'runtime_show').properties.characterId, 'actor_a');
    assert.equal(graphNode(saved, graph.id, 'runtime_show').properties.expressionId, '');
    assert.deepEqual(validateBlueprints(saved).filter(issue => issue.nodeId === 'runtime_show' && issue.code === 'blueprint-actor-expression-runtime'), []);
    return { callerDefaultPreserved: 'actor_b', fallbackPreserved: 'actor_a', expression: '', sourceIsRuntime: true };
  });

  await check('合法大玩家数值与角色大小层级聚焦失焦不改值', [2], async () => {
    const evidence = [];
    for (const [node, preference, value, name] of [['speed_node', 'textSpeed', 1000, '文字速度检查'], ['delay_node', 'autoForwardTime', 60, '自动间隔检查']] as const) {
      assert.equal(validPlayerPreference(preference, value), true);
      const before = graphNode(await read(), 'preference_graph', node), panel = await selectNode('preference_graph', node);
      for (const field of [panel.getByRole('spinbutton', { name: '设置值', exact: true }), card(node).getByRole('spinbutton', { name: name + ' · 设置值', exact: true })]) {
        await openDisclosureAncestors(field); await expect(field).toHaveValue(String(value)); await field.focus(); await field.press('Tab'); await expect(field).toHaveValue(String(value));
      }
      assert.deepEqual(graphNode(await save(), 'preference_graph', node), before); evidence.push({ preference, value, typedNothing: true });
    }
    for (const [graph, id, name, scale, layer] of [['position_graph', 'position_show', '横坐标显示检查', 6, 150], ['actor_range_graph', 'small_actor', '小角色检查', .01, -10], ['actor_range_graph', 'large_actor', '大角色检查', 12, -5]] as const) {
      const before = graphNode(await read(), graph, id), panel = await selectNode(graph, id);
      for (const [rightLabel, cardLabel, value] of [['角色大小', '大小', scale], ['前后层级', '层级', layer]] as const) {
        for (const field of [panel.getByRole('spinbutton', { name: rightLabel, exact: true }), card(id).getByRole('spinbutton', { name: name + ' · ' + cardLabel, exact: true })]) {
          await openDisclosureAncestors(field); await expect(field).toHaveValue(String(value)); await field.focus(); await field.press('Tab'); await expect(field).toHaveValue(String(value));
        }
      }
      assert.deepEqual(graphNode(await save(), graph, id), before); evidence.push({ id, scale, layer, typedNothing: true });
    }
    await screenshot('04-legal-numeric-values'); return evidence;
  });

  await check('快捷站位只受预设数据线限制，单独横坐标接线仍可选择', [7], async () => {
    let panel = await selectNode('actor_graph', 'dynamic_show'); const before = graphNode(await read(), 'actor_graph', 'dynamic_show');
    for (const name of ['左侧', '中间', '右侧']) { const field = panel.getByRole('button', { name, exact: true }); await expect(field).toBeDisabled(); await expect(field).toHaveAttribute('title', /站位预设来自/); }
    assert.deepEqual(graphNode(await save(), 'actor_graph', 'dynamic_show'), before);
    panel = await selectNode('position_graph', 'position_show'); const left = panel.getByRole('button', { name: '左侧', exact: true }); await expect(left).toBeEnabled(); await left.click();
    const saved = await save(), graph = saved.blueprints.find(graph => graph.id === 'position_graph')!;
    assert.equal(graphNode(saved, graph.id, 'position_show').properties.presetId, 'left');
    assert.ok(graph.links.some(link => link.fromNodeId === 'x_value' && link.toNodeId === 'position_show' && link.toPinId === 'x'));
    assert.ok(!graph.links.some(link => link.toNodeId === 'position_show' && link.toPinId === 'presetId'));
    await screenshot('05-preset-with-x-source'); return { presetSourceButtonsDisabled: true, xSourceRetained: true, chosenPreset: 'left' };
  });

  await check('无打字音明确静音，可撤销且不清除声音引用或其他文字设置', [4], async () => {
    const editor = await soundEditor('audit_line', 1), mode = editor.getByRole('combobox', { name: '打字音方式', exact: true });
    await expect(mode).toHaveValue('sound'); const initial = soundSnapshot(await read(), 'audit_line'); assert.ok(initial.generated);
    const sound = editor.getByRole('combobox', { name: '打字音', exact: true }); await expect(sound).toHaveValue('单句打字音'); await sound.click();
    await page!.getByRole('listbox', { name: '打字音搜索结果', exact: true }).getByRole('option', { name: '无打字音', exact: true }).click();
    await expect(mode).toHaveValue('mute'); await expect(editor.getByRole('combobox', { name: '打字音', exact: true })).toHaveCount(0);
    let saved = await save(), muted = soundSnapshot(saved, 'audit_line');
    assert.equal(muted.own?.typeSoundVolume, 0); assert.equal(muted.own?.typeSoundId, 'local_click'); assert.equal(muted.own?.typeSoundEvery, 3); assert.equal(muted.own?.presetId, 'sound_look'); assert.equal(muted.own?.cps, 15); assert.equal(muted.generated, undefined);
    await undo(); await expect(mode).toHaveValue('sound'); assert.deepEqual(soundSnapshot(await save(), 'audit_line'), initial);
    await mode.selectOption('mute'); saved = await save(); muted = soundSnapshot(saved, 'audit_line'); assert.equal(muted.generated, undefined);
    await screenshot('06-explicit-type-sound-mute');
    const inherited = await soundEditor('inherited_sound_line', 2); await expect(inherited.getByLabel('打字音方式', { exact: true })).toHaveValue('inherit');
    await inherited.getByLabel('打字音方式', { exact: true }).selectOption('mute'); const noLocal = soundSnapshot(await save(), 'inherited_sound_line');
    assert.equal(noLocal.own?.typeSoundVolume, 0); assert.equal(noLocal.own?.typeSoundId, undefined); assert.equal(noLocal.own?.typeSoundEvery, undefined); assert.equal(noLocal.generated, undefined);
    return { localMute: muted, inheritedMute: noLocal, audioDeviceNotTested: true };
  });

  await check('图片和视频三阶段与隐藏对象切方式均保留显式零秒', [5], async () => {
    const evidence = [];
    for (const id of ['image_line', 'video_line']) {
      const fields = await visualEditor(id, 'visual');
      for (const [key, label] of [['enter', '入场过渡'], ['exit', '离场过渡'], ['replace', '替换过渡']] as const) {
        const mode = fields.getByRole('combobox', { name: label, exact: true }), seconds = fields.getByRole('spinbutton', { name: label + '秒数', exact: true });
        await openDisclosureAncestors(mode); await expect(seconds).toHaveValue('0'); await mode.selectOption('move'); await expect(seconds).toHaveValue('0');
        assert.deepEqual(visual(await save(), id).visualTransitions?.[key], { mode: 'move', duration: 0 });
        await mode.selectOption('none'); await expect(seconds).toHaveValue('0'); await expect(seconds).toBeDisabled();
        assert.deepEqual(visual(await save(), id).visualTransitions?.[key], { mode: 'none', duration: 0 });
        await mode.selectOption('fade'); await expect(seconds).toHaveValue('0'); await expect(seconds).toBeEnabled();
        assert.deepEqual(visual(await save(), id).visualTransitions?.[key], { mode: 'fade', duration: 0 }); evidence.push({ id, phase: key, duration: 0 });
      }
      const mode = fields.getByLabel('入场过渡', { exact: true }), seconds = fields.getByLabel('入场过渡秒数', { exact: true });
      await seconds.fill('0.7'); await seconds.press('Tab'); await mode.selectOption('none'); await expect(seconds).toHaveValue('0');
      assert.deepEqual(visual(await save(), id).visualTransitions?.enter, { mode: 'none', duration: .7 });
      await mode.selectOption('move'); await expect(seconds).toHaveValue('0.7'); await seconds.fill('0'); await seconds.press('Tab'); await mode.selectOption('none'); await save();
      await screenshot(id === 'image_line' ? '07-image-zero-transitions' : '08-video-zero-transitions');
    }
    const fields = await visualEditor('hide_line', 'hideVisual'), mode = fields.getByLabel('离场过渡', { exact: true }), seconds = fields.getByLabel('离场过渡秒数', { exact: true });
    await expect(seconds).toHaveValue('0'); await mode.selectOption('move'); await expect(seconds).toHaveValue('0');
    const hidden = line(await save(), 'hide_line').actions[0]; assert.ok(hidden.kind === 'hideVisual'); assert.deepEqual(hidden.exitTransition, { mode: 'move', duration: 0 });
    await mode.selectOption('inherit'); await expect(seconds).toHaveValue(''); await expect(seconds).toBeDisabled();
    const inherited = line(await save(), 'hide_line').actions[0]; assert.ok(inherited.kind === 'hideVisual'); assert.equal(inherited.exitTransition, undefined);
    await mode.selectOption('dissolve'); await expect(seconds).toHaveValue('0.5'); await seconds.fill('0'); await seconds.press('Tab'); await mode.selectOption('none'); await expect(seconds).toBeDisabled();
    const final = line(await save(), 'hide_line').actions[0]; assert.ok(final.kind === 'hideVisual'); assert.deepEqual(final.exitTransition, { mode: 'none', duration: 0 });
    return { phases: evidence, positiveDurationRemembered: .7, inheritedHideResetsToDefault: .5, hideSaved: final.exitTransition };
  });

  await check('跳转区分未配置半秒与显式零秒，清除后改目标不制造转场', [6], async () => {
    let dialog = await openJump('jump_zero'); let mode = dialog.getByLabel('场景切换方式', { exact: true }), seconds = dialog.getByLabel('场景转场总时长 秒', { exact: true });
    await expect(seconds).toHaveValue('0'); await mode.selectOption('fade'); await expect(seconds).toHaveValue('0');
    assert.equal(jump(await saveJump(dialog), 'jump_zero').sceneTransition?.duration, 0);
    dialog = await openJump('jump_zero'); mode = dialog.getByLabel('场景切换方式', { exact: true }); seconds = dialog.getByLabel('场景转场总时长 秒', { exact: true });
    await mode.selectOption('none'); await expect(seconds).toHaveValue('0'); await expect(seconds).toBeDisabled(); await screenshot('09-jump-explicit-zero');
    const zero = jump(await saveJump(dialog), 'jump_zero'); assert.equal(zero.sceneTransition?.mode, 'none'); assert.equal(zero.sceneTransition?.duration, 0);

    dialog = await openJump('jump_empty'); mode = dialog.getByLabel('场景切换方式', { exact: true }); seconds = dialog.getByLabel('场景转场总时长 秒', { exact: true });
    await expect(mode).toHaveValue('none'); await expect(seconds).toHaveValue('0'); await expect(seconds).toBeDisabled(); await mode.selectOption('dissolve'); await expect(seconds).toHaveValue('0.5');
    await seconds.fill('0.75'); await seconds.press('Tab'); await mode.selectOption('none'); await expect(seconds).toHaveValue('0'); await expect(seconds).toBeDisabled();
    await mode.selectOption('fade'); await expect(seconds).toHaveValue('0.75'); assert.equal(jump(await saveJump(dialog), 'jump_empty').sceneTransition?.duration, .75);
    dialog = await openJump('jump_empty'); await dialog.getByRole('button', { name: '清除场景转场', exact: true }).click(); await dialog.getByLabel('目标场景', { exact: true }).selectOption('scene_third');
    const cleared = jump(await saveJump(dialog), 'jump_empty'); assert.equal(cleared.target, 'third_start'); assert.equal(cleared.sceneTransition, undefined);
    return { explicitNoneDuration: zero.sceneTransition?.duration, firstEnabledDuration: .5, rememberedDuration: .75, clearedTarget: cleared.target, clearedTransition: null };
  });

  await check('旧关联默认表情显示有效第二项，明确首项可撤销并保存', [9], async () => {
    const panel = await selectCharacter('legacy_child'), select = panel.getByLabel('角色默认表情', { exact: true });
    await expect(select).toHaveValue('parent_second'); await expect(panel.getByLabel('默认表情来源', { exact: true })).toContainText('沿用旧关联角色“旧关联上级”');
    assert.equal(effectiveCharacter(await read(), 'legacy_child')?.defaultExpressionId, 'parent_second');
    await panel.getByRole('button', { name: '使用第一个表情', exact: true }).click(); await expect(select).toHaveValue('parent_first');
    assert.equal(character(await save(), 'legacy_child').defaultExpressionId, 'parent_first');
    await undo(); await expect(select).toHaveValue('parent_second'); assert.equal(character(await save(), 'legacy_child').defaultExpressionId, undefined);
    await select.selectOption('parent_first'); assert.equal(character(await save(), 'legacy_child').defaultExpressionId, 'parent_first');
    await expect(panel.getByRole('button', { name: '还原默认表情：惊讶（沿用“旧关联上级”）', exact: true })).toBeVisible();
    await screenshot('10-inherited-expression-override'); return { inherited: 'parent_second', explicit: 'parent_first', undoRestoredInheritance: true };
  });

  await check('旧角色附加蓝图可定位来源，单独停用可撤销且不改上级', [10], async () => {
    let panel = await selectCharacter('legacy_child'); let binding = panel.getByRole('region', { name: '旧角色显示后蓝图', exact: true });
    await expect(binding).toContainText('旧角色附加蓝图'); await expect(binding).toContainText('旧关联角色“旧关联上级”');
    const beforeParent = character(await read(), 'legacy_parent');
    await binding.getByRole('button', { name: '查看蓝图：旧角色附加蓝图', exact: true }).click();
    await expect(page!.getByLabel('蓝图资源', { exact: true })).toHaveValue('graph:legacy_graph'); await fitBlueprintCanvas(page!); await expect(card('legacy_delay')).toBeVisible();
    panel = await selectCharacter('legacy_child'); binding = panel.getByRole('region', { name: '旧角色显示后蓝图', exact: true });
    await binding.getByRole('button', { name: '查看绑定来源角色', exact: true }).click(); await expect(page!.locator('.character-item[data-character-id="legacy_parent"]')).toHaveClass(/selected/);
    panel = await selectCharacter('legacy_child'); binding = panel.getByRole('region', { name: '旧角色显示后蓝图', exact: true });
    await binding.getByRole('button', { name: '停用本角色的额外蓝图', exact: true }).click(); await expect(binding).toContainText('这项额外蓝图已停用，角色立绘仍正常显示。');
    let saved = await save(); assert.equal(character(saved, 'legacy_child').blueprintDisabled, true); assert.equal(effectiveCharacter(saved, 'legacy_child')?.blueprintId, undefined); assert.deepEqual(character(saved, 'legacy_parent'), beforeParent);
    await undo(); saved = await save(); assert.equal(character(saved, 'legacy_child').blueprintDisabled, undefined); assert.equal(effectiveCharacter(saved, 'legacy_child')?.blueprintId, 'legacy_graph');
    await binding.getByRole('button', { name: '停用本角色的额外蓝图', exact: true }).click(); await save(); await screenshot('11-legacy-blueprint-disabled');
    return { graphLocated: 'legacy_graph', sourceLocated: 'legacy_parent', onlyChildDisabled: true, undoRestoredInheritance: true };
  });

  await check('旧上级删除列出直接和间接依赖并阻止产生悬空角色引用', [11], async () => {
    const before = (await read()).characters, panel = await selectCharacter('legacy_parent'), dependencies = panel.getByRole('region', { name: '角色删除依赖', exact: true });
    await expect(dependencies).toContainText('不能删除“旧关联上级”'); await expect(dependencies.getByRole('button', { name: '查看角色：旧关联下级', exact: true })).toBeVisible();
    await expect(dependencies.getByRole('button', { name: '查看角色：旧关联孙级', exact: true })).toBeVisible(); await expect(panel.getByRole('button', { name: '删除角色', exact: true })).toBeDisabled();
    await screenshot('12-protected-parent-delete'); await dependencies.getByRole('button', { name: '查看角色：旧关联孙级', exact: true }).click();
    await expect(page!.locator('.character-item[data-character-id="legacy_grandchild"]')).toHaveClass(/selected/); const saved = await save(); assert.deepEqual(saved.characters, before);
    assert.deepEqual(validateProject(saved).filter(issue => issue.severity === 'error' && issue.message.includes('继承的基础角色不存在')), []);
    return { preventedParent: 'legacy_parent', dependents: ['legacy_child', 'legacy_grandchild'], charactersUnchanged: true };
  });

  await check('创建入口移除旧角色功能，已有调用保持可读删除与撤销', [12], async () => {
    await openStoryMode(page!, 'script'); const target = row('legacy_line'); await target.locator('textarea').click();
    const add = target.getByRole('button', { name: '为第6行添加效果', exact: true }); await add.click();
    const menu = page!.getByRole('menu', { name: '添加本行演出', exact: true }); await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: '角色功能', exact: true })).toHaveCount(0); await expect(menu.getByRole('menuitem', { name: '显示角色', exact: true })).toBeVisible(); await add.click();
    const original = line(await read(), 'legacy_line').actions; await target.locator('.line-effect-chip[data-action-kind="characterFeature"]').click();
    const editor = target.getByRole('region', { name: '编辑角色功能', exact: true }); await expect(editor).toBeVisible();
    await expect(editor.locator('select').nth(0)).toHaveValue('legacy_child'); await expect(editor.locator('select').nth(1)).toHaveValue('legacy_feature');
    await expect(editor.locator('option:checked').last()).toHaveText('旧抖动'); await editor.getByRole('button', { name: '删除动作', exact: true }).click();
    assert.deepEqual(line(await save(), 'legacy_line').actions, []); await undo(); assert.deepEqual(line(await save(), 'legacy_line').actions, original);
    await expect(target.locator('.line-effect-chip[data-action-kind="characterFeature"]')).toBeVisible();

    await openStoryMode(page!, 'text'); await button('批量演出').click();
    const batch = page!.getByRole('dialog', { name: '批量添加演出', exact: true }), kinds = batch.getByLabel('批量演出类型', { exact: true });
    await expect(kinds.locator('option[value="characterFeature"]')).toHaveCount(0); await expect(kinds.locator('option[value="show"]')).toHaveCount(1);
    await batch.getByRole('button', { name: '关闭批量演出', exact: true }).click();
    const source = page!.getByRole('textbox', { name: '中文文本剧本', exact: true }), originalText = await source.inputValue();
    await source.focus(); await source.press('Control+End'); await page!.keyboard.insertText('\n@角色');
    const suggestions = page!.getByRole('listbox', { name: '文本补全建议', exact: true }); await expect(suggestions).toBeVisible();
    await expect(suggestions.getByRole('option').filter({ hasText: '显示角色' })).toHaveCount(1);
    await expect(suggestions.getByRole('option').filter({ hasText: '角色功能' })).toHaveCount(0); await expect(suggestions.getByRole('option').filter({ hasText: '旧抖动' })).toHaveCount(0);
    await screenshot('13-legacy-feature-not-offered'); await source.press('Escape');
    for (const _character of Array.from('\n@角色')) await source.press('Backspace');
    await expect(source).toHaveValue(originalText);
    const saved = await save(); assert.deepEqual(line(saved, 'legacy_line').actions, original); assert.equal(jump(saved, 'jump_zero').sceneTransition?.duration, 0); assert.equal(jump(saved, 'jump_zero').sceneTransition?.mode, 'none');
    return { hiddenCreationEntries: ['本行菜单', '批量演出', '文本命令补全'], preservedAction: original, deletedAndUndone: true };
  });

  await fs.copyFile(projectFile, path.join(output, 'saved-before-reopen.json')); await close(); await launch();
  await check('重开保留角色接线与合法数值、旧首项覆盖和附加蓝图停用', [1, 2, 7, 9, 10], async () => {
    const saved = await read(); let panel = await selectNode('actor_graph', 'dynamic_show');
    await expect(panel.getByLabel('表情', { exact: true })).toHaveValue('b_pose'); await expect(card('dynamic_show').getByLabel('动态显示检查 · 表情', { exact: true })).toHaveValue('b_pose');
    for (const name of ['左侧', '中间', '右侧']) await expect(panel.getByRole('button', { name, exact: true })).toBeDisabled();
    assert.equal(graphNode(saved, 'actor_graph', 'dynamic_show').properties.characterId, 'actor_a');
    for (const [id, value] of [['speed_node', 1000], ['delay_node', 60]] as const) { panel = await selectNode('preference_graph', id); await expect(panel.getByRole('spinbutton', { name: '设置值', exact: true })).toHaveValue(String(value)); }
    panel = await selectNode('position_graph', 'position_show'); await expect(panel.getByLabel('站位预设', { exact: true })).toHaveValue('left'); await expect(panel.getByRole('button', { name: '左侧', exact: true })).toBeEnabled();
    for (const [graph, id, scale, layer] of [['position_graph', 'position_show', 6, 150], ['actor_range_graph', 'small_actor', .01, -10], ['actor_range_graph', 'large_actor', 12, -5]] as const) {
      assert.equal(graphNode(saved, graph, id).properties.scale, scale); assert.equal(graphNode(saved, graph, id).properties.layer, layer);
    }
    panel = await selectCharacter('legacy_child'); await expect(panel.getByLabel('角色默认表情', { exact: true })).toHaveValue('parent_first');
    await expect(panel.getByRole('region', { name: '旧角色显示后蓝图', exact: true })).toContainText('这项额外蓝图已停用');
    assert.equal(character(saved, 'legacy_child').blueprintDisabled, true); return { persisted: true, authoringFallbacksNotRewritten: true };
  });

  await check('重开静音仍无打字音，恢复播放与恢复继承含义分开', [4], async () => {
    const editor = await soundEditor('audit_line', 1), mode = editor.getByLabel('打字音方式', { exact: true }); await expect(mode).toHaveValue('mute');
    assert.equal(soundSnapshot(await read(), 'audit_line').generated, undefined); await mode.selectOption('sound'); await expect(mode).toHaveValue('sound');
    await expect(editor.getByRole('combobox', { name: '打字音', exact: true })).toHaveValue('单句打字音');
    let saved = await save(); assert.equal(line(saved, 'audit_line').textPresentation?.typeSoundId, 'local_click'); assert.ok(soundSnapshot(saved, 'audit_line').generated);
    await mode.selectOption('inherit'); await expect(editor.getByRole('combobox', { name: '打字音', exact: true })).toHaveValue('角色打字音');
    saved = await save(); const restored = soundSnapshot(saved, 'audit_line');
    for (const key of ['typeSoundId', 'typeSoundEvery', 'typeSoundVolume'] as const) assert.equal(restored.own?.[key], undefined);
    assert.equal(restored.own?.presetId, 'sound_look'); assert.equal(restored.own?.cps, 15); assert.equal(restored.effective.typeSoundId, 'inherited_click'); assert.equal(restored.effective.typeSoundVolume, .45); assert.ok(restored.generated);
    const inherited = await soundEditor('inherited_sound_line', 2), inheritedMode = inherited.getByLabel('打字音方式', { exact: true }); await expect(inheritedMode).toHaveValue('mute');
    assert.equal(soundSnapshot(saved, 'inherited_sound_line').generated, undefined); await inheritedMode.selectOption('inherit'); await save(); await screenshot('14-type-sound-inheritance-restored');
    return { restored, audioDeviceNotTested: true };
  });

  await check('重开立即零秒后重新启用仍零秒，清除的跳转首次启用仍半秒', [5, 6], async () => {
    for (const id of ['image_line', 'video_line']) {
      const fields = await visualEditor(id, 'visual'), mode = fields.getByLabel('入场过渡', { exact: true }), seconds = fields.getByLabel('入场过渡秒数', { exact: true });
      await expect(mode).toHaveValue('none'); await expect(seconds).toHaveValue('0'); await expect(seconds).toBeDisabled(); await mode.selectOption('move'); await expect(seconds).toHaveValue('0');
      const current = visual(await save(), id); assert.deepEqual(current.visualTransitions?.enter, { mode: 'move', duration: 0 });
      for (const key of ['exit', 'replace'] as const) assert.deepEqual(current.visualTransitions?.[key], { mode: 'fade', duration: 0 });
    }
    const hide = await visualEditor('hide_line', 'hideVisual'); await expect(hide.getByLabel('离场过渡', { exact: true })).toHaveValue('none'); await hide.getByLabel('离场过渡', { exact: true }).selectOption('move'); await expect(hide.getByLabel('离场过渡秒数', { exact: true })).toHaveValue('0'); await save();
    let dialog = await openJump('jump_zero'); await expect(dialog.getByLabel('场景切换方式', { exact: true })).toHaveValue('none'); await dialog.getByLabel('场景切换方式', { exact: true }).selectOption('fade');
    await expect(dialog.getByLabel('场景转场总时长 秒', { exact: true })).toHaveValue('0'); assert.equal(jump(await saveJump(dialog), 'jump_zero').sceneTransition?.duration, 0);
    dialog = await openJump('jump_empty'); await expect(dialog.getByLabel('目标场景', { exact: true })).toHaveValue('scene_third'); await expect(dialog.getByLabel('场景切换方式', { exact: true })).toHaveValue('none');
    await dialog.getByLabel('场景切换方式', { exact: true }).selectOption('dissolve'); await expect(dialog.getByLabel('场景转场总时长 秒', { exact: true })).toHaveValue('0.5');
    assert.equal(jump(await saveJump(dialog), 'jump_empty').sceneTransition?.duration, .5); return { restoredVisualZero: true, restoredJumpZero: true, missingJumpFirstDuration: .5 };
  });

  await check('旧角色还原只清本地覆盖，默认表情和附加蓝图继续关联上级', [9, 10], async () => {
    const panel = await selectCharacter('legacy_child'); await panel.getByRole('button', { name: '还原默认表情：惊讶（沿用“旧关联上级”）', exact: true }).click();
    await expect(panel.getByLabel('角色默认表情', { exact: true })).toHaveValue('parent_second');
    await panel.getByRole('region', { name: '旧角色显示后蓝图', exact: true }).getByRole('button', { name: '还原本角色的蓝图设置', exact: true }).click();
    const saved = await save(), child = character(saved, 'legacy_child'); assert.equal(child.defaultExpressionId, undefined); assert.equal(child.blueprintDisabled, undefined); assert.equal(child.blueprintId, undefined); assert.equal(child.baseCharacterId, 'legacy_parent');
    assert.equal(effectiveCharacter(saved, child.id)?.defaultExpressionId, 'parent_second'); assert.equal(effectiveCharacter(saved, child.id)?.blueprintId, 'legacy_graph');
    assert.equal(character(saved, 'legacy_parent').defaultExpressionId, 'parent_second'); assert.equal(character(saved, 'legacy_parent').blueprintId, 'legacy_graph');
    await screenshot('15-legacy-inheritance-restored'); return { inheritedExpression: 'parent_second', inheritedBlueprint: 'legacy_graph', localOverridesRemoved: true };
  });

  await close(); await launch();
  await check('再次重开确认恢复继承与旧调用持久化，工程无新增错误', [4, 5, 6, 9, 10, 11, 12], async () => {
    const editor = await soundEditor('audit_line', 1); await expect(editor.getByLabel('打字音方式', { exact: true })).toHaveValue('inherit'); await expect(editor.getByRole('combobox', { name: '打字音', exact: true })).toHaveValue('角色打字音');
    const panel = await selectCharacter('legacy_child'); await expect(panel.getByLabel('角色默认表情', { exact: true })).toHaveValue('parent_second');
    await expect(panel.getByRole('region', { name: '旧角色显示后蓝图', exact: true })).toContainText('显示这个角色后还会执行“旧角色附加蓝图”');
    const saved = await save(); assert.equal(character(saved, 'legacy_child').blueprintDisabled, undefined); assert.equal(character(saved, 'legacy_child').defaultExpressionId, undefined);
    assert.ok(soundSnapshot(saved, 'audit_line').generated); assert.ok(soundSnapshot(saved, 'inherited_sound_line').generated);
    assert.deepEqual(line(saved, 'legacy_line').actions, [{ kind: 'characterFeature', characterId: 'legacy_child', featureId: 'legacy_feature' }]);
    assert.equal(jump(saved, 'jump_zero').sceneTransition?.duration, 0); assert.equal(jump(saved, 'jump_empty').sceneTransition?.duration, .5);
    for (const id of ['image_line', 'video_line']) assert.deepEqual(visual(saved, id).visualTransitions?.enter, { mode: 'move', duration: 0 });
    const diagnostics = validateProject(saved); assert.deepEqual(diagnostics.filter(issue => issue.severity === 'error'), []);
    await fs.copyFile(projectFile, path.join(output, 'saved-project.json')); return { diagnostics, persistentInheritanceVerified: true };
  });
  assert.deepEqual(pageErrors, []); report.status = 'passed';
} catch (error) {
  failure = error; report.status = 'failed'; report.phase = phase; report.error = String(error);
  if (app && page) await screenshot('acceptance-failure').catch(error => { report.screenshotError = String(error); });
} finally {
  await close().catch(error => { failure ??= error; report.status = 'failed'; report.closeError = String(error); });
  try {
    report.fingerprintsAfter = await fingerprints(); assert.deepEqual(report.fingerprintsAfter, report.fingerprintsBefore);
  } catch (error) { failure ??= error; report.status = 'failed'; report.buildIntegrityError = String(error); }
  try {
    const after = digest(await fs.readFile(authorFile)); report.authorSha256After = after;
    assert.equal(after, authorBefore, 'The author project changed during acceptance; this script never writes it.');
  } catch (error) { failure ??= error; report.status = 'failed'; report.authorIntegrityError = String(error); }
  await fs.mkdir(output, { recursive: true }); await writeReport();
  if (!app && processes.every(item => item.exited)) {
    try {
      const cleanup = await cleanVerificationDirectories(output, ['fixture', 'profile']); report.cleanup = cleanup;
      assert.deepEqual(cleanup.errors, []); await Promise.all(cleanup.removed.map(async file => { await assert.rejects(fs.stat(file), { code: 'ENOENT' }); }));
    } catch (error) { failure ??= error; report.status = 'failed'; report.cleanupError = String(error); }
  } else { failure ??= new Error('An owned acceptance process did not exit; its fixture/profile were retained.'); report.status = 'failed'; report.cleanupSkipped = 'Owned process still present'; }
  await writeReport(); console.log(output);
}
if (failure) throw failure;
