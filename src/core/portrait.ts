import { effectiveCharacter, type Asset, type Project } from './model';

export type VisibleBounds = { x: number; y: number; width: number; height: number };
export const defaultPortraitFraming = { x: 0.5, top: 0.16, visibleFraction: 0.64 };

/** Ignore transparent padding; pixel coordinates also work with native BGRA bitmaps. */
export function visibleImageBounds(data: ArrayLike<number>, width: number, height: number): VisibleBounds | undefined {
  if (width <= 0 || height <= 0 || data.length < width * height * 4) return;
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] < 8) continue;
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  return right < 0 ? undefined : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

export function portraitGeometry(asset: Asset | undefined, width: number, height: number) {
  const w = asset?.width && asset.width > 0 ? asset.width : width;
  const h = asset?.height && asset.height > 0 ? asset.height : height;
  const b = asset?.visibleBounds;
  return { width: w, height: h, bounds: b && b.x >= 0 && b.y >= 0 && b.width > 0 && b.height > 0 && b.x + b.width <= w && b.y + b.height <= h ? b : { x: 0, y: 0, width: w, height: h } };
}

/** Positions remain normal Ren'Py image-bottom anchors after this conversion. */
export function portraitPlacement(project: Project, characterId: string, expressionId: string, x = 0.5, y = 1, scale = 1) {
  const character = effectiveCharacter(project, characterId);
  const assetId = character?.expressions.find(e => e.id === expressionId)?.assetId;
  const image = portraitGeometry(project.assets.find(a => a.id === assetId), project.width, project.height);
  const framing = { ...defaultPortraitFraming, ...character?.portraitFraming };
  const zoom = project.height * (1 - framing.top) / framing.visibleFraction / image.bounds.height * scale;
  return {
    x: framing.x + x - 0.5 + (image.width / 2 - image.bounds.x - image.bounds.width / 2) * zoom / project.width,
    y: framing.top + y - 1 + (image.height - image.bounds.y) * zoom / project.height,
    scale: zoom,
  };
}
