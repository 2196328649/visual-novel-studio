import { endingPerformanceNodes } from '../src/core/ending-migration';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProject, projectSchema, type Project, type StageAction } from '../src/core/model';
import { buildProject, runRenpy } from '../src/runtime/service';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sdkRoot = path.join(appRoot, 'resources', 'runtime');
const exampleDir = path.join(appRoot, 'resources', 'example');
const outputRoot = path.join(appRoot, 'artifacts', 'player-state-verification');
const runId = new Date().toISOString().replaceAll(':', '-');
const runDir = path.join(outputRoot, runId);
const releaseDir = path.join(runDir, 'release');
const previewDir = path.join(runDir, 'preview');
const releaseSaveDir = path.join(runDir, 'player-saves');
const previewSaveDir = path.join(runDir, 'preview-saves');
const playerSlot = 'player_state_checkpoint';
const laterPlayerSlot = 'later_player_state_checkpoint';
const previewSlot = 'preview_state_checkpoint';
const checkpointText = '正式游戏的状态已经记录。';
const laterCheckpointText = '新的周目状态已经记录。';
const previewText = '从这里开始片段试玩。';
type FileHash = { relativePath: string; sha256: string };
const report: {
  runId: string; status: 'running' | 'passed' | 'failed'; runtime: string;
  directories: Record<string, string>; scope: string[];
  steps: { name: string; code: number; logPath: string; testCases?: number; assertions?: number }[];
  isolation?: { playerFilesBefore: FileHash[]; playerFilesAfter: FileHash[]; releaseBuildBefore: FileHash[]; releaseBuildAfter: FileHash[]; unchanged: boolean };
  testCases: number; assertions: number; error?: string;
} = {
  runId, status: 'running', runtime: sdkRoot,
  directories: { releaseDir, previewDir, releaseSaveDir, previewSaveDir },
  scope: [
    'Real RenPy test processes click the generated Chinese auto-forward, skip, and skip-all settings controls.',
    'The visible auto-forward button is Chinese; RenPy exposes the built-in action accessibility name Auto forward, used by its test selector.',
    'Automatic and skipping progression use separate, initially unread passages and no test advance commands.',
    'Generated set nodes update ordinary, persistent numeric, and persistent boolean variables; normal process exit writes persistence.',
    'A second release process checks persistent state, new-game defaults, and the saved checkpoint.',
    'Repeated old-save loads cannot repeat persistent increments or overwrite later persistent assignments; manual rollback and an intentional new choice can execute an increment again.',
    'A separate preview build starts at another entry with ordinary and persistent overrides and uses its own explicit savedir.',
    'A second preview process verifies its own persistent data and save; hashes of every release save file and compiled/source script must remain identical.',
    'Uses the runtime service directly; desktop preview controls and installation are verified by their dedicated verifiers.',
  ],
  steps: [], testCases: 0, assertions: 0,
};

async function writeReport(): Promise<void> {
  const text = JSON.stringify(report, null, 2) + '\n';
  await fs.writeFile(path.join(runDir, 'report.json'), text, 'utf8');
  await fs.writeFile(path.join(outputRoot, 'verification-report.json'), text, 'utf8');
}

async function recordStep(name: string, code: number, log: string, counts?: { testCases: number; assertions: number }): Promise<void> {
  const logPath = path.join(runDir, `${name}.log`);
  await fs.writeFile(logPath, log, 'utf8');
  report.steps.push({ name, code, logPath, ...counts });
  if (counts && code === 0) { report.testCases += counts.testCases; report.assertions += counts.assertions; }
  await writeReport();
  console.log(`${name}: ${code === 0 ? 'PASS' : 'FAIL'} (${logPath})`);
  if (code !== 0) throw new Error(`${name} failed (${code}).\n${log.slice(-8000)}`);
}

async function hashTree(root: string, accept: (relativePath: string) => boolean = () => true): Promise<FileHash[]> {
  const hashes: FileHash[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      const relativePath = path.relative(root, file).replaceAll('\\', '/');
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && accept(relativePath)) {
        hashes.push({ relativePath, sha256: createHash('sha256').update(await fs.readFile(file)).digest('hex') });
      }
    }
  }
  await visit(root);
  return hashes;
}

async function runTests(directory: string, savedir: string, name: string, tests: string): Promise<void> {
  const expectedCases = (tests.match(/^testcase /gm) ?? []).length;
  const expectedAssertions = (tests.match(/^\s+assert /gm) ?? []).length;
  const driver = `testsuite global:
    before testcase:
        $ _test.timeout = 12.0
        $ _test.transition_timeout = 0.05
        $ preferences.text_cps = 0
        $ preferences.afm_enable = False
        $ preferences.afm_time = 1.0
        $ preferences.skip_unseen = False
        if not screen "main_menu":
            run MainMenu(confirm=False)

    teardown:
        exit

${tests}`;
  await fs.writeFile(path.join(directory, 'game', 'testcases.rpy'), driver, 'utf8');
  const result = await runRenpy(sdkRoot, directory, ['test', '--report-detailed', '--report-skipped'], {
    savedir, timeoutMs: 150_000, onData: text => process.stdout.write(text),
  });
  const complete = /Status:\s+PASSED/.test(result.log)
    && new RegExp(`Test cases\\s*:\\s*${expectedCases}\\s*\\|\\s*${expectedCases} passed`).test(result.log)
    && new RegExp(`Assertions\\s*:\\s*${expectedAssertions}\\s*\\|\\s*${expectedAssertions} passed`).test(result.log);
  await recordStep(name, result.code || (complete ? 0 : 1), result.log, { testCases: expectedCases, assertions: expectedAssertions });
}

async function fixture(): Promise<Project> {
  const sample = projectSchema.parse(JSON.parse(await fs.readFile(path.join(exampleDir, 'project.vns.json'), 'utf8')));
  const project = createProject('玩家状态验证');
  project.id = 'project_player_state';
  project.assets = [sample.assets.find(asset => asset.kind === 'image')!];
  project.ui.menuBackgroundId = project.assets[0].id;
  project.variables = [
    { id: 'affection', name: '好感度', type: 'number', initial: 0, persistent: false },
    { id: 'runs', name: '完成次数', type: 'number', initial: 0, persistent: true },
    { id: 'completed', name: '已经完成', type: 'boolean', initial: false, persistent: true },
  ];
  const sceneId = project.scenes[0].id;
  const base = (id: string) => ({ id, sceneId, name: id, x: 0, y: 0 });
  const background: StageAction = { kind: 'background', assetId: project.assets[0].id, transition: 'none' };
  project.entryId = 'route_menu';
  project.nodes = [
    { ...base('route_menu'), kind: 'choice', prompt: '选择验证路线', choices: [
      { id: 'auto_option', text: '自动播放路线', target: 'auto_route' },
      { id: 'skip_option', text: '跳过路线', target: 'skip_route' },
      { id: 'write_option', text: '记录玩家状态', target: 'add_runs' },
      { id: 'later_option', text: '修改跨周目状态', target: 'later_runs' },
      { id: 'preview_option', text: '片段入口', target: 'preview_entry' },
    ] },
    { ...base('auto_route'), kind: 'passage', next: 'auto_choice', lines: [
      { id: 'auto_first', text: '晨光照进了窗。', actions: [background] },
      { id: 'auto_second', text: '走廊里传来了脚步。', actions: [] },
      { id: 'auto_third', text: '她停在门前。', actions: [] },
    ] },
    { ...base('auto_choice'), kind: 'choice', prompt: '是否开门？', choices: [{ id: 'auto_finish', text: '打开房门', target: 'end' }] },
    { ...base('skip_route'), kind: 'passage', next: 'skip_choice', lines: [
      { id: 'skip_first', text: '桌上放着一本旧书。', actions: [background] },
      { id: 'skip_second', text: '书页中夹着一封信。', actions: [] },
      { id: 'skip_third', text: '信封上没有署名。', actions: [] },
    ] },
    { ...base('skip_choice'), kind: 'choice', prompt: '是否读信？', choices: [{ id: 'skip_finish', text: '打开信封', target: 'end' }] },
    { ...base('add_runs'), kind: 'set', variableId: 'runs', operation: 'add', value: 1, next: 'set_completed' },
    { ...base('set_completed'), kind: 'set', variableId: 'completed', operation: 'set', value: true, next: 'set_affection' },
    { ...base('set_affection'), kind: 'set', variableId: 'affection', operation: 'set', value: 7, next: 'checkpoint' },
    { ...base('checkpoint'), kind: 'passage', next: 'end', lines: [{ id: 'checkpoint_line', text: checkpointText, actions: [background] }] },
    { ...base('later_runs'), kind: 'set', variableId: 'runs', operation: 'set', value: 10, next: 'later_completed' },
    { ...base('later_completed'), kind: 'set', variableId: 'completed', operation: 'set', value: false, next: 'later_affection' },
    { ...base('later_affection'), kind: 'set', variableId: 'affection', operation: 'set', value: 11, next: 'later_checkpoint' },
    { ...base('later_checkpoint'), kind: 'passage', next: 'end', lines: [{ id: 'later_checkpoint_line', text: laterCheckpointText, actions: [background] }] },
    { ...base('preview_entry'), kind: 'passage', next: 'end', lines: [{ id: 'preview_line', text: previewText, actions: [background] }] },
    ...endingPerformanceNodes(project, base('end'), '验证结束。'),
  ];
  return projectSchema.parse(project);
}

async function main(): Promise<void> {
  await fs.mkdir(runDir, { recursive: true });
  await writeReport();
  const project = await fixture();
  await fs.writeFile(path.join(runDir, 'project.json'), JSON.stringify(project, null, 2), 'utf8');
  const release = await buildProject({ project, projectDir: exampleDir, sdkRoot, outputDir: releaseDir, development: false });
  await recordStep('release-compile', release.ok ? 0 : 1, release.log + '\n' + JSON.stringify(release.diagnostics));
  await runTests(releaseDir, releaseSaveDir, 'release-controls-and-state', `testcase actual_auto_button:
    click id "vn_main_start"
    pause until screen "choice"
    click "自动播放路线"
    pause until "晨光照进了窗。"
    assert eval not renpy.seen_label("vn_line_auto_route_auto_second")
    assert eval (renpy.test.testfocus.find_focus("Auto forward", False).x is not None)
    click "Auto forward"
    assert eval preferences.afm_enable
    pause until screen "choice"
    assert eval (vn_current_node == "auto_choice")
    assert eval (renpy.seen_label("vn_line_auto_route_auto_second") and renpy.seen_label("vn_line_auto_route_auto_third"))
    assert eval ("走廊里传来了脚步。" in [item.what for item in _history_list])
    pause 0.5
    assert eval (vn_current_node == "auto_choice")
    screenshot "actual-auto-stops-at-choice.png"
    click "Auto forward"
    assert eval not preferences.afm_enable

testcase actual_skip_button:
    click id "vn_main_start"
    pause until screen "choice"
    click "跳过路线"
    pause until "桌上放着一本旧书。"
    assert eval not renpy.seen_label("vn_line_skip_route_skip_second")
    assert eval not preferences.skip_unseen
    click "设置"
    pause until screen "preferences"
    click "全部文本"
    assert eval preferences.skip_unseen
    screenshot "actual-skip-all-setting.png"
    click "返回游戏"
    pause until "桌上放着一本旧书。"
    assert eval (renpy.test.testfocus.find_focus("跳过", False).x is not None)
    click "跳过"
    pause until screen "choice"
    assert eval (vn_current_node == "skip_choice")
    assert eval (renpy.seen_label("vn_line_skip_route_skip_second") and renpy.seen_label("vn_line_skip_route_skip_third"))
    assert eval ("书页中夹着一封信。" in [item.what for item in _history_list])
    pause 0.5
    assert eval (vn_current_node == "skip_choice" and not renpy.is_skipping())
    screenshot "actual-skip-stops-at-choice.png"

testcase write_state_and_player_save:
    assert eval (persistent.vn_var_runs == 0 and persistent.vn_var_completed == False)
    click id "vn_main_start"
    pause until screen "choice"
    assert eval (vn_var_affection == 0)
    click "记录玩家状态"
    pause until ${JSON.stringify(checkpointText)}
    assert eval (vn_current_node == "checkpoint" and vn_var_affection == 7)
    assert eval (persistent.vn_var_runs == 1 and persistent.vn_var_completed == True)
    run FileSave("${playerSlot}", confirm=False, slot=True)
    assert eval renpy.can_load("${playerSlot}")
    screenshot "player-checkpoint-written.png"
`);
  await runTests(releaseDir, releaseSaveDir, 'release-restart-and-load', `testcase restart_retains_persistent_and_loads_save:
    assert eval (persistent.vn_var_runs == 1 and persistent.vn_var_completed == True)
    assert eval (config.save_directory == "vns_${project.id}")
    click id "vn_main_start"
    pause until screen "choice"
    assert eval (vn_current_node == "route_menu" and vn_var_affection == 0)
    assert eval (persistent.vn_var_runs == 1 and persistent.vn_var_completed == True)
    run FileLoad("${playerSlot}", confirm=False, slot=True)
    pause until ${JSON.stringify(checkpointText)}
    assert eval (vn_current_node == "checkpoint" and vn_current_line == "checkpoint_line" and vn_var_affection == 7)
    $ print("PLAYER_STATE_AFTER_LOAD", persistent.vn_var_runs, persistent.vn_var_completed, vn_var_affection)
    assert eval (persistent.vn_var_runs == 1 and persistent.vn_var_completed == True)
    run FileLoad("${playerSlot}", confirm=False, slot=True)
    pause until ${JSON.stringify(checkpointText)}
    assert eval (vn_var_affection == 7 and persistent.vn_var_runs == 1 and persistent.vn_var_completed == True)
    run FileLoad("${playerSlot}", confirm=False, slot=True)
    pause until ${JSON.stringify(checkpointText)}
    assert eval (vn_var_affection == 7 and persistent.vn_var_runs == 1 and persistent.vn_var_completed == True)
    screenshot "player-checkpoint-after-restart.png"

testcase manual_rollback_then_repeat_choice:
    run FileLoad("${playerSlot}", confirm=False, slot=True)
    pause until ${JSON.stringify(checkpointText)}
    assert eval (vn_var_affection == 7 and persistent.vn_var_runs == 1)
    click "回退"
    pause until screen "choice"
    assert eval (vn_current_node == "route_menu" and vn_var_affection == 0)
    assert eval (persistent.vn_var_runs == 1 and persistent.vn_var_completed == True)
    screenshot "manual-rollback-restores-choice.png"
    click "记录玩家状态"
    pause until ${JSON.stringify(checkpointText)}
    assert eval (vn_var_affection == 7 and persistent.vn_var_runs == 2 and persistent.vn_var_completed == True)
    screenshot "manual-choice-increments-again.png"

testcase later_persistent_values_survive_old_save_loads:
    assert eval (persistent.vn_var_runs == 2 and persistent.vn_var_completed == True)
    click id "vn_main_start"
    pause until screen "choice"
    assert eval (vn_var_affection == 0)
    click "修改跨周目状态"
    pause until ${JSON.stringify(laterCheckpointText)}
    assert eval (vn_var_affection == 11 and persistent.vn_var_runs == 10 and persistent.vn_var_completed == False)
    run FileSave("${laterPlayerSlot}", confirm=False, slot=True)
    assert eval renpy.can_load("${laterPlayerSlot}")
    run FileLoad("${playerSlot}", confirm=False, slot=True)
    pause until ${JSON.stringify(checkpointText)}
    assert eval (vn_var_affection == 7 and persistent.vn_var_runs == 10 and persistent.vn_var_completed == False)
    run FileLoad("${playerSlot}", confirm=False, slot=True)
    pause until ${JSON.stringify(checkpointText)}
    assert eval (vn_var_affection == 7 and persistent.vn_var_runs == 10 and persistent.vn_var_completed == False)
    screenshot "old-save-preserves-later-persistence.png"
`);
  await runTests(releaseDir, releaseSaveDir, 'later-persistence-after-restart', `testcase later_values_and_both_saves_survive_restart:
    assert eval (persistent.vn_var_runs == 10 and persistent.vn_var_completed == False)
    assert eval renpy.can_load("${playerSlot}")
    assert eval renpy.can_load("${laterPlayerSlot}")
    run FileLoad("${playerSlot}", confirm=False, slot=True)
    pause until ${JSON.stringify(checkpointText)}
    assert eval (vn_current_node == "checkpoint" and vn_var_affection == 7)
    assert eval (persistent.vn_var_runs == 10 and persistent.vn_var_completed == False)
    run FileLoad("${laterPlayerSlot}", confirm=False, slot=True)
    pause until ${JSON.stringify(laterCheckpointText)}
    assert eval (vn_current_node == "later_checkpoint" and vn_var_affection == 11)
    assert eval (persistent.vn_var_runs == 10 and persistent.vn_var_completed == False)
    screenshot "later-player-save-after-restart.png"
`);
  const playerFilesBefore = await hashTree(releaseSaveDir);
  if (!playerFilesBefore.some(file => file.relativePath === 'persistent')
    || !playerFilesBefore.some(file => file.relativePath.includes(playerSlot) && file.relativePath.endsWith('.save'))) {
    throw new Error('The release process did not produce both persistence and the player checkpoint.');
  }
  const scriptFile = (relativePath: string) => /\.rpyc?$/.test(relativePath);
  const releaseBuildBefore = await hashTree(path.join(releaseDir, 'game'), scriptFile);
  const preview = await buildProject({ project, projectDir: exampleDir, sdkRoot, outputDir: previewDir, development: true,
    preview: { entryId: 'preview_entry', variables: { affection: 42, runs: 99, completed: false } } });
  await recordStep('isolated-preview-compile', preview.ok ? 0 : 1, preview.log + '\n' + JSON.stringify(preview.diagnostics));
  await runTests(previewDir, previewSaveDir, 'preview-entry-and-overrides', `testcase preview_entry_and_overrides_are_isolated:
    assert eval (persistent.vn_var_runs == 0 and persistent.vn_var_completed == False)
    assert eval (config.save_directory == "vns_${project.id}_preview")
    assert eval not renpy.can_load("${playerSlot}")
    click id "vn_main_start"
    pause until ${JSON.stringify(previewText)}
    assert eval (vn_current_node == "preview_entry" and vn_current_line == "preview_line")
    assert eval (vn_var_affection == 42 and persistent.vn_var_runs == 99 and persistent.vn_var_completed == False)
    assert eval not renpy.seen_label("vn_node_route_menu")
    run FileSave("${previewSlot}", confirm=False, slot=True)
    assert eval renpy.can_load("${previewSlot}")
    screenshot "isolated-preview-overrides.png"
`);
  await runTests(previewDir, previewSaveDir, 'preview-restart-and-load', `testcase preview_persistence_and_save_remain_separate:
    assert eval (persistent.vn_var_runs == 99 and persistent.vn_var_completed == False)
    assert eval not renpy.can_load("${playerSlot}")
    assert eval renpy.can_load("${previewSlot}")
    run FileLoad("${previewSlot}", confirm=False, slot=True)
    pause until ${JSON.stringify(previewText)}
    assert eval (vn_current_node == "preview_entry" and vn_var_affection == 42)
    assert eval (persistent.vn_var_runs == 99 and persistent.vn_var_completed == False)
    screenshot "isolated-preview-after-restart.png"
`);
  const playerFilesAfter = await hashTree(releaseSaveDir);
  const releaseBuildAfter = await hashTree(path.join(releaseDir, 'game'), scriptFile);
  const unchanged = JSON.stringify(playerFilesBefore) === JSON.stringify(playerFilesAfter)
    && JSON.stringify(releaseBuildBefore) === JSON.stringify(releaseBuildAfter);
  report.isolation = { playerFilesBefore, playerFilesAfter, releaseBuildBefore, releaseBuildAfter, unchanged };
  await recordStep('release-save-and-build-integrity', unchanged ? 0 : 1, JSON.stringify(report.isolation, null, 2));
  report.status = 'passed';
  await writeReport();
  console.log(JSON.stringify({ status: report.status, testCases: report.testCases, assertions: report.assertions, report: path.join(runDir, 'report.json') }, null, 2));
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
