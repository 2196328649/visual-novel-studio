import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { compileProject } from '../src/runtime/compiler';
import { buildProject, runRenpy } from '../src/runtime/service';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { releasedSchemes } from './lib/released-runtime-fixture';
import { createUiSystemHostFixture } from './lib/ui-system-host-fixture';
import { nativeClick, releasedNativeCases, releasedProbeSource, releaseStart, releaseAnchor } from './lib/released-native-cases';

if (process.env.VNS_INSTALLED_EXE) throw new Error('System-host acceptance uses isolated development games.');
const sdk = process.env.VNS_RENPY_SDK ?? 'E:/Tools/renpy-8.5.3-sdk';
const output = path.resolve('artifacts/ui-system-hosts-runtime', new Date().toISOString().replaceAll(':', '-'));
const report: { status: string; runs: unknown[]; checks: unknown[]; error?: string; cleanup?: unknown } = { status: 'running', runs: [], checks: [] };
await fs.mkdir(output, { recursive: true });
const saveReport = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
async function check(name: string, result: { code: number; log: string }, count?: number) {
  const logPath = path.join(output, name + '.log'); await fs.writeFile(logPath, result.log); report.checks.push({ name, code: result.code, count, logPath }); await saveReport();
  assert.equal(result.code, 0, name + ': ' + result.log.slice(-10000));
  if (count !== undefined) assert.match(result.log, new RegExp('Test cases\\s*:\\s*' + count + '\\s*\\|\\s*' + count + ' passed'));
}
const q = JSON.stringify;
try {
  for (const scheme of releasedSchemes) for (const layout of ['native', 'custom'] as const) {
    const f = createUiSystemHostFixture(scheme, layout), name = scheme + '_' + layout;
    const run = path.join(output, name), work = path.join(run, 'work'), source = path.join(work, 'source'), game = path.join(work, 'game'), saves = path.join(work, 'saves');
    await fs.mkdir(source, { recursive: true });
    try {
      assert.deepEqual(compileProject(f.project).diagnostics.filter(row => row.severity === 'error'), []);
      await fs.writeFile(path.join(run, 'source.project.json'), JSON.stringify(f.project, null, 2));
      await fs.writeFile(path.join(source, 'project.vns.json'), JSON.stringify(f.project, null, 2));
      const built = await buildProject({ project: f.project, projectDir: source, sdkRoot: sdk, outputDir: game, development: true });
      await check(name + '-build', { code: built.ok ? 0 : 1, log: built.log + JSON.stringify(built.diagnostics) });
      const cases = releasedNativeCases(f.project, f);
      const ending = f.native.find(row => row.key === 'gameOver')!;
      cases.push({ key: 'gameOver', host: 'vn_game_over', saveScope: 'base', valueId: ending.valueId,
        setup: [...releaseStart, ...releaseAnchor, '    run Jump("vn_end_return")', '    pause until screen "vn_game_over"', nativeClick(ending.touchId)],
        afterLoad: ['    pause until screen "vn_game_over"'], continuation: ['    run Return()', '    pause until screen "main_menu"'] });
      const probes = [releasedProbeSource(f.project), 'init python:',
        '    def system_snapshot(page, key):',
        '        task, owner = vn_ui_state_owner(page)',
        '        return dict(hits=vn_ui_state_get(page, "hits", "number"), number=vn_ui_interface_get(page, "inputs", "number", "number"), flag=vn_ui_interface_get(page, "inputs", "flag", "boolean"), result=vn_ui_interface_get(page, "outputs", "result", "number"), created=getattr(renpy.store, "vn_var_system_created_" + key), shown=getattr(renpy.store, "vn_var_release_" + key + "_shows"), token=task["pageToken"], text=vn_ui_get("release_" + key + "_value", "text"))',
        '    def system_remember(page, key):', '        renpy.test.testexecution.system_expected = system_snapshot(page, key)',
        '    def system_dead(page):', '        return not any(record.get("page") == page for record in vn_ui_state_records.values()) and not any(record.get("page") == page for record in vn_ui_interface_records.values()) and not any(record.get("page") == page for record in vn_ui_native_page_sessions.values())',
        '', 'label system_input_constraints:', '    $ release_native_input = renpy.input("系统输入过滤", default="a", allow="ab", exclude="b", length=3)', '    "过滤输入已返回。"', '    jump vn_node_release_anchor', ''];
      const tests: string[] = [];
      for (const row of cases) {
        const key = row.key === 'load' || row.key === 'save' ? 'save' : row.key === 'rollback' ? 'say' : row.key === 'rollback_overlay' ? 'release_overlay' : row.key;
        const info = f.pages.find(page => page.key === key)!; assert.ok(info, row.key);
        const pageId = info.pageId, ready = '    pause until eval (system_snapshot(' + q(pageId) + ', ' + q(key) + ')["hits"] == 8)';
        const setup = row.setup.map(line => line.replace('run ShowMenu(', 'run VnUiMenu('));
        if (key === 'keyboard') setup.push(nativeClick(info.touchId));
        tests.push('testcase system_' + row.key + ':', ...setup, ready,
          '    assert eval (system_snapshot(' + q(pageId) + ', ' + q(key) + ')["number"] == 0 and system_snapshot(' + q(pageId) + ', ' + q(key) + ')["flag"] is False)',
          '    assert eval (system_snapshot(' + q(pageId) + ', ' + q(key) + ')["result"] == 99)',
          '    run Function(system_remember, ' + q(pageId) + ', ' + q(key) + ')',
          '    assert eval (FileSave(' + q('system_' + row.key) + ', slot=True).get_sensitive())',
          '    run FileSave(' + q('system_' + row.key) + ', confirm=False, slot=True)', nativeClick(info.touchId),
          '    assert eval (vn_ui_state_get(' + q(pageId) + ', "hits", "number") == 9)',
          '    run FileLoad(' + q('system_' + row.key) + ', confirm=False, slot=True)', ...row.afterLoad,
          '    assert eval (vn_ui_page_schema == 1 and not vn_ui_page_migration_log)');
        if (row.saveScope === 'base-only') {
          tests.push('    pause until eval (system_dead(' + q(pageId) + '))', '    assert eval (' + q(info.valueId) + ' not in vn_ui_overrides)');
          if (key !== 'messageBox') tests.push('    run VnUiMenu(' + q(row.host) + ')', '    pause until screen ' + q(row.host),
            '    pause until eval (vn_ui_state_get(' + q(pageId) + ', "hits", "number") == 7)',
            '    assert eval (vn_ui_interface_get(' + q(pageId) + ', "outputs", "result", "number") == 0)',
            '    run Return()', '    pause until screen "say"', '    pause until eval (system_dead(' + q(pageId) + '))');
        } else {
          tests.push('    assert eval (system_snapshot(' + q(pageId) + ', ' + q(key) + ') == renpy.test.testexecution.system_expected)',
            '    run FileSave(' + q('system_resaved_' + row.key) + ', confirm=False, slot=True)',
            '    run FileLoad(' + q('system_resaved_' + row.key) + ', confirm=False, slot=True)', ...row.afterLoad,
            '    assert eval (system_snapshot(' + q(pageId) + ', ' + q(key) + ') == renpy.test.testexecution.system_expected)', ...(row.continuation ?? []));
        }
        tests.push('');
      }
      const main = f.native.find(row => row.key === 'main')!;
      tests.push('testcase system_title_lifecycle_not_saveable:', '    pause until screen "main_menu"', nativeClick(main.touchId),
        '    assert eval (vn_ui_state_get("ui:main", "hits", "number") == 8)', '    assert eval (not FileSave("system_title", slot=True).get_sensitive())',
        '    run Start()', '    pause until screen "say"', '    assert eval (system_dead("ui:main"))', '',
        'testcase system_native_keyboard_uses_real_input_filters:', ...releaseStart, '    run Jump("system_input_constraints")', '    pause until screen "input"',
        '    $ renpy.test.testexecution.system_old_answer = vn_minigame_answer',
        '    click "a"', '    click "b"', '    click "a"', '    click "a"', '    assert eval (renpy.get_displayable("input", "input").content == "aaa")',
        '    click "退格"', '    assert eval (renpy.get_displayable("input", "input").content == "aa")',
        '    assert eval (vn_minigame_answer == renpy.test.testexecution.system_old_answer)', '    keysym "K_RETURN"', '    pause until "过滤输入已返回。"', '    assert eval (release_native_input == "aa")', '');
      const sourceText = [...probes, ...tests].join('\n');
      await fs.writeFile(path.join(run, 'testcases.rpy'), sourceText); await fs.writeFile(path.join(game, 'game/testcases.rpy'), sourceText);
      const nativeOptions = { savedir: saves, timeoutMs: 900000, env: { VNS_RELEASE_SNAPSHOT_DIR: path.join(run, 'snapshots') }, onData: (text: string) => process.stdout.write(text) };
      await check(name + '-lint', await runRenpy(sdk, game, ['lint'], nativeOptions));
      const caseCount = tests.filter(line => line.startsWith('testcase ')).length;
      await check(name + '-native', await runRenpy(sdk, game, ['test', '--report-detailed', '--report-skipped'], nativeOptions), caseCount);
      report.runs.push({ scheme, contextLayout: layout, caseCount, pages: f.pages.map(page => page.pageId), nativeHosts: cases.map(({ key, host, saveScope }) => ({ key, host, saveScope })) });
    } finally { const cleaned = await cleanVerificationDirectories(run, ['work']); assert.deepEqual(cleaned.errors, []); }
  }
  assert.equal(report.runs.length, releasedSchemes.length * 2); report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error); console.error(error); process.exitCode = 1; }
finally { await saveReport(); console.log(path.join(output, 'report.json')); }
