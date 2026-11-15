export type VisibleBounds = { x: number; y: number; width: number; height: number };

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
