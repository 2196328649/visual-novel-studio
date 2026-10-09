import { openUiPreviewWindow, showUiPreviewTestData } from './lib/ui-preview-window';
import { clickUiButtonEvent } from './lib/ui-disclosures';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { createServer } from 'vite';
import { createProject, projectSchema } from '../src/core/model';
import { launchDesktopFixture } from './lib/desktop-fixture';

const root=path.resolve('.'),output=path.join(root,'artifacts/ui-button-events',new Date().toISOString().replaceAll(':','-'));await fs.mkdir(output,{recursive:true});
const project=createProject('按钮事件编辑验收');project.ui.pages={...project.ui.pages,main:{layout:'custom'}};
project.variables.push(...['enabled','visible'].map(id=>({id,name:id==='enabled'?'按钮启用':'按钮显示',type:'boolean' as const,initial:true,persistent:false})));
project.ui.components.push({id:'source',name:'交互按钮',kind:'button',page:'main',text:'测试按钮事件',x:.1,y:.1,width:.35,height:.2,enabledWhen:{kind:'compare',variableId:'enabled',operator:'eq',value:true},visibleWhen:{kind:'compare',variableId:'visible',operator:'eq',value:true}},{id:'result',name:'事件结果',kind:'text',page:'main',text:'等待事件',x:.1,y:.6,width:.8,height:.15});
const original=JSON.stringify(project),projectFile=path.join(output,'project.vns.json');await fs.writeFile(projectFile,original);
const server=await createServer({root,server:{host:'127.0.0.1',port:0,watch:{ignored:['**/artifacts/**','**/resources/**','**/release/**']}}});await server.listen();
const app=await launchDesktopFixture({root,projectFile,profile:path.join(output,'profile'),devUrl:process.env.VNS_UI_BUTTON_DIST==='1'?undefined:'http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port}),page=await app.firstWindow();page.setDefaultTimeout(10000);
const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const button=(name:string)=>page.getByRole('button',{name,exact:true});
const sources=()=>page.locator('[data-ui-component-id="source"]'),resultRow=()=>page.locator('[data-ui-component-id="result"]');
try{
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});await page.locator('[data-workspace-tab="ui"]').click();await page.getByLabel('界面编辑模式').getByRole('button',{name:'事件图',exact:true}).click();
 for(const [entry,value] of [['悬停时 · OnHovered','悬停'],['移出时 · OnUnhovered','移出'],['按下时 · OnPressed','按下'],['松开时 · OnReleased','松开'],['点击时 · OnClicked','点击']]){
  await sources().click();await clickUiButtonEvent(page, entry);await resultRow().click();await button('设置属性').click();
  const node=page.locator('.node-kind-setUiProperty').last();await node.getByLabel('设置组件属性 · 组件属性',{exact:true}).selectOption('text');await node.getByLabel('设置组件属性 · 属性值',{exact:true}).fill(value);
 }
 await expect(page.locator('.node-kind-eventButton')).toHaveCount(4);await expect(page.locator('.react-flow__edge')).toHaveCount(5);
 await sources().click();await clickUiButtonEvent(page, '悬停时 · OnHovered');await expect(page.locator('.node-kind-eventButton')).toHaveCount(4);
 await button('自动排列蓝图').click();await expect(button('自动排列蓝图')).toBeEnabled();await button('框选全部节点').click();if(await button('关闭事件图提示').isVisible())await button('关闭事件图提示').click();await page.screenshot({path:path.join(output,'event-graph.png')});
 const previewPage=await openUiPreviewWindow(app,page);await showUiPreviewTestData(previewPage);
 const preview=previewPage.locator('.ui-logic-preview-frame'),source=preview.getByRole('button',{name:'测试按钮事件',exact:true}),result=preview.locator('[data-preview-component="result"]');await source.scrollIntoViewIfNeeded();
 await source.hover();await expect(result).toHaveText('悬停');await previewPage.mouse.down();await expect(result).toHaveText('按下');await previewPage.screenshot({path:path.join(output,'pressed.png')});
 const b=await preview.boundingBox();assert.ok(b);await previewPage.mouse.move(b.x+b.width*.9,b.y+b.height*.5);await expect(result).toHaveText('移出');await previewPage.mouse.up();await expect(result).toHaveText('松开');
 await source.click();await expect(result).toHaveText('点击');await source.focus();await previewPage.keyboard.press('Enter');await expect(result).toHaveText('点击');
 await previewPage.mouse.move(b.x+b.width*.9,b.y+b.height*.5);await source.hover();await previewPage.mouse.down();await expect(result).toHaveText('按下');await previewPage.getByLabel('预演参数 按钮启用',{exact:true}).selectOption('false');await previewPage.mouse.up();await expect(result).toHaveText('按下');await expect(source).toHaveAttribute('aria-disabled','true');
 await previewPage.getByRole('button',{name:'恢复测试值',exact:true}).click();await source.hover();await previewPage.mouse.down();await previewPage.getByLabel('预演参数 按钮显示',{exact:true}).selectOption('false');await previewPage.mouse.up();await expect(source).toHaveCount(0);await expect(result).toHaveText('按下');
 await previewPage.getByRole('button',{name:'恢复测试值',exact:true}).click();assert.equal(await fs.readFile(projectFile,'utf8'),original);await previewPage.close();await button('保存界面').click();await expect(button('保存界面')).toBeDisabled();
 const saved=projectSchema.parse(JSON.parse(await fs.readFile(projectFile,'utf8'))),graph=saved.blueprints.find(g=>g.uiPageId==='ui:main')!;assert.equal(graph.nodes.filter(n=>n.type==='eventButton').length,4);assert.equal(graph.links.length,5);
 await page.reload();await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});await page.locator('[data-workspace-tab="ui"]').click();await page.getByLabel('界面编辑模式').getByRole('button',{name:'事件图',exact:true}).click();await expect(page.locator('.node-kind-eventButton')).toHaveCount(4);
 await sources().click();await clickUiButtonEvent(page, '悬停时 · OnHovered');const eventNode=page.locator('.react-flow__node.selected .node-kind-eventButton');await eventNode.getByLabel(/触发时机$/).selectOption('press');await button('框选全部节点').focus();await page.keyboard.press('Control+z');await expect(eventNode.getByLabel(/触发时机$/)).toHaveValue('hover');await page.keyboard.press('Control+y');await expect(eventNode.getByLabel(/触发时机$/)).toHaveValue('press');
 await page.locator('[data-workspace-tab="assets"]').click();await page.getByRole('dialog',{name:'保存界面修改'}).getByRole('button',{name:'不保存',exact:true}).click();assert.equal(projectSchema.parse(JSON.parse(await fs.readFile(projectFile,'utf8'))).blueprints.find(g=>g.id===graph.id)!.nodes.find(n=>n.id===graph.nodes.find(n=>n.type==='eventButton'&&n.properties.trigger==='hover')!.id)!.properties.trigger,'hover');
 assert.deepEqual(errors,[]);await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',renderer:process.env.VNS_UI_BUTTON_DIST==='1'?'dist':'vite',checks:['四种按钮交互事件创建和重复定位','鼠标进入、按下、移出与外部松开不触发点击','正常鼠标与键盘激活','按住后禁用/隐藏取消后续事件','显式保存重开、事件修改撤销重做与放弃草稿']},null,2));
}catch(error){await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>undefined);await fs.writeFile(path.join(output,'failure.txt'),String(error)+'\n'+errors.join('\n'));throw error;}
finally{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();await server.close();console.log(output);}
