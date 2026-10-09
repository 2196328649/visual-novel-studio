import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = path.resolve('.'), release = path.join(root, 'release');
const read = async (file: string) => JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const { version } = await read(path.join(root, 'package.json'));
const evidenceRoot = path.join(root, `artifacts/editor-release-${version}`);
const packaged = path.join(release, 'win-unpacked');
const installer = path.join(release, `Visual Novel Studio Setup ${version}.exe`);
const portableZip = path.join(release, `Visual-Novel-Studio-${version}-portable-win-x64.zip`);
const archive = path.join(packaged, 'resources/app.asar');
const digest = async (file: string) => { const hash = createHash('sha256'); for await (const data of createReadStream(file)) hash.update(data); return hash.digest('hex'); };
const hashes = { executable: await digest(path.join(packaged, 'Visual Novel Studio.exe')), asar: await digest(archive), installer: await digest(installer), portable: await digest(portableZip) };
const checks: string[] = [], evidence: Record<string, unknown> = {};
const walk = async (directory: string, prefix = ''): Promise<string[]> => {
  const files: string[] = [];
  for (const entry of await fs.readdir(path.join(directory, prefix), { withFileTypes: true })) {
    assert.equal(entry.isSymbolicLink(), false, `Unexpected link: ${entry.name}`);
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await walk(directory, relative)); else if (entry.isFile()) files.push(relative);
  }
  return files.sort();
};
async function latest(directory: string, accepts: (data: any, file: string) => Promise<boolean> | boolean) {
  const folder = path.join(root, 'artifacts', directory);
  for (const entry of (await fs.readdir(folder)).sort().reverse()) {
    const file = path.join(folder, entry, 'report.json'), data = await read(file).catch(() => undefined);
    if (data?.status === 'passed' && await accepts(data, file)) return { file, data };
  }
  throw new Error(`No matching successful acceptance: ${directory}`);
}

const installationFile = path.join(root, `artifacts/installation-${version}.json`), installation = await read(installationFile);
assert.equal(installation.passed, true); assert.equal(installation.exitCode, 0); assert.equal(installation.afterVersion, version);
assert.equal(installation.installerSha256, hashes.installer); assert.equal(installation.afterAsarSha256, hashes.asar);
assert.equal(installation.beforeProjectSha256, installation.afterProjectSha256);
assert.equal(await digest(path.join(installation.destination, 'Visual Novel Studio.exe')), hashes.executable);
assert.equal(await fs.access(path.join(installation.destination, 'portable.json')).then(() => true, () => false), false);
evidence.installation = { file: installationFile, ...installation };
checks.push(`实际运行最终安装器，从 ${installation.beforeVersion} 升级到 ${version}，安装代码与打包代码相同，旧验收工程字节不变。`);

for (const name of ['chapter-workspace', `fidelity-editor-${version}`, 'export-setup']) {
  const result = await latest(name, async (_data, file) => {
    const tested = await read(path.join(path.dirname(file), 'tested-app.json')).catch(() => undefined);
    return tested?.packaged && tested.version === version && tested.binaries.asar === hashes.asar && tested.binaries.executable === hashes.executable;
  });
  evidence[name] = { report: result.file, checks: result.data.checks, metrics: result.data.metrics };
  if (result.data.zip) assert.equal(await digest(result.data.zip), result.data.sha256);
}
checks.push('最终安装版通过长章节编辑与重开、四种外观和极端自定义配色、角色预设、章节 WebGL、菜单设置、一键配置及真实独立游戏导出。');

const portable = await latest('portable-verification', data => data.version === version && data.zipSha256 === hashes.portable && data.portable?.asar === hashes.asar);
assert.ok(portable.data.game.assertions >= 10); assert.equal(await digest(portable.data.game.zip), portable.data.game.sha256);
assert.equal(await digest(portable.data.portable.executable), hashes.executable);
evidence.portable = { report: portable.file, checks: portable.data.checks, ...portable.data.portable, game: portable.data.game };
checks.push('便携版在源码目录外解压，使用系统 PATH 启动，移动后保留配置和工程；由它导出的独立 EXE 通过存读档、三个结局与返回标题。');

for (const name of [`presentation-fidelity-${version}`, `ui-fidelity-${version}`]) {
  const result = await latest(name, () => true);
  evidence[name] = { report: result.file, ...result.data };
}
checks.push('真实游戏验证章节水波的方向与时间变化、题字和粒子、100 张表情与 400 组站位，以及 Esc 设置、存读档、选项和返回。');

const nativeDesktopFile = path.join(evidenceRoot, 'native-desktop.json');
evidence.nativeDesktop = { file: nativeDesktopFile, ...await read(nativeDesktopFile) };

const require = createRequire(import.meta.url), builder = createRequire(require.resolve('electron-builder')), appBuilder = createRequire(builder.resolve('app-builder-lib'));
const asar = appBuilder('@electron/asar') as { extractFile(file: string, member: string): Buffer; listPackage(file: string): string[] };
assert.equal(JSON.parse(asar.extractFile(archive, 'package.json').toString()).version, version);
for (const directory of ['dist', 'dist-desktop']) for (const file of await walk(path.join(root, directory))) {
  const relative = path.join(directory, file);
  assert.ok(asar.extractFile(archive, relative).equals(await fs.readFile(path.join(root, relative))), `Stale bundled code: ${relative}`);
}
assert.equal(asar.listPackage(archive).some(file => /[/\\]node_modules[/\\]/.test(file)), false);
checks.push('全部前端与后台构建文件和最终 app.asar 字节一致，包内版本正确。');

let contentFiles = 0;
for (const folder of ['docs', 'resources']) for (const file of await walk(path.join(root, folder))) {
  const normalized = file.replaceAll('\\', '/');
  if (folder === 'resources' && normalized.startsWith('runtime/') && (/(?:^|\/)(?:tmp|__pycache__|cache|saves)(?:\/|$)/.test(normalized) || /(?:^|\/)(?:log|traceback|errors)\.txt$/.test(normalized))) continue;
  const expected = await digest(path.join(root, folder, file));
  for (const destination of [packaged, installation.destination, portable.data.portable.directory]) {
    assert.equal(await digest(path.join(destination, 'resources', folder, file)), expected, `Changed release content: ${destination}/${folder}/${file}`);
  }
  contentFiles++;
}
for (const destination of [packaged, installation.destination, portable.data.portable.directory]) assert.equal(await digest(path.join(destination, 'resources/README.md')), await digest(path.join(root, 'README.md')));
const sdkFixtures: Record<string, string> = {
  'resources/runtime/gui/game/testcases.rpy': 'ae5ed4a22924760bc0f34206aa5010caa13bc16868a70afdd61f7a782b32d357',
  'resources/runtime/launcher/game/testcases.rpy': '91c587a0d933ce8f50115950dbe733ebb6141946647815ff027239a7ca826e18',
  'resources/runtime/launcher/game/testcases.rpyc': '9b6f07138aac28e7c3e58155d9031d275d8ed17baece04d3d4a53822c08ca748',
};
for (const file of await walk(path.join(packaged, 'resources'))) {
  const normalized = file.replaceAll('\\', '/');
  assert.ok(!/(?:^|\/)runtime\/tmp\//.test(normalized), `Runtime build leaked: ${file}`);
  if (!/(?:^|\/)(?:token\.txt|ai-settings\.json|testcases\.rpyc?|\.env|saves)(?:$|\/)|\.autosave$/i.test(normalized)) continue;
  assert.ok(sdkFixtures[normalized], `Private data or QA script in release: ${file}`);
  assert.equal(await digest(path.join(packaged, 'resources', file)), sdkFixtures[normalized]);
}
checks.push(`${contentFiles} 份文档、素材与运行时文件在源码、安装版和便携版中一致，测试构建、用户配置及存档未混入发行包。`);

const baseline = path.join(evidenceRoot, 'user-file-baseline.json');
for (const original of await read(baseline)) {
  assert.equal(await fs.access(original.path).then(() => true, () => false), original.exists, `Protected file presence changed: ${original.path}`);
  if (original.exists) assert.equal(await digest(original.path), original.sha256, `Protected file changed: ${original.path}`);
}
evidence.protectedFiles = baseline;
checks.push('用户主工程、自动保存、工作区和 AI 设置与本轮基线一致；1.2.0、1.2.1、1.2.2 安装器均保留原始哈希。');
const unitFile = path.join(evidenceRoot, 'unit-tests.log'), unit = await fs.readFile(unitFile, 'utf8');
const total = Number(unit.match(/tests (\d+)/)?.[1]), passed = Number(unit.match(/pass (\d+)/)?.[1]);
assert.ok(total > 0); assert.equal(passed, total); assert.match(unit, /fail 0/); assert.match(unit, /cancelled 0/); assert.match(unit, /skipped 0/);
evidence.unitTests = { file: unitFile, total, passed };
checks.push(`${total} 项核心测试通过，失败、取消和跳过均为零。`);

const files = [];
for (const file of [installer, installer + '.blockmap', portableZip, path.join(packaged, 'Visual Novel Studio.exe'), archive]) files.push({ file: path.relative(release, file).replaceAll('\\', '/'), bytes: (await fs.stat(file)).size, sha256: await digest(file) });
const report = { status: 'passed', version, generatedAt: new Date().toISOString(), checks, evidence, contentFiles, files,
  limits: ['Android SDK 许可未确认，本轮未安装 SDK/NDK，也未完成 APK 或 Android 设备实测；缺少 Spine Android 原生库时检查页会阻止导出。', '外部 Windows 桌面截图工具在重新绑定窗口后仍超时，补充的系统键鼠与桌面截图验收未完成；游戏引擎内的按键、截图和游玩验收通过。', 'Unity 粒子随机细节使用确定性采样，不保证原作逐帧完全一致。', 'AI 一句话框架、场景与配音匹配沿用已有真实服务验收，本轮未重复付费生成。', 'Windows 安装器没有代码签名。'] };
const file = path.join(release, `verification-${version}.json`);
await fs.writeFile(file, JSON.stringify(report, null, 2) + '\n');
await fs.writeFile(path.join(release, `SHA256SUMS-${version}.txt`), files.map(item => `${item.sha256}  ${item.file}`).join('\n') + '\n');
console.log(JSON.stringify({ status: report.status, version, report: file, contentFiles, tests: total, files }, null, 2));
