import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PNG } from 'pngjs';
import { createProject } from '../src/core/model';
import { exportSettings } from '../src/core/export-settings';
import { packageSingleExe, singleExeEntry } from '../src/runtime/single-exe';
import { exportProject } from '../src/runtime/game-export';
import { nativeEnvironment } from '../src/runtime/process-env';
import { verifyExecutableIcon } from './lib/windows-icon';
import { pythonLiteral } from '../src/runtime/literals';

const execute = promisify(execFile), root = path.resolve('.'), sdk = path.join(root, 'resources/runtime');
const output = path.join(root, 'artifacts/single-exe', new Date().toISOString().replaceAll(':', '-')), distribution = path.join(output, '中文 空格 游戏');
await fs.mkdir(distribution, { recursive: true });
const python = path.join(sdk, 'lib/py3-windows-x86_64/python.exe'), toolsDir = path.join(root, 'resources/single-exe');
const probeSource = path.join(output, 'Probe.cs'), probe = path.join(output, 'Probe.exe'), probeResult = path.join(output, 'probe.json');
await fs.writeFile(probeSource, 'using System; using System.IO; using System.Web.Script.Serialization; class Probe { static int Main(string[] args) { File.WriteAllText(Environment.GetEnvironmentVariable("VNS_PROBE_RESULT"), new JavaScriptSerializer().Serialize(new { args, directory = Environment.CurrentDirectory, file = System.Reflection.Assembly.GetExecutingAssembly().Location })); return 7; } }');
await execute(path.join(process.env.SystemRoot!, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'), ['/nologo', '/reference:System.Web.Extensions.dll', '/out:' + probe, probeSource], { windowsHide: true });
const probeZip = path.join(output, 'probe.zip');
await execute(python, ['-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1],"w",zipfile.ZIP_DEFLATED); z.write(sys.argv[2],"测试目录/测试游戏.exe"); z.writestr("测试目录/说明.txt","中文")', probeZip, probe], { windowsHide: true, env: nativeEnvironment({ PYTHONUTF8: '1' }) });
const probePackage = path.join(distribution, '参数 测试.exe');
await packageSingleExe({ archive: probeZip, destination: probePackage, toolsDir, title: '参数测试', entry: '测试目录/测试游戏.exe' });
const slash = String.fromCharCode(92);
const argumentsToForward = ['普通', '含 空格', 'a"b', 'C:' + slash + 'path with space' + slash, '', '反斜线' + slash.repeat(2) + '"引号'];
for (let run = 0; run < 2; run++) {
  try { await execute(probePackage, argumentsToForward, { windowsHide: true, timeout: 30000, env: nativeEnvironment({ VNS_PROBE_RESULT: probeResult }) }); assert.fail('Probe exit code must be forwarded'); }
  catch (error) { assert.equal((error as any).code, 7, String(error)); }
  const result = JSON.parse(await fs.readFile(probeResult, 'utf8'));
  assert.deepEqual(result.args, argumentsToForward); assert.ok(result.directory.includes('vns-'));
  assert.equal(await fs.stat(result.file).then(() => true, () => false), false, 'temporary game removed after exit');
}
const project = createProject('单文件游戏'); project.width = 800; project.height = 450; project.playerDefaults = { textSpeed: 0, fullscreen: false, masterVolume: 0 };
project.nodes.find(n => n.kind === 'passage')!.lines = [{ id: 'hello', text: 'Single EXE game.', actions: [] }];
const png = new PNG({ width: 128, height: 128 }); for (let i = 0; i < png.data.length; i += 4) png.data.set([60, 155, 220, 255], i);
await fs.writeFile(path.join(output, 'icon.png'), PNG.sync.write(png)); project.assets.push({ id: 'icon', name: '图标', kind: 'image', path: 'icon.png' });
project.exportSettings = exportSettings(project); project.exportSettings.windows.format = 'exe'; project.exportSettings.iconAssetId = 'icon';
const buildDir = path.join(output, 'build');
const result = await exportProject({ project, projectDir: output, buildDir, baselineDir: path.join(output, 'baseline'), sdkRoot: sdk, spineRuntimeDir: path.join(root, 'resources/spine'), outputDir: distribution, onData: value => { if (/正在|已导出/.test(value)) console.log(value.trim()); } });
await fs.writeFile(path.join(output, 'export.log'), result.log); assert.equal(result.ok, true, result.log + JSON.stringify(result.diagnostics));
const gameExe = (await fs.readdir(distribution)).find(name => name.startsWith(project.name) && name.endsWith('.exe'))!; assert.ok(gameExe);
const icon = verifyExecutableIcon(await fs.readFile(path.join(distribution, gameExe)), await fs.readFile(path.join(buildDir, 'icon.ico')));
assert.equal((await fs.readdir(distribution)).some(name => name.endsWith('.zip')), false, 'single EXE choice publishes no separate ZIP');
await execute(path.join(distribution, gameExe), ['.', 'lint'], { windowsHide: true, timeout: 60000, env: nativeEnvironment() });
console.log('Standalone exported EXE lint passed');
const stage = path.join(buildDir, 'dist', (await fs.readdir(path.join(buildDir, 'dist')))[0]);
const archive = path.join(stage, (await fs.readdir(stage)).find(name => name.endsWith('.zip'))!);
const entry = await singleExeEntry(sdk, archive), prefix = entry.split('/')[0];
const qaZip = path.join(output, 'qa.zip'), qaScript = path.join(output, 'testcases.rpy'), qaResult = path.join(output, 'game-result.json');
await fs.copyFile(archive, qaZip);
await fs.writeFile(qaScript, `
init 100 python:
    import json as qa_json
testsuite global:
    before testcase:
        $ _test.timeout = 15
        $ preferences.text_cps = 0
        $ _test.screenshot_directory = ${pythonLiteral(path.join(output, 'screenshots').replaceAll('\\', '/'))}
    teardown:
        exit
testcase standalone:
    click id "vn_main_start"
    pause until "Single EXE game."
    $ renpy.session["qa_had_save"] = renpy.can_load("single")
    run FileSave("single", confirm=False, slot=True)
    run FileLoad("single", confirm=False, slot=True)
    pause until "Single EXE game."
    assert eval renpy.can_load("single")
    screenshot "game.png"
    $ qa_json.dump(dict(passed=True, basedir=config.basedir, savedir=config.savedir, hadSave=renpy.session["qa_had_save"]), open(${pythonLiteral(qaResult.replaceAll('\\', '/'))}, "w"))
`);
await execute(python, ['-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1],"a",zipfile.ZIP_DEFLATED); z.write(sys.argv[2],sys.argv[3])', qaZip, qaScript, prefix + '/game/testcases.rpy'], { windowsHide: true });
const qaExe = path.join(distribution, '单文件 游戏验收.exe');
await packageSingleExe({ archive: qaZip, destination: qaExe, toolsDir, title: project.name, entry, icon: path.join(buildDir, 'icon.ico') });
let lastGame: any;
for (let run = 0; run < 2; run++) {
  await fs.rm(qaResult, { force: true });
  const tested = await execute(qaExe, ['.', 'test', '--report-detailed'], { windowsHide: true, timeout: 60000, env: nativeEnvironment({ PATH: path.join(process.env.SystemRoot!, 'System32'), PYTHONUTF8: '1' }) });
  await fs.writeFile(path.join(output, `game-run-${run}.log`), tested.stdout + tested.stderr);
  lastGame = JSON.parse(await fs.readFile(qaResult, 'utf8')); assert.equal(lastGame.passed, true);
  assert.equal(lastGame.hadSave, run > 0); assert.ok(!lastGame.savedir.startsWith(lastGame.basedir));
  assert.ok(path.resolve(lastGame.basedir).toLowerCase().startsWith((await fs.realpath(os.tmpdir())).toLowerCase() + path.sep)); assert.equal(await fs.stat(lastGame.basedir).then(() => true, () => false), false);
  assert.ok((await fs.readdir(lastGame.savedir)).some(name => name.endsWith('.save')));
}
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', executable: path.join(distribution, gameExe), checks: ['single file only', 'Chinese and spaced paths', 'all forwarded arguments and exit code', 'temp cleanup twice', 'real exported game lint', 'real game save/load/restart without SDK on PATH', 'embedded Windows icon'], iconSizes: icon.sizes, lastGame }, null, 2));
console.log(output);
