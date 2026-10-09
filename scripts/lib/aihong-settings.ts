import type { Project, UiComponent, UiSkin } from '../../src/core/model';
import type { PlayerPreference } from '../../src/core/preferences';
import { playerPreferenceOptions, playerPreferences } from '../../src/core/preferences';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../../src/core/blueprint';
import type { UnityObject, UnityUi } from './unity-ui';

interface Context {
  project: Project; ui: UnityUi;
  image: (id: string, page: UiComponent['page'], original: string) => UiComponent;
  button: (id: string, page: UiComponent['page'], original: string, action: NonNullable<UiComponent['action']>, caption: string) => UiComponent;
  text: (id: string, page: UiComponent['page'], original: string, binding: UiComponent['binding']) => UiComponent;
  asset: (record: UnityObject | undefined) => string;
  skin: (node: UnityObject) => UiSkin;
  position: (node: UnityObject, id: string) => Pick<UiComponent, 'x' | 'y' | 'width' | 'height'>;
}

/** Recover layout as ordinary authored components. No template-specific runtime. */
export function addAihongSettings(context: Context) {
  const { project, ui, image, button, text, asset, skin, position } = context;
  const root = 'Canvas-AdvUI/Config';
  const safe = (name: string) => name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '_');
  const color = (value: { r: number; g: number; b: number }) => '#' + [value.r, value.g, value.b].map(n => Math.round(n * 255).toString(16).padStart(2, '0')).join('');
  const label = (id: string, page: UiComponent['page'], original: string, caption?: string) => {
    const source = ui.node(original);
    const t = ui.components(source).find(c => c.data.m_FontData && typeof c.data.m_Text === 'string');
    const c = text(id, page, original, undefined);
    c.text = caption ?? t?.data.m_Text ?? '';
    const outline = ui.components(source).find(c => c.class === 'UnityEngine.UI.Outline' && c.data.m_Enabled);
    if (outline) c.style = { ...c.style, outlineWidth: Math.min(8, Math.abs(outline.data.m_EffectDistance.x)), outlineColor: color(outline.data.m_EffectColor), outlineOpacity: outline.data.m_EffectColor.a };
    const alignment = t?.data.m_FontData?.m_Alignment;
    if (typeof alignment === 'number') c.style = { ...c.style, align: (['left', 'center', 'right'] as const)[alignment % 3] };
    return c;
  };
  const slider = (id: string, page: UiComponent['page'], original: string, preference: PlayerPreference, characterId?: string) => {
    const node = ui.node(original), handle = ui.node(`${original}/Handle Slide Area/Handle`);
    const thumb = { ...skin(node), idle: asset(ui.localizedSprite(handle)) };
    const track = ui.node(`${original}/Background`);
    const dimensions = ui.rectangle(handle);
    const component: UiComponent = { id, kind: 'preference', page, text: playerPreferences[preference].name, preference, preferenceCharacterId: characterId, ...position(node, id),
      slider: { trackId: asset(ui.localizedSprite(track)), trackHeight: ui.rectangle(track).height, thumb, thumbWidth: dimensions.width, thumbHeight: dimensions.height, showLabel: false } };
    project.ui.components.push(component);
    return component;
  };

  project.ui.pages ??= {};
  project.ui.pages.preferences = { layout: 'custom' };
  image('ai_settings_background', 'preferences', root).text = '设置背景';
  image('ai_settings_title', 'preferences', `${root}/BG/Title`).text = '设置页标题';
  const headings = { Language: '界面语言', VoiceLanguage: '配音语言', SreenMode: '显示模式', 'Skip Mode': '跳过范围', TextDisplaySpeed: '文字显示速度', AutoModeSpeed: '自动播放间隔', WindowOpacity: '对话框不透明度', MasterVolume: '总音量', MusicVolume: '音乐音量', SFXVolume: '音效音量', BGEVolume: '环境音量', 'Voice Volume': '语音音量', 'Mute Voice': '语音停止方式' };
  for (const [name, caption] of Object.entries(headings)) {
    const p = `${root}/BG/SubTitles/${name}`, id = `ai_settings_heading_${safe(name)}`;
    image(`${id}_background`, 'preferences', p);
    label(id, 'preferences', `${p}/Text`, caption);
  }
  for (const [p, node] of ui.nodes) if (p.startsWith(`${root}/BG/SubTitles/SignTexts/`) && ui.components(node).some(c => c.class === 'UnityEngine.UI.Text')) {
    const name = p.slice(p.lastIndexOf('/') + 1);
    label(`ai_settings_${safe(name)}`, 'preferences', p, name.includes('Speed') ? name.includes('Left') ? '慢' : '快' : name.includes('Left') ? '低' : '高');
  }
  for (const [name, preference] of [
    ['MessageSpeed', 'textSpeed'], ['AutoSpeed', 'autoForwardTime'], ['WindowTransparency', 'dialogueOpacity'],
    ['MasterVolume', 'masterVolume'], ['BgmVolume', 'musicVolume'], ['SeVolume', 'soundVolume'], ['AmbienceVolume', 'ambientVolume'], ['VoiceVolume', 'voiceVolume'],
  ] as const) slider(`ai_settings_${preference.toLowerCase()}`, 'preferences', `${root}/Content/${name}`, preference);

  for (const [path, preference, value, caption] of [
    ['IsNotfullScreen/FullScreen', 'fullscreen', true, '全屏'], ['IsNotfullScreen/Window', 'fullscreen', false, '窗口'],
    ['Skip/SkipRead', 'skipAll', false, '仅跳过已读'], ['Skip/SkipAll', 'skipAll', true, '跳过全部'],
    ['VoiceStop/Click', 'voiceSustain', false, '点击后停止配音'], ['VoiceStop/NextVoice', 'voiceSustain', true, '下一段配音时停止'],
  ] as const) Object.assign(button(`ai_settings_${safe(path)}`, 'preferences', `${root}/Content/${path}`, 'setPlayerPreference', caption), { preference, preferenceValue: value });

  const dropdown = `${root}/Content/IsNotfullScreen/Dropdown`;
  project.ui.components.push({ id: 'ai_settings_resolution', kind: 'preferenceChoice', page: 'preferences', text: '窗口分辨率', preference: 'windowSize', ...position(ui.node(dropdown), 'ai_settings_resolution'),
    skin: { ...skin(ui.node(dropdown)), hideText: false }, style: { fontSize: 22, textColor: '#262921' },
    selector: { options: playerPreferenceOptions('windowSize').filter(o => ['1920x1080', '1600x900', '1280x720', '640x360'].includes(String(o.value))).reverse(), itemHeight: 35,
      popupBackgroundId: asset(ui.localizedSprite(ui.node(`${dropdown}/Template`))), arrowId: asset(ui.localizedSprite(ui.node(`${dropdown}/Arrow`))),
      itemSkin: { idle: asset(ui.localizedSprite(ui.node(`${dropdown}/Template/Viewport/Content/Item/Item Background`))) } } });

  // This demonstration contains Chinese content only. Disabled arrows preserve
  // the source layout without pretending that unprovided translations exist.
  for (const [name, caption] of [['LanguageSetting', '简体中文'], ['VoiceLanguageSetting', '中文配音']] as const) {
    const p = `${root}/Content/${name}`;
    image(`ai_settings_${safe(name)}_background`, 'preferences', `${p}/BG`);
    label(`ai_settings_${safe(name)}_label`, 'preferences', `${p}/BG/${name === 'LanguageSetting' ? 'Uguitext' : 'Uguitext (1)'}`, caption);
    for (const direction of ['BtnPre', 'BtnNext']) button(`ai_settings_${safe(name)}_${direction.toLowerCase()}`, 'preferences', `${p}/${direction}`, 'return', '此示例仅含中文内容').disabled = true;
  }
  for (const [name, action, caption] of [['InitButton', 'resetPreferences', '恢复初始设置'], ['ButtonBack', 'return', '返回'], ['ButtonEndGame', 'quit', '退出游戏'], ['ButtonBackTitle', 'mainMenu', '返回标题']] as const) button(`ai_settings_${name.toLowerCase()}`, 'preferences', `${root}/Content/Button/${name}`, action, caption);
  const openVoices = button('ai_settings_characters', 'preferences', `${root}/Content/OpenCharacterVolumeSetting`, 'voiceSettings', '角色音量');
  openVoices.skin!.hideText = false;
  openVoices.style = { fontSize: 24, textColor: '#ffffff' };

  const voiceRoot = `${root}/CharacterVolume`;
  project.ui.pages.voiceSettings = { layout: 'custom' };
  image('ai_voice_background', 'voiceSettings', root).text = '角色音量背景';
  image('ai_voice_system_title', 'voiceSettings', `${root}/BG/Title`).text = '设置页标题';
  label('ai_voice_title', 'voiceSettings', `${voiceRoot}/Title`, '角色音量');
  for (const [p, node] of ui.nodes) if (p.startsWith(`${voiceRoot}/`) && ui.components(node).some(c => c.class === 'UnityEngine.UI.Slider')) {
    const parent = p.slice(0, p.lastIndexOf('/')), name = parent.slice(parent.lastIndexOf('/') + 1);
    const caption = ui.components(ui.node(`${parent}/Text`)).find(c => c.class === 'UnityEngine.UI.Text')?.data.m_Text as string;
    let character = project.characters.find(c => c.name === caption || caption === '穗' && c.name === '满穗');
    if (caption !== '其他' && !character) {
      character = { id: `ai_voice_${safe(name)}`, name: caption, color: '#ede6ce', expressions: [] };
      project.characters.push(character);
    }
    if (character && caption === '穗') character.name = caption;
    image(`ai_voice_${safe(name)}_background`, 'voiceSettings', parent);
    label(`ai_voice_${safe(name)}_caption`, 'voiceSettings', `${parent}/Text`, caption);
    slider(`ai_voice_${safe(name)}_slider`, 'voiceSettings', p, 'characterVolume', character?.id).text = `${caption}音量`;
  }
  const closeVoices = button('ai_voice_close', 'voiceSettings', `${voiceRoot}/CloseBtn`, 'return', '退出音量设定');
  closeVoices.skin!.hideText = false;
  closeVoices.style = { fontSize: 22, fontAssetId: project.ui.components.find(c => c.id === 'ai_voice_title')?.style?.fontAssetId, textColor: '#ffffff', align: 'center' };

  project.ui.pages.messageBox = { layout: 'custom', backgroundOpacity: 0 };
  const dialog = ui.includePrefab('UI_MessageBox', 'resources.assets');
  image('ai_confirm_panel', 'messageBox', `${dialog}/BG`).text = '原作确认框背景';
  const message = text('ai_confirm_message', 'messageBox', `${dialog}/Panel/TextTitle`, 'confirmation');
  message.style = { ...message.style, fontSize: 40, align: 'center' };
  const group = ui.node(`${dialog}/Panel/Buttons`), groupRect = ui.rectangle(group);
  const transform = ui.components(group).find(c => c.type === 'RectTransform')!;
  const layout = ui.components(group).find(c => c.class === 'UnityEngine.UI.HorizontalLayoutGroup')!.data;
  const children: UnityObject[] = transform.data.m_Children.map((pointer: any) => ui.reference(transform.file, pointer)).map((r: UnityObject) => ui.reference(r.file, r.data.m_GameObject));
  const totalWidth = children.reduce((total, child) => total + ui.rectangle(child).width, 0) + (children.length - 1) * layout.m_Spacing;
  let nextX = groupRect.x + groupRect.width / 2 - totalWidth / 2;
  for (const child of children) {
    const yes = child.data.m_Name === 'ButtonYes';
    const c = button(`ai_confirm_${yes ? 'yes' : 'no'}`, 'messageBox', `${dialog}/Panel/Buttons/${child.data.m_Name}`, yes ? 'confirmYes' : 'confirmNo', yes ? '确认' : '取消');
    c.x = nextX / ui.width;
    nextX += ui.rectangle(child).width + layout.m_Spacing;
  }
  const dialogueBackground = project.ui.components.find(c => c.id === 'ai_dialogue_background');
  if (dialogueBackground) dialogueBackground.style = { ...dialogueBackground.style, playerOpacity: true };

  const graph = createBlueprintGraph('ui', '设置示例 · 确认语音延续');
  graph.id = 'ai_settings_confirmation';
  const confirm = blueprintNodeDefaults('confirmMessage', 1), set = blueprintNodeDefaults('setPlayerPreference', 2), cancel = blueprintNodeDefaults('return', 3);
  confirm.properties.message = '是否让语音持续到下一段配音？';
  set.properties = { preference: 'voiceSustain', value: true }; cancel.name = '取消并返回';
  graph.nodes.push(confirm, set, cancel);
  connectBlueprintPins(graph, graph.nodes[0].id, 'exec', confirm.id, 'exec_in');
  connectBlueprintPins(graph, confirm.id, 'yes', set.id, 'exec_in');
  connectBlueprintPins(graph, confirm.id, 'no', cancel.id, 'exec_in');
  project.blueprints!.push(graph);
  synchronizeBlueprintSignatures(project);
}
