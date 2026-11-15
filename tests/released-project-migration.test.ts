import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { releasedProjectManifest, readReleasedProject, assertReleasedProjectIdentity } from '../scripts/lib/released-project-fixture';
import { parseProject, loadProject, saveProject } from '../src/desktop/project-store';

const manifest = await releasedProjectManifest();
for (const entry of manifest.projects) {
  test('released ' + manifest.release + ' / ' + entry.id + ' document retains author IDs, mixed entries and call interfaces on save/reopen', async t => {
    const { bytes, raw } = await readReleasedProject(entry), original = JSON.stringify(raw), parsed = parseProject(raw);
    assertReleasedProjectIdentity(raw, parsed.project); assert.equal(JSON.stringify(raw), original);
    assert.equal(parseProject(parsed.project).migrated, false, 'Migration must converge instead of altering the graph on each open.');
    const parent = await fs.realpath(os.tmpdir()), directory = await fs.mkdtemp(path.join(parent, 'vns-released-project-'));
    t.after(async () => { const real = await fs.realpath(directory); assert.equal(path.dirname(real), parent); await fs.rm(real, { recursive: true, force: true }); });
    const file = path.join(directory, 'project.vns.json'); await fs.writeFile(file, bytes);
    const loaded = await loadProject(file); assertReleasedProjectIdentity(raw, loaded.project);
    assert.deepEqual(await fs.readFile(file), bytes, 'Opening is not permission to rewrite the historical project.');
    if (parsed.migrated) assert.deepEqual(await fs.readFile(file + '.before-migration'), bytes);
    const saved = await saveProject(file, loaded.project), reopened = await loadProject(file);
    assertReleasedProjectIdentity(raw, reopened.project); assert.deepEqual(reopened.project.blueprints, saved.project.blueprints); assert.deepEqual(reopened.project.timelinePresets, saved.project.timelinePresets);
    assert.deepEqual(reopened.project.ui, saved.project.ui);
    assert.deepEqual((await readReleasedProject(entry)).bytes, bytes, 'Historical fixture bytes must never be rewritten.');
  });
}