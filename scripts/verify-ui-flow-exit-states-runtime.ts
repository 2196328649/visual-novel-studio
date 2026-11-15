import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject, projectSchema, type UiComponent } from '../src/core/model';
import { buildProject, runRenpy } from '../src/runtime/service';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { isolateRenpySaves } from './lib/renpy-saves';

const root = path.resolve('.'), sdk = process.env.VNS_RENPY_SDK ?? path.join(root, 'resources/runtime');
const output = path.resolve('artifacts/ui-flow-exit-states-runtime', new Date().toISOString().replaceAll(':', '-'));
const source = path.join(output, 'source'), game = path.join(output, 'game');
await fs.mkdir(source, { recursive: true }); await isolateRenpySaves(output);
const report: { status: string; cases?: number; assertions?: number; error?: string; checks: unknown[]; cleanup?: unknown } = { status: 'running', checks: [] };
async function check(name: string, result: { code: number; log: string }) {
  await fs.writeFile(path.join(output, name + '.log'), result.log);
  report.checks.push({ name, code: result.code });
  assert.equal(result.code, 0, result.log.slice(-6000));
}
try {
  const project = createProject('设置出口状态游戏验收');
  const template = projectSchema.parse(JSON.parse(await fs.readFile(path.join(root, 'resources/templates/aihong/project.vns.json'), 'utf8')));
  project.ui.pages = { preferences: { layout: 'custom' } };
  project.variables.push({ id: 'progress', name: '章节进度', type: 'number', initial: 0, persistent: false });
  const add = (id: string, name: string, extra: Partial<UiComponent>) => {
    project.ui.components.push({ id, name, text: name, page: 'preferences', kind: 'button', x: .1, y: .12 + project.ui.components.length * .1, width: .7, height: .075, ...extra });
  };
  const arrows = template.ui.components.filter(component => /^ai_settings_(voice)?languagesetting_btn(pre|next)$/.test(component.id));
  assert.equal(arrows.length, 4);
  for (const arrow of arrows) add(arrow.id, arrow.name!, { action: arrow.action, disabled: arrow.disabled });
  add('legacy_arrow', '旧工程语言箭头', { action: 'return', disabled: true });
  add('conditional_return', '进度达到二时返回', { action: 'return', enabledWhen: { kind: 'compare', variableId: 'progress', operator: 'gte', value: 2 } });
  add('regular_return', '返回', { action: 'return' });
  await fs.writeFile(path.join(source, 'project.vns.json'), JSON.stringify(project, null, 2));
  const built = await buildProject({ project, projectDir: source, outputDir: game, sdkRoot: sdk, development: true });
  await check('compile', { code: built.ok ? 0 : 1, log: built.log + JSON.stringify(built.diagnostics) });
  const click = (id: string) => '    click id ' + JSON.stringify('vn_component_' + id) + ' pos (0.5, 0.5)';
  const open = ['    click id "vn_main_preferences"', '    pause until screen "preferences"'];
  const cases = [
    'testcase template_placeholders_do_not_navigate:', ...open,
    ...arrows.flatMap(arrow => ['    assert eval (not vn_ui_get(' + JSON.stringify(arrow.id) + ', "enabled"))', click(arrow.id), '    assert screen "preferences"']),
    '    $ vn_ui_set(' + JSON.stringify(arrows[0].id) + ', "enabled", True)', '    pause 0.2',
    '    assert eval (vn_ui_get(' + JSON.stringify(arrows[0].id) + ', "enabled"))', click(arrows[0].id),
    '    assert screen "preferences"', click('regular_return'), '    pause until screen "main_menu"', '',
    'testcase legacy_disabled_return_stays_disabled:', ...open,
    '    assert eval (not vn_ui_get("legacy_arrow", "enabled"))', click('legacy_arrow'), '    assert screen "preferences"',
    click('regular_return'), '    pause until screen "main_menu"', '',
    'testcase real_enable_condition_controls_clicks:', ...open,
    '    $ vn_var_progress = 0', '    assert eval (not vn_ui_get("conditional_return", "enabled"))',
    click('conditional_return'), '    assert screen "preferences"',
    '    $ vn_var_progress = 2', '    $ renpy.restart_interaction()', '    pause 0.2',
    '    assert eval (vn_ui_get("conditional_return", "enabled"))',
    click('conditional_return'), '    pause until screen "main_menu"', '',
  ];
  const tests = ['testsuite global:', '    before testcase:', '        $ _test.timeout = 15.0', '        $ _test.transition_timeout = 0.05', '        pause until screen "main_menu"',
    '    teardown:', '        exit', '', ...cases].join('\n');
  await fs.writeFile(path.join(output, 'testcases.rpy'), tests);
  await fs.writeFile(path.join(game, 'game/testcases.rpy'), tests);
  await check('lint', await runRenpy(sdk, game, ['lint'], { savedir: path.join(output, 'saves'), timeoutMs: 120000 }));
  const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 120000, onData: text => process.stdout.write(text) });
  await check('player', result);
  report.cases = cases.filter(line => line.startsWith('testcase ')).length;
  report.assertions = cases.filter(line => line.startsWith('    assert ')).length;
  assert.match(result.log, new RegExp('Test cases\\s*:\\s*' + report.cases + '\\s*\\|\\s*' + report.cases + ' passed'));
  assert.equal(Number(result.log.match(/Assertions\s*:\s*(\d+)/)?.[1]), report.assertions);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = String(error); console.error(error); process.exitCode = 1;
} finally {
  if (await fs.stat(path.join(source, 'project.vns.json')).catch(() => undefined)) await fs.copyFile(path.join(source, 'project.vns.json'), path.join(output, 'fixture.project.json'));
  report.cleanup = await cleanVerificationDirectories(output, ['source', 'game', 'saves', 'renpy-saves']);
  if ((report.cleanup as Awaited<ReturnType<typeof cleanVerificationDirectories>>).errors.length) { report.status = 'failed'; process.exitCode = 1; }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(path.join(output, 'report.json'));
}
