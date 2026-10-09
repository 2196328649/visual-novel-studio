import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PNG } from 'pngjs';
import { createProject, projectSchema } from '../src/core/model';
import { androidConfiguration, distributionCommand, exportDiagnostics, exportSettings } from '../src/core/export-settings';
import { loadProject, saveProject } from '../src/desktop/project-store';
import { compileProject } from '../src/runtime/compiler';
import { fitIcon, windowsIcon, writeExportIcons } from '../src/runtime/export-icons';
import { androidAbis, androidSigningDirectory, checkExportEnvironment, ensureAndroidSigning, exportProject, prepareAndroidExport, type GameExportOptions, type GameExportServices } from '../src/runtime/game-export';

async function workspace(t: TestContext) {
  const prefix = path.resolve(os.tmpdir(), 'vns-export-');
  const root = await fs.mkdtemp(prefix);
  t.after(async () => { assert.ok(path.resolve(root).startsWith(prefix)); await fs.rm(root, { recursive: true, force: true }); });
  return root;
}
async function file(root: string, relative: string, contents = 'fixture') {
  const target = path.join(root, relative);
  await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, contents);
}
function fixture() { const project = createProject('导出设置验证'); return { ...project, exportSettings: exportSettings(project) }; }

test('older projects retain their default Windows export; platform settings persist through save and reopen', async t => {
  const root = await workspace(t), project = createProject();
  assert.equal(projectSchema.parse(project).exportSettings, undefined);
  assert.equal(exportSettings(project).platform, 'windows');
  assert.equal(exportSettings(project).fileName, project.name);
  const next = projectSchema.parse({ ...project, exportSettings: { platform: 'android', android: { packageName: 'com.example.story' } } });
  assert.equal(next.exportSettings!.android.format, 'apk');
  next.exportSettings!.android.orientation = 'portrait';
  await saveProject(path.join(root, 'project.vns.json'), next);
  assert.deepEqual((await loadProject(path.join(root, 'project.vns.json'))).project.exportSettings, next.exportSettings);
});

test('export validation rejects invalid platform fields without corrupting editable project data', () => {
  const project = fixture();
  for (const name of ['../escape', 'C:\\game', 'bad/name', '空格 名称', 'CON', 'lpt1', 'bad.exe']) {
    project.exportSettings.fileName = name; assert.ok(exportDiagnostics(project).length, name);
    assert.equal(projectSchema.safeParse(project).success, true, 'unfinished configuration can still be saved');
  }
  project.exportSettings.fileName = 'My_Story-2';
  project.exportSettings.android.packageName = 'invalid';
  assert.deepEqual(exportDiagnostics(project), [], 'unused Android settings do not block Windows');
  project.exportSettings.platform = 'android';
  for (const name of ['invalid', 'com..story', 'com.1story', 'com.class', 'COM.example', 'com.example/game', 'com.故事']) {
    project.exportSettings.android.packageName = name; assert.ok(exportDiagnostics(project).some(d => d.message.includes('包名')), name);
  }
  project.exportSettings.android.packageName = 'com.example.my_story';
  project.exportSettings.fileName = '../unused';
  assert.deepEqual(exportDiagnostics(project), [], 'unused Windows filename does not block Android');
  for (const version of [0, -1, 1.5, 2100000001]) {
    project.exportSettings.android.versionCode = version; assert.ok(exportDiagnostics(project).some(d => d.message.includes('版本代码')));
  }
  project.exportSettings.android.versionCode = 23; project.version = '1.';
  assert.ok(exportDiagnostics(project).some(d => d.message.includes('游戏版本')));
});

test('Windows, APK and AAB use the official distribution commands without installing on a device', () => {
  const project = fixture(), build = 'C:\\Games With Spaces\\build', out = 'D:\\作品导出';
  assert.deepEqual(distributionCommand(project, build, out), ['distribute', build, '--package', 'win', '--destination', out]);
  project.exportSettings.platform = 'android';
  assert.deepEqual(distributionCommand(project, build, out), ['android_build', build, '--destination', out]);
  project.exportSettings.android.format = 'aab';
  assert.deepEqual(distributionCommand(project, build, out), ['android_build', build, '--bundle', '--destination', out]);
});

test('generated settings preserve save identity and separate human version from Android version code', () => {
  const project = fixture(); project.exportSettings.fileName = 'Aihong';
  project.exportSettings.iconAssetId = 'icon'; project.assets.push({ id: 'icon', name: '图标', kind: 'image', path: 'assets/icon.png' });
  const options = compileProject(project).files['game/options.rpy'];
  assert.match(options, /define build.name = "Aihong"/);
  assert.ok(options.includes(`define config.save_directory = "vns_${project.id}"`));
  assert.match(options, /studio-window-icon.png/); assert.match(options, /build.classify\("\*\.keystore", None\)/);
  project.exportSettings.android = { ...project.exportSettings.android, versionCode: 42, orientation: 'portrait', internet: true };
  const config = androidConfiguration(project);
  assert.equal(config.numeric_version, 42); assert.equal(config.version, project.version); assert.equal(config.orientation, 'portrait');
  assert.equal(config.package, `com.vns.${project.id}`); assert.ok(config.permissions.includes('INTERNET'));
  project.exportSettings.android.internet = false; assert.ok(!androidConfiguration(project).permissions.includes('INTERNET'));
});

test('icons preserve aspect ratio, include standard Windows sizes and clear stale generated icons', async t => {
  const root = await workspace(t), project = fixture();
  const source = new PNG({ width: 80, height: 40 }); source.data.fill(255);
  const fitted = fitIcon(source, 256);
  assert.equal(fitted.data[(10 * 256 + 128) * 4 + 3], 0); assert.equal(fitted.data[(128 * 256 + 128) * 4 + 3], 255);
  const ico = windowsIcon(source); assert.equal(ico.readUInt16LE(2), 1); assert.equal(ico.readUInt16LE(4), 4);
  for (const [index, size] of [16, 32, 48, 256].entries()) {
    const at = 6 + index * 16, length = ico.readUInt32LE(at + 8), offset = ico.readUInt32LE(at + 12);
    const png = PNG.sync.read(ico.subarray(offset, offset + length)); assert.equal(png.width, size); assert.equal(png.height, size);
  }
  await fs.mkdir(path.join(root, 'game/assets'), { recursive: true }); await fs.writeFile(path.join(root, 'game/assets/icon.png'), PNG.sync.write(source));
  project.assets = [{ id: 'icon', name: '图标', kind: 'image', path: 'assets/icon.png' }]; project.exportSettings.iconAssetId = 'icon';
  project.exportSettings.android.iconBackground = '#123456'; await writeExportIcons(project, root);
  const background = PNG.sync.read(await fs.readFile(path.join(root, 'android-icon_background.png')));
  assert.equal(background.width, 432); assert.deepEqual([...background.data.subarray(0, 4)], [18, 52, 86, 255]);
  const foreground = PNG.sync.read(await fs.readFile(path.join(root, 'android-icon_foreground.png')));
  assert.equal(foreground.width, 432); assert.equal(foreground.data[3], 0);
  project.exportSettings.iconAssetId = undefined; await writeExportIcons(project, root);
  await assert.rejects(fs.stat(path.join(root, 'icon.ico')), { code: 'ENOENT' });
  await fs.access(path.join(root, 'game/assets/icon.png'));
});

test('Android environment checks are read only and distinguish missing SDK, RAPT, Java and Spine', async t => {
  const root = await workspace(t), project = fixture(), sdk = path.join(root, 'sdk'), spine = path.join(root, 'spine');
  await file(sdk, 'renpy.py'); await file(sdk, 'lib/py3-windows-x86_64/python.exe');
  assert.equal((await checkExportEnvironment(project, { sdkRoot: sdk, spineRuntimeDir: spine })).ready, true);
  project.exportSettings.platform = 'android';
  let check = await checkExportEnvironment(project, { sdkRoot: sdk, spineRuntimeDir: spine }, async () => undefined);
  assert.equal(check.ready, false); assert.equal(check.checks.find(c => c.id === 'signing')!.status, 'info');
  assert.deepEqual(check.checks.filter(c => c.status === 'missing').map(c => c.id), ['rapt', 'jdk', 'androidSdk', 'androidBuildTools']);
  await file(sdk, 'launcher/game/rapt_hash.txt', 'correct'); await file(sdk, 'rapt/hash.txt', 'correct');
  await file(sdk, 'rapt/buildlib/rapt/build.py'); await file(sdk, 'rapt/buildlib/rapt/install_sdk.py', '"platforms;android-36"');
  await file(sdk, `rapt/Sdk/platform-tools/${process.platform === 'win32' ? 'adb.exe' : 'adb'}`);
  await file(sdk, 'rapt/Sdk/platforms/android-36/android.jar'); await file(sdk, 'rapt/Sdk/licenses/android-sdk-license');
  check = await checkExportEnvironment(project, { sdkRoot: sdk, spineRuntimeDir: spine }, async () => 'javac 21.0.8');
  assert.equal(check.ready, false, 'platform tools alone cannot produce an APK');
  for (const name of ['aapt2', 'zipalign']) await file(sdk, 'rapt/Sdk/build-tools/36.0.0/' + name + (process.platform === 'win32' ? '.exe' : ''));
  for (const name of ['apksigner', 'd8']) await file(sdk, 'rapt/Sdk/build-tools/36.0.0/lib/' + name + '.jar');
  check = await checkExportEnvironment(project, { sdkRoot: sdk, spineRuntimeDir: spine }, async () => 'javac 21.0.8'); assert.equal(check.ready, true);
  project.assets.push({ id: 'spine', name: '动画', kind: 'spine', path: 'assets/spine.json' });
  check = await checkExportEnvironment(project, { sdkRoot: sdk, spineRuntimeDir: spine }, async () => 'javac 21.0.8');
  assert.equal(check.checks.find(c => c.id === 'spine')!.status, 'missing');
  for (const abi of androidAbis) await file(spine, `android/${abi}/libvns_spine.so`);
  await file(spine, 'vns_spine.dll'); await file(spine, 'vns_spine.py');
  assert.equal((await checkExportEnvironment(project, { sdkRoot: sdk, spineRuntimeDir: spine }, async () => 'javac 21.0.8')).ready, true);
  await file(sdk, 'rapt/hash.txt', 'wrong-version');
  assert.equal((await checkExportEnvironment(project, { sdkRoot: sdk, spineRuntimeDir: spine }, async () => 'javac 21.0.8')).checks.find(c => c.id === 'rapt')!.status, 'missing');
  await assert.rejects(fs.stat(path.join(root, '.studio')), { code: 'ENOENT' });
});

test('signing survives failed builds and save-as, reuses existing keys and refuses to replace another identity', async t => {
  const root = await workspace(t), project = fixture(), original = path.join(root, 'original'), copy = path.join(root, 'copy');
  let generations = 0;
  const generate = async (destination: string) => { generations++; await fs.writeFile(destination, 'mock signing identity'); };
  const signing = await ensureAndroidSigning(project, original, generate);
  await ensureAndroidSigning(project, original, generate); assert.equal(generations, 1);
  assert.equal(await fs.readFile(path.join(signing, 'bundle.keystore'), 'utf8'), 'mock signing identity');
  await saveProject(path.join(original, 'project.vns.json'), project);
  await saveProject(path.join(copy, 'project.vns.json'), project, original);
  const copied = androidSigningDirectory(project, copy);
  assert.equal(await fs.readFile(path.join(copied, 'android.keystore'), 'utf8'), 'mock signing identity');
  await fs.writeFile(path.join(copied, 'android.keystore'), 'another signing identity');
  await assert.rejects(saveProject(path.join(copy, 'project.vns.json'), project, original), /不同的 Android 签名/);
  assert.equal(await fs.readFile(path.join(copied, 'android.keystore'), 'utf8'), 'another signing identity');
  await fs.unlink(path.join(signing, 'android.keystore')); await ensureAndroidSigning(project, original, generate); assert.equal(generations, 1);
  await fs.unlink(path.join(signing, 'android.keystore')); await fs.unlink(path.join(signing, 'bundle.keystore'));
  await assert.rejects(ensureAndroidSigning(project, original, generate), /签名文件已丢失/); assert.equal(generations, 1);
});

test('Android preparation imports existing Ren’Py signing and places native libraries by ABI', async t => {
  const root = await workspace(t), project = fixture(), projectDir = path.join(root, 'project'), buildDir = path.join(root, 'build'), sdkRoot = path.join(root, 'sdk'), spineRuntimeDir = path.join(root, 'spine');
  project.exportSettings.platform = 'android'; project.exportSettings.android.packageName = 'com.example.story';
  project.assets.push({ id: 'spine', name: '动画', kind: 'spine', path: 'assets/spine.json' });
  await file(projectDir, 'android.keystore', 'original apk identity'); await file(projectDir, 'bundle.keystore', 'original bundle identity');
  for (const abi of androidAbis) await file(spineRuntimeDir, `android/${abi}/libvns_spine.so`, abi);
  await prepareAndroidExport(project, { projectDir, buildDir, sdkRoot, spineRuntimeDir }, async () => { assert.fail('existing signing must not be regenerated'); });
  assert.equal(await fs.readFile(path.join(buildDir, 'bundle.keystore'), 'utf8'), 'original bundle identity');
  assert.equal(JSON.parse(await fs.readFile(path.join(buildDir, 'android.json'), 'utf8')).package, 'com.example.story');
  for (const abi of androidAbis) assert.equal(await fs.readFile(path.join(sdkRoot, 'rapt/prototype/renpyandroid/src/main/jniLibs', abi, 'libvns_spine.so'), 'utf8'), abi);
});

async function exportHarness(t: TestContext) {
  const root = await workspace(t), project = fixture(), calls: string[] = [], commands: string[][] = [];
  const options: GameExportOptions = { project, sdkRoot: path.join(root, 'sdk'), projectDir: path.join(root, 'project'), spineRuntimeDir: path.join(root, 'spine'), buildDir: path.join(root, 'build'), baselineDir: path.join(root, 'baseline'), outputDir: path.join(root, 'output') };
  const services: GameExportServices = {
    check: async p => ({ platform: exportSettings(p).platform, ready: true, checks: [], diagnostics: [] }),
    build: async opts => { calls.push('compile'); assert.equal(opts.development, false); return { ok: true, diagnostics: [{ severity: 'warning', message: 'existing authoring warning' }], log: 'compile log', buildPath: opts.outputDir }; },
    prepareAndroid: async () => { calls.push('android configuration and signing'); },
    distribute: async (_sdk, _launcher, command) => {
      calls.push('distribution'); commands.push(command);
      const settings = exportSettings(project), extension = settings.platform === 'windows' ? 'zip' : settings.android.format;
      const destination = command[command.indexOf('--destination') + 1];
      await fs.writeFile(path.join(destination, `test.${extension}`), 'mock distribution output — not an installable package');
      return { code: 0, log: 'distribution log' };
    },
    preserve: async () => { calls.push('save baseline'); },
  };
  return { project, options, services, calls, commands };
}

test('export pipeline chooses Windows/APK/AAB, verifies output and updates the baseline only after success', async t => {
  for (const platform of ['windows', 'apk', 'aab'] as const) {
    const { project, options, services, calls, commands } = await exportHarness(t);
    if (platform !== 'windows') { project.exportSettings.platform = 'android'; project.exportSettings.android.format = platform; }
    const result = await exportProject(options, services); assert.equal(result.ok, true); assert.equal(result.outputPath, options.outputDir);
    assert.deepEqual(calls, platform === 'windows' ? ['compile', 'distribution', 'save baseline'] : ['compile', 'android configuration and signing', 'distribution', 'save baseline']);
    assert.equal(commands[0][0], platform === 'windows' ? 'distribute' : 'android_build'); assert.equal(commands[0].includes('--bundle'), platform === 'aab');
    assert.equal(result.diagnostics[0].message, 'existing authoring warning');
    assert.deepEqual(await fs.readdir(options.outputDir), [`test.${platform === 'windows' ? 'zip' : platform}`]);
  }
});

test('missing dependencies, failed distribution or absent output never report a successful export', async t => {
  const { project, options, services, calls } = await exportHarness(t);
  const unavailable: GameExportServices = { ...services, check: async () => ({ platform: 'windows', ready: false, checks: [], diagnostics: [{ severity: 'error', message: 'missing runtime' }] }) };
  assert.equal((await exportProject(options, unavailable)).ok, false); assert.equal(calls.length, 0);
  await assert.rejects(fs.stat(options.buildDir), { code: 'ENOENT' });
  let result = await exportProject(options, { ...services, distribute: async () => ({ code: 1, log: 'gradle failure' }) });
  assert.equal(result.ok, false); assert.ok(result.log.includes('gradle failure')); assert.equal(result.outputPath, undefined); assert.ok(!calls.includes('save baseline'));
  await file(options.outputDir, 'test.zip', 'a previous successful export');
  result = await exportProject(options, { ...services, distribute: async () => ({ code: 0, log: '' }) });
  assert.equal(result.ok, false); assert.match(result.diagnostics[0].message, /没有生成/); assert.ok(!calls.includes('save baseline'));
  assert.equal(await fs.readFile(path.join(options.outputDir, 'test.zip'), 'utf8'), 'a previous successful export');
  project.exportSettings.fileName = '../bad'; calls.length = 0;
  assert.equal((await exportProject(options, services)).ok, false); assert.equal(calls.length, 0);
});
