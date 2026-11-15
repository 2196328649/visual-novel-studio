import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { aiConversationSchema, type AiConversation } from '../src/core/ai-conversations';
import { AiConversationStore } from '../src/desktop/ai-conversations';
import { aiConversationBackupSchema, writeAiConversationBackup } from '../src/desktop/ai-conversation-backup';

async function temporary(t: TestContext) {
  const root=path.resolve('artifacts/ai-assistant-review-2026-11-15/backup-unit');
  await fs.mkdir(root,{recursive:true});
  const directory=await fs.mkdtemp(path.join(root,'case-'));
  t.after(async()=>{
    const relative=path.relative(root,path.resolve(directory));
    assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));
    await fs.rm(directory,{recursive:true,force:true});
  });
  return directory;
}

const conversation=():AiConversation=>aiConversationSchema.parse({
  version:1,id:'chat_recovery',projectId:'project_recovery',title:'完整会话',createdAt:1,updatedAt:2,
  mode:'chat',draft:'还没有发送的下一条草稿',messages:[
    {id:'request_user',role:'user',content:'用户要求',createdAt:1,pinned:true},
    {id:'request_assistant',role:'assistant',content:'生成中的完整片段',context:'给模型的摘要',createdAt:2,status:'stopped',proposalNote:'历史建议未应用'},
  ],
});

test('conversation recovery backup retains the full reply, draft and metadata instead of context excerpts',async t=>{
  const root=await temporary(t),file=path.join(root,'conversation.json'),source=conversation();
  await writeAiConversationBackup(file,source);
  assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')),source);
  assert.deepEqual(await fs.readdir(root),['conversation.json']);
});

test('recovery accepts messages exceeding the ordinary count and per-message text limits',()=>{
  const source=conversation();
  source.messages=Array.from({length:2001},(_,index)=>({id:'message_'+index,role:'assistant',content:index===2000?'全文'.repeat(1000001):'消息',createdAt:index}));
  assert.equal(aiConversationSchema.safeParse(source).success,false);
  const restored=aiConversationBackupSchema.parse(source);
  assert.equal(restored.messages.length,2001);
  assert.equal(restored.messages[2000].content,source.messages[2000].content);
  assert.equal(restored.draft,source.draft);
});

test('a conversation rejected by the 24 MiB store limit can still be fully backed up',async t=>{
  const root=await temporary(t),source=conversation(),store=new AiConversationStore(path.join(root,'store'));
  const content='完整中文'.repeat(160000);
  source.messages=Array.from({length:14},(_,index)=>({id:'message_'+index,role:'assistant',content:content+index,createdAt:index}));
  assert.ok(Buffer.byteLength(JSON.stringify(source))>24*1024*1024);
  assert.throws(()=>store.save(source),/保存上限/);
  const file=path.join(root,'recovered.json');
  await writeAiConversationBackup(file,source);
  const recovered=JSON.parse(await fs.readFile(file,'utf8')) as AiConversation;
  assert.equal(recovered.messages.length,source.messages.length);
  assert.equal(recovered.messages.at(-1)?.content,source.messages.at(-1)?.content);
  assert.equal(recovered.draft,source.draft);
});

test('failed recovery replacement keeps an existing destination and removes its temporary file',async t=>{
  const root=await temporary(t),destination=path.join(root,'occupied.json');
  await fs.mkdir(destination);
  await fs.writeFile(path.join(destination,'keep.txt'),'keep');
  await assert.rejects(writeAiConversationBackup(destination,conversation()));
  assert.equal(await fs.readFile(path.join(destination,'keep.txt'),'utf8'),'keep');
  assert.deepEqual(await fs.readdir(root),['occupied.json']);
});

test('recovery validates the conversation identity and strips unrecognized runtime data',async t=>{
  const root=await temporary(t),file=path.join(root,'conversation.json'),source=conversation();
  const withExtras={...source,apiKey:'never-persist-configuration',messages:source.messages.map(message=>({...message,workflow:{executable:true}}))};
  await writeAiConversationBackup(file,withExtras);
  const recovered=JSON.parse(await fs.readFile(file,'utf8'));
  assert.deepEqual(recovered,source);
  await assert.rejects(writeAiConversationBackup(file,{...source,projectId:'../foreign'}));
  assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')),source);
});
