import { uiPageTheme } from './ui-page-settings';
import { declaredUiComponents, type Project, type UiComponent } from './model';
import { playerPreferences, preferenceInfo, replacesPreferenceOption, replacesStandardPreferences, standardPreferenceChoices, type PlayerPreference } from './preferences';
import { dialogueLayout } from './ui';
import { uiMenuButtons } from './ui-page-catalog';
import { uiActionAvailable } from './ui-availability';

export interface NativePreferenceLayout {
  kind: 'settings' | 'shortcut' | 'music' | 'history' | 'voices';
  components: UiComponent[];
  bodyIds: string[];
  top: number;
  height: number;
  contentHeight: number;
}

/** Temporary controls for the native settings pages, never stored in the project. */
export function nativePreferencePreview(project: Project, pageId: string, authored: UiComponent[]): NativePreferenceLayout | undefined {
  if (pageId !== 'ui:preferences' && pageId !== 'ui:voiceSettings') return;
  const page = pageId.slice(3) as 'preferences' | 'voiceSettings', theme = uiPageTheme(project, pageId);
  if (theme.pages?.[page]?.layout === 'custom') return;
  const fullyCustom = page === 'preferences' && replacesStandardPreferences(authored);
  const { width, height } = project, { margin, contentWidth } = dialogueLayout(width, height, theme), font = Math.min(24, theme.fontSize);
  const components: UiComponent[] = [], bodyIds: string[] = [], occupied = new Set([...declaredUiComponents(project),...authored].map(c => c.id));
  const add = (key: string, kind: UiComponent['kind'], text: string, x: number, y: number, w: number, h: number, patch: Partial<UiComponent> = {}, body = true) => {
    let id = '__preview_native_' + page + '_' + key; while (occupied.has(id)) id += '_'; occupied.add(id);
    const component: UiComponent = { id, page, kind, text, x: x / width, y: y / height, width: w / width, height: h / height,
      style: { fontSize: font, textColor: theme.textColor, background: kind === 'button' ? '#283133' : undefined, selectedBackground: theme.accent }, ...patch };
    components.push(component); if (body) bodyIds.push(id); return component;
  };
  const buttonHeight = Math.ceil(font * 1.4) + 16, labelHeight = Math.ceil(font * 1.4);
  add('title', 'text', page === 'preferences' ? '设置' : '角色音量', margin, 22, contentWidth * .6, buttonHeight, {}, false);
  add('return', 'button', page === 'voiceSettings' && uiActionAvailable(theme, 'preferences') ? '返回设置' : '返回', width - margin - 150, 22, 150, buttonHeight, { action: 'return' }, false);
  let navX = margin;
  for (const [action, text] of uiMenuButtons.filter(([action]) => uiActionAvailable(theme, action))) {
    const w = Math.min(96, (contentWidth - 30) / 7);
    add('nav_' + action, 'button', text, navX, 22 + buttonHeight + 12, w, buttonHeight, { action }, false); navX += w + 5;
  }
  const top = 22 + 2 * buttonHeight + 30, viewportHeight = Math.max(80, height - top - 22);
  let y = 12; const x = margin + 12, w = contentWidth - 42;
  const actions = new Set(authored.filter(c => c.kind === 'button').map(c => c.action));
  const controls = new Set(authored.filter(c => c.kind === 'preference').map(c => c.preference));
  const label = (key: string, text: string) => { add(key, 'text', text, x, y, w, labelHeight); y += labelHeight + 8; };
  const actionRow = (entries: [NonNullable<UiComponent['action']>, string][]) => {
    entries = entries.filter(([action]) => uiActionAvailable(theme, action));
    if (!entries.length) return;
    let left = x;
    for (const [action,text] of entries) { const size = Math.min(w, text.length * font + 24); if (!actions.has(action)) add(action,'button',text,left,y,size,buttonHeight,{action}); left += size + 10; }
    y += buttonHeight + 18;
  };
  const shown = (preference: PlayerPreference) => preferenceInfo(project, preference).visible;
  const slider = (preference: PlayerPreference, text = preferenceInfo(project, preference).name, character?: string) => {
    if (page !== 'voiceSettings' && !shown(preference)) return;
    const replaced = page === 'voiceSettings' ? authored.some(c => c.kind === 'preference' && c.preference === 'characterVolume' && (c.preferenceCharacterId ?? '') === (character ?? '')) : controls.has(preference);
    if (!replaced) add(preference + '_' + (character ?? 'other'), 'preference', text, x, y, w, labelHeight + 38, { preference, preferenceCharacterId: character });
    y += labelHeight + 56;
  };
  if (page === 'voiceSettings') {
    for (const character of [...project.characters.map(c=>({id:c.id,name:c.name})),{id:undefined,name:'旁白及其他'}]) slider('characterVolume',character.name,character.id);
  } else if (!fullyCustom) {
    if (shown('fullscreen')) { label('display_label','显示'); actionRow([['window','窗口'],['fullscreen','全屏']]); }
    slider('textSpeed'); slider('autoForwardTime'); if (shown('skipAll')) { label('skip_label','跳过范围'); actionRow([['skipSeen','已读文本'],['skipAll','全部文本']]); } actionRow([['transitions','跳过转场']]);
    slider('musicVolume'); slider('soundVolume'); slider('voiceVolume'); actionRow([['mute','全部静音']]);
    slider('masterVolume'); slider('ambientVolume'); slider('dialogueOpacity'); if (shown('characterVolume')) actionRow([['voiceSettings',preferenceInfo(project,'characterVolume').name===playerPreferences.characterVolume.name?'角色音量':preferenceInfo(project,'characterVolume').name]]);
    for (const group of standardPreferenceChoices.filter(group => shown(group.preference))) {
      label(group.preference+'_label',group.title);
      group.options.forEach((option,index)=>{
        const column=index%2,row=Math.floor(index/2),size=Math.min((w-10)/2,option.label.length*font+24);
        if (!authored.some(c=>replacesPreferenceOption(c,group.preference,option.value))) add(group.preference+'_'+index,'button',option.label,x+column*(Math.min((w-10)/2,240)+10),y+row*(buttonHeight+8),size,buttonHeight,{action:'setPlayerPreference',preference:group.preference,preferenceValue:option.value});
      });
      y += Math.ceil(group.options.length/2)*(buttonHeight+8)+10;
    }
    actionRow([['resetPreferences','恢复初始设置']]);
  }
  return { kind: 'settings', components, bodyIds, top, height: viewportHeight, contentHeight: y + 12 };
}
