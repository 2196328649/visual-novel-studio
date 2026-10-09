import type { Project, UiComponent, UiSkin } from '../../src/core/model';
import { playerPreferenceOptions } from '../../src/core/preferences';
import type { UnityObject, UnityUi } from './unity-ui';
import { applyTemplateHistory } from '../../src/core/template-history';

/** The scene item matches the manager's prefab; retain its labelled artwork area. */
export function refineAihongChoices(project: Project, ui: UnityUi) {
  const choice = project.ui.components.find(c => c.id === 'ai_story_choices');
  if (!choice) throw new Error('模板缺少剧情选项组件');
  const area = ui.rectangle(ui.node('UI/Selection'));
  const item = ui.rectangle(ui.node('UI/Selection/Content/SelectionItem'));
  const labelNode = ui.node('UI/Selection/Content/SelectionItem/Label'), label = ui.rectangle(labelNode);
  const text = ui.components(labelNode).find(c => c.class === 'TMPro.TextMeshProUGUI')!;
  const layout = ui.components(ui.node('UI/Selection/Content')).find(c => c.class === 'Utage.UguiVerticalAlignGroup')!;
  Object.assign(choice, { x: area.x / ui.width, y: area.y / ui.height, width: area.width / ui.width, height: area.height / ui.height });
  choice.list = { ...choice.list, itemHeight: item.height, gapY: layout.data.space,
    caption: { x: (label.x - item.x) / item.width, y: (label.y - item.y) / item.height, width: label.width / item.width, height: label.height / item.height } };
  choice.style = { ...choice.style, fontSize: text.data.m_fontSize, textColor: '#ffffff', align: 'center' };
}

/** Screenshot corrections expressed as normal, editable project components. */
export function refineAihongFidelity({ project, ui, asset, skin, namedAsset }: {
  project: Project; ui: UnityUi; asset: (record: UnityObject | undefined) => string;
  skin: (node: UnityObject) => UiSkin; namedAsset: (name: string) => string;
}) {
  const component = (id: string) => {
    const value = project.ui.components.find(c => c.id === id);
    if (!value) throw new Error(`模板缺少组件：${id}`);
    return value;
  };
  if (project.ui.chapterTransition) {
    project.ui.chapterTransition.maskId = 'ai_presentation_mask';
    delete project.ui.chapterTransition.dissolveId;
  }
  for (const node of project.nodes) if (node.kind === 'chapterTitle' && ['ai_title_one', 'ai_title_two'].includes(node.id) && node.duration === 4.2) node.duration = 7;
  const boldFont = namedAsset('SourceHanSerifCN-Bold');
  namedAsset('SourceHanSerifCN-Regular');
  for (const name of ['history_progressbar_bg', 'history_progressbar_button_normal', 'history_progressbar_button_click']) namedAsset(name);
  applyTemplateHistory(component('ai_history_items'));
  const titleSkin = skin(ui.node('Canvas-AdvUI/Config/Content/Button/ButtonBackTitle'));
  for (const c of project.ui.components) {
    if (c.action === 'mainMenu') c.skin = { ...titleSkin };
    if (c.page === 'preferences' && c.action === 'setPlayerPreference' && c.skin?.pressed) c.skin.selected = c.skin.pressed;
  }

  const captions: Record<string, string> = { plotmap: '流程图', save: '保存进度', load: '读取存档', auto: '自动播放', skip: '跳过', history: '对话历史', config: '设置', hideui: '隐藏界面' };
  for (const [id, caption] of Object.entries(captions)) {
    const button = component(`ai_dialogue_${id}`);
    button.tooltip = caption;
    if (id === 'plotmap') button.shortcut = 'K_a';
  }
  const originalTip = ui.node('Canvas-AdvUI/MainGame/Buttons/ExplainImage'), tipRect = ui.rectangle(originalTip);
  // The dialogue components are already reused by Ren'Py's choice interaction.
  const tip: UiComponent = { id: 'ai_dialogue_tooltip', page: 'say', kind: 'text', binding: 'tooltip', text: '', layer: 50,
    x: tipRect.x / ui.width, y: tipRect.y / ui.height, width: tipRect.width / ui.width, height: tipRect.height / ui.height,
    skin: { idle: asset(ui.localizedSprite(originalTip)), fit: 'stretch' }, style: { fontAssetId: boldFont, fontSize: 28, textColor: '#ffffff', align: 'center' } };
  const oldTip = project.ui.components.find(c => c.id === tip.id);
  if (oldTip) Object.assign(oldTip, tip); else project.ui.components.push(tip);

  const choice = component('ai_story_choices');
  choice.style = { ...choice.style, fontAssetId: boldFont };
  refineAihongChoices(project, ui);

  const save = component('ai_save_slots');
  const slotPath = 'Canvas-AdvUI/SaveLoad/GridPage/Grid/SaveLoadItem', slot = ui.rectangle(ui.node(slotPath));
  const part = (name: string) => {
    const r = ui.rectangle(ui.node(`${slotPath}/${name}`));
    return { x: (r.x - slot.x) / slot.width, y: (r.y - slot.y) / slot.height, width: r.width / slot.width, height: r.height / slot.height };
  };
  const loadImage = asset(ui.localizedSprite(ui.node(`${slotPath}/Root/SaveLoadImage/Image_Load`)));
  const saveImage = asset(ui.localizedSprite(ui.node(`${slotPath}/Root/SaveLoadImage/Image_Save`)));
  save.style = { ...save.style, fontAssetId: boldFont, fontSize: 30, textColor: '#121212' };
  save.list = { ...save.list, columns: 5, rows: 1, fixedAutoSlot: true, pageCount: 11, showDelete: false,
    chapter: part('Root/Uguitext'), caption: part('Root/text'), number: part('Image_Number'), summaryFontSize: 24,
    numberSkin: { idle: asset(ui.localizedSprite(ui.node(`${slotPath}/Image_Number`))), fit: 'stretch' }, numberTextColor: '#e8e4d2',
    autoSlotSkin: { idle: namedAsset('sl_data1_bg_auto'), fit: 'stretch' },
    slotAction: part('Root/SaveLoadImage/Image_Load'), slotActionSkin: { idle: loadImage, fit: 'stretch', hideText: true }, slotSaveSkin: { idle: saveImage, fit: 'stretch', hideText: true },
    pageTextColor: '#ffffff', pageSelectedTextColor: '#ffffff' };
  save.list.chapter!.height += 26 / slot.height;
  save.list.caption!.y += 26 / slot.height;
  save.list.caption!.height -= 26 / slot.height;
  if (save.list.navigationRect) {
    save.list.navigationRect.x = (ui.width / 2 - 455 - save.x * ui.width) / (save.width * ui.width);
    save.list.navigationRect.width = 910 / (save.width * ui.width);
    save.list.navigationRect.height = 54 / (save.height * ui.height);
  }

  const headings = { language: '语言设置', voicelanguage: '声音语言', sreenmode: '画面设置', skip_mode: '选项设置', textdisplayspeed: '文字速度', automodespeed: '自动速度', windowopacity: '窗口透明度', mastervolume: '总音量', musicvolume: 'BGM音量', sfxvolume: 'SE音量', bgevolume: '环境音量', voice_volume: '语音音量', mute_voice: '中断语音' };
  for (const [key, text] of Object.entries(headings)) component(`ai_settings_heading_${key}`).text = text;
  for (const id of ['languagesetting', 'voicelanguagesetting']) {
    const label = component(`ai_settings_${id}_label`);
    label.text = id === 'languagesetting' ? '简体中文' : '中文';
    label.style = { ...label.style, align: 'center' };
    for (const direction of ['btnpre', 'btnnext']) {
      const arrow = component(`ai_settings_${id}_${direction}`);
      // The demo has one supplied language; keep the original bright arrow artwork.
      arrow.skin = { ...arrow.skin, disabled: arrow.skin?.idle };
    }
  }
  const voices = component('ai_settings_characters');
  voices.text = '角色音量设定'; voices.style = { ...voices.style, fontSize: 20, fontAssetId: boldFont, align: 'center' };
  const resolution = component('ai_settings_resolution');
  resolution.selector = { ...resolution.selector, options: playerPreferenceOptions('windowSize').filter(o => String(o.value) !== '3840x2160').reverse() };
  resolution.style = { ...resolution.style, fontAssetId: boldFont, fontSize: 23, align: 'center' };
  for (const id of ['dialogueopacity', 'autoforwardtime']) {
    const c = component(`ai_settings_${id}`); c.slider = { ...c.slider, reverse: true };
  }
  project.playerDefaults = { ...project.playerDefaults, textSpeed: 101, musicVolume: 0.5, soundVolume: 0.5, ambientVolume: 0.5, voiceVolume: 0.75, dialogueOpacity: 1, voiceSustain: true };
}
