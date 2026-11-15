import { parseBezierSegments, type Bezier, type Point } from './blueprint-selection';

interface ScreenTransform { a: number; b: number; c: number; d: number; e: number; f: number }
export interface RenderedWireCandidate { id: string; path: string; transform: ScreenTransform }

const curveTolerance = .0625;
const tiedDistance = .25;
const maximumCandidates = 32;
const maximumSegments = 32;
const maximumSubdivisions = 1024;

function segmentDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
  if (!length) return Math.hypot(point.x - a.x, point.y - a.y);
  const ux = dx / length, uy = dy / length;
  const along = Math.max(0, Math.min(length, (point.x - a.x) * ux + (point.y - a.y) * uy));
  return Math.hypot(point.x - a.x - along * ux, point.y - a.y - along * uy);
}

function boxDistance(point: Point, curve: Bezier): number {
  const [a, b, c, d] = curve;
  const left = Math.min(a.x, b.x, c.x, d.x), right = Math.max(a.x, b.x, c.x, d.x);
  const top = Math.min(a.y, b.y, c.y, d.y), bottom = Math.max(a.y, b.y, c.y, d.y);
  return Math.hypot(Math.max(left - point.x, 0, point.x - right), Math.max(top - point.y, 0, point.y - bottom));
}

const midpoint = (a: Point, b: Point): Point => ({ x: a.x / 2 + b.x / 2, y: a.y / 2 + b.y / 2 });

/** Distance to the actual screen-space cubics, including loops and return wires.
 * An unresolved pathological curve keeps native selection instead of guessing. */
function pathDistance(point: Point, candidate: RenderedWireCandidate): number | undefined {
  if (candidate.path.length > 16384 || !Object.values(candidate.transform).every(Number.isFinite)) return;
  const parsed = parseBezierSegments(candidate.path);
  if (!parsed.length || parsed.length > maximumSegments) return;
  const { a, b, c, d, e, f } = candidate.transform;
  const screenPoint = (p: Point): Point => ({ x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f });
  const curves = parsed.map(([p0, p1, p2, p3]): Bezier => [screenPoint(p0), screenPoint(p1), screenPoint(p2), screenPoint(p3)]);
  if (curves.some(curve => curve.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)))) return;
  let nearest = Infinity, visited = 0, exhausted = false;
  const visit = (curve: Bezier, depth: number) => {
    if (exhausted || boxDistance(point, curve) >= nearest) return;
    if (++visited > maximumSubdivisions) { exhausted = true; return; }
    const [first, control1, control2, last] = curve;
    // Measuring against the finite segment also catches collinear overshoots
    // and closed curves, for which distance to an infinite line is misleading.
    if (Math.max(segmentDistance(control1, first, last), segmentDistance(control2, first, last)) <= curveTolerance) {
      nearest = Math.min(nearest, segmentDistance(point, first, last)); return;
    }
    if (depth >= 20) { exhausted = true; return; }
    const ab = midpoint(first, control1), bc = midpoint(control1, control2), cd = midpoint(control2, last);
    const abc = midpoint(ab, bc), bcd = midpoint(bc, cd), middle = midpoint(abc, bcd);
    const left: Bezier = [first, ab, abc, middle], right: Bezier = [middle, bcd, cd, last];
    // Visiting the closer half first gives a useful bound before the other half.
    if (boxDistance(point, left) <= boxDistance(point, right)) { visit(left, depth + 1); visit(right, depth + 1); }
    else { visit(right, depth + 1); visit(left, depth + 1); }
  };
  for (const curve of curves) visit(curve, 0);
  return !exhausted && Number.isFinite(nearest) ? nearest : undefined;
}

/** Candidates come from the native target and pointer hit test. DOM order only breaks visual ties. */
export function nearestRenderedWire(point: Point, candidates: readonly RenderedWireCandidate[], nativeId: string): string {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || candidates.length > maximumCandidates || !candidates.some(item => item.id === nativeId)) return nativeId;
  const distances = candidates.map(candidate => ({ id: candidate.id, distance: pathDistance(point, candidate) }));
  if (distances.some(item => item.distance === undefined)) return nativeId;
  const closest = Math.min(...distances.map(item => item.distance!));
  const nativeDistance = distances.find(item => item.id === nativeId)!.distance!;
  if (nativeDistance <= closest + tiedDistance) return nativeId;
  return distances.find(item => item.distance! <= closest + tiedDistance)?.id ?? nativeId;
}

/** Keep the broad click target, resolving only overlapping SVG strokes at a real
 * click. Markers, node controls, reconnect handles and other canvases are untouched. */
export function storyWireAtPointer(root: HTMLElement | null, event: { clientX: number; clientY: number; target: EventTarget | null }, nativeId: string): string {
  const target = event.target instanceof Element ? event.target : null;
  const nativeEdge = target?.closest('.react-flow__edge.selectable');
  if (!root || !target || !nativeEdge || !root.contains(target) || !root.contains(nativeEdge) || nativeEdge.getAttribute('data-id') !== nativeId
    || target.closest('.react-flow__node, .react-flow__handle, .react-flow__edgeupdater, .react-flow__edgelabel-renderer')) return nativeId;
  const candidates = new Map<string, RenderedWireCandidate>();
  // Chromium can round click coordinates while retaining the original pointer
  // target. Keep that verified edge even when the rounded hit test omits it.
  for (const hit of [target, ...root.ownerDocument.elementsFromPoint(event.clientX, event.clientY)]) {
    if (!root.contains(hit) || hit.closest('.react-flow__node, .react-flow__handle, .react-flow__edgeupdater, .react-flow__edgelabel-renderer')) continue;
    const edge = hit.closest('.react-flow__edge.selectable'), id = edge?.getAttribute('data-id');
    if (!edge || !id || candidates.has(id)) continue;
    if (candidates.size >= maximumCandidates) return nativeId;
    const path = edge.querySelector<SVGPathElement>('.react-flow__edge-path');
    if (!path) return nativeId;
    const transform = path.getScreenCTM();
    if (!transform) return nativeId;
    candidates.set(id, { id, path: path.getAttribute('d') ?? '', transform: { a: transform.a, b: transform.b, c: transform.c, d: transform.d, e: transform.e, f: transform.f } });
  }
  return candidates.size > 1 ? nearestRenderedWire({ x: event.clientX, y: event.clientY }, [...candidates.values()], nativeId) : nativeId;
}
