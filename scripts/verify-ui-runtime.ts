import { endingVisible, endingTestHelper } from './lib/ending-fixture';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectSchema, type Project, type UiComponent } from '../src/core/model';
import { buildProject, runRenpy } from '../src/runtime/service';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sdkRoot = path.join(appRoot, 'resources', 'runtime');
const exampleDir = path.join(appRoot, 'resources', 'example');
const outputRoot = path.join(appRoot, 'artifacts', 'ui-runtime-verification');
const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const runDir = path.join(outputRoot, runId);
const report: {
  runId: string;
  runtime: string;
  status: 'running' | 'passed' | 'failed';
  steps: { name: string; code: number; logPath: string }[];
  projects: string[];
  error?: string;
} = { runId, runtime: sdkRoot, status: 'running', steps: [], projects: [] };

async function writeReport(): Promise<void> {
  const content = JSON.stringify(report, null, 2) + '\n';
  await fs.writeFile(path.join(runDir, 'report.json'), content, 'utf8');
  await fs.writeFile(path.join(outputRoot, 'verification-report.json'), content, 'utf8');
}

async function recordStep(name: string, code: number, log: string): Promise<void> {
  const logPath = path.join(runDir, `${name}.log`);
  await fs.writeFile(logPath, log, 'utf8');
  report.steps.push({ name, code, logPath });
  await writeReport();
  console.log(`${name}: ${code === 0 ? 'PASS' : 'FAIL'} (${logPath})`);
  if (code !== 0) throw new Error(`${name} failed with status ${code}.\n${log.slice(-8000)}`);
}

function customize(project: Project): void {
  const small = project.width === 640;
  project.ui.fontSize = small ? 18 : 28;
  const fontSize = small ? 14 : 22;
  const style = { fontSize, textColor: '#f3f7f6', background: '#29403f', opacity: 0.96 };
  const components: UiComponent[] = [
    { id: 'main_title', page: 'main', kind: 'text', binding: 'title', text: '', x: 0.05, y: 0.07, width: 0.56, height: 0.14, style: { fontSize: small ? 26 : 44, textColor: '#ffffff' } },
    { id: 'speaker', page: 'say', kind: 'text', binding: 'speaker', text: '', x: 0.06, y: 0.69, width: 0.4, height: 0.09, style: { ...style, textColor: '#66dbc5' } },
    { id: 'dialogue', page: 'say', kind: 'text', binding: 'dialogue', text: '', x: 0.06, y: 0.79, width: 0.88, height: 0.14, style },
    { id: 'say_settings', page: 'say', kind: 'button', action: 'preferences', text: 'Options', x: 0.79, y: 0.03, width: 0.17, height: 0.085, style },
    { id: 'choice_heading', page: 'choice', kind: 'text', text: 'Choose a route', x: 0.2, y: 0.13, width: 0.6, height: 0.08, style: { fontSize, textColor: '#ffffff', align: 'center' } },
    { id: 'choices', page: 'choice', kind: 'choiceList', text: '', x: 0.18, y: 0.23, width: 0.64, height: 0.3, style: { ...style, background: '#275c56', align: 'left' } },
    { id: 'slots', page: 'save', kind: 'saveSlots', text: '', x: 0.04, y: 0.34, width: 0.92, height: 0.57, style },
  ];
  for (const [index, action] of (['start', 'load', 'preferences', 'gallery', 'music', 'quit'] as const).entries()) {
    components.push({ id: `main_${action}`, page: 'main', kind: 'button', action, text: action, x: 0.65, y: 0.25 + index * 0.105, width: 0.28, height: 0.082, style });
  }
  for (const [index, preference] of (['textSpeed', 'autoForwardTime', 'musicVolume', 'soundVolume', 'voiceVolume'] as const).entries()) {
    components.push({ id: preference.toLowerCase(), page: 'preferences', kind: 'preference', preference, text: '',
      x: index % 2 ? 0.55 : 0.07, y: (small ? 0.34 : 0.25) + Math.floor(index / 2) * (small ? 0.14 : 0.16), width: 0.38, height: 0.105,
      style: { fontSize, textColor: '#f3f7f6' } });
  }
  for (const [action, x, y, width, text] of [
    ['window', 0.55, 0.59, 0.18, 'Window'], ['fullscreen', 0.75, 0.59, 0.18, 'Fullscreen'],
    ['mute', 0.55, 0.72, 0.38, 'Mute'], ['skipSeen', 0.07, 0.72, 0.18, 'Seen'],
    ['skipAll', 0.27, 0.72, 0.18, 'All'], ['transitions', 0.07, 0.84, 0.38, 'Transitions'],
    ['return', 0.65, 0.84, 0.28, 'Return'],
  ] as const) components.push({ id: action.toLowerCase(), page: 'preferences', kind: 'button', action, text, x, y: y + (small ? 0.055 : 0), width, height: 0.075, style });
  project.ui.components = components;
}

function testcases(project: Project): string {
  const opening = project.nodes.find(node => node.id === 'opening');
  const library = project.nodes.find(node => node.id === 'library');
  const choices = project.nodes.find(node => node.id === 'choice_help');
  const ending = project.nodes.find(node => node.id === 'ending_friend');
  if (opening?.kind !== 'passage' || library?.kind !== 'passage' || choices?.kind !== 'choice' || ending?.kind !== 'passage') throw new Error('Unexpected example structure.');
  return `testsuite global:
    before testcase:
        $ _test.timeout = 8.0
        $ _test.transition_timeout = 0.05
        $ preferences.text_cps = 0
        $ preferences.afm_enable = False
    teardown:
        exit

testcase custom_five_pages:
    assert eval (renpy.get_widget("main_menu", "vn_component_main_title") is not None)
    screenshot "custom-main.png"
    click id "vn_component_main_start"
    advance until ${JSON.stringify(opening.lines[1].text)}
    assert eval (renpy.get_widget("say", "who") is not None)
    assert eval (renpy.get_widget("say", "what") is not None)
    screenshot "custom-dialogue.png"
    advance until screen "choice"
    assert eval (renpy.get_widget("choice", "vn_component_choices") is not None)
    screenshot "custom-choice.png"
    click id "vn_component_choices_choice_0"
    pause until ${JSON.stringify(library.lines[0].text)}
    assert eval (vn_current_node == "library" and vn_var_affection == 1)
    click "存档"
    assert screen "save"
    assert eval (renpy.get_widget("save", "vn_component_slots") is not None)
    run FilePage(1)
    click id "vn_file_slot_1"
    assert eval renpy.can_load("1-1")
    screenshot "custom-save.png"
    click "返回游戏"
    click "读档"
    assert screen "load"
    assert eval (renpy.get_widget("load", "vn_component_slots") is not None)
    click id "vn_file_slot_1"
    if screen "confirm":
        click "确认"
    assert not screen "load"
    assert eval (vn_current_node == "library" and vn_var_affection == 1)
    click id "vn_component_say_settings"
    assert screen "preferences"
    assert eval all(renpy.get_widget("preferences", "vn_component_" + key + "_control") is not None for key in ["textspeed", "autoforwardtime", "musicvolume", "soundvolume", "voicevolume"])
    run Function(preferences.set_volume, "music", 1.0)
    screenshot "custom-preferences-before.png"
    click id "vn_component_musicvolume_control" pos (0.5, 0.5)
    pause until eval (preferences.get_volume("music") < 0.99)
    assert eval (0.0 < preferences.get_volume("music") < 0.99)
    assert eval (0.4 < MixerValue("music").get_mixer() / (1.0 if config.quadratic_volumes else config.volume_db_range) < 0.6)
    click id "vn_component_mute"
    assert eval preferences.get_mute("music")
    click id "vn_component_mute"
    assert eval not preferences.get_mute("music")
    screenshot "custom-preferences.png"
    click id "vn_component_return"
    assert not screen "preferences"
    assert eval (vn_current_node == "library" and vn_var_affection == 1)
    move id "what" pos (0.5, 0.5)
    advance until screen "choice"
    click id "vn_component_choices_choice_1"
    advance until eval ${endingVisible(project, ending)}
    assert eval (vn_current_node == "ending_friend" and vn_var_affection == 1)
    advance until screen "main_menu"
    click id "vn_component_main_preferences"
    assert screen "preferences"
    click id "vn_component_return"
    assert screen "main_menu"
`;
}

async function main(): Promise<void> {
  await fs.mkdir(runDir, { recursive: true });
  await writeReport();
  for (const [width, height] of [[1280, 720], [640, 360]]) {
    const project = projectSchema.parse(JSON.parse(await fs.readFile(path.join(exampleDir, 'project.vns.json'), 'utf8')));
    project.width = width;
    project.height = height;
    project.id = `project_ui_${width}`;
    customize(project);
    const outputDir = path.join(runDir, `${width}x${height}`);
    report.projects.push(outputDir);
    const compiled = await buildProject({ project, projectDir: exampleDir, sdkRoot, outputDir, development: false });
    await recordStep(`${width}-compile`, compiled.ok ? 0 : 1, compiled.log + '\n' + JSON.stringify(compiled.diagnostics));
    await fs.writeFile(path.join(outputDir, 'authored-project.json'), JSON.stringify(project, null, 2), 'utf8');
    await fs.writeFile(path.join(outputDir, 'game', 'testcases.rpy'), endingTestHelper + testcases(project), 'utf8');
    const lint = await runRenpy(sdkRoot, outputDir, ['lint']);
    await recordStep(`${width}-lint`, lint.code, lint.log);
    const tested = await runRenpy(sdkRoot, outputDir, ['test', '--report-detailed', '--report-skipped'], {
      savedir: path.join(outputDir, 'player-saves'), timeoutMs: 120_000, onData: text => process.stdout.write(text),
    });
    await recordStep(`${width}-custom-five-pages`, tested.code, tested.log);
    if (!/Test cases\s*:\s*1\s*\|\s*1 passed/.test(tested.log)) throw new Error('The custom UI testcase did not execute.');
  }
  report.status = 'passed';
  await writeReport();
  console.log(JSON.stringify(report, null, 2));
}

try { await main(); }
catch (error) {
  report.status = 'failed';
  report.error = error instanceof Error ? error.message : String(error);
  await fs.mkdir(runDir, { recursive: true });
  await writeReport();
  console.error(report.error);
  process.exitCode = 1;
}
