import type { UiComponent } from './model';
import { uiLayoutPropertyFields, uiLayoutValues } from './ui-layout';

export type UiInspectorLayoutProperty = keyof typeof uiLayoutPropertyFields;
export const uiInspectorTransformProperties = ['layoutRotation', 'scaleX', 'scaleY', 'anchorX', 'anchorY', 'pivotX', 'pivotY'] as const;
export const uiInspectorPaddingProperties = ['paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom'] as const;
export const uiInspectorContainerProperties = ['layoutFlow', 'childGap', ...uiInspectorPaddingProperties, 'clipChildren', 'scrollMode', 'scrollX', 'scrollY'] as const;

export function hasUiInspectorLayoutValue(component: UiComponent, property: UiInspectorLayoutProperty) {
  return component.layout?.[uiLayoutPropertyFields[property]] !== undefined;
}

/** Visibility only; authored coordinates and dormant layout values remain intact. */
export function uiInspectorLayoutContext(component: UiComponent, components: readonly UiComponent[]) {
  const parent = components.find(candidate => candidate.id === component.parentId && candidate.page === component.page);
  const children = components.filter(candidate => candidate.parentId === component.id && candidate.page === component.page);
  const layout = uiLayoutValues(component), parentLayout = parent && uiLayoutValues(parent);
  const background = !!parent && component.childLayer === 'background';
  const arranged = !!parentLayout && !background && parentLayout.flow !== 'absolute';
  return {
    parent, children, layout, parentLayout, background, arranged,
    container: component.kind === 'panel' || children.length > 0 || uiInspectorContainerProperties.some(property => hasUiInspectorLayoutValue(component, property)),
    showOrder: arranged || hasUiInspectorLayoutValue(component, 'layoutOrder'),
    showGap: layout.flow !== 'absolute' || hasUiInspectorLayoutValue(component, 'childGap'),
    scrollXEnabled: layout.scroll === 'horizontal' || layout.scroll === 'both',
    scrollYEnabled: layout.scroll === 'vertical' || layout.scroll === 'both',
    showScrollX: layout.scroll === 'horizontal' || layout.scroll === 'both' || hasUiInspectorLayoutValue(component, 'scrollX'),
    showScrollY: layout.scroll === 'vertical' || layout.scroll === 'both' || hasUiInspectorLayoutValue(component, 'scrollY'),
  };
}

export function uiInspectorChildScope(component: UiComponent): string | undefined {
  if (component.kind === 'flowchart') return '这里的子对象属于整个剧情图，不会复制到每个剧情节点。';
  if (component.kind === 'keyboard') return '这里的子对象属于整个键盘，不会复制到每个按键。';
  if (component.kind === 'staffRoll') return '这里的子对象属于整个名单，不会复制到每行内容。';
  if (component.kind === 'pauseMenu') return '这里的子对象属于整个菜单，不会复制到每个菜单按钮。';
  if (['choiceList', 'saveSlots', 'historyList', 'galleryGrid', 'musicTrackList', 'voiceCollection', 'chapterList'].includes(component.kind)) {
    return '这里的子对象属于整个列表，不会复制到每个条目；条目内部请使用“编辑条目部件”。';
  }
}
