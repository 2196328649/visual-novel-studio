import { openDisclosure } from './lib/ui-disclosures';
import { openStoryMode } from './lib/story-workspace';
import { _electron as electron, expect, type ElectronApplication } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expectedVersion = JSON.parse(await fs.readFile(path.join(studio, 'package.json'), 'utf8')).version as string;
const baseline = process.argv.includes('--baseline');
const smoke = process.argv.includes('--smoke');
const install = process.argv.includes('--install');
const mode = baseline ? 'baseline' : smoke ? 'smoke' : 'upgrade';
const root = path.resolve(process.env.VNS_INSTALL_VERIFY_ROOT ?? 'E:/VNS-Release-Verification');
const executable = path.join(root, 'Studio', 'Visual Novel Studio.exe');
const output = path.join(root, 'reports', `${mode}-${new Date().toISOString().replaceAll(':', '-')}`);
const profile = path.join(root, 'profile');
const projectFile = path.join(root, 'upgrade-project', 'project.vns.json');
const exportDirectory = path.join(root, 'exports');
const checks: string[] = [];
const errors: string[] = [];
const games: { zip: string; sha256: string; executable: string; log: string }[] = [];
let application: ElectronApplication | undefined;
let phase = 'launch';
await fs.mkdir(output, { recursive: true });
await fs.access(executable);
const env: Record<string, string> = Object.fromEntries(Object.entries({ ...process.env, VNS_RENPY_SDK: path.join(root, 'nonexistent-sdk'), VNS_PROJECT_PATH: path.join(root, 'nonexistent-project.json'), VNS_DEV_URL: 'http://127.0.0.1:1' }).filter((entry): entry is [string, string] => entry[1] !== undefined));
delete env.ELECTRON_RUN_AS_NODE;

async function runExecutable(exe: string, args: string[], cwd: string, extraEnv: Record<string, string> = {}) {
  return new Promise<{ code: number; log: string }>((resolve, reject) => {
    const childEnv: NodeJS.ProcessEnv = { ...env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', ...extraEnv };
    for (const key of ['PYTHONHOME', 'PYTHONPATH', 'RENPY_BASE']) delete childEnv[key];
    const child = spawn(exe, args, { cwd, env: childEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    const timer = setTimeout(() => child.kill(), 180_000);
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => { log += chunk; });
    }
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve({ code: code ?? 1, log }); });
  });
}

async function verifyExport(zip: string, projectId: string, marker: string) {
  const digest = async () => createHash('sha256').update(await fs.readFile(zip)).digest('hex');
  const sha256 = await digest();
  const extraction = path.join(root, 'games', randomUUID().slice(0, 8));
  const unpacked = await runExecutable('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory($env:VNS_VERIFY_ZIP, $env:VNS_VERIFY_UNPACK)"], root,
    { VNS_VERIFY_ZIP: zip, VNS_VERIFY_UNPACK: extraction });
  if (unpacked.code !== 0) throw new Error(`Unpack failed: ${unpacked.log}`);
  const folders = (await fs.readdir(extraction, { withFileTypes: true })).filter(entry => entry.isDirectory());
  if (folders.length !== 1) throw new Error('Expected one game directory in the export.');
  const game = path.join(extraction, folders[0].name);
  if (game.toLowerCase().startsWith(studio.toLowerCase())) throw new Error('The exported game must run outside the development directory.');
  const executable = path.join(game, `${projectId}.exe`);
  for (const file of [executable, path.join(game, 'game', 'fonts', 'SourceHanSansLite.ttf'), path.join(game, 'LICENSE-RenPy.txt'), path.join(game, 'renpy', 'LICENSE.txt'), path.join(game, 'SAMPLE-CREDITS.md')]) await fs.access(file);
  for (const file of ['game/testcases.rpy', 'game/testcases.rpyc', 'game/saves', 'tests']) {
    if (await fs.access(path.join(game, file)).then(() => true, () => false)) throw new Error(`Test or save artifact leaked into the export: ${file}`);
  }
  const source = await fs.readFile(path.join(game, 'game', 'story.rpy'), 'utf8');
  if (!source.includes(marker) || source.includes('VNS_EVENT:')) throw new Error('The exported script has stale content or development instrumentation.');
  // The acceptance driver is added only to this disposable extraction.
  await fs.writeFile(path.join(game, 'game', 'testcases.rpy'), `testsuite global:
    before testcase:
        $ _test.timeout = 90.0
        $ _test.transition_timeout = 0.05
        $ preferences.text_cps = 0
    teardown:
        exit

testcase installed_text_and_saves:
    click id "vn_main_start"
    advance until ${JSON.stringify(marker)}
    assert ${JSON.stringify(marker)}
    screenshot "installed-text.png"
    run FileSave("installed_text", confirm=False, slot=True)
    assert eval renpy.can_load("installed_text")
    advance until screen "main_menu"
    assert screen "main_menu"
    run FileLoad("installed_text", confirm=False, slot=True)
    assert ${JSON.stringify(marker)}
    run MainMenu(confirm=False)
    assert screen "main_menu"
`);
  const result = await runExecutable(executable, ['--savedir', path.join(output, `saves-${projectId}`), game, 'test', '--report-detailed'], game,
    { PATH: `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}` });
  const log = path.join(output, `game-${projectId}.log`);
  await fs.writeFile(log, result.log);
  if (result.code !== 0 || !/Assertions\s*:\s*5\s*\|\s*5 passed/.test(result.log) || !/Test cases\s*:\s*1\s*\|\s*1 passed/.test(result.log)) throw new Error(`Installed export failed its real gameplay/save test: ${result.log}`);
  if (await digest() !== sha256) throw new Error('The acceptance test modified the exported ZIP.');
  games.push({ zip, sha256, executable, log });
  checks.push(`The installation's exported ${projectId} game ran from its own EXE outside the source tree with a system-only PATH, displayed the revised Chinese text, and passed save/load and return-to-menu checks (1 case, 5 assertions). The ZIP remained unchanged.`);
}

try {
  if (install) {
    if (baseline) throw new Error('--install cannot be combined with --baseline.');
    const installer = path.join(studio, 'release', `Visual Novel Studio Setup ${expectedVersion}.exe`);
    const digest = async (file: string) => createHash('sha256').update(await fs.readFile(file)).digest('hex');
    const record: Record<string, unknown> = { installer, installerSha256: await digest(installer), destination: path.join(root, 'Studio'), beforeAsarSha256: await digest(path.join(root, 'Studio/resources/app.asar')), projectSha256: await digest(projectFile) };
    const result = await runExecutable(installer, ['/S', '/currentuser', `/D=${path.join(root, 'Studio')}`], studio);
    await fs.writeFile(path.join(output, 'installer.log'), result.log);
    record.exitCode = result.code;
    record.afterAsarSha256 = await digest(path.join(root, 'Studio/resources/app.asar'));
    record.afterProjectSha256 = await digest(projectFile);
    await fs.writeFile(path.join(output, 'installation.json'), JSON.stringify(record, null, 2));
    if (result.code !== 0 || record.projectSha256 !== record.afterProjectSha256) throw new Error('NSIS upgrade failed or changed the saved project.');
    if (record.afterAsarSha256 !== await digest(path.join(studio, 'release/win-unpacked/resources/app.asar'))) throw new Error('Installed renderer does not match the current packaged renderer.');
    checks.push('The current NSIS installer upgraded the existing installation in place, returned success, preserved the project bytes, and installed the exact packaged renderer.');
  }
  application = await electron.launch({ executablePath: executable, args: [`--user-data-dir=${profile}`], cwd: root, env, timeout: 120_000 });
  const documents = path.join(root, 'documents');
  await fs.mkdir(documents, { recursive: true });
  await application.evaluate(({ app }, documents) => app.setPath('documents', documents), documents);
  const page = await application.firstWindow({ timeout: 120_000 });
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  const installed = await application.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion(), appPath: app.getAppPath(), userData: app.getPath('userData') }));
  const binaries: Record<string, string> = {};
  for (const file of ['Visual Novel Studio.exe', 'resources/app.asar']) binaries[file] = createHash('sha256').update(await fs.readFile(path.join(root, 'Studio', file))).digest('hex');
  if (!baseline && installed.version !== expectedVersion) throw new Error(`Expected upgraded version ${expectedVersion}, found ${installed.version}`);
  await fs.writeFile(path.join(output, 'environment.json'), JSON.stringify(installed, null, 2));
  if (!installed.packaged || installed.appPath.toLowerCase().startsWith(studio.toLowerCase())) throw new Error('Verification did not launch the independently installed application.');
  if (!baseline) {
    const installedResources = path.join(root, 'Studio', 'resources');
    for (const file of ['docs/user-guide.md', 'docs/text-authoring.md', 'docs/interaction-authoring.md', 'docs/player-settings.md', 'resources/THIRD-PARTY-NOTICES.txt', 'resources/runtime/LICENSE.txt', 'resources/example/project.vns.json', 'resources/templates/aihong/project.vns.json']) await fs.access(path.join(installedResources, file));
    const installedTemplate = await fs.readFile(path.join(installedResources, 'resources/templates/aihong/project.vns.json'));
    if (!installedTemplate.equals(await fs.readFile(path.join(studio, 'resources/templates/aihong/project.vns.json')))) throw new Error('Installed Aihong template differs from the current bundled template.');
    for (const file of ['launcher/log.txt', 'launcher/traceback.txt', 'launcher/game/saves']) {
      if (await fs.access(path.join(installedResources, 'resources', 'runtime', file)).then(() => true, () => false)) throw new Error(`Development runtime data leaked into the installer: ${file}`);
    }
    checks.push('The installer includes Chinese documentation, sample assets and required license notices, with development runtime logs and saves excluded.');
  }
  if (path.resolve(installed.userData).toLowerCase() !== profile.toLowerCase()) throw new Error(`Isolated profile was not honored: ${installed.userData}`);
  await expect(page.locator('.project-title strong')).not.toBeEmpty({ timeout: 120_000 });
  if (!baseline) {
    await page.getByRole('button', { name: '关于叙事工坊', exact: true }).click();
    await expect(page.locator('.dialog')).toContainText(`版本 ${expectedVersion}`);
    await page.locator('.dialog').getByRole('button', { name: '关闭', exact: true }).click();
  }
  const runtime = await page.evaluate(() => window.studio!.environment());
  if (!runtime.sdkPath?.toLowerCase().startsWith(profile.toLowerCase())) throw new Error(`Installed runtime is not isolated: ${runtime.sdkPath}`);
  await fs.access(path.join(runtime.sdkPath, 'lib', 'py3-windows-x86_64', 'python.exe'));
  checks.push('The installed EXE and bundled renderer ran outside the source tree, using an isolated profile and private bundled RenPy despite invalid development overrides.');
  // Only file chooser responses are supplied. All project edits use visible controls.
  await application.evaluate(({ dialog }, data) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: data.projectFile });
    dialog.showOpenDialog = async (...args: unknown[]) => {
      const options = args.at(-1) as { title?: string };
      return { canceled: false, filePaths: options.title?.endsWith('游戏导出目录') ? [data.exportDirectory] : [data.projectFile] };
    };
  }, { projectFile, exportDirectory });
  if (baseline) {
    phase = 'baseline project';
    await page.getByRole('button', { name: '新建工程', exact: true }).click();
    await page.locator('.dialog').getByLabel('作品名称', { exact: true }).fill('安装升级验收');
    await page.getByRole('button', { name: '创建作品', exact: true }).click();
    await expect(page.locator('.project-title strong')).toHaveText('安装升级验收');
    await page.getByLabel('第1行对白', { exact: true }).fill('旧版保存的中文对白，升级后继续编辑。');
    await page.getByRole('button', { name: '保存工程', exact: true }).click();
    await expect(page.locator('.dirty-dot')).toHaveCount(0, { timeout: 20_000 });
    const content = JSON.parse(await fs.readFile(projectFile, 'utf8'));
    await fs.writeFile(path.join(root, 'baseline-project.json'), JSON.stringify(content, null, 2));
    checks.push(`The ${installed.version} packaged application created and saved a Chinese project through its native UI for the upgrade check.`);
  } else if (smoke) {
    const verified = JSON.parse(await fs.readFile(path.join(studio, 'artifacts', 'installed-verification', 'upgrade-report.json'), 'utf8'));
    if (!verified.passed || JSON.stringify(verified.binaries) !== JSON.stringify(binaries)) throw new Error('Final installer binaries differ from the installation that passed full upgrade/game acceptance; a full rerun is required.');
    await openStoryMode(page, 'text');
    await expect.poll(() => page.getByRole('textbox', { name: '中文文本剧本', exact: true }).inputValue()).toContain('从今往后，我又有家了');
    checks.push('The final documentation-only installer update preserved the saved Word project and launched successfully; its executable and app.asar hashes exactly match the binaries that passed full upgrade and exported-game acceptance.');
  } else {
    phase = 'upgraded project';
    await expect(page.locator('.project-title strong')).toHaveText('安装升级验收');
    await openStoryMode(page, 'script');
    await expect(page.getByLabel('第1行对白', { exact: true })).toHaveValue('旧版保存的中文对白，升级后继续编辑。');
    const before = JSON.parse(await fs.readFile(path.join(root, 'baseline-project.json'), 'utf8'));
    const reopened = JSON.parse(await fs.readFile(projectFile, 'utf8'));
    if (JSON.stringify(before) !== JSON.stringify(reopened)) throw new Error('The upgrade modified the existing saved project before an edit.');
    checks.push('The upgraded installation automatically reopened the older Chinese project and preserved its saved content and identities.');
    await openStoryMode(page, 'text');
    const source = page.getByRole('textbox', { name: '中文文本剧本', exact: true });
    await source.fill((await source.inputValue()).replace('旧版保存的中文对白，升级后继续编辑。', '升级后的中文文本直接参与试玩与导出。'));
    const revisedSource = await source.inputValue();
    const revisedLine = revisedSource.slice(0, revisedSource.indexOf('升级后的中文文本直接参与试玩与导出。')).split('\n').length;
    await page.getByRole('button', { name: `转到第 ${revisedLine} 行`, exact: true }).click();
    await expect(page.locator('.story-preview-content')).toContainText('升级后的中文文本直接参与试玩与导出。');
    await page.screenshot({ path: path.join(output, 'installed-text.png') });
    phase = 'installed preview';
    await page.getByRole('button', { name: '试玩', exact: true }).click();
    await expect(page.locator('.play-workspace')).toHaveAttribute('data-preview-state', /running|failed/, { timeout: 60_000 });
    expect(await page.locator('.play-workspace').getAttribute('data-preview-state'), await page.locator('.play-placeholder').textContent().catch(() => '') ?? '').toBe('running');
    const previewRoot = path.join(profile, 'builds', before.id, 'preview');
    const previews = await Promise.all((await fs.readdir(previewRoot)).map(async id => ({ id, time: (await fs.stat(path.join(previewRoot, id))).birthtimeMs })));
    const latestPreview = previews.sort((a, b) => b.time - a.time)[0].id;
    const previewStory = await fs.readFile(path.join(previewRoot, latestPreview, 'game', 'story.rpy'), 'utf8');
    if (!previewStory.includes('升级后的中文文本直接参与试玩与导出。')) throw new Error('Installed preview used stale text.');
    checks.push('The installed editor launched its real bundled runtime using the unapplied Chinese text draft.');
    await page.getByRole('button', { name: '停止试玩（Shift+F5）', exact: true }).click();
    await openStoryMode(page, 'text');
    phase = 'installed export';
    await page.getByRole('button', { name: '导出', exact: true }).click();
    await page.getByRole('dialog', { name: '作品设置', exact: true }).getByRole('button', { name: '选择目录并导出', exact: true }).click();
    await expect(page.locator('.status-message')).toContainText('游戏已导出', { timeout: 300_000 });
    const zip = path.join(exportDirectory, `${before.id}-${before.version}-win.zip`);
    await fs.access(zip);
    await verifyExport(zip, before.id, '升级后的中文文本直接参与试玩与导出。');
    // Export/preview may leave the renderer on the last authored workspace tab.
    // Return to the text editor before applying the draft so the action is stable
    // across persisted editor view state.
    await openStoryMode(page, 'text');
    await page.getByRole('button', { name: '应用到项目', exact: true }).click();
    await expect(page.locator('.status-message')).toContainText('文本已应用到项目');
    await page.getByRole('button', { name: '保存工程', exact: true }).click();
    await expect(page.locator('.dirty-dot')).toHaveCount(0, { timeout: 20_000 });
    const after = JSON.parse(await fs.readFile(projectFile, 'utf8'));
    if (!after.nodes.some((node: { kind: string; lines?: { text: string }[] }) => node.lines?.some(line => line.text === '升级后的中文文本直接参与试玩与导出。'))) throw new Error('Installed save did not retain the text edit.');
    if (after.id !== before.id) throw new Error('The upgrade changed the project identity.');
    await fs.writeFile(path.join(output, 'export.json'), JSON.stringify({ zip, projectFile, projectId: before.id }, null, 2));
    checks.push('The upgraded installation exported a Windows game with its bundled runtime and saved the revised text without changing project identity.');
    phase = 'installed Word import';
    const wordProject = path.join(root, 'word-project', 'project.vns.json');
    const document = process.env.VNS_VERIFY_DOCX ?? 'C:/Users/LiuXiangdong/Downloads/琼.第一回：归（崇祯五年）.docx';
    await fs.access(document);
    await application.evaluate(({ dialog }, data) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: data.wordProject });
      dialog.showOpenDialog = async (...args: unknown[]) => {
        const title = (args.at(-1) as { title?: string }).title;
        return { canceled: false, filePaths: [title === '导入中文文本' ? data.document : title?.endsWith('游戏导出目录') ? data.exportDirectory : data.wordProject] };
      };
    }, { wordProject, document, exportDirectory });
    await page.getByRole('button', { name: '新建工程', exact: true }).click();
    await page.locator('.dialog').getByLabel('作品名称', { exact: true }).fill('安装版 Word 导入验收');
    await page.getByRole('button', { name: '创建作品', exact: true }).click();
    await expect(page.locator('.project-title strong')).toHaveText('安装版 Word 导入验收');
    await openStoryMode(page, 'text');
    await openDisclosure(page!, '文本文件'); await page.getByRole('button', { name: '导入文本', exact: true }).click();
    const importDialog = page.getByRole('dialog', { name: '导入文本', exact: true });
    await expect(importDialog).toContainText('227 句台词');
    await importDialog.getByRole('button', { name: '应用导入', exact: true }).click();
    await expect.poll(() => page.getByRole('textbox', { name: '中文文本剧本', exact: true }).inputValue()).toContain('从今往后，我又有家了');
    await page.getByRole('button', { name: '应用到项目', exact: true }).click();
    await expect(page.locator('.status-message')).toContainText('文本已应用到项目');
    await page.getByRole('button', { name: '保存工程', exact: true }).click();
    await expect(page.locator('.dirty-dot')).toHaveCount(0, { timeout: 20_000 });
    const imported = JSON.parse(await fs.readFile(wordProject, 'utf8'));
    const importedPassages = imported.nodes.filter((node: { kind: string }) => node.kind === 'passage');
    const lineCount = importedPassages.reduce((sum: number, node: { lines: unknown[] }) => sum + node.lines.length, 0);
    if (imported.characters.length !== 13 || importedPassages.length !== 6 || lineCount !== 227) throw new Error(`Installed Word import changed the expected document structure: ${imported.characters.length}/${importedPassages.length}/${lineCount}`);
    const visibleWordText = await page.getByRole('textbox', { name: '中文文本剧本', exact: true }).inputValue();
    await page.reload();
    await expect(page.locator('.project-title strong')).toHaveText(imported.name);
    await openStoryMode(page, 'text');
    await expect(page.getByRole('textbox', { name: '中文文本剧本', exact: true })).toHaveValue(visibleWordText);
    await page.screenshot({ path: path.join(output, 'installed-word.png') });
    checks.push('The independently installed DOCX parser imported the actual supplied Chinese Word document (13 characters, 6 passages, 227 lines) through native IPC; the applied and saved text survived renderer reload.');
    phase = 'installed Word revision and independent game';
    const wordMarker = '安装版用户文档改稿，导出后可继续阅读。';
    const wordRevision = visibleWordText.replace(/^(@结局[：:].*)$/m, `旁白：${wordMarker}\n$1`);
    if (!wordRevision.includes(wordMarker)) throw new Error('The imported script has no ending at which to insert the revision.');
    await page.getByRole('textbox', { name: '中文文本剧本', exact: true }).fill(wordRevision);
    const wordLine = wordRevision.slice(0, wordRevision.indexOf(wordMarker)).split('\n').length;
    await page.getByRole('button', { name: `转到第 ${wordLine} 行`, exact: true }).click();
    await expect(page.locator('.story-preview-content')).toContainText(wordMarker);
    await page.getByRole('button', { name: '导出', exact: true }).click();
    await page.getByRole('dialog', { name: '作品设置', exact: true }).getByRole('button', { name: '选择目录并导出', exact: true }).click();
    await expect(page.locator('.status-message')).toContainText('游戏已导出', { timeout: 300_000 });
    await verifyExport(path.join(exportDirectory, `${imported.id}-${imported.version}-win.zip`), imported.id, wordMarker);
  }
  await page.screenshot({ path: path.join(output, 'installed-editor.png') });
  if (errors.length) throw new Error(errors.join('\n'));
  const report = { passed: true, mode, installed, binaries, runtime, executable, projectFile, output, checks, games, errors };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await fs.mkdir(path.join(studio, 'artifacts', 'installed-verification'), { recursive: true });
  await fs.writeFile(path.join(studio, 'artifacts', 'installed-verification', `${mode}-report.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const page = application?.windows()[0];
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: false, phase, output, checks, games, errors, failure: String(error) }, null, 2));
  console.error(`${phase}: ${String(error).split('\n')[0]}`);
  console.log(output);
  process.exitCode = 1;
} finally { await application?.close().catch(() => undefined); }
