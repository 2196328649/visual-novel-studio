import { PNG } from 'pngjs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { createServer } from 'vite';
import { createProject } from '../src/core/model';
import { createVisualObject } from '../src/core/visual-object';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { launchDesktopFixture } from './lib/desktop-fixture';
const root=path.resolve('.'),output=path.join(root,'artifacts/visual-asset-picker',new Date().toISOString().replaceAll(':','-'));await fs.mkdir(output,{recursive:true});
const project=createProject('演出素材选择验收');
for(const id of ['image_a','image_b']){const png=new PNG({width:64,height:64});png.data.fill(255);await fs.writeFile(path.join(output,id+'.png'),PNG.sync.write(png));project.assets.push({id,name:id==='image_a'?'初始图片':'搜索目标图片',kind:'image',path:id+'.png'});}
await fs.copyFile(path.resolve(root,'../renpy/common/DejaVuSans.ttf'),path.join(output,'font.ttf'));project.assets.push({id:'font_a',name:'搜索目标字体',kind:'font',path:'font.ttf'});
const objects=[createVisualObject('image','image_a'),createVisualObject('text'),createVisualObject('particles')];
const graph=blueprintFromPerformance(project,objects,'时间轴');graph.timelineComponent=true;project.blueprints.push(graph);const nodes=graph.nodes.filter(n=>n.type==='savedAction');
const projectFile=path.join(output,'project.vns.json');await fs.writeFile(projectFile,JSON.stringify(project));
const server=await createServer({root,server:{host:'127.0.0.1',port:0,watch:{ignored:['**/artifacts/**','**/resources/**','**/release/**']}}});await server.listen();
const app=await launchDesktopFixture({root,projectFile,profile:path.join(output,'profile'),devUrl:'http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port}),page=await app.firstWindow();
try{
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});
 await page.locator('[data-workspace-tab="assets"]').click();await page.getByRole('button',{name:/^全部素材/}).click();await page.locator('[data-content-key="asset:image_b"]').click();
 await page.locator('[data-workspace-tab="blueprint"]').click();await page.getByLabel('演出目标',{exact:true}).selectOption('graph:'+graph.id);
 const choose=async(label:string,name:string)=>{await expect(page.getByRole('combobox',{name:label,exact:true})).toHaveCount(0);await page.getByRole('button',{name:'浏览'+label,exact:true}).click();await page.getByRole('textbox',{name:'搜索可选资源',exact:true}).fill(name);await page.getByRole('button',{name:'预览资源 '+name,exact:true}).dblclick();await expect(page.getByRole('button',{name:'浏览'+label,exact:true})).toContainText(name);};
 await page.locator('.timeline-clip[data-node-id="'+nodes[0].id+'"]').click();
 await page.getByRole('button',{name:'使用资源管理器选中素材：片段图片素材',exact:true}).click();await expect(page.getByRole('button',{name:'浏览片段图片素材',exact:true})).toContainText('搜索目标图片');
 await choose('片段图片素材','初始图片');
 await page.getByRole('tab',{name:'动画与效果',exact:true}).click();await page.locator('summary').filter({hasText:'遮罩与消散'}).click();await choose('透明度遮罩','搜索目标图片');
 await page.locator('.timeline-clip[data-node-id="'+nodes[1].id+'"]').click();await page.getByRole('tab',{name:'动画与效果',exact:true}).click();await expect(page.getByRole('button',{name:'使用资源管理器选中素材：对象字体',exact:true})).toBeDisabled();await choose('对象字体','搜索目标字体');
 await page.locator('.timeline-clip[data-node-id="'+nodes[2].id+'"]').click();await page.getByRole('tab',{name:'动画与效果',exact:true}).click();await page.locator('summary').filter({hasText:'字形发射'}).click();await page.getByLabel('从图片字形发射',{exact:true}).check();await choose('字形来源图片','搜索目标图片');
 await page.getByRole('button',{name:'保存工程',exact:true}).click();await expect(page.locator('.dirty-dot')).toHaveCount(0);
 const saved=JSON.parse(await fs.readFile(projectFile,'utf8')),actions=saved.blueprints.find((g:any)=>g.id===graph.id).nodes.filter((n:any)=>n.type==='savedAction').map((n:any)=>JSON.parse(n.properties.action));expect(actions[0].assetId).toBe('image_a');expect(actions[0].maskAssetId).toBe('image_b');expect(actions[1].fontAssetId).toBe('font_a');expect(actions[2].glyphParticles.assetId).toBe('image_b');
 await page.screenshot({path:path.join(output,'verified.png')});await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',checks:['对象图片使用资源管理器选择','图片、字体、遮罩和字形来源搜索窗口','错误素材类型禁止直接使用','保存字段正确']}));console.log(output);
}catch(error){await page.screenshot({path:path.join(output,'failure.png')});throw error;}finally{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();await server.close();}
