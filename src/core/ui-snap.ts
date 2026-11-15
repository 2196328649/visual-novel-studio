import type { UiComponent } from './model';
import { uiSelectionRoots } from './ui-arrange';
import { resolveUiHierarchy } from './ui-hierarchy';
import { uiLayoutProblem, type UiPixelRect, type UiPoint } from './ui-layout';

type Axis = 'x' | 'y';
interface SnapLine {
  position: number; start: number; end: number; center: boolean; edge: 'start' | 'center' | 'end'; targetId?: string;
}
export interface UiSnapContext { bounds: UiPixelRect; lines: Record<Axis, SnapLine[]> }
export interface UiSnapGuide {
  axis: Axis; position: number; start: number; end: number; edge: 'start' | 'center' | 'end'; targetId?: string;
}
export interface UiSnapResult { delta: UiPoint; guides: UiSnapGuide[] }
export const uiSnapDistance = 6;

/** Capture stationary geometry once per drag, excluding every moving subtree. */
export function createUiSnapContext(components: readonly UiComponent[], ids: readonly string[], viewport: { width: number; height: number },
  visible: (component: UiComponent) => boolean = () => true): UiSnapContext | undefined {
  if (!(viewport.width > 0 && viewport.height > 0)) return;
  const roots = uiSelectionRoots(components, ids), rows = resolveUiHierarchy(components, { design: true, viewport, visible });
  const byId = new Map(rows.map(row => [row.component.id, row]));
  const selected = roots.map(id => byId.get(id));
  if (!selected.length || ids.some(id => !byId.has(id)) || selected.some(row => !row?.visible || !row.geometry || row.geometry.clippedOut)) return;
  const bounds = selected.map(row => row!.geometry!.bounds);
  const x = Math.min(...bounds.map(box => box.x)), y = Math.min(...bounds.map(box => box.y));
  const context: UiSnapContext = { bounds: { x, y, width: Math.max(...bounds.map(box => box.x + box.width)) - x, height: Math.max(...bounds.map(box => box.y + box.height)) - y }, lines: { x: [], y: [] } };
  const children = new Map<string, string[]>();
  for (const component of components) if (component.parentId) {
    const group = children.get(component.parentId);
    if (group) group.push(component.id); else children.set(component.parentId, [component.id]);
  }
  const moving = new Set(roots), pending = [...roots];
  while (pending.length) for (const id of children.get(pending.pop()!) ?? []) if (!moving.has(id)) { moving.add(id); pending.push(id); }
  const add = (box: UiPixelRect, targetId?: string) => {
    if (!Object.values(box).every(Number.isFinite) || box.width <= 0 || box.height <= 0) return;
    for (const axis of ['x', 'y'] as const) {
      const other = axis === 'x' ? 'y' : 'x', size = axis === 'x' ? 'width' : 'height', otherSize = axis === 'x' ? 'height' : 'width';
      for (const factor of [0, .5, 1]) context.lines[axis].push({ position: box[axis] + box[size] * factor, start: box[other], end: box[other] + box[otherSize], center: factor === .5, edge: factor === 0 ? 'start' : factor === 1 ? 'end' : 'center', targetId });
    }
  };
  add({ x: 0, y: 0, width: viewport.width, height: viewport.height });
  for (const row of rows) {
    const geometry = row.geometry;
    if (moving.has(row.component.id) || !row.visible || !geometry || geometry.clippedOut || row.component.style?.opacity === 0 || uiLayoutProblem(row.component)) continue;
    const box = geometry.bounds;
    if (box.x + box.width <= 0 || box.y + box.height <= 0 || box.x >= viewport.width || box.y >= viewport.height) continue;
    add(box, row.component.id);
  }
  return context;
}

/** Thresholds are screen pixels, while the result is one world delta for the whole selection. */
export function snapUiMove(context: UiSnapContext | undefined, delta: UiPoint, unitsPerPixel: UiPoint, enabled = true): UiSnapResult {
  const result: UiSnapResult = { delta: { ...delta }, guides: [] };
  if (!enabled || !context || ![delta.x, delta.y, unitsPerPixel.x, unitsPerPixel.y].every(Number.isFinite) || unitsPerPixel.x <= 0 || unitsPerPixel.y <= 0) return result;
  const matches: Partial<Record<Axis, SnapLine>> = {};
  for (const axis of ['x', 'y'] as const) {
    const other = axis === 'x' ? 'y' : 'x', size = axis === 'x' ? 'width' : 'height', otherSize = axis === 'x' ? 'height' : 'width';
    const start = context.bounds[other] + delta[other], end = start + context.bounds[otherSize];
    let best: { line: SnapLine; offset: number; distance: number; gap: number } | undefined;
    for (const line of context.lines[axis]) for (const factor of line.center ? [.5] : [0, 1]) {
      const offset = line.position - context.bounds[axis] - context.bounds[size] * factor - delta[axis], distance = Math.abs(offset) / unitsPerPixel[axis];
      if (distance > uiSnapDistance + 1e-7) continue;
      const gap = Math.max(0, line.start - end, start - line.end);
      // Stable ties favor center lines, then nearby targets, without depending on paint order.
      if (best && (distance > best.distance + 1e-7 || Math.abs(distance - best.distance) <= 1e-7 && (
        Number(line.center) < Number(best.line.center) || line.center === best.line.center && (gap > best.gap || gap === best.gap && (line.targetId ?? '') >= (best.line.targetId ?? ''))))) continue;
      best = { line, offset, distance, gap };
    }
    if (best) { result.delta[axis] += best.offset; matches[axis] = best.line; }
  }
  for (const axis of ['x', 'y'] as const) {
    const line = matches[axis]; if (!line) continue;
    const other = axis === 'x' ? 'y' : 'x', size = axis === 'x' ? 'height' : 'width';
    result.guides.push({ axis, position: line.position, start: Math.min(line.start, context.bounds[other] + result.delta[other]), end: Math.max(line.end, context.bounds[other] + result.delta[other] + context.bounds[size]), edge: line.edge, targetId: line.targetId });
  }
  return result;
}
