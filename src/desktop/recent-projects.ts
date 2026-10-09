import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { RecentProject } from '../core/bridge';
import { atomicWrite, WriteQueue } from './project-store';
import { projectFileExists, projectRecoveryFile } from './project-location';

export class RecentProjects {
  private queue = new WriteQueue();
  constructor(private file: string) {}
  private async read(): Promise<{ path?: string | null; recentProjects: Omit<RecentProject, 'available'>[] }> {
    let raw: any;
    try { raw = JSON.parse(await fs.readFile(this.file, 'utf8')); } catch { raw = {}; }
    if (!raw || typeof raw !== 'object') raw = {};
    const recentProjects: Omit<RecentProject, 'available'>[] = [];
    const keys = new Set<string>();
    const append = (entry: any) => {
      if (typeof entry?.path !== 'string' || !path.isAbsolute(entry.path)) return;
      const file = path.normalize(entry.path), key = file.toLowerCase();
      if (keys.has(key)) return;
      keys.add(key);
      recentProjects.push({ path: file, name: typeof entry.name === 'string' && entry.name.trim() ? entry.name : path.basename(path.dirname(file)), lastOpenedAt: typeof entry.lastOpenedAt === 'number' && Number.isFinite(entry.lastOpenedAt) ? entry.lastOpenedAt : 0, ...(typeof entry.projectId === 'string' ? { projectId: entry.projectId } : {}) });
    };
    if (Array.isArray(raw.recentProjects)) for (const item of raw.recentProjects) append(item);
    if (raw.path) append({ path: raw.path });
    return { path: typeof raw.path === 'string' ? raw.path : null, recentProjects: recentProjects.slice(0, 20) };
  }
  async list(): Promise<RecentProject[]> {
    const { recentProjects } = await this.read();
    return Promise.all(recentProjects.map(async item => ({ ...item,
      available: await projectFileExists(item.path).catch(() => false),
      recoveryAvailable: await Promise.all([item.path + '.autosave', item.path + '.previous', projectRecoveryFile(path.dirname(this.file), item.path) + '.autosave'].map(file => projectFileExists(file).catch(() => false))).then(files => files.some(Boolean)),
    })));
  }
  async remember(file: string | null, name: string, projectId?: string, replacedPath?: string) {
    return this.queue.run(async () => {
      const data = await this.read();
      data.path = file;
      if (file) {
        const normalized = path.normalize(file), replacedKey = replacedPath && path.normalize(replacedPath).toLowerCase();
        const remaining = [];
        for (const item of data.recentProjects) {
          if (item.path.toLowerCase() === normalized.toLowerCase() || item.path.toLowerCase() === replacedKey) continue;
          remaining.push(item);
        }
        data.recentProjects = [{ path: normalized, name, projectId, lastOpenedAt: Date.now() }, ...remaining].slice(0, 20);
      }
      await atomicWrite(this.file, JSON.stringify(data, null, 2));
    });
  }
  async forget(file: string) {
    return this.queue.run(async () => {
      const data = await this.read(), key = path.normalize(file).toLowerCase();
      data.recentProjects = data.recentProjects.filter(item => item.path.toLowerCase() !== key);
      if (data.path && path.normalize(data.path).toLowerCase() === key) data.path = null;
      await atomicWrite(this.file, JSON.stringify(data, null, 2));
    });
  }
}
