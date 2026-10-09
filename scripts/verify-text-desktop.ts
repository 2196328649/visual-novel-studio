import { openDisclosure } from './lib/ui-disclosures';
import { openStageEditing, openStoryMode } from './lib/story-workspace';
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { projectSchema, type Project } from '../src/core/model';
import { readTextDocument } from '../src/desktop/text-import';
import { runRenpy } from '../src/runtime/service';

const require = createRequire(import.meta.url);
const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runId = `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`;
const output = path.join(studio, 'artifacts', 'text-desktop-verification', runId);
const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'vns-text-'));
const projectFile = path.join(output, 'created-project', 'project.vns.json');
const exportDirectory = path.join(output, 'exports');
const sourcePath = process.env.VNS_TEXT_DOCUMENT ?? 'C:\\Users\\LiuXiangdong\\Downloads\\琼.第一回：归（崇祯五年）.docx';
const sdkRoot = process.env.VNS_TEXT_TEST_SDK ?? path.join(studio, 'resources', 'runtime');
const checks: string[] = [];
const errors: string[] = [];
const screenshots: string[] = [];
const previewBuilds: { button: string; marker: string; directory: string; compiledBytes: number; sourceMapEntries: number }[] = [];
const exportBuilds: { marker: string; directory: string; archives: string[] }[] = [];
const dialogs: { title: string; filePaths?: string[]; filePath?: string; canceled: boolean }[] = [];
let phase = 'prepare';
let application: ElectronApplication | undefined;
let page: Page | undefined;
let projectId = '';
let source: Awaited<ReturnType<typeof readTextDocument>> | undefined;
let savedProject: Project | undefined;

await fs.mkdir(path.join(output, 'imports'), { recursive: true });
const example = projectSchema.parse(JSON.parse(await fs.readFile(path.join(studio, 'resources', 'example', 'project.vns.json'), 'utf8')));
const selectedAssets = [example.assets.find((asset) => asset.kind === 'image')!, example.assets.find((asset) => asset.kind === 'audio')!];
const importFiles: string[] = [];
for (const asset of selectedAssets) {
  const target = path.join(output, 'imports', asset.name + path.extname(asset.path));
  await fs.copyFile(path.join(studio, 'resources', 'example', asset.path), target);
  importFiles.push(target);
}
const env: Record<string, string> = Object.fromEntries(Object.entries({ ...process.env, VNS_USER_DATA: userData, VNS_RENPY_SDK: sdkRoot }).filter((entry): entry is [string, string] => entry[1] !== undefined));
delete env.VNS_PROJECT_PATH;
delete env.VNS_TEST_ROOT;
delete env.VNS_DEV_URL;

async function launch() {
  application = await electron.launch({ executablePath: require('electron'), args: [studio], cwd: studio, env });
  page = await application.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', async (dialog) => { await dialog.accept(); });
  await expect(page.locator('.project-title strong')).not.toBeEmpty();
  // Only OS file chooser replies are supplied. All project operations use UI and native IPC.
  await application.evaluate(({ dialog }, data) => {
    const recorded: { title: string; filePaths?: string[]; filePath?: string; canceled: boolean }[] = [];
    (globalThis as typeof globalThis & { vnsTextDialogLog: typeof recorded }).vnsTextDialogLog = recorded;
    dialog.showSaveDialog = async (...args: unknown[]) => {
      const options = args.at(-1) as { title?: string };
      recorded.push({ title: options.title ?? '', filePath: data.projectFile, canceled: false });
      return { canceled: false, filePath: data.projectFile };
    };
    dialog.showOpenDialog = async (...args: unknown[]) => {
      const options = args.at(-1) as { title?: string };
      const state = globalThis as typeof globalThis & { vnsDelayAssetImport?: boolean; vnsReleaseAssetImport?: () => void };
      if (options.title === '导入素材' && state.vnsDelayAssetImport) await new Promise<void>((resolve) => { state.vnsReleaseAssetImport = resolve; });
      const filePaths = options.title === '导入中文文本' ? [data.sourcePath]
        : options.title === '导入素材' ? data.importFiles
          : options.title === '打开作品' ? [data.projectFile]
            : options.title === '选择游戏导出目录' ? [data.exportDirectory] : [];
      const canceled = filePaths.length === 0;
      recorded.push({ title: options.title ?? '', filePaths, canceled });
      return { canceled, filePaths };
    };
  }, { projectFile, sourcePath, importFiles, exportDirectory });
}

async function recordDialogs() {
  if (!application) return;
  const current = await application.evaluate(() => (globalThis as typeof globalThis & { vnsTextDialogLog?: typeof dialogs }).vnsTextDialogLog?.splice(0) ?? []);
  dialogs.push(...current);
}

async function closeNormally() {
  if (!application) return;
  await recordDialogs();
  const current = application;
  const closed = new Promise<void>((resolve) => current.process().once('exit', () => resolve()));
  await current.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.close(); });
  await Promise.race([closed, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Text desktop close handshake timed out.')), 15_000).unref())]);
  application = undefined;
  page = undefined;
}

async function save(): Promise<Project> {
  await page!.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page!.locator('.dirty-dot')).toHaveCount(0, { timeout: 15_000 });
  return projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
}

async function capture(name: string) {
  const file = path.join(output, name);
  await page!.screenshot({ path: file });
  screenshots.push(file);
}

async function previewDirectories(): Promise<string[]> {
  return fs.readdir(path.join(userData, 'builds', projectId, 'preview')).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
}

async function compilePreview(button: 'top' | 'text', marker: string) {
  const previous = new Set(await previewDirectories());
  const locator = button === 'top' ? page!.locator('.app-header').getByRole('button', { name: '试玩', exact: true })
    : page!.getByRole('button', { name: '实时试玩', exact: true });
  await locator.click();
  await expect(page!.locator('.status-message')).toContainText('试玩已启动', { timeout: 60_000 });
  let directory = '';
  await expect.poll(async () => {
    const added = (await previewDirectories()).find((candidate) => !previous.has(candidate));
    if (!added) return false;
    directory = path.join(userData, 'builds', projectId, 'preview', added);
    return fs.stat(path.join(directory, 'game', 'story.rpyc')).then((stat) => stat.size > 0).catch(() => false);
  }, { timeout: 20_000 }).toBe(true);
  const generated = await fs.readFile(path.join(directory, 'game', 'story.rpy'), 'utf8');
  expect(generated).toContain(marker);
  const compiled = await fs.stat(path.join(directory, 'game', 'story.rpyc'));
  const sourceMap = JSON.parse(await fs.readFile(path.join(directory, 'source-map.json'), 'utf8')) as Record<string, unknown>;
  expect(Object.keys(sourceMap).length).toBeGreaterThan(0);
  previewBuilds.push({ button, marker, directory, compiledBytes: compiled.size, sourceMapEntries: Object.keys(sourceMap).length });
}

async function writeReport(passed: boolean, failure?: string) {
  const sha256 = source ? createHash('sha256').update(source.text).digest('hex') : undefined;
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({
    passed, runId, phase, checks, errors, failure,
    source: source ? { path: sourcePath, name: source.name, characters: source.text.length, lines: source.text.split('\n').length, sha256 } : { path: sourcePath },
    projectFile, userData, projectId, sdkRoot,
    project: savedProject ? { name: savedProject.name, scenes: savedProject.scenes.length, nodes: savedProject.nodes.length, characters: savedProject.characters.length, assets: savedProject.assets.length } : undefined,
    dialogs, screenshots, previewBuilds, exportBuilds,
    scope: 'Actual Electron renderer, isolated native IPC, real DOCX parsing, atomic save/reopen and Ren\'Py compilation. Only file chooser answers are substituted.',
    notCovered: ['Windows installer isolation', 'Rollback and save compatibility', 'Chinese IME composition in a physical keyboard session'],
    knownLimitations: ['The earlier 2026-09-08T13-34-08.160Z-74de3fd1 run hit the RenPy Windows 260-character path limit during export. This run uses a shorter independent temporary user-data directory; the earlier failed report is retained.'],
  }, null, 2));
}

try {
  source = await readTextDocument(sourcePath);
  const expectedText = source.text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  phase = 'create blank project through UI';
  await launch();
  await page!.getByRole('button', { name: '新建工程', exact: true }).click();
  await page!.locator('.dialog').getByLabel('作品名称', { exact: true }).fill('中文文本桌面验收');
  await page!.getByRole('button', { name: '创建作品', exact: true }).click();
  await expect(page!.locator('.project-title strong')).toHaveText('中文文本桌面验收');
  const blank = await save();
  projectId = blank.id;
  expect(blank.assets).toHaveLength(0);
  expect(blank.characters).toHaveLength(0);
  expect(blank.nodes).toHaveLength(3);
  checks.push('Created and saved a genuinely blank project through Electron UI and the native save handler.');

  phase = 'native media import';
  await page!.locator('.sidebar').getByRole('button', { name: '素材', exact: true }).click();
  await page!.locator('.sidebar').getByRole('button', { name: '导入素材', exact: true }).click();
  await expect(page!.locator('.sidebar .resource-row')).toHaveCount(importFiles.length);
  checks.push('Imported a background image and audio file through the actual native asset pipeline.');

  phase = 'DOCX import, apply, and save';
  await openStoryMode(page!, 'text');
  await openDisclosure(page!, '文本文件'); await page!.getByRole('button', { name: '导入文本', exact: true }).click();
  const editor = () => page!.getByRole('textbox', { name: '中文文本剧本', exact: true });
  await expect(editor()).toHaveValue(expectedText, { timeout: 15_000 });
  await capture('01-docx-imported.png');
  await page!.getByRole('button', { name: '应用到项目', exact: true }).click();
  savedProject = await save();
  expect(savedProject.id).toBe(projectId);
  expect(savedProject.scriptText?.content).toBe(expectedText);
  expect(savedProject.scriptText?.sourceName).toBe(source.name);
  expect(savedProject.assets).toHaveLength(importFiles.length);
  expect(savedProject.characters.length).toBeGreaterThan(1);
  expect(savedProject.nodes.some((node) => node.kind === 'passage' && node.lines.some((line) => line.text.includes('在解州客栈')))).toBe(true);
  checks.push(`The supplied DOCX entered the editor with all ${expectedText.length} characters, applied as authored dialogue, and saved with its source name and imported assets intact.`);

  phase = 'undo and redo applied text, then delayed asset import';
  const undoMarker = '撤销应用后仍然使用最新文本草稿。';
  const undoSource = expectedText + `\n旁白：${undoMarker}`;
  await editor().fill(undoSource);
  await page!.getByRole('button', { name: '应用到项目', exact: true }).click();
  await page!.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(editor()).toHaveValue(undoSource);
  const undone = await save();
  expect(undone.nodes.some((node) => node.kind === 'passage' && node.lines.some((line) => line.text === undoMarker))).toBe(false);
  expect(undone.scriptText?.content).toBe(undoSource);
  await compilePreview('top', undoMarker);
  await page!.getByRole('button', { name: '重做', exact: true }).click();
  const redone = await save();
  expect(redone.nodes.some((node) => node.kind === 'passage' && node.lines.some((line) => line.text === undoMarker))).toBe(true);
  await expect(editor()).toHaveValue(undoSource);
  await application!.evaluate(() => { (globalThis as typeof globalThis & { vnsDelayAssetImport: boolean }).vnsDelayAssetImport = true; });
  await page!.locator('.sidebar').getByRole('button', { name: '素材', exact: true }).click();
  await page!.locator('.sidebar').getByRole('button', { name: '导入素材', exact: true }).click();
  await expect.poll(() => application!.evaluate(() => typeof (globalThis as typeof globalThis & { vnsReleaseAssetImport?: () => void }).vnsReleaseAssetImport)).toBe('function');
  await openStoryMode(page!, 'text');
  const duringImportMarker = '素材导入期间输入的中文草稿不会丢失。';
  const duringImportSource = undoSource + `\n旁白：${duringImportMarker}`;
  await editor().fill(duringImportSource);
  await application!.evaluate(() => {
    const state = globalThis as typeof globalThis & { vnsDelayAssetImport: boolean; vnsReleaseAssetImport: () => void };
    state.vnsDelayAssetImport = false;
    state.vnsReleaseAssetImport();
  });
  await expect(page!.locator('.status-message')).toContainText('素材已导入');
  await openStoryMode(page!, 'text');
  await expect(editor()).toHaveValue(duringImportSource);
  const afterImport = await save();
  expect(afterImport.scriptText?.content).toBe(duringImportSource);
  expect(afterImport.nodes.some((node) => node.kind === 'passage' && node.lines.some((line) => line.text === duringImportMarker))).toBe(false);
  checks.push('Undoing an applied text change restored the old graph while preserving the new draft; header preview compiled the draft, redo restored its graph, and a deferred native asset import preserved text entered while it was pending.');
  await editor().fill(expectedText);
  await page!.getByRole('button', { name: '应用到项目', exact: true }).click();
  savedProject = await save();

  phase = 'native open and full process restart';
  await page!.getByRole('button', { name: '打开工程', exact: true }).click();
  await expect(editor()).toHaveValue(expectedText);
  await closeNormally();
  await launch();
  await openStoryMode(page!, 'text');
  await expect(editor()).toHaveValue(expectedText);
  await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  checks.push('Reopened the saved project through the native chooser and then restarted Electron with the same isolated user data; the complete source remained editable.');

  phase = 'scene selector and live text preview';
  await page!.getByRole('button', { name: '添加小章节', exact: true }).click();
  await page!.locator('.scene-row.active > button').first().dblclick();
  await page!.locator('.dialog').getByLabel('名称', { exact: true }).fill('桌面演出场景');
  await page!.locator('.dialog').getByRole('button', { name: '确定', exact: true }).click();
  const sceneEntryMarker = '切换场景后的入口对白。';
  await openStoryMode(page!, 'script');
  await page!.getByRole('textbox', { name: '第1行对白', exact: true }).fill(sceneEntryMarker);
  await openStageEditing(page!);
  await page!.getByRole('combobox', { name: '舞台背景', exact: true }).selectOption({ label: selectedAssets[0].name });
  await openStoryMode(page!, 'script');
  await page!.getByRole('combobox', { name: '添加剧情节点', exact: true }).selectOption('end');
  await page!.locator('.passage-header').first().click();
  const endingValue = await page!.getByRole('combobox', { name: '接下来', exact: true }).locator('optgroup[label="桌面演出场景"] option').filter({ hasText: '结局' }).getAttribute('value');
  await page!.getByRole('combobox', { name: '接下来', exact: true }).selectOption(endingValue!);
  const sceneProject = await save();
  const targetScene = sceneProject.scenes.find((scene) => scene.name === '桌面演出场景')!;
  const targetEntry = sceneProject.nodes.find((node) => node.sceneId === targetScene.id && node.kind === 'passage')!;
  const targetBackground = sceneProject.assets.find((asset) => asset.kind === 'image')!;
  await openStoryMode(page!, 'text');
  await editor().fill(expectedText + '\n\n/');
  await page!.getByRole('button', { name: '跳转', exact: true }).click();
  await page!.getByRole('combobox', { name: '目标目录项', exact: true }).selectOption(targetScene.id);
  await page!.getByRole('button', { name: '插入指令', exact: true }).last().click();
  const sceneSource = await editor().inputValue();
  expect(sceneSource).toMatch(/@跳转：桌面演出场景/);
  expect(sceneSource).not.toMatch(/\n\/\s*$/);
  const sceneCommand = sceneSource.match(/^@跳转：桌面演出场景.*$/m)![0];
  await editor().fill(sceneSource + '／');
  await page!.getByRole('button', { name: '音效', exact: true }).click();
  await page!.getByRole('combobox', { name: '音效素材', exact: true }).selectOption({ label: selectedAssets[1].name });
  await page!.getByRole('button', { name: '插入指令', exact: true }).last().click();
  const soundSource = await editor().inputValue();
  expect(soundSource).toMatch(/@音效：.+【[a-z][a-z0-9_]+】/);
  expect(soundSource).not.toContain('／');
  const soundCommand = soundSource.match(/^@音效：.+$/m)![0];
  await editor().fill(soundSource + '/');
  await page!.getByRole('button', { name: '停止音乐', exact: true }).click();
  await page!.getByRole('spinbutton', { name: '淡出秒数', exact: true }).fill('0.7');
  await page!.getByRole('button', { name: '插入指令', exact: true }).last().click();
  expect(await editor().inputValue()).toContain('@停止音乐：0.7');
  const marker = '未应用的顶部试玩文本。';
  const liveSource = expectedText + `\n\n# 段落：文本演出验收\n@背景：${selectedAssets[0].name}\n@停止音乐：0.7\n@背景音乐：${selectedAssets[1].name}\n${soundCommand}\n@镜头：0，0，1.12，0.6\n@震动：横向\n旁白：${marker}\n${sceneCommand}`;
  await editor().fill(liveSource);
  await editor().press('ArrowUp');
  await expect(page!.locator('.text-stage-dialogue p')).toHaveText(marker);
  await expect.poll(() => page!.locator('.text-stage-background').evaluate((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0)).toBe(true);
  await expect.poll(() => page!.locator('.text-live-audio audio').first().evaluate((audio) => audio instanceof HTMLAudioElement && Number.isFinite(audio.duration) && audio.duration > 0)).toBe(true);
  const audio = page!.locator('.text-live-audio audio').first();
  await audio.evaluate((element) => (element as HTMLAudioElement).play());
  await expect.poll(() => audio.evaluate((element) => (element as HTMLAudioElement).currentTime)).toBeGreaterThan(0.1);
  const seekTime = await audio.evaluate((element) => {
    const player = element as HTMLAudioElement;
    player.pause();
    player.currentTime = player.duration / 2;
    return player.currentTime;
  });
  expect(seekTime).toBeGreaterThan(0);
  await expect.poll(() => audio.evaluate((element) => (element as HTMLAudioElement).seeking)).toBe(false);
  await audio.evaluate((element) => (element as HTMLAudioElement).play());
  await expect.poll(() => audio.evaluate((element) => (element as HTMLAudioElement).currentTime)).toBeGreaterThan(seekTime + 0.1);
  await audio.evaluate((element) => (element as HTMLAudioElement).pause());
  await page!.getByRole('button', { name: '播放预览', exact: true }).click();
  expect(await page!.evaluate(() => document.getAnimations().some((animation) => animation.playState === 'running'))).toBe(true);
  for (const [width, height] of [[1280, 720], [1920, 1080]]) {
    await application!.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size[0], size[1]), [width, height]);
    expect(await page!.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await capture(`02-live-preview-${width}.png`);
  }
  checks.push('ASCII and fullwidth slash menus selected a real existing scene and sound by stable ID, and inserted a Chinese stop-music command with an editable fade duration; unsaved edits updated the actual background/dialogue preview, playable audio and replayable camera/shake animation.');

  phase = 'unapplied source through both preview buttons';
  const diskBeforePreview = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
  expect(diskBeforePreview.nodes.some((node) => node.kind === 'passage' && node.lines.some((line) => line.text === marker))).toBe(false);
  await compilePreview('top', marker);
  const textMarker = '未应用的文本页试玩内容。';
  const textPreviewSource = liveSource.replace(marker, textMarker);
  await editor().fill(textPreviewSource);
  await editor().press('ArrowUp');
  await expect(page!.locator('.text-stage-dialogue p')).toHaveText(textMarker);
  await compilePreview('text', textMarker);
  checks.push('Both the header preview and the text-page preview compiled the latest unapplied draft with Ren\'Py; generated scripts and nonempty compiled bytecode contain their distinct new dialogue markers.');

  phase = 'native export of unapplied draft and scene jump execution';
  const exportButton = page!.locator('.app-header').getByRole('button', { name: '导出', exact: true });
  await exportButton.click();
  await expect(exportButton).toBeEnabled({ timeout: 300_000 });
  await expect(page!.locator('.status-message')).toContainText('游戏已导出');
  const archives = (await fs.readdir(exportDirectory)).filter((name) => name.endsWith('-win.zip'));
  expect(archives.length).toBeGreaterThan(0);
  const releaseRoot = path.join(userData, 'builds', projectId, 'release');
  const releaseFolders = await fs.readdir(releaseRoot);
  expect(releaseFolders).toHaveLength(1);
  const releaseBuild = path.join(releaseRoot, releaseFolders[0]);
  const releaseScript = await fs.readFile(path.join(releaseBuild, 'game/story.rpy'), 'utf8');
  expect(releaseScript).toContain(textMarker);
  expect(releaseScript).toContain(sceneEntryMarker);
  expect(releaseScript).toContain(`jump vn_node_${targetEntry.id}`);
  exportBuilds.push({ marker: textMarker, directory: releaseBuild, archives });
  await fs.writeFile(path.join(releaseBuild, 'game/testcases.rpy'), `testsuite global:
    before testcase:
        $ _test.timeout = 60.0
        $ _test.transition_timeout = 0.05
        $ preferences.text_cps = 0
    teardown:
        exit
testcase text_scene_jump:
    click id "vn_main_start"
    advance until eval vn_current_node == "${targetEntry.id}"
    pause until "${sceneEntryMarker}"
    assert eval vn_current_node == "${targetEntry.id}"
    assert "${sceneEntryMarker}"
    assert eval renpy.showing("vn_background_${targetBackground.id}")
`);
  const played = await runRenpy(sdkRoot, releaseBuild, ['test'], { timeoutMs: 150_000, savedir: path.join(output, 'game-test-saves') });
  await fs.writeFile(path.join(output, 'scene-jump-runtime.log'), played.log);
  expect(played.code, played.log).toBe(0);
  expect(played.log).toMatch(/Test cases\s*:\s*1\s*\|\s*1 passed/);
  expect(played.log).toMatch(/Status:\s+PASSED/);
  checks.push('Header export packaged the latest unapplied draft as a Windows game; a real Ren\'Py test advanced through the imported text and executed the chosen scene entry with its authored dialogue and background.');
  await recordDialogs();

  phase = 'reject and locate invalid commands';
  const beforeInvalid = await previewDirectories();
  const invalidCommand = '@不存在的演出指令：必须阻止';
  await editor().fill(textPreviewSource + '\n' + invalidCommand);
  await page!.locator('.app-header').getByRole('button', { name: '试玩', exact: true }).click();
  await expect(page!.locator('.status-message')).toContainText('文本存在错误');
  expect(await editor().evaluate((element) => { const input = element as HTMLTextAreaElement; return input.value.slice(input.selectionStart, input.selectionEnd); })).toBe(invalidCommand);
  expect(await previewDirectories()).toEqual(beforeInvalid);
  await page!.locator('.app-header').getByRole('button', { name: '导出', exact: true }).click();
  await page!.getByRole('dialog', { name: '作品设置', exact: true }).getByRole('button', { name: '选择目录并导出', exact: true }).click();
  await expect(page!.locator('.status-message')).toContainText('文本存在错误');
  await page!.getByRole('button', { name: '蓝图', exact: true }).click();
  await expect(editor()).toBeVisible();
  expect(await editor().evaluate((element) => { const input = element as HTMLTextAreaElement; return input.value.slice(input.selectionStart, input.selectionEnd); })).toBe(invalidCommand);
  await page!.locator('.sidebar').getByRole('button', { name: '素材', exact: true }).click();
  await expect(page!.locator('.sidebar .resource-row')).toHaveCount(importFiles.length);
  await openStoryMode(page!, 'text');
  await expect(editor()).toHaveValue(textPreviewSource + '\n' + invalidCommand);
  const savedInvalid = await save();
  expect(savedInvalid.scriptText?.content).toContain(invalidCommand);
  const exportDialogs = await application!.evaluate(() => ((globalThis as typeof globalThis & { vnsTextDialogLog: typeof dialogs }).vnsTextDialogLog).filter((entry) => entry.title === '选择游戏导出目录').length);
  expect(exportDialogs).toBe(0);
  await capture('03-error-line-selected.png');
  checks.push('An unknown explicit command blocked header preview, export and graphical editing while selecting its Chinese source line; assets remained accessible and the invalid draft could still be saved.');

  phase = 'draft save and recovery after restart';
  await editor().fill(textPreviewSource);
  savedProject = await save();
  expect(savedProject.scriptText?.content).toBe(textPreviewSource);
  expect(savedProject.nodes.some((node) => node.kind === 'passage' && node.lines.some((line) => line.text === textMarker))).toBe(false);
  await closeNormally();
  await launch();
  await openStoryMode(page!, 'text');
  await expect(editor()).toHaveValue(textPreviewSource);
  await compilePreview('top', textMarker);
  await page!.getByRole('button', { name: '应用到项目', exact: true }).click();
  savedProject = await save();
  expect(savedProject.scenes.some((scene) => scene.name === '桌面演出场景')).toBe(true);
  expect(savedProject.nodes.some((node) => node.kind === 'passage' && node.lines.some((line) => line.text === textMarker))).toBe(true);
  checks.push('Saved an unapplied draft, restarted Electron, previewed that draft again, then applied and saved its new scene and dialogue into the project graph.');
  phase = 'bidirectional text and graphical editing';
  const textToGraphMarker = '文本切换到蓝图时自动应用。';
  const graphToTextMarker = '图形修改后文本同步保留。';
  await editor().fill(textPreviewSource.replace(textMarker, textToGraphMarker));
  await page!.getByRole('button', { name: '蓝图', exact: true }).click();
  savedProject = await save();
  const syncedPassage = savedProject.nodes.find((node) => node.kind === 'passage' && node.lines.some((line) => line.text === textToGraphMarker));
  expect(syncedPassage?.kind).toBe('passage');
  const syncedSceneName = savedProject.scenes.find((scene) => scene.id === syncedPassage!.sceneId)!.name;
  await page!.locator('.scene-row').filter({ hasText: syncedSceneName }).first().locator('button').first().click();
  await expect(page!.locator('.react-flow__node').filter({ hasText: textToGraphMarker })).toBeVisible();
  await openStoryMode(page!, 'script');
  await page!.locator(`#node-${syncedPassage!.id}`).getByRole('textbox', { name: '第1行对白', exact: true }).fill(graphToTextMarker);
  await openStoryMode(page!, 'text');
  expect(await editor().inputValue()).toContain(graphToTextMarker);
  expect(await editor().inputValue()).not.toContain(textToGraphMarker);
  savedProject = await save();
  checks.push('Leaving a valid text draft for the blueprint automatically applied it; editing its dialogue in the graphical script view immediately regenerated text with that change intact.');
  await capture('04-final-applied.png');
  if (errors.length) throw new Error(errors.join('\n'));
  await recordDialogs();
  phase = 'complete';
  await writeReport(true);
  console.log(JSON.stringify({ output, passed: true, checks, previewBuilds }, null, 2));
} catch (error) {
  if (page && !page.isClosed()) await capture('failure.png').catch(() => undefined);
  if (page && !page.isClosed()) {
    await fs.writeFile(path.join(output, 'failure.html'), await page.content());
    await fs.writeFile(path.join(output, 'failure-log.txt'), await page.locator('.problems-panel').innerText({ timeout: 1000 }).catch(() => 'No problem panel.'));
    const media = await page.locator('audio').evaluateAll(async (elements) => Promise.all(elements.map(async (element) => {
      const audio = element as HTMLAudioElement;
      const response = await fetch(audio.currentSrc || audio.src).then(async (result) => ({ status: result.status, headers: Object.fromEntries(result.headers), bytes: (await result.arrayBuffer()).byteLength })).catch((reason) => ({ error: String(reason) }));
      return { source: audio.currentSrc || audio.src, duration: String(audio.duration), networkState: audio.networkState, readyState: audio.readyState, error: audio.error ? { code: audio.error.code, message: audio.error.message } : undefined, response };
    }))).catch((reason) => ({ error: String(reason) }));
    await fs.writeFile(path.join(output, 'media-diagnostics.json'), JSON.stringify(media, null, 2));
  }
  await recordDialogs().catch(() => undefined);
  await writeReport(false, String(error));
  throw error;
} finally {
  await closeNormally().catch(async () => { if (application) await application.close(); });
}
