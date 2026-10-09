import { promises as fs } from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { expect, type Page, type Route } from '@playwright/test';
import { createProject, type BlueprintGraph } from '../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { defaultAiConfig } from '../src/core/ai';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';

const root=path.resolve('.'),output=path.join(root,'artifacts/ai-blueprint-editor',new Date().toISOString().replaceAll(':','-'));
const profile=path.join(output,'profile'),projectFile=path.join(output,'project/project.vns.json');await fs.mkdir(profile,{recursive:true});
const project=createProject('AI 蓝图画布操作验收');project.variables.push({id:'counter',name:'计数',type:'number',initial:0,persistent:false});
function graph(kind:'function'|'ui',name:string) {
 const graph=createBlueprintGraph(kind,name),a=blueprintNodeDefaults('setVariable'),b=blueprintNodeDefaults('setVariable');a.properties={variableId:'counter',value:1};b.properties={variableId:'counter',value:2};a.name=b.name='同名节点';
 graph.nodes.push(a,b);for(const [index,node] of graph.nodes.entries())Object.assign(node,{x:1200-index*50,y:500-index*30});connectBlueprintPins(graph,graph.nodes[0].id,'exec',a.id,'exec_in');connectBlueprintPins(graph,a.id,'exec_out',b.id,'exec_in');return graph;
}
const first=graph('function','蓝图甲'),second=graph('function','蓝图乙'),uiGraph=graph('ui','界面逻辑'),timeline=createBlueprintGraph('effect','时间轴');timeline.timelineComponent=true;
project.blueprints=[first,second,uiGraph,timeline];project.ui.components=[{id:'ui_caption',kind:'text',page:'main',text:'界面文字',x:.1,y:.1,width:.5,height:.1}];synchronizeBlueprintSignatures(project);await saveProject(projectFile,project);
const commands=['arrangeBlueprint','frameBlueprint','collapseBlueprintNodes','expandBlueprintNodes','showBlueprintConnections','showBlueprintInterface','showBlueprintNodeProperties','undo','redo','openScript'];
const targets=[{kind:'blueprint',graphId:first.id,nodeId:first.nodes[2].id},{kind:'blueprint',graphId:second.id,nodeId:second.nodes[2].id},{kind:'blueprint',graphId:timeline.id},{kind:'ui',componentId:'ui_caption',advanced:true}];
const calls:any[]=[];
const server=createServer(async(req,res)=>{
 if(req.url==='/v1/chat/completions'){let raw='';for await(const chunk of req)raw+=chunk;calls.push(JSON.parse(raw));res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({message:'可操作当前蓝图画布。',operations:[],editorCommands:commands,editorTargets:targets})},finish_reason:'stop'}]}));return;}
 try{const url=new URL(req.url??'/','http://localhost'),relative=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname),file=path.resolve(root,'dist','.'+relative);if(!file.startsWith(path.join(root,'dist')+path.sep))throw new Error('path');res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await fs.readFile(file));}catch{res.statusCode=404;res.end();}
});
server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+(server.address() as {port:number}).port;
await fs.writeFile(path.join(profile,'ai-settings.json'),JSON.stringify({version:1,config:{...defaultAiConfig,baseUrl:base+'/v1',model:'local-mock',rememberKey:false}}));
const app=await launchDesktopFixture({root,profile,projectFile,devUrl:base}),page=await app.firstWindow();let assistant:Page|undefined,held:Route|undefined,release:(()=>void)|undefined;
const positions=(g:BlueprintGraph)=>g.nodes.map(n=>({id:n.id,x:n.x,y:n.y}));
const checks:string[]=[];
try{
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});const before=await fs.readFile(projectFile,'utf8');
 await page.route(/\/assets\/elk\.bundled-[^/]+\.js$/,async route=>{held=route;await new Promise<void>(resolve=>{release=resolve;});await route.continue();});
 const opened=app.waitForEvent('window');await page.getByRole('button',{name:'AI 助手',exact:true}).click();assistant=await opened;await assistant.getByLabel('发给 AI 的内容',{exact:true}).fill('整理蓝图并打开连线和输入输出');await assistant.getByRole('button',{name:'发送',exact:true}).click();
 const controls=assistant.locator('.ai-editor-commands').first(),status=controls.locator('[role="status"]'),button=(name:string)=>controls.getByRole('button',{name,exact:true}),click=async(name:string)=>button(name).click();
 const snapshot=async()=>(await assistant!.evaluate(async()=>(await window.studio?.getAiContext?.())?.project))!;
 const currentGraph=async(id:string)=>(await snapshot()).blueprints.find(g=>g.id===id)!;
 const locate=async(name:string)=>assistant!.getByRole('button',{name,exact:true}).click();
 await click('自动排列当前蓝图');await expect(status).toContainText('请先打开');expect(positions(await currentGraph(first.id))).toEqual(positions(first));
 await locate('定位：蓝图甲 / 同名节点');await expect(page.locator('.react-flow__node.selected')).toHaveAttribute('data-id',first.nodes[2].id);
 await click('自动排列当前蓝图');await expect.poll(()=>!!held).toBe(true);await expect(status).toContainText('正在处理');await expect(button('显示全部蓝图节点')).toBeDisabled();
 await page.getByLabel('演出目标',{exact:true}).selectOption('graph:'+second.id);await expect(assistant.getByLabel('当前工程上下文')).toContainText('蓝图乙');release!();await expect(status).toContainText('已取消',{timeout:30000});expect(positions(await currentGraph(first.id))).toEqual(positions(first));expect(positions(await currentGraph(second.id))).toEqual(positions(second));
 checks.push('没有画布时拒绝；真实ELK资源加载期间切图，计算后取消旧结果，两图位置不变');
 await locate('定位：蓝图乙 / 同名节点');await expect(page.locator('.react-flow__node.selected')).toHaveAttribute('data-id',second.nodes[2].id);
 await click('打开蓝图输入与输出');await expect(page.getByLabel('资源分组',{exact:true})).toBeVisible();await click('打开蓝图连线列表');await expect(page.locator('.connection-list button')).toHaveCount(2);await click('打开蓝图节点属性');await expect(page.locator('.react-flow__node.selected')).toHaveAttribute('data-id',second.nodes[2].id);
 await click('收起蓝图节点参数');await expect(page.locator('.blueprint-graph-node.parameters-collapsed')).toHaveCount(3);await click('展开蓝图节点参数');await expect(page.locator('.blueprint-graph-node.parameters-collapsed')).toHaveCount(0);
 await click('自动排列当前蓝图');await expect(status).toContainText('已自动排列「蓝图乙」',{timeout:30000});const arranged=await currentGraph(second.id);expect(positions(arranged)).not.toEqual(positions(second));expect(arranged.links).toEqual(second.links);expect(arranged.nodes.map(n=>n.properties)).toEqual(second.nodes.map(n=>n.properties));expect(positions(await currentGraph(first.id))).toEqual(positions(first));await expect(page.locator('.react-flow__node.selected')).toHaveAttribute('data-id',second.nodes[2].id);
 await click('撤销上次修改');await expect.poll(async()=>positions(await currentGraph(second.id))).toEqual(positions(second));await page.getByRole('button',{name:'自动排列蓝图',exact:true}).click();await expect.poll(async()=>positions(await currentGraph(second.id))).toEqual(positions(arranged));await expect(page.getByRole('button',{name:'自动排列蓝图',exact:true})).toBeEnabled();await click('撤销上次修改');await expect.poll(async()=>positions(await currentGraph(second.id))).toEqual(positions(second));await click('重做上次修改');await expect.poll(async()=>positions(await currentGraph(second.id))).toEqual(positions(arranged));
 const canvas=page.locator('.generic-blueprint-workspace .flow-container'),box=(await canvas.boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down({button:'middle'});await page.mouse.move(box.x+box.width/2+500,box.y+box.height/2+250,{steps:10});await page.mouse.up({button:'middle'});const moved=await page.locator('.react-flow__viewport').getAttribute('style');await click('显示全部蓝图节点');await expect(status).toContainText('已显示「蓝图乙」');expect(await page.locator('.react-flow__viewport').getAttribute('style')).not.toBe(moved);expect(positions(await currentGraph(second.id))).toEqual(positions(arranged));
 await page.screenshot({path:path.join(output,'graph.png')});checks.push('当前蓝图属性/接口/连线切换，参数展开收起保留选择；AI及手动排列只改目标位置，撤销重做；画布归位不改工程');
 await locate('定位：时间轴');await expect(page.getByLabel('演出轨道编辑器',{exact:true})).toBeVisible();await click('自动排列当前蓝图');await expect(status).toContainText('时间轴视图不能执行');
 await locate('高级UI：界面文字');await expect(page.getByLabel('高级界面蓝图',{exact:true})).toHaveValue(uiGraph.id);await click('收起蓝图节点参数');await expect(page.locator('.blueprint-graph-node.parameters-collapsed')).toHaveCount(3);await click('打开蓝图输入与输出');await expect(page.getByLabel('资源分组',{exact:true})).toBeVisible();await click('自动排列当前蓝图');await expect(status).toContainText('已自动排列「界面逻辑」');await expect(page.getByRole('button',{name:'保存界面',exact:true})).toBeEnabled();const uiArranged=await currentGraph(uiGraph.id);expect(positions(uiArranged)).not.toEqual(positions(uiGraph));
 await click('撤销上次修改');await expect.poll(async()=>positions(await currentGraph(uiGraph.id))).toEqual(positions(uiGraph));await click('重做上次修改');await expect.poll(async()=>positions(await currentGraph(uiGraph.id))).toEqual(positions(uiArranged));
 await page.locator('[data-workspace-tab="script"]').click();await page.getByRole('dialog',{name:'保存界面修改',exact:true}).getByRole('button',{name:'不保存',exact:true}).click();await expect.poll(async()=>positions(await currentGraph(uiGraph.id))).toEqual(positions(uiGraph));await click('打开蓝图连线列表');await expect(status).toContainText('请先打开');expect(await fs.readFile(projectFile,'utf8')).toBe(before);
 checks.push('时间轴不冒充节点画布；高级UI嵌入蓝图共用入口，排列进入UI草稿历史，撤销/重做/放弃正常，磁盘不变');
 await assistant.screenshot({path:path.join(output,'assistant.png')});await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',compiled:true,servedFrom:'dist',externalApiCalled:false,checks},null,2));console.log(output);
}catch(error){await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>undefined);await assistant?.screenshot({path:path.join(output,'failure-assistant.png')}).catch(()=>undefined);console.error(output);throw error;}
finally{release?.();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();server.closeAllConnections();server.close();}
