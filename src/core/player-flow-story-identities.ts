import type { Project } from './model';

export type PlayerFlowStoryIdentityKind = 'chapter' | 'scene' | 'node';

/** Read every saved reference, including inactive modes and hidden overrides.
 * New story identities must not capture these IDs; matching an existing story
 * object or restoring an explicit script marker is a separate operation. */
export function playerFlowStoryIds(project: Project): Record<PlayerFlowStoryIdentityKind, Set<string>> {
  const reserved = { chapter: new Set<string>(), scene: new Set<string>(), node: new Set<string>() };
  const containers = [project.ui.components,
    ...(project.ui.instances ?? []).map(instance => instance.components),
    ...(project.ui.customPages ?? []).map(page => page.components),
  ];
  for (const components of containers) for (const component of components) {
    for (const entry of component.list?.flowContent?.custom?.entries ?? []) {
      reserved.node.add(entry.nodeId);
      if (entry.owner) reserved[entry.owner.kind].add(entry.owner.id);
    }
  }
  return reserved;
}
