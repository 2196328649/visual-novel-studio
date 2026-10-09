import { projectGraphs } from './project-resources';
import type { Asset, AssetCategory, BlueprintGraph, BlueprintNode, BlueprintPin, Project } from './model';
import { rawSavedBlueprintAction } from './blueprint-authoring';
import { visualInputFields } from './visual-object';
import { visualAssetKind } from './visual-parameters';

export interface BlueprintAssetFilter { kind: Asset['kind'] | 'all'; category: AssetCategory | 'all' }
/** A node's asset input has the same format in its inline editor and public parameters. */
export function blueprintNodeAssetFilter(node: BlueprintNode, pinId: string): BlueprintAssetFilter | undefined {
  const action = rawSavedBlueprintAction(node);
  const field = action?.kind === 'visual' ? visualInputFields(action).find(f => 'object_' + f.key === pinId) : undefined;
  const kind = action?.kind === 'visual' && field ? visualAssetKind(action, field.path) : action?.kind === 'audioClip' && pinId === 'clip_assetId' ? 'audio' :
    (node.type === 'playSound' || node.type === 'playMusic') && pinId === 'assetId' || pinId === 'soundId' ? 'audio' :
      node.type === 'showBackground' && pinId === 'assetId' || node.type === 'showChapter' && ['backgroundId', 'titleImageId'].includes(pinId) ? 'image' : undefined;
  if (!kind) return;
  return { kind, category: kind === 'font' ? 'font' : kind === 'video' ? 'video' : kind === 'audio' ? node.type === 'playMusic' ? 'bgm' : node.type === 'playSound' || pinId === 'soundId' ? 'sound' : 'all' : pinId === 'titleImageId' || field?.path.at(-1) === 'maskAssetId' ? 'ui' : node.type === 'showBackground' || pinId === 'backgroundId' ? 'scene' : 'all' };
}
/** Follow every consumer, including nested call parameters, so all pickers share one constraint. */
export function blueprintAssetFilter(project: Project, graph: BlueprintGraph, pin: BlueprintPin): BlueprintAssetFilter {
  const filters: BlueprintAssetFilter[] = [], visited = new Set<string>();
  const follow = (g: BlueprintGraph, nodeId: string) => {
    const key = g.id + '/' + nodeId; if (visited.has(key)) return; visited.add(key);
    for (const link of g.links.filter(l => l.fromNodeId === nodeId)) {
      const node = g.nodes.find(n => n.id === link.toNodeId); if (!node) continue;
      const child = ['callFunction', 'callMacro'].includes(node.type) ? projectGraphs(project).find(g => g.id === node.properties.graphId) : undefined;
      if (child) { for (const reader of child.nodes.filter(n => n.type === 'getInput' && n.properties.inputId === link.toPinId.replace(/^arg_/, ''))) follow(child, reader.id); continue; }
      const filter = blueprintNodeAssetFilter(node, link.toPinId);
      if (filter) filters.push(filter);
      else if (node.type === 'select') follow(g, node.id);
    }
  };
  for (const reader of graph.nodes.filter(n => n.type === 'getInput' && n.properties.inputId === pin.id)) follow(graph, reader.id);
  if (filters.length && filters.every(f => f.kind === filters[0].kind)) return { kind: filters[0].kind, category: filters.every(f => f.category === filters[0].category) ? filters[0].category : 'all' };
  const fallback = project.assets.find(a => a.id === pin.defaultValue);
  return { kind: fallback?.kind ?? 'all', category: 'all' };
}
