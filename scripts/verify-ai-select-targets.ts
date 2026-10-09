import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { expect, type Page } from '@playwright/test';
import { createProject, type BlueprintGraph } from '../src/core/model';
import { createBlueprintGraph, blueprintNodeDefaults, connectBlueprintPins, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { createUiEventGraph } from '../src/core/ui-logic';
import { addTimelineComponent } from '../src/core/timeline-component';
import { defaultAiConfig } from '../src/core/ai';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';

const root = path.resolve('.'), output = path.join(root, 'artifacts/ai-select-targets', new Date().toISOString().replaceAll(':', '-'));
const profile = path.join(output, 'profile'), projectFile = path.join(output, 'project/project.vns.json'); await fs.mkdir(profile, { recursive: true });
const project = createProject('AI 主动选择验收'); project.variables.push({ id: 'counter', name: '计数', type: 'number', initial: 0, persistent: false });
function populate(graph: BlueprintGraph) {
 const nodes = [1, 2, 3].map(value => { const n = blueprintNodeDefaults('setVariable'); n.name = '同名节点'; n.properties = { variableId: 'counter', value }; return n; });
 const read = blueprintNodeDefaults('getVariable'); read.properties.variableId = 'counter';
 graph.nodes.push(...nodes, read);
 graph.nodes.forEach((n, i) => { n.x = [0, 370, 740, 740, 0][i]; n.y = i < 3 ? 0 : 430; });
 connectBlueprintPins(graph, graph.nodes[0].id, 'exec', nodes[0].id, 'exec_in'); connectBlueprintPins(graph, nodes[0].id, 'exec_out', nodes[1].id, 'exec_in'); connectBlueprintPins(graph, read.id, 'value', nodes[1].id, 'value'); connectBlueprintPins(graph, read.id, 'value', nodes[2].id, 'value');
 return { graph, a: nodes[0], b: nodes[1], c: nodes[2], read, exec: graph.links[1], data: graph.links[2] };
}
const first = populate(createBlueprintGraph('function', '普通节点蓝图')); project.blueprints.push(first.graph);
project.ui.components = [{ id: 'caption', name: '提示文字', kind: 'text', page: 'main', text: '文字', x: .2, y: .2, width: .4, height: .1 }];
const ui = populate(createUiEventGraph(project, 'ui:main', '标题页面'));
const second=populate(createBlueprintGraph('function','另一张节点蓝图'));project.blueprints.push(second.graph);first.graph.callName='first_graph';second.graph.callName='second_graph';
project.ui.customPages.push({id:'custom_page',name:'自定义界面',modal:false,components:[]});
const custom=populate(createUiEventGraph(project,'custom_page','自定义界面'));
project.ui.instances=[{id:'scheme',name:'另一套界面',components:[]}];project.ui.activeInstanceId='scheme';
const scoped=populate(createUiEventGraph(project,'ui:preferences','方案设置页'));project.ui.activeInstanceId=undefined;
const {timeline,node:timelineCall}=addTimelineComponent(project,ui.graph.id);
synchronizeBlueprintSignatures(project); await saveProject(projectFile, project);

let nextTarget:any,move=false;
const captures:any[]=[],serverErrors:string[]=[],checks:string[]=[];
const server=createServer(async(req,res)=>{try{
 let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw),content=body.messages.at(-1).content;
 const context=JSON.parse(content.slice(content.indexOf('\n{')+1));captures.push(context.selectedBlueprint);
 const operations=move?context.selectedBlueprint.selectedNodes.map((n:any)=>({kind:'editProject',action:'set',path:['blueprints',{id:context.selectedBlueprint.graphId},'nodes',{id:n.id},'x'],value:1300})):[];
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({message:move?'移动所选节点。':'点击按钮建立所需选择。',operations,...(!move?{editorTargets:[nextTarget]}:{})})},finish_reason:'stop'}]}));
}catch(error){serverErrors.push(String(error));res.statusCode=500;res.end(String(error));}});
server.listen(0,'127.0.0.1');await once(server,'listening');
await fs.writeFile(path.join(profile,'ai-settings.json'),JSON.stringify({version:1,config:{...defaultAiConfig,baseUrl:'http://127.0.0.1:'+(server.address() as any).port+'/v1',model:'selection-target-mock',rememberKey:false}}));
const app=await launchDesktopFixture({root,projectFile,profile}),page=await app.firstWindow();let assistant:Page|undefined;
page.setDefaultTimeout(12000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));let phase='open';
const ctx=async()=>await assistant!.evaluate(async()=>await window.studio!.getAiContext!());
const node=(id:string)=>page.locator('.react-flow__node[data-id="'+id+'"]');
const target=(graph:BlueprintGraph,nodes:string[]=[],links:string[]=[],frame=true)=>({kind:'blueprintSelection',graphId:graph.id,nodeIds:nodes,linkIds:links,frame});
const send=async()=>{await assistant!.getByLabel('发给 AI 的内容',{exact:true}).fill(move?'移动当前选中的节点':'按指定范围选择节点与连线');await assistant!.getByRole('button',{name:'发送',exact:true}).click();};
const propose=async(t:any)=>{nextTarget=t;move=false;const count=await assistant!.locator('.ai-editor-commands').count();await send();await expect(assistant!.locator('.ai-editor-commands')).toHaveCount(count+1);return assistant!.locator('.ai-editor-commands').nth(count);};
const choose=async(t:any)=>{const command=await propose(t);await command.getByRole('button').click();await expect(command).toContainText(t.nodeIds.length||t.linkIds.length?'已选中':'已清空');await expect.poll(async()=>{const c=(await ctx())?.selectedBlueprint;return {graphId:c?.graphId,nodes:c?.nodeIds?.slice().sort(),links:c?.linkIds?.slice().sort()};}).toEqual({graphId:t.graphId,nodes:[...new Set(t.nodeIds)].sort(),links:[...new Set(t.linkIds)].sort()});await expect(page.locator('.react-flow__node.selected')).toHaveCount(new Set(t.nodeIds).size);await expect(page.locator('.react-flow__edge.selected')).toHaveCount(new Set(t.linkIds).size);};
const record=(s:string)=>{checks.push(s);console.log('PASS '+s);};
const graphNow=async(id:string)=>(await ctx())!.project.blueprints.find(g=>g.id===id)!;
const undo=async()=>{await page.getByRole('button',{name:'框选全部节点',exact:true}).focus();await page.keyboard.press('Control+z');};
try{
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});const opened=app.waitForEvent('window');await page.getByRole('button',{name:'AI 助手',exact:true}).click();assistant=await opened;
 const before=(await ctx())!.project,disk=await fs.readFile(projectFile,'utf8');
 phase='cross workspace';await choose(target(first.graph,[first.a.id,first.b.id],[first.exec.id]));assert.deepEqual((await ctx())!.project,before);assert.equal(await fs.readFile(projectFile,'utf8'),disk);record('从其他工作区打开蓝图，准确混选同名节点与连线且不修改工程');
 phase='followup move';move=true;await send();const proposal=assistant.getByRole('region',{name:'AI 建议修改'}).last();await proposal.getByRole('button',{name:/应用选中的/}).click();await expect(proposal).toContainText('已应用修改');await expect.poll(async()=>(await graphNow(first.graph.id)).nodes.find(n=>n.id===first.a.id)!.x).toBe(1300);assert.equal((await graphNow(first.graph.id)).nodes.find(n=>n.id===first.b.id)!.x,1300);assert.deepEqual((await graphNow(first.graph.id)).nodes.find(n=>n.id===first.c.id),first.c);await undo();await expect.poll(async()=>(await graphNow(first.graph.id)).nodes).toEqual(first.graph.nodes);record('主动选择后发出修改请求，实际选择进入请求并仅移动对应节点');
 phase='wire only';await page.getByRole('button',{name:'框选全部节点',exact:true}).click();await page.waitForTimeout(300);const viewport=await page.locator('.react-flow__viewport').getAttribute('style');await choose(target(first.graph,[],[first.data.id],false));assert.equal(await page.locator('.react-flow__viewport').getAttribute('style'),viewport);await choose(target(first.graph,[],[],false));assert.equal(await page.locator('.react-flow__viewport').getAttribute('style'),viewport);record('仅选连线不选端点，清空选择及保留视角');
 phase='another graph';await choose(target(second.graph,[second.c.id],[]));await choose(target(first.graph,[first.a.id],[]));record('跨图重复定位不误选同名节点');
 phase='cancel navigation';const cancelled=await propose(target(second.graph,[second.c.id],[]));await cancelled.getByRole('button').click();await page.locator('[data-workspace-tab="script"]').click();await expect(cancelled).toContainText('取消');await page.waitForTimeout(250);await expect(page.getByLabel('演出目标',{exact:true})).toHaveCount(0);await choose(target(first.graph,[first.a.id],[]));record('选择期间切换工作区可取消，不会被迟到回调拉回旧画布');
 phase='stale target';const stale=await propose(target(first.graph,[first.a.id,first.b.id],[first.data.id]));await page.getByRole('button',{name:'框选全部节点',exact:true}).focus();await page.keyboard.press('Delete');await expect(node(first.a.id)).toHaveCount(0);await node(first.c.id).locator('.graph-node-title').click();await stale.getByRole('button').click();await expect(stale).toContainText('本次选择没有更改');await expect(node(first.c.id)).toHaveClass(/selected/);await expect(page.locator('.react-flow__node.selected')).toHaveCount(1);await undo();await expect(node(first.a.id)).toHaveCount(1);record('建议生成后目标被删，整次拒绝并保留现场选择');
 phase='ui open';await choose(target(ui.graph,[ui.c.id],[]));await expect(page.getByLabel('界面编辑模式')).toBeVisible();await page.getByLabel('节点名称',{exact:true}).fill('手动草稿保留');const drafted=(await ctx())!.project;
 await choose(target(ui.graph,[ui.a.id,ui.b.id],[ui.data.id]));assert.deepEqual((await ctx())!.project,drafted);await expect(page.getByRole('dialog',{name:'保存界面修改',exact:true})).toHaveCount(0);
 phase='ui other page';await choose(target(custom.graph,[custom.c.id],[custom.data.id]));assert.deepEqual((await ctx())!.project,drafted);await expect(page.getByLabel('事件图页面',{exact:true})).toHaveValue('custom_page');await page.screenshot({path:path.join(output,'ui-selection.png')});record('UI事件图自动打开正确页面，跨页选择保留手动草稿');
 phase='ui scheme';await choose(target(scoped.graph,[scoped.a.id],[]));await expect(page.getByLabel('事件图页面',{exact:true})).toHaveValue('ui:preferences');assert.equal((await ctx())!.project.ui.activeInstanceId,'scheme');assert.equal((await graphNow(ui.graph.id)).nodes.find(n=>n.id===ui.c.id)!.name,'手动草稿保留');await choose(target(custom.graph,[custom.c.id],[custom.data.id]));assert.deepEqual((await ctx())!.project,drafted);record('跨界面方案选择打开所属页面，返回后工程默认方案与草稿保持原状');
 phase='cancel leave';const leave=await propose(target(second.graph,[second.a.id],[]));await leave.getByRole('button').click();const dialog=page.getByRole('dialog',{name:'保存界面修改',exact:true});await dialog.getByRole('button',{name:'取消',exact:true}).click();await expect(leave).toContainText('已取消定位');await expect(node(custom.c.id)).toHaveClass(/selected/);assert.deepEqual((await ctx())!.project,drafted);record('离开UI的保存提示可取消，选择及草稿保留');
 phase='ui timeline';await choose(target(ui.graph,[timelineCall.id],[]));await choose(target(timeline,[timeline.nodes[0].id],timeline.links.slice(0,1).map(l=>l.id)));await expect(page.getByRole('region',{name:'界面事件的演出时间轴',exact:true})).toBeVisible();await page.getByRole('button',{name:'返回时间轴编辑',exact:true}).click();await expect(page.getByLabel('演出轨道编辑器',{exact:true})).toBeVisible();await page.getByRole('button',{name:'返回事件图',exact:true}).click();await choose(target(ui.graph,[],[],false));await undo();await expect.poll(async()=>(await graphNow(ui.graph.id)).nodes.find(n=>n.id===ui.c.id)!.name).toBe('同名节点');record('UI内未打开的时间轴沿真实调用路径进入组件连线并可返回；导航不占用撤销记录');
 phase='ordinary timeline';await choose(target(timeline,[timeline.nodes[0].id],timeline.links.slice(0,1).map(l=>l.id)));await page.getByRole('button',{name:'返回时间轴编辑',exact:true}).click();await expect(page.getByLabel('演出轨道编辑器',{exact:true})).toBeVisible();assert.equal(await fs.readFile(projectFile,'utf8'),disk);record('独立时间轴选择打开组件节点图，默认剪辑视图可恢复');
 await assistant.screenshot({path:path.join(output,'assistant.png')});assert.deepEqual(errors,[]);assert.deepEqual(serverErrors,[]);await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',compiled:true,externalApiCalled:false,checks,captures},null,2));console.log(output);
}catch(error){console.error('Phase:',phase,output);await page.screenshot({path:path.join(output,'failure.png')});await assistant?.screenshot({path:path.join(output,'failure-assistant.png')});throw error;}
finally{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();server.closeAllConnections();server.close();}
