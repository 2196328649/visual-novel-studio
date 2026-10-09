import { expect } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';
import { assetFiles } from '../src/core/model';
import { parseProject, assetSourcePath } from '../src/desktop/project-store';

const root=process.cwd(),projectFile=process.argv[2];
if(!projectFile)throw Error('Pass the project file to verify');
const source=path.dirname(path.resolve(projectFile));
const before=await fs.readFile(projectFile,'utf8'),project=parseProject(JSON.parse(before)).project;
const files=new Set(project.assets.flatMap(a=>assetFiles(a).map(file=>assetSourcePath(source,a,file))));
for(const file of files)await fs.access(file);
const output=path.join(root,'artifacts/restored-assets',new Date().toISOString().replaceAll(':','-'));
const profile=path.join(output,'profile');await fs.mkdir(profile,{recursive:true});
const app=await launchDesktopFixture({root,profile,projectFile:path.resolve(projectFile)});
const page=await app.firstWindow(),errors:string[]=[];
page.on('pageerror',error=>errors.push(error.message));
try{
  await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:60000});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1450,900));
  const audit=async(tag:string)=>page.evaluate(async({assets,tag})=>{
    const failures:string[]=[];
    for(let i=0;i<assets.length;i+=6)await Promise.all(assets.slice(i,i+6).map(async asset=>{
      const image=new Image();image.src=window.studio!.assetUrl(asset.path)+'?verify='+tag;
      try{await image.decode();if(image.naturalWidth<=0||image.naturalHeight<=0)throw Error('empty');}catch{failures.push(asset.name+': '+asset.path);}finally{image.src='';}
    }));
    return {images:assets.length,failures};
  },{assets:project.assets.filter(a=>a.kind==='image').map(({name,path})=>({name,path})),tag});
  const initial=await audit('initial');expect(initial.failures).toEqual([]);
  // Use a fresh isolated profile, and evict Chromium's real cache before another decode.
  await app.evaluate(async({session})=>{await session.defaultSession.clearCache();});
  for(const folder of ['temp','build','builds']){
    const target=path.resolve(profile,folder);if(!target.startsWith(path.resolve(profile)+path.sep))throw Error('Invalid fixture path');
    await fs.rm(target,{recursive:true,force:true});
  }
  const uncached=await audit('cache-cleared');expect(uncached.failures).toEqual([]);

  await page.locator('[data-workspace-tab="assets"]').click();
  const browser=page.getByRole('region',{name:'资源管理器'});
  await browser.getByRole('button',{name:/^全部素材/}).click();
  await browser.getByLabel('搜索资源和蓝图').fill('封面');
  const cover=browser.locator('[data-content-key="asset:ai_ui_d3ac9d00d76cb035"]');
  await expect(cover).toBeVisible();await cover.click();
  const preview=browser.getByRole('complementary',{name:'资源预览'}).locator('img');
  await expect.poll(()=>preview.evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBe(true);
  await page.screenshot({path:path.join(output,'resource-preview.png')});
  await openStoryMode(page,'script');
  await expect(page.locator('.story-preview-content')).toBeVisible();
  await expect.poll(()=>page.locator('.story-preview-content img').count(),{timeout:20000}).toBeGreaterThan(0);
  await expect.poll(()=>page.locator('.story-preview-content img').evaluateAll(images=>images.every(image=>(image as HTMLImageElement).complete&&(image as HTMLImageElement).naturalWidth>0))).toBe(true);
  const timeline=page.locator('.story-preview-content input[type="range"]').first();
  if(await timeline.isVisible()){const size=await timeline.boundingBox();await timeline.click({position:{x:size!.width*.5,y:size!.height/2}});}
  await expect.poll(()=>page.locator('.preview-stage-viewport img').evaluateAll(images=>images.some(image=>image.getBoundingClientRect().width>10&&(image as HTMLImageElement).naturalWidth>0))).toBe(true);
  await page.screenshot({path:path.join(output,'stage-preview.png')});
  expect(await fs.readFile(projectFile,'utf8')).toBe(before);
  expect(errors).toEqual([]);
  const report={projectId:project.id,assets:project.assets.length,files:files.size,initial,uncached,resourcePreview:true,stagePreview:true,projectUnchanged:true,errors};
  await fs.writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({output,...report},null,2));
}catch(error){await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});console.error(output);throw error;}
finally{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>{});await app.close();}
