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
const root=path.resolve('.'),output=path.join(root,'artifacts/ai-preview-control',new Date().toISOString().replaceAll(':','-')),profile=path.join(output,'profile'),projectFile=path.join(output,'project/project.vns.json');
await fs.mkdir(profile,{recursive:true});
const project=createProject('参数选择验证');project.variables=[{id:'one',name:'目标甲',type:'number',initial:1,persistent:false},{id:'two',name:'目标乙',type:'number',initial:2,persistent:false}];await saveProject(projectFile,project);let requests=0;
const mock=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests++;
 const result={message:'提供试玩控制',operations:[],editorCommands:['preview','pausePreview','resumePreview','stopPreview']};
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(result)},finish_reason:'stop'}]}));});
mock.listen(0,'127.0.0.1');await once(mock,'listening');
await fs.writeFile(path.join(profile,'ai-settings.json'),JSON.stringify({version:1,config:{...defaultAiConfig,baseUrl:'http://127.0.0.1:'+(mock.address() as {port:number}).port+'/v1',model:'local-mock',rememberKey:false}}));
const server=await createViteServer({root,server:{host:'127.0.0.1',port:0,watch:{ignored:['**/artifacts/**','**/resources/**','**/release/**']}}});await server.listen();
const app=await launchDesktopFixture({root,profile,projectFile,sdkRoot:path.resolve(root,'..'),devUrl:'http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port});const page=await app.firstWindow();let assistant:Page|undefined;
try {
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});const before=await fs.readFile(projectFile,'utf8');
 const opened=app.waitForEvent('window');await page.getByRole('button',{name:'AI 助手',exact:true}).click();assistant=await opened;

 await assistant.getByLabel('发给 AI 的内容',{exact:true}).fill('提供启动、暂停、继续和停止试玩');await assistant.getByRole('button',{name:'发送',exact:true}).click();
 await assistant.getByRole('button',{name:'暂停试玩',exact:true}).click();await expect(assistant.locator('body')).toContainText('试玩尚未运行');
 await assistant.getByRole('button',{name:'启动试玩',exact:true}).click();await expect(page.locator('.play-workspace')).toHaveAttribute('data-preview-state','running',{timeout:60000});
 await assistant.getByRole('button',{name:'暂停试玩',exact:true}).click();await expect(page.locator('.play-workspace')).toHaveAttribute('data-preview-state','paused',{timeout:15000});await expect(assistant.locator('body')).toContainText('试玩已暂停');
 await assistant.getByRole('button',{name:'继续试玩',exact:true}).click();await expect(page.locator('.play-workspace')).toHaveAttribute('data-preview-state','running',{timeout:15000});await expect(assistant.locator('body')).toContainText('试玩已继续');
 await assistant.getByRole('button',{name:'停止试玩',exact:true}).click();await expect(page.locator('.play-workspace')).toHaveCount(0);expect(await fs.readFile(projectFile,'utf8')).toBe(before);
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',externalApiCalled:false,nativeRuntime:true,checks:['未运行暂停返回取消','启动真实原生试玩','暂停确认paused','继续确认running','停止返回编辑','磁盘未改变']}));console.log(output);
} catch(error){await page.screenshot({path:path.join(output,'failure.png')});await assistant?.screenshot({path:path.join(output,'failure-assistant.png')});throw error;}
finally {await page.evaluate(()=>window.studio?.controlPreview?.('stop')).catch(()=>undefined);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();await server.close();mock.closeAllConnections();mock.close();}
