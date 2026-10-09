import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { projectSchema } from '../src/core/model';
import { synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { createUiConfirmPreviewFixture } from './lib/ui-confirm-preview-fixture';
import { launchDesktopFixture } from './lib/desktop-fixture';
const root=path.resolve('.'),output=path.join(root,'artifacts/ui-standard-confirm-preview',new Date().toISOString().replaceAll(':','-'));
const {project,nestedGraph,clocks,add,increment}=createUiConfirmPreviewFixture();
delete project.ui.pages!.messageBox;
project.ui.components.find(c=>c.id==='yes')!.events={onClick:nestedGraph.id};
increment(clocks,add(clocks,'eventTimer',{pageId:'ui:messageBox',interval:.1,repeat:true}),'after');
synchronizeBlueprintSignatures(project);
await fs.mkdir(output,{recursive:true});const projectFile=path.join(output,'project.vns.json');await fs.writeFile(projectFile,JSON.stringify(projectSchema.parse(project)));
const before=await fs.readFile(projectFile,'utf8'),app=await launchDesktopFixture({root,projectFile,profile:path.join(output,'profile')}),page=await app.firstWindow(),errors:string[]=[];
page.on('pageerror',error=>errors.push(error.message));
try{
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});await page.locator('[data-workspace-tab="ui"]').click();await page.getByRole('button',{name:'高级 UI 蓝图',exact:true}).click();await page.locator('.ui-logic-preview > summary').click();
 const divider=page.getByRole('separator',{name:'调整画布与页面设置高度',exact:true});for(let i=0;i<18;i++)await divider.press('ArrowUp');
 const frame=page.getByLabel('参数联动预演画面',{exact:true}),active=frame.locator('[data-preview-page]:not([inert]):not([hidden])'),name=page.getByLabel('当前预演页面',{exact:true}),value=(key:string)=>page.getByLabel('预演参数 '+key,{exact:true});
 const click=(text:string)=>active.getByRole('button',{name:text,exact:true}).click();
 await page.getByLabel('按时间预演',{exact:true}).check();await click('询问确认');
 await expect(active.getByLabel('标准确认框预演',{exact:true})).toBeVisible();await expect(active.getByLabel('确认提示',{exact:true})).toHaveText(project.variables.find(v=>v.id==='message')!.initial as string);
 await expect(active.locator('[data-preview-component]')).toHaveCount(0);await page.getByRole('button',{name:'推进 1 秒',exact:true}).click();await expect(value('after')).toHaveValue('0');await expect(value('base_ticks')).toHaveValue('1');
 await frame.screenshot({path:path.join(output,'standard-frame.png')});await click('确认');await expect(value('关闭结果')).toHaveValue('已确认');await expect(value('after')).toHaveValue('1');await expect(value('子页结果')).toHaveValue('尚未返回');await expect(active.getByRole('button',{name:'询问确认',exact:true})).toBeFocused();
 await click('询问确认');await click('取消');await expect(value('关闭结果')).toHaveValue('已取消');await expect(value('after')).toHaveValue('2');
 await click('询问确认');await page.keyboard.press('Escape');await expect(value('after')).toHaveValue('3');
 await click('询问确认');await frame.click({position:{x:15,y:15},button:'right'});await expect(value('after')).toHaveValue('4');
 await value('提示内容').fill('标准长提示 [name] {b}\n'.repeat(100));await value('提示内容').press('Tab');await click('询问确认');
 const prompt=active.getByLabel('确认提示',{exact:true});expect(await prompt.evaluate(e=>e.scrollHeight>e.clientHeight)).toBe(true);await prompt.evaluate(e=>e.scrollTop=e.scrollHeight);expect(await prompt.evaluate(e=>e.scrollTop)).toBeGreaterThan(0);
 const bounds=await frame.boundingBox(),button=await active.getByRole('button',{name:'取消',exact:true}).boundingBox();expect(button!.y+button!.height).toBeLessThanOrEqual(bounds!.y+bounds!.height);
 await frame.screenshot({path:path.join(output,'standard-long-frame.png')});await click('取消');await expect(name).toHaveText('标题');await expect(value('after')).toHaveValue('5');
 await expect(page.locator('.dirty-dot')).toHaveCount(0);expect(await fs.readFile(projectFile,'utf8')).toBe(before);expect(errors).toEqual([]);
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',compiledBuild:true,checks:['标准提示字面显示及独立确认/取消','不执行自定义消息框按钮和计时事件，底层计时继续','Esc与右键取消','长提示可滚动且按钮留在预演框内','返回焦点，UI草稿与磁盘不变'],errors},null,2));console.log(output);
}catch(error){await page.screenshot({path:path.join(output,'failure.png')});throw error;}
finally{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();}
