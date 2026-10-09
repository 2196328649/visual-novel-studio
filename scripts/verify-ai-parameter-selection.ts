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
const root=path.resolve('.'),output=path.join(root,'artifacts/ai-parameter-selection',new Date().toISOString().replaceAll(':','-')),profile=path.join(output,'profile'),projectFile=path.join(output,'project/project.vns.json');
await fs.mkdir(profile,{recursive:true});
const project=createProject('参数选择验证');project.variables=[{id:'one',name:'目标甲',type:'number',initial:1,persistent:false},{id:'two',name:'目标乙',type:'number',initial:2,persistent:false}];await saveProject(projectFile,project);let requests=0;
const mock=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests++;
 const content=body.messages.at(-1).content,data=JSON.parse(content.slice(content.indexOf('\n{')+1));expect(data.selectedParameter.setId).toBe('parameters_story');expect(data.selectedParameter.variable.id).toBe('two');
 const result={message:'修改选中参数初始值',operations:[{kind:'setInitial',variableId:'two',value:99}],editorCommands:['undo','redo']};
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(result)},finish_reason:'stop'}]}));});
mock.listen(0,'127.0.0.1');await once(mock,'listening');
await fs.writeFile(path.join(profile,'ai-settings.json'),JSON.stringify({version:1,config:{...defaultAiConfig,baseUrl:'http://127.0.0.1:'+(mock.address() as {port:number}).port+'/v1',model:'local-mock',rememberKey:false}}));
const server=await createViteServer({root,server:{host:'127.0.0.1',port:0,watch:{ignored:['**/artifacts/**','**/resources/**','**/release/**']}}});await server.listen();
const app=await launchDesktopFixture({root,profile,projectFile,sdkRoot:path.resolve(root,'..'),devUrl:'http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port});const page=await app.firstWindow();let assistant:Page|undefined;
try {
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});const before=await fs.readFile(projectFile,'utf8');
 await page.locator('[data-workspace-tab="variables"]').click();await page.locator('.parameter-set-card').filter({hasText:'故事状态'}).click();
 const opened=app.waitForEvent('window');await page.getByRole('button',{name:'AI 助手',exact:true}).click();assistant=await opened;

 await expect(assistant.locator('.ai-workspace-context')).toContainText('参数：目标甲');await page.locator('.parameter-table button').filter({hasText:'目标乙'}).click();await expect(assistant.locator('.ai-workspace-context')).toContainText('参数：目标乙');
 await assistant.getByLabel('发给 AI 的内容',{exact:true}).fill('修改选中的参数初始值为99');await assistant.getByRole('button',{name:'发送',exact:true}).click();await assistant.getByRole('button',{name:'应用选中的 1 项修改',exact:true}).click();
 const row=page.locator('.parameter-table button').filter({hasText:'目标乙'});await expect(row).toContainText('99');await assistant.getByRole('button',{name:'撤销上次修改',exact:true}).click();await expect(row).not.toContainText('99');await assistant.getByRole('button',{name:'重做上次修改',exact:true}).click();await expect(row).toContainText('99');expect(await fs.readFile(projectFile,'utf8')).toBe(before);
 await page.locator('.parameter-sets-workspace').getByRole('button',{name:'参数集',exact:true}).click();await expect(assistant.locator('.ai-workspace-context')).not.toContainText('参数集：');
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',externalApiCalled:false,checks:['内置参数集及默认选择同步','助手打开后换选同步','修改准确变量','撤销重做','返回列表清空选择','磁盘未自动保存']}));console.log(output);
} catch(error){await page.screenshot({path:path.join(output,'failure.png')});await assistant?.screenshot({path:path.join(output,'failure-assistant.png')});throw error;}
finally {await page.evaluate(()=>window.studio?.controlPreview?.('stop')).catch(()=>undefined);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();await server.close();mock.closeAllConnections();mock.close();}
