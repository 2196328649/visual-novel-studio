import assert from 'node:assert/strict';
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { createReadStream, promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { projectSchema } from '../src/core/model';
import { nativeEnvironment } from '../src/runtime/process-env';
import { openStoryMode } from './lib/story-workspace';

const root = path.resolve('.'), execute = promisify(execFile);
const { version } = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const zip = path.join(root, 'release', `Visual-Novel-Studio-${version}-portable-win-x64.zip`);
const output = path.join(root, 'artifacts/portable-verification', new Date().toISOString().replaceAll(':', '-'));
const run = await fs.mkdtemp('E:/VNS13Portable-');
const projectFile = path.join(run, '作品/project.vns.json'), exports = path.join(run, 'exports');
await fs.mkdir(output, { recursive: true }); await fs.mkdir(path.dirname(projectFile), { recursive: true }); await fs.mkdir(exports);
const digest = async (file: string) => { const hash = createHash('sha256'); for await (const data of createReadStream(file)) hash.update(data); return hash.digest('hex'); };
const powershell = path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const extract = (archive: string, destination: string) => execute(powershell, ['-NoProfile', '-NonInteractive', '-Command',
  "$ErrorActionPreference = 'Stop'\nAdd-Type -AssemblyName System.IO.Compression.FileSystem\n[System.IO.Compression.ZipFile]::ExtractToDirectory($env:VNS_QA_ZIP, $env:VNS_QA_DESTINATION)"],
  { windowsHide: true, timeout: 180_000, env: nativeEnvironment({ VNS_QA_ZIP: archive, VNS_QA_DESTINATION: destination }) });
let directory = path.join(run, `Visual-Novel-Studio-${version}`), app: ElectronApplication | undefined, page: Page | undefined, phase = 'extract';
const checks: string[] = [], errors: string[] = [], report: Record<string, unknown> = { status: 'running', version, zip, output, run };
const marker = '便携版保存并重启后，这句台词仍然保留。';
const launch = async () => {
  const env = nativeEnvironment({ PATH: `${process.env.SystemRoot}/System32;${process.env.SystemRoot}`, VNS_USER_DATA: path.join(run, 'ignored-profile'), VNS_RENPY_SDK: path.join(run, 'ignored-sdk'), VNS_DEV_URL: 'http://127.0.0.1:1' });
  const instance = await electron.launch({ executablePath: path.join(directory, 'Visual Novel Studio.exe'), args: [], cwd: directory, env, timeout: 180_000 });
  const actual = await instance.evaluate(({ app }) => ({ version: app.getVersion(), packaged: app.isPackaged, data: app.getPath('userData'), path: process.env.PATH }));
  assert.equal(actual.packaged, true); assert.equal(actual.version, version);
  assert.equal(path.resolve(actual.data).toLowerCase(), path.join(directory, 'data').toLowerCase());
  assert.equal(actual.path, env.PATH);
  const window = await instance.firstWindow(); window.on('pageerror', error => errors.push(error.message));
  await instance.evaluate(({ BrowserWindow, dialog }, locations) => {
    BrowserWindow.getAllWindows()[0].setContentSize(1520, 980);
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: locations.projectFile });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [locations.exports] });
  }, { projectFile, exports });
  return { instance, window, actual };
};
try {
  report.zipSha256 = await digest(zip);
  await extract(zip, run);
  assert.ok(!directory.toLowerCase().startsWith(root.toLowerCase()));
  assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'portable.json'), 'utf8')).version, version);
  assert.equal(await digest(path.join(directory, 'resources/app.asar')), await digest(path.join(root, 'release/win-unpacked/resources/app.asar')));
  phase = 'first portable launch';
  let launched = await launch(); app = launched.instance; page = launched.window; report.firstLaunch = launched.actual;
  await expect(page.locator('.project-title strong')).not.toBeEmpty();
  await expect(page.locator('html')).toHaveAttribute('data-editor-theme', 'codexDark');
  await page.getByRole('button', { name: '新建工程', exact: true }).click();
  await page.locator('.dialog').getByLabel('作品名称', { exact: true }).fill('便携版完整游戏验收');
  await page.locator('.dialog').getByLabel('工程模板', { exact: true }).selectOption('aihong');
  await page.getByRole('button', { name: '创建作品', exact: true }).click();
  await expect(page.locator('.project-title strong')).toHaveText('便携版完整游戏验收', { timeout: 60_000 });
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  const original = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
  const opening = original.nodes.find(node => node.id === 'opening'); assert.ok(opening?.kind === 'passage');
  assert.equal(original.ui.menuShortcutPage, 'preferences');
  phase = 'edit chapter and persist';
  await openStoryMode(page, 'text');
  const input = page.getByLabel('中文文本剧本', { exact: true });
  const source = await input.inputValue(); assert.ok(source.includes(opening.lines[0].text));
  await input.fill(source.replace(opening.lines[0].text, marker));
  await page.getByRole('button', { name: '应用到项目', exact: true }).click();
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  await page.getByRole('button', { name: '作品设置', exact: true }).click();
  await page.getByRole('button', { name: '编辑器外观', exact: true }).click();
  await page.getByRole('button', { name: /^亮白/ }).click();
  await page.getByRole('button', { name: '关闭作品设置', exact: true }).click();
  await page.screenshot({ path: path.join(output, 'portable-editor.png') });
  checks.push('便携 ZIP 在源码目录外全部解压；仅系统 PATH、没有 user-data-dir 参数即可启动，新建模板并保存章节修改。');
  await app.close(); app = undefined;

  phase = 'move folder and restart';
  const moved = path.join(run, '移动后的叙事工坊');
  for (const candidate of [directory, moved]) assert.ok(path.resolve(candidate).toLowerCase().startsWith(path.resolve(run).toLowerCase() + path.sep));
  await fs.rename(directory, moved); directory = moved;
  launched = await launch(); app = launched.instance; page = launched.window; report.restarted = launched.actual;
  await expect(page.locator('.project-title strong')).toHaveText(original.name);
  await expect(page.locator('html')).toHaveAttribute('data-editor-theme', 'codexLight');
  await expect(page.getByLabel('中文文本剧本', { exact: true })).toHaveValue(new RegExp(marker));
  checks.push('关闭后移动整个便携文件夹，再次启动恢复最近工程、章节、文本模式和亮白配色；数据始终在程序旁的 data。');

  phase = 'one-click export';
  await page.locator('.export-button').click();
  await page.getByLabel('导出文件名', { exact: true }).fill('Portable-Story');
  await expect(page.getByRole('button', { name: '一键配置', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '一键配置', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '导出环境已就绪' })).toBeVisible({ timeout: 180_000 });
  const environment = await page.evaluate(() => window.studio!.environment());
  assert.ok(environment.sdkPath?.toLowerCase().startsWith(path.join(directory, 'data').toLowerCase()));
  await page.screenshot({ path: path.join(output, 'portable-export-ready.png') });
  await page.getByRole('button', { name: '选择目录并导出', exact: true }).click();
  const gameZip = path.join(exports, `Portable-Story-${original.version}-win.zip`);
  await expect.poll(async () => {
    const failures = await page!.locator('.diagnostic.error').allTextContents(); assert.ok(!failures.length, failures.join('\n'));
    return fs.stat(gameZip).then(stat => stat.size, () => 0);
  }, { timeout: 240_000, intervals: [1000, 2000] }).toBeGreaterThan(1_000_000);
  await expect(page.locator('.export-button')).toBeEnabled({ timeout: 60_000 });
  const gameZipHash = await digest(gameZip);
  await app.close(); app = undefined;
  checks.push('由便携版界面一键修复私有运行时，并实际导出含原作模板资源和 Spine 的 Windows 游戏 ZIP。');

  phase = 'standalone game';
  const unpacked = path.join(run, 'game'); await extract(gameZip, unpacked);
  const folder = (await fs.readdir(unpacked, { withFileTypes: true })).find(entry => entry.isDirectory()); assert.ok(folder);
  const game = path.join(unpacked, folder.name), exe = path.join(game, 'Portable-Story.exe');
  await fs.access(exe);
  assert.equal(await fs.access(path.join(game, 'game/testcases.rpy')).then(() => true, () => false), false);
  await fs.writeFile(path.join(game, 'game/testcases.rpy'), `testsuite global:
    before testcase:
        $ _test.timeout = 25.0
        $ _test.transition_timeout = 0.1
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
        $ preferences.afm_enable = False
        $ preferences.set_volume("main", 0.0)
    teardown:
        exit

testcase portable_complete_game:
    assert screen "main_menu"
    screenshot "01-title.png"
    click id "vn_component_ai_title_plotmap"
    assert screen "flowchart"
    pause 0.2
    $ flow_view = renpy.get_widget("flowchart", "vn_component_ai_flowchart_items_viewport")
    $ flow_bar = renpy.get_widget("flowchart", "vn_component_ai_flowchart_items_scroll_x")
    assert eval renpy.get_widget("flowchart", "vn_component_ai_flowchart_items_scroll_y") is None
    assert eval flow_view.xadjustment.page == 1920 and flow_view.yadjustment.page == 736
    assert eval flow_bar.width == 733 and flow_bar.height == 31
    assert eval abs(flow_bar.thumb_dim / flow_bar.width - flow_view.xadjustment.page / (flow_view.xadjustment.range + flow_view.xadjustment.page)) < 0.01
    drag id "vn_component_ai_flowchart_items_scroll_x" pos (0.05, 0.5) to id "vn_component_ai_flowchart_items_scroll_x" pos (0.95, 0.5) steps 20
    assert eval flow_view.xadjustment.value > flow_view.xadjustment.range * 0.8
    screenshot "01-flow-end.png"
    click id "vn_component_ai_flowchart_back"
    assert screen "main_menu"
    click id "vn_component_ai_title_start"
    advance until ${JSON.stringify(marker)}
    assert ${JSON.stringify(marker)}
    keysym "K_ESCAPE"
    assert screen "preferences"
    screenshot "02-settings.png"
    keysym "K_ESCAPE"
    assert ${JSON.stringify(marker)}
    run FileSave("portable", confirm=False, slot=True)
    assert eval renpy.can_load("portable")
    advance until screen "choice"
    run FileLoad("portable", confirm=False, slot=True)
    assert ${JSON.stringify(marker)}
    screenshot "03-restored-dialogue.png"
    advance until screen "choice"
    click "记下劝告，放下酒坛"
    advance until screen "choice"
    click "沿墙慢行，辨认废井旁的小路"
    advance until screen "choice"
    click "入左屋，安分守己"
    advance until screen "choice"
    click "关好院门，先让她暖过来"
    advance until eval vn_performance_active and renpy.showing("vn_visual_ending_title")
    assert eval vn_current_node == "ai_ending_shelter"
    pause 0.7
    screenshot "04-shelter.png"
    pause until screen "main_menu"
    click id "vn_component_ai_title_start"
    advance until screen "choice"
    assert eval vn_var_ai_caution == 0 and vn_var_ai_route_known is False
    click "借酒压下心事"
    advance until screen "choice"
    click "随人流奔逃，先离开街口"
    advance until screen "choice"
    click "入右屋，窥视街道"
    advance until eval vn_performance_active and renpy.showing("vn_visual_ending_title")
    assert eval vn_current_node == "ai_ending_dream"
    pause 0.7
    screenshot "05-dream.png"
    pause until screen "main_menu"
    click id "vn_component_ai_title_start"
    advance until screen "choice"
    click "记下劝告，放下酒坛"
    advance until screen "choice"
    click "沿墙慢行，辨认废井旁的小路"
    advance until screen "choice"
    click "入左屋，安分守己"
    advance until screen "choice"
    click "收好盘缠，寻找避兵的小路"
    advance until eval vn_performance_active and renpy.showing("vn_visual_ending_title")
    assert eval vn_current_node == "ai_ending_boat"
    pause 0.7
    screenshot "06-boat.png"
    pause until screen "main_menu"
    assert eval "ai_story_boat" in persistent.vn_unlocks
    screenshot "07-return-title.png"
`);
  let log = '';
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(exe, ['--savedir', path.join(run, 'player-saves'), game, 'test', '--report-detailed'], { cwd: game, windowsHide: true,
      env: nativeEnvironment({ PATH: `${process.env.SystemRoot}/System32;${process.env.SystemRoot}`, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }), stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => child.kill(), 240_000);
    child.stdout.on('data', data => { log += data.toString(); }); child.stderr.on('data', data => { log += data.toString(); });
    child.on('error', error => { clearTimeout(timer); reject(error); }); child.on('close', code => { clearTimeout(timer); resolve(code ?? 1); });
  });
  await fs.writeFile(path.join(output, 'standalone.log'), log);
  assert.equal(exitCode, 0, log.slice(-6000)); assert.match(log, /Test cases\s*:\s*1\s*\|\s*1 passed/);
  assert.equal(await digest(gameZip), gameZipHash);
  assert.deepEqual(errors, []);
  checks.push('独立 EXE 在系统 PATH 下完成流程图尺寸与滚动、改稿对白、Esc 设置、真实存读档、三个结局及返回标题；交付 ZIP 字节未变。');
  report.status = 'passed';
  report.portable = { directory, executable: path.join(directory, 'Visual Novel Studio.exe'), data: path.join(directory, 'data'), asar: await digest(path.join(directory, 'resources/app.asar')) };
  report.game = { zip: gameZip, sha256: gameZipHash, exe, assertions: Number(log.match(/Assertions\s*:\s*(\d+)/)?.[1]), screenshots: path.join(game, 'tests/screenshots') };
} catch (error) {
  report.status = 'failed'; report.phase = phase; report.error = String(error);
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
  console.error(phase + ': ' + String(error).slice(0, 2500)); process.exitCode = 1;
} finally {
  await app?.close();
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ ...report, checks, errors }, null, 2));
}
console.log('REPORT ' + path.join(output, 'report.json'));
