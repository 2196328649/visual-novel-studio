import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runAiAgent, type AiAgentOptions } from '../src/desktop/ai-agent';
import { AiRetryableError, AiService } from '../src/desktop/ai-service';
import { AiAuthoringService } from '../src/desktop/ai-authoring';
import { readAiAttachments } from '../src/desktop/ai-attachments';
import { resolveAiSource, readAiAttachmentPage } from '../src/desktop/ai-agent-files';
import { aiLines, defaultAiConfig, type AiRequest } from '../src/core/ai';
import { createProject, type Project } from '../src/core/model';
import { applyAiWorkflow } from '../src/core/ai-workflow';
import { aiEffectHolds, aiProjectEffects, aiTaskEvidenceDiagnostics, aiTaskOutcomes, createAiAgentProposal } from '../src/core/ai-agent-review';
import { projectToText } from '../src/core/text-script';
import { currentScriptText } from '../src/core/script-text';

const task = (id = 'change', title = '修改请求', kind = 'change') => ({ id, title, kind });
const tool = (id: string, name: string, args: object = {}, taskIds = ['change']) => ({ id, name, arguments: args, taskIds });
const edit = (id: string, value: number) => tool(id, 'editProject', { operations: [{ kind: 'editProject', path: ['width'], action: 'set', value }] });
const finish = (evidence: string[], id = 'change', status = 'complete') => ({ finish: { message: '待应用', tasks: [{ id, status, evidence }] } });
const results = (messages: { content: string }[]) => JSON.parse(messages.at(-1)!.content.split('\n').slice(1).join('\n'));
const fixture = (count = 3) => {
  const project = createProject('工具循环');
  const passage = project.nodes.find(node => node.kind === 'passage')!;
  passage.lines = Array.from({ length: count }, (_, i) => ({ id: 'line_' + i, text: '台词' + i, actions: [] }));
  return project;
};
const request = (project: Project, extra: Partial<AiRequest> = {}): AiRequest => ({ id: 'agent_test', prompt: '执行这次修改', project, lineIds: aiLines(project).map(({ line }) => line.id), ...extra });
const options = (extra: Partial<AiAgentOptions> = {}): AiAgentOptions => ({ projectDirectory: () => undefined, progress: () => {}, check: () => {}, specialist: async () => { throw new Error('Unexpected specialist'); }, ...extra });
async function temporary(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vns-agent-'));
  t.after(async () => { assert.ok(root.startsWith(path.resolve(os.tmpdir()) + path.sep)); await fs.rm(root, { force: true, recursive: true }); });
  return root;
}
async function run(project: Project, steps: (object | ((messages: any[]) => object))[], extra: Partial<AiRequest> = {}, config: Partial<AiAgentOptions> = {}) {
  let calls = 0;
  const answer = await runAiAgent({ agentStep: async (_id, messages) => {
    const step = steps[calls++]; assert.ok(step, 'Unexpected extra model request: ' + messages.at(-1)?.content);
    return JSON.stringify(typeof step === 'function' ? step(messages) : step);
  } }, request(project, extra), options(config));
  assert.equal(calls, steps.length);
  return answer;
}

test('agent composes edits, reads the staged project and applies one transaction with stale settings/source protection', async () => {
  const project = fixture(), original = structuredClone(project);
  const response = await run(project, [
    { tasks: [task()], tools: [edit('width', 1600), tool('read', 'readProject', { kind: 'project', path: ['width'] })] },
    messages => { assert.equal(results(messages)[1].data.value, 1600); return { tools: [tool('text', 'editProject', { operations: [{ kind: 'replaceText', lineId: 'line_2', text: '末句修改' }] }), tool('review', 'reviewChanges')] }; },
    finish(['width', 'text']),
  ]);
  const proposal = response.workflow!;
  assert.deepEqual(project, original); assert.equal(proposal.summary.changedLines, 1);
  assert.equal(proposal.tasks![0].status, 'complete');
  const next = applyAiWorkflow(project, proposal); assert.equal(next.width, 1600); assert.equal(aiLines(next)[2].line.text, '末句修改');
  for (const mutate of [(p: Project) => { p.ui.accent = '#abcdef'; }, (p: Project) => { p.scriptText = currentScriptText('// draft\n' + projectToText(p)); }]) {
    const stale = structuredClone(project); mutate(stale); assert.throws(() => applyAiWorkflow(stale, proposal), /工程或文本已修改/);
  }
});

test('tool error rolls back only that step, permits correction and never mutates source', async () => {
  const project = fixture(), original = structuredClone(project);
  const response = await run(project, [
    { tasks: [task()], tools: [edit('bad', -1)] },
    messages => { assert.equal(results(messages)[0].ok, false); return { tools: [edit('fixed', 1600), tool('review', 'reviewChanges')] }; },
    finish(['fixed']),
  ]);
  assert.equal(response.workflow!.project.width, 1600); assert.deepEqual(project, original);
});

test('finishing requires review after the final edit and every registered requirement', async () => {
  await run(fixture(), [
    { tasks: [task(), task('other', '第二项')], tools: [edit('width', 1600), tool('review', 'reviewChanges')] },
    { tools: [edit('again', 1800)] }, finish(['again']),
    messages => { assert.match(messages.at(-1).content, /尚未审阅/); return { tools: [tool('review2', 'reviewChanges')] }; },
    finish(['again']),
    messages => { assert.match(messages.at(-1).content, /覆盖每个/); return { finish: { message: '第二项尚未完成', tasks: [{ id: 'change', status: 'complete', evidence: ['again'] }, { id: 'other', status: 'incomplete', evidence: [] }] } }; },
  ]).then(result => { assert.equal(result.workflow!.tasks![1].status, 'incomplete'); assert.match(result.message, /仍有 1 项未完成/); });
});

test('overwritten evidence and failed later checks cannot be hidden by claiming an earlier success', async () => {
  const response = await run(fixture(), [
    { tasks: [task()], tools: [edit('first', 1600), edit('second', 1800), tool('badCheck', 'checkProject', { checks: [{ path: ['width'], value: 1600 }] }), tool('review', 'reviewChanges')] },
    finish(['first']),
    messages => { assert.match(messages.at(-1).content, /完成证据不成立/); return finish(['second']); },
    messages => { assert.match(messages.at(-1).content, /完成证据不成立/); return { tools: [tool('check', 'checkProject', { checks: [{ path: ['width'], value: 1800 }] })] }; },
    finish(['check']),
  ]);
  assert.equal(response.workflow!.tasks![0].status, 'complete');
});

test('no-op assertions produce zero actual changes and no stale source rewrite', async () => {
  const project = fixture();
  project.scriptText = currentScriptText('// 保留注释\n' + projectToText(project));
  const response = await run(project, [
    { tasks: [task()], tools: [tool('check', 'checkProject', { checks: [{ path: ['width'], value: project.width }] }), tool('review', 'reviewChanges')] }, finish(['check']),
  ]);
  assert.equal(response.workflow!.summary.changes, 0); assert.equal(response.workflow!.summary.changedLines, 0);
  assert.equal(response.workflow!.tasks![0].status, 'unchanged'); assert.deepEqual(response.workflow!.changedFields, []);
});

test('scope blocks hidden dialogue changes, full-story replacement, and readonly tools', async t => {
  const project = fixture(), root = await temporary(t), file = path.join(root, 'story.txt'); await fs.writeFile(file, '旁白：新故事');
  const attachments = await readAiAttachments([file], () => {});
  for (const operation of [tool('bad', 'editProject', { operations: [{ kind: 'replaceText', lineId: 'line_2', text: '越界' }] }), tool('bad', 'importText', { source: file, mode: 'replace' })]) {
    const response = await run(project, [{ tasks: [task()], tools: [operation, tool('review', 'reviewChanges')] }, messages => { assert.equal(results(messages)[0].ok, false); return finish([], 'change', 'incomplete'); }], { lineIds: ['line_0'], attachments });
    assert.equal(response.workflow!.summary.changes, 0);
  }
  await run(project, [{ tasks: [task()], tools: [edit('bad',1600),tool('review','reviewChanges')] }, messages => { assert.match(results(messages)[0].error, /只读/); return finish([], 'change', 'incomplete'); }], { readOnly: true });
});

test('stop after provider response or local tool discards the transaction', async () => {
  for (const point of ['provider', 'tool']) {
    const project = fixture(), original = structuredClone(project); let stopped = false;
    await assert.rejects(runAiAgent({ agentStep: async () => { if (point === 'provider') stopped = true; return JSON.stringify({ tasks: [task()], tools: [edit('width',1600)] }); } }, request(project), options({ check: () => { if (stopped) throw new Error('停止'); }, progress: message => { if (point === 'tool' && message.includes('修改工程')) stopped = true; } })), /停止/);
    assert.deepEqual(project,original);
  }
});

test('transient provider failure retries the same reply without reexecuting a completed tool', async () => {
  let calls=0,mutations=0;
  const result=await runAiAgent({agentStep:async(_id,messages)=>{
    calls++;
    if(calls===1)return JSON.stringify({tasks:[task()],tools:[edit('width',1600),tool('review','reviewChanges')]});
    if(calls===2)throw new AiRetryableError('gateway timeout','timeout');
    assert.equal(results(messages)[0].id,'width');return JSON.stringify(finish(['width']));
  }},request(fixture()),options({progress:message=>{if(message==='AI 正在修改工程…')mutations++;}}));
  assert.equal(calls,3);assert.equal(mutations,1);assert.equal(result.workflow!.project.width,1600);
});

test('attachments page beyond initial limits, resolve descendants and reject sibling/symlink escapes', async t => {
  const root = await temporary(t), directory = path.join(root,'files'); await fs.mkdir(directory);
  const file = path.join(directory,'long.txt'), content = '文本'.repeat(40000); await fs.writeFile(file, content);
  await fs.writeFile(path.join(root,'secret.txt'),'outside');
  const attachments = await readAiAttachments([directory],()=>{}), source = await resolveAiSource(file,attachments,()=>{});
  let offset = 0, read = '';
  do { const page: any = await readAiAttachmentPage(source,offset,100,undefined,()=>{}); read += page.text; offset = page.nextOffset; } while (offset !== undefined);
  assert.equal(read,content);
  await assert.rejects(resolveAiSource(path.join(root,'secret.txt'),attachments,()=>{}),/明确引用/);
  await assert.rejects(resolveAiSource(root,attachments,()=>{}),/明确引用/);
  const link = path.join(directory,'escape'); await fs.symlink(root,link,'junction');
  await assert.rejects(resolveAiSource(path.join(link,'secret.txt'),attachments,()=>{}),/链接/);
});

test('import text then add meaningful chapter boundaries and settings in the same loop', async t => {
  const root=await temporary(t), file=path.join(root,'正文.txt'), project=fixture();
  await fs.writeFile(file,'旁白：清晨出发。\n旁白：天色暗了，终于到达旅店。');
  const response=await run(project,[
    {tasks:[task()],tools:[tool('import','importText',{source:file,mode:'replace'}),tool('read','readScript')]},
    messages=>{assert.match(results(messages)[1].data.text,/清晨出发/);return {tools:[tool('chapters','editScript',{patches:[{before:'旁白：清晨出发。',after:'# 章节：启程\n# 小章节：清晨\n旁白：清晨出发。'},{before:'旁白：天色暗了，终于到达旅店。',after:'# 章节：抵达\n# 小章节：旅店\n旁白：天色暗了，终于到达旅店。'}]}),edit('setting',1600),tool('review','reviewChanges')]};},
    finish(['chapters','setting']),
  ],{attachments:await readAiAttachments([file],()=>{})});
  assert.deepEqual(response.workflow!.project.chapters.map(c=>c.name),['启程','抵达']); assert.equal(response.workflow!.project.width,1600);
  assert.deepEqual(aiLines(response.workflow!.project).map(({line})=>line.text),['清晨出发。','天色暗了，终于到达旅店。']);
});

test('multiple portraits plus settings use actual imported ids, preserve dialogue and register previews for copy/reference imports', async t => {
  const root = await temporary(t), image = path.join(root,'图片 2.png'), folder = path.join(root,'琼华'); await fs.mkdir(folder);
  await fs.writeFile(image,'fang'); await fs.writeFile(path.join(folder,'通常.png'),'q-normal'); await fs.writeFile(path.join(folder,'开心.png'),'q-happy');
  for (const mode of ['copy','reference'] as const) {
    const project=fixture(227), dest=path.join(root,mode); await fs.mkdir(dest);
    project.resourceSettings = { ...project.resourceSettings, importMode:mode } as Project['resourceSettings'];
    project.assets=[{id:'old',kind:'image',name:'旧图',path:'assets/old.png'}];
    project.characters=['方知宥','琼华'].map((name,i)=>({id:'actor'+i,name,color:'#ffffff',defaultExpressionId:'normal'+i,expressions:[{id:'normal'+i,name:'通常',assetId:'old'},{id:'think'+i,name:'思考',assetId:'old'}]}));
    aiLines(project)[0].line.speakerId='actor0'; aiLines(project)[1].line.speakerId='actor1';
    project.scriptText=currentScriptText('// 注释\n'+projectToText(project));
    const original=structuredClone(project); let step=0;
    const sequence=[
      {tasks:[task('fang','替换方知宥'),task('qiong','替换琼华'),task()],tools:[tool('fangImport','importAssets',{sources:[image],category:'portrait'},['fang']),tool('qiongImport','importAssets',{sources:[folder],category:'portrait'},['qiong'])]},
      {tools:[tool('fangBind','bindPortraits',{bindings:[{characterId:'actor0',mode:'replace',importId:'fangImport'}]},['fang']),tool('qiongBind','bindPortraits',{bindings:[{characterId:'actor1',mode:'replace',importId:'qiongImport'}]},['qiong']),edit('setting',1600),tool('review','reviewChanges')]},
      {finish:{message:'台词修改 0 句',tasks:[{id:'fang',status:'complete',evidence:['fangBind']},{id:'qiong',status:'complete',evidence:['qiongBind']},{id:'change',status:'complete',evidence:['setting']}]}}
    ];
    const service=new AiService({file:path.join(dest,'config.json'),vault:{isEncryptionAvailable:()=>false,encryptString:()=>Buffer.alloc(0),decryptString:()=>''},fetch:async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(sequence[step++])}}]}))});
    await service.saveConfig({...defaultAiConfig,baseUrl:'https://fixture.invalid/v1',model:'fixture'});
    const author=new AiAuthoringService(service,{projectDirectory:p=>p.id===project.id?dest:undefined});
    const response=await author.request(request(project,{prompt:'把剧本中的方知宥发立绘图片改为上传的这张，琼华使用上传文件夹中的琼华的立绘，宽度1600',attachmentPaths:[image,folder]}));
    assert.equal(step,3);assert.deepEqual(project,original);
    const proposal=response.workflow!, after=applyAiWorkflow(project,proposal);
    assert.equal(proposal.summary.changedLines,0);assert.equal(proposal.summary.portraitCharacters,2);assert.equal(proposal.summary.importedAssets,3);
    assert.equal(after.scriptText?.content,project.scriptText.content);assert.deepEqual(aiLines(after),aiLines(project));
    assert.ok(proposal.warnings.some(w=>w.includes('思考')));
    for(const portrait of proposal.portraits!) for(const row of portrait.expressions) for(const side of ['before','after'] as const) {
      const image=row[side];if(!image)continue;
      const url=new URL(image.previewUrl!), [token,key]=url.pathname.slice(1).split('/');
      assert.equal(author.previewAsset(token,decodeURIComponent(key))?.asset.id,image.assetId);
      assert.equal(author.previewAsset('invalid',decodeURIComponent(key)),undefined);
    }
  }
});

test('import alone is not evidence that portrait binding has completed', async t => {
  const root=await temporary(t), image=path.join(root,'portrait.png');await fs.writeFile(image,'image');
  const response=await run(fixture(),[
    {tasks:[task()],tools:[tool('import','importAssets',{sources:[image]}),tool('review','reviewChanges')]},finish(['import']),
    messages=>{assert.match(messages.at(-1).content,/完成证据不成立/);return finish(['import'],'change','incomplete');},
  ],{attachments:await readAiAttachments([image],()=>{})},{projectDirectory:()=>path.join(root,'project')});
  assert.equal(response.workflow!.tasks![0].status,'incomplete');
});

test('portrait completion repairs wrong evidence IDs using the actual successful bindings without reimporting', async () => {
  const project=fixture();
  project.assets=['old','fang','qiong'].map(id=>({id,name:id,kind:'image',path:id+'.png'}));
  project.characters=['方知宥','琼华'].map((name,i)=>({id:'actor'+i,name,color:'#ffffff',expressions:[{id:'normal'+i,name:'通常',assetId:'old'}]}));
  const claims=(fang:string[],qiong:string[])=>({finish:{message:'待应用',tasks:[{id:'fang',status:'complete',evidence:fang},{id:'qiong',status:'complete',evidence:qiong}]}});
  const response=await run(project,[
    {tasks:[task('fang','替换方知宥'),task('qiong','替换琼华')],tools:['fang','qiong'].map((id,i)=>tool(id+'Bind','bindPortraits',{bindings:[{characterId:'actor'+i,mode:'replace',images:[{assetId:id,name:'通常'}]}]},[id]))},
    {tools:[tool('review','reviewChanges',{},[])]},
    messages=>{const review=results(messages)[0].data;assert.deepEqual(review.evidence.map((item:any)=>item.availableEvidence),[['fangBind'],['qiongBind']]);return claims(['review'],['missing']);},
    messages=>{const feedback=messages.at(-1).content;assert.match(feedback,/完成证据不成立/);assert.match(feedback,/fangBind/);assert.match(feedback,/qiongBind/);assert.match(feedback,/不存在/);return claims(['fangBind'],['qiongBind']);},
  ]);
  assert.ok(response.workflow!.tasks!.every(task=>task.status==='complete'));
  assert.equal(response.workflow!.summary.portraitCharacters,2);
  assert.equal(response.workflow!.summary.changedLines,0);
});

test('checks require task association at execution and can be corrected before final review', async () => {
  const response=await run(fixture(),[
    {tasks:[task()],tools:[edit('width',1600),tool('unscoped','checkProject',{checks:[{path:['width'],value:1600}]},[])]},
    messages=>{assert.equal(results(messages)[1].ok,false);assert.match(results(messages)[1].error,/taskIds/);return {tools:[tool('checked','checkProject',{checks:[{path:['width'],value:1600}]}),tool('review','reviewChanges')]};},
    finish(['checked']),
  ]);
  assert.equal(response.workflow!.tasks![0].status,'complete');
});

test('evidence compares JSON objects structurally but retains array order and reports stale paths', () => {
  const project=fixture();
  project.characters=[{id:'actor',name:'角色',color:'#ffffff',expressions:[]}];
  const character=project.characters[0];
  const reversed=Object.fromEntries(Object.entries(character).reverse());
  assert.ok(aiEffectHolds(project,{path:['characters',{id:character.id}],value:reversed}));
  assert.equal(aiEffectHolds(project,{path:['nodes'],value:[...project.nodes].reverse()}),false);
  const later=structuredClone(project);later.width=1600;
  const evidence=[{id:'width',name:'editProject',taskIds:['change'],ok:true,mutation:true,complete:true,detail:'',effects:aiProjectEffects(project,later)}];
  const diagnosis=aiTaskEvidenceDiagnostics(project,{id:'change',title:'修改宽度',kind:'change'},evidence,{id:'change',status:'complete',evidence:['width']});
  assert.deepEqual(diagnosis.availableEvidence,[]);assert.match(diagnosis.rejected[0].reason,/width/);
});

test('mixed portrait imports require an explicit source and imports for another task cannot be bound accidentally', async t => {
  const root=await temporary(t), image=path.join(root,'方.png'),folder=path.join(root,'琼华');await fs.mkdir(folder);
  await fs.writeFile(image,'fang');await fs.writeFile(path.join(folder,'通常.png'),'qiong');
  const project=fixture();project.assets=[{id:'old',name:'old',kind:'image',path:'old.png'}];
  project.characters=['方知宥','琼华'].map((name,i)=>({id:'actor'+i,name,color:'#ffffff',expressions:[{id:'normal'+i,name:'通常',assetId:'old'}]}));
  const binding=(id:string,importId:string,source?:string)=>tool(id,'bindPortraits',{bindings:[{characterId:'actor1',mode:'replace',importId,source}]},['qiong']);
  const response=await run(project,[
    {tasks:[task('fang'),task('qiong')],tools:[tool('fangImport','importAssets',{sources:[image]},['fang']),tool('mixed','importAssets',{sources:[image,folder]},['fang','qiong'])]},
    messages=>{assert.equal(results(messages)[0].data.importId,'fangImport');return {tools:[binding('wrongTask','fangImport'),binding('ambiguous','mixed')]};},
    messages=>{assert.match(results(messages)[0].error,/属于其他任务/);assert.match(results(messages)[1].error,/包含多个来源/);return {tools:[binding('badSource','mixed',root)]};},
    messages=>{assert.match(results(messages)[0].error,/不属于/);return {tools:[binding('qiongBind','mixed',folder),tool('fangBind','bindPortraits',{bindings:[{characterId:'actor0',mode:'replace',importId:'fangImport'}]},['fang']),tool('review','reviewChanges',{},[])]};},
    {finish:{message:'待应用',tasks:[{id:'fang',status:'complete',evidence:['fangBind']},{id:'qiong',status:'complete',evidence:['qiongBind']}]}},
  ],{attachments:await readAiAttachments([image,folder],()=>{})},{projectDirectory:()=>path.join(root,'project')});
  const next=response.workflow!.project;
  assert.equal(next.characters[0].expressions.length,1);assert.equal(next.characters[1].expressions.length,1);
  assert.notEqual(next.characters[0].expressions[0].assetId,next.characters[1].expressions[0].assetId);
  assert.ok(response.workflow!.tasks!.every(task=>task.status==='complete'));
});

test('long dialogue editing uses staged project pagination beyond the first 100 lines', async () => {
  const project=fixture(127), passage=project.nodes.find(n=>n.kind==='passage')!;
  const steps:any[]=[{tasks:[task()],tools:[tool('page0','readProject',{kind:'project',path:['nodes',{id:passage.id},'lines'],limit:100})]}];
  const editLines=(items:any[])=>items.map(line=>({kind:'replaceText',lineId:line.id,text:line.text+'！'}));
  steps.push((messages:any[])=>{const data=results(messages)[0].data;assert.equal(data.nextOffset,100);return {tools:[tool('edit0','editProject',{operations:editLines(data.items)}),tool('page1','readProject',{kind:'project',path:['nodes',{id:passage.id},'lines'],offset:100,limit:100})]};});
  steps.push((messages:any[])=>({tools:[tool('edit1','editProject',{operations:editLines(results(messages)[1].data.items)}),tool('review','reviewChanges')]}));
  steps.push(finish(['edit0','edit1']));
  const result=await run(project,steps);assert.equal(result.workflow!.summary.changedLines,127);assert.equal(result.workflow!.summary.lines,127);
});

test('malformed turn and duplicate call IDs never execute a mutation twice', async () => {
  const result=await run(fixture(),[
    {tasks:[task()],tools:[edit('first',1600)]}, {tools:[edit('first',1800),tool('review','reviewChanges')]},
    messages=>{assert.match(results(messages)[0].error,/id已使用/);return finish(['first']);}
  ]);assert.equal(result.workflow!.project.width,1600);
});

test('proposal counts compare final state, including deletions and reverted edits', () => {
  const project=fixture(), next=structuredClone(project);aiLines(next)[0].line.text='新文本';next.characters.push({id:'new',name:'新增',color:'#ffffff',expressions:[]});
  const result=createAiAgentProposal(project,next,[],2);assert.equal(result.summary.changedLines,1);
  assert.equal(createAiAgentProposal(project,project,[],2).summary.changes,0);
});

test('compatible model prose surrounding one JSON tool block executes and ambiguous blocks trigger repair', async () => {
  for(const ambiguous of [false,true]) {
    let round=0;
    const operation=JSON.stringify({tasks:[task()],tools:[edit('width',1600),tool('review','reviewChanges')]});
    const result=await runAiAgent({agentStep:async(_id,messages)=>{
      round++;
      if(round===1)return '我先修改。\n\n```json\n'+operation+'\n```'+(ambiguous?'\n```json\n{}\n```':'');
      if(ambiguous&&round===2){assert.match(messages.at(-1)!.content,/多个代码块/);return operation;}
      return '核对完成。\n```json\n'+JSON.stringify(finish(['width']))+'\n```';
    }},request(fixture()),options());
    assert.equal(result.workflow!.project.width,1600);assert.equal(round,ambiguous?3:2);assert.equal(result.message.includes('```'),false);
  }
});

test('a combined mutation refined by another task still counts the first task as changed; reverted changes are unchanged', () => {
  const original=fixture(), intermediate=structuredClone(original), final=structuredClone(original);
  intermediate.width=1600;intermediate.height=1000;final.width=1600;final.height=1100;
  const evidence=[{id:'both',name:'editProject',taskIds:['change','other'],ok:true,mutation:true,complete:true,detail:'',effects:aiProjectEffects(original,intermediate)}, {id:'check',name:'checkProject',taskIds:['change'],ok:true,mutation:false,complete:true,detail:'',effects:[],checks:[{path:['width'],value:1600}]}];
  assert.equal(aiTaskOutcomes(final,[{id:'change',title:'宽度',kind:'change'}],evidence,[{id:'change',status:'complete',evidence:['check']}],original)[0].status,'complete');
  evidence[1].checks![0].value=original.width;
  assert.equal(aiTaskOutcomes(original,[{id:'change',title:'宽度',kind:'change'}],evidence,[{id:'change',status:'complete',evidence:['check']}],original)[0].status,'unchanged');
});

test('portrait fallback warnings follow the final image after the model refines a binding', async () => {
  const project=fixture();project.assets=['old','normal','happy'].map(id=>({id,name:id,kind:'image',path:id+'.png'}));
  project.characters=[{id:'actor',name:'甲',color:'#ffffff',defaultExpressionId:'think',expressions:[{id:'think',name:'思考',assetId:'old'}]}];
  const response=await run(project,[
    {tasks:[task()],tools:[tool('bind','bindPortraits',{bindings:[{characterId:'actor',mode:'replace',images:[{assetId:'normal',name:'通常'},{assetId:'happy',name:'开心'}]}]})]},
    {tools:[tool('refine','editProject',{operations:[{kind:'editProject',path:['characters',{id:'actor'},'expressions',{id:'think'},'assetId'],action:'set',value:'happy'}]}),tool('review','reviewChanges')]},finish(['refine'])
  ]);
  assert.equal(response.workflow!.project.characters[0].expressions[0].assetId,'happy');
  assert.equal(response.workflow!.warnings.some(warning=>warning.includes('思考')&&warning.includes('暂用')),false);
});

test('readonly review can report existing incomplete UI without treating it as a new schema error', async () => {
  const project=fixture();
  project.ui.components.push({id:'broken',kind:'button',page:'main',text:'按钮',action:'blueprint',x:0,y:0,width:.2,height:.1});
  const response=await run(project,[
    {tasks:[task('inspect','检查当前问题','inspect')],tools:[tool('diagnostics','readProject',{kind:'diagnostics'},['inspect']),tool('review','reviewChanges',{},['inspect'])]},
    finish(['diagnostics'],'inspect')
  ],{readOnly:true});
  assert.equal(response.workflow!.summary.changes,0);assert.equal(response.workflow!.tasks![0].status,'complete');
});

test('retained scene and expression specialists compose with ordinary edits through the real authoring entry', async t => {
  const root=await temporary(t), project=fixture(2);project.assets=[{id:'portrait',name:'立绘',kind:'image',path:'portrait.png'},{id:'night',name:'夜色',kind:'image',path:'night.png'}];
  project.characters=[{id:'actor',name:'甲',color:'#ffffff',expressions:[{id:'normal',name:'通常',assetId:'portrait'}]}];
  for(const {line} of aiLines(project))line.speakerId='actor';
  let round=0, expressions=0, scenes=0;
  const service=new AiService({file:path.join(root,'config.json'),vault:{isEncryptionAvailable:()=>false,encryptString:()=>Buffer.alloc(0),decryptString:()=>''},fetch:async(_url,init)=>{
    const body=JSON.parse(init!.body as string);let reply;
    if(body.messages[0].content.includes('通用工具循环')) {
      reply=round++===0?{tasks:[task()],tools:[tool('scenes','configureScenes'),tool('portraits','addSpeakerPortraits'),tool('expressions','selectExpressions'),edit('width',1600),tool('review','reviewChanges')]}:finish(['width']);
    } else if(body.messages[0].content.includes('表情初选')) {
      expressions++;reply={message:'',operations:aiLines(project).map(({line})=>({kind:'setExpression',lineId:line.id,expressionId:'normal'}))};
    } else {scenes++;reply={operations:[{kind:'setScene',sceneId:project.scenes[0].id,backgroundId:'night'}]};}
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(reply)}}]}));
  }});
  await service.saveConfig({...defaultAiConfig,baseUrl:'https://fixture.invalid/v1',model:'fixture'});
  const response=await new AiAuthoringService(service,{projectDirectory:()=>root}).request(request(project));
  assert.equal(scenes,1);assert.equal(expressions,1);assert.equal(round,2);
  assert.equal(response.workflow!.summary.changedLines,0);assert.equal(response.workflow!.summary.expressions,2);assert.equal(response.workflow!.summary.portraitLines,2);
  assert.equal(response.workflow!.project.width,1600);
});
