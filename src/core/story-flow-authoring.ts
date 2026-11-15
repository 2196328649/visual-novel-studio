import type { Project } from './model';
import { storyMenuEntries, type StoryMenuEntry } from './story-menu';
import { isStandaloneNode } from './standalone-performance';

/** All story-map metadata edits share the UI draft's text synchronization path. */
export const storyFlowContentEdit = '剧情图内容';
export type FlowOwner = NonNullable<StoryMenuEntry['owner']>;
type FlowMetadata = NonNullable<Project['chapters'][number]['flowchart']>;

export function storyFlowOwner(project: Project, owner?: FlowOwner) {
  const collection = owner?.kind === 'chapter' ? project.chapters : owner?.kind === 'scene' ? project.scenes : project.nodes;
  return collection.find(item => item.id === owner?.id);
}

/** Only declared story headings can round-trip map metadata through script text. */
export function storyFlowSourceEditable(project: Project, owner?: FlowOwner) {
  if (!owner) return false;
  if (owner.kind !== 'node') return !!storyFlowOwner(project, owner);
  const node = project.nodes.find(item => item.id === owner.id);
  return !!node && node.textHeading !== false && node.kind !== 'start' && node.kind !== 'chapterTitle' && !isStandaloneNode(node);
}

export function editStoryFlowSource(project: Project, owner: FlowOwner, change: Partial<FlowMetadata>) {
  const target = storyFlowOwner(project, owner);
  if (!target || !storyFlowSourceEditable(project, owner)) return;
  target.flowchart = { ...target.flowchart, ...change };
  for (const key of ['name', 'styleId', 'visible'] as const) if (target.flowchart[key] === undefined) delete target.flowchart[key];
}

/** Re-resolve the actual owner in the current transaction, not a stale selection. */
export function editStoryFlowEntry(project: Project, nodeId: string, change: Partial<FlowMetadata>) {
  const entry = storyMenuEntries(project, 'flowchart').find(item => item.id === nodeId);
  if (entry?.owner) editStoryFlowSource(project, entry.owner, change);
}

export function storyFlowSourceLabel(project: Project, owner?: FlowOwner) {
  const target = storyFlowOwner(project, owner);
  if (!target || !owner) return '';
  const scene = owner.kind === 'scene' ? project.scenes.find(item => item.id === target.id) : owner.kind === 'node' ? project.scenes.find(item => item.id === ('sceneId' in target ? target.sceneId : undefined)) : undefined;
  const chapter = project.chapters.find(item => item.id === (owner.kind === 'chapter' ? target.id : scene?.chapterId));
  return [chapter?.name, owner.kind !== 'chapter' ? scene?.name : undefined, owner.kind === 'node' ? target.name : undefined].filter(Boolean).join(' / ');
}

/** Author groups are deliberately not a source of player-visible entries. */
export function storyFlowSources(project: Project) {
  const sceneEntry = (id: string) => project.nodes.find(node => node.sceneId === id && node.kind === 'start') ?? project.nodes.find(node => node.sceneId === id);
  const entries = new Map(storyMenuEntries(project, 'flowchart').map(entry => [entry.id, entry]));
  const sources = [
    ...project.chapters.map(item => ({ item, owner: { kind: 'chapter', id: item.id } as FlowOwner, nodeId: sceneEntry(project.scenes.find(scene => scene.chapterId === item.id && sceneEntry(scene.id))?.id ?? '')?.id })),
    ...project.scenes.map(item => ({ item, owner: { kind: 'scene', id: item.id } as FlowOwner, nodeId: sceneEntry(item.id)?.id })),
    ...project.nodes.filter(item => storyFlowSourceEditable(project, { kind: 'node', id: item.id }) || item.flowchart?.visible === true).map(item => ({ item, owner: { kind: 'node', id: item.id } as FlowOwner, nodeId: item.id })),
  ];
  return sources.map(source => {
    const visible = source.owner.kind === 'chapter' ? source.item.flowchart?.visible !== false : source.item.flowchart?.visible === true;
    const shown = source.nodeId ? entries.get(source.nodeId) : undefined;
    return { ...source, visible, editable: storyFlowSourceEditable(project, source.owner), path: storyFlowSourceLabel(project, source.owner), overriddenBy: visible && shown?.owner && (shown.owner.kind !== source.owner.kind || shown.owner.id !== source.owner.id) ? shown.owner : undefined };
  });
}
