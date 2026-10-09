import { createReadStream, promises as fs } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { assetFiles, type Project } from '../core/model';
import { assetCategories, resourceDirectoryParts } from '../core/asset-library';
import { relocateProjectAssets, type AssetRelocation } from '../core/asset-relocation';
import { atomicWrite, containedPath } from './project-store';
import { readResourcePaths, relativeResourcePath, resolveResourcePath, resourcePathLedger } from './resource-paths';

const key = (file: string) => file.replaceAll('\\', '/').toLowerCase();
export function resourceFileName(name: string, original: string): string {
  const extension = path.posix.extname(original.replaceAll('\\', '/'));
  const stem = extension && name.toLowerCase().endsWith(extension.toLowerCase()) ? name.slice(0, -extension.length) : name;
  return safeResourceName(stem) + extension;
}
function safeResourceName(name: string): string {
  const clean = Array.from(name.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')).slice(0, 120).join('').replace(/[. ]+$/, '') || '_';
  return /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(clean) ? '_' + clean : clean;
}
async function digest(file: string) { const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex'); }
const stat = (file: string) => fs.stat(file).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });

/** Copies and verifies first; old paths are removed only after a durable project save. */
export async function prepareResourceLayout(root: string, project: Project) {
  const categories = assetCategories(project), relocations: AssetRelocation[] = [], skipped: string[] = [];
  const plans: { assetId: string; source: string; destination: string; from: string; to: string; hash: string }[] = [];
  const caseRenames: { source: string; destination: string }[] = [];
  const destinations = new Map<string, string>(), hashes = new Map<string, Promise<string>>();
  const hash = (file: string) => { let result = hashes.get(key(file)); if (!result) { result = digest(file); hashes.set(key(file), result); } return result; };
  const realRoot = await fs.realpath(root);
  const checkReal = async (file: string) => {
    let existing = file;
    while (!await stat(existing)) { const parent = path.dirname(existing); if (parent === existing) throw new Error('素材目录无效。'); existing = parent; }
    const real = await fs.realpath(existing);
    if (key(real) !== key(realRoot) && !key(real).startsWith(key(realRoot + path.sep))) throw new Error('素材路径经过项目外的链接：' + file);
  };
  for (const asset of project.assets) {
    const folder = project.contentBrowser?.assignments['asset:' + asset.id];
    if (asset.externalPath || Object.keys(asset.externalFiles ?? {}).length) continue;
    const base = [asset.kind === 'script' ? 'scripts' : project.resourceSettings?.directory ?? 'assets', ...resourceDirectoryParts(project, categories.get(asset.id) ?? 'other', folder), ...(asset.spine ? [safeResourceName(asset.name) + '_' + safeResourceName(asset.id)] : [])].join('/');
    const originals = assetFiles(asset), files: Record<string, string> = {};
    // A grouped asset is all-or-nothing; moving only its atlas would break it.
    const sources = originals.map(from => resolveResourcePath(root, from, asset.id));
    if ((await Promise.all(sources.map(stat))).some(item => !item?.isFile())) { skipped.push(asset.name); continue; }
    for (const [index, from] of originals.entries()) {
      const source = sources[index]; await checkReal(source);
      const tail = asset.spine ? path.posix.relative(path.posix.dirname(asset.path.replaceAll('\\', '/')), from.replaceAll('\\', '/')) : resourceFileName(asset.name, from);
      let to = `${base}/${tail}`, destination = containedPath(root, to);
      if (key(source) === key(destination) && path.basename(await fs.realpath(source)) !== path.basename(destination)) caseRenames.push({ source, destination });
      if (key(source) !== key(destination)) {
        const value = await hash(source);
        const conflicting = async () => {
          const planned = destinations.get(key(destination));
          if (planned && planned !== value) return true;
          await checkReal(destination);
          const existing = await stat(destination);
          return !!existing && (!existing.isFile() || await hash(destination) !== value);
        };
        if (await conflicting()) {
          if (asset.spine) throw new Error('骨骼素材目标目录存在不同内容：' + to);
          const extension = path.posix.extname(to), stem = to.slice(0, to.length - extension.length);
          let number = 0;
          do { to = `${stem}_${safeResourceName(asset.id)}${number ? '_' + number : ''}${extension}`; destination = containedPath(root, to); number++; } while (await conflicting());
        }
        destinations.set(key(destination), value);
        if (key(source) !== key(destination)) plans.push({ assetId: asset.id, source, destination, from, to, hash: value });
      }
      if (from !== to) files[from] = to;
    }
    if (Object.keys(files).length) relocations.push({ assetId: asset.id, files });
  }
  const next = relocateProjectAssets(project, relocations);
  // Preflight above must finish before any asset is written.
  for (const plan of plans) {
    await fs.mkdir(path.dirname(plan.destination), { recursive: true }); await checkReal(plan.destination);
    try { await fs.copyFile(plan.source, plan.destination, fs.constants.COPYFILE_EXCL); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    if (await digest(plan.destination) !== plan.hash) throw new Error('素材复制校验失败：' + plan.to);
  }
  if (plans.length) {
    const ledger = readResourcePaths(root);
    ledger.assets ??= {};
    for (const plan of plans) {
      const aliases = ledger.assets[plan.assetId] ??= {};
      aliases[key(plan.from)] = plan.to;
      aliases[key(relativeResourcePath(root, plan.source))] = plan.to;
    }
    for (const plan of plans) delete ledger.assets[plan.assetId][key(plan.to)];
    for (const plan of plans) {
      ledger.paths[key(plan.from)] = plan.to;
      ledger.paths[key(relativeResourcePath(root, plan.source))] = plan.to;
    }
    // Actual destinations supersede old aliases when undo moves a file back.
    for (const plan of plans) delete ledger.paths[key(plan.to)];
    const record = `.studio/resource-layout/${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}.json`;
    await checkReal(containedPath(root, record)); await checkReal(containedPath(root, resourcePathLedger));
    await atomicWrite(containedPath(root, record), JSON.stringify({ projectId: project.id, relocations }, null, 2));
    await atomicWrite(containedPath(root, resourcePathLedger), JSON.stringify(ledger, null, 2));
  }
  return { project: next, relocations, skipped, finish: async () => {
    const retained: string[] = [], live = new Set(next.assets.flatMap(asset => [...assetFiles(asset).map(file => containedPath(root, file)), ...Object.values(asset.externalFiles ?? {}), ...(asset.externalPath ? [asset.externalPath] : [])]).map(key));
    for (const { source, destination } of caseRenames) {
      try { await checkReal(source); await checkReal(destination); await fs.rename(source, destination); }
      catch { retained.push(relativeResourcePath(root, source)); }
    }
    for (const source of new Set(plans.map(plan => plan.source))) {
      if (live.has(key(source))) continue;
      try {
        await checkReal(source);
        // If another program edited it during save, preserve that new content.
        if (await digest(source) !== plans.find(plan => plan.source === source)!.hash) { retained.push(relativeResourcePath(root, source)); continue; }
        await fs.unlink(source);
        const assetRoot = containedPath(root, project.resourceSettings?.directory ?? 'assets');
        let parent = path.dirname(source);
        while (key(parent).startsWith(key(assetRoot + path.sep))) {
          await checkReal(parent);
          try { await fs.rmdir(parent); } catch { break; }
          parent = path.dirname(parent);
        }
      } catch { retained.push(relativeResourcePath(root, source)); }
    }
    return retained;
  } };
}
