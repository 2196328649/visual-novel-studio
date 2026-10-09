import { blueprintFromPerformance, performanceInputs, exposePerformanceInputs } from '../src/core/blueprint-authoring';
import { blueprintNodeDefaults, callablePins, connectBlueprintPins } from '../src/core/blueprint';
import { performanceTimeline, arrangePerformanceTimeline } from '../src/core/performance-timeline';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { createUiParameterBinding } from '../src/core/ui-logic';
import { previewUiLogic } from '../src/core/ui-logic-preview';
import { compileProject } from '../src/runtime/compiler';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/core/model';
import { createBlueprintGraph } from '../src/core/blueprint';
import { parseAiResponse, prepareAiChanges, applyAiChanges, type AiOperation } from '../src/core/ai';
import { projectToText } from '../src/core/text-script';

const set = (path: any[], value: any): AiOperation => ({ kind: 'editProject', path, action: 'set', value });
test('AI project edits cover UI, blueprint structure, parameter sets and settings atomically', () => {
  const project = createProject('AI 编辑测试');
  const original = structuredClone(project);
  const graph = createBlueprintGraph('effect', '通用演出');
  const operations: AiOperation[] = [
    { kind: 'editProject', path: ['blueprints'], action: 'append', value: graph as any },
    set(['blueprints', { id: graph.id }, 'name'], '新的演出'),
    set(['parameterSets'], [{ id: 'settings_set', name: '界面参数', kind: 'settings' }]),
    { kind: 'editProject', path: ['ui', 'components'], action: 'append', value: { id: 'ai_label', kind: 'text', page: 'main', text: '测试标题', x: 0, y: 0, width: .5, height: .1 } },
    set(['ui', 'components', { id: 'ai_label' }, 'x'], .25),
    set(['width'], 1920), set(['height'], 1080),
  ];
  const parsed = parseAiResponse(JSON.stringify({ operations }));
  const changes = prepareAiChanges(project, parsed.operations, []);
  assert.deepEqual(project, original);
  const reordered = Object.fromEntries(Object.entries(project).reverse()) as typeof project;
  assert.doesNotThrow(() => applyAiChanges(reordered, changes));
  const next = applyAiChanges(project, changes);
  assert.equal(next.ui.components.find(c => c.id === 'ai_label')?.x, .25);
  assert.equal(next.blueprints.find(g => g.id === graph.id)?.name, '新的演出');
  assert.equal(next.parameterSets?.[0].name, '界面参数');
  assert.equal(next.width, 1920);
  project.ui.accent = '#ff0000';
  assert.throws(() => applyAiChanges(project, changes), /发生变化/);
});

test('AI edits reject unknown fields, invalid structures, prototype paths and missing IDs', () => {
  const project = createProject();
  for (const operation of [set(['ui', 'inventedOption'], true), set(['width'], -1), set(['ui', 'components', { id: 'missing' }, 'x'], .1), set(['ui', '__proto__', 'polluted'], true), set(['id'], 'changed')]) {
    assert.throws(() => prepareAiChanges(project, [operation], []));
  }
  assert.equal(({} as any).polluted, undefined);
  const before = structuredClone(project);
  assert.throws(() => prepareAiChanges(project, [set(['name'], '合法修改'), set(['width'], 0)], []));
  assert.deepEqual(project, before);
});

test('AI structural edits respect selected dialogue and synchronize source text', () => {
  const project = createProject();
  const node = project.nodes.find(n => n.kind === 'passage')!;
  const line = node.lines[0];
  project.scriptText = { format: 'vns-text-1', content: projectToText(project) };
  const edit = set(['nodes', { id: node.id }, 'lines', { id: line.id }, 'text'], '修改后的台词');
  assert.throws(() => prepareAiChanges(project, [edit], []), /范围以外/);
  const next = applyAiChanges(project, prepareAiChanges(project, [edit], [line.id]));
  assert.match(next.scriptText!.content, /修改后的台词/);
  project.ui.components.push({ id: 'removable', kind: 'text', page: 'main', text: '测试', x: 0, y: 0, width: .2, height: .1 });
  const remove: AiOperation = { kind: 'editProject', action: 'remove', path: ['ui', 'components', { id: project.ui.components[0].id }] };
  const result = applyAiChanges(project, prepareAiChanges(project, [remove], []));
  assert.equal(result.ui.components.length, project.ui.components.length - 1);
});

test('AI linked edits build a working parameter-driven UI graph and reject partial or dangling batches',()=>{
 const project=createProject('AI 参数联动'),draft=structuredClone(project);
 draft.parameterSets=[{id:'ai_group',name:'界面参数',kind:'settings'}];
 draft.variables.push({id:'ai_caption',name:'显示文字',type:'string',initial:'默认标题',persistent:true,parameterSetId:'ai_group'});
 const label={id:'ai_linked_label',kind:'text' as const,page:'main' as const,text:'占位',x:.1,y:.1,width:.5,height:.1};
 draft.ui.components.push(label);
 const graph=createUiParameterBinding(draft,label.id,'text','ai_caption','ui:main');
 const operations:AiOperation[]=[
  {kind:'editProject',path:['blueprints'],action:'append',value:graph as any},
  {kind:'editProject',path:['ui','components'],action:'append',value:label},
  set(['parameterSets'],draft.parameterSets),
  {kind:'editProject',path:['variables'],action:'append',value:draft.variables.find(v=>v.id==='ai_caption') as any},
 ];
 const original=structuredClone(project);
 const response=parseAiResponse(JSON.stringify({message:'建立联动',operations}));
 const changes=prepareAiChanges(project,response.operations,[]);
 const next=applyAiChanges(project,changes);
 const sample=previewUiLogic(next,[next.ui.components.find(c=>c.id===label.id)!],'ui:main',{ai_caption:'AI 联动生效'});
 assert.equal(sample.incomplete,false);assert.equal(sample.components[0].component.text,'AI 联动生效');
 const compiled=compileProject(next);assert.ok(compiled.files['game/story.rpy']);
 assert.deepEqual(project,original);
 assert.throws(()=>prepareAiChanges(project,[operations[0]],[]));
 const remove:AiOperation={kind:'editProject',action:'remove',path:['variables',{id:'ai_caption'}]};
 assert.throws(()=>prepareAiChanges(next,[remove],[]));
 const renamed=applyAiChanges(next,prepareAiChanges(next,[set(['variables',{id:'ai_caption'},'name'],'新名称')],[]));
 assert.equal(previewUiLogic(renamed,[label],'ui:main',{ai_caption:'重命名后仍联动'}).components[0].component.text,'重命名后仍联动');
});

test('AI creates reusable timeline calls with asset defaults and overrides then edits their timing',()=>{
 const project=createProject();project.assets.push({id:'default_image',name:'默认素材',kind:'image',path:'default.png'},{id:'other_image',name:'覆盖素材',kind:'image',path:'other.png'});
 const draft=structuredClone(project);
 const child=blueprintFromPerformance(draft,[{kind:'background',assetId:'default_image',transition:'none',duration:0,wait:false}],'通用时间轴');child.timelineComponent=true;draft.blueprints.push(child);
 exposePerformanceInputs(child,performanceInputs(child).filter(f=>f.pinId==='assetId'));
 const model=performanceTimeline(draft,child);arrangePerformanceTimeline(draft,child,model.clips.map(c=>({...c,at:.5})),model.tracks);
 const caller=createBlueprintGraph('function','调用演出');caller.exposedInputs=[{id:'image_input',name:'图片',direction:'input',dataType:'asset',required:false,defaultValue:''}];
 const read=blueprintNodeDefaults('getInput');read.properties.inputId='image_input';
 const call=blueprintNodeDefaults('callFunction');call.properties.graphId=child.id;call.pins=callablePins(child);caller.nodes.push(read,call);
 assert.equal(connectBlueprintPins(caller,caller.nodes[0].id,'exec',call.id,'exec_in'),undefined);assert.equal(connectBlueprintPins(caller,read.id,'value',call.id,'arg_'+child.exposedInputs[0].id),undefined);
 const operations:AiOperation[]=[{kind:'editProject',path:['blueprints'],action:'append',value:caller as any},{kind:'editProject',path:['blueprints'],action:'append',value:child as any}];
 const next=applyAiChanges(project,prepareAiChanges(project,parseAiResponse(JSON.stringify({operations})).operations,[]));
 const restored=JSON.parse(JSON.stringify(next));
 for(const [input,expected] of [['',undefined],['other_image','other_image']] as const) {
  const context=previewActionContext(restored),actions=expandPreviewActions(restored,[{kind:'blueprint',blueprintId:caller.id,inputs:{image_input:input}}],context);
  assert.equal(context.incomplete,!input);assert.equal(actions.find(a=>a.kind==='background')?.assetId,expected);
 }
 const moved=structuredClone(restored),timeline=moved.blueprints.find((g:any)=>g.id===child.id)!;const layout=performanceTimeline(moved,timeline);arrangePerformanceTimeline(moved,timeline,layout.clips.map(c=>({...c,at:1.25})),layout.tracks);
 const changed=applyAiChanges(restored,prepareAiChanges(restored,[set(['blueprints',{id:child.id}],timeline)],[]));
 assert.equal(performanceTimeline(changed,changed.blueprints.find(g=>g.id===child.id)!).clips[0].at,1.25);
 assert.deepEqual(changed.blueprints.find(g=>g.id===caller.id),restored.blueprints.find((g:any)=>g.id===caller.id));
 assert.ok(compileProject(changed).files['game/story.rpy']);assert.equal(project.blueprints.length,0);
});
