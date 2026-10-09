import type { ReactNode } from 'react';
import type { PreviewActor } from '../core/line-preview';

/** Add premultiplied colors inside each crossfade, then composite onto the stage. */
export function renderActorLayers(actors: PreviewActor[], render: (actor: PreviewActor) => ReactNode): ReactNode {
  const groups = new Map<string, PreviewActor[]>();
  for (const actor of actors) if (actor.blendGroup) groups.set(actor.blendGroup, [...(groups.get(actor.blendGroup) ?? []), actor]);
  const emitted = new Set<string>();
  return actors.sort((a, b) => a.layer - b.layer).map(actor => {
    if (!actor.blendGroup) return render(actor);
    if (emitted.has(actor.blendGroup)) return null;
    emitted.add(actor.blendGroup);
    return <div key={'blend:' + actor.blendGroup} className="actor-crossfade" style={{ position: 'absolute', inset: 0, isolation: 'isolate', zIndex: actor.layer }}>{groups.get(actor.blendGroup)!.map(render)}</div>;
  });
}
