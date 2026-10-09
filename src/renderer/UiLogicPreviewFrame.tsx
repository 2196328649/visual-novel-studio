import { UiHistoryPreview } from './UiHistoryPreview';
import { UiMusicCollectionPreview } from './UiMusicCollectionPreview';
import { UiStagePreview } from './UiStagePreview';
import { UiVoiceCollectionPreview } from './UiVoiceCollectionPreview';
import { Fragment, useContext, useEffect, useRef } from 'react';
import { CompositionEditingContext } from './CompositionEditingContext';
import type { Project, UiComponent } from '../core/model';
import { uiPreviewKeyboardKey, type previewUiLogic, type UiPreviewEvent } from '../core/ui-logic-preview';
import { UiParameterControlPreview } from './UiParameterControlPreview';
import { UiComponentContent, uiComponentPreviewStyle } from './UiComponentVisual';
import { GalleryPreview } from './UiCollectionPreview';
import { UiGalleryDetailPreview } from './UiGalleryDetailPreview';
import { UiConfirmationPreview, UiConfirmationText } from './UiConfirmationPreview';
import type { AssetUrl } from './StageEditor';
import { uiPageBackgroundOpacity } from '../core/ui';
import { useUiHoverSound } from './useUiHoverSound';

export function UiLogicPreviewFrame({ project, previewProject, preview, assetUrl, scale, keys, background, backgroundId, backgroundOpacity, galleryUnlocks, onEvent, playing = false }: {
  project: Project; previewProject: Project; preview: ReturnType<typeof previewUiLogic>; assetUrl: AssetUrl; scale: number; keys: string[];
  background: string; backgroundId?: string; backgroundOpacity: number; galleryUnlocks?: readonly string[]; onEvent: (event: UiPreviewEvent) => void; playing?: boolean;
}) {
  const detail = preview.gallery.detail;
  const compositionEditing = useContext(CompositionEditingContext);
  const hoverSound = useUiHoverSound(previewProject, assetUrl, preview.muted ? 0 : Number(preview.preferences.masterVolume) * Number(preview.preferences.soundVolume));
  const interactions=useRef(new Map<string,{inside:boolean;held:boolean}>());
  const buttonHandlers=(component:UiComponent,disabled:boolean,instance:number)=>{
    if(component.kind!=='button')return {};
    const identity=instance+':'+component.id;
    const state=()=>{let s=interactions.current.get(identity);if(!s){s={inside:false,held:false};interactions.current.set(identity,s);}return s;};
    const hover=(inside:boolean)=>{const s=state();if(s.inside===inside)return;s.inside=inside;if(!disabled)onEvent({kind:'button',componentId:component.id,trigger:inside?'hover':'unhover'});};
    const inside=(event:React.PointerEvent<HTMLDivElement>)=>{const b=event.currentTarget.getBoundingClientRect();return event.clientX>=b.left&&event.clientX<b.right&&event.clientY>=b.top&&event.clientY<b.bottom;};
    return {
      onPointerEnter:()=>hover(true),onPointerLeave:()=>hover(false),
      onBlur:()=>{if(state().held){state().held=false;onEvent({kind:'button',componentId:component.id,trigger:'cancel'});}},
      onPointerDown:(event:React.PointerEvent<HTMLDivElement>)=>{if(disabled||event.button!==0)return;state().held=true;state().inside=true;event.currentTarget.setPointerCapture(event.pointerId);onEvent({kind:'button',componentId:component.id,trigger:'press'});},
      onPointerMove:(event:React.PointerEvent<HTMLDivElement>)=>{if(state().held)hover(inside(event));},
      onPointerUp:(event:React.PointerEvent<HTMLDivElement>)=>{if(event.button!==0||!state().held)return;state().held=false;const within=inside(event);state().inside=within;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);if(!disabled)onEvent({kind:'button',componentId:component.id,trigger:'release',inside:within});},
      onLostPointerCapture:()=>{if(state().held){state().held=false;onEvent({kind:'button',componentId:component.id,trigger:'cancel'});}},
      onClick:(event:React.MouseEvent)=>{if(!disabled&&event.detail===0)onEvent({kind:'click',componentId:component.id});},
      onKeyDown:(event:React.KeyboardEvent)=>{if(!disabled&&['Enter',' '].includes(event.key)){event.preventDefault();if(!event.repeat)onEvent({kind:'click',componentId:component.id});}},
    };
  };
  return <div aria-label="参数联动预演画面" tabIndex={0} onPointerOverCapture={hoverSound} onKeyDownCapture={event => {
    if (event.ctrlKey || event.metaKey || event.altKey || (event.target instanceof HTMLElement && event.target.closest('input,select,textarea'))) return;
    const key = uiPreviewKeyboardKey(event.key);
    if (key && keys.includes(key)) { event.preventDefault(); event.stopPropagation(); if (!event.repeat) onEvent({ kind: 'key', key }); }
  }} onKeyDown={event => event.stopPropagation()} onContextMenu={event => { if (!detail && (!preview.pageId.startsWith('ui:') || preview.layers.at(-1)?.nativeLayout || ['confirm','menu'].includes(preview.layers.at(-1)?.mode??'')) && !preview.closed) { event.preventDefault(); onEvent({ kind: 'cancelPage', pageId: preview.pageId }); } }} style={{ position: 'relative', isolation: 'isolate', width: project.width * scale, height: project.height * scale, overflow: 'hidden', background }}>
    <UiStagePreview project={project} preview={preview} assetUrl={assetUrl} playing={playing}/>
    {preview.layers.map((layer, index) => {
      const custom = project.ui.customPages.find(page => page.id === layer.pageId), page = layer.pageId.slice(3) as UiComponent['page'];
      const settings = custom ?? previewProject.ui.pages?.[page];
      const imageId = settings?.backgroundId ?? (['main', 'say', 'choice'].includes(page) ? previewProject.ui.menuBackgroundId : undefined);
      const nativeIds = new Set(layer.nativeLayout?.components.map(c=>c.id)), bodyIds = new Set(layer.nativeLayout?.bodyIds);
      return <UiPreviewLayer key={layer.instance} pageId={layer.pageId} hidden={layer.hidden || !!compositionEditing?.isolate} interactive={layer.interactive && !compositionEditing?.isolate} focus={!compositionEditing?.isolate && layer.mode !== 'root' && layer.instance === preview.layers.at(-1)?.instance && !detail} zIndex={index+1}>
      {layer.nativeConfirm ? <UiConfirmationPreview project={previewProject} message={layer.message??''} scale={scale} onAnswer={value=>onEvent({kind:'confirm',requestId:layer.instance,value})}/> : <>
      <div style={{ position: 'absolute', inset: 0, background: settings?.background ?? previewProject.ui.background, opacity: custom ? 1 : uiPageBackgroundOpacity(previewProject.ui, page), pointerEvents: 'none' }} />
      {imageId && <img src={assetUrl(imageId)} alt="预演页面背景" draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none', opacity: custom ? 1 : uiPageBackgroundOpacity(previewProject.ui, page) }} />}
      {[true,false].map(body=>{const children=layer.components.filter(row => row.visible&&bodyIds.has(row.component.id)===body).map(({ component, state }) => <div key={component.id} data-preview-component={component.id} data-preview-native={nativeIds.has(component.id)||undefined} className={'ui-component ' + component.kind}
        role={component.kind === 'button' ? 'button' : undefined} aria-label={component.kind === 'button' ? (component.text || '预演按钮') : undefined} aria-disabled={component.kind === 'button' ? state === 'disabled' : undefined} tabIndex={component.kind === 'button' && state !== 'disabled' ? 0 : undefined}
        {...buttonHandlers(component,state==='disabled',layer.instance)}
        style={uiComponentPreviewStyle(previewProject, component, scale, state)}>
        {component.binding==='confirmation' && layer.message!==undefined ? <UiConfirmationText message={layer.message} scale={scale}/> : component.kind==='historyList' ? <UiHistoryPreview project={previewProject} component={component} assetUrl={assetUrl} scale={scale} state={state} native={layer.nativeLayout?.kind==='history'&&bodyIds.has(component.id)} interaction={{entries:preview.history,onAction:action=>onEvent({kind:'history',componentId:component.id,...action})}}/> : component.kind==='musicTrackList' ? <UiMusicCollectionPreview project={previewProject} component={component} assetUrl={assetUrl} scale={scale} state={state} interaction={{view:layer.music[component.id],playingId:preview.music.playback?.assetId,onPage:page=>onEvent({kind:'music',componentId:component.id,action:'page',page}),onPlay:assetId=>onEvent({kind:'music',componentId:component.id,action:'play',assetId})}}/> : component.kind==='voiceCollection' ? <UiVoiceCollectionPreview project={previewProject} component={component} assetUrl={assetUrl} scale={scale} state={state} interaction={{view:layer.voice[component.id],playingId:preview.voice.playback?.entryId??preview.voice.playback?.assetId,onAction:action=>onEvent({kind:'voice',componentId:component.id,...action})}}/> : component.kind === 'galleryGrid' ? <GalleryPreview project={previewProject} component={component} assetUrl={assetUrl} scale={scale} state={state} interaction={{ page: layer.gallery.pages[component.id] ?? 0, unlocks: galleryUnlocks,
          values: preview.variables, onPage: page => onEvent({ kind: 'gallery', componentId: component.id, action: 'page', page }), onOpen: groupId => onEvent({ kind: 'gallery', componentId: component.id, action: 'open', groupId }) }} />
          : ['preference', 'preferenceChoice'].includes(component.kind) && (project.variables.some(v => v.id === component.parameterId) || (!component.parameterId && component.preference && (component.preference !== 'characterVolume' || !component.preferenceCharacterId || project.characters.some(c => c.id === component.preferenceCharacterId))))
            ? <UiParameterControlPreview project={project} component={component} assetUrl={assetUrl} scale={scale} state={state} value={component.parameterId ? (preview.variables[component.parameterId] ?? project.variables.find(v => v.id === component.parameterId)!.initial) : component.preference === 'characterVolume' ? (preview.characterVolumes?.[component.preferenceCharacterId ?? ''] ?? preview.preferences.characterVolume) : preview.preferences[component.preference!]} onChange={value => onEvent({ kind: 'control', componentId: component.id, value })} onCommit={method=>onEvent({kind:'textCommit',componentId:component.id,method})} />
            : <UiComponentContent project={previewProject} component={component} assetUrl={assetUrl} scale={scale} state={state} bindings={{ dialogue: '对白预演', speaker: '角色' }} />}
      </div>);return body?layer.nativeLayout&&layer.nativeLayout.kind!=='shortcut'?<div key="native-body" aria-label={layer.nativeLayout.kind==='music'?'标准音乐滚动区域':layer.nativeLayout.kind==='history'?'标准历史区域':layer.nativeLayout.kind==='voices'?'标准语音收藏区域':'标准设置滚动区域'} tabIndex={0} style={{position:'absolute',left:0,right:0,top:layer.nativeLayout.top*scale,height:layer.nativeLayout.height*scale,overflowY:'auto',overflowX:'hidden',pointerEvents:'auto',background:layer.nativeLayout.kind==='history'?'transparent':'#222a2d'}}><div style={{position:'relative',width:'100%',height:layer.nativeLayout.contentHeight*scale}}>{children}</div></div>:null:<Fragment key="components">{children}</Fragment>;})}</>}
    </UiPreviewLayer>; })}
    {detail && !compositionEditing?.isolate && <div style={{ position: 'absolute', inset: 0, zIndex: preview.layers.length+1 }}><UiGalleryDetailPreview key={detail.componentId + ':' + detail.groupId} detail={detail} assetUrl={assetUrl} scale={scale} onAction={action => onEvent({ kind: 'gallery', componentId: detail.componentId, ...action })} /></div>}
  </div>;
}

function UiPreviewLayer({ pageId, hidden, interactive, focus, zIndex, children }: { pageId: string; hidden: boolean; interactive: boolean; focus: boolean; zIndex: number; children: React.ReactNode }) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focus) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    element.current?.focus({ preventScroll: true });
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  // A nested page temporarily covers this layer; restore focus only when the
  // layer is removed, not whenever it loses the topmost position.
  }, []);
  useEffect(()=>{if(focus)element.current?.focus({preventScroll:true});},[pageId]);
  return <div ref={element} data-preview-page={pageId} hidden={hidden} inert={!interactive} tabIndex={focus ? -1 : undefined} style={{ position: 'absolute', inset: 0, zIndex, pointerEvents: 'none' }}>{children}</div>;
}
