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
const root=path.resolve('.'),output=path.join(root,'artifacts/ai-incomplete-ui',new Date().toISOString().replaceAll(':','-')),profile=path.join(output,'profile'),projectFile=path.join(output,'project/project.vns.json');
await fs.mkdir(profile,{recursive:true});
const project=createProject('组合动作原工程');await saveProject(projectFile,project);let requests=0;
let targetId='';
const mock=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests++;

 const result={message:'检查当前草稿',operations:[],editorCommands:['validate']};
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(result)},finish_reason:'stop'}]}));});
mock.listen(0,'127.0.0.1');await once(mock,'listening');
await fs.writeFile(path.join(profile,'ai-settings.json'),JSON.stringify({version:1,config:{...defaultAiConfig,baseUrl:'http://127.0.0.1:'+(mock.address() as {port:number}).port+'/v1',model:'local-mock',rememberKey:false}}));
const server=await createViteServer({root,server:{host:'127.0.0.1',port:0,watch:{ignored:['**/artifacts/**','**/resources/**','**/release/**']}}});await server.listen();
const app=await launchDesktopFixture({root,profile,projectFile,sdkRoot:path.resolve(root,'..'),devUrl:'http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port});const page=await app.firstWindow();let assistant:Page|undefined;
try {
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});const before=await fs.readFile(projectFile,'utf8');
 await page.locator('[data-workspace-tab="ui"]').click();await page.getByRole('button',{name:'添加组件',exact:true}).click();await page.getByLabel('添加组件菜单',{exact:true}).getByRole('button',{name:'按钮',exact:true}).click();await page.getByLabel('点击行为',{exact:true}).selectOption('blueprint');
 const opened=app.waitForEvent('window');await page.getByRole('button',{name:'AI 助手',exact:true}).click();assistant=await opened;
 await assistant.getByLabel('发给 AI 的内容',{exact:true}).fill('检查当前工程');await assistant.getByRole('button',{name:'发送',exact:true}).click();await assistant.getByRole('button',{name:'检查工程',exact:true}).click();await expect(assistant.locator('.ai-editor-commands')).toContainText('界面按钮调用的蓝图不存在');await expect(page.locator('.problems-panel')).toContainText('界面按钮调用的蓝图不存在');
 await page.getByLabel('点击行为',{exact:true}).selectOption('start');await assistant.getByRole('button',{name:'检查工程',exact:true}).click();await expect(assistant.locator('.ai-editor-commands')).not.toContainText('界面按钮调用的蓝图不存在');expect(await fs.readFile(projectFile,'utf8')).toBe(before);
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',externalApiCalled:false,checks:['检查当前未保存按钮未绑定警告','主问题面板同步草稿警告','修正后重新检查清除错误','检查不写磁盘']}));console.log(output);
} catch(error){await page.screenshot({path:path.join(output,'failure.png')});await assistant?.screenshot({path:path.join(output,'failure-assistant.png')});throw error;}
finally {await page.evaluate(()=>window.studio?.controlPreview?.('stop')).catch(()=>undefined);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();await server.close();mock.closeAllConnections();mock.close();}
