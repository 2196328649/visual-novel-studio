import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema } from '../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintNodeValuePins, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { createUiEventGraph, ensureUiClickEvent, uiPageGraphs, uiPageComponents, uiClickHandlers, createUiGraphVariable } from '../src/core/ui-logic';
import { previewUiLogic } from '../src/core/ui-logic-preview';
import { compileProject } from '../src/runtime/compiler';

function fixture(){const p=createProject();p.ui.components.push({id:'switch',kind:'button',page:'main',text:'隐藏文字',x:.1,y:.3,width:.2,height:.1},{id:'text',kind:'text',page:'main',text:'原始文字',x:.1,y:.1,width:.3,height:.1});return p;}
test('page event graph runs on show and click, survives reload, and excludes unrelated UI graphs',()=>{
 const p=fixture(),g=createUiEventGraph(p,'ui:main','标题'),other=createUiEventGraph(p,'ui:preferences','设置');p.blueprints.push(createBlueprintGraph('ui','未绑定的通用图'));
 const initial=blueprintNodeDefaults('setUiProperty');initial.properties={componentId:'text',property:'text',value:'页面已显示'};
 const click=ensureUiClickEvent(p,g,'switch','ui:main');assert.equal(ensureUiClickEvent(p,g,'switch','ui:main').id,click.id);
 const hide=blueprintNodeDefaults('setUiProperty');hide.properties={componentId:'text',property:'visible',value:false};g.nodes.push(initial,hide);synchronizeBlueprintSignatures(p);
 assert.equal(connectBlueprintPins(g,g.nodes[0].id,'exec',initial.id,'exec_in'),undefined);assert.equal(connectBlueprintPins(g,click.id,'exec',hide.id,'exec_in'),undefined);
 const loaded=projectSchema.parse(JSON.parse(JSON.stringify(p)));assert.deepEqual(uiPageGraphs(loaded,'ui:main').map(g=>g.id),[g.id]);assert.deepEqual(uiPageGraphs(loaded,'ui:preferences').map(g=>g.id),[other.id]);
 const components=uiPageComponents(loaded,'ui:main'),shown=previewUiLogic(loaded,components,'ui:main',{},[],{timed:true});assert.equal(shown.components.find(c=>c.component.id==='text')?.component.text,'页面已显示');
 const clicked=previewUiLogic(loaded,components,'ui:main',{},[{kind:'click',componentId:'switch'}],{timed:true});assert.equal(clicked.components.find(c=>c.component.id==='text')?.visible,false);
 const output=compileProject(loaded);assert.deepEqual(output.diagnostics.filter(d=>d.severity==='error'),[]);const screens=output.files['game/screens.rpy'];const main=screens.slice(screens.indexOf('screen vn_components_main('),screens.indexOf('screen vn_components_say('));assert.ok(main.includes('on "show" action Function(vn_run_ui_show, "'+g.id+'")'));assert.ok(!main.includes(other.id));assert.ok(main.includes('Function(vn_run_blueprint, "'+g.id+'", "'+click.id+'")'));
});
test('scheme events respect inheritance, including buttons inherited with the same component id',()=>{
 const p=fixture();p.ui.instances=[{id:'a',name:'A',components:[]},{id:'b',name:'B',components:[]},{id:'child',name:'继承A',baseUiId:'a',components:[]}];p.ui.activeInstanceId='a';const g=createUiEventGraph(p,'ui:main','标题'),click=ensureUiClickEvent(p,g,'switch','ui:main');const hide=blueprintNodeDefaults('setUiProperty');hide.properties={componentId:'text',property:'visible',value:false};g.nodes.push(hide);connectBlueprintPins(g,click.id,'exec',hide.id,'exec_in');
 for(const [scheme,active] of [['a',true],['b',false],['child',true]] as const){p.ui.activeInstanceId=scheme;assert.equal(uiPageGraphs(p,'ui:main').some(x=>x.id===g.id),active);const result=previewUiLogic(p,uiPageComponents(p,'ui:main'),'ui:main',{},[{kind:'click',componentId:'switch'}]);assert.equal(result.components.find(c=>c.component.id==='text')?.visible,!active);const screens=compileProject(p).files['game/screens.rpy'];assert.equal(screens.includes('Function(vn_run_blueprint, "'+g.id+'", "'+click.id+'")'),active);}
});
test('custom page show events work without a component and legacy click graphs retain their page association',()=>{
 const p=fixture();p.ui.customPages.push({id:'empty',name:'空页面',modal:false,components:[]});const g=createUiEventGraph(p,'empty','空页面');const legacy=createBlueprintGraph('ui','旧点击');const click=blueprintNodeDefaults('eventClick');click.properties.componentId='switch';legacy.nodes.push(click);p.blueprints.push(legacy);assert.ok(uiPageGraphs(p,'ui:main').includes(legacy));assert.ok(!uiPageGraphs(p,'ui:preferences').includes(legacy));assert.ok(compileProject(p).files['game/screens.rpy'].includes('on "show" action Function(vn_run_ui_show, "'+g.id+'")'));assert.throws(()=>ensureUiClickEvent(p,g,'switch','empty'));
});

test('removing the page-show entry cannot turn a click event into a show event',()=>{
 const p=fixture(),g=createUiEventGraph(p,'ui:main','标题'),click=ensureUiClickEvent(p,g,'switch','ui:main');g.nodes=g.nodes.filter(n=>n.type!=='event');const hide=blueprintNodeDefaults('setUiProperty');hide.properties={componentId:'text',property:'visible',value:false};g.nodes.push(hide);connectBlueprintPins(g,click.id,'exec',hide.id,'exec_in');
 assert.equal(previewUiLogic(p,uiPageComponents(p,'ui:main'),'ui:main').components.find(c=>c.component.id==='text')?.visible,true);assert.ok(!compileProject(p).files['game/screens.rpy'].includes('on "show" action Function(vn_run_ui_show, "'+g.id+'")'));
});

test('existing button callbacks stay visible in execution order and inactive click roots are excluded',()=>{
 const p=fixture(),component=p.ui.components.find(c=>c.id==='switch')!;
 const root=createUiEventGraph(p,'ui:main','点击'),event=ensureUiClickEvent(p,root,component.id,'ui:main');
 const inactive=blueprintNodeDefaults('eventClick');inactive.properties={componentId:component.id,uiInstanceId:'missing'};root.nodes.unshift(inactive);
 const callback=createUiEventGraph(p,'ui:preferences','共享回调');component.events={onClick:callback.id};component.action='blueprint';component.blueprintId=callback.id;
 assert.deepEqual(uiClickHandlers(p,'ui:main',component.id),[{graphId:root.id,nodeId:event.id,source:'event'},{graphId:callback.id,source:'callback'},{graphId:callback.id,source:'action'}]);
 assert.ok(uiPageGraphs(p,'ui:main').includes(callback));assert.deepEqual(uiClickHandlers(p,'ui:preferences',component.id),[]);
 assert.equal(ensureUiClickEvent(p,root,component.id,'ui:main').id,event.id);
 component.action='preferences';delete component.events.onClick;assert.ok(!uiPageGraphs(p,'ui:main').includes(callback),'stale blueprintId on a native action is not an active binding');
 component.events.onClick='missing_graph';assert.equal(uiClickHandlers(p,'ui:main',component.id).at(-1)?.graphId,'missing_graph','missing bindings remain visible for repair');
});
test('graph variables preserve type, parameter-set persistence and reject invalid input without partial changes',()=>{
 const p=fixture();for(const [type,initial,name,set] of [['boolean',true,'显示说明','parameters_story'],['number',3,'次数','parameters_game'],['string','文本','标题','parameters_story']] as const){
 const variable=createUiGraphVariable(p,name,type,initial,set);assert.equal(variable.type,type);assert.equal(variable.initial,initial);assert.equal(variable.parameterSetId,set);assert.equal(variable.persistent,set==='parameters_game');
 }
 assert.doesNotThrow(()=>projectSchema.parse(p));const before=structuredClone(p);
 for(const [name,type,initial,set] of [['显示说明','boolean',false,'parameters_story'],['  ','boolean',false,'parameters_story'],['错误','number',false,'parameters_story'],['错误','number',Infinity,'parameters_story'],['错误','number',1,'missing']] as const)assert.throws(()=>createUiGraphVariable(p,name,type,initial,set));
 assert.deepEqual(p,before);
});

test('new variable node pins reject incompatible wires immediately and retarget with the selected variable',()=>{
 const p=fixture(),g=createUiEventGraph(p,'ui:main','标题'),boolean=createUiGraphVariable(p,'显示','boolean',true,'parameters_story'),text=createUiGraphVariable(p,'文字','string','内容','parameters_story');
 const read=blueprintNodeDefaults('getVariable'),write=blueprintNodeDefaults('setVariable');read.properties.variableId=text.id;write.properties.variableId=boolean.id;g.nodes.push(read,write);
 for(const n of [read,write])synchronizeBlueprintNodeValuePins(p,g,n);
 assert.equal(read.pins.find(p=>p.id==='value')?.dataType,'string');assert.equal(write.pins.find(p=>p.id==='value')?.dataType,'boolean');assert.match(connectBlueprintPins(g,read.id,'value',write.id,'value')??'',/无法连接/);assert.equal(g.links.length,0);
 read.properties.variableId=boolean.id;synchronizeBlueprintNodeValuePins(p,g,read);assert.equal(connectBlueprintPins(g,read.id,'value',write.id,'value'),undefined);assert.equal(g.links.length,1);
});
