import assert from 'node:assert/strict';
import { createProject, type BlueprintNode, type UiComponent, type VariableValue } from '../../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, synchronizeBlueprintSignatures } from '../../src/core/blueprint';
import { createUiEventGraph, ensureUiValueChangedEvent } from '../../src/core/ui-logic';
import { uiControlValueType } from '../../src/core/ui-control-events';

export function controlEventFixture(){
 const project=createProject('控件值改变事件验收');project.ui.pages={...project.ui.pages,preferences:{layout:'custom'}};
 const variables=[{id:'level',type:'number' as const,initial:10,setting:{min:0,max:100,step:1}},{id:'toggle',type:'boolean' as const,initial:false},{id:'mode',type:'string' as const,initial:'普通',setting:{options:['普通','困难']}},{id:'name',type:'string' as const,initial:'初始'}];
 project.variables.push(...variables.map(v=>({...v,name:v.id,persistent:false})));
 const definitions:Partial<UiComponent>[]=[{id:'level_control',text:'等级滑块',parameterId:'level'},{id:'toggle_control',text:'选项开关',parameterId:'toggle'},{id:'mode_control',text:'模式选项',parameterId:'mode'},{id:'name_control',text:'输入名称',parameterId:'name'},{id:'volume_control',text:'音乐音量',preference:'musicVolume'},{id:'voice_control',text:'语音方式',kind:'preferenceChoice',preference:'voiceSustain'}];
 const controls=definitions.map((c,i)=>({kind:'preference',page:'preferences',x:.03+(i%2)*.5,y:.04+Math.floor(i/2)*.29,width:.42,height:.12,...c} as UiComponent));
 project.ui.components.push(...controls,...controls.map(c=>({id:c.id+'_text',kind:'text' as const,page:'preferences' as const,text:'尚未改变',x:c.x,y:c.y+.14,width:c.width,height:.08})));
 const graph=createUiEventGraph(project,'ui:preferences','控件事件');
 const node=(type:BlueprintNode['type'],properties:BlueprintNode['properties']={})=>{const n=blueprintNodeDefaults(type);Object.assign(n.properties,properties);graph.nodes.push(n);return n;};
 const link=(from:BlueprintNode,out:string,to:BlueprintNode,input:string)=>assert.equal(connectBlueprintPins(graph,from.id,out,to.id,input),undefined);
 const entries=new Map<string,BlueprintNode>(),endings=new Map<string,BlueprintNode>();
 for(const control of controls){
  const type=uiControlValueType(project,control)!,initial:VariableValue=type==='number'?0:type==='boolean'?false:'';
  for(const suffix of ['value','previous','count'])project.variables.push({id:control.id+'_'+suffix,name:control.id+'_'+suffix,type:suffix==='count'?'number':type,initial:suffix==='count'?0:initial,persistent:false});
  const event=ensureUiValueChangedEvent(project,graph,control.id,'ui:preferences');entries.set(control.id,event);
  const set=node('setVariable',{variableId:control.id+'_value',value:initial}),old=node('setVariable',{variableId:control.id+'_previous',value:initial}),read=node('getVariable',{variableId:control.id+'_count'}),add=node('math',{operation:'add',b:1}),count=node('setVariable',{variableId:control.id+'_count',value:0}),format=node('formatText',{format:'新值：{value}'}),text=node('setUiProperty',{componentId:control.id+'_text',property:'text',value:''});
  synchronizeBlueprintSignatures(project);link(event,'exec',set,'exec_in');link(event,'value',set,'value');link(set,'exec_out',old,'exec_in');link(event,'previous',old,'value');link(old,'exec_out',count,'exec_in');link(read,'value',add,'a');link(add,'result',count,'value');link(count,'exec_out',text,'exec_in');link(event,'value',format,'value');link(format,'text',text,'value');endings.set(control.id,text);
 }
 return {project,graph,controls,node,link,entries,endings};
}
