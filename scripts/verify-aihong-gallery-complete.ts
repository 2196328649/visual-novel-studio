import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { assetFiles,projectSchema } from '../src/core/model';
import { aihongGalleryDefaults,aihongGalleryGroups,type GallerySourceManifest } from './lib/aihong-gallery';
import { launchDesktopFixture } from './lib/desktop-fixture';

const root=path.resolve('.'),source=path.join(root,'resources/templates/aihong'),output=path.join(root,'artifacts/aihong-gallery-complete',new Date().toISOString().replaceAll(':','-')),fixture=path.join(output,'project');
const original=await fs.readFile(path.join(source,'project.vns.json'),'utf8'),project=projectSchema.parse(JSON.parse(original)),gallery=project.ui.components.find(c=>c.id==='ai_gallery_items')!,groups=gallery.list!.galleryGroups!;
const manifest:GallerySourceManifest=JSON.parse(await fs.readFile(path.join(root,'artifacts/aihong-gallery-source/manifest.json'),'utf8'));assert.deepEqual(groups.map(({unlockWhen: _condition, ...group})=>group),aihongGalleryGroups(manifest,aihongGalleryDefaults).groups);assert.equal(groups.length,94);assert.equal(groups.reduce((n,g)=>n+g.assetIds.length,0),381);
await fs.mkdir(fixture,{recursive:true});const projectFile=path.join(fixture,'project.vns.json');await fs.writeFile(projectFile,original);
for(const relative of new Set(project.assets.flatMap(assetFiles))){const destination=path.join(fixture,relative);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.link(path.join(source,relative),destination);}
const app=await launchDesktopFixture({root,projectFile,profile:path.join(output,'profile')}),page=await app.firstWindow();page.setDefaultTimeout(10000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});await page.locator('[data-workspace-tab="ui"]').click();await page.getByLabel('设计页面', { exact: true }).selectOption({ label: '画廊' });
 const design=page.locator('[data-component-id="ai_gallery_items"]');await expect(design.locator('[data-gallery-index]')).toHaveCount(8);await expect(design.locator('[data-gallery-page]')).toHaveCount(12);await expect.poll(()=>design.locator('[data-gallery-thumbnail]').evaluateAll(images=>images.every(i=>(i as HTMLImageElement).complete&&(i as HTMLImageElement).naturalWidth>0))).toBe(true);
 await page.locator('[data-hierarchy-id="ai_gallery_items"]').click();await expect(page.getByLabel(/^图鉴分组（/).locator('option')).toHaveCount(94);
 await page.getByLabel('界面编辑模式').getByRole('button',{name:'事件图',exact:true}).click();await page.getByRole('button',{name:'交互预演',exact:true}).click();const divider=page.getByRole('separator',{name:'调整画布与页面设置高度',exact:true});if(await divider.count()){await divider.focus();for(let i=0;i<18;i++)await page.keyboard.press('ArrowUp');}
 const frame=page.getByLabel('参数联动预演画面',{exact:true}),detail=frame.locator('.ui-gallery-detail-preview');let decoded=0;const pages=[];
 for(let p=0;p<12;p++){
  await page.getByRole('button',{name:'恢复测试值',exact:true}).click();
  await frame.getByRole('button',{name:'图鉴第 '+(p+1)+' 页',exact:true}).click();const chunk=groups.slice(p*8,p*8+8);await expect(frame.locator('[data-gallery-group]')).toHaveCount(chunk.length);
  await expect.poll(()=>frame.locator('[data-gallery-thumbnail]').evaluateAll(images=>images.every(i=>(i as HTMLImageElement).complete&&(i as HTMLImageElement).naturalWidth>0))).toBe(true);
  await frame.screenshot({path:path.join(output,'page-'+String(p+1).padStart(2,'0')+'.png')});
  for(const group of chunk){
   await frame.locator('[data-gallery-group="'+group.id+'"]').click();
   for(const assetId of group.assetIds){await expect(detail.locator('img')).toHaveAttribute('data-gallery-detail-asset',assetId);await detail.locator('img').evaluate(async(i:HTMLImageElement)=>{await i.decode();if(!i.naturalWidth)throw Error('图片未解码');});decoded++;await detail.getByRole('button',{name:'查看下一张图鉴',exact:true}).click();}
   await expect(detail).toHaveCount(0);await expect(frame.getByRole('button',{name:'图鉴第 '+(p+1)+' 页',exact:true})).toHaveAttribute('aria-current','page');
  }
  pages.push({page:p+1,groups:chunk.length,variants:chunk.reduce((n,g)=>n+g.assetIds.length,0)});console.log('Checked page',p+1,'images',decoded);
 }
 assert.equal(decoded,381);await page.getByRole('button',{name:'交互预演',exact:true}).click();await page.getByLabel('界面编辑模式').getByRole('button',{name:'设计',exact:true}).click();await page.locator('[data-hierarchy-id="ai_gallery_items"]').click();
 await page.getByLabel(/^图鉴分组（/).selectOption(groups.at(-1)!.id);await page.getByLabel('分组名称',{exact:true}).fill('最后一组编辑验收');await page.getByRole('button',{name:'保存界面',exact:true}).click();await expect(page.locator('.workspace-toolbar').getByText('已保存',{exact:true})).toBeVisible();
 const saved=projectSchema.parse(JSON.parse(await fs.readFile(projectFile,'utf8')));assert.equal(saved.ui.components.find(c=>c.id==='ai_gallery_items')!.list!.galleryGroups!.at(-1)!.name,'最后一组编辑验收');assert.equal(await fs.readFile(path.join(source,'project.vns.json'),'utf8'),original);assert.deepEqual(errors,[]);
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',renderer:'dist',groups:94,decodedVariants:decoded,pages,checks:['正式模板94组381分镜及12页','全部缩略图真实加载、全部分镜依序解码','每组末张返回原页','末组可编辑并实际保存','验收仅修改隔离副本，正式模板未被试玩写入']},null,2));
}catch(error){await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>undefined);await fs.writeFile(path.join(output,'failure.txt'),String(error)+'\n'+errors.join('\n'));throw error;}
finally{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();console.log(output);}
