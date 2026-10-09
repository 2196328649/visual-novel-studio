import type { UiComponent } from './model';

export type UiRect = Pick<UiComponent, 'x' | 'y' | 'width' | 'height'>;
export type UiResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export type UiTransformMode = 'move' | UiResizeHandle;

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
