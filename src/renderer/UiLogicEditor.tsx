import { projectGraphs } from '../core/project-resources';
import type { UiAnimationFocus } from './ui-animation-editor-focus';
import { uiControlValue } from '../core/ui-control-value';
import type { BlueprintSelection, UiAnimationSelection } from '../core/ai-selection';
import { uiControlValueType, uiTextInput } from '../core/ui-control-events';
import { uiButtonEvents, type UiButtonEvent } from '../core/ui-button-events';
import { UiAnimationEditor } from './UiAnimationEditor';
import { createUiAnimationClip, uiPageAnimations } from '../core/ui-animation-clips';
import { UiGraphVariables } from './UiGraphVariables';
import { useEffect, useMemo, useState } from 'react';
import { UiEventTimeline } from './UiEventTimeline';
import { findTimelinePath, validTimelineVisits, type TimelineVisit } from '../core/timeline-navigation';
import { GitBranch, MousePointer2, Plus, Search } from 'lucide-react';
import { BlueprintGraphEditor, type BlueprintFocus } from './BlueprintGraphEditor';
import { UiParameterBindings } from './UiParameterBindings';
import { createUiEventGraph, uiEventAuthoringGraph, ownsUiEventGraph, findUiControlEvent, ensureUiClickEvent, ensureUiButtonEvent, ensureUiValueChangedEvent, ensureUiTextCommittedEvent, uiPageGraphs, uiClickHandlers } from '../core/ui-logic';
import type { BlueprintNodeType } from '../core/blueprint';
import { actionName, componentName, componentNames, uiPageNames } from './UiNames';
import type { Project, UiComponent, VariableValue } from '../core/model';
import type { Commit } from './editor';
import type { AssetUrl } from './StageEditor';

export function UiLogicEditor({animationFocus,blueprintFocus,project,components,pageId,commit,assetUrl,selectedComponentId,onComponentSelect,onActiveBlueprint,onActiveAnimation,onDesign}:{animationFocus?:UiAnimationFocus;blueprintFocus?:BlueprintFocus;project:Project;components:UiComponent[];pageId:string;commit:Commit;assetUrl:AssetUrl;selectedComponentId?:string;onComponentSelect:(id?:string)=>void;onDesign?:()=>void;onActiveAnimation?:(selection?:UiAnimationSelection)=>void;onActiveBlueprint?:(selection?:BlueprintSelection)=>void}) {
 const [selectedGraph,setSelectedGraph]=useState<string>(),[target,setTarget]=useState<BlueprintFocus>(),[notice,setNotice]=useState(''),[query,setQuery]=useState('');
 const [animationId,setAnimationId]=useState<string>();
 const animation=project.ui.animations?.find(a=>a.id===animationId);
 const openAnimation=(id:string,nodeId?:string)=>{setNotice('');setAnimationId(id);if(nodeId&&graph)setTarget(t=>({graphId:graph.id,nodeId,request:(t?.request??0)+1}));onActiveBlueprint?.(undefined);};
 const createAnimation=()=>{let id='';commit('创建界面动画',draft=>{id=createUiAnimationClip(draft,pageId).id;});openAnimation(id);};
 const [auxiliary,setAuxiliary]=useState<'binding'>();
 const [timelineVisits,setTimelineVisits]=useState<TimelineVisit[]>([]);
 const related=uiPageGraphs(project,pageId),graph=related.find(g=>g.id===selectedGraph)??related.find(g=>g.uiPageId===pageId)??related[0];
 const component=components.find(c=>c.id===selectedComponentId);
 const pageName=project.ui.customPages.find(p=>p.id===pageId)?.name??uiPageNames[pageId.slice(3) as UiComponent['page']]??'界面';
 const focus=useMemo(()=>graph?target?.graphId===graph.id?target:{graphId:graph.id,request:0}:undefined,[graph?.id, target]);
 const locate=(graphId:string,nodeId?:string)=>{setAnimationId(undefined);setTimelineVisits([]);setSelectedGraph(graphId);setTarget(t=>({graphId,nodeId,request:(t?.request??0)+1}));};
 const visits=validTimelineVisits(project,graph?.id,timelineVisits);
 useEffect(()=>{if(visits.length!==timelineVisits.length)setTimelineVisits(visits);},[project, graph?.id, timelineVisits]);
 const timeline=projectGraphs(project).find(g=>g.id===visits.at(-1)?.graphId);
 useEffect(()=>{
  if(!blueprintFocus?.selection?.active())return;
  if(visits.some(v=>v.graphId===blueprintFocus.graphId)){
   const index=visits.findIndex(v=>v.graphId===blueprintFocus.graphId);setTimelineVisits(visits.slice(0,index+1));
  }else if(related.some(g=>g.id===blueprintFocus.graphId)){
   setTimelineVisits([]);setSelectedGraph(blueprintFocus.graphId);
  }else{
   const path=findTimelinePath(project,graph?.id,blueprintFocus.graphId);if(!path)return;setTimelineVisits(path);
  }
  setAnimationId(undefined);setTarget(blueprintFocus);
 },[blueprintFocus, pageId]);
 useEffect(()=>{
  if(!animationFocus?.active()||!uiPageAnimations(project,pageId).some(a=>a.id===animationFocus.animationId))return;
  setAnimationId(animationFocus.animationId);setTimelineVisits([]);setAuxiliary(undefined);onActiveBlueprint?.(undefined);
 },[animationFocus, pageId, project.ui.activeInstanceId]);
 const openTimeline=(id:string,ownerId:string,callNodeId?:string)=>{

  if(id===graph?.id||visits.some(v=>v.graphId===id)){setNotice('该时间轴已经在当前路径中，不能循环进入。');return;}
  const nodeId=callNodeId??projectGraphs(project).find(g=>g.id===ownerId)?.nodes.find(n=>n.type==='callFunction'&&n.properties.graphId===id)?.id;
  if(!nodeId)return;
  setTimelineVisits([...visits,{graphId:id,callNodeId:nodeId}]);setTarget(t=>({graphId:id,request:(t?.request??0)+1}));
 };
 const backTimeline=()=>{
  const last=visits.at(-1);if(!last||!graph)return;
  const ownerId=visits.at(-2)?.graphId??graph.id;
  setTimelineVisits(visits.slice(0,-1));setTarget(t=>({graphId:ownerId,nodeId:last.callNodeId,request:(t?.request??0)+1}));
 };
 const create=()=>{try{let id='';commit('创建页面事件图',draft=>{id=createUiEventGraph(draft,pageId,pageName).id;});locate(id);setNotice('页面显示时会执行入口。选择左侧按钮，为它添加点击事件。');}catch(error){setNotice(String(error));}};
 const handlers=component?uiClickHandlers(project,pageId,component.id):[];
 const newClickEvent=()=>{if(!component)return;try{
  let graphId='',nodeId='';commit('添加控件点击事件',draft=>{
   const g=uiEventAuthoringGraph(draft,pageId,pageName,graph?.id);graphId=g.id;nodeId=ensureUiClickEvent(draft,g,component.id,pageId).id;
  });locate(graphId,nodeId);setNotice('点击事件已就绪。选择要控制的控件并添加设置属性，再连接白色执行引脚。');
 }catch(error){setNotice(String(error));}};
 const clickEvent=()=>{
  const existing=handlers.find(handler=>projectGraphs(project).some(g=>g.id===handler.graphId&&ownsUiEventGraph(project,g,pageId)))??handlers.find(handler=>projectGraphs(project).some(g=>g.id===handler.graphId));
  if(existing){const g=projectGraphs(project).find(g=>g.id===existing.graphId)!;locate(g.id,existing.nodeId??g.nodes.find(n=>n.type==='event')?.id);return;}
  if(handlers.length){setNotice('这个按钮引用的蓝图已不存在。请在设计属性中重新选择绑定，或添加独立点击事件。');return;}
  newClickEvent();
 };
 const buttonEvent=(trigger:UiButtonEvent,independent=false)=>{if(!component)return;try{
  const existing=!independent&&findUiControlEvent(project,pageId,component.id,'eventButton',trigger);
  if(existing){locate(existing.g.id,existing.n.id);return;}
  let graphId='',nodeId='';commit('添加按钮'+uiButtonEvents[trigger].name+'事件',draft=>{const g=uiEventAuthoringGraph(draft,pageId,pageName,graph?.id);graphId=g.id;nodeId=ensureUiButtonEvent(draft,g,component.id,pageId,trigger).id;});locate(graphId,nodeId);
 }catch(error){setNotice(String(error));}};
 const valueChangedEvent=(independent=false)=>{if(!component)return;try{
  const existing=!independent&&findUiControlEvent(project,pageId,component.id,'eventValueChanged');
  if(existing){locate(existing.g.id,existing.n.id);return;}
  let graphId='',nodeId='';commit('添加控件值改变事件',draft=>{const g=uiEventAuthoringGraph(draft,pageId,pageName,graph?.id);graphId=g.id;nodeId=ensureUiValueChangedEvent(draft,g,component.id,pageId).id;});locate(graphId,nodeId);
 }catch(error){setNotice(String(error));}};
 const textCommittedEvent=(independent=false)=>{if(!component)return;try{
  const existing=!independent&&findUiControlEvent(project,pageId,component.id,'eventTextCommitted');if(existing){locate(existing.g.id,existing.n.id);return;}
  let graphId='',nodeId='';commit('添加文字提交事件',draft=>{const g=uiEventAuthoringGraph(draft,pageId,pageName,graph?.id);graphId=g.id;nodeId=ensureUiTextCommittedEvent(draft,g,component.id,pageId).id;});locate(graphId,nodeId);
 }catch(error){setNotice(String(error));}};
 const inheritedEvents: {label:string;add:()=>void}[]=[];
 if(component){
  const inherited=(type:BlueprintNodeType,trigger?:UiButtonEvent)=>{const entry=findUiControlEvent(project,pageId,component.id,type,trigger);return entry&&!ownsUiEventGraph(project,entry.g,pageId);};
  if(component.kind==='button')for(const [trigger,event] of Object.entries(uiButtonEvents))if(inherited('eventButton',trigger as UiButtonEvent))inheritedEvents.push({label:event.name.replace(/时$/,''),add:()=>buttonEvent(trigger as UiButtonEvent,true)});
  if(uiControlValueType(project,component)&&inherited('eventValueChanged'))inheritedEvents.push({label:'值改变',add:()=>valueChangedEvent(true)});
  if(uiTextInput(project,component)&&inherited('eventTextCommitted'))inheritedEvents.push({label:'文字提交',add:()=>textCommittedEvent(true)});
 }
 const eventScope=pageId.startsWith('ui:')?'当前方案':'当前页面';
 const graphOrigin=graph&&!ownsUiEventGraph(project,graph,pageId)?graph.uiInstanceId&&graph.uiInstanceId!=='base'?'方案「'+(project.ui.instances?.find(i=>i.id===graph.uiInstanceId)?.name??graph.uiInstanceId)+'」':graph.uiInstanceId==='base'?'基础界面':'共用蓝图':undefined;
 const controlValue=uiControlValue(project,component);
 const controlKind=(c:UiComponent)=>{
  if(uiTextInput(project,c))return '文字输入';
  const type=uiControlValueType(project,c);
  if(c.kind==='preferenceChoice'&&type)return '选项';
  return type?{number:'滑块',boolean:'开关',string:'选项'}[type]:componentNames[c.kind];
 };
 const library=(add:(type:BlueprintNodeType,properties?:Record<string,VariableValue>)=>void)=><aside className="ui-event-library" aria-label="我的界面">
  <section><h3><MousePointer2 size={14}/>控件 <small>{components.length}</small></h3><div className="search"><Search size={13}/><input aria-label="搜索事件图控件" placeholder="搜索控件" value={query} onChange={e=>setQuery(e.target.value)}/></div>
   <div className="ui-event-components" aria-label="当前页面控件">{[...components].reverse().filter(c=>(componentName(c)+' '+controlKind(c)).includes(query.trim())).map(c=><button key={c.id} data-ui-component-id={c.id} draggable aria-pressed={component?.id===c.id} className={component?.id===c.id?'active':''} onClick={()=>onComponentSelect(c.id)} onDragStart={e=>{e.dataTransfer.setData('application/vns-ui-component',c.id);e.dataTransfer.effectAllowed='copy';onComponentSelect(c.id);}}><span>{componentName(c)}</span><small>{controlKind(c)}</small></button>)}</div>
   {!components.length&&<p>在“设计”中添加按钮、文字或图片，再回来连接行为。</p>}
   {component?<div className="ui-event-component-actions"><strong>{componentName(component)}</strong>{uiTextInput(project,component)&&<button className="small-button" onClick={()=>textCommittedEvent()}><Plus size={13}/>文字提交时 · OnTextCommitted</button>}{uiControlValueType(project,component)&&<button className="small-button" onClick={()=>valueChangedEvent()}><Plus size={13}/>值改变时 · OnValueChanged</button>}{component.kind==='button'&&<button className="small-button" onClick={clickEvent}><Plus size={13}/>点击时 · OnClicked</button>}{component.kind==='button'&&<details key={component.id} className="ui-property-group"><summary>更多按钮事件</summary><div className="ui-button-event-actions">{Object.entries(uiButtonEvents).map(([id,e])=><button key={id} className="small-button" onClick={()=>buttonEvent(id as UiButtonEvent)}>{e.name} · {e.unreal}</button>)}</div></details>}{component.kind==='button'&&(handlers.length>0||component.action)&&<div className="ui-click-flow" aria-label="按钮执行顺序"><small>点击后的执行顺序</small><ol>{handlers.map((handler,index)=>{const g=projectGraphs(project).find(g=>g.id===handler.graphId),node=g?.nodes.find(n=>n.id===handler.nodeId);return <li key={index}><button className="text-button" disabled={!g} onClick={()=>g&&locate(g.id,node?.id??g.nodes.find(n=>n.type==='event')?.id)}>{g?(handler.source==='event'?'事件：':handler.source==='callback'?'绑定事件：':'调用：')+(node?.name??g.name):'缺失蓝图：'+handler.graphId}</button></li>;})}{component.action&&component.action!=='blueprint'&&<li>预设动作：{actionName(component.action)}</li>}</ol>{onDesign&&<button className="text-button" onClick={onDesign}>编辑按钮行为</button>}{handlers.length>0&&<button className="text-button" onClick={newClickEvent}>＋ 添加独立点击事件</button>}</div>}{inheritedEvents.length>0&&<div className="ui-control-value" aria-label="继承控件事件"><small>此控件有继承或共用事件。下方新增事件只作用于{eventScope}，原有事件仍会执行。</small>{inheritedEvents.map(event=><button key={event.label} className="small-button" onClick={event.add}>为{eventScope}添加{event.label}事件</button>)}</div>}{controlValue&&<div className="ui-control-value" aria-label="控件值绑定">{controlValue.error?<><small>{controlValue.error}</small>{onDesign&&<button className="text-button" onClick={onDesign}>编辑控件绑定</button>}</>:<><small>值来自：{controlValue.label}</small><div><button className="small-button" disabled={!graph} onClick={()=>add(controlValue.read!.type,controlValue.read!.properties)}>读取值</button><button className="small-button" disabled={!graph} onClick={()=>add(controlValue.write!.type,controlValue.write!.properties)}>设置值</button></div><small>修改绑定值会同步所有使用它的控件。</small></>}</div>}<div><button className="small-button" disabled={!graph} onClick={()=>add('getUiProperty',{componentId:component.id})}>读取属性</button><button className="small-button" disabled={!graph} onClick={()=>add('setUiProperty',{componentId:component.id})}>设置属性</button><button className="small-button" disabled={!graph} onClick={()=>add('animateUiProperty',{componentId:component.id})}>属性动画</button><button className="small-button" disabled={!graph} onClick={()=>add('stopUiAnimation',{componentId:component.id})}>停止动画</button></div></div>:<p>选中控件查看事件；也可以拖到图中。</p>}
  </section>
  <section><h3><GitBranch size={14}/>事件</h3>{graph?.nodes.filter(n=>['event','eventClick','eventButton','eventValueChanged','eventTextCommitted','eventKey','eventTimer'].includes(n.type)).map(n=><button key={n.id} className="ui-event-entry" onClick={()=>locate(graph.id,n.id)}>{n.type==='event'&&graph.uiPageId?'页面显示时 · OnShow':n.name}</button>)}{graph&&<div className="ui-event-event-actions"><button className="text-button" onClick={()=>add('eventKey')}>＋ 按键事件</button><button className="text-button" onClick={()=>add('eventTimer')}>＋ 定时事件</button>{!graph.nodes.some(n=>n.type==='event')&&<button className="text-button" onClick={()=>add('event')}>＋ 页面显示事件</button>}</div>}</section>
  <section className="ui-animation-list"><h3>动画 <button className="text-button" disabled={(project.ui.animations?.length??0)>=256} onClick={createAnimation}>＋ 新建动画</button></h3>{uiPageAnimations(project,pageId).map(a=><div key={a.id} data-ui-animation-id={a.id}><button className="text-button" draggable onDragStart={e=>{e.dataTransfer.setData('application/vns-ui-animation',a.id);e.dataTransfer.effectAllowed='copy';}} onClick={()=>openAnimation(a.id)}>{a.name}</button><div><button className="text-button" disabled={!graph} onClick={()=>add('playUiAnimation',{animationId:a.id})}>播放</button><button className="text-button" disabled={!graph} onClick={()=>add('stopUiAnimationPlayback',{animationId:a.id})}>停止</button></div></div>)}{!uiPageAnimations(project,pageId).length&&<p>创建可复用的控件关键帧动画，再拖入事件图播放。</p>}</section>
  <UiGraphVariables project={project} commit={commit} canAddNode={!!graph} add={add} onNotice={setNotice}/>
 </aside>;
 const auxiliaryPanel=<><div className="workspace-toolbar ui-event-auxiliary"><button className="text-button" aria-expanded={auxiliary==='binding'} onClick={()=>setAuxiliary(v=>v==='binding'?undefined:'binding')}>参数绑定…</button></div>{auxiliary==='binding'&&<UiParameterBindings project={project} components={components} pageId={pageId} commit={commit} selectedComponentId={selectedComponentId} onComponentSelect={onComponentSelect} onGraphChange={id=>locate(id)}/>}</>;
 return <div className="ui-logic-editor ui-event-editor">{graphOrigin&&!animation&&!timeline&&<div className="ui-event-notice" role="status">当前正在编辑{graphOrigin}的事件图，修改会影响使用它的其他页面或方案。新增控件事件会保存到{eventScope}。</div>}{notice&&<div className="ui-event-notice" role="status">{notice}<button onClick={()=>setNotice('')} aria-label="关闭事件图提示">×</button></div>}
  {animation?<UiAnimationEditor focus={animationFocus} onActiveAnimation={onActiveAnimation} key={animation.id} project={project} clip={animation} commit={commit} assetUrl={assetUrl} onBack={()=>setAnimationId(undefined)} selectedComponentId={selectedComponentId} onComponentSelect={onComponentSelect}/>:timeline?<UiEventTimeline key={timeline.id} project={project} graph={timeline} commit={commit} assetUrl={assetUrl} focus={target} onOpenTimeline={openTimeline} onNotice={setNotice} onActiveSelection={onActiveBlueprint} navigation={<><button className="small-button" onClick={backTimeline}>{visits.length>1?'返回上层时间轴':'返回事件图'}</button><span className="ui-event-timeline-path">{pageName} / {graph?.name}{visits.slice(0,-1).map(v=>' / '+(projectGraphs(project).find(g=>g.id===v.graphId)?.name??''))} /</span></>}/>:graph?<BlueprintGraphEditor onOpenUiAnimation={openAnimation} onOpenTimeline={openTimeline} project={project} commit={commit} focus={focus} onActiveSelection={onActiveBlueprint} uiWorkspace={{pageId,selectedComponentId,auxiliary:auxiliaryPanel,auxiliaryOpen:!!auxiliary,library,toolbar:<><select aria-label="当前页面事件图" value={graph.id} onChange={e=>locate(e.target.value)}>{related.map(g=><option key={g.id} value={g.id}>{g.name}{!g.uiPageId?' · 已有绑定':g.uiPageId!==pageId?' · 调用其他页面':''}</option>)}</select><button className="text-button" onClick={create}>＋ 新建事件图</button></>}}/>:
   <><div className="ui-event-empty"><div>{library(()=>{})}</div><main><GitBranch size={36}/><h2>{pageName} · 事件图</h2><p>在“设计”中摆放控件，在这里连接它们的行为。</p><div className="ui-event-example"><span>按钮 · 点击时</span><b>→</b><span>设置文字 · 显示 = 否</span></div><button className="primary" onClick={create}>创建页面事件图</button><p>也可以先选左侧按钮，直接添加 OnClicked 点击事件。</p></main></div><div className="ui-event-empty-auxiliary">{auxiliaryPanel}</div></>}
 </div>;
}
