import type { Project, UiComponent } from './model';
import { galleryLayout, type CollectionRect } from './gallery-layout';
import { musicCollectionLayout } from './music-preview';
import { customVoiceItem, voiceCollectionLayout } from './voice-preview';
import { uiComponentBounds } from './ui';
import { uiComponentTheme } from './ui-page-settings';

export type { CollectionRect } from './gallery-layout';

export type CollectionPart = 'item' | 'thumbnail' | 'chapter' | 'caption' | 'number' | 'slotAction'
  | 'thumbnailFrame' | 'navigationRect' | 'lockedRect' | 'voiceFavoriteRect' | 'voiceReplay'
  | 'historyName' | 'historyText' | 'historyScrollbar' | 'autoSlot';
export type CollectionLayoutField = 'columns' | 'rows' | 'gapX' | 'gapY' | 'itemWidth' | 'itemHeight';
export interface CollectionLayoutValues {
  columns?: number;
  /** Zero means scrolling, represented by an absent rows property in saved data. */
  rows?: number;
  gapX?: number;
  gapY: number;
  itemWidth?: number;
  itemHeight?: number;
  fields: CollectionLayoutField[];
  pagination: 'fixed' | 'optional' | 'none';
}

const collectionKinds = new Set<UiComponent['kind']>([
  'choiceList', 'saveSlots', 'galleryGrid', 'musicTrackList', 'voiceCollection', 'chapterList', 'historyList',
]);
const gridFields: CollectionLayoutField[] = ['columns', 'rows', 'gapX', 'gapY', 'itemWidth', 'itemHeight'];
const wholeRect = (): CollectionRect => ({ x: 0, y: 0, width: 1, height: 1 });
const copyRect = ({ x, y, width, height }: CollectionRect): CollectionRect => ({ x, y, width, height });
const relativeRect = (rect: CollectionRect, width: number, height: number): CollectionRect => ({
  x: rect.x / Math.max(1, width), y: rect.y / Math.max(1, height),
  width: Math.max(1, rect.width) / Math.max(1, width), height: Math.max(1, rect.height) / Math.max(1, height),
});

export function collectionSupports(component: Pick<UiComponent, 'kind'>): boolean {
  return collectionKinds.has(component.kind);
}

/** Editable areas may extend outside their parent; only invalid or empty geometry is rejected. */
export function isCollectionRect(value: unknown): value is CollectionRect {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const rect = value as Record<string, unknown>;
  return (['x', 'y', 'width', 'height'] as const).every(key => typeof rect[key] === 'number' && Number.isFinite(rect[key]))
    && (rect.width as number) > 0 && (rect.height as number) > 0;
}

/** Match vn_ui_rect, including Python's truncation towards zero for negative positions. */
export function collectionPixelRect(rect: CollectionRect, width: number, height: number): CollectionRect {
  const x = Math.trunc(rect.x * width + .5), y = Math.trunc(rect.y * height + .5);
  return { x, y,
    width: Math.max(1, Math.min(Math.trunc(rect.width * width + .5), width - x)),
    height: Math.max(1, Math.min(Math.trunc(rect.height * height + .5), height - y)),
  };
}

/** Save-slot metrics in game pixels; only thumbnail is relative to the slot body. */
export function saveSlotLayout(project: Pick<Project, 'width' | 'height'>, component: UiComponent) {
  const { width, height } = uiComponentBounds(component, project.width, project.height), list = component.list;
  const columns = list?.columns ?? 3, rows = list?.rows ?? 2;
  const fixedAuto = !!list?.fixedAutoSlot && columns * rows > 1;
  const pageLabels = Array.from({ length: list?.pageCount ?? 6 }, (_, index) => String(index + 1));
  const navigationLabels = fixedAuto ? pageLabels : ['上一页', '自动', '快速', ...pageLabels, '下一页'];
  const gapX = Math.min(Math.trunc((list?.gapX ?? 10) + .5), Math.max(0, Math.trunc(width / (columns * 2))));
  const gapY = Math.min(Math.trunc((list?.gapY ?? 10) + .5), Math.max(0, Math.trunc(height / (rows * 3))));
  const navHeight = Math.max(24, Math.min(40, Math.trunc(height * .1)));
  const navigation = list?.navigationRect ? collectionPixelRect(list.navigationRect, width, height)
    : { x: 0, y: list?.navigation === 'bottom' ? height - navHeight : 0, width, height: navHeight };
  const navGap = Math.max(2, Math.min(8, Math.trunc(navigation.width / 150)));
  const navWidth = Math.max(1, Math.trunc((navigation.width - (navigationLabels.length - 1) * navGap) / navigationLabels.length));
  const gridTop = list?.navigation === 'bottom' ? 0 : navigation.y + navigation.height + gapY;
  const gridHeight = Math.max(1, list?.navigation === 'bottom' ? navigation.y - gapY : height - gridTop);
  const cellWidth = Math.max(1, Math.min(Math.trunc(list?.itemWidth ?? width), Math.trunc((width - (columns - 1) * gapX) / columns)));
  const cellHeight = Math.max(1, Math.min(Math.trunc(list?.itemHeight ?? height), Math.trunc((gridHeight - (rows - 1) * gapY) / rows)));
  const captionHeight = list?.showDelete !== false || (!list?.caption && list?.showLabels !== false)
    ? Math.max(18, Math.min(32, Math.trunc(cellHeight * .2))) : 0;
  const bodyHeight = Math.max(1, cellHeight - captionHeight);
  const thumbnailPixels = list?.thumbnail ? collectionPixelRect(list.thumbnail, cellWidth, bodyHeight)
    : { x: 10, y: 10, width: Math.max(1, cellWidth - 20), height: Math.max(1, bodyHeight - 20) };
  const gridLeft = Math.trunc((width - (columns * cellWidth + (columns - 1) * gapX)) / 2);
  return { width, height, columns, rows, gapX, gapY, cellWidth, cellHeight, bodyHeight, captionHeight,
    gridTop, gridHeight, gridLeft, navigation, navigationLabels, navGap, navWidth, fixedAuto,
    thumbnail: relativeRect(thumbnailPixels, cellWidth, bodyHeight),
  };
}

// Zero-size authored controls are legal. Use the same one-pixel minimum as the runtime without writing it back.
function measurableComponent(project: Pick<Project, 'width' | 'height'>, component: UiComponent): UiComponent {
  if (component.width * project.width >= 1 && component.height * project.height >= 1) return component;
  return { ...component, width: Math.max(1, component.width * project.width) / project.width,
    height: Math.max(1, component.height * project.height) / project.height };
}

function themedProject(project: Project, component: UiComponent): Project {
  return { ...project, ui: uiComponentTheme(project, component) };
}

/** Effective sizes/counts, not placeholder values or the authored limits before fitting. */
export function collectionLayoutValues(project: Project, component: UiComponent): CollectionLayoutValues {
  const list = component.list, width = Math.max(1, component.width * project.width), height = Math.max(1, component.height * project.height);
  if (component.kind === 'saveSlots') {
    const geometry = saveSlotLayout(project, component);
    return { columns: geometry.columns, rows: geometry.rows, gapX: geometry.gapX, gapY: geometry.gapY,
      itemWidth: geometry.cellWidth, itemHeight: geometry.cellHeight, fields: [...gridFields], pagination: 'fixed' };
  }
  if (component.kind === 'galleryGrid') {
    const geometry = galleryLayout(project, component), columns = list?.columns ?? 3, rows = list?.rows ?? 2;
    return { columns, rows, gapX: Math.min(list?.gapX ?? 12, width / (columns * 2)), gapY: list?.gapY ?? 12,
      itemWidth: geometry.cells[0].width * width, itemHeight: geometry.cells[0].height * height,
      fields: [...gridFields], pagination: 'fixed' };
  }
  if (component.kind === 'historyList') return {
    gapX: Math.min(Math.round(list?.gapX ?? 12), Math.max(0, Math.trunc(width / ((list?.columns ?? 1) * 2)))),
    gapY: Math.round(list?.gapY ?? 12), fields: ['gapX', 'gapY'], pagination: 'none',
  };
  const pageProject = themedProject(project, component);
  if (component.kind === 'choiceList') {
    const choice = project.nodes.find(node => node.kind === 'choice');
    const count = choice?.kind === 'choice' ? choice.choices.length : 2;
    const gapY = list?.gapY ?? 10, font = component.style?.fontSize ?? pageProject.ui.fontSize;
    const itemHeight = Math.max(32, list?.itemHeight ?? Math.max(font + 24, Math.min(80, Math.floor((height - gapY * Math.max(0, count - 1)) / Math.max(1, count)))));
    return { gapY, itemHeight, fields: ['gapY', 'itemHeight'], pagination: 'none' };
  }
  if (component.kind === 'voiceCollection' || component.kind === 'musicTrackList' || component.kind === 'chapterList') {
    const measurable = measurableComponent(project, component);
    const geometry = component.kind === 'voiceCollection' ? voiceCollectionLayout(pageProject, measurable) : musicCollectionLayout(pageProject, measurable);
    return { columns: geometry.columns, rows: geometry.rows, gapX: geometry.gapX, gapY: geometry.gapY,
      itemWidth: geometry.cellW, itemHeight: geometry.cellH, fields: [...gridFields], pagination: 'optional' };
  }
  return { gapY: 0, fields: [], pagination: 'none' };
}

/**
 * A seed for enabling custom geometry. Existing authored rectangles are copied verbatim.
 * Navigation/scrollbar areas are control-relative; other editable areas are item-relative
 * (save parts use the body, excluding the delete/time footer). Structural parts have no custom rect.
 */
export function collectionPartDefaultRect(project: Project, component: UiComponent, part: CollectionPart): CollectionRect {
  const list = component.list;
  const authored: Partial<Record<CollectionPart, CollectionRect | undefined>> = {
    thumbnail: list?.thumbnail, chapter: list?.chapter, caption: list?.caption, number: list?.number,
    slotAction: list?.slotAction, thumbnailFrame: list?.thumbnailFrame, navigationRect: list?.navigationRect,
    lockedRect: list?.lockedRect, voiceFavoriteRect: list?.voiceFavoriteRect, historyScrollbar: list?.historyScrollbar?.rect,
  };
  if (authored[part]) return copyRect(authored[part]);
  if (component.kind === 'saveSlots') {
    const geometry = saveSlotLayout(project, component);
    if (part === 'navigationRect') return relativeRect(geometry.navigation, geometry.width, geometry.height);
    if (part === 'thumbnail' || part === 'thumbnailFrame') return copyRect(geometry.thumbnail);
    // These parts are optional overlays, not a new layout that moves the existing screenshot.
    if (part === 'chapter') return { x: .08, y: .08, width: .68, height: .14 };
    if (part === 'caption') return { x: .08, y: .30, width: .84, height: .36 };
    if (part === 'number') return { x: .78, y: .04, width: .18, height: .16 };
    if (part === 'slotAction') return { x: .54, y: .76, width: .4, height: .18 };
  }
  if (component.kind === 'galleryGrid') {
    const geometry = galleryLayout(project, component);
    if (part === 'navigationRect') return copyRect(geometry.navigation);
    if (part === 'thumbnail' || part === 'thumbnailFrame') return copyRect(geometry.thumbnail);
    if (part === 'lockedRect') return copyRect(geometry.locked);
  }
  const measurable = measurableComponent(project, component), width = measurable.width * project.width, height = measurable.height * project.height;
  if (component.kind === 'historyList' && part === 'historyScrollbar') {
    return relativeRect({ x: width - 20, y: 0, width: 20, height }, width, height);
  }
  if (component.kind === 'choiceList' && part === 'caption') {
    const itemHeight = collectionLayoutValues(project, component).itemHeight!;
    return relativeRect({ x: 12, y: 6, width: Math.max(1, width - 24), height: Math.max(1, itemHeight - 12) }, width, itemHeight);
  }
  if (component.kind === 'voiceCollection' || component.kind === 'musicTrackList' || component.kind === 'chapterList') {
    const pageProject = themedProject(project, component);
    const geometry = component.kind === 'voiceCollection' ? voiceCollectionLayout(pageProject, measurable) : musicCollectionLayout(pageProject, measurable);
    if (part === 'navigationRect') {
      const navHeight = Math.min(40, Math.max(24, Math.floor(height * .1)));
      return relativeRect(geometry.rows ? geometry.navigation : { x: 0, y: height - navHeight, width, height: navHeight }, width, height);
    }
    if (component.kind === 'voiceCollection') {
      const voice = voiceCollectionLayout(pageProject, measurable);
      if (part === 'voiceFavoriteRect') return relativeRect(voice.favorite, voice.cellW, voice.cellH);
      if (part === 'caption') {
        const caption = customVoiceItem(component) ? voice.caption : {
          x: 8, y: 8, width: Math.max(1, voice.cellW - voice.favorite.width - 24), height: Math.max(1, voice.cellH - 16),
        };
        return relativeRect(caption, voice.cellW, voice.cellH);
      }
    }
  }
  return wholeRect();
}
