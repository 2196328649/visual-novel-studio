import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { expect } from '@playwright/test';
import { createProject, projectSchema } from '../src/core/model';
import { createBlueprintGraph } from '../src/core/blueprint';
import { addTimelineComponent } from '../src/core/timeline-component';
import { createVisualObject, visualPose } from '../src/core/visual-object';
import { exposePerformanceInputs, performanceInputs, rawSavedBlueprintAction } from '../src/core/blueprint-authoring';
import { insertTimelineAction, performanceTimeline, timelineNodeActions } from '../src/core/performance-timeline';
import { compileProject } from '../src/runtime/compiler';
import { launchDesktopFixture } from './lib/desktop-fixture';

const root=path.resolve('.'),output=path.join(root,'artifacts/visual-clip-bindings',new Date().toISOString().replaceAll(':','-'));await fs.mkdir(output,{recursive:true});
const project=createProject('图片参数与动画编辑验收');
for(const [id,name,color] of [['red','默认红图',[210,40,50]],['blue','传入蓝图',[40,75,220]]] as const){const png=new PNG({width:160,height:90});for(let i=0;i<png.data.length;i+=4){png.data[i]=color[0];png.data[i+1]=color[1];png.data[i+2]=color[2];png.data[i+3]=255;}await fs.writeFile(path.join(output,id+'.png'),PNG.sync.write(png));project.assets.push({id,name,kind:'image',category:'scene',path:id+'.png'});}
const owner=createBlueprintGraph('effect','调用图片演出');project.blueprints.push(owner);const {timeline}=addTimelineComponent(project,owner.id);
const image={...createVisualObject('image','red'),instanceId:'moving_image',width:.6,height:.3,duration:3,retimeOnDuration:true,curves:{x:[{at:0,value:.2,easing:'linear' as const},{at:3,value:.8,easing:'linear' as const}]}};image.keyframes[0].y=.6;
const imageId=insertTimelineAction(project,timeline,image,0),imageNode=timeline.nodes.find(n=>n.id===imageId)!;imageNode.properties.object_duration=6;
const text={...createVisualObject('text'),instanceId:'bound_text',text:'默认文字',duration:9};text.keyframes[0].y=.13;
const textId=insertTimelineAction(project,timeline,text,0);
for(const [nodeId,pinId,name,value] of [[imageId,'object_assetId','替换图片','blue'],[textId,'object_text','传入文字','实际生效的文字']] as const){const input=performanceInputs(timeline).find(p=>p.nodeId===nodeId&&p.pinId===pinId)!;exposePerformanceInputs(timeline,[{...input,name}]);timeline.exposedInputs.at(-1)!.defaultValue=value;}
const original=JSON.stringify(project),projectFile=path.join(output,'project.vns.json');await fs.writeFile(projectFile,original);
const app=await launchDesktopFixture({root,projectFile,profile:path.join(output,'profile')}),page=await app.firstWindow();page.setDefaultTimeout(10000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
const button=(name:string)=>page.getByRole('button',{name,exact:true}),clip=(id:string)=>page.locator('.timeline-clip[data-node-id="'+id+'"]');
const set=async(name:string,value:string)=>{const input=page.getByLabel(name,{exact:true});await input.fill(value);await input.press('Tab');};
const open=async()=>{await page.locator('[data-workspace-tab="blueprint"]').click();await page.getByLabel('演出目标',{exact:true}).selectOption('graph:'+timeline.id);await page.getByLabel('轨道缩放',{exact:true}).selectOption('60');};
const seek=async(time:number)=>{const ruler=await page.getByLabel('时间标尺',{exact:true}).boundingBox();assert.ok(ruler);await page.mouse.click(ruler.x+130+time*60,ruler.y+12);};
try{
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});await open();await clip(imageId).click();
 await expect(clip(imageId).locator('img')).toHaveAttribute('src',/blue.png/);await expect.poll(()=>clip(imageId).locator('img').evaluate(el=>(el as HTMLImageElement).naturalWidth)).toBe(160);
 await expect(page.locator('.timeline-clip-basics')).toContainText('传入蓝图');await expect(page.getByLabel('片段显示时长',{exact:true})).toHaveValue('6');await expect(page.getByLabel('水平位置 %',{exact:true})).toHaveValue('20');
 await set('片段名称','保留绑定的图片');await set('宽度 %','40');await set('水平位置 %','10');await expect(page.getByLabel('片段显示时长',{exact:true})).toHaveValue('6');
 await set('片段显示时长','9');await expect(clip(imageId)).toHaveAttribute('data-duration','9');
 await page.locator('.timeline-clip-effects > summary').click();await expect(page.locator('.timeline-clip-effects')).toContainText('原始 3.00 秒');await expect(page.getByLabel('对象持续秒数',{exact:true})).toHaveValue('3');await set('对象名称','修改源对象名称');await expect(clip(imageId)).toHaveAttribute('data-duration','9');await page.locator('.timeline-clip-effects > summary').click();
 await seek(3);const visual=page.locator('[data-visual-instance="moving_image"]');await expect.poll(async()=>Number((await visual.locator(':scope > g').getAttribute('transform'))?.match(/^translate\(([-\d.]+)/)?.[1])).toBeCloseTo(project.width/3,2);
 const png=PNG.sync.read(await page.locator('.text-stage').screenshot()),i=(Math.floor(png.height*.6)*png.width+Math.floor(png.width/3))*4;assert.ok(png.data[i+2]>180&&png.data[i]<80,'Actual preview displays the blue source');
 await clip(textId).click();await expect(page.getByLabel('文字内容',{exact:true})).toHaveValue('实际生效的文字');await expect(page.getByLabel('文字内容',{exact:true})).toBeDisabled();await set('片段名称','绑定文字改名');
 await page.getByLabel('时间轴画布',{exact:true}).focus();await page.keyboard.press('Control+z');await expect(clip(textId)).toContainText('文字');await page.keyboard.press('Control+y');await expect(clip(textId)).toContainText('绑定文字改名');
 assert.equal(await fs.readFile(projectFile,'utf8'),original);await button('保存工程').click();await expect(page.locator('.dirty-dot')).toHaveCount(0);await expect(page.getByRole('contentinfo')).toContainText('工程已保存');
 const saved=projectSchema.parse(JSON.parse(await fs.readFile(projectFile,'utf8'))),graph=saved.blueprints.find(g=>g.id===timeline.id)!,node=graph.nodes.find(n=>n.id===imageId)!,raw=rawSavedBlueprintAction(node)!;assert.ok(raw.kind==='visual');assert.equal(raw.assetId,'red');assert.equal(raw.duration,3);assert.equal(raw.curves!.x!.at(-1)!.at,3);assert.equal(raw.curves!.x![0].value,.1);assert.equal(node.properties.object_duration,9);assert.deepEqual(graph.exposedInputs,timeline.exposedInputs);assert.equal(graph.links.filter(l=>l.toPinId==='object_assetId'||l.toPinId==='object_text').length,2);
 const resolved=timelineNodeActions(saved,graph,node).find(a=>a.kind==='visual')!;assert.equal(resolved.duration,9);assert.equal(resolved.assetId,'blue');assert.ok(Math.abs(visualPose(resolved,3).x-1/3)<1e-8);assert.equal(performanceTimeline(saved,graph).clips.find(c=>c.nodeId===imageId)!.duration,9);assert.deepEqual(compileProject(saved).diagnostics.filter(d=>d.severity==='error'),[]);
 await page.reload();await expect(page.locator('.project-title strong')).toHaveText(project.name);await open();await clip(imageId).click();await expect(clip(imageId).locator('img')).toHaveAttribute('src',/blue.png/);await expect(page.getByLabel('片段显示时长',{exact:true})).toHaveValue('9');await seek(3);await page.screenshot({path:path.join(output,'verified.png')});
 assert.deepEqual(errors,[]);await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',renderer:'dist',projectFile,checks:['绑定图片的素材字段、缩略图与真实画面一致','名称和宽度修改不折入素材及动画参数','曲线存在时初始位置编辑生效','修改片段时长保留原动画时钟','动画源对象编辑不丢字面时长覆盖','绑定文字显示生效内容且改名保留参数','撤销重做、显式保存重开及编译校验']},null,2));
}catch(error){await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>undefined);await fs.writeFile(path.join(output,'failure.txt'),String(error));throw error;}
finally{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();console.log(output);}
