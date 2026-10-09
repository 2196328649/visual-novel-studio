import { targets, type Project, type StoryNode, type UiComponent } from './model';
import { storyMenuEntries } from './story-menu';
export interface FlowBox { id: string; name: string; kind: StoryNode['kind']; styleId?: string; chapter: string; x: number; y: number; width: number; height: number }
import { isStandaloneNode } from './standalone-performance';
export interface FlowEdge { from: string; to: string; label: string; points: [number, number][] }

/** Collapse hidden implementation nodes while preserving branches, merges and loop exits. */
export function storyFlowLayout(project: Project, component: UiComponent) {
  const list = component.list;
  const nodeWidth = list?.itemWidth ?? 350, nodeHeight = list?.itemHeight ?? 80, gapX = list?.gapX ?? 100, gapY = list?.gapY ?? 90;
  const all = new Map(project.nodes.map(node => [node.id, node]));
  const entries = new Map(storyMenuEntries(project, 'flowchart').map(entry => [entry.nodeId!, entry]));
  const shown = new Set(entries.keys());
  const visible = project.nodes.filter(node => shown.has(node.id));
  const locations = new Map(visible.map(node => [node.id, { id: node.id, distance: 0 }]));
  const edges: { from: string; to: string; label: string }[] = [];
  const labelFor = (node: StoryNode, port: string) => node.kind === 'choice' ? node.choices.find(choice => choice.id === port)?.text ?? '' : node.kind === 'condition' ? port === 'yes' ? '条件满足' : '条件未满足' : '';
  for (const source of visible) {
    const pending = targets(source).filter(edge => edge.target).map(edge => ({ target: edge.target!, label: labelFor(source, edge.port), distance: 1 }));
    const visited = new Set<string>();
    while (pending.length) {
      const next = pending.shift()!, node = all.get(next.target);
      const visitKey = JSON.stringify([next.target, next.label]);
      if (!node || visited.has(visitKey)) continue;
      visited.add(visitKey);
      if (shown.has(node.id)) {
        const previous = edges.find(edge => edge.from === source.id && edge.to === node.id);
        if (previous) { if (next.label && !previous.label.split(' / ').includes(next.label)) previous.label = [previous.label, next.label].filter(Boolean).join(' / '); }
        else edges.push({ from: source.id, to: node.id, label: next.label });
        continue;
      }
      if (next.distance < (locations.get(node.id)?.distance ?? Infinity)) locations.set(node.id, { id: source.id, distance: next.distance });
      pending.push(...targets(node).filter(edge => edge.target).map(edge => ({ target: edge.target!, label: next.label || labelFor(node, edge.port), distance: next.distance + 1 })));
    }
  }
  const rank = new Map<string, number>(), done = new Set<string>();
  while (done.size < visible.length) {
    const remaining = visible.filter(node => !done.has(node.id));
    const node = remaining.find(node => edges.filter(edge => edge.to === node.id && edge.from !== node.id).every(edge => done.has(edge.from))) ?? remaining[0];
    const incoming = edges.filter(edge => edge.to === node.id && done.has(edge.from));
    rank.set(node.id, incoming.length ? Math.max(...incoming.map(edge => (rank.get(edge.from) ?? 0) + 1)) : 0);
    done.add(node.id);
  }
  const groups = new Map<number, StoryNode[]>();
  for (const node of visible) groups.set(rank.get(node.id)!, [...(groups.get(rank.get(node.id)!) ?? []), node]);
  const rowCount = Math.max(3, ...[...groups.values()].map(group => group.length)), center = (rowCount - 1) / 2;
  const lane = new Map<string, number>(), boxes: FlowBox[] = [];
  const viewportWidth = component.width * project.width * (list?.flowViewport?.width ?? 1);
  const viewportHeight = component.height * project.height * (list?.flowViewport?.height ?? 1);
  const height = Math.max(viewportHeight - 34, rowCount * nodeHeight + (rowCount - 1) * gapY + 80);
  const top = Math.max(40, (height - (rowCount * nodeHeight + (rowCount - 1) * gapY)) / 2);
  for (const [column, nodes] of [...groups].sort(([a], [b]) => a - b)) {
    const free = Array.from({ length: rowCount }, (_, index) => index);
    for (const node of nodes) {
      const parents = edges.filter(edge => edge.to === node.id).flatMap(edge => lane.has(edge.from) ? [lane.get(edge.from)!] : []);
      const desired = parents.length ? parents.reduce((sum, value) => sum + value, 0) / parents.length : center;
      const row = [...free].sort((a, b) => Math.abs(a - desired) - Math.abs(b - desired) || a - b)[0]; free.splice(free.indexOf(row), 1); lane.set(node.id, row);
      const scene = project.scenes.find(scene => scene.id === node.sceneId);
      boxes.push({ id: node.id, name: entries.get(node.id)!.name, ...(entries.get(node.id)!.styleId ? { styleId: entries.get(node.id)!.styleId } : {}), kind: isStandaloneNode(node) ? 'chapterTitle' : node.kind, chapter: project.chapters.find(chapter => chapter.id === scene?.chapterId)?.name ?? '', x: 60 + column * (nodeWidth + gapX), y: top + row * (nodeHeight + gapY), width: nodeWidth, height: nodeHeight });
    }
  }
  const byId = new Map(boxes.map(node => [node.id, node]));
  const connectors: FlowEdge[] = edges.flatMap(edge => {
    const from = byId.get(edge.from), to = byId.get(edge.to); if (!from || !to) return [];
    const sx = from.x + from.width, sy = from.y + from.height / 2, tx = to.x, ty = to.y + to.height / 2;
    const points: [number, number][] = tx > sx ? [[sx, sy], [(sx + tx) / 2, sy], [(sx + tx) / 2, ty], [tx, ty]] : [[sx, sy], [sx + 20, sy], [sx + 20, from.y - 24], [tx - 24, from.y - 24], [tx - 24, ty], [tx, ty]];
    return [{ ...edge, points }];
  });
  return { nodes: boxes, edges: connectors, locations: Object.fromEntries([...locations].map(([id, location]) => [id, location.id])), width: Math.max(viewportWidth, ...boxes.map(node => node.x + node.width + 60)), height };
}
