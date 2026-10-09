import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';

function run(executable: string, args: string[], cwd: string, extraEnv: NodeJS.ProcessEnv = {}) {
  return new Promise<{ code: number; log: string }>((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', ...extraEnv };
    for (const key of ['PYTHONHOME', 'PYTHONPATH', 'RENPY_BASE', 'ELECTRON_RUN_AS_NODE']) delete env[key];
    const child = spawn(executable, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = ''; const timeout = setTimeout(() => child.kill(), 120_000);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { log += data.toString(); });
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('close', code => { clearTimeout(timeout); resolve({ code: code ?? 1, log }); });
  });
}

export async function verifyInstanceExport(zip: string, output: string, projectId: string) {
  const digest = async () => createHash('sha256').update(await fs.readFile(zip)).digest('hex');
  const sha256 = await digest(), extraction = path.join(output, 'standalone');
  const expanded = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    'Add-Type -AssemblyName System.IO.Compression.FileSystem\n[System.IO.Compression.ZipFile]::ExtractToDirectory($env:VNS_ACTOR_ZIP, $env:VNS_ACTOR_UNPACK)'], output,
    { VNS_ACTOR_ZIP: zip, VNS_ACTOR_UNPACK: extraction });
  assert.equal(expanded.code, 0, expanded.log);
  const directories = (await fs.readdir(extraction, { withFileTypes: true })).filter(entry => entry.isDirectory());
  assert.equal(directories.length, 1);
  const game = path.join(extraction, directories[0].name), executable = path.join(game, projectId + '.exe');
  await fs.access(executable);
  for (const file of ['game/testcases.rpy', 'game/testcases.rpyc', 'game/saves']) assert.equal(await fs.access(path.join(game, file)).then(() => true, () => false), false);
  const source = await fs.readFile(path.join(game, 'game/story.rpy'), 'utf8');
  assert.ok(source.includes('as vn_instance_actor_1'));
  assert.ok(source.includes('vn_finish_line_actors()'));
  assert.ok(!source.includes('VNS_EVENT:'));
  await fs.writeFile(path.join(game, 'game/testcases.rpy'), `testsuite global:
    before testcase:
        $ _test.timeout = 25.0
        $ _test.transition_timeout = .05
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
    teardown:
        exit

testcase exported_instances:
    click id "vn_component_ai_title_start"
    pause until "左右两个持续实例，添加一个本句副本。"
    assert eval all(renpy.showing("vn_instance_" + key) for key in ("left", "right", "actor_1"))
    assert eval vn_actor_instances["vn_instance_right"]["lifetime"] == "persistent"
    run FileSave("exported_instances", confirm=False, slot=True)
    assert eval renpy.can_load("exported_instances")
    advance until "本句副本清除，左右继续显示。"
    assert eval not renpy.showing("vn_instance_actor_1")
    assert eval renpy.showing("vn_instance_left") and renpy.showing("vn_instance_right")
    screenshot "exported-two-persistent.png"
    run FileLoad("exported_instances", confirm=False, slot=True)
    pause until "左右两个持续实例，添加一个本句副本。"
    assert eval all(renpy.showing("vn_instance_" + key) for key in ("left", "right", "actor_1"))
    advance until "右侧隐藏后，左侧仍然显示。"
    assert eval renpy.showing("vn_instance_left") and not renpy.showing("vn_instance_right")
    assert eval len(vn_chapter_particle_seeds) == 200
    screenshot "exported-left-only.png"
    run MainMenu(confirm=False)
    assert screen "main_menu"
`);
  const result = await run(executable, ['--savedir', path.join(output, 'standalone-saves'), game, 'test', '--report-detailed'], game,
    { PATH: `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}` });
  await fs.writeFile(path.join(output, 'standalone-game.log'), result.log);
  assert.equal(result.code, 0, result.log.slice(-6500));
  assert.match(result.log, /Assertions\s*:\s*9\s*\|\s*9 passed/);
  assert.equal(await digest(), sha256);
  return { zip, sha256, executable, log: path.join(output, 'standalone-game.log'), assertions: 9 };
}
