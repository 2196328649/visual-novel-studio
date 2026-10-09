import test from 'node:test';
import assert from 'node:assert/strict';
import { uiControlValue } from '../src/core/ui-control-value';
import { blueprintNodeDefaults, connectBlueprintPins, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { createProject, projectSchema, type UiComponent } from '../src/core/model';
import { createUiEventGraph } from '../src/core/ui-logic';
import { previewUiLogic } from '../src/core/ui-logic-preview';
import { compileProject } from '../src/runtime/compiler';

test('control shortcuts retain binding identity, typed data flow and defaults through save and preview', () => {
 const project = createProject('Control values');
 project.variables.push({id:'flag', name:'Flag', type:'boolean', initial:false, persistent:false}, {id:'text', name:'Text', type:'string', initial:'初始', persistent:false});
 project.characters.push({id:'hero', name:'角色', color:'#ffffff', expressions:[]}, {id:'other', name:'其他角色', color:'#ffffff', expressions:[]});
 project.playerDefaults = {musicVolume:.7};
 const graph = createUiEventGraph(project, 'ui:preferences', 'Values');
 let previous = graph.nodes[0];
 for (const [index, binding] of [{parameterId:'flag', preference:'musicVolume'}, {parameterId:'text'}, {preference:'musicVolume'}, {preference:'characterVolume', preferenceCharacterId:'hero'}, {preference:'characterVolume'}].entries()) {
  const component = {id:'control'+index,kind:'preference',page:'preferences',x:0,y:index*.15,width:.8,height:.1,...binding} as UiComponent;
  project.ui.components.push(component);
  const value = uiControlValue(project,component)!; assert.ok(value.read && value.write);
  const read = blueprintNodeDefaults(value.read.type), write = blueprintNodeDefaults(value.write.type);
  Object.assign(read.properties,value.read.properties); Object.assign(write.properties,value.write.properties);
  graph.nodes.push(read,write); synchronizeBlueprintSignatures(project);
  assert.equal(connectBlueprintPins(graph,previous.id,previous===graph.nodes[0]?'exec':'exec_out',write.id,'exec_in'),undefined);
  assert.equal(connectBlueprintPins(graph,read.id,'value',write.id,'value'),undefined); previous=write;
  if(index===2) assert.equal(value.write.properties.value,.7);
  if(index===3) assert.equal(value.read.properties.characterId,'hero');
  if(index===4) assert.equal(value.read.properties.characterId,'');
 }
 const saved=projectSchema.parse(JSON.parse(JSON.stringify(project)));
 assert.deepEqual(compileProject(saved).diagnostics.filter(d=>d.severity==='error'),[]);
 const result=previewUiLogic(saved,saved.ui.components,'ui:preferences',{flag:true,text:'现值'});
 assert.equal(result.incomplete,false); assert.equal(result.variables.flag,true); assert.equal(result.variables.text,'现值');
 assert.equal(result.preferences.musicVolume,.7); assert.equal(result.characterVolumes!.hero,1); assert.equal(result.characterVolumes![''],1); assert.equal(result.characterVolumes!.other,undefined);
});

test('missing bindings cannot silently create nodes for a different variable or character', () => {
 const project=createProject('Missing binding'), control={id:'c',kind:'preference',page:'preferences',x:0,y:0,width:.8,height:.1} as UiComponent;
 for(const binding of [{}, {parameterId:'missing',preference:'musicVolume'}, {preference:'characterVolume',preferenceCharacterId:'missing'}]) {
  const result=uiControlValue(project,{...control,...binding} as UiComponent)!;
  assert.ok(result.error); assert.equal(result.read,undefined); assert.equal(result.write,undefined);
 }
 assert.equal(uiControlValue(project,{...control,kind:'text'}),undefined);
});
