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
const root=path.resolve('.'),output=path.join(root,'artifacts/ai-blueprint-selection',new Date().toISOString().replaceAll(':','-')),profile=path.join(output,'profile'),projectFile=path.join(output,'project/project.vns.json');
await fs.mkdir(profile,{recursive:true});
const project=createProject('组合动作原工程');const graph=createBlueprintGraph('function','测试蓝图');const chosen=blueprintNodeDefaults('literal',0);chosen.name='同名';chosen.x=0;chosen.y=200;const other=blueprintNodeDefaults('literal',1);other.name='同名';other.x=400;other.y=200;graph.nodes.push(chosen,other);project.blueprints.push(graph);await saveProject(projectFile,project);let requests=0;
let targetId='';
const mock=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests++;
 const content=body.messages.at(-1).content,data=JSON.parse(content.slice(content.indexOf('\n{')+1));expect(data.selectedBlueprint.graphId).toBe(graph.id);expect(data.selectedBlueprint.node.id).toBe(targetId);
 const result={message:'修改当前草稿组件',operations:[{kind:'editProject',path:['blueprints',{id:graph.id},'nodes',{id:targetId},'name'],action:'set',value:'AI草稿更新'}],editorCommands:['undo','redo','save']};
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(result)},finish_reason:'stop'}]}));});
mock.listen(0,'127.0.0.1');await once(mock,'listening');
await fs.writeFile(path.join(profile,'ai-settings.json'),JSON.stringify({version:1,config:{...defaultAiConfig,baseUrl:'http://127.0.0.1:'+(mock.address() as {port:number}).port+'/v1',model:'local-mock',rememberKey:false}}));
const server=await createViteServer({root,server:{host:'127.0.0.1',port:0,watch:{ignored:['**/artifacts/**','**/resources/**','**/release/**']}}});await server.listen();
const app=await launchDesktopFixture({root,profile,projectFile,sdkRoot:path.resolve(root,'..'),devUrl:'http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port});const page=await app.firstWindow();let assistant:Page|undefined;
try {
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});const before=await fs.readFile(projectFile,'utf8');
 await page.locator('[data-workspace-tab="blueprint"]').click();await page.getByLabel('演出目标',{exact:true}).selectOption('graph:'+graph.id);targetId=chosen.id;await page.getByRole('button',{name:'框选全部节点',exact:true}).click();await page.locator('.react-flow__node[data-id="'+other.id+'"] .graph-node-title').click();await page.locator('.react-flow__node[data-id="'+targetId+'"] .graph-node-title').click();
 const opened=app.waitForEvent('window');await page.getByRole('button',{name:'AI 助手',exact:true}).click();assistant=await opened;

 await assistant.getByLabel('发给 AI 的内容',{exact:true}).fill('将当前选中的组件文字改成AI草稿更新');await assistant.getByRole('button',{name:'发送',exact:true}).click();
 await assistant.getByRole('button',{name:'应用选中的 1 项修改',exact:true}).click();const canvas=page.locator('.react-flow__node[data-id="'+targetId+'"]');await expect(canvas).toContainText('AI草稿更新');expect(await fs.readFile(projectFile,'utf8')).toBe(before);
 await assistant.getByRole('button',{name:'撤销上次修改',exact:true}).click();await expect(canvas).toContainText('同名');
 await assistant.getByRole('button',{name:'重做上次修改',exact:true}).click();await expect(canvas).toContainText('AI草稿更新');
 await expect(page.locator('.react-flow__node[data-id="'+other.id+'"]')).toContainText('同名');
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',externalApiCalled:false,checks:['实际节点选择传递至独立助手','两个同名节点仅修改选中对象','撤销重做','磁盘未自动保存']}));console.log(output);
} catch(error){await page.screenshot({path:path.join(output,'failure.png')});await assistant?.screenshot({path:path.join(output,'failure-assistant.png')});throw error;}
finally {await page.evaluate(()=>window.studio?.controlPreview?.('stop')).catch(()=>undefined);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();await server.close();mock.closeAllConnections();mock.close();}
