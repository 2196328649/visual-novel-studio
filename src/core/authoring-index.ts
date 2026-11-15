import { effectiveUiComponents, type Asset, type CustomUiPage, type Project, type UiComponent, type UiInstance, type UiTheme } from './model';

export interface AssetAuthoringIndex {
  readonly all: readonly Asset[];
  readonly byId: ReadonlyMap<string, Asset>;
  readonly byKind: ReadonlyMap<Asset['kind'], readonly Asset[]>;
}
export interface UiAuthoringIndex {
  readonly all: readonly UiComponent[];
  readonly byId: ReadonlyMap<string, UiComponent>;
  readonly declaredById: ReadonlyMap<string, UiComponent>;
  readonly byPage: ReadonlyMap<string, readonly UiComponent[]>;
  readonly customPageById: ReadonlyMap<string, CustomUiPage>;
  readonly customPageByComponentId: ReadonlyMap<string, CustomUiPage>;
}
export function authoringItem<T>(byId: ReadonlyMap<string, T>, id: unknown): T | undefined {
  return typeof id === 'string' ? byId.get(id) : undefined;
}
const noInstances: UiInstance[] = [];
type InstanceIndexes = { ids: ReadonlySet<string>; pages: WeakMap<CustomUiPage[], Map<string, UiAuthoringIndex>> };
export const noUiComponents: readonly UiComponent[] = Object.freeze([]);

/** Match Array.find on duplicate/invalid identities; diagnostics own their rejection. */
function firstById<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  const result = new Map<string, T>();
  for (const item of items) if (!result.has(item.id)) result.set(item.id, item);
  return result;
}
function assetIndex(assets: Project['assets']): AssetAuthoringIndex {
  const byKind = new Map<Asset['kind'], Asset[]>();
  for (const asset of assets) {
    const group = byKind.get(asset.kind) ?? [];
    group.push(asset); byKind.set(asset.kind, group);
  }
  return { all: assets, byId: firstById(assets), byKind };
}
function uiIndex(theme: UiTheme): UiAuthoringIndex {
  const effective = effectiveUiComponents(theme), pages = theme.customPages;
  const all = [...effective, ...pages.flatMap(page => page.components)];
  const byPage = new Map<string, UiComponent[]>();
  for (const component of effective) {
    const id = 'ui:' + component.page, group = byPage.get(id) ?? [];
    group.push(component); byPage.set(id, group);
  }
  const customPageById = firstById(pages), customPageByComponentId = new Map<string, CustomUiPage>();
  for (const page of pages) {
    // uiPageComponents interprets the ui: prefix as a native page, even for invalid documents.
    if (!page.id.startsWith('ui:') && customPageById.get(page.id) === page) byPage.set(page.id, page.components);
    for (const component of page.components) if (!customPageByComponentId.has(component.id)) customPageByComponentId.set(component.id, page);
  }
  const declaredById = new Map(all.map(component => [component.id, component]));
  for (const component of [...theme.components, ...(theme.instances ?? []).flatMap(instance => instance.components)]) {
    if (!declaredById.has(component.id)) declaredById.set(component.id, component);
  }
  return { all, byId: firstById(all), declaredById, byPage, customPageById, customPageByComponentId };
}

/** Opt in only for immutable COW snapshots, never for a mutable authoring draft.
 * Default callers always rebuild, so in-place edits cannot leave stale IDs or inheritance.
 * Each cache axis follows only its dependencies, not the whole Project or graph revision.
 * Weak keys let old histories/projects be collected; active-instance keys are bounded by
 * the immutable instance list and can be reused when switching schemes or undoing edits. */
export class AuthoringIndexCache {
  private assetCache = new WeakMap<Project['assets'], AssetAuthoringIndex>();
  private uiCache = new WeakMap<UiTheme['components'], WeakMap<UiInstance[], InstanceIndexes>>();
  constructor(private readonly options: { assumeImmutable?: boolean } = {}) {}
  assets(project: Pick<Project, 'assets'>): AssetAuthoringIndex {
    if (!this.options.assumeImmutable) return assetIndex(project.assets);
    let result = this.assetCache.get(project.assets);
    if (!result) { result = assetIndex(project.assets); this.assetCache.set(project.assets, result); }
    return result;
  }
  ui(project: Pick<Project, 'ui'>): UiAuthoringIndex {
    const theme = project.ui;
    if (!this.options.assumeImmutable) return uiIndex(theme);
    const instances = theme.instances ?? noInstances;
    let byInstances = this.uiCache.get(theme.components);
    if (!byInstances) { byInstances = new WeakMap(); this.uiCache.set(theme.components, byInstances); }
    let entry = byInstances.get(instances);
    if (!entry) { entry = { ids: new Set(instances.map(instance => instance.id)), pages: new WeakMap() }; byInstances.set(instances, entry); }
    let byActive = entry.pages.get(theme.customPages);
    if (!byActive) { byActive = new Map(); entry.pages.set(theme.customPages, byActive); }
    // An unresolved/empty active identity means the base scheme in effectiveUiComponents.
    const active = entry.ids.has(theme.activeInstanceId ?? '') ? theme.activeInstanceId! : '';
    let result = byActive.get(active);
    if (!result) { result = uiIndex(theme); byActive.set(active, result); }
    return result;
  }
}
