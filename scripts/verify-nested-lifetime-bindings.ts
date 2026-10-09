import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { expect } from '@playwright/test';
import { createProject, projectSchema } from '../src/core/model';
import { createBlueprintGraph } from '../src/core/blueprint';
import { addTimelineComponent } from '../src/core/timeline-component';
import { createVisualObject, visualInputFields, visualPose } from '../src/core/visual-object';
import { rawSavedBlueprintAction } from '../src/core/blueprint-authoring';
import { insertTimelineAction, performanceLifetimes, timelineNodeActions } from '../src/core/performance-timeline';
import { compileProject } from '../src/runtime/compiler';
import { launchDesktopFixture } from './lib/desktop-fixture';

const root=path.resolve('.'),output=path.join(root,'artifacts/nested-lifetime-bindings',new Date().toISOString().replaceAll(':','-'));await fs.mkdir(output,{recursive:true});
const project=createProject('组合显示区间与参数验收');
for(const [id,color] of [['red',[210,40,50]],['blue',[40,75,220]]] as const){const png=new PNG({width:160,height:90});for(let i=0;i<png.data.length;i+=4){png.data[i]=color[0];png.data[i+1]=color[1];png.data[i+2]=color[2];png.data[i+3]=255;}await fs.writeFile(path.join(output,id+'.png'),PNG.sync.write(png));project.assets.push({id,name:id,kind:'image',category:'scene',path:id+'.png'});}
const owner=createBlueprintGraph('effect','调用组合');project.blueprints.push(owner);const {timeline}=addTimelineComponent(project,owner.id);
const child={...createVisualObject('image','red'),instanceId:'child',name:'移动的图片',startAt:.5,duration:1,retimeOnDuration:true,width:.25,height:.25,curves:{x:[{at:0,value:.2,easing:'linear' as const},{at:1,value:.8,easing:'linear' as const}]}};
const sibling={...createVisualObject('text'),instanceId:'sibling',name:'不变的文字',duration:4,text:'原始文字'};sibling.keyframes[0].y=.2;
const group={...createVisualObject('group'),instanceId:'group',name:'参数组合',duration:4,retimeOnDuration:true,children:[child,sibling]};
const nodeId=insertTimelineAction(project,timeline,group,0),node=timeline.nodes.find(n=>n.id===nodeId)!;
const field=(p:string)=>'object_'+visualInputFields(group).find(f=>f.path.join('/')===p)!.key;
node.properties.object_duration=8;node.properties[field('children/0/duration')]=1.5;node.properties[field('children/0/assetId')]='blue';node.properties[field('children/1/text')]='保留的文字参数';
const original=JSON.stringify(project),projectFile=path.join(output,'project.vns.json');await fs.writeFile(projectFile,original);
const app=await launchDesktopFixture({root,projectFile,profile:path.join(output,'profile')}),page=await app.firstWindow();page.setDefaultTimeout(10000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
const life=(id:string)=>page.locator('.lifetime-span[data-instance-id="'+id+'"]');
const interval=async(id:string,start:number,end:number)=>{await expect.poll(async()=>Number(await life(id).getAttribute('data-start'))).toBeCloseTo(start,6);await expect.poll(async()=>Number(await life(id).getAttribute('data-end'))).toBeCloseTo(end,6);};
const open=async()=>{await page.locator('[data-workspace-tab="blueprint"]').click();await page.getByLabel('演出目标',{exact:true}).selectOption('graph:'+timeline.id);await page.getByLabel('轨道缩放',{exact:true}).selectOption('60');await page.getByLabel('显示实例生命周期',{exact:true}).check();};
const seek=async(time:number)=>{const box=await page.getByLabel('时间标尺',{exact:true}).boundingBox();assert.ok(box);await page.mouse.click(box.x+130+time*60,box.y+12);};
try{
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});await open();await interval('child',1,4);
 await life('child').scrollIntoViewIfNeeded();const bounds=await life('child').boundingBox();assert.ok(bounds);await page.mouse.move(bounds.x+30,bounds.y+bounds.height/2);await page.mouse.down();await page.mouse.move(bounds.x+60,bounds.y+bounds.height/2,{steps:8});await page.mouse.up();await interval('child',1.5,4.5);
 const edge=await life('child').locator('[data-resize="lifetime"]').boundingBox();assert.ok(edge);await page.mouse.move(edge.x+edge.width/2,edge.y+edge.height/2);await page.mouse.down();await page.mouse.move(edge.x+edge.width/2-30,edge.y+edge.height/2,{steps:8});await page.mouse.up();await interval('child',1.5,4);
 await expect(page.getByLabel('对象持续秒数',{exact:true})).toHaveValue('1');await expect(page.locator('.timeline-clip-effects')).toContainText('原始 1.00 秒');
 await page.getByLabel('时间轴画布',{exact:true}).focus();await page.keyboard.press('Control+z');await interval('child',1.5,4.5);await page.keyboard.press('Control+y');await interval('child',1.5,4);
 await life('group').press('Alt+Shift+ArrowRight');await interval('group',0,9);await interval('child',1.6875,4.5);
 await seek(3.09375);const preview=page.locator('[data-visual-instance="child"]');await expect(preview).toHaveCount(1);await expect(preview.locator('image[href]')).toHaveAttribute('href',/blue.png/);await expect(page.locator('[data-visual-instance="sibling"]')).toContainText('保留的文字参数');
 await expect.poll(async()=>Number((await preview.locator(':scope > g').getAttribute('transform'))?.match(/^translate\(([-\d.]+)/)?.[1])).toBeCloseTo(project.width*.5,2);
 const sampled=page.getByLabel('当前横向位置 %',{exact:true});await expect(sampled).toHaveValue('50');await sampled.focus();await sampled.press('Tab');
 const image=PNG.sync.read(await page.locator('.text-stage').screenshot());let blue=0;for(let i=0;i<image.data.length;i+=4)if(image.data[i]<80&&image.data[i+1]<120&&image.data[i+2]>180)blue++;assert.ok(blue>1000);
 await page.screenshot({path:path.join(output,'verified.png')});await seek(4.6);await expect(preview).toHaveCount(0);await expect(page.locator('[data-visual-instance="sibling"]')).toHaveCount(1);
 assert.equal(await fs.readFile(projectFile,'utf8'),original);await page.getByRole('button',{name:'保存工程',exact:true}).click();await expect(page.locator('.dirty-dot')).toHaveCount(0);await expect(page.getByRole('contentinfo')).toContainText('工程已保存');
 const saved=projectSchema.parse(JSON.parse(await fs.readFile(projectFile,'utf8'))),graph=saved.blueprints.find(g=>g.id===timeline.id)!,source=graph.nodes.find(n=>n.id===nodeId)!,raw=rawSavedBlueprintAction(source)!;assert.ok(raw.kind==='visual');
 const expected=structuredClone(group);expected.children[0].startAt=.75;assert.deepEqual(raw,JSON.parse(JSON.stringify(expected)));assert.equal(source.properties.object_duration,9);assert.equal(source.properties[field('children/0/duration')],1.25);assert.equal(source.properties[field('children/0/assetId')],'blue');assert.equal(source.properties[field('children/1/text')],'保留的文字参数');
 const action=timelineNodeActions(saved,graph,source).find(a=>a.kind==='visual')!;assert.equal(action.children![0].duration,2.8125);assert.equal(visualPose(action.children![0],1.40625).x,.5);assert.equal(performanceLifetimes(saved,graph).find(r=>r.instanceId==='child')!.until,4.5);assert.deepEqual(compileProject(saved).diagnostics.filter(d=>d.severity==='error'),[]);
 await page.reload();await expect(page.locator('.project-title strong')).toHaveText(project.name);await open();await interval('child',1.6875,4.5);await seek(3.09375);await expect(preview.locator('image[href]')).toHaveAttribute('href',/blue.png/);
 assert.deepEqual(errors,[]);await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',renderer:'dist',projectFile,graphId:timeline.id,bluePixels:blue,checks:['参数缩放后实际拖动内部显示区间','右边缘裁短保留原动画和其他字面参数','撤销重做恢复实际区间','再次拉长外层组合保留同比缩放','预览素材、文字、位置和结束时刻一致','采样属性显示简洁小数且聚焦不改原始帧','显式保存重开、原始数据及导出校验']},null,2));
}catch(error){await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>undefined);await fs.writeFile(path.join(output,'failure.txt'),String(error));throw error;}
finally{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();console.log(output);}
