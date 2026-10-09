import { openStageEditing } from './lib/story-workspace';
import { chromium, expect, type Browser, type Page } from '@playwright/test';
import { createServer } from 'vite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createProject, projectSchema, type Project, type StoryNode } from '../src/core/model';
import type { StudioBridge, RuntimeEvent } from '../src/core/bridge';

interface EditorHarness {
  snapshot?: () => { project: Project; dirty: boolean };
  saved?: Project;
  autosaved?: Project;
  previewed?: Project;
  delaySave: boolean;
  releaseSave?: () => void;
  closeSubscriptions: number;
  runtime?: (event: RuntimeEvent) => void;
}
declare global { interface Window { __editorHarness: EditorHarness } }

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const longTextOnly = process.argv.includes('--long-text-only');
const output = path.join(root, 'artifacts', 'editor-verification', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/resources/runtime/**', '**/release/**'] } } });
await server.listen();
const address = server.httpServer!.address();
if (!address || typeof address === 'string') throw new Error('Vite did not assign a port.');
const url = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch(process.env.VNS_BROWSER_PATH ? { executablePath: process.env.VNS_BROWSER_PATH, headless: true } : { channel: 'msedge', headless: true });
const checks: string[] = [];
const errors: string[] = [];
const measurements: Record<string, unknown> = {};
const sample = projectSchema.parse(JSON.parse(await fs.readFile(path.join(root, 'resources', 'example', 'project.vns.json'), 'utf8')));

async function editor(project: Project, viewport = { width: 1280, height: 720 }): Promise<Page> {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.addInitScript((initial: Project) => {
    Object.defineProperty(window, '__name', { value: new Function('target', 'return target'), configurable: true });
    const harness: EditorHarness = { delaySave: false, closeSubscriptions: 0 };
    window.__editorHarness = harness;
    // This isolates editor behavior. Native IPC and Ren'Py are verified separately.
    const bridge: StudioBridge = {
      create: async name => ({ project: { ...structuredClone(initial), id: `project_${crypto.randomUUID().replaceAll('-', '')}`, name }, path: null, recovered: false }),
      getInitial: async () => ({ project: structuredClone(initial), path: 'test/project.vns.json', recovered: false }),
      open: async () => null,
      save: async project => {
        const snapshot = structuredClone(project);
        harness.saved = snapshot;
        if (harness.delaySave) await new Promise<void>(resolve => { harness.releaseSave = resolve; });
        return { project: snapshot, path: 'test/project.vns.json', recovered: false };
      },
      autosave: async project => { harness.autosaved = structuredClone(project); return { savedAt: Date.now() }; },
      importAssets: async () => null,
      importText: async () => null,
      preview: async project => { harness.previewed = structuredClone(project); return { ok: true, diagnostics: [], log: '' }; },
      exportGame: async () => null,
      checkExport: async project => ({ platform: project.exportSettings?.platform ?? 'windows', ready: true, checks: [], diagnostics: [] }),
      assetUrl: assetPath => `/resources/example/${assetPath}`,
      environment: async () => ({ sdkPath: null, appVersion: 'editor-test' }),
      onRuntimeEvent: callback => { harness.runtime = callback; return () => { harness.runtime = undefined; }; },
      onCloseRequested: snapshot => {
        harness.snapshot = snapshot;
        harness.closeSubscriptions += 1;
        return () => { harness.snapshot = undefined; harness.closeSubscriptions -= 1; };
      },
    };
    window.studio = bridge;
  }, project);
  await page.goto(url);
  await expect(page.locator('.project-title strong')).toHaveText(project.name);
  await page.waitForFunction(() => !!window.__editorHarness.snapshot);
  return page;
}
async function snapshot(page: Page) { return page.evaluate(() => window.__editorHarness.snapshot!()); }
async function clickTab(page: Page, name: string) {
  if (name === '文本' || name === '剧本') {
    await page.locator('.view-tabs').getByRole('button', { name: '剧本', exact: true }).click();
    await page.getByRole('button', { name: name === '文本' ? '文本编辑' : '模块编辑', exact: true }).click();
  } else await page.getByRole('button', { name, exact: true }).click();
}
async function assertNoOverflow(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }

try {
  if (!longTextOnly) {
  const page = await editor(sample);
  await expect(page.locator('.status-bar')).toContainText('检查通过');
  expect(await page.evaluate(() => window.__editorHarness.closeSubscriptions)).toBe(1);
  await assertNoOverflow(page);
  await page.screenshot({ path: path.join(output, 'editor-1280.png') });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await assertNoOverflow(page);
  await page.screenshot({ path: path.join(output, 'editor-1920.png') });
  await page.setViewportSize({ width: 1280, height: 720 });
  checks.push('1280x720 and 1920x1080 layouts, no page overflow, one active close subscription.');

  const first = page.getByRole('textbox', { name: '第1行对白', exact: true }).first();
  const original = await first.inputValue();
  await first.fill('编辑验收：午后的雨停了。');
  await clickTab(page, '撤销');
  await expect(first).toHaveValue(original);
  await clickTab(page, '重做');
  await expect(first).toHaveValue('编辑验收：午后的雨停了。');
  checks.push('Dialogue edit, undo and redo update the shared project.');

  await page.evaluate(() => { window.__editorHarness.delaySave = true; });
  await clickTab(page, '保存工程');
  await page.waitForFunction(() => !!window.__editorHarness.releaseSave);
  await first.fill('保存期间新增的 B');
  await page.evaluate(() => window.__editorHarness.releaseSave!());
  await expect(page.locator('.dirty-dot')).toHaveCount(1);
  expect((await snapshot(page)).project.nodes.some(node => node.kind === 'passage' && node.lines.some(line => line.text === '保存期间新增的 B'))).toBe(true);
  expect((await snapshot(page)).dirty).toBe(true);
  await clickTab(page, '撤销');
  await expect(first).toHaveValue('编辑验收：午后的雨停了。');
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  expect((await snapshot(page)).dirty).toBe(false);
  await page.evaluate(() => { window.__editorHarness.delaySave = false; });
  checks.push('Save A while editing B retains B as dirty; undo returns to saved A and clears dirty. Close snapshot reports the newest state.');

  await openStageEditing(page);
  await expect(page.locator('.ui-dialogue-preview')).toContainText('编辑验收：午后的雨停了。');
  await expect.poll(() => page.locator('.text-stage img').evaluateAll(images => images.every(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true);
  const actor = page.locator('.text-stage-actor').first();
  const oldLeft = await actor.evaluate(element => element.style.left);
  const bounds = (await actor.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 25);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 55, bounds.y + 25, { steps: 8 });
  await page.mouse.up();
  expect(await actor.evaluate(element => element.style.left)).not.toBe(oldLeft);
  const changedStage = (await snapshot(page)).project;
  expect(JSON.stringify(changedStage.nodes)).not.toBe(JSON.stringify(sample.nodes));
  await page.screenshot({ path: path.join(output, 'stage-1280.png') });
  await clickTab(page, '素材');
  await expect(page.getByLabel('资源列表', { exact: true })).toBeVisible();
  checks.push('Preview shows real bitmap assets, dialogue changes propagate, actor dragging edits the project, and the resource workspace remains accessible.');

  await clickTab(page, '界面');
  await clickTab(page, '添加文字');
  await page.getByLabel('文字', { exact: true }).fill('编辑验收标题');
  await expect(page.locator('.ui-component.selected')).toHaveText('编辑验收标题');
  await page.screenshot({ path: path.join(output, 'ui-1280.png') });
  await page.locator('.ui-toolbar').getByRole('button', { name: '选项', exact: true }).click();
  await clickTab(page, '编辑选项列表');
  await page.getByLabel('组件字号', { exact: true }).fill('34');
  await page.getByLabel('组件背景色', { exact: true }).fill('#245f50');
  await page.getByLabel('文字对齐', { exact: true }).selectOption('left');
  await page.getByLabel('添加标准组件').selectOption('choiceList');
  expect((await snapshot(page)).project.ui.components.filter(component => component.kind === 'choiceList')).toHaveLength(1);
  await page.screenshot({ path: path.join(output, 'ui-choice-1280.png') });
  await page.locator('.ui-toolbar').getByRole('button', { name: '存读档', exact: true }).click();
  await clickTab(page, '编辑存档槽');
  await page.getByLabel('宽度 %', { exact: true }).fill('85');
  await expect(page.locator('.ui-component.saveSlots .ui-save-slot')).toHaveCount(6);
  await page.screenshot({ path: path.join(output, 'ui-save-1280.png') });
  await page.locator('.ui-toolbar').getByRole('button', { name: '设置', exact: true }).click();
  await clickTab(page, '编辑音乐音量');
  await page.getByLabel('文字', { exact: true }).fill('背景音乐');
  await page.getByLabel('组件字号', { exact: true }).fill('30');
  await expect(page.locator('.ui-component.preference')).toContainText('背景音乐');
  await page.getByLabel('添加标准组件').selectOption('preference:musicVolume');
  expect((await snapshot(page)).project.ui.components.filter(component => component.preference === 'musicVolume')).toHaveLength(1);
  await page.screenshot({ path: path.join(output, 'ui-preferences-1280.png') });
  await page.locator('.ui-toolbar').getByRole('button', { name: '对话', exact: true }).click();
  await clickTab(page, '编辑当前对白');
  await expect(page.getByLabel('文字内容', { exact: true })).toHaveValue('dialogue');
  expect((await snapshot(page)).project.ui.components.some(component => component.page === 'say' && component.binding === 'dialogue')).toBe(true);
  projectSchema.parse((await snapshot(page)).project);
  await assertNoOverflow(page);
  checks.push('All five UI pages support native bindings: singleton choice list, six save slots, music preference, dialogue binding, and per-component style properties pass the project schema.');
  await clickTab(page, '剧本');
  await clickTab(page, '状态');
  await page.getByRole('button', { name: '添加状态', exact: true }).last().click();
  await page.getByLabel('状态名称', { exact: true }).last().fill('测试好感');
  await expect(page.locator('.variable-row')).toHaveCount(sample.variables.length + 1);
  checks.push('UI components and typed story variables are created and edited through forms.');

  await clickTab(page, '蓝图');
  await page.waitForSelector('.react-flow__node');
  const count = await page.locator('.react-flow__node').count();
  await clickTab(page, '折叠全部节点');
  await expect(page.locator('.graph-node.collapsed')).toHaveCount(count);
  const collapsedHandles = await page.locator('.react-flow__handle').count();
  await clickTab(page, '展开全部节点');
  expect(await page.locator('.react-flow__handle').count()).toBe(collapsedHandles);
  await clickTab(page, '创建可复用段落');
  await page.locator('.dialog').getByLabel('名称', { exact: true }).fill('共同的告别');
  await page.locator('.dialog').getByRole('button', { name: '确定', exact: true }).click();
  const subgraphProject = (await snapshot(page)).project;
  const call = subgraphProject.nodes.find(node => node.kind === 'call' && node.name === '调用 · 共同的告别');
  expect(call?.kind).toBe('call');
  if (call?.kind !== 'call') throw new Error('Call node was not created.');
  const entry = subgraphProject.nodes.find(node => node.id === call.target);
  expect(entry?.kind).toBe('passage');
  const back = entry && 'next' in entry ? subgraphProject.nodes.find(node => node.id === entry.next) : undefined;
  expect(back?.kind).toBe('return');
  await page.locator(`.react-flow__node[data-id="${call.id}"]`).getByTitle('进入 共同的告别').click();
  await expect(page.locator('.scene-row.active')).toContainText('共同的告别');
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await clickTab(page, '返回调用处');
  await expect(page.locator(`.react-flow__node[data-id="${call.id}"]`)).toBeVisible();
  await page.getByLabel('新建蓝图节点').selectOption('call');
  await page.getByLabel('目标段落', { exact: true }).selectOption(entry!.id);
  await page.getByLabel('接下来', { exact: true }).selectOption(sample.nodes.find(node => node.kind === 'end')!.id);
  const reusedProject = (await snapshot(page)).project;
  expect(reusedProject.nodes.filter(node => node.kind === 'call' && node.target === entry!.id)).toHaveLength(2);
  await clickTab(page, '自动布局');
  await expect(page.getByRole('button', { name: '自动布局', exact: true })).toBeEnabled();
  await page.screenshot({ path: path.join(output, 'blueprint-1280.png') });
  checks.push('Blueprint collapse retains all ports; reusable passage creates call/passage/return, opens and returns to caller, and supports a second caller.');
  await expect.poll(() => page.evaluate(() => window.__editorHarness.autosaved?.ui.components.some(component => component.text === '编辑验收标题') ?? false)).toBe(true);
  checks.push('Autosave receives the complete shared project after edits.');
  const positionNode = sample.nodes.find(node => node.kind === 'passage')!;
  const positionLine = positionNode.kind === 'passage' ? positionNode.lines[0].id : undefined;
  const variable = sample.variables[0];
  await page.evaluate(({ nodeId, lineId, variableId }) => window.__editorHarness.runtime!({ kind: 'position', message: '', nodeId, lineId, variables: variableId ? { [variableId]: 7 } : {} }), { nodeId: positionNode.id, lineId: positionLine, variableId: variable?.id });
  await expect(page.locator('.runtime-status')).toContainText(positionNode.name);
  await page.locator('.runtime-status').click();
  await expect(page.locator('.runtime-position')).toContainText(positionNode.name);
  if (variable) await expect(page.locator('.runtime-state')).toContainText('7');
  await page.locator('.runtime-location').click();
  await expect(page.locator(`#line-${positionLine}`)).toHaveClass(/selected/);
  await page.evaluate(({ nodeId, lineId }) => window.__editorHarness.runtime!({ kind: 'diagnostics', message: '', diagnostics: [{ severity: 'error', message: '运行错误定位验收', nodeId, lineId }] }), { nodeId: positionNode.id, lineId: positionLine });
  await expect(page.locator('.diagnostic').filter({ hasText: '运行错误定位验收' })).toBeVisible();
  await page.screenshot({ path: path.join(output, 'runtime-position-1280.png') });
  checks.push('Structured runtime positions and variables display without changing editor selection; location actions jump to the exact line, and runtime diagnostics open the panel.');
  await page.close();
  }

  const large = largeProject();
  const started = performance.now();
  const benchmark = await editor(large);
  measurements.initialLoadMs = Math.round(performance.now() - started);
  await expect(benchmark.locator('.scene-row')).toHaveCount(100);
  await expect(benchmark.locator('.passage-section')).toHaveCount(10);
  const switchSamples: number[] = [];
  for (const index of [99, 25, 74, 1, 50]) {
    const name = `场景 ${String(index + 1).padStart(3, '0')}`;
    const start = performance.now();
    await benchmark.locator('.scene-row').filter({ hasText: name }).locator('button').first().click();
    await expect(benchmark.locator('.workspace-toolbar')).toContainText(name);
    await expect(benchmark.locator('.passage-section')).toHaveCount(index === 99 ? 11 : 10);
    switchSamples.push(Math.round(performance.now() - start));
  }
  measurements.sceneSwitchMs = switchSamples;
  const firstLarge = benchmark.getByRole('textbox', { name: '第1行对白', exact: true }).first();
  const editStart = performance.now();
  await firstLarge.fill('长篇工程编辑验收');
  expect((await snapshot(benchmark)).project.nodes.some(node => node.kind === 'passage' && node.lines[0]?.text === '长篇工程编辑验收')).toBe(true);
  measurements.editAndSnapshotMs = Math.round(performance.now() - editStart);
  const saveStart = performance.now();
  await clickTab(benchmark, '保存工程');
  await expect(benchmark.locator('.dirty-dot')).toHaveCount(0);
  measurements.bridgeSaveMs = Math.round(performance.now() - saveStart);
  const saved = await benchmark.evaluate(() => window.__editorHarness.saved!);
  const diskStart = performance.now();
  await fs.writeFile(path.join(output, 'benchmark-saved-project.vns.json'), JSON.stringify(saved));
  const restored = JSON.parse(await fs.readFile(path.join(output, 'benchmark-saved-project.vns.json'), 'utf8')) as Project;
  expect(restored.nodes).toHaveLength(1001);
  expect(restored.nodes.filter(node => node.kind === 'passage')).toHaveLength(1000);
  expect(restored.scenes).toHaveLength(100);
  measurements.jsonWriteReadMs = Math.round(performance.now() - diskStart);
  const graphStart = performance.now();
  await clickTab(benchmark, '蓝图');
  await expect(benchmark.locator('.react-flow__node')).toHaveCount(10);
  measurements.blueprintOpenMs = Math.round(performance.now() - graphStart);
  await benchmark.getByLabel('搜索蓝图').fill('段落 501');
  expect(await benchmark.locator('.react-flow__node').evaluateAll(nodes => nodes.filter(node => node instanceof HTMLElement && node.style.opacity === '1').length)).toBe(1);
  const layoutStart = performance.now();
  await clickTab(benchmark, '自动布局');
  await expect(benchmark.getByRole('button', { name: '自动布局', exact: true })).toBeEnabled();
  measurements.sceneAutoLayoutMs = Math.round(performance.now() - layoutStart);
  await benchmark.getByLabel('搜索蓝图').fill('');
  await assertNoOverflow(benchmark);
  await benchmark.screenshot({ path: path.join(output, 'benchmark-100-scenes-1000-passages.png') });
  const textStart = performance.now();
  await clickTab(benchmark, '文本');
  const textEditor = benchmark.getByRole('textbox', { name: '中文文本剧本', exact: true });
  await expect(textEditor).toBeVisible();
  await expect(benchmark.locator('.text-stage')).toBeVisible();
  await expect(benchmark.locator('.text-parse-status')).not.toHaveClass(/error/);
  measurements.textOpenMs = Math.round(performance.now() - textStart);
  const textSource = await textEditor.inputValue();
  measurements.textCharacters = textSource.length;
  const beforeText = (await snapshot(benchmark)).project;
  const textEditStart = performance.now();
  const changedSource = textSource.replace('长篇工程编辑验收', '长篇文本实时预览验收');
  expect(changedSource).not.toBe(textSource);
  await textEditor.focus();
  await textEditor.evaluate(element => {
    const textarea = element as HTMLTextAreaElement;
    const offset = textarea.value.indexOf('长篇工程编辑验收');
    textarea.setSelectionRange(offset, offset + '长篇工程编辑验收'.length);
  });
  await benchmark.keyboard.insertText('长篇文本实时预览验收');
  expect(await textEditor.inputValue()).toBe(changedSource);
  await textEditor.evaluate(element => {
    const textarea = element as HTMLTextAreaElement;
    const offset = textarea.value.indexOf('长篇文本实时预览验收');
    textarea.setSelectionRange(offset, offset);
    textarea.dispatchEvent(new Event('select', { bubbles: true }));
  });
  await expect(benchmark.locator('.text-stage-dialogue p')).toHaveText('长篇文本实时预览验收');
  measurements.textEditPreviewMs = Math.round(performance.now() - textEditStart);
  expect((await snapshot(benchmark)).project.nodes).toEqual(beforeText.nodes);
  const previewStart = performance.now();
  await clickTab(benchmark, '实时试玩');
  await expect.poll(() => benchmark.evaluate(() => window.__editorHarness.previewed?.nodes.some(node => node.kind === 'passage' && node.lines.some(line => line.text === '长篇文本实时预览验收')) ?? false)).toBe(true);
  measurements.textPreviewRequestMs = Math.round(performance.now() - previewStart);
  const textApplyStart = performance.now();
  await clickTab(benchmark, '应用到项目');
  await expect.poll(() => benchmark.evaluate(() => window.__editorHarness.snapshot!().project.nodes.some(node => node.kind === 'passage' && node.lines.some(line => line.text === '长篇文本实时预览验收')))).toBe(true);
  measurements.textApplyMs = Math.round(performance.now() - textApplyStart);
  const afterText = (await snapshot(benchmark)).project;
  expect(afterText.nodes).toHaveLength(1001);
  expect(afterText.nodes.filter(node => node.kind === 'passage')).toHaveLength(1000);
  expect(afterText.scenes).toHaveLength(100);
  expect(afterText.nodes.map(node => node.id)).toEqual(beforeText.nodes.map(node => node.id));
  projectSchema.parse(afterText);
  await assertNoOverflow(benchmark);
  await benchmark.screenshot({ path: path.join(output, 'benchmark-text-1000-passages.png') });
  await benchmark.close();
  checks.push('100-scene / 1000-passage project (1001 total nodes) loads, switches scenes, edits, searches, lays out, saves through bridge, and round-trips JSON on disk. Only the active scene is rendered.');
  checks.push('The 1000-passage text view opens, previews edited dialogue at the cursor, passes the current draft to the preview bridge, applies the draft, and preserves all 100 scenes and 1001 node identities.');
  expect(errors).toHaveLength(0);
  const report = { passed: true, longTextOnly, scope: 'Browser renderer with an instrumented StudioBridge. This script does not claim native IPC or RenPy runtime verification.', checks, errors, measurements, fixture: { scenes: 100, passages: 1000, nodes: 1001 }, machine: { platform: os.platform(), release: os.release(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryGiB: Math.round(os.totalmem() / 1024 ** 3), node: process.version }, screenshots: [...(longTextOnly ? [] : ['editor-1280.png', 'editor-1920.png', 'stage-1280.png', 'ui-1280.png', 'blueprint-1280.png']), 'benchmark-100-scenes-1000-passages.png', 'benchmark-text-1000-passages.png'] };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, ...report }, null, 2));
} catch (error) {
  const lastPage = browser.contexts().flatMap(context => context.pages()).at(-1);
  if (lastPage && !lastPage.isClosed()) await lastPage.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: false, checks, errors, measurements, failure: String(error) }, null, 2));
  console.error(String(error).slice(0, 1500));
  process.exitCode = 1;
} finally { await browser.close(); await server.close(); }

function largeProject(): Project {
  const project = createProject('长篇编辑基准');
  const chapterId = project.chapters[0].id;
  project.scenes = [];
  project.nodes = [];
  project.entryId = 'bench_0';
  for (let sceneIndex = 0; sceneIndex < 100; sceneIndex++) {
    const sceneId = `scene_${sceneIndex}`;
    project.scenes.push({ id: sceneId, chapterId, name: `场景 ${String(sceneIndex + 1).padStart(3, '0')}` });
    for (let position = 0; position < 10; position++) {
      const index = sceneIndex * 10 + position;
      const base = { id: `bench_${index}`, name: `段落 ${index + 1}`, sceneId, x: position * 295, y: 100 };
      const node: StoryNode = { ...base, kind: 'passage', next: `bench_${index + 1}`, lines: [{ id: `line_${index}`, text: `这是第 ${index + 1} 段的对白。每个场景包含十个节点。`, actions: [] }] };
      project.nodes.push(node);
    }
  }
  project.nodes.push({ id: 'bench_1000', name: '故事结束', sceneId: 'scene_99', x: 2950, y: 100, kind: 'end' });
  return project;
}
