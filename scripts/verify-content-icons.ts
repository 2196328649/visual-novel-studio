import { PNG } from 'pngjs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { createServer } from 'vite';
import { createProject } from '../src/core/model';
import { blueprintNodeDefaults, createBlueprintGraph } from '../src/core/blueprint';
import { launchDesktopFixture } from './lib/desktop-fixture';
const root=path.resolve('.'), output=path.join(root,'artifacts/content-icons',new Date().toISOString().replaceAll(':','-'));
await fs.mkdir(output,{recursive:true});
const project=createProject('真实素材布局验收');const source=JSON.parse(await fs.readFile('D:/LiuXiangdong/Documents/project.vns.json','utf8'));
project.assets=source.assets.filter((a:any)=>a.kind==='image').slice(0,100);project.contentBrowser=source.contentBrowser;
for(const [index,asset] of project.assets.entries()){const file=path.resolve('D:/LiuXiangdong/Documents',asset.path);asset.path='assets/'+index+path.extname(file);const dest=path.join(output,asset.path);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.copyFile(file,dest);}
const projectFile=path.join(output,'project.vns.json');await fs.writeFile(projectFile,JSON.stringify(project));
const server=await createServer({root,server:{host:'127.0.0.1',port:0,watch:{ignored:['**/artifacts/**','**/resources/**','**/release/**']}}});await server.listen();
const app=await launchDesktopFixture({root,projectFile,profile:path.join(output,'profile'),devUrl:'http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port}),page=await app.firstWindow();const results=[];
try {
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});
 await page.locator('[data-workspace-tab="assets"]').click();await page.getByRole('button',{name:/^全部内容/}).click();
 for(const width of [1480,1024]){await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,800),width);await page.waitForTimeout(300);
 await expect.poll(()=>page.locator('.content-thumbnail img').evaluateAll(els=>els.slice(0,15).every(el=>(el as HTMLImageElement).complete&&(el as HTMLImageElement).naturalWidth>0)),{timeout:15000}).toBe(true);
 const state=await page.locator('.content-browser').evaluate(el=>{const surface=el.getBoundingClientRect();return {width:surface.width,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,toolbar:[...el.querySelectorAll('.content-toolbar button')].map(el=>{const r=el.getBoundingClientRect();return {name:el.getAttribute('title')||el.textContent,right:r.right,outside:r.right>surface.right};}),captions:[...el.querySelectorAll('.content-item > small')].map(el=>{const r=el.getBoundingClientRect(),card=el.parentElement!.getBoundingClientRect();return {text:el.textContent,clipped:r.bottom>card.bottom-1};}),images:[...el.querySelectorAll('.content-thumbnail img')].slice(0,15).map(el=>{const img=el as HTMLImageElement,r=el.getBoundingClientRect(),parent=el.parentElement!.getBoundingClientRect();return {loaded:img.complete&&img.naturalWidth>0,clipped:r.width>parent.width+1||r.height>parent.height+1};})};});assert.ok(state.captions.every(c=>!c.clipped),'资源卡片名称／分类被裁切');assert.ok(state.toolbar.every(button=>!button.outside),'工具栏按钮超出面板');assert.ok(state.images.length>0&&state.images.every(img=>img.loaded&&!img.clipped),'缩略图未加载或被裁切');assert.ok(state.scrollWidth<=state.clientWidth+1,'素材面板横向溢出');results.push(state);await page.screenshot({path:path.join(output,'assets-'+width+'.png')});}
 await page.locator('.content-item').last().scrollIntoViewIfNeeded();await expect(page.locator('.content-item').last()).toBeVisible();
 await page.getByRole('button',{name:'列表视图',exact:true}).click();await expect(page.locator('.content-items')).toHaveClass(/list/);
 await page.screenshot({path:path.join(output,'list.png')});
 await page.locator('[data-workspace-tab="script"]').click();await page.getByRole('button',{name:/^资源管理器/}).click();
 const dock=page.locator('.content-dock');await expect(dock).toBeVisible();await dock.getByRole('button',{name:/^全部内容/}).click();
 const clipped=await dock.locator('.content-item > small').evaluateAll(els=>els.some(el=>el.getBoundingClientRect().bottom>el.parentElement!.getBoundingClientRect().bottom-1));assert.equal(clipped,false);
 await page.screenshot({path:path.join(output,'dock.png')});
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',sourceImageCount:project.assets.length,checks:['100项实际素材副本','1480/1024宽度工具栏及卡片不裁切','首15张缩略图实际加载且边界完整','列表与底部资源管理器'],measurements:results},null,2));console.log(output);
}finally {await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();await server.close();}
