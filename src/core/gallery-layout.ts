import type { Project, UiComponent } from './model';
export interface CollectionRect { x: number; y: number; width: number; height: number }

/** Geometry is shared by the editor and generated game, in component-relative coordinates. */
export function galleryLayout(project: Pick<Project, 'width' | 'height'>, component: UiComponent) {
  const list = component.list, width = Math.max(1, component.width * project.width), height = Math.max(1, component.height * project.height);
  const columns = list?.columns ?? 3, rows = list?.rows ?? 2;
  const gapX = Math.min(list?.gapX ?? 12, width / (columns * 2)), gapY = list?.gapY ?? 12;
  const stagger = list?.layout === 'staggered' ? Math.min(list.staggerX ?? 120, width / 3) : 0;
  const navHeight = Math.min(40, Math.max(24, height * .1));
  const navigation = list?.navigationRect ?? { x: 0, y: 1 - navHeight / height, width: 1, height: navHeight / height };
  const viewHeight = Math.min(height, navigation.y * height - gapY);
  const cellWidth = Math.max(1, Math.min(list?.itemWidth ?? width, (width - stagger - (columns - 1) * gapX) / columns));
  const cellHeight = Math.max(1, Math.min(list?.itemHeight ?? Math.max(80, (viewHeight - (rows - 1) * gapY) / rows), (viewHeight - (rows - 1) * gapY) / rows));
  const cells: CollectionRect[] = Array.from({ length: columns * rows }, (_, index) => ({ x: ((index % columns) * (cellWidth + gapX) + (Math.floor(index / columns) % 2 ? stagger : 0)) / width, y: Math.floor(index / columns) * (cellHeight + gapY) / height, width: cellWidth / width, height: cellHeight / height }));
  const thumbnail = list?.thumbnail ?? { x: 8 / cellWidth, y: 8 / cellHeight, width: Math.max(1, cellWidth - 16) / cellWidth, height: Math.max(1, cellHeight - (list?.showLabels === false ? 16 : (component.style?.fontSize ?? 24) + 24)) / cellHeight };
  return { cells, navigation, thumbnail, locked: list?.lockedRect ?? { x: 0, y: 0, width: 1, height: 1 } };
}
