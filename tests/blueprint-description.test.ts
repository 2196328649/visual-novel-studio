import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/core/model';
import { blueprintNodeDefaults, createBlueprintGraph, connectBlueprintPins, blueprintNodeSummary, blueprintInputSource, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { BlueprintViewCache } from '../src/renderer/blueprint-view';

function fixture() {
 const project=createProject(),graph=createBlueprintGraph('ui','可读性');project.blueprints.push(graph);
 project.ui.components.push({id:'caption',name:'说明文字',text:'说明',kind:'text',page:'main',x:.1,y:.1,width:.3,height:.1});
 project.variables.push({id:'value_a',name:'展开位置',type:'number',initial:.8,persistent:false},{id:'value_b',name:'收回位置',type:'number',initial:.1,persistent:false});
 const read=blueprintNodeDefaults('getVariable');read.properties.variableId='value_a';
 const write=blueprintNodeDefaults('setUiProperty');write.properties={componentId:'caption',property:'x',value:.5};graph.nodes.push(read,write);synchronizeBlueprintSignatures(project);
 return {project,graph,read,write};
}
test('control summaries explain the authored target, property and value without changing project data',()=>{
 const {project,graph,write}=fixture(),before=JSON.stringify(project);
 assert.equal(blueprintNodeSummary(project,graph,write),'说明文字 · 横向位置（画面比例） = 0.5');assert.equal(JSON.stringify(project),before);
 write.properties.property='visible';write.properties.value=false;assert.equal(blueprintNodeSummary(project,graph,write),'说明文字 · 显示 = 否');
 write.properties.property='text';write.properties.value='';assert.equal(blueprintNodeSummary(project,graph,write),'说明文字 · 文字 = 空文字');
 write.properties.value='新的说明';assert.ok(blueprintNodeSummary(project,graph,write).includes('「新的说明」'));
});
test('connected values describe their actual source and never display an inactive fallback',()=>{
 const {project,graph,read,write}=fixture();connectBlueprintPins(graph,read.id,'value',write.id,'value');
 assert.deepEqual(blueprintInputSource(project,graph,write.id,'value'),{nodeId:read.id,label:'变量 · 展开位置'});
 assert.equal(blueprintNodeSummary(project,graph,write),'说明文字 · 横向位置（画面比例） = 变量 · 展开位置');
 read.properties.variableId='value_b';assert.equal(blueprintInputSource(project,graph,write.id,'value')!.label,'变量 · 收回位置');
 graph.nodes=graph.nodes.filter(n=>n.id!==read.id);assert.equal(blueprintInputSource(project,graph,write.id,'value')!.label,'缺失节点');assert.ok(!blueprintNodeSummary(project,graph,write).includes('0.5'));
 graph.links=[];assert.ok(blueprintNodeSummary(project,graph,write).endsWith('0.5'));
});
test('event outputs and component-valued pins distinguish sources, including broken output links',()=>{
 const {project,graph,write}=fixture();const event=blueprintNodeDefaults('eventValueChanged');event.name='滑块 · 值改变时';graph.nodes.push(event);connectBlueprintPins(graph,event.id,'previous',write.id,'value');
 assert.equal(blueprintInputSource(project,graph,write.id,'value')!.label,'滑块 · 值改变时 · 旧值');
 const constant=blueprintNodeDefaults('literal');constant.pins[0].dataType='component';constant.properties.value='caption';graph.nodes.push(constant);connectBlueprintPins(graph,constant.id,'value',write.id,'componentId');
 assert.ok(blueprintNodeSummary(project,graph,write).startsWith('常量 · 说明文字'));
 event.pins=event.pins.filter(p=>p.id!=='previous');assert.ok(blueprintInputSource(project,graph,write.id,'value')!.label.includes('缺失输出'));
});
test('upstream node edits invalidate connected source labels while unrelated nodes retain their views',()=>{
 const {project,graph,read,write}=fixture();connectBlueprintPins(graph,read.id,'value',write.id,'value');const cache=new BlueprintViewCache(),edit=()=>{},toggle=()=>{},collapsed=new Set<string>();
 const view=(p:typeof project)=>cache.update(p,p.blueprints[0],[],edit,collapsed,toggle);const first=view(project),changed=structuredClone(project);
 changed.blueprints[0].nodes.find(n=>n.id===read.id)!.properties.variableId='value_b';const second=view(changed);
 assert.equal(second[0].data,first[0].data);assert.notEqual(second.find(n=>n.node.id===write.id)!.data,first.find(n=>n.node.id===write.id)!.data);assert.equal(second.find(n=>n.node.id===write.id)!.data.inputSources.get('value'),'变量 · 收回位置');
 const moved=structuredClone(changed);moved.blueprints[0].nodes.find(n=>n.id===read.id)!.x+=50;assert.ok(view(moved).every((n,i)=>n.data===second[i].data));
});
