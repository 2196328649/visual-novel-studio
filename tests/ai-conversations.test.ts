import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { aiConversationSchema, aiHistorySchema, conversationContext, conversationMarkdown, type SavedAiMessage } from '../src/core/ai-conversations';
import { createProject } from '../src/core/model';
import { defaultAiConfig } from '../src/core/ai';
import { AiConversationStore } from '../src/desktop/ai-conversations';
import { AiService } from '../src/desktop/ai-service';
import { AiAuthoringService } from '../src/desktop/ai-authoring';
import { readAiStream } from '../src/desktop/ai-stream';

async function temp(t:TestContext) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'vns-conversation-'));
  t.after(async()=>{assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(root,{recursive:true,force:true});});return root;
}
const message=(n:number,extra:Partial<SavedAiMessage>={}):SavedAiMessage=>({id:'m_'+n,role:n%2?'assistant':'user',content:'内容 '+n,createdAt:n,...extra});
const session=(id='chat_a',projectId='project_a')=>aiConversationSchema.parse({version:1,id,projectId,title:'旧会话',createdAt:1,updatedAt:1,draft:'还没有发送',messages:[message(0),message(1,{proposalNote:'修改已应用'})]});
const frame=(value:unknown)=>'data: '+JSON.stringify(value)+'\r\n\r\n';
const delta=(content:string)=>frame({choices:[{delta:{content}}]});
function sse(text:string,bytes=3){const data=new TextEncoder().encode(text);let offset=0;return new Response(new ReadableStream({pull(controller){if(offset>=data.length){controller.close();return;}controller.enqueue(data.slice(offset,offset+=bytes));}}),{headers:{'Content-Type':'text/event-stream'}});}

test('conversation store restores project-specific history, draft, active selection, pin and deletion',async t=>{
  const root=await temp(t),store=new AiConversationStore(root),a=session();
  await store.save(a);await store.save({...session('chat_b'),title:'另一会话',pinned:true});
  await store.save(session('chat_a','project_b'));
  const reopened=new AiConversationStore(root);
  assert.equal((await reopened.list('project_a')).activeId,'chat_b');
  assert.equal((await reopened.list('project_b')).items.length,1);
  assert.equal((await reopened.read('project_a','chat_a')).draft,'还没有发送');
  await reopened.save({...a,title:'改名'});
  const list=await reopened.list('project_a');
  assert.equal(list.activeId,'chat_a');assert.equal(list.items[0].id,'chat_b');
  await reopened.delete('project_a','chat_a');
  assert.equal((await reopened.list('project_a')).activeId,'chat_b');
  assert.equal((await reopened.read('project_b','chat_a')).messages.length,2);
});
test('serialized writes keep the latest draft and omit unrecognized payloads',async t=>{
  const root=await temp(t),store=new AiConversationStore(root);
  await Promise.all(Array.from({length:8},(_,i)=>store.save({...session(),draft:String(i),apiKey:'must-not-persist'} as any)));
  assert.equal((await store.read('project_a','chat_a')).draft,'7');
  assert.ok(!(await fs.readFile(path.join(root,'project_a','chat_a.json'),'utf8')).includes('must-not-persist'));
});
test('invalid and foreign records are preserved but excluded, paths cannot escape store',async t=>{
  const root=await temp(t),store=new AiConversationStore(root);await store.save(session());
  await fs.writeFile(path.join(root,'project_a','bad.json'),'{broken');
  await fs.writeFile(path.join(root,'project_a','foreign.json'),JSON.stringify(session('foreign','project_b')));
  assert.equal((await store.list('project_a')).unreadable,2);
  assert.equal(await fs.readFile(path.join(root,'project_a','bad.json'),'utf8'),'{broken');
  await assert.rejects(store.read('../outside','chat_a'));
  await assert.rejects(store.read('project_a','../outside'));
  await assert.rejects(store.read('project_a','foreign'),/不属于/);
});
test('context preserves more than ten turns, bounds long history and excludes unsuccessful replies',()=>{
  const full=Array.from({length:80},(_,i)=>message(i,{content:'x'.repeat(16000)+i}));
  full[0]=message(0,{content:'始终使用中文',pinned:true});
  full[38]=message(38,{content:'中途固定要求',pinned:true});
  full.push(message(81,{content:'失败不应作为事实',status:'failed'}));
  const context=conversationContext(full),text=JSON.stringify(context.history);
  assert.ok(text.includes('始终使用中文'));assert.ok(text.includes('中途固定要求'));assert.ok(!text.includes('失败不应作为事实'));
  aiHistorySchema.parse(context.history);assert.ok(text.length<75000);assert.ok(context.earlier>0);
  assert.equal(conversationContext(Array.from({length:24},(_,i)=>message(i))).history.length,24);
});
test('all forty fixed early messages take precedence over other excerpts and keep chronological order',()=>{
  const messages=Array.from({length:160},(_,i)=>message(i,{pinned:i>=50&&i<90}));
  const content=conversationContext(messages).history[0].content;
  for(let i=50;i<90;i++)assert.ok(content.includes('内容 '+i));
  assert.ok(content.indexOf('内容 50')<content.indexOf('内容 89'));
});
test('Markdown export retains conversation text and application status',()=>{
  const text=conversationMarkdown(session());assert.ok(text.includes('# 旧会话'));assert.ok(text.includes('内容 0'));assert.ok(text.includes('修改已应用'));
});
test('SSE handles UTF-8, CRLF split at every byte, and final usage-only frames',async()=>{
  const chunks:string[]=[];
  const result=await readAiStream(sse(delta('你好')+delta('，世界')+frame({choices:[{delta:{},finish_reason:'stop'}]})+frame({choices:[],usage:{prompt_tokens:12,prompt_tokens_details:{cached_tokens:0}}})+'data: [DONE]\r\n\r\n',1),text=>chunks.push(text));
  assert.equal(result.choices[0].message.content,'你好，世界');assert.equal(chunks.length,2);assert.equal((result.usage as any).prompt_tokens,12);
});
test('SSE rejects premature close and refusal, DONE cancels an otherwise open connection',async()=>{
  await assert.rejects(readAiStream(sse(delta('半句')),()=>{}),/提前结束/);
  await assert.rejects(readAiStream(sse(frame({choices:[{delta:{refusal:'no'}}]})),()=>{}),/拒绝/);
  let cancelled=false;
  const response=new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(delta('完成')+'data: [DONE]\n\n'));},cancel(){cancelled=true;}}));
  assert.equal((await readAiStream(response,()=>{})).choices[0].message.content,'完成');assert.ok(cancelled);
});

async function service(t:TestContext,respond:(body:any,init:RequestInit)=>Response|Promise<Response>,chunk?:(id:string,text:string)=>void){
  const root=await temp(t),value=new AiService({file:path.join(root,'config.json'),vault:{isEncryptionAvailable:()=>false,encryptString:()=>Buffer.alloc(0),decryptString:()=>''},fetch:async(_url,init)=>respond(JSON.parse(init!.body as string),init!),chunk});
  await value.saveConfig({...defaultAiConfig,baseUrl:'https://test.invalid/v1',model:'test',rememberKey:false,apiKey:'secret-token'});return value;
}
const request=()=>({id:'request_1',project:createProject('测试'),prompt:'生成故事需要注意什么？',lineIds:[],mode:'chat' as const});
test('chat bypasses the planner, streams safe text, and reports actual cache hits',async t=>{
  let calls=0;const chunks:string[]=[];
  const ai=await service(t,(body)=>{calls++;assert.equal(body.stream,true);assert.equal(body.response_format,undefined);assert.ok(body.messages.some((m:any)=>m.content==='旧要求'));assert.equal(body.messages[1].content,'旧要求');return sse(delta('你好 secret-')+delta('token 完成')+frame({choices:[{finish_reason:'stop'}],usage:{prompt_tokens:200,completion_tokens:20,prompt_tokens_details:{cached_tokens:128}}})+'data: [DONE]\n\n',11);},(_id,text)=>chunks.push(text));
  const author=new AiAuthoringService(ai,{projectDirectory:()=>undefined});ai.beginUsage('request_1');
  const result=await author.request({...request(),history:[{role:'user',content:'旧要求'}]});
  assert.equal(calls,1);assert.deepEqual(result.operations,[]);assert.equal(result.message,'你好 [已隐藏密钥] 完成');
  assert.ok(chunks.every(text=>!text.includes('secret-token')&&!text.endsWith('secret-')));
  assert.deepEqual(ai.takeUsage('request_1'),{requests:1,reportedRequests:1,cacheReportedRequests:1,inputTokens:200,outputTokens:20,cachedTokens:128});
});
test('usage distinguishes missing cache fields from zero hits and aggregates compatible responses',async t=>{
  const stats=[undefined,{prompt_tokens:10,completion_tokens:2,prompt_tokens_details:{cached_tokens:0}},{input_tokens:20,output_tokens:3,input_tokens_details:{cached_tokens:5}},{prompt_tokens:30,prompt_cache_hit_tokens:10}];let n=0;
  const ai=await service(t,()=>new Response(JSON.stringify({choices:[{message:{content:'ok'}}],usage:stats[n++]})));
  ai.beginUsage('request_1');await ai.chat(request());assert.equal(ai.takeUsage('request_1')!.cacheReportedRequests,0);
  ai.beginUsage('request_1');await ai.chat(request());await ai.chat(request());await ai.chat(request());
  assert.deepEqual(ai.takeUsage('request_1'),{requests:3,reportedRequests:3,cacheReportedRequests:3,inputTokens:60,outputTokens:5,cachedTokens:15});
  assert.throws(()=>ai.beginUsage('../invalid'));
  ai.beginUsage('request_1');assert.throws(()=>ai.beginUsage('request_1'),/正在进行/);ai.takeUsage('request_1');
});
test('stream cancellation retains emitted text and nonstream compatibility can be selected',async t=>{
  let started!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve;});
  const ai=await service(t,(body,init)=>{
    if(!body.stream){assert.equal(body.stream_options,undefined);return new Response(JSON.stringify({choices:[{message:{content:'普通回复'}}]}));}
    return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(delta('已收到')));init.signal!.addEventListener('abort',()=>c.error(Error('aborted')));started();}}),{headers:{'Content-Type':'text/event-stream'}});
  });
  const running=ai.chat(request());await ready;ai.cancel('request_1');await assert.rejects(running,/已停止/);
  await ai.saveConfig({...defaultAiConfig,baseUrl:'https://test.invalid/v1',model:'test',streamChat:false});
  assert.equal((await ai.chat(request())).message,'普通回复');
});
