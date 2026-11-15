import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const execute = promisify(execFile);
const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve('electron-builder'));
const asar = createRequire(builderRequire.resolve('app-builder-lib'))('@electron/asar');
const metadata = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const { version } = metadata;
const requestedOutput = process.env.VNS_RELEASE_VERIFY_ROOT, sevenZip = process.env.VNS_FULL_7ZIP;
assert.ok(requestedOutput && path.isAbsolute(requestedOutput), 'Specify a fresh absolute VNS_RELEASE_VERIFY_ROOT.');
assert.ok(sevenZip && path.isAbsolute(sevenZip), 'Specify a verified full 7-Zip executable.');
const output = path.resolve(requestedOutput), artifacts = path.join(root, 'artifacts');
const contained = (parent, file) => {
  const relative = path.relative(parent, file);
  return !!relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};
assert.ok(contained(artifacts, output), 'Release verification must stay within workspace artifacts.');
assert.ok(contained(await fs.realpath(artifacts), await fs.realpath(path.dirname(output))), 'Run parent escapes the workspace.');
await fs.mkdir(output); // Exclusive output: no old acceptance directory is inspected or reused.
const report = { status: 'running', version, output, checks: [], cleanupTargets: [], installerExecuted: false };
const source = path.join(root, 'release/win-unpacked');
const digest = async file => {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
};
const bytesDigest = bytes => createHash('sha256').update(bytes).digest('hex');
const slash = file => file.replaceAll('\\', '/');
const archivePath = file => file.split('/').join(path.sep);
async function collect(directory, relative = '') {
  const files = [];
  for (const entry of (await fs.readdir(path.join(directory, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(relative, entry.name);
    assert.ok(!entry.isSymbolicLink(), `Release must not contain links: ${file}`);
    if (entry.isDirectory()) files.push(...await collect(directory, file));
    else {
      assert.ok(entry.isFile(), `Unsupported release entry: ${file}`);
      files.push({ path: slash(file), bytes: (await fs.stat(path.join(directory, file))).size, sha256: await digest(path.join(directory, file)) });
    }
  }
  return files;
}
async function extract(archive, destination, args = []) {
  const result = await execute(sevenZip, ['x', '-y', ...args, '-o' + destination, archive], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  await fs.appendFile(path.join(output, 'extraction.log'), result.stdout + result.stderr);
}
async function checkAsar(application) {
  const archive = path.join(application, 'resources/app.asar');
  const entries = asar.listPackage(archive).map(item => slash(item).replace(/^\//, ''));
  const files = entries.filter(item => !asar.statFile(archive, archivePath(item)).files).sort();
  assert.ok(!files.some(item => /\.(?:map|cmd)$/i.test(item) || /^(?:src|scripts|tests|node_modules|docs)\//.test(item)), 'ASAR contains development-only files.');
  const packaged = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
  assert.equal(packaged.version, version);
  const buildFiles = (await Promise.all(['dist', 'dist-desktop'].map(async directory => (await collect(path.join(root, directory)))
    .filter(item => !item.path.endsWith('.map')).map(item => ({ ...item, path: directory + '/' + item.path }))))).flat();
  assert.deepEqual(files, ['package.json', ...buildFiles.map(item => item.path)].sort(), 'ASAR product file list must match this build.');
  for (const file of buildFiles) {
    assert.equal(bytesDigest(asar.extractFile(archive, archivePath(file.path))), file.sha256, `ASAR differs from this build: ${file.path}`);
  }
  const worker = 'dist-desktop/image-metadata-worker.cjs';
  assert.equal(asar.statFile(archive, archivePath(worker)).unpacked, true, 'Image metadata worker must run from the unpacked path.');
  assert.equal(await digest(path.join(application, 'resources/app.asar.unpacked', worker)), await digest(path.join(root, worker)));
  return { sha256: await digest(archive), files: files.length, buildFiles: buildFiles.length };
}
async function checkDocs(application) {
  const packagedRoot = path.join(application, 'resources'), docRoot = path.join(packagedRoot, 'docs');
  const docFilter = metadata.build.extraResources.find(item => item.from === 'docs').filter;
  const delivered = await collect(docRoot);
  assert.deepEqual(delivered.map(item => item.path).sort(), [...docFilter].sort(), 'Only approved user documentation may be packaged.');
  for (const item of delivered) {
    assert.equal(item.sha256, await digest(path.join(root, 'docs', item.path)), `Bundled documentation differs: ${item.path}`);
  }
  assert.equal(await digest(path.join(packagedRoot, 'README.md')), await digest(path.join(root, 'docs/README.md')));
  for (const file of [path.join(packagedRoot, 'README.md'), ...delivered.map(item => path.join(docRoot, item.path))]) {
    const text = await fs.readFile(file, 'utf8');
    assert.ok(!/启动开发版\.cmd|运行开发版本\.cmd|LiuXiangdong|docs\/handoff-|artifacts\/[\w-]+\//i.test(text), `User documentation contains local/internal content: ${file}`);
    for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1].replace(/^<|>$/g, '').split('#')[0];
      if (!target || /^[a-z][a-z\d+.-]*:/i.test(target)) continue;
      const absolute = path.resolve(path.dirname(file), target);
      assert.ok(contained(packagedRoot, absolute), `Documentation link escapes the package: ${target}`);
      assert.ok((await fs.stat(absolute)).isFile(), `Bundled documentation link is missing: ${target}`);
    }
  }
  return { files: delivered.length, localLinksVerified: true };
}
try {
  const expected = await collect(source);
  await fs.writeFile(path.join(output, 'build-manifest.json'), JSON.stringify({ version, files: expected }, null, 2));
  const disallowed = expected.filter(item => /(?:^|\/)(?:artifacts|work|node_modules|\.git|__pycache__|saves|cache|data)(?:\/|$)|(?:^|\/)AGENTS\.md$|启动开发版\.cmd$|运行开发版本\.cmd$|(?:^|\/)ai-settings\.json$|\.(?:p12|pfx|jks|keystore|map)$/i.test(item.path));
  // Electron's renderer snapshot has no .map files; bundled engines may retain
  // compiled Python/Ren'Py modules, which are runtime inputs rather than caches.
  assert.deepEqual(disallowed, [], 'Application contains local/development files.');
  const resources = path.join(source, 'resources/resources');
  const required = [
    'runtime/renpy.py', 'runtime/LICENSE.txt', 'runtime/lib/py3-windows-x86_64/python.exe',
    'single-exe/launcher.exe', 'single-exe/icon-tool.exe', 'templates/aihong/project.vns.json',
    'example/project.vns.json', 'spine/vns_spine.py', 'spine/vns_spine.dll', 'spine/LICENSE-Spine.txt',
    'spine/android/armeabi-v7a/libvns_spine.so', 'spine/android/arm64-v8a/libvns_spine.so',
    'spine/android/x86_64/libvns_spine.so', 'tools/unpack_verified.py', 'THIRD-PARTY-NOTICES.txt', 'SAMPLE-CREDITS.md',
  ];
  for (const relative of required) assert.ok((await fs.stat(path.join(resources, relative))).size > 0, `Runtime resource missing: ${relative}`);
  report.checks.push({ kind: 'build', files: expected.length, bytes: expected.reduce((sum, file) => sum + file.bytes, 0), requiredResources: required.length,
    asar: await checkAsar(source), docs: await checkDocs(source) });
  const archives = [
    { kind: 'installer', filename: `Visual Novel Studio Setup ${version}.exe` },
    { kind: 'portable', filename: `Visual-Novel-Studio-${version}-portable-win-x64.zip` },
  ];
  for (const { kind, filename } of archives) {
    const archive = path.join(root, 'release', filename);
    let application;
    if (kind === 'installer') {
      const container = path.join(output, 'installer-container');
      application = path.join(output, 'installer-app');
      report.cleanupTargets.push(container, application);
      await extract(archive, container, ['-tNsis']);
      await extract(path.join(container, '$PLUGINSDIR/app-64.7z'), application);
      // NSIS writes pre-compressed resources directly into $INSTDIR, outside
      // app-64.7z. Merge those actual embedded files before comparing payloads.
      for (const item of await collect(container)) {
        if (item.path.startsWith('$')) continue; // Installer plugin and uninstaller files.
        const expectedFile = expected.find(file => file.path === item.path);
        assert.ok(expectedFile, `Unexpected direct NSIS application file: ${item.path}`);
        assert.deepEqual(item, expectedFile, `NSIS direct resource differs from the build: ${item.path}`);
        const destination = path.join(application, item.path);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.copyFile(path.join(container, item.path), destination);
      }
    } else {
      const destination = path.join(output, 'portable');
      report.cleanupTargets.push(destination);
      await extract(archive, destination);
      application = path.join(destination, `Visual-Novel-Studio-${version}`);
    }
    const actual = await collect(application);
    const extras = kind === 'portable' ? ['portable.json', '使用说明.md'] : [];
    assert.deepEqual(actual.map(item => item.path).sort(), [...expected.map(item => item.path), ...extras].sort(), `${kind} contains missing or extra files.`);
    const actualFiles = new Map(actual.map(item => [item.path, item]));
    for (const file of expected) assert.deepEqual(actualFiles.get(file.path), file, `${kind} payload differs from the current build: ${file.path}`);
    if (kind === 'portable') {
      assert.deepEqual(JSON.parse(await fs.readFile(path.join(application, 'portable.json'), 'utf8')), { format: 1, version, dataDirectory: 'data' });
      assert.equal(await digest(path.join(application, '使用说明.md')), await digest(path.join(root, 'docs/portable.md')));
    }
    report.checks.push({ kind, filename, bytes: (await fs.stat(archive)).size, sha256: await digest(archive), application,
      files: actual.length, payloadMatchesBuild: true, asar: await checkAsar(application), docs: await checkDocs(application) });
  }
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = String(error); process.exitCode = 1;
} finally {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, version, report: path.join(output, 'report.json'), checks: report.checks.length, error: report.error }, null, 2));
}
