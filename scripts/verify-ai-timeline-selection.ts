import { createVisualObject } from '../src/core/visual-object';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { performanceTimeline, arrangePerformanceTimeline } from '../src/core/performance-timeline';
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
const root=path.resolve('.'),output=path.join(root,'artifacts/ai-timeline-selection',new Date().toISOString().replaceAll(':','-')),profile=path.join(output,'profile'),projectFile=path.join(output,'project/project.vns.json');
await fs.mkdir(profile,{recursive:true});
const project=createProject('时间轴选择验证');const object=createVisualObject('group'),child=createVisualObject('text'),sibling=createVisualObject('text');child.text='原始子对象文字';sibling.text='保留兄弟对象文字';object.children=[child,sibling];const graph=blueprintFromPerformance(project,[{kind:'stopMusic',fade:0},object],'时间轴');graph.timelineComponent=true;project.blueprints.push(graph);const model=performanceTimeline(project,graph);arrangePerformanceTimeline(project,graph,model.clips.map((c,i)=>({...c,at:i*1})),model.tracks);const chosen=graph.nodes.find(n=>n.type==='savedAction')!,other=graph.nodes.find(n=>n.type==='stopMusic')!;await saveProject(projectFile,project);let requests=0;
let targetId='';
const mock=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests++;
 const content=body.messages.at(-1).content;
 if(requests<3){const data=JSON.parse(content.slice(content.indexOf('\n{')+1));expect(data.selectedBlueprint.graphId).toBe(graph.id);expect(data.selectedBlueprint.node.id).toBe(targetId);
 if(requests===2){expect(data.selectedBlueprint.selectedObject.instanceId).toBe(child.instanceId);expect(data.selectedBlueprint.selectedObject.path).toEqual([0]);}}
 let editedAction='';if(requests===3){const results=JSON.parse(content.slice(content.indexOf('\n')+1));const action=JSON.parse(results[0].result.value);expect(action.children[0].instanceId).toBe(child.instanceId);action.children[0].text='AI子对象更新';editedAction=JSON.stringify(action);}
 const result=requests===2?{read:[{kind:'project',path:['blueprints',{id:graph.id},'nodes',{id:chosen.id},'properties','action']}],operations:[]}:requests===3?{message:'修改所选子对象文字',operations:[{kind:'editProject',path:['blueprints',{id:graph.id},'nodes',{id:chosen.id},'properties','action'],action:'set',value:editedAction}],editorCommands:['undo','redo','save']}:{message:'修改当前草稿组件',operations:[{kind:'editProject',path:['blueprints',{id:graph.id},'nodes',{id:targetId},'name'],action:'set',value:'AI草稿更新'}],editorCommands:['undo','redo','save']};
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(result)},finish_reason:'stop'}]}));});
mock.listen(0,'127.0.0.1');await once(mock,'listening');
await fs.writeFile(path.join(profile,'ai-settings.json'),JSON.stringify({version:1,config:{...defaultAiConfig,baseUrl:'http://127.0.0.1:'+(mock.address() as {port:number}).port+'/v1',model:'local-mock',rememberKey:false}}));
const server=await createViteServer({root,server:{host:'127.0.0.1',port:0,watch:{ignored:['**/artifacts/**','**/resources/**','**/release/**']}}});await server.listen();
const app=await launchDesktopFixture({root,profile,projectFile,sdkRoot:path.resolve(root,'..'),devUrl:'http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port});const page=await app.firstWindow();let assistant:Page|undefined;
try {
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});const before=await fs.readFile(projectFile,'utf8');
 await page.locator('[data-workspace-tab="blueprint"]').click();await page.getByLabel('演出目标',{exact:true}).selectOption('graph:'+graph.id);targetId=chosen.id;await page.locator('.timeline-clip[data-node-id="'+other.id+'"]').click();await page.locator('.timeline-clip[data-node-id="'+targetId+'"]').click();
 const opened=app.waitForEvent('window');await page.getByRole('button',{name:'AI 助手',exact:true}).click();assistant=await opened;

 await assistant.getByLabel('发给 AI 的内容',{exact:true}).fill('将当前选中的组件文字改成AI草稿更新');await assistant.getByRole('button',{name:'发送',exact:true}).click();
 await assistant.getByRole('button',{name:'应用选中的 1 项修改',exact:true}).click();const canvas=page.locator('.timeline-clip[data-node-id="'+targetId+'"]');await expect(canvas).toContainText('AI草稿更新');expect(await fs.readFile(projectFile,'utf8')).toBe(before);
 await assistant.getByRole('button',{name:'撤销上次修改',exact:true}).click();await expect(canvas).not.toContainText('AI草稿更新');
 await assistant.getByRole('button',{name:'重做上次修改',exact:true}).click();await expect(canvas).toContainText('AI草稿更新');
 await page.locator('.lifetime-span[data-instance-id="'+child.instanceId+'"]').click();await expect(assistant.locator('.ai-workspace-context')).toContainText('子对象：'+child.name);await assistant.getByLabel('发给 AI 的内容',{exact:true}).fill('将当前选中的子对象文字改成AI子对象更新，保持兄弟对象和外层组合不变');await assistant.getByRole('button',{name:'发送',exact:true}).click();await assistant.getByRole('button',{name:'应用选中的 1 项修改',exact:true}).last().click();
 await expect(page.getByLabel('对象文字',{exact:true})).toHaveValue('AI子对象更新');expect(requests).toBe(3);expect(await fs.readFile(projectFile,'utf8')).toBe(before);
 await assistant.getByRole('button',{name:'撤销上次修改',exact:true}).last().click();await expect(page.getByLabel('对象文字',{exact:true})).toHaveValue(child.text);
 await assistant.getByRole('button',{name:'重做上次修改',exact:true}).last().click();await expect(page.getByLabel('对象文字',{exact:true})).toHaveValue('AI子对象更新');
 await page.locator('.lifetime-span[data-instance-id="'+sibling.instanceId+'"]').click();await expect(page.getByLabel('对象文字',{exact:true})).toHaveValue(sibling.text);
 await page.getByRole('button',{name:'保存工程',exact:true}).click();
 await expect.poll(async()=>JSON.parse(await fs.readFile(projectFile,'utf8')).blueprints.find((g:any)=>g.id===graph.id).nodes.find((n:any)=>n.id===chosen.id).properties.action).toContain('AI子对象更新');
 const saved=JSON.parse(await fs.readFile(projectFile,'utf8')),savedGraph=saved.blueprints.find((g:any)=>g.id===graph.id),savedAction=JSON.parse(savedGraph.nodes.find((n:any)=>n.id===chosen.id).properties.action);
 const expected=structuredClone(object);expected.children![0].text='AI子对象更新';expect(savedAction).toEqual(expected);expect(savedGraph.nodes.find((n:any)=>n.id===other.id)).toEqual(other);
 await page.screenshot({path:path.join(output,'verified.png')});
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',externalApiCalled:false,checks:['时间轴片段选择传递至独立助手','片段修改与撤销重做','组合子对象携带独立ID与实际路径','子对象读取后准确修改及撤销重做','兄弟对象与外层属性保持不变','磁盘未自动保存、显式保存正确落盘']}));console.log(output);
} catch(error){await page.screenshot({path:path.join(output,'failure.png')});await assistant?.screenshot({path:path.join(output,'failure-assistant.png')});throw error;}
finally {await page.evaluate(()=>window.studio?.controlPreview?.('stop')).catch(()=>undefined);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();await server.close();mock.closeAllConnections();mock.close();}
