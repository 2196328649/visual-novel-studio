import { UiEventDirectory, type UiDirectoryEventTrigger } from './UiEventDirectory';
import { UiEventSidebarProvider, UiEventDetailHost, UiEventDetail, WithoutUiEventSidebar, useUiEventSidebar } from './UiEventSidebar';
import { UiEventWorkspace } from './UiEventWorkspace';
import { uiSpineEvents, type UiSpineEvent } from '../core/ui-spine';
import { uiVideoEvents, type UiVideoEvent } from '../core/ui-video';
import { uiImageEvents, type UiImageEvent } from '../core/ui-image';
import type { BlueprintUsage } from '../core/blueprint-usages';
import { projectGraphs } from '../core/project-resources';
import type { UiAnimationFocus } from './ui-animation-editor-focus';
import type { BlueprintSelection, UiAnimationSelection } from '../core/ai-selection';
import { uiButtonEvents, type UiButtonEvent } from '../core/ui-button-events';
import { UiAnimationEditor } from './UiAnimationEditor';
import { createUiAnimationClip, uiPageAnimations } from '../core/ui-animation-clips';
import { Activity, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { rememberedUiGraphFocus, uiGraphDetailToRemember, uiGraphEntryDetail, uiGraphEntryFocus, type UiAuthoringSession } from './ui-authoring-session';
import type { BlueprintCanvasLocation } from './blueprint-navigation';
import { UiEventTimeline } from './UiEventTimeline';
import { findTimelinePath, validTimelineVisits, type TimelineVisit } from '../core/timeline-navigation';
import { GitBranch, Plus } from 'lucide-react';
import { BlueprintGraphEditor, type BlueprintFocus } from './BlueprintGraphEditor';
import type { OpenBlueprintGraph } from './blueprint-navigation';
import { createUiEventGraph, uiEventAuthoringGraph, ownsUiEventGraph, findUiControlEvent, ensureUiClickEvent, ensureUiButtonEvent, ensureUiValueChangedEvent, ensureUiTextCommittedEvent, ensureUiImageEvent, ensureUiVideoEvent, ensureUiSpineEvent, uiPageGraphs, uiClickHandlers } from '../core/ui-logic';
import type { BlueprintNodeType } from '../core/blueprint';
import { uiPageNames } from './UiNames';
import type { Project, UiComponent, VariableValue } from '../core/model';
import type { Commit } from './editor';
import type { AssetUrl } from './StageEditor';

type UiLogicEditorProps = {session:UiAuthoringSession;pageActions?:ReactNode;onLocateUsage?:(usage:BlueprintUsage)=>void;openBlueprint?:OpenBlueprintGraph;animationFocus?:UiAnimationFocus;blueprintFocus?:BlueprintFocus;project:Project;components:UiComponent[];pageId:string;commit:Commit;assetUrl:AssetUrl;selectedComponentId?:string;onComponentSelect:(id?:string)=>void;onLocateComponent?:(id:string)=>void;onDesign?:()=>void;onActiveAnimation?:(selection?:UiAnimationSelection)=>void;onActiveBlueprint?:(selection?:BlueprintSelection)=>void;saving?:boolean};

export function UiLogicEditor(props: UiLogicEditorProps) {
 const related=uiPageGraphs(props.project,props.pageId);
 const initial=related.find(g=>g.id===props.session.graphId)??related.find(g=>ownsUiEventGraph(props.project,g,props.pageId))??related[0];
 return <UiEventSidebarProvider session={props.session} fallback={"graph:"+(initial?.id??"none")}><UiLogicEditorContent {...props}/></UiEventSidebarProvider>;
}

function UiLogicEditorContent({session,pageActions,onLocateUsage,openBlueprint,animationFocus,blueprintFocus,project,components,pageId,commit,assetUrl,selectedComponentId,onComponentSelect,onLocateComponent,onActiveBlueprint,onActiveAnimation,onDesign,saving=false}: UiLogicEditorProps) {
 const [selectedGraph,setSelectedGraph]=useState(session.graphId),[target,setTarget]=useState<BlueprintFocus|undefined>(()=>rememberedUiGraphFocus(session,session.timelineVisits.at(-1)?.graphId??session.graphId)),[notice,setNotice]=useState('');
 const [animationId,setAnimationId]=useState(session.animationId);
 const sidebar=useUiEventSidebar()!;
 const animation=project.ui.animations?.find(a=>a.id===animationId);
 const openAnimation=(id:string,nodeId?:string)=>{setNotice('');setAnimationId(id);if(nodeId&&graph)setTarget(t=>({graphId:graph.id,nodeId,request:(t?.request??0)+1}));onActiveBlueprint?.(undefined);};
 const createAnimation=()=>{let id='';commit('创建界面动画',draft=>{id=createUiAnimationClip(draft,pageId).id;});sidebar.select('animation:'+id);openAnimation(id);};
 const [timelineVisits,setTimelineVisits]=useState<TimelineVisit[]>(session.timelineVisits);
 const related=uiPageGraphs(project,pageId),graph=related.find(g=>g.id===selectedGraph)??related.find(g=>ownsUiEventGraph(project,g,pageId))??related.find(g=>g.uiPageId===pageId)??related[0];
 const component=components.find(c=>c.id===selectedComponentId);
 const pageName=project.ui.customPages.find(p=>p.id===pageId)?.name??uiPageNames[pageId.slice(3) as UiComponent['page']]??'界面';
 const focus=useMemo(()=>graph?target?.graphId===graph.id?target:{graphId:graph.id,request:0}:undefined,[graph?.id, target]);
 const locate=(graphId:string,nodeId?:string)=>{sidebar.select(nodeId?'node:'+graphId+':'+nodeId:session.sidebar.graphDetails.get(graphId)??'graph:'+graphId);setAnimationId(undefined);setTimelineVisits([]);setSelectedGraph(graphId);setTarget(t=>nodeId?{graphId,nodeId,request:(t?.request??0)+1}:rememberedUiGraphFocus(session,graphId,(t?.request??0)+1));};
 const visits=validTimelineVisits(project,graph?.id,timelineVisits);
 useEffect(()=>{if(visits.length!==timelineVisits.length)setTimelineVisits(visits);},[project, graph?.id, timelineVisits]);
 const timeline=projectGraphs(project).find(g=>g.id===visits.at(-1)?.graphId);
 useEffect(()=>{
  if(!blueprintFocus || blueprintFocus === session.handledFocus || blueprintFocus.selection && !blueprintFocus.selection.active())return;
  const requestedGraph=projectGraphs(project).find(item=>item.id===blueprintFocus.graphId);
  if(!requestedGraph || blueprintFocus.nodeId && !requestedGraph.nodes.some(node=>node.id===blueprintFocus.nodeId))return;
  if(visits.some(v=>v.graphId===blueprintFocus.graphId)){
   const index=visits.findIndex(v=>v.graphId===blueprintFocus.graphId);setTimelineVisits(visits.slice(0,index+1));
  }else if(related.some(g=>g.id===blueprintFocus.graphId)){
   setTimelineVisits([]);setSelectedGraph(blueprintFocus.graphId);
  }else{
   const path=findTimelinePath(project,graph?.id,blueprintFocus.graphId);if(!path)return;setTimelineVisits(path);
  }
  session.handledFocus = blueprintFocus;
  if(blueprintFocus.nodeId||related.some(g=>g.id===blueprintFocus.graphId))sidebar.select(uiGraphEntryDetail(session,blueprintFocus,graph?.id,sidebar.active));
  else if(!session.sidebar.active)sidebar.select('graph:'+blueprintFocus.graphId);
  setAnimationId(undefined);setTarget(uiGraphEntryFocus(session,blueprintFocus));
 },[blueprintFocus, pageId, session, project, graph?.id, timelineVisits]);
 useEffect(()=>{
  if(animationFocus === session.handledAnimationFocus || !animationFocus?.active()||!uiPageAnimations(project,pageId).some(a=>a.id===animationFocus.animationId))return;
  session.handledAnimationFocus = animationFocus;
  setAnimationId(animationFocus.animationId);setTimelineVisits([]);onActiveBlueprint?.(undefined);
 },[animationFocus, pageId, session, project]);
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
 const create=()=>{try{let id='';commit('创建页面事件图',draft=>{id=createUiEventGraph(draft,pageId,pageName).id;});locate(id);setNotice('页面显示时会执行入口。在“我的界面”选择按钮，为它添加点击事件。');}catch(error){setNotice(String(error));}};
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
 const imageEvent = (trigger: UiImageEvent, independent = false) => { if (!component) return; try {
  const existing = !independent && findUiControlEvent(project, pageId, component.id, 'eventImage', trigger);
  if (existing) { locate(existing.g.id, existing.n.id); return; }
  let graphId = '', nodeId = ''; commit('添加' + uiImageEvents[trigger], draft => { const g = uiEventAuthoringGraph(draft, pageId, pageName, graph?.id); graphId = g.id; nodeId = ensureUiImageEvent(draft, g, component.id, pageId, trigger).id; }); locate(graphId, nodeId);
 } catch (error) { setNotice(String(error)); } };
 const videoEvent = (trigger: UiVideoEvent, independent = false) => { if (!component) return; try {
  const existing = !independent && findUiControlEvent(project, pageId, component.id, 'eventVideo', trigger);
  if (existing) { locate(existing.g.id, existing.n.id); return; }
  let graphId = '', nodeId = ''; commit('添加' + uiVideoEvents[trigger], draft => { const g = uiEventAuthoringGraph(draft, pageId, pageName, graph?.id); graphId = g.id; nodeId = ensureUiVideoEvent(draft, g, component.id, pageId, trigger).id; }); locate(graphId, nodeId);
 } catch (error) { setNotice(String(error)); } };
 const spineEvent = (trigger: UiSpineEvent, independent = false) => { if (!component) return; try {
  const existing = !independent && findUiControlEvent(project, pageId, component.id, 'eventSpine', trigger);
  if (existing) { locate(existing.g.id, existing.n.id); return; }
  let graphId = '', nodeId = ''; commit('添加' + uiSpineEvents[trigger], draft => { const g = uiEventAuthoringGraph(draft, pageId, pageName, graph?.id); graphId = g.id; nodeId = ensureUiSpineEvent(draft, g, component.id, pageId, trigger).id; }); locate(graphId, nodeId);
 } catch (error) { setNotice(String(error)); } };
 const eventScope=pageId.startsWith('ui:')?'当前方案':'当前页面';
 const graphOrigin=graph&&!ownsUiEventGraph(project,graph,pageId)?graph.uiInstanceId&&graph.uiInstanceId!=='base'?'方案「'+(project.ui.instances?.find(i=>i.id===graph.uiInstanceId)?.name??graph.uiInstanceId)+'」':graph.uiInstanceId==='base'?'基础界面':'共用蓝图':undefined;
 useLayoutEffect(()=>{session.graphId=graph?.id;session.animationId=animationId;session.timelineVisits=visits;sidebar.setFallback('graph:'+(graph?.id??'none'));},[session,graph?.id,animationId,visits,sidebar.setFallback]);
 const previousDetail=useRef({graphId:graph?.id,active:sidebar.active});
 useLayoutEffect(()=>{
  // A graph change can render before its sidebar selection settles. Do not
  // overwrite the destination's remembered detail with the previous graph's.
  const detail=uiGraphDetailToRemember(previousDetail.current,graph?.id,sidebar.active);
  if(graph&&detail!==undefined)session.sidebar.graphDetails.set(graph.id,detail);
  previousDetail.current={graphId:graph?.id,active:sidebar.active};
 },[session,graph?.id,sidebar.active]);
 const rememberView=useCallback((view:BlueprintCanvasLocation)=>{session.graphs.set(view.graphId,view);},[session]);
 const backAnimation=()=>{setAnimationId(undefined);if(graph)setTarget(previous=>rememberedUiGraphFocus(session,graph.id,(previous?.request??0)+1));};
 const controlEvent=(type:BlueprintNodeType,trigger?:UiDirectoryEventTrigger,independent=false)=>{
  if(type==='eventButton')buttonEvent(trigger as UiButtonEvent,independent);
  else if(type==='eventValueChanged')valueChangedEvent(independent);
  else if(type==='eventTextCommitted')textCommittedEvent(independent);
  else if(type==='eventImage')imageEvent(trigger as UiImageEvent,independent);
  else if(type==='eventVideo')videoEvent(trigger as UiVideoEvent,independent);
  else if(type==='eventSpine')spineEvent(trigger as UiSpineEvent,independent);
 };
 const library=(add:(type:BlueprintNodeType,properties?:Record<string,VariableValue>)=>void,modules?:ReactNode)=><UiEventDirectory project={project} components={components} component={component} pageId={pageId} graph={graph} commit={commit} saving={saving} pageActions={pageActions} modules={modules} add={add} selectComponent={onComponentSelect} locateComponent={onLocateComponent} locate={locate} design={onDesign} clickEvent={clickEvent} newClickEvent={newClickEvent} controlEvent={controlEvent} createAnimation={createAnimation} openAnimation={openAnimation} notice={setNotice}/>;
 return <div className="ui-logic-editor ui-event-editor">{graphOrigin&&!animation&&!timeline&&<div className="ui-event-notice" role="status">当前正在编辑{graphOrigin}的事件图，修改会影响使用它的其他页面或方案。新增控件事件会保存到{eventScope}。</div>}{notice&&<div className="ui-event-notice" role="status">{notice}<button onClick={()=>setNotice('')} aria-label="关闭事件图提示">×</button></div>}
  {animation && <WithoutUiEventSidebar><UiAnimationEditor focus={animationFocus} onActiveAnimation={onActiveAnimation} key={animation.id} project={project} clip={animation} commit={commit} assetUrl={assetUrl} onBack={backAnimation} selectedComponentId={selectedComponentId} onComponentSelect={onComponentSelect}/></WithoutUiEventSidebar>}{timeline && !animation && <WithoutUiEventSidebar><UiEventTimeline onOpenGraph={openBlueprint} key={timeline.id} project={project} graph={timeline} commit={commit} assetUrl={assetUrl} focus={target} onOpenTimeline={openTimeline} onNotice={setNotice} onActiveSelection={onActiveBlueprint} navigation={<><button className="small-button" onClick={backTimeline}>{visits.length>1?'返回上层时间轴':'返回事件图'}</button><span className="ui-event-timeline-path">{pageName} / {graph?.name}{visits.slice(0,-1).map(v=>' / '+(projectGraphs(project).find(g=>g.id===v.graphId)?.name??''))} /</span></>}/></WithoutUiEventSidebar>}<Activity mode={animation || timeline ? "hidden" : "visible"}>{graph?<BlueprintGraphEditor onRememberView={rememberView} onLocateUsage={onLocateUsage} onOpenGraph={openBlueprint} onOpenUiAnimation={openAnimation} onOpenTimeline={openTimeline} project={project} commit={commit} focus={focus} onActiveSelection={onActiveBlueprint} uiWorkspace={{pageId,selectedComponentId,onLocateComponent,preferences:session.preferences,moduleLibrary:session.moduleLibrary,session:session.sidebar,library,toolbar:<><select className="blueprint-graph-picker" aria-label="当前页面事件图" title={graph.name} value={graph.id} onChange={e=>locate(e.target.value)}>{related.map(g=><option key={g.id} value={g.id}>{g.name}{!g.uiPageId?' · 已有绑定':g.uiPageId!==pageId?' · 调用其他页面':''}</option>)}</select><button type="button" className="icon-button" aria-label="新建事件图" title="新建事件图" onClick={create}><Plus size={16}/></button></>}}/>:
   <UiEventWorkspace directory={library(()=>{})} directoryScroll={session.sidebar.directoryScroll} detailScrollKey={sidebar.active} detailScroll={session.sidebar.detailScroll} details={<UiEventDetailHost/>} canvas={<div className="ui-event-empty"><main><GitBranch size={36}/><h2>{pageName} · 事件图</h2><p>在设计中摆放控件，在这里连接它们的行为。</p><div className="ui-event-example"><span>按钮 · 点击时</span><b>→</b><span>设置文字 · 显示 = 否</span></div><button className="primary" onClick={create}>创建页面事件图</button><p>也可以选择左侧控件，添加它的事件。</p><UiEventDetail id="graph:none" title={pageName} kind="事件图"><p>此页面还没有事件图。创建后即可连接行为。</p><button type="button" className="primary" onClick={create}>创建页面事件图</button></UiEventDetail></main></div>}/>}</Activity>
 </div>;
}
