import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectSchema } from '../src/core/model';
import { buildProject, runRenpy } from '../src/runtime/service';
import { blueprintVerificationProject } from './fixtures/blueprint-project';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const example = path.join(root, 'resources', 'example');
const sdk = path.join(root, 'resources', 'runtime');
const runDir = path.join(root, 'artifacts', 'blueprint-runtime-verification', new Date().toISOString().replaceAll(':', '-'));
const buildDir = path.join(runDir, 'game');
const report: { status: string; steps: { name: string; code: number; logPath: string }[]; screenshots: string[]; error?: string } = { status: 'running', steps: [], screenshots: [] };
const saveReport = async () => fs.writeFile(path.join(runDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
async function step(name: string, result: { code: number; log: string }) {
  const logPath = path.join(runDir, `${name}.log`); await fs.writeFile(logPath, result.log);
  report.steps.push({ name, code: result.code, logPath }); await saveReport();
  console.log(`${name}: ${result.code === 0 ? 'PASS' : 'FAIL'}`);
  if (result.code !== 0) throw new Error(`${name} failed: ${result.log.slice(-7000)}`);
}
async function main() {
  await fs.mkdir(runDir, { recursive: true }); await saveReport();
  const sample = projectSchema.parse(JSON.parse(await fs.readFile(path.join(example, 'project.vns.json'), 'utf8')));
  const project = blueprintVerificationProject(sample);
  await fs.writeFile(path.join(runDir, 'authored-project.json'), JSON.stringify(project, null, 2));
  const compiled = await buildProject({ project, projectDir: example, sdkRoot: sdk, outputDir: buildDir, development: true });
  await step('compile', { code: compiled.ok ? 0 : 1, log: compiled.log + '\n' + JSON.stringify(compiled.diagnostics) });
  const background = project.assets.find(asset => asset.kind === 'image')!;
  const after = project.assets.filter(asset => asset.kind === 'image')[1];
  const audio = project.assets.find(asset => asset.kind === 'audio')!;
  await fs.writeFile(path.join(buildDir, 'game', 'testcases.rpy'), `testsuite global:
    before testcase:
        $ _test.timeout = 12.0
        $ _test.transition_timeout = 0.05
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
        $ preferences.afm_enable = False
        if not screen "main_menu":
            run MainMenu(confirm=False)
    teardown:
        exit

testcase chinese_blueprints_execute_and_restore:
    click id "vn_main_start"
    advance until "蓝图演出与计算已完成。"
    assert eval (vn_var_score == 6)
    assert eval (vn_var_nested_count == 6)
    assert eval (vn_var_first_result == 4 and vn_var_second_result == 10)
    assert eval (vn_var_received_flag is False and vn_var_received_word == "雨夜")
    assert eval (vn_bp_result_bp_call_first_doubled == 4 and vn_bp_result_bp_call_second_doubled == 10)
    assert eval (vn_bp_result_bp_call_first_flag is False and vn_bp_result_bp_call_second_flag is True)
    assert eval (vn_bp_result_bp_call_second_word_result == "")
    assert eval renpy.showing("vn_background_${background.id}")
    assert eval renpy.showing("vn_actor_bp_actor")
    assert eval (renpy.music.get_playing(channel="music") == ${JSON.stringify(audio.path.replaceAll('\\', '/'))})
    assert eval (renpy.music.get_playing(channel="sound") == ${JSON.stringify(audio.path.replaceAll('\\', '/'))})
    screenshot "blueprint-stage-and-values.png"
    run FileSave("blueprint_snapshot", confirm=False, slot=True)

    advance until screen "preferences"
    assert eval (vn_var_menu_returned is False)
    screenshot "blueprint-opened-settings.png"
    click "存档"
    pause until screen "save"
    click "设置"
    pause until screen "preferences"
    click id "vn_game_menu_return"
    pause until "设置菜单关闭后继续。"
    assert eval (vn_var_menu_returned is True)

    advance until "角色和音乐已经离场。"
    assert eval (not renpy.showing("vn_actor_bp_actor"))
    assert eval (renpy.music.get_playing(channel="music") is None)
    screenshot "blueprint-hidden-stopped.png"

    advance until "已进入目标场景。"
    assert eval (vn_current_scene == "bp_after_scene" and vn_scene_parameters["天气"] == "晴")
    assert eval (vn_pending_scene_transition is None)
    assert eval renpy.showing("vn_background_${after.id}")
    screenshot "blueprint-scene-transfer.png"

    run FileLoad("blueprint_snapshot", confirm=False, slot=True)
    pause until "蓝图演出与计算已完成。"
    assert eval (vn_var_score == 6 and vn_var_nested_count == 6)
    assert eval (vn_var_first_result == 4 and vn_var_second_result == 10)
    assert eval (vn_var_received_flag is False and vn_var_received_word == "雨夜")
    assert eval (vn_var_menu_returned is False)
    assert eval renpy.showing("vn_actor_bp_actor")
    assert eval (renpy.music.get_playing(channel="music") == ${JSON.stringify(audio.path.replaceAll('\\', '/'))})
    screenshot "blueprint-restored-save.png"
    run MainMenu(confirm=False)
    pause until screen "main_menu"
`);
  await step('lint', await runRenpy(sdk, buildDir, ['lint']));
  const tested = await runRenpy(sdk, buildDir, ['test', '--report-detailed', '--report-skipped'], { savedir: path.join(runDir, 'saves'), timeoutMs: 120000, onData: text => process.stdout.write(text) });
  await step('runtime', tested);
  if (!/Test cases\s*:\s*1\s*\|\s*1 passed/.test(tested.log)) throw new Error('The native blueprint testcase did not report success.');
  const screenshotDir = path.join(buildDir, 'tests', 'screenshots');
  async function screenshots(directory: string) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await screenshots(file); else if (entry.name.endsWith('.png')) report.screenshots.push(file);
    }
  }
  await screenshots(screenshotDir);
  if (report.screenshots.length < 5) throw new Error('Expected five native runtime screenshots.');
  report.status = 'passed'; await saveReport(); console.log(`Report: ${path.join(runDir, 'report.json')}`);
}
try { await main(); } catch (error) {
  report.status = 'failed'; report.error = error instanceof Error ? error.message : String(error);
  await fs.mkdir(runDir, { recursive: true }); await saveReport(); console.error(report.error); process.exitCode = 1;
}
