import type { Project, UiSkin } from '../../src/core/model';
import type { UnityObject, UnityUi } from './unity-ui';
import { addAihongGalleryNavigation } from './aihong-gallery-navigation';
import { templateFlowSoftShadow } from '../../src/core/template-repairs';

/** Read exact prefab rectangles and referenced Chinese sprites, never select a same-named variant. */
export function addAihongSpatialMenus({ project, ui, asset, skin }: { project: Project; ui: UnityUi; asset: (record: UnityObject | undefined) => string; skin: (node: UnityObject) => UiSkin }) {
  const component = (id: string) => { const found = project.ui.components.find(component => component.id === id); if (!found) throw new Error(`缺少模板组件 ${id}`); return found; };
  const position = (name: string) => { const rect = ui.rectangle(ui.node(name)); return { x: rect.x / ui.width, y: rect.y / ui.height, width: rect.width / ui.width, height: rect.height / ui.height }; };
  const cg = 'Canvas-AdvUI/Gallery/CgGallery/GridPage_Layered', up = ui.rectangle(ui.node(cg + '/GridUp')), down = ui.rectangle(ui.node(cg + '/GridDown'));
  const itemPath = cg + '/GridUp/CgGalleryItem', item = ui.rectangle(ui.node(itemPath)), thumbnail = ui.rectangle(ui.node(itemPath + '/ThumainalImage')), lock = ui.rectangle(ui.node(itemPath + '/BG/Image'));
  const nav = ui.rectangle(ui.node(cg + '/PageCarousels/Carousel')), navArea = ui.rectangle(ui.node(cg + '/PageCarousels'));
  const width = ui.width - up.x, height = nav.y + nav.height - up.y;
  const gallery = component('ai_gallery_items');
  Object.assign(gallery, { x: up.x / ui.width, y: up.y / ui.height, width: width / ui.width, height: height / ui.height });
  gallery.style = { ...gallery.style, background: undefined };
  gallery.skin = { idle: asset(ui.localizedSprite(ui.node(itemPath + '/BG/Image (1)'))), disabled: asset(ui.localizedSprite(ui.node(itemPath + '/BG/Image (1)'))), fit: 'stretch' };
  const pageSkin = skin(ui.node(cg + '/PageCarousels/Carousel/CarouselButton'));
  pageSkin.selected = asset(ui.localizedSprite(ui.node(cg + '/PageCarousels/Carousel/CarouselButton/BG/Checkmark'))); pageSkin.hideText = false;
  gallery.list = { ...gallery.list, layout: 'staggered', columns: 4, rows: 2, itemWidth: item.width, itemHeight: item.height, gapX: 42, gapY: down.y - up.y - item.height, staggerX: down.x - up.x,
    thumbnail: { x: (thumbnail.x - item.x) / item.width, y: (thumbnail.y - item.y) / item.height, width: thumbnail.width / item.width, height: thumbnail.height / item.height }, thumbnailFit: 'cover',
    lockedRect: { x: (lock.x - item.x) / item.width, y: (lock.y - item.y) / item.height, width: lock.width / item.width, height: lock.height / item.height },
    lockedAssetId: asset(ui.localizedSprite(ui.node(itemPath + '/BG/Image'))), showLabels: false,
    navigationRect: { x: (navArea.x - up.x) / width, y: (nav.y - up.y) / height, width: navArea.width / width, height: nav.height / height }, pageSkin };

  addAihongGalleryNavigation(project, ui, asset);

  const flow = 'Canvas-AdvUI/UI_PlotMap';
  Object.assign(component('ai_flowchart_background'), position(flow + '/BG'), { assetId: asset(ui.localizedSprite(ui.node(flow + '/BG'))) });
  Object.assign(component('ai_flowchart_title'), position(flow + '/Title'), { assetId: asset(ui.localizedSprite(ui.node(flow + '/Title'))), style: { imageFit: 'stretch' } });
  Object.assign(component('ai_flowchart_back'), position(flow + '/BtnBack'), { skin: skin(ui.node(flow + '/BtnBack')) });
  const prototype = (sprite: string) => [...ui.nodes].find(([name, node]) => name.startsWith(flow + '/') && ui.components(node).some(record => record.class === 'UI_PlotChapterElement') && ui.localizedSprite(node)?.data.m_Name === sprite)!;
  const regular = prototype('flowchart_data_bg_J'), chapter = prototype('flowchart_data_bg_Y'), ending = prototype('flowchart_data_bg_GE');
  const nodeSkin = ([name, node]: [string, UnityObject]): UiSkin => {
    const button = ui.node(name + '/Btn');
    const colors = ui.components(button).find(record => record.class === 'UnityEngine.UI.Button')?.data.m_Colors;
    // The prefab tints the same node image. ButtonEnter is a separate hidden child.
    return { idle: asset(ui.localizedSprite(node)), disabled: asset(ui.localizedSprite(ui.node(name + '/Lock/LockBG'))), fit: 'stretch', hideText: false,
      brightness: { hover: colors?.m_HighlightedColor.r ?? 1, pressed: colors?.m_PressedColor.r ?? 1, selected: 1 } };
  };
  const line = (sprite: string) => [...ui.nodes].find(([name, node]) => name.startsWith(flow + '/Scroll View/Viewport/Content/Arrow/') && ui.localizedSprite(node)?.data.m_Name === sprite)![1];
  const graph = component('ai_flowchart_items');
  // The Chinese title sprites use large white calligraphy. Use the game's own
  // YanShu face for editable story names instead of the generic menu serif.
  const titleFont = ui.records.find(record => record.type === 'Font' && record.data.m_Name === '喜鹊燕书体简繁版');
  Object.assign(graph, { x: 0, y: 200 / ui.height, width: 1, height: 736 / ui.height, skin: nodeSkin(regular), style: { fontAssetId: asset(titleFont), fontSize: 60, textColor: '#ffffff', hoverTextColor: '#ffffff', outlineWidth: 1, outlineColor: '#000000', outlineOpacity: 0.2, ...templateFlowSoftShadow } });
  graph.list = { layout: 'flow', itemWidth: 547, itemHeight: 90, gapX: 96, gapY: 112, flowLineWidth: 16, flowLineAssetId: asset(ui.localizedSprite(line('flowchart_line_1'))), flowVerticalLineAssetId: asset(ui.localizedSprite(line('flowchart_line_2'))), flowEndSkin: nodeSkin(ending), flowChapterSkin: nodeSkin(chapter), lockUnread: true, showProgress: false, confirmJump: true };
  const scrollbarPath = flow + '/Scroll View/Scrollbar Horizontal';
  const scrollbar = ui.node(scrollbarPath), scrollbarRect = ui.rectangle(scrollbar);
  const handle = ui.node(scrollbarPath + '/Sliding Area/Handle'), handleRect = ui.rectangle(handle);
  const scrollColors = ui.components(scrollbar).find(record => record.class === 'UnityEngine.UI.Scrollbar')!.data.m_Colors;
  const handleBorder = ui.localizedSprite(handle)!.data.m_Border;
  // A full-page component keeps the original independent graph viewport and
  // bottom-centred rail editable without placing children outside its bounds.
  Object.assign(graph, { x: 0, y: 0, width: 1, height: 1 });
  graph.list.flowViewport = { x: 0, y: 200 / ui.height, width: 1, height: 736 / ui.height };
  graph.list.flowShowControls = false;
  graph.list.flowShowVerticalScrollbar = false;
  const currentMarker = ui.node(regular[0] + '/Highlight'), currentMarkerRect = ui.rectangle(currentMarker), regularRect = ui.rectangle(regular[1]);
  graph.list.flowCurrentMarker = { assetId: asset(ui.localizedSprite(currentMarker)), rect: { x: (currentMarkerRect.x - regularRect.x) / regularRect.width, y: (currentMarkerRect.y - regularRect.y) / regularRect.height, width: currentMarkerRect.width / regularRect.width, height: currentMarkerRect.height / regularRect.height } };
  graph.list.flowScrollbar = {
    rect: { x: scrollbarRect.x / ui.width, y: handleRect.y / ui.height, width: scrollbarRect.width / ui.width, height: handleRect.height / ui.height },
    trackId: asset(ui.localizedSprite(scrollbar)), trackHeight: scrollbarRect.height, thumbHeight: handleRect.height,
    thumb: { idle: asset(ui.localizedSprite(handle)), fit: 'nineSlice', borders: { left: handleBorder.x, bottom: handleBorder.y, right: handleBorder.z, top: handleBorder.w }, brightness: { hover: scrollColors.m_HighlightedColor.r, pressed: scrollColors.m_PressedColor.r } },
  };
  const chapters = project.ui.components.find(component => component.id === 'ai_flowchart_chapters');
  if (chapters) Object.assign(chapters, { x: .026, y: 974 / ui.height, width: .13, height: 73 / ui.height });

  // Unity expands its carousel at runtime. Keep its vertical position and button
  // skin, with enough central space for Ren'Py's automatic and quick-save pages.
  const save = component('ai_save_slots'), saveWidth = save.width * ui.width, saveHeight = save.height * ui.height;
  const carousel = 'Canvas-AdvUI/SaveLoad/GridPage/PageCarousels/Carousels/CarouselButton';
  const saveNav = ui.rectangle(ui.node(carousel)), savePageSkin = skin(ui.node(carousel));
  savePageSkin.selected = asset(ui.localizedSprite(ui.node(carousel + '/BG/Checkmark'))); savePageSkin.hideText = false;
  save.list = { ...save.list, navigation: 'bottom', pageSkin: savePageSkin, pageTextColor: '#f7f4ed', pageSelectedTextColor: '#242a26', navigationRect: {
    x: (ui.width / 2 - 440 - save.x * ui.width) / saveWidth, y: (saveNav.y - save.y * ui.height) / saveHeight,
    width: 880 / saveWidth, height: saveNav.height / saveHeight,
  } };
}
