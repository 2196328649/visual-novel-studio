import { compileProject } from '../src/runtime/compiler';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { expect, type Locator } from '@playwright/test';
import { createServer } from 'vite';
import { createProject, projectSchema } from '../src/core/model';
import { launchDesktopFixture } from './lib/desktop-fixture';
const root=path.resolve('.'),output=path.join(root,'artifacts/ui-text-commit',new Date().toISOString().replaceAll(':','-'));await fs.mkdir(output,{recursive:true});
const project=createProject('文字提交事件编辑验收');project.ui.pages={...project.ui.pages,preferences:{layout:'custom'}};
project.variables.push({id:'name',name:'玩家名称',type:'string',initial:'初始',persistent:false});
project.ui.components.push({id:'name_control',kind:'preference',page:'preferences',text:'输入名称',parameterId:'name',x:.1,y:.12,width:.75,height:.14},{id:'other_name',kind:'preference',page:'preferences',text:'另一个输入框',parameterId:'name',x:.1,y:.32,width:.75,height:.14},{id:'caption',name:'提交结果',kind:'text',page:'preferences',text:'等待提交',x:.1,y:.56,width:.75,height:.1},{id:'method',name:'提交方式',kind:'text',page:'preferences',text:'未提交',x:.1,y:.73,width:.75,height:.1});
const original=JSON.stringify(project),projectFile=path.join(output,'project.vns.json');await fs.writeFile(projectFile,original);
const server=await createServer({root,server:{host:'127.0.0.1',port:0,watch:{ignored:['**/artifacts/**','**/resources/**','**/release/**']}}});await server.listen();
const app=await launchDesktopFixture({root,projectFile,profile:path.join(output,'profile'),devUrl:process.env.VNS_UI_TEXT_DIST==='1'?undefined:'http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port}),page=await app.firstWindow();page.setDefaultTimeout(10000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
const button=(name:string)=>page.getByRole('button',{name,exact:true}),control=(id:string)=>page.locator('[data-ui-component-id="'+id+'"]');
const arrange=async()=>{await button('自动排列蓝图').click();await expect(button('自动排列蓝图')).toBeEnabled();await button('框选全部节点').click();};
const wire=async(from:Locator,pin:string,to:Locator)=>{const a=await from.locator('[data-handleid="'+pin+'"]').boundingBox(),b=await to.locator('[data-handleid="value"]').boundingBox();assert.ok(a&&b);await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:20});await page.mouse.up();};
try{
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});await page.locator('[data-workspace-tab="ui"]').click();await page.getByLabel('界面编辑模式').getByRole('button',{name:'事件图',exact:true}).click();await page.getByLabel('事件图页面').selectOption('ui:preferences');
 await control('name_control').click();await button('文字提交时 · OnTextCommitted').click();await button('文字提交时 · OnTextCommitted').click();await expect(page.locator('.node-kind-eventTextCommitted')).toHaveCount(1);
 for(const id of ['caption','method']){await control(id).click();await button('设置属性').click();await page.locator('.node-kind-setUiProperty').last().getByLabel('设置组件属性 · 组件属性',{exact:true}).selectOption('text');}
 await arrange();const source=page.locator('.node-kind-eventTextCommitted'),setters=page.locator('.node-kind-setUiProperty');await expect(source.locator('[title="提交文字 · 文字"]')).toBeVisible();await expect(source.locator('[title="提交方式 · 文字"]')).toBeVisible();await wire(source,'value',setters.nth(0));await wire(source,'method',setters.nth(1));await expect(page.locator('.react-flow__edge')).toHaveCount(4);
 await button('框选全部节点').focus();await page.keyboard.press('Control+z');await expect(page.locator('.react-flow__edge')).toHaveCount(3);await page.keyboard.press('Control+y');await expect(page.locator('.react-flow__edge')).toHaveCount(4);
 if(await button('关闭事件图提示').isVisible())await button('关闭事件图提示').click();await page.screenshot({path:path.join(output,'event-graph.png')});
 await button('交互预演').click();const divider=page.getByRole('separator',{name:'调整画布与页面设置高度',exact:true});await divider.focus();for(let i=0;i<15;i++)await page.keyboard.press('ArrowUp');
 const preview=page.locator('.ui-logic-preview-frame'),input=preview.getByLabel('输入名称',{exact:true}),other=preview.getByLabel('另一个输入框',{exact:true}),caption=preview.locator('[data-preview-component="caption"]'),method=preview.locator('[data-preview-component="method"]');
 await input.fill('玩家A');await expect(caption).toHaveText('等待提交');await input.press('Enter');await expect(caption).toHaveText('玩家A');await expect(method).toHaveText('enter');await expect(input).not.toBeFocused();
 await input.fill('玩家B');await expect(caption).toHaveText('玩家A');await other.click();await expect(caption).toHaveText('玩家B');await expect(method).toHaveText('focusLost');
 await input.click();await input.press('Enter');await expect(method).toHaveText('enter');await input.click();await input.click();await expect(method).toHaveText('enter');await input.press('Tab');await expect(method).toHaveText('focusLost');
 await input.fill('输入法待确认');await input.dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true});await expect(caption).toHaveText('玩家B');await expect(input).toBeFocused();await input.press('Enter');await expect(caption).toHaveText('输入法待确认');await expect(method).toHaveText('enter');
 await page.screenshot({path:path.join(output,'text-preview.png')});assert.equal(await fs.readFile(projectFile,'utf8'),original);await button('交互预演').click();await button('保存界面').click();await expect(page.locator('.workspace-toolbar').getByText('已保存',{exact:true})).toBeVisible();const saved=projectSchema.parse(JSON.parse(await fs.readFile(projectFile,'utf8'))),graph=saved.blueprints.find(g=>g.uiPageId==='ui:preferences')!;assert.equal(graph.links.length,4);assert.deepEqual(compileProject(saved).diagnostics.filter(d=>d.severity==='error'),[]);assert.equal(graph.nodes.filter(n=>n.type==='eventTextCommitted').length,1);
 await page.reload();await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});await page.locator('[data-workspace-tab="ui"]').click();await page.getByLabel('界面编辑模式').getByRole('button',{name:'事件图',exact:true}).click();await page.getByLabel('事件图页面').selectOption('ui:preferences');await expect(page.locator('.react-flow__edge')).toHaveCount(4);
 await button('＋ 新建事件图').click();await page.locator('[data-workspace-tab="assets"]').click();await page.getByRole('dialog',{name:'保存界面修改'}).getByRole('button',{name:'不保存',exact:true}).click();assert.equal(projectSchema.parse(JSON.parse(await fs.readFile(projectFile,'utf8'))).blueprints.length,1);
 assert.deepEqual(errors,[]);await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',renderer:process.env.VNS_UI_TEXT_DIST==='1'?'dist':'vite',checks:["从自由文字控件创建提交事件并去重","提交文字/方式真实数据线驱动界面文字","Enter结束输入、点击其他输入、Tab和同值提交","模拟composition键盘事件不提前提交（非真实IME验收）","撤销重做、显式保存重开及放弃修改"]},null,2));
}catch(error){await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>undefined);await fs.writeFile(path.join(output,'failure.txt'),String(error)+'\n'+errors.join('\n'));throw error;}
finally{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();await server.close();console.log(output);}
