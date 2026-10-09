import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { createProject, projectSchema } from '../src/core/model';
import { createBlueprintGraph } from '../src/core/blueprint';
import { addTimelineComponent } from '../src/core/timeline-component';
import { exposePerformanceInputs, performanceInputs, rawSavedBlueprintAction } from '../src/core/blueprint-authoring';
import { createAudioClip } from '../src/core/audio-clip';
import { arrangePerformanceTimeline, insertTimelineAction, performanceTimeline, timelineNodeActions } from '../src/core/performance-timeline';
import { timelineOverlap } from '../src/core/timeline-editing';
import { compileProject } from '../src/runtime/compiler';
import { launchDesktopFixture } from './lib/desktop-fixture';

const root=path.resolve('.'),output=path.join(root,'artifacts/timeline-audio-bindings',new Date().toISOString().replaceAll(':','-'));await fs.mkdir(output,{recursive:true});
const project=createProject('音频参数裁剪验收');
for(const [id,duration] of [['short',4],['long',12]] as const){
 const rate=22050,size=rate*duration*2,b=Buffer.alloc(44+size);b.write('RIFF');b.writeUInt32LE(36+size,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(size,40);for(let i=0;i<size/2;i++)b.writeInt16LE(Math.round(1800*Math.sin(2*Math.PI*440*i/rate)),44+i*2);await fs.writeFile(path.join(output,id+'.wav'),b);project.assets.push({id,name:id==='short'?'原音频四秒':'替换音频十二秒',kind:'audio',path:id+'.wav'});
}
const owner=createBlueprintGraph('effect','调用音频时间轴');project.blueprints.push(owner);const {timeline,node:call}=addTimelineComponent(project,owner.id);
const add=(name:string,at:number)=>insertTimelineAction(project,timeline,{...createAudioClip('short',name,4),duration:1},at);
const longId=add('换源音频',0),offsetId=add('截取音频',1),neighborId=add('后续音频',9);
const model=performanceTimeline(project,timeline),tracks=[{id:'top',name:'换源轨道'},{id:'bottom',name:'截取轨道'}];
arrangePerformanceTimeline(project,timeline,model.clips.map(c=>({...c,at:c.nodeId===neighborId?9:0,trackId:c.nodeId===offsetId?'bottom':'top'})),tracks);
for(const [nodeId,pinId,name,value] of [[longId,'clip_assetId','替换素材','long'],[longId,'clip_offset','换源截取点',2],[offsetId,'clip_offset','原素材截取点',3]] as const){const input=performanceInputs(timeline).find(p=>p.nodeId===nodeId&&p.pinId===pinId)!;exposePerformanceInputs(timeline,[{...input,name}]);timeline.exposedInputs.at(-1)!.defaultValue=value;}
timeline.nodes.find(n=>n.id===longId)!.properties.clip_volume=.35;
const original=JSON.stringify(project),projectFile=path.join(output,'project.vns.json');await fs.writeFile(projectFile,original);
const app=await launchDesktopFixture({root,projectFile,profile:path.join(output,'profile')}),page=await app.firstWindow();page.setDefaultTimeout(10000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
const button=(name:string)=>page.getByRole('button',{name,exact:true}),clip=(id:string)=>page.locator('.timeline-clip[data-node-id="'+id+'"]');
const open=async()=>{await page.locator('[data-workspace-tab="blueprint"]').click();await page.getByLabel('演出目标',{exact:true}).selectOption('graph:'+timeline.id);await page.getByLabel('轨道缩放',{exact:true}).selectOption('60');};
const set=async(label:string,value:string)=>{await page.getByLabel(label,{exact:true}).fill(value);await page.getByLabel(label,{exact:true}).press('Tab');};
const resize=async(id:string,delta:number)=>{const handle=await clip(id).locator('.timeline-resize').boundingBox();assert.ok(handle);await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(handle.x+handle.width/2+delta*60,handle.y+handle.height/2,{steps:15});await page.mouse.up();};
try{
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});await open();await clip(longId).click();
 await expect(page.locator('.timeline-audio-properties')).toContainText('替换音频十二秒');await expect(page.getByLabel('音频截取起点',{exact:true})).toHaveValue('2');await expect(page.getByLabel('音频截取起点',{exact:true})).toBeDisabled();await expect(page.getByLabel('音频片段音量',{exact:true})).toHaveValue('35');await expect(page.locator('.timeline-audio-properties')).not.toContainText('原素材 4.00 秒');
 await resize(longId,6);await expect(clip(longId)).toHaveAttribute('data-duration','7');await expect(page.getByLabel('音频片段时长',{exact:true})).toHaveValue('7');
 await set('音频片段名称','换源后已裁剪');await set('音频淡入秒数','.2');await expect(clip(longId)).toHaveAttribute('data-duration','7');await expect(page.getByLabel('音频片段音量',{exact:true})).toHaveValue('35');
 await resize(longId,5);await expect(clip(longId)).toHaveAttribute('data-duration','9');await expect(clip(neighborId)).toHaveAttribute('data-start','9');
 await page.getByLabel('时间轴画布',{exact:true}).focus();await page.keyboard.press('Control+z');await expect(clip(longId)).toHaveAttribute('data-duration','7');await page.keyboard.press('Control+y');await expect(clip(longId)).toHaveAttribute('data-duration','9');
 await set('音频片段时长','8');await expect(clip(longId)).toHaveAttribute('data-duration','8');
 await clip(offsetId).click();await expect(page.getByLabel('音频截取起点',{exact:true})).toHaveValue('3');await expect(page.locator('.timeline-audio-properties')).toContainText('使用 3.00–4.00 秒');await resize(offsetId,5);await expect(clip(offsetId)).toHaveAttribute('data-duration','1');await expect(page.getByLabel('音频片段时长',{exact:true})).toHaveValue('1');
 await clip(longId).click();await page.evaluate(()=>{const Real=window.Audio;(window as any).audioProbe=[];window.Audio=function(url?:string){const a=new Real(url);(window as any).audioProbe.push(a);return a;} as any;});
 const ruler=await page.getByLabel('时间标尺',{exact:true}).boundingBox();assert.ok(ruler);await page.mouse.click(ruler.x+130+5*60,ruler.y+12);await button('播放预览').click();
 await expect.poll(()=>page.evaluate(()=>(window as any).audioProbe.filter((a:HTMLAudioElement)=>!a.paused).map((a:HTMLAudioElement)=>({time:a.currentTime,src:a.src,volume:a.volume})))).toEqual([expect.objectContaining({src:expect.stringContaining('/long'),volume:.35,time:expect.any(Number)})]);
 const times=await page.evaluate(()=>(window as any).audioProbe.filter((a:HTMLAudioElement)=>!a.paused).map((a:HTMLAudioElement)=>a.currentTime));assert.ok(times[0]>=7&&times[0]<8);await button('停止预览').click();
 assert.equal(await fs.readFile(projectFile,'utf8'),original);await button('保存工程').click();await expect(page.locator('.dirty-dot')).toHaveCount(0);await expect(page.getByRole('contentinfo')).toContainText('工程已保存');
 const saved=projectSchema.parse(JSON.parse(await fs.readFile(projectFile,'utf8'))),graph=saved.blueprints.find(g=>g.id===timeline.id)!,savedNode=graph.nodes.find(n=>n.id===longId)!;
 assert.equal(timelineOverlap(performanceTimeline(saved,graph).clips),undefined);assert.deepEqual(graph.exposedInputs,timeline.exposedInputs);assert.equal(graph.links.filter(l=>l.toPinId.startsWith('clip_')).length,3);assert.equal(rawSavedBlueprintAction(savedNode)?.kind,'audioClip');const raw=rawSavedBlueprintAction(savedNode)!;assert.ok(raw.kind==='audioClip');assert.equal(raw.assetId,'short');assert.equal(raw.offset,0);assert.equal(savedNode.properties.clip_volume,.35);assert.equal(timelineNodeActions(saved,graph,savedNode).find(a=>a.kind==='audioClip')!.duration,8);assert.deepEqual(compileProject(saved).diagnostics.filter(d=>d.severity==='error'),[]);
 await page.reload();await expect(page.locator('.project-title strong')).toHaveText(project.name);await open();await clip(longId).click();await expect(page.getByLabel('音频片段时长',{exact:true})).toHaveValue('8');await expect(page.getByLabel('音频截取起点',{exact:true})).toHaveValue('2');await page.screenshot({path:path.join(output,'verified.png')});
 assert.deepEqual(errors,[]);await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',renderer:'dist',projectFile,checks:['参数替换素材和截取点显示实际值','换源后可拖过原文件长度','同轨后续片段边界限制及撤销重做','当前截取点决定原文件裁剪上限','无关属性编辑保留输入绑定及字面音量','真实媒体从有效偏移试播','保存重开、无重叠、原素材默认值保留、编译通过']},null,2));
}catch(error){await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>undefined);await fs.writeFile(path.join(output,'failure.txt'),String(error));throw error;}
finally{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();console.log(output);}
