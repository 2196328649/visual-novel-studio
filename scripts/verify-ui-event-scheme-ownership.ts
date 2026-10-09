import { clickUiButtonEvent } from './lib/ui-disclosures';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { uiEventSchemeFixture } from './lib/ui-event-scheme-fixture';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { projectSchema } from '../src/core/model';
import { compileProject } from '../src/runtime/compiler';

const root=path.resolve('.'),output=path.join(root,'artifacts/ui-event-scheme-ownership',new Date().toISOString().replaceAll(':','-'));
await fs.mkdir(output,{recursive:true});const {project,parent}=uiEventSchemeFixture(),projectFile=path.join(output,'project.vns.json'),original=JSON.stringify(project);
await fs.writeFile(projectFile,original);const expectedParent=projectSchema.parse(JSON.parse(original)).blueprints.find(g=>g.id===parent.id)!;
const app=await launchDesktopFixture({root,projectFile,profile:path.join(output,'profile')}),page=await app.firstWindow();page.setDefaultTimeout(10000);
const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
const button=(name:string)=>page.getByRole('button',{name,exact:true}),graphs=page.getByLabel('当前页面事件图',{exact:true});
const control=(id:string)=>page.getByLabel('当前页面控件',{exact:true}).locator('[data-ui-component-id="'+id+'"]');
const mode=(name:string)=>page.getByLabel('界面编辑模式',{exact:true}).getByRole('button',{name,exact:true});
const enter=async()=>{await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});await page.locator('[data-workspace-tab="ui"]').click();await mode('事件图').click();await page.getByLabel('事件图页面',{exact:true}).selectOption('ui:preferences');};
const chooseParent=async()=>{await graphs.selectOption(parent.id);await expect(graphs).toHaveValue(parent.id);};
const save=async()=>{await button('保存界面').click();await expect(button('保存界面')).toBeDisabled();return projectSchema.parse(JSON.parse(await fs.readFile(projectFile,'utf8')));};
try{
 await enter();await expect(graphs).toHaveValue(parent.id);await expect(page.locator('.ui-event-notice')).toContainText('方案「父方案」');
 await control('trigger').click();await clickUiButtonEvent(page, '悬停时 · OnHovered');await expect(graphs).toHaveValue(parent.id);
 const inherited=page.getByLabel('继承控件事件',{exact:true});await expect(inherited).toContainText('原有事件仍会执行');await expect(button('为当前方案添加悬停事件')).toBeVisible();
 await page.screenshot({path:path.join(output,'inherited-events.png')});
 await clickUiButtonEvent(page, '按下时 · OnPressed');const childId=await graphs.inputValue();assert.notEqual(childId,parent.id);await expect(graphs.locator('option')).toHaveCount(2);await expect(page.locator('.react-flow__node')).toHaveCount(2);
 // Undo the creation as a whole, then restore the same owned graph.
 await button('框选全部节点').focus();await page.keyboard.press('Control+z');await expect(graphs.locator('option')).toHaveCount(1);await expect(graphs).toHaveValue(parent.id);
 await page.keyboard.press('Control+y');await expect(graphs.locator('option')).toHaveCount(2);await graphs.selectOption(childId);await expect(page.locator('.react-flow__node')).toHaveCount(2);
 await chooseParent();await control('slider').click();await button('值改变时 · OnValueChanged').click();await expect(graphs).toHaveValue(childId);await expect(page.locator('.node-kind-eventValueChanged')).toHaveCount(1);
 await button('值改变时 · OnValueChanged').click();await expect(page.locator('.react-flow__node')).toHaveCount(3);
 await chooseParent();await control('input').click();await button('文字提交时 · OnTextCommitted').click();await expect(graphs).toHaveValue(parent.id);
 await button('为当前方案添加文字提交事件').click();await expect(graphs).toHaveValue(childId);await expect(page.locator('.react-flow__node')).toHaveCount(4);
 await chooseParent();await button('文字提交时 · OnTextCommitted').click();await expect(graphs).toHaveValue(childId);await expect(page.locator('.node-kind-eventTextCommitted')).toHaveCount(1);
 await chooseParent();await control('trigger').click();await button('为当前方案添加悬停事件').click();await expect(graphs).toHaveValue(childId);await expect(page.locator('.node-kind-eventButton')).toHaveCount(2);
 await chooseParent();await clickUiButtonEvent(page, '悬停时 · OnHovered');await expect(graphs).toHaveValue(childId);await expect(button('为当前方案添加悬停事件')).toHaveCount(0);
 await chooseParent();await button('点击时 · OnClicked').click();await expect(graphs).toHaveValue(childId);await expect(page.locator('.react-flow__node')).toHaveCount(6);
 await chooseParent();await button('点击时 · OnClicked').click();await expect(graphs).toHaveValue(childId);await expect(page.locator('.node-kind-eventClick')).toHaveCount(1);
 assert.equal(await fs.readFile(projectFile,'utf8'),original);
 const saved=await save(),child=saved.blueprints.find(g=>g.id===childId)!;assert.equal(saved.blueprints.length,2);assert.equal(child.uiInstanceId,'child');assert.deepEqual(saved.blueprints.find(g=>g.id===parent.id),expectedParent);
 assert.ok(child.nodes.filter(n=>n.type!=='event').every(n=>n.properties.uiInstanceId==='child'));assert.deepEqual(compileProject(saved).diagnostics.filter(d=>d.severity==='error'),[]);
 await page.reload();await enter();await graphs.selectOption(childId);await expect(page.locator('.react-flow__node')).toHaveCount(6);await control('input').click();await button('文字提交时 · OnTextCommitted').click();await expect(graphs).toHaveValue(childId);await expect(button('保存界面')).toBeDisabled();
 await page.screenshot({path:path.join(output,'local-events.png')});
 for(const id of ['parent','sibling']){await mode('设计').click();await page.getByLabel('选择界面实例',{exact:true}).selectOption(id);await mode('事件图').click();await expect(graphs.locator('option')).toHaveCount(1);await expect(graphs).toHaveValue(parent.id);await expect(page.locator('.react-flow__node')).toHaveCount(3);await control('trigger').click();await clickUiButtonEvent(page, '悬停时 · OnHovered');await expect(graphs).toHaveValue(parent.id);}
 // A narrow sidebar must wrap the new inherited-event actions.
 await app.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];window.setMinimumSize(800,600);window.setSize(1024,768);});
 await button('为当前方案添加悬停事件').scrollIntoViewIfNeeded();await expect(button('为当前方案添加悬停事件')).toBeInViewport();const overflow=await inherited.evaluate(el=>({width:el.clientWidth,content:el.scrollWidth}));assert.ok(overflow.content<=overflow.width+1,JSON.stringify(overflow));assert.ok(await page.locator('.ui-event-library').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
 await page.screenshot({path:path.join(output,'inherited-events-narrow.png')});
 await mode('设计').click();await page.getByLabel('选择界面实例',{exact:true}).selectOption('child');await mode('事件图').click();await graphs.selectOption(childId);await expect(page.locator('.react-flow__node')).toHaveCount(6);
 await expect(button('保存界面')).toBeDisabled();const final=projectSchema.parse(JSON.parse(await fs.readFile(projectFile,'utf8')));assert.equal(final.ui.activeInstanceId,'child');assert.deepEqual(final.blueprints,saved.blueprints);assert.deepEqual(errors,[]);
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',renderer:'dist',checks:['继承事件来源与添加当前方案事件说明','按下事件新建子方案图及撤销重做','值改变事件复用本方案图且重复定位不新增','继承文字提交与悬停事件独立新增、优先定位本方案','点击事件复用本方案图','保存前磁盘未改、保存重开保留事件作用域和节点','父方案图完整未改、父方案与兄弟方案不显示子方案图','1024宽侧栏继承事件按钮换行'],parentGraphId:parent.id,childGraphId:childId},null,2));
}catch(error){await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>undefined);await fs.writeFile(path.join(output,'failure.txt'),String(error)+'\n'+errors.join('\n'));throw error;}
finally{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();console.log(output);}
