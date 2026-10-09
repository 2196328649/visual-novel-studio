import type { Project } from '../../src/core/model';
import type { UnityObject, UnityUi } from './unity-ui';

/** The runtime clones the 84×67 asset prefab, not the 64×57 scene example. */
export function addAihongGalleryNavigation(project: Project, ui: UnityUi, asset: (record: UnityObject | undefined) => string) {
  const root = 'Canvas-AdvUI/Gallery/CgGallery/GridPage_Layered';
  const controller = ui.components(ui.node(root)).find(c => c.class === 'Utage.UguiLayeredGridPage')!;
  const prefab = ui.reference(controller.file, controller.data.pageCarouselPrefab)!;
  const size = ui.components(prefab).find(c => c.type === 'RectTransform')!.data.m_SizeDelta;
  const prefix = ui.includePrefab(prefab.data.m_Name, prefab.file);
  const text = ui.components(ui.node(prefix + '/PageNumber')).find(c => c.class === 'UnityEngine.UI.Text')!;
  const font = text.data.m_FontData;
  const align = ui.components(ui.node(root + '/PageCarousels/Carousel')).find(c => c.class === 'Utage.UguiHorizontalAlignGroup')!.data;
  const anchor = ui.rectangle(ui.node(root + '/PageCarousels/Carousel'));
  const component = project.ui.components.find(c => c.id === 'ai_gallery_items')!;
  const card = ui.reference(controller.file, controller.data.itemPrefab)!;
  const button = ui.components(card).find(c => c.class === 'UnityEngine.UI.Button')!;
  if (ui.reference(button.file, button.data.m_TargetGraphic)?.class !== 'UnityEngine.UI.RawImage') throw new Error('Gallery thumbnail color target changed.');
  const colors = button.data.m_Colors;
  const width = component.width * project.width, height = component.height * project.height;
  const count = 12, extent = count * size.x + (count - 1) * align.space;
  component.list = { ...component.list, galleryPageButtonLimit: count, pageButtonWidth: size.x, pageButtonHeight: size.y, pageGap: align.space,
    thumbnailBrightness: Object.fromEntries(Object.entries({ idle: 'm_NormalColor', hover: 'm_HighlightedColor', pressed: 'm_PressedColor', selected: 'm_SelectedColor', disabled: 'm_DisabledColor' }).map(([state, key]) => [state, Math.min(1, colors[key].r * colors.m_ColorMultiplier)])),
    pageFontSize: font.m_BestFit ? font.m_MaxSize : font.m_FontSize, pageFontAssetId: asset(ui.reference(text.file, font.m_Font)), pageBold: font.m_FontStyle === 1 || font.m_FontStyle === 3,
    pageTextColor: '#ffffff', pageSelectedTextColor: '#ffffff',
    navigationRect: { x: (anchor.x + (align.paddingLeft - align.paddingRight) / 2 - extent / 2 - component.x * project.width) / width,
      y: (anchor.y - component.y * project.height) / height, width: extent / width, height: anchor.height / height } };
}
