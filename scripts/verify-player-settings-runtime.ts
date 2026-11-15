import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject } from '../src/core/model';
import { buildProject, runRenpy } from '../src/runtime/service';
import { isolateRenpySaves } from './lib/renpy-saves';
import { renderedScreenTextHelper } from './lib/renpy-screen-test';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

// Built-in settings as ordinary parameters, in the real game: authored name, range and
// visibility in the menu, sliders on the new range, and a stored value fitted at startup.
const root = path.resolve('.'), sdk = path.resolve(process.env.VNS_RENPY_SDK ?? 'resources/runtime');
const output = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? 'artifacts/player-settings-runtime',
  'player-settings-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const relative = path.relative(root, output);
if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Acceptance output must stay inside the workspace.');
const projectDir = path.join(output, 'project'), game = path.join(output, 'game');
await fs.mkdir(projectDir, { recursive: true });
const previousSaves = process.env.RENPY_PATH_TO_SAVES;
const runs: Record<string, unknown>[] = [];
const report: Record<string, unknown> = { status: 'running', runs, checks: ['内置偏好名称/范围/隐藏', '重启适配已存偏好', '自定义变量无自动菜单', '旧分组恢复资格兼容'] };
let failure: unknown;
try {
await isolateRenpySaves(output);

const project = createProject('游戏设置验收');
const passage = project.nodes.find(node => node.kind === 'passage');
assert.ok(passage?.kind === 'passage');
passage.lines = [{ id: 'first', text: '第一句。', actions: [] }];
project.playerDefaults = { textSpeed: 100, musicVolume: .5 };
project.playerPreferenceSettings = {
  textSpeed: { name: '打字速度', min: 10, max: 500, step: 10, unit: 'cps' },
  musicVolume: { min: .2, max: .8 },
  ambientVolume: { visible: false }, characterVolume: { visible: false }, windowSize: { visible: false },
};
project.parameterSets = [{ id: 'parameters_screen', name: '画面', kind: 'settings' }];
project.variables.push({ id: 'var_brightness', name: '亮度', type: 'number', initial: .5, persistent: true, parameterSetId: 'parameters_screen', setting: { min: 0, max: 1, step: .05, display: 'percent' } });

const built = await buildProject({ project, projectDir, outputDir: game, sdkRoot: sdk });
await fs.writeFile(path.join(output, 'compile.log'), built.log + '\n' + JSON.stringify(built.diagnostics, null, 2));
assert.ok(built.ok, built.log);
const header = `${renderedScreenTextHelper}
init -999 python:
    import renpy as _engine
    _engine.safe_mode_checked = True
testsuite global:
    before testcase:
        $ _test.timeout = 30.0
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit
`;
const play = async (name: string, body: string) => {
  const testcases = `${header}testcase ${name}:\n${body}\n`;
  await fs.writeFile(path.join(output, name + '.rpy'), testcases); await fs.writeFile(path.join(game, 'game/testcases.rpy'), testcases);
  const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 120000, env: { RENPY_RENDERER: 'gl2' } });
  await fs.writeFile(path.join(output, name + '.log'), result.log);
  const expectedAssertions = testcases.split('\n').filter(line => line.trim().startsWith('assert ')).length;
  const assertions = Number(result.log.match(/Assertions\s*:\s*(\d+)/)?.[1] ?? NaN), cases = Number(result.log.match(/Test cases\s*:\s*(\d+)/)?.[1] ?? NaN);
  runs.push({ name, code: result.code, cases, assertions, expectedAssertions });
  assert.equal(result.code, 0, result.log.slice(-5000));
  assert.match(result.log, /Status: PASSED/);
  assert.equal(cases, 1); assert.equal(assertions, expectedAssertions);
  return assertions;
};

const first = await play('first_run', `
    # The first run starts on the authored initial values.
    assert eval _preferences.text_cps == 100
    assert eval abs(vn_preference_get("musicVolume") - .5) < .01
    click id "vn_main_preferences"
    pause .3
    assert screen "preferences"
    assert "打字速度"
    screenshot "settings-menu.png"
    # The slider runs on the authored range and step, not the old 0 to 200.
    assert eval abs(vn_preference_ratio("textSpeed") - (100 - 10) / 490.0) < .001
    $ VnPreferenceValue("textSpeed").changed(1.0)
    assert eval _preferences.text_cps == 500
    $ VnPreferenceValue("textSpeed").changed(0.0)
    assert eval _preferences.text_cps == 10
    $ VnPreferenceValue("textSpeed").changed(.5)
    assert eval _preferences.text_cps == 260
    $ VnPreferenceValue("musicVolume").changed(1.0)
    assert eval abs(vn_preference_get("musicVolume") - .8) < .01
    $ VnPreferenceValue("musicVolume").changed(0.0)
    assert eval abs(vn_preference_get("musicVolume") - .2) < .01
    # Other settings keep their defaults.
    assert eval vn_preference_info["autoForwardTime"]["max"] == 30
    # Hidden settings leave the menu; blueprints may still use them.
    $ vn_preference_set("ambientVolume", .5)
    assert eval abs(vn_preference_get("ambientVolume") - .5) < .01
    # Scripts may go past the slider, within what the engine accepts.
    $ vn_preference_set("textSpeed", 900)
    assert eval _preferences.text_cps == 900
    # A legacy settings group retains reset behavior, but never creates menu rows.
    assert eval "var_brightness" in vn_parameter_reset_ids
    assert eval "亮度" not in vns_test_rendered_texts("preferences")
    assert eval "更多设置" not in vns_test_rendered_texts("preferences")
    $ vn_parameter_set("var_brightness", .8)
    # Leave a value outside the range for the next start.
    $ renpy.save_persistent()`);

const second = await play('second_run', `
    # A stored value outside the authored range is fitted when the game starts; the rest stay.
    assert eval _preferences.text_cps == 500
    assert eval abs(vn_preference_get("ambientVolume") - .5) < .01
    assert eval abs(vn_parameter_get("var_brightness") - .8) < .001
    click id "vn_main_preferences"
    pause .3
    assert screen "preferences"
    screenshot "settings-after-restart.png"
    $ vn_reset_preferences()
    assert eval _preferences.text_cps == 100
    assert eval abs(vn_preference_get("musicVolume") - .5) < .01
    assert eval abs(vn_parameter_get("var_brightness") - .5) < .001`);

report.status = 'passed'; report.assertions = first + second; report.cases = runs.reduce((sum, run) => sum + Number(run.cases), 0);
} catch (error) { failure = error; report.status = 'failed'; report.error = String(error); }
finally {
  if (previousSaves === undefined) delete process.env.RENPY_PATH_TO_SAVES; else process.env.RENPY_PATH_TO_SAVES = previousSaves;
  let preserved = false;
  try {
    for (const directory of [path.join(game, 'tests/screenshots'), path.join(game, 'game/tests/screenshots')]) {
      if (await fs.stat(directory).then(stat => stat.isDirectory()).catch(() => false)) await fs.cp(directory, path.join(output, 'screenshots'), { recursive: true });
    }
    for (const filename of ['errors.txt', 'traceback.txt', 'log.txt']) {
      if (await fs.stat(path.join(game, filename)).then(stat => stat.isFile()).catch(() => false)) await fs.copyFile(path.join(game, filename), path.join(output, filename));
    }
    preserved = true;
  } catch (error) { failure ??= error; report.status = 'failed'; report.evidenceError = String(error); }
  try {
    if (!preserved) throw new Error('Evidence preservation failed; retained this run for review.');
    report.cleanup = await cleanVerificationDirectories(output, ['project', 'game', 'saves', 'renpy-saves']);
    assert.deepEqual((report.cleanup as { errors: unknown[] }).errors, []);
  } catch (error) { failure ??= error; report.status = 'failed'; report.cleanupError = String(error); }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(output);
}
if (failure) throw failure;
