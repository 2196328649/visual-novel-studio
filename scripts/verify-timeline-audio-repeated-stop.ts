import { execFileSync } from 'node:child_process';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { performanceTimeline, arrangePerformanceTimeline } from '../src/core/performance-timeline';
import { PNG } from 'pngjs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { createServer } from 'vite';
import { createProject } from '../src/core/model';
import { blueprintNodeDefaults, createBlueprintGraph } from '../src/core/blueprint';
import { launchDesktopFixture } from './lib/desktop-fixture';
const root=path.resolve('.'), output=path.join(root,'artifacts/timeline-audio-repeated-stop',new Date().toISOString().replaceAll(':','-'));
await fs.mkdir(output,{recursive:true});
const format=process.env.VNS_AUDIO_FORMAT??'wav';if(!['wav','ogg','mp3'].includes(format))throw Error('Unsupported fixture audio format');
const project=createProject('时间轴声音定位验收');
for(const [id,seconds] of [['music',2.7],['effect',.5]] as const){const rate=8000,size=rate*seconds*2,b=Buffer.alloc(44+size);b.write('RIFF');b.writeUInt32LE(36+size,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(size,40);for(let i=0;i<size/2;i++)b.writeInt16LE(Math.round(2400*Math.sin(2*Math.PI*(id==='music'?220:660)*i/rate)),44+i*2);await fs.writeFile(path.join(output,id+'.wav'),b);if(format!=='wav')execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',path.join(output,id+'.wav'),...(format==='ogg'?['-c:a','libvorbis']:['-c:a','libmp3lame']),path.join(output,id+'.'+format)]);project.assets.push({id,name:id,kind:'audio',path:id+'.'+format});}
const graph=blueprintFromPerformance(project,[{kind:'music',assetId:'music',loop:true,fade:0},{kind:'pause',seconds:1},{kind:'sound',assetId:'effect'},{kind:'pause',seconds:3},{kind:'stopMusic',fade:2},{kind:'pause',seconds:1},{kind:'stopMusic',fade:2},{kind:'pause',seconds:3},{kind:'stopMusic',fade:2},{kind:'pause',seconds:3}],'声音时间轴');graph.timelineComponent=true;project.blueprints.push(graph);const model=performanceTimeline(project,graph);arrangePerformanceTimeline(project,graph,model.clips,model.tracks);
const projectFile=path.join(output,'project.vns.json');await fs.writeFile(projectFile,JSON.stringify(project));
const server=await createServer({root,server:{host:'127.0.0.1',port:0,watch:{ignored:['**/artifacts/**','**/resources/**','**/release/**']}}});await server.listen();
const app=await launchDesktopFixture({root,projectFile,profile:path.join(output,'profile'),devUrl:'http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port}),page=await app.firstWindow();
try {
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});
 await page.evaluate(()=>{const Real=window.Audio;(window as any).audioProbe=[];window.Audio=function(url?:string){const audio=new Real(url);audio.addEventListener('loadedmetadata',()=>{const delay=(window as any).audioDelay??0;if(delay){const callback=audio.onloadedmetadata;audio.onloadedmetadata=null;setTimeout(()=>callback?.call(audio,new Event('loadedmetadata')),delay);}});(window as any).audioProbe.push({audio,url,plays:0});const play=audio.play.bind(audio);audio.play=()=>{(window as any).audioProbe.find((r:any)=>r.audio===audio).plays++;return play();};return audio;} as any;});
 await page.locator('[data-workspace-tab="blueprint"]').click();await page.getByLabel('轨道缩放',{exact:true}).selectOption('60');
 const seek=async(time:number)=>{await page.getByLabel('时间标尺',{exact:true}).click({position:{x:130+time*60,y:10}});await expect.poll(async()=>parseFloat(await page.locator('.timeline-time').innerText())).toBeCloseTo(time,1);};
 const sample=()=>page.evaluate(()=>(window as any).audioProbe.map((r:any)=>({url:r.url,time:r.audio.currentTime,paused:r.audio.paused,volume:r.audio.volume,plays:r.plays,duration:r.audio.duration,src:r.audio.getAttribute('src')})));
 await seek(5.2);await page.getByRole('button',{name:'播放预览',exact:true}).click();
 await expect.poll(async()=>(await sample()).filter((r:any)=>r.url.includes('music')).at(-1)?.plays).toBe(1);
 const midFade=(await sample()).filter((r:any)=>r.url.includes('music')).at(-1);assert.ok(midFade.volume>.35&&midFade.volume<.46,JSON.stringify(midFade));
 await page.getByRole('button',{name:'停止预览',exact:true}).click();
 await seek(4.8);await page.getByRole('button',{name:'播放预览',exact:true}).click();
 await expect.poll(async()=>parseFloat(await page.locator('.timeline-time').innerText())).toBeGreaterThan(5.2);
 const continuous=(await sample()).filter((r:any)=>r.url.includes('music')).at(-1);assert.ok(continuous.volume>0&&continuous.volume<.46,JSON.stringify(continuous));
 await page.getByRole('button',{name:'停止预览',exact:true}).click();
 await seek(6.8);await page.getByRole('button',{name:'播放预览',exact:true}).click();
 await expect.poll(async()=>parseFloat(await page.locator('.timeline-time').innerText())).toBeGreaterThan(8.2);
 const stopped=(await sample()).filter((r:any)=>r.url.includes('music')).at(-1);assert.equal(stopped.paused,true);assert.equal(stopped.volume,0);
 await page.getByRole('button',{name:'停止预览',exact:true}).click();
 const before=(await sample()).length;await seek(8.5);await page.getByRole('button',{name:'播放预览',exact:true}).click();
 await expect.poll(async()=>parseFloat(await page.locator('.timeline-time').innerText())).toBeGreaterThan(8.6);
 const added=(await sample()).slice(before);assert.ok(!added.some((r:any)=>r.url.includes('music')));assert.ok(added.every((r:any)=>r.plays===0));
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',checks:['重复停止从已有淡出音量继续','连续播放经过第二次停止无音量回升','停止后再遇停止保持静音','从后面的停止片段中间定位不会复活音乐'],midFade,continuous,stopped,added}));console.log(output);
} catch(error){await page.screenshot({path:path.join(output,'failure.png')});throw error;}
finally {await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();await server.close();}
