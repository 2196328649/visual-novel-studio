import { uiSpineEvents, type UiSpineEvent } from './ui-spine';
import { uiVideoEvents, type UiVideoEvent } from './ui-video';
import { uiImageEvents, type UiImageEvent } from './ui-image';
import { projectGraphs, addProjectGraphs } from './project-resources';
import { uiControlValueType, uiTextInput } from './ui-control-events';
import { effectiveUiComponents, sortUiComponents, uiPageSchema, variableAssetKind, type BlueprintGraph, type BlueprintNode, type ParameterDefaults, type Project, type Variable, type VariableValue } from './model';
import { addParameter, parameterNameProblem } from './parameter-sets';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures, synchronizeBlueprintNodeValuePins } from './blueprint';
import { availableBlueprintName } from './blueprint-names';
import { uiProperties, uiPropertyApplies, type UiProperty } from './ui';
import { uiPropertyPinType } from './ui-properties';
import { uiControlPropertyAssignmentProblem } from './ui-control-authoring';
import { findUiParameterBinding, isUiParameterBindingGraph, markUiParameterBindingGraph } from './ui-parameter-links';
import { uiButtonEvents, type UiButtonEvent } from './ui-button-events';
import { uiPageLifecyclePhases, type UiPageLifecyclePhase } from './ui-page-interface';
export const standardUiEventPages = uiPageSchema.options.filter(page=>page!=='custom').map(page=>({id:'ui:'+page,name:page}));
export function createUiGraphVariable(project:Project,name:string,type:Variable['type'],initial:VariableValue,setId:string,options?:Partial<ParameterDefaults>) {
 name=name.trim();
 const problem=parameterNameProblem(project,name);if(problem)throw new Error(problem);
 if(type==='asset'||typeof initial!==type||typeof initial==='number'&&!Number.isFinite(initial))throw new Error('初始值与变量类型不匹配。');
 const id=addParameter(project,setId,type,options),variable=project.variables.find(v=>v.id===id)!;
 variable.name=name;variable.initial=initial;return variable;
}
export function uiPageComponents(project:Project,pageId:string) {
 return pageId.startsWith('ui:')?effectiveUiComponents(project.ui).filter(c=>'ui:'+c.page===pageId):project.ui.customPages.find(p=>p.id===pageId)?.components??[];
}
/** Owned event graphs execute only on their page and active UI scheme. Legacy graphs retain their existing bindings. */
export function uiGraphOnPage(project:Project,graph:BlueprintGraph,pageId:string):boolean {
 return !graph.uiPageId || graph.uiPageId===pageId&&uiEventInActiveInstance(project,{properties:{uiInstanceId:graph.uiInstanceId??''}});
}
/** The same ordered show roots are used by the player and startup-path diagnostics. */
export function uiPageShowGraphIds(project: Project, pageId: string): string[] {
  const graphs = projectGraphs(project), components = sortUiComponents(uiPageComponents(project, pageId));
  const page = project.ui.customPages.find(page => page.id === pageId);
  const instance = pageId.startsWith('ui:') ? project.ui.instances?.find(instance => instance.id === project.ui.activeInstanceId) : undefined;
  const candidates = [
    ...graphs.filter(graph => graph.uiPageId === pageId && uiGraphOnPage(project, graph, pageId) && graph.nodes.some(node => node.type === 'event')).map(graph => graph.id),
    page?.onShowBlueprintId, instance?.blueprintId, ...components.map(component => component.events?.onShow),
  ];
  return [...new Set(candidates)].filter((id): id is string => !!id && graphs.some(graph => graph.id === id));
}
export interface UiClickHandler { graphId:string; nodeId?:string; source:'beforeClick'|'event'|'callback'|'action' }
/** A connected page runs before the existing click roots, callback and primary action. */
export function uiClickHandlers(project:Project,pageId:string,componentId:string):UiClickHandler[] {
 const component=uiPageComponents(project,pageId).find(c=>c.id===componentId&&c.kind==='button');
 if(!component)return [];
 const handlers:UiClickHandler[]=component.clickMode==='replace'?[]:projectGraphs(project).flatMap(graph=>uiGraphOnPage(project,graph,pageId)?graph.nodes.filter(n=>n.type==='eventClick'&&n.properties.componentId===componentId&&uiEventInActiveInstance(project,n)).map(node=>({graphId:graph.id,nodeId:node.id,source:'event' as const})):[]);
 if(component.events?.beforeClick)handlers.unshift({graphId:component.events.beforeClick,source:'beforeClick'});
 if(component.clickMode!=='replace'&&component.events?.onClick)handlers.push({graphId:component.events.onClick,source:'callback'});
 if(component.action==='blueprint'&&component.blueprintId)handlers.push({graphId:component.blueprintId,source:'action'});
 return handlers;
}
export function uiPageGraphs(project:Project,pageId:string,graphs:readonly BlueprintGraph[]=projectGraphs(project)) {
 const components=uiPageComponents(project,pageId), ids=new Set(components.map(c=>c.id));
 const bound=new Set([project.ui.customPages.find(p=>p.id===pageId)?.onShowBlueprintId,...components.flatMap(c=>[c.action==='blueprint'?c.blueprintId:undefined,c.events?.beforeClick,c.events?.onClick,c.events?.onShow]),...(pageId.startsWith('ui:')?[project.ui.instances?.find(i=>i.id===project.ui.activeInstanceId)?.blueprintId]:[])]);
 return graphs.filter(graph=>bound.has(graph.id)||(graph.uiPageId?uiGraphOnPage(project,graph,pageId):graph.nodes.some(node=>['eventKey','eventTimer','eventPage'].includes(node.type)?node.properties.pageId===pageId&&uiEventInActiveInstance(project,node):['eventClick','eventButton','eventValueChanged','eventTextCommitted','eventImage', 'eventVideo', 'eventSpine'].includes(node.type)&&ids.has(String(node.properties.componentId))&&uiEventInActiveInstance(project,node))));
}
export function createUiEventGraph(project:Project,pageId:string,name:string) {
 if(!standardUiEventPages.some(p=>p.id===pageId)&&!project.ui.customPages.some(p=>p.id===pageId))throw new Error('页面已不存在。');
 if(projectGraphs(project).length>=256)throw new Error('蓝图数量已达到上限。');
 const graph=createBlueprintGraph('ui',availableBlueprintName(project,name+' · 事件图'));
 graph.uiPageId=pageId;if(pageId.startsWith('ui:'))graph.uiInstanceId=project.ui.activeInstanceId??'base';
 graph.nodes[0].name='页面显示时';graph.nodes[0].x=60;graph.nodes[0].y=60;
 addProjectGraphs(project, graph);return graph;
}
/** New control events belong to the edited scheme, even while viewing an inherited or called graph. */
export function ownsUiEventGraph(project:Project,graph:BlueprintGraph,pageId:string):boolean {
 return graph.uiPageId===pageId&&(!pageId.startsWith('ui:')||graph.uiInstanceId===(project.ui.activeInstanceId??'base'));
}
export function uiEventAuthoringGraph(project:Project,pageId:string,name:string,preferredGraphId?:string) {
 return projectGraphs(project).find(g=>g.id===preferredGraphId&&ownsUiEventGraph(project,g,pageId))
  ??projectGraphs(project).find(g=>ownsUiEventGraph(project,g,pageId)&&!isUiParameterBindingGraph(project,g))??createUiEventGraph(project,pageId,name);
}
/** Design-side shortcuts never add nodes to an inherited or shared graph. */
export function ensureUiPageEvent(project: Project, pageId: string, name: string, phase: UiPageLifecyclePhase | 'show') {
  const graphs = projectGraphs(project).filter(graph => ownsUiEventGraph(project, graph, pageId) && !isUiParameterBindingGraph(project, graph));
  const matches = (node: BlueprintNode) => phase === 'show' ? node.type === 'event'
    : node.type === 'eventPage' && node.properties.phase === phase && (!node.properties.pageId || node.properties.pageId === pageId);
  const existing = graphs.flatMap(graph => graph.nodes.filter(matches).map(node => ({ graph, node })))[0];
  if (existing) return existing;
  const graph = uiEventAuthoringGraph(project, pageId, name);
  if (phase === 'show' && graph.nodes.some(node => node.type === 'event')) return { graph, node: graph.nodes.find(node => node.type === 'event')! };
  if (graph.nodes.length >= 512) throw new Error('节点数量已达到上限。');
  const node = blueprintNodeDefaults(phase === 'show' ? 'event' : 'eventPage');
  node.name = phase === 'show' ? '页面显示时' : uiPageLifecyclePhases[phase].name;
  if (phase !== 'show') Object.assign(node.properties, { pageId, phase, uiInstanceId: graph.uiInstanceId ?? '' });
  node.x = 60; node.y = Math.max(60, ...graph.nodes.map(item => item.y)) + 320;
  graph.nodes.push(node); synchronizeBlueprintSignatures(project);
  return { graph, node };
}
export function findUiControlEvent(project:Project,pageId:string,componentId:string,type:BlueprintNode['type'],trigger?:UiButtonEvent|UiImageEvent|UiVideoEvent|UiSpineEvent) {
 const matches=uiPageGraphs(project,pageId).filter(g=>uiGraphOnPage(project,g,pageId)).flatMap(g=>g.nodes.filter(n=>n.type===type&&n.properties.componentId===componentId&&(trigger===undefined||n.properties.trigger===trigger)&&uiEventInActiveInstance(project,n)).map(n=>({g,n})));
 return matches.find(({g})=>ownsUiEventGraph(project,g,pageId))??matches[0];
}
export function ensureUiClickEvent(project:Project,graph:BlueprintGraph,componentId:string,pageId:string) {
 const component=uiPageComponents(project,pageId).find(c=>c.id===componentId&&c.kind==='button');
 if(!component||!uiGraphOnPage(project,graph,pageId))throw new Error('请选择当前页面的按钮。');
 const existing=graph.nodes.find(n=>n.type==='eventClick'&&n.properties.componentId===componentId&&uiEventInActiveInstance(project,n));
 if(existing)return existing;
 if(graph.nodes.length>=512)throw new Error('节点数量已达到上限。');
 const node=blueprintNodeDefaults('eventClick');node.name=(component.name||component.text||'按钮').slice(0,105)+' · 点击时';
 node.properties.componentId=componentId;node.properties.uiInstanceId=graph.uiInstanceId??'';
 node.x=60;node.y=Math.max(60,...graph.nodes.map(n=>n.y))+320;graph.nodes.push(node);return node;
}
export function ensureUiButtonEvent(project:Project,graph:BlueprintGraph,componentId:string,pageId:string,trigger:UiButtonEvent) {
 const component=uiPageComponents(project,pageId).find(c=>c.id===componentId&&c.kind==='button');
 if(!component||!uiGraphOnPage(project,graph,pageId))throw new Error('请选择当前页面的按钮。');
 const existing=graph.nodes.find(n=>n.type==='eventButton'&&n.properties.componentId===componentId&&n.properties.trigger===trigger&&uiEventInActiveInstance(project,n));
 if(existing)return existing;
 if(graph.nodes.length>=512)throw new Error('节点数量已达到上限。');
 const node=blueprintNodeDefaults('eventButton');node.name=(component.name||component.text||'按钮').slice(0,105)+' · '+uiButtonEvents[trigger].name;
 Object.assign(node.properties,{componentId,trigger,uiInstanceId:graph.uiInstanceId??''});
 node.x=60;node.y=Math.max(60,...graph.nodes.map(n=>n.y))+320;graph.nodes.push(node);return node;
}
export function createUiParameterBinding(project:Project, componentId:string, property:UiProperty, variableId:string, pageId:string) {
 const component=uiPageComponents(project,pageId).find(c=>c.id===componentId), variable=project.variables.find(v=>v.id===variableId);
 if(!component||!variable||!uiPropertyApplies(component,property,project)||!uiProperties[property].writable||!uiProperties[property].bindable||uiPropertyPinType(property)!==variable.type||variable.type==='asset'&&variableAssetKind(variable)!==uiProperties[property].resource) throw new Error('组件属性与参数类型不匹配。');
 const existing=findUiParameterBinding(project,componentId,property,variableId,pageId);if(existing)return existing;
 const valueProblem=uiControlPropertyAssignmentProblem(project,component,property,variable.initial);if(valueProblem)throw new Error(valueProblem);
 if(projectGraphs(project).length>=256)throw new Error('蓝图数量已达到上限。');
 const graph=createBlueprintGraph('ui',availableBlueprintName(project,'界面参数联动'));
 graph.uiPageId=pageId;if(pageId.startsWith('ui:'))graph.uiInstanceId=project.ui.activeInstanceId??'base';
 const timer=blueprintNodeDefaults('eventTimer');timer.properties={pageId,interval:.05,repeat:true,...(pageId.startsWith('ui:')?{uiInstanceId:project.ui.activeInstanceId??'base'}:{})};timer.x=0;timer.y=350;
 const read=blueprintNodeDefaults('getVariable');read.properties.variableId=variable.id;read.x=0;read.y=650;
 const initial=blueprintNodeDefaults('setUiProperty'),update=blueprintNodeDefaults('setUiProperty');
 for(const node of [initial,update]) {node.properties={componentId,property,value:variable.initial};node.x=450;}
 initial.y=0;update.y=350;
 graph.nodes.push(timer,read,initial,update);
 // Complete the isolated graph before publishing it. An incompatible source
 // must never leave half a binding or mutate unrelated project signatures.
 for(const node of graph.nodes)synchronizeBlueprintNodeValuePins(project,graph,node);
 for(const [from,fromPin,to,toPin] of [[graph.nodes[0].id,'exec',initial.id,'exec_in'],[timer.id,'exec',update.id,'exec_in'],[read.id,'value',initial.id,'value'],[read.id,'value',update.id,'value']]) {const error=connectBlueprintPins(graph,from,fromPin,to,toPin);if(error)throw new Error(error);}
 markUiParameterBindingGraph(graph);addProjectGraphs(project,graph);
 return graph;
}

/** An empty scope means a reusable event shared across schemes. */
export function uiEventInActiveInstance(project:Project,node:Pick<BlueprintNode,'properties'>):boolean {
 const scope=node.properties.uiInstanceId;
 if(!scope)return true;
 if(scope==='base')return !project.ui.activeInstanceId;
 const seen=new Set<string>();let id=project.ui.activeInstanceId;
 while(id&&!seen.has(id)) {if(id===scope)return true;seen.add(id);id=project.ui.instances?.find(instance=>instance.id===id)?.baseUiId;}
 return false;
}

export function ensureUiValueChangedEvent(project:Project,graph:BlueprintGraph,componentId:string,pageId:string) {
 const component=uiPageComponents(project,pageId).find(c=>c.id===componentId);
 if(!uiControlValueType(project,component)||!uiGraphOnPage(project,graph,pageId))throw new Error('请选择当前页面已绑定参数的滑块、选项或输入控件。');
 const existing=graph.nodes.find(n=>n.type==='eventValueChanged'&&n.properties.componentId===componentId&&uiEventInActiveInstance(project,n));if(existing)return existing;
 if(graph.nodes.length>=512)throw new Error('节点数量已达到上限。');
 const node=blueprintNodeDefaults('eventValueChanged');node.name=(component!.name||component!.text||'控件').slice(0,100)+' · 值改变时';
 Object.assign(node.properties,{componentId,uiInstanceId:graph.uiInstanceId??''});node.x=60;node.y=Math.max(60,...graph.nodes.map(n=>n.y))+320;graph.nodes.push(node);synchronizeBlueprintSignatures(project);return node;
}

export function ensureUiTextCommittedEvent(project:Project,graph:BlueprintGraph,componentId:string,pageId:string) {
 const component=uiPageComponents(project,pageId).find(c=>c.id===componentId);
 if(!uiTextInput(project,component)||!uiGraphOnPage(project,graph,pageId))throw new Error('请选择当前页面绑定自由文字参数的输入控件。');
 const existing=graph.nodes.find(n=>n.type==='eventTextCommitted'&&n.properties.componentId===componentId&&uiEventInActiveInstance(project,n));if(existing)return existing;
 if(graph.nodes.length>=512)throw new Error('节点数量已达到上限。');
 const node=blueprintNodeDefaults('eventTextCommitted');node.name=(component!.name||component!.text||'输入框').slice(0,100)+' · 文字提交时';Object.assign(node.properties,{componentId,uiInstanceId:graph.uiInstanceId??''});node.x=60;node.y=Math.max(60,...graph.nodes.map(n=>n.y))+320;graph.nodes.push(node);return node;
}

/** Lifecycle nodes share the same page and active-scheme routing as all other events. */
export function uiPageLifecycleHandlers(project: Project, pageId: string, phase: string) {
  return projectGraphs(project).flatMap(graph => uiGraphOnPage(project, graph, pageId) ? graph.nodes.filter(node => node.type === 'eventPage' && (node.properties.pageId || graph.uiPageId) === pageId && node.properties.phase === phase && uiEventInActiveInstance(project, node)).map(node => ({ graphId: graph.id, nodeId: node.id })) : []);
}

export function ensureUiImageEvent(project: Project, graph: BlueprintGraph, componentId: string, pageId: string, trigger: UiImageEvent) {
  const component = uiPageComponents(project, pageId).find(c => c.id === componentId && c.kind === 'image');
  if (!component || !uiGraphOnPage(project, graph, pageId) || !Object.hasOwn(uiImageEvents, trigger)) throw new Error('请选择当前页面的图片和有效加载事件。');
  const existing = graph.nodes.find(node => node.type === 'eventImage' && node.properties.componentId === componentId && node.properties.trigger === trigger && uiEventInActiveInstance(project, node));
  if (existing) return existing;
  if (graph.nodes.length >= 512) throw new Error('节点数量已达到上限。');
  const node = blueprintNodeDefaults('eventImage'); node.name = (component.name || component.text || '图片').slice(0, 100) + ' · ' + uiImageEvents[trigger];
  Object.assign(node.properties, { componentId, trigger, uiInstanceId: graph.uiInstanceId ?? '' });
  node.x = 60; node.y = Math.max(60, ...graph.nodes.map(node => node.y)) + 320; graph.nodes.push(node); return node;
}

export function ensureUiVideoEvent(project: Project, graph: BlueprintGraph, componentId: string, pageId: string, trigger: UiVideoEvent) {
  const component = uiPageComponents(project, pageId).find(c => c.id === componentId && c.kind === 'video');
  if (!component || !uiGraphOnPage(project, graph, pageId) || !Object.hasOwn(uiVideoEvents, trigger)) throw new Error('请选择当前页面的视频和有效播放事件。');
  const existing = graph.nodes.find(node => node.type === 'eventVideo' && node.properties.componentId === componentId && node.properties.trigger === trigger && uiEventInActiveInstance(project, node));
  if (existing) return existing;
  if (graph.nodes.length >= 512) throw new Error('节点数量已达到上限。');
  const node = blueprintNodeDefaults('eventVideo'); node.name = (component.name || component.text || '视频').slice(0, 100) + ' · ' + uiVideoEvents[trigger];
  Object.assign(node.properties, { componentId, trigger, uiInstanceId: graph.uiInstanceId ?? '' });
  node.x = 60; node.y = Math.max(60, ...graph.nodes.map(node => node.y)) + 320; graph.nodes.push(node); return node;
}

export function ensureUiSpineEvent(project: Project, graph: BlueprintGraph, componentId: string, pageId: string, trigger: UiSpineEvent) {
  const component = uiPageComponents(project, pageId).find(c => c.id === componentId && c.kind === 'spine');
  if (!component || !uiGraphOnPage(project, graph, pageId) || !Object.hasOwn(uiSpineEvents, trigger)) throw new Error('请选择当前页面的骨骼和有效播放事件。');
  const existing = graph.nodes.find(node => node.type === 'eventSpine' && node.properties.componentId === componentId && node.properties.trigger === trigger && uiEventInActiveInstance(project, node));
  if (existing) return existing;
  if (graph.nodes.length >= 512) throw new Error('节点数量已达到上限。');
  const node = blueprintNodeDefaults('eventSpine'); node.name = (component.name || component.text || '骨骼').slice(0, 100) + ' · ' + uiSpineEvents[trigger];
  Object.assign(node.properties, { componentId, trigger, uiInstanceId: graph.uiInstanceId ?? '' });
  node.x = 60; node.y = Math.max(60, ...graph.nodes.map(node => node.y)) + 320; graph.nodes.push(node); return node;
}
