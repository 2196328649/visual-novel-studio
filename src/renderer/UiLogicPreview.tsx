import { UiHistoryPreviewData } from './UiHistoryPreviewData';
import { UiMusicPreviewAudio } from './UiMusicPreviewAudio';
import { UiMusicPreviewData } from './UiMusicPreviewData';
import { nativeParameterSettingsPage } from '../core/ui-native-preview';
import { UiStagePreviewAudio } from './UiStagePreviewAudio';
import { UiVoicePreviewData } from './UiVoicePreviewData';
import { UiVoicePreviewAudio } from './UiVoicePreviewAudio';
import { UiLogicPreviewFrame } from './UiLogicPreviewFrame';
import { UiGalleryPreviewData } from './UiGalleryPreviewData';
import { blueprintKeyNames } from '../core/blueprint';
import { useEffect, useMemo, useRef, useState } from 'react';
import { effectiveUiTheme, type Project, type UiComponent, type VariableValue } from '../core/model';
import { uiPageNames } from '../core/ui-names';
import { previewUiLogic, uiPreviewKeys, uiPreviewDurationLimit, type UiPreviewEvent } from '../core/ui-logic-preview';
import { UiFontFaces } from './UiAppearance';
import { ValueInput } from './components';
import type { AssetUrl } from './StageEditor';
import { useUiViewport } from './useUiViewport';
import { UiZoomControls } from './UiZoomControls';

export function UiLogicPreview({project,components,pageId,assetUrl}:{project:Project;components:UiComponent[];pageId:string;assetUrl:AssetUrl}) {
 const [values,setValues]=useState<Record<string,VariableValue>>({});
 const viewport=useUiViewport(project.width,project.height);
 const [timed,setTimed]=useState(false),[playing,setPlaying]=useState(false);
 const [galleryUnlocks,setGalleryUnlocks]=useState<string[]|undefined>();
 const scope=String(timed)+':'+project.id+':'+pageId+':'+(project.ui.activeInstanceId??'base');
 const [record,setRecord]=useState<{scope:string;events:UiPreviewEvent[]}>({scope,events:[]});
 useEffect(()=>{setRecord({scope,events:[]});setPlaying(false);setGalleryUnlocks(undefined);},[scope]);
 useEffect(()=>{setPlaying(false);},[project]);
 const events=record.scope===scope?record.events:[];
 const setEvents=(update:UiPreviewEvent[]|((current:UiPreviewEvent[])=>UiPreviewEvent[]))=>setRecord(current=>({scope,events:typeof update==='function'?update(current.scope===scope?current.events:[]):update}));
 const pressKey=(key:string)=>setEvents(current=>current.length>=256?current:[...current,{kind:'key',key}]);
 const preview=useMemo(()=>previewUiLogic(project,components,pageId,values,events,{timed,galleryUnlocks}),[project,components,pageId,values,events,timed,galleryUnlocks]);
 const activePageId=preview?.pageId??pageId;
 const keys=preview?.keys??uiPreviewKeys(project,activePageId,components);
 const theme=effectiveUiTheme(project.ui),customPage=project.ui.customPages.find(page=>page.id===activePageId);
 const activePage=activePageId.startsWith('ui:')?activePageId.slice(3) as UiComponent['page']:'custom';
 const pageSettings=customPage??theme.pages?.[activePage];
 const backgroundId=pageSettings?.backgroundId??(['main','say','choice'].includes(activePage)?theme.menuBackgroundId:undefined);
 const pageName=activePageId===nativeParameterSettingsPage?'更多设置':customPage?.name??(activePage==='save'?(preview?.saveMode==='save'?'存档':'读档'):uiPageNames[activePage]);
 const advance=(seconds:number)=>setEvents(current=>{
  const last=current.at(-1);
  if(last?.kind==='advance')return [...current.slice(0,-1),{kind:'advance',seconds:Math.min(uiPreviewDurationLimit,last.seconds+seconds)}];
  return current.length>=256?current:[...current,{kind:'advance',seconds}];
 });
 useEffect(()=>{if(!timed||!playing||preview.exhausted||events.length>=256)return;let previous=performance.now();const timer=setInterval(()=>{const now=performance.now();advance(Math.min(1,(now-previous)/1000));previous=now;},100);return ()=>clearInterval(timer);},[timed,playing,scope,preview.exhausted,events.length>=256]);
 useEffect(()=>{if(preview.exhausted||events.length>=256)setPlaying(false);},[preview.exhausted,events.length>=256]);
 const previewProject={...project,ui:theme,playerDefaults:{...project.playerDefaults,...preview?.preferences}};
 const nativeSettings=!!preview?.layers.some(layer=>layer.nativeLayout);
 const scale=viewport.scale;
 const variableInputs=project.variables.map(variable=><label key={variable.id}><span>{variable.name}</span><ValueInput variable={variable} label={'预演参数 '+variable.name} value={preview?.variables[variable.id]??variable.initial} onChange={value=>setEvents(current=>current.length>=256?current:[...current,{kind:'parameter',id:variable.id,value}])}/></label>);
 return <section className="ui-logic-preview" aria-label="UI 交互预览">
  <div className="ui-preview-controls">
   <div className="workspace-toolbar"><UiZoomControls viewport={viewport}/></div>
   <div className="workspace-toolbar ui-preview-toolbar"><output aria-label="当前预演页面">{pageName}</output><label><input type="checkbox" checked={timed} onChange={event=>setTimed(event.target.checked)}/>按时间预演</label>{timed&&<><output aria-label="预演时间">{preview.elapsed.toFixed(2)} 秒</output><button className="small-button" disabled={preview.exhausted} onClick={()=>setPlaying(value=>!value)}>{playing?'暂停计时':'播放计时'}</button><button className="small-button" disabled={playing||preview.exhausted} onClick={()=>advance(.1)}>推进 0.1 秒</button><button className="small-button" disabled={playing||preview.exhausted} onClick={()=>advance(1)}>推进 1 秒</button></>}<div className="spacer"/><button className="small-button" onClick={()=>{setPlaying(false);setValues({});setEvents([]);setGalleryUnlocks(undefined);}}>恢复测试值</button></div>
   <details className="ui-preview-help"><summary>预演说明</summary><p>直接操作画面中的控件，检查事件效果。开启“按时间预演”后，控件动画、时间轴画面和声音一起推进；可播放、暂停或逐步检查。测试值不会写入工程。</p><p>菜单切换保留测试值，从对话或选项进入菜单后返回原页。聚焦画面可测试绑定按键，音乐鉴赏和语音收藏可单独试听，不受计时开关影响。舞台显示在界面下方，不透明页面背景会遮住演出画面；暂停计时会暂停演出声音。</p></details>
   {!!preview?.waitingPages.length&&<p role="status">等待页面关闭：{preview.waitingPages.map(id=>project.ui.customPages.find(p=>p.id===id)?.name??(id===nativeParameterSettingsPage?'更多设置':id.startsWith('ui:')?uiPageNames[id.slice(3) as UiComponent['page']]:id)).join(' → ')}</p>}
   {preview?.closed&&<p role="status">页面已关闭，恢复测试值可重新预演。</p>}
   {!customPage&&theme.pages?.[activePage]?.layout!=='custom'&&!preview?.layers.at(-1)?.nativeConfirm&&!preview?.layers.at(-1)?.nativeLayout&&<p role="status">此处仅预演已添加的组件，标准布局的内置控件请在试玩中检查。</p>}
   {preview?.layers.at(-1)?.nativeLayout?.kind==='settings'&&<p className="muted">标准设置可滚动操作；显示模式和分辨率只改变测试值。点击恢复初始设置会先显示确认框。</p>}
   {preview?.exhausted&&<p role="status">本次计时预演已达到时长或触发次数上限，请恢复测试值后继续。</p>}
   {!!keys.length&&<div className="ui-preview-keys" role="group" aria-label="预演按键">{keys.map(key=><button key={key} className="small-button" onClick={()=>pressKey(key)}>触发 {blueprintKeyNames[key]}</button>)}</div>}
   {events.length>=256&&<p role="status">预演操作已达到上限，请恢复测试值后继续。</p>}
   {!!preview?.stageWaiting&&<p role="status">等待演出完成：{preview.stageWaiting} 个执行流程</p>}
   <UiStagePreviewAudio preview={preview} playing={timed&&playing&&!preview.exhausted&&events.length<256} assetUrl={assetUrl}/>
   {preview?.incomplete&&<p role="status">部分节点尚未预演；舞台演出需开启“按时间预演”，其他未支持行为请使用试玩检查。</p>}
   <details className="ui-preview-test-data"><summary>测试数据</summary><div className="ui-logic-preview-values">{variableInputs.length?variableInputs:<p className="muted">当前工程没有测试变量。</p>}</div>
   {preview?.components.some(row=>row.visible&&row.component.kind==='galleryGrid')&&<UiGalleryPreviewData project={project} components={preview.components.filter(row=>row.visible).map(row=>row.component)} assetUrl={assetUrl} unlocks={galleryUnlocks} onChange={setGalleryUnlocks}/>}
   {preview?.components.some(row=>row.visible&&['voiceCollection','historyList'].includes(row.component.kind))&&<UiVoicePreviewData project={project} preview={preview} assetUrl={assetUrl} onEvent={event=>setEvents(current=>current.length>=256?current:[...current,event])}/>}
   {preview?.components.some(row=>row.visible&&row.component.kind==='musicTrackList')&&<UiMusicPreviewData project={project} preview={preview} assetUrl={assetUrl} onEvent={event=>setEvents(current=>current.length>=256?current:[...current,event])}/>}
   {preview?.components.some(row=>row.visible&&row.component.kind==='historyList')&&<UiHistoryPreviewData project={project} preview={preview} onEvent={event=>setEvents(current=>current.length>=256?current:[...current,event])}/>}
   </details>
   <UiMusicPreviewAudio preview={events.length>=256?undefined:preview} assetUrl={assetUrl} onEvent={event=>setEvents(current=>current.length>=256?current:[...current,event])}/>
   <UiVoicePreviewAudio preview={events.length>=256?undefined:preview} assetUrl={assetUrl} onEvent={event=>setEvents(current=>current.length>=256?current:[...current,event])}/>
  </div>
   <div className={'ui-logic-preview-body'+(nativeSettings?' native-settings-preview':'')}>
    <div className="ui-logic-preview-frame ui-zoom-scroll" ref={viewport.observe}><UiFontFaces project={project} assetUrl={assetUrl}/><div className="ui-zoom-stage"><div data-ui-zoom-surface>{preview&&<UiLogicPreviewFrame project={project} previewProject={previewProject} preview={preview} assetUrl={assetUrl} scale={scale} keys={keys} background={pageSettings?.background??theme.background} backgroundId={backgroundId} backgroundOpacity={customPage?1:theme.pages?.[activePage]?.backgroundOpacity??1} galleryUnlocks={galleryUnlocks} playing={timed&&playing&&!preview.exhausted&&events.length<256} onEvent={event=>setEvents(current=>current.length>=256?current:[...current,event])}/>}</div></div></div>
   </div>
 </section>;
}
