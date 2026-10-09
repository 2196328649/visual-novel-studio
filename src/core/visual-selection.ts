import type { VisualObject } from './model';

/** Resolve the current path each render, so sibling reordering cannot retarget edits. */
export function visualInstancePath(root: VisualObject, instanceId: string): number[] | undefined {
  const matches: number[][] = [];
  const visit = (object: VisualObject, path: number[]) => {
    if (object.instanceId === instanceId) matches.push(path);
    object.children?.forEach((child, index) => visit(child, [...path, index]));
  };
  visit(root, []);
  return matches.length === 1 ? matches[0] : undefined;
}

export function renewVisualIdentities(root: VisualObject, identify: (id: string) => string) {
  const ids = new Map<string, string>();
  const visit = (object: VisualObject) => { ids.set(object.instanceId, identify(object.instanceId)); object.children?.forEach(visit); };
  visit(root);
  const renew = (object: VisualObject) => { object.instanceId = ids.get(object.instanceId)!; object.parameters?.forEach(parameter => parameter.targets.forEach(target => { target.instanceId = ids.get(target.instanceId) ?? target.instanceId; })); object.children?.forEach(renew); };
  renew(root);
  return root;
}
