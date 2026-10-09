import { projectGraphs, withProjectGraphs } from './project-resources';
import type { BlueprintGraph, BlueprintNode, Project, VariableValue, Diagnostic } from './model';
import { blueprintInputValue, blueprintNodeDefaults, createBlueprintGraph, callablePins } from './blueprint';
import { savedBlueprintAction, rawSavedBlueprintAction } from './blueprint-authoring';
import { renewVisualIdentities } from './visual-selection';
import { visualInputFields } from './visual-object';
import { canLaunchTimeline } from './timeline-launch';
import { timelineLayerPlans } from './timeline-editing';

type Source={node:string;pin:string};
/** Build a private, linear playback graph. Authored reusable components stay intact. */
export function interleaveTimeline(project:Project,root:BlueprintGraph,helpers:BlueprintGraph[]=[],onUnsupported?:(message:string,nodeId?:string)=>void):BlueprintGraph|undefined {
 if(!root.timeline?.tailNodeId||!root.nodes.some(node=>node.type==='callFunction'&&node.properties.wait===false&&!canLaunchTimeline(project,projectGraphs(project).find(g=>g.id===node.properties.graphId)??root)))return;
 const result=structuredClone(root);result.nodes=[];result.links=[];
 const clips:{node:BlueprintNode;at:number;order:number}[]=[];
 let changed=false,serial=0;let location={graph:root.name,node:root.name,nodeId:root.nodes.find(n=>n.type==='callFunction')?.id};
 const ids=new Set<string>();
 const stable=(path:string)=>{let a=2166136261,b=5381;for(const c of path){a=Math.imul(a^c.charCodeAt(0),16777619);b=Math.imul(b,33)^c.charCodeAt(0);}return 'tl_'+(a>>>0).toString(16)+'_'+(b>>>0).toString(16);};
 const add=(node:BlueprintNode)=>{if(ids.has(node.id))throw Error('duplicate');ids.add(node.id);result.nodes.push(node);if(result.nodes.length>4096)throw Error('limit');return node;};
 const link=(from:Source,to:string,pin:string)=>result.links.push({id:stable(root.id+'/link/'+serial++),fromNodeId:from.node,fromPinId:from.pin,toNodeId:to,toPinId:pin});
 const walk=(graph:BlueprintGraph,path:string,offset:number,args:Map<string,Source>|undefined,ancestors:Set<string>,layerBase=0)=>{
  if(!graph.timeline?.tailNodeId||ancestors.has(graph.id)||ancestors.size>=16||graph.exposedOutputs.length)throw Error('unsupported');
  location={graph:graph.name,node:graph.name,nodeId:graph.nodes.find(n=>n.type==='event')?.id};
  const active=new Set(ancestors).add(graph.id),mapped=new Map<string,Source>();
  for(const node of graph.nodes){
   if(args&&node.type==='getInput'){const source=args.get(String(node.properties.inputId));if(!source)throw Error('input');mapped.set(node.id,source);continue;}
   mapped.set(node.id,{node:path===root.id?node.id:stable(path+'/'+node.id),pin:'value'});
  }
  const source=(nodeId:string,pin:string):Source=>{const mappedSource=mapped.get(nodeId);if(!mappedSource)throw Error('missing');return args&&graph.nodes.find(node=>node.id===nodeId)?.type==='getInput'?mappedSource:{node:mappedSource.node,pin};};
  const data=(node:BlueprintNode,pins?:Map<string,string>)=>{for(const input of graph.links.filter(l=>l.toNodeId===node.id&&node.pins.some(p=>p.id===l.toPinId&&p.dataType!=='exec')))link(source(input.fromNodeId,input.fromPinId),mapped.get(node.id)!.node,pins?.get(input.toPinId)??input.toPinId);};
  for(const node of graph.nodes.filter(n=>!n.pins.some(p=>p.dataType==='exec')&&!(args&&n.type==='getInput'))){const copy=structuredClone(node);copy.id=mapped.get(node.id)!.node;add(copy);data(node);}
  let at=offset,node=graph.nodes.find(n=>n.type==='event');const seen=new Set<string>();
  while(node){
   location={graph:graph.name,node:node.name,nodeId:node.id};
   if(seen.has(node.id))throw Error('cycle');seen.add(node.id);
   const next=graph.links.filter(l=>l.fromNodeId===node!.id&&node!.pins.some(p=>p.id===l.fromPinId&&p.dataType==='exec'));
   if(node.id===graph.timeline.tailNodeId){if(node.type!=='delay'||next.length)throw Error('tail');break;}
   if(next.length!==1)throw Error('chain');
   if(node.type==='delay'){
    if(graph.links.some(l=>l.toNodeId===node!.id&&l.toPinId==='seconds'))throw Error('dynamic delay');
    const seconds=blueprintInputValue(node,'seconds')??1;if(typeof seconds!=='number'||!Number.isFinite(seconds)||seconds<0)throw Error('delay');at+=seconds;
   }else if(node.type==='callFunction'){
    if(node.properties.wait!==false||graph.links.some(l=>l.fromNodeId===node!.id&&node!.pins.some(p=>p.id===l.fromPinId&&p.dataType!=='exec')))throw Error('blocking call');
    const child=projectGraphs(project).find(g=>g.id===node!.properties.graphId);if(!child)throw Error('missing child');
    if(!canLaunchTimeline(project,child))changed=true;
    const childArgs=new Map<string,Source>();
    child.exposedInputs.forEach((pin,index)=>{
     const input=graph.links.find(l=>l.toNodeId===node!.id&&l.toPinId==='arg_'+pin.id)??graph.links.find(l=>l.toNodeId===node!.id&&l.toPinId==='arg_'+index);
     if(input){
      const value=source(input.fromNodeId,input.fromPinId);
      childArgs.set(pin.id,value);
     }else{
      const literal=blueprintNodeDefaults('literal');literal.id=stable(path+'/'+node!.id+'/'+pin.id+'/value');const value:VariableValue|undefined=node!.properties['arg_'+pin.id]??node!.properties['arg_'+index]??pin.defaultValue;literal.properties.value=value??'';add(literal);childArgs.set(pin.id,{node:literal.id,pin:'value'});
     }
    });
    if(childArgs.size){
     const helper=createBlueprintGraph('function','时间轴参数快照');helper.id=stable(path+'/'+node.id+'/capture_graph');helper.nodes[0].id=stable(helper.id+'/event');
     helper.exposedInputs=structuredClone(child.exposedInputs);helper.exposedOutputs=helper.exposedInputs.map(pin=>({...pin,direction:'output' as const}));
     let previous=helper.nodes[0];
     for(const pin of helper.exposedInputs){
      const read=blueprintNodeDefaults('getInput');read.id=stable(helper.id+'/'+pin.id+'/read');read.properties.inputId=pin.id;
      const write=blueprintNodeDefaults('setOutput');write.id=stable(helper.id+'/'+pin.id+'/write');write.properties.outputId=pin.id;helper.nodes.push(read,write);
      helper.links.push({id:stable(write.id+'/exec'),fromNodeId:previous.id,fromPinId:previous.type==='event'?'exec':'exec_out',toNodeId:write.id,toPinId:'exec_in'},{id:stable(write.id+'/data'),fromNodeId:read.id,fromPinId:'value',toNodeId:write.id,toPinId:'value'});previous=write;
     }
     const capture=blueprintNodeDefaults('callFunction');capture.id=stable(path+'/'+node.id+'/capture');capture.properties.graphId=helper.id;capture.pins=callablePins(helper);add(capture);clips.push({node:capture,at,order:clips.length});
     for(const [id,value] of childArgs){link(value,capture.id,'arg_'+id);childArgs.set(id,{node:capture.id,pin:'out_'+id});}helpers.push(helper);
    }
    walk(child,path+'/'+node.id,at,childArgs,active,layerBase+Number(node.properties.__timelineLayerOffset??0));
   }else if(node.type!=='event'){
    const saved=node.type==='savedAction'?savedBlueprintAction(node):undefined;
    if(node.type==='savedAction'? !saved||!['audioClip','visual','show','animate','camera'].includes(saved.kind)||!('wait' in saved)||saved.wait!==false : !['startDialogue','showBackground','showCharacter','hideCharacter','showChapter','camera','shake','playMusic','playSound','stopMusic'].includes(node.type)||!['startDialogue','playMusic','playSound','stopMusic'].includes(node.type)&&node.properties.wait!==false)throw Error('unsupported action');
    if(graph.links.some(l=>l.toNodeId===node!.id&&l.toPinId==='wait'))throw Error('dynamic wait');
    const copy=structuredClone(node);copy.id=mapped.get(node.id)!.node;copy.properties.__timelineGraph=graph.id;copy.properties.__timelineNode=node.id;
    let scopedPins: Map<string, string> | undefined;
    if (path !== root.id && copy.type === 'savedAction') {
     const action = rawSavedBlueprintAction(copy);
     if (action?.kind === 'visual') {
      const before = visualInputFields(action); renewVisualIdentities(action, id => stable(path + '/object/' + id));
      const fields = new Map(visualInputFields(action).map(field => [JSON.stringify(field.path), 'object_' + field.key]));
      scopedPins = new Map(before.map(field => ['object_' + field.key, fields.get(JSON.stringify(field.path))!]));
      copy.pins.forEach(pin => { pin.id = scopedPins!.get(pin.id) ?? pin.id; });
      const values = Object.entries(copy.properties).filter(([key]) => key.startsWith('object_')); values.forEach(([key]) => { delete copy.properties[key]; });
      for (const [key, value] of values) copy.properties[scopedPins.get(key) ?? key] = value;
      copy.properties.action = JSON.stringify(action);
     }
     else if (action?.kind === 'audioClip') copy.properties.action = JSON.stringify({ ...action, instanceId: stable(path + '/audio/' + action.instanceId) });
    }
    if (typeof copy.properties.__timelineLayerOffset === 'number') copy.properties.__timelineLayerOffset += layerBase;
    add(copy);data(node,scopedPins);clips.push({node:copy,at,order:clips.length});
   }
   node=graph.nodes.find(n=>n.id===next[0].toNodeId);
  }
  if(!seen.has(graph.timeline.tailNodeId)||graph.nodes.some(n=>n.pins.some(p=>p.dataType==='exec')&&!seen.has(n.id)))throw Error('disconnected');
 };
 try{
  walk(root,root.id,0,undefined,new Set());if(!changed)return;
  const entry=structuredClone(root.nodes.find(n=>n.type==='event')!);add(entry);let previous=entry,at=0;
  const append=(node:BlueprintNode)=>{link({node:previous.id,pin:previous.type==='event'?'exec':'exec_out'},node.id,'exec_in');previous=node;};
  clips.sort((a,b)=>a.at-b.at||a.order-b.order);
  for(const clip of clips){if(clip.at>at){const delay=blueprintNodeDefaults('delay');delay.id=stable(root.id+'/gap/'+clip.node.id);delay.properties.seconds=clip.at-at;add(delay);append(delay);at=clip.at;}append(clip.node);}
  const tail=structuredClone(root.nodes.find(n=>n.id===root.timeline!.tailNodeId)!);tail.properties.seconds=0;add(tail);append(tail);
  result.timeline={...root.timeline,clips:clips.map(c=>({nodeId:c.node.id,trackId:root.timeline!.tracks[0]?.id??'track_performance'}))};return result;
 }catch(error){
  const reasons:Record<string,string>={unsupported:'包含递归、超过16层嵌套、返回值或不是标准时间轴',limit:'展开后超过4096个节点',duplicate:'展开后的节点标识冲突',input:'子时间轴引用了未定义输入',missing:'数据连接的来源节点不存在',cycle:'执行路径存在循环',tail:'结束等待节点或后续连线不完整',chain:'执行路径存在分支或断开的节点','dynamic delay':'内部等待时长由数据连线控制',delay:'内部等待时长无效','blocking call':'包含等待完成的子调用或读取子调用返回值','missing child':'引用的子时间轴不存在','unsupported action':'包含交互、分支或需要阻塞等待的动作','dynamic wait':'动作等待方式由数据连线控制',disconnected:'执行路径或结束等待节点未完整连接'};
  const reason=reasons[error instanceof Error?error.message:'']??'无法建立固定的交错播放时序';
  onUnsupported?.('时间轴“'+root.name+'”不能交错播放：“'+location.graph+' / '+location.node+'”'+reason+'。请将该调用设为等待完成，或调整为固定间隔的线性时间轴。',location.nodeId);
  return undefined;
 }

}
export function canInterleaveTimeline(project:Project,graph:BlueprintGraph):boolean {
 // A nonblocking wrapper tests the same flattening contract used for playback.
 const call=blueprintNodeDefaults('callFunction');call.id='interleave_probe_call';call.properties={graphId:graph.id,wait:false};
 const event=blueprintNodeDefaults('event');event.id='interleave_probe_event';const tail=blueprintNodeDefaults('delay');tail.id='interleave_probe_tail';
 const probe:BlueprintGraph={...graph,id:'interleave_probe',nodes:[event,call,tail],links:[{id:'interleave_probe_a',fromNodeId:event.id,fromPinId:'exec',toNodeId:call.id,toPinId:'exec_in'},{id:'interleave_probe_b',fromNodeId:call.id,fromPinId:'exec_out',toNodeId:tail.id,toPinId:'exec_in'}],exposedInputs:[],exposedOutputs:[],timeline:{tracks:[],clips:[],tailNodeId:tail.id}};
 return canLaunchTimeline(project,graph)||!!interleaveTimeline(project,probe);
}
export function interleaveProjectTimelines(project:Project,onUnsupported?:(graph:BlueprintGraph,message:string,nodeId?:string)=>void):Project {
 // Apply track order to a private playback copy, keeping authored fields and links intact.
 const layerPlans = timelineLayerPlans(project);
 project = withProjectGraphs({ ...project }, projectGraphs(project).map(graph => {
  if (!graph.timeline) return graph;
  const nodes = graph.nodes.map(node => {
   const offset = layerPlans.get(graph.id)?.offsets.get(node.id);
   return offset === undefined ? node : { ...node, properties: { ...node.properties, __timelineLayerOffset: offset } };
  });
  return { ...graph, nodes };
 }));
 const helpers:BlueprintGraph[]=[];const blueprints=projectGraphs(project).map(graph=>{const local:BlueprintGraph[]=[];const result=interleaveTimeline(project,graph,local,(message,nodeId)=>onUnsupported?.(graph,message,nodeId));if(result)helpers.push(...local);return result??graph;});
 return withProjectGraphs({ ...project }, [...blueprints,...helpers]);
}

export function timelineInterleaveDiagnostics(project:Project):Diagnostic[] {
 const diagnostics:Diagnostic[]=[];
 for(const graph of projectGraphs(project))interleaveTimeline(project,graph,[],(message,nodeId)=>diagnostics.push({severity:'error',message,nodeId}));
 return diagnostics;
}
