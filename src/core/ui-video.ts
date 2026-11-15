import type { VariableValue } from './model';

export const uiVideoEvents = { ended: '视频播放结束时', failed: '视频播放失败时' } as const;
export type UiVideoEvent = keyof typeof uiVideoEvents;
export const uiVideoStatuses = { empty: '未设置视频', loading: '等待视频播放', playing: '正在播放', paused: '已暂停', stopped: '已停止', ended: '播放结束', failed: '播放失败' } as const;
export type UiVideoStatus = keyof typeof uiVideoStatuses;
export type UiVideoMode = 'playing' | 'paused' | 'stopped';
export type UiVideoOperation = 'play' | 'pause' | 'stop';
export const uiVideoOperations = { play: '播放视频', pause: '暂停或继续视频', stop: '停止视频' } as const;
/** Author seeking is intentionally separate from the adapter's internal saved-
 * position restoration. A browser's native seek UI is not an engine capability. */
export const uiVideoCanSeek = false;
export const uiVideoStateVersion = 1;
export interface UiVideoRequest {
  version: 1; pageInstance: number; assetId: string; sourceSequence: number; sequence: number; lastSample: number;
  mode: UiVideoMode; status: UiVideoStatus; loop: boolean; suspended: boolean;
  position: number; duration: number; durationKnown: boolean; error: string;
}
export interface UiVideoReport {
  pageInstance: number; assetId: string; sourceSequence: number; sequence: number; sample: number;
  status: 'metadata' | 'playing' | 'paused' | 'progress' | UiVideoEvent;
  position?: number; duration?: number; durationKnown?: boolean; error?: string;
}
const finiteTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const serial = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const next = (value: number) => { if (!serial(value) || value >= Number.MAX_SAFE_INTEGER) throw new Error('视频请求序号已超出安全范围，请明确重置后重试。'); return value + 1; };
export function uiVideoRequestProblem(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return '视频运行记录无效；请明确重置并保留原记录。';
  const r = value as Record<string, unknown>;
  if (r.version !== uiVideoStateVersion || !serial(r.pageInstance) || !serial(r.sequence) || !serial(r.sourceSequence) || !serial(r.lastSample)
    || typeof r.assetId !== 'string' || !['playing','paused','stopped'].includes(String(r.mode)) || !Object.hasOwn(uiVideoStatuses,String(r.status))
    || typeof r.loop !== 'boolean' || typeof r.suspended !== 'boolean' || typeof r.durationKnown !== 'boolean'
    || !finiteTime(r.position) || !finiteTime(r.duration) || typeof r.error !== 'string') return '视频运行记录版本或内容暂不支持；请明确重置并保留原记录。';
  if (r.durationKnown && !(Number(r.duration) > 0) || !r.durationKnown && r.duration !== 0 || r.durationKnown && Number(r.position) > Number(r.duration)) return '视频时间记录无效；请明确重置并保留原记录。';
}
/** The request identity survives a source A -> B -> A change and separates old
 * play promises/decoder samples from newer pause, stop and loop commands. */
export function uiVideoRequest(previous: UiVideoRequest | undefined, assetId: string, loop: boolean, pageInstance: number): UiVideoRequest {
  if (typeof assetId !== 'string' || typeof loop !== 'boolean' || !serial(pageInstance)) throw new Error('视频素材、循环或页面实例参数无效。');
  if (previous && uiVideoRequestProblem(previous)) throw new Error(uiVideoRequestProblem(previous));
  if (previous?.pageInstance === pageInstance && previous.assetId === assetId) {
    return previous.loop === loop ? previous : { ...previous, loop, sequence: next(previous.sequence), lastSample: 0 };
  }
  const samePage = previous?.pageInstance === pageInstance;
  return { version: 1, pageInstance, assetId, sequence: samePage ? next(previous.sequence) : 1, sourceSequence: samePage ? next(previous.sourceSequence) : 1, lastSample: 0,
    mode: assetId ? 'playing' : 'stopped', status: assetId ? 'loading' : 'empty', loop, suspended: false, position: 0, duration: 0, durationKnown: false, error: '' };
}
export function controlUiVideo(request: UiVideoRequest, operation: UiVideoOperation, value?: boolean): UiVideoRequest {
  const problem = uiVideoRequestProblem(request); if (problem) throw new Error(problem);
  if (!Object.hasOwn(uiVideoOperations,operation) || value !== undefined && typeof value !== 'boolean') throw new Error('请选择有效的视频播放操作和开关参数。');
  if (operation === 'play' && !request.assetId) throw new Error('视频控件尚未设置视频素材。');
  if (!request.assetId) return request;
  if (operation === 'stop') {
    if (request.mode === 'stopped' && request.status === 'stopped') return request;
    return { ...request, mode: 'stopped', status: 'stopped', position: 0, error: '', sequence: next(request.sequence), lastSample: 0 };
  }
  if (operation === 'pause') {
    if (request.mode === 'stopped' || ['ended','failed'].includes(request.status)) return request;
    const mode = (value ?? true) ? 'paused' : 'playing'; if (mode === request.mode) return request;
    return { ...request, mode, status: mode === 'paused' || request.suspended ? 'paused' : 'loading', sequence: next(request.sequence), lastSample: 0 };
  }
  const restart = (value ?? false) || request.mode === 'stopped' || ['ended','failed'].includes(request.status);
  if (!restart && request.mode === 'playing') return request;
  return { ...request, mode: 'playing', status: request.suspended ? 'paused' : 'loading', error: '', sequence: next(request.sequence), lastSample: 0,
    ...(restart ? { sourceSequence: next(request.sourceSequence), position: 0, duration: 0, durationKnown: false } : {}) };
}
export function suspendUiVideo(request: UiVideoRequest, suspended: boolean): UiVideoRequest {
  const problem = uiVideoRequestProblem(request); if (problem) throw new Error(problem);
  if (typeof suspended !== 'boolean') throw new Error('视频挂起参数必须为开关。');
  if (request.suspended === suspended) return request;
  return { ...request, suspended, sequence: next(request.sequence), lastSample: 0,
    status: request.mode === 'stopped' || ['empty','ended','failed'].includes(request.status) ? request.status : suspended || request.mode === 'paused' ? 'paused' : 'loading' };
}
/** Real decoder/player reports are observations, never a simulated timer or an
 * import-metadata duration. Only accepted terminal reports may emit events. */
export function acceptUiVideoReport(request: UiVideoRequest, report: UiVideoReport): UiVideoRequest | undefined {
  if (uiVideoRequestProblem(request) || request.pageInstance !== report.pageInstance || request.assetId !== report.assetId || !request.assetId
    || request.sourceSequence !== report.sourceSequence || request.sequence !== report.sequence || !serial(report.sample) || report.sample <= request.lastSample
    || !['metadata','playing','paused','progress','ended','failed'].includes(report.status)) return;
  if (report.position !== undefined && !finiteTime(report.position) || report.duration !== undefined && !finiteTime(report.duration) || report.durationKnown !== undefined && typeof report.durationKnown !== 'boolean') return;
  if (report.error !== undefined && typeof report.error !== 'string') return;
  if (['ended','failed'].includes(request.status)) return;
  if (report.status === 'playing' && (request.mode !== 'playing' || request.suspended)) return;
  if (report.status === 'paused' && request.mode === 'playing' && !request.suspended) return;
  if (report.status === 'ended' && (request.loop || request.mode !== 'playing' || request.suspended)) return;
  if (report.status === 'failed' && request.mode === 'stopped') return;
  if (request.mode === 'stopped' && report.status !== 'metadata') return;
  const known = report.durationKnown ?? (report.duration !== undefined ? report.duration > 0 : request.durationKnown);
  const duration = known ? report.duration ?? request.duration : 0; if (known && duration <= 0) return;
  const position = request.mode === 'stopped' ? 0 : Math.max(0, Math.min(known ? duration : Infinity, report.position ?? request.position));
  const status = report.status === 'metadata' || report.status === 'progress' ? request.status : report.status;
  return { ...request, lastSample: report.sample, status, position, duration, durationKnown: known,
    error: report.status === 'failed' ? [...(report.error || '视频无法读取、解码或播放。')].slice(0,2000).join('') : request.error };
}
export function uiVideoObservation(request: UiVideoRequest, property: string): VariableValue | undefined {
  const values: Record<string,VariableValue> = { videoStatus: request.status, videoPlaying: request.status === 'playing' && request.mode === 'playing' && !request.suspended,
    videoPaused: request.status === 'paused', videoPosition: request.position, videoDuration: request.duration, videoDurationKnown: request.durationKnown,
    videoProgress: request.durationKnown && request.duration > 0 ? Math.max(0,Math.min(1,request.position/request.duration)) : 0, videoError: request.error, videoCanSeek: uiVideoCanSeek };
  return values[property];
}
