import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { createProject, effectiveUiComponents, projectSchema } from '../../src/core/model';
import { assetSourcePath } from '../../src/desktop/project-store';

export const typographyWords = '春江花月夜 Aa';
export const typographyColor = '#55ff55';
export const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

/** Only copy font files. The source project is read without loading/migrating it. */
export async function typographyFixture(source: string, directory: string) {
  const bytes = await fs.readFile(source), original = projectSchema.parse(JSON.parse(bytes.toString('utf8')));
  const project = createProject('文字对齐与字体验收');
  project.ui.fontSize = 42;
  project.ui.textColor = typographyColor;
  project.ui.accent = '#888888';
  project.ui.background = '#111111';
  project.ui.pages = { say: { showQuickMenu: false } };
  project.playerDefaults = { textSpeed: 0, masterVolume: 0 };
  for (const asset of original.assets.filter(asset => asset.kind === 'font')) {
    const relative = `assets/字体/${asset.id}${path.extname(asset.path)}`;
    await fs.mkdir(path.dirname(path.join(directory, relative)), { recursive: true });
    await fs.copyFile(assetSourcePath(path.dirname(source), asset), path.join(directory, relative));
    project.assets.push({ id: asset.id, name: asset.name, kind: 'font', category: 'font', path: relative });
  }
  const regular = project.assets.find(asset => /Regular/i.test(asset.name)) ?? project.assets[0];
  const dialogueFont = effectiveUiComponents(original.ui).find(component => component.page === 'say' && component.binding === 'dialogue')?.style?.fontAssetId;
  const font = project.assets.find(asset => asset.id === dialogueFont) ?? regular;
  project.ui.components = [{ id: 'typography_dialogue', page: 'say', kind: 'text', binding: 'dialogue', text: '', x: .1, y: .7, width: .8, height: .24, style: { fontAssetId: font?.id, fontSize: 42, align: 'right', textColor: typographyColor } }];
  project.nodes.find(node => node.kind === 'passage')!.lines = [{ id: 'typography', text: typographyWords, actions: [], textPresentation: { speed: 'instant' } }];
  return { project, originalHash: sha256(bytes), regular, source };
}

/** Ink pixels from our green fixture text, excluding panel backgrounds and UI chrome. */
export function textInk(image: PNG) {
  const rows: { y: number; minX: number; maxX: number; pixels: number }[] = [];
  let minX = image.width, maxX = -1, minY = image.height, maxY = -1, pixels = 0;
  for (let y = 0; y < image.height; y++) {
    let left = image.width, right = -1, count = 0;
    for (let x = 0; x < image.width; x++) {
      const i = (y * image.width + x) * 4, r = image.data[i], g = image.data[i + 1], b = image.data[i + 2];
      if (g > 125 && g - r > 50 && g - b > 50 && image.data[i + 3] > 128) { left = Math.min(left, x); right = x; count++; }
    }
    if (count) {
      rows.push({ y, minX: left, maxX: right, pixels: count });
      minX = Math.min(minX, left); maxX = Math.max(maxX, right); minY = Math.min(minY, y); maxY = y; pixels += count;
    }
  }
  const bands: { minY: number; maxY: number; minX: number; maxX: number; pixels: number }[] = [];
  for (const row of rows) {
    const last = bands.at(-1);
    if (last && row.y - last.maxY <= 3) { last.maxY = row.y; last.minX = Math.min(last.minX, row.minX); last.maxX = Math.max(last.maxX, row.maxX); last.pixels += row.pixels; }
    else bands.push({ minY: row.y, maxY: row.y, minX: row.minX, maxX: row.maxX, pixels: row.pixels });
  }
  return { width: image.width, height: image.height, pixels, minX, maxX, minY, maxY, bands, hash: sha256(image.data) };
}

export function glyphDifference(before: PNG, after: PNG) {
  const width = Math.max(before.width, after.width), height = Math.max(before.height, after.height);
  let changed = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const a = x < before.width && y < before.height ? (y * before.width + x) * 4 : -1;
    const b = x < after.width && y < after.height ? (y * after.width + x) * 4 : -1;
    if ([0, 1, 2].some(channel => Math.abs((a >= 0 ? before.data[a + channel] : 0) - (b >= 0 ? after.data[b + channel] : 0)) > 24)) changed++;
  }
  return { changedPixels: changed, before: textInk(before), after: textInk(after) };
}

export function assertGlyphChange(before: PNG, after: PNG, kind: 'bold' | 'italic', context: string) {
  const evidence = glyphDifference(before, after);
  assert.ok(evidence.before.pixels > 40 && evidence.after.pixels > 40, context + ': no readable fixture text');
  assert.ok(evidence.changedPixels > 15, context + ': glyphs did not visibly change: ' + JSON.stringify(evidence));
  if (kind === 'bold') assert.ok(evidence.after.pixels > evidence.before.pixels * 1.025, context + ': bold strokes did not thicken: ' + JSON.stringify(evidence));
  return evidence;
}

export async function preserveRenpyScreenshots(game: string, destination: string) {
  for (const relative of ['tests/screenshots', 'game/tests/screenshots']) {
    const directory = path.join(game, relative);
    if (await fs.stat(directory).then(stat => stat.isDirectory()).catch(() => false)) await fs.cp(directory, destination, { recursive: true });
  }
}

export async function findScreenshot(directory: string, name: string): Promise<string | undefined> {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { const found = await findScreenshot(file, name); if (found) return found; }
    else if (entry.name === name) return file;
  }
}
