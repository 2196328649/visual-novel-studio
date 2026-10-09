import { endingVisible, endingTestHelper } from './lib/ending-fixture';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectSchema, type PassageNode, type Project } from '../src/core/model';
import { buildProject, preserveCompiledGame, runRenpy } from '../src/runtime/service';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sdkRoot = path.join(appRoot, 'resources', 'runtime');
const exampleDir = path.join(appRoot, 'resources', 'example');
const outputRoot = path.join(appRoot, 'artifacts', 'save-compatibility');
const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const runDir = path.join(outputRoot, runId);
const firstDir = path.join(runDir, 'v1');
const secondDir = path.join(runDir, 'v2');
const baselineDir = path.join(runDir, 'release-baseline');
const saveDir = path.join(runDir, 'player-saves');
const librarySlot = 'vns_compat_library';
const callSlot = 'vns_compat_call';
const revisedLibrary = 'QA revised library checkpoint.';
const originalCommon = 'QA original common checkpoint.';
const revisedCommon = 'QA revised common checkpoint.';
const insertedLibrary = 'QA inserted after the library checkpoint.';
const insertedCommon = 'QA inserted after the common checkpoint.';

const report: {
  runId: string;
  runtime: string;
  firstBuild: string;
  secondBuild: string;
  savedir: string;
  baseline: { relativePath: string; sha256: string }[];
  saveFiles: { path: string; sha256: string }[];
  steps: { name: string; code: number; logPath: string }[];
  status: 'running' | 'passed' | 'failed';
  scope: string[];
  error?: string;
} = {
  runId, runtime: sdkRoot, firstBuild: firstDir, secondBuild: secondDir, savedir: saveDir,
  baseline: [], saveFiles: [], steps: [], status: 'running',
  scope: [
    'Two distinct release-mode builds using the bundled example plus a call/return fixture.',
    'Actual v1 player saves are loaded by v2 after rewriting their current dialogue and inserting dialogue before and after it.',
    'Stable node, line, variable, and call IDs are retained; v1 compiled files are supplied through v2/old-game.',
    'Checks restored variable values, displayed revised text, subsequent inserted lines, call return, endings, and main menu.',
    'Does not establish compatibility after deleting IDs, changing variable types, arbitrary graph rewrites, or changing RenPy versions.',
  ],
};

async function hashFile(file: string): Promise<string> {
  return createHash('sha256').update(await fs.readFile(file)).digest('hex');
}

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

function passage(project: Project, id: string): PassageNode {
  const node = project.nodes.find(item => item.id === id);
  if (!node || node.kind !== 'passage') throw new Error(`Missing fixture passage ${id}.`);
  return node;
}

function driver(body: string): string {
  return `testsuite global:
    before testcase:
        $ _test.timeout = 8.0
        $ _test.transition_timeout = 0.05
        $ preferences.text_cps = 0
        $ preferences.afm_enable = False
        if not screen "main_menu":
            run MainMenu(confirm=False)

    teardown:
        exit

${body}`;
}

async function runTests(directory: string, name: string, tests: string, expectedCases: number): Promise<void> {
  await fs.writeFile(path.join(directory, 'game', 'testcases.rpy'), endingTestHelper + driver(tests), 'utf8');
  const result = await runRenpy(sdkRoot, directory, ['test', '--report-detailed', '--report-skipped'], {
    savedir: saveDir, timeoutMs: 120_000, onData: text => process.stdout.write(text),
  });
  await recordStep(name, result.code, result.log);
  if (!new RegExp(`Test cases\\s*:\\s*${expectedCases}\\s*\\|\\s*${expectedCases} passed`).test(result.log)) {
    throw new Error(`${name} did not execute every expected testcase.`);
  }
}

async function main(): Promise<void> {
  await fs.mkdir(runDir, { recursive: true });
  await writeReport();
  const first = projectSchema.parse(JSON.parse(await fs.readFile(path.join(exampleDir, 'project.vns.json'), 'utf8')));
  first.id = 'project_save_compat';
  const library = passage(first, 'library');
  const originalLibrary = library.lines.find(line => line.id === 'line_xia')!.text;
  library.next = 'compat_call';
  first.nodes.push(
    { id: 'compat_call', kind: 'call', name: 'Compatibility call', sceneId: library.sceneId, x: 900, y: 400, target: 'compat_common', next: 'choice_help' },
    { id: 'compat_common', kind: 'passage', name: 'Compatibility common passage', sceneId: library.sceneId, x: 1200, y: 400, next: 'compat_return', lines: [
      { id: 'compat_before', text: 'QA common passage begins.', actions: [] },
      { id: 'compat_current', text: originalCommon, actions: [] },
      { id: 'compat_after', text: 'QA common passage continues.', actions: [] },
    ] },
    { id: 'compat_return', kind: 'return', name: 'Compatibility return', sceneId: library.sceneId, x: 1500, y: 400 },
  );
  await fs.writeFile(path.join(runDir, 'v1.project.json'), JSON.stringify(first, null, 2), 'utf8');
  const firstBuild = await buildProject({ project: first, projectDir: exampleDir, sdkRoot, outputDir: firstDir, development: false });
  await recordStep('v1-release-compile', firstBuild.ok ? 0 : 1, firstBuild.log + '\n' + JSON.stringify(firstBuild.diagnostics));
  await preserveCompiledGame(firstDir, baselineDir);
  for (const relativePath of ['story.rpyc', 'screens.rpyc', 'options.rpyc']) {
    report.baseline.push({ relativePath, sha256: await hashFile(path.join(baselineDir, relativePath)) });
  }
  const accept = first.nodes.find(node => node.id === 'choice_invite');
  const help = first.nodes.find(node => node.id === 'choice_help');
  const warm = first.nodes.find(node => node.id === 'ending_warm');
  const friend = first.nodes.find(node => node.id === 'ending_friend');
  if (accept?.kind !== 'choice' || help?.kind !== 'choice' || warm?.kind !== 'passage' || friend?.kind !== 'passage') throw new Error('Unexpected example structure.');
  await runTests(firstDir, 'v1-create-player-saves', `testcase create_player_saves:
    click id "vn_main_start"
    advance until screen "choice"
    click ${JSON.stringify(accept.choices[0].text)}
    advance until ${JSON.stringify(originalLibrary)}
    assert eval (vn_current_node == "library" and vn_current_line == "line_xia" and vn_var_affection == 1)
    run FileSave("${librarySlot}", confirm=False, slot=True)
    assert eval renpy.can_load("${librarySlot}")
    screenshot "v1-library-save.png"
    advance until ${JSON.stringify(originalCommon)}
    assert eval (vn_current_node == "compat_common" and vn_current_line == "compat_current" and vn_var_affection == 1)
    assert eval ("vn_return_compat_call" in renpy.get_return_stack())
    run FileSave("${callSlot}", confirm=False, slot=True)
    assert eval renpy.can_load("${callSlot}")
    screenshot "v1-call-save.png"
    run MainMenu(confirm=False)
    assert screen "main_menu"
`, 1);
  for (const slot of [librarySlot, callSlot]) {
    const names = (await fs.readdir(saveDir)).filter(name => name.endsWith('.save') && (name === `${slot}.save` || name.startsWith(`${slot}-`)));
    if (names.length !== 1) throw new Error(`Expected exactly one v1 save for ${slot}.`);
    const file = path.join(saveDir, names[0]);
    report.saveFiles.push({ path: file, sha256: await hashFile(file) });
  }
  const second = structuredClone(first);
  second.version = '1.0.1';
  for (const [nodeId, lineId, revised, inserted] of [
    ['library', 'line_xia', revisedLibrary, insertedLibrary],
    ['compat_common', 'compat_current', revisedCommon, insertedCommon],
  ]) {
    const node = passage(second, nodeId);
    const index = node.lines.findIndex(line => line.id === lineId);
    node.lines[index].text = revised;
    node.lines.splice(index + 1, 0, { id: `${lineId}_inserted_after`, text: inserted, actions: [] });
    node.lines.splice(index, 0, { id: `${lineId}_inserted_before`, text: `QA inserted before ${lineId}.`, actions: [] });
  }
  await fs.writeFile(path.join(runDir, 'v2.project.json'), JSON.stringify(second, null, 2), 'utf8');
  // Preserve the released statement identities before the new compilation starts.
  await fs.cp(baselineDir, path.join(secondDir, 'old-game'), { recursive: true });
  const secondBuild = await buildProject({ project: second, projectDir: exampleDir, sdkRoot, outputDir: secondDir, development: false });
  await recordStep('v2-release-compile-with-baseline', secondBuild.ok ? 0 : 1, secondBuild.log + '\n' + JSON.stringify(secondBuild.diagnostics));
  for (const entry of report.baseline) {
    if (await hashFile(path.join(secondDir, 'old-game', entry.relativePath)) !== entry.sha256) throw new Error(`Baseline changed: ${entry.relativePath}`);
  }
  await recordStep('old-game-baseline-integrity', 0, JSON.stringify(report.baseline, null, 2));
  await runTests(secondDir, 'v2-load-old-player-saves', `testcase restore_rewritten_dialogue:
    assert eval renpy.can_load("${librarySlot}")
    run FileLoad("${librarySlot}", confirm=False, slot=True)
    pause until ${JSON.stringify(revisedLibrary)}
    assert ${JSON.stringify(revisedLibrary)}
    assert eval (vn_current_node == "library" and vn_current_line == "line_xia" and vn_var_affection == 1)
    screenshot "v2-library-restored.png"
    advance
    assert ${JSON.stringify(insertedLibrary)}
    assert eval (vn_current_line == "line_xia_inserted_after" and vn_var_affection == 1)
    advance until screen "choice"
    assert eval (vn_current_node == "choice_help" and vn_var_affection == 1)
    click ${JSON.stringify(help.choices[0].text)}
    advance until eval ${endingVisible(second, warm)}
    assert eval (vn_current_node == "ending_warm" and vn_var_affection == 2)
    advance until screen "main_menu"
    assert screen "main_menu"

testcase restore_active_call_then_return:
    assert eval renpy.can_load("${callSlot}")
    run FileLoad("${callSlot}", confirm=False, slot=True)
    pause until ${JSON.stringify(revisedCommon)}
    assert ${JSON.stringify(revisedCommon)}
    assert eval (vn_current_node == "compat_common" and vn_current_line == "compat_current" and vn_var_affection == 1)
    assert eval ("vn_return_compat_call" in renpy.get_return_stack())
    screenshot "v2-call-restored.png"
    advance
    assert ${JSON.stringify(insertedCommon)}
    assert eval (vn_current_line == "compat_current_inserted_after" and vn_var_affection == 1)
    advance until screen "choice"
    assert eval (vn_current_node == "choice_help" and vn_var_affection == 1)
    assert eval ("vn_return_compat_call" not in renpy.get_return_stack())
    click ${JSON.stringify(help.choices[1].text)}
    advance until eval ${endingVisible(second, friend)}
    assert eval (vn_current_node == "ending_friend" and vn_var_affection == 1)
    advance until screen "main_menu"
    assert screen "main_menu"
`, 2);
  for (const save of report.saveFiles) {
    if (await hashFile(save.path) !== save.sha256) throw new Error(`Old save was replaced during v2 verification: ${save.path}`);
  }
  await recordStep('old-save-integrity', 0, JSON.stringify(report.saveFiles, null, 2));
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
