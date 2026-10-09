import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Project } from '../core/model';
import { autosaveProject, loadProject } from './project-store';

export const projectFileExists = (file: string) => fs.stat(file).then(stat => stat.isFile(), error => {
  if (['ENOENT', 'ENOTDIR'].includes(error.code)) return false;
  throw error;
});

/** Keep recovery separate from movable project folders, including multiple projects. */
export function projectRecoveryFile(userData: string, file: string): string {
  const key = createHash('sha256').update(path.resolve(file).toLowerCase()).digest('hex');
  return path.join(userData, 'project-recovery', key, 'project.vns.json');
}

export async function autosaveAtLocation(file: string | null, project: Project, userData: string): Promise<{ savedAt: number; locationMissing?: boolean }> {
  if (!file) return autosaveProject(path.join(userData, 'draft.vns.json'), project);
  if (await projectFileExists(file)) {
    try { return { ...await autosaveProject(file, project, false), locationMissing: false }; }
    catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      // The folder can disappear between stat and writing the recovery file.
    }
  }
  return { ...await autosaveProject(projectRecoveryFile(userData, file), project), locationMissing: true };
}

/** Explicitly discarding edits must also discard their crash-recovery copies. */
export async function discardProjectRecovery(file: string | null, userData: string): Promise<void> {
  const targets = file ? [file, projectRecoveryFile(userData, file)] : [path.join(userData, 'draft.vns.json')];
  for (const target of targets) await fs.rm(target + '.autosave', { force: true }).catch(error => {
    if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
  });
}

export async function recoverProjectAtLocation(file: string, userData: string) {
  const fallback = projectRecoveryFile(userData, file);
  const savedAt = async (target: string) => {
    try { const raw = JSON.parse(await fs.readFile(target + '.autosave', 'utf8')); return typeof raw.savedAt === 'number' ? raw.savedAt : 0; }
    catch { return 0; }
  };
  const candidates = await savedAt(fallback) > await savedAt(file) ? [fallback, file] : [file, fallback];
  for (const candidate of candidates) {
    try { return { ...await loadProject(candidate), path: file, locationMissing: !await projectFileExists(file), recovered: true }; }
    catch { /* Try the other recovery copy if one was incomplete. */ }
  }
  throw new Error('没有可用的恢复内容，请重新定位移动后的工程。');
}

export async function loadRelocatedProject(file: string, expectedId?: string) {
  if (!await projectFileExists(file)) throw new Error('请选择移动后的 project.vns.json 工程文件。');
  const next = await loadProject(file);
  if (expectedId && next.project.id !== expectedId) throw new Error('选择的文件属于另一个工程，请选择原工程移动后的文件。');
  return next;
}
