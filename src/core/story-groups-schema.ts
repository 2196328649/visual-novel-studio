import { z } from 'zod';

const id = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);

/** Authoring organization only. Story IDs, scene membership and execution links stay on the nodes. */
export const storyGroupSchema = z.object({
  id, name: z.string().trim().min(1).max(120), sceneId: id, parentId: id.optional(),
  nodeIds: z.array(id), x: z.number().finite(), y: z.number().finite(),
});
export type StoryGroup = z.infer<typeof storyGroupSchema>;

export function storyGroupProblems(project: {
  storyGroups?: StoryGroup[]; scenes: { id: string }[]; nodes: { id: string; sceneId: string }[];
}): { groupId: string; message: string }[] {
  const problems: { groupId: string; message: string }[] = [];
  const groups = new Map((project.storyGroups ?? []).map(group => [group.id, group]));
  const scenes = new Set(project.scenes.map(scene => scene.id));
  const nodes = new Map(project.nodes.map(node => [node.id, node]));
  const groupIds = new Set<string>(), members = new Set<string>();
  for (const group of project.storyGroups ?? []) {
    const add = (message: string) => problems.push({ groupId: group.id, message: `剧情组“${group.name}”：${message}` });
    if (groupIds.has(group.id)) add('标识重复。');
    groupIds.add(group.id);
    if (!scenes.has(group.sceneId)) add('所属小章节已不存在。');
    if (group.parentId && (!groups.has(group.parentId) || groups.get(group.parentId)!.sceneId !== group.sceneId)) add('上级剧情组必须位于同一小章节。');
    for (const nodeId of group.nodeIds) {
      if (members.has(nodeId)) add('一个节点只能直接属于一个剧情组。');
      members.add(nodeId);
      if (nodes.get(nodeId)?.sceneId !== group.sceneId) add('成员节点必须存在并位于同一小章节。');
    }
    const visited = new Set([group.id]);
    let parent = group.parentId;
    while (parent && groups.has(parent)) {
      if (visited.has(parent)) { add('分组层级不能互相包含。'); break; }
      visited.add(parent); parent = groups.get(parent)!.parentId;
    }
  }
  return problems;
}
