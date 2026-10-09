import { projectGraphs, addProjectGraphs } from './project-resources';
import { uiControlValueType, uiTextInput } from './ui-control-events';
import { allUiComponents, effectiveUiComponents, uiPageSchema, type BlueprintGraph, type BlueprintNode, type Project, type Variable, type VariableValue } from './model';
import { addParameter } from './parameter-sets';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from './blueprint';
import { availableBlueprintName } from './blueprint-names';
import { uiProperties, uiPropertyApplies, type UiProperty } from './ui';
import { uiButtonEvents, type UiButtonEvent } from './ui-button-events';
export const standardUiEventPages = uiPageSchema.options.filter(page=>page!=='custom').map(page=>({id:'ui:'+page,name:page}));
export function createUiGraphVariable(project:Project,name:string,type:Variable['type'],initial:VariableValue,setId:string) {
 name=name.trim();
 if(!name||name.length>120||project.variables.some(v=>v.name===name))throw new Error('请输入未被使用的变量名称，最多 120 字。');
 if(typeof initial!==type||typeof initial==='number'&&!Number.isFinite(initial))throw new Error('初始值与变量类型不匹配。');
 const id=addParameter(project,setId,type),variable=project.variables.find(v=>v.id===id)!;
 variable.name=name;variable.initial=initial;return variable;
}
export function uiPageComponents(project:Project,pageId:string) {
 return pageId.startsWith('ui:')?effectiveUiComponents(project.ui).filter(c=>'ui:'+c.page===pageId):project.ui.customPages.find(p=>p.id===pageId)?.components??[];
}
/** Owned event graphs execute only on their page and active UI scheme. Legacy graphs retain their existing bindings. */
export function uiGraphOnPage(project:Project,graph:BlueprintGraph,pageId:string):boolean {
 return !graph.uiPageId || graph.uiPageId===pageId&&uiEventInActiveInstance(project,{properties:{uiInstanceId:graph.uiInstanceId??''}});
}
export interface UiClickHandler { graphId:string; nodeId?:string; source:'event'|'callback'|'action' }
/** Screen action order: explicit click roots, legacy callback, then primary blueprint. */
export function uiClickHandlers(project:Project,pageId:string,componentId:string):UiClickHandler[] {
 const component=uiPageComponents(project,pageId).find(c=>c.id===componentId&&c.kind==='button');
 if(!component)return [];
 const handlers:UiClickHandler[]=projectGraphs(project).flatMap(graph=>uiGraphOnPage(project,graph,pageId)?graph.nodes.filter(n=>n.type==='eventClick'&&n.properties.componentId===componentId&&uiEventInActiveInstance(project,n)).map(node=>({graphId:graph.id,nodeId:node.id,source:'event' as const})):[]);
 if(component.events?.onClick)handlers.push({graphId:component.events.onClick,source:'callback'});
 if(component.action==='blueprint'&&component.blueprintId)handlers.push({graphId:component.blueprintId,source:'action'});
 return handlers;
}
export function uiPageGraphs(project:Project,pageId:string) {
 const components=uiPageComponents(project,pageId), ids=new Set(components.map(c=>c.id));
 const bound=new Set([project.ui.customPages.find(p=>p.id===pageId)?.onShowBlueprintId,...components.flatMap(c=>[c.action==='blueprint'?c.blueprintId:undefined,c.events?.onClick,c.events?.onShow]),...(pageId.startsWith('ui:')?[project.ui.instances?.find(i=>i.id===project.ui.activeInstanceId)?.blueprintId]:[])]);
 return projectGraphs(project).filter(graph=>bound.has(graph.id)||(graph.uiPageId?uiGraphOnPage(project,graph,pageId):graph.nodes.some(node=>['eventKey','eventTimer'].includes(node.type)?node.properties.pageId===pageId&&uiEventInActiveInstance(project,node):['eventClick','eventButton','eventValueChanged','eventTextCommitted'].includes(node.type)&&ids.has(String(node.properties.componentId))&&uiEventInActiveInstance(project,node))));
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
  ??projectGraphs(project).find(g=>ownsUiEventGraph(project,g,pageId))??createUiEventGraph(project,pageId,name);
}
export function findUiControlEvent(project:Project,pageId:string,componentId:string,type:BlueprintNode['type'],trigger?:UiButtonEvent) {
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
 const component=allUiComponents(project).find(c=>c.id===componentId), variable=project.variables.find(v=>v.id===variableId);
 if(!component||!variable||!uiPropertyApplies(component,property)||uiProperties[property].type!==variable.type) throw new Error('组件属性与参数类型不匹配。');
 if(!project.ui.customPages.some(page=>page.id===pageId&&page.components.some(c=>c.id===componentId))&&pageId!=='ui:'+component.page)throw new Error('界面与组件不匹配。');
 if(projectGraphs(project).length>=256)throw new Error('蓝图数量已达到上限。');
 const graph=createBlueprintGraph('ui',availableBlueprintName(project,'界面参数联动'));
 graph.uiPageId=pageId;if(pageId.startsWith('ui:'))graph.uiInstanceId=project.ui.activeInstanceId??'base';
 const timer=blueprintNodeDefaults('eventTimer');timer.properties={pageId,interval:.05,repeat:true,...(pageId.startsWith('ui:')?{uiInstanceId:project.ui.activeInstanceId??'base'}:{})};timer.x=0;timer.y=350;
 const read=blueprintNodeDefaults('getVariable');read.properties.variableId=variable.id;read.x=0;read.y=650;
 const initial=blueprintNodeDefaults('setUiProperty'),update=blueprintNodeDefaults('setUiProperty');
 for(const node of [initial,update]) {node.properties={componentId,property,value:variable.initial};node.x=450;}
 initial.y=0;update.y=350;
 graph.nodes.push(timer,read,initial,update);addProjectGraphs(project, graph);synchronizeBlueprintSignatures(project);
 for(const [from,fromPin,to,toPin] of [[graph.nodes[0].id,'exec',initial.id,'exec_in'],[timer.id,'exec',update.id,'exec_in'],[read.id,'value',initial.id,'value'],[read.id,'value',update.id,'value']]) {const error=connectBlueprintPins(graph,from,fromPin,to,toPin);if(error)throw new Error(error);}
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
