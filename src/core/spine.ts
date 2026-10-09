import type { Asset, SpinePlayback } from './model';

/** Same top-left layout contract for the WebGL editor and native player. */
export function spinePlacement(asset: Asset, settings: SpinePlayback, width: number, height: number) {
  const bounds = asset.spine?.bounds ?? { x: 0, y: 0, width: 1, height: 1 };
  const fit = settings.fit !== 'manual';
  const scale = fit ? Math.min(width / bounds.width, height / bounds.height) * 0.95 : settings.scale ?? 1;
  const sx = settings.flipX ? -scale : scale, sy = settings.flipY ? -scale : scale;
  return {
    x: fit ? width / 2 - (bounds.x + bounds.width / 2) * sx : (settings.originX ?? 0.5) * width,
    y: fit ? height / 2 + (bounds.y + bounds.height / 2) * sy : (settings.originY ?? 0.5) * height,
    scaleX: sx, scaleY: sy, rotation: settings.rotation ?? 0,
  };
}
