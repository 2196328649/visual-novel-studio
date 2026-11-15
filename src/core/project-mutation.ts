import { Immer, current, isDraft, original, type Draft } from 'immer';
import type { BlueprintGraph, Project } from './model';

// Existing authoring helpers also operate on fresh, mutable imports. Keep
// freezing local to their callers; editor snapshots are protected by drafting.
const transactions = new Immer({ autoFreeze: false });

/** Copy only changed branches while preserving the existing mutation API. */
export function mutateProject(before: Project, edit: (draft: Project, before: Project) => void): Project {
  return transactions.produce(before, draft => { edit(draft, before); });
}

/** Snapshot one draft record without asking Immer to recursively clone raw,
 * untouched resources under a modified root (our authoring API cannot freeze them).
 * Newly assigned mutable values are detached, so later edits cannot alter the capture. */
function snapshotRecord<T extends object>(draft: T, fields: Record<string, (value: any) => any> = {}): T {
  if (!isDraft(draft)) return cloneData(draft);
  const base = original(draft as Draft<T>) as T;
  const result: Record<string, unknown> = {};
  const keys = Object.keys(draft);
  let changed = keys.length !== Object.keys(base).length;
  for (const key of keys) {
    const value = (draft as Record<string, unknown>)[key], prior = (base as Record<string, unknown>)[key];
    const next = fields[key] ? fields[key](value) : isDraft(value) ? current(value)
      : value === prior || !value || typeof value !== 'object' ? value : cloneData(value);
    result[key] = next;
    if (!Object.hasOwn(base, key) || next !== prior) changed = true;
  }
  return changed ? result as T : base;
}

function snapshotArray<T>(array: T[], item: (value: T) => T): T[] {
  if (!isDraft(array)) return cloneData(array);
  const base = original<T[]>(array as Draft<T[]>) as T[];
  const result = array.map(item);
  return result.length === base.length && result.every((value, index) => value === base[index]) ? base : result;
}

const snapshotGraph = (graph: BlueprintGraph) => snapshotRecord(graph, {
  nodes: (nodes: BlueprintGraph['nodes']) => snapshotArray(nodes, node => isDraft(node) ? current(node) : cloneData(node)),
  links: (links: BlueprintGraph['links']) => snapshotArray(links, link => isDraft(link) ? current(link) : cloneData(link)),
});

/** Read-only transaction state; untouched resource and graph/node identities survive. */
export function projectReadSnapshot(project: Project): Project {
  return isDraft(project) ? snapshotRecord(project, {
    blueprints: (graphs: BlueprintGraph[]) => snapshotArray(graphs, snapshotGraph),
    timelinePresets: (graphs?: BlueprintGraph[]) => graphs && snapshotArray(graphs, snapshotGraph),
  }) : project;
}

/** Mutable callers need a defensive copy; transaction captures include any pending
 * performance materialization and cannot be overwritten by the following edit. */
export function projectEditSnapshot(project: Project): Project {
  return isDraft(project) ? projectReadSnapshot(project) : cloneData(project);
}

/** Native structuredClone rejects draft proxies. Authoring operations use this
 * for explicit copies (duplicate/paste/etc.), including containers of drafts. */
export function cloneData<T>(value: T): T {
  if (isDraft(value)) return structuredClone(current<T>(value as Draft<T>));
  try { return structuredClone(value); }
  catch (error) {
    if (!(error instanceof Error) || error.name !== 'DataCloneError') throw error;
    let foundDraft = false;
    const seen = new Map<object, unknown>();
    const unwrap = (item: any): any => {
      if (isDraft(item)) { foundDraft = true; return current(item); }
      if (!item || typeof item !== 'object') return item;
      if (seen.has(item)) return seen.get(item);
      if (item instanceof Map) {
        const result = new Map(); seen.set(item, result);
        for (const [key, value] of item) result.set(unwrap(key), unwrap(value));
        return result;
      }
      if (item instanceof Set) {
        const result = new Set(); seen.set(item, result);
        for (const value of item) result.add(unwrap(value));
        return result;
      }
      if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype) return item;
      const result: any = Array.isArray(item) ? [] : {}; seen.set(item, result);
      for (const key of Object.keys(item)) result[key] = unwrap(item[key]);
      return result;
    };
    const plain = unwrap(value);
    if (!foundDraft) throw error;
    return structuredClone(plain);
  }
}
