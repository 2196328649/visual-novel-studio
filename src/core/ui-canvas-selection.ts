import type { UiHierarchyRow } from './ui-hierarchy';
import { uiClipPolygon, uiGeometryContains, uiPointInPolygon, uiRectPolygon, uiTransformPoint, type UiPoint } from './ui-layout';
import { uiComponentBounds } from './ui';

/** Screen pixels, shared by click/marquee selection and component movement. */
export const uiCanvasDragThreshold = 4;
interface Viewport { width: number; height: number }

/** The hierarchy is already in paint order and includes inherited visibility,
 * locks and clips. The page itself also clips authoring hit tests. */
export function uiCanvasHitIds(rows: readonly UiHierarchyRow[], point: UiPoint, viewport: Viewport, includeLocked = false): string[] {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.y < 0 || point.x >= viewport.width || point.y >= viewport.height) return [];
  return [...rows].reverse().filter(row => {
    if (!row.visible || !includeLocked && row.component.editor?.locked || !row.geometry) return false;
    const { width, height } = uiComponentBounds(row.component, viewport.width, viewport.height);
    return uiGeometryContains({ ...row.geometry, width, height }, point);
  }).map(row => row.component.id);
}

function ancestors(rows: ReadonlyMap<string, UiHierarchyRow>, id: string): Set<string> {
  const result = new Set<string>(), seen = new Set([id]);
  let next = rows.get(id)?.component.parentId;
  while (next && !seen.has(next)) {
    seen.add(next); result.add(next); next = rows.get(next)?.component.parentId;
  }
  return result;
}

/** Only a real supporting object gets the first-click deselection rule: an
 * ancestor, a background child of that ancestor, or a complete-page backdrop.
 * A nearby image/button is never classified by an arbitrary size threshold. */
export function uiCanvasIsBackdrop(rows: readonly UiHierarchyRow[], id: string, selectedIds: readonly string[], viewport: Viewport): boolean {
  if (!selectedIds.length || selectedIds.includes(id)) return false;
  const byId = new Map(rows.map(row => [row.component.id, row])), row = byId.get(id), geometry = row?.geometry;
  if (!row?.visible || !geometry || geometry.clippedOut) return false;
  const { width, height } = uiComponentBounds(row.component, viewport.width, viewport.height);
  const frame = uiRectPolygon({ x: 0, y: 0, width, height }).map(point => uiTransformPoint(geometry.renderMatrix, point));
  const polygon = geometry.clipPolygons.length ? uiClipPolygon(frame, geometry.visiblePolygon) : frame;
  const fullPage = uiRectPolygon({ x: 0, y: 0, ...viewport }).every(point => uiPointInPolygon(point, polygon));
  const index = rows.indexOf(row);
  return selectedIds.every(selectedId => {
    const selected = byId.get(selectedId), selectedGeometry = selected?.geometry;
    if (!selected?.visible || !selectedGeometry || selectedGeometry.clippedOut || rows.indexOf(selected) <= index) return false;
    const parents = ancestors(byId, selectedId), parent = row.component.parentId;
    const supports = fullPage || parents.has(id) || row.component.childLayer === 'background' && !!parent && (parent === selectedId || parents.has(parent));
    if (!supports) return false;
    const size = uiComponentBounds(selected.component, viewport.width, viewport.height);
    const selectedFrame = uiRectPolygon({ x: 0, y: 0, width: size.width, height: size.height })
      .map(point => uiTransformPoint(selectedGeometry.renderMatrix, point));
    const visible = uiClipPolygon(selectedGeometry.clipPolygons.length ? uiClipPolygon(selectedFrame, selectedGeometry.visiblePolygon) : selectedFrame, uiRectPolygon({ x: 0, y: 0, ...viewport }));
    return visible.length >= 3 && visible.every(point => uiPointInPolygon(point, polygon));
  });
}

/** Clicking cycles; pressing and dragging retains the already selected object.
 * An enclosing selection must not steal a first drag from its unselected child. */
export function uiCanvasMoveTarget(rows: readonly UiHierarchyRow[], hits: readonly string[], selectedIds: readonly string[], viewport: Viewport): string | undefined {
  const first = hits[0];
  if (!first) return;
  const parents = ancestors(new Map(rows.map(row => [row.component.id, row])), first);
  return hits.find(id => selectedIds.includes(id) && (id === first || !parents.has(id) && !uiCanvasIsBackdrop(rows, id, [first], viewport)));
}

export function uiCanvasClickSelection(rows: readonly UiHierarchyRow[], hits: readonly string[], selectedIds: readonly string[], viewport: Viewport, repeat: boolean): string[] {
  const first = hits[0];
  if (!first) return [];
  if (repeat && selectedIds.length === 1 && hits.includes(selectedIds[0])) return [hits[(hits.indexOf(selectedIds[0]) + 1) % hits.length]];
  return uiCanvasIsBackdrop(rows, first, selectedIds, viewport) ? [] : [first];
}
