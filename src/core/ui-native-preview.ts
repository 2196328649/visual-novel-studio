import { declaredUiComponents, effectiveUiComponents, effectiveUiTheme, type Project, type UiComponent } from './model';
import { parameterSets, settingsParameters } from './parameter-sets';
import { playerPreferences, replacesPreferenceOption, replacesStandardPreferences, standardPreferenceChoices, type PlayerPreference } from './preferences';
import { dialogueLayout } from './ui';

export interface NativePreferenceLayout {
  kind: 'settings' | 'parameters' | 'shortcut' | 'music' | 'history' | 'voices';
  moreSettingsId?: string;
  components: UiComponent[];
  bodyIds: string[];
  top: number;
  height: number;
  contentHeight: number;
}

export const nativeParameterSettingsPage = 'ui:parameterSettings';

/** Temporary controls for the native settings pages, never stored in the project. */
export function nativePreferencePreview(project: Project, pageId: string, authored: UiComponent[], preferenceComponents?: UiComponent[]): NativePreferenceLayout | undefined {
  const parameters = pageId === nativeParameterSettingsPage;
  if (!parameters && pageId !== 'ui:preferences' && pageId !== 'ui:voiceSettings') return;
  const page = parameters ? 'preferences' : pageId.slice(3) as 'preferences' | 'voiceSettings', theme = effectiveUiTheme(project.ui);
  const custom = !parameters && theme.pages?.[page]?.layout === 'custom';
  if (custom && page === 'voiceSettings') return;
  const placed = parameters ? preferenceComponents ?? effectiveUiComponents(project.ui).filter(c => c.page === 'preferences') : authored;
  const unplaced = settingsParameters(project).filter(v => v.setting?.visible !== false && !placed.some(c => c.parameterId === v.id));
  const fullyCustom = page === 'preferences' && (custom || replacesStandardPreferences(authored));
  if (custom && !unplaced.length) return;
  const { width, height } = project, { margin, contentWidth } = dialogueLayout(width, height, theme), font = Math.min(24, theme.fontSize);
  const components: UiComponent[] = [], bodyIds: string[] = [], occupied = new Set([...declaredUiComponents(project),...authored].map(c => c.id));
  const add = (key: string, kind: UiComponent['kind'], text: string, x: number, y: number, w: number, h: number, patch: Partial<UiComponent> = {}, body = true) => {
    let id = '__preview_native_' + (parameters ? 'parameterSettings' : page) + '_' + key; while (occupied.has(id)) id += '_'; occupied.add(id);
    const component: UiComponent = { id, page, kind, text, x: x / width, y: y / height, width: w / width, height: h / height,
      style: { fontSize: font, textColor: theme.textColor, background: kind === 'button' ? '#283133' : undefined, selectedBackground: theme.accent }, ...patch };
    components.push(component); if (body) bodyIds.push(id); return component;
  };
  const buttonHeight = Math.ceil(font * 1.4) + 16, labelHeight = Math.ceil(font * 1.4);
  let moreSettingsId: string | undefined;
  if (!parameters && fullyCustom && unplaced.length) {
    const size = font * 4 + 24;
    moreSettingsId = add('more', 'button', '更多设置', (width - size) * .97, (height - buttonHeight) * .97, size, buttonHeight, {}, false).id;
  }
  const finish = (kind: NativePreferenceLayout['kind'], top: number, viewportHeight: number, contentHeight: number): NativePreferenceLayout => {
    const more = components.find(c => c.id === moreSettingsId);
    if (more) more.layer = Math.max(components.length + authored.length, ...authored.map(c => c.layer ?? 0)) + 1;
    return { kind, components, bodyIds, moreSettingsId, top, height: viewportHeight, contentHeight };
  };
  if (custom) return finish('shortcut', 0, 0, 0);
  add('title', 'text', parameters ? '更多设置' : page === 'preferences' ? '设置' : '角色音量', margin, 22, contentWidth * .6, buttonHeight, {}, false);
  add('return', 'button', parameters || page === 'voiceSettings' ? '返回设置' : '返回', width - margin - 150, 22, 150, buttonHeight, { action: 'return' }, false);
  let navX = margin;
  for (const [action, text] of [['save','存档'],['load','读档'],['preferences','设置'],['history','历史'],['gallery','画廊'],['music','音乐'],['mainMenu','标题']] as const) {
    const w = Math.min(96, (contentWidth - 30) / 7);
    add('nav_' + action, 'button', text, navX, 22 + buttonHeight + 12, w, buttonHeight, { action }, false); navX += w + 5;
  }
  const top = 22 + 2 * buttonHeight + 30, viewportHeight = Math.max(80, height - top - 22);
  let y = 12; const x = margin + 12, w = contentWidth - 42;
  const actions = new Set(authored.filter(c => c.kind === 'button').map(c => c.action));
  const controls = new Set(authored.filter(c => c.kind === 'preference').map(c => c.preference));
  const label = (key: string, text: string) => { add(key, 'text', text, x, y, w, labelHeight); y += labelHeight + 8; };
  const actionRow = (entries: [NonNullable<UiComponent['action']>, string][]) => {
    let left = x;
    for (const [action,text] of entries) { const size = Math.min(w, text.length * font + 24); if (!actions.has(action)) add(action,'button',text,left,y,size,buttonHeight,{action}); left += size + 10; }
    y += buttonHeight + 18;
  };
  const slider = (preference: PlayerPreference, text = playerPreferences[preference].name, character?: string) => {
    const replaced = page === 'voiceSettings' ? authored.some(c => c.kind === 'preference' && c.preference === 'characterVolume' && (c.preferenceCharacterId ?? '') === (character ?? '')) : controls.has(preference);
    if (!replaced) add(preference + '_' + (character ?? 'other'), 'preference', text, x, y, w, labelHeight + 38, { preference, preferenceCharacterId: character });
    y += labelHeight + 56;
  };
  const parameterControls = () => {
    for (const set of parameterSets(project).filter(s => s.kind === 'settings')) {
      const variables = unplaced.filter(v => v.parameterSetId === set.id); if (!variables.length) continue;
      label('set_' + set.id, set.name);
      for (const variable of variables) {
        if (variable.type === 'string') label('label_' + variable.id, variable.name);
        add('variable_' + variable.id, 'preference', variable.name, x, y, w, labelHeight + 38, { parameterId: variable.id }); y += labelHeight + 56;
      }
    }
  };
  if (parameters) parameterControls();
  else if (page === 'voiceSettings') {
    for (const character of [...project.characters.map(c=>({id:c.id,name:c.name})),{id:undefined,name:'旁白及其他'}]) slider('characterVolume',character.name,character.id);
  } else if (!fullyCustom) {
    label('display_label','显示'); actionRow([['window','窗口'],['fullscreen','全屏']]);
    slider('textSpeed'); slider('autoForwardTime'); label('skip_label','跳过范围'); actionRow([['skipSeen','已读文本'],['skipAll','全部文本']]); actionRow([['transitions','跳过转场']]);
    slider('musicVolume'); slider('soundVolume'); slider('voiceVolume'); actionRow([['mute','全部静音']]);
    slider('masterVolume'); slider('ambientVolume'); slider('dialogueOpacity'); actionRow([['voiceSettings','角色音量']]);
    for (const group of standardPreferenceChoices) {
      label(group.preference+'_label',group.title);
      group.options.forEach((option,index)=>{
        const column=index%2,row=Math.floor(index/2),size=Math.min((w-10)/2,option.label.length*font+24);
        if (!authored.some(c=>replacesPreferenceOption(c,group.preference,option.value))) add(group.preference+'_'+index,'button',option.label,x+column*(Math.min((w-10)/2,240)+10),y+row*(buttonHeight+8),size,buttonHeight,{action:'setPlayerPreference',preference:group.preference,preferenceValue:option.value});
      });
      y += Math.ceil(group.options.length/2)*(buttonHeight+8)+10;
    }
    parameterControls();
    actionRow([['resetPreferences','恢复初始设置']]);
  }
  return finish(parameters ? 'parameters' : 'settings', top, viewportHeight, y + 12);
}
