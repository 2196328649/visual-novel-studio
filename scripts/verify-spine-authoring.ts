/** Product acceptance: author through Chinese desktop controls, export, then
 * run that exported EXE. Only the OS file/directory selections are supplied. */
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { assetFiles, projectSchema, type Project } from '../src/core/model';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packaged = process.argv.includes('--packaged');
const output = path.join(root, 'artifacts', packaged ? 'spine-packaged-verification' : 'spine-authoring-verification', new Date().toISOString().replaceAll(':', '-'));
const deployment = path.join(os.tmpdir(), `vns-spine-${randomUUID().slice(0, 8)}`);
const input = path.join(deployment, 'project'), profile = path.join(deployment, 'profile'), exportsDir = path.join(deployment, 'export');
const projectFile = path.join(input, 'project.vns.json');
const errors: string[] = [], checks: string[] = [], dialogs: string[] = [];
const ids: Record<string, string> = {};
let application: ElectronApplication | undefined, page: Page | undefined;
const report: Record<string, unknown> = { status: 'running', packaged, output, deployment, checks, errors, dialogs };
const saveReport = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
async function run(executable: string, args: string[], cwd: string, environment: Record<string, string> = {}) {
  return new Promise<{ code: number; log: string }>((resolve, reject) => {
    const child = spawn(executable, args, { cwd, windowsHide: true, env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', ...environment }, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = ''; const timer = setTimeout(() => child.kill(), 300_000);
    child.stdout.on('data', text => { log += String(text); }); child.stderr.on('data', text => { log += String(text); });
    child.once('error', error => { clearTimeout(timer); reject(error); }); child.once('close', code => { clearTimeout(timer); resolve({ code: code ?? 1, log }); });
  });
}
async function checkpoint(message: string) { checks.push(message); await saveReport(); console.log(message); }
async function save(): Promise<Project> {
  await page!.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  return projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
}
async function fit() {
  await page!.getByRole('button', { name: '框选全部节点', exact: true }).click();
  await page!.waitForFunction(() => {
    const bounds = document.querySelector('.generic-blueprint-workspace .flow-container')!.getBoundingClientRect();
    return [...document.querySelectorAll('.generic-blueprint-workspace .react-flow__node')].every(node => {
      const rect = node.getBoundingClientRect(); return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1 && rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1;
    });
  });
}
async function connect(from: string, fromPin: string, to: string, toPin: string) {
  await fit();
  await page!.locator(`.react-flow__node[data-id="${from}"] .react-flow__handle[data-handleid="${fromPin}"]`).click();
  await page!.locator(`.react-flow__node[data-id="${to}"] .react-flow__handle[data-handleid="${toPin}"]`).click();
}
async function node(name: string) {
  await page!.getByLabel('搜索蓝图节点').fill(name);
  await page!.locator('.blueprint-library-node').getByText(name, { exact: true }).click();
  return (await page!.locator('.react-flow__node.selected').getAttribute('data-id'))!;
}
async function graph(name: string) {
  await page!.getByRole('button', { name: '新建蓝图', exact: true }).click();
  const id = (await page!.getByLabel('演出目标').inputValue()).slice(6);
  const event = (await page!.locator('.react-flow__node').first().getAttribute('data-id'))!;
  await page!.getByRole('button', { name: '输入与输出', exact: true }).click();
  await page!.getByLabel('蓝图名称', { exact: true }).fill(name);
  return { id, event };
}
async function property(component: string, key: string, value: string | boolean) {
  const id = await node('设置组件属性');
  await page!.getByLabel('界面组件', { exact: true }).selectOption(component);
  await page!.getByLabel('组件属性', { exact: true }).selectOption(key);
  const field = page!.getByLabel('属性值', { exact: true });
  if (typeof value === 'boolean') await field.selectOption(String(value)); else await field.fill(value);
  return id;
}
async function uiComponent(kind: '文字' | '按钮', name: string, x: number, width: number, y = 3) {
  await page!.getByRole('button', { name: `添加${kind}`, exact: true }).click();
  const id = (await page!.locator('.ui-component.selected').getAttribute('data-component-id'))!;
  await page!.getByLabel('文字', { exact: true }).fill(name);
  for (const [label, value] of [['横向位置 %', x], ['纵向位置 %', y], ['宽度 %', width], ['高度 %', 5], ['组件字号', 24]] as const) await page!.getByLabel(label, { exact: true }).fill(String(value));
  return id;
}

try {
  await fs.mkdir(output, { recursive: true }); await fs.mkdir(profile, { recursive: true }); await fs.mkdir(exportsDir, { recursive: true });
  await fs.cp(path.join(root, 'artifacts/aihong-template'), input, { recursive: true });
  const initial = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
  initial.id = 'project_spine_authoring'; initial.name = '骨骼动画与蓝图验证'; initial.blueprints = [];
  initial.assets = initial.assets.filter(asset => asset.kind !== 'spine' && asset.kind !== 'video');
  initial.ui.components = initial.ui.components.filter(component => component.kind !== 'spine' && component.kind !== 'video');
  await fs.writeFile(projectFile, JSON.stringify(initial, null, 2));
  await fs.writeFile(path.join(profile, 'workspace.json'), JSON.stringify({ path: projectFile }));
  if (packaged) await fs.cp(path.join(root, 'release/win-unpacked'), path.join(deployment, 'Studio'), { recursive: true });
  application = await electron.launch({ executablePath: packaged ? path.join(deployment, 'Studio/Visual Novel Studio.exe') : require('electron'),
    args: [...(packaged ? [`--user-data-dir=${profile}`] : [root]), '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    env: { ...process.env, VNS_DEV_URL: '', VNS_PROJECT_PATH: projectFile, VNS_USER_DATA: profile, VNS_RENPY_SDK: path.join(root, 'resources/runtime') }, cwd: deployment, timeout: 120_000 });
  await application.firstWindow({ timeout: 120_000 });
  await application.evaluate(({ BrowserWindow, dialog }, paths) => {
    BrowserWindow.getAllWindows()[0].setContentSize(1480, 940);
    const recorded: string[] = []; (globalThis as any).__spineDialogs = recorded;
    dialog.showOpenDialog = (async (...args: unknown[]) => {
      const options = args.at(-1) as { title: string }; recorded.push(options.title);
      if (options.title.startsWith('导入骨骼动画')) return { canceled: false, filePaths: [paths.skeleton] };
      if (options.title.startsWith('为图集')) return { canceled: false, filePaths: [paths.texture] };
      if (options.title === '选择游戏导出目录') return { canceled: false, filePaths: [paths.exports] };
      throw new Error(`Unexpected file dialog: ${options.title}`);
    }) as typeof dialog.showOpenDialog;
    dialog.showSaveDialog = (async (...args: unknown[]) => {
      const options = args.at(-1) as { title: string }; recorded.push(options.title);
      if (options.title === '创建哀鸿界面工程') return { canceled: false, filePath: paths.preset };
      throw new Error(`Unexpected save dialog: ${options.title}`);
    }) as typeof dialog.showSaveDialog;
  }, { skeleton: 'E:/Project/Model/SLY/T/Assets/TextAsset/1.bytes', texture: 'E:/Project/Model/SLY/T/Assets/Texture2D/1_0.png', exports: exportsDir, preset: path.join(deployment, 'preset/project.vns.json') });
  page = await application.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  const appEnvironment = await application.evaluate(({ app }) => ({ packaged: app.isPackaged, appPath: app.getAppPath(), profile: app.getPath('userData') }));
  const runtimeEnvironment = await page.evaluate(() => window.studio!.environment());
  report.environment = { ...appEnvironment, ...runtimeEnvironment };
  expect(appEnvironment.packaged).toBe(packaged);
  if (packaged) {
    expect(path.resolve(appEnvironment.appPath).startsWith(root)).toBe(false);
    expect(path.resolve(runtimeEnvironment.sdkPath!).startsWith(profile)).toBe(true);
    report.binaries = Object.fromEntries(await Promise.all(['Visual Novel Studio.exe', 'resources/app.asar', 'resources/resources/spine/vns_spine.dll'].map(async file => [file, createHash('sha256').update(await fs.readFile(path.join(deployment, 'Studio', file))).digest('hex')])));
  }
  await expect(page.locator('.project-title strong')).toHaveText(initial.name);
  await page.getByRole('button', { name: '素材', exact: true }).click();
  await page.getByRole('button', { name: '导入骨骼动画', exact: true }).click();
  await expect(page.locator('.asset-spine-preview canvas')).toHaveAttribute('data-spine-state', 'playing', { timeout: 30_000 });
  await page.getByRole('button', { name: '暂停预览', exact: true }).click();
  await expect(page.locator('.asset-spine-preview canvas')).toHaveAttribute('data-spine-state', 'paused');
  const pausedAt = await page.locator('.asset-spine-preview canvas').getAttribute('data-spine-time');
  await page.waitForTimeout(120);
  expect(await page.locator('.asset-spine-preview canvas').getAttribute('data-spine-time')).toBe(pausedAt);
  await checkpoint('桌面素材库导入原始 1.bytes、图集和改名的 1_0.png；实时素材预览可暂停。');

  await page.getByRole('button', { name: '界面', exact: true }).click();
  await page.getByRole('button', { name: '添加骨骼动画', exact: true }).click();
  ids.rig = (await page.locator('.ui-component.spine.selected').getAttribute('data-component-id'))!;
  await page.getByLabel('组件名称', { exact: true }).fill('标题实时动画');
  for (const [label, value] of [['横向位置 %', 0], ['纵向位置 %', 0], ['宽度 %', 100], ['高度 %', 100]] as const) await page.getByLabel(label, { exact: true }).fill(String(value));
  await page.getByLabel('骨骼布局', { exact: true }).selectOption('manual');
  await page.getByLabel('骨骼缩放', { exact: true }).fill('0.32');
  await page.getByLabel('纵向原点 %', { exact: true }).fill(String(543 / 1080 * 100));
  await expect(page.locator('.ui-component.spine canvas')).toHaveAttribute('data-spine-state', 'playing');
  await page.getByLabel('显示层级', { exact: true }).fill('0.5');
  ids.pause = await uiComponent('按钮', '暂停动画', 4, 10);
  ids.resume = await uiComponent('按钮', '继续动画', 15, 10);
  ids.half = await uiComponent('按钮', '半速播放', 26, 10);
  ids.toggle = await uiComponent('按钮', '显示或隐藏', 37, 12);
  ids.reset = await uiComponent('按钮', '恢复动画', 50, 10);
  ids.status = await uiComponent('文字', '播放中', 4, 40, 9);
  await page.screenshot({ path: path.join(output, 'authored-ui.png') });
  await checkpoint('通过界面工具添加骨骼组件、恢复原点与缩放，并创建控制按钮和状态文字。');

  await page.getByRole('button', { name: '蓝图', exact: true }).click();
  await page.getByLabel('蓝图类型').selectOption('graph');
  for (const [key, title, paused] of [['pause', '暂停标题动画', true], ['resume', '继续标题动画', false]] as const) {
    const g = await graph(title); ids[`${key}Graph`] = g.id;
    let first = g.event;
    if (!paused) {
      first = await node('播放骨骼动画');
      await page.getByLabel('重新开始', { exact: true }).selectOption('false');
      await connect(g.event, 'exec', first, 'exec_in');
    }
    const pause = await node('暂停骨骼动画'); await page.getByLabel('暂停', { exact: true }).selectOption(String(paused));
    const status = await property(ids.status, 'text', paused ? '已暂停 [原始文字] {原始文字}' : '播放中');
    const selected = await property(ids.pause, 'selected', paused);
    await connect(first, first === g.event ? 'exec' : 'exec_out', pause, 'exec_in'); await connect(pause, 'exec_out', status, 'exec_in'); await connect(status, 'exec_out', selected, 'exec_in');
  }
  const half = await graph('标题动画半速'); ids.halfGraph = half.id;
  const speed = await node('设置动画速度'); await page.getByLabel('播放速度', { exact: true }).fill('0.5');
  const halfText = await property(ids.status, 'text', '半速播放');
  await connect(half.event, 'exec', speed, 'exec_in'); await connect(speed, 'exec_out', halfText, 'exec_in');
  const toggle = await graph('切换动画显示'); ids.toggleGraph = toggle.id;
  const get = await node('读取组件属性'); await page.getByLabel('界面组件', { exact: true }).selectOption(ids.rig);
  const branch = await node('条件分支');
  const hide = await property(ids.rig, 'visible', false);
  await page.locator('.react-flow__pane').click({ position: { x: 5, y: 5 } });
  const show = await property(ids.rig, 'visible', true);
  await connect(toggle.event, 'exec', branch, 'exec_in'); await connect(get, 'value', branch, 'condition');
  await connect(branch, 'true', hide, 'exec_in'); await connect(branch, 'false', show, 'exec_in');
  const reset = await graph('恢复初始动画'); ids.resetGraph = reset.id;
  const resetNode = await node('重置组件'); await page.getByLabel('界面组件', { exact: true }).selectOption(ids.rig);
  await connect(reset.event, 'exec', resetNode, 'exec_in');
  await page.screenshot({ path: path.join(output, 'authored-blueprint.png') });
  await checkpoint('从中文节点库创建暂停、继续、调速、读取属性与条件分支、重置蓝图，并实际连接执行线和数据线。');

  await page.getByRole('button', { name: '界面', exact: true }).click();
  for (const key of ['pause', 'resume', 'half', 'toggle', 'reset']) {
    await page.locator('.ui-hierarchy-row').filter({ hasText: ({ pause: '暂停动画', resume: '继续动画', half: '半速播放', toggle: '显示或隐藏', reset: '恢复动画' } as Record<string, string>)[key] }).click();
    await page.getByLabel('点击行为', { exact: true }).selectOption('blueprint');
    await page.getByLabel('调用蓝图', { exact: true }).selectOption(ids[`${key}Graph`]);
  }
  const saved = await save();
  expect(saved.blueprints).toHaveLength(5); expect(saved.assets.some(asset => asset.kind === 'video')).toBe(false);
  for (const file of assetFiles(saved.assets.find(asset => asset.kind === 'spine')!)) await fs.access(path.join(input, file));
  await page.reload(); await expect(page.locator('.project-title strong')).toHaveText(saved.name);
  await page.getByRole('button', { name: '界面', exact: true }).click();
  await expect(page.locator('.ui-component.spine canvas')).toHaveAttribute('data-spine-state', 'playing', { timeout: 20_000 });
  await checkpoint('按钮绑定蓝图后保存并重开，组件、骨骼配套文件、动画参数和连线完整保留。');
  await page.getByRole('button', { name: '导出', exact: true }).click();
  await page.getByRole('dialog', { name: '作品设置', exact: true }).getByRole('button', { name: '选择目录并导出', exact: true }).click();
  await expect(page.locator('.status-message')).toContainText('游戏已导出', { timeout: 300_000 });
  const zip = path.join(exportsDir, `${saved.id}-${saved.version}-win.zip`);
  report.zip = zip; report.zipSha256 = createHash('sha256').update(await fs.readFile(zip)).digest('hex');
  await checkpoint('桌面导出完成，开始使用导出包自己的 EXE 验证蓝图控制和存读档。');
  const unpacked = path.join(deployment, 'unpacked');
  const extraction = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Add-Type -AssemblyName System.IO.Compression.FileSystem\n[System.IO.Compression.ZipFile]::ExtractToDirectory($env:VNS_SPINE_ZIP, $env:VNS_SPINE_UNPACK)"], deployment, { VNS_SPINE_ZIP: zip, VNS_SPINE_UNPACK: unpacked });
  expect(extraction.code, extraction.log).toBe(0);
  const game = path.join(unpacked, (await fs.readdir(unpacked, { withFileTypes: true })).find(entry => entry.isDirectory())!.name);
  report.game = game;
  for (const file of ['game/python-packages/vns_spine.dll', 'game/python-packages/vns_spine.py', 'LICENSE-Spine.txt', ...saved.assets.filter(asset => asset.kind === 'spine').flatMap(assetFiles).map(file => `game/${file}`)]) await fs.access(path.join(game, file));
  const opening = saved.nodes.find(node => node.kind === 'passage')!;
  if (opening.kind !== 'passage') throw new Error('Missing demonstration dialogue.');
  await fs.writeFile(path.join(game, 'game/testcases.rpy'), `testsuite global:
    before testcase:
        $ _test.timeout = 15.0
        $ _test.transition_timeout = 0.05
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
    teardown:
        exit

testcase exported_spine_blueprint:
    assert screen "main_menu"
    pause until eval vn_spine_states[${JSON.stringify(ids.rig)}]["time"] > 0.1
    click id "vn_component_${ids.pause}"
    assert eval vn_spine_states[${JSON.stringify(ids.rig)}]["paused"]
    assert eval vn_ui_get(${JSON.stringify(ids.status)}, "text") == "已暂停 [原始文字] {原始文字}"
    assert eval vn_ui_get(${JSON.stringify(ids.pause)}, "selected")
    $ saved_animation_time = vn_spine_states[${JSON.stringify(ids.rig)}]["time"]
    screenshot "paused.png"
    pause 0.35
    assert eval vn_spine_states[${JSON.stringify(ids.rig)}]["time"] == saved_animation_time
    click id "vn_component_${ids.resume}"
    assert eval not vn_spine_states[${JSON.stringify(ids.rig)}]["paused"]
    assert eval not vn_ui_get(${JSON.stringify(ids.pause)}, "selected")
    pause until eval vn_spine_states[${JSON.stringify(ids.rig)}]["time"] > saved_animation_time + 0.05
    click id "vn_component_${ids.half}"
    assert eval vn_spine_states[${JSON.stringify(ids.rig)}]["speed"] == 0.5
    assert eval vn_ui_get(${JSON.stringify(ids.status)}, "text") == "半速播放"
    click id "vn_component_${ids.toggle}"
    assert eval not vn_ui_get(${JSON.stringify(ids.rig)}, "visible")
    assert eval renpy.get_widget("main_menu", "vn_spine_${ids.rig}") is None
    click id "vn_component_${ids.toggle}"
    assert eval vn_ui_get(${JSON.stringify(ids.rig)}, "visible")
    assert eval renpy.get_widget("main_menu", "vn_spine_${ids.rig}") is not None
    click id "vn_component_${ids.reset}"
    assert eval vn_spine_states[${JSON.stringify(ids.rig)}]["speed"] == 1
    pause until eval vn_spine_states[${JSON.stringify(ids.rig)}]["time"] > 0.15
    click id "vn_component_${ids.pause}"
    screenshot "blueprint-pause-selected.png"
    click id "vn_component_ai_title_start"
    advance until ${JSON.stringify(opening.lines[0].text)}
    $ vns_spine._test_expected_playback = dict(vn_spine_states[${JSON.stringify(ids.rig)}])
    assert eval vns_spine._test_expected_playback["time"] > 0
    run FileSave("spine_blueprint", confirm=False, slot=True)
    run Function(vn_run_blueprint, ${JSON.stringify(ids.resumeGraph)})
    assert eval not vn_spine_states[${JSON.stringify(ids.rig)}]["paused"]
    run FileLoad("spine_blueprint", confirm=False, slot=True)
    pause until ${JSON.stringify(opening.lines[0].text)}
    assert eval vn_spine_states[${JSON.stringify(ids.rig)}]["paused"]
    assert eval dict(vn_spine_states[${JSON.stringify(ids.rig)}]) == vns_spine._test_expected_playback
    assert eval vn_ui_get(${JSON.stringify(ids.status)}, "text") == "已暂停 [原始文字] {原始文字}"
    screenshot "loaded-with-spine-state.png"
`);
  const tested = await run(path.join(game, `${saved.id}.exe`), ['--savedir', path.join(deployment, 'game-saves'), game, 'test', '--report-detailed'], game, { PATH: `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`, PYTHONHOME: '', PYTHONPATH: '', RENPY_BASE: '' });
  await fs.writeFile(path.join(output, 'export-runtime.log'), tested.log);
  expect(tested.code, tested.log.slice(-6000)).toBe(0); expect(tested.log).toContain('Status: PASSED');
  await fs.cp(path.join(game, 'tests/screenshots'), path.join(output, 'screenshots'), { recursive: true });
  await fs.copyFile(projectFile, path.join(output, 'saved-project.json'));
  await fs.writeFile(path.join(output, 'authored-ids.json'), JSON.stringify(ids, null, 2));
  await checkpoint('导出 EXE 的真实按钮执行暂停、继续、半速、条件显示与重置；存读档恢复动画位置、暂停状态和界面属性。');
  await page.getByRole('button', { name: '关闭问题面板', exact: true }).click().catch(() => undefined);
  await page.getByRole('button', { name: '新建工程', exact: true }).click();
  await page.getByLabel('工程模板', { exact: true }).selectOption('aihong');
  await page.getByLabel('作品名称', { exact: true }).fill('可编辑的哀鸿界面');
  await page.getByRole('button', { name: '创建作品', exact: true }).click();
  await expect(page.locator('.project-title strong')).toHaveText('可编辑的哀鸿界面');
  const preset = projectSchema.parse(JSON.parse(await fs.readFile(path.join(deployment, 'preset/project.vns.json'), 'utf8')));
  expect(preset.id).not.toBe(initial.id); expect(preset.id).not.toBe('project_aihong_ui_template');
  expect(preset.ui.components.filter(component => component.kind === 'spine')).toHaveLength(1);
  expect(preset.blueprints!.filter(graph => graph.name.startsWith('标题动画'))).toHaveLength(4);
  expect(preset.assets.some(asset => asset.kind === 'video')).toBe(false);
  for (const relative of preset.assets.flatMap(assetFiles)) await fs.access(path.join(deployment, 'preset', relative));
  await page.getByRole('button', { name: '界面', exact: true }).click();
  await expect(page.locator('.ui-component.spine canvas')).toHaveAttribute('data-spine-state', 'playing');
  await page.screenshot({ path: path.join(output, 'new-project-template.png') });
  await checkpoint('新建工程的哀鸿模板在用户所选目录创建独立副本，全部配套资源、组件和四张控制蓝图可继续编辑。');
  await page.getByRole('button', { name: '试玩', exact: true }).click();
  await expect(page.locator('.status-message')).toContainText('试玩已启动', { timeout: 60_000 });
  await checkpoint('从新建模板启动真实试玩，运行库由当前桌面应用提供。');
  dialogs.push(...await application.evaluate(() => (globalThis as any).__spineDialogs));
  expect(errors).toEqual([]); report.status = 'passed'; await saveReport();
  console.log(JSON.stringify({ report: path.join(output, 'report.json'), projectFile, game }));
} catch (error) {
  report.status = 'failed'; report.error = error instanceof Error ? error.stack : String(error);
  if (page) { await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined); report.visibleText = await page.locator('body').innerText().catch(() => ''); }
  await saveReport(); console.error(report.error); process.exitCode = 1;
} finally { await application?.close(); }
