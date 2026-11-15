import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createProject, effectiveCharacter, projectSchema, type Project } from '../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph } from '../src/core/blueprint';
import { validateBlueprints } from '../src/core/blueprint-validation';
import { validPlayerPreference } from '../src/core/preferences';
import { effectiveTextStyle, textRuntimeLook } from '../src/core/text-presentation';
import { createVisualObject } from '../src/core/visual-object';
import { projectToText } from '../src/core/text-script';
import { validateProject } from '../src/core/validate';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { fitBlueprintCanvas } from './lib/blueprint-canvas';
import { openStoryMode } from './lib/story-workspace';
import { openDisclosureAncestors } from './lib/ui-disclosures';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

// A diagnostic snapshot of existing defects, NOT a product acceptance test.
// Assertions describe the observed faulty behavior; fixes should replace this
// historical probe with regression coverage of the intended behavior.
if (process.env.VNS_INSTALLED_EXE) throw new Error('Use the already-built source editor for this isolated review.');
const root = path.resolve('.');
const output = path.resolve('artifacts/authoring-code-review-2026-11-11', 'diagnostic-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const projectFile = path.join(output, 'fixture/project.vns.json'), profile = path.join(output, 'profile');
const authorFile = path.resolve('../我的视觉小说1/project.vns.json');
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const project = createProject('编辑一致性只读审查隔离工程');
project.id = 'authoring_code_review_20261111';
project.assets = [
  { id: 'portrait', kind: 'image', name: '审查图片', path: 'portrait.svg', width: 180, height: 300 },
  { id: 'inherited_click', kind: 'audio', category: 'sound', name: '角色打字音', path: 'inherited.wav' },
  { id: 'local_click', kind: 'audio', category: 'sound', name: '单句打字音', path: 'local.wav' },
];
project.characters = [
  { id: 'actor_a', name: '角色甲', color: '#ffffff', expressions: [{ id: 'a_pose', name: '甲的表情', assetId: 'portrait' }], textPresentation: { typeSoundId: 'inherited_click' } },
  { id: 'actor_b', name: '角色乙', color: '#ffffff', expressions: [{ id: 'b_pose', name: '乙的表情', assetId: 'portrait' }] },
  { id: 'legacy_parent', name: '旧关联上级', color: '#ffffff', expressions: [{ id: 'parent_first', name: '正面', assetId: 'portrait' }, { id: 'parent_second', name: '惊讶', assetId: 'portrait' }], defaultExpressionId: 'parent_second' },
  { id: 'legacy_child', name: '旧关联下级', color: '#ffffff', expressions: [], baseCharacterId: 'legacy_parent' },
];
const preferences = createBlueprintGraph('effect', '玩家数值审查'); preferences.id = 'preference_graph';
const speed = blueprintNodeDefaults('setPlayerPreference'); Object.assign(speed, { id: 'speed_node', name: '文字速度检查', x: 350, y: 0 }); speed.properties = { preference: 'textSpeed', value: 1000 };
const delay = blueprintNodeDefaults('setPlayerPreference'); Object.assign(delay, { id: 'delay_node', name: '自动间隔检查', x: 700, y: 0 }); delay.properties = { preference: 'autoForwardTime', value: 60 };
preferences.nodes.push(speed, delay);
assert.equal(connectBlueprintPins(preferences, preferences.nodes[0].id, 'exec', speed.id, 'exec_in'), undefined);
assert.equal(connectBlueprintPins(preferences, speed.id, 'exec_out', delay.id, 'exec_in'), undefined);
const actors = createBlueprintGraph('effect', '动态角色审查'); actors.id = 'actor_graph';
const show = blueprintNodeDefaults('showCharacter'); Object.assign(show, { id: 'dynamic_show', name: '动态显示检查', x: 370, y: 0 }); show.properties.characterId = 'actor_a';
const actorValue = blueprintNodeDefaults('literal'); Object.assign(actorValue, { id: 'actor_value', name: '实际角色乙', x: 0, y: 220 }); actorValue.properties.value = 'actor_b'; actorValue.pins[0].dataType = 'character';
const presetValue = blueprintNodeDefaults('literal'); Object.assign(presetValue, { id: 'preset_value', name: '实际中间站位', x: 0, y: 390 }); presetValue.properties.value = 'center';
actors.nodes.push(show, actorValue, presetValue);
assert.equal(connectBlueprintPins(actors, actors.nodes[0].id, 'exec', show.id, 'exec_in'), undefined);
assert.equal(connectBlueprintPins(actors, actorValue.id, 'value', show.id, 'characterId'), undefined);
assert.equal(connectBlueprintPins(actors, presetValue.id, 'value', show.id, 'presetId'), undefined);
project.blueprints = [preferences, actors];
const passage = project.nodes.find(node => node.kind === 'passage')!;
const image = createVisualObject('image', 'portrait'); image.visualTransitions = { enter: { mode: 'dissolve', duration: 0 } };
passage.lines = [{ id: 'audit_line', speakerId: 'actor_a', text: '这一句检查打字音与图片过渡。', actions: [image], textPresentation: { typeSoundId: 'local_click', speed: 'cps', cps: 15 } }];
project.scriptText = { format: 'vns-text-1', content: projectToText(project) };
project.ui.customPages = [{ id: 'audit_page', name: '审查用自定义页面', modal: true, components: [
  { id: 'ui_a', name: '文字甲', kind: 'text', page: 'custom', text: '甲的设计文字', x: .1, y: .15, width: .3, height: .15, style: { opacity: .2 } },
  { id: 'ui_b', name: '文字乙', kind: 'text', page: 'custom', text: '乙的设计文字', x: .5, y: .15, width: .3, height: .15, style: { opacity: .8 } },
] }];
let app: ElectronApplication | undefined, page: Page | undefined, failure: unknown, phase = 'prepare', authorBefore: string | undefined;
const cases: { name: string; evidence: unknown }[] = [], pageErrors: string[] = [];
const report: Record<string, unknown> = { purpose: 'Reproduce defects without changing product source or the author project', status: 'running', cases, pageErrors, temporaryPaths: [path.dirname(projectFile), profile] };
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const line = (p: Project) => { const node = p.nodes.find(node => node.id === passage.id); assert.ok(node?.kind === 'passage'); return node.lines[0]; };
const graphNode = (p: Project, graph: string, node: string) => p.blueprints.find(item => item.id === graph)!.nodes.find(item => item.id === node)!;
const settle = async () => page!.evaluate(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
const screenshot = async (name: string) => {
  const bytes = await app!.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  await fs.writeFile(path.join(output, name + '.png'), Buffer.from(bytes, 'base64'));
};
const save = async () => { await page!.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page!.locator('.dirty-dot')).toHaveCount(0); return read(); };
const saveUi = async () => {
  await page!.getByRole('button', { name: '保存界面', exact: true }).click();
  await expect(page!.locator('.ui-save-status')).toHaveText('已保存'); return read();
};
const check = async (name: string, work: () => Promise<unknown>) => {
  phase = name; const evidence = await work(); cases.push({ name, evidence });
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log('复现：' + name);
};
const selectNode = async (graph: string, node: string) => {
  await page!.locator('[data-workspace-tab="blueprint"]').click(); await page!.getByLabel('蓝图资源', { exact: true }).selectOption('graph:' + graph);
  await fitBlueprintCanvas(page!); await page!.locator(`.react-flow__node[data-id="${node}"] .graph-node-title strong`).click();
  return page!.getByRole('complementary', { name: '蓝图属性', exact: true });
};
const property = () => page!.locator('.ui-inspector-view:not([hidden]) .field[data-ui-property="text"]');
const controlDialog = () => page!.getByRole('dialog', { name: '属性控制设置', exact: true });
const openControl = async () => {
  const content = page!.locator('.ui-inspector-view:not([hidden]) [data-ui-inspector-group="content"]');
  await openDisclosureAncestors(content); if (await content.getAttribute('open') === null) await content.locator(':scope > summary').click();
  await openDisclosureAncestors(property()); await property().locator('.field-label').click({ button: 'right' });
  await page!.getByRole('menu', { name: '属性控制菜单', exact: true }).getByRole('menuitem', { name: '关联参数…', exact: true }).click();
  await expect(controlDialog()).toBeVisible();
};
async function fingerprints() {
  const html = await fs.readFile('dist/index.html', 'utf8');
  const files = ['dist/index.html', 'dist-desktop/main.cjs', 'dist-desktop/preload.cjs',
    ...[...html.matchAll(/(?:src|href)="(\.\/assets\/[^"?#]+\.(?:js|css))"/g)].map(match => 'dist/' + match[1].slice(2)),
    'src/renderer/BlueprintGraphEditor.tsx', 'src/renderer/BlueprintNodeFields.tsx', 'src/renderer/NumberInput.tsx', 'src/renderer/VisualTransitionsEditor.tsx',
    'src/renderer/TextPresentationEditor.tsx', 'src/renderer/UiMultiInspector.tsx', 'src/renderer/UiPropertyControl.tsx', 'src/renderer/App.tsx'];
  return Promise.all([...new Set(files)].map(async file => ({ file, sha256: hash(await fs.readFile(file)) })));
}
try {
  await fs.mkdir(path.dirname(projectFile), { recursive: true }); authorBefore = hash(await fs.readFile(authorFile)); report.authorSha256Before = authorBefore;
  report.fingerprintsBefore = await fingerprints();
  await fs.writeFile(path.join(path.dirname(projectFile), 'portrait.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="300"><rect width="180" height="300" fill="#c06070"/></svg>');
  // Valid silent WAVs: this review checks source selection/serialization, not hearing or device output.
  const wav = Buffer.alloc(44 + 1600); wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(1600, 40);
  for (const file of ['inherited.wav', 'local.wav']) await fs.writeFile(path.join(path.dirname(projectFile), file), wav);
  assert.deepEqual(validateProject(projectSchema.parse(project)).filter(issue => issue.severity === 'error'), []);
  await saveProject(projectFile, project); await fs.copyFile(projectFile, path.join(output, 'input-project.json'));
  app = await launchDesktopFixture({ root, projectFile, profile }); page = await app.firstWindow(); page.setDefaultTimeout(12000); report.pid = app.process().pid;
  page.on('pageerror', error => pageErrors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; if (window.isMaximized()) window.unmaximize(); window.setContentSize(1600, 1000); });
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await page.context().tracing.start({ screenshots: true, snapshots: true, sources: false });

  await check('蓝图右栏仅聚焦再失焦就改小合法玩家数值', async () => {
    const observed = [];
    for (const [node, preference, before, after] of [['speed_node', 'textSpeed', 1000, 200], ['delay_node', 'autoForwardTime', 60, 30]] as const) {
      assert.equal(validPlayerPreference(preference, before), true);
      const panel = await selectNode('preference_graph', node), field = panel.getByRole('spinbutton', { name: '设置值', exact: true });
      await expect(field).toHaveValue(String(before)); await field.focus(); await field.press('Tab'); await expect(field).toHaveValue(String(after));
      const saved = await save(); assert.equal(graphNode(saved, 'preference_graph', node).properties.value, after);
      observed.push({ preference, before, after, typedNothing: true, savedValue: after });
    }
    await screenshot('01-preference-clamp'); return observed;
  });
  await check('动态角色右栏提供旧角色表情并允许保存', async () => {
    const panel = await selectNode('actor_graph', 'dynamic_show'), expression = panel.getByRole('combobox', { name: '表情', exact: true });
    const options = await expression.locator('option').evaluateAll(items => items.map(item => ({ value: (item as HTMLOptionElement).value, label: item.textContent })));
    assert.ok(options.some(item => item.value === 'a_pose')); assert.ok(!options.some(item => item.value === 'b_pose'));
    await expression.selectOption('a_pose'); const saved = await save(), actual = graphNode(saved, 'actor_graph', 'dynamic_show');
    assert.equal(actual.properties.characterId, 'actor_a'); assert.equal(actual.properties.expressionId, 'a_pose');
    assert.equal(graphNode(saved, 'actor_graph', 'actor_value').properties.value, 'actor_b');
    const diagnostics = validateBlueprints(saved); assert.ok(!diagnostics.some(issue => issue.message.includes('表情')));
    await screenshot('02-dynamic-expression'); return { options, storedCharacter: actual.properties.characterId, linkedCharacter: 'actor_b', savedExpression: actual.properties.expressionId, diagnostics, nativeGameNotExecuted: true };
  });
  await check('站位预设已接线仍可点击快捷站位写入隐藏覆盖', async () => {
    const panel = page!.getByRole('complementary', { name: '蓝图属性', exact: true }), left = panel.getByRole('button', { name: '左侧', exact: true });
    await expect(left).toBeEnabled(); await left.click(); const saved = await save();
    const graph = saved.blueprints.find(item => item.id === 'actor_graph')!, node = graphNode(saved, graph.id, 'dynamic_show');
    assert.equal(node.properties.presetId, 'left'); assert.ok(graph.links.some(link => link.toNodeId === node.id && link.toPinId === 'presetId'));
    assert.equal(graphNode(saved, graph.id, 'preset_value').properties.value, 'center');
    return { clicked: 'left', storedOverride: node.properties.presetId, connectedPresetStill: 'center', nativeGameNotExecuted: true };
  });
  await check('图片过渡切换方式把显式零秒改为半秒', async () => {
    await openStoryMode(page!, 'script'); const row = page!.locator('#line-audit_line'); await row.locator('textarea').click(); await row.locator('.line-effect-chip[data-action-kind="visual"]').click();
    const fields = row.getByRole('region', { name: '演出对象属性', exact: true }), seconds = fields.getByRole('spinbutton', { name: '入场过渡秒数', exact: true });
    await expect(seconds).toHaveValue('0'); await fields.getByRole('combobox', { name: '入场过渡', exact: true }).selectOption('move'); await expect(seconds).toHaveValue('0.5');
    const saved = await save(), action = line(saved).actions[0]; assert.ok(action.kind === 'visual'); assert.deepEqual(action.visualTransitions!.enter, { mode: 'move', duration: .5 });
    await screenshot('03-zero-transition'); await row.locator('.line-effect-chip[data-action-kind="visual"]').click(); return { before: { mode: 'dissolve', duration: 0 }, saved: action.visualTransitions!.enter };
  });
  await check('无打字音清除本句声音后重新沿用角色声音', async () => {
    const row = page!.locator('#line-audit_line'); await row.getByRole('button', { name: '展开第1行台词文字演出', exact: true }).click();
    const editor = row.getByRole('region', { name: '第1行台词文字演出', exact: true }); await editor.getByRole('tab', { name: '打字音', exact: true }).click();
    const sound = editor.getByRole('combobox', { name: '打字音', exact: true }); await expect(sound).toHaveValue('单句打字音'); await sound.click();
    await page!.getByRole('listbox', { name: '打字音搜索结果', exact: true }).getByRole('option', { name: '无打字音', exact: true }).click();
    await expect(sound).toHaveValue('角色打字音'); const saved = await save(), savedLine = line(saved), style = effectiveTextStyle(saved, savedLine), runtime = textRuntimeLook(saved, style, savedLine.text);
    assert.equal(savedLine.textPresentation?.typeSoundId, undefined); assert.equal(style.typeSoundId, 'inherited_click'); assert.ok(runtime?.typeSound);
    await screenshot('04-no-sound-inherits');
    const volume = editor.getByRole('spinbutton', { name: '音量 %', exact: true }); await volume.fill('0'); await volume.press('Tab');
    const muted = await save(); assert.equal(textRuntimeLook(muted, effectiveTextStyle(muted, line(muted)), line(muted).text)?.typeSound, undefined);
    return { selectedLabel: '无打字音', savedLocalSound: null, effectiveSound: style.typeSoundId, generatedRuntimeSound: runtime!.typeSound, volumeZeroWorkaroundVerified: true, audioDeviceNotTested: true };
  });
  await check('混合数值拖动按Esc留下待应用零值', async () => {
    await page!.locator('[data-workspace-tab="ui"]').click(); await page!.getByLabel('设计页面', { exact: true }).selectOption('audit_page');
    await page!.locator('[data-hierarchy-id="ui_a"] .ui-hierarchy-caption').click(); await page!.locator('[data-hierarchy-id="ui_b"] .ui-hierarchy-caption').click({ modifiers: ['Control'] });
    const shell = page!.getByLabel('共同属性编辑', { exact: true }), field = shell.locator('[data-ui-multi-field="opacity"]'), input = shell.getByRole('spinbutton', { name: '共同不透明度 %', exact: true });
    await openDisclosureAncestors(input); await expect(input).toHaveValue(''); await expect(field).not.toHaveAttribute('data-pending', 'true');
    const label = field.locator('.field-label'); await label.scrollIntoViewIfNeeded(); const box = await label.boundingBox(); assert.ok(box);
    await page!.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page!.mouse.down(); await page!.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2, { steps: 6 });
    await page!.keyboard.press('Escape'); await page!.mouse.up(); await expect(input).toHaveValue('0'); await expect(field).toHaveAttribute('data-pending', 'true');
    await screenshot('05-escape-pending-zero'); await shell.getByRole('button', { name: '应用到 2 个控件', exact: true }).click();
    const saved = await saveUi(), values = saved.ui.customPages.find(item => item.id === 'audit_page')!.components.map(item => item.style!.opacity);
    assert.deepEqual(values, [0, 0]); return { initial: [.2, .8], fieldBefore: '', afterEscape: 0, pendingAfterEscape: true, savedAfterExplicitApply: values, notAppliedUntilButtonClicked: true };
  });
  await check('草稿新参数的查看来源按钮静默留在界面', async () => {
    await page!.locator('[data-hierarchy-id="ui_a"] .ui-hierarchy-caption').click(); await openControl();
    await controlDialog().getByRole('button', { name: '新建参数并关联', exact: true }).click(); await controlDialog().getByLabel('新参数名称', { exact: true }).fill('审查草稿文字参数');
    await controlDialog().getByLabel('新参数初始值', { exact: true }).fill('草稿参数文字'); await controlDialog().getByRole('button', { name: '应用设置', exact: true }).click();
    await expect(controlDialog()).toHaveCount(0); await expect(page!.getByRole('button', { name: '保存界面', exact: true })).toBeEnabled();
    assert.ok(!(await read()).variables.some(item => item.name === '审查草稿文字参数'));
    await openControl(); const source = await controlDialog().getByLabel('来源参数', { exact: true }).inputValue(); assert.ok(source);
    await controlDialog().getByRole('button', { name: '查看来源参数', exact: true }).click(); await settle();
    await expect(controlDialog()).toHaveCount(0); await expect(page!.locator('.ui-canvas')).toBeVisible(); await expect(page!.getByRole('dialog')).toHaveCount(0);
    await screenshot('06-draft-navigation-no-op'); const saved = await saveUi(); assert.ok(saved.variables.some(item => item.id === source));
    await openControl(); await controlDialog().getByRole('button', { name: '查看来源参数', exact: true }).click(); await expect(page!.locator('.ui-canvas')).toHaveCount(0);
    return { draftSource: source, beforeSave: 'dialog closed, stayed in UI, no save prompt', afterSave: 'left UI for parameter', parameterPersisted: true };
  });
  await check('旧关联默认表情显示与有效值不一致', async () => {
    await page!.locator('[data-workspace-tab="characters"]').click(); await page!.locator('.character-item[data-character-id="legacy_child"]').click();
    await page!.getByRole('tab', { name: '外观与表情', exact: true }).click();
    const field = page!.getByRole('combobox', { name: '角色默认表情', exact: true }); await expect(field).toHaveValue(''); await expect(field.locator('option:checked')).toHaveText('使用第一个表情');
    const effective = effectiveCharacter(await read(), 'legacy_child')!; assert.equal(effective.defaultExpressionId, 'parent_second'); assert.equal(effective.expressions[0].id, 'parent_first');
    const deleted = await read(); deleted.characters = deleted.characters.filter(item => item.id !== 'legacy_parent');
    const missing = validateProject(deleted).filter(item => item.severity === 'error' && item.message.includes('继承的基础角色不存在')); assert.ok(missing.length);
    await screenshot('07-legacy-expression'); return { displayed: '使用第一个表情', firstExpression: effective.expressions[0].id, effectiveDefault: effective.defaultExpressionId, deletionPureFunctionDiagnostics: missing };
  });
  await fs.copyFile(projectFile, path.join(output, 'saved-project.json'));
  report.fingerprintsAfter = await fingerprints(); assert.deepEqual(report.fingerprintsAfter, report.fingerprintsBefore); assert.deepEqual(pageErrors, []);
  report.status = 'diagnosis-complete';
} catch (error) {
  failure = error; report.status = 'diagnostic-incomplete'; report.phase = phase; report.error = String(error);
  if (app && page) await screenshot('diagnostic-failure').catch(() => undefined);
} finally {
  if (page) await page.context().tracing.stop({ path: path.join(output, 'trace.zip') }).catch(error => { report.traceError = String(error); });
  if (app) { const child = app.process(); await app.close(); report.processExited = child.exitCode !== null || child.signalCode !== null; }
  const after = hash(await fs.readFile(authorFile)); report.authorSha256After = after;
  if (authorBefore !== after) { failure ??= new Error('The author project changed during the review; it was not written by this probe.'); report.status = 'diagnostic-incomplete'; }
  await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  if (!app || report.processExited) report.cleanup = await cleanVerificationDirectories(output, ['fixture', 'profile']);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(output);
}
if (failure) throw failure;
