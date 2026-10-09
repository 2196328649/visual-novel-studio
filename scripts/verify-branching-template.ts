import { endingVisible, endingTestHelper } from './lib/ending-fixture';
import assert from 'node:assert/strict';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { createBranchingProject } from '../src/core/project-templates';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { exportSettings } from '../src/core/export-settings';
import { exportProject } from '../src/runtime/game-export';
import { renderedScreenTextHelper } from './lib/renpy-screen-test';

const root = path.resolve('.'), output = path.join(root, 'artifacts/branching-template', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const original = createBranchingProject('雨中的车站'), parsed = applyTextScript(original, projectToText(original));
assert.deepEqual(parsed.issues, []);
const project = parsed.project;
project.exportSettings = { ...exportSettings(project), platform: 'windows', fileName: 'Rainy-Station' };
await fs.writeFile(path.join(output, 'project.vns.json'), JSON.stringify(project, null, 2));
try {
  const result = await exportProject({ project, projectDir: output, sdkRoot: path.join(root, 'resources/runtime'), spineRuntimeDir: path.join(root, 'resources/spine'),
    buildDir: path.join(output, 'build'), baselineDir: path.join(output, 'baseline'), outputDir: path.join(output, 'distribution') });
  await fs.writeFile(path.join(output, 'export.log'), result.log);
  assert.equal(result.ok, true, result.log + JSON.stringify(result.diagnostics));
  const archive = path.join(result.outputPath!, (await fs.readdir(result.outputPath!)).find(name => name.endsWith('.zip'))!);
  const unpacked = path.join(output, 'unpacked');
  await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Add-Type -AssemblyName System.IO.Compression.FileSystem\n[System.IO.Compression.ZipFile]::ExtractToDirectory($env:VNS_BRANCH_ARCHIVE, $env:VNS_BRANCH_UNPACKED)'],
    { windowsHide: true, env: { ...process.env, VNS_BRANCH_ARCHIVE: archive, VNS_BRANCH_UNPACKED: unpacked }, timeout: 180000 });
  const folder = (await fs.readdir(unpacked, { withFileTypes: true })).find(entry => entry.isDirectory())!;
  const gameRoot = path.join(unpacked, folder.name), executable = path.join(gameRoot, (await fs.readdir(gameRoot)).find(name => name.endsWith('.exe'))!);
  const endings = project.nodes.filter(node => node.kind === 'end');
  const choices = project.nodes.find(node => node.kind === 'choice')!;
  const testSource = `${endingTestHelper}
${renderedScreenTextHelper}
testsuite global:
    before testcase:
        $ _test.timeout = 20.0
        $ _test.transition_timeout = 0.1
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
        $ preferences.afm_enable = False
    teardown:
        exit

testcase both_endings_and_save_load:
    assert screen "main_menu"
    screenshot "01-title.png"
    click id "vn_main_start"
    pause until screen "say"
    assert "末班车离站后，雨还没有停。"
    screenshot "02-opening.png"
    advance until screen "choice"
    screenshot "03-choice.png"
    run FileSave("branch-choice", confirm=False, slot=True)
    click ${JSON.stringify(choices.choices[0].text)}
    advance until eval ${endingVisible(project, endings[0])}
    pause 0.7
    screenshot "04-ending-together.png"
    assert eval ${endingVisible(project, endings[0])}
    assert eval not vns_test_rendered_texts("quick_menu")
    run FileLoad("branch-choice", confirm=False, slot=True)
    pause until screen "choice"
    screenshot "05-restored-choice.png"
    assert eval ${JSON.stringify(choices.prompt)} in vns_test_rendered_texts("say")
    assert eval vn_current_node == ${JSON.stringify(choices.id)}
    assert eval "存档" in vns_test_rendered_texts("quick_menu")
    click ${JSON.stringify(choices.choices[1].text)}
    advance until eval ${endingVisible(project, endings[1])}
    pause 0.7
    screenshot "06-ending-again.png"
    assert eval ${endingVisible(project, endings[1])}
    assert eval not vns_test_rendered_texts("quick_menu")
    advance until screen "main_menu"
    click id "vn_main_start"
    pause until screen "say"
    assert "末班车离站后，雨还没有停。"
    screenshot "07-new-game.png"
    assert eval "存档" in vns_test_rendered_texts("quick_menu")
`;
  // Only the extracted verification copy receives tests; the release ZIP stays clean.
  await fs.writeFile(path.join(gameRoot, 'game/testcases.rpy'), testSource);
  let log = '';
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn(executable, [gameRoot, 'test', '--report-detailed', '--savedir', path.join(output, 'saves')], { cwd: gameRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', data => { log += String(data); }); child.stderr.on('data', data => { log += String(data); });
    const timer = setTimeout(() => child.kill(), 120000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve(code ?? 1); });
  });
  await fs.writeFile(path.join(output, 'run.log'), log);
  assert.equal(code, 0, log);
  const hash = createHash('sha256'); for await (const chunk of createReadStream(archive)) hash.update(chunk);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', archive, executable, sha256: hash.digest('hex'), code,
    checks: ['正式导出 Windows ZIP，直接运行包内 EXE', '两条结局、存档后分支读回、新开局', '多行结局经文本往返后仍完整显示'], screenshots: path.join(gameRoot, 'tests/screenshots') }, null, 2));
  console.log(output);
} catch (error) { await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', error: String(error) }, null, 2)); console.log(output); throw error; }
