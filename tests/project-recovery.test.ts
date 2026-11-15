import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject, projectSchema } from '../src/core/model';
import { projectDraftSchema } from '../src/core/project-draft-schema';
import { applyUiDraft } from '../src/core/ui-draft';
import { autosaveProject, loadProject, saveProject, WriteQueue, UnsupportedProjectFormatError } from '../src/desktop/project-store';
import { autosaveAtLocation, discardProjectRecovery, recoverProjectAtLocation } from '../src/desktop/project-location';

async function fixture(t: TestContext) {
  const parent = path.resolve(process.env.VNS_TEST_TEMP_ROOT ? path.join(process.env.VNS_TEST_TEMP_ROOT, 'recovery-unit') : 'artifacts/recovery-unit'); await fs.mkdir(parent, { recursive: true });
  const directory = await fs.mkdtemp(path.join(parent, 'run-'));
  t.after(async () => {
    const actual = await fs.realpath(directory);
    assert.ok(actual.startsWith(await fs.realpath(parent) + path.sep));
    await fs.rm(actual, { recursive: true, force: true });
  });
  const file = path.join(directory, 'project.vns.json');
  const saved = await saveProject(file, createProject('恢复验证'));
  await fs.utimes(file, new Date(0), new Date(0));
  return { directory, file, project: saved.project };
}
test('UI-only recovery preserves a clean base and an unfinished draft without writing the primary file', async t => {
  const { project, file } = await fixture(t), bytes = await fs.readFile(file, 'utf8');
  const uiDraft = structuredClone(project);
  uiDraft.ui.components.push({ id: 'unfinished', kind: 'button', page: 'main', text: '继续编辑', action: 'blueprint', x: .1, y: .1, width: .2, height: .1 });
  assert.equal(projectSchema.safeParse(uiDraft).success, false); assert.equal(projectDraftSchema.safeParse(uiDraft).success, true);
  await autosaveProject(file, project, true, { projectDirty: false, uiDraft });
  const recovered = await loadProject(file);
  assert.equal(recovered.recovered, true); assert.equal(recovered.recoveredProjectDirty, false);
  assert.deepEqual(recovered.project, project); assert.deepEqual(recovered.uiDraft, uiDraft);
  await assert.rejects(saveProject(file, uiDraft)); assert.equal(await fs.readFile(file, 'utf8'), bytes);
  uiDraft.ui.components.at(-1)!.action = 'start';
  await saveProject(file, applyUiDraft(recovered.project, { base: recovered.project, value: uiDraft }));
  const reopened = await loadProject(file); assert.equal(reopened.recovered, false); assert.equal(reopened.uiDraft, undefined);
  assert.equal(reopened.project.ui.components.at(-1)?.text, '继续编辑');
});
test('mixed recovery keeps project edits and UI edits separate, including concurrent resources', async t => {
  const { project, file } = await fixture(t);
  project.name = '主工程的新名称'; project.assets.push({ id: 'external', name: '外部图', kind: 'image', path: 'assets/source.jpg', externalPath: path.join(path.dirname(file), 'outside.jpg') });
  const uiDraft = structuredClone(project); uiDraft.ui.fontSize = 51;
  await autosaveProject(file, project, true, { projectDirty: true, uiDraft });
  const result = await loadProject(file);
  assert.equal(result.recoveredProjectDirty, true); assert.equal(result.project.name, project.name);
  assert.equal(result.project.ui.fontSize, project.ui.fontSize); assert.equal(result.uiDraft?.ui.fontSize, 51);
  assert.equal(result.project.assets.at(-1)?.id, 'external'); assert.equal(result.uiDraft?.assets.at(-1)?.id, 'external');
});
test('invalid or foreign UI recovery never partially replaces a valid primary project', async t => {
  const { project, file } = await fixture(t);
  for (const uiDraft of [{ ...project, id: 'other' }, { ...project, ui: { ...project.ui, fontSize: 'large' } }]) {
    await fs.writeFile(file + '.autosave', JSON.stringify({ savedAt: Date.now(), project: { ...project, name: '不应采用' }, uiDraft }));
    const result = await loadProject(file); assert.equal(result.recovered, false); assert.equal(result.project.name, project.name); assert.equal(result.uiDraft, undefined);
  }
});
test('a newer UI draft is not silently discarded in favor of the older primary file', async t => {
  const { project, file } = await fixture(t), primary = await fs.readFile(file, 'utf8');
  const uiDraft = { ...project, blueprints: [{ id: 'future', nodes: [{ id: 'future_node', type: 'futureUiBinding' }] }] };
  const recovery = JSON.stringify({ savedAt: Date.now(), project, uiDraft, projectDirty: false });
  await fs.writeFile(file + '.autosave', recovery);
  await assert.rejects(loadProject(file), UnsupportedProjectFormatError);
  assert.equal(await fs.readFile(file, 'utf8'), primary);
  assert.equal(await fs.readFile(file + '.autosave', 'utf8'), recovery);
});
test('discard follows an in-flight write and leaves no resurrected recovery, while other projects remain', async t => {
  const { project, file, directory } = await fixture(t), data = path.join(directory, 'profile');
  const queue = new WriteQueue(); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const pending = queue.run(async () => { await gate; return autosaveProject(file, { ...project, name: '稍晚写入的旧副本' }); });
  const clear = queue.run(() => discardProjectRecovery(file, data));
  await autosaveAtLocation(null, createProject('另一草稿'), data);
  release(); await pending; await clear;
  await assert.rejects(fs.access(file + '.autosave'));
  assert.equal((await loadProject(file)).project.name, project.name);
  await fs.access(path.join(data, 'draft.vns.json.autosave'));
});
test('missing-folder recovery includes UI draft and cannot recreate the moved project folder', async t => {
  const { project, file, directory } = await fixture(t), missing = path.join(directory, 'moved', 'project.vns.json'), data = path.join(directory, 'profile');
  const uiDraft = structuredClone(project); uiDraft.ui.fontSize = 53;
  assert.equal((await autosaveAtLocation(missing, project, data, { projectDirty: false, uiDraft })).locationMissing, true);
  await assert.rejects(fs.access(path.dirname(missing)));
  const recovered = await recoverProjectAtLocation(missing, data); assert.equal(recovered.uiDraft?.ui.fontSize, 53);
  await discardProjectRecovery(missing, data); await assert.rejects(recoverProjectAtLocation(missing, data)); await fs.access(file);
});
