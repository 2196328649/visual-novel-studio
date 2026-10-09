import type { UiButtonState, UiComponent } from './model';

export const uiHierarchyDepthLimit = 32;

/** The editor list has its own order; moving a row never changes paint order. */
export function uiListOrder(components: readonly UiComponent[]): UiComponent[] {
  return components.map((component, index) => ({ component, index }))
    .sort((a, b) => (a.component.editor?.listOrder ?? -a.index) - (b.component.editor?.listOrder ?? -b.index) || b.index - a.index)
    .map(item => item.component);
}

export interface UiListChange { id: string; change: Partial<UiComponent> }

/** Insert beside a row, keeping its sibling group and the dragged subtree's world rectangle. */
export function reorderUiList(components: readonly UiComponent[], id: string, targetId: string, placement: 'before' | 'after'): UiListChange[] {
  const source = components.find(c => c.id === id), target = components.find(c => c.id === targetId);
  if (!source || !target || source.page !== target.page || uiSubtreeIds(components, id).has(targetId)) throw new Error('请选择同页中不属于该子树的列表位置。');
  const page = components.filter(c => c.page === source.page);
  const original = uiListOrder(page).filter(c => c.parentId === target.parentId);
  const next = original.filter(c => c.id !== id);
  const index = next.findIndex(c => c.id === targetId) + (placement === 'after' ? 1 : 0);
  next.splice(index, 0, source);
  if (source.parentId === target.parentId && original.every((c, i) => c.id === next[i]?.id)) return [];
  const parentChange = source.parentId === target.parentId ? {} : reparentUiComponent(components, id, target.parentId);
  const rank = (c: UiComponent) => c.editor?.listOrder ?? -page.findIndex(item => item.id === c.id);
  const before = index > 0 ? rank(next[index - 1]) : undefined;
  const after = index + 1 < next.length ? rank(next[index + 1]) : undefined;
  const order = before === undefined ? (after ?? 0) - 1 : after === undefined ? before + 1 : before / 2 + after / 2;
  // A normal move needs only one override, preserving inheritance for other rows.
  if (Number.isFinite(order) && (before === undefined || order > before) && (after === undefined || order < after)) {
    return [{ id, change: { ...parentChange, editor: { ...source.editor, listOrder: order } } }];
  }
  return next.flatMap((c, listOrder) => c.id === id || c.editor?.listOrder !== listOrder
    ? [{ id: c.id, change: { ...(c.id === id ? parentChange : {}), editor: { ...c.editor, listOrder } } }] : []);
}

export function uiHierarchyProblems(components: readonly UiComponent[]) {
  const byId = new Map(components.map(c => [c.id, c]));
  const problems: { id: string; message: string }[] = [];
  for (const c of components) {
    const seen = new Set([c.id]);
    let next = c;
    while (next.parentId) {
      const parent = byId.get(next.parentId);
      const message = !parent ? '父对象不存在。' : parent.page !== c.page ? '父对象必须在同一页面。'
        : seen.has(parent.id) ? '子对象不能包含自己的父级，层级不能循环。'
        : seen.size >= uiHierarchyDepthLimit ? `子对象层级不能超过 ${uiHierarchyDepthLimit} 层。` : '';
      if (message) { problems.push({ id: c.id, message }); break; }
      seen.add(parent!.id); next = parent!;
    }
  }
  return problems;
}

export function uiSubtreeIds(components: readonly UiComponent[], id: string): Set<string> {
  const result = new Set([id]), children = new Map<string, string[]>();
  for (const c of components) if (c.parentId) children.set(c.parentId, [...children.get(c.parentId) ?? [], c.id]);
  const pending = [id];
  while (pending.length) for (const child of children.get(pending.pop()!) ?? []) if (!result.has(child)) { result.add(child); pending.push(child); }
  return result;
}

export function uiAncestors(components: readonly UiComponent[], id: string): UiComponent[] {
  const byId = new Map(components.map(c => [c.id, c])), result: UiComponent[] = [], seen = new Set([id]);
  let c = byId.get(id);
  while (c?.parentId && result.length < uiHierarchyDepthLimit) {
    c = byId.get(c.parentId);
    if (!c || seen.has(c.id)) break;
    seen.add(c.id); result.push(c);
  }
  return result;
}

/** Paint each subtree as a unit. A background child is behind its parent's content. */
export function uiPaintOrder(components: readonly UiComponent[]): UiComponent[] {
  const ordered = components.map((c, i) => ({ c, i })).sort((a, b) => (a.c.layer ?? a.i) - (b.c.layer ?? b.i) || a.i - b.i).map(({ c }) => c);
  const children = new Map<string | undefined, UiComponent[]>(), ids = new Set(ordered.map(c => c.id));
  for (const c of ordered) { const parent = c.parentId && ids.has(c.parentId) ? c.parentId : undefined; children.set(parent, [...children.get(parent) ?? [], c]); }
  const result: UiComponent[] = [], seen = new Set<string>();
  const visit = (c: UiComponent) => {
    if (seen.has(c.id)) return;
    seen.add(c.id);
    const kids = children.get(c.id) ?? [];
    kids.filter(c => c.childLayer === 'background').forEach(visit);
    result.push(c);
    kids.filter(c => c.childLayer !== 'background').forEach(visit);
  };
  (children.get(undefined) ?? []).forEach(visit);
  return result;
}

export interface UiHierarchyRow { component: UiComponent; state: UiButtonState; visible: boolean }

/** World rectangles are derived; authored coordinates and animation values stay local. */
export function resolveUiHierarchy(components: readonly UiComponent[], options: {
  state?: (component: UiComponent) => UiButtonState;
  visible?: (component: UiComponent) => boolean;
  design?: boolean;
  playerOpacity?: number;
} = {}): UiHierarchyRow[] {
  const byId = new Map(components.map(c => [c.id, c])), cache = new Map<string, UiHierarchyRow>();
  const resolve = (c: UiComponent, seen = new Set<string>()): UiHierarchyRow => {
    const cached = cache.get(c.id); if (cached) return cached;
    const parent = c.parentId ? byId.get(c.parentId) : undefined;
    const cycle = seen.has(c.id) || seen.size >= uiHierarchyDepthLimit;
    const p = parent && !cycle ? resolve(parent, new Set(seen).add(c.id)) : undefined;
    const rect = p?.component;
    const ownState = options.state?.(c) ?? (c.disabled ? 'disabled' : 'idle');
    const state = p?.state === 'disabled' ? 'disabled' : c.inheritState && p ? p.state : ownState;
    const visible = !cycle && (!c.parentId || !!p?.visible) && (options.visible?.(c) ?? true) && !(options.design && c.editor?.hidden);
    const style = { ...c.style, opacity: (c.style?.opacity ?? 1) * (c.style?.playerOpacity ? options.playerOpacity ?? 1 : 1) * (rect?.style?.opacity ?? 1), playerOpacity: false };
    const component: UiComponent = { ...c, style, x: (rect?.x ?? 0) + c.x * (rect?.width ?? 1), y: (rect?.y ?? 0) + c.y * (rect?.height ?? 1), width: c.width * (rect?.width ?? 1), height: c.height * (rect?.height ?? 1),
      editor: { ...c.editor, locked: c.editor?.locked || rect?.editor?.locked },
    };
    const row = { component, state, visible }; cache.set(c.id, row); return row;
  };
  return uiPaintOrder(components).map(c => resolve(c));
}

/** Reparenting preserves the visible rectangle, including the full descendant subtree. */
export function reparentUiComponent(components: readonly UiComponent[], id: string, parentId?: string): Pick<UiComponent, 'parentId' | 'x' | 'y' | 'width' | 'height' | 'childLayer' | 'inheritState'> {
  const c = components.find(c => c.id === id), parent = components.find(c => c.id === parentId);
  if (!c || parentId && (!parent || parent.page !== c.page || uiSubtreeIds(components, id).has(parentId))) throw new Error('请选择同页中不属于该子树的父对象。');
  const resolved = resolveUiHierarchy(components), world = resolved.find(row => row.component.id === id)!.component;
  const p = resolved.find(row => row.component.id === parentId)?.component;
  if (p && (!p.width || !p.height)) throw new Error('父对象的宽高必须大于零。');
  const result = { parentId, x: (world.x - (p?.x ?? 0)) / (p?.width ?? 1), y: (world.y - (p?.y ?? 0)) / (p?.height ?? 1), width: world.width / (p?.width ?? 1), height: world.height / (p?.height ?? 1),
    // Parenting adds a relationship, never replaces the parent's appearance.
    ...(parentId ? { childLayer: c.childLayer ?? 'foreground' as const, inheritState: c.inheritState ?? c.kind !== 'button' } : {}),
  };
  if (uiHierarchyProblems(components.map(item => item.id === id ? { ...item, ...result } : item)).length) throw new Error('父对象层级无效或过深。');
  return result;
}

export function duplicateUiSubtree(components: readonly UiComponent[], id: string, newId: () => string): UiComponent[] {
  const subtree = uiSubtreeIds(components, id), ids = new Map([...subtree].map(id => [id, newId()]));
  return components.filter(c => subtree.has(c.id)).map(c => ({ ...structuredClone(c), id: ids.get(c.id)!,
    name: ((c.name || c.text || c.kind) + ' 副本').slice(0, 120), parentId: c.parentId ? ids.get(c.parentId) ?? c.parentId : undefined,
    x: c.x + (c.id === id ? .02 : 0), y: c.y + (c.id === id ? .02 : 0),
  }));
}
