import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { AtlasAttachmentLoader, Skeleton, SkeletonJson, TextureAtlas, Vector2 } from '@esotericsoftware/spine-webgl';
import { assetSchema, type Asset } from '../core/model';
import { assetCategoryNames } from '../core/asset-library';
import { containedPath } from './project-store';

const maximumBytes = 64 * 1024 * 1024;
async function read(file: string) {
  if ((await fs.stat(file)).size > maximumBytes) throw new Error(`骨骼动画文件超过 64 MB：${path.basename(file)}`);
  return fs.readFile(file);
}
export async function findSpineAtlas(skeletonPath: string): Promise<string | undefined> {
  const folder = path.dirname(skeletonPath), base = path.basename(skeletonPath).replace(/\.(json|bytes)$/i, '');
  for (const name of [`${base}.atlas`, `${base}.atlas.bytes`]) {
    const file = path.join(folder, name);
    if (await fs.access(file).then(() => true, () => false)) return file;
  }
  const atlases = (await fs.readdir(folder)).filter(name => /\.atlas(?:\.bytes)?$/i.test(name));
  return atlases.length === 1 ? path.join(folder, atlases[0]) : undefined;
}
export async function readSpineAtlas(atlasPath: string) {
  const text = (await read(atlasPath)).toString('utf8').replace(/^\uFEFF/, '');
  const atlas = new TextureAtlas(text);
  if (!atlas.pages.length || atlas.pages.length > 64) throw new Error('图集需要包含 1 至 64 张图片。');
  for (const page of atlas.pages) {
    containedPath(path.dirname(atlasPath), page.name);
    if (!(page.width > 0 && page.height > 0)) throw new Error(`图集缺少图片尺寸：${page.name}`);
  }
  return { atlas, text };
}

/** Imports an editable Spine export as one portable asset. No frames are baked. */
export async function importSpineAsset(dir: string, skeletonPath: string, atlasPath?: string, textures: Record<string, string> = {}, options: { mode?: 'copy' | 'reference'; directory?: string } = {}): Promise<Asset> {
  atlasPath ??= await findSpineAtlas(skeletonPath);
  if (!atlasPath) throw new Error('请选择与骨骼数据配套的 .atlas 或 .atlas.bytes 文件。');
  const jsonText = (await read(skeletonPath)).toString('utf8').replace(/^\uFEFF/, '');
  let json;
  try { json = JSON.parse(jsonText); } catch { throw new Error('请选择 Spine JSON 骨骼数据；.bytes 仅支持其中保存的是 JSON 的文件。'); }
  const version = String(json?.skeleton?.spine ?? '');
  if (!/^4\.2\./.test(version)) throw new Error(`当前支持 Spine 4.2 JSON，所选文件版本为 ${version || '未知'}。`);
  const { atlas, text } = await readSpineAtlas(atlasPath);
  const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(json);
  const skeleton = new Skeleton(data), offset = new Vector2(), size = new Vector2();
  skeleton.updateWorldTransform(0); skeleton.getBounds(offset, size, []);
  const bounds = { x: Number(json.skeleton.x ?? offset.x), y: Number(json.skeleton.y ?? offset.y), width: Number(json.skeleton.width || size.x || 1), height: Number(json.skeleton.height || size.y || 1) };
  const hash = createHash('sha256').update(jsonText).update(text);
  const pages: { name: string; filename: string; source: string; bytes: Buffer; sourcePremultipliedAlpha: boolean; width: number; height: number }[] = [];
  for (const [index, page] of atlas.pages.entries()) {
    const texturePath = textures[page.name] ?? containedPath(path.dirname(atlasPath), page.name);
    let bytes: Buffer;
    try { bytes = await read(texturePath); } catch { throw new Error(`找不到图集图片“${page.name}”，请通过“导入骨骼动画”为它选择对应图片。`); }
    const extension = path.extname(texturePath).toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) throw new Error(`图集图片格式不支持：${extension}`);
    hash.update(bytes);
    if (page.pma) {
      if (extension !== '.png') throw new Error('预乘透明度图集请使用 PNG 图片。');
      const png = PNG.sync.read(bytes, { skipRescale: false });
      for (let i = 0; i < png.data.length; i += 4) {
        const alpha = png.data[i + 3];
        for (let c = 0; c < 3; c++) png.data[i + c] = alpha ? Math.min(255, Math.round(png.data[i + c] * 255 / alpha)) : 0;
      }
      bytes = PNG.sync.write(png);
    }
    pages.push({ name: page.name, filename: `page_${index}${extension}`, source: path.resolve(texturePath), bytes, sourcePremultipliedAlpha: page.pma, width: page.width, height: page.height });
  }
  const id = `spine_${hash.digest('hex').slice(0, 24)}`, folder = `${options.directory ?? 'assets'}/${assetCategoryNames.spine}/${id}`;
  const files: [string, string | Buffer][] = [[`${folder}/skeleton.json`, jsonText]];
  const names = new Map(pages.map(page => [page.name, page.filename]));
  const atlasLines = text.split(/\r?\n/);
  const normalizedAtlas = atlasLines.map((line, index) => {
    if (names.has(line.trim()) && (index === 0 || !atlasLines[index - 1].trim())) return names.get(line.trim())!;
    return line.replace(/^(\s*pma\s*:)\s*true\s*$/i, '$1false');
  }).join('\n');
  files.push([`${folder}/skeleton.atlas`, normalizedAtlas]);
  for (const page of pages) files.push([`${folder}/${page.filename}`, page.bytes]);
  const externalFiles = options.mode === 'reference' ? Object.fromEntries([[`${folder}/skeleton.json`, path.resolve(skeletonPath)], ...pages.filter(page => !page.sourcePremultipliedAlpha).map(page => [`${folder}/${page.filename}`, page.source])]) : undefined;
  const asset = assetSchema.parse({ id, name: path.basename(skeletonPath).replace(/\.(json|bytes)$/i, ''), kind: 'spine', category: 'spine', path: `${folder}/skeleton.json`, ...(externalFiles ? { externalFiles } : {}), width: bounds.width, height: bounds.height,
    spine: { version, atlasPath: `${folder}/skeleton.atlas`, bounds, animations: data.animations.map(animation => ({ name: animation.name, duration: animation.duration })), skins: data.skins.map(skin => skin.name),
      pages: pages.map(page => ({ name: page.filename, path: `${folder}/${page.filename}`, width: page.width, height: page.height, sourcePremultipliedAlpha: page.sourcePremultipliedAlpha })) } });
  for (const [relative, bytes] of files) {
    if (externalFiles?.[relative]) continue;
    const target = containedPath(dir, relative);
    await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, bytes);
  }
  return asset;
}
