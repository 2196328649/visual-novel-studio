import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { createProject, projectSchema, type UiComponent } from '../../src/core/model';

export async function createGalleryFixture(directory: string) {
  await fs.mkdir(path.join(directory, 'assets'), { recursive: true });
  const project = createProject();
  project.name = '图鉴分组验收'; project.width = 1920; project.height = 1080;
  const colors = { full_a: [180, 50, 50], full_b: [50, 180, 50], full_c: [50, 50, 180], thumb: [180, 160, 50] };
  project.assets = [];
  for (const [id, color] of Object.entries(colors)) {
    const image = new PNG({ width: 2160, height: 1080 });
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const offset = (y * image.width + x) * 4;
      image.data[offset] = x < 120 ? 255 : color[0]; image.data[offset + 1] = x > 2039 ? 255 : color[1]; image.data[offset + 2] = y < 80 || y > 999 ? 220 : color[2]; image.data[offset + 3] = 255;
    }
    await fs.writeFile(path.join(directory, 'assets', id + '.png'), PNG.sync.write(image));
    project.assets.push({ id, name: id, kind: 'image', category: 'scene', path: 'assets/' + id + '.png', width: image.width, height: image.height });
  }
  const gallery: UiComponent = { id: 'test_gallery', kind: 'galleryGrid', page: 'gallery', text: '', x: .03, y: .12, width: .94, height: .84, style: { fontSize: 24, textColor: '#ffffff' }, list: {
    columns: 4, rows: 2, showLabels: true, galleryPageButtonLimit: 12, galleryShowControls: false, galleryFit: 'cover', galleryEndAction: 'close',
    galleryGroups: Array.from({ length: 94 }, (_, i) => ({ id: 'group_' + i, name: `第 ${i + 1} 组`, thumbnailAssetId: 'thumb', assetIds: i === 0 ? ['full_c', 'full_a', 'full_b'] : i === 1 ? ['full_b'] : ['full_a'] })),
  } };
  project.ui.pages = { ...project.ui.pages, gallery: { layout: 'custom' } };
  project.ui.components = project.ui.components.filter(c => c.page !== 'gallery');
  project.ui.components.push(gallery);
  await fs.writeFile(path.join(directory, 'project.vns.json'), JSON.stringify(projectSchema.parse(project), null, 2));
  return project;
}
