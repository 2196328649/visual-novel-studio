import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createBlueprintChoiceFixture } from './lib/blueprint-choice-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { compileProject } from '../src/runtime/compiler';
import { buildProject, runRenpy } from '../src/runtime/service';
import { pythonLiteral } from '../src/runtime/literals';

const sdk = process.env.VNS_RENPY_SDK ?? 'E:/Tools/renpy-8.5.3-sdk';
const output = path.resolve('artifacts/blueprint-choice-runtime', new Date().toISOString().replaceAll(':', '-'));
const source = path.join(output, 'source'), game = path.join(output, 'game'); await fs.mkdir(source, { recursive: true });
const report: Record<string, unknown> = { status: 'running', checks: [] };
const checks = report.checks as { name: string; code: number; logPath: string }[];
const save = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
async function check(name: string, result: { code: number; log: string }) { const logPath = path.join(output, name + '.log'); await fs.writeFile(logPath, result.log); checks.push({ name, code: result.code, logPath }); await save(); assert.equal(result.code, 0, name + ': ' + result.log.slice(-6000)); }
try {
  const f = createBlueprintChoiceFixture(), before = JSON.stringify(f.project), q = pythonLiteral;
  assert.deepEqual(compileProject(f.project).diagnostics.filter(issue => issue.severity === 'error'), []);
  await fs.writeFile(path.join(source, 'project.vns.json'), JSON.stringify(f.project));
  const built = await buildProject({ project: f.project, projectDir: source, sdkRoot: sdk, outputDir: game, development: true }); await check('build', { code: built.ok ? 0 : 1, log: built.log + JSON.stringify(built.diagnostics) });
  const start = ['    pause until screen "main_menu"', '    click id "vn_main_start" pos (0.5, 0.5)', '    pause until "多路选择准备完成。"'];
  const expectation = (entry: typeof f.cases[number]) => '    assert eval (vn_var_' + entry.group.resultVariable + ' == ' + q(entry.expected) + ' and vn_var_' + entry.group.routeVariable + ' == ' + q(entry.route) + ' and isinstance(vn_var_' + entry.group.resultVariable + ', ' + (typeof entry.expected === 'boolean' ? 'bool' : typeof entry.expected === 'number' ? '(int, float)' : 'str') + ')' + (typeof entry.expected === 'number' ? ' and not isinstance(vn_var_' + entry.group.resultVariable + ', bool)' : '') + ')';
  const tests = [
    'init python:', '    def vn_test_choice_reject(work):', '        try:', '            work()', '        except Exception:', '            return True', '        return False', '',
    ...f.cases.flatMap(entry => ['label vn_choice_probe_' + entry.id + ':', '    call vn_blueprint_' + entry.group.graph.id + '(vn_bp_in_' + entry.group.graph.id + '_key=' + q(entry.key) + ') from vn_choice_probe_call_' + entry.id, '    ' + q('多路用例 ' + entry.id + ' 完成。'), '    return', '']),
    'testsuite global:', '    before testcase:', '        $ _test.timeout = 12.0', '        $ _test.transition_timeout = 0.05', '        $ _test.screenshot_directory = "tests/screenshots"', '        $ preferences.text_cps = 0', '    after testcase:', '        if eval not main_menu:', '            run MainMenu(confirm=False)', '        pause until screen "main_menu"', '    teardown:', '        exit', '',
    'testcase typed_story_calls:', ...start,
    ...f.cases.flatMap(entry => ['    run Jump(' + q('vn_choice_probe_' + entry.id) + ')', '    pause until ' + q('多路用例 ' + entry.id + ' 完成。'), expectation(entry), '    assert eval (vn_bp_frame is None and vn_bp_task is None)']), '',
    'testcase authored_page_calls:', ...start, '    run Jump(' + q('vn_node_' + f.after.id) + ')', '    pause until eval (' + q(f.page.id) + ' in vn_ui_open_pages)',
    ...f.cases.flatMap(entry => ['    click id ' + q('vn_component_' + entry.buttonId) + ' pos (0.5, 0.5)', expectation(entry)]),
    '    screenshot "choice-page.png"', '    click id ' + q('vn_component_' + f.page.components[1].id) + ' pos (0.5, 0.5)', '    pause until "多路节点页面已返回。"', '    assert eval (not vn_ui_open_pages and vn_bp_frame is None and vn_bp_task is None)', '',
    'testcase choice_save_restore_and_rollback:', ...start,
    '    run Jump("vn_choice_probe_text_2")', '    pause until "多路用例 text_2 完成。"', expectation(f.cases.find(entry => entry.id === 'text_2')!),
    '    run FileSave("choice-state", confirm=False, slot=True)', '    $ vn_var_choice_result_text = -42', '    $ vn_var_choice_route_text = "wrong"',
    '    run FileLoad("choice-state", confirm=False, slot=True)', '    pause until "多路用例 text_2 完成。"', expectation(f.cases.find(entry => entry.id === 'text_2')!),
    '    run Rollback()', '    pause until "多路选择准备完成。"', expectation(f.cases.find(entry => entry.id === 'text_0')!), '',
    'testcase native_type_and_lazy_guards:', ...start,
    '    assert eval (vn_bp_choice_value("A", "string", [("a", "A"), ("b", "B")], "number", {"case_a": lambda: 0, "case_b": lambda: 1/0, "default": lambda: 1/0}) == 0)',
    '    assert eval (vn_bp_choice_value("other", "string", [("a", "A")], "boolean", {"case_a": lambda: 1/0, "default": lambda: False}) is False)',
    '    assert eval (vn_test_choice_reject(lambda: vn_bp_choice_match(True, "number", [("zero", 0)])))',
    '    assert eval (vn_test_choice_reject(lambda: vn_bp_choice_match("0", "number", [("zero", 0)])))',
    '    assert eval (vn_test_choice_reject(lambda: vn_bp_choice_match(float("nan"), "number", [("zero", 0)])))',
    '    assert eval (vn_test_choice_reject(lambda: vn_bp_choice_match("A", "string", [("a", "A"), ("b", "A")])))',
    '    assert eval (vn_test_choice_reject(lambda: vn_bp_choice_value("A", "string", [("a", "A")], "number", {"case_a": lambda: False})))', '',
  ].join('\n');
  await fs.writeFile(path.join(game, 'game/testcases.rpy'), tests); await fs.writeFile(path.join(output, 'testcases.rpy'), tests);
  const options = { savedir: path.join(output, 'saves'), timeoutMs: 180000 };
  await check('lint', await runRenpy(sdk, game, ['lint'], options));
  const native = await runRenpy(sdk, game, ['test', '--report-detailed', '--report-skipped'], { ...options, onData: text => process.stdout.write(text) }); await check('choice', native);
  report.cases = (tests.match(/^testcase /gm) ?? []).length; report.assertions = Number(native.log.match(/Assertions\s*:\s*(\d+)/)?.[1]);
  assert.match(native.log, new RegExp('Test cases\\s*:\\s*' + report.cases + '\\s*\\|\\s*' + report.cases + ' passed')); assert.equal(report.assertions, (tests.match(/^    assert /gm) ?? []).length);
  assert.equal(JSON.stringify(f.project), before); report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error); console.error(error); process.exitCode = 1; }
finally {
  for (const screenshots of [path.join(game, 'tests/screenshots'), path.join(game, 'game/tests/screenshots')]) {
    if (await fs.stat(screenshots).then(stat => stat.isDirectory()).catch(() => false)) await fs.cp(screenshots, path.join(output, 'screenshots'), { recursive: true });
  }
  for (const name of ['traceback.txt', 'errors.txt']) { const file = path.join(game, name); if (await fs.stat(file).catch(() => undefined)) await fs.copyFile(file, path.join(output, name)); }
  const cleanup = await cleanVerificationDirectories(output, ['source', 'game', 'saves']); if (cleanup.errors.length) { report.status = 'failed'; report.cleanupErrors = cleanup.errors; process.exitCode = 1; }
  await save(); console.log(output);
}
