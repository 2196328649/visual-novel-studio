import { createReadStream, promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve('.'), release = path.join(root, 'release');
const { version } = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const verificationRoot = path.resolve(process.env.VNS_RELEASE_EVIDENCE ?? path.join(root, 'artifacts', `editor-release-${version}`));
const packaged = path.join(release, 'win-unpacked');
const installer = path.join(release, `Visual Novel Studio Setup ${version}.exe`);
const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve('electron-builder'));
const appRequire = createRequire(builderRequire.resolve('app-builder-lib'));
const asar = appRequire('@electron/asar') as { listPackage(file: string): string[]; extractFile(file: string, member: string): Buffer };
const digest = async (file: string) => {
  const hash = createHash('sha256');
  for await (const data of createReadStream(file)) hash.update(data);
  return hash.digest('hex');
};
const readJson = async (file: string) => JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const hashes = { executable: await digest(path.join(packaged, 'Visual Novel Studio.exe')), asar: await digest(path.join(packaged, 'resources/app.asar')) };
const checks: string[] = [];
const evidence: Record<string, unknown> = {};

const installed = await readJson(path.join(root, 'artifacts/installed-verification/upgrade-report.json'));
assert.equal(installed.passed, true);
assert.equal(installed.installed.version, version);
assert.equal(installed.binaries['Visual Novel Studio.exe'], hashes.executable);
assert.equal(installed.binaries['resources/app.asar'], hashes.asar);
assert.equal(installed.games.length, 2);
evidence.installed = path.join(installed.output, 'report.json');
checks.push('当前安装包对应的安装版通过旧工程、Word 导入、保存重开、真实试玩和两份独立游戏的存读档验收。');

const installedChecks = ['release-authoring', 'resource-timeline-authoring', 'text-exchange', 'ui-responsiveness', 'fidelity-editor-1.2.1', 'live-preview-verification'];
for (const name of installedChecks) {
  const directory = path.join(root, 'artifacts', name);
  let found: { report: string; data: any } | undefined;
  for (const candidate of (await fs.readdir(directory)).sort().reverse()) {
    const report = path.join(directory, candidate, 'report.json');
    const data = await readJson(report).catch(() => undefined);
    if (data?.status !== 'passed' || data.baseline) continue;
    const tested = await readJson(path.join(directory, candidate, 'tested-app.json')).catch(() => undefined);
    if (!tested?.packaged || tested.version !== version || tested.binaries.executable !== hashes.executable || tested.binaries.asar !== hashes.asar) continue;
    found = { report, data }; break;
  }
  assert.ok(found, `No successful ${name} report for the final packaged binaries.`);
  evidence[name] = { report: found.report, checks: found.data.checks, metrics: found.data.metrics };
  if (name === 'release-authoring') assert.equal(found.data.metrics.provider?.connection, 'passed', 'Final installed AI connection was not tested.');
}
checks.push('最终程序及 app.asar 的哈希与模板/布局、资源/时间轴、文本交换、输入响应、角色预设/界面、内嵌试玩和真实 AI 连接测试逐项一致。');

const featureReports = await readJson(path.join(verificationRoot, 'feature-evidence.json')) as Record<string, string>;
for (const [name, file] of Object.entries(featureReports)) {
  const data = await readJson(file);
  assert.equal(data.status, 'passed', `Feature verification did not pass: ${file}`);
  evidence[name] = { report: file, checks: data.checks, generated: data.generated, geometry: data.geometry, portraitExpressions: data.portraitExpressions, sharedPresetPlacements: data.sharedPresetPlacements };
  if (data.package && data.sha256) assert.equal(await digest(data.package), data.sha256, `Changed game distribution: ${data.package}`);
}
checks.push('原生界面、100 张表情和 400 组关联站位、开场/结局、模板三个结局及真实 AI 双分支游戏均有本轮通过记录；AI 配音验证使用明确索引的合成测试音。');

const upgradeRoot = path.resolve(process.env.VNS_INSTALL_VERIFY_ROOT ?? 'E:/VNS12QA');
const installations = [];
for (const candidate of (await fs.readdir(path.join(upgradeRoot, 'reports'))).sort()) {
  const file = path.join(upgradeRoot, 'reports', candidate, 'installation.json');
  const data = await readJson(file).catch(() => undefined);
  if (data?.exitCode === 0 && data.projectSha256 === data.afterProjectSha256) installations.push({ file, ...data });
}
const installerHash = await digest(installer);
assert.ok(installations.some(item => item.installerSha256 === installerHash && item.afterAsarSha256 === hashes.asar), 'The final NSIS installer has not passed installation and project preservation.');
evidence.installations = installations;
checks.push('实际运行最终 NSIS 安装器返回成功，安装的代码与打包代码相同，升级测试工程内容未被安装过程修改。');

const archive = path.join(packaged, 'resources/app.asar');
const members = asar.listPackage(archive).map(member => member.replaceAll('\\', '/').replace(/^\//, ''));
assert.equal(members.some(member => member.startsWith('node_modules/')), false);
assert.equal(members.filter(member => /^dist\/assets\/elk\.bundled-.*\.js$/.test(member)).length, 1);
const walk = async (directory: string, prefix = ''): Promise<string[]> => {
  const result: string[] = [];
  for (const entry of await fs.readdir(path.join(directory, prefix), { withFileTypes: true })) {
    assert.equal(entry.isSymbolicLink(), false, `Unexpected symbolic link: ${path.join(directory, prefix, entry.name)}`);
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...await walk(directory, relative));
    else if (entry.isFile()) result.push(relative);
  }
  return result.sort();
};
const bundledCode = [...await walk(path.join(root, 'dist')).then(files => files.map(file => path.join('dist', file))), ...await walk(path.join(root, 'dist-desktop')).then(files => files.map(file => path.join('dist-desktop', file)))];
for (const file of bundledCode) assert.ok(asar.extractFile(archive, file).equals(await fs.readFile(path.join(root, file))), `Stale bundled code: ${file}`);
checks.push('全部前端/后台构建文件与 app.asar 一致，独立排版模块存在，未重复打入 node_modules。');

let contentFiles = 0;
for (const folder of ['docs', 'resources']) {
  for (const file of await walk(path.join(root, folder))) {
    const normalized = file.replaceAll('\\', '/');
    if (folder === 'resources' && normalized.startsWith('runtime/') && (/(?:^|\/)(?:__pycache__|cache|saves)\//.test(normalized) || /(?:^|\/)(?:log|traceback|errors)\.txt$/.test(normalized))) continue;
    const source = path.join(root, folder, file), included = path.join(packaged, 'resources', folder, file);
    assert.equal(await digest(included), await digest(source), `Stale or missing release content: ${folder}/${file}`);
    contentFiles++;
  }
}
assert.equal(await digest(path.join(packaged, 'resources/README.md')), await digest(path.join(root, 'README.md')));
const releaseContent = await walk(path.join(packaged, 'resources'));
// These three fixtures ship with the original Ren'Py 8.5.3 SDK. Their bytes
// were checked against the unmodified SDK, not against our acceptance projects.
const sdkFixtures: Record<string, string> = {
  'resources/runtime/gui/game/testcases.rpy': 'ae5ed4a22924760bc0f34206aa5010caa13bc16868a70afdd61f7a782b32d357',
  'resources/runtime/launcher/game/testcases.rpy': '91c587a0d933ce8f50115950dbe733ebb6141946647815ff027239a7ca826e18',
  'resources/runtime/launcher/game/testcases.rpyc': '9b6f07138aac28e7c3e58155d9031d275d8ed17baece04d3d4a53822c08ca748',
};
for (const file of releaseContent.filter(file => /(?:^|[/\\])(?:token\.txt|ai-settings\.json|testcases\.rpyc?|\.env|saves)(?:$|[/\\])|\.autosave$/i.test(file))) {
  const known = sdkFixtures[file.replaceAll('\\', '/')];
  assert.ok(known, `Private settings or test artifacts leaked into the release: ${file}`);
  assert.equal(await digest(path.join(packaged, 'resources', file)), known, `Bundled SDK fixture differs from the original SDK: ${file}`);
}
evidence.originalSdkFixtures = sdkFixtures;
checks.push(`资源、文档和运行时共 ${contentFiles} 个文件与源码一致；未包含密钥配置、本轮测试驱动或玩家存档，三个 SDK 自带测试文件已按原始哈希核对。`);

const protectedFiles = await readJson(path.join(verificationRoot, 'user-file-baseline.json'));
for (const original of protectedFiles) {
  const stat = await fs.stat(original.path).catch(() => undefined);
  assert.equal(!!stat, original.exists, `Protected file presence changed: ${original.path}`);
  if (original.exists) assert.equal(await digest(original.path), original.sha256, `Protected file changed: ${original.path}`);
}
checks.push('用户原工程、自动保存、工作区与 AI 设置的存在状态和文件哈希均保持不变。');

const unitLog = path.join(verificationRoot, 'unit-tests.log');
const tests = await fs.readFile(unitLog, 'utf8');
const totalTests = Number(tests.match(/tests (\d+)/)?.[1]);
const passedTests = Number(tests.match(/pass (\d+)/)?.[1]);
assert.ok(totalTests > 0); assert.equal(passedTests, totalTests); assert.match(tests, /fail 0/); assert.match(tests, /skipped 0/);
evidence.unitTests = unitLog;
const metadata = await readJson(path.join(verificationRoot, 'windows-metadata.json'));
assert.equal(metadata.version, version);
assert.equal(metadata.installer, installer);
evidence.windows = metadata;
checks.push(`${totalTests} 项单元测试通过；Windows 程序文件版本为 ${version}，签名状态如实记录。`);

const files = [];
for (const file of [installer, installer + '.blockmap', path.join(packaged, 'Visual Novel Studio.exe'), archive]) files.push({ file: path.relative(release, file).replaceAll('\\', '/'), bytes: (await fs.stat(file)).size, sha256: await digest(file) });
const initial = await readJson(path.join(root, 'artifacts/editor-release-1.2/initial-package.json'));
const initialMain = initial.find((file: { path: string }) => file.path.endsWith('index-Bf4Z8Orn.js'));
const currentMain = (await fs.readdir(path.join(root, 'dist/assets'))).find(file => /^index-.*\.js$/.test(file))!;
const currentMainBytes = (await fs.stat(path.join(root, 'dist/assets', currentMain))).size;
const report = { status: 'passed', version, generatedAt: new Date().toISOString(), checks, evidence, files, contentFiles,
  optimization: { initialMainBytes: initialMain.bytes, currentMainBytes, reductionPercent: Math.round((1 - currentMainBytes / initialMain.bytes) * 100), initialAsarBytes: initial.find((file: { path: string }) => file.path.endsWith('app.asar')).bytes, currentAsarBytes: (await fs.stat(archive)).size },
  limits: ['在当前 Windows 10 x64 机器验证，未执行干净虚拟机或其他实体设备验收；实际显示缩放为 125%，其他 DPI 为几何模拟。', '没有代码签名。', '本轮 Android 只验证图标编辑和生成，未发行新 APK。', 'AI 配音是目录和文本索引匹配，不包含语音合成或音频识别。', '原作界面依据恢复的素材与布局制作，不宣称逐像素复刻。'],
};
await fs.writeFile(path.join(release, `verification-${version}.json`), JSON.stringify(report, null, 2) + '\n');
await fs.writeFile(path.join(release, `SHA256SUMS-${version}.txt`), files.map(file => `${file.sha256}  ${file.file}`).join('\n') + '\n');
console.log(JSON.stringify({ status: 'passed', version, contentFiles, optimization: report.optimization, files, report: path.join(release, `verification-${version}.json`) }, null, 2));
