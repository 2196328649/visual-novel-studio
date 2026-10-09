import type { Project, UiComponent } from './model';

export const historyTemplateAssets = ['ai_ui_37e66a53a43d9a54', 'ai_ui_8c9a6415ff743b9e', 'ai_ui_091c965ff444b381', 'ai_ui_85429005947e6647'];
export function legacyTemplateHistory(project: Project) {
  return [...project.ui.components, ...(project.ui.instances ?? []).flatMap(i => i.components), ...(project.ui.customPages ?? []).flatMap(p => p.components)].filter(c =>
    c.id === 'ai_history_items' && c.kind === 'historyList' && c.list?.historyLayout === 'columns' && c.list.historyNameWidth === 165 && c.list.gapX === 22 && c.list.gapY === 18 &&
    c.style?.fontSize === 30 && !c.style.fontAssetId && !c.list.historyScrollbar);
}
export function applyTemplateHistory(component: UiComponent) {
  component.height = 980 / 1080;
  component.style = { ...component.style, fontAssetId: historyTemplateAssets[0] };
  component.list = { ...component.list, gapY: 35, historyPaddingY: 15, historyRowHeight: 49, historyNameFontSize: 32, historyBold: true, historyLetterSpacing: 2,
    historyScrollbar: { rect: { x: (1794.5 - component.x * 1920) / (component.width * 1920), y: (37 - component.y * 1080) / 980, width: 31 / (component.width * 1920), height: 706 / 980 },
      trackWidth: 5, trackId: historyTemplateAssets[1], thumb: { idle: historyTemplateAssets[2], hover: historyTemplateAssets[3], pressed: historyTemplateAssets[3], fit: 'nineSlice', borders: { left: 0, top: 16, right: 0, bottom: 16 } } } };
}
export function repairTemplateHistory(project: Project) {
  if (historyTemplateAssets.every(id => project.assets.some(a => a.id === id))) for (const c of legacyTemplateHistory(project)) applyTemplateHistory(c);
}
