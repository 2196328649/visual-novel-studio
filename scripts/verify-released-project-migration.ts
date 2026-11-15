import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { releasedProjectManifest, readReleasedProject, assertReleasedProjectIdentity } from './lib/released-project-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { containedPath, loadProject, parseProject, saveProject } from '../src/desktop/project-store';
import { projectGraphs } from '../src/core/project-resources';

const root = path.resolve('.'), output = path.resolve('artifacts/released-project-migration', new Date().toISOString().replaceAll(':', '-'));
const sdk = process.env.VNS_RENPY_SDK ?? 'E:/Tools/renpy-8.5.3-sdk';
const python = path.join(sdk, 'lib/py3-windows-x86_64/python.exe'), execute = promisify(execFile);
await fs.mkdir(output, { recursive: true });
const report: { status: string; scope: string; archive?: unknown; projects: unknown[]; error?: string } = { status: 'running',
  scope: 'Exact archived 0.8.0 project documents, source provenance and non-destructive migration/save/reopen. This does NOT prove native save, rollback, every system-host context or derived-scheme runtime compatibility.', projects: [] };
try {
  const manifest = await releasedProjectManifest(), archive = containedPath(root, manifest.archive.file);
  const hash = createHash('sha256'); for await (const chunk of createReadStream(archive)) hash.update(chunk);
  const sha256 = hash.digest('hex'); assert.equal(sha256, manifest.archive.expectedSha256, 'The historical archive must match the recorded released distribution, not a current build.');
  report.archive = { release: manifest.release, path: archive, sha256, provenance: manifest.archive.provenance };
  await fs.access(python);
  for (const entry of manifest.projects) {
    assert.match(entry.id, /^[a-z0-9_-]+$/);
    const run = path.join(output, entry.id), source = path.join(run, 'source'), file = path.join(source, 'project.vns.json');
    await fs.mkdir(source, { recursive: true });
    try {
      // The fixed destination is never derived from an archive path; zipfile
      // verifies entry CRC and writes only the explicitly requested document.
      const extraction = await execute(python, ['-c', [
        'import json, pathlib, sys, zipfile',
        'with zipfile.ZipFile(sys.argv[1]) as archive:',
        '    entry = archive.getinfo(sys.argv[2])',
        '    if entry.file_size > 32 * 1024 * 1024: raise ValueError("Historical project is too large")',
        '    value = archive.read(entry)',
        '    with open(sys.argv[3], "xb") as target: target.write(value)',
        '    print(json.dumps(dict(entry=entry.filename, bytes=len(value))))',
      ].join('\n'), archive, entry.archiveEntry, file], { windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024, env: { ...process.env, PYTHONUTF8: '1' } });
      await fs.writeFile(path.join(run, 'archive-read.log'), extraction.stdout + extraction.stderr);
      const historical = await readReleasedProject(entry), bytes = await fs.readFile(file); assert.deepEqual(bytes, historical.bytes);
      const parsed = parseProject(historical.raw), session = await loadProject(file);
      assertReleasedProjectIdentity(historical.raw, session.project); assert.deepEqual(await fs.readFile(file), bytes);
      if (parsed.migrated) assert.deepEqual(await fs.readFile(file + '.before-migration'), bytes);
      const saved = await saveProject(file, session.project), reopened = await loadProject(file);
      assertReleasedProjectIdentity(historical.raw, reopened.project); assert.equal(parseProject(reopened.project).migrated, false);
      assert.deepEqual(projectGraphs(reopened.project), projectGraphs(saved.project)); assert.deepEqual(reopened.project.ui, saved.project.ui);
      assert.deepEqual((await readReleasedProject(entry)).bytes, bytes);
      report.projects.push({ id: entry.id, archiveEntry: entry.archiveEntry, bytes: bytes.length, sourceSha256: entry.sha256,
        migrated: parsed.migrated, original: entry.inventory, saved: { graphs: projectGraphs(saved.project).length, assets: saved.project.assets.length, components: saved.project.ui.components.length }, nativeSaveCoverage: false });
      await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    } finally { const cleanup = await cleanVerificationDirectories(run, ['source']); assert.deepEqual(cleanup.errors, []); }
  }
  assert.equal(report.projects.length, manifest.projects.length); report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error); console.error(error); process.exitCode = 1; }
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(output);