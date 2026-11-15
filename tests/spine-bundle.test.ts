import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spineRuntimeAbi, spineRuntimeProblem, requiresSpineRuntime, spineAndroidAbis } from '../src/runtime/spine-bundle';
import { createProject } from '../src/core/model';
import { prepareAndroidExport } from '../src/runtime/game-export';
import { writeSpineBundleFixture } from '../scripts/lib/spine-bundle-fixture';

async function fixture(t: TestContext) {
  const temporary = await fs.realpath(os.tmpdir()), root = await fs.mkdtemp(path.join(temporary, 'vns-spine-bundle-'));
  t.after(async () => { const resolved = await fs.realpath(root), relative = path.relative(temporary, resolved); assert.ok(relative.startsWith('vns-spine-bundle-') && !relative.includes(path.sep)); await fs.rm(resolved, { recursive: true, force: true }); });
  await writeSpineBundleFixture(root); return root;
}

test('native package preflight checks ABI and all recorded binaries without modifying them', async t => {
  const root = await fixture(t), before = await fs.readFile(path.join(root, 'android/build.json'));
  assert.equal(await spineRuntimeProblem(root, 'windows'), undefined); assert.equal(await spineRuntimeProblem(root, 'android'), undefined);
  for (const abi of spineAndroidAbis) {
    const file = path.join(root, 'android', abi, 'libvns_spine.so'), original = await fs.readFile(file);
    await fs.writeFile(file, 'mixed old library'); assert.match((await spineRuntimeProblem(root, 'android'))!, new RegExp(abi));
    await fs.writeFile(file, original);
  }
  assert.deepEqual(await fs.readFile(path.join(root, 'android/build.json')), before);
  await fs.writeFile(path.join(root, 'vns_spine.dll'), 'mixed old host library');
  assert.match((await spineRuntimeProblem(root, 'windows'))!, /构建记录不一致/);
});

test('old or unknown ABI, invalid metadata and mismatched Python are explicit failures', async t => {
  const root = await fixture(t), file = path.join(root, 'build.json'), original = await fs.readFile(file, 'utf8');
  for (const abi of [1, 0, spineRuntimeAbi + 1, '2', null]) {
    await fs.writeFile(file, JSON.stringify({ ...JSON.parse(original), abi })); assert.match((await spineRuntimeProblem(root, 'windows'))!, /ABI 2/);
  }
  for (const invalid of ['null', '[]', '{', '{}']) { await fs.writeFile(file, invalid); assert.ok(await spineRuntimeProblem(root, 'windows')); }
  await fs.writeFile(file, original); await fs.writeFile(path.join(root, 'vns_spine.py'), 'SPINE_ABI = 1\n');
  assert.match((await spineRuntimeProblem(root, 'windows'))!, /Python 适配器/);
});

test('an empty Spine control still requires native support, including an inherited scheme', () => {
  const project = createProject(); assert.equal(requiresSpineRuntime(project), false);
  project.ui.instances = [{ id: 'parent', name: '原方案', components: [{ id: 'empty_spine', page: 'main', kind: 'spine', text: '', x: 0, y: 0, width: 1, height: 1 }] }, { id: 'derived', name: '派生', baseUiId: 'parent', components: [] }];
  project.ui.activeInstanceId = 'derived'; assert.equal(requiresSpineRuntime(project), true); assert.equal(project.assets.length, 0);
});

test('Android ABI failure is reported before writing signatures, game files or SDK libraries', async t => {
  const root = await fixture(t), project = createProject();
  project.ui.components.push({ id: 'empty_spine', page: 'main', kind: 'spine', text: '', x: 0, y: 0, width: 1, height: 1 });
  await fs.writeFile(path.join(root, 'android/build.json'), JSON.stringify({ abi: 1 }));
  const projectDir = path.join(root, 'project'), buildDir = path.join(root, 'game'), sdkRoot = path.join(root, 'sdk');
  await assert.rejects(prepareAndroidExport(project, { projectDir, buildDir, sdkRoot, spineRuntimeDir: root }, async () => assert.fail('No key generation before native validation.')), /ABI 2/);
  for (const directory of [projectDir, buildDir, sdkRoot]) await assert.rejects(fs.stat(directory), { code: 'ENOENT' });
});