import { PNG } from 'pngjs';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { createProject, projectSchema } from '../src/core/model';
import { createVisualObject } from '../src/core/visual-object';
import { blueprintFromPerformance, rawSavedBlueprintAction } from '../src/core/blueprint-authoring';
import { arrangePerformanceTimeline, performanceTimeline } from '../src/core/performance-timeline';
import { launchDesktopFixture } from './lib/desktop-fixture';
const root=path.resolve('.'),output=path.join(root,'artifacts/text-clip',new Date().toISOString().replaceAll(':','-'));
await fs.mkdir(output,{recursive:true});
const project=createProject('文字样式验收'),object=createVisualObject('text');object.text='文字裁切';object.textClip={x:0,y:0,width:.5,height:1};object.fontSize=96;object.textEffects={outlineWidth:2,outlineColor:'#ff0000',shadowX:12,shadowY:8,shadowColor:'#0000ff',shadowOpacity:1};
const graph=blueprintFromPerformance(project,[object],'文字演出');graph.timelineComponent=true;project.blueprints.push(graph);const timeline=performanceTimeline(project,graph);arrangePerformanceTimeline(project,graph,timeline.clips,timeline.tracks);
const file=path.join(output,'project.vns.json');await fs.writeFile(file,JSON.stringify(projectSchema.parse(project)));
const app=await launchDesktopFixture({root,projectFile:file,profile:path.join(output,'profile')}),page=await app.firstWindow();
try{
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});await page.locator('[data-workspace-tab="blueprint"]').click();await page.getByLabel('演出目标',{exact:true}).selectOption('graph:'+graph.id);await page.locator('.timeline-clip').first().click();
 await page.getByText('描边与阴影',{exact:true}).click();await page.getByLabel('描边宽度',{exact:true}).fill('5');await page.getByLabel('阴影横向偏移',{exact:true}).fill('18');await page.getByLabel('阴影横向偏移',{exact:true}).press('Tab');
 const text=page.locator('[data-visual-text]');await expect(text).toHaveCount(1);const shadow=await text.evaluate(node=>getComputedStyle(node).textShadow);assert.ok(shadow.includes('18px')&&shadow.includes('5px'),shadow);
 const clip=await text.evaluate(node=>getComputedStyle(node).clipPath);assert.equal(clip,'inset(0% 50% 0% 0%)');
 const png=PNG.sync.read(await text.screenshot({path:path.join(output,'clip.png')}));let visible=0,outside=0;
 for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++){const i=(y*png.width+x)*4;if(png.data[i]>220&&png.data[i+1]>220&&png.data[i+2]>220){visible++;if(x>png.width/2+2)outside++;}}
 assert.ok(visible>20);assert.equal(outside,0);
 await page.getByRole('button',{name:'保存工程',exact:true}).click();await expect(page.locator('.dirty-dot')).toHaveCount(0);
 const saved=projectSchema.parse(JSON.parse(await fs.readFile(file,'utf8')));const action=rawSavedBlueprintAction(saved.blueprints.find(g=>g.id===graph.id)!.nodes.find(n=>n.type==='savedAction')!);assert.equal(action?.kind,'visual');if(action?.kind==='visual'){assert.deepEqual(action.textClip,{x:0,y:0,width:.5,height:1});assert.equal(action.textEffects?.outlineWidth,5);assert.equal(action.textEffects?.shadowX,18);}
 await page.reload();await expect(page.locator('.project-title strong')).toHaveText(project.name);await page.locator('[data-workspace-tab="blueprint"]').click();await page.getByLabel('演出目标',{exact:true}).selectOption('graph:'+graph.id);await expect(page.locator('[data-visual-text]')).toHaveCount(1);
 assert.equal(await page.locator('[data-visual-text]').evaluate(node=>getComputedStyle(node).textShadow),shadow);
 await page.screenshot({path:path.join(output,'desktop.png')});await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',shadow},null,2));
}finally{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(window=>window.destroy())).catch(()=>undefined);await app.close();console.log(output);}
