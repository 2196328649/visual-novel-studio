import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { projectSchema, type Project } from '../src/core/model';
import { projectFolderName } from '../src/core/project-templates';
import { actionText, applyTextScript } from '../src/core/text-script';
import { textDocument } from '../src/core/text-document';
import { textChapters } from '../src/core/text-chapters';
import { readTextDocument } from '../src/desktop/text-import';
import { buildProject, runRenpy } from '../src/runtime/service';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';
import { openDisclosure } from './lib/ui-disclosures';
import { uiFixturePng } from './lib/ui-fixture-image';
import { isolateRenpySaves } from './lib/renpy-saves';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

const root = path.resolve('.');
const output = path.join(root, 'artifacts/text-desktop-verification', new Date().toISOString().replaceAll(':', '-'));
const profile = path.join(output, 'profile'), imports = path.join(output, 'imports');
const projectName = '中文文本桌面验收', projectParent = path.join(output, 'projects');
const projectFile = path.join(projectParent, projectFolderName(projectName), 'project.vns.json');
const sourcePath = path.join(imports, '桌面验收剧本.docx');
const sdkRoot = path.join(root, 'resources/runtime'), native = path.join(output, 'native');
const firstText = 'DOCX 第一行：窗外的雨停了。', secondText = '第二位角色保留中文、标点和空格。';
const sceneEntry = '切换场景后的入口对白。';
const authoredText = `# 章节：桌面验收
# 小章节：开场
# 段落：开场
@背景：验收背景
小雨：${firstText}
阿宁：${secondText}
旁白：文档实体 <归来> & 中文。
# 小章节：桌面演出场景
# 段落：场景入口
@背景：验收背景
旁白：${sceneEntry}
@返回标题界面`;

// A real deflated DOCX fixture, independent of an author's Downloads folder.
function docx(text: string) {
  const escaped = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const xml = '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
    + text.split('\n').map(line => `<w:p><w:r><w:t xml:space="preserve">${escaped(line)}</w:t></w:r></w:p>`).join('') + '</w:body></w:document>';
  const name = Buffer.from('word/document.xml'), raw = Buffer.from(xml), compressed = deflateRawSync(raw);
  let checksum = 0xffffffff;
  for (const byte of raw) { checksum ^= byte; for (let bit = 0; bit < 8; bit++) checksum = (checksum >>> 1) ^ (0xedb88320 & -(checksum & 1)); }
  const local = Buffer.alloc(30 + name.length + compressed.length);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
  local.writeUInt32LE((checksum ^ 0xffffffff) >>> 0, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26);
  name.copy(local, 30); compressed.copy(local, 30 + name.length);
  const central = Buffer.alloc(46 + name.length); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
  local.copy(central, 16, 14, 26); central.writeUInt16LE(name.length, 28); name.copy(central, 46);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, central, end]);
}

const checks: string[] = [], errors: string[] = [], screenshots: string[] = [];
const previewBuilds: { trigger: string; marker: string; compiledBytes: number; sourceMapEntries: number }[] = [];
const dialogs: { title: string; filePaths: string[] }[] = [];
let application: ElectronApplication | undefined, page: Page | undefined, phase = 'prepare', projectId = '';
let savedProject: Project | undefined;
await fs.mkdir(imports, { recursive: true });
await fs.mkdir(projectParent, { recursive: true });
await fs.writeFile(sourcePath, docx(authoredText));
await fs.writeFile(path.join(imports, '验收背景.png'), uiFixturePng());
const wav = Buffer.alloc(44 + 16000 * 8);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
await fs.writeFile(path.join(imports, '验收音频.wav'), wav);
const importFiles = ['验收背景.png', '验收音频.wav'].map(name => path.join(imports, name));
await isolateRenpySaves(output);
const editor = () => page!.getByRole('textbox', { name: '中文文本剧本', exact: true });
const disk = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const lines = (project: Project) => project.nodes.flatMap(node => node.kind === 'passage' ? node.lines : []);
const view = async (name: string) => page!.locator('.view-tabs').getByRole('button', { name, exact: true }).click();
const visibleChapter = (project: Project) => {
  const source = project.scriptText!.content, range = textChapters(source, project.chapters).find(chapter => chapter.chapterId === project.chapters[0].id)!;
  return textDocument(source, [], { range }).text;
};
async function launch(reopen = false) {
  application = await launchDesktopFixture({ root, profile, sdkRoot, projectHub: true });
  page = await application.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => { void dialog.accept(); });
  await application.evaluate(({ dialog }, data) => {
    const state = globalThis as any; state.qaDialogs = [];
    // Substitute only file chooser replies. All edits and saves use real UI/IPC.
    dialog.showOpenDialog = async (...args: unknown[]) => {
      const { title = '' } = args.at(-1) as { title?: string };
      if (title === '导入素材' && state.qaDelayImport) await new Promise<void>(resolve => { state.qaReleaseImport = resolve; });
      const filePaths = title === '导入中文文本' ? [data.sourcePath] : title === '导入素材' ? data.importFiles : title === '打开作品' ? [data.projectFile] : [];
      state.qaDialogs.push({ title, filePaths }); return { canceled: !filePaths.length, filePaths };
    };
  }, { sourcePath, importFiles, projectFile });
  await expect(page.getByRole('main', { name: '项目窗口', exact: true })).toBeVisible({ timeout: 45000 });
  if (reopen) await page.locator('.recent-project-open').filter({ hasText: projectFile }).click();
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1520, 980));
}
async function close() {
  if (!application) return;
  dialogs.push(...await application.evaluate(() => (globalThis as any).qaDialogs ?? []));
  await application.close(); application = undefined; page = undefined;
}
async function save() {
  await page!.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page!.locator('.dirty-dot')).toHaveCount(0, { timeout: 15000 });
  return disk();
}
async function capture(name: string) {
  await page!.screenshot({ path: path.join(output, name) }); screenshots.push(name);
}
async function position(marker: string) {
  await editor().evaluate((element, marker) => {
    const field = element as HTMLTextAreaElement, at = field.value.indexOf(marker);
    if (at < 0) throw new Error('未找到正文：' + marker);
    field.focus(); field.setSelectionRange(at, at); field.dispatchEvent(new Event('select', { bubbles: true }));
  }, marker);
  await editor().press('ArrowRight'); await editor().press('ArrowLeft');
}
async function palette(command: string, before: string, slash: '/' | '／' = '/') {
  const source = await editor().inputValue(), at = source.indexOf(before);
  expect(at).toBeGreaterThanOrEqual(0);
  await editor().fill(source.slice(0, at) + '\n' + source.slice(at));
  await editor().evaluate((element, before) => {
    const input = element as HTMLTextAreaElement, at = input.value.indexOf(before) - 1;
    input.focus(); input.setSelectionRange(at, at); input.dispatchEvent(new Event('select', { bubbles: true }));
  }, before);
  await page!.keyboard.insertText(slash);
  const menu = page!.getByRole('dialog', { name: '中文指令面板', exact: true });
  await menu.getByLabel('筛选中文指令', { exact: true }).fill(command);
  await menu.locator('.node-picker-results button').filter({ has: page!.getByText(command, { exact: true }) }).click();
  return page!.getByRole('dialog', { name: '命令参数', exact: true });
}
const previewDirectories = () => fs.readdir(path.join(profile, 'builds', projectId, 'preview')).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error; });
async function compilePreview(trigger: 'header' | 'F5', marker: string) {
  const previous = new Set(await previewDirectories());
  if (trigger === 'header') await page!.locator('.app-header').getByRole('button', { name: '试玩', exact: true }).click();
  else await editor().press('F5');
  await expect(page!.locator('.play-workspace')).toHaveAttribute('data-preview-state', 'running', { timeout: 90000 });
  let directory = '';
  await expect.poll(async () => {
    const added = (await previewDirectories()).find(name => !previous.has(name));
    if (!added) return false;
    directory = path.join(profile, 'builds', projectId, 'preview', added);
    return fs.stat(path.join(directory, 'game/story.rpyc')).then(stat => stat.size > 0).catch(() => false);
  }, { timeout: 15000 }).toBe(true);
  const generated = await fs.readFile(path.join(directory, 'game/story.rpy'), 'utf8'); expect(generated).toContain(marker);
  const map = JSON.parse(await fs.readFile(path.join(directory, 'source-map.json'), 'utf8')); expect(Object.keys(map).length).toBeGreaterThan(0);
  previewBuilds.push({ trigger, marker, compiledBytes: (await fs.stat(path.join(directory, 'game/story.rpyc'))).size, sourceMapEntries: Object.keys(map).length });
  const evidence = path.join(output, `preview-${previewBuilds.length}`); await fs.mkdir(evidence);
  await fs.writeFile(path.join(evidence, 'story.rpy'), generated); await fs.writeFile(path.join(evidence, 'source-map.json'), JSON.stringify(map, null, 2));
  await capture(`preview-${previewBuilds.length}.png`);
  await page!.locator('.play-stop').click();
  await expect(page!.locator('.play-workspace')).toHaveCount(0);
}
async function report(status: 'passed' | 'failed', error?: unknown) {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status, phase, error: error && String(error), checks, errors, screenshots, previewBuilds, dialogs,
    source: { name: path.basename(sourcePath), characters: authoredText.length, sha256: createHash('sha256').update(authoredText).digest('hex') },
    project: savedProject && { id: savedProject.id, scenes: savedProject.scenes.length, nodes: savedProject.nodes.length, assets: savedProject.assets.length },
    packaged: false, exported: false, userProjectModified: false,
    scope: '真实 Electron、原生 DOCX/素材导入、撤销与草稿、保存重开、当前文本菜单、试玩工作区和 Ren’Py 场景跳转。仅替换系统文件选择器回复。',
    notCovered: ['发行打包与导出（用户要求不执行）', '实体键盘中文输入法组合态'],
  }, null, 2));
}

try {
  expect(await readTextDocument(sourcePath)).toEqual({ name: path.basename(sourcePath), text: authoredText });
  phase = 'create blank project'; await launch();
  await page!.getByRole('navigation', { name: '项目操作' }).getByRole('button', { name: '新建项目', exact: true }).click();
  await page!.getByLabel('新项目名称', { exact: true }).fill(projectName);
  await page!.getByLabel('新项目保存位置', { exact: true }).fill(projectParent);
  await page!.getByRole('group', { name: '选择项目模板' }).getByRole('button', { name: /^空白项目/ }).click();
  await page!.getByRole('button', { name: '创建并打开项目', exact: true }).click();
  await expect(page!.locator('.project-title strong')).toHaveText(projectName);
  const blank = await save(); projectId = blank.id;
  expect(blank.assets).toHaveLength(0); expect(blank.characters).toHaveLength(0); expect(blank.nodes).toHaveLength(3);
  checks.push('从项目窗口选择空白模板，通过原生保存创建独立工程。');

  phase = 'native asset and DOCX import';
  await view('资源'); await page!.locator('.content-workspace').getByRole('button', { name: '导入素材', exact: true }).click();
  await expect(page!.locator('.status-message')).toContainText('已导入 2 项');
  expect((await save()).assets).toHaveLength(2);
  await openStoryMode(page!, 'text'); await openDisclosure(page!, '文本文件'); await page!.getByRole('button', { name: '导入文本', exact: true }).click();
  const importing = page!.getByRole('dialog', { name: '导入文本', exact: true });
  await expect(importing.locator('pre')).toHaveText(authoredText);
  await importing.getByRole('button', { name: '应用导入', exact: true }).click();
  savedProject = await save();
  expect(savedProject.id).toBe(projectId); expect(savedProject.scriptText?.sourceName).toBe(path.basename(sourcePath));
  expect(lines(savedProject).filter(line => !line.silent).map(line => line.text)).toEqual([firstText, secondText, '文档实体 <归来> & 中文。', sceneEntry]);
  expect(savedProject.characters.map(character => character.name)).toEqual(['小雨', '阿宁']); expect(savedProject.scenes).toHaveLength(2); expect(savedProject.assets).toHaveLength(2);
  const importedSource = visibleChapter(savedProject); await expect(editor()).toHaveValue(importedSource);
  await page!.getByRole('button', { name: '撤销文本修改', exact: true }).click(); expect((await save()).nodes).toEqual(blank.nodes);
  await page!.getByRole('button', { name: '重做文本修改', exact: true }).click(); await expect(editor()).toHaveValue(importedSource);
  savedProject = await save(); await capture('docx-imported.png');
  checks.push('原生导入图片、音频和合成 DOCX；章节、两位角色、全部台词和 XML 实体正确，整次导入可一步撤销重做。');

  phase = 'applied text undo and draft preview';
  const undoMarker = '撤销应用后仍使用最新文本草稿。';
  const undoSource = importedSource.replace(firstText, undoMarker);
  await editor().fill(undoSource); await page!.getByRole('button', { name: '应用到项目', exact: true }).click(); await save();
  await page!.getByRole('button', { name: '撤销文本修改', exact: true }).click();
  await expect(editor()).toHaveValue(undoSource);
  const undone = await save(); expect(lines(undone).some(line => line.text === undoMarker)).toBe(false); expect(undone.scriptText!.content).toContain(undoMarker);
  await compilePreview('header', undoMarker);
  await page!.getByRole('button', { name: '重做文本修改', exact: true }).click(); expect(lines(await save()).some(line => line.text === undoMarker)).toBe(true);
  checks.push('应用文本后撤销恢复旧图并保留草稿；顶部试玩编译草稿，重做恢复应用结果。');

  phase = 'deferred native asset import';
  await application!.evaluate(() => { (globalThis as any).qaDelayImport = true; });
  await view('资源'); await page!.locator('.content-workspace').getByRole('button', { name: '导入素材', exact: true }).click();
  await expect.poll(() => application!.evaluate(() => typeof (globalThis as any).qaReleaseImport)).toBe('function');
  await openStoryMode(page!, 'text');
  const duringImport = '素材导入期间输入的中文草稿不会丢失。';
  await editor().fill(undoSource.replace(secondText, duringImport));
  await application!.evaluate(() => { (globalThis as any).qaDelayImport = false; (globalThis as any).qaReleaseImport(); });
  await expect(page!.locator('.status-message')).toContainText('跳过 2 项重复素材');
  await expect(editor()).toHaveValue(undoSource.replace(secondText, duringImport));
  const afterImport = await save(); expect(lines(afterImport).some(line => line.text === duringImport)).toBe(false); expect(afterImport.scriptText!.content).toContain(duringImport); expect(afterImport.assets).toHaveLength(2);
  checks.push('延迟素材选择期间继续输入，原生去重导入完成后保留新草稿及旧图。');

  phase = 'native open and process restart';
  await page!.getByRole('button', { name: '打开工程', exact: true }).click(); await openStoryMode(page!, 'text');
  await expect(editor()).toHaveValue(visibleChapter(afterImport));
  await close(); await launch(true); await openStoryMode(page!, 'text'); await expect(editor()).toHaveValue(visibleChapter(afterImport));
  checks.push('原生选择器重新打开和完整重启后，草稿、导入来源及素材仍在。');

  phase = 'Chinese command menus and live preview';
  // Replace the serializer's implicit scene link through the real command menu.
  await editor().fill((await editor().inputValue()).replace(/^@跳转：场景入口\r?\n/m, ''));
  let params = await palette('跳转', '# 小章节：桌面演出场景');
  const targetScene = afterImport.scenes.find(scene => scene.name === '桌面演出场景')!;
  await params.getByLabel('目标目录项', { exact: true }).selectOption(targetScene.id);
  await params.getByRole('button', { name: '插入指令', exact: true }).click();
  expect(await editor().inputValue()).toContain('@跳转：桌面演出场景');
  params = await palette('音效', '小雨：', '／');
  await params.getByRole('button', { name: '浏览音效素材', exact: true }).click();
  const assets = page!.getByRole('dialog', { name: '音效素材资源浏览器', exact: true });
  await assets.getByLabel('可选素材分类', { exact: true }).selectOption('all');
  await assets.getByRole('button', { name: '预览资源 验收音频', exact: true }).dblclick();
  await expect(params.getByLabel('音效素材', { exact: true })).toHaveValue('验收音频');
  await params.getByRole('button', { name: '插入指令', exact: true }).click();
  params = await palette('停止音乐', '小雨：');
  await params.getByLabel('淡出秒数', { exact: true }).fill('0.7'); await params.getByLabel('淡出秒数', { exact: true }).press('Tab');
  await params.getByRole('button', { name: '插入指令', exact: true }).click();
  expect(await editor().inputValue()).toContain('@停止音乐：0.7'); expect(await editor().inputValue()).not.toContain('／');
  const marker = '未应用的桌面试玩内容。';
  const camera = actionText(afterImport, { kind: 'camera', x: .15, y: 0, zoom: 1.12, rotation: 0, duration: 1, easing: 'linear', wait: true });
  const liveSource = (await editor().inputValue()).replace(undoMarker, marker).replace('小雨：', `@背景音乐：验收音频\n${camera}\n小雨：`);
  await editor().fill(liveSource); await position(marker);
  await expect(page!.locator('.ui-dialogue-preview')).toContainText(marker);
  await expect.poll(() => page!.locator('.text-stage-background').evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
  const audio = page!.getByLabel('试听音乐：验收音频', { exact: true });
  await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).duration)).toBeGreaterThan(0);
  await audio.evaluate(element => (element as HTMLAudioElement).play());
  await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).currentTime)).toBeGreaterThan(.1);
  await audio.evaluate(element => { const player = element as HTMLAudioElement; player.pause(); player.currentTime = 2; });
  await audio.evaluate(element => (element as HTMLAudioElement).play());
  await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).currentTime)).toBeGreaterThan(2.1);
  await audio.evaluate(element => (element as HTMLAudioElement).pause());
  await page!.getByRole('button', { name: '播放预览', exact: true }).click();
  await expect(page!.locator('.story-preview-content')).toHaveAttribute('data-preview-phase', /actions|dialogue/);
  for (const [width, height] of [[1280, 720], [1920, 1080]]) {
    await application!.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size[0], size[1]), [width, height]);
    expect(await page!.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await capture(`live-preview-${width}.png`);
  }
  await page!.getByRole('button', { name: '停止预览', exact: true }).click();
  expect(lines(await disk()).some(line => line.text === marker)).toBe(false);
  await compilePreview('F5', marker);
  checks.push('半角与全角斜杠菜单选择场景、音效和淡出参数；未应用文本更新画面，音频可播放/定位，F5 编译最新草稿。');

  phase = 'reject and locate invalid command';
  const previousBuilds = await previewDirectories(), invalid = '@不存在的演出指令：必须阻止';
  await editor().fill(liveSource + '\n' + invalid);
  await page!.locator('.app-header').getByRole('button', { name: '试玩', exact: true }).click();
  await expect(page!.locator('.status-message')).toContainText('文本存在错误');
  expect(await editor().evaluate(element => { const input = element as HTMLTextAreaElement; return input.value.slice(input.selectionStart, input.selectionEnd); })).toBe(invalid);
  expect(await previewDirectories()).toEqual(previousBuilds);
  await view('流程图'); await expect(editor()).toBeVisible();
  await view('资源'); await expect(page!.locator('.content-workspace')).toBeVisible();
  await openStoryMode(page!, 'text'); expect((await save()).scriptText!.content).toContain(invalid);
  await capture('error-line-selected.png');
  checks.push('未知指令阻止试玩与流程图切换，定位正确行；资源仍可访问，错误草稿仍可保存。');

  phase = 'draft recovery and graph round trip';
  await editor().fill(liveSource); savedProject = await save();
  expect(lines(savedProject).some(line => line.text === marker)).toBe(false);
  await close(); await launch(true); await openStoryMode(page!, 'text'); await expect(editor()).toHaveValue(liveSource);
  await compilePreview('header', marker);
  await page!.getByRole('button', { name: '应用到项目', exact: true }).click(); savedProject = await save(); expect(lines(savedProject).some(line => line.text === marker)).toBe(true);
  const toGraph = '文本切换到流程图时自动应用。', fromGraph = '模块修改后文本同步保留。';
  await editor().fill(liveSource.replace(marker, toGraph)); await view('流程图'); savedProject = await save();
  const changedNode = savedProject.nodes.find(node => node.kind === 'passage' && node.lines.some(line => line.text === toGraph))!;
  expect(changedNode.kind).toBe('passage');
  const changedLine = changedNode.kind === 'passage' ? changedNode.lines.find(line => line.text === toGraph)! : undefined;
  await page!.getByLabel('流程场景', { exact: true }).selectOption(changedNode.sceneId);
  await openStoryMode(page!, 'script');
  await page!.locator('.story-directory .scene-row').filter({ hasText: '开场' }).locator('button').first().click();
  await page!.locator(`#line-${changedLine!.id} .dialogue-input`).fill(fromGraph);
  await openStoryMode(page!, 'text'); expect(await editor().inputValue()).toContain(fromGraph); expect(await editor().inputValue()).not.toContain(toGraph);
  savedProject = await save(); await capture('final-text.png');
  checks.push('保存未应用草稿后重启仍可试玩；文本进入流程图自动应用，模块改字再回文本保持同一对白编号。');
  await close();

  phase = 'native scene jump runtime';
  const parsed = applyTextScript(savedProject, savedProject.scriptText!.content); expect(parsed.issues).toEqual([]);
  const built = await buildProject({ project: parsed.project, projectDir: path.dirname(projectFile), sdkRoot, outputDir: native, development: true });
  await fs.writeFile(path.join(output, 'native-build.json'), JSON.stringify(built, null, 2)); expect(built.ok, JSON.stringify(built.diagnostics)).toBe(true);
  const target = parsed.project.nodes.find(node => node.sceneId === targetScene.id && node.kind === 'passage' && node.lines.some(line => line.text === sceneEntry))!;
  const background = parsed.project.assets.find(asset => asset.name === '验收背景')!;
  await fs.writeFile(path.join(native, 'game/testcases.rpy'), `
init -999 python:
    import renpy as _engine
    _engine.safe_mode_checked = True
testsuite global:
    before testcase:
        $ _test.timeout = 30.0
        $ _test.transition_timeout = 0.05
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
        $ preferences.afm_enable = False
    teardown:
        exit
testcase desktop_text_scene_jump:
    click id "vn_main_start"
    pause until "${fromGraph}"
    assert "${fromGraph}"
    assert eval renpy.showing("vn_background_${background.id}")
    screenshot "authored-dialogue.png"
    advance until "${sceneEntry}"
    assert eval vn_current_node == "${target.id}"
    assert eval renpy.showing("vn_background_${background.id}")
    screenshot "scene-jump.png"
`);
  const runtime = await runRenpy(sdkRoot, native, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 90000 });
  await fs.writeFile(path.join(output, 'runtime.log'), runtime.log); expect(runtime.code, runtime.log).toBe(0); expect(runtime.log).toMatch(/Test cases\s*:\s*1\s*\|\s*1 passed/);
  checks.push('实际 Ren’Py 执行导入后修订的对白和菜单插入的场景跳转，目标对白及背景正确。');
  expect(errors).toEqual([]); phase = 'complete'; await report('passed');
} catch (error) {
  if (page && !page.isClosed()) { await capture('failure.png').catch(() => undefined); await fs.writeFile(path.join(output, 'failure.html'), await page.content()).catch(() => undefined); }
  await report('failed', error); console.error(error); process.exitCode = 1;
} finally {
  await close();
  for (const name of ['tests', 'log.txt', 'errors.txt', 'traceback.txt']) {
    const source = path.join(native, name);
    if (await fs.stat(source).then(() => true).catch(() => false)) await fs.cp(source, path.join(output, name === 'tests' ? 'runtime-tests' : 'runtime-' + name), { recursive: true });
  }
  const cleanup = await cleanVerificationDirectories(output, ['projects', 'profile', 'imports', 'native', 'saves', 'renpy-saves']);
  expect(cleanup.errors).toEqual([]); console.log(output);
}
