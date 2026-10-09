import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, type Locator } from '@playwright/test';
import { animationPlaybackFixture } from './lib/ui-animation-playback-fixture';
import { createUiEventGraph } from '../src/core/ui-logic';
import { blueprintNodeDefaults, connectBlueprintPins, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { projectSchema } from '../src/core/model';
import { launchDesktopFixture } from './lib/desktop-fixture';

const root=path.resolve('.'),output=path.join(root,'artifacts/ui-graph-readability',new Date().toISOString().replaceAll(':','-'));await fs.mkdir(output,{recursive:true});
const {project}=animationPlaybackFixture(),graph=project.blueprints.find(g=>g.uiPageId==='ui:main')!;
const play=graph.nodes.find(n=>n.type==='playUiAnimation'&&n.properties.playMode==='pingpong')!,event=graph.nodes.find(n=>n.type==='eventClick'&&n.properties.componentId==='loops')!,read=graph.nodes.find(n=>n.type==='getVariable'&&n.properties.variableId==='play_loops')!;
graph.nodes.forEach((n,i)=>{n.x=(i%4)*430;n.y=Math.floor(i/4)*650;});
const other=createUiEventGraph(project,'ui:main','另一张页面图'),far=blueprintNodeDefaults('comment');far.x=5200;far.y=3600;far.properties.text='远处说明';other.nodes.push(far);
const custom={id:'readability_page',name:'独立测试页',modal:true,components:[]};project.ui.customPages.push(custom);const customGraph=createUiEventGraph(project,custom.id,'独立页面');
const format=blueprintNodeDefaults('formatText');format.properties.format='次数 {value}';graph.nodes.push(format);format.x=1700;format.y=2000;connectBlueprintPins(graph,read.id,'value',format.id,'value');
synchronizeBlueprintSignatures(project);const projectFile=path.join(output,'project.vns.json'),original=JSON.stringify(project);await fs.writeFile(projectFile,original);
const app=await launchDesktopFixture({root,projectFile,profile:path.join(output,'profile')}),page=await app.firstWindow();page.setDefaultTimeout(10000);
const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
const button=(name:string)=>page.getByRole('button',{name,exact:true});
const node=(id:string)=>page.locator('.react-flow__node[data-id="'+id+'"]');
const saved=()=>expect(page.locator('.workspace-toolbar').getByText('已保存',{exact:true})).toBeVisible();
const focused=async(id:string)=>{
 await expect(node(id)).toHaveClass(/selected/);
 await expect.poll(async()=>(await node(id).boundingBox())!.width).toBeGreaterThan(210);
 await expect.poll(async()=>{const a=await node(id).locator('.graph-node-title').boundingBox(),b=await page.locator('.react-flow').boundingBox();return !!a&&!!b&&a.x>=b.x-1&&a.y>=b.y-1&&a.x+a.width<=b.x+b.width+1&&a.y+a.height<=b.y+b.height+1;}).toBe(true);
};
const showNode=async(id:string)=>{await button('框选全部节点').click();await node(id).locator('.graph-node-title').click();await button('定位选中节点').click();await focused(id);};
try{
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});await page.locator('[data-workspace-tab="ui"]').click();await page.getByLabel('界面编辑模式').getByRole('button',{name:'事件图',exact:true}).click();
 await page.locator('.ui-event-entry').filter({hasText:'往返播放按钮 · 点击时'}).click();await focused(event.id);await saved();await page.screenshot({path:path.join(output,'event-focused.png')});
 await showNode(play.id);await expect(node(play.id).locator('.graph-node-detail')).toHaveText('提示展开 · 往返 · 变量 · 循环次数');await expect(node(play.id).locator('.blueprint-pin-source')).toHaveText(['来自：变量 · 循环次数','来自：变量 · 播放倍率']);
 await page.screenshot({path:path.join(output,'playback-sources.png')});
 await button('定位循环次数（0为无限）来源：变量 · 循环次数').click();await focused(read.id);await saved();
 await node(read.id).getByLabel('读取状态 · 作品状态',{exact:true}).selectOption('play_speed');await expect(node(play.id).locator('.blueprint-pin-source')).toHaveText(['来自：变量 · 播放倍率','来自：变量 · 播放倍率']);
 await button('定位选中节点').focus();await page.keyboard.press('Control+z');await expect(node(play.id).locator('.blueprint-pin-source')).toHaveText(['来自：变量 · 循环次数','来自：变量 · 播放倍率']);await saved();
 await page.keyboard.press('Control+y');await expect(node(play.id).locator('.graph-node-detail')).toHaveText('提示展开 · 往返 · 变量 · 播放倍率');await page.keyboard.press('Control+z');await saved();
 await showNode(play.id);await button('断开循环次数（0为无限）的数据线').click();await expect(node(play.id).getByLabel('播放界面动画 · 循环次数（0为无限）',{exact:true})).toBeVisible();await expect(node(play.id).locator('.graph-node-detail')).toHaveText('提示展开 · 往返 · 1次');await button('定位选中节点').focus();await page.keyboard.press('Control+z');await saved();
 await showNode(format.id);await expect(page.locator('.blueprint-properties .blueprint-linked-value')).toContainText('变量 · 循环次数');await button('定位输入值来源：变量 · 循环次数').click();await focused(read.id);
 await page.getByLabel('当前页面事件图',{exact:true}).selectOption(other.id);await page.locator('.ui-event-entry').filter({hasText:'页面显示时'}).click();await focused(other.nodes[0].id);
 await page.getByLabel('当前页面事件图',{exact:true}).selectOption(graph.id);await page.locator('.ui-event-entry').filter({hasText:'往返播放按钮 · 点击时'}).click();await focused(event.id);
 await page.getByLabel('事件图页面',{exact:true}).selectOption(custom.id);await expect(page.getByLabel('当前页面事件图',{exact:true})).toHaveValue(customGraph.id);await page.locator('.ui-event-entry').filter({hasText:'页面显示时'}).click();await focused(customGraph.nodes[0].id);
 await page.getByLabel('事件图页面',{exact:true}).selectOption('ui:main');await page.getByLabel('当前页面事件图',{exact:true}).selectOption(graph.id);await page.locator('.ui-event-entry').filter({hasText:'往返播放按钮 · 点击时'}).click();await focused(event.id);await saved();assert.equal(await fs.readFile(projectFile,'utf8'),original);
 // At a narrower desktop size, the requested event remains legible and in view.
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1024,768));await page.locator('.ui-event-entry').filter({hasText:'往返播放按钮 · 点击时'}).click();await focused(event.id);await page.screenshot({path:path.join(output,'event-1024.png')});
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1480,950));await showNode(play.id);await node(play.id).getByLabel('播放界面动画 · 播放方向',{exact:true}).selectOption('reverse');await button('保存界面').click();await saved();
 const written=projectSchema.parse(JSON.parse(await fs.readFile(projectFile,'utf8')));assert.equal(written.blueprints.find(g=>g.id===graph.id)!.nodes.find(n=>n.id===play.id)!.properties.playMode,'reverse');assert.deepEqual(written.blueprints.find(g=>g.id===graph.id)!.links,graph.links);
 await page.reload();await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});await page.locator('[data-workspace-tab="ui"]').click();await page.getByLabel('界面编辑模式').getByRole('button',{name:'事件图',exact:true}).click();await page.getByLabel('当前页面事件图',{exact:true}).selectOption(graph.id);await page.locator('.ui-event-entry').filter({hasText:'往返播放按钮 · 点击时'}).click();await focused(event.id);await showNode(play.id);await expect(node(play.id).locator('.graph-node-detail')).toHaveText('提示展开 · 倒放 · 变量 · 循环次数');await saved();
 assert.deepEqual(errors,[]);await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',renderer:'dist',checks:['左侧事件定位具体节点且保持可读缩放','节点展示目标/方向/实际变量来源','来源点击定位与同名读取节点区分','来源修改撤销重做与断线恢复默认值','文字格式节点的已连线参数正确显示来源','跨图跨页与重复定位，导航不写草稿','1024窗口事件定位可见','实际保存重开保留连线和描述']},null,2));
}catch(error){await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>undefined);await fs.writeFile(path.join(output,'failure.txt'),String(error)+'\n'+errors.join('\n'));throw error;}
finally{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();console.log(output);}
