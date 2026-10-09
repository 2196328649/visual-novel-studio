import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { expect,type Page } from '@playwright/test';
import { aiUiPageSelectionFixture } from './lib/ai-ui-page-selection-fixture';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { defaultAiConfig } from '../src/core/ai';
import { compileProject } from '../src/runtime/compiler';

const root=path.resolve('.'),output=path.join(root,'artifacts/ai-ui-page-selection',new Date().toISOString().replaceAll(':','-')),profile=path.join(output,'profile'),projectFile=path.join(output,'project.vns.json');
await fs.mkdir(profile,{recursive:true});const project=aiUiPageSelectionFixture(),original=JSON.stringify(project);await fs.writeFile(projectFile,original);
const gates=[0,1].map(()=>{let release!:()=>void;const promise=new Promise<void>(resolve=>release=resolve);return {release,promise};});
const captures:any[]=[],serverErrors:string[]=[];let calls=0;
const server=createServer(async(req,res)=>{try{
 let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw),last=body.messages.at(-1).content,call=calls++,index=Math.floor(call/2);let result;
 if(call%2===0){const data=JSON.parse(last.slice(last.indexOf('\n{')+1)),selected=data.selectedUiPage;captures.push(selected);assert.equal(data.selectedUiComponent,undefined);assert.equal(data.selectedBlueprint,undefined);assert.equal(selected.selectionUnavailable,false);
  assert.deepEqual({pageId:selected.pageId,uiInstanceId:selected.uiInstanceId,mode:selected.mode},index===0?{pageId:'ui:preferences',uiInstanceId:'child',mode:'events'}:{pageId:'first',uiInstanceId:undefined,mode:'events'});
  await gates[index].promise;result={operations:[],read:[{kind:'project',path:[...selected.settingsPath,'background']}]};
 }else{assert.match(last,index===0?/#28313a/:/#102030/);result={message:'修改发送请求时所选页面的底色。',operations:[{kind:'editProject',path:[...captures[index].settingsPath,'background'],action:'set',value:index===0?'#354657':'#789abc'}]};}
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(result)},finish_reason:'stop'}]}));
}catch(error){serverErrors.push(String(error));res.statusCode=500;res.end(String(error));}});
server.listen(0,'127.0.0.1');await once(server,'listening');
await fs.writeFile(path.join(profile,'ai-settings.json'),JSON.stringify({version:1,config:{...defaultAiConfig,baseUrl:'http://127.0.0.1:'+(server.address() as {port:number}).port+'/v1',model:'local-mock',rememberKey:false}}));
const app=await launchDesktopFixture({root,projectFile,profile}),page=await app.firstWindow();page.setDefaultTimeout(10000);let assistant:Page|undefined;
const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const button=(name:string)=>page.getByRole('button',{name,exact:true});
const mode=(name:string)=>page.getByLabel('界面编辑模式',{exact:true}).getByRole('button',{name,exact:true});
const context=()=>assistant!.evaluate(()=>window.studio!.getAiContext!());
const current=async()=>(await context())!.project;
const background=async()=> (await current()).ui.instances!.find(i=>i.id==='child')!.pages!.preferences!.background;
const first=async()=> (await current()).ui.customPages.find(p=>p.id==='first')!;
const send=async()=>{await assistant!.getByLabel('发给 AI 的内容',{exact:true}).fill('把当前界面页面的底色改成指定颜色，其他内容不变。');await assistant!.getByRole('button',{name:'发送',exact:true}).click();};
const apply=async()=>{const proposal=assistant!.getByRole('region',{name:'AI 建议修改'}).last();await expect(proposal).toContainText('待应用修改 · 1 项');await proposal.getByRole('button',{name:'应用选中的 1 项修改',exact:true}).click();await expect(proposal).toContainText('已应用修改');};
const save=async()=>{await button('保存界面').click();await expect(page.locator('.workspace-toolbar').filter({has:button('保存界面')})).toContainText('已保存');await expect(button('保存界面')).toBeDisabled();};
try{
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});await page.locator('[data-workspace-tab="ui"]').click();await mode('事件图').click();await page.getByLabel('事件图页面').selectOption('ui:preferences');
 await expect(button('创建页面事件图')).toBeVisible();const opened=app.waitForEvent('window');await button('AI 助手').click();assistant=await opened;
 await expect.poll(async()=>(await context())?.selectedUiPage).toEqual({pageId:'ui:preferences',uiInstanceId:'child',mode:'events'});await expect(assistant.getByLabel('当前界面页面')).toContainText('设置 · 同名方案 · 事件图');
 await mode('设计').click();for(const id of ['parent','','child']){await page.getByLabel('选择界面实例').selectOption(id);await expect.poll(async()=>(await context())?.selectedUiPage).toEqual({pageId:'ui:preferences',uiInstanceId:id||'base',mode:'design'});}await expect(button('保存界面')).toBeDisabled();await mode('事件图').click();
 await send();await expect.poll(()=>captures.length).toBe(1);await page.getByLabel('事件图页面').selectOption('ui:save');await expect.poll(async()=>(await context())?.selectedUiPage?.pageId).toBe('ui:save');gates[0].release();await apply();await expect.poll(background).toBe('#354657');
 assert.equal((await current()).ui.pages!.preferences!.background,'#18212a');assert.deepEqual((await current()).ui.instances![0],project.ui.instances![0]);assert.equal(await fs.readFile(projectFile,'utf8'),original);
 await mode('事件图').focus();await page.keyboard.press('Control+z');await expect.poll(background).toBe('#28313a');await page.keyboard.press('Control+y');await expect.poll(background).toBe('#354657');await save();
 await page.getByLabel('事件图页面').selectOption('ui:preferences');await mode('设计').click();await expect(page.locator('.ui-canvas')).toHaveCSS('background-color','rgb(53, 70, 87)');
 await mode('事件图').click();await page.getByLabel('事件图页面').selectOption('first');await mode('设计').click();await page.getByRole('checkbox',{name:'阻止下层交互',exact:true}).uncheck();await mode('事件图').click();
 await expect.poll(async()=>(await context())?.selectedUiPage).toEqual({pageId:'first',mode:'events'});assert.equal((await first()).modal,false);await send();await expect.poll(()=>captures.length).toBe(2);
 await mode('设计').click();await page.getByLabel('选择自定义页面').selectOption('second');await expect.poll(async()=>(await context())?.selectedUiPage).toEqual({pageId:'second',mode:'design'});gates[1].release();await apply();
 await expect.poll(async()=>(await first()).background).toBe('#789abc');assert.deepEqual((await current()).ui.customPages[1],project.ui.customPages[1]);assert.equal((await first()).modal,false);
 await mode('设计').focus();await page.keyboard.press('Control+z');await expect.poll(async()=>(await first()).background).toBe('#102030');assert.equal((await first()).modal,false);await page.keyboard.press('Control+y');await expect.poll(async()=>(await first()).background).toBe('#789abc');
 await page.getByLabel('选择自定义页面').selectOption('first');await expect(page.locator('.ui-canvas')).toHaveCSS('background-color','rgb(120, 154, 188)');
 await save();const saved=JSON.parse(await fs.readFile(projectFile,'utf8'));assert.deepEqual(compileProject(saved).diagnostics.filter(d=>d.severity==='error'),[]);assert.equal(saved.ui.customPages[0].modal,false);assert.equal(saved.ui.customPages[0].background,'#789abc');assert.deepEqual(saved.ui.customPages[1],project.ui.customPages[1]);assert.deepEqual(saved.ui.pages,project.ui.pages);assert.equal(saved.blueprints.length,0);
 await assistant.screenshot({path:path.join(output,'assistant-current-page.png')});await page.screenshot({path:path.join(output,'applied-page.png')});
 await page.locator('[data-workspace-tab="assets"]').click();await expect.poll(async()=>(await context())?.selectedUiPage).toBeUndefined();await expect(assistant.getByLabel('当前界面页面')).toHaveCount(0);
 await page.reload();await expect(page.locator('.project-title strong')).toHaveText(project.name);await page.locator('[data-workspace-tab="ui"]').click();await mode('事件图').click();await page.getByLabel('事件图页面').selectOption('first');await mode('设计').click();await expect(page.locator('.ui-canvas')).toHaveCSS('background-color','rgb(120, 154, 188)');await expect(button('保存界面')).toBeDisabled();
 assert.equal(calls,4);assert.deepEqual(errors,[]);assert.deepEqual(serverErrors,[]);await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',renderer:'dist',externalApiCalled:false,captures,checks:['无控件和事件图的页面仍有完整AI页面上下文','设计与事件图模式及父/子/默认方案同步','发送请求后切换标准页仍读改原子方案设置','同名自定义页发送后切换仍按原ID读改','真实应用撤销重做保留手动UI草稿','父方案、基础设置及另一自定义页保持不变','保存重开与实际画布底色','离开UI清理页面上下文']},null,2));
}catch(error){await fs.writeFile(path.join(output,'failure.json'),JSON.stringify({error:String(error),serverErrors,captures},null,2));await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>undefined);await assistant?.screenshot({path:path.join(output,'failure-assistant.png')}).catch(()=>undefined);throw error;}
finally{gates.forEach(g=>g.release());await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();server.closeAllConnections();server.close();console.log(output);}
