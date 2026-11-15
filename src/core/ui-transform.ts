import { uiIdentity, uiInverse, uiLayoutLocalDelta, uiLayoutValues, uiTransformPoint, uiTransformVector, type UiLayoutGeometry, type UiPixelRect, type UiPoint } from './ui-layout';
import type { UiComponent } from './model';

export type UiRect = Pick<UiComponent, 'x' | 'y' | 'width' | 'height'>;
export type UiResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export type UiTransformMode = 'move' | UiResizeHandle;

/** Internal canvas gestures use the same complete frame as the flat DOM paint.
 * `scale` includes the editor zoom and any zoom inside the control. Translation
 * never affects a delta; ancestor rotation, shear, scale and mirroring do. */
export function uiScreenToLocalDelta(geometry: Pick<UiLayoutGeometry, 'renderMatrix'> | undefined, delta: UiPoint, scale = 1): UiPoint | undefined {
  if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(delta.x) || !Number.isFinite(delta.y)) return;
  const matrix = geometry?.renderMatrix ?? uiIdentity;
  if (!matrix.every(Number.isFinite)) return;
  const inverse = uiInverse(matrix);
  if (!inverse) return;
  const local = uiTransformVector(inverse, { x: delta.x / scale, y: delta.y / scale });
  return Number.isFinite(local.x) && Number.isFinite(local.y) ? local : undefined;
}

/**
 * Invert an absolute client point using the AABB of a known, transformed local
 * rectangle. `bounds` is the element's getBoundingClientRect left/top in client
 * CSS pixels. The rectangle and matrix are in component pixels; `scale` is the
 * CSS pixel scale used by the flat canvas painter.
 */
export function uiScreenToLocalPoint(geometry: Pick<UiLayoutGeometry, 'renderMatrix'> | undefined, point: UiPoint, bounds: Pick<UiPoint, 'x' | 'y'>, rect: UiPixelRect, scale = 1): UiPoint | undefined {
  if (!Number.isFinite(scale) || scale <= 0 || ![point.x, point.y, bounds.x, bounds.y, rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width < 0 || rect.height < 0) return;
  const matrix = geometry?.renderMatrix ?? uiIdentity;
  if (!matrix.every(Number.isFinite)) return;
  const inverse = uiInverse(matrix);
  if (!inverse) return;
  const corners = [
    uiTransformPoint(matrix, { x: rect.x, y: rect.y }),
    uiTransformPoint(matrix, { x: rect.x + rect.width, y: rect.y }),
    uiTransformPoint(matrix, { x: rect.x + rect.width, y: rect.y + rect.height }),
    uiTransformPoint(matrix, { x: rect.x, y: rect.y + rect.height }),
  ];
  const minX = Math.min(...corners.map(corner => corner.x)), minY = Math.min(...corners.map(corner => corner.y));
  const offset = { x: bounds.x - minX * scale, y: bounds.y - minY * scale };
  const local = uiTransformPoint(inverse, { x: (point.x - offset.x) / scale, y: (point.y - offset.y) / scale });
  return Number.isFinite(local.x) && Number.isFinite(local.y) ? local : undefined;
}

/** Deltas and minimum sizes use the same parent-local coordinates as the authored rectangle. */
export function transformUiRect(rect: UiRect, mode: UiTransformMode, dx: number, dy: number, options: {
  preserveAspectRatio?: boolean; minWidth?: number; minHeight?: number;
} = {}): UiRect {
  if (mode === 'move') return { ...rect, x: rect.x + dx, y: rect.y + dy };
  const horizontal = mode.includes('w') ? -1 : mode.includes('e') ? 1 : 0;
  const vertical = mode.includes('n') ? -1 : mode.includes('s') ? 1 : 0;
  const minWidth = options.minWidth ?? 1e-6, minHeight = options.minHeight ?? 1e-6;
  let width = horizontal ? Math.max(minWidth, rect.width + horizontal * dx) : rect.width;
  let height = vertical ? Math.max(minHeight, rect.height + vertical * dy) : rect.height;
  if (options.preserveAspectRatio && rect.width > 0 && rect.height > 0) {
    const sx = width / rect.width, sy = height / rect.height;
    const scale = Math.max(minWidth / rect.width, minHeight / rect.height,
      !horizontal ? sy : !vertical ? sx : Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy);
    width = rect.width * scale; height = rect.height * scale;
  }
  return {
    x: rect.x + (horizontal < 0 ? rect.width - width : !horizontal ? (rect.width - width) / 2 : 0),
    y: rect.y + (vertical < 0 ? rect.height - height : !vertical ? (rect.height - height) / 2 : 0),
    width, height,
  };
}

/** Screen-pixel drag deltas are inverted through the actual parent/own affine frame. */
export function transformUiLayoutRect(component: UiComponent, geometry: UiLayoutGeometry, mode: UiTransformMode, delta: UiPoint, preserveAspectRatio = false): UiRect | undefined {
  if (!geometry.basis.width || !geometry.basis.height) return;
  const local = uiLayoutLocalDelta(geometry, delta, mode !== 'move');
  if (!local) return;
  if (mode === 'move') return { x: component.x + local.x / geometry.basis.width, y: component.y + local.y / geometry.basis.height, width: component.width, height: component.height };
  const rect = transformUiRect(component, mode, local.x / geometry.basis.width, local.y / geometry.basis.height,
    { preserveAspectRatio, minWidth: 1 / geometry.basis.width, minHeight: 1 / geometry.basis.height });
  const layout = uiLayoutValues(component);
  const origin = uiTransformVector(geometry.localMatrix, {
    x: (rect.x - component.x + layout.pivotX * (rect.width - component.width)) * geometry.basis.width,
    y: (rect.y - component.y + layout.pivotY * (rect.height - component.height)) * geometry.basis.height,
  });
  return { x: component.x + origin.x / geometry.basis.width, y: component.y + origin.y / geometry.basis.height, width: rect.width, height: rect.height };
}
