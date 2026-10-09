import { useCallback, useEffect, useState } from 'react';
import type { UiPreviewWindowContext } from '../core/bridge';
import { uiPageNames } from '../core/ui-names';
import type { UiComponent } from '../core/model';
import { UiLogicPreview } from './UiLogicPreview';

export function UiPreviewWindow() {
 const [context, setContext] = useState<UiPreviewWindowContext>(), [error, setError] = useState('');
 useEffect(() => {
  let active = true, receivedUpdate = false;
  const receive = (next: UiPreviewWindowContext) => { receivedUpdate = true; if (active) { setContext(next); setError(''); } };
  const unsubscribe = window.studio?.onUiPreviewContext?.(receive);
  void window.studio?.getUiPreviewContext?.().then(initial => { if (active && !receivedUpdate && initial) setContext(initial); }).catch(error => { if (active) setError(String(error)); });
  const opener = window.opener;
  const onMessage = (event: MessageEvent) => {
   if (event.source === opener && event.origin === location.origin && event.data?.kind === 'studio:ui-preview-context' && event.data.context) receive(event.data.context);
  };
  const closed = () => opener?.postMessage({ kind: 'studio:ui-preview-closed' }, location.origin);
  window.addEventListener('message', onMessage);
  window.addEventListener('beforeunload', closed);
  opener?.postMessage({ kind: 'studio:ui-preview-ready' }, location.origin);
  return () => { active = false; unsubscribe?.(); window.removeEventListener('message', onMessage); window.removeEventListener('beforeunload', closed); };
 }, []);
 const assetUrl = useCallback((id?: string) => {
  if (!id) return undefined;
  const asset = context?.project.assets.find(asset => asset.id === id);
  return context?.assetUrls?.[id] ?? (asset ? window.studio?.assetUrl(asset.path) ?? asset.path : undefined);
 }, [context]);
 const pageName = context?.project.ui.customPages.find(page => page.id === context.pageId)?.name ?? uiPageNames[context?.pageId.slice(3) as UiComponent['page']];
 useEffect(() => { document.title = context ? `UI 预览 · ${pageName} · ${context.project.name}` : 'UI 预览'; }, [pageName, context?.project.name]);
 if (!context) return <main className="ui-preview-loading" role="status">{error || '正在连接界面编辑器…'}</main>;
 return <main className="ui-preview-window">
  <header><strong>UI 预览</strong><span title={context.project.name}>{context.project.name}</span><small>跟随当前页面和界面修改</small><button className="small-button" onClick={() => window.studio?.closeUiPreviewWindow ? void window.studio.closeUiPreviewWindow() : window.close()}>关闭预览</button></header>
  <UiLogicPreview key={context.project.id + '/' + context.pageId + '/' + (context.project.ui.activeInstanceId ?? 'base')} project={context.project} components={context.components} pageId={context.pageId} assetUrl={assetUrl}/>
 </main>;
}
