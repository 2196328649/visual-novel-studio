import type { Project, StoryNode, UiComponent } from './model';
import { playerFlowView, playerFlowPositions, type PlayerFlowView } from './player-flow-content';
import type { StoryMenuEntry } from './story-menu';
import { type FlowConnection } from './story-flow-connections';
import { storyFlowRanking } from './story-flow-ranking';
export { flowEdgeUnlocked } from './story-flow-connections';
export type { FlowEdgePath, FlowEndpoint } from './story-flow-connections';
export interface FlowBox { id: string; name: string; parts?: string[]; kind: StoryNode['kind']; styleId?: string; chapter: string; x: number; y: number; width: number; height: number; nodeId?: string; groupId?: string; memberIds?: string[]; action?: 'replay' | 'inspect'; callId?: string; targetId?: string; viewId?: string; sourceEntryId?: string }
import { isStandaloneNode } from './standalone-performance';
export interface FlowEdge extends FlowConnection { points: [number, number][] }

/** Defaults shared by the layout and its property editor. Coordinates are pixels. */
export const storyFlowDefaults = { itemWidth: 350, itemHeight: 80, gapX: 100, gapY: 90, flowLineWidth: 4, flowLineColor: '#8c7963' } as const;

export interface StoryFlowRect { x: number; y: number; width: number; height: number }

/** Matches vn_story_flow_body. A custom skin never opts out of automatic positioning. */
export function storyFlowBrowseLayout(project: Project, component: UiComponent) {
  const list = component.list, custom = list?.flowScrollbar;
  const width = component.width * project.width, height = component.height * project.height;
  const relative = list?.flowViewport ?? { x: 0, y: 0, width: 1, height: 1 };
  const view = { x: relative.x * width, y: relative.y * height, width: relative.width * width, height: relative.height * height };
  const side = { x: view.x + (list?.flowViewport ? 0 : 16), y: view.y, width: Math.max(1, view.width - (list?.flowViewport ? 0 : 32)), height: Math.max(1, view.height - ((list?.flowShowControls ?? true) ? 44 : 0)) };
  const automaticScrollbarHeight = custom ? Math.max(16, Math.floor(Math.max(custom.trackHeight ?? 5, custom.thumbHeight ?? 31))) : 16;
  const contentWidth = Math.max(1, side.width - ((list?.flowShowVerticalScrollbar ?? true) ? 24 : 0));
  const contentHeight = Math.max(1, side.height - (custom?.rect ? 0 : automaticScrollbarHeight + 8));
  const scrollbar = custom?.rect
    ? { x: custom.rect.x * width, y: custom.rect.y * height, width: custom.rect.width * width, height: custom.rect.height * height }
    : { x: side.x, y: side.y + contentHeight + 8, width: contentWidth, height: automaticScrollbarHeight };
  return { width, height, view, side, contentWidth, contentHeight, scrollbar, automaticScrollbarHeight };
}

/** Creating an appearance override keeps the previously visible native rail dimensions. */
export function ensureStoryFlowScrollbar(component: UiComponent) {
  component.list ??= {};
  return component.list.flowScrollbar ??= { trackHeight: 16, thumbHeight: 16 };
}

/** Restoring position must leave every rail and thumb appearance setting intact. */
export function setStoryFlowScrollbarRect(component: UiComponent, rect?: StoryFlowRect) {
  if (rect) ensureStoryFlowScrollbar(component).rect = rect;
  else if (component.list?.flowScrollbar) delete component.list.flowScrollbar.rect;
}

export function storyFlowPaginationStyle(list: UiComponent['list']): 'numbers' | 'previousNext' {
  return list?.flowPaginationStyle ?? (list?.navigationRect ? 'numbers' : 'previousNext');
}

/** Materialize the legacy presentation before changing its old position-based discriminator. */
export function setStoryFlowPaginationRect(component: UiComponent, rect?: StoryFlowRect) {
  const style = storyFlowPaginationStyle(component.list);
  component.list = { ...component.list, flowPaginationStyle: style, navigationRect: rect };
}

/** Directory cells follow vn_collection; samples and the canvas share this geometry. */
export function storyFlowDirectoryLayout(project: Project, component: UiComponent, fontSize = project.ui.fontSize, groupHeaderHeight = 0) {
  const list = component.list, width = component.width * project.width, height = component.height * project.height;
  const columns = list?.columns ?? 1, rows = list?.rows ?? 0;
  const gapX = Math.min(Math.floor((list?.gapX ?? 12) + .5), Math.max(0, Math.floor(width / (columns * 2))));
  const gapY = Math.floor((list?.gapY ?? 12) + .5);
  const navHeight = rows && !list?.navigationRect ? Math.min(40, Math.max(24, Math.floor(height * .1))) : 0;
  const bodyTop = groupHeaderHeight ? groupHeaderHeight + gapY : 0;
  const viewHeight = Math.max(1, height - navHeight - (navHeight ? gapY : 0) - bodyTop);
  const cellWidth = Math.max(1, Math.min(Math.floor(list?.itemWidth ?? width), Math.floor((width - (columns - 1) * gapX - (rows ? 0 : 16)) / columns)));
  const cellHeight = Math.max(1, Math.floor((list?.itemHeight ?? (rows ? Math.max(32, Math.floor((viewHeight - (rows - 1) * gapY) / rows)) : Math.max(48, (component.style?.fontSize ?? fontSize) + 28))) + .5));
  const rect = list?.navigationRect;
  const navigation = rect ? { x: rect.x * width, y: rect.y * height, width: rect.width * width, height: rect.height * height } : { x: 0, y: height - navHeight, width, height: navHeight };
  return { width, height, columns, rows, gapX, gapY, navHeight, viewHeight, cellWidth, cellHeight, navigation, bodyTop };
}

/** Collapse hidden implementation nodes while preserving branches, merges and loop exits. */
export function storyFlowLayout(project: Project, component: UiComponent, groupId?: string, view?: PlayerFlowView) {
  const list = component.list, positions = playerFlowPositions(component, groupId);
  const nodeWidth = list?.itemWidth ?? storyFlowDefaults.itemWidth, nodeHeight = list?.itemHeight ?? storyFlowDefaults.itemHeight, gapX = list?.gapX ?? storyFlowDefaults.gapX, gapY = list?.gapY ?? storyFlowDefaults.gapY;
  const all = new Map(project.nodes.map(node => [node.id, node]));
  const projected = view ?? playerFlowView(project, component, groupId), visible = projected.entries;
  const edges = projected.edges;
  const { rank, incoming } = storyFlowRanking(visible.map(node => node.id), edges);
  const groups = new Map<number, StoryMenuEntry[]>();
  for (const node of visible) {
    const value = rank.get(node.id)!, group = groups.get(value) ?? [];
    group.push(node); groups.set(value, group);
  }
  const rowCount = Math.max(3, ...[...groups.values()].map(group => group.length)), center = (rowCount - 1) / 2;
  const lane = new Map<string, number>(), boxes: FlowBox[] = [];
  const viewportWidth = component.width * project.width * (list?.flowViewport?.width ?? 1);
  const viewportHeight = component.height * project.height * (list?.flowViewport?.height ?? 1);
  const vertical = list?.flowDirection === 'vertical', columnCount = groups.size;
  // Lanes spread across the map, ranks advance along it: sideways by default, downwards when vertical.
  const laneSpan = vertical ? rowCount * nodeWidth + (rowCount - 1) * gapX : rowCount * nodeHeight + (rowCount - 1) * gapY;
  const autoHeight = vertical ? Math.max(viewportHeight - 34, 60 + columnCount * (nodeHeight + gapY)) : Math.max(viewportHeight - 34, laneSpan + 80);
  const laneStart = Math.max(40, ((vertical ? viewportWidth : autoHeight) - laneSpan) / 2);
  const scenes = new Map(project.scenes.map(scene => [scene.id, scene])), chapters = new Map(project.chapters.map(chapter => [chapter.id, chapter]));
  for (const [column, nodes] of [...groups].sort(([a], [b]) => a - b)) {
    const free = Array.from({ length: rowCount }, (_, index) => index);
    for (const node of nodes) {
      const parents = (incoming.get(node.id) ?? []).flatMap(parent => lane.has(parent) ? [lane.get(parent)!] : []);
      const desired = parents.length ? parents.reduce((sum, value) => sum + value, 0) / parents.length : center;
      // Free lanes stay sorted. Only the neighbors of the desired lane can win.
      let low = 0, high = free.length;
      while (low < high) { const middle = (low + high) >>> 1; if (free[middle] < desired) low = middle + 1; else high = middle; }
      const nearest = low === free.length || low > 0 && desired - free[low - 1] <= free[low] - desired ? low - 1 : low;
      const row = free.splice(nearest, 1)[0]; lane.set(node.id, row);
      const actual = node.nodeId ? all.get(node.nodeId) : undefined;
      const scene = actual && scenes.get(actual.sceneId);
      boxes.push({ id: node.id, name: node.name, ...(node.parts ? { parts: node.parts } : {}), ...(node.styleId ? { styleId: node.styleId } : {}),
        ...(node.nodeId ? { nodeId: node.nodeId } : {}), ...(node.action ? { action: node.action } : {}),
        ...(node.groupId ? { groupId: node.groupId, memberIds: node.memberIds } : {}),
        ...(node.callId ? { callId: node.callId, targetId: node.targetId, sourceEntryId: node.sourceEntryId } : {}), ...(node.viewId ? { viewId: node.viewId } : {}),
        kind: actual ? isStandaloneNode(actual) ? 'chapterTitle' : actual.kind : 'passage', chapter: scene ? chapters.get(scene.chapterId)?.name ?? '' : '',
        ...(positions[node.id] ?? (vertical ? { x: laneStart + row * (nodeWidth + gapX), y: 60 + column * (nodeHeight + gapY) } : { x: 60 + column * (nodeWidth + gapX), y: laneStart + row * (nodeHeight + gapY) })), width: nodeWidth, height: nodeHeight });
    }
  }
  const byId = new Map(boxes.map(node => [node.id, node]));
  const connectors: FlowEdge[] = edges.flatMap(edge => {
    const from = byId.get(edge.from), to = byId.get(edge.to); if (!from || !to) return [];
    return [{ ...edge, points: flowEdgePoints(from, to, vertical, list?.flowLineStyle ?? 'elbow') }];
  });
  const linePadding = (list?.flowLineWidth ?? storyFlowDefaults.flowLineWidth) / 2 + 24, points = connectors.flatMap(edge => edge.points);
  return { nodes: boxes, edges: connectors, locations: projected.locations,
    ...(projected.callLocations ? { callLocations: projected.callLocations, nodeIds: projected.nodeIds, progressIds: projected.progressIds } : {}),
    width: Math.max(viewportWidth, ...boxes.map(node => node.x + node.width + 60), ...points.map(point => point[0] + linePadding)), height: Math.max(autoHeight, ...boxes.filter(node => positions[node.id]).map(node => node.y + node.height + 60), ...points.map(point => point[1] + linePadding)) };
}

export type StoryFlowLayout = ReturnType<typeof storyFlowLayout>;

/** A drag changes geometry only. Keep the initial extent until commit so the
 * viewport cannot shrink under the pointer; the saved layout recalculates it. */
export function moveStoryFlowLayout(graph: StoryFlowLayout, component: UiComponent, nodeId: string, position: { x: number; y: number }): StoryFlowLayout {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return graph;
  const original = graph.nodes.find(node => node.id === nodeId);
  if (!original || original.x === position.x && original.y === position.y) return graph;
  const moved = { ...original, x: position.x, y: position.y };
  const nodes = graph.nodes.map(node => node === original ? moved : node), byId = new Map(nodes.map(node => [node.id, node]));
  let width = Math.max(graph.width, moved.x + moved.width + 60), height = Math.max(graph.height, moved.y + moved.height + 60);
  const padding = (component.list?.flowLineWidth ?? storyFlowDefaults.flowLineWidth) / 2 + 24;
  const edges = graph.edges.map(edge => {
    if (edge.from !== nodeId && edge.to !== nodeId) return edge;
    const from = byId.get(edge.from), to = byId.get(edge.to);
    if (!from || !to) return edge;
    const points = flowEdgePoints(from, to, component.list?.flowDirection === 'vertical', component.list?.flowLineStyle ?? 'elbow');
    for (const point of points) { width = Math.max(width, point[0] + padding); height = Math.max(height, point[1] + padding); }
    return { ...edge, points };
  });
  return { ...graph, nodes, edges, width, height };
}

type FlowRect = Pick<FlowBox, 'x' | 'y' | 'width' | 'height'>;
type FlowPoint = [number, number];
const curveSteps = 16;

/** Remove empty pieces and redundant straight joins before either renderer sees them. */
function simplifyFlowPoints(points: FlowPoint[]): FlowPoint[] {
  const result: FlowPoint[] = [];
  for (const point of points) {
    const last = result.at(-1), before = result.at(-2);
    if (last && point[0] === last[0] && point[1] === last[1]) continue;
    if (last && before) {
      const dx = last[0] - before[0], dy = last[1] - before[1], nx = point[0] - last[0], ny = point[1] - last[1];
      if (Math.abs(dx * ny - dy * nx) < 1e-8 && dx * nx + dy * ny >= 0) result.pop();
    }
    result.push(point);
  }
  return result;
}

function roundedFlowRoute(points: FlowPoint[]): FlowPoint[] {
  const result: FlowPoint[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1], b = points[i], c = points[i + 1];
    const before = Math.hypot(b[0] - a[0], b[1] - a[1]), after = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const radius = Math.min(24, before / 2, after / 2);
    const enter: FlowPoint = [b[0] + (a[0] - b[0]) * radius / before, b[1] + (a[1] - b[1]) * radius / before];
    const exit: FlowPoint = [b[0] + (c[0] - b[0]) * radius / after, b[1] + (c[1] - b[1]) * radius / after];
    result.push(enter);
    for (let step = 1; step <= 6; step++) {
      const t = step / 6, u = 1 - t;
      result.push([u * u * enter[0] + 2 * u * t * b[0] + t * t * exit[0], u * u * enter[1] + 2 * u * t * b[1] + t * t * exit[1]]);
    }
  }
  return [...result, points.at(-1)!];
}

/** Straight lines meet the facing rectangle boundaries. Elbows and curves keep the
 * layout direction, but use the facing cross-axis sides when hand-placed nodes overlap
 * along that axis. Return paths go around both ends, including nodes at the map origin. */
export function flowEdgePoints(from: FlowRect, to: FlowRect, vertical: boolean, style: 'elbow' | 'straight' | 'curve'): FlowPoint[] {
  const same = from.x === to.x && from.y === to.y && from.width === to.width && from.height === to.height;
  if (style === 'straight' && !same) {
    const a: FlowPoint = [from.x + from.width / 2, from.y + from.height / 2], b: FlowPoint = [to.x + to.width / 2, to.y + to.height / 2];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const ratio = (rect: FlowRect) => Math.min(dx ? rect.width / 2 / Math.abs(dx) : Infinity, dy ? rect.height / 2 / Math.abs(dy) : Infinity);
    const start = ratio(from), end = ratio(to);
    // Overlapping rectangles have no exposed straight connector between them.
    return start + end >= 1 ? [] : [[a[0] + dx * start, a[1] + dy * start], [b[0] - dx * end, b[1] - dy * end]];
  }
  const swap = (rect: FlowRect): FlowRect => vertical ? { x: rect.y, y: rect.x, width: rect.height, height: rect.width } : rect;
  const a = swap(from), b = swap(to), sx = a.x + a.width, sy = a.y + a.height / 2, tx = b.x, ty = b.y + b.height / 2;
  let route: FlowPoint[], forward = false;
  if (same) {
    route = [[sx, sy], [sx + 24, sy], [sx + 24, a.y + a.height + 24], [a.x + a.width / 2, a.y + a.height + 24], [a.x + a.width / 2, a.y + a.height]];
  } else if (tx > sx) {
    route = [[sx, sy], [(sx + tx) / 2, sy], [(sx + tx) / 2, ty], [tx, ty]];
    forward = true;
  } else if (b.x + b.width > a.x && (b.y >= a.y + a.height || a.y >= b.y + b.height)) {
    const down = b.y >= a.y + a.height, start = down ? a.y + a.height : a.y, end = down ? b.y : b.y + b.height;
    route = [[a.x + a.width / 2, start], [a.x + a.width / 2, (start + end) / 2], [b.x + b.width / 2, (start + end) / 2], [b.x + b.width / 2, end]];
    forward = true;
  } else {
    const top = Math.min(a.y, b.y) - 24, outside = top >= 0 ? top : Math.max(a.y + a.height, b.y + b.height) + 24;
    route = [[sx, sy], [Math.max(sx, b.x + b.width) + 24, sy], [Math.max(sx, b.x + b.width) + 24, outside]];
    if (tx >= 24) route.push([tx - 24, outside], [tx - 24, ty], [tx, ty]);
    else route.push([b.x + b.width / 2, outside], [b.x + b.width / 2, top >= 0 ? b.y : b.y + b.height]);
  }
  let points = simplifyFlowPoints(route);
  if (style === 'curve' && points.length > 2) {
    if (forward) {
      const [start, c1, c2, end] = route;
      points = Array.from({ length: curveSteps + 1 }, (_, index) => {
        const t = index / curveSteps, u = 1 - t;
        const at = (axis: 0 | 1) => u * u * u * start[axis] + 3 * u * u * t * c1[axis] + 3 * u * t * t * c2[axis] + t * t * t * end[axis];
        return [at(0), at(1)];
      });
    } else points = roundedFlowRoute(points);
  }
  return simplifyFlowPoints(points).map(([x, y]) => vertical ? [y, x] : [x, y]);
}

/** Texture distance continues through every bend instead of restarting on each piece. */
export function flowEdgeSegments(points: readonly FlowPoint[]) {
  let distance = 0;
  return points.slice(1).flatMap((b, index) => {
    const a = points[index], dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
    if (length < 1e-8) return [];
    const segment = { a, b, length, distance, angle: Math.atan2(dy, dx) * 180 / Math.PI, vertical: dx === 0 };
    distance += length;
    return [segment];
  });
}

/** Drop onto the grid, or onto another node's edge when one is close, so hand layouts line up. */
export function snapFlowPosition(x: number, y: number, others: readonly Pick<FlowBox, 'x' | 'y'>[], grid = 10, reach = 8) {
  const snap = (value: number, axis: 'x' | 'y') => {
    let best: number | undefined;
    for (const other of others) if (Math.abs(other[axis] - value) <= reach && (best === undefined || Math.abs(other[axis] - value) < Math.abs(best - value))) best = other[axis];
    return Math.max(0, best ?? Math.round(value / grid) * grid);
  };
  return { x: snap(x, 'x'), y: snap(y, 'y') };
}
