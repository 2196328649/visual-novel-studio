import { z } from 'zod';
import type { Project, VisualObject } from './model';

const number = z.number().finite();
const schema = z.object({
  位置: z.tuple([number, number]).optional(),
  缩放: z.tuple([number, number]).optional(), 旋转: number.optional(), 不透明度: number.min(0).max(1).optional(),
}).strict();
export interface ImageTransform { x: number; y: number; scaleX: number; scaleY: number; rotation: number; opacity: number }
export const defaultImageTransform: ImageTransform = { x: .5, y: .5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 };
export function parseImageTransform(source?: string): ImageTransform {
  if (!source) return { ...defaultImageTransform };
  try {
    const value = schema.parse(JSON.parse(source));
    return { x: value.位置?.[0] ?? .5, y: value.位置?.[1] ?? .5, scaleX: value.缩放?.[0] ?? 1, scaleY: value.缩放?.[1] ?? 1, rotation: value.旋转 ?? 0, opacity: value.不透明度 ?? 1 };
  } catch { throw new Error('变换请填写结构，例如 {"位置":[0.5,0.5],"缩放":[1,1],"旋转":0}；缩放 X/Y 分别控制宽高，数值需有限，不透明度为 0 至 1。'); }
}
export function imageTransform(object: VisualObject): ImageTransform {
  const pose = object.keyframes[0];
  return { x: pose.x, y: pose.y, scaleX: pose.scale * (pose.scaleX ?? 1), scaleY: pose.scale * (pose.scaleY ?? 1), rotation: pose.rotation, opacity: pose.opacity };
}
export function imageTransformText(value: ImageTransform): string {
  return JSON.stringify({ 位置: [value.x, value.y], 缩放: [value.scaleX, value.scaleY], 旋转: value.rotation, ...(value.opacity !== 1 ? { 不透明度: value.opacity } : {}) });
}

/** Express a static image's rendered geometry as axis scales relative to its
 * canvas fit. A crop with a different aspect ratio remains a full visual clip. */
export function canonicalImageVisual(project: Project, object: VisualObject): VisualObject | undefined {
  if (object.content !== 'image' || object.keyframes.length !== 1 || object.curves) return;
  const pose = object.keyframes[0];
  let x = object.width, y = object.height;
  if (object.imageFit === 'contain') {
    const asset = project.assets.find(asset => asset.id === object.assetId);
    if (asset?.width && asset.height) {
      const base = Math.min(project.width / asset.width, project.height / asset.height);
      x = y = Math.min(object.width * project.width / asset.width, object.height * project.height / asset.height) / base;
    } else if (x === y) y = x;
    else return;
  } else if (object.imageFit === 'cover' && x !== y) return;
  return { ...object, width: 1, height: 1, keyframes: [{ ...pose, scale: 1, scaleX: pose.scale * (pose.scaleX ?? 1) * x, scaleY: pose.scale * (pose.scaleY ?? 1) * y }] };
}
