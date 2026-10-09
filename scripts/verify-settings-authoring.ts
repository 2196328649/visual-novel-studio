/** Create settings and a branching confirmation using actual desktop controls. */
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assetFiles, createProject, projectSchema, type Project } from '../src/core/model';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packaged = process.argv.includes('--packaged');
const output = path.join(root, 'artifacts', packaged ? 'settings-packaged-verification' : 'settings-authoring-verification', new Date().toISOString().replaceAll(':', '-'));
const deployment = path.resolve(process.env.VNS_SETTINGS_AUTHORING_ROOT ?? 'E:/VNS-Settings-Authoring', randomUUID().slice(0, 8));
const input = path.join(deployment, 'project'), profile = path.join(deployment, 'profile'), exported = path.join(deployment, 'export');
const projectFile = path.join(input, 'project.vns.json');
const errors: string[] = [], checks: string[] = [], ids: Record<string, string> = {};
const report: Record<string, unknown> = { status: 'running', packaged, output, deployment, checks, errors, ids, fixture: '从空白界面开始，预先复制已有素材和角色；只替代系统导出目录选择。' };
let application: ElectronApplication | undefined, page: Page | undefined;
const saveReport = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
async function checkpoint(message: string) { checks.push(message); await saveReport(); console.log(message); }
async function run(executable: string, args: string[], cwd: string, env: Record<string, string> = {}) {
  return new Promise<{ code: number; log: string }>((resolve, reject) => {
    const child = spawn(executable, args, { cwd, windowsHide: true, env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = ''; const timer = setTimeout(() => child.kill(), 300000);
    child.stdout.on('data', data => { log += data; }); child.stderr.on('data', data => { log += data; });
    child.on('error', error => { clearTimeout(timer); reject(error); }); child.on('close', code => { clearTimeout(timer); resolve({ code: code ?? 1, log }); });
  });
}
async function uiPage(name: string) { await page!.locator('.ui-toolbar').getByRole('button', { name, exact: true }).click(); }
async function bounds(x: number, y: number, width: number, height: number) {
  for (const [label, value] of [['横向位置 %', x], ['纵向位置 %', y], ['宽度 %', width], ['高度 %', height]] as const) await page!.getByLabel(label, { exact: true }).fill(String(value));
}
async function selectedComponent() { return (await page!.locator('.ui-component.selected').getAttribute('data-component-id'))!; }
async function button(name: string, action: string, x: number, y: number, width = 32) {
  await page!.getByRole('button', { name: '添加按钮', exact: true }).click();
  const id = await selectedComponent();
  await page!.getByLabel('文字', { exact: true }).fill(name);
  await page!.getByLabel('点击行为', { exact: true }).selectOption(action);
  await bounds(x, y, width, 8);
  return id;
}
async function node(name: string) {
  await page!.getByLabel('搜索蓝图节点').fill(name);
  await page!.locator('.blueprint-library-node').getByText(name, { exact: true }).click();
  return (await page!.locator('.react-flow__node.selected').getAttribute('data-id'))!;
}
async function connect(from: string, pin: string, to: string, input = 'exec_in') {
  await page!.getByRole('button', { name: '框选全部节点', exact: true }).click();
  await page!.waitForFunction(() => {
    const box = document.querySelector('.generic-blueprint-workspace .flow-container')!.getBoundingClientRect();
    return [...document.querySelectorAll('.generic-blueprint-workspace .react-flow__node')].every(node => { const r = node.getBoundingClientRect(); return r.left >= box.left - 1 && r.right <= box.right + 1 && r.top >= box.top - 1 && r.bottom <= box.bottom + 1; });
  });
  await page!.locator(`.react-flow__node[data-id="${from}"] .react-flow__handle[data-handleid="${pin}"]`).click();
  await page!.locator(`.react-flow__node[data-id="${to}"] .react-flow__handle[data-handleid="${input}"]`).click();
}
async function save(): Promise<Project> {
  await page!.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  return projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
}

try {
  await fs.mkdir(output, { recursive: true }); await fs.mkdir(input, { recursive: true }); await fs.mkdir(profile, { recursive: true }); await fs.mkdir(exported, { recursive: true });
  const source = path.join(root, 'artifacts/aihong-template');
  const template = projectSchema.parse(JSON.parse(await fs.readFile(path.join(source, 'project.vns.json'), 'utf8')));
  const initial = createProject('玩家设置可视化创作');
  initial.assets = template.assets; initial.characters = template.characters;
  for (const relative of initial.assets.flatMap(assetFiles)) { const to = path.join(input, relative); await fs.mkdir(path.dirname(to), { recursive: true }); await fs.copyFile(path.join(source, relative), to); }
  await fs.writeFile(projectFile, JSON.stringify(initial, null, 2));
  await fs.writeFile(path.join(profile, 'workspace.json'), JSON.stringify({ path: projectFile }));
  if (packaged) await fs.cp(path.join(root, 'release/win-unpacked'), path.join(deployment, 'Studio'), { recursive: true });
  const executable = packaged ? path.join(deployment, 'Studio/Visual Novel Studio.exe') : require('electron');
  application = await electron.launch({ executablePath: executable, args: [...(packaged ? [`--user-data-dir=${profile}`] : [root]), '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], cwd: deployment,
    env: { ...process.env, VNS_DEV_URL: '', VNS_PROJECT_PATH: projectFile, VNS_USER_DATA: profile, VNS_RENPY_SDK: path.join(root, packaged ? 'nonexistent-settings-sdk' : 'resources/runtime') }, timeout: 120000 });
  page = await application.firstWindow({ timeout: 120000 }); page.on('pageerror', error => errors.push(error.message));
  await application.evaluate(({ BrowserWindow, dialog }, directory) => {
    BrowserWindow.getAllWindows()[0].setContentSize(1480, 940);
    dialog.showOpenDialog = (async (...args: unknown[]) => {
      const options = args.at(-1) as { title: string };
      if (options.title !== '选择游戏导出目录') throw new Error(`Unexpected dialog: ${options.title}`);
      return { canceled: false, filePaths: [directory] };
    }) as typeof dialog.showOpenDialog;
  }, exported);
  const environment = await application.evaluate(({ app }) => ({ packaged: app.isPackaged, appPath: app.getAppPath(), profile: app.getPath('userData') }));
  const runtimeEnvironment = await page.evaluate(() => window.studio!.environment());
  report.environment = { ...environment, ...runtimeEnvironment };
  expect(environment.packaged).toBe(packaged);
  if (packaged) {
    const within = (parent: string, child: string) => { const relative = path.relative(parent, child); return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };
    const realApp = await fs.realpath(environment.appPath), realSdk = await fs.realpath(runtimeEnvironment.sdkPath!);
    expect(within(root, realApp)).toBe(false);
    expect(within(root, realSdk)).toBe(false);
    expect(within(await fs.realpath(profile), realSdk)).toBe(true);
    expect(path.resolve(environment.profile).toLowerCase()).toBe(profile.toLowerCase());
    await fs.access(path.join(realSdk, 'lib/py3-windows-x86_64/python.exe'));
    report.executableSha256 = createHash('sha256').update(await fs.readFile(executable)).digest('hex');
    report.asarSha256 = createHash('sha256').update(await fs.readFile(realApp)).digest('hex');
    report.runtimeEntrySha256 = createHash('sha256').update(await fs.readFile(path.join(realSdk, 'renpy.py'))).digest('hex');
    await checkpoint('打包程序在开发目录外启动，忽略无效的开发 SDK 路径，使用独立配置中的自带运行时。');
  }
  await expect(page.locator('.project-title strong')).toHaveText(initial.name);
  await page.getByRole('button', { name: '界面', exact: true }).click();
  await uiPage('设置');
  const standard = page.locator('.ui-preferences-default');
  await expect(standard.getByRole('slider')).toHaveCount(8);
  for (const label of ['总音量', '环境音量', '对话框不透明度', '角色音量', '点击时停止', '持续到下一段配音', '640 × 360', '恢复初始设置']) await expect(standard.getByRole('button', { name: `编辑${label}`, exact: true })).toHaveCount(1);
  await standard.getByRole('button', { name: '编辑恢复初始设置', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'standard-settings-preview.png') });
  await page.getByLabel('当前页面布局', { exact: true }).selectOption('custom');
  await page.getByText('玩家初始设置', { exact: true }).click();
  await page.getByLabel('初始音乐音量', { exact: true }).fill('0.65');
  await page.getByLabel('初始角色单独音量', { exact: true }).fill('0.75');
  await page.getByText('玩家初始设置', { exact: true }).click();
  await page.getByLabel('添加标准组件', { exact: true }).selectOption('preference:musicVolume'); ids.music = await selectedComponent();
  await page.getByLabel('文字', { exact: true }).fill('音乐响度'); await bounds(8, 15, 42, 10);
  const originalSlider = template.ui.components.find(c => c.id === 'ai_settings_musicvolume')!.slider!;
  await page.getByLabel('滑条底图', { exact: true }).selectOption(originalSlider.trackId!);
  await page.getByLabel('滑块宽度', { exact: true }).fill('29');
  await page.getByText('滑块状态图片', { exact: true }).click();
  await page.getByLabel('普通滑块', { exact: true }).selectOption(originalSlider.thumb!.idle!);
  await page.getByLabel('按住滑块', { exact: true }).selectOption(originalSlider.thumb!.pressed!);
  await page.getByLabel('添加标准组件', { exact: true }).selectOption('preferenceChoice'); ids.resolution = await selectedComponent();
  await bounds(56, 15, 34, 8);
  await page.getByLabel('选项 1 文字', { exact: true }).fill('紧凑窗口');
  await page.getByLabel('下拉面板底图', { exact: true }).selectOption(template.ui.components.find(c => c.id === 'ai_settings_resolution')!.selector!.popupBackgroundId!);
  ids.voices = await button('角色音量', 'voiceSettings', 8, 31, 42);
  ids.reset = await button('恢复初始设置', 'resetPreferences', 8, 45, 42);
  ids.confirm = await button('询问并静音', 'return', 8, 59, 42);
  ids.back = await button('返回', 'return', 56, 82, 34);
  await page.screenshot({ path: path.join(output, 'authored-settings.png') });
  await uiPage('角色音量'); await page.getByLabel('当前页面布局', { exact: true }).selectOption('custom');
  await page.getByLabel('添加标准组件', { exact: true }).selectOption('preference:characterVolume'); ids.character = await selectedComponent();
  await page.getByLabel('配音角色', { exact: true }).selectOption('char_yu');
  await page.getByLabel('文字', { exact: true }).fill('穗的声音'); await bounds(10, 25, 60, 12);
  ids.voiceBack = await button('返回设置', 'return', 58, 80, 30);
  await uiPage('消息框'); await page.getByRole('button', { name: '创建确认框布局', exact: true }).click();
  await page.getByLabel('组件字号', { exact: true }).fill('26');
  await page.screenshot({ path: path.join(output, 'authored-confirmation.png') });
  await checkpoint('通过中文控件创建换肤滑条、下拉选项、角色音量页和可编辑确认框，设置真实类型的玩家初始值。');

  await page.getByRole('button', { name: '蓝图', exact: true }).click();
  await page.getByLabel('蓝图类型', { exact: true }).selectOption('graph');
  await page.getByRole('button', { name: '新建蓝图', exact: true }).click(); ids.graph = (await page.getByLabel('演出目标').inputValue()).slice(6);
  ids.event = (await page.locator('.react-flow__node').first().getAttribute('data-id'))!;
  await page.getByRole('button', { name: '输入与输出', exact: true }).click(); await page.getByLabel('蓝图名称', { exact: true }).fill('确认静音');
  ids.prompt = await node('显示确认框'); await page.getByLabel('提示文字', { exact: true }).fill('是否关闭音乐？ [说明] {说明}');
  ids.yes = await node('设置玩家选项'); await page.getByLabel('设置值', { exact: true }).fill('0');
  await page.locator('.react-flow__pane').click({ position: { x: 5, y: 5 } });
  ids.read = await node('读取玩家选项');
  ids.no = await node('设置玩家选项');
  await connect(ids.event, 'exec', ids.prompt); await connect(ids.prompt, 'yes', ids.yes); await connect(ids.prompt, 'no', ids.no); await connect(ids.read, 'value', ids.no, 'value');
  await page.screenshot({ path: path.join(output, 'authored-blueprint.png') });
  await page.getByRole('button', { name: '界面', exact: true }).click(); await uiPage('设置');
  await page.locator('.ui-hierarchy-row').filter({ hasText: '询问并静音' }).click();
  await page.getByLabel('点击行为', { exact: true }).selectOption('blueprint'); await page.getByLabel('调用蓝图', { exact: true }).selectOption(ids.graph);
  const saved = await save();
  expect(saved.playerDefaults?.musicVolume).toBe(0.65); expect(saved.playerDefaults?.characterVolume).toBe(0.75);
  expect(saved.blueprints![0].links).toHaveLength(4); expect(saved.ui.components.find(c => c.id === ids.character)?.preferenceCharacterId).toBe('char_yu');
  const yes = saved.ui.components.find(c => c.action === 'confirmYes')!, no = saved.ui.components.find(c => c.action === 'confirmNo')!;
  ids.confirmYes = yes.id; ids.confirmNo = no.id;
  await page.reload(); await expect(page.locator('.project-title strong')).toHaveText(saved.name);
  await page.getByRole('button', { name: '界面', exact: true }).click(); await uiPage('设置');
  await expect(page.locator(`.ui-component[data-component-id="${ids.music}"]`)).toHaveCount(1);
  await checkpoint('实际连接确认／取消执行线及设置值数据线，绑定按钮，保存重开后保留参数、素材和连线。');
  await page.getByRole('button', { name: '导出', exact: true }).click();
  await page.getByRole('dialog', { name: '作品设置', exact: true }).getByRole('button', { name: '选择目录并导出', exact: true }).click();
  await expect(page.locator('.status-message')).toContainText('游戏已导出', { timeout: 300000 });
  const zip = path.join(exported, `${saved.id}-${saved.version}-win.zip`);
  report.zip = zip; report.zipSha256 = createHash('sha256').update(await fs.readFile(zip)).digest('hex');
  const unpack = path.join(deployment, 'unpacked');
  const extracted = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Add-Type -AssemblyName System.IO.Compression.FileSystem\n[System.IO.Compression.ZipFile]::ExtractToDirectory($env:VNS_SETTINGS_ZIP, $env:VNS_SETTINGS_UNPACK)'], deployment, { VNS_SETTINGS_ZIP: zip, VNS_SETTINGS_UNPACK: unpack });
  expect(extracted.code, extracted.log).toBe(0);
  const game = path.join(unpack, (await fs.readdir(unpack, { withFileTypes: true })).find(entry => entry.isDirectory())!.name);
  const component = (id: string, suffix = '') => JSON.stringify(`vn_component_${id}${suffix}`);
  await fs.writeFile(path.join(game, 'game/testcases.rpy'), `testsuite global:
    before testcase:
        $ _test.timeout = 30.0
        $ _test.transition_timeout = 0.05
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit
testcase authored_settings_and_blueprint_in_export:
    assert screen "main_menu"
    assert eval abs(vn_preference_get("musicVolume") - 0.65) < 0.001
    click id "vn_main_preferences"
    assert screen "preferences"
    screenshot "settings.png"
    click id ${component(ids.confirm)}
    assert screen "confirm"
    screenshot "confirmation.png"
    click id ${component(ids.confirmNo)}
    assert eval abs(vn_preference_get("musicVolume") - 0.65) < 0.001
    click id ${component(ids.confirm)}
    click id ${component(ids.confirmYes)}
    assert eval vn_preference_get("musicVolume") == 0
    click id ${component(ids.reset)}
    assert screen "confirm"
    click id ${component(ids.confirmYes)}
    assert eval abs(vn_preference_get("musicVolume") - 0.65) < 0.001
    click id ${component(ids.music, '_control')} pos (0.4, 0.5)
    assert eval 0.3 < vn_preference_get("musicVolume") < 0.5
    click id ${component(ids.resolution, '_choice')}
    assert screen "vn_preference_popup"
    screenshot "dropdown.png"
    click id "vn_preference_option_0"
    pause until eval renpy.get_physical_size() == (640, 360)
    assert eval vn_preference_get("windowSize") == "640x360"
    click id ${component(ids.voices)}
    assert screen "voice_settings"
    click id ${component(ids.character, '_control')} pos (0.25, 0.5)
    assert eval 0.15 < vn_preference_get("characterVolume", "char_yu") < 0.35
    screenshot "character-volume.png"
    click id ${component(ids.voiceBack)}
    assert screen "preferences"
    click id ${component(ids.back)}
    assert screen "main_menu"
`);
  const tested = await run(path.join(game, `${saved.id}.exe`), ['--savedir', path.join(deployment, 'game-saves'), game, 'test', '--report-detailed'], game, { PATH: `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`, PYTHONHOME: '', PYTHONPATH: '', RENPY_BASE: '' });
  await fs.writeFile(path.join(output, 'export-runtime.log'), tested.log); expect(tested.code, tested.log.slice(-7000)).toBe(0); expect(tested.log).toContain('Status: PASSED');
  await fs.cp(path.join(game, 'tests/screenshots'), path.join(output, 'screenshots'), { recursive: true });
  await fs.copyFile(projectFile, path.join(output, 'saved-project.json'));
  report.assertions = Number(tested.log.match(/Assertions\s*:\s*(\d+)/)?.[1] ?? 0);
  await checkpoint('真实桌面导出包在开发目录外用自身 EXE 验证滑条、分辨率、角色音量、确认分支和恢复默认设置。');
  expect(errors).toEqual([]); report.status = 'passed'; await saveReport(); console.log(`Report: ${path.join(output, 'report.json')}`);
} catch (error) {
  report.status = 'failed'; report.error = error instanceof Error ? error.stack : String(error);
  if (page) { await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined); report.visibleText = await page.locator('body').innerText().catch(() => ''); }
  await fs.mkdir(output, { recursive: true }); await saveReport(); console.error(report.error); process.exitCode = 1;
} finally { await application?.close(); }
