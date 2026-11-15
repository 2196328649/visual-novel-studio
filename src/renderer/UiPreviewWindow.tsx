import { checkedUiPreviewAction, uiPreviewActionResultSchema, type UiPreviewAction, type UiPreviewActionResult } from '../core/ui-preview-actions';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { UiPreviewWindowContext } from '../core/bridge';
import { pagePreviewOrigin } from '../core/preview-origin';
import { UiLogicPreview } from './UiLogicPreview';

export function UiPreviewWindow() {
 const actionSequence = useRef(0), pendingActions = useRef(new Map<string, (result: UiPreviewActionResult) => void>());
 const [context, setContext] = useState<UiPreviewWindowContext>(), [error, setError] = useState('');
 useEffect(() => {
  let active = true, receivedUpdate = false;
  const receive = (next: UiPreviewWindowContext) => { receivedUpdate = true; if (active) { setContext(next); setError(''); } };
  const unsubscribe = window.studio?.onUiPreviewContext?.(receive);
  void window.studio?.getUiPreviewContext?.().then(initial => { if (active && !receivedUpdate && initial) setContext(initial); }).catch(error => { if (active) setError(String(error)); });
  const opener = window.opener;
  const onMessage = (event: MessageEvent) => {
   if (event.source === opener && event.origin === location.origin && event.data?.kind === 'studio:ui-preview-action-result') {
    const pending = pendingActions.current.get(event.data.requestId), parsed = uiPreviewActionResultSchema.safeParse(event.data.result);
    if (pending && parsed.success) { pendingActions.current.delete(event.data.requestId); pending(parsed.data); }
   }
   if (event.source === opener && event.origin === location.origin && event.data?.kind === 'studio:ui-preview-context' && event.data.context) receive(event.data.context);
  };
  const closed = () => opener?.postMessage({ kind: 'studio:ui-preview-closed' }, location.origin);
  window.addEventListener('message', onMessage);
  window.addEventListener('beforeunload', closed);
  opener?.postMessage({ kind: 'studio:ui-preview-ready' }, location.origin);
  return () => { active = false; for (const resolve of pendingActions.current.values()) resolve({ status: 'cancelled', message: '预览已关闭。' }); pendingActions.current.clear(); unsubscribe?.(); window.removeEventListener('message', onMessage); window.removeEventListener('beforeunload', closed); };
 }, []);
 const requestAction = useCallback(async (raw: UiPreviewAction): Promise<UiPreviewActionResult> => {
  if (!context) throw new Error('预演上下文已关闭。');
  const action = checkedUiPreviewAction(context.project, raw);
  if (window.studio?.requestUiPreviewAction) return window.studio.requestUiPreviewAction(action);
  if (!window.opener || window.opener.closed) throw new Error('主编辑器已关闭，无法处理定位或试玩。');
  const requestId = 'preview-' + Date.now() + '-' + (++actionSequence.current);
  return new Promise(resolve => { pendingActions.current.set(requestId, resolve); window.opener.postMessage({ kind: 'studio:ui-preview-action', requestId, action }, location.origin); });
 }, [context]);
 const assetUrl = useCallback((id?: string) => {
  if (!id) return undefined;
  const asset = context?.project.assets.find(asset => asset.id === id);
  return context?.assetUrls?.[id] ?? (asset ? window.studio?.assetUrl(asset.path) ?? asset.path : undefined);
 }, [context]);
 const origin = context ? pagePreviewOrigin(context.project, context.pageId) : undefined;
 const pageName = origin?.pageName;
 useEffect(() => { document.title = context ? `UI 预览 · ${pageName} · ${context.project.name}` : 'UI 预览'; }, [pageName, context?.project.name]);
 if (!context) return <main className="ui-preview-loading" role="status">{error || '正在连接界面编辑器…'}</main>;
 return <main className="ui-preview-window">
  <header><strong>UI 预览</strong><span title={context.project.name}>{context.project.name}</span><small>跟随当前页面和界面修改</small><button className="small-button" onClick={() => window.studio?.closeUiPreviewWindow ? void window.studio.closeUiPreviewWindow() : window.close()}>关闭预览</button></header>
  <div className="ui-preview-origin" role="note" aria-label="预览起点" data-preview-origin="page"><strong>{origin!.label}</strong><span>{origin!.detail}</span></div>
  <UiLogicPreview key={context.project.id + '/' + context.pageId + '/' + (context.project.ui.activeInstanceId ?? 'base')} project={context.project} components={context.components} pageId={context.pageId} assetUrl={assetUrl} onAction={requestAction}/>
 </main>;
}
