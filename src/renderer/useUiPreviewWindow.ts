import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UiPreviewWindowContext } from '../core/bridge';
import type { AiEditorResult } from '../core/ai-editor-commands';
import type { Project, UiComponent } from '../core/model';
import type { AssetUrl } from './StageEditor';

export interface UiPreviewWindowControls {
 show: () => Promise<AiEditorResult>;
 close: () => Promise<AiEditorResult>;
}

export function useUiPreviewWindow(project: Project, components: UiComponent[], pageId: string, assetUrl: AssetUrl) {
 const [open, setOpen] = useState(false), [error, setError] = useState('');
 const context = useMemo<UiPreviewWindowContext>(() => ({ project, components, pageId }), [project, components, pageId]);
 const signature = useMemo(() => JSON.stringify(context), [context]);
 const current = useRef({ context, signature, assetUrl, open });
 current.current = { context, signature, assetUrl, open };
 const mounted = useRef(false);
 const popup = useRef<Window | null>(null), lastSent = useRef('');
 const send = useCallback(async (force = false) => {
  const snapshot = current.current;
  if (!force && lastSent.current === snapshot.signature) return;
  if (window.studio?.updateUiPreviewContext) await window.studio.updateUiPreviewContext(snapshot.context);
  else if (popup.current && !popup.current.closed) {
   const assetUrls: Record<string, string> = {};
   for (const asset of snapshot.context.project.assets) { const url = snapshot.assetUrl(asset.id); if (url) assetUrls[asset.id] = url; }
   popup.current.postMessage({ kind: 'studio:ui-preview-context', context: { ...snapshot.context, assetUrls } }, location.origin);
  }
  lastSent.current = snapshot.signature;
 }, []);
 useEffect(() => {
  mounted.current = true;
  const unsubscribe = window.studio?.onUiPreviewWindowState?.(value => { setOpen(value); if (!value) lastSent.current = ''; });
  const onMessage = (event: MessageEvent) => {
   if (event.source !== popup.current || event.origin !== location.origin) return;
   if (event.data?.kind === 'studio:ui-preview-ready') { setOpen(true); void send(true); }
   if (event.data?.kind === 'studio:ui-preview-closed') { setOpen(false); lastSent.current = ''; }
  };
  const close = () => { popup.current?.close(); void window.studio?.closeUiPreviewWindow?.().catch(() => undefined); };
  window.addEventListener('message', onMessage);
  window.addEventListener('beforeunload', close);
  const timer = window.studio ? undefined : window.setInterval(() => { if (popup.current?.closed) { popup.current = null; setOpen(false); lastSent.current = ''; } }, 500);
  return () => { mounted.current = false; unsubscribe?.(); window.removeEventListener('message', onMessage); window.removeEventListener('beforeunload', close); window.clearInterval(timer); close(); };
 }, [send]);
 useEffect(() => {
  if (!open) return;
  if (!pageId) { popup.current?.close(); void window.studio?.closeUiPreviewWindow?.().catch(() => undefined); return; }
  if (lastSent.current === signature) return;
  const timer = window.setTimeout(() => { void send().catch(error => setError(String(error))); }, 100);
  return () => window.clearTimeout(timer);
 }, [open, signature, send, pageId]);
 const show = useCallback(async (): Promise<AiEditorResult> => {
  setError('');
  try {
   if (!mounted.current) return { status: 'cancelled', message: '界面编辑已离开，预览操作已取消。' };
   if (!current.current.context.pageId) return { status: 'cancelled', message: '当前没有可预览的界面页面。' };
   if (window.studio?.openUiPreviewWindow) {
    const snapshot = current.current;
    await window.studio.openUiPreviewWindow(snapshot.context);
    if (!mounted.current) return { status: 'cancelled', message: '界面编辑已离开，预览操作已取消。' };
    lastSent.current = snapshot.signature;
    setOpen(true);
    await send();
   } else {
    if (!popup.current || popup.current.closed) {
     const url = new URL(location.href); url.hash = 'ui-preview';
     popup.current = window.open(url, 'studio-ui-preview', 'popup,width=1100,height=800');
     if (!popup.current) throw new Error('预览窗口被浏览器拦截，请允许此网站打开弹出窗口。');
    } else { popup.current.focus(); await send(); }
    setOpen(true);
   }
   return { status: 'completed', message: 'UI 预览窗口已显示，跟随当前页面和未保存的界面修改。' };
  } catch (error) { const message = error instanceof Error ? error.message : String(error); setError(message); return { status: 'failed', message }; }
 }, [send]);
 const close = useCallback(async (): Promise<AiEditorResult> => {
  setError('');
  if (!current.current.open && (!popup.current || popup.current.closed)) return { status: 'cancelled', message: 'UI 预览窗口尚未打开。' };
  try {
   if (window.studio?.closeUiPreviewWindow) await window.studio.closeUiPreviewWindow();
   else popup.current?.close();
   setOpen(false); lastSent.current = '';
   return { status: 'completed', message: 'UI 预览窗口已关闭，试听和计时已结束。' };
  } catch (error) { const message = error instanceof Error ? error.message : String(error); setError(message); return { status: 'failed', message }; }
 }, []);
 return { open, error, show, close };
}
