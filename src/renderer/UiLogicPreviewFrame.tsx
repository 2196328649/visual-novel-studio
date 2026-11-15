import { uiPageTheme } from '../core/ui-page-settings';
import { uiGeometryContains, type UiLayoutGeometry } from '../core/ui-layout';
import { uiPointerInPlane, useUiLayoutWheel } from './useUiLayoutWheel';
import { UiPreviewFocusContext, withUiProgrammaticFocus, type UiPreviewFocusRestore } from './UiPreviewFocusContext';
import { UiHistoryPreview } from './UiHistoryPreview';
import { UiMusicCollectionPreview } from './UiMusicCollectionPreview';
import { UiStagePreview } from './UiStagePreview';
import { UiVoiceCollectionPreview } from './UiVoiceCollectionPreview';
import { Fragment, useContext, useEffect, useLayoutEffect, useRef } from 'react';
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
  const frame = useRef<HTMLDivElement>(null), focusController = useRef({ depth: 0 });
  const appliedFocusCommand = useRef<string | undefined>(undefined);
  const compositionEditing = useContext(CompositionEditingContext);
  useUiLayoutWheel(frame, preview, project.width, onEvent, !!compositionEditing?.isolate || !!detail);
  const hoverSound = useUiHoverSound(previewProject, assetUrl, preview.muted ? 0 : Number(preview.preferences.masterVolume) * Number(preview.preferences.soundVolume), preview.layers.flatMap(layer => layer.components.map(row => row.component)), preview.clickFeedback.at(-1));
  useLayoutEffect(() => {
    const command = preview.inputFocusCommand;
    if (!command) { appliedFocusCommand.current = undefined; return; }
    const identity = [command.sequence, command.pageInstance, command.componentId, command.focused].join(':');
    if (appliedFocusCommand.current === identity) return;
    appliedFocusCommand.current = identity;
    // A time jump can cross several virtual refreshes. Apply the net result of
    // these explicit commands, not just the last targeted release, and never
    // reapply it merely because an observed focus value changes later.
    const target = command.active;
    const input = target && frame.current?.querySelector<HTMLInputElement>('[data-preview-instance="' + target.pageInstance + '"] [data-preview-component="' + CSS.escape(target.componentId) + '"] input[data-ui-text-input]');
    withUiProgrammaticFocus(focusController.current, () => {
      if (target) {
        if (input && !input.disabled && !input.readOnly && !input.closest('[inert],[hidden]') && !compositionEditing?.isolate) input.focus({ preventScroll: true });
      } else {
        const current = document.activeElement;
        if (current instanceof HTMLInputElement && current.matches('[data-ui-text-input]') && frame.current?.contains(current)) current.blur();
      }
    });
    if (target && (!input || document.activeElement !== input)) onEvent({ kind: 'focus', componentId: target.componentId, pageInstance: target.pageInstance, focused: false });
  }, [preview.inputFocusCommand, compositionEditing?.isolate, onEvent]);
  const interactions=useRef(new Map<string,{inside:boolean;held:boolean}>());
  const buttonHandlers=(component:UiComponent,disabled:boolean,instance:number,geometry?:UiLayoutGeometry)=>{
    if(component.kind!=='button')return {};
    const identity=instance+':'+component.id;
    const state=()=>{let s=interactions.current.get(identity);if(!s){s={inside:false,held:false};interactions.current.set(identity,s);}return s;};
    const hover=(inside:boolean)=>{const s=state();if(s.inside===inside)return;s.inside=inside;if(!disabled)onEvent({kind:'button',componentId:component.id,trigger:inside?'hover':'unhover'});};
    const inside=(event:React.PointerEvent<HTMLDivElement>)=>{const point=uiPointerInPlane(event.currentTarget,event.clientX,event.clientY,project.width);if(geometry&&point)return uiGeometryContains(geometry,point);const b=event.currentTarget.getBoundingClientRect();return event.clientX>=b.left&&event.clientX<b.right&&event.clientY>=b.top&&event.clientY<b.bottom;};
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
  return <UiPreviewFocusContext.Provider value={focusController.current}><div ref={frame} data-ui-layout-plane aria-label="参数联动预演画面" tabIndex={0} onPointerOverCapture={hoverSound} onKeyDownCapture={event => {
    if (event.ctrlKey || event.metaKey || event.altKey || (event.target instanceof HTMLElement && event.target.closest('input,select,textarea'))) return;
    const key = uiPreviewKeyboardKey(event.key);
    if (key && keys.includes(key)) { event.preventDefault(); event.stopPropagation(); if (!event.repeat) onEvent({ kind: 'key', key }); }
  }} onKeyDown={event => event.stopPropagation()} onContextMenu={event => { if (!detail && preview.cancelPageId && !preview.closed) { event.preventDefault(); onEvent({ kind: 'key', key: 'K_ESCAPE' }); } }} style={{ position: 'relative', isolation: 'isolate', width: project.width * scale, height: project.height * scale, overflow: 'hidden', background: preview.layers.every(layer => layer.opening.presentation === 'overlay') ? '#25333b' : background }}>
    <UiStagePreview project={project} preview={preview} assetUrl={assetUrl} playing={playing}/>
    {preview.layers.map((layer, index) => {
      const custom = project.ui.customPages.find(page => page.id === layer.pageId), page = layer.pageId.slice(3) as UiComponent['page'];
      const layerProject = { ...previewProject, ui: uiPageTheme(project, layer.pageId) };
      const settings = custom ?? layerProject.ui.pages?.[page];
      const imageId = settings?.backgroundId ?? (['main', 'say', 'choice'].includes(page) ? layerProject.ui.menuBackgroundId : undefined);
      const nativeIds = new Set(layer.nativeLayout?.components.map(c=>c.id)), bodyIds = new Set(layer.nativeLayout?.bodyIds);
      return <UiPreviewLayer key={layer.instance} pageId={layer.pageId} instance={layer.instance} hidden={layer.hidden || !!compositionEditing?.isolate} interactive={layer.interactive && !compositionEditing?.isolate} focus={!compositionEditing?.isolate && layer.mode !== 'root' && layer.focused && layer.interactive && !detail} zIndex={index+1}>
      {layer.opening.presentation !== 'overlay' && <div style={{ position: 'absolute', inset: 0, background: settings?.background ?? layerProject.ui.background, opacity: custom ? 1 : uiPageBackgroundOpacity(layerProject.ui, page), pointerEvents: 'none' }} />}
      {imageId && layer.opening.presentation !== 'overlay' && <img src={assetUrl(imageId)} alt="预演页面背景" draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none', opacity: custom ? 1 : uiPageBackgroundOpacity(layerProject.ui, page) }} />}
      {layer.nativeConfirm && <UiConfirmationPreview project={layerProject} message={layer.message??''} scale={scale} onAnswer={value=>onEvent({kind:'confirm',requestId:layer.instance,value})}/>}
      {[true,false].map(body=>{const children=layer.components.filter(row => row.visible&&bodyIds.has(row.component.id)===body).map(({ component, state, geometry }) => <div key={component.id} data-ui-clipped={geometry?.clippedOut || undefined} data-preview-component={component.id} data-preview-native={nativeIds.has(component.id)||undefined} className={'ui-component ' + component.kind}
        role={component.kind === 'button' ? 'button' : undefined} aria-label={component.kind === 'button' ? (component.text || '预演按钮') : undefined} aria-disabled={component.kind === 'button' ? state === 'disabled' : undefined} tabIndex={component.kind === 'button' && state !== 'disabled' && !geometry?.clippedOut ? 0 : undefined}
        {...buttonHandlers(component,state==='disabled'||!!geometry?.clippedOut,layer.instance,geometry)}
        style={uiComponentPreviewStyle(layerProject, component, scale, state, component, geometry)}>
        {component.binding==='confirmation' && layer.message!==undefined ? <UiConfirmationText message={layer.message} scale={scale}/> : component.kind==='historyList' ? <UiHistoryPreview project={layerProject} component={component} geometry={geometry} assetUrl={assetUrl} scale={scale} state={state} native={layer.nativeLayout?.kind==='history'&&bodyIds.has(component.id)} interaction={{entries:preview.history,onAction:action=>onEvent({kind:'history',componentId:component.id,...action})}}/> : component.kind==='musicTrackList' ? <UiMusicCollectionPreview project={layerProject} component={component} assetUrl={assetUrl} scale={scale} state={state} interaction={{view:layer.music[component.id],playingId:preview.music.playback?.assetId,onPage:page=>onEvent({kind:'music',componentId:component.id,action:'page',page}),onPlay:assetId=>onEvent({kind:'music',componentId:component.id,action:'play',assetId})}}/> : component.kind==='voiceCollection' ? <UiVoiceCollectionPreview project={layerProject} component={component} assetUrl={assetUrl} scale={scale} state={state} interaction={{view:layer.voice[component.id],playingId:preview.voice.playback?.entryId??preview.voice.playback?.assetId,onAction:action=>onEvent({kind:'voice',componentId:component.id,...action})}}/> : component.kind === 'galleryGrid' ? <GalleryPreview project={layerProject} component={component} assetUrl={assetUrl} scale={scale} state={state} interaction={{ page: layer.gallery.pages[component.id] ?? 0, unlocks: galleryUnlocks,
          values: preview.variables, onPage: page => onEvent({ kind: 'gallery', componentId: component.id, action: 'page', page }), onOpen: groupId => onEvent({ kind: 'gallery', componentId: component.id, action: 'open', groupId }) }} />
          : ['preference', 'preferenceChoice'].includes(component.kind) && (project.variables.some(v => v.id === component.parameterId) || (!component.parameterId && component.preference && (component.preference !== 'characterVolume' || !component.preferenceCharacterId || project.characters.some(c => c.id === component.preferenceCharacterId))))
            ? <UiParameterControlPreview project={layerProject} component={component} assetUrl={assetUrl} scale={scale} state={state} value={preview.controlValues[component.id]} options={preview.controlOptions[component.id]} onFocusChange={focused => onEvent({ kind: 'focus', componentId: component.id, pageInstance: layer.instance, focused })} onChange={(value, selection) => onEvent({ kind: 'control', componentId: component.id, pageInstance: layer.instance, value, ...selection })} onCommit={method=>onEvent({kind:'textCommit',componentId:component.id,pageInstance:layer.instance,method})} />
            : component.kind === 'spine' && preview.spineProblems[component.id] ? <span className="spine-preview-error" role="status">{preview.spineProblems[component.id]}</span>
            : <UiComponentContent project={layerProject} component={component} assetUrl={assetUrl} scale={scale} state={state} bindings={{ dialogue: '对白预演', speaker: '角色' }} spineFeedback={preview.spineRequests[component.id] ? { request: preview.spineRequests[component.id], onReport: report => onEvent({ kind: 'spine', componentId: component.id, ...report }) } : undefined} videoFeedback={preview.videoRequests[component.id] ? { request: preview.videoRequests[component.id], onReport: report => onEvent({ kind: 'video', componentId: component.id, ...report }) } : undefined} imageFeedback={!layer.hidden && preview.imageRequests[component.id] ? { request: preview.imageRequests[component.id], onReport: report => onEvent({ kind: 'image', componentId: component.id, ...report }) } : undefined} />}
      </div>);return body?layer.nativeLayout&&layer.nativeLayout.kind!=='shortcut'?<div key="native-body" aria-label={layer.nativeLayout.kind==='music'?'标准音乐滚动区域':layer.nativeLayout.kind==='history'?'标准历史区域':layer.nativeLayout.kind==='voices'?'标准语音收藏区域':'标准设置滚动区域'} tabIndex={0} style={{position:'absolute',left:0,right:0,top:layer.nativeLayout.top*scale,height:layer.nativeLayout.height*scale,overflowY:'auto',overflowX:'hidden',pointerEvents:'auto',background:layer.nativeLayout.kind==='history'?'transparent':'#222a2d'}}><div data-ui-layout-plane style={{position:'relative',width:'100%',height:layer.nativeLayout.contentHeight*scale}}>{children}</div></div>:null:<Fragment key="components">{children}</Fragment>;})}
    </UiPreviewLayer>; })}
    {detail && !compositionEditing?.isolate && <div style={{ position: 'absolute', inset: 0, zIndex: preview.layers.length+1 }}><UiGalleryDetailPreview key={detail.componentId + ':' + detail.groupId} detail={detail} assetUrl={assetUrl} scale={scale} onAction={action => onEvent({ kind: 'gallery', componentId: detail.componentId, ...action })} /></div>}
  </div></UiPreviewFocusContext.Provider>;
}

function UiPreviewLayer({ pageId, instance, hidden, interactive, focus, zIndex, children }: { pageId: string; instance: number; hidden: boolean; interactive: boolean; focus: boolean; zIndex: number; children: React.ReactNode }) {
  const element = useRef<HTMLDivElement>(null), controller = useContext(UiPreviewFocusContext);
  const restore = useRef<UiPreviewFocusRestore>({});
  useLayoutEffect(() => {
    if (!focus) return;
    const node = element.current, frame = node?.closest<HTMLElement>('[data-ui-layout-plane]');
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    // A repeated mount (StrictMode) finds focus already inside; keep the original source.
    if (!active || !node?.contains(active)) {
      // A menu's own navigation replaces its page, and the removed button left focus
      // on the body. Keep the replaced page's source: closing returns to the opener.
      const replaced = !active || active === document.body || active === frame ? [...controller?.restores ?? []].find(([page, record]) => !page.isConnected && record.previous?.isConnected)?.[1] : undefined;
      restore.current = replaced ? { ...replaced } : { previous: active, frame };
    }
    if (node && controller) (controller.restores ??= new Map()).set(node, restore.current);
    withUiProgrammaticFocus(controller, () => node?.focus({ preventScroll: true }));
  // A nested page temporarily covers this layer; do not steal focus on updates.
  }, []);
  // Restore after the whole commit. A layout cleanup runs while the covered layer
  // is still inert, so the restore would be refused and focus would fall to the body.
  useEffect(() => { const node = element.current; return () => {
    // StrictMode replays effects on a page that stays mounted.
    if (node?.isConnected) return;
    if (node) controller?.restores?.delete(node);
    const { previous, frame } = restore.current, active = document.activeElement;
    // Keep focus that the player or another preview update already moved elsewhere.
    if (!previous || (active && active !== document.body && active !== frame)) return;
    // A covered text input lost editing focus. Restore page navigation, not an
    // old editing session or a submission when a program closes the overlay.
    const target = previous.matches('input,textarea') ? previous.closest<HTMLElement>('[data-preview-page]') : previous;
    if (target?.isConnected && !target.closest('[inert],[hidden]')) withUiProgrammaticFocus(controller, () => target.focus({ preventScroll: true }));
  }; }, []);
  return <div ref={element} data-preview-page={pageId} data-preview-instance={instance} hidden={hidden} inert={!interactive} tabIndex={focus ? -1 : undefined} style={{ position: 'absolute', inset: 0, zIndex, pointerEvents: 'none' }}>{children}</div>;
}
