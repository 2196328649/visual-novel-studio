import { controlEventFixture } from './ui-control-event-fixture';
import { ensureUiTextCommittedEvent } from '../../src/core/ui-logic';
import { synchronizeBlueprintSignatures } from '../../src/core/blueprint';

export function textCommitFixture(){
 const f=controlEventFixture(),{project,graph,node,link}=f;
 project.ui.components.push({id:'other_name',kind:'preference',page:'preferences',text:'另一个输入框',parameterId:'name',x:.53,y:.84,width:.42,height:.12});
 project.ui.customPages.push({id:'commit_modal',name:'提交结果',modal:true,components:[{id:'commit_close',kind:'button',page:'custom',text:'关闭结果',action:'return',x:.53,y:.36,width:.42,height:.12}]});
 project.variables.push(...[
  {id:'committed',type:'string' as const,initial:''},
  {id:'commit_method',type:'string' as const,initial:''},
  {id:'commit_count',type:'number' as const,initial:0},
  {id:'open_on_commit',type:'boolean' as const,initial:false},
 ].map(v=>({...v,name:v.id,persistent:false})));
 const event=ensureUiTextCommittedEvent(project,graph,'name_control','ui:preferences');
 const value=node('setVariable',{variableId:'committed',value:''}),method=node('setVariable',{variableId:'commit_method',value:''}),read=node('getVariable',{variableId:'commit_count'}),add=node('math',{operation:'add',b:1}),count=node('setVariable',{variableId:'commit_count',value:0});
 const caption=node('setUiProperty',{componentId:'name_control_text',property:'text',value:''}),condition=node('getVariable',{variableId:'open_on_commit'}),branch=node('branch'),open=node('showUiPage',{pageId:'commit_modal',wait:false});
 synchronizeBlueprintSignatures(project);
 link(event,'exec',value,'exec_in');link(event,'value',value,'value');link(value,'exec_out',method,'exec_in');link(event,'method',method,'value');link(method,'exec_out',count,'exec_in');link(read,'value',add,'a');link(add,'result',count,'value');link(count,'exec_out',caption,'exec_in');link(event,'value',caption,'value');link(caption,'exec_out',branch,'exec_in');link(condition,'value',branch,'condition');link(branch,'true',open,'exec_in');
 return {...f,commit:event};
}
