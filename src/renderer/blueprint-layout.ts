import type { ELK, ElkNode } from 'elkjs/lib/elk-api';

let engine: Promise<ELK> | undefined;

/** Share the layout engine, loading its sizeable bundle only when an author requests a layout. */
export async function layoutBlueprint(graph: ElkNode): Promise<ElkNode> {
  const elk = await (engine ??= import('elkjs/lib/elk.bundled.js')
    .then(({ default: LayoutEngine }) => new LayoutEngine())
    .catch(error => { engine = undefined; throw error; }));
  return elk.layout(graph);
}
