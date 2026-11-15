import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { createProject, projectSchema, type Project } from '../src/core/model';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { storyMenuEntries } from '../src/core/story-menu';
import { storyFlowOwner } from '../src/core/story-flow-authoring';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openDisclosureAncestors } from './lib/ui-disclosures';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

// Run only after the complete implementation and unified build. This script
// never compiles, starts Vite, opens the author's project, or launches a game.
if (process.env.VNS_INSTALLED_EXE) throw new Error('Use the isolated compiled source editor.');
const root = path.resolve('.');
const output = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? 'artifacts/player-flow-inspector-2026-11-11',
  'editor-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const relativeOutput = path.relative(root, output);
assert.ok(relativeOutput && !path.isAbsolute(relativeOutput) && relativeOutput !== '..' && !relativeOutput.startsWith('..' + path.sep),
  'Acceptance output must remain inside this checkout.');
const fixtureDirectory = path.join(output, 'fixture'), profile = path.join(output, 'profile');
const projectFile = path.join(fixtureDirectory, 'project.vns.json');
const sourceFile = path.resolve(process.env.VNS_AUTHOR_PROJECT ?? '../我的视觉小说1/project.vns.json');
const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const ids = { map: 'flow_inspector_map', alternate: 'flow_inspector_alternate', decoration: 'flow_inspector_decoration', preset: 'flow_inspector_shared', unused: 'flow_inspector_unused',
  parameterMap: 'flow_inspector_parameter_map', parameterParent: 'flow_inspector_parameter_parent', nestedMap: 'flow_inspector_nested_map',
  opacityParameter: 'flow_inspector_alpha', widthParameter: 'flow_inspector_width', heightParameter: 'flow_inspector_height' };

function fixture() {
  const parsed = applyTextScript(createProject('玩家剧情图属性对象验收'), [
    '#章节：第一章', '#小章节(流程图=是)：第一小节', '旁白：起点',
    '#段落(流程图=是)：分支甲', '旁白：分支内容',
    '#章节：第二章', '旁白：第二章正文', '#章节：第三章', '旁白：第三章正文',
    '#章节：第四章', '旁白：第四章正文',
  ].join('\n'));
  assert.deepEqual(parsed.issues, []);
  const project = parsed.project; project.id = 'flow_inspector_acceptance'; project.width = 1920; project.height = 1080;
  project.resourceSettings = { importMode: 'copy', directory: 'assets', syncFolders: false };
  project.variables.push(
    { id: ids.opacityParameter, name: '验收整图不透明度', type: 'number', initial: .4, persistent: false },
    { id: ids.widthParameter, name: '验收目录宽度', type: 'number', initial: .65, persistent: false },
    { id: ids.heightParameter, name: '验收目录高度', type: 'number', initial: .75, persistent: false },
  );
  project.ui.pages = { ...project.ui.pages, flowchart: { layout: 'custom' } };
  project.ui.components = [{ id: ids.map, name: '玩家剧情图', text: '', kind: 'flowchart', page: 'flowchart',
    x: .02, y: .05, width: .96, height: .9,
    list: { layout: 'flow', columns: 2, rows: 3, itemWidth: 350, itemHeight: 100, gapX: 95, gapY: 85,
      lockUnread: true, flowLockedCaption: '尚未到达', flowLineStyle: 'curve' },
    style: { fontSize: 40, textColor: '#dce7db', background: '#32434d', opacity: .62, borderWidth: 2,
      borderColor: '#82a1ae', radius: 8, outlineWidth: 1, outlineColor: '#17242d',
      shadowX: 0, shadowY: 0, shadowColor: '#000000', shadowBlur: 10, shadowSpread: 3, shadowOpacity: .7,
      captionParts: [{ fontSize: 18, color: '#e3ab64', gap: 11 }, {}] } },
    { id: ids.decoration, kind: 'text', page: 'flowchart', name: '装饰文字', text: '剧情图验收', x: .02, y: 0, width: .3, height: .04 },
    { id: ids.alternate, name: '另一张剧情图', text: '', kind: 'flowchart', page: 'flowchart', x: .75, y: 0, width: .22, height: .04,
      list: { layout: 'grid', columns: 2, rows: 3 }, style: { fontSize: 30, background: '#493d50' } },
    // Kept out of the ordinary canvas until the independent resolved-preview
    // group reveals them through the real hierarchy. Authored values differ
    // from parameter initials so a raw-component sample cannot pass by chance.
    { id: ids.parameterMap, name: '单向参数图', text: '', kind: 'flowchart', page: 'flowchart', x: .03, y: .12, width: .35, height: .7,
      editor: { hidden: true }, propertyControls: { opacity: { mode: 'follow', parameterId: ids.opacityParameter } },
      list: { layout: 'flow', itemWidth: 350, itemHeight: 100 }, style: { opacity: .9, fontSize: 40, background: '#385949' } },
    { id: ids.parameterParent, name: '半透明父对象', text: '', kind: 'panel', page: 'flowchart', x: .45, y: .1, width: .5, height: .65,
      editor: { hidden: true }, style: { opacity: .5 } },
    { id: ids.nestedMap, name: '父级参数目录', text: '', kind: 'flowchart', page: 'flowchart', parentId: ids.parameterParent,
      x: 0, y: 0, width: .9, height: .3,
      propertyControls: { opacity: { mode: 'follow', parameterId: ids.opacityParameter }, width: { mode: 'follow', parameterId: ids.widthParameter }, height: { mode: 'follow', parameterId: ids.heightParameter } },
      list: { layout: 'grid', columns: 2, rows: 3, gapX: 12, gapY: 12 }, style: { opacity: .9, fontSize: 40, background: '#65485d' } },
  ];
  project.ui.flowStyles = [{ id: ids.preset, name: '主线框', style: { fontSize: 60, textColor: '#eef0f4', background: '#29424e',
    borderWidth: 3, borderColor: '#77c0dc', radius: 9, outlineWidth: 1, outlineColor: '#000000',
    shadowX: 0, shadowY: 0, shadowColor: '#000000', shadowBlur: 14, shadowSpread: 4, shadowOpacity: .9,
    captionParts: [{ fontSize: 24, color: '#e3ab64', gap: 13 }, { fontSize: 60 }] } },
    { id: ids.unused, name: '尚未分配的外观', style: { fontSize: 48, background: '#4a3159', borderWidth: 2 } }];
  const scene = project.scenes.find(item => item.name === '第一小节')!;
  assert.ok(scene); scene.flowchart = { ...scene.flowchart, visible: true, name: '记 第一回｜醉梦', styleId: ids.preset };
  // The chapter shares the scene's entry and is overridden by the more specific
  // scene. It still counts as a preset reference and must survive copy/restore.
  project.chapters[0].flowchart = { ...project.chapters[0].flowchart, styleId: ids.preset };
  project.chapters.find(item => item.name === '第三章')!.flowchart = { styleId: ids.preset };
  project.scriptText!.content = projectToText(project);
  return projectSchema.parse(project);
}
const initial = fixture(), entries = storyMenuEntries(initial, 'flowchart');
const first = entries.find(entry => entry.owner?.kind === 'scene' && entry.name === '记 第一回 醉梦')!;
const second = entries.find(entry => entry.name === '分支甲')!;
const last = entries.at(-1)!;
const sharedVisibleIds = entries.filter(entry => entry.styleId === ids.preset).map(entry => entry.id).sort();
assert.ok(first && second && last); assert.equal(sharedVisibleIds.length, 2); assert.equal(entries.length, 5);

let app: ElectronApplication | undefined, page: Page | undefined, failure: unknown, phase = '准备';
let sourceHash: string | undefined, savedBytes = '', traceRunning = false, launchNumber = 0;
const checks: { name: string; durationMs: number }[] = [], errors: string[] = [], traces: string[] = [];
const processes: { pid?: number; exited: boolean; forced?: boolean }[] = [];
const evidence: Record<string, unknown> = {};
const report: Record<string, unknown> = { status: 'running', renderer: 'compiled', checks, errors, traces, processes, evidence,
  sourceFile, temporaryPaths: [fixtureDirectory, profile],
  limits: ['所有剧情与控件均为自建 fixture；真实工程仅读取 SHA256。',
    '检查桌面编辑、实际节点绘制、保存与重开；原生游戏由独立运行时验收负责。',
    '保存结果通过磁盘重新解析核对；运行中的工程修改只经可见编辑器操作。'] };
const button = (name: string) => page!.getByRole('button', { name, exact: true });
const inspector = () => page!.locator('.ui-inspector[data-ui-flow-view]');
const view = () => inspector().locator('.ui-inspector-view:not([hidden])');
const flow = () => view().locator('.ui-player-flow-inspector');
const field = (name: string) => view().getByLabel(name, { exact: true });
const search = () => inspector().getByRole('searchbox', { name: '搜索控件属性', exact: true });
const group = (id: string) => view().locator(`[data-ui-inspector-group="${id}"]`);
const canvas = () => page!.locator(`[data-component-id="${ids.map}"]`);
const node = (id: string) => canvas().locator(`[data-flow-node="${id}"]`);
const scroll = () => inspector().locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " inspector-scroll ")][1]');
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const mapIn = (project: Project) => project.ui.components.find(component => component.id === ids.map)!;
const presetIn = (project: Project) => project.ui.flowStyles!.find(preset => preset.id === ids.preset)!;
const settle = () => page!.evaluate('async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); }');
async function writeReport() { await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); }
async function fingerprints() {
  const html = await fs.readFile(path.join(root, 'dist/index.html'), 'utf8');
  const files = ['dist/index.html', 'dist-desktop/main.cjs', 'dist-desktop/preload.cjs',
    ...[...html.matchAll(/(?:src|href)="(\.\/assets\/[^"?#]+\.(?:js|css))"/g)].map(match => 'dist/' + match[1].slice(2))];
  assert.ok(files.some(file => file.startsWith('dist/assets/') && file.endsWith('.js')), 'Compiled renderer assets must exist.');
  return Promise.all([...new Set(files)].map(async file => ({ file, sha256: sha256(await fs.readFile(path.join(root, file))) })));
}
async function size(width: number, height: number) {
  await app!.evaluate(({ BrowserWindow }, dimensions) => {
    const window = BrowserWindow.getAllWindows()[0]; if (window.isMinimized()) window.restore(); if (window.isMaximized()) window.unmaximize();
    window.setContentSize(dimensions.width, dimensions.height); window.webContents.setBackgroundThrottling(false);
  }, { width, height });
  await expect.poll(() => page!.evaluate(requested => Math.max(Math.abs(innerWidth - requested.width), Math.abs(innerHeight - requested.height)), { width, height })).toBeLessThanOrEqual(1);
  await settle();
}
async function launch() {
  app = await launchDesktopFixture({ root, projectFile, profile, devUrl: '' }); launchNumber++;
  processes.push({ pid: app.process().pid, exited: false }); page = await app.firstWindow(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(initial.name, { timeout: 45000 });
  assert.equal(path.resolve(fileURLToPath(page.url())), path.join(root, 'dist/index.html')); report.rendererUrl = page.url();
  await page.evaluate('globalThis.__name = value => value');
  await page.context().tracing.start({ screenshots: true, snapshots: true, sources: false }); traceRunning = true;
  await size(1600, 1000); await page.locator('[data-workspace-tab="ui"]').click();
  await page.getByLabel('界面编辑模式', { exact: true }).getByRole('button', { name: '设计', exact: true }).click();
  await page.getByLabel('设计页面', { exact: true }).selectOption('flowchart');
  await page.getByLabel('画面缩放比例', { exact: true }).selectOption('50');
  await page.locator(`[data-hierarchy-id="${ids.map}"] .ui-hierarchy-caption`).click();
  await scope('map'); await settle();
}
async function close() {
  if (!app) return;
  const owned = app, child = owned.process(), exited = () => child.exitCode !== null || child.signalCode !== null;
  const record = processes.find(item => item.pid === child.pid)!; let closeError: unknown;
  if (traceRunning && page) {
    const name = `trace-${launchNumber}.zip`;
    try { await page.context().tracing.stop({ path: path.join(output, name) }); traces.push(name); }
    catch (error) { closeError = error; }
    traceRunning = false;
  }
  try { await owned.close(); await expect.poll(exited, { timeout: 15000 }).toBe(true); }
  catch (error) { closeError ??= error; if (!exited()) { record.forced = true; child.kill(); } await expect.poll(exited, { timeout: 15000 }).toBe(true); }
  finally { record.exited = exited(); if (record.exited) { app = undefined; page = undefined; } }
  if (closeError) throw closeError;
}
async function screenshot(name: string) {
  await settle();
  const data = await app!.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  await fs.writeFile(path.join(output, name + '.png'), Buffer.from(data, 'base64'));
}
async function check(name: string, work: () => Promise<void>) {
  phase = name; const started = Date.now(); await work(); checks.push({ name, durationMs: Date.now() - started }); await writeReport(); console.log('通过：' + name);
}
async function scope(expected: 'map' | 'node' | 'base' | 'preset' | 'sources') {
  await expect(inspector()).toHaveAttribute('data-ui-flow-view', expected);
  await expect(flow()).toHaveAttribute('data-flow-inspector-target', expected); await expect(flow()).toBeVisible();
}
async function reveal(target: Locator) { await openDisclosureAncestors(target); await expect(target).toBeVisible(); }
async function openGroup(id: string) { await reveal(group(id).locator(':scope > summary')); }
async function clearSearch() { if (await search().inputValue()) await inspector().getByRole('button', { name: '清除属性搜索', exact: true }).click(); }
async function map() {
  if (await inspector().getAttribute('data-ui-flow-view') !== 'map') await inspector().locator('.ui-inspector-header').getByRole('button', { name: '返回整张图设置', exact: true }).click();
  await scope('map');
}
async function selectNode(id: string) {
  await map(); await clearSearch(); await openGroup('flow-content');
  await field('查找剧情图节点').fill(''); await field('选择剧情图节点').selectOption(id); await scope('node');
  await expect(flow()).toHaveAttribute('data-flow-editing-node', id);
}
async function editPreset() {
  await flow().getByRole('button', { name: '编辑这个外观预设', exact: true }).click(); await scope('preset');
  await expect(field('编辑节点外观预设')).toHaveValue(ids.preset);
}
async function editBase(referenceId?: string) {
  await map(); await clearSearch(); await openGroup('flow-style');
  await flow().getByRole('button', { name: /^本图基础外观/ }).click(); await scope('base');
  if (referenceId) await field('外观参考节点').selectOption(referenceId);
}
async function save() {
  await expect(button('保存界面')).toBeEnabled(); await button('保存界面').click();
  await expect(page!.locator('.ui-save-status')).toHaveAttribute('data-dirty', 'false', { timeout: 30000 });
  await expect(button('保存界面')).toBeDisabled(); savedBytes = await fs.readFile(projectFile, 'utf8'); return read();
}
async function unchanged() { await expect(button('保存界面')).toBeDisabled(); assert.equal(await fs.readFile(projectFile, 'utf8'), savedBytes); }
async function preview() {
  const dialog = page!.getByRole('dialog', { name: '剧情图预览', exact: true });
  if (!await dialog.isVisible()) await button('剧情图预览').click();
  await expect(dialog).toBeVisible(); return dialog;
}
async function visual(state: string) {
  const dialog = await preview(); await dialog.getByLabel('预览视觉状态', { exact: true }).selectOption(state);
  await dialog.getByRole('button', { name: '关闭剧情图预览', exact: true }).click(); await settle();
}
async function affected() { return canvas().locator('[data-flow-affected]').evaluateAll(elements => elements.map(element => element.getAttribute('data-flow-node')!).sort()); }
async function sampleMetrics(componentId: string, nodeId = first.id) {
  const sample = flow().locator('.flow-node-sample'); await expect(sample).toHaveCount(1); await settle();
  const inspectorMetrics = await sample.evaluate(element => {
    const surface = element.firstElementChild!, preview = element.closest('.flow-actual-preview')!;
    return { opacity: Number(getComputedStyle(surface).opacity), shellOpacity: Number(getComputedStyle(element).opacity),
      previewOpacity: Number(getComputedStyle(preview).opacity), headingOpacity: [...preview.querySelectorAll('.flow-preview-heading')].map(heading => Number(getComputedStyle(heading).opacity)),
      width: Number(element.getAttribute('data-flow-sample-width')), height: Number(element.getAttribute('data-flow-sample-height')) };
  });
  const canvasMetrics = await page!.locator(`[data-component-id="${componentId}"] [data-flow-node="${nodeId}"]`).evaluate((element, projectWidth) => {
    const component = element.closest('[data-component-id]')!, stage = element.closest('.ui-canvas')!;
    const mapOpacity = Number(getComputedStyle(component).opacity), nodeOpacity = Number(getComputedStyle(element).opacity);
    const scale = parseFloat(getComputedStyle(stage).width) / projectWidth;
    return { mapOpacity, nodeOpacity, opacity: mapOpacity * nodeOpacity, scale,
      width: parseFloat(getComputedStyle(element).width) / scale, height: parseFloat(getComputedStyle(element).height) / scale,
      mapWidth: parseFloat(getComputedStyle(component).width) / scale, mapHeight: parseFloat(getComputedStyle(component).height) / scale };
  }, initial.width);
  return { sample: inspectorMetrics, canvas: canvasMetrics };
}
async function expectSampleOpacity(componentId: string, expected: number, expectedMapOpacity: number, expectedNodeOpacity: number) {
  await expect.poll(async () => (await sampleMetrics(componentId)).sample.opacity).toBeCloseTo(expected, 5);
  const metrics = await sampleMetrics(componentId);
  assert.ok(Math.abs(metrics.canvas.opacity - expected) < .00001, 'Sample and actual canvas must have the same effective opacity.');
  assert.ok(Math.abs(metrics.canvas.mapOpacity - expectedMapOpacity) < .00001);
  assert.ok(Math.abs(metrics.canvas.nodeOpacity - expectedNodeOpacity) < .00001);
  assert.equal(metrics.sample.shellOpacity, 1, 'Whole-map opacity belongs only to the rendered sample surface.');
  assert.equal(metrics.sample.previewOpacity, 1); assert.deepEqual(metrics.sample.headingOpacity, [1, 1], 'Preview title and location controls must remain fully opaque.');
  return metrics;
}
async function captionLetterSpacing(componentId: string, nodeId: string) {
  await settle();
  const sample = flow().locator('.flow-node-sample'), sampleParts = sample.locator('[data-flow-caption] > span > [data-flow-part]');
  const sampleScale = await sample.evaluate(element => parseFloat(getComputedStyle(element.firstElementChild!).width) / Number(element.getAttribute('data-flow-sample-width')));
  const actual = page!.locator(`[data-component-id="${componentId}"] [data-flow-node="${nodeId}"]`);
  const actualParts = actual.locator('[data-flow-caption] > span > [data-flow-part]');
  const logicalWidth = mapIn(initial).list?.itemWidth ?? 350;
  const canvasScale = await actual.evaluate((element, width) => parseFloat(getComputedStyle(element).width) / width, logicalWidth);
  const readParts = async (target: Locator, scale: number) => target.evaluateAll((elements, scale) => elements.map(element => {
    const style = getComputedStyle(element), css = style.letterSpacing;
    return {
      text: element.textContent, css,
      spacing: css === 'normal' ? 0 : Number((parseFloat(css) / scale).toFixed(4)),
      gap: Number((parseFloat(style.marginRight) / scale).toFixed(4)),
    };
  }), scale);
  return { sample: await readParts(sampleParts, sampleScale), canvas: await readParts(actualParts, canvasScale), sampleScale, canvasScale };
}
async function expectCaptionSpacing(componentId: string, nodeId: string, expected: number[]) {
  await expect.poll(async () => (await captionLetterSpacing(componentId, nodeId)).sample.map(part => part.spacing)).toEqual(expected);
  const result = await captionLetterSpacing(componentId, nodeId);
  assert.deepEqual(result.canvas.map(part => part.text), result.sample.map(part => part.text));
  assert.equal(result.sample.length, expected.length); assert.equal(result.canvas.length, expected.length);
  for (const [index, value] of expected.entries()) {
    assert.ok(Math.abs(result.sample[index].spacing - value) < .01, `Sample caption ${index} should use ${value}px letter spacing.`);
    assert.ok(Math.abs(result.canvas[index].spacing - value) < .01, `Canvas caption ${index} should use ${value}px letter spacing.`);
    assert.ok(Math.abs(result.sample[index].spacing - result.canvas[index].spacing) < .01, `Sample and canvas caption ${index} spacing must match.`);
  }
  return result;
}
function flowFieldSource(input: Locator) { return input.locator('xpath=ancestor::div[contains(@class, "flow-style-field")][1]'); }
async function theme(name: '黑白' | '亮白', id: 'codexDark' | 'codexLight') {
  await button('作品设置').click(); const dialog = page!.getByRole('dialog', { name: '作品设置', exact: true });
  await dialog.getByRole('button', { name: '编辑器外观', exact: true }).click();
  await dialog.getByRole('group', { name: '编辑器配色', exact: true }).getByRole('button', { name: new RegExp('^' + name) }).click();
  await expect(page!.locator('html')).toHaveAttribute('data-editor-theme', id); await dialog.getByRole('button', { name: '完成', exact: true }).click(); await settle();
}

try {
  await fs.mkdir(output, { recursive: true }); sourceHash = sha256(await fs.readFile(sourceFile)); report.sourceSha256Before = sourceHash;
  report.buildBefore = await fingerprints();
  await saveProject(projectFile, initial); savedBytes = await fs.readFile(projectFile, 'utf8');
  evidence.fixtureSha256Before = sha256(savedBytes); await launch();

  await check('点真实画布节点进入专属视图，整图字段保持隐藏且节点文本、来源与范围可辨', async () => {
    await expect(view().locator('[data-ui-inspector-region="common"]')).toBeVisible();
    await expect(field('流程图排列')).toHaveValue('flow'); await node(first.id).click(); await scope('node');
    await expect(field('节点文字第 1 段')).toHaveValue('记 第一回'); await expect(field('节点文字第 2 段')).toHaveValue('醉梦');
    await expect(field('当前节点文字')).toContainText('第一章 / 第一小节');
    await expect(field('当前节点文字')).toContainText('文字同步到其他“跟随剧本”的剧情图');
    await expect(inspector().locator('.ui-inspector-breadcrumb')).toContainText('记 第一回 醉梦');
    await expect(view().locator('[data-ui-inspector-region="common"]')).toHaveCount(0);
    await expect(view().locator('[data-ui-inspector-group="flow-layout"]')).toHaveCount(0);
    await expect(view().getByLabel('控件不透明度 %', { exact: true })).toHaveCount(0);
    await expect(flow()).toContainText('被 3 处剧情引用'); await unchanged(); await screenshot('01-node-scope');
  });

  await check('整图搜索、折叠和滚动在节点往返后保留，预设Esc返回节点再返回整张图', async () => {
    await map(); await openGroup('flow-layout'); await search().fill('节点');
    await scroll().evaluate(element => { element.scrollTop = Math.min(180, element.scrollHeight - element.clientHeight); }); await settle();
    const savedScroll = await scroll().evaluate(element => element.scrollTop); assert.ok(savedScroll > 0, 'Fixture must exercise a genuinely scrolled map inspector.');
    await node(first.id).click(); await scope('node'); await expect(search()).toHaveValue('');
    await editPreset(); await expect(flow().locator('[data-flow-preview-reference]')).toHaveAttribute('data-flow-preview-reference', first.id);
    await page!.getByLabel('界面设计画布', { exact: true }).focus(); await page!.keyboard.press('Escape'); await scope('node');
    await expect(field('节点文字第 2 段')).toHaveValue('醉梦'); await map(); await expect(search()).toHaveValue('节点');
    await expect(group('flow-layout')).toHaveJSProperty('open', true);
    await expect.poll(async () => Math.abs(await scroll().evaluate(element => element.scrollTop) - savedScroll)).toBeLessThanOrEqual(2);
    evidence.mapContext = { search: '节点', scrollTop: savedScroll }; await unchanged(); await clearSearch();
  });

  await check('复制预设并用于此节点为一次完整撤销，复制内容、分配、隐藏引用及重做一致', async () => {
    await selectNode(first.id); const before = await read();
    await flow().getByRole('button', { name: '复制预设并用于此节点', exact: true }).click(); await scope('preset');
    const copiedId = await field('编辑节点外观预设').inputValue(); assert.ok(copiedId && copiedId !== ids.preset);
    await inspector().locator('.ui-inspector-header').getByRole('button', { name: '返回当前节点内容', exact: true }).click(); await scope('node');
    await expect(field('当前节点外观预设')).toHaveValue(copiedId);
    await flow().getByRole('button', { name: '编辑这个外观预设', exact: true }).click(); await scope('preset');
    await button('撤销').click();
    // Saving accepts the UI draft and clears its undo stack. Exercise atomic
    // undo/redo before save, then independently inspect the persisted copy.
    await scope('map'); await unchanged();
    await button('重做').click(); await selectNode(first.id); await expect(field('当前节点外观预设')).toHaveValue(copiedId);
    await flow().getByRole('button', { name: '编辑这个外观预设', exact: true }).click(); await scope('preset');
    const copied = await save(), copy = copied.ui.flowStyles!.find(preset => preset.id === copiedId)!;
    assert.equal(copied.ui.flowStyles!.length, before.ui.flowStyles!.length + 1);
    assert.deepEqual(copy.style, presetIn(before).style); assert.deepEqual(copy.skin, presetIn(before).skin);
    assert.equal(storyFlowOwner(copied, first.owner)?.flowchart?.styleId, copiedId);
    assert.equal(copied.chapters[0].flowchart?.styleId, ids.preset, 'The overridden chapter reference must not be reassigned.');
    assert.deepEqual(presetIn(copied), presetIn(before));
    await selectNode(first.id); await field('当前节点外观预设').selectOption(ids.preset); await editPreset();
    await field('编辑节点外观预设').selectOption(copiedId); await openGroup('flow-preset-manage');
    await expect(flow().getByRole('button', { name: '删除预设', exact: true })).toBeEnabled();
    await flow().getByRole('button', { name: '删除预设', exact: true }).click();
    const restored = await save(); assert.deepEqual(restored, before, 'Visible reassignment and deletion must cleanly restore the fixture after the persisted-copy check.');
    // Unlike the deleted-copy case, undoing an assignment leaves the preset
    // itself alive. Its reference must move to one of its remaining real users.
    await selectNode(second.id); await field('当前节点外观预设').selectOption(ids.preset); await editPreset();
    await expect(flow().locator('[data-flow-preview-reference]')).toHaveAttribute('data-flow-preview-reference', second.id);
    await button('撤销').click(); await scope('preset');
    await expect(flow().locator('[data-flow-preview-reference]')).toHaveAttribute('data-flow-preview-reference', first.id);
    await expect(field('外观参考节点')).toHaveValue(first.id); await unchanged();
    evidence.atomicCopy = { copiedId, copiedName: copy.name, originalReferences: 3, copiedReferences: 1, undoAssignmentReference: first.id };
  });

  await check('真实两段文字直接选择并调整各自字号，末段没有无效段后间距，画布同步', async () => {
    await selectNode(first.id); await flow().getByRole('button', { name: '调整文字第 1 段外观', exact: true }).click(); await scope('preset');
    await expect(flow().getByRole('tab', { name: '记 第一回', exact: true })).toHaveAttribute('aria-selected', 'true');
    await field('预设第 1 段字号').fill('31'); await expect(field('预设第 1 段后面间距')).toHaveValue('13');
    await flow().getByRole('tab', { name: '醉梦', exact: true }).click(); await field('预设第 2 段字号').fill('67');
    await expect(view().getByLabel('预设第 2 段后面间距', { exact: true })).toHaveCount(0);
    const sizes = await node(first.id).locator('[data-flow-caption] > span:not([aria-hidden]) [data-flow-part]').evaluateAll(elements => elements.map(element => ({ text: element.textContent, size: parseFloat(getComputedStyle(element).fontSize) })));
    assert.deepEqual(sizes.map(item => item.text), ['记 第一回', '醉梦']);
    assert.ok(Math.abs(sizes[0].size / sizes[1].size - 31 / 67) < .001, 'The actual canvas must retain both authored size proportions.');
    const saved = await save(); assert.equal(presetIn(saved).style?.captionParts?.[0].fontSize, 31); assert.equal(presetIn(saved).style?.captionParts?.[1].fontSize, 67);
    assert.equal(storyFlowOwner(saved, first.owner)?.flowchart?.name, '记 第一回｜醉梦');
    evidence.actualTextSizes = sizes; await screenshot('02-real-caption-parts');
  });

  await check('柔边黑底使用厚度、柔和度和实际不透明度，实际节点黑底可见且分段外观保留', async () => {
    await expect(field('预设文字黑底方式')).toHaveValue('soft');
    await field('预设黑底厚度').fill('6'); await field('预设黑底柔和度').fill('20'); await field('预设黑底不透明度').fill('80');
    await expect(node(first.id).locator('[data-flow-caption-shadow]')).toHaveCSS('opacity', '0.8');
    const shadow = await node(first.id).locator('[data-flow-caption-shadow]').evaluate(element => ({ opacity: getComputedStyle(element).opacity,
      stroke: getComputedStyle(element).webkitTextStrokeWidth, filter: getComputedStyle(element).filter, text: element.textContent }));
    assert.ok(parseFloat(shadow.stroke) > 0 && shadow.filter.includes('blur('));
    const saved = await save(), style = presetIn(saved).style!;
    assert.equal(style.shadowSpread, 6); assert.equal(style.shadowBlur, 20); assert.equal(style.shadowOpacity, .8); assert.equal(style.shadowColor, '#000000');
    assert.deepEqual(style.captionParts?.map(part => part.fontSize), [31, 67]); evidence.blackBackdrop = shadow; await screenshot('03-soft-black-backdrop');
  });

  await check('按当前字段高亮真正受影响的节点，引用计数包含同入口被覆盖的剧情', async () => {
    await openGroup('flow-preset-frame'); await field('预设边框宽度').focus();
    await expect(flow().locator('[data-flow-property-impact]')).toContainText('当前图有 2 个节点受影响');
    await expect.poll(affected).toEqual(sharedVisibleIds);
    await expect(flow().locator('[data-flow-property-impact]')).toHaveAttribute('data-flow-reference-affected', 'true');
    await openGroup('flow-preset-manage'); await expect(group('flow-preset-manage')).toContainText('3 处剧情引用');
    await openGroup('flow-preset-usages'); await expect(group('flow-preset-usages')).toContainText('第一章 / 第一小节');
    await expect(group('flow-preset-usages')).toContainText('包含隐藏和同入口被覆盖的剧情');
    evidence.presetImpact = { visibleAffectedIds: await affected(), totalReferences: 3 }; await unchanged(); await screenshot('04-preset-impact');
  });

  await check('基础外观保留真实参考节点并解释预设覆盖，只高亮基础字号能影响的节点', async () => {
    await editBase(first.id); await openGroup('flow-base-base-text'); await field('基础字号').focus();
    await expect(flow().locator('[data-flow-preview-reference]')).toHaveAttribute('data-flow-preview-reference', first.id);
    await expect(flow().locator('[data-flow-property-impact]')).toHaveAttribute('data-flow-reference-affected', 'false');
    await expect(flow().locator('[data-flow-property-impact]')).toContainText('主线框');
    await expect(flow().locator('[data-flow-property-impact]')).toContainText('单独设置');
    const expected = entries.filter(entry => entry.styleId !== ids.preset).map(entry => entry.id).sort();
    await expect.poll(affected).toEqual(expected);
    const sharedBefore = await node(first.id).locator('[data-flow-part="1"]').evaluate(element => getComputedStyle(element).fontSize);
    const before = await read(); await field('基础字号').fill('46'); const saved = await save();
    assert.equal(mapIn(saved).style?.fontSize, 46); assert.deepEqual(saved.ui.flowStyles, before.ui.flowStyles);
    assert.equal(await node(first.id).locator('[data-flow-part="1"]').evaluate(element => getComputedStyle(element).fontSize), sharedBefore);
    evidence.baseImpact = { affectedIds: await affected(), referenceId: first.id, coveredSecondPartSize: sharedBefore };
    await screenshot('05-base-overridden-reference');
  });

  await check('右键只恢复所选段字号；整套基础外观恢复保留整图不透明度且可撤销', async () => {
    await map(); await selectNode(first.id); await editPreset();
    await flow().getByRole('tab', { name: '记 第一回', exact: true }).click(); const before = await read();
    const input = field('预设第 1 段字号'), beforeRightClick = await input.boundingBox();
    assert.ok(beforeRightClick); await expect(input).not.toBeFocused(); await input.click({ button: 'right' });
    const menu = page!.getByRole('menu', { name: '参数操作', exact: true });
    await expect(menu).toContainText('此预设分段样式');
    const afterRightClick = await input.boundingBox(); assert.ok(afterRightClick);
    assert.ok(Math.abs(afterRightClick.y - beforeRightClick.y) <= .5, 'First-focus property help must not move the input during a right-click.');
    evidence.firstFocusRightClick = { before: beforeRightClick, after: afterRightClick, menuOpened: true };
    await menu.getByRole('menuitem', { name: '沿用整组基础字号', exact: true }).click(); await expect(field('预设第 1 段字号')).toHaveValue('60');
    await button('撤销').click(); await expect(field('预设第 1 段字号')).toHaveValue('31'); await unchanged();
    await button('重做').click(); const reset = await save();
    const expected = JSON.parse(JSON.stringify(presetIn(before))) as ReturnType<typeof presetIn>;
    delete expected.style!.captionParts![0].fontSize;
    assert.deepEqual(presetIn(reset), expected, 'Restoring one caption size must preserve colors, spacing, black backdrop, frame and all other slots.');
    assert.deepEqual(mapIn(reset), mapIn(before)); await field('预设第 1 段字号').fill('31'); assert.deepEqual(await save(), before);
    await editBase(first.id); const beforeAll = await read(); await flow().getByRole('button', { name: '恢复全部节点外观', exact: true }).click();
    await expect(field('基础文字黑底方式')).toHaveValue('none');
    await button('撤销').click(); await expect(field('基础文字黑底方式')).toHaveValue('soft'); await unchanged();
    await button('重做').click();
    const cleared = await save(); assert.deepEqual(mapIn(cleared).style, { opacity: .62 });
    assert.deepEqual(mapIn(cleared).list, mapIn(beforeAll).list); assert.deepEqual(cleared.ui.flowStyles, beforeAll.ui.flowStyles);
    evidence.preciseRestore = { restoredProperty: 'captionParts[0].fontSize', retainedMapOpacity: .62 };
  });

  await check('搜索字体仅展开文字相关组，节点底图、边框和黑底组保持隐藏，清除恢复折叠偏好', async () => {
    await editBase(first.id); await clearSearch();
    const imageGroup = group('flow-base-skin'), shadowGroup = group('flow-base-text-effects'), frameGroup = group('flow-base-frame');
    const preferredShadowOpen = await shadowGroup.getAttribute('open') !== null;
    await search().fill('字体');
    await expect(group('flow-base-caption-parts')).toBeVisible(); await expect(group('flow-base-base-text')).toBeVisible();
    await expect(group('flow-base-base-text')).toHaveJSProperty('open', true);
    for (const target of [imageGroup, shadowGroup, frameGroup]) await expect(target).toBeHidden();
    await screenshot('06-font-search'); await clearSearch();
    await expect(shadowGroup).toHaveJSProperty('open', preferredShadowOpen); await unchanged();
  });

  await check('五种视觉状态和玩家进度共用实际节点预览，仅改临时会话并在跨页后重置', async () => {
    await selectNode(first.id); await editPreset(); await openGroup('flow-preset-frame'); await field('预设边框宽度').focus();
    for (const state of ['idle', 'hover', 'pressed', 'disabled', 'selected']) {
      await visual(state); await expect(node(first.id)).toHaveAttribute('data-flow-forced-state', state);
      await expect(flow().locator('.flow-node-sample')).toHaveAttribute('data-flow-sample-state', state);
      await unchanged();
    }
    const unreachedReference = entries.find(entry => entry.styleId === ids.preset && entry.id !== first.id)!;
    await field('外观参考节点').selectOption(unreachedReference.id); await visual('auto');
    let dialog = await preview(); await dialog.getByLabel('预览玩家进度', { exact: true }).selectOption('partial');
    await dialog.getByLabel('预览当前节点', { exact: true }).selectOption(first.id);
    await dialog.getByRole('button', { name: '关闭剧情图预览', exact: true }).click();
    await expect(node(unreachedReference.id)).toHaveAttribute('data-flow-state', 'disabled');
    await expect(flow().locator('.flow-node-sample')).toHaveAttribute('data-flow-sample-state', 'disabled');
    dialog = await preview(); await dialog.getByLabel('预览玩家进度', { exact: true }).selectOption('current');
    await dialog.getByLabel('预览当前节点', { exact: true }).selectOption(unreachedReference.id);
    await dialog.getByRole('button', { name: '关闭剧情图预览', exact: true }).click();
    await expect(node(unreachedReference.id)).toHaveAttribute('data-flow-state', 'selected');
    await expect(flow().locator('.flow-node-sample')).toHaveAttribute('data-flow-sample-state', 'selected');
    await expect(flow().locator('.flow-node-sample')).toHaveAttribute('data-flow-sample-current', '');
    await field('编辑节点外观预设').selectOption(ids.unused);
    await expect(flow().locator('[data-flow-preview-reference]')).toHaveAttribute('data-flow-preview-reference', 'unapplied');
    await openGroup('flow-preset-frame'); await field('预设边框宽度').focus();
    for (const state of ['pressed', 'selected', 'disabled']) {
      await visual(state); await expect(canvas().locator('[data-flow-forced-state]')).toHaveCount(0);
      await expect(canvas().locator('[data-flow-affected]')).toHaveCount(0);
      await expect(node(unreachedReference.id)).toHaveAttribute('data-flow-state', 'selected');
      await expect(flow().locator('.flow-node-sample')).toHaveAttribute('data-flow-sample-state', state); await unchanged();
    }
    await page!.locator(`[data-hierarchy-id="${ids.alternate}"] .ui-hierarchy-caption`).click();
    const other = await preview(); await expect(other.getByLabel('预览视觉状态', { exact: true })).toHaveValue('auto');
    await expect(other.getByLabel('预览玩家进度', { exact: true })).toHaveValue('all');
    await other.getByRole('button', { name: '关闭剧情图预览', exact: true }).click();
    await page!.getByLabel('设计页面', { exact: true }).selectOption('main');
    await page!.getByLabel('设计页面', { exact: true }).selectOption('flowchart');
    await page!.locator(`[data-hierarchy-id="${ids.map}"] .ui-hierarchy-caption`).click(); await scope('map');
    await expect(canvas().locator('[data-flow-forced-state]')).toHaveCount(0); await expect(canvas().locator('[data-flow-affected]')).toHaveCount(0);
    const returned = await preview(); await expect(returned.getByLabel('预览视觉状态', { exact: true })).toHaveValue('auto');
    await expect(returned.getByLabel('预览玩家进度', { exact: true })).toHaveValue('all');
    await returned.getByRole('button', { name: '关闭剧情图预览', exact: true }).click(); await unchanged();
    evidence.previewStates = { fixed: ['idle', 'hover', 'pressed', 'disabled', 'selected'], automatic: ['disabled', 'selected'], unusedPresetForcesNoCanvasNode: true }; await screenshot('07-natural-preview-returned');
  });

  await check('实际样例叠加整图、预设、单向参数和父级不透明度，目录尺寸使用画布已解析宽高', async () => {
    const before = await read(), samples: Record<string, unknown> = {};
    await selectNode(first.id); await editPreset();
    samples.map62Preset100 = await expectSampleOpacity(ids.map, .62, .62, 1);
    await openGroup('flow-preset-frame');
    const presetOpacity = () => view().locator('[data-flow-field="节点不透明度 %"]').getByRole('spinbutton');
    await presetOpacity().fill('50');
    samples.map62Preset50 = await expectSampleOpacity(ids.map, .31, .62, .5);
    await map(); await clearSearch(); await openGroup('visibility'); await field('控件不透明度 %').fill('0');
    await selectNode(first.id); await editPreset();
    samples.map0Preset50 = await expectSampleOpacity(ids.map, 0, 0, .5);
    await map(); await openGroup('visibility'); await field('控件不透明度 %').fill('62');

    await button('在画布显示 单向参数图').click();
    await page!.locator(`[data-hierarchy-id="${ids.parameterMap}"] .ui-hierarchy-caption`).click(); await scope('map');
    const controlledMap = page!.locator(`[data-component-id="${ids.parameterMap}"]`);
    await controlledMap.locator(`[data-flow-node="${first.id}"]`).click(); await scope('node');
    samples.parameter40Preset50 = await expectSampleOpacity(ids.parameterMap, .2, .4, .5);

    await button('在画布显示 半透明父对象').click();
    await page!.locator(`[data-hierarchy-id="${ids.nestedMap}"] .ui-hierarchy-caption`).click(); await scope('map');
    const nestedMap = page!.locator(`[data-component-id="${ids.nestedMap}"]`);
    await nestedMap.locator(`[data-flow-node="${first.id}"]`).click(); await scope('node');
    const nested = await expectSampleOpacity(ids.nestedMap, .1, .2, .5);
    // Derive the cell from the actual resolved canvas rectangle. Parent
    // containers can reduce the child's layout basis through their content box.
    const columns = 2, rows = 3, gapY = 12;
    const gapX = Math.min(12, Math.max(0, Math.floor(nested.canvas.mapWidth / (columns * 2))));
    const navHeight = Math.min(40, Math.max(24, Math.floor(nested.canvas.mapHeight * .1)));
    const viewHeight = Math.max(1, nested.canvas.mapHeight - navHeight - gapY);
    const expectedCellWidth = Math.max(1, Math.min(Math.floor(nested.canvas.mapWidth), Math.floor((nested.canvas.mapWidth - (columns - 1) * gapX) / columns)));
    const expectedCellHeight = Math.max(1, Math.floor((Math.max(32, Math.floor((viewHeight - (rows - 1) * gapY) / rows))) + .5));
    evidence.resolvedSample = { opacity: samples, nested, directoryExpected: { logicalMapWidth: nested.canvas.mapWidth, logicalMapHeight: nested.canvas.mapHeight, cellWidth: expectedCellWidth, cellHeight: expectedCellHeight } };
    assert.notEqual(nested.canvas.mapWidth, .9 * initial.width, 'Resolved width must use its follow parameter, not the authored component width.');
    assert.notEqual(nested.canvas.mapHeight, .3 * initial.height, 'Resolved height must use its follow parameter and parent content box.');
    assert.equal(nested.sample.width, expectedCellWidth); assert.equal(nested.sample.height, expectedCellHeight);
    assert.ok(Math.abs(nested.canvas.width - nested.sample.width) < .1, 'Directory sample width must equal the actual canvas logical cell width.');
    assert.ok(Math.abs(nested.canvas.height - nested.sample.height) < .1, 'Directory sample height must equal the actual canvas logical cell height.');
    samples.parent50Parameter40Preset50 = nested;
    await screenshot('07b-resolved-opacity-and-directory');

    await button('在画布隐藏 单向参数图').click(); await button('在画布隐藏 半透明父对象').click();
    await page!.locator(`[data-hierarchy-id="${ids.map}"] .ui-hierarchy-caption`).click(); await scope('map');
    await selectNode(first.id); await editPreset(); await openGroup('flow-preset-frame');
    await presetOpacity().click({ button: 'right' });
    await page!.getByRole('menu', { name: '参数操作', exact: true }).getByRole('menuitem', { name: '恢复节点不透明度 100%', exact: true }).click();
    await expectSampleOpacity(ids.map, .62, .62, 1);
    const restored = await button('保存界面').isEnabled() ? await save() : await read();
    assert.deepEqual(restored, before, 'Opacity and visibility probes must restore the complete authored fixture without replacing stored values with resolved parameters.');
    assert.equal(restored.ui.components.find(component => component.id === ids.parameterMap)!.style?.opacity, .9);
    const nestedSource = restored.ui.components.find(component => component.id === ids.nestedMap)!;
    assert.equal(nestedSource.width, .9); assert.equal(nestedSource.height, .3); assert.equal(nestedSource.style?.opacity, .9);
    evidence.resolvedSample = { samples, nested, directoryExpected: { logicalMapWidth: nested.canvas.mapWidth, logicalMapHeight: nested.canvas.mapHeight, cellWidth: expectedCellWidth, cellHeight: expectedCellHeight }, authoredFixtureRestored: true };
    await unchanged();
  });

  await check('基础、预设与分段字间距支持正负和零，重置可撤销且样例与画布一致', async () => {
    const before = await read(), baseChecks: unknown[] = [];
    await editBase(last.id); await openGroup('flow-base-base-text');
    const baseSpacing = field('基础字间距');
    let baseCss: unknown;
    for (const [value, expected] of [['2.5', 2.5], ['-1.25', -1.25], ['0', 0]] as const) {
      await baseSpacing.fill(value); await expect(baseSpacing).toHaveValue(value);
      baseCss = await expectCaptionSpacing(ids.map, last.id, [expected]); baseChecks.push({ value: expected, css: baseCss });
    }
    await baseSpacing.click({ button: 'right' });
    const baseMenu = page!.getByRole('menu', { name: '参数操作', exact: true });
    await expect(baseMenu).toContainText('恢复默认字间距：0 px');
    await baseMenu.getByRole('menuitem', { name: '恢复默认字间距：0 px', exact: true }).click();
    await button('撤销').click(); await expect(baseSpacing).toHaveValue('0');
    await expect(flowFieldSource(baseSpacing)).toHaveAttribute('data-flow-field-source', '本图基础字间距');
    await expectCaptionSpacing(ids.map, last.id, [0]);
    await baseSpacing.fill('1.75'); await expectCaptionSpacing(ids.map, last.id, [1.75]);

    await selectNode(first.id); await editPreset(); await openGroup('flow-preset-base-text');
    const presetSpacing = field('预设字间距');
    await presetSpacing.fill('-1.25'); await expect(presetSpacing).toHaveValue('-1.25');
    const negativePreset = await expectCaptionSpacing(ids.map, first.id, [-1.25, -1.25]);
    await presetSpacing.fill('0'); await expectCaptionSpacing(ids.map, first.id, [0, 0]);
    await presetSpacing.click({ button: 'right' });
    const presetMenu = page!.getByRole('menu', { name: '参数操作', exact: true });
    await expect(presetMenu).toContainText('恢复本图基础字间距');
    await presetMenu.getByRole('menuitem', { name: '恢复本图基础字间距', exact: true }).click();
    await expect(presetSpacing).toHaveValue('1.75'); await expect(flowFieldSource(presetSpacing)).toHaveAttribute('data-flow-field-source', '沿用本图基础字间距：1.75 px');
    await button('撤销').click(); await expect(presetSpacing).toHaveValue('0');
    await expect(flowFieldSource(presetSpacing)).toHaveAttribute('data-flow-field-source', '此预设字间距单独设置');
    await presetSpacing.fill('2.25'); await expectCaptionSpacing(ids.map, first.id, [2.25, 2.25]);

    await flow().getByRole('tab', { name: '记 第一回', exact: true }).click();
    const partSpacing = field('预设第 1 段字间距');
    await partSpacing.fill('0'); await expect(partSpacing).toHaveValue('0');
    const explicitZero = await expectCaptionSpacing(ids.map, first.id, [0, 2.25]);
    assert.equal(explicitZero.sample[0].gap, 13); assert.equal(explicitZero.canvas[0].gap, 13);
    await partSpacing.click({ button: 'right' });
    const partMenu = page!.getByRole('menu', { name: '参数操作', exact: true });
    await expect(partMenu).toContainText('沿用整组基础字间距');
    await partMenu.getByRole('menuitem', { name: '沿用整组基础字间距', exact: true }).click();
    await expectCaptionSpacing(ids.map, first.id, [2.25, 2.25]);
    await button('撤销').click(); await expect(partSpacing).toHaveValue('0');
    const restoredZero = await expectCaptionSpacing(ids.map, first.id, [0, 2.25]);
    assert.equal(restoredZero.sample[0].gap, 13); assert.equal(restoredZero.canvas[0].gap, 13);

    const saved = await save(), baseStyle = mapIn(saved).style!, presetStyle = presetIn(saved).style!;
    assert.equal(baseStyle.letterSpacing, 1.75); assert.equal(presetStyle.letterSpacing, 2.25);
    assert.equal(presetStyle.captionParts?.[0].letterSpacing, 0, 'Explicit part zero must remain distinct from inheritance.');
    assert.equal(presetStyle.captionParts?.[1].letterSpacing, undefined, 'Unspecified part spacing must continue to inherit the preset-wide value.');
    assert.equal(presetStyle.captionParts?.[0].gap, 13); assert.equal(presetStyle.captionParts?.[1].gap, undefined);
    assert.deepEqual(presetStyle.captionParts?.map(part => part.fontSize), [31, 67]);
    evidence.letterSpacing = { base: { positiveNegativeZero: baseChecks, resetUndo: true, saved: baseStyle.letterSpacing },
      preset: { negative: negativePreset, explicitZero: explicitZero, inheritedAfterPartOverrideReset: restoredZero, saved: presetStyle.letterSpacing },
      savedCaptionParts: presetStyle.captionParts?.map(part => ({ letterSpacing: part.letterSpacing, gap: part.gap })) };
    await screenshot('07c-letter-spacing');
  });

  await check('分支图和目录列表往返保留行列、节点尺寸与连线，目录选节点可自动翻页', async () => {
    await map(); await clearSearch(); await reveal(field('流程图排列')); await field('流程图排列').selectOption('grid');
    await openGroup('flow-layout'); await expect(field('每行数量')).toHaveValue('2'); await expect(field('每页行数（0 为滚动）')).toHaveValue('3');
    await field('每行数量').fill('1'); await field('每页行数（0 为滚动）').fill('1');
    await selectNode(last.id); await expect(node(last.id)).toHaveCount(1);
    await expect(canvas().locator('[data-flow-pagination]')).toContainText(`${entries.length} / ${entries.length}`);
    await canvas().getByRole('button', { name: '剧情目录上一页', exact: true }).click(); await expect(node(last.id)).toHaveCount(0);
    await selectNode(first.id); await expect(node(first.id)).toHaveCount(1);
    await map(); await openGroup('flow-layout'); await field('每行数量').fill('2'); await field('每页行数（0 为滚动）').fill('3');
    await field('流程图排列').selectOption('flow'); await expect(field('连线样式')).toHaveValue('curve');
    await expect(field('节点宽度')).toHaveValue('350'); await expect(field('节点高度')).toHaveValue('100');
    await expect(view().getByLabel('每行数量', { exact: true })).toHaveCount(0);
    // The round-trip returns to the saved layout, so it may already be clean.
    if (await button('保存界面').isEnabled()) await save();
    const saved = await read(); assert.equal(mapIn(saved).list?.layout, 'flow'); assert.equal(mapIn(saved).list?.columns, 2);
    assert.equal(mapIn(saved).list?.rows, 3); assert.equal(mapIn(saved).list?.flowLineStyle, 'curve'); await screenshot('08-directory-and-branch');
  });

  await check('剧情来源为工程作用域，隐藏同入口小节切换章节展示，一次撤销恢复文字和预设', async () => {
    await map(); await clearSearch(); await openGroup('flow-mode');
    await group('flow-mode').getByRole('button', { name: /^管理显示的剧情/ }).click(); await scope('sources');
    await expect(flow()).toContainText('同步到本工程中使用“跟随剧本”的剧情图'); await expect(flow()).toContainText('自定义图分别保留自己的内容'); await expect(flow()).toContainText('同一入口显示：第一章 / 第一小节');
    const before = await read(); await field('显示小章节：第一小节').uncheck();
    await expect(node(first.id)).toHaveText(/第一章/); await expect(field('显示小章节：第一小节')).not.toBeChecked();
    await button('撤销').click(); await scope('sources'); await expect(node(first.id).locator('[data-flow-part="1"]')).toHaveText('醉梦');
    await unchanged(); assert.deepEqual(await read(), before);
    await expect(field('显示小章节：第一小节')).toBeChecked(); await screenshot('09-sources-scope');
  });

  await check('1024像素窄窗及明暗主题中节点、基础和预设面板无横向溢出，控件保持可见', async () => {
    const layouts: unknown[] = [];
    for (const [name, id] of [['黑白', 'codexDark'], ['亮白', 'codexLight']] as const) {
      await theme(name, id); await size(1024, 768);
      for (const target of ['node', 'preset', 'base'] as const) {
        await selectNode(first.id);
        if (target === 'preset') await editPreset();
        if (target === 'base') await editBase(first.id);
        await clearSearch();
        const dimensions = await flow().evaluate(element => {
          const host = element.getBoundingClientRect();
          return { clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, width: host.width,
            controls: [...element.querySelectorAll<HTMLElement>('button,input,select')].filter(control => control.getClientRects().length)
              .map(control => { const rect = control.getBoundingClientRect(); return { label: control.getAttribute('aria-label') ?? control.textContent?.trim(), left: rect.left - host.left, right: rect.right - host.left, width: rect.width, height: rect.height }; }),
            documentFits: document.documentElement.scrollWidth <= innerWidth + 1 };
        });
        assert.ok(dimensions.width > 180 && dimensions.scrollWidth <= dimensions.clientWidth + 2, JSON.stringify(dimensions));
        assert.ok(dimensions.documentFits, 'The application must not create horizontal document scrolling.');
        assert.deepEqual(dimensions.controls.filter(control => control.width < 1 || control.height < 1 || control.left < -2 || control.right > dimensions.width + 2), [], 'Visible flow controls must fit the narrow panel.');
        layouts.push({ theme: id, target, ...dimensions }); await screenshot(`10-${id}-${target}-narrow`);
      }
      await size(1600, 1000);
    }
    evidence.layouts = layouts; await unchanged();
  });

  await check('保存重开保留实际分段、黑底、预设分配与整图不透明度，编辑视图和临时预览不落盘', async () => {
    await unchanged(); const before = await read();
    const reparsed = applyTextScript(before, before.scriptText!.content); assert.deepEqual(reparsed.issues, []);
    assert.deepEqual(storyMenuEntries(reparsed.project, 'flowchart'), storyMenuEntries(before, 'flowchart'));
    await close(); await launch(); await unchanged();
    await editBase(last.id); await openGroup('flow-base-base-text'); await expect(field('基础字间距')).toHaveValue('1.75');
    const baseSpacing = await expectCaptionSpacing(ids.map, last.id, [1.75]);
    await selectNode(first.id); await expect(field('当前节点外观预设')).toHaveValue(ids.preset);
    await expect(field('节点文字第 1 段')).toHaveValue('记 第一回'); await expect(field('节点文字第 2 段')).toHaveValue('醉梦');
    await editPreset(); await expect(field('预设文字黑底方式')).toHaveValue('soft'); await openGroup('flow-preset-base-text');
    await expect(field('预设字间距')).toHaveValue('2.25');
    await flow().getByRole('tab', { name: '记 第一回', exact: true }).click();
    await expect(field('预设第 1 段字间距')).toHaveValue('0');
    const reopenedExplicitZero = await expectCaptionSpacing(ids.map, first.id, [0, 2.25]);
    await flow().getByRole('tab', { name: '醉梦', exact: true }).click(); await expect(field('预设第 2 段字间距')).toHaveValue('2.25');
    const reopenedInherited = await expectCaptionSpacing(ids.map, first.id, [0, 2.25]);
    evidence.reopenedLetterSpacing = { base: baseSpacing, explicitPartZero: reopenedExplicitZero, inheritedPart: reopenedInherited };
    await expect(field('预设文字黑底方式')).toHaveValue('soft');
    await expect(field('预设黑底不透明度')).toHaveValue('80'); await expect(field('预设黑底厚度')).toHaveValue('6');
    await flow().getByRole('tab', { name: '记 第一回', exact: true }).click(); await expect(field('预设第 1 段字号')).toHaveValue('31');
    await flow().getByRole('tab', { name: '醉梦', exact: true }).click(); await expect(field('预设第 2 段字号')).toHaveValue('67');
    assert.deepEqual(await read(), before); assert.equal(mapIn(before).style?.opacity, .62);
    evidence.fixtureSha256After = sha256(savedBytes); await screenshot('11-saved-reopened');
  });

  await check('未同步剧本只禁止节点文字、预设分配和来源切换，外观仍可编辑且原剧本完整保留', async () => {
    await close(); const pending = await read(); pending.scriptText!.content += '\n@不存在的剧情命令：尚未完成';
    await fs.writeFile(projectFile, JSON.stringify(pending)); savedBytes = await fs.readFile(projectFile, 'utf8'); await launch();
    await expect(flow()).toContainText('剧本文本有尚未同步的修改'); await selectNode(first.id);
    await expect(field('节点文字第 1 段')).toBeDisabled(); await expect(field('当前节点外观预设')).toBeDisabled();
    await expect(flow().getByRole('button', { name: '复制预设并用于此节点', exact: true })).toBeDisabled();
    await editPreset(); await expect(field('预设文字黑底方式')).toBeEnabled(); await openGroup('flow-preset-manage'); await expect(field('预设名称')).toBeDisabled();
    await map(); await clearSearch(); await openGroup('flow-mode');
    await group('flow-mode').getByRole('button', { name: /^管理显示的剧情/ }).click(); await scope('sources');
    await expect(field('显示小章节：第一小节')).toBeDisabled();
    assert.equal((await read()).scriptText!.content, pending.scriptText!.content); await unchanged(); await screenshot('12-pending-text-guard');
    evidence.pendingScript = { protected: true, sourceBytes: Buffer.byteLength(pending.scriptText!.content, 'utf8') };
  });

  assert.equal(checks.length, 17); assert.deepEqual(errors, [], 'Renderer must not raise runtime errors.');
  report.buildAfter = await fingerprints(); assert.deepEqual(report.buildAfter, report.buildBefore, 'Acceptance must use one unchanged compiled build.');
  report.status = 'passed';
} catch (error) {
  failure = error; report.status = 'failed'; report.phase = phase; report.error = String(error);
  if (app && page && !page.isClosed()) {
    report.scopeAtFailure = await inspector().getAttribute('data-ui-flow-view').catch(() => undefined);
    report.inspectorAtFailure = await flow().innerText().catch(() => undefined);
    await screenshot('failure').catch(capture => { report.captureError = String(capture); });
  }
} finally {
  try { await close(); } catch (error) { report.status = 'failed'; report.closeError = String(error); failure ??= error; }
  try {
    const after = sha256(await fs.readFile(sourceFile)); report.sourceSha256After = after;
    if (sourceHash !== undefined) assert.equal(after, sourceHash, 'The author project changed during isolated acceptance.');
  } catch (error) { report.status = 'failed'; report.sourceProtectionError = String(error); failure ??= error; }
  try {
    if (app || processes.some(record => !record.exited)) throw new Error('An owned fixture process remains alive; retain its directories.');
    report.cleanup = await cleanVerificationDirectories(output, ['fixture', 'profile']);
    assert.deepEqual((report.cleanup as { errors: unknown[] }).errors, []);
  } catch (error) { report.status = 'failed'; report.cleanupError = String(error); failure ??= error; }
  await fs.mkdir(output, { recursive: true }); await writeReport(); console.log(output);
}
if (failure) throw failure;
