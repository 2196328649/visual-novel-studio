import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/core/model';
import { createUiParameterBinding } from '../src/core/ui-logic';
import { previewUiLogic, uiPreviewKeys, uiPreviewKeyboardKey, uiPreviewTimerLimit } from '../src/core/ui-logic-preview';
import { blueprintNodeDefaults, createBlueprintGraph, connectBlueprintPins } from '../src/core/blueprint';

test('UI preview samples shared blueprint arithmetic, text and visibility without changing the authored project',()=>{
 const project=createProject();const component={id:'preview_title',kind:'text' as const,page:'main' as const,text:'原始标题',x:.1,y:.1,width:.5,height:.1};project.ui.components.push(component);
 project.variables.push({id:'shown',name:'显示',type:'boolean',initial:true,persistent:false},{id:'title',name:'标题',type:'string',initial:'默认标题',persistent:false},{id:'position',name:'位置',type:'number',initial:.1,persistent:false});
 createUiParameterBinding(project,component.id,'visible','shown','ui:main');createUiParameterBinding(project,component.id,'text','title','ui:main');
 const graph=createUiParameterBinding(project,component.id,'x','position','ui:main');
 const reader=graph.nodes.find(node=>node.type==='getVariable')!,timer=graph.nodes.find(node=>node.type==='eventTimer')!;
 const setter=graph.nodes.find(node=>graph.links.some(link=>link.fromNodeId===timer.id&&link.toNodeId===node.id))!;
 const math=blueprintNodeDefaults('math');math.properties={operation:'multiply',b:2};graph.nodes.push(math);graph.links=graph.links.filter(link=>!(link.toNodeId===setter.id&&link.toPinId==='value'));
 connectBlueprintPins(graph,reader.id,'value',math.id,'a');connectBlueprintPins(graph,math.id,'result',setter.id,'value');
 const before=structuredClone(project),sample=previewUiLogic(project,[component],'ui:main',{shown:false,title:'测试内容',position:.3});
 assert.equal(sample.incomplete,false);assert.equal(sample.components[0].visible,false);assert.equal(sample.components[0].component.text,'测试内容');assert.equal(sample.components[0].component.x,.6);assert.deepEqual(project,before);
 const reset=previewUiLogic(project,[component],'ui:main');assert.equal(reset.components[0].visible,true);assert.equal(reset.components[0].component.text,'默认标题');assert.equal(reset.components[0].component.x,.2);
 const delay=blueprintNodeDefaults('delay');graph.nodes.push(delay);connectBlueprintPins(graph,setter.id,'exec_out',delay.id,'exec_in');assert.equal(previewUiLogic(project,[component],'ui:main').incomplete,true);
});

test('UI click replay retains state, respects disabled buttons and refreshes parameter bindings without persistence',()=>{
 const project=createProject();const button={id:'increment',disabled:false,kind:'button' as const,page:'main' as const,text:'增加',x:.1,y:.1,width:.2,height:.1};project.ui.components.push(button);
 project.variables.push({id:'count',name:'次数',type:'number',initial:0,persistent:false});
 const {graph}=(()=>{const graph=createUiParameterBinding(project,button.id,'x','count','ui:main');return {graph};})();
 const event=blueprintNodeDefaults('eventClick');event.properties.componentId=button.id;
 const reader=blueprintNodeDefaults('getVariable');reader.properties.variableId='count';
 const add=blueprintNodeDefaults('math');add.properties={operation:'add',b:.1};
 const setter=blueprintNodeDefaults('setVariable');setter.properties.variableId='count';
 graph.nodes.push(event,reader,add,setter);
 connectBlueprintPins(graph,event.id,'exec',setter.id,'exec_in');connectBlueprintPins(graph,reader.id,'value',add.id,'a');connectBlueprintPins(graph,add.id,'result',setter.id,'value');
 const before=structuredClone(project),events=[{kind:'click' as const,componentId:button.id},{kind:'click' as const,componentId:button.id}];
 const sample=previewUiLogic(project,[button],'ui:main',{},events);assert.equal(sample.variables.count,.2);assert.equal(sample.components[0].component.x,.2);assert.equal(sample.incomplete,false);assert.deepEqual(project,before);
 assert.equal(previewUiLogic(project,[{...button,disabled:true}],'ui:main',{},events).variables.count,0);
 button.disabled=true;
 assert.equal(previewUiLogic(project,[button],'ui:main',{},events).variables.count,0);
});

test('UI preview formats values read from component properties through shared blueprint nodes',()=>{
 const project=createProject(),component={id:'read_title',kind:'text' as const,page:'main' as const,text:'占位',x:.25,y:.1,width:.5,height:.1};project.ui.components.push(component);
 project.variables.push({id:'caption',name:'文字',type:'string',initial:'初始',persistent:false});
 const graph=createUiParameterBinding(project,component.id,'text','caption','ui:main');
 const timer=graph.nodes.find(node=>node.type==='eventTimer')!,setter=graph.nodes.find(node=>graph.links.some(link=>link.fromNodeId===timer.id&&link.toNodeId===node.id))!;
 const read=blueprintNodeDefaults('getUiProperty');read.properties={componentId:component.id,property:'x'};read.pins.find(pin=>pin.id==='value')!.dataType='number';
 const format=blueprintNodeDefaults('formatText');format.properties.format='{value} / {value}';graph.nodes.push(read,format);
 graph.links=graph.links.filter(link=>!(link.toNodeId===setter.id&&link.toPinId==='value'));
 assert.equal(connectBlueprintPins(graph,read.id,'value',format.id,'value'),undefined);assert.equal(connectBlueprintPins(graph,format.id,'text',setter.id,'value'),undefined);
 const result=previewUiLogic(project,[component],'ui:main');assert.equal(result.incomplete,false);assert.equal(result.components[0].component.text,'0.25 / 0.25');
});


test('UI key preview dispatches matching page and scheme roots in order without changing project state',()=>{
 const project=createProject(),component={id:'key_text',kind:'text' as const,page:'main' as const,text:'原始',x:.1,y:.1,width:.5,height:.1};project.ui.components.push(component);
 project.variables.push({id:'caption',name:'标题',type:'string',initial:'原始',persistent:false});
 const graph=createUiParameterBinding(project,component.id,'text','caption','ui:main');
 for(const [pageId,scope,value,key] of [['ui:main','base','正确','K_e'],['ui:say','base','错误页面','K_e'],['ui:main','other','错误方案','K_e'],['ui:main','base','错误按键','K_a']]){
  const event=blueprintNodeDefaults('eventKey');event.properties={pageId,uiInstanceId:scope,key};
  const setter=blueprintNodeDefaults('setVariable');setter.properties={variableId:'caption',value};graph.nodes.push(event,setter);
  assert.equal(connectBlueprintPins(graph,event.id,'exec',setter.id,'exec_in'),undefined);
 }
 const before=structuredClone(project),sample=previewUiLogic(project,[component],'ui:main',{},[{kind:'key',key:'K_e'}]);
 assert.equal(sample.variables.caption,'正确');assert.equal(sample.components[0].component.text,'正确');assert.equal(sample.incomplete,false);assert.deepEqual(project,before);
 assert.deepEqual(uiPreviewKeys(project,'ui:main'),['K_e','K_a']);
 assert.equal(uiPreviewKeyboardKey('E'),'K_e');assert.equal(uiPreviewKeyboardKey('ArrowDown'),'K_DOWN');assert.equal(uiPreviewKeyboardKey('F5'),undefined);
 assert.equal(previewUiLogic(project,[component],'ui:main',{},[{kind:'key',key:'unknown'}]).incomplete,true);
});


test('timed UI preview respects intervals, one-shot events and interactions without extra timer samples',()=>{
 const project=createProject();project.variables.push({id:'clock_count',name:'计数',type:'number',initial:0,persistent:false});
 const graph=createBlueprintGraph('ui','计时');project.blueprints.push(graph);
 const repeat=blueprintNodeDefaults('eventTimer');repeat.properties={pageId:'ui:main',interval:1,repeat:true};
 const once=blueprintNodeDefaults('eventTimer');once.properties={pageId:'ui:main',interval:.5,repeat:false};
 const read=blueprintNodeDefaults('getVariable');read.properties.variableId='clock_count';
 const add=blueprintNodeDefaults('math');add.properties={operation:'add',b:1};
 const write=blueprintNodeDefaults('setVariable');write.properties.variableId='clock_count';
 const initialize=blueprintNodeDefaults('setVariable');initialize.properties={variableId:'clock_count',value:100};
 graph.nodes.push(repeat,once,read,add,write,initialize);
 for(const [from,out,to,input] of [[repeat.id,'exec',write.id,'exec_in'],[once.id,'exec',initialize.id,'exec_in'],[read.id,'value',add.id,'a'],[add.id,'result',write.id,'value']])assert.equal(connectBlueprintPins(graph,from,out,to,input),undefined);
 const before=structuredClone(project),sample=(events:any[])=>previewUiLogic(project,[],'ui:main',{},events,{timed:true});
 assert.equal(sample([]).variables.clock_count,0);
 assert.equal(sample([{kind:'advance',seconds:.2}]).variables.clock_count,0);
 assert.equal(sample([{kind:'advance',seconds:.5}]).variables.clock_count,100);
 const split=sample([{kind:'advance',seconds:.2},{kind:'advance',seconds:.3},{kind:'advance',seconds:1.5}]);
 assert.equal(split.variables.clock_count,102);assert.equal(split.fired,3);assert.equal(split.elapsed,2);assert.equal(split.incomplete,false);
 assert.deepEqual(split,sample([{kind:'advance',seconds:2}]));
 const events=[{kind:'advance',seconds:1},{kind:'parameter',id:'clock_count',value:4}];
 assert.equal(sample(events).variables.clock_count,4);assert.equal(sample([...events,{kind:'advance',seconds:1}]).variables.clock_count,5);
 assert.equal(sample([{kind:'advance',seconds:NaN}]).incomplete,true);
 assert.deepEqual(project,before);
 repeat.properties.interval=.00001;
 const bounded=sample([{kind:'advance',seconds:1}]);assert.equal(bounded.exhausted,true);assert.equal(bounded.fired,uiPreviewTimerLimit);assert.equal(bounded.incomplete,true);
});

test('parameter controls update linked UI, honor ranges and disabled visibility without changing defaults',()=>{
 const project=createProject();project.variables.push({id:'volume',name:'亮度',type:'number',initial:20,persistent:false,setting:{min:0,max:100,step:1}},{id:'caption_control',name:'标题',type:'string',initial:'默认',persistent:false,setting:{options:['默认','替换']}},{id:'switch_control',name:'显示',type:'boolean',initial:true,persistent:false});
 const controls=['volume','caption_control','switch_control'].map((id,index)=>({id:'control_'+id,disabled:false,kind:'preference' as const,page:'main' as const,text:id,parameterId:id,x:0,y:index*.1,width:.5,height:.1}));
 const text={id:'controlled_text',kind:'text' as const,page:'main' as const,text:'占位',x:0,y:.5,width:.5,height:.1};project.ui.components.push(...controls,text);
 createUiParameterBinding(project,text.id,'text','caption_control','ui:main');createUiParameterBinding(project,text.id,'visible','switch_control','ui:main');
 const before=structuredClone(project);
 const sample=previewUiLogic(project,project.ui.components,'ui:main',{},[{kind:'control',componentId:controls[0].id,value:75},{kind:'control',componentId:controls[1].id,value:'替换'},{kind:'control',componentId:controls[2].id,value:false}]);
 assert.equal(sample.incomplete,false);assert.equal(sample.variables.volume,75);assert.equal(sample.components.find(c=>c.component.id===text.id)?.component.text,'替换');assert.equal(sample.components.find(c=>c.component.id===text.id)?.visible,false);assert.deepEqual(project,before);
 const invalid=previewUiLogic(project,project.ui.components,'ui:main',{},[{kind:'control',componentId:controls[0].id,value:101},{kind:'control',componentId:controls[1].id,value:'不在选项中'}]);assert.equal(invalid.incomplete,true);assert.equal(invalid.variables.volume,20);assert.equal(invalid.variables.caption_control,'默认');
 controls[0].disabled=true;
 const disabled=previewUiLogic(project,controls,'ui:main',{},[{kind:'control',componentId:controls[0].id,value:70}]);assert.equal(disabled.variables.volume,20);
});

test('player preference controls and blueprint setters share local values without changing defaults',()=>{
 const project=createProject();project.playerDefaults={musicVolume:.8};project.variables.push({id:'ratio',name:'比例',type:'number',initial:0,persistent:false});
 const progress={id:'preference_progress',kind:'progress' as const,page:'preferences' as const,text:'音量',value:0,x:0,y:0,width:.5,height:.1};
 const slider={id:'preference_slider',kind:'preference' as const,page:'preferences' as const,preference:'musicVolume' as const,text:'音乐音量',x:0,y:.2,width:.5,height:.1};
 const button={id:'preference_button',kind:'button' as const,page:'preferences' as const,text:'静音',action:'setPlayerPreference' as const,preference:'musicVolume' as const,preferenceValue:0,x:0,y:.4,width:.5,height:.1};project.ui.components.push(progress,slider,button);
 const graph=createUiParameterBinding(project,progress.id,'value','ratio','ui:preferences');
 const reader=graph.nodes.find(n=>n.type==='getVariable')!;reader.type='getPlayerPreference';reader.properties={preference:'musicVolume'};
 const event=blueprintNodeDefaults('eventKey');event.properties={pageId:'ui:preferences',key:'K_e'};const setter=blueprintNodeDefaults('setPlayerPreference');setter.properties={preference:'musicVolume',value:.6};graph.nodes.push(event,setter);connectBlueprintPins(graph,event.id,'exec',setter.id,'exec_in');
 const before=structuredClone(project);
 const sample=(events:any[]=[])=>previewUiLogic(project,project.ui.components,'ui:preferences',{},events);
 assert.equal(sample().components.find(r=>r.component.id===progress.id)?.component.value,.8);
 const moved=sample([{kind:'control',componentId:slider.id,value:.3}]);assert.equal(moved.incomplete,false);assert.equal(moved.preferences.musicVolume,.3);assert.equal(moved.components.find(r=>r.component.id===progress.id)?.component.value,.3);
 const changed=sample([{kind:'key',key:'K_e'}]);assert.equal(changed.preferences.musicVolume,.6);assert.equal(changed.components.find(r=>r.component.id===progress.id)?.component.value,.6);assert.equal(changed.incomplete,false);
 assert.equal(sample([{kind:'click',componentId:button.id}]).preferences.musicVolume,0);
 const invalid=sample([{kind:'control',componentId:slider.id,value:2}]);assert.equal(invalid.incomplete,true);assert.equal(invalid.preferences.musicVolume,.8);
 assert.deepEqual(project,before);
});

test('character volume preview isolates characters and other voices across controls and blueprint reads/writes',()=>{
 const p=createProject();p.playerDefaults={characterVolume:.8};p.characters=['hero','npc'].map(id=>({id,name:id,color:'#ffffff',expressions:[]}));p.variables.push({id:'read_volume',name:'读到的音量',type:'number',initial:0,persistent:false});
 const controls=['hero','npc',''].map((id,index)=>({id:'voice_'+index,kind:'preference' as const,page:'voiceSettings' as const,text:id||'其他',preference:'characterVolume' as const,preferenceCharacterId:id||undefined,x:0,y:index*.2,width:.5,height:.1}));p.ui.components.push(...controls);
 const graph=createBlueprintGraph('ui','角色音量');p.blueprints.push(graph);
 const timer=blueprintNodeDefaults('eventTimer');timer.properties={pageId:'ui:voiceSettings',interval:.1,repeat:true};
 const read=blueprintNodeDefaults('getPlayerPreference');read.properties={preference:'characterVolume',characterId:'hero'};
 const write=blueprintNodeDefaults('setVariable');write.properties.variableId='read_volume';
 const key=blueprintNodeDefaults('eventKey');key.properties={pageId:'ui:voiceSettings',key:'K_e'};
 const set=blueprintNodeDefaults('setPlayerPreference');set.properties={preference:'characterVolume',characterId:'npc',value:.4};graph.nodes.push(timer,read,write,key,set);connectBlueprintPins(graph,timer.id,'exec',write.id,'exec_in');connectBlueprintPins(graph,read.id,'value',write.id,'value');connectBlueprintPins(graph,key.id,'exec',set.id,'exec_in');
 const original=structuredClone(p);
 const result=previewUiLogic(p,controls,'ui:voiceSettings',{},[{kind:'control',componentId:controls[0].id,value:.2},{kind:'control',componentId:controls[2].id,value:.6},{kind:'key',key:'K_e'}]);
 assert.equal(result.incomplete,false);assert.deepEqual(result.characterVolumes,{hero:.2,'':.6,npc:.4});assert.equal(result.variables.read_volume,.2);assert.equal(result.preferences.characterVolume,.8);assert.deepEqual(p,original);
 controls[0].preferenceCharacterId='missing';const invalid=previewUiLogic(p,controls,'ui:voiceSettings',{},[{kind:'control',componentId:controls[0].id,value:.1}]);assert.equal(invalid.incomplete,true);assert.deepEqual(invalid.characterVolumes,{});
});

test('UI show events run scheme initialization before components in render order and deduplicate graphs',()=>{
 const p=createProject();p.variables.push({id:'init_value',name:'初始化值',type:'number',initial:0,persistent:false});
 const make=(name:string,operation:string,value:number)=>{const graph=createBlueprintGraph('ui',name),read=blueprintNodeDefaults('getVariable'),math=blueprintNodeDefaults('math'),write=blueprintNodeDefaults('setVariable');read.properties.variableId='init_value';math.properties={operation,b:value};write.properties={variableId:'init_value',value};graph.nodes.push(read,math,write);connectBlueprintPins(graph,graph.nodes[0].id,'exec',write.id,'exec_in');if(operation!=='set'){connectBlueprintPins(graph,read.id,'value',math.id,'a');connectBlueprintPins(graph,math.id,'result',write.id,'value');}p.blueprints.push(graph);return graph.id;};
 const initialize=make('方案初始化','set',10),multiply=make('组件初始化一','multiply',2),add=make('组件初始化二','add',3);
 p.ui.instances=[{id:'scheme',name:'方案',components:[],blueprintId:initialize}];p.ui.activeInstanceId='scheme';
 const components=[{id:'later',layer:2,events:{onShow:add}},{id:'earlier',layer:1,events:{onShow:multiply}},{id:'duplicate',layer:3,events:{onShow:add}}].map(c=>({...c,kind:'text' as const,page:'main' as const,text:c.id,x:0,y:0,width:.2,height:.1}));
 p.ui.instances[0].components=components;
 const before=structuredClone(p),result=previewUiLogic(p,components,'ui:main');
 assert.equal(result.incomplete,false);assert.equal(result.variables.init_value,23);assert.deepEqual(p,before);
});

test('button shortcuts invoke click actions with topmost capture, disabled blocking and hidden fallback',()=>{
 const p=createProject();p.variables.push({id:'upper_visible',name:'显示上层',type:'boolean',initial:true,persistent:false});
 const lower={id:'lower',kind:'button' as const,page:'main' as const,text:'下层',layer:1,shortcut:'K_e',action:'setPlayerPreference' as const,preference:'musicVolume' as const,preferenceValue:.4,x:0,y:0,width:.2,height:.1};
 const upper={...lower,id:'upper',text:'上层',layer:2,shortcut:'e',disabled:false,preferenceValue:.2,visibleWhen:{kind:'compare' as const,variableId:'upper_visible',operator:'eq' as const,value:true}};p.ui.components.push(upper,lower);
 const graph=createBlueprintGraph('ui','页面按键'),key=blueprintNodeDefaults('eventKey'),write=blueprintNodeDefaults('setPlayerPreference');key.properties={pageId:'ui:main',key:'K_e'};write.properties={preference:'musicVolume',value:.9};graph.nodes.push(key,write);connectBlueprintPins(graph,key.id,'exec',write.id,'exec_in');p.blueprints.push(graph);
 const event=[{kind:'key' as const,key:'K_e'}],sample=(values={})=>previewUiLogic(p,p.ui.components,'ui:main',values,event);
 assert.deepEqual(uiPreviewKeys(p,'ui:main'),['K_e']);assert.equal(sample().preferences.musicVolume,.2);
 upper.disabled=true;assert.equal(sample().preferences.musicVolume,1);
 assert.equal(sample({upper_visible:false}).preferences.musicVolume,.4);
 p.ui.components=[];assert.equal(sample().preferences.musicVolume,.9);
});
