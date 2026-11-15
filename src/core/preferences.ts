import type { Project, UiComponent, VariableValue } from './model';

export function replacesStandardPreferences(components: readonly UiComponent[]): boolean {
  const controls = new Set(components.filter(c => c.page === 'preferences' && c.kind === 'preference').map(c => c.preference));
  const actions = new Set(components.filter(c => c.page === 'preferences' && c.kind === 'button').map(c => c.action));
  return (['textSpeed', 'autoForwardTime', 'musicVolume', 'soundVolume', 'voiceVolume'] as const).every(key => controls.has(key)) &&
    (['window', 'fullscreen', 'skipSeen', 'skipAll', 'transitions', 'mute'] as const).every(action => actions.has(action));
}

export const playerPreferenceKeys = ['textSpeed', 'autoForwardTime', 'masterVolume', 'musicVolume', 'soundVolume', 'ambientVolume', 'voiceVolume', 'characterVolume', 'dialogueOpacity', 'fullscreen', 'skipAll', 'voiceSustain', 'windowSize'] as const;
export type PlayerPreference = typeof playerPreferenceKeys[number];
export type NumberDisplay = 'number' | 'percent';
export interface PlayerPreferenceInfo {
  name: string; type: 'number' | 'boolean' | 'string'; initial: VariableValue;
  /** The default slider range; authors may change it within `limit`. */
  min?: number; max?: number; step?: number;
  /** What the engine accepts. A missing maximum means no upper bound. */
  limit?: { min: number; max?: number };
  display?: NumberDisplay; unit?: string; options?: readonly string[];
  /** What the value means, shown next to it in the editor. */
  help?: string;
}
const ratio = { min: 0, max: 1, step: .01, limit: { min: 0, max: 1 }, display: 'percent' } as const;
export const playerPreferences: Record<PlayerPreference, PlayerPreferenceInfo> = {
  textSpeed: { name: '文字速度', type: 'number', initial: 35, min: 0, max: 200, step: 1, limit: { min: 0 }, unit: '字/秒', help: '每秒显示的字数；0 为立即显示全部文字。滑条最右端是“立即显示”。' },
  autoForwardTime: { name: '自动播放间隔', type: 'number', initial: 15, min: 0, max: 30, step: .3, limit: { min: 0 }, unit: '秒', help: '自动播放时每句之后的等待时间，数值越大等待越久。' },
  masterVolume: { name: '总音量', type: 'number', initial: 1, ...ratio },
  musicVolume: { name: '音乐音量', type: 'number', initial: 1, ...ratio },
  soundVolume: { name: '音效音量', type: 'number', initial: 1, ...ratio },
  ambientVolume: { name: '环境音量', type: 'number', initial: 1, ...ratio },
  voiceVolume: { name: '语音音量', type: 'number', initial: 1, ...ratio },
  characterVolume: { name: '角色单独音量', type: 'number', initial: 1, ...ratio, help: '每个角色语音的音量，在“角色音量”页分别调整。' },
  dialogueOpacity: { name: '对话框不透明度', type: 'number', initial: 1, ...ratio },
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

/** A built-in setting as this project presents it: the engine definition with the author's name,
 * initial value, range, visibility and display applied. Numbers always have a full range. */
export interface EffectivePreference extends PlayerPreferenceInfo { key: PlayerPreference; visible: boolean; min: number; max: number; step: number }

/** Values the author typed that the engine cannot use fall back to the defaults, never fail. */
export function preferenceInfo(project: Pick<Project, 'playerDefaults' | 'playerPreferenceSettings'> | undefined, key: PlayerPreference): EffectivePreference {
  const base = playerPreferences[key], own = project?.playerPreferenceSettings?.[key];
  const initial = project?.playerDefaults?.[key] ?? base.initial;
  const result: EffectivePreference = { ...base, key, initial, name: own?.name?.trim() || base.name, visible: own?.visible !== false, min: base.min ?? 0, max: base.max ?? 0, step: base.step ?? 1 };
  if (base.type !== 'number') return result;
  if (own?.display) result.display = own.display;
  if (own?.unit !== undefined) result.unit = own.unit || undefined;
  const range = { min: own?.min ?? base.min!, max: own?.max ?? base.max!, step: own?.step ?? base.step! };
  if (!preferenceRangeProblem(key, range)) Object.assign(result, range);
  return result;
}

export function preferenceRangeProblem(key: PlayerPreference, range: { min: number; max: number; step: number }): string | undefined {
  const limit = playerPreferences[key].limit;
  if (!limit) return '这项设置没有数值范围。';
  if (![range.min, range.max, range.step].every(Number.isFinite)) return '范围必须是数字。';
  if (range.min < limit.min) return `最小值不能小于 ${formatPreferenceLimit(key, limit.min)}。`;
  if (limit.max !== undefined && range.max > limit.max) return `最大值不能大于 ${formatPreferenceLimit(key, limit.max)}。`;
  if (range.max <= range.min) return '最大值需大于最小值。';
  if (range.step <= 0) return '步长需大于 0。';
}
const formatPreferenceLimit = (key: PlayerPreference, value: number) => playerPreferences[key].display === 'percent' ? `${value * 100}%` : String(value);

/** A built-in setting's value is within the author's range; instant text speed counts when the range starts at 0. */
export function preferenceInRange(info: EffectivePreference, value: VariableValue) {
  if (info.type !== 'number') return true;
  return typeof value === 'number' && (value >= info.min && value <= info.max || info.key === 'textSpeed' && value === 0 && info.min === 0);
}

export function replacesPreferenceOption(component: UiComponent, preference: PlayerPreference, value: VariableValue): boolean {
  return component.preference === preference && (component.kind === 'preferenceChoice' || component.kind === 'button' && component.action === 'setPlayerPreference' && component.preferenceValue === value);
}
export function playerPreferenceOptions(key: PlayerPreference, project?: Pick<Project, 'playerDefaults' | 'playerPreferenceSettings'>): { label: string; value: VariableValue }[] {
  const info = preferenceInfo(project, key);
  if (info.type === 'boolean') return [{ label: '开启', value: true }, { label: '关闭', value: false }];
  if (info.options) return info.options.map(value => ({ label: value.replace('x', ' × '), value }));
  return [...new Set([info.min, Number(info.initial), info.max])].map(value => ({ label: formatNumber(value, info), value }));
}
/** Whether the engine can use the value. Authored ranges narrow what players pick, not what scripts may set. */
export function validPlayerPreference(key: string, value: unknown): boolean {
  const info = playerPreferences[key as PlayerPreference];
  if (!info || typeof value !== info.type) return false;
  if (typeof value === 'number') return Number.isFinite(value) && value >= info.limit!.min && (info.limit!.max === undefined || value <= info.limit!.max);
  return !info.options || info.options.includes(String(value));
}

/** A number as authors read it, with the parameter's display format. */
export function formatNumber(value: number, display: { display?: NumberDisplay; unit?: string } = {}) {
  if (!Number.isFinite(value)) return String(value);
  if (display.display === 'percent') return `${+(value * 100).toFixed(4)}%`;
  return `${+value.toFixed(6)}${display.unit ? ' ' + display.unit : ''}`;
}
/** Editor inputs show percentages as 0–100; stored values stay 0–1. */
export const displayScale = (display: { display?: NumberDisplay }) => display.display === 'percent' ? 100 : 1;
