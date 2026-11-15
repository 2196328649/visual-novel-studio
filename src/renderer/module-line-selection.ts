import type { Project } from '../core/model';

/** Keep a surviving selection. After removal (including undo), prefer the next
 * surviving line from the old order, then the preceding one in this passage. */
export function moduleLineSelection(project: Project, nodeId: string | undefined, lineId: string | undefined, previous: Project): string | undefined {
  if (!lineId) return;
  const node = project.nodes.find(item => item.id === nodeId);
  if (node?.kind !== 'passage') return;
  if (node.lines.some(line => line.id === lineId)) return lineId;
  const before = previous.id === project.id ? previous.nodes.find(item => item.id === nodeId) : undefined;
  const index = before?.kind === 'passage' ? before.lines.findIndex(line => line.id === lineId) : -1;
  if (before?.kind === 'passage' && index >= 0) {
    const remaining = new Set(node.lines.map(line => line.id));
    for (let next = index + 1; next < before.lines.length; next++) if (remaining.has(before.lines[next].id)) return before.lines[next].id;
    for (let prior = index - 1; prior >= 0; prior--) if (remaining.has(before.lines[prior].id)) return before.lines[prior].id;
    return node.lines[Math.min(index, node.lines.length - 1)]?.id;
  }
  return node.lines[0]?.id;
}
