import type { UiHierarchyRow } from './ui-hierarchy';
import { uiClipPolygon, uiPolygonBounds, uiRectPolygon, uiTransformPoint, type UiPixelRect, type UiPoint } from './ui-layout';
import { uiComponentBounds } from './ui';

export interface UiMarqueeCandidate { id: string; bounds: UiPixelRect }
export type UiMarqueeMode = 'replace' | 'add' | 'toggle';

export function uiMarqueeRect(start: UiPoint, end: UiPoint): UiPixelRect {
  return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
}

/** Complete rendered frames in paint order, including the portion outside a
 * parent's clip. A clipped visible fragment is not a smaller selectable object. */
export function uiMarqueeCandidates(rows: readonly UiHierarchyRow[], viewport: { width: number; height: number }): UiMarqueeCandidate[] {
  const canvas = uiRectPolygon({ x: 0, y: 0, ...viewport });
  return rows.flatMap(({ component, geometry, visible }) => {
    if (!visible || component.editor?.locked || !geometry || geometry.clippedOut) return [];
    const { width, height } = uiComponentBounds(component, viewport.width, viewport.height);
    const frame = uiRectPolygon({ x: 0, y: 0, width, height }).map(point => uiTransformPoint(geometry.renderMatrix, point));
    const clipped = geometry.clipPolygons.length ? uiClipPolygon(frame, geometry.visiblePolygon) : frame;
    const visibleFrame = uiClipPolygon(clipped, canvas);
    const visibleArea = Math.abs(visibleFrame.reduce((area, point, index) => {
      const next = visibleFrame[(index + 1) % visibleFrame.length];
      return area + point.x * next.y - point.y * next.x;
    }, 0)) / 2;
    if (visibleArea < 1e-8) return [];
    const bounds = uiPolygonBounds(frame);
    return Object.values(bounds).every(Number.isFinite) && bounds.width > 0 && bounds.height > 0 ? [{ id: component.id, bounds }] : [];
  });
}

/** Containment, never intersection. Tolerance only compensates for CSS subpixel rounding. */
export function uiMarqueeHits(candidates: readonly UiMarqueeCandidate[], area: UiPixelRect, tolerance = 1e-7): string[] {
  if (area.width <= 0 || area.height <= 0 || !Object.values(area).every(Number.isFinite)) return [];
  return candidates.filter(({ bounds }) => bounds.x >= area.x - tolerance && bounds.y >= area.y - tolerance
    && bounds.x + bounds.width <= area.x + area.width + tolerance && bounds.y + bounds.height <= area.y + area.height + tolerance).map(item => item.id);
}

/** Apply each frame to the gesture's starting selection, not its previous hits. */
export function uiMarqueeSelection(base: readonly string[], hits: readonly string[], mode: UiMarqueeMode): string[] {
  if (mode === 'replace') return [...new Set(hits)];
  if (mode === 'add') return [...new Set([...base, ...hits])];
  const original = new Set(base), contained = new Set(hits);
  return [...new Set([...base.filter(id => !contained.has(id)), ...hits.filter(id => !original.has(id))])];
}
