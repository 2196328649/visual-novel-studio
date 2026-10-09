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
const root=path.resolve('.'), output=path.join(root,'artifacts/cross-line-audio',new Date().toISOString().replaceAll(':','-'));
await fs.mkdir(output,{recursive:true});
const format=process.env.VNS_AUDIO_FORMAT??'wav';if(!['wav','ogg','mp3'].includes(format))throw Error('Unsupported fixture audio format');
const project=createProject('时间轴声音定位验收');
for(const [id,seconds] of [['music',2.7],['effect',.5]] as const){const rate=8000,size=rate*seconds*2,b=Buffer.alloc(44+size);b.write('RIFF');b.writeUInt32LE(36+size,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(size,40);for(let i=0;i<size/2;i++)b.writeInt16LE(Math.round(2400*Math.sin(2*Math.PI*(id==='music'?220:660)*i/rate)),44+i*2);await fs.writeFile(path.join(output,id+'.wav'),b);if(format!=='wav')execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',path.join(output,id+'.wav'),...(format==='ogg'?['-c:a','libvorbis']:['-c:a','libmp3lame']),path.join(output,id+'.'+format)]);project.assets.push({id,name:id,kind:'audio',path:id+'.'+format});}
const passage=project.nodes.find(n=>n.kind==='passage')!;
passage.lines=[
{id:'one',text:'开始音乐',actions:[{kind:'music',assetId:'music',loop:true,fade:4},{kind:'sound',assetId:'effect'},{kind:'pause',seconds:1}]},
{id:'two',text:'继承音乐',actions:[{kind:'stopMusic',fade:2},{kind:'pause',seconds:.5}]},
{id:'three',text:'继续淡出',actions:[{kind:'pause',seconds:2}]},
{id:'four',text:'音乐结束',actions:[{kind:'pause',seconds:1}]},
];
const projectFile=path.join(output,'project.vns.json');await fs.writeFile(projectFile,JSON.stringify(project));
const server=await createServer({root,server:{host:'127.0.0.1',port:0,watch:{ignored:['**/artifacts/**','**/resources/**','**/release/**']}}});await server.listen();
const app=await launchDesktopFixture({root,projectFile,profile:path.join(output,'profile'),devUrl:'http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port}),page=await app.firstWindow();
try {
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});
 await page.evaluate(()=>{const Real=window.Audio;(window as any).audioProbe=[];window.Audio=function(url?:string){const audio=new Real(url);audio.addEventListener('loadedmetadata',()=>{const delay=(window as any).audioDelay??0;if(delay){const callback=audio.onloadedmetadata;audio.onloadedmetadata=null;setTimeout(()=>callback?.call(audio,new Event('loadedmetadata')),delay);}});(window as any).audioProbe.push({audio,url,plays:0});const play=audio.play.bind(audio);audio.play=()=>{(window as any).audioProbe.find((r:any)=>r.audio===audio).plays++;return play();};return audio;} as any;});
 await page.getByRole('button',{name:'文本编辑',exact:true}).click();
 const input=page.getByLabel('中文文本剧本',{exact:true});
 const select=async(needle:string,id:string)=>{
  await input.evaluate((element,needle)=>{const text=element as HTMLTextAreaElement;const at=text.value.indexOf(needle);if(at<0)throw Error(needle);text.focus();text.setSelectionRange(at,at);},needle);
  await input.press('ArrowRight');await input.press('ArrowLeft');
  await expect(page.locator('.story-preview-content')).toHaveAttribute('data-preview-key',passage.id+'/'+id);
 };
 const sample=()=>page.evaluate(()=>(window as any).audioProbe.map((r:any)=>({url:r.url,time:r.audio.currentTime,paused:r.audio.paused,volume:r.audio.volume,plays:r.plays})));
 await select('继续淡出','three');await page.getByRole('button',{name:'播放预览',exact:true}).click();
 await expect.poll(async()=>(await sample()).find((r:any)=>r.url.includes('music'))?.plays).toBe(1);
 const fading=await sample(),music=fading.find((r:any)=>r.url.includes('music'));assert.ok(music.time>=1.5&&music.time<1.9,JSON.stringify(music));assert.ok(music.volume>0&&music.volume<.19,JSON.stringify(music));assert.equal(fading.find((r:any)=>r.url.includes('effect')).plays,0);
 await page.getByRole('button',{name:'停止预览',exact:true}).click();
 const before=(await sample()).length;await select('音乐结束','four');await page.getByRole('button',{name:'播放预览',exact:true}).click();
 await expect(page.locator('.story-preview-content')).toHaveAttribute('data-preview-phase','actions');
 const ended=(await sample()).slice(before);assert.ok(!ended.some((r:any)=>r.url.includes('music')));assert.ok(ended.every((r:any)=>r.plays===0));
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',checks:['跨台词保留音乐位置与未完成淡出','前句已结束音效不重播','音乐停止后后续台词不重新播放'],fading,ended}));console.log(output);
} catch(error){await page.screenshot({path:path.join(output,'failure.png')});throw error;}
finally {await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();await server.close();}
