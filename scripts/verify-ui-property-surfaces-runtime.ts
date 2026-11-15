import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createUiPropertyFixture, uiPropertyFixtureTone, uiPropertyFixturePng } from './lib/ui-property-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { compileProject } from '../src/runtime/compiler';
import { buildProject, runRenpy } from '../src/runtime/service';
import { pythonLiteral as q } from '../src/runtime/literals';

const sdk = process.env.VNS_RENPY_SDK ?? 'E:/Tools/renpy-8.5.3-sdk';
const output = path.resolve('artifacts/ui-property-surfaces-runtime', new Date().toISOString().replaceAll(':', '-'));
const source = path.join(output, 'source'), game = path.join(output, 'game');
const report: { status: string; checks: { name: string; code: number; logPath: string }[]; cases?: number; assertions?: number; error?: string; cleanup?: unknown } = { status: 'running', checks: [] };
await fs.mkdir(path.join(source, 'assets'), { recursive: true });
const save = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
async function check(name: string, result: { code: number; log: string }) {
  const logPath = path.join(output, name + '.log'); await fs.writeFile(logPath, result.log);
  report.checks.push({ name, code: result.code, logPath }); await save();
  if (result.code) throw new Error(name + ': ' + result.log.slice(-9000));
}
try {
  const f = createUiPropertyFixture(), original = structuredClone(f.project);
  assert.deepEqual(compileProject(f.project).diagnostics.filter(issue => issue.severity === 'error'), []); assert.deepEqual(f.project, original);
  await fs.writeFile(path.join(source, 'project.vns.json'), JSON.stringify(f.project, null, 2));
  await fs.writeFile(path.join(source, 'assets/click.wav'), uiPropertyFixtureTone());
  await fs.writeFile(path.join(source, 'assets/property-skin.png'), uiPropertyFixturePng());
  const built = await buildProject({ project: f.project, projectDir: source, sdkRoot: sdk, outputDir: game, development: true });
  await check('compile', { code: built.ok ? 0 : 1, log: built.log + JSON.stringify(built.diagnostics) });
  const start = ['    pause until screen "main_menu"', '    click id "vn_main_start" pos (0.5, 0.5)', '    pause until eval ("property_page" in vn_ui_open_pages)', '    move pos (8, 8)'];
  const values = f.records.map(row => '    assert eval vn_test_property_equal(vn_var_' + row.variableId + ', ' + q(row.expected) + ')');
  const first = f.project.nodes.find(node => node.kind === 'passage')!.id;
  const tests = [
    'default vn_test_property_clicks = []', '',
    'init 1000 python:',
    '    vn_test_original_property_click = vn_ui_play_click',
    '    def vn_ui_play_click(component_id):',
    '        vn_test_property_clicks.append((component_id, vn_ui_get(component_id, "clickSound")))',
    '        return vn_test_original_property_click(component_id)',
    '    def vn_test_property_equal(actual, expected):',
    '        if isinstance(expected, bool): return actual is expected',
    '        if isinstance(expected, (int, float)): return not isinstance(actual, bool) and isinstance(actual, (int, float)) and abs(actual - expected) < 0.000001',
    '        return actual == expected',
    '    def vn_test_property_readonly(component, property, reset=False):',
    '        try:',
    '            if reset: vn_ui_reset_property(component, property)',
    '            else: vn_ui_set(component, property, False)',
    '        except Exception as error:',
    '            return "只读" in str(error)',
    '        return False', '',
    'testsuite global:',
    '    before testcase:', '        $ _test.timeout = 12.0', '        $ _test.transition_timeout = 0.05', '        $ _test.screenshot_directory = "tests/screenshots"', '        $ preferences.text_cps = 0',
    '    after testcase:', '        if eval not main_menu:', '            run MainMenu(confirm=False)', '        pause until screen "main_menu"',
    '    teardown:', '        exit', '',
    'testcase ordinary_property_values_and_render:', ...start,
    '    click id "vn_component_apply" pos (0.5, 0.5)', '    pause until eval abs(vn_var_world_x - 384) < 0.000001', ...values,
    '    assert eval vn_ui_get("frame", "background") == "#12223380"',
    '    assert eval vn_ui_get("bottom", "hoverBackground") == "#224466"',
    '    assert eval vn_test_property_readonly("probe", "pressed")',
    '    assert eval vn_test_property_readonly("caption", "screenX", True)',
    '    screenshot "properties-applied.png"',
    '    click id "vn_component_reset" pos (0.5, 0.5)',
    '    assert eval vn_ui_get("caption", "textColor") == "#ddeeff"',
    '    assert eval vn_ui_get("caption", "hoverTextColor") == "#f040d0"',
    '    assert eval vn_ui_get("caption", "shadowOpacity") == 0.25',
    '    assert eval vn_ui_get("frame", "borderWidth") == 0',
    '    assert eval vn_ui_get("frame", "background") == "#12223380"', '',
    'testcase layer_order_changes_actual_pointer_target:', ...start,
    '    click pos (371, 581)', '    assert eval (vn_var_hits_top == 1 and vn_var_hits_bottom == 0)',
    '    click id "vn_component_swap" pos (0.5, 0.5)',
    '    click pos (371, 581)', '    assert eval (vn_var_hits_top == 1 and vn_var_hits_bottom == 1)',
    '    assert eval vn_ui_get("decoration", "layer") == 9999',
    '    screenshot "stable-layer-hit-target.png"',
    '    click id "vn_component_reset" pos (0.5, 0.5)',
    '    click pos (371, 581)', '    assert eval (vn_var_hits_top == 2 and vn_var_hits_bottom == 1)', '',
    'testcase live_pointer_observations_and_cancelled_audio:', ...start,
    '    click id "vn_component_apply" pos (0.5, 0.5)',
    '    move id "vn_component_probe" pos (0.5, 0.5)', '    pause 0.05',
    '    assert eval (vn_var_probe_hover is True and vn_ui_get("probe", "hovered") is True)',
    '    $ renpy.test.testmouse.press_mouse(1)', '    pause 0.05',
    '    assert eval (vn_var_probe_down is True and vn_ui_get("probe", "pressed") is True)',
    '    screenshot "live-pressed-observation.png"',
    '    $ renpy.test.testmouse.release_mouse(1)', '    pause 0.05',
    '    assert eval (vn_var_probe_up is False and vn_ui_get("probe", "pressed") is False)',
    '    assert eval [value for component, value in vn_test_property_clicks if component == "probe"] == ["click_tone"]',
    '    $ renpy.test.testmouse.press_mouse(1)', '    move pos (8, 8)', '    $ renpy.test.testmouse.release_mouse(1)', '    pause 0.05',
    '    assert eval (vn_var_probe_unhover is False and vn_ui_get("probe", "hovered") is False)',
    '    assert eval [value for component, value in vn_test_property_clicks if component == "probe"] == ["click_tone"]',
    '    $ vn_ui_set("probe", "enabled", False)', '    click id "vn_component_probe" pos (0.5, 0.5)',
    '    assert eval [value for component, value in vn_test_property_clicks if component == "probe"] == ["click_tone"]', '',
    'testcase property_save_load_and_page_instance_reset:', ...start,
    '    click id "vn_component_apply" pos (0.5, 0.5)', '    click id "vn_component_swap" pos (0.5, 0.5)',
    '    $ renpy.save("property-checkpoint")',
    '    click id "vn_component_reset" pos (0.5, 0.5)', '    assert eval vn_ui_get("frame", "borderWidth") == 0',
    '    run FileLoad("property-checkpoint", confirm=False, slot=True)', '    pause until eval vn_ui_get("frame", "borderWidth") == 6',
    '    assert eval vn_ui_get("bottom", "layer") == 100',
    '    assert eval len(vn_ui_page_order) == 1',
    '    assert eval [component for component, value in vn_test_property_clicks] == ["apply", "swap"]',
    '    assert eval vn_ui_get("probe", "pressed") is False',
    '    click id "vn_component_close" pos (0.5, 0.5)', '    pause until "属性页面已关闭。"',
    '    assert eval (not vn_ui_open_pages and not vn_ui_page_order)',
    '    assert eval "caption" not in vn_ui_overrides',
    '    run Jump(' + q('vn_node_' + first) + ')', '    pause until eval "property_page" in vn_ui_open_pages',
    '    assert eval vn_ui_get("caption", "textColor") == "#ddeeff"',
    '    assert eval vn_ui_get("probe", "clickSound") == ""',
    '    assert eval vn_ui_get("bottom", "layer") == 20', '',
  ].join('\n');
  await fs.writeFile(path.join(output, 'testcases.rpy'), tests);
  await fs.writeFile(path.join(game, 'game/testcases.rpy'), tests);
  const options = { savedir: path.join(output, 'saves'), timeoutMs: 180000 };
  await check('lint', await runRenpy(sdk, game, ['lint'], options));
  const native = await runRenpy(sdk, game, ['test', '--report-detailed', '--report-skipped'], { ...options, onData: text => process.stdout.write(text) });
  await check('runtime', native); report.cases = (tests.match(/^testcase /gm) ?? []).length;
  assert.match(native.log, new RegExp('Test cases\\s*:\\s*' + report.cases + '\\s*\\|\\s*' + report.cases + ' passed'));
  report.assertions = Number(native.log.match(/Assertions\s*:\s*(\d+)/)?.[1]);
  assert.equal(report.assertions, (tests.match(/^    assert /gm) ?? []).length);
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error); process.exitCode = 1; }
finally {
  try {
    for (const directory of [path.join(game, 'tests/screenshots'), path.join(game, 'game/tests/screenshots')]) {
      if (await fs.stat(directory).then(stat => stat.isDirectory()).catch(() => false)) await fs.cp(directory, path.join(output, 'screenshots'), { recursive: true });
    }
  } catch (error) { report.status = 'failed'; report.error = [report.error, 'Screenshot preservation failed: ' + String(error)].filter(Boolean).join('\n'); process.exitCode = 1; }
  // Preservation failures must never bypass fixture cleanup.
  try {
    report.cleanup = await cleanVerificationDirectories(output, ['source', 'game', 'saves']);
    if ((report.cleanup as { errors: unknown[] }).errors.length) throw new Error('Verification cleanup failed.');
  } catch (error) { report.status = 'failed'; report.error = [report.error, String(error)].filter(Boolean).join('\n'); process.exitCode = 1; }
  await save(); console.log(path.join(output, 'report.json')); if (report.error) console.error(report.error);
}
