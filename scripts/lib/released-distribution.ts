import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { containedPath } from '../../src/desktop/project-store';
import { releasedProjectManifest } from './released-project-fixture';

export async function sha256File(file: string) {
  const hash = createHash('sha256'); for await (const bytes of createReadStream(file)) hash.update(bytes); return hash.digest('hex');
}
/** The actual archived binary/compiler/runtime, never an old-looking document
 * compiled by current sources. Everything executes inside the caller's run. */
export async function extractReleasedDistribution(root: string, output: string, python: string) {
  const manifest = await releasedProjectManifest(), archive = containedPath(root, manifest.archive.file);
  const sha256 = await sha256File(archive); assert.equal(sha256, manifest.archive.expectedSha256);
  const destination = containedPath(output, 'release'); await fs.mkdir(destination);
  const indexFile = containedPath(output, 'archive-index.json');
  const result = await promisify(execFile)(python, ['-c', [
    'import hashlib, json, pathlib, stat, sys, zipfile',
    'root = pathlib.Path(sys.argv[2]).resolve()',
    'index = []',
    'with zipfile.ZipFile(sys.argv[1]) as archive:',
    '    entries = archive.infolist()',
    '    if len(entries) > 10000 or sum(row.file_size for row in entries) > 5 * 1024 ** 3: raise ValueError("Archive size limit")',
    '    targets = []',
    '    for row in entries:',
    '        name = pathlib.PurePosixPath(row.filename)',
    '        if name.is_absolute() or ".." in name.parts or any(":" in part or chr(92) in part for part in name.parts) or stat.S_ISLNK(row.external_attr >> 16): raise ValueError("Unsafe archive path")',
    '        target = root.joinpath(*name.parts).resolve()',
    '        if not target.is_relative_to(root) or target == root: raise ValueError("Archive path escapes extraction root")',
    '        targets.append((row, target))',
    '    for row, target in targets:',
    '        if row.is_dir(): target.mkdir(parents=True, exist_ok=True); continue',
    '        target.parent.mkdir(parents=True, exist_ok=True)',
    '        h = hashlib.sha256()',
    '        with archive.open(row) as source, target.open("xb") as out:',
    '            while True:',
    '                chunk = source.read(1024 * 1024)',
    '                if not chunk: break',
    '                h.update(chunk); out.write(chunk)',
    '        index.append(dict(file=row.filename, bytes=row.file_size, sha256=h.hexdigest()))',
    'pathlib.Path(sys.argv[3]).write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")',
    'print(json.dumps(dict(files=len(index), bytes=sum(row["bytes"] for row in index))))',
  ].join('\n'), archive, destination, indexFile], { windowsHide: true, timeout: 300000, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' } });
  await fs.writeFile(containedPath(output, 'archive-extraction.log'), result.stdout + result.stderr);
  const releaseRoot = containedPath(destination, manifest.distribution.rootEntry);
  const executablePath = containedPath(releaseRoot, manifest.distribution.executable);
  assert.equal(await sha256File(executablePath), manifest.distribution.executableSha256);
  assert.equal(await sha256File(containedPath(releaseRoot, 'resources/app.asar')), manifest.distribution.asarSha256);
  return { manifest, archive: { file: archive, sha256 }, releaseRoot, extractedRoot: destination,
    sdk: containedPath(releaseRoot, 'resources/resources/runtime'),
    launch: { ...manifest.distribution, executablePath, version: manifest.release } };
}
