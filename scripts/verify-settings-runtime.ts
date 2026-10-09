import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectSchema, type BlueprintGraph, type BlueprintNode } from '../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { buildProject, runRenpy } from '../src/runtime/service';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sdk = path.join(root, 'resources/runtime'), template = path.join(root, 'artifacts/aihong-template');
const output = path.join(root, 'artifacts/settings-runtime-verification', new Date().toISOString().replaceAll(':', '-'));
const game = path.join(output, 'game'), saves = path.join(output, 'saves');
const report: Record<string, unknown> = { status: 'running', output, steps: [], screenshots: [] };
const save = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
async function step(name: string, result: { code: number; log: string }, assertions = false) {
  await fs.writeFile(path.join(output, `${name}.log`), result.log);
  (report.steps as unknown[]).push({ name, code: result.code, assertions: assertions ? Number(result.log.match(/Assertions\s*:\s*(\d+)/)?.[1] ?? 0) : undefined });
  await save(); console.log(`${name}: ${result.code === 0 ? 'PASS' : 'FAIL'}`);
  if (result.code !== 0 || assertions && (!result.log.includes('Status: PASSED') || !/Assertions\s*:\s*[1-9]/.test(result.log))) throw new Error(`${name}\n${result.log.slice(-7000)}`);
}
async function run(executable: string, args: string[], cwd: string, env: Record<string, string> = {}) {
  return new Promise<{ code: number; log: string }>((resolve, reject) => {
    const child = spawn(executable, args, { cwd, windowsHide: true, env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 240000);
    child.stdout.on('data', data => { log += data; }); child.stderr.on('data', data => { log += data; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve({ code: timedOut ? 124 : code ?? 1, log }); });
  });
}

try {
  await fs.mkdir(output, { recursive: true }); await save();
  const project = projectSchema.parse(JSON.parse(await fs.readFile(path.join(template, 'project.vns.json'), 'utf8')));
  project.id = `project_settings_${randomUUID().slice(0, 8)}`;
  report.projectId = project.id;
  project.playerDefaults = { musicVolume: 0.7, masterVolume: 0.9, soundVolume: 0, voiceVolume: 0.6, characterVolume: 0.8, ambientVolume: 0.4, dialogueOpacity: 0.85, voiceSustain: false, skipAll: false, fullscreen: false, windowSize: '1280x720' };
  const opening = project.nodes.find(n => n.id === 'opening');
  const audio = project.assets.find(a => a.kind === 'audio');
  if (opening?.kind !== 'passage' || opening.lines.length < 2 || !audio) throw new Error('The sample needs two opening lines and audio.');
  if (opening.lines.length < 3) opening.lines.push({ id: 'settings_unvoiced_line', text: '这一句没有新的配音。', speakerId: 'char_yu', actions: [] });
  report.fixture = '在示例副本中增加一条无配音对白，并用演示音频验证实际配音通道和停止方式。';
  opening.lines[1].voiceId = audio.id; opening.lines[1].speakerId = 'char_yu'; opening.lines[2].voiceId = undefined;
  project.variables.push({ id: 'settings_branch', name: '确认结果', type: 'number', initial: 0, persistent: false }, { id: 'settings_read', name: '蓝图读到的音量', type: 'number', initial: 0, persistent: false });
  const graph = createBlueprintGraph('ui', '设置运行验收'); graph.id = 'settings_verification';
  const node = (type: BlueprintNode['type'], id: string, properties: BlueprintNode['properties']) => {
    const n = blueprintNodeDefaults(type, graph.nodes.length); n.id = id; Object.assign(n.properties, properties); graph.nodes.push(n); return n;
  };
  const get = node('getPlayerPreference', 'settings_get', { preference: 'musicVolume' });
  const record = node('setVariable', 'settings_record', { variableId: 'settings_read', operation: 'set' });
  const confirm = node('confirmMessage', 'settings_prompt', { message: '确认 [原样文字] {原样文字}？' });
  const yes = node('setVariable', 'settings_yes', { variableId: 'settings_branch', operation: 'set', value: 1 });
  const no = node('setVariable', 'settings_no', { variableId: 'settings_branch', operation: 'set', value: 2 });
  const ambient = node('setPlayerPreference', 'settings_ambient', { preference: 'ambientVolume', value: 0.25 });
  const play = node('playSound', 'settings_play', { assetId: audio.id, channel: 'ambient', loop: true });
  const link = (from: BlueprintNode, pin: string, to: BlueprintNode, input = 'exec_in') => { const error = connectBlueprintPins(graph, from.id, pin, to.id, input); if (error) throw new Error(error); };
  project.blueprints!.push(graph); synchronizeBlueprintSignatures(project);
  link(graph.nodes[0], 'exec', record); link(get, 'value', record, 'value'); link(record, 'exec_out', confirm);
  link(confirm, 'yes', yes); link(confirm, 'no', no); link(yes, 'exec_out', ambient); link(ambient, 'exec_out', play);
  project.ui.components.push({ id: 'settings_test_button', kind: 'button', page: 'preferences', action: 'blueprint', blueprintId: graph.id, text: '确认框验收', x: 0.01, y: 0.87, width: 0.11, height: 0.07, style: { textColor: '#ffffff' } });
  const stopGraph = createBlueprintGraph('ui', '停止环境音'); stopGraph.id = 'settings_stop_audio';
  const stop = blueprintNodeDefaults('stopMusic'); stop.properties = { channel: 'ambient', fade: 0 };
  stopGraph.nodes.push(stop); connectBlueprintPins(stopGraph, stopGraph.nodes[0].id, 'exec', stop.id, 'exec_in');
  project.blueprints!.push(stopGraph);
  project.ui.components.push({ id: 'settings_stop_button', kind: 'button', page: 'preferences', action: 'blueprint', blueprintId: stopGraph.id, text: '停止环境音', x: 0.01, y: 0.75, width: 0.11, height: 0.07, style: { textColor: '#ffffff' } });
  await fs.writeFile(path.join(output, 'authored-project.json'), JSON.stringify(project, null, 2));
  const built = await buildProject({ project, projectDir: template, sdkRoot: sdk, outputDir: game, development: true });
  await step('compile', { code: built.ok ? 0 : 1, log: built.log + JSON.stringify(built.diagnostics) });
  const cases = `testsuite global:
    before testcase:
        $ _test.timeout = 30.0
        $ _test.transition_timeout = 0.05
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
        $ preferences.afm_enable = False
    teardown:
        exit

testcase authored_defaults_and_skinned_controls:
    assert screen "main_menu"
    assert eval abs(vn_preference_get("musicVolume") - 0.7) < 0.001
    assert eval abs(vn_preference_get("masterVolume") - 0.9) < 0.001
    assert eval vn_preference_get("soundVolume") == 0
    assert eval vn_preference_get("dialogueOpacity") == 0.85
    assert eval vn_preference_get("characterVolume", "char_yu") == 0.8
    click id "vn_component_ai_title_start"
    advance until ${JSON.stringify(opening.lines[1].text)}
    assert eval _voice.playing_info.tag == "vn_voice_char_yu"
    assert eval abs(renpy.music.get_channel("voice").chan_volume - 0.8) < 0.001
    run FileSave("settings_before", confirm=False, slot=True)
    click id "vn_component_ai_dialogue_config"
    assert screen "preferences"
    assert eval renpy.get_widget("preferences", "vn_component_ai_settings_musicvolume_control") is not None
    screenshot "settings-idle.png"
    move id "vn_component_ai_settings_musicvolume_control" pos (0.3, 0.5)
    run Function(renpy.test.testmouse.press_mouse, 1)
    pause 0.1
    assert eval renpy.display.focus.get_grab() is renpy.get_widget("preferences", "vn_component_ai_settings_musicvolume_control")
    assert eval renpy.get_widget("preferences", "vn_component_ai_settings_musicvolume_control").style.prefix == "selected_hover_"
    screenshot "settings-held-slider.png"
    run Function(renpy.test.testmouse.release_mouse, 1)
    assert eval renpy.display.focus.get_grab() is None
    assert eval 0.25 < vn_preference_get("musicVolume") < 0.35
    click id "vn_component_ai_settings_dialogueopacity_control" pos (0.3, 0.5)
    assert eval 0.25 < vn_preference_get("dialogueOpacity") < 0.35
    click id "vn_component_ai_settings_skip_skipall"
    assert eval vn_preference_get("skipAll") is True
    assert eval renpy.get_widget("preferences", "vn_component_ai_settings_skip_skipall").is_selected()
    click id "vn_component_ai_settings_skip_skipread"
    assert eval vn_preference_get("skipAll") is False
    click id "vn_component_ai_settings_voicestop_nextvoice"
    assert eval vn_preference_get("voiceSustain") is True
    click id "vn_component_ai_settings_characters"
    assert screen "voice_settings"
    screenshot "character-volumes.png"
    click id "vn_component_ai_voice_sui_slider_control" pos (0.3, 0.5)
    assert eval 0.25 < vn_preference_get("characterVolume", "char_yu") < 0.35
    assert eval vn_preference_get("characterVolume", "char_xia") == 0.8
    click id "vn_component_ai_voice_other_slider_control" pos (0.5, 0.5)
    assert eval 0.45 < vn_preference_get("characterVolume") < 0.55
    keysym "K_ESCAPE"
    assert screen "preferences"

testcase dropdown_display_and_confirmation_branches:
    click id "vn_component_ai_settings_resolution_choice"
    assert screen "vn_preference_popup"
    screenshot "resolution-dropdown.png"
    click pos (20, 20)
    assert not screen "vn_preference_popup"
    click id "vn_component_ai_settings_resolution_choice"
    click id "vn_preference_option_3"
    pause until eval vn_preference_get("windowSize") == "640x360"
    pause until eval renpy.get_physical_size() == (640, 360)
    assert eval vn_preference_get("windowSize") == "640x360"
    screenshot "settings-small-window.png"
    click id "vn_component_ai_settings_resolution_choice"
    click id "vn_preference_option_2"
    pause until eval vn_preference_get("windowSize") == "1280x720"
    pause until eval renpy.get_physical_size() == (1280, 720)
    click id "vn_component_ai_settings_isnotfullscreen_fullscreen"
    pause until eval vn_preference_get("fullscreen") is True
    assert eval not renpy.get_widget("preferences", "vn_component_ai_settings_resolution_choice").is_sensitive()
    click id "vn_component_ai_settings_isnotfullscreen_window"
    pause until eval vn_preference_get("fullscreen") is False
    assert eval renpy.get_widget("preferences", "vn_component_ai_settings_resolution_choice").is_sensitive()
    click id "vn_component_settings_test_button"
    assert screen "confirm"
    assert eval vn_var_settings_branch == 0
    assert eval abs(vn_var_settings_read - vn_preference_get("musicVolume")) < 0.001
    screenshot "blueprint-confirmation.png"
    click id "vn_component_ai_confirm_no"
    assert not screen "confirm"
    assert eval vn_var_settings_branch == 2
    assert eval vn_preference_get("ambientVolume") == 0.4
    click id "vn_component_settings_test_button"
    click id "vn_component_ai_confirm_yes"
    assert not screen "confirm"
    assert eval vn_var_settings_branch == 1
    assert eval vn_preference_get("ambientVolume") == 0.25
    assert eval renpy.music.get_playing(channel="ambient") == ${JSON.stringify(audio.path)}
    assert eval renpy.music.get_channel("ambient").mixer == "ambient"
    click id "vn_component_settings_stop_button"
    pause until eval renpy.music.get_playing(channel="ambient") is None
    assert eval renpy.music.get_playing(channel="ambient") is None
    click id "vn_component_settings_test_button"
    click id "vn_component_ai_confirm_yes"
    pause until eval renpy.music.get_playing(channel="ambient") == ${JSON.stringify(audio.path)}
    assert eval renpy.music.get_playing(channel="ambient") == ${JSON.stringify(audio.path)}
    click id "vn_component_ai_settings_buttonbacktitle"
    assert screen "confirm"
    keysym "K_ESCAPE"
    assert screen "preferences"
    click id "vn_component_ai_settings_buttonendgame"
    assert screen "confirm"
    click id "vn_component_ai_confirm_no"
    assert screen "preferences"

testcase preferences_survive_story_load_and_drive_voice:
    click id "vn_component_ai_settings_buttonback"
    assert screen "say"
    assert eval renpy.music.get_playing(channel="ambient") == ${JSON.stringify(audio.path)}
    run FileLoad("settings_before", confirm=False, slot=True)
    pause until ${JSON.stringify(opening.lines[1].text)}
    assert eval vn_var_settings_branch == 0 and vn_var_settings_read == 0
    assert eval 0.25 < vn_preference_get("musicVolume") < 0.35
    assert eval 0.25 < vn_preference_get("dialogueOpacity") < 0.35
    assert eval 0.25 < vn_preference_get("characterVolume", "char_yu") < 0.35
    assert eval vn_preference_get("ambientVolume") == 0.25
    assert eval vn_preference_get("voiceSustain") is True
    assert eval abs(renpy.music.get_channel("voice").chan_volume - vn_preference_get("characterVolume", "char_yu")) < 0.001
    screenshot "dialogue-player-opacity.png"
    move id "what" pos (0.5, 0.5)
    advance until ${JSON.stringify(opening.lines[2].text)}
    assert eval renpy.music.get_playing(channel="voice") == ${JSON.stringify(audio.path)}
    click id "vn_component_ai_dialogue_config"
    click id "vn_component_ai_settings_voicestop_click"
    click id "vn_component_ai_settings_buttonback"
    run FileLoad("settings_before", confirm=False, slot=True)
    move id "what" pos (0.5, 0.5)
    advance until ${JSON.stringify(opening.lines[2].text)}
    pause until eval renpy.music.get_playing(channel="voice") is None
    assert eval renpy.music.get_playing(channel="voice") is None
    click id "vn_component_ai_dialogue_config"
    click id "vn_component_ai_settings_initbutton"
    assert screen "confirm"
    screenshot "reset-confirmation.png"
    click id "vn_component_ai_confirm_no"
    assert eval vn_preference_get("ambientVolume") == 0.25
    click id "vn_component_ai_settings_initbutton"
    click id "vn_component_ai_confirm_yes"
    assert eval abs(vn_preference_get("musicVolume") - 0.7) < 0.001
    assert eval vn_preference_get("ambientVolume") == 0.4
    assert eval vn_preference_get("characterVolume", "char_yu") == 0.8
    assert eval vn_preference_get("dialogueOpacity") == 0.85
    assert eval vn_preference_get("voiceSustain") is False
    assert eval vn_preference_get("soundVolume") == 0
    click id "vn_component_ai_settings_musicvolume_control" pos (0.42, 0.5)
    click id "vn_component_ai_settings_dialogueopacity_control" pos (0.4, 0.5)
    assert eval 0.38 < vn_preference_get("musicVolume") < 0.45
    click id "vn_component_ai_settings_characters"
    click id "vn_component_ai_voice_sui_slider_control" pos (0.2, 0.5)
    assert eval 0.15 < vn_preference_get("characterVolume", "char_yu") < 0.25
    click id "vn_component_ai_voice_close"
    assert screen "preferences"
`;
  const persistence = `testsuite global:
    before testcase:
        $ _test.timeout = 15.0
    teardown:
        exit
testcase preferences_survive_a_new_process:
    assert screen "main_menu"
    assert eval 0.38 < vn_preference_get("musicVolume") < 0.45
    assert eval 0.35 < vn_preference_get("dialogueOpacity") < 0.45
    assert eval 0.15 < vn_preference_get("characterVolume", "char_yu") < 0.25
    click id "vn_component_ai_title_settings"
    assert screen "preferences"
    screenshot "preferences-after-relaunch.png"
`;
  const testFile = path.join(game, 'game/testcases.rpy');
  await fs.writeFile(testFile, cases);
  await step('lint', await runRenpy(sdk, game, ['lint'], { savedir: saves }));
  await step('settings-runtime', await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: saves, timeoutMs: 180000, onData: text => process.stdout.write(text) }), true);
  await fs.writeFile(testFile, persistence);
  await step('new-process-preferences', await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: saves, timeoutMs: 60000 }), true);
  await fs.writeFile(testFile, cases);
  if (process.argv.includes('--export')) {
    const deployed = path.resolve(process.env.VNS_SETTINGS_VERIFY_ROOT ?? 'E:/VNS-Settings-Verification', randomUUID().slice(0, 8));
    const zipDir = path.join(deployed, 'export'), unpack = path.join(deployed, 'game');
    await fs.mkdir(zipDir, { recursive: true });
    await step('windows-export', await runRenpy(sdk, path.join(sdk, 'launcher'), ['distribute', game, '--package', 'win', '--destination', zipDir], { timeoutMs: 300000 }));
    const zip = path.join(zipDir, `${project.id}-${project.version}-win.zip`);
    report.zip = zip; report.zipSha256 = createHash('sha256').update(await fs.readFile(zip)).digest('hex');
    await step('extract', await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Add-Type -AssemblyName System.IO.Compression.FileSystem\n[System.IO.Compression.ZipFile]::ExtractToDirectory($env:VNS_SETTINGS_ZIP, $env:VNS_SETTINGS_UNPACK)'], deployed, { VNS_SETTINGS_ZIP: zip, VNS_SETTINGS_UNPACK: unpack }));
    const child = (await fs.readdir(unpack, { withFileTypes: true })).find(item => item.isDirectory());
    if (!child) throw new Error('Exported game folder missing.');
    const exported = path.join(unpack, child.name), executable = path.join(exported, `${project.id}.exe`);
    await fs.writeFile(path.join(exported, 'game/testcases.rpy'), cases);
    const env = { PATH: `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`, PYTHONHOME: '', PYTHONPATH: '', RENPY_BASE: '' };
    const exportedSaves = path.join(deployed, 'saves');
    await step('standalone-settings', await run(executable, ['--savedir', exportedSaves, exported, 'test', '--report-detailed'], exported, env), true);
    await fs.writeFile(path.join(exported, 'game/testcases.rpy'), persistence);
    await step('standalone-relaunch', await run(executable, ['--savedir', exportedSaves, exported, 'test', '--report-detailed'], exported, env), true);
    report.executable = executable; report.executableSha256 = createHash('sha256').update(await fs.readFile(executable)).digest('hex');
  }
  report.screenshots = (await fs.readdir(path.join(game, 'tests/screenshots'))).filter(name => name.endsWith('.png')).map(name => path.join(game, 'tests/screenshots', name));
  report.status = 'passed'; await save(); console.log(`Report: ${path.join(output, 'report.json')}`);
} catch (error) {
  report.status = 'failed'; report.error = error instanceof Error ? error.stack : String(error);
  await fs.mkdir(output, { recursive: true }); await save(); console.error(report.error); process.exitCode = 1;
}
