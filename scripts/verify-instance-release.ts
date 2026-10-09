import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

// This release adds actor instances and restores the source game's chapter
// effect. Earlier AI/Android acceptance remains historical, not a new run.
const root = path.resolve('.'), release = path.join(root, 'release');
const readJson = async (file: string) => JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const digest = async (file: string) => {
  const hash = createHash('sha256');
  for await (const data of createReadStream(file)) hash.update(data);
  return hash.digest('hex');
};
const walk = async (directory: string, prefix = ''): Promise<string[]> => {
  const files: string[] = [];
  for (const entry of await fs.readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    assert.equal(entry.isSymbolicLink(), false, `Unexpected symbolic link: ${relative}`);
    if (entry.isDirectory()) files.push(...await walk(directory, relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files.sort();
};
const { version } = await readJson(path.join(root, 'package.json'));
assert.equal(version, '1.2.2');
const packaged = path.join(release, 'win-unpacked');
const installer = path.join(release, `Visual Novel Studio Setup ${version}.exe`);
const archive = path.join(packaged, 'resources/app.asar');
const hashes = {
  installer: await digest(installer),
  executable: await digest(path.join(packaged, 'Visual Novel Studio.exe')),
  asar: await digest(archive),
};
const checks: string[] = [], observations: string[] = [], evidence: Record<string, unknown> = {};

const installationFile = path.join(root, 'artifacts/installation-1.2.2.json');
const installation = await readJson(installationFile);
assert.equal(installation.passed, true);
assert.equal(installation.exitCode, 0);
assert.equal(installation.beforeVersion, '1.2.1');
assert.equal(installation.afterVersion, version);
assert.equal(installation.installerSha256, hashes.installer);
assert.equal(installation.afterAsarSha256, hashes.asar);
assert.equal(installation.beforeProjectSha256, installation.afterProjectSha256);
assert.equal(await digest(path.join(installation.destination, 'Visual Novel Studio.exe')), hashes.executable);
assert.equal(await digest(path.join(installation.destination, 'resources/app.asar')), hashes.asar);
evidence.installation = installationFile;
checks.push('实际运行最终 NSIS 安装器，从 1.2.1 升级到 1.2.2；安装程序和 app.asar 与打包产物相同，旧测试工程字节不变。');

const editorDirectory = path.join(root, 'artifacts/actor-instances-editor');
let editor: { file: string; data: any; tested: any } | undefined;
for (const candidate of (await fs.readdir(editorDirectory)).sort().reverse()) {
  const file = path.join(editorDirectory, candidate, 'report.json');
  const data = await readJson(file).catch(() => undefined);
  const tested = await readJson(path.join(editorDirectory, candidate, 'tested-app.json')).catch(() => undefined);
  if (data?.status === 'passed' && data.exported && tested?.packaged && tested.version === version
    && tested.binaries.executable === hashes.executable && tested.binaries.asar === hashes.asar) {
    editor = { file, data, tested }; break;
  }
}
assert.ok(editor, 'No installed editor and independent export acceptance for the final binaries.');
assert.equal(await digest(editor.data.exported.zip), editor.data.exported.sha256);
assert.equal(editor.data.exported.assertions, 9);
assert.match(await fs.readFile(editor.data.exported.log, 'utf8'), /Assertions\s*:\s*9\s*\|\s*9 passed/);
evidence.installedEditor = { report: editor.file, tested: editor.tested, checks: editor.data.checks, exported: editor.data.exported };
checks.push('实际安装版通过新增副本、范围切换、独立移动/换表情/隐藏、保存重启和七秒章节播放；真实导出 ZIP 后，其独立 EXE 在仅系统 PATH 下通过 9 项角色及存读档断言。');

const runtimeFile = path.join(root, 'artifacts/actor-instances-runtime/2026-09-26T19-11-50.253Z/report.json');
const runtime = await readJson(runtimeFile);
assert.equal(runtime.status, 'passed');
const runtimeLog = await fs.readFile(path.join(path.dirname(runtimeFile), 'test.log'), 'utf8');
assert.match(runtimeLog, /Assertions\s*:\s*19\s*\|\s*19 passed/);
assert.match(runtimeLog, /Status:\s*PASSED/);
evidence.nativeRuntime = { report: runtimeFile, checks: runtime.checks, source: runtime.source, screenshots: runtime.screenshots, assertions: 19 };
checks.push('真实 Ren’Py 通过 19 项断言，覆盖三实例、本句清除、跨背景持续、独立动画与表情、隐藏、FileSave/FileLoad、回退、纯演出行、蓝图及章节采样，并保存实际 GPU 动画截图。');

const unitFile = path.join(root, 'artifacts/actor-instances-unit.log');
const unitLog = await fs.readFile(unitFile, 'utf8');
assert.match(unitLog, /tests 277/);
assert.match(unitLog, /pass 277/);
for (const name of ['fail', 'cancelled', 'skipped']) assert.match(unitLog, new RegExp(`${name} 0`));
evidence.unitTests = { log: unitFile, total: 277, passed: 277, skipped: 0 };
evidence.build = path.join(root, 'artifacts/package-1.2.2.log');
checks.push('277 项核心测试通过，失败、取消、跳过均为零；最终打包包含 TypeScript 类型检查及前后台构建。');

const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve('electron-builder'));
const appRequire = createRequire(builderRequire.resolve('app-builder-lib'));
const asar = appRequire('@electron/asar') as { listPackage(file: string): string[]; extractFile(file: string, member: string): Buffer };
assert.equal(JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8')).version, version);
const members = asar.listPackage(archive).map(member => member.replaceAll('\\', '/').replace(/^\//, ''));
assert.equal(members.some(member => member.startsWith('node_modules/')), false);
const bundledCode = [];
for (const directory of ['dist', 'dist-desktop']) {
  for (const file of await walk(path.join(root, directory))) {
    const relative = path.join(directory, file);
    assert.ok(asar.extractFile(archive, relative).equals(await fs.readFile(path.join(root, relative))), `Stale bundled code: ${relative}`);
    bundledCode.push(relative);
  }
}
evidence.bundledCodeFiles = bundledCode.length;
checks.push('所有前端和后台构建文件与最终 app.asar 字节一致，包内版本为 1.2.2。');

let contentFiles = 0;
for (const folder of ['docs', 'resources']) {
  for (const file of await walk(path.join(root, folder))) {
    const normalized = file.replaceAll('\\', '/');
    if (folder === 'resources' && normalized.startsWith('runtime/') && (/(?:^|\/)(?:__pycache__|cache|saves)\//.test(normalized) || /(?:^|\/)(?:log|traceback|errors)\.txt$/.test(normalized))) continue;
    const expected = await digest(path.join(root, folder, file));
    assert.equal(await digest(path.join(packaged, 'resources', folder, file)), expected, `Stale release content: ${folder}/${file}`);
    assert.equal(await digest(path.join(installation.destination, 'resources', folder, file)), expected, `Stale installed content: ${folder}/${file}`);
    contentFiles++;
  }
}
for (const destination of [packaged, installation.destination]) {
  assert.equal(await digest(path.join(destination, 'resources/README.md')), await digest(path.join(root, 'README.md')));
}
const sdkFixtures: Record<string, string> = {
  'resources/runtime/gui/game/testcases.rpy': 'ae5ed4a22924760bc0f34206aa5010caa13bc16868a70afdd61f7a782b32d357',
  'resources/runtime/launcher/game/testcases.rpy': '91c587a0d933ce8f50115950dbe733ebb6141946647815ff027239a7ca826e18',
  'resources/runtime/launcher/game/testcases.rpyc': '9b6f07138aac28e7c3e58155d9031d275d8ed17baece04d3d4a53822c08ca748',
};
for (const file of await walk(path.join(packaged, 'resources'))) {
  if (!/(?:^|[/\\])(?:token\.txt|ai-settings\.json|testcases\.rpyc?|\.env|saves)(?:$|[/\\])|\.autosave$/i.test(file)) continue;
  const known = sdkFixtures[file.replaceAll('\\', '/')];
  assert.ok(known, `Private settings or test artifact in release: ${file}`);
  assert.equal(await digest(path.join(packaged, 'resources', file)), known);
}
evidence.originalSdkFixtures = sdkFixtures;
checks.push(`资源、文档和运行时共 ${contentFiles} 个文件在源码、打包目录及安装目录中均相同；未混入本轮测试脚本、玩家存档或私密配置。`);

const baselineFile = path.join(root, 'artifacts/editor-release-1.2.1/user-file-baseline.json');
const installedAcceptanceStarted = (await fs.stat(path.dirname(editor.file))).birthtime;
const protectedFiles = [];
for (const original of await readJson(baselineFile)) {
  const stat = await fs.stat(original.path).catch(() => undefined);
  assert.equal(!!stat, original.exists, `Protected file presence changed: ${original.path}`);
  if (!stat) continue;
  const sha256 = await digest(original.path), matchesPreviousRelease = sha256 === original.sha256;
  protectedFiles.push({ path: original.path, previousReleaseSha256: original.sha256, sha256, matchesPreviousRelease, lastWriteTime: stat.mtime.toISOString() });
  if (matchesPreviousRelease) continue;
  // The previous release baseline predates this acceptance. Never restore or
  // overwrite an autosave merely to make an old integrity comparison pass.
  assert.equal(path.basename(original.path), 'project.vns.json.autosave', `Protected file changed: ${original.path}`);
  assert.ok(stat.mtime < installedAcceptanceStarted, 'Autosave changed during installed acceptance.');
  observations.push(`自动保存文件与 1.2.1 基线不同，修改时间为 ${stat.mtime.toISOString()}，早于此次安装版验收；保留当前文件，未恢复或覆盖。不能据旧基线断言自动保存自上次发行以来未变化。`);
}
assert.equal(await digest(path.join(release, 'Visual Novel Studio Setup 1.2.1.exe')), '03a0586852c4ceb9868703b336682d635ad55a3989bd4c483e820b31e174b603');
evidence.protectedFiles = { previousReleaseBaseline: baselineFile, installedAcceptanceStarted: installedAcceptanceStarted.toISOString(), files: protectedFiles };
checks.push('用户原工程、工作区、AI 设置及旧版 1.2.0/1.2.1 安装器的文件哈希与 1.2.1 基线一致；自动保存的单独差异记录在 observations。');

const metadataEnv: NodeJS.ProcessEnv = { ...process.env, VNS_RELEASE_INSTALLER: installer };
// Windows PowerShell must load its own modules rather than inherit PS 7's path.
for (const key of Object.keys(metadataEnv)) if (key.toLowerCase() === 'psmodulepath') delete metadataEnv[key];
const metadata = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()\n$vnsInstaller = Get-Item -LiteralPath $env:VNS_RELEASE_INSTALLER\n[pscustomobject]@{version=$vnsInstaller.VersionInfo.ProductVersion;signature=(Get-AuthenticodeSignature -LiteralPath $env:VNS_RELEASE_INSTALLER).Status.ToString()} | ConvertTo-Json -Compress'],
  { encoding: 'utf8', windowsHide: true, env: metadataEnv });
assert.equal(metadata.status, 0, metadata.stderr);
evidence.windows = JSON.parse(metadata.stdout.trim());
assert.equal((evidence.windows as { version: string }).version, version);
const files = [];
for (const file of [installer, installer + '.blockmap', path.join(packaged, 'Visual Novel Studio.exe'), archive]) {
  files.push({ file: path.relative(release, file).replaceAll('\\', '/'), bytes: (await fs.stat(file)).size, sha256: await digest(file) });
}
const report = {
  status: observations.length ? 'passed_with_observations' : 'passed', version, generatedAt: new Date().toISOString(), checks, observations, evidence, files, contentFiles,
  limits: [
    '本轮测试在当前 Windows 10 x64 机器完成，未重新执行 Android、其他设备或付费 AI 生成测试；AI 框架和配音匹配沿用 1.2.1 的既有验收。',
    '粒子的原始参数、力场曲线、标题消散数学与时序已提取；Unity 内部随机噪声采用确定性近似，不保证逐帧随机位置一致。背景 Ripple 参数已提取但本轮仍使用现有静态背景。',
    '内置模板章节时长为 7 秒，已有用户工程保留自己的时长。',
    'Windows 安装器没有代码签名。',
  ],
};
const reportFile = path.join(release, `verification-${version}.json`);
await fs.writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
await fs.writeFile(path.join(release, `SHA256SUMS-${version}.txt`), files.map(file => `${file.sha256}  ${file.file}`).join('\n') + '\n');
console.log(JSON.stringify({ status: report.status, version, contentFiles, report: reportFile, observations, files }, null, 2));
