export interface Point { x: number; y: number }
export interface Rect extends Point { width: number; height: number }
export type Bezier = readonly [Point, Point, Point, Point];

const contains = (rect: Rect, point: Point) => point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
export const rectanglesIntersect = (a: Rect, b: Rect) => a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;

export function segmentIntersectsRect(a: Point, b: Point, rect: Rect): boolean {
  let first = 0, last = 1;
  for (const [start, delta, low, high] of [[a.x, b.x - a.x, rect.x, rect.x + rect.width], [a.y, b.y - a.y, rect.y, rect.y + rect.height]]) {
    if (!delta) { if (start < low || start > high) return false; continue; }
    const one = (low - start) / delta, two = (high - start) / delta;
    first = Math.max(first, Math.min(one, two)); last = Math.min(last, Math.max(one, two));
    if (first > last) return false;
  }
  return true;
}

const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
function distanceToSegment(point: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0;
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}

/** Subdivide the rendered cubic, rather than selecting empty space inside its
 * bounding box. Tolerance is supplied in flow units to keep screen precision. */
export function bezierIntersectsRect(curve: Bezier, rect: Rect, tolerance = 0.5): boolean {
  const target = { x: rect.x - tolerance, y: rect.y - tolerance, width: rect.width + 2 * tolerance, height: rect.height + 2 * tolerance };
  const visit = ([a, b, c, d]: Bezier, depth: number): boolean => {
    const left = Math.min(a.x, b.x, c.x, d.x), top = Math.min(a.y, b.y, c.y, d.y);
    if (!rectanglesIntersect(target, { x: left, y: top, width: Math.max(a.x, b.x, c.x, d.x) - left, height: Math.max(a.y, b.y, c.y, d.y) - top })) return false;
    if (contains(target, a) || contains(target, d)) return true;
    if (depth >= 18 || Math.max(distanceToSegment(b, a, d), distanceToSegment(c, a, d)) <= Math.max(tolerance / 4, 0.001)) return segmentIntersectsRect(a, d, target);
    const ab = midpoint(a, b), bc = midpoint(b, c), cd = midpoint(c, d), abc = midpoint(ab, bc), bcd = midpoint(bc, cd), middle = midpoint(abc, bcd);
    return visit([a, ab, abc, middle], depth + 1) || visit([middle, bcd, cd, d], depth + 1);
  };
  return visit(curve, 0);
}

/** React Flow's getBezierPath emits one M followed by one C. */
export function parseBezierPath(path: string): Bezier | undefined {
  if (!path.trim().startsWith('M') || !path.includes('C')) return;
  const values = path.trim().split(/[MC,\s]+/).filter(Boolean).map(Number);
  if (values.length !== 8 || !values.every(Number.isFinite)) return;
  return [{ x: values[0], y: values[1] }, { x: values[2], y: values[3] }, { x: values[4], y: values[5] }, { x: values[6], y: values[7] }];
}

/** The story canvas uses several cubics for return wires; selection follows the whole visible path. */
export function parseBezierSegments(path: string): Bezier[] {
  const chunks = path.match(/[MC][^MC]*/g);
  if (!chunks?.length || !chunks[0].startsWith('M')) return [];
  const values = (text: string) => text.slice(1).trim().split(/[,\s]+/).filter(Boolean).map(Number);
  const move = values(chunks[0]);
  if (move.length !== 2 || !move.every(Number.isFinite)) return [];
  let from: Point = { x: move[0], y: move[1] };
  const segments: Bezier[] = [];
  for (const chunk of chunks.slice(1)) {
    const coords = values(chunk);
    if (!chunk.startsWith('C') || coords.length !== 6 || !coords.every(Number.isFinite)) return [];
    const to = { x: coords[4], y: coords[5] };
    segments.push([from, { x: coords[0], y: coords[1] }, { x: coords[2], y: coords[3] }, to]); from = to;
  }
  return segments;
}
