import { clickUiButtonEvent } from './lib/ui-disclosures';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { expect, type Locator } from '@playwright/test';
import { projectSchema } from '../src/core/model';
import { animationPlaybackFixture } from './lib/ui-animation-playback-fixture';
import { launchDesktopFixture } from './lib/desktop-fixture';

const root=path.resolve('.'),output=path.join(root,'artifacts/ui-animation-playback',new Date().toISOString().replaceAll(':','-'));await fs.mkdir(output,{recursive:true});
const {project}=animationPlaybackFixture(false),original=JSON.stringify(project),projectFile=path.join(output,'project.vns.json');await fs.writeFile(projectFile,original);
const app=await launchDesktopFixture({root,projectFile,profile:path.join(output,'profile')}),page=await app.firstWindow();page.setDefaultTimeout(10000);
const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
const button=(name:string)=>page.getByRole('button',{name,exact:true});
const nodes=(type:string)=>page.locator('.react-flow__node').filter({has:page.locator('.node-kind-'+type)});
const component=(id:string)=>page.locator('[data-ui-component-id="'+id+'"]');
const arrange=async()=>{await button('自动排列蓝图').click();await expect(button('自动排列蓝图')).toBeEnabled();await button('框选全部节点').click();};
const field=(node:Locator,name:string)=>node.getByLabel('播放界面动画 · '+name,{exact:true});
const wire=async(from:Locator,pin:string,to:Locator)=>{const a=await from.locator('[data-handleid="value"]').boundingBox(),b=await to.locator('[data-handleid="'+pin+'"]').boundingBox();assert.ok(a&&b);await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:20});await page.mouse.up();};
try{
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});await page.locator('[data-workspace-tab="ui"]').click();await page.getByLabel('界面编辑模式').getByRole('button',{name:'事件图',exact:true}).click();
 const entry=page.locator('[data-ui-animation-id]').filter({hasText:'提示展开'});
 await component('loops').click();await button('点击时 · OnClicked').click();await entry.getByRole('button',{name:'播放',exact:true}).click();
 const playId=(await nodes('playUiAnimation').getAttribute('data-id'))!,play=page.locator('.react-flow__node[data-id="'+playId+'"]');
 await field(play,'播放方向').selectOption('pingpong');await field(play,'循环次数（0为无限）').fill('2');await field(play,'播放速度').fill('2');
 await component('trace').click();await button('设置属性').click();await nodes('setUiProperty').getByLabel('设置组件属性 · 组件属性',{exact:true}).selectOption('text');await nodes('setUiProperty').getByLabel('设置组件属性 · 属性值',{exact:true}).fill('往返完成');
 for(const [id,pin] of [['play_loops','loops'],['play_speed','speed']]){
  await page.locator('[data-ui-variable-id="'+id+'"]').dragTo(page.locator('.flow-container'),{targetPosition:{x:120,y:160}});await page.getByRole('dialog',{name:'添加蓝图节点'}).getByRole('button',{name:/^读取变量/}).click();await arrange();await wire(nodes('getVariable').last(),pin,play);
 }
 await expect(page.locator('.react-flow__edge')).toHaveCount(4);
 for(const [event,mode] of [['悬停时 · OnHovered','forward'],['移出时 · OnUnhovered','reverse']]){
  await component('hover').click();await clickUiButtonEvent(page, event);await entry.getByRole('button',{name:'播放',exact:true}).click();const node=nodes('playUiAnimation').last();await field(node,'播放方向').selectOption(mode);await field(node,'沿用当前进度').selectOption('true');await field(node,'等待结束').selectOption('false');
 }
 await component('stop').click();await button('点击时 · OnClicked').click();await entry.getByRole('button',{name:'停止',exact:true}).click();
 await arrange();if(await button('关闭事件图提示').isVisible())await button('关闭事件图提示').click();await page.screenshot({path:path.join(output,'event-graph.png')});await play.locator('.graph-node-title').click();await page.locator('.blueprint-properties').screenshot({path:path.join(output,'playback-options.png')});
 await button('交互预演').click();await page.getByLabel('按时间预演',{exact:true}).check();const divider=page.getByRole('separator',{name:'调整画布与页面设置高度',exact:true});await divider.focus();for(let i=0;i<12;i++)await page.keyboard.press('ArrowUp');
 const preview=page.locator('.ui-logic-preview-frame'),target=preview.locator('[data-preview-component="target"]'),trace=preview.locator('[data-preview-component="trace"]');
 const x=()=>target.evaluate(e=>parseFloat((e as HTMLElement).style.left)/e.parentElement!.getBoundingClientRect().width);
 await preview.getByRole('button',{name:'往返两次',exact:true}).click();await button('推进 1 秒').click();assert.ok(Math.abs(await x()-.7)<.01);await expect(trace).toHaveText('等待操作');
 await button('推进 1 秒').click();assert.ok(Math.abs(await x()-.1)<.01);await expect(trace).toHaveText('等待操作');await button('推进 1 秒').click();await button('推进 1 秒').click();await expect(trace).toHaveText('往返完成');
 await button('恢复测试值').click();const hover=preview.getByRole('button',{name:'悬停展开',exact:true});await hover.hover();await button('推进 0.1 秒').focus();for(let i=0;i<5;i++)await page.keyboard.press('Enter');const before=await x();assert.ok(Math.abs(before-.25)<.01);
 const box=await preview.boundingBox();assert.ok(box);await page.mouse.move(box.x+box.width*.97,box.y+box.height*.9);assert.ok(Math.abs(await x()-before)<.01);await page.keyboard.press('Enter');assert.ok(Math.abs(await x()-.22)<.01);await page.screenshot({path:path.join(output,'reversing-preview.png')});
 await preview.getByRole('button',{name:'停在当前位置',exact:true}).click();const frozen=await x();await button('推进 1 秒').click();assert.ok(Math.abs(await x()-frozen)<.01);
 await button('恢复测试值').click();await page.getByLabel('预演参数 循环次数',{exact:true}).fill('0');await preview.getByRole('button',{name:'往返两次',exact:true}).click();for(let i=0;i<5;i++)await button('推进 1 秒').click();await expect(trace).toHaveText('等待操作');await preview.getByRole('button',{name:'停在当前位置',exact:true}).click();await expect(trace).toHaveText('往返完成');
 assert.equal(await fs.readFile(projectFile,'utf8'),original);await button('交互预演').click();await button('保存界面').click();await expect(page.locator('.workspace-toolbar').getByText('已保存',{exact:true})).toBeVisible();
 const saved=projectSchema.parse(JSON.parse(await fs.readFile(projectFile,'utf8'))),graph=saved.blueprints.find(g=>g.uiPageId==='ui:main')!;assert.equal(graph.nodes.find(n=>n.id===playId)!.properties.playMode,'pingpong');assert.equal(graph.links.filter(l=>l.toNodeId===playId&&['speed','loops'].includes(l.toPinId)).length,2);assert.equal(saved.variables.find(v=>v.id==='play_loops')!.initial,2);
 await page.reload();await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});await page.locator('[data-workspace-tab="ui"]').click();await page.getByLabel('界面编辑模式').getByRole('button',{name:'事件图',exact:true}).click();await arrange();await expect(field(play,'播放方向')).toHaveValue('pingpong');
 await field(play,'播放方向').selectOption('reverse');await button('框选全部节点').focus();await page.keyboard.press('Control+z');await expect(field(play,'播放方向')).toHaveValue('pingpong');await page.keyboard.press('Control+y');await expect(field(play,'播放方向')).toHaveValue('reverse');
 await page.locator('[data-workspace-tab="assets"]').click();await page.getByRole('dialog',{name:'保存界面修改'}).getByRole('button',{name:'不保存',exact:true}).click();assert.equal(projectSchema.parse(JSON.parse(await fs.readFile(projectFile,'utf8'))).blueprints.find(g=>g.id===graph.id)!.nodes.find(n=>n.id===playId)!.properties.playMode,'pingpong');
 assert.deepEqual(errors,[]);await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',renderer:'dist',checks:['当前事件图创建正放倒放往返节点及循环速度字段','实际拖动变量引脚接线','两倍速往返两次后继续','实际悬停移出连续换向及停止冻结','无限循环等待至停止','保存重开、撤销重做和放弃草稿']},null,2));
}catch(error){await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>undefined);await fs.writeFile(path.join(output,'failure.txt'),String(error)+'\n'+errors.join('\n'));throw error;}
finally{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();console.log(output);}
