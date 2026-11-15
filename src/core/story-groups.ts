import { makeId, type Project } from './model';
import type { StoryGroup } from './story-groups-schema';

export type { StoryGroup } from './story-groups-schema';
export const storyGroupNodeId = (id: string) => 'story:group:' + id;
export const storySceneNodeId = (id: string) => 'story:scene:' + id;

/** Build once per project snapshot; all projections share the same ownership and ancestry. */
export function storyGroupIndex(project: Project) {
  const groups = new Map((project.storyGroups ?? []).map(group => [group.id, group]));
  const nodeGroup = new Map<string, string>();
  const children = new Map<string | undefined, StoryGroup[]>();
  for (const group of groups.values()) {
    children.set(group.parentId, [...(children.get(group.parentId) ?? []), group]);
    for (const id of group.nodeIds) nodeGroup.set(id, group.id);
  }
  const cache = new Map<string, ReadonlySet<string>>();
  const members = (groupId: string): ReadonlySet<string> => {
    const saved = cache.get(groupId); if (saved) return saved;
    const ids = new Set<string>(), seen = new Set<string>(), pending = [groupId];
    while (pending.length) {
      const id = pending.pop()!; if (seen.has(id)) continue;
      seen.add(id);
      for (const nodeId of groups.get(id)?.nodeIds ?? []) ids.add(nodeId);
      for (const child of children.get(id) ?? []) pending.push(child.id);
    }
    cache.set(groupId, ids); return ids;
  };
  const ancestors = (groupId?: string): StoryGroup[] => {
    const path: StoryGroup[] = [], seen = new Set<string>();
    while (groupId && !seen.has(groupId)) {
      const group = groups.get(groupId); if (!group) break;
      seen.add(groupId); path.unshift(group); groupId = group.parentId;
    }
    return path;
  };
  return { groups, nodeGroup, children, members, ancestors };
}
export type StoryGroupIndex = ReturnType<typeof storyGroupIndex>;

/** Text edits and node deletion can remove or move members. Keep valid stable IDs and empty authored groups. */
export function pruneStoryGroups(project: Project) {
  if (!project.storyGroups?.length) return;
  const scenes = new Set(project.scenes.map(scene => scene.id));
  const nodes = new Map(project.nodes.map(node => [node.id, node]));
  const retained = project.storyGroups.filter(group => scenes.has(group.sceneId));
  if (retained.length !== project.storyGroups.length) project.storyGroups = retained;
  const groups = new Map(retained.map(group => [group.id, group]));
  for (const group of project.storyGroups) {
    const members = group.nodeIds.filter(id => nodes.get(id)?.sceneId === group.sceneId);
    if (members.length !== group.nodeIds.length) group.nodeIds = members;
    if (group.parentId && groups.get(group.parentId)?.sceneId !== group.sceneId) delete group.parentId;
  }
}

export function createStoryGroup(project: Project, options: {
  name: string; sceneId: string; parentId?: string; nodeIds: string[]; groupIds: string[];
}): StoryGroup {
  const name = options.name.trim();
  if (!name || name.length > 120) throw new Error('请输入 1～120 字的剧情组名称。');
  const index = storyGroupIndex(project);
  const parent = options.parentId ? index.groups.get(options.parentId) : undefined;
  if (!project.scenes.some(scene => scene.id === options.sceneId) || options.parentId && parent?.sceneId !== options.sceneId) throw new Error('所属小章节或上级剧情组已不存在。');
  const nodeIds = [...new Set(options.nodeIds)], groupIds = [...new Set(options.groupIds)];
  if (!nodeIds.length && !groupIds.length) throw new Error('请先框选要打组的剧情节点或剧情组。');
  const nodes = nodeIds.map(id => project.nodes.find(node => node.id === id));
  const groups = groupIds.map(id => index.groups.get(id));
  if (nodes.some(node => !node || node.sceneId !== options.sceneId || index.nodeGroup.get(node.id) !== options.parentId)
    || groups.some(group => !group || group.sceneId !== options.sceneId || group.parentId !== options.parentId)) throw new Error('只能对同一小章节、同一层级的完整节点或剧情组打组。');
  const items = [...nodes, ...groups] as { x: number; y: number }[];
  const group: StoryGroup = { id: makeId('story_group'), name, sceneId: options.sceneId,
    ...(options.parentId ? { parentId: options.parentId } : {}), nodeIds,
    x: Math.min(...items.map(item => item.x)), y: Math.min(...items.map(item => item.y)),
  };
  // All checks precede edits so mutable callers also get an atomic operation.
  if (parent) parent.nodeIds = parent.nodeIds.filter(id => !nodeIds.includes(id));
  for (const child of groups) child!.parentId = group.id;
  (project.storyGroups ??= []).push(group);
  return group;
}

/** Expand current contents at the group's current location, including edits made while inside it. */
export function ungroupStoryGroup(project: Project, groupId: string) {
  const group = project.storyGroups?.find(item => item.id === groupId);
  if (!group) throw new Error('剧情组已不存在。');
  const nodes = project.nodes.filter(node => group.nodeIds.includes(node.id));
  const children = project.storyGroups!.filter(item => item.parentId === groupId);
  const items = [...nodes, ...children];
  if (items.length) {
    const dx = group.x - Math.min(...items.map(item => item.x)), dy = group.y - Math.min(...items.map(item => item.y));
    for (const item of items) { item.x += dx; item.y += dy; }
  }
  const parent = project.storyGroups!.find(item => item.id === group.parentId);
  if (parent) parent.nodeIds.push(...nodes.map(node => node.id));
  for (const child of children) { if (parent) child.parentId = parent.id; else delete child.parentId; }
  project.storyGroups = project.storyGroups!.filter(item => item.id !== groupId);
}

export function addNodeToStoryGroup(project: Project, nodeId: string, groupId?: string) {
  if (!groupId) return;
  const group = project.storyGroups?.find(item => item.id === groupId), node = project.nodes.find(item => item.id === nodeId);
  if (!group || !node || group.sceneId !== node.sceneId) throw new Error('新节点与剧情组必须位于同一小章节。');
  if (project.storyGroups?.some(item => item.nodeIds.includes(nodeId))) throw new Error('节点已经属于剧情组。');
  group.nodeIds.push(nodeId);
}
