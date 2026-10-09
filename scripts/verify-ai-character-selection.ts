import { createBlueprintGraph, blueprintNodeDefaults } from '../src/core/blueprint';
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
const root=path.resolve('.'),output=path.join(root,'artifacts/ai-character-selection',new Date().toISOString().replaceAll(':','-')),profile=path.join(output,'profile'),projectFile=path.join(output,'project/project.vns.json');
await fs.mkdir(profile,{recursive:true});
const project=createProject('参数选择验证');project.characters=[{id:'one',name:'同名',color:'#1b8a78',expressions:[]},{id:'two',name:'同名',color:'#1b8a78',expressions:[]}];await saveProject(projectFile,project);let requests=0;
const mock=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests++;
 const content=body.messages.at(-1).content,data=JSON.parse(content.slice(content.indexOf('\n{')+1));expect(data.selectedContent).toEqual([{key:'character:two',id:'two',kind:'character',name:'同名'}]);
 const result={message:'修改选中参数初始值',operations:[{kind:'editProject',path:['characters',{id:'two'},'name'],action:'set',value:'修改目标'}],editorCommands:['undo','redo']};
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(result)},finish_reason:'stop'}]}));});
mock.listen(0,'127.0.0.1');await once(mock,'listening');
await fs.writeFile(path.join(profile,'ai-settings.json'),JSON.stringify({version:1,config:{...defaultAiConfig,baseUrl:'http://127.0.0.1:'+(mock.address() as {port:number}).port+'/v1',model:'local-mock',rememberKey:false}}));
const server=await createViteServer({root,server:{host:'127.0.0.1',port:0,watch:{ignored:['**/artifacts/**','**/resources/**','**/release/**']}}});await server.listen();
const app=await launchDesktopFixture({root,profile,projectFile,sdkRoot:path.resolve(root,'..'),devUrl:'http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port});const page=await app.firstWindow();let assistant:Page|undefined;
try {
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});const before=await fs.readFile(projectFile,'utf8');
 await page.locator('[data-workspace-tab="characters"]').click();await page.locator('[data-character-id="one"]').click();
 const opened=app.waitForEvent('window');await page.getByRole('button',{name:'AI 助手',exact:true}).click();assistant=await opened;

 await expect(assistant.locator('.ai-workspace-context')).toContainText('选中角色：同名');await page.locator('[data-character-id="two"]').click();
 await assistant.getByLabel('发给 AI 的内容',{exact:true}).fill('重命名选中的角色为修改目标');await assistant.getByRole('button',{name:'发送',exact:true}).click();await assistant.getByRole('button',{name:'应用选中的 1 项修改',exact:true}).click();
 const row=page.locator('[data-character-id="two"]');await expect(row).toContainText('修改目标');await expect(page.locator('[data-character-id="one"]')).toContainText('同名');await assistant.getByRole('button',{name:'撤销上次修改',exact:true}).click();await expect(row).toContainText('同名');await assistant.getByRole('button',{name:'重做上次修改',exact:true}).click();await expect(row).toContainText('修改目标');expect(await fs.readFile(projectFile,'utf8')).toBe(before);
 await page.locator('[data-workspace-tab="script"]').click();await expect(assistant.locator('.ai-workspace-context')).not.toContainText('选中角色：');
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',externalApiCalled:false,checks:['助手打开后换选同名角色同步','只修改所选角色','撤销重做','离开角色页清除上下文','磁盘不变']}));console.log(output);
} catch(error){await page.screenshot({path:path.join(output,'failure.png')});await assistant?.screenshot({path:path.join(output,'failure-assistant.png')});throw error;}
finally {await page.evaluate(()=>window.studio?.controlPreview?.('stop')).catch(()=>undefined);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();await server.close();mock.closeAllConnections();mock.close();}
