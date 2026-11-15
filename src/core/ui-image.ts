import type { UiButtonState, UiComponent, UiImageEffects, UiSkin } from './model';

export const uiImageEvents = { loaded: '图片加载成功时', failed: '图片加载失败时' } as const;
export type UiImageEvent = keyof typeof uiImageEvents;
export const uiImageStatuses = { empty: '未设置图片', loading: '等待加载', loaded: '加载成功', failed: '加载失败' } as const;
export type UiImageStatus = keyof typeof uiImageStatuses;
export const uiImageCropFields = { imageCropX: 'cropX', imageCropY: 'cropY', imageCropWidth: 'cropWidth', imageCropHeight: 'cropHeight' } as const;

/** A source request is independent of size, tint, crop and visibility. Only a
 * changed source binding, displayed state asset or page instance starts a load lifetime. */
export interface UiImageRequest {
  version: 1; pageInstance: number; sequence: number; assetId: string; baseId: string;
  status: UiImageStatus; error: string; width: number; height: number;
}
export interface UiImageReport {
  pageInstance: number; sequence: number; assetId: string;
  status: UiImageEvent; error?: string; width?: number; height?: number;
}
export function uiImageRequest(previous: UiImageRequest | undefined, assetId: string, pageInstance: number, baseId = assetId): UiImageRequest {
  if (previous?.pageInstance === pageInstance && previous.assetId === assetId && previous.baseId === baseId) return previous;
  return { version: 1, pageInstance, sequence: previous?.pageInstance === pageInstance ? previous.sequence + 1 : 1,
    assetId, baseId, status: assetId ? 'loading' : 'empty', error: '', width: 0, height: 0 };
}
/** Reports never write design data or accept callbacks from a superseded source. */
export function acceptUiImageReport(request: UiImageRequest, report: UiImageReport): UiImageRequest | undefined {
  if (request.status !== 'loading' || !request.assetId || request.pageInstance !== report.pageInstance || request.sequence !== report.sequence || request.assetId !== report.assetId || !Object.hasOwn(uiImageEvents, report.status)) return;
  if (report.status === 'loaded' && (![report.width, report.height].every(value => typeof value === 'number' && Number.isSafeInteger(value) && value > 0))) return;
  return { ...request, status: report.status, error: report.status === 'failed' ? [...(report.error || '图片无法读取或解码。')].slice(0, 2000).join('') : '',
    width: report.status === 'loaded' ? report.width! : 0, height: report.status === 'loaded' ? report.height! : 0 };
}
export function uiImageAsset(component: UiComponent, state: UiButtonState = 'idle'): string {
  if (!component.parentId) state = 'idle';
  const skin = { ...component.skin, idle: component.assetId };
  return (state === 'pressed' || state === 'selected' ? skin[state] || skin.hover || skin.idle : skin[state] || skin.idle) || '';
}
export interface UiImageRect { x: number; y: number; width: number; height: number }
export interface UiImagePatch { source: UiImageRect; target: UiImageRect }
const pixel = (value: number) => Math.floor(value + .5);
/** Source-normalized rectangle, intersected with the image, then rounded to
 * source pixels. A zero-area crop is transparent, not a failed image load. */
export function uiImageCrop(width: number, height: number, effects: UiImageEffects = {}): UiImageRect {
  const x = pixel(width * (effects.cropX ?? 0)), y = pixel(height * (effects.cropY ?? 0));
  return { x, y, width: Math.max(0, pixel(width * Math.min(1, (effects.cropX ?? 0) + (effects.cropWidth ?? 1))) - x),
    height: Math.max(0, pixel(height * Math.min(1, (effects.cropY ?? 0) + (effects.cropHeight ?? 1))) - y) };
}
/** Both renderers use these integer-pixel patch rules. Nine-slice borders are
 * measured inside the cropped source; oversized borders shrink proportionally. */
export function uiImagePatches(source: UiImageRect, width: number, height: number, fit: UiSkin['fit'] = 'contain', borders: UiSkin['borders'] = { left: 12, top: 12, right: 12, bottom: 12 }): UiImagePatch[] {
  if (source.width <= 0 || source.height <= 0 || width <= 0 || height <= 0) return [];
  if (fit !== 'nineSlice') {
    const scale = fit === 'cover' ? Math.max(width / source.width, height / source.height) : Math.min(width / source.width, height / source.height);
    const w = fit === 'stretch' ? width : Math.max(1, pixel(source.width * scale)), h = fit === 'stretch' ? height : Math.max(1, pixel(source.height * scale));
    return [{ source, target: { x: pixel((width - w) / 2), y: pixel((height - h) / 2), width: w, height: h } }];
  }
  const cuts = (size: number, first: number, last: number) => {
    const scale = Math.min(1, size / Math.max(1, first + last));
    const left = pixel(first * scale);
    return [0, left, Math.max(left, size - pixel(last * scale)), size];
  };
  const sx = cuts(source.width, borders.left, borders.right), sy = cuts(source.height, borders.top, borders.bottom);
  const tx = cuts(width, sx[1], source.width - sx[2]), ty = cuts(height, sy[1], source.height - sy[2]);
  const patches: UiImagePatch[] = [];
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
    const sw = sx[x + 1] - sx[x], sh = sy[y + 1] - sy[y], w = tx[x + 1] - tx[x], h = ty[y + 1] - ty[y];
    if (sw > 0 && sh > 0 && w > 0 && h > 0) patches.push({ source: { x: source.x + sx[x], y: source.y + sy[y], width: sw, height: sh }, target: { x: tx[x], y: ty[y], width: w, height: h } });
  }
  return patches;
}
