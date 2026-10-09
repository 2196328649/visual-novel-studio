import { endingCaption, endingVisible, endingTestHelper } from './lib/ending-fixture';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { projectSchema } from '../src/core/model';
import { exportSettings } from '../src/core/export-settings';
import { exportProject } from '../src/runtime/game-export';
import { verifyExecutableIcon } from './lib/windows-icon';

const root = path.resolve('.'), execute = promisify(execFile);
const reuse = process.argv[2];
const output = reuse ? path.resolve(reuse) : path.join(root, 'artifacts/complete-game-export', new Date().toISOString().replaceAll(':', '-'));
if (reuse) assert.ok(output.startsWith(path.join(root, 'artifacts/complete-game-export') + path.sep));
const template = path.join(root, 'resources/templates/aihong');
const report: { status: string; steps: string[]; package?: string; executable?: string; bytes?: number; sha256?: string; screenshots?: string[]; error?: string } = { status: 'running', steps: [] };
const save = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
await fs.mkdir(output, { recursive: true });
try {
  const project = projectSchema.parse(JSON.parse(await fs.readFile(path.join(reuse ? output : template, 'project.vns.json'), 'utf8')));
  project.name = '哀鸿_导出验收';
  project.exportSettings = { ...exportSettings(project), platform: 'windows', fileName: '', iconAssetId: project.ui.components.find(c => c.id === 'ai_dialogue_plotmap')!.skin!.idle };
  if (!reuse) {
    await fs.writeFile(path.join(output, 'project.vns.json'), JSON.stringify(project, null, 2));
    const result = await exportProject({ project, projectDir: template, sdkRoot: path.join(root, 'resources/runtime'), spineRuntimeDir: path.join(root, 'resources/spine'), buildDir: path.join(output, 'build'), baselineDir: path.join(output, 'baseline'), outputDir: path.join(output, 'distribution'), onData: text => { if (/正在|已导出/.test(text)) console.log(text.trim()); } });
    await fs.writeFile(path.join(output, 'export.log'), result.log);
    assert.equal(result.ok, true, result.log + JSON.stringify(result.diagnostics));
  }
  const distribution = path.join(output, 'distribution');
  const archive = (await fs.readdir(distribution)).find(name => name.endsWith('.zip'))!;
  assert.ok(archive); report.package = path.join(distribution, archive);
  const bytes = await fs.readFile(report.package); report.bytes = bytes.length; report.sha256 = createHash('sha256').update(bytes).digest('hex');
  report.steps.push('由编辑器正式导出服务生成 Windows ZIP，保留独立运行时、原作界面图片、字体和骨骼动画库。'); await save();
  console.log('EXPORT PASS: ' + report.package);

  const unpacked = path.join(output, reuse ? 'unpacked-' + Date.now() : 'unpacked');
  await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Add-Type -AssemblyName System.IO.Compression.FileSystem\n[System.IO.Compression.ZipFile]::ExtractToDirectory($env:VNS_EXPORT_ARCHIVE, $env:VNS_EXPORT_UNPACKED)'], { windowsHide: true, env: { ...process.env, VNS_EXPORT_ARCHIVE: report.package, VNS_EXPORT_UNPACKED: unpacked }, timeout: 180000 });
  const folder = (await fs.readdir(unpacked, { withFileTypes: true })).find(entry => entry.isDirectory()); assert.ok(folder);
  const gameRoot = path.join(unpacked, folder.name);
  const executable = (await fs.readdir(gameRoot)).find(name => name.endsWith('.exe')); assert.ok(executable);
  report.executable = path.join(gameRoot, executable);
  const icon = verifyExecutableIcon(await fs.readFile(report.executable), await fs.readFile(path.join(output, 'build/icon.ico')));
  await fs.writeFile(path.join(output, 'executable-icon.png'), icon.largest);
  report.steps.push(`实际 Windows EXE 内的 ${icon.sizes.join('/')}px 图标资源与作者选择的图标逐字节相同。`);
  const originalGameFiles = await fs.readdir(path.join(gameRoot, 'game'));
  assert.ok(!originalGameFiles.some(name => /testcases|autosave|ai-settings|project\.vns/.test(name)));
  assert.ok(!originalGameFiles.some(name => name.endsWith('.rpy')));
  assert.ok(originalGameFiles.includes('story.rpyc'));
  assert.ok(!(await fs.readdir(gameRoot)).some(name => /source-map|build-manifest/.test(name)));
  assert.ok(!(await fs.readdir(path.join(gameRoot, 'lib'))).some(name => name.includes('i686')));
  assert.equal(executable, project.name + '.exe');
  report.steps.push('发布包不含工程脚本源码、调试映射、构建清单及 Windows 32 位运行库；空文件名使用中文作品名。');
  const ending = (id: string) => { const node = project.nodes.find(node => node.id === id); assert.ok(node?.kind === 'passage'); return JSON.stringify(endingCaption(project, node)); };
  const firstLine = project.nodes.find(node => node.id === 'opening'); assert.ok(firstLine?.kind === 'passage');
  // Ren'Py's selector-state equality recurses through animated skin displayables.
  // Send a real pointer click at the authored button center, then assert its menu.
  const clickComponent = (id: string) => { const c = project.ui.components.find(c => c.id === id)!; return '$ renpy.test.testmouse.click_mouse(1, ' + Math.round((c.x + c.width / 2) * project.width) + ', ' + Math.round((c.y + c.height / 2) * project.height) + ')'; };

  // Test code is added only to this extracted verification copy. The delivered
  // ZIP above remains a release build without test scripts or test save data.
  await fs.writeFile(path.join(gameRoot, 'game', 'testcases.rpy'), `${endingTestHelper}
define _test.timeout = 25.0

testsuite global:
    before testcase:
        $ _test.timeout = 25.0
        $ _test.transition_timeout = 0.1
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
        $ preferences.afm_enable = False
    teardown:
        exit

testcase standalone_complete_game:
    assert screen "main_menu"
    screenshot "01-title.png"
    click id "vn_component_ai_title_plotmap"
    assert screen "flowchart"
    ${project.ui.components.find(c => c.id === 'ai_flowchart_items')?.list?.flowShowControls === false ? 'assert eval renpy.get_widget("flowchart", "vn_component_ai_flowchart_items_zoom_in") is None' : 'click id "vn_component_ai_flowchart_items_zoom_in"'}
    pause 0.2
    screenshot "01-flowchart.png"
    click id "vn_component_ai_flowchart_back"
    assert screen "main_menu"
    click id "vn_component_ai_title_settings"
    assert screen "preferences"
    screenshot "02-options.png"
    click id "vn_component_ai_settings_buttonback"
    pause 0.2
    assert screen "main_menu"
    click id "vn_component_ai_title_start"
    advance until ${JSON.stringify(firstLine.lines[1].text)}
    assert screen "say"
    screenshot "03-game.png"
    ${clickComponent("ai_dialogue_save")}
    pause until screen "save"
    run FilePage(1)
    click id "vn_file_slot_1"
    pause 0.2
    if screen "confirm":
        click id "vn_component_ai_confirm_yes"
    pause until not screen "confirm"
    assert eval renpy.can_load("1-1")
    screenshot "04-save.png"
    click id "vn_file_page_2"
    pause until eval FileCurrentPage() == "2"
    assert eval not FileLoadable(1)
    click id "vn_file_page_1"
    pause until eval FileCurrentPage() == "1"
    assert eval FileLoadable(1)
    click id "vn_component_ai_save_back"
    pause until not screen "save"
    move pos (960, 540)
    advance until ${JSON.stringify(firstLine.lines[2].text)}
    ${clickComponent("ai_dialogue_load")}
    pause until screen "load"
    screenshot "05-load.png"
    click id "vn_file_slot_1"
    pause 0.2
    if screen "confirm":
        click id "vn_component_ai_confirm_yes"
    assert ${JSON.stringify(firstLine.lines[1].text)}
    advance until screen "choice"
    click "记下劝告，放下酒坛"
    advance until screen "choice"
    click "沿墙慢行，辨认废井旁的小路"
    advance until screen "choice"
    assert eval vn_var_ai_caution == 1 and vn_var_ai_route_known is True
    click "入左屋，安分守己"
    advance until screen "choice"
    click "关好院门，先让她暖过来"
    advance until eval ${endingVisible(project, 'ai_ending_shelter')}
    assert eval vn_current_node == "ai_ending_shelter"
    pause 0.7
    screenshot "06-ending-shelter.png"
    pause until screen "main_menu"
    screenshot "07-return-title.png"
    click id "vn_component_ai_title_start"
    advance until screen "choice"
    assert eval vn_var_ai_caution == 0 and vn_var_ai_route_known is False
    click "借酒压下心事"
    advance until screen "choice"
    click "随人流奔逃，先离开街口"
    advance until screen "choice"
    click "入右屋，窥视街道"
    advance until eval ${endingVisible(project, 'ai_ending_dream')}
    assert eval vn_current_node == "ai_ending_dream"
    pause 0.7
    screenshot "08-ending-dream.png"
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
    advance until eval ${endingVisible(project, 'ai_ending_boat')}
    assert eval vn_current_node == "ai_ending_boat"
    pause 0.7
    screenshot "09-ending-boat.png"
    pause until screen "main_menu"
    assert eval "ai_story_boat" in persistent.vn_unlocks
    $ open(config.basedir + "/standalone-passed.json", "w", encoding="utf-8").write('{"passed":true}')
`);
  console.log('Testing the exported EXE: ' + report.executable);
  let log = '';
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn(report.executable!, [gameRoot, 'test', '--report-detailed', '--savedir', path.join(output, 'saves')], { cwd: gameRoot, windowsHide: true, env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { child.kill(); reject(new Error('独立游戏验证超时。')); }, 240000);
    for (const stream of [child.stdout, child.stderr]) stream?.on('data', data => { const text = String(data); log = (log + text).slice(-1000000); if (text.includes('[rpytest]')) process.stdout.write(text); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve(code ?? 1); });
  });
  await fs.writeFile(path.join(output, 'standalone.log'), log);
  assert.equal(code, 0, log.slice(-6000));
  assert.equal(JSON.parse(await fs.readFile(path.join(gameRoot, 'standalone-passed.json'), 'utf8')).passed, true);
  report.screenshots = (await fs.readdir(path.join(gameRoot, 'tests/screenshots'))).filter(file => file.endsWith('.png')).map(file => path.join(gameRoot, 'tests/screenshots', file));
  report.steps.push('直接启动解压后的 EXE：标题、选项、剧情、真实存档与读取、三个分支结局、返回标题与重新开局均通过。');
  report.status = 'passed'; await save(); console.log('PASS: ' + path.join(output, 'report.json'));
} catch (error) {
  report.status = 'failed'; report.error = error instanceof Error ? error.stack ?? error.message : String(error); await save(); console.error(report.error); process.exitCode = 1;
}
