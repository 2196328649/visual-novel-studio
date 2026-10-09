import type { Project, UiSkin } from '../../src/core/model';
import type { UnityObject, UnityUi } from './unity-ui';

/** Apply the live grid dimensions before resolving its anchored text/delete children. */
export function addAihongVoiceCollection({ project, ui, asset, skin }: {
  project: Project; ui: UnityUi; asset: (record: UnityObject | undefined) => string; skin: (node: UnityObject) => UiSkin;
}) {
  const component = project.ui.components.find(c => c.id === 'ai_voicecollection_items');
  if (!component) throw new Error('模板缺少语音收藏列表');
  const root = 'Canvas-AdvUI/Gallery/VoiceCollection/GridPage';
  const grid = ui.node(root + '/Grid'), bounds = ui.rectangle(grid);
  const layout = ui.components(grid).find(c => c.class === 'UnityEngine.UI.GridLayoutGroup')!.data;
  const item = ui.node(root + '/Grid/VoiceCollectionItem'), old = ui.rectangle(item);
  const width = layout.m_CellSize.x, height = layout.m_CellSize.y;
  const child = (name: string) => {
    const node = ui.node(root + '/Grid/VoiceCollectionItem/' + name), r = ui.rectangle(node);
    const anchors = ui.components(node).find(c => c.type === 'RectTransform')!.data;
    const dx = width - old.width, dy = height - old.height;
    return { x: (r.x - old.x + dx * anchors.m_AnchorMin.x) / width,
      y: (r.y - old.y + dy * (1 - anchors.m_AnchorMax.y)) / height,
      width: (r.width + dx * (anchors.m_AnchorMax.x - anchors.m_AnchorMin.x)) / width,
      height: (r.height + dy * (anchors.m_AnchorMax.y - anchors.m_AnchorMin.y)) / height };
  };
  const text = ui.components(ui.node(root + '/Grid/VoiceCollectionItem/text')).find(c => c.class === 'TMPro.TextMeshProUGUI')!;
  const fontName = ui.reference(text.file, text.data.m_fontAsset)!.data.m_Name.replace(/ SDF$/, '');
  const font = ui.records.find(r => r.type === 'Font' && r.data.m_Name === fontName);
  const y = bounds.y + layout.m_Padding.m_Top, areaHeight = 1000 - y;
  const pageSkin = skin(ui.node(root + '/PageCarousels/Carousel/CarouselButton'));
  pageSkin.selected = asset(ui.localizedSprite(ui.node(root + '/PageCarousels/Carousel/CarouselButton/BG/Checkmark')));
  pageSkin.hideText = false;
  Object.assign(component, { x: bounds.x / ui.width, y: y / ui.height, width: bounds.width / ui.width, height: areaHeight / ui.height,
    skin: { ...skin(item), hideText: false }, style: { ...component.style, fontAssetId: asset(font), fontSize: text.data.m_fontSize, textColor: '#000000', align: 'left' } });
  component.list = { ...component.list, columns: 2, rows: 6, itemWidth: width, itemHeight: height,
    gapX: layout.m_Spacing.x, gapY: layout.m_Spacing.y, favoritesOnly: true, showVoiceControls: false,
    voiceOrder: 'favorites', voiceRemoveConfirm: true,
    voiceCaptionMode: 'text', voiceSingleLine: true, caption: child('text'), voiceFavoriteRect: child('Delete'),
    voiceButtonSize: 68, voiceFavoriteSkin: skin(ui.node(root + '/Grid/VoiceCollectionItem/Delete')),
    pageSkin, pageTextColor: '#ffffff', pageSelectedTextColor: '#ffffff',
    navigationRect: { x: (496 - bounds.x) / bounds.width, y: (938 - y) / areaHeight, width: 432 / bounds.width, height: 56 / areaHeight } };
}
