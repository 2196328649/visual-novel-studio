import { uiPageInterface, uiPageParameterDefault } from '../core/ui-page-interface';
import { BlueprintValueInput } from './BlueprintValueInput';
import { blueprintTaskFinished, blueprintTaskStatusNames } from '../core/blueprint-tasks';
import { BlueprintTracePanel } from './BlueprintTracePanel';
import type { UiPreviewActionHandler } from '../core/ui-preview-actions';
import { UiHistoryPreviewData } from './UiHistoryPreviewData';
import { UiMusicPreviewAudio } from './UiMusicPreviewAudio';
import { UiMusicPreviewData } from './UiMusicPreviewData';
import { UiStagePreviewAudio } from './UiStagePreviewAudio';
import { UiVoicePreviewData } from './UiVoicePreviewData';
import { UiVoicePreviewAudio } from './UiVoicePreviewAudio';
import { UiLogicPreviewFrame } from './UiLogicPreviewFrame';
import { UiGalleryPreviewData } from './UiGalleryPreviewData';
import { blueprintKeyNames } from '../core/blueprint';
import { useEffect, useMemo, useRef, useState } from 'react';
import { effectiveUiTheme, type Project, type UiComponent, type VariableValue } from '../core/model';
import { uiPageNames } from '../core/ui-names';
import { previewUiLogic, appendUiPreviewEvent, sameUiPreviewResult, uiPreviewInputCount, uiPreviewKeys, uiPreviewDurationLimit, type UiPreviewEvent } from '../core/ui-logic-preview';
import { UiFontFaces } from './UiAppearance';
import { ValueInput } from './components';
import type { AssetUrl } from './StageEditor';
import { useUiViewport } from './useUiViewport';
import { UiZoomControls } from './UiZoomControls';

export function UiLogicPreview({project,components,pageId,assetUrl,onAction}:{project:Project;components:UiComponent[];pageId:string;assetUrl:AssetUrl;onAction?:UiPreviewActionHandler}) {
 const [traceOpen,setTraceOpen]=useState(false),[traceReset,setTraceReset]=useState(0);
 const hostScope=project.id+':'+pageId;
 const [hostRecord,setHostRecord]=useState<{scope:string;value:'title'|'story'}>();
 const host=hostRecord?.scope===hostScope?hostRecord.value:!pageId.startsWith('ui:')||['ui:say','ui:choice'].includes(pageId)?'story':'title';
 const [values,setValues]=useState<Record<string,VariableValue>>({});
 const [pageInputRecord,setPageInputRecord]=useState<{pageId:string;values:Record<string,VariableValue>}>({pageId,values:{}});
 const pageDefinition=uiPageInterface(project,pageId);
 // Every displayed test value is an explicit open argument, including 0/false/empty.
 // A memoized empty map also avoids resetting the replay on unrelated renders.
 const pageInputs=useMemo(()=>Object.fromEntries((pageDefinition?.inputs??[]).map(parameter=>[parameter.id,pageInputRecord.pageId===pageId&&Object.hasOwn(pageInputRecord.values,parameter.id)?pageInputRecord.values[parameter.id]:uiPageParameterDefault(parameter)])),[pageDefinition,pageId,pageInputRecord]);
 const viewport=useUiViewport(project.width,project.height);
 const [timed,setTimed]=useState(false),[playing,setPlaying]=useState(false);
 const [galleryUnlocks,setGalleryUnlocks]=useState<string[]|undefined>();
 const scope=host+':'+String(timed)+':'+project.id+':'+pageId+':'+(project.ui.activeInstanceId??'base');
 const [record,setRecord]=useState<{scope:string;events:UiPreviewEvent[]}>({scope,events:[]});
 useEffect(()=>{setRecord({scope,events:[]});setPlaying(false);setGalleryUnlocks(undefined);},[scope]);
 const events=record.scope===scope?record.events:[];
 const setEvents=(update:UiPreviewEvent[]|((current:UiPreviewEvent[])=>UiPreviewEvent[]))=>setRecord(current=>({scope,events:typeof update==='function'?update(current.scope===scope?current.events:[]):update}));
 const pressKey=(key:string)=>setEvents(current=>uiPreviewInputCount(current)>=256?current:[...current,{kind:'key',key}]);
 const options={timed,galleryUnlocks,trace:true,pageInputs,host};
 const preview=useMemo(()=>previewUiLogic(project,components,pageId,values,events,options),[project,components,pageId,values,events,timed,galleryUnlocks,pageInputs,host]);
 // Keep the timer running through edits that do not change the replay (imported files, folders, saving).
 const previewed=useRef({project,components});
 useEffect(()=>{
  const last=previewed.current;previewed.current={project,components};
  if(!timed||!playing||(last.project===project&&last.components===components))return;
  if(!sameUiPreviewResult(previewUiLogic(last.project,last.components,pageId,values,events,options),preview))setPlaying(false);
 },[project,components]);
 const activePageId=preview?.pageId??pageId;
 const keys=preview?.keys??uiPreviewKeys(project,activePageId,components);
 const theme=effectiveUiTheme(project.ui),customPage=project.ui.customPages.find(page=>page.id===activePageId);
 const activePage=activePageId.startsWith('ui:')?activePageId.slice(3) as UiComponent['page']:'custom';
 const pageSettings=customPage??theme.pages?.[activePage];
 const backgroundId=pageSettings?.backgroundId??(['main','say','choice'].includes(activePage)?theme.menuBackgroundId:undefined);
 const pageName=customPage?.name??(activePage==='save'?(preview?.saveMode==='save'?'存档':'读档'):uiPageNames[activePage]);
 const advance=(seconds:number)=>setEvents(current=>{
  const last=current.at(-1);
  if(last?.kind==='advance')return [...current.slice(0,-1),{kind:'advance',seconds:Math.min(uiPreviewDurationLimit,last.seconds+seconds)}];
  return uiPreviewInputCount(current)>=256?current:[...current,{kind:'advance',seconds}];
 });
 useEffect(()=>{if(!timed||!playing||preview.exhausted||uiPreviewInputCount(events)>=256)return;let previous=performance.now();const timer=setInterval(()=>{const now=performance.now();advance(Math.min(1,(now-previous)/1000));previous=now;},100);return ()=>clearInterval(timer);},[timed,playing,scope,preview.exhausted,uiPreviewInputCount(events)>=256]);
 useEffect(()=>{if(preview.exhausted||uiPreviewInputCount(events)>=256)setPlaying(false);},[preview.exhausted,uiPreviewInputCount(events)>=256]);
 const previewProject={...project,ui:theme,playerDefaults:{...project.playerDefaults,...preview?.preferences}};
 const nativeSettings=!!preview?.layers.some(layer=>layer.nativeLayout);
 const scale=viewport.scale;
 const variableInputs=project.variables.map(variable=><label key={variable.id}><span>{variable.name}</span><ValueInput project={project} variable={variable} label={'预演参数 '+variable.name} value={preview?.variables[variable.id]??variable.initial} onChange={value=>setEvents(current=>uiPreviewInputCount(current)>=256?current:[...current,{kind:'parameter',id:variable.id,value}])}/></label>);
 return <section className={'ui-logic-preview'+(traceOpen?' trace-visible':'')} aria-label="UI 交互预览">
  <div className="ui-preview-controls">
   <div className="workspace-toolbar ui-preview-toolbar"><UiZoomControls viewport={viewport}/><output aria-label="当前预演页面">{pageName}</output><label><input type="checkbox" checked={timed} onChange={event=>setTimed(event.target.checked)}/>按时间预演</label>{timed&&<><output aria-label="预演时间">{preview.elapsed.toFixed(2)} 秒</output><button className="small-button" disabled={preview.exhausted} onClick={()=>setPlaying(value=>!value)}>{playing?'暂停计时':'播放计时'}</button><button className="small-button" disabled={playing||preview.exhausted} onClick={()=>advance(.1)}>推进 0.1 秒</button><button className="small-button" disabled={playing||preview.exhausted} onClick={()=>advance(1)}>推进 1 秒</button></>}<div className="spacer"/><button className="small-button" aria-pressed={traceOpen} onClick={()=>setTraceOpen(value=>!value)}>执行轨迹 · {preview.trace?.entries.length??0}</button><button className="small-button" onClick={()=>{setPlaying(false);setValues({});setPageInputRecord({pageId,values:{}});setEvents([]);setGalleryUnlocks(undefined);setTraceReset(value=>value+1);}}>恢复测试值</button></div>
   <details className="ui-preview-help"><summary>预演说明</summary><p>直接操作画面中的控件，检查事件效果。开启“按时间预演”后，节流、防抖、独立任务、控件动画、时间轴画面和声音一起推进；可播放、暂停或逐步检查。测试值不会写入工程。</p><p>菜单切换保留测试值，从对话或选项进入菜单后返回原页。聚焦画面可测试绑定按键，音乐鉴赏和语音收藏可单独试听，不受计时开关影响。视频使用真实静音播放器，暂停计时不会替代视频暂停，请用视频控制节点。舞台显示在界面下方，不透明页面背景会遮住演出画面；暂停计时会暂停演出声音。</p></details>
   {!!preview?.waitingPages.length&&<p role="status">等待页面关闭：{preview.waitingPages.map(id=>project.ui.customPages.find(p=>p.id===id)?.name??(id.startsWith('ui:')?uiPageNames[id.slice(3) as UiComponent['page']]:id)).join(' → ')}</p>}
   {preview?.closed&&<p role="status">页面已关闭，恢复测试值可重新预演。</p>}
   {!customPage&&theme.pages?.[activePage]?.layout!=='custom'&&!preview?.layers.at(-1)?.nativeConfirm&&!preview?.layers.at(-1)?.nativeLayout&&<p role="status">此处仅预演已添加的组件，标准布局的内置控件请在试玩中检查。</p>}
   {preview?.layers.at(-1)?.nativeLayout?.kind==='settings'&&<p className="muted">标准设置可滚动操作；显示模式和分辨率只改变测试值。点击恢复初始设置会先显示确认框。</p>}
   {preview?.exhausted&&<p role="status">{preview.stopReason??'本次计时预演已达到上限。'} 活动任务和等待未完成，不表示执行成功或已取消。请恢复测试值后继续。</p>}
   {!!keys.length&&<div className="ui-preview-keys" role="group" aria-label="预演按键">{keys.map(key=><button key={key} className="small-button" onClick={()=>pressKey(key)}>触发 {blueprintKeyNames[key]}</button>)}</div>}
   {uiPreviewInputCount(events)>=256&&<p role="status">预演操作已达到上限，请恢复测试值后继续。</p>}
   {!!preview.tasks.length&&<details className="ui-preview-task-list"><summary>后台任务：{preview.tasks.filter(task=>!blueprintTaskFinished(task.status)).length} 个活动 · {preview.tasks.length} 条记录</summary><ul>{preview.tasks.slice(-20).reverse().map(task=><li key={task.handle}><strong>{project.blueprints.find(graph=>graph.id===task.graphId)?.name??"任务模块"}</strong> · {blueprintTaskStatusNames[task.status]}{task.reason&&task.reason!==task.status&&<small> · {task.reason}</small>}</li>)}</ul>{!!preview.taskWaiting&&<p>有 {preview.taskWaiting} 个执行流程等待任务结果。</p>}</details>}
<details className="ui-preview-page-results"><summary>页面返回结果 · {preview.pageResults.length}</summary>{preview.pageResults.map(result=><div key={result.pageId+'/'+result.instance}><strong>{result.pageId.startsWith('ui:')?uiPageNames[result.pageId.slice(3) as UiComponent['page']]:project.ui.customPages.find(page=>page.id===result.pageId)?.name??result.pageId}</strong><span> · {result.reason} · {result.result}</span>{Object.entries(result.outputs??{}).map(([id,value])=><p key={id}>{uiPageInterface(project,result.pageId)?.outputs.find(parameter=>parameter.id===id)?.name??id}：{String(value)}</p>)}</div>)}</details>
   {!!preview?.stageWaiting&&<p role="status">等待演出完成：{preview.stageWaiting} 个执行流程</p>}
   <UiStagePreviewAudio preview={preview} playing={timed&&playing&&!preview.exhausted&&uiPreviewInputCount(events)<256} assetUrl={assetUrl}/>
   {preview?.incomplete&&<p role="status">部分节点尚未预演；舞台演出需开启“按时间预演”，其他未支持行为请使用试玩检查。<button className="small-button" onClick={()=>setTraceOpen(true)}>查看停止原因</button></p>}
   <details className="ui-preview-test-data"><summary>测试数据</summary><label>预演宿主<select aria-label="页面预演宿主" value={host} onChange={event=>{setPlaying(false);setHostRecord({scope:hostScope,value:event.target.value as 'title'|'story'});}}><option value="story">游戏内（已有剧情进度）</option><option value="title">标题／标题前（无游戏进度）</option></select></label><p className="muted">切换宿主会重新开始预演；游戏内允许打开保存菜单，标题宿主只允许读取存档。此处不实际存读档，请通过试玩验证真实进度。</p>{!!uiPageInterface(project,pageId)?.inputs.length&&<fieldset><legend>页面打开时输入</legend><p className="muted">下面显示的值都会作为预演实参（包括 0、否和空文字）。修改会重新开始本页预演；实际实例打开后输入不会随调用者改变。</p>{uiPageInterface(project,pageId)!.inputs.map(parameter=><label key={parameter.id}><span>{parameter.name}</span><BlueprintValueInput project={project} type={parameter.dataType} label={'预演页面输入 '+parameter.name} value={pageInputs[parameter.id]??uiPageParameterDefault(parameter)} onChange={value=>{setPlaying(false);setEvents([]);setTraceReset(value=>value+1);setPageInputRecord({pageId,values:{...pageInputs,[parameter.id]:value??uiPageParameterDefault(parameter)}});}}/></label>)}</fieldset>}<div className="ui-logic-preview-values">{variableInputs.length?variableInputs:<p className="muted">当前工程没有测试变量。</p>}</div>
   {preview?.components.some(row=>row.visible&&row.component.kind==='galleryGrid')&&<UiGalleryPreviewData project={project} components={preview.components.filter(row=>row.visible).map(row=>row.component)} assetUrl={assetUrl} unlocks={galleryUnlocks} onChange={setGalleryUnlocks}/>}
   {preview?.components.some(row=>row.visible&&['voiceCollection','historyList'].includes(row.component.kind))&&<UiVoicePreviewData project={project} preview={preview} assetUrl={assetUrl} onEvent={event=>setEvents(current=>appendUiPreviewEvent(current,event))}/>}
   {preview?.components.some(row=>row.visible&&row.component.kind==='musicTrackList')&&<UiMusicPreviewData project={project} preview={preview} assetUrl={assetUrl} onEvent={event=>setEvents(current=>appendUiPreviewEvent(current,event))}/>}
   {preview?.components.some(row=>row.visible&&row.component.kind==='historyList')&&<UiHistoryPreviewData project={project} preview={preview} onEvent={event=>setEvents(current=>appendUiPreviewEvent(current,event))}/>}
   </details>
   <UiMusicPreviewAudio preview={uiPreviewInputCount(events)>=256?undefined:preview} assetUrl={assetUrl} onEvent={event=>setEvents(current=>appendUiPreviewEvent(current,event))}/>
   <UiVoicePreviewAudio preview={uiPreviewInputCount(events)>=256?undefined:preview} assetUrl={assetUrl} onEvent={event=>setEvents(current=>appendUiPreviewEvent(current,event))}/>
  </div>
  <div className={'ui-preview-content'+(traceOpen?' trace-open':'')}>
   <div className={'ui-logic-preview-body'+(nativeSettings?' native-settings-preview':'')}>
    <div className="ui-logic-preview-frame ui-zoom-scroll" ref={viewport.observe}><UiFontFaces project={project} assetUrl={assetUrl}/><div className="ui-zoom-stage"><div data-ui-zoom-surface>{preview&&<UiLogicPreviewFrame key={scope+':'+traceReset} project={project} previewProject={previewProject} preview={preview} assetUrl={assetUrl} scale={scale} keys={keys} background={pageSettings?.background??theme.background} backgroundId={backgroundId} backgroundOpacity={customPage?1:theme.pages?.[activePage]?.backgroundOpacity??1} galleryUnlocks={galleryUnlocks} playing={timed&&playing&&!preview.exhausted&&uiPreviewInputCount(events)<256} onEvent={event=>setEvents(current=>appendUiPreviewEvent(current,event))}/>}</div></div></div>
   </div>
   {traceOpen&&<BlueprintTracePanel project={project} trace={preview.trace} resetId={scope+'/'+traceReset} onAction={onAction} onClose={()=>setTraceOpen(false)}/>}
  </div>
 </section>;
}
