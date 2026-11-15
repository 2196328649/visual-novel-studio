import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { createProject, projectSchema, type Project } from '../src/core/model';
import { currentScriptText } from '../src/core/script-text';
import { dialogueMarkupRows, quotedTextMarkupDeclaration, readMarkedRow } from '../src/core/text-spans';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { saveProject } from '../src/desktop/project-store';
import { buildProject, spawnRenpy } from '../src/runtime/service';
import { pythonLiteral } from '../src/runtime/literals';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { flowRuntimeTraceSource, recordFlowNativeResult } from './lib/flow-runtime-verification';
import { openStoryMode } from './lib/story-workspace';
import { preserveRenpyScreenshots } from './lib/text-typography';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

// Pending coordinated validation. This script authors and plays only its own
// synthetic project, after all product changes, shared checks and editor build.
if (process.env.VNS_INSTALLED_EXE) throw new Error('请使用隔离的源码构建版验收。');
if (process.env.VNS_TEST_ROOT) throw new Error('本专项不允许替代测试根目录。');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
assert.equal(path.resolve(process.cwd()).toLowerCase(), root.toLowerCase());
const output = path.join(root, 'artifacts/code-health-review-2026-11-14/text-integration', `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`);
const projectDir = path.join(output, 'project'), profile = path.join(output, 'profile'), game = path.join(output, 'game');
const projectFile = path.join(projectDir, 'project.vns.json'), sdk = path.join(root, 'resources/runtime');
const evidence = path.join(output, 'evidence'), screenshots = path.join(output, 'screenshots');
const previousSaves = process.env.RENPY_PATH_TO_SAVES;
const wholeId = 'qa_whole', bracketId = 'qa_brackets', legacyId = 'qa_legacy';
const originalWords = '甲〖乙〗丙', editedWords = '甲〖改写乙〗丙';
const legacyRow = '〖"旧\\n原文"|粗体〗〗〗〖〖停顿=1〗';
const legacyExpected: ReturnType<typeof readMarkedRow> = { text: '"旧\\n原文"〗〗〖停顿=1〗', spans: [{ start: 0, end: 7, style: { bold: true } }], pauses: [] };
const checks: { name: string; elapsedMs: number }[] = [], pageErrors: string[] = [];
const processes: { kind: string; pid?: number; exited: boolean; exitCode: number | null; signalCode: string | null }[] = [];
const report: Record<string, unknown> = { status: 'running', output, checks, pageErrors, processes,
  scope: '模块选择字面括号设置样式、带引号正文编辑、错误草稿保护、整句属性、保存真正重开、真实RenPy文字和样式；仅合成工程和SDK字体。' };
let app: ElectronApplication | undefined, page: Page | undefined, child: ChildProcess | undefined, traceStarted = false;
let nativeChild: ChildProcess | undefined, compiledOnClose = false, nativeEvidencePreserved = false, closeTimedOut = false;
let validVisibleSource = '', finalProject: Project | undefined;
const inside = (parent: string, childPath: string) => {
  const relative = path.relative(parent, childPath);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};
const lines = (project: Project) => project.nodes.flatMap(node => node.kind === 'passage' ? node.lines : []);
const line = (project: Project, id: string) => { const found = lines(project).find(item => item.id === id); assert.ok(found, id); return found; };
const textInput = () => page!.getByLabel('中文文本剧本', { exact: true });
const row = (id: string) => page!.locator('#line-' + id);
const writeReport = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const disk = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));

async function prepareOutput() {
  const workspace = await fs.realpath(root);
  let current = root;
  for (const part of path.relative(root, output).split(path.sep)) {
    current = path.join(current, part);
    const info = await fs.lstat(current).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; });
    if (current === output) assert.equal(info, undefined, '每次验收使用全新目录。');
    if (info) assert.ok(info.isDirectory() && !info.isSymbolicLink(), current);
    else await fs.mkdir(current);
    assert.ok(inside(workspace, await fs.realpath(current)), current);
  }
  await fs.mkdir(evidence); await fs.mkdir(screenshots);
}
async function check(name: string, action: () => Promise<void>) {
  report.phase = name; await writeReport(); const started = performance.now();
  await action(); checks.push({ name, elapsedMs: performance.now() - started }); await writeReport(); console.log('通过：' + name);
}
async function capture(name: string) {
  const bytes = await app!.evaluate(({ BrowserWindow }) => {
    return BrowserWindow.getAllWindows()[0].webContents.capturePage().then(image => {
      const size = image.getSize(), ratio = Math.min(1, 1280 / Math.max(size.width, size.height));
      return (ratio < 1 ? image.resize({ width: Math.round(size.width * ratio), height: Math.round(size.height * ratio), quality: 'best' }) : image).toPNG().toString('base64');
    });
  });
  const png = Buffer.from(bytes, 'base64'), dimensions = PNG.sync.read(png);
  assert.ok(Math.max(dimensions.width, dimensions.height) <= 1280);
  await fs.writeFile(path.join(screenshots, name + '.png'), png);
}
async function launch() {
  app = await launchDesktopFixture({ root, projectFile, profile }); child = app.process();
  processes.push({ kind: 'electron', pid: child.pid, exited: false, exitCode: child.exitCode, signalCode: child.signalCode });
  const actualAppPath = await app.evaluate(({ app }) => app.getAppPath());
  assert.equal((await fs.realpath(actualAppPath)).toLowerCase(), (await fs.realpath(root)).toLowerCase(), '验收必须运行本工作区的Electron源码构建。');
  page = await app.firstWindow(); page.setDefaultTimeout(20000); page.on('pageerror', error => pageErrors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText('字面括号文字集成验收', { timeout: 45000 });
  assert.equal(path.resolve(fileURLToPath(page.url())).toLowerCase(), path.join(root, 'dist/index.html').toLowerCase());
  await page.evaluate('globalThis.__name = value => value');
  const window = await app.browserWindow(page);
  await window.evaluate(current => { if (current.isMaximized()) current.unmaximize(); current.setContentSize(1280, 900); current.show(); current.focus(); current.webContents.setBackgroundThrottling(false); });
  await page.context().tracing.start({ screenshots: true, snapshots: true, sources: false }); traceStarted = true;
  await openStoryMode(page, 'script');
}
async function closeOwnedApp() {
  if (!app) return;
  const owned = app, ownedChild = child!, record = [...processes].reverse().find(item => item.kind === 'electron')!;
  const failures: unknown[] = [];
  if (traceStarted) {
    try { await owned.context().tracing.stop({ path: path.join(output, `editor-trace-${processes.filter(item => item.kind === 'electron').length}.zip`) }); }
    catch (error) { failures.push(error); }
    finally { traceStarted = false; }
  }
  let closeTimer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      owned.close(),
      new Promise<never>((_resolve, reject) => {
        closeTimer = setTimeout(() => { closeTimedOut = true; reject(new Error('本轮编辑器关闭超过15秒，保留验收目录。')); }, 15000);
      }),
    ]);
  } catch (error) { failures.push(error); }
  finally { clearTimeout(closeTimer); }
  try { await expect.poll(() => ownedChild.exitCode !== null || ownedChild.signalCode !== null, { timeout: 15000 }).toBe(true); }
  catch (error) { failures.push(error); }
  record.exited = ownedChild.exitCode !== null || ownedChild.signalCode !== null;
  record.exitCode = ownedChild.exitCode; record.signalCode = ownedChild.signalCode;
  if (record.exited) { app = undefined; page = undefined; child = undefined; }
  if (failures.length) throw new AggregateError(failures, '本轮编辑器trace或退出核对失败。');
}
async function save() {
  await page!.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page!.locator('.dirty-dot')).toHaveCount(0, { timeout: 30000 }); return disk();
}
async function selectWords(id: string, start: number, end: number) {
  const input = row(id).locator('.dialogue-input'); await input.click(); await input.press('Control+Home');
  for (let index = 0; index < start; index++) await input.press('ArrowRight');
  for (let index = start; index < end; index++) await input.press('Shift+ArrowRight');
  const toolbar = row(id).getByRole('toolbar', { name: '选中文字效果', exact: true }); await expect(toolbar).toBeVisible();
  await expect(toolbar.locator('.text-selection-words')).toHaveText(originalWords.slice(start, end)); return toolbar;
}
async function preview(id: string, words: string, expected: { color?: string; weight?: string; italic?: string }[]) {
  await row(id).locator('.dialogue-input').click();
  const text = page!.locator('.story-preview-content .ui-dialogue-preview .styled-text').first();
  await expect(text.locator('.styled-char')).toHaveText(Array.from(words));
  await expect.poll(() => text.locator('.styled-char-loop').evaluateAll(nodes => nodes.map(node => {
    const style = getComputedStyle(node); return { text: node.textContent, color: style.color, weight: style.fontWeight, italic: style.fontStyle };
  }))).toEqual(Array.from(words).map((character, index) => ({ text: character, color: expected[index]?.color ?? 'rgb(245, 247, 247)', weight: expected[index]?.weight ?? '400', italic: expected[index]?.italic ?? 'normal' })));
}
async function openCompleteText() {
  await openStoryMode(page!, 'text'); const toggle = page!.getByRole('button', { name: '隐藏演出', exact: true });
  if (await toggle.getAttribute('aria-pressed') === 'true') await toggle.click();
  await expect(textInput()).toBeVisible();
}
function assertValid(project: Project) {
  const source = project.scriptText?.content ?? projectToText(project), parsed = applyTextScript(project, source);
  assert.deepEqual(parsed.issues, []);
  for (const id of [wholeId, bracketId, legacyId]) {
    const current = line(project, id), next = line(parsed.project, id);
    assert.deepEqual([next.text, next.textSpans, next.textPresentation, next.actions], [current.text, current.textSpans, current.textPresentation, current.actions]);
  }
  assert.equal(source.split(quotedTextMarkupDeclaration).length - 1, 2);
  const legacy = line(project, legacyId);
  assert.deepEqual([legacy.text, legacy.textSpans], [legacyExpected.text, legacyExpected.spans]);
  assert.ok(dialogueMarkupRows(project, legacy, '旁白：').every(value => value !== quotedTextMarkupDeclaration));
  return parsed;
}
function nativeSource(project: Project) {
  const whole = line(project, wholeId), brackets = line(project, bracketId), old = line(project, legacyId);
  const allRedBold = Array.from(whole.text).map(character => [character, '#ff0000', true]);
  const bracketStyles = Array.from(brackets.text).map((character, index) => [character, index === 1 ? '#00ff00' : '#f5f7f7', index === 3]);
  return `
init -999 python:
    import renpy as _qa_engine
    _qa_engine.safe_mode_checked = True
${flowRuntimeTraceSource(output)}
init python:
    from renpy.text.textsupport import TEXT as QA_TEXT, TAG as QA_TAG, PARAGRAPH as QA_PARAGRAPH
    def qa_markup_snapshot(name=None):
        widget = renpy.get_widget("say", "what")
        if widget is None:
            return None
        current_color = Color(widget.style.color).hexcode[:7].lower()
        current_bold = bool(widget.style.bold)
        colors = []
        weights = []
        words = []
        characters = []
        for kind, value in widget.tokens:
            if kind == QA_TAG:
                tag = str(value)
                if tag.startswith("color="):
                    colors.append(current_color)
                    current_color = Color(tag.split("=", 1)[1]).hexcode[:7].lower()
                elif tag == "/color":
                    current_color = colors.pop()
                elif tag == "b":
                    weights.append(current_bold)
                    current_bold = True
                elif tag == "/b":
                    current_bold = weights.pop()
            elif kind == QA_TEXT:
                words.append(str(value))
                characters.extend([character, current_color, current_bold] for character in str(value))
            elif kind == QA_PARAGRAPH:
                words.append("\\n")
        result = dict(text="".join(words), characters=characters, tags=[str(value) for kind, value in widget.tokens if kind == QA_TAG], italic=bool(widget.style.italic), raw=str(widget.text))
        if name is not None:
            qa_trace(name, **result)
        return result
    def qa_markup_words(words):
        current = qa_markup_snapshot()
        return current is not None and current["text"] == words
testsuite global:
    before testcase:
        $ _test.timeout = 30.0
        $ _test.screenshot_directory = "tests/screenshots"
    after testcase:
        if not screen "main_menu":
            run MainMenu(confirm=False)
        pause until screen "main_menu"
    teardown:
        exit
testcase quoted_whole_span:
    click id "vn_main_start"
    pause until eval qa_markup_words(${pythonLiteral(whole.text)})
    pause .3
    assert eval qa_markup_snapshot()["text"] == ${pythonLiteral(whole.text)}
    assert eval qa_markup_snapshot()["characters"] == ${pythonLiteral(allRedBold)}
    assert eval qa_markup_snapshot()["italic"]
    assert eval "color=#ff0000" in qa_markup_snapshot()["tags"] and "b" in qa_markup_snapshot()["tags"]
    $ qa_markup_snapshot("whole-span")
    screenshot "native-whole-span.png"
testcase delimiter_only_and_legacy:
    click id "vn_main_start"
    advance until eval qa_markup_words(${pythonLiteral(brackets.text)})
    pause .3
    assert eval qa_markup_snapshot()["text"] == ${pythonLiteral(brackets.text)}
    assert eval qa_markup_snapshot()["characters"] == ${pythonLiteral(bracketStyles)}
    assert eval "color=#00ff00" in qa_markup_snapshot()["tags"] and "b" in qa_markup_snapshot()["tags"]
    assert eval not qa_markup_snapshot()["italic"]
    $ qa_markup_snapshot("delimiter-only")
    screenshot "native-delimiter-only.png"
    advance until eval qa_markup_words(${pythonLiteral(old.text)})
    pause .3
    assert eval qa_markup_snapshot()["text"] == ${pythonLiteral(old.text)}
    assert eval "b" in qa_markup_snapshot()["tags"]
    assert eval not qa_markup_snapshot()["italic"]
    $ qa_markup_snapshot("legacy-words")
`;
}
async function runNative(tests: string) {
  let log = '', timedOut = false;
  nativeChild = spawnRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), env: { RENPY_RENDERER: 'gl2' }, onData: text => { log = (log + text).slice(-1_000_000); } });
  const owned = nativeChild, record = { kind: 'renpy-test', pid: owned.pid, exited: false, exitCode: null as number | null, signalCode: null as string | null }; processes.push(record);
  const result = await new Promise<{ code: number; log: string }>(resolve => {
    const timer = setTimeout(() => { timedOut = true; owned.kill(); }, 120000);
    owned.once('error', error => { log += '\n' + String(error); });
    owned.once('close', code => { clearTimeout(timer); record.exited = true; record.exitCode = owned.exitCode; record.signalCode = owned.signalCode; nativeChild = undefined; resolve({ code: timedOut ? 124 : code ?? 1, log }); });
  });
  await fs.writeFile(path.join(output, 'native.log'), result.log);
  const native: Record<string, unknown> = {}; report.native = native; recordFlowNativeResult(native, tests, result, 2);
}
async function preserveNativeEvidence() {
  await preserveRenpyScreenshots(game, path.join(screenshots, 'native'));
  const copySources = async (directory: string, relative = ''): Promise<void> => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; })) {
      const source = path.join(directory, entry.name), next = path.join(relative, entry.name);
      if (entry.isDirectory() && !['assets', 'fonts', 'gui', 'saves', 'cache'].includes(entry.name)) await copySources(source, next);
      else if (entry.isFile() && (/\.rpy$/.test(entry.name) || /_tracesave|traceback|^errors\.txt$|^log\.txt$|^(?:test-)?report\.html$|^(?:source-map|build-manifest)\.json$/i.test(entry.name))) {
        const destination = path.join(evidence, 'generated', next); await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.copyFile(source, destination);
      }
    }
  };
  await copySources(game);
  const resize = async (directory: string): Promise<void> => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; })) {
      const source = path.join(directory, entry.name);
      if (entry.isDirectory()) await resize(source);
      else if (entry.name.endsWith('.png')) {
        const original = PNG.sync.read(await fs.readFile(source)), ratio = Math.min(1, 1280 / Math.max(original.width, original.height));
        if (ratio < 1) {
          const smaller = new PNG({ width: Math.round(original.width * ratio), height: Math.round(original.height * ratio) });
          for (let y = 0; y < smaller.height; y++) for (let x = 0; x < smaller.width; x++) {
            const from = (Math.min(original.height - 1, Math.floor(y / ratio)) * original.width + Math.min(original.width - 1, Math.floor(x / ratio))) * 4;
            original.data.copy(smaller.data, (y * smaller.width + x) * 4, from, from + 4);
          }
          await fs.writeFile(source, PNG.sync.write(smaller));
        }
      }
    }
  };
  await resize(screenshots); nativeEvidencePreserved = true;
}

await prepareOutput();
try {
  await fs.mkdir(path.join(output, 'renpy-saves')); process.env.RENPY_PATH_TO_SAVES = path.join(output, 'renpy-saves');
  assert.deepEqual(readMarkedRow(createProject(), legacyRow), legacyExpected, '旧语法中的引号和反斜杠不按JSON重新解释。');
  const project = createProject('字面括号文字集成验收'); project.id = 'qa_text_markup_code_health';
  project.characters = []; project.playerDefaults = { textSpeed: 0, masterVolume: 0 };
  project.resourceSettings = { directory: 'assets', importMode: 'copy', syncFolders: false };
  project.ui.pages = { say: { showQuickMenu: false } };
  await fs.mkdir(path.join(projectDir, 'assets'), { recursive: true });
  await fs.copyFile(path.join(sdk, 'sdk-fonts/SourceHanSansLite.ttf'), path.join(projectDir, 'assets/qa_font.ttf'));
  project.assets = [{ id: 'qa_font', name: '验收字体', kind: 'font', category: 'font', path: 'assets/qa_font.ttf' }];
  project.ui.components = [{ id: 'qa_dialogue', page: 'say', kind: 'text', binding: 'dialogue', text: '', x: .08, y: .72, width: .84, height: .21, style: { fontAssetId: 'qa_font', fontSize: 32, textColor: '#f5f7f7' } }];
  project.nodes.find(node => node.kind === 'passage')!.lines = [
    { id: wholeId, text: originalWords, actions: [], textPresentation: { speed: 'instant' } },
    { id: bracketId, text: originalWords, actions: [], textPresentation: { speed: 'instant' } },
    { id: legacyId, text: legacyExpected.text, textSpans: legacyExpected.spans, actions: [], textPresentation: { speed: 'instant' } },
    { id: 'qa_end', text: '文字验收结束。', actions: [], textPresentation: { speed: 'instant' } },
  ];
  const initialSource = projectToText(project).replace(dialogueMarkupRows(project, line(project, legacyId), '旁白：').join('\n'), '旁白：' + legacyRow);
  assert.ok(initialSource.includes('旁白：' + legacyRow)); project.scriptText = currentScriptText(initialSource); await saveProject(projectFile, project);
  await fs.copyFile(projectFile, path.join(evidence, 'initial.project.json')); await launch();

  await check('模块真实选择包含字面括号的整段，红色和粗体在每个字符生效', async () => {
    const toolbar = await selectWords(wholeId, 0, 5);
    await toolbar.getByLabel('局部文字颜色', { exact: true }).fill('#ff0000'); await toolbar.getByLabel('局部粗体', { exact: true }).click();
    await preview(wholeId, originalWords, Array.from(originalWords).map(() => ({ color: 'rgb(255, 0, 0)', weight: '700' })));
    const saved = await save(); assert.deepEqual(line(saved, wholeId).textSpans, [{ start: 0, end: 5, style: { color: '#ff0000', bold: true } }]);
    await capture('module-whole-span');
  });
  await check('两个字面括号独立设置效果，旧引号和反斜杠正文维持原解析含义', async () => {
    let toolbar = await selectWords(bracketId, 1, 2); await toolbar.getByLabel('局部文字颜色', { exact: true }).fill('#00ff00');
    toolbar = await selectWords(bracketId, 3, 4); await toolbar.getByLabel('局部粗体', { exact: true }).click();
    await preview(bracketId, originalWords, [{}, { color: 'rgb(0, 255, 0)' }, {}, { weight: '700' }, {}]);
    const saved = await save(); assertValid(saved);
    assert.deepEqual(line(saved, bracketId).textSpans, [{ start: 1, end: 2, style: { color: '#00ff00' } }, { start: 3, end: 4, style: { bold: true } }]);
    await capture('module-brackets');
  });
  await check('文本模式保留带引号标记，标记内禁止嵌套并可改写原文使范围增长', async () => {
    await openCompleteText(); const source = await textInput().inputValue();
    assert.equal(source.split(quotedTextMarkupDeclaration).length - 1, 2); assert.ok(source.includes('〖"甲〖乙〗丙"｜'));
    await textInput().evaluate(element => { const input = element as HTMLTextAreaElement, start = input.value.indexOf('甲〖乙〗丙') + 2; input.focus(); input.setSelectionRange(start, start + 1); input.dispatchEvent(new Event('select', { bubbles: true })); });
    await textInput().dispatchEvent('contextmenu', { button: 2, clientX: 400, clientY: 300 });
    await expect(page!.getByRole('menuitem', { name: '设为局部文字效果', exact: true })).toBeDisabled(); await page!.keyboard.press('Escape');
    await textInput().evaluate(element => { const input = element as HTMLTextAreaElement, start = input.value.indexOf('甲〖乙〗丙') + 2; input.focus(); input.setSelectionRange(start, start + 1); });
    await page!.keyboard.insertText('改写乙'); await expect(textInput()).toHaveValue(source.replace(originalWords, editedWords));
    await page!.getByRole('button', { name: '应用到项目', exact: true }).click(); await openStoryMode(page!, 'script');
    await preview(wholeId, editedWords, Array.from(editedWords).map(() => ({ color: 'rgb(255, 0, 0)', weight: '700' })));
    const saved = await save(); assertValid(saved); assert.deepEqual(line(saved, wholeId).textSpans, [{ start: 0, end: 7, style: { color: '#ff0000', bold: true } }]);
    await openCompleteText(); validVisibleSource = await textInput().inputValue(); await capture('quoted-text-edit');
  });
  await check('错误新语法保留可保存草稿，应用和模块切换均不替换有效故事', async () => {
    const before = await disk(), invalid = validVisibleSource.replace('〖"甲〖改写乙〗丙"｜', '〖"甲\\q〖改写乙〗丙"｜'); assert.notEqual(invalid, validVisibleSource);
    await textInput().fill(invalid); await page!.getByRole('button', { name: '应用到项目', exact: true }).click();
    await expect(page!.locator('.status-message')).toContainText('文本存在错误'); await openStoryMode(page!, 'script'); await expect(textInput()).toBeVisible();
    assert.equal(await textInput().inputValue(), invalid); const saved = await save();
    assert.deepEqual(saved.nodes, before.nodes); assert.ok(saved.scriptText!.content.includes('甲\\q〖改写乙〗丙'));
    assert.ok(applyTextScript(saved, saved.scriptText!.content).issues.some(issue => issue.severity === 'error'));
    await fs.copyFile(projectFile, path.join(evidence, 'invalid-draft.project.json')); await capture('invalid-draft');
    await textInput().fill(validVisibleSource); await page!.getByRole('button', { name: '应用到项目', exact: true }).click(); await openStoryMode(page!, 'script');
  });
  await check('整句斜体属性写回仍保留相邻格式声明，保存后真正关闭编辑器', async () => {
    const currentRow = row(wholeId), panel = currentRow.getByRole('region', { name: '第1行台词文字演出', exact: true });
    if (!await panel.isVisible()) await currentRow.getByRole('button', { name: '展开第1行台词文字演出', exact: true }).click();
    await panel.getByRole('tab', { name: '文字样式', exact: true }).click(); await panel.getByLabel('斜体', { exact: true }).check();
    await preview(wholeId, editedWords, Array.from(editedWords).map(() => ({ color: 'rgb(255, 0, 0)', weight: '700', italic: 'italic' })));
    finalProject = await save(); const parsed = assertValid(finalProject);
    assert.equal(line(finalProject, wholeId).textPresentation?.italic, true); assert.equal(line(parsed.project, wholeId).textPresentation?.italic, true);
    await fs.copyFile(projectFile, path.join(evidence, 'final.project.json')); await fs.writeFile(path.join(evidence, 'final-script.vns.txt'), finalProject.scriptText!.content);
    await capture('whole-line-property'); await closeOwnedApp();
  });
  await check('真正重新启动保留原文、字面括号样式、整句属性和有效文本', async () => {
    const saved = await disk(); await launch();
    await preview(wholeId, editedWords, Array.from(editedWords).map(() => ({ color: 'rgb(255, 0, 0)', weight: '700', italic: 'italic' })));
    await preview(bracketId, originalWords, [{}, { color: 'rgb(0, 255, 0)' }, {}, { weight: '700' }, {}]);
    await openCompleteText(); assert.ok((await textInput().inputValue()).includes('〖"甲〖改写乙〗丙"｜'));
    assert.deepEqual((await disk()).nodes, saved.nodes); assertValid(saved); await expect(page!.locator('.dirty-dot')).toHaveCount(0);
    await capture('reopened'); await closeOwnedApp(); assert.deepEqual(pageErrors, []); finalProject = await disk();
  });
  await check('保存工程实际编译RenPy，两类括号样式与旧文本原生显示、tokens和截图一致', async () => {
    assert.ok(finalProject); assertValid(finalProject);
    const result = await buildProject({ project: finalProject, projectDir, outputDir: game, sdkRoot: sdk }); compiledOnClose = true;
    report.build = { ok: result.ok, diagnostics: result.diagnostics, compileProcessClosed: true }; await fs.writeFile(path.join(output, 'compile.log'), result.log);
    assert.ok(result.ok, result.log + JSON.stringify(result.diagnostics));
    const tests = nativeSource(finalProject); await fs.writeFile(path.join(evidence, 'native-testcases.rpy'), tests); await fs.writeFile(path.join(game, 'game/testcases.rpy'), tests);
    await runNative(tests); await preserveNativeEvidence();
    for (const name of ['whole-span', 'delimiter-only', 'legacy-words']) {
      const trace = JSON.parse(await fs.readFile(path.join(output, 'traces', name + '.json'), 'utf8')); assert.equal(trace.name, name);
      assert.equal(trace.values.text, name === 'whole-span' ? editedWords : name === 'delimiter-only' ? originalWords : legacyExpected.text);
    }
    const nativeFiles = await fs.readdir(path.join(screenshots, 'native')); assert.ok(nativeFiles.includes('native-whole-span.png') && nativeFiles.includes('native-delimiter-only.png'));
  });
  assert.equal(checks.length, 7); report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error instanceof Error ? error.stack : String(error); process.exitCode = 1;
  if (app && page) await capture('failure').catch(() => undefined);
} finally {
  try { await closeOwnedApp(); } catch (error) { report.status = 'failed'; report.closeError = String(error); process.exitCode = 1; }
  try { if (!nativeChild && !nativeEvidencePreserved) await preserveNativeEvidence(); } catch (error) { report.status = 'failed'; report.evidenceError = String(error); process.exitCode = 1; }
  if (previousSaves === undefined) delete process.env.RENPY_PATH_TO_SAVES; else process.env.RENPY_PATH_TO_SAVES = previousSaves;
  try {
    if (app || nativeChild || processes.some(record => !record.exited)) throw new Error('本轮进程尚未确认退出，不清理工作目录。');
    if (closeTimedOut) throw new Error('本轮编辑器关闭曾超时，保留验收目录供排查。');
    if (!nativeEvidencePreserved && compiledOnClose) throw new Error('原生证据尚未保全，不清理游戏目录。');
    const cleanup = await cleanVerificationDirectories(output, ['project', 'profile', 'game', 'saves', 'renpy-saves']); report.cleanup = cleanup; assert.deepEqual(cleanup.errors, []);
  } catch (error) { report.status = 'failed'; report.cleanupError = String(error); process.exitCode = 1; }
  await writeReport(); console.log((report.status === 'passed' ? 'PASS: ' : 'FAIL: ') + path.join(output, 'report.json'));
  if (report.error) console.error(report.error);
}
