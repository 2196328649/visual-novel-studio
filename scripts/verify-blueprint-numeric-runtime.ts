import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createBlueprintNumericFixture } from './lib/blueprint-numeric-fixture';
import { compileProject } from '../src/runtime/compiler';
import { buildProject, runRenpy } from '../src/runtime/service';
import { pythonLiteral } from '../src/runtime/literals';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

const sdk = process.env.VNS_RENPY_SDK ?? 'E:/Tools/renpy-8.5.3-sdk';
const output = path.resolve('artifacts/blueprint-numeric-runtime', new Date().toISOString().replaceAll(':', '-'));
const source = path.join(output, 'source'), game = path.join(output, 'game');
const report: { status: string; checks: { name: string; code: number; logPath: string }[]; cases?: number; assertions?: number; error?: string; cleanupErrors?: unknown } = { status: 'running', checks: [] };
await fs.mkdir(source, { recursive: true });
const save = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
async function check(name: string, result: { code: number; log: string }) {
  const logPath = path.join(output, name + '.log'); await fs.writeFile(logPath, result.log); report.checks.push({ name, code: result.code, logPath }); await save();
  if (result.code) throw new Error(name + ': ' + result.log.slice(-7000));
}
try {
  const f = createBlueprintNumericFixture(), before = structuredClone(f.project);
  assert.deepEqual(compileProject(f.project).diagnostics.filter(issue => issue.severity === 'error'), []); assert.deepEqual(f.project, before);
  await fs.writeFile(path.join(source, 'project.vns.json'), JSON.stringify(f.project, null, 2));
  await fs.writeFile(path.join(output, 'fixture.json'), JSON.stringify(f.project, null, 2));
  const built = await buildProject({ project: f.project, projectDir: source, sdkRoot: sdk, outputDir: game, development: true });
  await check('compile', { code: built.ok ? 0 : 1, log: built.log + JSON.stringify(built.diagnostics) });
  const q = pythonLiteral, start = ['    pause until screen "main_menu"', '    click id "vn_main_start" pos (0.5, 0.5)', '    pause until "数值运算准备完成。"'];
  const assertions = f.rows.map(row => '    assert eval (vn_var_' + row.variableId + ' == ' + q(row.expected) + ' and isinstance(vn_var_' + row.variableId + ', ' + (typeof row.expected === 'boolean' ? 'bool' : '(int, float)') + ')' + (typeof row.expected === 'boolean' ? '' : ' and not isinstance(vn_var_' + row.variableId + ', bool)') + ')');
  const reset = f.rows.map(row => '    $ vn_var_' + row.variableId + ' = ' + q(typeof row.expected === 'boolean' ? !row.expected : -999));
  const tests = [
    'init python:', '    def vn_test_numeric_reject(kind, values, mode="nearest"):', '        try:', '            vn_bp_numeric(kind, values, mode)', '        except Exception:', '            return True', '        return False', '',
    'testsuite global:', '    before testcase:', '        $ _test.timeout = 10.0', '        $ _test.transition_timeout = 0.05', '        $ _test.screenshot_directory = "tests/screenshots"', '        $ preferences.text_cps = 0',
    '    after testcase:', '        if eval not main_menu:', '            run MainMenu(confirm=False)', '        pause until screen "main_menu"', '    teardown:', '        exit', '',
    'testcase numeric_story_dataflow:', ...start, ...assertions, '    screenshot "numeric-story.png"', '',
    'testcase numeric_page_event_dataflow:', ...start, ...reset,
    '    run Jump(' + q('vn_node_' + f.after.id) + ')', '    pause until eval (' + q(f.page.id) + ' in vn_ui_open_pages)', ...assertions,
    '    screenshot "numeric-page.png"', '    click id ' + q('vn_component_' + f.page.components[1].id) + ' pos (0.5, 0.5)', '    pause until "数值页面已返回。"',
    '    assert eval (not vn_ui_open_pages and vn_bp_frame is None and vn_bp_task is None)', '',
    'testcase numeric_save_restore:', ...start,
    '    $ renpy.save("numeric-checkpoint")', ...reset, '    run FileLoad("numeric-checkpoint", confirm=False, slot=True)', '    pause until "数值运算准备完成。"', ...assertions, '',
    'testcase numeric_native_type_and_domain_guards:', ...start,
    '    assert eval (vn_test_numeric_reject("abs", dict(value=True)))',
    '    assert eval (vn_test_numeric_reject("abs", dict(value="12")))',
    '    assert eval (vn_test_numeric_reject("abs", dict(value=float("inf"))))',
    '    assert eval (vn_test_numeric_reject("abs", dict(value=float("nan"))))',
    '    assert eval (vn_test_numeric_reject("clamp", dict(value=0, min=2, max=1)))',
    '    assert eval (vn_test_numeric_reject("round", dict(value=2), "bankers"))',
    '    assert eval (vn_test_numeric_reject("inRange", dict(value=0, min=0, max=1, includeMin=1, includeMax=True)))',
    '    assert eval (vn_test_numeric_reject("nearlyEqual", dict(a=0, b=0, tolerance=-1)))',
    '    assert eval (vn_test_numeric_reject("mapRange", dict(value=0, inputMin=1, inputMax=1, outputMin=0, outputMax=1, clamp=True)))',
    '    assert eval (vn_test_numeric_reject("lerp", dict(a=1e308, b=-1e308, alpha=4, clampAlpha=False)))', '',
  ].join('\n');
  await fs.writeFile(path.join(game, 'game/testcases.rpy'), tests); await fs.writeFile(path.join(output, 'testcases.rpy'), tests);
  const options = { savedir: path.join(output, 'saves'), timeoutMs: 160000 };
  await check('lint', await runRenpy(sdk, game, ['lint'], options));
  const native = await runRenpy(sdk, game, ['test', '--report-detailed', '--report-skipped'], { ...options, onData: text => process.stdout.write(text) });
  await check('numeric', native); report.cases = (tests.match(/^testcase /gm) ?? []).length;
  assert.match(native.log, new RegExp('Test cases\\s*:\\s*' + report.cases + '\\s*\\|\\s*' + report.cases + ' passed'));
  report.assertions = Number(native.log.match(/Assertions\s*:\s*(\d+)/)?.[1]); assert.equal(report.assertions, (tests.match(/^    assert /gm) ?? []).length);
  report.status = 'passed'; await save(); console.log('PASS: ' + path.join(output, 'report.json'));
} catch (error) { report.status = 'failed'; report.error = String(error); await save(); console.error(error); process.exitCode = 1; }
finally {
  for (const screenshots of [path.join(game, 'tests/screenshots'), path.join(game, 'game/tests/screenshots')]) {
    if (await fs.stat(screenshots).then(stat => stat.isDirectory()).catch(() => false)) await fs.cp(screenshots, path.join(output, 'screenshots'), { recursive: true });
  }
  for (const name of ['traceback.txt', 'errors.txt']) { const file = path.join(game, name); if (await fs.stat(file).catch(() => undefined)) await fs.copyFile(file, path.join(output, name)); }
  const cleanup = await cleanVerificationDirectories(output, ['source', 'game', 'saves']); if (cleanup.errors.length) { report.status = 'failed'; report.cleanupErrors = cleanup.errors; process.exitCode = 1; }
  await save(); console.log(output);
}
