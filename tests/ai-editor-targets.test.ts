import { createVisualObject } from '../src/core/visual-object';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/core/model';
import { createBlueprintGraph, blueprintNodeDefaults } from '../src/core/blueprint';
import { aiEditorTargetSchema, resolveAiEditorTarget } from '../src/core/ai-editor-targets';
test('AI editor targets resolve exact identities and reject missing or ambiguous objects',()=>{
 const project=createProject(),graph=createBlueprintGraph('function','同名'),node=blueprintNodeDefaults('literal');graph.nodes.push(node);project.blueprints.push(graph);
 const before=structuredClone(project);assert.equal(resolveAiEditorTarget(project,{kind:'blueprint',graphId:graph.id,nodeId:node.id}).kind,'blueprint');
 assert.throws(()=>resolveAiEditorTarget(project,{kind:'blueprint',graphId:graph.id,nodeId:'missing'}));assert.deepEqual(project,before);
 const component={id:'chosen',kind:'text' as const,page:'main' as const,text:'同名',x:0,y:0,width:.2,height:.1};project.ui.components=[component];
 assert.equal(resolveAiEditorTarget(project,{kind:'ui',componentId:component.id}).kind,'ui');project.ui.customPages=[{id:'custom',name:'自定义',modal:false,components:[{...component,page:'custom'}]}];
 assert.throws(()=>resolveAiEditorTarget(project,{kind:'ui',componentId:component.id}),/唯一/);
 assert.throws(()=>aiEditorTargetSchema.parse({kind:'blueprint',graphId:graph.id,path:'private'}));
 assert.throws(()=>resolveAiEditorTarget(project,{kind:'parameter',variableId:'missing'}));assert.throws(()=>resolveAiEditorTarget(project,{kind:'character',characterId:'missing'}));
});

test('UI targets respect inherited identities and explicit scheme/page scope',()=>{
 const project=createProject();const component={id:'shared',kind:'text' as const,page:'main' as const,text:'基础',x:0,y:0,width:.2,height:.1};project.ui.components=[component];project.ui.instances=[{id:'scheme',name:'方案',components:[{...component,text:'覆盖'}]}];project.ui.activeInstanceId='scheme';
 const current=resolveAiEditorTarget(project,{kind:'ui',componentId:'shared'});assert.equal(current.label,'覆盖');assert.equal(current.kind==='ui'&&current.target.instanceId,'scheme');
 project.ui.customPages=[{id:'custom',name:'自定义',modal:false,components:[{...component,page:'custom'}]}];
 assert.throws(()=>resolveAiEditorTarget(project,{kind:'ui',componentId:'shared'}));
 assert.equal(resolveAiEditorTarget(project,{kind:'ui',componentId:'shared',instanceId:'scheme'}).label,'覆盖');
 const custom=resolveAiEditorTarget(project,{kind:'ui',componentId:'shared',customPageId:'custom'});assert.equal(custom.kind==='ui'&&custom.target.customPageId,'custom');
 assert.throws(()=>resolveAiEditorTarget(project,{kind:'ui',componentId:'shared',instanceId:'missing'}));
});

test('parameter set targets resolve built-ins, renamed built-ins and empty custom sets',()=>{
 const project=createProject();assert.equal(resolveAiEditorTarget(project,{kind:'parameterSet',setId:'parameters_story'}).label,'故事状态');project.parameterSets=[{id:'parameters_game',name:'玩家偏好',kind:'settings'},{id:'empty',name:'空集合',kind:'story'}];
 assert.equal(resolveAiEditorTarget(project,{kind:'parameterSet',setId:'parameters_game'}).label,'玩家偏好');assert.equal(resolveAiEditorTarget(project,{kind:'parameterSet',setId:'empty'}).label,'空集合');assert.throws(()=>resolveAiEditorTarget(project,{kind:'parameterSet',setId:'missing'}));assert.equal(project.variables.length,0);
});

test('timeline child targets follow stable identity through reorder and reject deleted or duplicate IDs',()=>{
 const project=createProject(),root=createVisualObject('group'),child=createVisualObject('text'),other=createVisualObject('text');root.children=[child,other];child.name='目标子对象';const graph=blueprintFromPerformance(project,[root],'时间轴');graph.timelineComponent=true;project.blueprints.push(graph);const node=graph.nodes.find(n=>n.type==='savedAction')!;
 const target={kind:'blueprint' as const,graphId:graph.id,nodeId:node.id,objectInstanceId:child.instanceId};
 assert.match(resolveAiEditorTarget(project,target).label,/目标子对象/);root.children.reverse();node.properties.action=JSON.stringify(root);assert.match(resolveAiEditorTarget(project,target).label,/目标子对象/);
 root.children=[other];node.properties.action=JSON.stringify(root);assert.throws(()=>resolveAiEditorTarget(project,target),/移除/);
 root.children=[child,structuredClone(child)];node.properties.action=JSON.stringify(root);assert.throws(()=>resolveAiEditorTarget(project,target),/不唯一/);
 assert.throws(()=>resolveAiEditorTarget(project,{...target,nodeId:undefined}));
});


test('asset targets distinguish duplicate names by identity and UI targets retain advanced mode',()=>{
 const project=createProject();project.assets=[{id:'image_a',name:'同名图',kind:'image',path:'private/a.png'},{id:'image_b',name:'同名图',kind:'image',path:'private/b.png'}];project.contentBrowser={folders:[{id:'folder',name:'背景'}],assignments:{'asset:image_b':'folder'},favorites:[]};
 const target=resolveAiEditorTarget(project,{kind:'asset',assetId:'image_b'});assert.equal(target.kind,'asset');assert.equal('id' in target&&target.id,'image_b');assert.equal(target.label,'背景 / 同名图');assert.ok(!JSON.stringify(target).includes('private'));
 project.assets.pop();assert.throws(()=>resolveAiEditorTarget(project,{kind:'asset',assetId:'image_b'}),/不存在/);
 project.ui.components=[{id:'control',name:'目标控件',kind:'text',page:'main',text:'文字',x:0,y:0,width:.2,height:.1}];
 const advanced=resolveAiEditorTarget(project,{kind:'ui',componentId:'control',advanced:true});assert.equal(advanced.kind==='ui'&&advanced.advanced,true);const normal=resolveAiEditorTarget(project,{kind:'ui',componentId:'control'});assert.equal(normal.kind==='ui'&&normal.advanced,false);
});


test('blueprint selection targets validate every identity atomically, separate nodes and links, and retain UI scope',()=>{
 const project=createProject(),g=createBlueprintGraph('ui','同名');g.uiPageId='ui:main';g.uiInstanceId='base';project.blueprints.push(g);
 const node=blueprintNodeDefaults('delay');g.nodes.push(node);g.links.push({id:'wire',fromNodeId:g.nodes[0].id,fromPinId:'exec',toNodeId:node.id,toPinId:'exec_in'});
 const target={kind:'blueprintSelection' as const,graphId:g.id,nodeIds:[node.id,node.id],linkIds:['wire']};
 const before=structuredClone(project),result=resolveAiEditorTarget(project,target);assert.equal(result.kind,'blueprintSelection');
 if(result.kind!=='blueprintSelection')throw new Error('wrong kind');assert.deepEqual(result.nodeIds,[node.id]);assert.deepEqual(result.linkIds,['wire']);assert.equal(result.ui?.page,'main');assert.equal(result.ui?.instanceId,undefined);assert.equal(result.frame,true);assert.deepEqual(project,before);
 const wires=resolveAiEditorTarget(project,{...target,nodeIds:[]});assert.equal(wires.kind==='blueprintSelection'&&wires.nodeIds.length,0);
 assert.throws(()=>resolveAiEditorTarget(project,{...target,nodeIds:[node.id,'missing']}),/本次选择没有更改/);assert.throws(()=>resolveAiEditorTarget(project,{...target,linkIds:['missing']}));assert.deepEqual(project,before);
 assert.equal(aiEditorTargetSchema.safeParse({...target,nodeIds:undefined}).success,false);assert.equal(aiEditorTargetSchema.safeParse({...target,nodeIds:Array(513).fill(node.id)}).success,false);
 g.links.push({...g.links[0]});assert.throws(()=>resolveAiEditorTarget(project,target),/不唯一/);g.links.pop();
 g.uiInstanceId='missing';assert.throws(()=>resolveAiEditorTarget(project,target),/方案/);
 g.uiPageId='custom';assert.throws(()=>resolveAiEditorTarget(project,target),/自定义页面/);project.ui.customPages.push({id:'custom',name:'自定义',modal:false,components:[]});
 const custom=resolveAiEditorTarget(project,target);assert.equal(custom.kind==='blueprintSelection'&&custom.ui?.customPageId,'custom');
});
