import type { Project, UiComponent } from './model';
import { uiComponentTheme } from './ui-page-settings';
import { uiComponentFontSize } from './ui';
import { setCollectionOption } from './ui-collection-edit';
import { collectionPixelRect, saveSlotLayout } from './ui-collection-layout';

export type CollectionTextPart = 'chapter' | 'caption' | 'number' | 'navigation' | 'historyName' | 'historyText';
export type CollectionTextOverride = NonNullable<NonNullable<UiComponent['list']>['textStyles']>[CollectionTextPart];
export interface CollectionTextStyle {
  fontAssetId?: string; fontSize: number; textColor: string; align: 'left' | 'center' | 'right';
}

/** Parts inherit existing component/page values; old projects need no migration. */
export function collectionTextStyle(project: Project, component: UiComponent, part: CollectionTextPart, defaults: Partial<CollectionTextStyle> = {}): CollectionTextStyle {
  const theme = uiComponentTheme(project, component), list = component.list;
  const fontSize = uiComponentFontSize(component, theme, project.width, project.height);
  const legacy: Partial<CollectionTextStyle> = part === 'caption' ? { fontSize: list?.summaryFontSize ?? fontSize, align: list?.chapter ? 'left' : 'center' }
    : part === 'number' ? { textColor: list?.numberTextColor, align: 'center' }
    : part === 'navigation' ? { ...(component.kind === 'galleryGrid' ? { fontAssetId: list?.pageFontAssetId, fontSize: list?.pageFontSize ?? Math.min(fontSize, 24) } : {}), textColor: list?.pageTextColor, align: 'center' }
    : part === 'historyName' ? { fontSize: list?.historyNameFontSize ?? fontSize, align: list?.historyLayout === 'columns' ? 'right' : 'left' }
    : { align: 'left' };
  if (component.kind === 'saveSlots') {
    const layout = saveSlotLayout(project, component);
    if (part === 'navigation') legacy.fontSize = layout.fixedAuto ? Math.min(44, layout.navigation.height - 2, layout.navWidth - 12) : Math.max(8, Math.min(fontSize, 20, Math.trunc((layout.navWidth - 16) / 3)));
    if (part === 'number' && list?.number) legacy.fontSize = Math.min(fontSize, collectionPixelRect(list.number, layout.cellWidth, layout.bodyHeight).height - 4);
    if (part === 'caption' && !list?.caption) { legacy.fontSize = Math.max(8, Math.min(fontSize, 20, Math.trunc(layout.cellWidth / 15))); legacy.align = 'left'; }
  }
  const defined = (value: Partial<CollectionTextStyle>) => Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
  const validFont = (value?: string) => value && project.assets.some(asset => asset.id === value && asset.kind === 'font') ? value : undefined;
  const override = { ...list?.textStyles?.[part] };
  if (override.fontAssetId && !validFont(override.fontAssetId)) delete override.fontAssetId;
  if (legacy.fontAssetId && !validFont(legacy.fontAssetId)) delete legacy.fontAssetId;
  const resolved: CollectionTextStyle = {
    fontAssetId: validFont(component.style?.fontAssetId ?? theme.fontAssetId),
    fontSize, textColor: component.style?.textColor ?? theme.textColor, align: 'left',
    ...defined(legacy), ...defined(defaults), ...defined(override),
  };
  return { ...resolved, fontSize: Math.max(1, Math.trunc(resolved.fontSize)) };
}

/** Clearing a field removes only that override, preserving every sibling part. */
export function editCollectionTextStyle(component: UiComponent, part: CollectionTextPart, change: (style: NonNullable<CollectionTextOverride>) => void): void {
  const style = { ...component.list?.textStyles?.[part] };
  change(style);
  for (const key of Object.keys(style) as (keyof typeof style)[]) if (style[key] === undefined) delete style[key];
  const styles = { ...component.list?.textStyles };
  if (Object.keys(style).length) styles[part] = style; else delete styles[part];
  setCollectionOption(component, 'textStyles', Object.keys(styles).length ? styles : undefined);
}
