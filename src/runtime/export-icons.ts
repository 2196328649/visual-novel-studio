import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import type { Project } from '../core/model';
import { exportSettings } from '../core/export-settings';
import { containedPath } from '../desktop/project-store';
import { androidIconLayout } from '../core/icon-layout';

export interface IconRenderOptions { scale?: number; x?: number; y?: number; background?: string; offsetExtent?: number }

/** Fit, position and composite an icon while preserving its proportions. */
export function fitIcon(source: PNG, size: number, inset = 0, options: IconRenderOptions = {}): PNG {
  const result = new PNG({ width: size, height: size });
  result.data.fill(0);
  const background = options.background ? [1, 3, 5].map(at => parseInt(options.background!.slice(at, at + 2), 16)) : undefined;
  if (background) for (let at = 0; at < result.data.length; at += 4) { result.data.set(background, at); result.data[at + 3] = 255; }
  const factor = (size - inset * 2) / Math.max(source.width, source.height) * (options.scale ?? 1);
  const width = Math.max(1, Math.round(source.width * factor)), height = Math.max(1, Math.round(source.height * factor));
  const extent = options.offsetExtent ?? size;
  const left = Math.floor((size - width) / 2) + Math.round((options.x ?? 0) * extent), top = Math.floor((size - height) / 2) + Math.round((options.y ?? 0) * extent);
  for (let y = Math.max(0, -top); y < Math.min(height, size - top); y++) for (let x = Math.max(0, -left); x < Math.min(width, size - left); x++) {
    const sx = Math.max(0, Math.min(source.width - 1, (x + .5) / width * source.width - .5));
    const sy = Math.max(0, Math.min(source.height - 1, (y + .5) / height * source.height - .5));
    const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(source.width - 1, x0 + 1), y1 = Math.min(source.height - 1, y0 + 1);
    const samples = [[x0, y0, (1 - (sx - x0)) * (1 - (sy - y0))], [x1, y0, (sx - x0) * (1 - (sy - y0))], [x0, y1, (1 - (sx - x0)) * (sy - y0)], [x1, y1, (sx - x0) * (sy - y0)]];
    const pixel = ((y + top) * size + x + left) * 4;
    let alpha = 0;
    const rgb = [0, 0, 0];
    for (const [xx, yy, weight] of samples) {
      const at = (yy * source.width + xx) * 4, a = source.data[at + 3] / 255 * weight;
      alpha += a;
      for (let channel = 0; channel < 3; channel++) rgb[channel] += source.data[at + channel] * a;
    }
    for (let channel = 0; channel < 3; channel++) result.data[pixel + channel] = background ? Math.round(rgb[channel] + background[channel] * (1 - alpha)) : alpha ? Math.round(rgb[channel] / alpha) : 0;
    result.data[pixel + 3] = background ? 255 : Math.round(alpha * 255);
  }
  return result;
}

/** ICO supports PNG entries on every Windows version supported by Ren'Py. */
export function windowsIcon(source: PNG, options: IconRenderOptions = {}): Buffer {
  const sizes = [16, 32, 48, 256], images = sizes.map(size => PNG.sync.write(fitIcon(source, size, 0, options)));
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, index) => {
    const at = 6 + index * 16;
    header[at] = header[at + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(images[index].length, at + 8); header.writeUInt32LE(offset, at + 12);
    offset += images[index].length;
  });
  return Buffer.concat([header, ...images]);
}

export async function writeExportIcons(project: Project, buildDir: string): Promise<void> {
  const settings = exportSettings(project);
  if (!settings.iconAssetId) {
    for (const file of ['game/gui/studio-window-icon.png', 'icon.ico', 'android-icon_foreground.png', 'android-icon_background.png']) await fs.rm(containedPath(buildDir, file), { force: true });
    return;
  }
  const asset = project.assets.find(asset => asset.id === settings.iconAssetId && asset.kind === 'image');
  if (!asset || !/\.png$/i.test(asset.path)) throw new Error('游戏图标需要 PNG 图片，请在作品设置中重新选择。');
  const source = PNG.sync.read(await fs.readFile(containedPath(path.join(buildDir, 'game'), asset.path)));
  await fs.mkdir(path.join(buildDir, 'game/gui'), { recursive: true });
  const win = settings.windows;
  const options = { scale: win.iconScale, x: win.iconX, y: win.iconY, background: win.iconBackgroundMode === 'solid' ? win.iconBackground : undefined };
  await fs.writeFile(path.join(buildDir, 'game/gui/studio-window-icon.png'), PNG.sync.write(fitIcon(source, 256, 0, options)));
  await fs.writeFile(path.join(buildDir, 'icon.ico'), windowsIcon(source, options));
  const android = androidIconLayout(settings.android.iconScale);
  await fs.writeFile(path.join(buildDir, 'android-icon_foreground.png'), PNG.sync.write(fitIcon(source, android.canvas, android.inset, { x: settings.android.iconX, y: settings.android.iconY, offsetExtent: android.mask })));
  const background = new PNG({ width: 432, height: 432 });
  const color = [1, 3, 5].map(index => parseInt(settings.android.iconBackground.slice(index, index + 2), 16));
  for (let at = 0; at < background.data.length; at += 4) {
    color.forEach((value, index) => { background.data[at + index] = value; }); background.data[at + 3] = settings.android.iconBackgroundMode === 'solid' ? 255 : 0;
  }
  await fs.writeFile(path.join(buildDir, 'android-icon_background.png'), PNG.sync.write(background));
}
