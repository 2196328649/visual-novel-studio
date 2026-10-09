import { connectNode, makeId, newNode, targets, type Project, type StoryNode } from './model';

export type ModulePlacement = 'above' | 'below';
export type ModuleKind = 'dialogue' | 'standalone';

export function createStoryModule(kind: ModuleKind, sceneId: string): StoryNode {
  const node = newNode('passage', sceneId);
  if (node.kind !== 'passage') throw new Error('无法创建剧情模块');
  node.name = kind === 'standalone' ? '新的独立演出' : '新的剧情';
  node.lines = [{ id: makeId('line'), text: '', actions: [], ...(kind === 'standalone' ? { silent: true } : {}) }];
  return node;
}

export function copyStoryModule(source: StoryNode): StoryNode {
  const node = structuredClone(source);
  node.id = makeId('node');
  if (node.kind === 'passage') node.lines.forEach(line => { line.id = makeId('line'); });
  if (node.kind === 'choice') node.choices.forEach(choice => { choice.id = makeId('option'); });
  if (node.kind === 'interaction') node.hotspots.forEach(hotspot => { hotspot.id = makeId('hotspot'); });
  return node;
}

/** Insert in both the editor list and the ordinary execution path. */
export function insertStoryModule(project: Project, node: StoryNode, sceneId: string, anchorId?: string, placement: ModulePlacement = 'below') {
  const anchor = project.nodes.find(item => item.id === anchorId) ?? project.nodes.filter(item => item.sceneId === sceneId).at(-1);
  node.sceneId = anchor?.sceneId ?? sceneId;
  const at = anchor ? project.nodes.indexOf(anchor) + (placement === 'below' ? 1 : 0) : project.nodes.length;
  node.x = anchor?.x ?? 80; node.y = (anchor?.y ?? 0) + (placement === 'above' ? -100 : 100);
  if (placement === 'above' && anchor) {
    project.nodes = project.nodes.map(item => targets(item).reduce((result, port) => port.target === anchor.id ? connectNode(result, port.port, node.id) : result, item));
    if (project.entryId === anchor.id) project.entryId = node.id;
    node = connectNode(node, 'next', anchor.id);
  } else if (anchor && 'next' in anchor) {
    node = connectNode(node, 'next', anchor.next);
    project.nodes = project.nodes.map(item => item.id === anchor.id ? connectNode(item, 'next', node.id) : item);
  } else if (anchor?.kind === 'passage' || anchor?.kind === 'start' || anchor?.kind === 'set' || anchor?.kind === 'call' || anchor?.kind === 'chapterTitle') {
    node = connectNode(node, 'next', undefined);
    project.nodes = project.nodes.map(item => item.id === anchor.id ? connectNode(item, 'next', node.id) : item);
  } else node = connectNode(node, 'next', undefined);
  project.nodes.splice(at, 0, node);
  return node.id;
}

/** Removing an ordinary module reconnects its incoming paths to its successor. */
export function removeStoryModule(project: Project, id: string) {
  const node = project.nodes.find(item => item.id === id);
  if (!node || node.kind === 'start') return;
  const successor = 'next' in node && node.next !== id ? node.next : undefined;
  if (project.entryId === id && !successor) return;
  project.nodes = project.nodes.filter(item => item.id !== id).map(item => targets(item).reduce((result, port) => port.target === id ? connectNode(result, port.port, successor) : result, item));
  if (project.entryId === id && successor) project.entryId = successor;
}
