import assert from 'node:assert/strict';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';

const root = path.resolve('.'), version = JSON.parse(await fs.readFile('package.json', 'utf8')).version;
const packageReport = path.resolve(process.argv[2]);
const packages = JSON.parse(await fs.readFile(packageReport, 'utf8'));
assert.equal(packages.status, 'passed'); assert.equal(packages.version, version);
const installer = packages.checks.find(check => check.kind === 'installer');
const portable = packages.checks.find(check => check.kind === 'portable');
assert.ok(installer?.executable && portable?.sha256);
const output = path.resolve('artifacts/v08-publication', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const digest = async file => { const hash = createHash('sha256'); for await (const bytes of createReadStream(file)) hash.update(bytes); return hash.digest('hex'); };
const read = async file => JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const binaries = { executable: await digest(installer.executable), asar: await digest(path.join(path.dirname(installer.executable), 'resources/app.asar')) };
const author = 'E:/Project/Visual Novel Studio/我的视觉小说1/project.vns.json';
const authorHash = await digest(author);
const results = [];
const suites = [
  { id: 'image-and-performance', script: 'scripts/verify-media-authoring-ux.ts', directory: 'artifacts/media-authoring-ux' },
  { id: 'media-insertion', script: 'scripts/verify-media-commands-editor.ts', directory: 'artifacts/media-commands-editor' },
  { id: 'author-project-and-flowchart', script: 'work/verify-compact-show-ui.ts', directory: 'artifacts/compact-show-ui', args: [author] },
  { id: 'live-parameter-editing', script: 'scripts/profile-live-parameters.ts', directory: 'artifacts/live-parameters', args: [author] },
  { id: 'portable-isolation-and-export', script: 'scripts/verify-v08-portable.ts', directory: 'artifacts/v08-portable', portable: true },
];
const progressFile = path.join(output, 'report.json');
try {
  for (const [index, suite] of suites.entries()) {
    const before = new Set(await fs.readdir(suite.directory).catch(() => []));
    console.log(`[${index + 1}/${suites.length}] ${suite.id}`);
    const log = path.join(output, suite.id + '.log');
    await new Promise((resolve, reject) => {
      const stream = createWriteStream(log);
      const env = { ...process.env, VNS_INSTALLED_EXE: suite.portable ? '' : installer.executable };
      delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(process.execPath, ['--import', 'tsx', suite.script, ...(suite.args ?? [])], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.pipe(stream, { end: false }); child.stderr.pipe(stream, { end: false });
      child.on('error', error => { stream.end(); reject(error); });
      child.on('close', code => stream.end(() => code === 0 ? resolve() : reject(new Error(`${suite.id} failed (${code}); see ${log}`))));
    });
    const folders = (await fs.readdir(suite.directory)).filter(name => !before.has(name));
    assert.equal(folders.length, 1, 'one new evidence directory per suite');
    const report = path.resolve(suite.directory, folders[0], 'report.json');
    const result = await read(report);
    assert.equal(result.status, 'passed', suite.id); assert.deepEqual(result.errors ?? [], [], suite.id);
    let testedApp;
    if (!suite.portable) {
      testedApp = await read(path.join(path.dirname(report), 'tested-app.json'));
      assert.equal(testedApp.packaged, true); assert.equal(testedApp.version, version);
      assert.deepEqual(testedApp.binaries, binaries, 'UI acceptance must use these exact release binaries');
    } else assert.equal(result.packageSha256, portable.sha256, 'portable acceptance must use this exact ZIP');
    results.push({ id: suite.id, report, log, testedApp, result });
    await fs.writeFile(progressFile, JSON.stringify({ status: 'running', version, packageReport, results }, null, 2));
    console.log(`passed: ${suite.id}`);
  }
  assert.equal(await digest(author), authorHash, 'acceptance must not modify the author project');
  for (const check of packages.checks) assert.equal(await digest(check.archive), check.sha256, 'release archive changed during acceptance');
  const unitLog = path.resolve('work/v08-release-tests.log'), unitText = await fs.readFile(unitLog, 'utf8');
  const tests = Number(unitText.match(/^# tests (\d+)$/m)?.[1]), passed = Number(unitText.match(/^# pass (\d+)$/m)?.[1]);
  assert.ok(tests > 0 && tests === passed); assert.match(unitText, /^# fail 0$/m); assert.match(unitText, /^# skipped 0$/m);
  const nativeReport = path.resolve('artifacts/media-lifetime/2026-10-08T03-38-51.028Z/report.json');
  const native = await read(nativeReport); assert.equal(native.status, 'passed');
  const replacementReport = path.resolve('work/image-axis-replacement/2026-10-08T03-29-47.630Z/applied.json');
  const replacement = await read(replacementReport); assert.equal(replacement.status, 'applied');
  assert.equal(replacement.records[0].after, authorHash);
  const backup = await read('work/v08-release-20261008-inputs.json');
  const report = { status: 'passed', version, releasedAt: new Date().toISOString(), platform: 'Windows x64', packageReport,
    packages: packages.checks, binaries, buildLogs: [path.resolve('work/v08-release-20261008-package.log'), path.resolve('work/v08-release-docs-repackage.log')],
    unitTests: { tests, passed, failed: 0, skipped: 0, log: unitLog }, results,
    nativeImage: { report: nativeReport, result: native }, authorProjectReplacement: { report: replacementReport, result: replacement },
    authorProjectAfterAcceptance: { file: author, sha256: authorHash }, previousReleaseArchive: backup.directory,
    boundaries: ['Installer contents and extracted editor were tested; system install/uninstall was not executed.', 'Android native-library hashes were checked; no Android device, signing or SDK download test was run.', 'Numeric drags update locally; release still performs one complete script commit. Performance results are observations on this machine.'],
  };
  await fs.writeFile(progressFile, JSON.stringify(report, null, 2));
  await fs.writeFile(path.resolve('release', `verification-${version}.json`), JSON.stringify(report, null, 2));
  const live = results.find(result => result.id === 'live-parameter-editing').result.metrics;
  const acceptance = `# v0.8（${version}）发行验收\n\n发行日期：2026-10-08。平台：Windows x64。状态：通过。\n\n- ${passed} / ${tests} 单元测试通过，类型检查与正式打包通过。\n- 安装包与便携 ZIP 分别解包，逐文件与正式构建核对，无差异。\n- 本次安装器解出的程序通过图片两轴、舞台变换、数值拖动、暂停编辑、媒体插入、角色默认离场、流程图节点／连线、作者工程副本的保存重开。每份报告记录了实际程序与 app.asar 的哈希。\n- 便携版在源码目录外、仅系统 PATH 环境启动，创建中文工程；移动整个便携目录后重开，并从界面成功导出单 EXE。\n- 数字拖动每种模式 24 次采样：模块模式中位数 ${live.script.frames.medianMs.toFixed(1)}ms、P95 ${live.script.frames.p95Ms.toFixed(1)}ms；文本模式中位数 ${live.text.frames.medianMs.toFixed(1)}ms、P95 ${live.text.frames.p95Ms.toFixed(1)}ms。松开时仍统一执行一次剧本提交。\n- 原生图片验证通过 15 条断言和像素检查，包含独立 X/Y 缩放、旋转、存读档与离场。\n\n安装器未执行系统安装／卸载；Android 库核对了完整性，本轮未做真机测试。详见 verification-${version}.json。\n\n## 校验值\n\n${packages.checks.map(check => `- ${path.basename(check.archive)}：${check.sha256}`).join('\n')}\n\n此前同版本的旧包及报告已保留在 ${backup.directory}。\n`;
  await fs.writeFile(path.resolve('release/acceptance-0.8.md'), acceptance);
  await fs.copyFile('docs/release-0.8.md', 'release/release-notes-0.8.md');
  console.log('PUBLISHED ' + output);
} catch (error) {
  await fs.writeFile(progressFile, JSON.stringify({ status: 'failed', version, packageReport, results, error: String(error) }, null, 2));
  console.error(String(error)); console.log(output); process.exitCode = 1;
}
