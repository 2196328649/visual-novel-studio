import type { UiComponent, VariableValue } from './model';

export function replacesStandardPreferences(components: readonly UiComponent[]): boolean {
  const controls = new Set(components.filter(c => c.page === 'preferences' && c.kind === 'preference').map(c => c.preference));
  const actions = new Set(components.filter(c => c.page === 'preferences' && c.kind === 'button').map(c => c.action));
  return (['textSpeed', 'autoForwardTime', 'musicVolume', 'soundVolume', 'voiceVolume'] as const).every(key => controls.has(key)) &&
    (['window', 'fullscreen', 'skipSeen', 'skipAll', 'transitions', 'mute'] as const).every(action => actions.has(action));
}

export const playerPreferenceKeys = ['textSpeed', 'autoForwardTime', 'masterVolume', 'musicVolume', 'soundVolume', 'ambientVolume', 'voiceVolume', 'characterVolume', 'dialogueOpacity', 'fullscreen', 'skipAll', 'voiceSustain', 'windowSize'] as const;
export type PlayerPreference = typeof playerPreferenceKeys[number];
export interface PlayerPreferenceInfo { name: string; type: 'number' | 'boolean' | 'string'; initial: VariableValue; min?: number; max?: number; options?: readonly string[] }
export const playerPreferences: Record<PlayerPreference, PlayerPreferenceInfo> = {
  textSpeed: { name: '文字速度', type: 'number', initial: 35, min: 0, max: 200 },
  autoForwardTime: { name: '自动播放间隔', type: 'number', initial: 15, min: 0, max: 30 },
  masterVolume: { name: '总音量', type: 'number', initial: 1, min: 0, max: 1 },
  musicVolume: { name: '音乐音量', type: 'number', initial: 1, min: 0, max: 1 },
  soundVolume: { name: '音效音量', type: 'number', initial: 1, min: 0, max: 1 },
  ambientVolume: { name: '环境音量', type: 'number', initial: 1, min: 0, max: 1 },
  voiceVolume: { name: '语音音量', type: 'number', initial: 1, min: 0, max: 1 },
  characterVolume: { name: '角色单独音量', type: 'number', initial: 1, min: 0, max: 1 },
  dialogueOpacity: { name: '对话框不透明度', type: 'number', initial: 1, min: 0, max: 1 },
  fullscreen: { name: '全屏显示', type: 'boolean', initial: false },
  skipAll: { name: '跳过未读内容', type: 'boolean', initial: false },
  voiceSustain: { name: '语音持续到下一段配音', type: 'boolean', initial: false },
  windowSize: { name: '窗口分辨率', type: 'string', initial: '1280x720', options: ['640x360', '960x540', '1280x720', '1600x900', '1920x1080', '2560x1440', '3840x2160'] },
};
export const sliderPreferences = playerPreferenceKeys.filter(key => playerPreferences[key].type === 'number');
export const standardPreferenceChoices: { preference: PlayerPreference; title: string; options: { label: string; value: VariableValue }[] }[] = [
  { preference: 'voiceSustain', title: '语音停止方式', options: [{ label: '点击时停止', value: false }, { label: '持续到下一段配音', value: true }] },
  { preference: 'windowSize', title: '窗口大小', options: ['640x360', '960x540', '1280x720', '1920x1080'].map(value => ({ label: value.replace('x', ' × '), value })) },
];
export function replacesPreferenceOption(component: UiComponent, preference: PlayerPreference, value: VariableValue): boolean {
  return component.preference === preference && (component.kind === 'preferenceChoice' || component.kind === 'button' && component.action === 'setPlayerPreference' && component.preferenceValue === value);
}
export function playerPreferenceOptions(key: PlayerPreference): { label: string; value: VariableValue }[] {
  const info = playerPreferences[key];
  if (info.type === 'boolean') return [{ label: '开启', value: true }, { label: '关闭', value: false }];
  if (info.options) return info.options.map(value => ({ label: value.replace('x', ' × '), value }));
  return [...new Set([info.min!, Number(info.initial), info.max!])].map(value => ({ label: String(value), value }));
}
export function validPlayerPreference(key: string, value: unknown): boolean {
  const info = playerPreferences[key as PlayerPreference];
  if (!info || typeof value !== info.type) return false;
  if (typeof value === 'number') return Number.isFinite(value) && value >= info.min! && value <= info.max!;
  return !info.options || info.options.includes(String(value));
}
