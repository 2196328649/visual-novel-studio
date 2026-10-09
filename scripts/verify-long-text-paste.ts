import { openStoryMode } from './lib/story-workspace';
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProject, projectSchema, type StoryNode } from '../src/core/model';
import { projectToText } from '../src/core/text-script';
import { textDocument } from '../src/core/text-document';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const output = path.join(root, 'artifacts', 'long-text-paste-verification', new Date().toISOString().replaceAll(':', '-'));
const projectFile = path.join(output, 'project.vns.json');
const project = createProject('长篇原生粘贴验收');
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
    const node: StoryNode = { ...base, kind: 'passage', next: `bench_${index + 1}`, lines: [{ id: `line_${index}`, text: index === 500 ? '长篇工程编辑验收' : `这是第 ${index + 1} 段的对白。每个场景包含十个节点。`, actions: [] }] };
    project.nodes.push(node);
  }
}
project.nodes.push({ id: 'bench_1000', name: '故事结束', sceneId: 'scene_99', x: 2950, y: 100, kind: 'end' });
const source = projectToText(project);
const visibleSource = textDocument(source).text;
const marker = '长篇文本原生粘贴验收';
const replacement = source.replace('长篇工程编辑验收', marker);
const visibleReplacement = textDocument(replacement).text;
const checks: string[] = [];
const errors: string[] = [];
const measurements: Record<string, unknown> = {};
let application: ElectronApplication | undefined;
let page: Page | undefined;
let failure: string | undefined;
await fs.mkdir(output, { recursive: true });
await fs.writeFile(projectFile, JSON.stringify(project, null, 2));
const env: Record<string, string> = Object.fromEntries(Object.entries({ ...process.env, VNS_USER_DATA: path.join(output, 'user-data'), VNS_PROJECT_PATH: projectFile }).filter((entry): entry is [string, string] => entry[1] !== undefined));
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/resources/**', '**/release/**'] } } });
await server.listen();
env.VNS_DEV_URL = `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}`;
delete env.ELECTRON_RUN_AS_NODE;
delete env.VNS_TEST_ROOT;

try {
  application = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env });
  page = await application.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(project.name);
  await openStoryMode(page, 'text');
  const textbox = page.getByRole('textbox', { name: '中文文本剧本', exact: true });
  const previewDialogue = page.locator('.ui-dialogue-preview');
  expect(await textbox.inputValue()).toBe(visibleSource);
  measurements.sourceCharacters = source.length;
  await page.evaluate(() => {
    const state = window as any;
    state.pasteMetrics = { inputs: 0, beforeInputs: 0, pastes: 0, inputTypes: {}, longtasks: [] };
    document.addEventListener('paste', () => state.pasteMetrics.pastes++, true);
    document.addEventListener('beforeinput', () => state.pasteMetrics.beforeInputs++, true);
    document.addEventListener('input', event => {
      state.pasteMetrics.inputs++;
      const type = (event as InputEvent).inputType;
      state.pasteMetrics.inputTypes[type] = (state.pasteMetrics.inputTypes[type] ?? 0) + 1;
    }, true);
    new PerformanceObserver(list => state.pasteMetrics.longtasks.push(...list.getEntries().map(entry => Math.round(entry.duration)))).observe({ entryTypes: ['longtask'] });
  });
  await application.evaluate(({ clipboard }, value) => {
    (globalThis as any).originalPasteClipboard = { text: clipboard.readText(), html: clipboard.readHTML(), rtf: clipboard.readRTF(), image: clipboard.readImage() };
    clipboard.writeText(value);
  }, replacement);
  await textbox.focus();
  await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.focus(); });
  await page.keyboard.press('Control+A');
  const pasteStart = performance.now();
  await page.keyboard.press('Control+V');
  await expect.poll(() => textbox.inputValue().then(value => value === visibleReplacement), { timeout: 10_000 }).toBe(true);
  await expect(previewDialogue).toContainText('这是第 1000 段的对白。');
  measurements.pasteAndLastLinePreviewMs = Math.round(performance.now() - pasteStart);
  measurements.nativeEvents = await page.evaluate(() => (window as any).pasteMetrics);
  const cursorStart = performance.now();
  await textbox.evaluate((element, text) => {
    const textarea = element as HTMLTextAreaElement;
    const position = textarea.value.indexOf(text);
    textarea.setSelectionRange(position, position);
    textarea.dispatchEvent(new Event('select', { bubbles: true }));
  }, marker);
  await page.keyboard.press('ArrowRight');
  await expect(previewDialogue).toContainText(marker);
  measurements.cursorPreviewMs = Math.round(performance.now() - cursorStart);
  measurements.nativeEvents = await page.evaluate(() => (window as any).pasteMetrics);
  const nativeEvents = measurements.nativeEvents as { pastes: number; inputs: number; inputTypes: Record<string, number> };
  expect(nativeEvents.pastes).toBe(1);
  expect(nativeEvents.inputs).toBe(1);
  expect(nativeEvents.inputTypes.insertFromPaste).toBe(1);
  checks.push('A real Electron clipboard paste inserts the complete 91k Chinese script with one paste event and one insertFromPaste input event.');
  checks.push('The final line previews after paste; moving the cursor to the changed dialogue previews that line without applying the draft.');
  const saveStart = performance.now();
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  const savedDraft = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
  expect(savedDraft.scriptText?.content).toBe(replacement);
  expect(savedDraft.nodes).toEqual(project.nodes);
  measurements.nativeDraftSaveMs = Math.round(performance.now() - saveStart);
  await page.getByRole('button', { name: '应用到项目', exact: true }).click();
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  const saved = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
  expect(saved.scenes).toHaveLength(100);
  expect(saved.nodes.filter(node => node.kind === 'passage')).toHaveLength(1000);
  expect(saved.nodes).toHaveLength(1001);
  expect(saved.nodes.map(node => node.id)).toEqual(project.nodes.map(node => node.id));
  expect(saved.nodes.some(node => node.kind === 'passage' && node.lines.some(line => line.text === marker))).toBe(true);
  expect(saved.scriptText?.content).toBe(replacement);
  checks.push('Native save persists the complete unapplied draft while keeping the graph unchanged; applying and saving retains 100 scenes, 1000 passages, 1001 node IDs, and the new Chinese dialogue.');
  await page.screenshot({ path: path.join(output, 'native-long-paste.png') });
  expect(errors).toHaveLength(0);
} catch (error) {
  failure = String(error).slice(0, 2000);
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  process.exitCode = 1;
} finally {
  if (application) {
    await application.evaluate(({ clipboard }) => {
      const previous = (globalThis as any).originalPasteClipboard;
      if (previous) clipboard.write(previous);
    }).catch(() => {});
    await application.close();
  }
  await server.close();
  const report = { passed: !failure, output, checks, errors, measurements, failure, fixture: { scenes: 100, passages: 1000, nodes: 1001 }, scope: 'Actual Electron clipboard keyboard paste, renderer preview, native IPC and disk saves in an isolated profile; no user manuscript or assets are included.' };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
