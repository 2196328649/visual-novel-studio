import { editableUiComponent, effectiveUiComponents, localUiComponents, uiComponentLimit, type Project, type UiComponent } from './model';
import { resolveUiHierarchy } from './ui-hierarchy';
import { resolveUiLayout, uiLayoutProblem, uiLayoutValues, type UiPoint } from './ui-layout';
import { transformUiLayoutRect, type UiRect } from './ui-transform';
import { uiPropertyControlFor } from './ui-property-control';
import { uiPropertyControlDesignSnapshot } from './ui-property-control-snapshot';
import { uiProperties } from './ui-properties';

export type UiArrangeTarget = 'canvas' | 'selection' | 'last';
export type UiArrangement =
  | { kind: 'align'; axis: 'x' | 'y'; edge: 'start' | 'center' | 'end'; target: UiArrangeTarget }
  | { kind: 'distribute'; axis: 'x' | 'y' }
  | { kind: 'move'; delta: UiPoint };
export interface UiRectChange { id: string; rect: UiRect }
export interface UiArrangementPlan { changes: UiRectChange[]; roots: string[]; problem?: string; distribution?: { axis: 'x' | 'y'; gap: number } }
export interface UiEditScope { page: UiComponent['page']; ownerId?: string }

function ancestors(byId: ReadonlyMap<string, UiComponent>, id: string): UiComponent[] {
  const seen = new Set([id]), result: UiComponent[] = [];
  let parent = byId.get(byId.get(id)?.parentId ?? '');
  while (parent && !seen.has(parent.id) && result.length < 32) {
    result.push(parent); seen.add(parent.id); parent = byId.get(parent.parentId ?? '');
  }
  return result;
}

/** A selected child follows its selected ancestor; never apply the movement twice. */
export function uiSelectionRoots(components: readonly UiComponent[], ids: readonly string[]): string[] {
  const selected = new Set(ids), byId = new Map(components.map(c => [c.id, c]));
  return [...selected].filter(id => byId.has(id) && !ancestors(byId, id).some(c => selected.has(c.id)));
}

export function planUiArrangement(components: readonly UiComponent[], ids: readonly string[], viewport: { width: number; height: number }, operation: UiArrangement,
  visible: (component: UiComponent) => boolean = () => true): UiArrangementPlan {
  const roots = uiSelectionRoots(components, ids);
  const fail = (problem: string): UiArrangementPlan => ({ changes: [], roots, problem });
  if (!ids.length) return fail('先选择控件；按住 Shift 或 Ctrl 点击可多选。');
  const authoredById = new Map(components.map(c => [c.id, c]));
  const rows = new Map(resolveUiHierarchy(components, { design: true, viewport, visible }).map(row => [row.component.id, row]));
  for (const id of ids) {
    const row = rows.get(id), authored = authoredById.get(id);
    if (!row || !authored) return fail('所选控件已不存在，请重新选择。');
    if (!row.visible) return fail('所选控件包含隐藏项，请先在画布显示或取消选择。');
    if (row.component.editor?.locked) return fail('所选控件或其父级已锁定，请先解锁或取消选择。');
    if ([authored, ...ancestors(authoredById, id)].some(c => uiLayoutProblem(c))) return fail('所选控件的布局版本暂不支持，请先在属性中恢复布局。');
  }
  if (!roots.length) return fail('所选控件的父子层级无效。');
  const items = roots.map(id => ({ component: authoredById.get(id)!, geometry: rows.get(id)!.geometry! }));
  for (const { component, geometry } of items) {
    if (!geometry?.inverse || !geometry.basis.width || !geometry.basis.height) return fail('控件或父容器的尺寸、缩放必须非零。');
    const parent = authoredById.get(component.parentId ?? '');
    if (operation.kind !== 'move' && parent && component.childLayer !== 'background' && uiLayoutValues(parent).flow !== 'absolute') return fail('控件由父容器自动排列，请在父容器调整间距；仍可拖动或微调局部偏移。');
  }
  if (operation.kind === 'distribute' && roots.length < 3) return fail('等距分布需要至少 3 个独立控件；父子一起选算一组。');
  if (operation.kind === 'align' && operation.target !== 'canvas' && roots.length < 2) return fail('控件之间对齐需要至少 2 个独立控件；单个控件可对齐到游戏画面。');
  const deltas = new Map<string, UiPoint>();
  let distribution: UiArrangementPlan['distribution'];
  if (operation.kind === 'move') {
    if (!Number.isFinite(operation.delta.x) || !Number.isFinite(operation.delta.y)) return fail('移动距离必须是有效数字。');
    for (const { component } of items) deltas.set(component.id, operation.delta);
  } else {
    const axis = operation.axis, size = axis === 'x' ? 'width' : 'height';
    if (operation.kind === 'align') {
      const factor = operation.edge === 'start' ? 0 : operation.edge === 'end' ? 1 : .5;
      const referenceId = operation.target === 'last' ? ids.at(-1)! : undefined;
      if (referenceId && rows.get(referenceId)!.geometry?.clippedOut) return fail('基准控件没有可见的外框，请选择其他基准。');
      const reference = referenceId ? rows.get(referenceId)!.geometry!.bounds : undefined;
      const fixed = referenceId ? new Set([referenceId, ...ancestors(authoredById, referenceId).map(c => c.id)]) : undefined;
      const start = reference ? reference[axis] : operation.target === 'canvas' ? 0 : Math.min(...items.map(item => item.geometry.bounds[axis]));
      const end = reference ? reference[axis] + reference[size] : operation.target === 'canvas' ? viewport[size] : Math.max(...items.map(item => item.geometry.bounds[axis] + item.geometry.bounds[size]));
      // A selected ancestor of the reference must also stay fixed, or its child would drift.
      for (const { component, geometry } of items) deltas.set(component.id, { x: 0, y: 0, [axis]: fixed?.has(component.id) ? 0 : start + (end - start) * factor - geometry.bounds[axis] - geometry.bounds[size] * factor });
    } else {
      const ordered = [...items].sort((a, b) => a.geometry.bounds[axis] - b.geometry.bounds[axis] || a.geometry.bounds[size] - b.geometry.bounds[size]);
      const first = ordered[0].geometry.bounds, last = ordered.at(-1)!.geometry.bounds;
      if (ordered.every(item => item.geometry.bounds[axis] === first[axis] && item.geometry.bounds[size] === first[size])) {
        return { changes: [], roots, distribution: { axis, gap: -first[size] } };
      }
      const gap = (last[axis] + last[size] - first[axis] - ordered.reduce((sum, item) => sum + item.geometry.bounds[size], 0)) / (ordered.length - 1);
      // Signed gaps are useful for overlapping buttons too. Reject only layouts
      // that would reverse their edges, or collapse unequal sizes onto the same
      // edge where floating-point transforms could swap the order on the next click.
      const unequalSizes = ordered.some(item => Math.abs(item.geometry.bounds[size] - first[size]) > 1e-8);
      if (ordered.some(item => item.geometry.bounds[size] + gap < 0
        || gap < 0 && unequalSizes && item.geometry.bounds[size] + gap <= 1e-8)) {
        return fail('无法在保持两端和控件顺序的同时等距分布，请先拉开两端控件。');
      }
      distribution = { axis, gap };
      let cursor = first[axis];
      for (const [index, { component, geometry }] of ordered.entries()) {
        // Endpoints remain exact, including when their position is parameter-controlled.
        deltas.set(component.id, { x: 0, y: 0, [axis]: index === 0 || index === ordered.length - 1 ? 0 : cursor - geometry.bounds[axis] });
        cursor += geometry.bounds[size] + gap;
      }
    }
  }
  const changes: UiRectChange[] = [];
  for (const { component, geometry } of items) {
    const delta = deltas.get(component.id)!;
    if (Math.abs(delta.x) < 1e-8 && Math.abs(delta.y) < 1e-8) continue;
    const rect = transformUiLayoutRect(component, geometry, 'move', delta);
    if (!rect || !Object.values(rect).every(Number.isFinite)) return fail('当前控件无法换算到父容器坐标。');
    changes.push({ id: component.id, rect });
  }
  // Moving a child can change a scroll container's clamped offset. Reject drift atomically.
  const byId = new Map(changes.map(change => [change.id, change.rect]));
  const after = resolveUiLayout(components.map(c => byId.has(c.id) ? { ...c, ...byId.get(c.id) } : c), viewport, c => visible(c) && !c.editor?.hidden);
  for (const { component, geometry } of items) {
    const bounds = after.get(component.id)?.bounds, delta = deltas.get(component.id)!;
    if (!bounds || Math.abs(bounds.x - geometry.bounds.x - delta.x) > 1e-5 || Math.abs(bounds.y - geometry.bounds.y - delta.y) > 1e-5) return fail('这次移动会改变滚动容器的边界，请先调整父容器。');
  }
  return { changes, roots, ...(distribution && { distribution }) };
}

export function uiRectChangeProblem(project: Project, scope: UiEditScope, changes: readonly UiRectChange[]): string | undefined {
  if (!changes.length) return;
  const custom = scope.page === 'custom' ? project.ui.customPages.find(p => p.id === scope.ownerId) : undefined;
  if (scope.page === 'custom' ? !custom : project.ui.activeInstanceId !== scope.ownerId) return '页面或界面方案已切换，请重新操作。';
  const components = custom?.components ?? effectiveUiComponents(project.ui), local = custom?.components ?? localUiComponents(project.ui);
  const componentIds = new Set(components.filter(c => c.page === scope.page).map(c => c.id)), localIds = new Set(local.map(c => c.id));
  if (changes.some(change => !componentIds.has(change.id))) return '所选控件已不存在，请重新选择。';
  for (const change of changes) {
    const component = components.find(item => item.id === change.id)!;
    const shown = uiPropertyControlDesignSnapshot(project, component).component;
    for (const property of ['x', 'y', 'width', 'height'] as const) {
      if (uiPropertyControlFor(project, component, property) && Math.abs(change.rect[property] - shown[property]) > 1e-9) {
        return `${component.name || component.text || '此控件'}的${uiProperties[property].name}已关联参数；请在属性中调整来源，或改回默认设置后再操作。`;
      }
    }
  }
  const newIds = new Set(changes.filter(change => !localIds.has(change.id)).map(change => change.id));
  if (local.length + newIds.size > uiComponentLimit) return '本地组件数量不足以覆盖所有所选控件；本次未修改任何控件。';
  if (changes.some(change => !Object.values(change.rect).every(Number.isFinite) || change.rect.width < 0 || change.rect.height < 0)) return '控件位置或尺寸无效。';
}

export function applyUiRectChanges(project: Project, scope: UiEditScope, changes: readonly UiRectChange[]): void {
  const problem = uiRectChangeProblem(project, scope, changes);
  if (problem) throw new Error(problem);
  for (const change of changes) {
    const component = scope.page === 'custom' ? project.ui.customPages.find(p => p.id === scope.ownerId)!.components.find(c => c.id === change.id) : editableUiComponent(project.ui, change.id);
    // Plans use the displayed rectangle. Only unlinked fields may become new
    // design values; a linked width must not leak into an unrelated Y move.
    for (const property of ['x', 'y', 'width', 'height'] as const) {
      if (!uiPropertyControlFor(project, component!, property)) component![property] = change.rect[property];
    }
  }
}
