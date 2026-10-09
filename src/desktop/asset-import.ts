import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AssetImportOptions, AssetImportReport } from '../core/bridge';
import { assetCategorySchema, type Asset, type Project } from '../core/model';
import { categoryAcceptsKind, ensureAssetFolder, folderCategory, inferAssetCategory, resourceDirectoryParts } from '../core/asset-library';
import { assetKindForFile, ensureResourceDirectories, importAsset } from './project-store';

const supported = /\.(png|jpe?g|webp|avif|ogg|opus|wav|mp3|flac|webm|mp4|ogv|ttf|otf|rpy)$/i;
const categoryRoots = /^(character|characters|portrait|portraits|立绘|配音|voice|voices|bgm|music|音乐|音效|sfx|场景|backgrounds?|ui素材|ui|字体|fonts?)$/i;

export function parseAssetImportOptions(input: unknown): AssetImportOptions {
  if (input === undefined) return {};
  if (!input || typeof input !== 'object') throw new Error('导入参数无效。');
  const value = input as AssetImportOptions;
  if (value.paths !== undefined && (!Array.isArray(value.paths) || value.paths.length > 4096 || value.paths.some(item => typeof item !== 'string' || !path.isAbsolute(item)))) throw new Error('请拖入本机文件或文件夹。');
  if (value.folderId !== undefined && typeof value.folderId !== 'string') throw new Error('目标文件夹无效。');
  if (value.mode !== undefined && value.mode !== 'files' && value.mode !== 'folder') throw new Error('导入方式无效。');
  if (value.category !== undefined) assetCategorySchema.parse(value.category);
  if (value.extensions !== undefined && (!Array.isArray(value.extensions) || !value.extensions.length || value.extensions.some(extension => typeof extension !== 'string' || !/^(png|jpe?g|webp|avif|ogg|opus|wav|mp3|flac|webm|mp4|ogv|ttf|otf|rpy)$/i.test(extension)))) throw new Error('素材格式筛选无效。');
  if (value.single !== undefined && typeof value.single !== 'boolean') throw new Error('素材选择方式无效。');
  return { mode: value.mode, paths: value.paths, folderId: value.folderId, category: value.category, extensions: value.extensions?.map(extension => extension.toLowerCase()), single: value.single };
}

/** Import stores either a project copy or an explicit link to the original file. */
export async function importAssetPaths(directory: string, project: Project, sources: string[], options: AssetImportOptions & { acceptFile?: (relative: string, kind: Asset['kind']) => boolean; check?: () => void } = {}, measureImage?: (file: string) => { width: number; height: number; visibleBounds?: Asset['visibleBounds'] }) {
  const next = structuredClone(project);
  if (options.folderId && !next.contentBrowser?.folders.some(folder => folder.id === options.folderId)) throw new Error('目标文件夹已不存在。');
  await ensureResourceDirectories(directory, next);
  const report: AssetImportReport = { imported: 0, duplicates: 0, skipped: 0, errors: [] };
  const files: { file: string; relative: string }[] = [], seen = new Set<string>();
  const scan = async (file: string, relative: string, depth = 0): Promise<void> => {
    options.check?.();
    const absolute = path.resolve(file), key = process.platform === 'win32' ? absolute.toLowerCase() : absolute;
    if (seen.has(key)) return;
    seen.add(key);
    try {
      const stat = await fs.lstat(absolute);
      if (stat.isSymbolicLink()) { report.skipped++; return; }
      if (stat.isDirectory()) {
        if (depth >= 24) { report.errors.push(`${relative}：文件夹层级超过 24 层`); return; }
        const children = await fs.readdir(absolute);
        for (const child of children.sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }))) await scan(path.join(absolute, child), `${relative}/${child}`, depth + 1);
      } else if (stat.isFile() && supported.test(file)) files.push({ file: absolute, relative });
      else report.skipped++;
    } catch (error) { report.errors.push(`${relative}：${error instanceof Error ? error.message : String(error)}`); }
  };
  for (const source of sources) await scan(source, path.basename(source));
  const ids = new Set(next.assets.map(asset => asset.id));
  const imported: Asset[] = [];
  const entries: { source: string; relative: string; assetId: string }[] = [];
  for (const { file, relative } of files) {
    if (options.single && entries.length) break;
    options.check?.();
    try {
      const kind = assetKindForFile(file);
      if (options.extensions && !options.extensions.includes(path.extname(file).slice(1).toLowerCase())) { report.skipped++; continue; }
      if (options.acceptFile && !options.acceptFile(relative, kind)) { report.skipped++; continue; }
      const preferred = folderCategory(next, options.folderId) ?? options.category;
      const category = preferred && categoryAcceptsKind(preferred, kind) ? preferred : inferAssetCategory({ kind, name: path.basename(file), sourcePath: relative });
      const parts = relative.replaceAll('\\', '/').split('/');
      if (parts.length > 1 && categoryRoots.test(parts[0])) parts.shift();
      const target = options.folderId && (!preferred || categoryAcceptsKind(preferred, kind)) ? options.folderId : undefined;
      const folder = ensureAssetFolder(next, category, parts.slice(0, -1), target);
      const asset = await importAsset(directory, file, { mode: next.resourceSettings?.importMode, directory: next.resourceSettings?.directory, category, subdirectory: resourceDirectoryParts(next, category, folder).join('/') });
      entries.push({ source: file, relative, assetId: asset.id });
      if (ids.has(asset.id)) { report.duplicates++; continue; }
      asset.category = category;
      asset.sourcePath = parts.join('/');
      if (asset.kind === 'image' && measureImage) {
        const dimensions = measureImage(file);
        if (dimensions.width && dimensions.height) Object.assign(asset, dimensions);
      }
      next.contentBrowser!.assignments[`asset:${asset.id}`] = folder;
      next.assets.push(asset); imported.push(asset); ids.add(asset.id); report.imported++;
    } catch (error) { report.errors.push(`${relative}：${error instanceof Error ? error.message : String(error)}`); }
  }
  report.assetIds = [...new Set(entries.map(entry => entry.assetId))];
  return { project: next, report, imported, entries };
}
