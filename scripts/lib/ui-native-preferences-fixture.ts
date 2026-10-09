import { createProject, type UiComponent } from '../../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintNodeValuePins } from '../../src/core/blueprint';

export function uiNativePreferencesFixture() {
 const project=createProject('标准设置交互验收');project.playerDefaults={musicVolume:.7,characterVolume:.8};
 project.characters.push({id:'hero',name:'小雨',color:'#ffffff',expressions:[]},{id:'other',name:'其他角色',color:'#ffffff',expressions:[]});
 project.variables.push({id:'story',name:'剧情计数',type:'number',initial:3,persistent:false},{id:'custom',name:'字幕字号',type:'number',initial:25,persistent:true,parameterSetId:'parameters_game',setting:{min:12,max:60,step:1}},{id:'hidden',name:'隐藏设置',type:'boolean',initial:true,persistent:true,parameterSetId:'parameters_game',setting:{visible:false}});
 const button:UiComponent={id:'open',kind:'button',page:'main',text:'打开标准设置',action:'preferences',x:.25,y:.2,width:.5,height:.12};
 project.ui.components.push(button,{id:'linked_volume',kind:'progress',page:'preferences',text:'',x:.75,y:.1,width:.2,height:.025,value:0});
 const graph=createBlueprintGraph('ui','同步音乐音量');graph.uiPageId='ui:preferences';const timer=blueprintNodeDefaults('eventTimer');timer.properties={pageId:'ui:preferences',interval:.1,repeat:true};const get=blueprintNodeDefaults('getPlayerPreference');get.properties={preference:'musicVolume'};const set=blueprintNodeDefaults('setUiProperty');set.properties={componentId:'linked_volume',property:'value'};graph.nodes.push(timer,get,set);synchronizeBlueprintNodeValuePins(project,graph,set);connectBlueprintPins(graph,timer.id,'exec',set.id,'exec_in');connectBlueprintPins(graph,get.id,'value',set.id,'value');project.blueprints.push(graph);
 const title=createBlueprintGraph('ui','标题事件');title.uiPageId='ui:main';project.blueprints.push(title);
 return project;
}
