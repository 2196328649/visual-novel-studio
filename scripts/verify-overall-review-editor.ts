import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { createProject, newNode, projectSchema, type Project, type UiComponent, type VariableValue } from '../src/core/model';
import { createUiEventGraph } from '../src/core/ui-logic';
import { saveProject } from '../src/desktop/project-store';
import { fitBlueprintCanvas } from './lib/blueprint-canvas';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { openDisclosure, openDisclosureAncestors } from './lib/ui-disclosures';
import { openStoryMode } from './lib/story-workspace';

// Pending unified acceptance: authoring this script does not run it. The parent
// runs it serially only after all product changes and the shared build freeze.
if (process.env.VNS_INSTALLED_EXE) throw new Error('整体回归只允许隔离的源码构建版。');
const root = path.resolve('.');
const permittedRoot = path.join(root, 'artifacts/overall-review-2026-11-13/editor');
const requestedRoot = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? permittedRoot);
function inside(parent: string, candidate: string, allowEqual = false) {
  const relative = path.relative(parent, candidate);
  return (allowEqual || relative !== '') && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}
assert.ok(inside(permittedRoot, requestedRoot, true), '桌面验收输出必须位于本轮 overall-review-2026-11-13/editor 目录内。');
const output = path.join(requestedRoot, `overall-review-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`);
const projectDir = path.join(output, 'project'), profile = path.join(output, 'profile');
const projectFile = path.join(projectDir, 'project.vns.json'), dialogueFile = path.join(projectDir, 'dialogue-project.vns.json');
const screenshots = path.join(output, 'screenshots'), thumbnails = path.join(output, 'thumbnails');
const savedEvidence = path.join(output, 'saved-project-evidence');
const imageRelative = 'assets/ui/overall-checker.png';
for (const candidate of [projectDir, profile, projectFile, dialogueFile, screenshots, thumbnails, savedEvidence]) {
  assert.ok(inside(output, candidate), 'fixture/profile/evidence 必须位于本次新目录内：' + candidate);
}

/** Inspect only exact output ancestors. Never enumerate artifacts or inspect
 * another run's fixture, profile, or any historical refused cleanup path. */
async function prepareOutput() {
  const workspace = await fs.realpath(root);
  let current = root;
  for (const part of path.relative(root, output).split(path.sep)) {
    current = path.join(current, part);
    const stat = await fs.lstat(current).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    });
    if (current === output) assert.equal(stat, undefined, '每次桌面验收必须创建新目录。');
    if (stat) assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), '拒绝非目录或链接输出路径：' + current);
    else await fs.mkdir(current);
    assert.ok(inside(workspace, await fs.realpath(current)), '输出路径离开工作区：' + current);
  }
}

const ids = {
  page: 'overall_page', graphA: 'overall_graph_a', graphB: 'overall_graph_b', nodeA: 'overall_node_a', nodeB: 'overall_node_b',
  variableA: 'overall_variable_a', variableB: 'overall_variable_b',
  passage: 'overall_passage', lineA: 'overall_line_a', lineB: 'overall_line_b', lineC: 'overall_line_c',
  start: 'overall_start', unreadStart: 'overall_unread_start', flow: 'overall_flow_map',
  save: 'overall_save_slots', savePanel: 'overall_save_panel', saveText: 'overall_save_text', safeSaveRoot: 'overall_safe_save_root',
  illegalTree: 'overall_illegal_tree', illegalInner: 'overall_illegal_inner', illegalSlots: 'overall_illegal_slots',
  text: 'overall_text', panel: 'overall_panel', image: 'overall_image', imageAsset: 'overall_image_asset', draftButton: 'overall_draft_button',
  dialoguePassage: 'overall_dialogue_passage', dialogueLine: 'overall_dialogue_line', hiddenLine: 'overall_dialogue_hidden_line',
  dialoguePanel: 'overall_dialogue_panel', dialogueText: 'overall_dialogue_text', dialogueButton: 'overall_dialogue_button',
  alpha: 'overall_alpha', words: 'overall_words', visible: 'overall_visible', position: 'overall_position', enabled: 'overall_enabled', selected: 'overall_selected',
};
const lineText: Record<string, string> = { [ids.lineA]: '第一行保留。', [ids.lineB]: '第二行待操作。', [ids.lineC]: '第三行保留。' };
const placeholder = '尚未到达内容', updatedWords = '剧情更新的参数文字';

function createFixture(): Project {
  const project = createProject('整体回归桌面验收');
  project.id = 'overall_review_acceptance';
  project.resourceSettings = { importMode: 'copy', directory: 'assets', syncFolders: false };
  project.playerDefaults = { textSpeed: 0, masterVolume: 0 };
  project.chapters = [{ id: 'overall_chapter_a', name: '已到达的第一章' }, { id: 'overall_chapter_b', name: '尚未到达的第二章' }];
  project.scenes = [{ id: 'overall_scene_a', chapterId: 'overall_chapter_a', name: '三行模块场景' }, { id: 'overall_scene_b', chapterId: 'overall_chapter_b', name: '未到达场景' }];
  project.entryId = ids.start;
  project.nodes = [
    { id: ids.start, kind: 'start', name: '第一章入口', sceneId: 'overall_scene_a', x: 40, y: 80, next: ids.passage },
    { id: ids.passage, kind: 'passage', name: '三行模块', sceneId: 'overall_scene_a', x: 280, y: 80, next: ids.unreadStart,
      lines: [ids.lineA, ids.lineB, ids.lineC].map(id => ({ id, text: lineText[id], actions: [] })) },
    { id: ids.unreadStart, kind: 'start', name: '第二章入口', sceneId: 'overall_scene_b', x: 520, y: 80, next: 'overall_unread_passage' },
    { id: 'overall_unread_passage', kind: 'passage', name: '尚未到达段落', sceneId: 'overall_scene_b', x: 760, y: 80, next: 'overall_end', lines: [{ id: 'overall_unread_line', text: '尚未到达的故事。', actions: [] }] },
    { id: 'overall_end', kind: 'end', name: '返回标题', sceneId: 'overall_scene_b', x: 1000, y: 80 },
  ];
  project.ui.customPages = [{ id: ids.page, name: '同页双图验收页面', modal: true, components: [
    { id: 'overall_custom_text', kind: 'text', name: '自定义页原有文字', page: 'custom', text: '原有文字', x: .05, y: .05, width: .3, height: .1 },
  ] }];
  for (const [graphId, nodeId, variableId, name, initialValue] of [
    [ids.graphA, ids.nodeA, ids.variableA, 'A', 3] as const,
    [ids.graphB, ids.nodeB, ids.variableB, 'B', 8] as const,
  ]) {
    const graph = createUiEventGraph(project, ids.page, '同页事件图 ' + name);
    graph.id = graphId; graph.name = '同页事件图 ' + name;
    graph.nodes[0].id = nodeId; graph.nodes[0].name = name + ' 专属节点'; graph.nodes[0].x = 260; graph.nodes[0].y = 180;
    graph.localVariables = [{ id: variableId, name: name + ' 图变量', type: 'number', initial: initialValue }];
  }
  project.assets = [{ id: ids.imageAsset, name: '本轮生成的棋盘图片', kind: 'image', category: 'ui', path: imageRelative, width: 32, height: 32 }];
  project.ui.components = [
    { id: ids.save, kind: 'saveSlots', name: '直接复制的存档槽', page: 'save', text: '', x: .03, y: .08, width: .43, height: .66 },
    { id: ids.savePanel, kind: 'panel', page: 'save', parentId: ids.save, childLayer: 'foreground', text: '存档装饰面板', x: .05, y: .05, width: .5, height: .3 },
    { id: ids.saveText, kind: 'text', page: 'save', parentId: ids.savePanel, childLayer: 'foreground', text: '多层子树文字', x: .05, y: .1, width: .9, height: .4 },
    { id: ids.safeSaveRoot, kind: 'text', page: 'save', text: '可跨页的普通复制根', x: .03, y: .82, width: .4, height: .08 },
    // The root and first copied root are ordinary controls; the invalid child
    // is two levels below a panel, so rejection must cover the entire paste.
    { id: ids.illegalTree, kind: 'panel', page: 'save', text: '包含专用子项的普通面板', x: .52, y: .08, width: .43, height: .66 },
    { id: ids.illegalInner, kind: 'panel', page: 'save', parentId: ids.illegalTree, childLayer: 'foreground', text: '中间普通面板', x: .04, y: .04, width: .92, height: .92 },
    { id: ids.illegalSlots, kind: 'saveSlots', page: 'save', parentId: ids.illegalInner, childLayer: 'foreground', text: '', x: .04, y: .04, width: .92, height: .92 },
    { id: ids.text, kind: 'text', page: 'main', text: '普通跨页文字', x: .06, y: .14, width: .38, height: .1 },
    { id: ids.panel, kind: 'panel', page: 'main', text: '普通跨页面板', x: .06, y: .32, width: .4, height: .3, style: { background: '#314a51' } },
    { id: ids.image, kind: 'image', page: 'main', parentId: ids.panel, childLayer: 'foreground', text: '普通跨页图片', assetId: ids.imageAsset, x: .1, y: .1, width: .65, height: .65 },
    { id: ids.draftButton, kind: 'button', page: 'main', text: '未完成蓝图草稿按钮', action: 'start', x: .54, y: .14, width: .38, height: .1 },
    { id: ids.flow, kind: 'flowchart', page: 'flowchart', text: '', x: .04, y: .08, width: .9, height: .8,
      list: { layout: 'flow', flowDirection: 'vertical', itemWidth: 260, itemHeight: 80, gapX: 30, gapY: 35,
        flowShowControls: false, flowShowVerticalScrollbar: false, lockUnread: true, flowLockedNode: 'hide', flowLockedCaption: placeholder } },
  ];
  const callable = createBlueprintGraph('function', '剪贴板验收有效蓝图'); callable.id = 'overall_callable'; project.blueprints.push(callable);
  synchronizeBlueprintSignatures(project);
  return projectSchema.parse(project);
}

/** A second fresh project keeps linked dialogue text out of the row-selection
 * fixture, whose preview must be compared to the exact selected line. */
function createDialogueFixture(): Project {
  const project = createProject('整体回归：剧情参数对话预览');
  project.id = 'overall_review_dialogue_acceptance';
  project.resourceSettings = { importMode: 'copy', directory: 'assets', syncFolders: false };
  project.playerDefaults = { textSpeed: 0, masterVolume: 0 };
  const sceneId = project.scenes[0].id;
  project.variables = [
    { id: ids.alpha, name: '对话透明度', type: 'number', initial: .2, persistent: false },
    { id: ids.words, name: '对话关联文字', type: 'string', initial: '初始参数文字', persistent: false },
    { id: ids.visible, name: '对话面板可见', type: 'boolean', initial: false, persistent: false },
    { id: ids.position, name: '对话面板横向', type: 'number', initial: .05, persistent: false },
    { id: ids.enabled, name: '按钮可操作', type: 'boolean', initial: false, persistent: false },
    { id: ids.selected, name: '按钮选中', type: 'boolean', initial: false, persistent: false },
  ];
  const changes: readonly [string, VariableValue][] = [[ids.alpha, .6], [ids.words, updatedWords], [ids.visible, true], [ids.position, .125], [ids.enabled, true], [ids.selected, true]];
  const setters = changes.map(([variableId, value], index) => {
    const node = newNode('set', sceneId, variableId);
    assert.ok(node.kind === 'set');
    return { ...node, id: 'overall_set_' + index, name: '剧情设置参数 ' + (index + 1), value, next: index + 1 < changes.length ? 'overall_set_' + (index + 1) : ids.dialoguePassage };
  });
  project.entryId = 'overall_dialogue_start';
  project.nodes = [
    { id: project.entryId, kind: 'start', name: '参数预览入口', sceneId, x: 0, y: 0, next: setters[0].id },
    ...setters,
    { id: ids.dialoguePassage, kind: 'passage', name: '参数生效后的对白', sceneId, x: 300, y: 300, next: 'overall_hide_dialogue', lines: [{ id: ids.dialogueLine, text: '原始台词不能重复补到参数文字之后。', actions: [] }] },
    { id: 'overall_hide_dialogue', kind: 'set', name: '隐藏整个对话父面板', sceneId, x: 500, y: 300, variableId: ids.visible, operation: 'set', value: false, next: 'overall_hidden_passage' },
    { id: 'overall_hidden_passage', kind: 'passage', name: '隐藏后继续对白', sceneId, x: 700, y: 300, next: 'overall_dialogue_end', lines: [{ id: ids.hiddenLine, text: '父面板隐藏后不能补回原始台词。', actions: [] }] },
    { id: 'overall_dialogue_end', kind: 'end', name: '返回标题', sceneId, x: 900, y: 300 },
  ];
  const controls: UiComponent[] = [
    { id: ids.dialoguePanel, kind: 'panel', page: 'say', text: '', x: .05, y: .64, width: .8, height: .28,
      style: { opacity: 1, background: '#203445' }, propertyControls: { opacity: { mode: 'sync', parameterId: ids.alpha }, visible: { mode: 'sync', parameterId: ids.visible }, x: { mode: 'sync', parameterId: ids.position } } },
    { id: ids.dialogueText, kind: 'text', page: 'say', parentId: ids.dialoguePanel, childLayer: 'foreground', inheritState: true, binding: 'dialogue', text: '', x: .05, y: .12, width: .8, height: .5,
      style: { fontSize: 28, textColor: '#ffffff' }, propertyControls: { text: { mode: 'sync', parameterId: ids.words } } },
    { id: ids.dialogueButton, kind: 'button', page: 'say', parentId: ids.dialoguePanel, childLayer: 'foreground', inheritState: false, text: '跟随剧情状态按钮', action: 'history', disabled: true, x: .67, y: .64, width: .28, height: .28,
      style: { background: '#882222', disabledBackground: '#333333', selectedBackground: '#abcdef' }, propertyControls: { enabled: { mode: 'sync', parameterId: ids.enabled }, selected: { mode: 'sync', parameterId: ids.selected } } },
  ];
  project.ui.components = controls;
  // Keep the normal dialogue layout: authored bindings themselves must prevent
  // the native fallback from displaying the raw story line again.
  return projectSchema.parse(project);
}

let initial: Project, dialogueInitial: Project;
let app: ElectronApplication | undefined, page: Page | undefined, traceStarted = false, phase = '准备', launchNumber = 0, prepared = false;
let currentProjectFile = projectFile;
const checks: { name: string; durationMs: number }[] = [], errors: string[] = [], traces: string[] = [], temporaryNames: string[] = [];
const processes: { pid?: number; exited: boolean }[] = [];
const evidence = {
  eventGraph: [] as Record<string, unknown>[], clipboard: [] as Record<string, unknown>[], moduleRows: [] as Record<string, unknown>[],
  flowchart: [] as Record<string, unknown>[], dialogue: [] as Record<string, unknown>[],
  screenshots: [] as Record<string, unknown>[], generatedAssets: [] as Record<string, unknown>[], savedProjects: [] as { file: string; sha256: string }[],
};
const report: Record<string, unknown> = {
  status: 'running', renderer: 'compiled source editor', checks, errors, traces, processes, evidence,
  temporaryPaths: [projectDir, profile],
  limits: ['仅新建的隔离工程和 profile；不访问真实作者工程或历史 artifacts。', '只验证编辑器，不启动游戏、不使用外部 AI。', '保留原始截图；每张另存长边不超过 1280 像素的缩略图。'],
};
const readProject = async (file = currentProjectFile) => projectSchema.parse(JSON.parse(await fs.readFile(file, 'utf8')));
const button = (name: string) => page!.getByRole('button', { name, exact: true });
const settle = () => page!.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
const eventWorkspace = () => page!.locator('.ui-event-workspace:visible');
const sidebar = () => eventWorkspace().locator('.ui-event-sidebar:visible');
const directory = () => sidebar().locator('.ui-event-directory-scroll');
const details = () => sidebar().locator('.ui-event-detail:visible');
const variables = () => directory().getByRole('region', { name: '蓝图变量', exact: true });
const canvas = () => page!.locator('.react-flow:visible');
const node = (id: string) => canvas().locator(`.react-flow__node[data-id="${id}"]`);
const uiCanvas = () => page!.getByLabel('界面设计画布', { exact: true });
const hierarchy = () => page!.locator('.ui-hierarchy:visible');
const hierarchyRow = (id: string) => hierarchy().locator(`[data-hierarchy-id="${id}"]`);
const hierarchyIds = () => hierarchy().locator('[data-hierarchy-id]').evaluateAll(rows => rows.map(row => row.getAttribute('data-hierarchy-id')!).sort());
const selectedHierarchyIds = () => hierarchy().locator('[data-hierarchy-id][aria-selected="true"]').evaluateAll(rows => rows.map(row => row.getAttribute('data-hierarchy-id')!).sort());
const row = (id: string) => page!.locator(`#line-${id}`);
const storyPreview = () => page!.locator('.story-preview-content:visible');
const dialoguePreview = () => storyPreview().locator('.ui-dialogue-preview:visible');
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const writeReport = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const componentsOnPage = (project: Project, pageId: string) => pageId === ids.page ? project.ui.customPages.find(item => item.id === pageId)!.components : project.ui.components.filter(component => component.page === pageId);

async function fingerprints() {
  const html = await fs.readFile(path.join(root, 'dist/index.html'), 'utf8');
  const files = ['dist/index.html', 'dist-desktop/main.cjs', 'dist-desktop/preload.cjs', ...[...html.matchAll(/(?:src|href)="(\.\/assets\/[^"?#]+\.(?:js|css))"/g)].map(match => 'dist/' + match[1].slice(2))];
  assert.ok(files.some(file => file.startsWith('dist/assets/') && file.endsWith('.js')), '先完成统一构建，再运行验收。');
  return Promise.all([...new Set(files)].map(async file => ({ file, sha256: hash(await fs.readFile(path.join(root, file))) })));
}
async function preserveProject(name: string, file = currentProjectFile) {
  const destination = path.join(savedEvidence, name + '.vns.json');
  await fs.copyFile(file, destination);
  evidence.savedProjects.push({ file: path.relative(output, destination), sha256: hash(await fs.readFile(destination)) });
}
async function check(name: string, work: () => Promise<void>) {
  phase = name; const start = Date.now(); await work(); checks.push({ name, durationMs: Date.now() - start }); await writeReport(); console.log('通过：' + name);
}
async function screenshot(name: string) {
  await settle();
  const native = await app!.browserWindow(page!);
  const image = await native.evaluate(async window => {
    const capture = await window.webContents.capturePage(), originalSize = capture.getSize();
    const scale = Math.min(1, 1280 / Math.max(originalSize.width, originalSize.height));
    const thumbnail = capture.resize({ width: Math.max(1, Math.round(originalSize.width * scale)), height: Math.max(1, Math.round(originalSize.height * scale)), quality: 'best' });
    return { original: capture.toPNG().toString('base64'), thumbnail: thumbnail.toPNG().toString('base64'), originalSize, thumbnailSize: thumbnail.getSize() };
  });
  assert.ok(Math.max(image.thumbnailSize.width, image.thumbnailSize.height) <= 1280);
  await Promise.all([fs.writeFile(path.join(screenshots, name + '.png'), Buffer.from(image.original, 'base64')), fs.writeFile(path.join(thumbnails, name + '.png'), Buffer.from(image.thumbnail, 'base64'))]);
  evidence.screenshots.push({ name, original: `screenshots/${name}.png`, thumbnail: `thumbnails/${name}.png`, originalSize: image.originalSize, thumbnailSize: image.thumbnailSize });
}
async function setWindow(width = 1280, height = 900) {
  const native = await app!.browserWindow(page!);
  await native.evaluate((window, size) => { if (window.isMinimized()) window.restore(); if (window.isMaximized()) window.unmaximize(); window.setContentSize(size.width, size.height); window.show(); window.focus(); window.webContents.setBackgroundThrottling(false); }, { width, height });
  await expect.poll(() => page!.evaluate(size => Math.max(Math.abs(innerWidth - size.width), Math.abs(innerHeight - size.height)), { width, height })).toBeLessThanOrEqual(2);
}
async function launch(file = projectFile, name = initial.name) {
  currentProjectFile = file;
  app = await launchDesktopFixture({ root, profile, projectFile: file });
  launchNumber++; processes.push({ pid: app.process().pid, exited: false });
  page = await app.firstWindow(); page.setDefaultTimeout(18000);
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(name, { timeout: 45000 });
  assert.equal(path.resolve(fileURLToPath(page.url())), path.join(root, 'dist/index.html'), '必须使用统一编译后的 dist 编辑器。');
  report.rendererUrl = page.url();
  await page.evaluate('globalThis.__name = value => value');
  await setWindow(); await page.context().tracing.start({ screenshots: true, snapshots: true, sources: false }); traceStarted = true;
}
async function closeOwnedApp() {
  if (!app) return;
  const owned = app, child = owned.process(), exited = () => child.exitCode !== null || child.signalCode !== null;
  let traceError: unknown;
  if (traceStarted) {
    const name = 'trace-' + String(launchNumber).padStart(2, '0') + '.zip';
    try { await owned.context().tracing.stop({ path: path.join(output, name) }); traces.push(name); }
    catch (error) { traceError = error; report.traceError = String(error); }
    traceStarted = false;
  }
  try { await owned.close(); }
  finally {
    await expect.poll(exited, { timeout: 15000 }).toBe(true);
    const record = processes.find(item => item.pid === child.pid); if (record) record.exited = exited();
    if (exited()) { app = undefined; page = undefined; }
  }
  if (traceError) throw traceError;
}
async function openDesign(pageId: string) {
  await page!.locator('[data-workspace-tab="ui"]').click();
  await page!.getByLabel('界面编辑模式', { exact: true }).getByRole('button', { name: '设计', exact: true }).click();
  await page!.getByLabel('设计页面', { exact: true }).selectOption(pageId);
  await expect(hierarchy()).toHaveCount(1); await settle();
}
async function openEvents() {
  await page!.locator('[data-workspace-tab="ui"]').click();
  await page!.getByLabel('界面编辑模式', { exact: true }).getByRole('button', { name: '事件图', exact: true }).click();
  await page!.getByLabel('事件图页面', { exact: true }).selectOption(ids.page);
  await expect(eventWorkspace()).toHaveCount(1);
  if (await button('展开事件图左栏').isVisible()) await button('展开事件图左栏').click();
  const toggle = sidebar().locator('.ui-event-directory-toggle'); if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
}
async function chooseGraph(graphId: string) { await page!.getByLabel('当前页面事件图', { exact: true }).selectOption(graphId); await settle(); }
async function expectDetail(id: string) {
  await expect(sidebar()).toHaveCount(1);
  await expect(details()).toHaveCount(1); await expect(details()).toHaveAttribute('data-detail-id', id);
  await expect(sidebar().locator('.ui-event-detail-host')).toHaveAttribute('data-detail-key', id);
  await expect(sidebar().locator('.ui-event-detail-empty')).toHaveCount(0);
  await expect(eventWorkspace().locator('[data-dock-slot="right"], [data-dock-slot="bottom"]')).toHaveCount(0);
  await expect(directory().locator('.blueprint-member-details:visible, .blueprint-member-draft:visible')).toHaveCount(0);
}
async function selectEventNode(graphId: string, nodeId: string) {
  await directory().getByRole('textbox', { name: '搜索我的界面', exact: true }).fill('');
  await directory().locator(`[data-event-node-id="${nodeId}"]`).click();
  await expectDetail(`node:${graphId}:${nodeId}`); await expect(node(nodeId)).toHaveClass(/selected/);
}
async function revealVariables() {
  await directory().getByRole('textbox', { name: '搜索我的界面', exact: true }).fill('');
  const toggle = variables().locator(':scope > .ui-library-heading .ui-library-toggle');
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  const scope = variables().getByLabel('状态列表作用域', { exact: true });
  if (await scope.inputValue() !== 'call') await scope.selectOption('call');
}
async function selectBVariable() {
  await revealVariables();
  await variables().locator(`[data-state-variable-id="${ids.variableB}"]`).getByRole('button', { name: '编辑变量 B 图变量', exact: true }).click();
  await expectDetail(`variable:call:${ids.graphB}:${ids.variableB}`);
  await expect(details().getByRole('spinbutton', { name: '状态初始值 B 图变量', exact: true })).toHaveValue('8');
}
async function openResourceGraph(graphId: string) {
  await page!.locator('[data-workspace-tab="assets"]').click();
  const browser = page!.getByRole('region', { name: '资源管理器', exact: true });
  await browser.getByLabel('搜索资源和蓝图', { exact: true }).fill(graphId === ids.graphA ? '同页事件图 A' : '同页事件图 B');
  await browser.locator(`[data-content-key="blueprint:${graphId}"]`).dblclick();
  await expect(page!.getByLabel('当前页面事件图', { exact: true })).toHaveValue(graphId);
  await expect(eventWorkspace()).toHaveCount(1); await settle();
}
async function graphView() {
  await expect.poll(() => canvas().evaluate(async element => {
    const viewport = element.querySelector('.react-flow__viewport'); if (!viewport) return false;
    const transform = getComputedStyle(viewport).transform;
    for (let frame = 0; frame < 4; frame++) { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); if (!viewport.isConnected || getComputedStyle(viewport).transform !== transform) return false; }
    return true;
  })).toBe(true);
  return canvas().evaluate(element => {
    const viewport = element.querySelector('.react-flow__viewport'); if (!viewport) throw new Error('缺少事件图视口。');
    const matrix = new DOMMatrix(getComputedStyle(viewport).transform);
    return { selected: [...element.querySelectorAll('.react-flow__node.selected')].map(node => node.getAttribute('data-id')!).sort(), x: matrix.e, y: matrix.f, zoom: matrix.a };
  });
}
async function expectGraphView(before: Awaited<ReturnType<typeof graphView>>) {
  await expect.poll(async () => {
    const after = await graphView();
    return JSON.stringify(after.selected) === JSON.stringify(before.selected) && Math.abs(after.x - before.x) <= 1 && Math.abs(after.y - before.y) <= 1 && Math.abs(after.zoom - before.zoom) < .005;
  }).toBe(true);
}
async function saveUi(name: string) {
  if (await button('保存界面').isEnabled()) await button('保存界面').click();
  await expect(button('保存界面')).toBeDisabled();
  await expect(page!.locator('.ui-save-status')).toHaveAttribute('data-dirty', 'false', { timeout: 30000 });
  await expect(button('保存工程')).toBeEnabled({ timeout: 30000 }); await settle();
  const saved = await readProject(); await preserveProject(name); return saved;
}
async function saveWholeProject(name: string) {
  await button('保存工程').click();
  await expect(button('保存工程')).toBeEnabled({ timeout: 30000 }); await expect(page!.locator('.dirty-dot')).toHaveCount(0, { timeout: 30000 });
  await settle(); const saved = await readProject(); await preserveProject(name); return saved;
}
async function selectRoots(rootIds: readonly string[]) {
  for (const [index, id] of rootIds.entries()) await hierarchyRow(id).click(index ? { modifiers: ['Control'] } : {});
  await expect.poll(selectedHierarchyIds).toEqual([...rootIds].sort());
}
async function flowInspector() {
  await openDesign('flowchart'); await hierarchyRow(ids.flow).locator('.ui-hierarchy-caption').click();
  const inspector = page!.locator('.ui-inspector[data-ui-flow-view="map"]'); await expect(inspector).toHaveCount(1);
  await openDisclosure(page!, '玩家操作'); return inspector;
}
async function partialFlowPreview() {
  await button('剧情图预览').click();
  const dialog = page!.getByRole('dialog', { name: '剧情图预览', exact: true });
  await dialog.getByLabel('预览视觉状态', { exact: true }).selectOption('auto');
  await dialog.getByLabel('预览玩家进度', { exact: true }).selectOption('partial');
  await dialog.getByLabel('预览当前节点', { exact: true }).selectOption(ids.start);
  await dialog.getByRole('button', { name: '关闭剧情图预览', exact: true }).click(); await settle();
}
async function expectLineSelection(id: string, text = lineText[id]) {
  await expect(row(id)).toHaveClass(/selected/);
  await expect(page!.locator(`#node-${ids.passage} .story-line.selected`)).toHaveCount(1);
  await expect(storyPreview()).toHaveAttribute('data-preview-key', ids.passage + '/' + id);
  await expect(dialoguePreview().locator('.styled-text').first()).toHaveText(text);
}

try {
  await prepareOutput(); prepared = true;
  await fs.mkdir(projectDir); temporaryNames.push('project'); await fs.mkdir(profile); temporaryNames.push('profile');
  await fs.mkdir(screenshots); await fs.mkdir(thumbnails); await fs.mkdir(savedEvidence);
  report.fingerprintsBefore = await fingerprints();
  phase = '生成并校验隔离夹具'; initial = createFixture(); dialogueInitial = createDialogueFixture();
  const image = new PNG({ width: 32, height: 32 });
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { const at = (y * 32 + x) * 4, light = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0; image.data[at] = light ? 245 : 41; image.data[at + 1] = light ? 190 : 112; image.data[at + 2] = light ? 90 : 143; image.data[at + 3] = 255; }
  const imageBytes = PNG.sync.write(image);
  await fs.mkdir(path.dirname(path.join(projectDir, imageRelative)), { recursive: true });
  await fs.writeFile(path.join(projectDir, imageRelative), imageBytes);
  await fs.mkdir(path.dirname(path.join(savedEvidence, imageRelative)), { recursive: true });
  await fs.copyFile(path.join(projectDir, imageRelative), path.join(savedEvidence, imageRelative));
  evidence.generatedAssets.push({ file: path.relative(output, path.join(savedEvidence, imageRelative)), sha256: hash(imageBytes), width: 32, height: 32, generatedLocally: true });
  await saveProject(projectFile, initial); await preserveProject('initial-project', projectFile);
  phase = '打开隔离源码编辑器';
  await launch();

  await check('同页双事件图：先访问 B，再从 A 节点外部打开 B，恢复 B 选区和左栏', async () => {
    const bytes = await fs.readFile(projectFile, 'utf8');
    await openEvents(); await chooseGraph(ids.graphB); await fitBlueprintCanvas(page!); await selectEventNode(ids.graphB, ids.nodeB);
    const bView = await graphView();
    await chooseGraph(ids.graphA); await selectEventNode(ids.graphA, ids.nodeA); await expectDetail(`node:${ids.graphA}:${ids.nodeA}`);
    await openResourceGraph(ids.graphB);
    await expectDetail(`node:${ids.graphB}:${ids.nodeB}`); await expect(node(ids.nodeB)).toHaveClass(/selected/); await expect(node(ids.nodeA)).toHaveCount(0); await expectGraphView(bView);
    await expect(button('保存界面')).toBeDisabled(); assert.equal(await fs.readFile(projectFile, 'utf8'), bytes);
    await screenshot('01-event-graph-b-resource-restored');
    evidence.eventGraph.push({ scenario: 'node detail and canvas after graph-only resource entry', restoredDetail: await details().getAttribute('data-detail-id'), before: bView, after: await graphView() });
  });

  await check('B 图变量详情跨图恢复，同图资源重开保持变量详情', async () => {
    const bytes = await fs.readFile(projectFile, 'utf8');
    await selectBVariable(); const bView = await graphView();
    await chooseGraph(ids.graphA); await selectEventNode(ids.graphA, ids.nodeA); await openResourceGraph(ids.graphB);
    await expectDetail(`variable:call:${ids.graphB}:${ids.variableB}`); await expectGraphView(bView);
    await expect(details().getByRole('spinbutton', { name: '状态初始值 B 图变量', exact: true })).toHaveValue('8');
    await openResourceGraph(ids.graphB); await expectDetail(`variable:call:${ids.graphB}:${ids.variableB}`);
    await expect(details().getByRole('spinbutton', { name: '状态初始值 B 图变量', exact: true })).toHaveValue('8');
    await expect(button('保存界面')).toBeDisabled(); assert.equal(await fs.readFile(projectFile, 'utf8'), bytes);
    await screenshot('02-event-graph-b-variable-retained');
    evidence.eventGraph.push({ scenario: 'variable detail across graph switch and repeated same-graph entry', owner: ids.graphB, variable: ids.variableB, initialValue: 8 });
  });

  await check('B 图未提交变量草稿跨图和同图重开保留，不提前创建变量', async () => {
    const bytes = await fs.readFile(projectFile, 'utf8'), draftName = 'B 图尚未提交的变量';
    await revealVariables(); await variables().getByRole('button', { name: '新建变量', exact: true }).click(); await expectDetail(`variable:call:${ids.graphB}:new`);
    const form = () => details().getByRole('form', { name: '创建状态变量', exact: true });
    await form().getByRole('textbox', { name: '变量名称', exact: true }).fill(draftName);
    await form().getByRole('combobox', { name: '变量类型', exact: true }).click();
    await page!.getByRole('listbox', { name: '变量类型选项', exact: true }).getByRole('option', { name: '数值', exact: true }).click();
    await form().getByRole('spinbutton', { name: '变量初始值', exact: true }).fill('41'); await form().getByRole('spinbutton', { name: '变量初始值', exact: true }).press('Tab');
    await chooseGraph(ids.graphA); await selectEventNode(ids.graphA, ids.nodeA); await openResourceGraph(ids.graphB);
    for (let entry = 0; entry < 2; entry++) {
      if (entry) await openResourceGraph(ids.graphB);
      await expectDetail(`variable:call:${ids.graphB}:new`);
      await expect(form().getByRole('textbox', { name: '变量名称', exact: true })).toHaveValue(draftName);
      await expect(form().getByRole('combobox', { name: '变量类型', exact: true })).toContainText('数值');
      await expect(form().getByRole('spinbutton', { name: '变量初始值', exact: true })).toHaveValue('41');
      await expect(form().getByRole('button', { name: '创建变量', exact: true })).toBeEnabled();
      await expect(variables().getByRole('button', { name: '编辑变量 ' + draftName, exact: true })).toHaveCount(0);
    }
    await expect(button('保存界面')).toBeDisabled(); assert.equal(await fs.readFile(projectFile, 'utf8'), bytes);
    assert.deepEqual((await readProject()).blueprints.find(graph => graph.id === ids.graphB)!.localVariables, initial.blueprints.find(graph => graph.id === ids.graphB)!.localVariables);
    await screenshot('03-event-graph-b-uncommitted-draft-retained');
    evidence.eventGraph.push({ scenario: 'uncommitted creation draft', graph: ids.graphB, draftName, type: 'number', initial: 41, createdDefinitions: 0 });
    await form().getByRole('button', { name: '取消', exact: true }).click(); await expectDetail(`variable:call:${ids.graphB}:${ids.variableB}`);
  });

  await check('存档槽和普通根内的非法专用子树跨标题粘贴均原子拒绝', async () => {
    await openDesign('main'); const baseline = await saveUi('clipboard-baseline');
    for (const sourceRoots of [[ids.save], [ids.safeSaveRoot, ids.illegalTree]]) {
      await openDesign('save'); await selectRoots(sourceRoots); await hierarchyRow(sourceRoots.at(-1)!).press('Control+C');
      await openDesign('main'); await selectRoots([ids.text]);
      const beforeIds = await hierarchyIds(), beforeSelection = await selectedHierarchyIds(), beforeUndo = await button('撤销').isEnabled();
      await hierarchyRow(ids.text).press('Control+V');
      const alert = page!.locator('.ui-command-error[role="alert"]');
      await expect(alert).toContainText('不能粘贴到'); await expect(alert).toContainText('标题'); await expect(alert).toContainText('存读档');
      assert.deepEqual(await hierarchyIds(), beforeIds, '不能部分插入普通根或合法子项。'); assert.deepEqual(await selectedHierarchyIds(), beforeSelection, '拒绝后目标选区应保持。');
      await expect(button('保存界面')).toBeDisabled(); assert.equal(await button('撤销').isEnabled(), beforeUndo, '拒绝不应增加历史提交。');
      const message = await alert.innerText(); await screenshot(sourceRoots.length === 1 ? '04-direct-save-slots-refused' : '05-multi-root-invalid-subtree-refused');
      await alert.getByRole('button', { name: '知道了', exact: true }).click();
      const saved = await saveWholeProject(sourceRoots.length === 1 ? 'direct-save-slots-refused' : 'invalid-subtree-refused');
      assert.deepEqual(saved.ui, baseline.ui, '拒绝后保存的整个界面必须与基线一致。');
      evidence.clipboard.push({ sourceRoots, destination: 'main', message, beforeIds, afterIds: await hierarchyIds(), selected: beforeSelection, savedUiUnchanged: true });
    }
  });

  await check('普通文字、面板和图片子树跨页可复制，撤销重做后真实保存重开', async () => {
    const before = await readProject(), customBefore = componentsOnPage(before, ids.page);
    await openDesign('main'); await selectRoots([ids.text, ids.panel]); await hierarchyRow(ids.panel).press('Control+C');
    await openDesign(ids.page); const beforeIds = await hierarchyIds();
    await uiCanvas().focus(); await page!.keyboard.press('Control+V');
    await expect(hierarchy().locator('[data-hierarchy-id]')).toHaveCount(beforeIds.length + 3);
    const addedIds = (await hierarchyIds()).filter(id => !beforeIds.includes(id)); assert.equal(addedIds.length, 3);
    const newRoots = await selectedHierarchyIds(); assert.equal(newRoots.length, 2);
    await button('撤销').click(); await expect(hierarchy().locator('[data-hierarchy-id]')).toHaveCount(beforeIds.length); assert.deepEqual(await hierarchyIds(), beforeIds);
    await button('重做').click(); await expect(hierarchy().locator('[data-hierarchy-id]')).toHaveCount(beforeIds.length + 3);
    assert.deepEqual((await hierarchyIds()).filter(id => !beforeIds.includes(id)), addedIds, '重做必须恢复相同控件身份。');
    const saved = await saveUi('ordinary-subtree-pasted');
    const custom = componentsOnPage(saved, ids.page), added = custom.filter(component => addedIds.includes(component.id));
    assert.deepEqual(custom.filter(component => !addedIds.includes(component.id)), customBefore);
    assert.deepEqual(added.map(component => component.kind).sort(), ['image', 'panel', 'text']); assert.ok(added.every(component => component.page === 'custom'));
    const panel = added.find(component => component.kind === 'panel')!, image = added.find(component => component.kind === 'image')!;
    assert.equal(image.parentId, panel.id); assert.equal(image.assetId, ids.imageAsset); assert.equal(added.find(component => component.kind === 'text')!.text, '普通跨页文字');
    assert.deepEqual(componentsOnPage(saved, 'main'), componentsOnPage(before, 'main'), '复制不能改写原控件。');
    await closeOwnedApp(); await launch(); await openDesign(ids.page);
    await expect(hierarchy().locator('[data-hierarchy-id]')).toHaveCount(beforeIds.length + 3); assert.deepEqual((await hierarchyIds()).filter(id => !beforeIds.includes(id)), addedIds);
    const imageComponent = uiCanvas().locator(`[data-component-id="${image.id}"]`);
    const imageProbe = imageComponent.locator(`img[data-ui-image-probe="${ids.imageAsset}"]`);
    await expect(imageProbe).toHaveCount(1);
    await expect.poll(() => imageProbe.evaluate(element => { const image = element as HTMLImageElement; return image.complete && image.naturalWidth === 32 && image.naturalHeight === 32; })).toBe(true);
    await expect(imageComponent.locator(`.ui-image-surface[data-ui-image-source="${ids.imageAsset}"]`)).toBeVisible();
    await expect(imageComponent.locator('svg image')).toHaveCount(1);
    await screenshot('06-ordinary-subtree-saved-reopened');
    evidence.clipboard.push({ scenario: 'text/panel/image cross-page subtree, undo/redo and process reopen', addedIds, roots: newRoots, imageParentId: image.parentId, imageDecoded: { width: 32, height: 32 }, savedCount: custom.length });
  });

  await check('同页缺少 blueprintId 的未完成按钮草稿可创建副本，并完整撤销', async () => {
    await openDesign('main'); const baselineIds = await hierarchyIds(), before = await fs.readFile(projectFile, 'utf8');
    await selectRoots([ids.draftButton]); await openDisclosure(page!, '交互');
    await page!.getByLabel('点击行为', { exact: true }).selectOption('blueprint'); await expect(page!.getByLabel('调用蓝图', { exact: true })).toHaveValue('');
    await hierarchyRow(ids.draftButton).press('Control+D');
    await expect(hierarchy().locator('[data-hierarchy-id]')).toHaveCount(baselineIds.length + 1);
    const copiedId = (await hierarchyIds()).find(id => !baselineIds.includes(id)); assert.ok(copiedId);
    await expect(hierarchyRow(copiedId)).toHaveAttribute('aria-selected', 'true'); await openDisclosure(page!, '交互');
    await expect(page!.getByLabel('点击行为', { exact: true })).toHaveValue('blueprint'); await expect(page!.getByLabel('调用蓝图', { exact: true })).toHaveValue('');
    await expect(page!.locator('.ui-command-error[role="alert"]')).toHaveCount(0);
    await screenshot('07-unfinished-blueprint-button-copied');
    await button('撤销').click(); await expect(hierarchyRow(copiedId)).toHaveCount(0); await selectRoots([ids.draftButton]);
    await openDisclosure(page!, '交互'); await expect(page!.getByLabel('点击行为', { exact: true })).toHaveValue('blueprint');
    await button('撤销').click(); await expect(page!.getByLabel('点击行为', { exact: true })).toHaveValue('start');
    assert.deepEqual(await hierarchyIds(), baselineIds); await expect(button('保存界面')).toBeDisabled(); assert.equal(await fs.readFile(projectFile, 'utf8'), before);
    evidence.clipboard.push({ scenario: 'same-page incomplete blueprint action draft', sourceId: ids.draftButton, copiedId, missingBlueprintIdAcceptedInDraft: true, undoRestoredSavedValue: true });
  });

  await check('流程图隐藏未读后切目录仍可恢复占位，撤销和保存重开保留规则', async () => {
    let inspector = await flowInspector();
    const field = (name: string): Locator => inspector.getByLabel(name, { exact: true });
    await expect(field('未到达的节点')).toHaveValue('hide'); await expect(field('未到达时显示的文字')).toHaveCount(0);
    await partialFlowPreview(); const map = () => uiCanvas().locator(`[data-component-id="${ids.flow}"]`), unread = () => map().locator(`[data-flow-node="${ids.unreadStart}"]`);
    await expect(unread()).toHaveCount(0); await openDisclosureAncestors(field('流程图排列')); await field('流程图排列').selectOption('grid');
    await expect(field('流程图排列')).toHaveValue('grid'); await expect(field('未到达的节点')).toBeVisible(); await expect(field('未到达的节点')).toHaveValue('hide'); await expect(field('未到达时显示的文字')).toHaveCount(0); await expect(unread()).toHaveCount(0);
    await field('未到达的节点').selectOption('show'); await expect(field('未到达时显示的文字')).toHaveValue(placeholder);
    await expect(unread()).toHaveAttribute('data-flow-state', 'disabled'); await expect(unread()).toContainText(placeholder);
    await field('未到达时显示的文字').fill('目录占位文字'); await field('未到达时显示的文字').press('Tab'); await expect(unread()).toContainText('目录占位文字');
    await button('撤销').click(); await expect(field('未到达时显示的文字')).toHaveValue(placeholder); await expect(unread()).toContainText(placeholder);
    await button('撤销').click(); await expect(field('未到达的节点')).toHaveValue('hide'); await expect(field('未到达时显示的文字')).toHaveCount(0); await expect(unread()).toHaveCount(0);
    await button('撤销').click(); await expect(field('流程图排列')).toHaveValue('flow'); await expect(field('未到达的节点')).toHaveValue('hide');
    await button('重做').click(); await expect(field('流程图排列')).toHaveValue('grid'); await button('重做').click(); await expect(field('未到达的节点')).toHaveValue('show'); await expect(field('未到达时显示的文字')).toHaveValue(placeholder);
    const saved = await saveUi('flow-directory-rule-shown'), savedList = saved.ui.components.find(component => component.id === ids.flow)!.list!;
    assert.equal(savedList.layout, 'grid'); assert.equal(savedList.flowLockedNode ?? 'show', 'show'); assert.equal(savedList.flowLockedCaption, placeholder);
    await closeOwnedApp(); await launch(); inspector = await flowInspector();
    await expect(field('流程图排列')).toHaveValue('grid'); await expect(field('未到达的节点')).toHaveValue('show'); await expect(field('未到达时显示的文字')).toHaveValue(placeholder);
    await partialFlowPreview(); await expect(unread()).toHaveAttribute('data-flow-state', 'disabled'); await expect(unread()).toContainText(placeholder);
    await field('未到达的节点').selectOption('hide'); await expect(unread()).toHaveCount(0); await button('撤销').click(); await expect(unread()).toHaveAttribute('data-flow-state', 'disabled'); await expect(field('未到达时显示的文字')).toHaveValue(placeholder);
    await expect(button('保存界面')).toBeDisabled(); await screenshot('08-flow-directory-unread-rule-reopened');
    evidence.flowchart.push({ componentId: ids.flow, unreadId: ids.unreadStart, initial: 'flow/hide', saved: 'grid/show', placeholder, partialProgress: true, undoRestoredHideAndLayout: true, reopenedToggleUndo: true });
  });

  await check('模块选中中间行删除剪切选后邻，无后邻选前邻，撤销新增复制与非选中删除保持有效预览', async () => {
    await openStoryMode(page!, 'script');
    const passage = page!.locator(`#node-${ids.passage}`), lines = passage.locator('.story-line');
    await expect(passage).toBeVisible(); await expect(lines).toHaveCount(3);
    await row(ids.lineB).locator('textarea').click(); await expectLineSelection(ids.lineB);
    await row(ids.lineB).getByRole('button', { name: '删除对白', exact: true }).click(); await expect(lines).toHaveCount(2); await expectLineSelection(ids.lineC);
    await button('撤销').click(); await expect(lines).toHaveCount(3); await expectLineSelection(ids.lineC);
    await row(ids.lineB).locator('textarea').click(); await expectLineSelection(ids.lineB); await row(ids.lineB).click({ button: 'right' });
    await page!.getByRole('menu', { name: '台词菜单', exact: true }).getByRole('menuitem', { name: '剪切台词', exact: true }).click(); await expect(lines).toHaveCount(2); await expectLineSelection(ids.lineC);
    await button('撤销').click(); await expect(lines).toHaveCount(3); await expectLineSelection(ids.lineC);
    await row(ids.lineC).locator('textarea').click(); await row(ids.lineC).getByRole('button', { name: '删除对白', exact: true }).click(); await expect(lines).toHaveCount(2); await expectLineSelection(ids.lineB);
    await button('撤销').click(); await expect(lines).toHaveCount(3); await expectLineSelection(ids.lineB);
    await row(ids.lineB).getByRole('button', { name: '复制对白', exact: true }).click(); await expect(lines).toHaveCount(4);
    const copied = passage.locator('.story-line.selected'); await expect(copied).toHaveCount(1);
    const copiedId = (await copied.getAttribute('id'))!.slice('line-'.length); assert.ok(![ids.lineA, ids.lineB, ids.lineC].includes(copiedId));
    await expectLineSelection(copiedId, lineText[ids.lineB]); await button('撤销').click(); await expect(lines).toHaveCount(3); await expectLineSelection(ids.lineC);
    await passage.getByRole('button', { name: '添加对白', exact: true }).click(); await expect(lines).toHaveCount(4);
    const added = passage.locator('.story-line.selected'); await expect(added).toHaveCount(1); await expect(added.locator('textarea')).toHaveValue('');
    const addedId = (await added.getAttribute('id'))!.slice('line-'.length); await expect(storyPreview()).toHaveAttribute('data-preview-key', ids.passage + '/' + addedId);
    await button('撤销').click(); await expect(lines).toHaveCount(3); await expectLineSelection(ids.lineC);
    await row(ids.lineA).locator('textarea').click(); await expectLineSelection(ids.lineA);
    await row(ids.lineB).getByRole('button', { name: '删除对白', exact: true }).click(); await expect(lines).toHaveCount(2); await expectLineSelection(ids.lineA);
    await screenshot('09-module-other-row-delete-keeps-selection');
    await button('撤销').click(); await expect(lines).toHaveCount(3); await expectLineSelection(ids.lineA);
    const saved = await saveWholeProject('module-neighbor-selection-complete');
    const savedPassage = saved.nodes.find(node => node.id === ids.passage); assert.ok(savedPassage?.kind === 'passage'); assert.deepEqual(savedPassage.lines.map(line => ({ id: line.id, text: line.text })), [ids.lineA, ids.lineB, ids.lineC].map(id => ({ id, text: lineText[id] })));
    evidence.moduleRows.push({ deletedMiddle: ids.lineB, cutMiddle: ids.lineB, nextSelection: ids.lineC, deletedLast: ids.lineC, previousSelection: ids.lineB, undoneCopy: copiedId, undoneAddition: addedId, retainedOtherRowSelection: ids.lineA, previewComparedToExactLine: true });
  });

  await check('对话预览使用剧情当前参数，父子透明度位置显隐与按钮状态一致且不重复补原台词', async () => {
    await closeOwnedApp(); await saveProject(dialogueFile, dialogueInitial); await preserveProject('dialogue-initial-project', dialogueFile); await launch(dialogueFile, dialogueInitial.name); await openStoryMode(page!, 'script');
    const bytes = await fs.readFile(dialogueFile, 'utf8');
    await page!.locator(`#node-${ids.dialoguePassage}`).scrollIntoViewIfNeeded(); await row(ids.dialogueLine).locator('textarea').click();
    await expect(storyPreview()).toHaveAttribute('data-preview-key', ids.dialoguePassage + '/' + ids.dialogueLine);
    const panel = () => dialoguePreview().locator(`[data-preview-component-id="${ids.dialoguePanel}"]`), words = () => dialoguePreview().locator(`[data-preview-component-id="${ids.dialogueText}"]`), stateButton = () => dialoguePreview().locator(`[data-preview-component-id="${ids.dialogueButton}"]`);
    await expect(panel()).toBeVisible(); await expect(words().locator('.ui-text-content')).toHaveText(updatedWords);
    await expect(dialoguePreview()).not.toContainText('原始台词不能重复补到参数文字之后。'); await expect(dialoguePreview().locator('.styled-text')).toHaveCount(0);
    await expect.poll(() => panel().evaluate(element => Number(getComputedStyle(element).opacity))).toBe(.6); await expect.poll(() => words().evaluate(element => Number(getComputedStyle(element).opacity))).toBe(.6);
    const geometry = await dialoguePreview().evaluate((element, ids) => {
      const root = element.getBoundingClientRect(), panel = element.querySelector(`[data-preview-component-id="${ids.panel}"]`)!.getBoundingClientRect(), words = element.querySelector(`[data-preview-component-id="${ids.words}"]`)!.getBoundingClientRect();
      return { panelX: (panel.left - root.left) / root.width, childX: (words.left - panel.left) / panel.width, childWidth: words.width / panel.width };
    }, { panel: ids.dialoguePanel, words: ids.dialogueText });
    assert.ok(Math.abs(geometry.panelX - .125) < .003, '父面板位置必须采样剧情当前值。'); assert.ok(Math.abs(geometry.childX - .05) < .003 && Math.abs(geometry.childWidth - .8) < .003, '子对象几何必须继承父面板。');
    await expect(stateButton()).toHaveCSS('pointer-events', 'auto'); await expect(stateButton()).toHaveCSS('background-color', 'rgb(171, 205, 239)'); await stateButton().hover(); await expect(stateButton()).toHaveCSS('background-color', 'rgb(171, 205, 239)');
    await screenshot('10-dialogue-current-parameters-and-child-geometry');
    await page!.locator('#node-overall_hidden_passage').scrollIntoViewIfNeeded(); await row(ids.hiddenLine).locator('textarea').click();
    await expect(storyPreview()).toHaveAttribute('data-preview-key', 'overall_hidden_passage/' + ids.hiddenLine);
    await expect(panel()).toHaveCount(0); await expect(words()).toHaveCount(0); await expect(stateButton()).toHaveCount(0); await expect(dialoguePreview()).not.toContainText('父面板隐藏后不能补回原始台词。');
    assert.equal(await fs.readFile(dialogueFile, 'utf8'), bytes, '预览不能把当前值写回参数初始值或 authored 控件。');
    const saved = await readProject(); assert.equal(saved.variables.find(variable => variable.id === ids.alpha)!.initial, .2); assert.equal(saved.ui.components.find(component => component.id === ids.dialoguePanel)!.style!.opacity, 1); assert.equal(saved.ui.components.find(component => component.id === ids.dialogueText)!.binding, 'dialogue');
    await preserveProject('dialogue-preview-authored-values-retained'); await screenshot('11-dialogue-parent-hidden-without-native-fallback');
    evidence.dialogue.push({ currentOpacity: .6, authoredOpacity: 1, initialParameterOpacity: .2, currentWords: updatedWords, geometry, buttonEnabledAndSelected: true, hiddenParentRemovedChildren: true, noNativeFallback: true, savedValuesUnchanged: true });
  });

  assert.deepEqual(errors, [], '编辑器不应产生未捕获异常。'); report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.phase = phase; report.error = error instanceof Error ? error.stack : String(error); process.exitCode = 1;
  if (page && app) await screenshot('failure').catch(() => undefined);
} finally {
  try { await closeOwnedApp(); }
  catch (error) { report.closeError = String(error); report.status = 'failed'; process.exitCode = 1; }
  if (prepared) {
    // Retain exact actual saves before removing only the two directories this
    // invocation created. Do not traverse the project to collect evidence.
    for (const [name, file] of [['last-saved-project', projectFile], ['last-saved-dialogue-project', dialogueFile]] as const) {
      try { await preserveProject(name, file); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { report.evidenceError = String(error); report.status = 'failed'; process.exitCode = 1; } }
    }
    try {
      if (app || processes.some(process => !process.exited)) throw new Error('本次编辑器尚未确认退出，保留其隔离 profile 和工程。');
      const cleanup = await cleanVerificationDirectories(output, temporaryNames); report.cleanup = cleanup; assert.deepEqual(cleanup.errors, []);
    } catch (error) { report.cleanupError = String(error); report.status = 'failed'; process.exitCode = 1; }
    if (report.fingerprintsBefore) {
      try { report.fingerprintsAfter = await fingerprints(); assert.deepEqual(report.fingerprintsAfter, report.fingerprintsBefore, '验收期间统一构建必须保持冻结。'); }
      catch (error) { report.buildChanged = String(error); report.status = 'failed'; process.exitCode = 1; }
    }
    if (errors.length) { report.status = 'failed'; process.exitCode = 1; }
    try { await writeReport(); console.log(path.join(output, 'report.json')); }
    catch (error) { console.error('报告未写入：' + String(error)); process.exitCode = 1; }
  }
  if (report.error) console.error(report.error);
}
