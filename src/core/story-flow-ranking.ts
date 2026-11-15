import type { FlowConnection } from './story-flow-connections';

/** The lowest authored index wins, including nodes that become ready later. */
class ReadyNodes {
  private values: number[] = [];
  push(value: number) {
    const items = this.values;
    let index = items.length;
    items.push(value);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (items[parent] <= value) break;
      items[index] = items[parent]; index = parent;
    }
    items[index] = value;
  }
  pop(): number | undefined {
    const items = this.values, first = items[0], last = items.pop();
    if (!items.length) return first;
    let index = 0;
    while (index * 2 + 1 < items.length) {
      let child = index * 2 + 1;
      if (child + 1 < items.length && items[child + 1] < items[child]) child++;
      if (items[child] >= last!) break;
      items[index] = items[child]; index = child;
    }
    items[index] = last!;
    return first;
  }
}

/** Preserve the existing first-ready ordering and first-remaining cycle break,
 * indexing each edge once instead of rescanning the whole graph for every candidate. */
export function storyFlowRanking(ids: readonly string[], edges: readonly FlowConnection[]) {
  const index = new Map(ids.map((id, i) => [id, i]));
  const incoming = ids.map(() => [] as number[]), outgoing = ids.map(() => [] as number[]);
  const remaining = new Uint32Array(ids.length), done = new Uint8Array(ids.length), ranks = new Int32Array(ids.length);
  for (const edge of edges) {
    const from = index.get(edge.from), to = index.get(edge.to);
    if (from === undefined || to === undefined) continue;
    incoming[to].push(from);
    if (from !== to) { outgoing[from].push(to); remaining[to]++; }
  }
  const ready = new ReadyNodes();
  for (let i = 0; i < ids.length; i++) if (!remaining[i]) ready.push(i);
  let fallback = 0;
  for (let count = 0; count < ids.length; count++) {
    let next = ready.pop();
    while (next !== undefined && done[next]) next = ready.pop();
    while (done[fallback]) fallback++;
    next ??= fallback;
    let rank = 0;
    for (const parent of incoming[next]) if (done[parent]) rank = Math.max(rank, ranks[parent] + 1);
    ranks[next] = rank; done[next] = 1;
    for (const child of outgoing[next]) if (!--remaining[child] && !done[child]) ready.push(child);
  }
  return { rank: new Map(ids.map((id, i) => [id, ranks[i]])), incoming: new Map(ids.map((id, i) => [id, incoming[i].map(parent => ids[parent])])) };
}
