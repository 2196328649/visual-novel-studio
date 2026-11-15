import { z } from 'zod';

const id = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const position = z.object({ x: z.number().finite(), y: z.number().finite() });
const positions = z.record(z.string(), position);

/** A display entry keeps a real story destination; it never becomes executable content. */
export const playerFlowEntrySchema = z.object({
  nodeId: id,
  owner: z.object({ kind: z.enum(['chapter', 'scene', 'node']), id }).optional(),
  // Existing script heading names are unbounded; copying their displayed text must stay lossless.
  name: z.string().optional(),
  styleId: id.optional(),
  action: z.enum(['replay', 'inspect']).optional(),
});

export const playerFlowGroupSchema = z.object({
  id,
  name: z.string().min(1).max(120),
  nodeIds: z.array(id),
  collapsed: z.boolean().optional(),
  position: position.optional(),
  // Interior coordinates are independent from the group's root card and its former root members.
  positions: positions.optional(),
});

/** Omission is the original script-driven graph. Both modes retain their own saved layout. */
export const playerFlowContentSchema = z.object({
  mode: z.enum(['script', 'custom']),
  // Derived call bodies share a layout, while each call card keeps its outer position.
  // These scopes are display-only and never become story nodes or custom entries.
  scriptViews: z.record(z.string(), positions).optional(),
  custom: z.object({
    entries: z.array(playerFlowEntrySchema),
    positions: positions.optional(),
    views: z.record(z.string(), positions).optional(),
    groups: z.array(playerFlowGroupSchema).optional(),
  }).optional(),
}).superRefine((content, context) => {
  const nodes = new Set<string>(), groups = new Set<string>(), members = new Set<string>();
  for (const [index, entry] of (content.custom?.entries ?? []).entries()) {
    if (nodes.has(entry.nodeId)) context.addIssue({ code: 'custom', path: ['custom', 'entries', index, 'nodeId'], message: '同一剧情入口在本图中只能添加一次。' });
    nodes.add(entry.nodeId);
  }
  for (const [index, group] of (content.custom?.groups ?? []).entries()) {
    if (groups.has(group.id) || nodes.has(group.id)) context.addIssue({ code: 'custom', path: ['custom', 'groups', index, 'id'], message: '剧情分组 ID 不能与节点或其他分组重复。' });
    groups.add(group.id);
    for (const [memberIndex, nodeId] of group.nodeIds.entries()) {
      if (!nodes.has(nodeId)) context.addIssue({ code: 'custom', path: ['custom', 'groups', index, 'nodeIds', memberIndex], message: '分组成员需要先添加到本图。' });
      if (members.has(nodeId)) context.addIssue({ code: 'custom', path: ['custom', 'groups', index, 'nodeIds', memberIndex], message: '一个节点只能属于一个剧情分组。' });
      members.add(nodeId);
    }
  }
});

export type FlowPosition = z.infer<typeof position>;
export type PlayerFlowEntry = z.infer<typeof playerFlowEntrySchema>;
export type PlayerFlowGroup = z.infer<typeof playerFlowGroupSchema>;
export type PlayerFlowContent = z.infer<typeof playerFlowContentSchema>;
