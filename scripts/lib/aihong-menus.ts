import type { Project, UiComponent, UiSkin } from '../../src/core/model';
import type { UnityObject, UnityUi } from './unity-ui';
import { addAihongSpatialMenus } from './aihong-spatial-menus';
import { addAihongVoiceCollection } from './aihong-voice-collection';

export function addAihongMenus({ project, ui, asset, skin }: {
  project: Project; ui: UnityUi; asset: (record: UnityObject | undefined) => string; skin: (node: UnityObject) => UiSkin;
}) {
  const component = (id: string) => {
    const found = project.ui.components.find(component => component.id === id);
    if (!found) throw new Error(`模板缺少界面组件：${id}`);
    return found;
  };
  const originalImage = (id: string, original: string) => {
    const target = component(id), node = ui.node(original), rect = ui.rectangle(node);
    Object.assign(target, { assetId: asset(ui.localizedSprite(node)), x: rect.x / ui.width, y: rect.y / ui.height, width: rect.width / ui.width, height: rect.height / ui.height });
  };
  originalImage('ai_history_background', 'UI/BackLog/Filter');
  originalImage('ai_history_title', 'UI/BackLog/Title');
  const itemPath = 'UI/BackLog/Content/ListView/Content/BackLogItem (1)';
  const row = ui.rectangle(ui.node(itemPath));
  const close = ui.node('UI/BackLog/Content/GameObject/CloseButton'), closeRect = ui.rectangle(close);
  const replaySkin = skin(ui.node(`${itemPath}/sound`));
  const favoriteSkin = skin(ui.node(`${itemPath}/collection`));
  favoriteSkin.selected = favoriteSkin.pressed ?? favoriteSkin.hover ?? favoriteSkin.idle;
  Object.assign(component('ai_history_items'), {
    x: row.x / ui.width, y: row.y / ui.height, width: row.width / ui.width, height: (closeRect.y - row.y - 35) / ui.height,
    skin: undefined, style: { fontSize: 30, textColor: '#ffffff', align: 'left' },
    list: { historyLayout: 'columns', historyNameWidth: 165, voiceButtonSize: 49, voiceReplaySkin: replaySkin, voiceFavoriteSkin: favoriteSkin, gapX: 22, gapY: 18 },
  });
  Object.assign(component('ai_history_back'), { x: closeRect.x / ui.width, y: closeRect.y / ui.height, width: closeRect.width / ui.width, height: closeRect.height / ui.height, skin: skin(close) });
  const voices = component('ai_voicecollection_items');
  voices.list = { ...voices.list, favoritesOnly: true, voiceButtonSize: 49, voiceReplaySkin: replaySkin, voiceFavoriteSkin: favoriteSkin };
  voices.style = { ...voices.style, fontSize: 28 };
  for (const id of ['ai_chapter_items', 'ai_flowchart_items']) {
    const target = component(id);
    target.list = { ...target.list, lockUnread: true, showProgress: true, confirmJump: true };
    target.style = { ...target.style, disabledBackground: '#c3bda6' };
  }
  const plainRowSkin: UiSkin = { ...component('ai_musicroom_items').skin, fit: 'nineSlice', borders: { left: 36, right: 36, top: 16, bottom: 16 }, hideText: false };
  component('ai_chapter_items').skin = { ...plainRowSkin };
  const flow = component('ai_flowchart_items');
  flow.style = { ...flow.style, textColor: '#ffffff' };
  flow.skin = { idle: flow.skin?.idle, fit: 'nineSlice', borders: { left: 24, right: 24, top: 12, bottom: 12 }, hideText: false };
  for (const id of ['ai_chapter_back', 'ai_flowchart_back', 'ai_staff_back', 'ai_pause_back']) component(id).skin = skin(close);
  Object.assign(component('ai_chapter_title'), { kind: 'text', assetId: undefined, text: '章节选择', x: 0.20, y: 0.10, width: 0.60, height: 0.08, style: { fontSize: 48, textColor: '#ffffff', align: 'center' } });
  const navigation = (id: string, page: UiComponent['page'], text: string, action: UiComponent['action']) => {
    const value: UiComponent = { id, page, kind: 'button', text, action, x: 0.73, y: 0.025, width: 0.15, height: 0.055, skin: { ...plainRowSkin }, style: { fontSize: 25, textColor: '#242a26', align: 'center' } };
    const existing = project.ui.components.find(component => component.id === id);
    if (existing) Object.assign(existing, value); else project.ui.components.push(value);
  };
  navigation('ai_flowchart_chapters', 'flowchart', '章节选择', 'chapterSelect');
  navigation('ai_chapter_flowchart', 'chapterSelect', '剧情流程图', 'flowchart');
  addAihongSpatialMenus({ project, ui, asset, skin });
  addAihongVoiceCollection({ project, ui, asset, skin });
}
