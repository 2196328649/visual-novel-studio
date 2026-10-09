import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { assetFiles, type Project } from '../src/core/model';
import { assetSourcePath, loadProject, saveProject } from '../src/desktop/project-store';

const projectFile = path.resolve(process.argv[2] ?? '');
if (!process.argv[2] || path.basename(projectFile) !== 'project.vns.json') throw new Error('Pass an explicit project.vns.json path after closing its editor.');
const root = path.dirname(projectFile), stamp = new Date().toISOString().replaceAll(':', '-');
const backup = process.argv[3] ? path.resolve(process.argv[3]) : path.join(path.dirname(root), path.basename(root) + '-目录整理备份-' + stamp);
assert.equal(path.dirname(backup), path.dirname(root)); assert.notEqual(backup, root);
assert.ok(path.basename(backup).startsWith(path.basename(root) + '-目录整理备份-'));
async function hash(file: string) { const value = createHash('sha256'); for await (const bytes of createReadStream(file)) value.update(bytes); return value.digest('hex'); }
const fingerprints = async () => Object.fromEntries(await Promise.all(['', '.autosave', '.previous', '.before-migration'].map(async suffix => [suffix, await hash(projectFile + suffix).catch(error => { if (error.code === 'ENOENT') return null; throw error; })])));
const initial = await fingerprints();
const before = (await loadProject(projectFile)).project;
const paths = before.assets.flatMap(asset => assetFiles(asset).map((relative, index) => ({ id: `${asset.id}/${index}`, file: assetSourcePath(root, asset, relative) })));
const hashes = new Map<string, string>();
for (const item of paths) hashes.set(item.id, await hash(item.file));
console.log(JSON.stringify({ phase: 'copy', assets: before.assets.length, files: paths.length, backup }));
if (!process.argv[3]) await fs.cp(root, backup, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true, filter: async source => {
  if ((await fs.lstat(source)).isSymbolicLink()) throw new Error('备份遇到目录链接，停止整理：' + source);
  return true;
} });
const verify = async (directory: string, project: Project) => {
  for (const asset of project.assets) for (const [index, relative] of assetFiles(asset).entries()) assert.equal(await hash(assetSourcePath(directory, asset, relative)), hashes.get(`${asset.id}/${index}`), asset.id);
  const { assets: oldAssets, ...oldContent } = before, { assets: newAssets, ...newContent } = project;
  assert.deepEqual(newContent, oldContent);
  assert.deepEqual(newAssets.map(({ path, spine, ...asset }) => asset), oldAssets.map(({ path, spine, ...asset }) => asset));
};
const copied = await saveProject(path.join(backup, 'project.vns.json'), structuredClone(before));
await verify(backup, copied.project);
assert.deepEqual(copied.resourceReport?.skipped ?? [], []); assert.deepEqual(copied.resourceReport?.retained ?? [], []);
console.log(JSON.stringify({ phase: 'copy-verified', report: copied.resourceReport }));
// Never overwrite work saved while the copy was being verified.
assert.deepEqual(await fingerprints(), initial, '工程在校验期间发生变化，原工程未整理。');
const saved = await saveProject(projectFile, before);
await verify(root, saved.project);
assert.deepEqual(saved.resourceReport?.skipped ?? [], []); assert.deepEqual(saved.resourceReport?.retained ?? [], []);
const restored = await loadProject(projectFile);
await verify(root, restored.project);
const rootFiles = (await fs.readdir(path.join(root, 'assets'), { withFileTypes: true })).filter(entry => entry.isFile()).map(entry => entry.name);
const report = { status: 'passed', projectFile, backup, assets: before.assets.length, files: paths.length, report: saved.resourceReport, remainingRootFiles: rootFiles };
await fs.writeFile(path.join(backup, '目录整理验证.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
