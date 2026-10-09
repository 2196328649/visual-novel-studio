import { expect, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { defaultAiConfig } from '../src/core/ai';
import { launchDesktopFixture } from './lib/desktop-fixture';

const root=path.resolve('.'),output=path.join(root,'artifacts/ai-conversations',new Date().toISOString().replaceAll(':','-'));
await fs.mkdir(output,{recursive:true});
const payloads:any[]=[],checks:string[]=[];
let waitForStop=false,failNext=false;
const server=createServer(async(req,res)=>{
  if(req.url!=='/v1/chat/completions'){res.writeHead(404).end();return;}
  let raw='';for await(const part of req)raw+=part;
  const body=JSON.parse(raw);payloads.push(body);
  if(failNext){failNext=false;res.writeHead(400,{'Content-Type':'application/json'}).end(JSON.stringify({error:{message:'验证失败后重试'}}));return;}
  if(!body.stream){
    const raw=body.messages.at(-1).content,context=JSON.parse(raw.slice(raw.indexOf('\n{')+1));
    const operations=raw.includes('验证历史建议')?[{kind:'replaceText',lineId:context.lines[0].id,text:'验证修改已经应用。'}]:[];
    res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({choices:[{message:{content:JSON.stringify({message:'已检查当前工程，可继续追问。',operations})}}]}));return;
  }
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  res.write('data: '+JSON.stringify({choices:[{delta:{content:'正在结合上下文'}}]})+'\n\n');
  const timer=setTimeout(()=>{
    res.write('data: '+JSON.stringify({choices:[{delta:{content:'回答。\n\n**建议**\n- 保持人物动机一致\n```text\n这是示例对白\n```'},finish_reason:'stop'}]})+'\n\n');
    res.end('data: '+JSON.stringify({choices:[],usage:{prompt_tokens:256,completion_tokens:40,prompt_tokens_details:{cached_tokens:payloads.length===1?0:128}}})+'\n\ndata: [DONE]\n\n');
  },waitForStop?15000:800);
  res.on('close',()=>clearTimeout(timer));
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const apiRoot=`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`;
const app=await launchDesktopFixture({root,profile:path.join(output,'profile')});
const originalClipboard=await app.evaluate(({clipboard})=>clipboard.readText());
let assistant:Page|undefined;
try{
  const page=await app.firstWindow();
  await expect(page.locator('.project-title strong')).not.toBeEmpty({timeout:60000});
  await page.evaluate(config=>window.studio!.saveAiConfig!(config),{...defaultAiConfig,baseUrl:apiRoot,model:'本地验证模型',apiKey:'test-only',rememberKey:false});
  const open=async()=>{const next=app.waitForEvent('window');await page.getByRole('button',{name:'AI 助手',exact:true}).click();assistant=await next;await expect(assistant.getByLabel('发给 AI 的内容',{exact:true})).toBeEnabled();return assistant;};
  let chat=await open();
  await chat.getByLabel('AI 对话模式').selectOption('chat');
  const send=async(text:string)=>{await chat.getByLabel('发给 AI 的内容',{exact:true}).fill(text);await chat.getByRole('button',{name:'发送',exact:true}).click();};
  const complete=async()=>{await expect(chat.getByRole('button',{name:'停止生成',exact:true})).toHaveCount(0,{timeout:20000});};
  const first='故事发生在江南，主角名叫小青。';
  await send(first);
  await expect(chat.locator('.ai-message.assistant')).toContainText('正在结合上下文');
  await complete();
  await expect(chat.locator('.ai-usage')).toContainText('缓存命中 0 token');
  expect((await chat.locator('.ai-conversation-sidebar').boundingBox())!.width).toBeLessThan(280);
  expect((await chat.locator('.ai-session-main').boundingBox())!.width).toBeGreaterThan(400);
  expect(payloads[0].stream_options.include_usage).toBe(true);
  await chat.screenshot({path:path.join(output,'chat-stream-and-usage.png')});
  checks.push('流式文本、Markdown 和实际零缓存统计');

  await chat.getByLabel('发给 AI 的内容',{exact:true}).fill('尚未发送的草稿');
  const closed=chat.waitForEvent('close');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('#ai-assistant'))!.close());
  await closed;
  chat=await open();
  await expect(chat.getByLabel('发给 AI 的内容',{exact:true})).toHaveValue('尚未发送的草稿');
  await expect(chat.locator('.ai-message')).toHaveCount(2);
  await expect(chat.getByLabel('AI 对话模式')).toHaveValue('chat');
  await send('她之前叫什么名字？');await complete();
  expect(payloads.at(-1).messages.some((m:any)=>m.content===first)).toBe(true);
  expect(payloads.at(-1).messages.some((m:any)=>m.role==='assistant'&&m.content.includes('示例对白'))).toBe(true);
  await expect(chat.locator('.ai-usage').last()).toContainText('缓存命中 128 token');
  checks.push('原生关闭窗口后恢复记录、草稿、模式，追问实际携带上下文');

  await chat.getByRole('button',{name:'重命名会话',exact:true}).click();
  await chat.getByLabel('会话名称').fill('江南人物设定');
  await chat.getByRole('button',{name:'保存名称',exact:true}).click();
  await chat.getByRole('button',{name:'置顶会话',exact:true}).click();
  await chat.getByRole('button',{name:'新建会话',exact:true}).click();
  await expect(chat.locator('.ai-message')).toHaveCount(0);
  await chat.getByLabel('AI 对话模式').selectOption('chat');
  await send('另一个完全独立的故事');await complete();
  expect(payloads.at(-1).messages.some((m:any)=>m.content===first)).toBe(false);
  await expect(chat.getByRole('complementary',{name:'会话列表',exact:true})).toBeVisible();
  await expect(chat.locator('.ai-conversation-sidebar nav button')).toHaveCount(2);
  await chat.getByLabel('搜索历史会话').fill('江南');
  await expect(chat.locator('.ai-conversation-sidebar nav button')).toHaveCount(1);
  await chat.screenshot({path:path.join(output,'history-search.png')});
  await chat.locator('.ai-conversation-sidebar nav button').click();
  await expect(chat.locator('.ai-message')).toHaveCount(4);
  checks.push('常驻会话列表、新会话独立、重命名、置顶、按正文和名称搜索、切回旧会话继续聊');

  await chat.locator('.ai-message.user').first().getByRole('button',{name:'编辑后重发'}).click();
  await send('主角改叫小蓝，继续这个设定。');await complete();
  await expect(chat.locator('.ai-session-bar')).toContainText('分支');
  await expect(chat.locator('.ai-message')).toHaveCount(2);
  expect(payloads.at(-1).messages.some((m:any)=>m.content===first)).toBe(false);
  await chat.locator('.ai-message.assistant').getByRole('button',{name:'复制',exact:true}).click();
  await expect.poll(()=>app.evaluate(({clipboard})=>clipboard.readText())).toContain('示例对白');
  await chat.locator('.ai-message.user').getByRole('button',{name:'固定上下文',exact:true}).click();
  await expect(chat.locator('.ai-message.user').getByRole('button',{name:'取消固定',exact:true})).toHaveAttribute('aria-pressed','true');
  const exportFile=path.join(output,'conversation.md');
  await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},exportFile);
  await chat.getByRole('button',{name:'导出会话 Markdown',exact:true}).click();
  await expect(chat.getByRole('status')).toContainText('聊天记录已导出');
  expect(await fs.readFile(exportFile,'utf8')).toContain('主角改叫小蓝');
  await chat.screenshot({path:path.join(output,'conversation-branch.png')});
  checks.push('编辑后重发创建分支、复制、固定上下文、导出 Markdown');

  const retryAttachment=path.join(output,'重试附件.txt');await fs.writeFile(retryAttachment,'重试时应保留的附件内容');
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},retryAttachment);
  await chat.getByRole('button',{name:'添加文件',exact:true}).click();
  await expect(chat.locator('.ai-attachments')).toContainText('重试附件.txt');
  waitForStop=true;await send('这条消息将手动停止');
  await expect(chat.locator('.ai-message.assistant').last()).toContainText('正在结合上下文');
  await chat.getByRole('button',{name:'停止生成',exact:true}).click();await complete();
  await expect(chat.locator('.ai-message.assistant').last()).toContainText('已停止');
  await expect(chat.locator('.ai-message.assistant').last()).toContainText('正在结合上下文');
  waitForStop=false;
  const savedCurrent=()=>chat.evaluate(async()=>{const context=await window.studio!.getAiContext!();const list=await window.studio!.listAiConversations!(context!.project.id);return {list,conversation:await window.studio!.readAiConversation!(context!.project.id,list.activeId!)};});
  await expect.poll(async()=>(await savedCurrent()).conversation.messages.at(-1)?.status).toBe('stopped');
  const retryBefore=await savedCurrent();
  await chat.getByRole('button',{name:'移除附件 重试附件.txt',exact:true}).click();
  await chat.locator('.ai-message.assistant').last().getByRole('button',{name:'重试',exact:true}).click();await complete();
  await expect(chat.locator('.ai-message')).toHaveCount(4);
  await expect(chat.locator('.ai-message.assistant').last()).not.toContainText('已停止');
  await expect.poll(async()=>(await savedCurrent()).conversation.messages.at(-1)?.status).toBeUndefined();
  const retryAfter=await savedCurrent();
  expect(retryAfter.list.activeId).toBe(retryBefore.list.activeId);
  expect(retryAfter.list.items.map(item=>item.id).sort()).toEqual(retryBefore.list.items.map(item=>item.id).sort());
  expect(retryAfter.conversation.messages.map(item=>item.id)).toEqual(retryBefore.conversation.messages.map(item=>item.id));
  expect(retryAfter.conversation.title).toBe(retryBefore.conversation.title);
  expect(retryAfter.conversation.messages.filter(item=>item.role==='user').at(-1)?.attachmentPaths).toEqual([retryAttachment]);
  expect(JSON.stringify(payloads.at(-1).messages)).toContain('重试时应保留的附件内容');
  // Regenerating an older answer must keep subsequent questions and replies.
  await chat.getByLabel('发给 AI 的内容',{exact:true}).fill('保留尚未发送的草稿');
  await chat.locator('.ai-message.assistant').first().getByRole('button',{name:'重新生成',exact:true}).click();await complete();
  await expect(chat.locator('.ai-message')).toHaveCount(4);
  await expect(chat.locator('.ai-message.user').last()).toContainText('这条消息将手动停止');
  await expect(chat.getByLabel('发给 AI 的内容',{exact:true})).toHaveValue('保留尚未发送的草稿');
  expect(payloads.at(-1).messages.some((item:any)=>item.content==='这条消息将手动停止')).toBe(false);
  failNext=true;
  await chat.locator('.ai-message.assistant').first().getByRole('button',{name:'重新生成',exact:true}).click();await complete();
  await expect(chat.locator('.ai-message.assistant').first()).toContainText('验证失败后重试');
  await chat.locator('.ai-message.assistant').first().getByRole('button',{name:'重试',exact:true}).click();await complete();
  await expect(chat.locator('.ai-message')).toHaveCount(4);
  await expect(chat.locator('.ai-message.assistant').first()).not.toContainText('回复未完成');
  waitForStop=true;
  await chat.locator('.ai-message.assistant').last().getByRole('button',{name:'重新生成',exact:true}).click();
  await expect(chat.getByRole('button',{name:'停止生成',exact:true})).toBeVisible();
  const retryClosed=chat.waitForEvent('close');await chat.getByRole('button',{name:'关闭 AI 助手',exact:true}).click();await retryClosed;
  waitForStop=false;chat=await open();
  await expect(chat.locator('.ai-message')).toHaveCount(4);
  await expect(chat.locator('.ai-message.assistant').last()).toContainText('已停止');
  expect((await savedCurrent()).list.activeId).toBe(retryBefore.list.activeId);
  await chat.locator('.ai-message.assistant').last().getByRole('button',{name:'重试',exact:true}).click();await complete();
  checks.push('失败/停止重试和重新生成均留在当前会话，保留消息编号、后续对话和草稿，关闭期间正确保存停止状态');

  const context=await chat.evaluate(()=>window.studio!.getAiContext!());
  await page.evaluate(context=>window.studio!.updateAiContext!({...context!,project:{...context!.project,id:'project_other_test',name:'另一个工程'}}),context);
  await expect(chat.locator('.ai-workspace-context')).toContainText('另一个工程');
  await expect(chat.getByLabel('发给 AI 的内容',{exact:true})).toBeEnabled();
  await expect(chat.locator('.ai-message')).toHaveCount(0);
  await page.evaluate(context=>window.studio!.updateAiContext!(context!),context);
  await expect(chat.locator('.ai-message')).toHaveCount(4);
  checks.push('切换工程隔离记录并恢复上次会话');

  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('#ai-assistant'))!.setContentSize(420,600));
  await chat.screenshot({path:path.join(output,'compact-420.png')});
  expect(await chat.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await expect(chat.getByRole('button',{name:'发送',exact:true})).toBeVisible();
  await chat.getByRole('button',{name:'删除当前会话',exact:true}).click();
  await chat.getByRole('button',{name:'确认删除会话',exact:true}).click();
  await expect(chat.locator('.ai-delete-confirm')).toHaveCount(0);
  checks.push('420 像素窗口无横向溢出、删除会话可用');

  await chat.getByLabel('AI 对话模式').selectOption('edit');
  await send('验证历史建议');await complete();
  await expect(chat.getByRole('button',{name:'应用选中的 1 项修改',exact:true})).toBeVisible();
  await chat.getByRole('button',{name:'应用选中的 1 项修改',exact:true}).click();
  await expect(chat.locator('.ai-proposal').last()).toContainText('已应用修改');
  await expect(chat.locator('.ai-usage').last()).toContainText('缓存用量未返回');
  const proposalClosed=chat.waitForEvent('close');
  await chat.getByRole('button',{name:'关闭 AI 助手',exact:true}).click();await proposalClosed;
  chat=await open();
  await expect(chat.locator('.ai-message.assistant').last()).toContainText('修改建议已应用（1 项）');
  await expect(chat.locator('.ai-proposal')).toHaveCount(0);
  await chat.screenshot({path:path.join(output,'restored-applied-proposal.png')});
  checks.push('协助编辑仍能生成并应用建议，重开保留执行状态且不恢复旧执行按钮，缺失缓存统计明确显示');
  await fs.writeFile(path.join(output,'result.json'),JSON.stringify({checks,requests:payloads.length},null,2));
  console.log(JSON.stringify({output,checks,requests:payloads.length},null,2));
}catch(error){await assistant?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});console.error('Verification output:',output);throw error;}
finally{await app.evaluate(({clipboard},text)=>clipboard.writeText(text),originalClipboard).catch(()=>{});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>{});await app.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
