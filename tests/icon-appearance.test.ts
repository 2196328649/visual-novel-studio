import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PNG } from 'pngjs';
import { createProject } from '../src/core/model';
import { exportSettings } from '../src/core/export-settings';
import { fitIcon, writeExportIcons } from '../src/runtime/export-icons';

const rgba = (png: PNG, x: number, y: number) => [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4)];
const source = () => { const image = new PNG({ width: 8, height: 8 }); for (let p = 0; p < image.data.length; p += 4) image.data.set([255, 0, 0, 128], p); return image; };
test('icon scaling and signed offsets clip correctly and composite translucent pixels over solid backgrounds', () => {
  const image = source(), small = fitIcon(image, 16, 0, { scale: .5, x: .25, y: -.25 });
  assert.deepEqual(rgba(small, 8, 0), [255, 0, 0, 128]); assert.equal(rgba(small, 7, 0)[3], 0); assert.equal(rgba(small, 8, 8)[3], 0);
  const zoom = fitIcon(image, 16, 0, { scale: 2, x: -.75, y: .75, background: '#0000ff' });
  assert.deepEqual(rgba(zoom, 0, 4), [128, 0, 127, 255]); assert.deepEqual(rgba(zoom, 12, 4), [0, 0, 255, 255]);
  assert.deepEqual(rgba(zoom, 0, 3), [0, 0, 255, 255]);
});
test('exported ICO/window icon and adaptive Android layers independently use platform scale, position and background', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vns-icon-appearance-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = createProject(); project.exportSettings = exportSettings(project);
  project.exportSettings.iconAssetId = 'icon'; project.assets = [{ id: 'icon', name: 'icon', kind: 'image', path: 'icon.png' }];
  await fs.mkdir(path.join(root, 'game')); await fs.writeFile(path.join(root, 'game/icon.png'), PNG.sync.write(source()));
  Object.assign(project.exportSettings.windows, { iconScale: .5, iconX: .25, iconY: -.25, iconBackgroundMode: 'solid', iconBackground: '#0000ff' });
  Object.assign(project.exportSettings.android, { iconScale: 2, iconX: -.5, iconY: .25, iconBackgroundMode: 'transparent' });
  await writeExportIcons(project, root);
  const ico = await fs.readFile(path.join(root, 'icon.ico'));
  for (let i = 0; i < 4; i++) {
    const at = 6 + i * 16, offset = ico.readUInt32LE(at + 12), length = ico.readUInt32LE(at + 8), image = PNG.sync.read(ico.subarray(offset, offset + length));
    assert.deepEqual(rgba(image, 0, 0), [0, 0, 255, 255]); assert.deepEqual(rgba(image, image.width - 1, 0), [128, 0, 127, 255]);
  }
  const win = PNG.sync.read(await fs.readFile(path.join(root, 'game/gui/studio-window-icon.png')));
  assert.deepEqual(rgba(win, 255, 0), [128, 0, 127, 255]);
  const android = PNG.sync.read(await fs.readFile(path.join(root, 'android-icon_foreground.png')));
  assert.equal(rgba(android, 0, 110)[3], 128); assert.equal(rgba(android, 300, 110)[3], 0);
  const bg = PNG.sync.read(await fs.readFile(path.join(root, 'android-icon_background.png'))); assert.equal(rgba(bg, 10, 10)[3], 0);
  project.exportSettings.windows.iconBackgroundMode = 'transparent';
  project.exportSettings.android.iconBackgroundMode = 'solid'; project.exportSettings.android.iconBackground = '#123456';
  await writeExportIcons(project, root);
  assert.equal(rgba(PNG.sync.read(await fs.readFile(path.join(root, 'game/gui/studio-window-icon.png'))), 0, 0)[3], 0);
  assert.deepEqual(rgba(PNG.sync.read(await fs.readFile(path.join(root, 'android-icon_background.png'))), 0, 0), [18, 52, 86, 255]);
});
