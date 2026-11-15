import type { Asset, SpinePlayback, VariableValue } from './model';

/** Native physics advances in 1/30-second steps. With a 0.1-second frame cap,
 * this bounds one update to approximately 97 steps instead of unbounded work. */
export const uiSpineMaximumSpeed = 32;
export const uiSpineSpeedRange = `0～${uiSpineMaximumSpeed}`;
export const uiSpineSpeedMessage = `骨骼播放速度需要 ${uiSpineSpeedRange} 之间的有限数值；超出范围不会修改原值。`;
export function uiSpineSpeedProblem(value: unknown): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > uiSpineMaximumSpeed) return uiSpineSpeedMessage;
}

export const uiSpineEvents = { completed: '骨骼动画完成时', failed: '骨骼播放失败时' } as const;
export type UiSpineEvent = keyof typeof uiSpineEvents;
/** Animation/skin constants may target a runtime replacement, not just the
 * design asset. Keep names grouped by their source without evaluating a graph. */
export function uiSpineNamedChoices(assets: readonly Asset[], kind: 'animation' | 'skin'): Record<string, string> {
  const names = new Map<string, string[]>();
  for (const asset of assets) if (asset.kind === 'spine' && asset.spine) {
    for (const name of kind === 'animation' ? asset.spine.animations.map(a => a.name) : asset.spine.skins) {
      const sources = names.get(name) ?? []; if (!sources.includes(asset.name)) sources.push(asset.name); names.set(name, sources);
    }
  }
  return Object.fromEntries([...names].map(([name, sources]) => [name, name + ' · ' + sources.join(' / ')]));
}
export const uiSpineStatuses = { empty: '未设置骨骼素材', loading: '等待骨骼加载', ready: '显示初始姿态', playing: '正在播放', paused: '已暂停', completed: '动画已完成', failed: '播放失败' } as const;
export type UiSpineStatus = keyof typeof uiSpineStatuses;
export const uiSpineObservationProperties = ['spineAnimation', 'spineStatus', 'spinePlaying', 'spinePaused', 'spinePosition', 'spineDuration', 'spineDurationKnown', 'spineProgress', 'spineError'] as const;
export interface UiSpineRequest {
  version: 1; pageInstance: number; assetId: string; sequence: number; sourceSequence: number; lastSample: number;
  animation: string; skin: string; loop: boolean; paused: boolean; speed: number; suspended: boolean;
  status: UiSpineStatus; position: number; duration: number; durationKnown: boolean; error: string;
}
export interface UiSpineReport {
  pageInstance: number; assetId: string; sequence: number; sourceSequence: number; sample: number;
  animation: string; status: 'ready' | 'playing' | 'paused' | 'progress' | 'completed' | 'failed';
  position: number; duration: number; durationKnown: boolean; error?: string;
}
const counter = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const next = (value: number) => { if (!counter(value) || value === Number.MAX_SAFE_INTEGER) throw Error('骨骼请求序号超出安全范围，请明确重置控件。'); return value + 1; };
const terminal = (r: UiSpineRequest) => r.status === 'completed' || r.status === 'failed';
const waiting = (r: UiSpineRequest): UiSpineStatus => !r.assetId ? 'empty' : r.paused || r.suspended || r.speed === 0 ? 'paused' : 'loading';
export function uiSpineRequestProblem(value: unknown): string | undefined {
  const r = value as UiSpineRequest;
  if (!r || typeof r !== 'object' || r.version !== 1) return '骨骼运行记录版本不受支持，请明确重置控件并保留原记录。';
  if (![r.pageInstance, r.sequence, r.sourceSequence, r.lastSample].every(counter) || ![r.assetId, r.animation, r.skin, r.error].every(v => typeof v === 'string') || !Object.hasOwn(uiSpineStatuses, r.status) || ![r.paused, r.loop, r.suspended, r.durationKnown].every(v => typeof v === 'boolean')) return '骨骼运行记录内容无效。';
  const speedProblem = uiSpineSpeedProblem(r.speed); if (speedProblem) return speedProblem;
  if (![r.position, r.duration].every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0) || !r.durationKnown && r.duration !== 0 || r.durationKnown && r.position > r.duration) return '骨骼时间记录无效。';
}
export function uiSpineSkinProblem(asset: Asset | undefined, skin: unknown): string | undefined {
  if (typeof skin !== 'string' || skin !== '' && !asset?.spine?.skins.includes(skin)) return '当前骨骼素材没有所选皮肤；空值表示默认皮肤。';
}
/** A→B→A and restart use distinct source generations. Metadata chooses only the
 * initial animation; duration and completion always come from a real runtime. */
export function uiSpineRequest(previous: UiSpineRequest | undefined, asset: Asset | undefined, settings: SpinePlayback, pageInstance: number): UiSpineRequest {
  if (!counter(pageInstance)) throw Error('骨骼页面实例无效。');
  if (previous) { const problem = uiSpineRequestProblem(previous); if (problem) throw Error(problem); }
  const assetId = asset?.id ?? '', skin = settings.skin ?? '', loop = settings.loop ?? true, speed = settings.speed ?? 1;
  if (typeof loop !== 'boolean') throw Error('骨骼循环播放需要开关值。');
  const speedProblem = uiSpineSpeedProblem(speed); if (speedProblem) throw Error(speedProblem);
  const skinProblem = uiSpineSkinProblem(asset, skin); if (skinProblem) throw Error(skinProblem);
  const sameOwner = previous?.pageInstance === pageInstance;
  if (!previous || !sameOwner || previous.assetId !== assetId) {
    const animation = settings.animation ?? asset?.spine?.animations[0]?.name ?? '';
    return { version: 1, pageInstance, assetId, sequence: sameOwner ? next(previous!.sequence) : 1, sourceSequence: sameOwner ? next(previous!.sourceSequence) : 1, lastSample: 0,
      animation: assetId ? animation : '', skin, loop, paused: sameOwner && previous ? previous.paused : !(settings.autoplay ?? true), speed, suspended: false,
      status: assetId ? 'loading' : 'empty', position: 0, duration: 0, durationKnown: false, error: '' };
  }
  if (previous.skin === skin && previous.loop === loop && previous.speed === speed) return previous;
  const r = { ...previous, skin, loop, speed, sequence: next(previous.sequence), lastSample: 0 };
  if (!terminal(r)) r.status = waiting(r);
  return r;
}
export function playUiSpine(request: UiSpineRequest, asset: Asset | undefined, animation: unknown, loop: unknown = true, restart: unknown = true): UiSpineRequest {
  if (uiSpineRequestProblem(request)) throw Error(uiSpineRequestProblem(request));
  if (typeof animation !== 'string' || !asset?.spine?.animations.some(a => a.name === animation) || asset.id !== request.assetId) throw Error('当前骨骼素材没有所选动画。');
  if (typeof loop !== 'boolean' || typeof restart !== 'boolean') throw Error('循环播放和重新开始需要开关值。');
  const reset = restart || request.animation !== animation || terminal(request);
  if (!reset && request.loop === loop && !request.paused) return request;
  const r = { ...request, animation, loop, paused: false, sequence: next(request.sequence), lastSample: 0, error: '' };
  if (reset) Object.assign(r, { sourceSequence: next(r.sourceSequence), position: 0, duration: 0, durationKnown: false });
  r.status = waiting(r); return r;
}
export function pauseUiSpine(request: UiSpineRequest, paused: unknown): UiSpineRequest {
  const problem = uiSpineRequestProblem(request); if (problem) throw Error(problem);
  if (typeof paused !== 'boolean') throw Error('暂停骨骼动画需要开关值。');
  if (request.paused === paused || !request.assetId) return request;
  const r = { ...request, paused, sequence: next(request.sequence), lastSample: 0 }; if (!terminal(r)) r.status = waiting(r); return r;
}
export function suspendUiSpine(request: UiSpineRequest, suspended: boolean): UiSpineRequest {
  const problem = uiSpineRequestProblem(request); if (problem) throw Error(problem);
  if (typeof suspended !== 'boolean') throw Error('骨骼宿主挂起状态需要开关值。');
  if (request.suspended === suspended) return request;
  const r = { ...request, suspended, sequence: next(request.sequence), lastSample: 0 }; if (!terminal(r)) r.status = waiting(r); return r;
}
export function acceptUiSpineReport(request: UiSpineRequest, report: UiSpineReport): UiSpineRequest | undefined {
  if (uiSpineRequestProblem(request) || !request.assetId || terminal(request) || report.pageInstance !== request.pageInstance || report.assetId !== request.assetId || report.animation !== request.animation || report.sequence !== request.sequence || report.sourceSequence !== request.sourceSequence || !counter(report.sample) || report.sample <= request.lastSample) return;
  if (!['ready','playing','paused','progress','completed','failed'].includes(report.status) || typeof report.durationKnown !== 'boolean' || ![report.position, report.duration].every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0) || !report.durationKnown && report.duration !== 0 || report.durationKnown && report.position > report.duration || report.error !== undefined && typeof report.error !== 'string') return;
  const stopped = request.paused || request.suspended || request.speed === 0;
  if (report.status === 'completed' && (request.loop || stopped || !request.animation || !report.durationKnown || report.position !== report.duration)) return;
  if (report.status === 'playing' && (stopped || !request.animation) || report.status === 'ready' && request.animation !== '') return;
  const status: UiSpineStatus = report.status === 'progress' ? !request.animation ? 'ready' : stopped ? 'paused' : 'playing' : report.status;
  return { ...request, position: report.position, duration: report.duration, durationKnown: report.durationKnown, status, lastSample: report.sample, error: status === 'failed' ? (report.error || '骨骼素材无法加载或播放。').slice(0, 2000) : '' };
}
export function uiSpineObservation(request: UiSpineRequest, property: string): VariableValue | undefined {
  return ({ spineAnimation: request.animation, spineStatus: request.status, spinePlaying: request.status === 'playing' && !request.paused && !request.suspended && request.speed > 0,
    spinePaused: request.status === 'paused', spinePosition: request.position, spineDuration: request.duration, spineDurationKnown: request.durationKnown,
    spineProgress: request.durationKnown && request.duration > 0 ? Math.min(1, Math.max(0, request.position / request.duration)) : request.status === 'completed' ? 1 : 0, spineError: request.error } as Record<string, VariableValue>)[property];
}

export function resetUiSpine(previous: UiSpineRequest | undefined, initial: UiSpineRequest): UiSpineRequest {
  return previous && previous.pageInstance === initial.pageInstance ? { ...initial, sequence: next(previous.sequence), sourceSequence: next(previous.sourceSequence), lastSample: 0 } : initial;
}
