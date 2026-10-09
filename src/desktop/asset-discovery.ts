import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Asset, Project } from '../core/model';
import { assetFiles } from '../core/model';
import { assetCategoryNames, ensureAssetFolder, inferAssetCategory } from '../core/asset-library';
import { assetSourcePath, containedPath, importAsset } from './project-store';

const media = /\.(png|jpe?g|webp|avif|ogg|opus|wav|mp3|flac|webm|mp4|ogv|ttf|otf)$/i;
const key = (file: string) => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
type Measure = (file: string) => { width: number; height: number; visibleBounds?: Asset['visibleBounds'] };

/** Discover local media without moving files or executing newly found scripts. */
export class AssetDiscovery {
  private seen = new Map<string, string>();
  private running = false;
  async scan(directory: string, project: Project, measure?: Measure): Promise<Project | undefined> {
    if (this.running) return;
    this.running = true;
    try {
      const resourceRoot = containedPath(directory, project.resourceSettings?.directory ?? 'assets');
      const known = new Set(project.assets.flatMap(asset => assetFiles(asset).map(file => key(assetSourcePath(directory, asset, file)))));
      const files = new Map<string, { file: string; signature: string }>();
      const walk = async (folder: string, recursive: boolean, depth = 0): Promise<void> => {
        if (depth > 24) return;
        let entries;
        try { entries = await fs.readdir(folder, { withFileTypes: true }); }
        catch (error) { if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return; throw error; }
        for (const entry of entries) {
          if (entry.name.startsWith('.') || ['cache', 'saves', '__pycache__'].includes(entry.name)) continue;
          const file = path.join(folder, entry.name);
          if (entry.isSymbolicLink()) continue;
          if (entry.isDirectory() && recursive) await walk(file, true, depth + 1);
          else if (entry.isFile() && media.test(entry.name)) {
            const id = key(file);
            if (known.has(id)) continue;
            try { const stat = await fs.stat(file); const signature = `${stat.size}:${stat.mtimeMs}`; if (this.seen.get(id) !== signature) files.set(id, { file, signature }); }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
          }
        }
      };
      await walk(resourceRoot, true);
      await walk(directory, false);
      await walk(path.join(directory, 'game'), false);
      for (const name of ['images', 'audio', 'fonts']) await walk(path.join(directory, 'game', name), true);
      if (!files.size) return;
      const next = structuredClone(project), ids = new Set(project.assets.map(asset => asset.id));
      let added = 0;
      for (const [id, { file, signature }] of files) {
        try {
          const asset = await importAsset(directory, file, { mode: 'reference' });
          if (ids.has(asset.id)) { this.seen.set(id, signature); continue; }
          // This file is already inside the project, regardless of external import mode.
          delete asset.externalPath;
          asset.path = path.relative(directory, file).replaceAll('\\', '/');
          asset.sourcePath = asset.path;
          asset.category = inferAssetCategory(asset);
          if (asset.kind === 'image' && measure) {
            const size = measure(file);
            if (!(size.width > 0 && size.height > 0)) throw new Error('图片尚未复制完成');
            Object.assign(asset, size);
          }
          // Recheck after reading: a file still being copied must be retried.
          const stat = await fs.stat(file);
          if (`${stat.size}:${stat.mtimeMs}` !== signature) continue;
          this.seen.set(id, signature);
          const relative = path.relative(resourceRoot, file);
          let parts = (!relative.startsWith('..') && !path.isAbsolute(relative) ? relative : asset.path).replaceAll('\\', '/').split('/').slice(0, -1);
          if (Object.values(assetCategoryNames).includes(parts[0])) parts = parts.slice(1);
          const folder = ensureAssetFolder(next, asset.category, parts);
          next.contentBrowser!.assignments['asset:' + asset.id] = folder;
          next.assets.push(asset); ids.add(asset.id); added++;
        } catch (error) {
          // Copying a large file can briefly leave an incomplete image. Retry next scan.
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.seen.delete(id);
        }
      }
      return added ? next : undefined;
    } finally { this.running = false; }
  }
}
