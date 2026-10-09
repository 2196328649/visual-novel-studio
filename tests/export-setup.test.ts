import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { createProject } from '../src/core/model';
import { exportSettings } from '../src/core/export-settings';
import { downloadTool, ExportSetupController, managedPath, type ToolArchive } from '../src/desktop/export-setup';
import type { ExportSetupProgress } from '../src/core/bridge';

async function workspace(t: TestContext) {
  const prefix = path.resolve(os.tmpdir(), 'vns-setup-');
  const root = await fs.mkdtemp(prefix);
  t.after(async () => { assert.ok(path.resolve(root).startsWith(prefix)); await fs.rm(root, { recursive: true, force: true }); });
  return root;
}
const bytes = Buffer.from('verified archive fixture');
const archive: ToolArchive = { name: '测试工具', url: 'https://example.invalid/tool.zip', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
const signal = () => new AbortController().signal;

test('verified downloads reuse only intact caches and repair corrupt caches on retry', async t => {
  const directory = await workspace(t); let requests = 0;
  const fetcher: typeof fetch = async () => { requests++; return new Response(bytes); };
  const received: number[] = [];
  const options = { signal: signal(), fetch: fetcher, progress: (size: number) => received.push(size) };
  const file = await downloadTool(archive, directory, options);
  assert.deepEqual(await fs.readFile(file), bytes); assert.equal(requests, 1);
  assert.equal(received.at(-1), archive.bytes);
  assert.equal(await downloadTool(archive, directory, options), file); assert.equal(requests, 1);
  await fs.writeFile(file, 'damaged');
  await downloadTool(archive, directory, options); assert.equal(requests, 2);
  assert.deepEqual(await fs.readdir(directory), [archive.sha256 + '.zip']);
});

test('bad checksums, incomplete responses and cancelled transfers never become installable archives', async t => {
  const directory = await workspace(t);
  for (const response of [new Response(Buffer.alloc(bytes.length)), new Response(bytes.subarray(0, 2)), new Response('', { status: 503 })]) {
    await assert.rejects(downloadTool(archive, directory, { signal: signal(), fetch: async () => response }), /校验失败|下载失败/);
    assert.deepEqual(await fs.readdir(directory), []);
  }
  const controller = new AbortController();
  await assert.rejects(downloadTool(archive, directory, {
    signal: controller.signal,
    fetch: async () => new Response(new ReadableStream({ pull(stream) { stream.enqueue(bytes.subarray(0, 2)); controller.abort(); } })),
  }), /abort/i);
  assert.deepEqual(await fs.readdir(directory), []);
  await downloadTool(archive, directory, { signal: signal(), fetch: async () => new Response(bytes) });
  assert.deepEqual(await fs.readdir(directory), [archive.sha256 + '.zip']);
});

test('managed destinations reject traversal, the root itself and directory links', async t => {
  const directory = await workspace(t), outside = await workspace(t);
  await assert.rejects(managedPath(directory, '../outside'));
  await assert.rejects(managedPath(directory, '.'));
  await fs.symlink(outside, path.join(directory, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(managedPath(directory, 'linked/file.zip'), /符号链接/);
  assert.equal(await managedPath(directory, 'downloads/file.zip'), path.join(directory, 'downloads/file.zip'));
});

async function setupFixture(t: TestContext) {
  const root = await workspace(t), resources = path.join(root, 'resources'), userData = path.join(root, 'data');
  for (const file of ['renpy.py', 'renpy/bootstrap.py', 'lib/py3-windows-x86_64/python.exe', 'sdk-fonts/SourceHanSansLite.ttf', 'launcher/game/rapt_hash.txt', 'tmp/old-build', 'renpy/__pycache__/old']) {
    const destination = path.join(resources, 'runtime', file);
    await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.writeFile(destination, 'bundled ' + file);
  }
  const progress: ExportSetupProgress[] = [];
  const controller = new ExportSetupController({ resources, userData, appVersion: 'test', onProgress: state => progress.push(state), fetch: async () => { assert.fail('unexpected network request'); } });
  return { root, resources, userData, progress, controller };
}

test('Windows one-click setup is offline, repairs its private runtime and preserves the bundled source', async t => {
  const { resources, controller, progress } = await setupFixture(t), project = createProject();
  let result = await controller.run(project, undefined, false);
  assert.equal(result.ok, true); assert.equal(result.check?.ready, true); assert.equal(controller.running, false);
  const runtime = await controller.ensureRuntime();
  await assert.rejects(fs.stat(path.join(runtime, 'tmp')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(runtime, 'renpy/__pycache__')), { code: 'ENOENT' });
  await fs.writeFile(path.join(runtime, 'renpy.py'), 'damaged');
  result = await controller.run(project, undefined, false); assert.equal(result.ok, true);
  assert.equal(await fs.readFile(path.join(runtime, 'renpy.py'), 'utf8'), 'bundled renpy.py');
  assert.equal(await fs.readFile(path.join(resources, 'runtime/renpy.py'), 'utf8'), 'bundled renpy.py');
  await fs.rm(path.join(runtime, 'renpy/bootstrap.py'));
  result = await controller.run(project, undefined, false); assert.equal(result.ok, true);
  assert.equal(await fs.readFile(path.join(runtime, 'renpy/bootstrap.py'), 'utf8'), 'bundled renpy/bootstrap.py');
  assert.equal(progress.at(-1)?.phase, 'ready');
});

test('Android setup requires explicit consent before downloading SDK tools', async t => {
  const { controller } = await setupFixture(t), project = createProject();
  project.exportSettings = { ...exportSettings(project), platform: 'android' };
  const result = await controller.run(project, undefined, false);
  assert.equal(result.ok, false); assert.match(result.error!, /阅读并同意 Android SDK 许可/);
  assert.equal(controller.snapshot().phase, 'failed'); assert.equal(controller.running, false);
});

test('cancelling configuration releases the controller and a subsequent Windows retry succeeds', async t => {
  const { resources, userData } = await setupFixture(t);
  let cancelled = false;
  const controller = new ExportSetupController({ resources, userData, appVersion: 'cancel', onProgress: state => {
    if (state.phase === 'runtime' && !cancelled) { cancelled = true; controller.cancel(); }
  } });
  assert.equal((await controller.run(createProject(), undefined, false)).cancelled, true);
  assert.equal(controller.running, false); assert.equal(controller.snapshot().phase, 'cancelled');
  assert.equal((await controller.run(createProject(), undefined, false)).ok, true);
});
