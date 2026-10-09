import { projectGraphs } from './project-resources';
import { uiPageSchema } from './model';
import { aiSelectedUiAnimation } from './ai-selection';
import { uiAnimationPropertyNames } from './ui-animation';
import { folderTrail } from './content-browser';
import { savedBlueprintAction } from './blueprint-authoring';
import { visualInstancePath } from './visual-selection';
import { isTimelineComponent } from './timeline-component';
import { performanceTimeline } from './performance-timeline';
import { parameterSets } from './parameter-sets';
import { z } from 'zod';
import { effectiveUiComponents, type Project } from './model';
const id=z.string().min(1).max(200);
export const aiEditorTargetSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('uiAnimation'),animationId:id,trackId:id.optional(),keyId:id.optional()}).strict(),
 z.object({kind:z.literal('blueprintSelection'),graphId:id,nodeIds:z.array(id).max(512),linkIds:z.array(id).max(2048),frame:z.boolean().optional()}).strict(),
 z.object({kind:z.literal('blueprint'),graphId:id,nodeId:id.optional(),objectInstanceId:id.optional()}).strict(),
 z.object({kind:z.literal('ui'),componentId:id,advanced:z.boolean().optional(),instanceId:id.optional(),customPageId:id.optional()}).strict(),
 z.object({kind:z.literal('parameterSet'),setId:id}).strict(),
 z.object({kind:z.literal('parameter'),variableId:id}).strict(),
 z.object({kind:z.literal('asset'),assetId:id}).strict(),
 z.object({kind:z.literal('character'),characterId:id}).strict(),
]);
export type AiEditorTarget=z.infer<typeof aiEditorTargetSchema>;
export function resolveAiEditorTarget(project:Project,raw:AiEditorTarget){
 const target=aiEditorTargetSchema.parse(raw);
 if(target.kind==='uiAnimation'){
  if(target.keyId&&!target.trackId)throw new Error('定位关键帧需要所属轨道。');
  const selected=aiSelectedUiAnimation(project,target);
  if(!selected||selected.selectionUnavailable)throw new Error('动画、轨道或关键帧已不存在或标识不唯一；本次定位没有更改。');
  let ui:{page:Project['ui']['components'][number]['page'];instanceId?:string;customPageId?:string;componentId?:string};
  if(selected.pageId!.startsWith('ui:')){
   const page=uiPageSchema.safeParse(selected.pageId!.slice(3));if(!page.success||page.data==='custom')throw new Error('动画所属页面已不存在。');
   const instanceId=selected.uiInstanceId==='base'?undefined:selected.uiInstanceId;
   if(instanceId&&!project.ui.instances?.some(i=>i.id===instanceId))throw new Error('动画所属界面方案已不存在。');
   ui={page:page.data,instanceId,componentId:selected.componentId};
  }else{
   if(!project.ui.customPages.some(p=>p.id===selected.pageId))throw new Error('动画所属自定义页面已不存在。');
   ui={page:'custom',customPageId:selected.pageId,componentId:selected.componentId};
  }
  return {kind:'uiAnimation' as const,animationId:target.animationId,trackId:target.trackId,keyId:target.keyId,ui,
   label:selected.name+(selected.property?' / '+uiAnimationPropertyNames[selected.property]:'')+(selected.key?' / '+selected.key.time+' 秒':'')};
 }
 if(target.kind==='blueprintSelection'){
  const graphs=projectGraphs(project).filter(g=>g.id===target.graphId),graph=graphs[0];
  if(graphs.length!==1)throw new Error('找不到唯一蓝图，请重新读取当前工程。');
  const nodeIds=[...new Set(target.nodeIds)],linkIds=[...new Set(target.linkIds)];
  if(nodeIds.some(id=>graph.nodes.filter(n=>n.id===id).length!==1)||linkIds.some(id=>graph.links.filter(l=>l.id===id).length!==1))throw new Error('所选节点或连线已不存在或标识不唯一；本次选择没有更改。');
  let ui:{page:Project['ui']['components'][number]['page'];instanceId?:string;customPageId?:string}|undefined;
  if(graph.uiPageId){
   if(graph.uiPageId.startsWith('ui:')){
    const page=uiPageSchema.safeParse(graph.uiPageId.slice(3));if(!page.success||page.data==='custom')throw new Error('事件图所属页面已不存在。');
    const instanceId=graph.uiInstanceId==='base'?undefined:graph.uiInstanceId||project.ui.activeInstanceId;
    if(instanceId&&!project.ui.instances?.some(i=>i.id===instanceId))throw new Error('事件图所属界面方案已不存在。');
    ui={page:page.data,instanceId};
   }else{
    if(!project.ui.customPages.some(p=>p.id===graph.uiPageId))throw new Error('事件图所属自定义页面已不存在。');
    ui={page:'custom',customPageId:graph.uiPageId};
   }
  }
  return {kind:'blueprintSelection' as const,graphId:graph.id,nodeIds,linkIds,frame:target.frame??true,ui,label:graph.name+' · '+(nodeIds.length||linkIds.length?nodeIds.length+' 个节点 / '+linkIds.length+' 条连线':'清空选择')};
 }
 if(target.kind==='blueprint'){

  const graph=projectGraphs(project).find(g=>g.id===target.graphId),node=graph?.nodes.find(n=>n.id===target.nodeId);
  if(!graph||target.nodeId&&!node)throw new Error('蓝图或节点已不存在，请重新读取当前工程。');
  let objectName:string|undefined;
  if(target.objectInstanceId){
   const action=node&&savedBlueprintAction(node),path=action?.kind==='visual'?visualInstancePath(action,target.objectInstanceId):undefined;
   if(!path||action?.kind!=='visual')throw new Error('组合对象已移除或标识不唯一，请重新读取当前工程。');
   if(!isTimelineComponent(graph)||performanceTimeline(project,graph).reason)throw new Error('此对象当前不能在时间轴中定位，请打开所属蓝图检查。');
   let object=action;for(const index of path)object=object.children![index];objectName=object.name;
  }
  return {kind:'blueprint' as const,graphId:graph.id,nodeId:node?.id,objectInstanceId:target.objectInstanceId,label:graph.name+(node?' / '+node.name:'')+(objectName?' / '+objectName:'')};
 }
 if(target.kind==='ui'){
  if(target.instanceId&&target.customPageId)throw new Error('界面定位不能同时指定方案和自定义页面。');
  if(target.instanceId&&!project.ui.instances?.some(i=>i.id===target.instanceId))throw new Error('界面方案已不存在。');
  if(target.customPageId&&!project.ui.customPages.some(p=>p.id===target.customPageId))throw new Error('自定义页面已不存在。');
  const instanceId=target.instanceId??project.ui.activeInstanceId;
  const scheme=effectiveUiComponents({...project.ui,activeInstanceId:instanceId}).map(component=>({component,instanceId,customPageId:undefined as string|undefined}));
  const custom=project.ui.customPages.filter(p=>!target.customPageId||p.id===target.customPageId).flatMap(p=>p.components.map(component=>({component,instanceId:undefined as string|undefined,customPageId:p.id})));
  let candidates=(target.customPageId?custom:target.instanceId?scheme:[...scheme,...custom]).filter(c=>c.component.id===target.componentId);
  if(!candidates.length&&!target.instanceId&&!target.customPageId)candidates=(project.ui.instances??[]).flatMap(i=>i.components.filter(c=>c.id===target.componentId).map(component=>({component,instanceId:i.id,customPageId:undefined})));
  if(candidates.length!==1)throw new Error('找不到唯一界面组件，请重新读取当前工程。');
  const {component,instanceId:resolvedInstanceId,customPageId}=candidates[0];
  return {kind:'ui' as const,advanced:target.advanced??false,target:{page:component.page,componentId:component.id,instanceId:resolvedInstanceId,customPageId},label:component.name||component.text||'界面组件'};
 }
 if(target.kind==='asset'){const asset=project.assets.find(a=>a.id===target.assetId);if(!asset)throw new Error('素材已不存在，请重新读取当前工程。');return {kind:'asset' as const,id:asset.id,label:[...folderTrail(project,project.contentBrowser?.assignments['asset:'+asset.id]).map(folder=>folder.name),asset.name].join(' / ')};}
 if(target.kind==='parameterSet'){const set=parameterSets(project).find(s=>s.id===target.setId);if(!set)throw new Error('参数集已不存在，请重新读取当前工程。');return {kind:'parameterSet' as const,id:set.id,label:set.name};}
 if(target.kind==='parameter'){
  const variable=project.variables.find(v=>v.id===target.variableId);if(!variable)throw new Error('参数已不存在，请重新读取当前工程。');
  return {kind:'parameter' as const,id:variable.id,label:variable.name};
 }
 const character=project.characters.find(c=>c.id===target.characterId);if(!character)throw new Error('角色已不存在，请重新读取当前工程。');
 return {kind:'character' as const,id:character.id,label:character.name};
}
export function aiEditorTargetLabel(project:Project,target:AiEditorTarget){try{return (target.kind==='blueprintSelection'?'选择：':target.kind==='ui'&&target.advanced?'高级UI：':'定位：')+resolveAiEditorTarget(project,target).label;}catch{return '定位：目标已不存在';}}
