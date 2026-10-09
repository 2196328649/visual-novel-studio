import { createHash } from 'node:crypto';
import path from 'node:path';
import { assetFiles, type Project } from '../core/model';
import { pythonLiteral } from './literals';

/** RAPT's APK reader cannot reliably resolve non-ASCII ZIP member names. */
export function androidAssets(project: Project) {
  const aliases: Record<string, string> = {};
  const files = [...new Set(project.assets.flatMap(assetFiles))].map(source => {
    const normalized = source.replaceAll('\\', '/');
    let destination = normalized;
    if (/[^\x20-\x7e]/.test(normalized)) {
      const extension = path.posix.extname(normalized).toLowerCase();
      if (!/^\.[a-z0-9]+$/.test(extension)) throw new Error(`Android 不支持此资源扩展名：${source}`);
      const digest = createHash('sha256').update(normalized).digest('hex');
      destination = `${normalized.startsWith('scripts/') ? 'scripts' : 'assets'}/vns_android_${digest}${extension}`;
      aliases[normalized] = destination;
    }
    return { source, destination };
  });
  const destinations = new Set<string>();
  for (const file of files) {
    if (destinations.has(file.destination)) throw new Error(`Android 资源路径冲突：${file.source}`);
    destinations.add(file.destination);
  }
  const mapped = (file: string) => aliases[file.replaceAll('\\', '/')] ?? file;
  const compiledProject: Project = { ...project, assets: project.assets.map(asset => ({ ...asset, path: mapped(asset.path),
    ...(asset.spine ? { spine: { ...asset.spine, atlasPath: mapped(asset.spine.atlasPath), pages: asset.spine.pages.map(page => ({ ...page, path: mapped(page.path) })) } } : {}),
  })) };
  // Saved displayables and imported scripts may still contain the original path.
  const runtime = Object.keys(aliases).length ? `init -999 python:
    vn_android_asset_aliases = ${pythonLiteral(aliases)}
    vn_android_previous_open = config.file_open_callback
    vn_android_previous_loadable = config.loadable_callback

    def vn_android_open_asset(name):
        mapped = vn_android_asset_aliases.get(name)
        if mapped is not None:
            return renpy.file(mapped)
        if vn_android_previous_open is not None:
            return vn_android_previous_open(name)
        return None

    def vn_android_asset_loadable(name):
        mapped = vn_android_asset_aliases.get(name)
        if mapped is not None:
            return renpy.loadable(mapped)
        return bool(vn_android_previous_loadable and vn_android_previous_loadable(name))

    config.file_open_callback = vn_android_open_asset
    config.loadable_callback = vn_android_asset_loadable
` : '';
  return { project: compiledProject, files, runtime, aliases };
}
