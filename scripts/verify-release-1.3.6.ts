import assert from 'node:assert/strict';
import { createReadStream, promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';

const version = '1.3.6', root = path.resolve('.');
const json = async (file: string) => JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const digest = async (file: string) => { const h = createHash('sha256'); for await (const b of createReadStream(file)) h.update(b); return h.digest('hex'); };
const installationFile = 'artifacts/installation-content-1.3.6-1790766018511.json';
const installation = await json(installationFile);
assert.equal(installation.version, version); assert.equal(installation.passed, true);
assert.deepEqual(installation.mismatches, []);
assert.equal(await digest(installation.installer), installation.installerSha256);
assert.equal(await digest(installation.projectFile), installation.before);
const reports = {
  installedFlow: 'artifacts/flow-navigation-editor/2026-09-30T11-02-42.877Z/report.json',
  installedChapter: 'artifacts/chapter-framing/2026-09-30T11-03-09.882Z/report.json',
  nativeChapter: 'artifacts/actor-instances-runtime/2026-09-30T10-50-54.089Z/report.json',
  nativeFlow: 'artifacts/game-flow/2026-09-30T10-16-17.212Z/report.json',
  priorUnifiedBlueprint: 'artifacts/unified-blueprint/2026-09-30T08-24-44.102Z/report.json',
  priorStandaloneRuntime: 'artifacts/standalone-runtime/2026-09-30T07-56-54.448Z/report.json',
};
for (const file of Object.values(reports)) assert.equal((await json(file)).status, 'passed', file);
for (const file of [reports.installedFlow, reports.installedChapter]) {
  const app = await json(path.join(path.dirname(file), 'tested-app.json'));
  assert.equal(app.version, version); assert.equal(app.packaged, true);
  assert.equal(app.binaries.asar, installation.asar);
  assert.equal(await digest(app.executable), app.binaries.executable);
}
const archive = path.join(installation.destination, 'resources/app.asar');
assert.equal(await digest(archive), installation.asar);
const require = createRequire(import.meta.url), builder = createRequire(require.resolve('electron-builder'));
const asar = createRequire(builder.resolve('app-builder-lib'))('@electron/asar');
assert.equal(JSON.parse(asar.extractFile(archive, 'package.json')).version, version);
const walk = async (dir: string): Promise<string[]> => (await Promise.all((await fs.readdir(dir, { withFileTypes: true })).map(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))).flat();
for (const folder of ['dist', 'dist-desktop']) for (const file of await walk(folder)) {
  assert.equal(createHash('sha256').update(asar.extractFile(archive, file)).digest('hex'), await digest(file), file);
}
assert.equal(await digest('resources/templates/aihong/project.vns.json'), await digest(path.join(installation.destination, 'resources/resources/templates/aihong/project.vns.json')));
const log = await fs.readFile('artifacts/original-visual-2026-09-30/framing-tests.log', 'utf8');
assert.match(log, /tests 312/); assert.match(log, /pass 312/); assert.match(log, /fail 0/);
const portable = await json('release/portable-1.3.6.json');
assert.equal(await digest(portable.file), portable.sha256);
const manifest = await json(portable.manifest);
assert.equal(manifest.files.find((f: {path: string}) => f.path.replaceAll('\\', '/') === 'resources/app.asar').sha256, installation.asar);
const report = { version, status: 'passed', installation: installationFile, reports, unitTests: { passed: 312, failed: 0 },
  artifacts: [{ path: installation.installer, sha256: installation.installerSha256 }, { path: portable.file, sha256: portable.sha256 }],
  installedExecutable: path.join(installation.destination, 'Visual Novel Studio.exe'), asar: installation.asar,
  originalEvidence: 'artifacts/original-visual-2026-09-30/findings.md',
  scope: ['editable current-node glow', 'editable chapter background offsets', 'original live flow states and chapter animation comparison'],
  limitations: ['原作章节名为预绘制题字，改编模板保持可编辑章节名及提取字体，不声称逐字图像相同。', '粒子随机分布不保证逐像素一致。', '按用户要求不处理原游戏封面缺少两个人。', '本轮未重新执行 Android 设备验收。'],
};
await fs.writeFile('release/verification-1.3.6.json', JSON.stringify(report, null, 2));
console.log(path.join(root, 'release/verification-1.3.6.json'));
