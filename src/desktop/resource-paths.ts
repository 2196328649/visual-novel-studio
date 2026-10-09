import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { containedPath } from './project-store';

export const resourcePathLedger = '.studio/resource-paths.json';
export interface ResourcePathLedger { version: 1; paths: Record<string, string>; assets?: Record<string, Record<string, string>> }
export function readResourcePaths(root: string): ResourcePathLedger {
  const file = containedPath(root, resourcePathLedger);
  if (!existsSync(file)) return { version: 1, paths: {} };
  const data = JSON.parse(readFileSync(file, 'utf8')) as ResourcePathLedger;
  if (data.version !== 1 || !data.paths || typeof data.paths !== 'object' || Array.isArray(data.paths)) throw new Error('素材路径恢复记录无效。');
  for (const [from, to] of Object.entries(data.paths)) { containedPath(root, from); if (typeof to !== 'string') throw new Error('素材路径恢复记录无效。'); containedPath(root, to); }
  if (data.assets) for (const aliases of Object.values(data.assets)) {
    if (!aliases || typeof aliases !== 'object' || Array.isArray(aliases)) throw new Error('素材路径恢复记录无效。');
    for (const [from, to] of Object.entries(aliases)) { containedPath(root, from); if (typeof to !== 'string') throw new Error('素材路径恢复记录无效。'); containedPath(root, to); }
  }
  return data;
}
const cache = new Map<string, { stamp: string; ledger: ResourcePathLedger }>();
function cachedLedger(root: string) {
  const file = containedPath(root, resourcePathLedger);
  const info = existsSync(file) ? statSync(file) : undefined, stamp = info ? `${info.mtimeMs}/${info.ctimeMs}/${info.size}` : '';
  let entry = cache.get(root);
  if (!entry || entry.stamp !== stamp) { entry = { stamp, ledger: readResourcePaths(root) }; if (cache.size >= 16) cache.delete(cache.keys().next().value!); cache.set(root, entry); }
  return entry.ledger;
}

/** Old undo snapshots and project backups remain usable after physical moves. */
export function resolveResourcePath(root: string, relative: string, assetId?: string): string {
  let file = containedPath(root, relative);
  if (!assetId && existsSync(file)) return file;
  const { paths, assets } = cachedLedger(root), aliases = assetId ? assets?.[assetId] ?? {} : {}, seen = new Set<string>();
  let key = relative.replaceAll('\\', '/').toLowerCase();
  while (!seen.has(key)) {
    seen.add(key);
    // A display name can later be reused by a different asset. Identity-specific
    // aliases must win over that new file when restoring an old snapshot.
    const next = aliases[key] ?? (!existsSync(file) ? paths[key] : undefined);
    if (!next) return file;
    file = containedPath(root, next); key = next.replaceAll('\\', '/').toLowerCase();
  }
  return containedPath(root, relative);
}

export function relativeResourcePath(root: string, file: string) { return path.relative(root, file).split(path.sep).join('/'); }
