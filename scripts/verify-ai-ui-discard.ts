import { createUiParameterBinding } from '../src/core/ui-logic';
import { previewUiLogic } from '../src/core/ui-logic-preview';
import { compileProject } from '../src/runtime/compiler';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { expect, type Page } from '@playwright/test';
import { createServer as createViteServer } from 'vite';
import { createProject } from '../src/core/model';
import { defaultAiConfig } from '../src/core/ai';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
const root=path.resolve('.'),output=path.join(root,'artifacts/ai-ui-discard',new Date().toISOString().replaceAll(':','-')),profile=path.join(output,'profile'),projectFile=path.join(output,'project/project.vns.json');
await fs.mkdir(profile,{recursive:true});
const project=createProject('组合动作原工程');await saveProject(projectFile,project);let requests=0;
let targetId='';
const mock=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests++;
 const result={message:'可在主编辑器选择是否放弃未保存修改',operations:[],editorCommands:['discardUiDraft']};
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(result)},finish_reason:'stop'}]}));});
mock.listen(0,'127.0.0.1');await once(mock,'listening');
await fs.writeFile(path.join(profile,'ai-settings.json'),JSON.stringify({version:1,config:{...defaultAiConfig,baseUrl:'http://127.0.0.1:'+(mock.address() as {port:number}).port+'/v1',model:'local-mock',rememberKey:false}}));
const server=await createViteServer({root,server:{host:'127.0.0.1',port:0,watch:{ignored:['**/artifacts/**','**/resources/**','**/release/**']}}});await server.listen();
const app=await launchDesktopFixture({root,profile,projectFile,sdkRoot:path.resolve(root,'..'),devUrl:'http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port});const page=await app.firstWindow();let assistant:Page|undefined;
try {
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});const before=await fs.readFile(projectFile,'utf8');
 await page.locator('[data-workspace-tab="ui"]').click();const add=async()=>{await page.getByRole('button',{name:'添加组件',exact:true}).click();await page.getByLabel('添加组件菜单',{exact:true}).getByRole('button',{name:'文字',exact:true}).click();};await add();
 const opened=app.waitForEvent('window');await page.getByRole('button',{name:'AI 助手',exact:true}).click();assistant=await opened;
 await assistant.getByLabel('发给 AI 的内容',{exact:true}).fill('放弃未保存的界面修改');await assistant.getByRole('button',{name:'发送',exact:true}).click();const command=assistant.getByRole('button',{name:'放弃界面修改…',exact:true}),dialog=page.getByRole('dialog',{name:'保存界面修改',exact:true});
 await command.click();await expect(dialog).toBeVisible();await expect(page.locator('[data-hierarchy-id]')).toHaveCount(1);await dialog.getByRole('button',{name:'取消',exact:true}).click();await expect(assistant.locator('body')).toContainText('界面草稿保留');await expect(page.locator('[data-hierarchy-id]')).toHaveCount(1);
 await command.click();await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:'不保存',exact:true}).click();await expect(assistant.locator('body')).toContainText('未保存的界面修改已放弃');await expect(page.locator('[data-hierarchy-id]')).toHaveCount(0);expect(await fs.readFile(projectFile,'utf8')).toBe(before);
 await command.click();await expect(assistant.locator('body')).toContainText('没有未保存的界面修改');await expect(dialog).toHaveCount(0);
 await add();await command.click();await dialog.getByRole('button',{name:'保存并继续',exact:true}).click();await expect(assistant.locator('body')).toContainText('已按选择保存界面');await expect(page.locator('[data-hierarchy-id]')).toHaveCount(1);expect(JSON.parse(await fs.readFile(projectFile,'utf8')).ui.components).toHaveLength(1);
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',externalApiCalled:false,checks:['操作先显示保存选择且草稿仍在','取消保留草稿并反馈取消','不保存恢复工程版本且磁盘不变','无草稿返回明确取消','选择保存落盘且如实反馈未放弃']}));console.log(output);
} catch(error){await page.screenshot({path:path.join(output,'failure.png')});await assistant?.screenshot({path:path.join(output,'failure-assistant.png')});throw error;}
finally {await page.evaluate(()=>window.studio?.controlPreview?.('stop')).catch(()=>undefined);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();await server.close();mock.closeAllConnections();mock.close();}
