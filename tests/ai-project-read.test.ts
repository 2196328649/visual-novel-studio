import { createVisualObject } from '../src/core/visual-object';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, blueprintNodeSchema } from '../src/core/model';
import { readAiProject, aiReadResponseSchema } from '../src/core/ai-project-read';
import { aiRequestMessages } from '../src/core/ai';

test('AI reads actual schemas and node templates, pages and searches project data without exposing paths',()=>{
 const project=createProject();project.assets=Array.from({length:180},(_,i)=>({id:'asset_'+i,name:'图片 '+i,kind:'image',path:'private/'+i+'.png'}));
 const schema:any=readAiProject(project,[],{kind:'schema',field:'parameterSets'});assert.ok(schema.schema.items.properties.kind.enum.includes('settings'));
 const template:any=readAiProject(project,[],{kind:'blueprintNode',type:'getVariable'});assert.equal(blueprintNodeSchema.parse(template.template).type,'getVariable');
 const first:any=readAiProject(project,[],{kind:'project',path:['assets'],limit:30});assert.equal(first.total,180);assert.equal(first.nextOffset,30);assert.equal(first.items[0].path,undefined);
 const found:any=readAiProject(project,[],{kind:'project',path:['assets'],query:'图片 179'});assert.equal(found.items[0].id,'asset_179');
 assert.throws(()=>readAiProject(project,[],{kind:'project',path:['assets',{id:'asset_0'},'path']}),/路径无效/);
 assert.throws(()=>readAiProject(project,[],{kind:'project',path:['__proto__']}));
 assert.equal(aiReadResponseSchema.safeParse({read:[{kind:'schema',field:'ui'}],operations:[{kind:'editProject'}]}).success,false);
});

test('AI scoped reads exclude unselected dialogue; large context is indexed with on-demand access',()=>{
 const project=createProject(), passage=project.nodes.find(n=>n.kind==='passage')!;
 passage.lines=Array.from({length:130},(_,i)=>({id:'line_'+i,text:'长台词'.repeat(600),actions:[]}));
 const read:any=readAiProject(project,['line_129'],{kind:'project',path:['nodes',{id:passage.id},'lines']});assert.equal(read.total,1);assert.equal(read.items[0].id,'line_129');
 assert.throws(()=>readAiProject(project,['line_129'],{kind:'project',path:['nodes',{id:passage.id},'lines',{id:'line_0'}]}));
 const messages=aiRequestMessages({id:'test',prompt:'修改界面',project,lineIds:passage.lines.map(l=>l.id)});
 assert.ok(messages.at(-1)!.content.length<170000);assert.ok(messages.at(-1)!.content.includes('partial'));assert.ok(messages[0].content.includes('blueprintNode'));
});


test('AI reads long text in bounded pages without character-field expansion or scope bypass',()=>{
 const project=createProject(),passage=project.nodes.find(n=>n.kind==='passage')!;
 const text='文'.repeat(29999)+'😀'+'后文'.repeat(20000);
 passage.lines=[{id:'long_text',text,actions:[]}];
 const path=['nodes',{id:passage.id},'lines',{id:'long_text'},'text'];
 const before=structuredClone(project);let offset=0,reconstructed='',pages=0;
 while(true){const result:any=readAiProject(project,['long_text'],{kind:'project',path,offset});assert.equal(typeof result.value,'string');assert.ok(result.value.length<=30000);assert.equal(result.total,text.length);assert.equal(result.offset,offset);assert.ok(JSON.stringify(result).length<31000);assert.ok(!result.value.endsWith('\ud83d'));reconstructed+=result.value;pages++;if(result.nextOffset===undefined)break;assert.ok(result.nextOffset>offset);offset=result.nextOffset;}
 assert.equal(reconstructed,text);assert.equal(pages,3);assert.deepEqual(project,before);
 assert.throws(()=>readAiProject(project,[],{kind:'project',path,offset:30000}),/唯一对象/);
 const tail:any=readAiProject(project,['long_text'],{kind:'project',path,offset:text.length});assert.equal(tail.value,'');assert.equal(tail.nextOffset,undefined);
});


test('AI reads paged diagnostics with UI location and excludes out-of-scope dialogue issues',()=>{
 const project=createProject(),passage=project.nodes.find(n=>n.kind==='passage')!;
 passage.lines=[{id:'outside',text:'范围外',speakerId:'missing',actions:[]}];
 project.ui.components=Array.from({length:3},(_,i)=>({id:'control_'+i,kind:'preference' as const,page:'preferences' as const,text:'待设置',x:0,y:0,width:.2,height:.1}));
 const before=structuredClone(project),first:any=readAiProject(project,[],{kind:'diagnostics',limit:1,severity:'error'});
 assert.ok(first.omittedLineDiagnostics>0);assert.ok(first.total>=3);assert.equal(first.items.length,1);assert.equal(first.nextOffset,1);assert.equal(first.items[0].lineId,undefined);assert.equal(first.items[0].ui.componentId,'control_0');
 const next:any=readAiProject(project,[],{kind:'diagnostics',offset:first.nextOffset,limit:1,severity:'error'});assert.equal(next.items[0].ui.componentId,'control_1');
 const included:any=readAiProject(project,['outside'],{kind:'diagnostics'});assert.equal(included.omittedLineDiagnostics,0);assert.ok(included.items.some((i:any)=>i.lineId==='outside'));
 assert.deepEqual(project,before);
});


test('AI selection context keeps the exact UI identity even when large project context is summarized',()=>{
 const project=createProject();project.ui.components=[{id:'chosen',name:'同名',kind:'text',page:'main',text:'内容',x:0,y:0,width:.2,height:.1},{id:'other',name:'同名',kind:'text',page:'main',text:'另一个',x:0,y:0,width:.2,height:.1}];
 const passage=project.nodes.find(n=>n.kind==='passage')!;passage.lines=[{id:'large',text:'长'.repeat(170000),actions:[]}];
 const data=(selectedUiComponentId:string)=>{const messages=aiRequestMessages({id:'selection',prompt:'修改选中组件',project,lineIds:['large'],selectedUiComponentId});const content=messages.at(-1)!.content;return JSON.parse(content.slice(content.indexOf('\n{')+1));};
 assert.equal(data('chosen').selectedUiComponent.id,'chosen');assert.equal(data('chosen').partial,true);assert.equal(data('missing').selectedUiComponent,undefined);
});


test('AI blueprint selection resolves within its graph and survives context summaries',()=>{
 const project=createProject();
 const a=readAiProject(project,[],{kind:'blueprintNode',type:'literal'}) as any;
 const node={...a.template,id:'chosen',name:'同名'};
 project.blueprints=[{id:'graph_a',name:'蓝图',kind:'function',nodes:[node,{...node,id:'other'}],links:[],exposedInputs:[],exposedOutputs:[]}];
 const passage=project.nodes.find(n=>n.kind==='passage')!;
 const data=(graphId:string,nodeId?:string)=>{const messages=aiRequestMessages({id:'selection',prompt:'修改选中节点',project,lineIds:passage.lines.map(l=>l.id),selectedBlueprint:{graphId,nodeId}});const content=messages.at(-1)!.content;return JSON.parse(content.slice(content.indexOf('\n{')+1));};
 assert.equal(data('graph_a','chosen').selectedBlueprint.node.id,'chosen');
 assert.equal(data('graph_a','missing').selectedBlueprint.node,undefined);
 assert.equal(data('missing','chosen').selectedBlueprint,undefined);
 passage.lines=[{id:'large',text:'长'.repeat(170000),actions:[]}];
 assert.equal(data('graph_a','other').selectedBlueprint.node.id,'other');assert.equal(data('graph_a').partial,true);
});


test('AI content selection keeps mixed identities, removes stale keys and excludes private paths',()=>{
 const project=createProject();project.assets=[{id:'one',kind:'image',name:'同名',path:'private/one.png'},{id:'two',kind:'image',name:'同名',path:'private/two.png'}];project.contentBrowser={folders:[{id:'folder',name:'文件夹'}],assignments:{},favorites:[]};
 const data=(keys:string[])=>{const content=aiRequestMessages({id:'selection',prompt:'修改所选素材',project,lineIds:[],selectedContentKeys:keys}).at(-1)!.content;return JSON.parse(content.slice(content.indexOf('\n{')+1)).selectedContent;};
 const selected=data(['asset:two','asset:one','asset:one','folder:folder','asset:missing']);assert.equal(selected.length,3);assert.deepEqual(selected.map((i:any)=>i.key).sort(),['asset:one','asset:two','folder:folder']);assert.equal(JSON.stringify(selected).includes('private'),false);assert.deepEqual(data([]),[]);
});


test('AI parameter selection resolves built-in sets and rejects variables from another set',()=>{
 const project=createProject();project.variables=[{id:'story',name:'剧情参数',type:'number',initial:1,persistent:false},{id:'setting',name:'设置参数',type:'number',initial:2,persistent:true,parameterSetId:'parameters_game'}];
 const data=(setId:string,variableId?:string)=>{const content=aiRequestMessages({id:'selection',prompt:'修改这个参数',project,lineIds:[],selectedParameter:{setId,variableId}}).at(-1)!.content;return JSON.parse(content.slice(content.indexOf('\n{')+1)).selectedParameter;};
 assert.equal(data('parameters_story','story').variable.id,'story');assert.equal(data('parameters_story','setting').variable,undefined);assert.equal(data('missing','story'),undefined);assert.equal(data('parameters_game').kind,'settings');
});


test('AI timeline child selection retains instance identity and rejects deleted children',()=>{
 const project=createProject(),root=createVisualObject('group'),child=createVisualObject('text'),other=createVisualObject('text');root.children=[other,child];const graph=blueprintFromPerformance(project,[root],'时间轴');project.blueprints.push(graph);const node=graph.nodes.find(n=>n.type==='savedAction')!;
 const data=(objectInstanceId:string)=>{const content=aiRequestMessages({id:'selection',prompt:'修改子对象',project,lineIds:[],selectedBlueprint:{graphId:graph.id,nodeId:node.id,objectInstanceId}}).at(-1)!.content;return JSON.parse(content.slice(content.indexOf('\n{')+1)).selectedBlueprint;};
 assert.deepEqual(data(child.instanceId).selectedObject.path,[1]);assert.equal(data(child.instanceId).selectedObject.instanceId,child.instanceId);assert.equal(data('missing').selectionUnavailable,true);assert.equal(data('missing').node,undefined);
});


test('large resource selections have bounded context and complete paged identities',()=>{
 const project=createProject();project.assets=Array.from({length:3000},(_,i)=>({id:'asset_'+i,name:'素材名称'.repeat(30)+i,kind:'image',path:'private/'+i+'.png'}));
 const keys=project.assets.map(a=>'asset:'+a.id);keys.push(keys[0],'asset:missing');
 const content=aiRequestMessages({id:'large_selection',prompt:'修改选择',project,lineIds:[],selectedContentKeys:keys}).at(-1)!.content;
 assert.ok(content.length<170000,'selection must not defeat context limit: '+content.length);
 const data=JSON.parse(content.slice(content.indexOf('\n{')+1));assert.equal(data.selectedContentTotal,3000);assert.equal(data.selectedContentPartial,true);assert.equal(data.selectedContent.length,100);
 const actual:string[]=[];let offset=0;
 do {const page:any=readAiProject(project,[],{kind:'selectedContent',offset,limit:100},keys);assert.equal(page.total,3000);assert.ok(!JSON.stringify(page).includes('private/'));actual.push(...page.items.map((i:any)=>i.key));offset=page.nextOffset;}while(offset!==undefined);
 assert.deepEqual(actual,keys.slice(0,3000));
 assert.equal((readAiProject(project,[],{kind:'selectedContent'}) as any).total,0);
 assert.equal((readAiProject(project,[],{kind:'selectedContent',query:'2999'},keys) as any).items[0].id,'asset_2999');
 assert.throws(()=>readAiProject(project,[],{kind:'selectedContent',keys:['asset:asset_0']},keys));
});
