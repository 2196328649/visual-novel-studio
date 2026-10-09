import { PNG } from 'pngjs';
import { promises as fs } from 'node:fs';
import type { Project } from '../core/model';
import { visibleImageBounds } from '../core/portrait';
import { assetSourcePath } from './project-store';

export function pngMetadata(bytes: Buffer) {
  const png = PNG.sync.read(bytes);
  return { width: png.width, height: png.height, visibleBounds: visibleImageBounds(png.data, png.width, png.height) };
}

/** Enrich the in-memory copy of older projects; opening never rewrites their files. */
export async function withPortraitMetadata(project: Project, directory: string): Promise<Project> {
  const portraits = new Set(project.characters.flatMap(c => c.expressions.map(e => e.assetId)));
  const assets = await Promise.all(project.assets.map(async asset => {
    if (!portraits.has(asset.id) || asset.visibleBounds || !/\.png$/i.test(asset.path)) return asset;
    try { return { ...asset, ...pngMetadata(await fs.readFile(assetSourcePath(directory, asset))) }; }
    catch { return asset; }
  }));
  return { ...project, assets };
}
