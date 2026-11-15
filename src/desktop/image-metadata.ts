import { promises as fs } from 'node:fs';
import type { Project } from '../core/model';
import { assetSourcePath } from './project-store';
import { imageMetadataConcurrency, pngMetadataAsync } from './image-metadata-worker-pool';
import type { PngMetadata } from './png-metadata';
export { pngMetadata } from './png-metadata';
export { pngMetadataAsync } from './image-metadata-worker-pool';

const metadataCache = new Map<string, { stamp: string; result: Promise<PngMetadata> }>();
async function readMetadata(file: string) {
  const info = await fs.stat(file), stamp = `${info.size}/${info.mtimeMs}/${info.ctimeMs}`;
  const previous = metadataCache.get(file);
  if (previous?.stamp === stamp) return previous.result;
  const result = fs.readFile(file).then(pngMetadataAsync);
  if (metadataCache.size >= 128) metadataCache.delete(metadataCache.keys().next().value!);
  metadataCache.set(file, { stamp, result });
  try { return await result; }
  catch (error) { if (metadataCache.get(file)?.result === result) metadataCache.delete(file); throw error; }
}

/** Enrich the in-memory copy of older projects; opening never rewrites their files. */
export async function withPortraitMetadata(project: Project, directory: string): Promise<Project> {
  const portraits = new Set(project.characters.flatMap(c => c.expressions.map(e => e.assetId)));
  const assets = [...project.assets];
  const missing = assets.flatMap((asset, index) => portraits.has(asset.id) && !asset.visibleBounds && /\.png$/i.test(asset.path) ? [index] : []);
  let next = 0, changed = false;
  await Promise.all(Array.from({ length: Math.min(imageMetadataConcurrency, missing.length) }, async () => {
    while (next < missing.length) {
      const index = missing[next++], asset = assets[index];
      try { assets[index] = { ...asset, ...await readMetadata(assetSourcePath(directory, asset)) }; changed = true; }
      catch { /* Unreadable legacy art remains available for normal diagnostics. */ }
    }
  }));
  return changed ? { ...project, assets } : project;
}
