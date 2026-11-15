import { useEffect, useRef } from 'react';
import type { Project, UiComponent } from '../core/model';
import { uiVideoRequest, type UiVideoReport, type UiVideoRequest } from '../core/ui-video';
import type { AssetUrl } from './StageEditor';

export interface UiVideoFeedback { request: UiVideoRequest; onReport: (report: UiVideoReport) => void }

/** The design canvas uses the same player without an event sink. Runtime state
 * always comes from the actual media element, not imported duration metadata. */
export function UiVideoView({ project, component, assetUrl, feedback }: {
  project: Project; component: UiComponent; assetUrl: AssetUrl; feedback?: UiVideoFeedback;
}) {
  const assetId = component.assetId ?? '', asset = project.assets.find(a => a.id === assetId && a.kind === 'video');
  const url = asset ? assetUrl(asset.id) ?? '' : '', poster = assetUrl(component.posterId);
  const request = feedback?.request ?? uiVideoRequest(undefined, assetId, component.loop ?? true, 0);
  const key = JSON.stringify([assetId, url, request.pageInstance, request.sourceSequence]);
  return <UiVideoSource key={key} {...{ url, poster, request, feedback }} />;
}

function UiVideoSource({ url, poster, request, feedback }: {
  url: string; poster?: string; request: UiVideoRequest; feedback?: UiVideoFeedback;
}) {
  const video = useRef<HTMLVideoElement>(null), generation = useRef(0);
  const current = useRef({ request, feedback }); current.current = { request, feedback };
  const restore = useRef<number | undefined>(request.position);
  useEffect(() => {
    const element = video.current; if (!element) return;
    const token = ++generation.current, command = current.current.request;
    let sample = command.lastSample, lastProgress = -1;
    const live = () => generation.current === token && current.current.request.pageInstance === command.pageInstance
      && current.current.request.sourceSequence === command.sourceSequence && current.current.request.sequence === command.sequence;
    const report = (status: UiVideoReport['status'], error?: string) => {
      if (!live()) return;
      const durationKnown = Number.isFinite(element.duration) && element.duration > 0;
      const position = Number.isFinite(element.currentTime) ? Math.max(0, element.currentTime) : 0;
      if (status === 'progress' && position === lastProgress) return;
      if (status === 'progress') lastProgress = position;
      current.current.feedback?.onReport({ pageInstance: command.pageInstance, assetId: command.assetId,
        sourceSequence: command.sourceSequence, sequence: command.sequence, sample: ++sample, status, position,
        duration: durationKnown ? element.duration : 0, durationKnown, ...(error ? { error } : {}) });
    };
    const shouldPlay = () => command.mode === 'playing' && !command.suspended && !['empty', 'ended', 'failed'].includes(command.status);
    const apply = () => {
      if (!live()) return;
      element.loop = command.loop;
      if (element.readyState >= 1 && restore.current !== undefined) {
        const position = restore.current; restore.current = undefined;
        if (position > 0) {
          try { element.currentTime = Number.isFinite(element.duration) ? Math.min(element.duration, position) : position; }
          catch { report('failed', '无法恢复视频的已保存播放位置。'); return; }
        }
      }
      if (!shouldPlay()) {
        element.pause();
        if (command.mode === 'stopped') {
          restore.current = 0;
          if (element.readyState >= 1 && element.currentTime !== 0) element.currentTime = 0;
        }
        return;
      }
      // A source may still be loading; play() resolves only after real playback.
      void element.play().catch((error: unknown) => {
        if (!live() || (error instanceof DOMException && error.name === 'AbortError')) return;
        report('failed', error instanceof Error ? error.message : '视频无法播放。');
      });
    };
    const metadata = () => { report('metadata'); apply(); };
    const playing = () => { if (!element.paused && !element.ended && shouldPlay()) report('playing'); };
    const paused = () => { if (element.paused && (command.mode === 'paused' || command.suspended)) report('paused'); };
    const progress = () => { if (!element.seeking) report('progress'); };
    const ended = () => { if (element.ended && !element.loop && shouldPlay()) report('ended'); };
    const failed = () => { if (element.error) report('failed', '视频无法读取或解码（播放器错误 ' + element.error.code + '）。'); };
    const listeners: [string, () => void][] = [['loadedmetadata', metadata], ['durationchange', metadata], ['playing', playing],
      ['pause', paused], ['timeupdate', progress], ['ended', ended], ['error', failed]];
    for (const [name, listener] of listeners) element.addEventListener(name, listener);
    if (!url && command.assetId) report('failed', '视频素材不存在或无法读取。');
    else if (url) { if (element.readyState >= 1) report('metadata'); apply(); }
    return () => {
      ++generation.current;
      for (const [name, listener] of listeners) element.removeEventListener(name, listener);
      element.pause();
    };
  }, [url, request.pageInstance, request.sourceSequence, request.sequence, request.loop]);
  const cover = ['empty', 'stopped', 'ended', 'failed'].includes(request.status);
  return <span className="ui-video-surface">
    <video ref={video} className="ui-video" data-ui-video-source={request.assetId} data-ui-video-status={request.status}
      src={url || undefined} poster={poster} muted playsInline preload="auto" style={cover ? { visibility: 'hidden' } : undefined} />
    {cover && poster && <img className="ui-video" alt="" aria-hidden="true" draggable={false} src={poster} />}
  </span>;
}
