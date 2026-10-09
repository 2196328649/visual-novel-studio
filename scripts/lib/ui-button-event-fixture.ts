import assert from 'node:assert/strict';
import { createProject, type BlueprintNode } from '../../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, synchronizeBlueprintSignatures } from '../../src/core/blueprint';
import { createUiEventGraph, ensureUiButtonEvent, ensureUiClickEvent } from '../../src/core/ui-logic';
import { uiButtonEvents, type UiButtonEvent } from '../../src/core/ui-button-events';

export function buttonEventFixture(){
 const project=createProject('按钮交互事件验收');project.ui.pages={...project.ui.pages,main:{layout:'custom'}};
 const buttons=['target','hide','disable','modal','release_modal','restore'];
 project.ui.components.push({id:'trace',kind:'text',page:'main',text:'',x:.1,y:.65,width:.8,height:.1},...buttons.map((id,index)=>({id,kind:'button' as const,page:'main' as const,name:id,text:id,x:.1+(index%3)*.3,y:index>=3?.4:.2,width:.25,height:.15})));
 project.ui.customPages.push({id:'button_overlay',name:'按钮覆盖页',modal:true,components:[{id:'overlay_close',kind:'button',page:'custom',text:'关闭覆盖页',action:'return',x:.4,y:.4,width:.2,height:.15}]});
 const graph=createUiEventGraph(project,'ui:main','按钮事件');
 const node=(type:BlueprintNode['type'],properties:BlueprintNode['properties']={})=>{const n=blueprintNodeDefaults(type);Object.assign(n.properties,properties);graph.nodes.push(n);return n;};
 const link=(from:BlueprintNode,output:string,to:BlueprintNode,input:string)=>assert.equal(connectBlueprintPins(graph,from.id,output,to.id,input),undefined);
 const endings=new Map<string,BlueprintNode>();
 for(const id of buttons)for(const trigger of [...Object.keys(uiButtonEvents),'click']){
  const event=trigger==='click'?ensureUiClickEvent(project,graph,id,'ui:main'):ensureUiButtonEvent(project,graph,id,'ui:main',trigger as UiButtonEvent);
  const read=node('getUiProperty',{componentId:'trace',property:'text'}),format=node('formatText',{format:'{value}'+({hover:'H',unhover:'U',press:'P',release:'R',click:'C'}[trigger])}),write=node('setUiProperty',{componentId:'trace',property:'text',value:''});
  synchronizeBlueprintSignatures(project);link(event,'exec',write,'exec_in');link(read,'value',format,'value');link(format,'text',write,'value');endings.set(id+':'+trigger,write);
 }
 for(const [id,property] of [['hide','visible'],['disable','enabled']]){const setter=node('setUiProperty',{componentId:id,property,value:false});link(endings.get(id+':press')!,'exec_out',setter,'exec_in');}
 const open=node('showUiPage',{pageId:'button_overlay',wait:false});link(endings.get('modal:press')!,'exec_out',open,'exec_in');
 const openOnRelease=node('showUiPage',{pageId:'button_overlay',wait:false});link(endings.get('release_modal:release')!,'exec_out',openOnRelease,'exec_in');
 const disable=node('setUiProperty',{componentId:'restore',property:'enabled',value:false}),enable=node('setUiProperty',{componentId:'restore',property:'enabled',value:true});link(endings.get('restore:press')!,'exec_out',disable,'exec_in');link(disable,'exec_out',enable,'exec_in');
 synchronizeBlueprintSignatures(project);
 return {project,graph,node,link,endings};
}
