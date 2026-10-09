import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlueprintGraph } from '../src/core/blueprint';
import { blueprintLayoutIsCurrent, registerBlueprintEditor, runBlueprintEditorAction } from '../src/renderer/blueprint-editor-actions';

test('editor action dispatch requires a unique live project and graph, and unmount removes the handler',async()=>{
 const calls:string[]=[],handler=async(command:string)=>{calls.push(command);return {status:'completed' as const,message:'done'};};
 const remove=registerBlueprintEditor('project','graph',handler);
 try {
  assert.equal((await runBlueprintEditorAction('other','graph','frameBlueprint')).status,'failed');
  assert.equal((await runBlueprintEditorAction('project','other','frameBlueprint')).status,'failed');
  assert.equal((await runBlueprintEditorAction('project','graph','frameBlueprint')).status,'completed');assert.deepEqual(calls,['frameBlueprint']);
  const duplicate=registerBlueprintEditor('project','graph',handler);
  try {assert.equal((await runBlueprintEditorAction('project','graph','arrangeBlueprint')).status,'failed');assert.deepEqual(calls,['frameBlueprint']);}finally{duplicate();}
 }finally{remove();}
 assert.equal((await runBlueprintEditorAction('project','graph','arrangeBlueprint')).status,'failed');
});

test('layout guards reject changed positions, topology, node values, graph or project before applying results',()=>{
 const source={projectId:'p',graph:createBlueprintGraph('function','目标')};
 assert.equal(blueprintLayoutIsCurrent(source,structuredClone(source)),true);
 for(const edit of [(g:typeof source.graph)=>{g.nodes[0].x+=20;},(g:typeof source.graph)=>{g.nodes[0].properties.value=1;},(g:typeof source.graph)=>{g.nodes=[];},(g:typeof source.graph)=>{g.id='other';}]){
  const next=structuredClone(source);edit(next.graph);assert.equal(blueprintLayoutIsCurrent(source,next),false);
 }
 assert.equal(blueprintLayoutIsCurrent(source,{...source,projectId:'other'}),false);
 assert.equal(blueprintLayoutIsCurrent(source,{projectId:source.projectId}),false);
});
