import { effectiveCharacter, type Asset, type Project } from './model';

export { visibleImageBounds, type VisibleBounds } from './image-bounds';
export const defaultPortraitFraming = { x: 0.5, top: 0.16, visibleFraction: 0.64 };

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
