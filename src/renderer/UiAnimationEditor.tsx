import type { UiAnimationFocus } from './ui-animation-editor-focus';
import { aiSelectedUiAnimation } from '../core/ai-selection';
import type { UiAnimationSelection } from '../core/ai-selection';
import { Fragment, useEffect, useRef, useState } from 'react';
import { Pause, Play, Plus, Trash2 } from 'lucide-react';
import { makeId, effectiveUiTheme, sortUiComponents, type Project, type UiAnimationClip, type UiAnimationKey } from '../core/model';
import { addUiAnimationTrack, sampleUiAnimationTrack, uiAnimationClipProblems, uiAnimationInitial, uiClipComponents } from '../core/ui-animation-clips';
import { uiAnimationEasings, uiAnimationPropertyNames, type UiAnimationProperty } from '../core/ui-animation';
import { uiPropertyApplies } from '../core/ui';
import { UiDock } from './UiDock';
import { UiFontFaces } from './UiAppearance';
import { UiComponentContent, uiComponentPreviewStyle } from './UiComponentVisual';
import { componentName } from './UiNames';
import { NumberInput } from './NumberInput';
import type { Commit } from './editor';
import type { AssetUrl } from './StageEditor';

export function UiAnimationEditor({focus,project,clip,commit,assetUrl,onBack,onActiveAnimation,selectedComponentId,onComponentSelect}:{focus?:UiAnimationFocus;project:Project;clip:UiAnimationClip;commit:Commit;assetUrl:AssetUrl;onBack:()=>void;onActiveAnimation?:(selection?:UiAnimationSelection)=>void;selectedComponentId?:string;onComponentSelect:(id?:string)=>void}) {
 const editor=useRef<HTMLDivElement>(null);
 const components=uiClipComponents(project,clip),component=components.find(c=>c.id===selectedComponentId)??components[0];
 const [trackId,setTrackId]=useState<string>(),[keyId,setKeyId]=useState<string>(),[property,setProperty]=useState<UiAnimationProperty>('opacity');
 const [time,setTime]=useState(0),[playing,setPlaying]=useState(false),[notice,setNotice]=useState('');
 const [width,setWidth]=useState(640),frame=useRef<HTMLDivElement>(null);
 const [dragTime,setDragTime]=useState<number>();
 const drag=useRef<{keyId:string;trackId:string;startX:number;time:number;width:number;value:number}|undefined>(undefined);
 const track=clip.tracks.find(t=>t.id===trackId),key=track?.keys.find(k=>k.id===keyId);
 const targetName=(id:string)=>{const c=components.find(c=>c.id===id);return c?componentName(c):'缺失控件';};
 const playhead=Math.min(time,clip.duration),theme=effectiveUiTheme(project.ui),scale=width/project.width;
 const page=clip.pageId.slice(3) as keyof NonNullable<Project['ui']['pages']>;
 const settings=clip.pageId.startsWith('ui:')?theme.pages?.[page]:project.ui.customPages.find(p=>p.id===clip.pageId);
 const backgroundId=settings?.backgroundId??(['ui:main','ui:say','ui:choice'].includes(clip.pageId)?theme.menuBackgroundId:undefined);
 useEffect(()=>{if(!frame.current)return;const observer=new ResizeObserver(entries=>setWidth(Math.min(entries[0].contentRect.width,Math.max(80,entries[0].contentRect.height-32)*project.width/project.height)));observer.observe(frame.current);return()=>observer.disconnect();},[project.width,project.height]);
 useEffect(()=>{setPlaying(false);setDragTime(undefined);drag.current=undefined;},[project]);
 useEffect(()=>{if(!playing)return;let request=0,last=performance.now();const tick=(now:number)=>{const delta=(now-last)/1000;last=now;setTime(t=>{const next=Math.min(clip.duration,t+delta);if(next>=clip.duration)setPlaying(false);return next;});request=requestAnimationFrame(tick);};request=requestAnimationFrame(tick);return()=>cancelAnimationFrame(request);},[playing,clip.duration]);
 useEffect(()=>{onActiveAnimation?.({animationId:clip.id,trackId,keyId});},[clip.id,trackId,keyId,onActiveAnimation]);
 useEffect(()=>()=>onActiveAnimation?.(undefined),[onActiveAnimation]);
 useEffect(()=>{
  if(!focus?.active()||focus.animationId!==clip.id)return;
  const selected=aiSelectedUiAnimation(project,focus);
  if(!selected||selected.selectionUnavailable){focus.finish({status:'failed',message:'动画选择已失效，请重新读取当前工程。'});return;}
  setPlaying(false);setTrackId(focus.trackId);setKeyId(focus.keyId);setTime(selected.key?.time??0);
 },[focus,clip,project]);
 useEffect(()=>{
  if(!focus?.active()||focus.animationId!==clip.id||trackId!==focus.trackId||keyId!==focus.keyId||playing||time!==(key?.time??0))return;
  const selected=aiSelectedUiAnimation(project,focus);if(!selected||selected.selectionUnavailable)return;
  const request=requestAnimationFrame(()=>{
   if(!focus.active())return;
   const selector=keyId?'[data-animation-key="'+CSS.escape(keyId)+'"]':trackId?'[data-animation-track="'+CSS.escape(trackId)+'"]':undefined;
   const element=selector?editor.current?.querySelector(selector):editor.current;
   if(!element)return;element.scrollIntoView({block:'nearest',inline:'nearest'});
   focus.finish({status:'completed',message:'已定位控件动画：'+focus.label});
  });return()=>cancelAnimationFrame(request);
 },[focus,clip.id,trackId,keyId,time,key,playing,project]);
 useEffect(()=>{
  if(!focus||focus.animationId!==clip.id)return;
  return()=>{if(focus.active())focus.finish({status:'cancelled',message:'已离开动画编辑器，定位已取消。'});};
 },[focus,clip.id]);
 const update=(label:string,edit:(target:UiAnimationClip)=>void)=>{
  const next=structuredClone(clip);edit(next);const errors=uiAnimationClipProblems(project,next);
  if(errors.length){setNotice(errors.join(' ')+' 修改未应用。');return false;}
  setNotice('');commit(label,draft=>{const index=draft.ui.animations?.findIndex(a=>a.id===clip.id)??-1;if(index>=0)draft.ui.animations![index]=next;});return true;
 };
 const selectKey=(nextTrack:string,next:UiAnimationKey)=>{setPlaying(false);setTrackId(nextTrack);setKeyId(next.id);setTime(next.time);};
 const editKey=(patch:Partial<UiAnimationKey>)=>{if(!track||!key)return;update('修改动画关键帧',a=>{Object.assign(a.tracks.find(t=>t.id===track.id)!.keys.find(k=>k.id===key.id)!,patch);});};
 const addTrack=()=>{if(!component)return;let id='';if(update('添加控件动画轨道',a=>{id=addUiAnimationTrack(a,component,uiPropertyApplies(component,property)?property:'opacity').id;})){setTrackId(id);setKeyId(undefined);}};
 const addKey=()=>{if(!track)return;const at=Math.round(playhead*1000)/1000,existing=track.keys.find(k=>Math.abs(k.time-at)<1e-6);if(existing){selectKey(track.id,existing);return;}
  const source=components.find(c=>c.id===track.componentId);if(!source)return;
  const next:UiAnimationKey={id:makeId('ui_key'),time:at,value:sampleUiAnimationTrack(track,at,uiAnimationInitial(source,track.property)),easing:'linear'};
  if(update('添加动画关键帧',a=>a.tracks.find(t=>t.id===track.id)!.keys.push(next)))selectKey(track.id,next);
 };
 const hierarchy=<div className="ui-animation-library"><p>选择控件与属性，为它添加关键帧轨道。</p>{components.map(c=><button key={c.id} className={component?.id===c.id?'active':''} aria-pressed={component?.id===c.id} data-animation-component={c.id} onClick={()=>onComponentSelect(c.id)}>{componentName(c)}</button>)}<label>动画属性<select aria-label="添加轨道属性" value={component&&uiPropertyApplies(component,property)?property:'opacity'} onChange={e=>setProperty(e.target.value as UiAnimationProperty)}>{Object.entries(uiAnimationPropertyNames).filter(([p])=>!component||uiPropertyApplies(component,p as UiAnimationProperty)).map(([p,n])=><option key={p} value={p}>{n}</option>)}</select></label><button className="small-button" disabled={!component||clip.tracks.length>=128} onClick={addTrack}><Plus size={14}/>添加属性轨道</button></div>;
 const canvas=<div className="ui-animation-preview-scroll" ref={frame}><div className="ui-animation-preview" aria-label="控件动画画布" style={{width,margin:'0 auto',aspectRatio:`${project.width}/${project.height}`,background:settings?.background??theme.background,color:theme.textColor}}>
  {backgroundId&&<img className="stage-background" src={assetUrl(backgroundId)} alt="界面背景"/>}
  {sortUiComponents(components).map(original=>{const c=structuredClone(original);for(const t of clip.tracks.filter(t=>t.componentId===c.id)){const value=sampleUiAnimationTrack(t,playhead,uiAnimationInitial(original,t.property));if(t.property==='opacity')c.style={...c.style,opacity:value};else c[t.property]=value;}
   return <div key={c.id} className={'ui-animation-component ui-logic-component kind-'+c.kind+(component?.id===c.id?' selected':'')} data-animation-preview={c.id} style={uiComponentPreviewStyle(project,c,scale)} onClick={()=>onComponentSelect(c.id)} title={componentName(c)}><UiComponentContent project={project} component={c} assetUrl={assetUrl} scale={scale}/></div>;
  })}</div><small>控件关键帧预览 · 点击画布控件可选择；此处不触发按钮事件。</small></div>;
 const timeline=<div className="ui-animation-timeline"><div className="ui-animation-transport"><button className="small-button" disabled={!clip.duration||!clip.tracks.length} aria-label={playing?'暂停动画预览':'播放动画预览'} onClick={()=>{if(!playing&&playhead>=clip.duration)setTime(0);setPlaying(p=>!p);}}>{playing?<Pause size={14}/>:<Play size={14}/>}</button><button className="text-button" onClick={()=>{setPlaying(false);setTime(0);}}>回到起点</button><label>播放头<NumberInput aria-label="动画播放头秒数" value={playhead} step={.01} onChange={e=>{setPlaying(false);setTime(Math.max(0,Math.min(clip.duration,e.target.valueAsNumber)));}}/> 秒</label><button className="small-button" disabled={!track||track.keys.length>=1024} onClick={addKey}><Plus size={13}/>在播放头添加关键帧</button></div>
  <div className="ui-animation-ruler"><span>控件 / 属性</span><input aria-label="动画时间标尺" type="range" min={0} max={clip.duration||1} step={.001} value={playhead} onChange={e=>{setPlaying(false);setTime(Number(e.target.value));}}/></div>
  <div className="ui-animation-ruler"><span>秒</span><div className="ui-animation-time-labels">{Array.from({length:6},(_,i)=><span key={i} style={{left:`${i*20}%`}}>{Number((clip.duration*i/5).toFixed(2))}</span>)}</div></div>
  {!clip.tracks.length&&<p className="ui-animation-empty">从左侧添加属性轨道，再在播放头位置添加关键帧。</p>}
  {clip.tracks.map(t=><div key={t.id} className={'ui-animation-track'+(track?.id===t.id?' selected':'')} data-animation-track={t.id}><button className="ui-animation-track-label" onClick={()=>{setTrackId(t.id);setKeyId(undefined);onComponentSelect(t.componentId);}}>{targetName(t.componentId)}<small>{uiAnimationPropertyNames[t.property]}</small></button><div className="ui-animation-lane" onClick={e=>{const b=e.currentTarget.getBoundingClientRect();setPlaying(false);setTime(Math.max(0,Math.min(clip.duration,(e.clientX-b.left)/b.width*clip.duration)));if(trackId!==t.id)setKeyId(undefined);setTrackId(t.id);}}><i className="ui-animation-playhead" style={{left:`${playhead/(clip.duration||1)*100}%`}}/>
   {t.keys.map(k=><button key={k.id} className={'ui-animation-key'+(key?.id===k.id?' selected':'')} aria-label={`${targetName(t.componentId)} · ${uiAnimationPropertyNames[t.property]} · ${k.time} 秒关键帧`} data-animation-key={k.id} title={`${k.time} 秒 · ${k.value}`} style={{left:`${(drag.current?.keyId===k.id?dragTime??k.time:k.time)/(clip.duration||1)*100}%`}}
    onClick={e=>{e.stopPropagation();if(e.detail===0)selectKey(t.id,k);}}
    onPointerDown={e=>{if(e.button!==0)return;e.stopPropagation();selectKey(t.id,k);onComponentSelect(t.componentId);const b=e.currentTarget.parentElement!.getBoundingClientRect();drag.current={keyId:k.id,trackId:t.id,startX:e.clientX,time:k.time,width:b.width,value:k.time};e.currentTarget.setPointerCapture(e.pointerId);}}
    onPointerMove={e=>{const d=drag.current;if(!d||d.keyId!==k.id)return;d.value=Math.round(Math.max(0,Math.min(clip.duration,d.time+(e.clientX-d.startX)/d.width*clip.duration))*1000)/1000;setDragTime(d.value);setTime(d.value);}}
    onPointerUp={e=>{const d=drag.current;if(!d||d.keyId!==k.id)return;e.currentTarget.releasePointerCapture(e.pointerId);drag.current=undefined;setDragTime(undefined);if(d.value!==d.time)update('移动动画关键帧',a=>{a.tracks.find(t=>t.id===d.trackId)!.keys.find(k=>k.id===d.keyId)!.time=d.value;});}}
    onPointerCancel={()=>{drag.current=undefined;setDragTime(undefined);}}
    onKeyDown={e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const at=Math.max(0,Math.min(clip.duration,k.time+(e.key==='ArrowRight'?1:-1)*(e.shiftKey ? .1 : .01)));if(update('移动动画关键帧',a=>{a.tracks.find(r=>r.id===t.id)!.keys.find(r=>r.id===k.id)!.time=Number(at.toFixed(3));}))setTime(at);}}>◆</button>)}
  </div></div>)}
 </div>;
 const inspector=<div className="ui-animation-inspector"><label>动画名称<input aria-label="界面动画名称" value={clip.name} maxLength={120} onChange={e=>{if(e.target.value.trim())update('重命名界面动画',a=>{a.name=e.target.value;});}}/></label><label>总时长（秒）<NumberInput aria-label="界面动画总时长" value={clip.duration} step={.1} onChange={e=>update('修改界面动画时长',a=>{a.duration=e.target.valueAsNumber;})}/></label><small>缩短时长前，请先移动或删除超出范围的关键帧。</small>
  {key?<Fragment key={key.id}><h3>关键帧</h3><label>时间（秒）<NumberInput aria-label="关键帧时间" value={key.time} step={.01} onChange={e=>editKey({time:e.target.valueAsNumber})}/></label><label>{uiAnimationPropertyNames[track!.property]}<NumberInput aria-label="关键帧数值" value={key.value} step={.01} onChange={e=>editKey({value:e.target.valueAsNumber})}/></label><label>到达此帧的缓动<select aria-label="关键帧缓动" value={key.easing} onChange={e=>editKey({easing:e.target.value as UiAnimationKey['easing']})}>{Object.entries(uiAnimationEasings).map(([id,n])=><option key={id} value={id}>{n}</option>)}</select></label><button className="small-button" disabled={track!.keys.length<=1} onClick={()=>{if(update('删除动画关键帧',a=>{const t=a.tracks.find(t=>t.id===track!.id)!;t.keys=t.keys.filter(k=>k.id!==key.id);}))setKeyId(undefined);}}><Trash2 size={13}/>删除关键帧</button></Fragment>:<p>选择菱形关键帧，编辑它的时间与数值。可拖动关键帧，或用方向键微调。</p>}
  {track&&<button className="text-button" onClick={()=>{if(update('删除动画轨道',a=>{a.tracks=a.tracks.filter(t=>t.id!==track.id);})){setTrackId(undefined);setKeyId(undefined);}}}>删除所选轨道</button>}
  <hr/><small>动画从首帧开始，末帧后保持至总时长；首帧晚于 0 秒时，从播放时的控件值过渡。</small><button className="text-button" onClick={()=>{commit('删除界面动画',draft=>{draft.ui.animations=draft.ui.animations?.filter(a=>a.id!==clip.id);});onBack();}}>删除此动画</button><small>删除后可撤销；引用此动画的节点会提示引用缺失。</small>
 </div>;
 return <div ref={editor} className="ui-animation-editor"><UiFontFaces project={project} assetUrl={assetUrl}/><div className="workspace-toolbar"><button className="small-button" onClick={onBack}>返回事件图</button><strong>控件动画 · {clip.name}</strong><span>{clip.tracks.length} 条属性轨道</span></div>{notice&&<div className="ui-event-notice" role="status">{notice}<button aria-label="关闭动画提示" onClick={()=>setNotice('')}>×</button></div>}<UiDock defaultTop={60} storageKey="vns-ui-animation-dock-v1" label="控件动画面板布局" labels={{hierarchy:'控件',canvas:'动画预览',settings:'关键帧轨道',inspector:'详细信息'}} panels={{hierarchy,canvas,settings:timeline,inspector}}/></div>;
}
