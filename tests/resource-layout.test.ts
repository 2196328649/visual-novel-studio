import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createProject, type Project } from '../src/core/model';
import { ensureAssetFolder } from '../src/core/asset-library';
import { relocateProjectAssets } from '../src/core/asset-relocation';
import { assetSourcePath, autosaveProject, loadProject, saveProject } from '../src/desktop/project-store';
import { prepareResourceLayout, resourceFileName } from '../src/desktop/resource-layout';
import { readResourcePaths, resourcePathLedger } from '../src/desktop/resource-paths';
import { validateProject } from '../src/core/validate';

function copyGate(t: TestContext) {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  const abort = () => release();
  t.signal.addEventListener('abort', abort, { once: true });
  t.after(() => { release(); t.signal.removeEventListener('abort', abort); });
  if (t.signal.aborted) release();
  return { promise, release };
}

async function waitForCopyGate(t: TestContext, gate: ReturnType<typeof copyGate>, outcome: Promise<{ ok: true } | { ok: false; error: unknown }>, checkpoint: string) {
  t.signal.throwIfAborted();
  // Parsing or preflight may reject before the mock is called. Surface that
  // failure directly instead of waiting for a gate until the test times out.
  await Promise.race([
    gate.promise,
    outcome.then(result => {
      if (!result.ok) throw result.error;
      throw new Error('Save completed before copy checkpoint: ' + checkpoint);
    }),
  ]);
  t.signal.throwIfAborted();
}

async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vns-resource-layout-'));
  const pendingCleanup: (() => Promise<void>)[] = [];
  const beforeCleanup = (drain: () => Promise<void>) => { pendingCleanup.push(drain); };
  t.after(async () => {
    for (const drain of pendingCleanup) await drain();
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('vns-resource-layout-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const project = createProject('目录同步');
  project.assets = [{ id: 'image', name: '夜宴', kind: 'image', category: 'scene', path: 'assets/image.webp' }];
  const folder = ensureAssetFolder(project, 'scene', ['王家大院']);
  project.contentBrowser!.assignments['asset:image'] = folder;
  await fs.mkdir(path.join(root, 'assets'));
  await fs.writeFile(path.join(root, 'assets/image.webp'), 'image-bytes');
  return { root, project, folder, file: path.join(root, 'project.vns.json'), beforeCleanup };
}

test('saving before preview keeps script resources under the executable scripts directory', async t => {
  const { root, project, file } = await fixture(t);
  await fs.mkdir(path.join(root, 'scripts'));
  await fs.writeFile(path.join(root, 'scripts/menu.rpy'), 'init python:\n    qa_value = 1\n');
  project.assets.push({ id: 'script', kind: 'script', name: '菜单脚本', path: 'scripts/menu.rpy' });
  project.contentBrowser!.assignments['asset:script'] = ensureAssetFolder(project, 'script', ['菜单']);
  const saved = await saveProject(file, project);
  const script = saved.project.assets.find(asset => asset.id === 'script')!;
  assert.equal(script.path, 'scripts/脚本/菜单/菜单脚本.rpy');
  assert.equal(await fs.readFile(assetSourcePath(root, script), 'utf8'), 'init python:\n    qa_value = 1\n');
  assert.deepEqual(validateProject(saved.project).filter(issue => issue.severity === 'error'), []);
  const reopened = await loadProject(file);
  assert.equal(reopened.project.assets.find(asset => asset.id === 'script')!.path, script.path);
});

test('save mirrors editor folders, preserves IDs and bytes, and old backups still resolve', async t => {
  const { root, project, folder, file } = await fixture(t);
  await fs.writeFile(file, JSON.stringify(project));
  await fs.writeFile(path.join(root, 'assets/unknown.txt'), 'leave me');
  const saved = await saveProject(file, project), asset = saved.project.assets[0];
  assert.equal(asset.path, 'assets/场景/王家大院/夜宴.webp');
  assert.equal(await fs.readFile(assetSourcePath(root, asset), 'utf8'), 'image-bytes');
  await assert.rejects(fs.access(path.join(root, 'assets/image.webp')), { code: 'ENOENT' });
  assert.equal(await fs.readFile(assetSourcePath(root, project.assets[0]), 'utf8'), 'image-bytes');
  assert.equal(await fs.readFile(path.join(root, 'assets/unknown.txt'), 'utf8'), 'leave me');
  assert.deepEqual(relocateProjectAssets(project, saved.assetRelocations!).assets, saved.project.assets);
  assert.equal((await loadProject(file + '.previous')).project.assets[0].path, asset.path);
  const renamed = structuredClone(saved.project);
  renamed.contentBrowser!.folders.find(item => item.id === folder)!.name = '庭院';
  const moved = await saveProject(file, renamed);
  assert.equal(moved.project.assets[0].path, 'assets/场景/庭院/夜宴.webp');
  assert.equal(await fs.readFile(assetSourcePath(root, project.assets[0]), 'utf8'), 'image-bytes');
  assert.deepEqual(moved.project.nodes, project.nodes);
  // Undo may supply a historical path and folder; it must move back safely.
  const undone = await saveProject(file, project);
  assert.equal(undone.project.assets[0].path, asset.path);
  assert.equal(await fs.readFile(assetSourcePath(root, moved.project.assets[0]), 'utf8'), 'image-bytes');
  await autosaveProject(file, moved.project);
  await fs.utimes(file, new Date(0), new Date(0));
  assert.equal((await loadProject(file)).project.assets[0].path, asset.path);
});

test('conflicting destination is preserved, duplicate sources are copied to separate folders', async t => {
  const { root, project, file } = await fixture(t);
  await fs.mkdir(path.join(root, 'assets/场景/王家大院'), { recursive: true });
  await fs.writeFile(path.join(root, 'assets/场景/王家大院/夜宴.webp'), 'unrelated');
  project.assets.push({ ...project.assets[0], id: 'second' });
  project.contentBrowser!.assignments['asset:second'] = ensureAssetFolder(project, 'scene', ['客栈']);
  const saved = await saveProject(file, project);
  assert.equal(saved.project.assets[0].path, 'assets/场景/王家大院/夜宴_image.webp');
  assert.equal(saved.project.assets[1].path, 'assets/场景/客栈/夜宴.webp');
  for (const asset of saved.project.assets) assert.equal(await fs.readFile(assetSourcePath(root, asset), 'utf8'), 'image-bytes');
  assert.equal(await fs.readFile(path.join(root, 'assets/场景/王家大院/夜宴.webp'), 'utf8'), 'unrelated');
});

test('shared normalized destinations copy once and retain each asset historical path', async t => {
  const { root, project, folder, file } = await fixture(t);
  const secondExtension = process.platform === 'win32' ? '.WEBP' : '.webp', secondSource = 'assets/second' + secondExtension;
  project.assets.push({ ...project.assets[0], id: 'second', name: '夜宴.WEBP', path: secondSource });
  project.contentBrowser!.assignments['asset:second'] = folder;
  await fs.writeFile(path.join(root, secondSource), 'image-bytes');
  const copyFile = fs.copyFile.bind(fs), copies: string[] = [];
  t.mock.method(fs, 'copyFile', async (...args: Parameters<typeof fs.copyFile>) => {
    if (args[2] === fs.constants.COPYFILE_EXCL) copies.push(path.relative(root, String(args[1])).split(path.sep).join('/'));
    return copyFile(...args);
  });

  const saved = await saveProject(file, project), destination = 'assets/场景/王家大院/夜宴.webp', secondDestination = 'assets/场景/王家大院/夜宴' + secondExtension;
  assert.deepEqual(copies, [destination]);
  assert.deepEqual(saved.project.assets.map(asset => asset.path), [destination, secondDestination]);
  assert.deepEqual(saved.assetRelocations, [
    { assetId: 'image', files: { 'assets/image.webp': destination } },
    { assetId: 'second', files: { [secondSource]: secondDestination } },
  ]);
  const ledger = readResourcePaths(root);
  for (const [index, asset] of project.assets.entries()) {
    assert.equal(ledger.assets?.[asset.id]?.[asset.path.toLowerCase()], saved.project.assets[index].path);
    await assert.rejects(fs.access(path.join(root, asset.path)), { code: 'ENOENT' });
    // Reusing the old filename must not hide this asset's identity-specific alias.
    await fs.writeFile(path.join(root, asset.path), 'replacement-for-' + asset.id);
    assert.equal(await fs.readFile(assetSourcePath(root, asset), 'utf8'), 'image-bytes');
  }
});

test('failed parallel copies wait for in-flight work without committing or removing sources', { timeout: 10000 }, async t => {
  const { root, project, folder, file, beforeCleanup } = await fixture(t);
  const contents = ['image-bytes', 'second-bytes', 'third-bytes', 'fourth-bytes', 'fifth-bytes', 'sixth-bytes'];
  for (let index = 1; index < contents.length; index++) {
    const id = 'copy_' + index;
    project.assets.push({ ...project.assets[0], id, name: '场景-' + index, path: `assets/${id}.webp` });
    project.contentBrowser!.assignments['asset:' + id] = folder;
    await fs.writeFile(path.join(root, `assets/${id}.webp`), contents[index]);
  }
  const primary = JSON.stringify(project), previous = 'previous-project-bytes';
  const ledgerFile = path.join(root, resourcePathLedger), records = path.join(root, '.studio/resource-layout');
  const ledgerBytes = JSON.stringify({ version: 1, paths: {}, assets: {} }), recordBytes = '{"previous":true}';
  await fs.mkdir(records, { recursive: true });
  await fs.writeFile(file, primary);
  await fs.writeFile(file + '.previous', previous);
  await fs.writeFile(ledgerFile, ledgerBytes);
  await fs.writeFile(path.join(records, 'previous.json'), recordBytes);

  const allStarted = copyGate(t), failCopy = copyGate(t), failureThrown = copyGate(t), finishCopies = copyGate(t);
  const copyFile = fs.copyFile.bind(fs), tasks: Promise<void>[] = [];
  const started: string[] = [], finished = new Set<string>();
  const failure = Object.assign(new Error('copy denied by test'), { code: 'EACCES' });
  const failedSource = path.join(root, project.assets[0].path);
  t.mock.method(fs, 'copyFile', (...args: Parameters<typeof fs.copyFile>) => {
    if (args[2] !== fs.constants.COPYFILE_EXCL) return copyFile(...args);
    const source = String(args[0]);
    const task = (async () => {
      started.push(source);
      if (started.length === 4) allStarted.release();
      try {
        if (source === failedSource) {
          await failCopy.promise;
          failureThrown.release();
          throw failure;
        }
        await finishCopies.promise;
        await copyFile(...args);
      } finally { finished.add(source); }
    })();
    tasks.push(task);
    return task;
  });

  let settled = false, completedAtSettlement: string[] = [];
  const pending = saveProject(file, project);
  const outcome = pending.then(
    value => { settled = true; completedAtSettlement = [...finished]; return { ok: true as const, value }; },
    error => { settled = true; completedAtSettlement = [...finished]; return { ok: false as const, error }; },
  );
  const drain = async () => {
    allStarted.release(); failCopy.release(); failureThrown.release(); finishCopies.release();
    await outcome;
    await Promise.allSettled(tasks);
  };
  beforeCleanup(drain);
  const assertUntouched = async () => {
    assert.equal(await fs.readFile(file, 'utf8'), primary);
    assert.equal(await fs.readFile(file + '.previous', 'utf8'), previous);
    assert.equal(await fs.readFile(ledgerFile, 'utf8'), ledgerBytes);
    assert.deepEqual(await fs.readdir(records), ['previous.json']);
    assert.equal(await fs.readFile(path.join(records, 'previous.json'), 'utf8'), recordBytes);
    for (const [index, asset] of project.assets.entries()) assert.equal(await fs.readFile(path.join(root, asset.path), 'utf8'), contents[index]);
  };
  try {
    await waitForCopyGate(t, allStarted, outcome, 'all four initial copies started');
    const expectedStarted = project.assets.slice(0, 4).map(asset => path.join(root, asset.path));
    assert.deepEqual(new Set(started), new Set(expectedStarted));
    failCopy.release();
    await waitForCopyGate(t, failureThrown, outcome, 'the injected copy failed');
    await assertUntouched();
    assert.equal(settled, false, 'Save must remain pending while three already-started copies are held');
    assert.deepEqual(started.slice().sort(), expectedStarted.slice().sort());

    finishCopies.release();
    const result = await outcome;
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, failure);
    assert.deepEqual(new Set(completedAtSettlement), new Set(expectedStarted));
    assert.deepEqual(started.slice().sort(), expectedStarted.slice().sort(), 'No queued fifth or sixth plan may start after failure');
    await assertUntouched();
    for (let index = 1; index < 4; index++) assert.equal(await fs.readFile(path.join(root, 'assets/场景/王家大院', project.assets[index].name + '.webp'), 'utf8'), contents[index]);
  } finally { await drain(); }
});

test('parallel completion order preserves deterministic conflict names and existing destinations', { timeout: 10000 }, async t => {
  const { root, project, folder, file, beforeCleanup } = await fixture(t);
  project.assets.push(
    { ...project.assets[0], id: 'second', path: 'assets/second.webp' },
    { ...project.assets[0], id: 'third', path: 'assets/third.webp' },
  );
  const contents = ['image-bytes', 'second-bytes', 'third-bytes'];
  for (const [index, asset] of project.assets.entries()) {
    project.contentBrowser!.assignments['asset:' + asset.id] = folder;
    await fs.writeFile(path.join(root, asset.path), contents[index]);
  }
  const directory = path.join(root, 'assets/场景/王家大院');
  await fs.mkdir(directory, { recursive: true });
  const preserved = [
    ['夜宴.webp', 'unrelated-original'],
    ['夜宴_image.webp', 'unrelated-image-suffix'],
    ['夜宴_second.webp', 'unrelated-second-suffix'],
  ];
  for (const [name, bytes] of preserved) await fs.writeFile(path.join(directory, name), bytes);
  const destinations = ['夜宴_image_1.webp', '夜宴_second_1.webp', '夜宴_third.webp'];
  const releases = destinations.map(() => copyGate(t)), completions = destinations.map(() => copyGate(t)), allStarted = copyGate(t);
  const copyFile = fs.copyFile.bind(fs), tasks: Promise<void>[] = [];
  const started: string[] = [], completed: string[] = [];
  t.mock.method(fs, 'copyFile', (...args: Parameters<typeof fs.copyFile>) => {
    if (args[2] !== fs.constants.COPYFILE_EXCL) return copyFile(...args);
    const name = path.basename(String(args[1])), index = destinations.indexOf(name);
    const task = (async () => {
      assert.ok(index >= 0, 'Copy must use the preflight conflict destination: ' + name);
      started.push(name);
      if (started.length === destinations.length) allStarted.release();
      await releases[index].promise;
      await copyFile(...args);
      completed.push(name);
      completions[index].release();
    })();
    tasks.push(task);
    return task;
  });
  const pending = saveProject(file, project);
  // Attach rejection handling before waiting for mock checkpoints.
  const outcome = pending.then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
  const drain = async () => {
    allStarted.release();
    for (const gate of [...releases, ...completions]) gate.release();
    await outcome;
    await Promise.allSettled(tasks);
  };
  beforeCleanup(drain);
  try {
    await waitForCopyGate(t, allStarted, outcome, 'all conflicting destinations started');
    assert.deepEqual(new Set(started), new Set(destinations));
    for (let index = destinations.length - 1; index >= 0; index--) {
      releases[index].release();
      await waitForCopyGate(t, completions[index], outcome, 'destination completed: ' + destinations[index]);
    }
    const result = await outcome;
    if (!result.ok) throw result.error;
    assert.deepEqual(completed, destinations.slice().reverse());
    assert.deepEqual(result.value.project.assets.map(asset => asset.path), destinations.map(name => 'assets/场景/王家大院/' + name));
    for (const [index, asset] of result.value.project.assets.entries()) assert.equal(await fs.readFile(assetSourcePath(root, asset), 'utf8'), contents[index]);
    for (const [name, bytes] of preserved) assert.equal(await fs.readFile(path.join(directory, name), 'utf8'), bytes);
    for (const [index, asset] of project.assets.entries()) assert.equal(await fs.readFile(assetSourcePath(root, asset), 'utf8'), contents[index]);
  } finally { await drain(); }
});

test('internal directory aliases do not read a shared destination before its copy finishes', { timeout: 10000 }, async t => {
  const { root, project, file, beforeCleanup } = await fixture(t);
  const realDirectory = path.join(root, 'assets/场景/王家大院'), aliasDirectory = path.join(root, 'assets/场景/客栈');
  await fs.mkdir(realDirectory, { recursive: true });
  try { await fs.symlink(realDirectory, aliasDirectory, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) {
      t.skip('Internal directory links are unavailable: ' + (error as NodeJS.ErrnoException).code);
      return;
    }
    throw error;
  }
  project.assets.push({ ...project.assets[0], id: 'second', path: 'assets/second.webp' });
  project.contentBrowser!.assignments['asset:second'] = ensureAssetFolder(project, 'scene', ['客栈']);
  await fs.writeFile(path.join(root, 'assets/second.webp'), 'image-bytes');
  const copyFile = fs.copyFile.bind(fs), mkdir = fs.mkdir.bind(fs);
  const started = copyGate(t), completeFirst = copyGate(t), tasks: Promise<void>[] = [];
  let firstFinished = false;
  const aliasPreparation: boolean[] = [], copies: string[] = [];
  t.mock.method(fs, 'mkdir', (...args: Parameters<typeof fs.mkdir>) => {
    if (path.resolve(String(args[0])) === aliasDirectory) aliasPreparation.push(firstFinished);
    return mkdir(...args);
  });
  t.mock.method(fs, 'copyFile', (...args: Parameters<typeof fs.copyFile>) => {
    if (args[2] !== fs.constants.COPYFILE_EXCL) return copyFile(...args);
    const destination = String(args[1]);
    const task = (async () => {
      copies.push(path.dirname(destination));
      if (path.dirname(destination) === realDirectory) {
        // COPYFILE_EXCL exposes the destination name before all its bytes exist.
        await fs.writeFile(destination, 'partial', { flag: 'wx' });
        started.release();
        await completeFirst.promise;
        await fs.writeFile(destination, await fs.readFile(args[0]));
        firstFinished = true;
      } else {
        assert.equal(firstFinished, true, 'Alias verification must wait for the original copy');
        await copyFile(...args);
      }
    })();
    tasks.push(task);
    return task;
  });
  const pending = saveProject(file, project);
  const outcome = pending.then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
  const drain = async () => {
    started.release(); completeFirst.release();
    await outcome;
    await Promise.allSettled(tasks);
  };
  beforeCleanup(drain);
  try {
    await waitForCopyGate(t, started, outcome, 'the shared destination is partially written');
    assert.deepEqual(aliasPreparation, [], 'Alias copy must not be scheduled while the first destination is incomplete');
    assert.equal(await fs.readFile(path.join(aliasDirectory, '夜宴.webp'), 'utf8'), 'partial');
    completeFirst.release();
    const result = await outcome;
    if (!result.ok) throw result.error;
    assert.deepEqual(aliasPreparation, [true]);
    assert.deepEqual(copies, [realDirectory, aliasDirectory]);
    assert.deepEqual(result.value.project.assets.map(asset => asset.path), ['assets/场景/王家大院/夜宴.webp', 'assets/场景/客栈/夜宴.webp']);
    for (const asset of project.assets) assert.equal(await fs.readFile(assetSourcePath(root, asset), 'utf8'), 'image-bytes');
  } finally { await drain(); }
});

test('spine files move as a group; reference assets and missing groups are preserved', async t => {
  const { root, project, file } = await fixture(t);
  const skeleton: Project['assets'][number] = { id: 'spine', name: '骨骼', kind: 'spine', path: 'assets/old/skeleton.json', spine: { version: '4.2', atlasPath: 'assets/old/skeleton.atlas', pages: [{ name: 'page.png', path: 'assets/old/page.png', width: 1, height: 1 }], animations: [], skins: [], bounds: { x: 0, y: 0, width: 1, height: 1 } } };
  project.assets.push(skeleton, { ...project.assets[0], id: 'reference', externalPath: path.join(root, 'assets/image.webp'), path: 'assets/reference.webp' }, { ...skeleton, id: 'missing', path: 'assets/missing.json' });
  const spineFolder = ensureAssetFolder(project, 'spine', ['人物']);
  for (const id of ['spine', 'missing']) project.contentBrowser!.assignments['asset:' + id] = spineFolder;
  project.contentBrowser!.assignments['asset:reference'] = project.contentBrowser!.assignments['asset:image'];
  await fs.mkdir(path.join(root, 'assets/old'));
  for (const name of ['skeleton.json', 'skeleton.atlas', 'page.png']) await fs.writeFile(path.join(root, 'assets/old', name), name);
  const saved = await saveProject(file, project);
  const moved = saved.project.assets[1];
  assert.equal(moved.path, 'assets/骨骼动画/人物/骨骼_spine/skeleton.json');
  assert.equal(moved.spine!.atlasPath, 'assets/骨骼动画/人物/骨骼_spine/skeleton.atlas');
  assert.equal(await fs.readFile(assetSourcePath(root, moved, moved.spine!.pages[0].path), 'utf8'), 'page.png');
  assert.deepEqual(saved.project.assets.slice(2), project.assets.slice(2));
  assert.equal(await fs.readFile(assetSourcePath(root, saved.project.assets[2]), 'utf8'), 'image-bytes');
  assert.deepEqual(saved.resourceReport?.skipped, ['骨骼']);
});

test('save failure keeps original files and bytes; autosave never moves assets', async t => {
  const { root, project, file } = await fixture(t);
  await autosaveProject(file, project);
  assert.equal(await fs.readFile(path.join(root, 'assets/image.webp'), 'utf8'), 'image-bytes');
  await fs.mkdir(file);
  await assert.rejects(saveProject(file, project));
  assert.equal(await fs.readFile(path.join(root, 'assets/image.webp'), 'utf8'), 'image-bytes');
  assert.equal(await fs.readFile(assetSourcePath(root, project.assets[0]), 'utf8'), 'image-bytes');
});

test('disabled synchronization retains paths and a source changed during save is not deleted', async t => {
  const { root, project, file } = await fixture(t);
  project.resourceSettings!.syncFolders = false;
  const unchanged = await saveProject(file, project);
  assert.deepEqual(unchanged.project.assets, project.assets);
  const pending = await prepareResourceLayout(root, project);
  await fs.writeFile(path.join(root, 'assets/image.webp'), 'changed elsewhere');
  assert.deepEqual(await pending.finish(), ['assets/image.webp']);
  assert.equal(await fs.readFile(path.join(root, 'assets/image.webp'), 'utf8'), 'changed elsewhere');
});

test('unassigned legacy music and fonts use their category and later saves do no extra copying', async t => {
  const { root, project, file } = await fixture(t);
  project.assets.push({ id: 'music', kind: 'audio', category: 'bgm', name: '音乐', path: 'assets/music.ogg' }, { id: 'font', kind: 'font', name: '字体', path: 'assets/font.ttf' });
  await fs.writeFile(path.join(root, 'assets/music.ogg'), 'music'); await fs.writeFile(path.join(root, 'assets/font.ttf'), 'font');
  const saved = await saveProject(file, project);
  assert.deepEqual(saved.project.assets.slice(1).map(asset => asset.path), ['assets/BGM/音乐.ogg', 'assets/字体/字体.ttf']);
  const before = (await fs.stat(path.join(root, saved.project.assets[1].path))).mtimeMs;
  const again = await saveProject(file, saved.project);
  assert.equal(again.resourceReport, undefined);
  assert.equal((await fs.stat(path.join(root, again.project.assets[1].path))).mtimeMs, before);
});

test('asset renaming synchronizes files and historical references through undo and redo', async t => {
  const { root, project, file } = await fixture(t);
  const first = await saveProject(file, project);
  const renamed = structuredClone(first.project);
  renamed.assets[0].name = '客栈：夜/雨.webp';
  const second = await saveProject(file, renamed);
  assert.equal(second.project.assets[0].path, 'assets/场景/王家大院/客栈：夜_雨.webp');
  assert.equal(await fs.readFile(assetSourcePath(root, first.project.assets[0]), 'utf8'), 'image-bytes');
  const undone = await saveProject(file, first.project);
  assert.equal(undone.project.assets[0].path, first.project.assets[0].path);
  const redone = await saveProject(file, second.project);
  assert.equal(redone.project.assets[0].path, second.project.assets[0].path);
  assert.equal(await fs.readFile(assetSourcePath(root, project.assets[0]), 'utf8'), 'image-bytes');
  assert.equal((await saveProject(file, redone.project)).resourceReport, undefined);
});

test('Windows names remain safe and extensions stay attached exactly once', () => {
  assert.equal(resourceFileName('CON', 'assets/a.ogg'), '_CON.ogg');
  assert.equal(resourceFileName('音乐.OGG', 'assets/a.ogg'), '音乐.ogg');
  assert.equal(resourceFileName('末尾. ', 'assets/a.png'), '末尾.png');
  assert.equal(resourceFileName('../../路径\\名?', 'assets/a.ttf'), '.._.._路径_名_.ttf');
});

test('reusing a renamed file name cannot redirect an old snapshot to another asset', async t => {
  const { root, project, file } = await fixture(t);
  const first = await saveProject(file, project);
  const renamed = structuredClone(first.project); renamed.assets[0].name = '客栈';
  const second = await saveProject(file, renamed);
  await fs.writeFile(path.join(root, 'assets/new.webp'), 'different-image');
  second.project.assets.push({ ...project.assets[0], id: 'new_image', path: 'assets/new.webp' });
  second.project.contentBrowser!.assignments['asset:new_image'] = project.contentBrowser!.assignments['asset:image'];
  const third = await saveProject(file, second.project);
  assert.equal(third.project.assets[1].path, first.project.assets[0].path);
  assert.equal(await fs.readFile(assetSourcePath(root, first.project.assets[0]), 'utf8'), 'image-bytes');
  assert.equal(await fs.readFile(assetSourcePath(root, third.project.assets[1]), 'utf8'), 'different-image');
  const copyRoot = path.join(root, 'copy');
  const copied = await saveProject(path.join(copyRoot, 'project.vns.json'), first.project, root);
  assert.equal(await fs.readFile(assetSourcePath(copyRoot, copied.project.assets[0]), 'utf8'), 'image-bytes');
});
