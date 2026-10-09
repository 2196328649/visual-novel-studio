import assert from 'node:assert/strict';
import { createReadStream, promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = path.resolve('.'), version = JSON.parse(await fs.readFile('package.json', 'utf8')).version;
const [installationFile, editorFile, portableFile, flowFile, genericFile] = process.argv.slice(2);
assert.ok(installationFile && editorFile && portableFile && flowFile && genericFile, 'Pass the five exact acceptance report paths: installation, editor, portable, aihong flow, generic flow.');
const json = async (file: string) => JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const digest = async (file: string) => { const h = createHash('sha256'); for await (const b of createReadStream(file)) h.update(b); return h.digest('hex'); };
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');
async function walk(directory: string, prefix = ''): Promise<string[]> {
  const files: string[] = [];
  for (const item of await fs.readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const file = path.join(prefix, item.name);
    if (item.isDirectory()) files.push(...await walk(directory, file)); else if (item.isFile()) files.push(file);
  }
  return files;
}
const installation = await json(installationFile), editor = await json(editorFile), portable = await json(portableFile), flow = await json(flowFile), generic = await json(genericFile);
assert.equal(installation.passed, true); assert.equal(installation.version, version);
assert.equal(editor.status, 'passed'); assert.equal(portable.status, 'passed'); assert.equal(portable.version, version);
assert.equal(flow.status, 'passed'); assert.equal(flow.variant, 'aihong'); assert.equal(generic.status, 'passed'); assert.equal(generic.variant, 'generic');
const testedApp = await json(path.join(path.dirname(editorFile), 'tested-app.json'));
assert.equal(testedApp.version, version); assert.equal(testedApp.packaged, true);
assert.equal(testedApp.executable, editor.installedExecutable);
const packed = path.join(root, 'release/win-unpacked'), archive = path.join(packed, 'resources/app.asar');
const archiveHash = await digest(archive);
for (const value of [installation.asar, testedApp.binaries.asar, portable.portable.asar]) assert.equal(value, archiveHash);
assert.equal(await digest(path.join(installation.destination, 'resources/app.asar')), archiveHash);
assert.equal(await digest(installation.installer), installation.installerSha256);
assert.equal(await digest(installation.projectFile), installation.before);
const require = createRequire(import.meta.url), builderRequire = createRequire(require.resolve('electron-builder'));
const asar = createRequire(builderRequire.resolve('app-builder-lib'))('@electron/asar');
assert.equal(JSON.parse(asar.extractFile(archive, 'package.json').toString()).version, version);
let codeFiles = 0, contentFiles = 0;
const regeneratedRuntimeFiles: { path: string; sourceSha256: string; packagedSha256: string; matchingSource: string }[] = [];
for (const folder of ['dist', 'dist-desktop']) for (const file of await walk(folder)) {
  assert.equal(sha(asar.extractFile(archive, path.join(folder, file))), await digest(path.join(folder, file)), file); codeFiles++;
}
for (const folder of ['resources', 'docs']) for (const file of await walk(folder)) {
  const normalized = file.replaceAll('\\', '/');
  if (folder === 'resources' && normalized.startsWith('runtime/') && (normalized.startsWith('runtime/tmp/') || /(?:^|\/)(?:__pycache__|cache|saves)\//.test(normalized) || /(?:^|\/)(?:log|traceback|errors)\.txt$/.test(normalized))) continue;
  const sourceSha256 = await digest(path.join(folder, file)), packagedSha256 = await digest(path.join(packed, 'resources', folder, file));
  if (sourceSha256 !== packagedSha256 && folder === 'resources' && /^runtime\/renpy\/common\/.+\.rpym?c$/.test(normalized)) {
    // Native QA regenerates these SDK caches after packaging. Verify the exact
    // corresponding source; package bytes are covered by install/ZIP manifests.
    const candidates = [file.slice(0, -1), file.replace(/\.rpyc$/, '.rpym'), file.replace(/\.rpyc$/, '_ren.py')];
    const matchingSource = (await Promise.all(candidates.map(async candidate => await fs.access(path.join(folder, candidate)).then(() => candidate, () => undefined)))).find(candidate => candidate !== undefined);
    assert.ok(matchingSource, `Missing runtime source for ${file}`);
    assert.equal(await digest(path.join(folder, matchingSource)), await digest(path.join(packed, 'resources', folder, matchingSource)), matchingSource);
    regeneratedRuntimeFiles.push({ path: file, sourceSha256, packagedSha256, matchingSource });
  } else assert.equal(sourceSha256, packagedSha256, file);
  contentFiles++;
}
assert.equal(await digest('README.md'), await digest(path.join(packed, 'resources/README.md')));
const manifest = await json((await json(`release/portable-${version}.json`)).manifest);
assert.equal(await digest(portable.zip), portable.zipSha256);
for (const item of manifest.files) assert.equal(await digest(path.join(portable.portable.directory, item.path)), item.sha256, item.path);
const evidence = path.join(root, `artifacts/flow-navigation-${version}`);
const protectedFiles = await json(path.join(evidence, 'protected-before.json'));
for (const item of protectedFiles) { item.actual = await digest(item.path); item.unchanged = item.actual === item.sha256; assert.equal(item.actual, item.sha256, item.path); }
const fullTests = await fs.readFile(path.join(evidence, 'full-tests.log'), 'utf8');
assert.match(fullTests, /pass 309/); assert.match(fullTests, /fail 0/);
const nativeLog = await fs.readFile(path.join(path.dirname(flowFile), 'run.log'), 'utf8');
assert.match(nativeLog, /Assertions\s*:\s*32\s*\|\s*32 passed/);
const sourceManifest = [];
for (const folder of ['src', 'scripts', 'tests', 'docs']) for (const file of await walk(folder)) sourceManifest.push({ path: path.join(folder, file), sha256: await digest(path.join(folder, file)) });
for (const file of ['package.json', 'README.md', 'resources/templates/aihong/project.vns.json']) sourceManifest.push({ path: file, sha256: await digest(file) });
await fs.writeFile(path.join(evidence, 'source-manifest.json'), JSON.stringify(sourceManifest, null, 2));
const binaries = [];
for (const file of [installation.installer, portable.zip]) binaries.push({ path: file, bytes: (await fs.stat(file)).size, sha256: await digest(file) });
const record = (file: string, data: unknown) => ({ path: path.resolve(file), data });
const report = {
  status: 'passed_with_limits', version, verifiedAt: new Date().toISOString(),
  scope: 'Windows editor and flow navigation, aihong template, installer upgrade, portable relocation and standalone game export. Original-game visual comparison remains incomplete.',
  installer: binaries[0], portable: binaries[1], asar: archiveHash, codeFiles, contentFiles, regeneratedRuntimeFiles, portableFiles: manifest.files.length,
  unitTests: { passed: 309, failed: 0, log: path.join(evidence, 'full-tests.log') }, buildLog: path.join(evidence, 'package.log'), sourceManifest: path.join(evidence, 'source-manifest.json'),
  installation: record(installationFile, installation), editor: record(editorFile, { ...editor, testedApp }), portableRun: record(portableFile, portable),
  aihongFlow: record(flowFile, flow), genericFlow: record(genericFile, generic), protectedFiles,
  originalCapture: await json(path.join(evidence, 'original-capture.json')),
  limitations: ['原游戏直接截图仍失败，原作的流程图状态、滚动条、标题字形和章节动画尚未完成直接视觉对照。', 'Android 本版未重新构建或进行设备验收。'],
};
await fs.writeFile(`release/SHA256SUMS-${version}.txt`, binaries.map(item => item.sha256 + '  ' + path.basename(item.path)).join('\n') + '\n');
await fs.writeFile(`release/verification-${version}.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ status: report.status, version, codeFiles, contentFiles, portableFiles: manifest.files.length, protectedFiles: protectedFiles.length, report: path.resolve(`release/verification-${version}.json`) }));
