import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { PNG } from 'pngjs';
import { uiStageFixture, writeUiStageAssets } from './lib/ui-stage-fixture';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openUiPreviewWindow, showUiPreviewTestData } from './lib/ui-preview-window';

const root=path.resolve('.'),output=path.join(root,'artifacts/ui-stage-preview',new Date().toISOString().replaceAll(':','-'));
await writeUiStageAssets(output);const {project,image}=uiStageFixture(),original=JSON.stringify(project),projectFile=path.join(output,'project.vns.json');await fs.writeFile(projectFile,original);
const app=await launchDesktopFixture({root,projectFile,profile:path.join(output,'profile')}),editor=await app.firstWindow();let page=editor;page.setDefaultTimeout(10000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
const button=(name:string)=>page.getByRole('button',{name,exact:true});let frame=page.locator('.ui-logic-preview-frame'),label=frame.locator('[data-preview-component="label"]'),visual=frame.locator('[data-visual-instance="'+image.instanceId+'"]'),audio=page.locator('audio[data-stage-audio]');
const advance=async(tenths:number)=>{for(let i=0;i<tenths;i++)await button('推进 0.1 秒').click();};
try{
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});await page.locator('[data-workspace-tab="ui"]').click();await page.getByLabel('界面编辑模式').getByRole('button',{name:'事件图',exact:true}).click();page = await openUiPreviewWindow(app, editor); await showUiPreviewTestData(page); frame=page.locator('.ui-logic-preview-frame'); label=frame.locator('[data-preview-component="label"]'); visual=frame.locator('[data-visual-instance="'+image.instanceId+'"]'); audio=page.locator('audio[data-stage-audio]');
 if(await editor.getByRole('button',{name:'保存界面',exact:true}).isEnabled()){await editor.getByRole('button',{name:'保存界面',exact:true}).click();await expect(editor.locator('.workspace-toolbar').getByText('已保存',{exact:true})).toBeVisible();}
 const diskBefore=await fs.readFile(projectFile,'utf8');
 await page.getByLabel('按时间预演',{exact:true}).check();await frame.getByRole('button',{name:'播放演出',exact:true}).click();await advance(1);await expect(visual).toHaveCount(0);await expect(label).toHaveText('尚未播放');
 await advance(6);await expect(visual).toBeVisible();await expect(label).toHaveText('尚未播放');await expect(audio).toHaveCount(1);await expect.poll(()=>audio.evaluate((a:HTMLAudioElement)=>a.readyState)).toBeGreaterThan(0);assert.equal(await audio.evaluate((a:HTMLAudioElement)=>a.paused),true);
 assert.equal(await visual.locator('g image').evaluate(async e=>{const image=new Image();image.src=e.getAttribute('href')!;await image.decode();return image.naturalWidth;}),320);
 const screenshot=PNG.sync.read(await frame.screenshot({path:path.join(output,'during-stage.png')}));let green=0;for(let i=0;i<screenshot.data.length;i+=4)if(screenshot.data[i]<60&&screenshot.data[i+1]>140&&screenshot.data[i+2]>100)green++;assert.ok(green>1000,'舞台图片必须实际绘制到预演画面');
 await button('推进 1 秒').click();await advance(1);await expect(visual).toHaveCount(0);await expect(label).toHaveText('演出完成');await expect(audio).toHaveCount(0);await advance(2);const opacity=await label.evaluate(e=>Number(getComputedStyle(e).opacity));assert.ok(Math.abs(opacity-.65)<.001);await advance(3);await expect(label).toHaveText('全部完成');await expect(label).toHaveCSS('opacity','0.3');
 await button('恢复测试值').click();await frame.getByRole('button',{name:'播放演出',exact:true}).click();await advance(5);await expect(audio).toHaveCount(1);await expect.poll(()=>audio.evaluate((a:HTMLAudioElement)=>a.readyState)).toBeGreaterThan(0);
 await audio.evaluate((a:HTMLAudioElement)=>{(window as any).qaAudio=a;(window as any).qaAudioPlays=0;a.addEventListener('play',()=>{(window as any).qaAudioPlays++;});});
 await button('播放计时').click();await expect.poll(()=>audio.evaluate((a:HTMLAudioElement)=>!a.paused)).toBe(true);await expect.poll(()=>audio.evaluate((a:HTMLAudioElement)=>a.currentTime)).toBeGreaterThan(.85);
 await button('暂停计时').click();await expect.poll(()=>audio.evaluate((a:HTMLAudioElement)=>a.paused)).toBe(true);const held=await audio.evaluate((a:HTMLAudioElement)=>a.currentTime),clock=await page.getByLabel('预演时间',{exact:true}).textContent();await page.waitForTimeout(300);assert.equal(await page.getByLabel('预演时间',{exact:true}).textContent(),clock);assert.equal(await audio.evaluate((a:HTMLAudioElement)=>a.currentTime),held);assert.equal(await page.evaluate(()=>(window as any).qaAudioPlays),1);
 assert.equal(await audio.evaluate(a=>a===(window as any).qaAudio),true);await button('播放计时').click();await expect.poll(()=>page.evaluate(()=>(window as any).qaAudioPlays)).toBe(2);await expect(audio).toHaveCount(0);await expect(label).toHaveText('全部完成');assert.equal(await page.evaluate(()=>(window as any).qaAudio.paused),true);await button('暂停计时').click();
 await button('恢复测试值').click();await frame.getByRole('button',{name:'播放演出',exact:true}).click();await advance(5);await button('播放计时').click();await expect.poll(()=>audio.evaluate((a:HTMLAudioElement)=>!a.paused)).toBe(true);await audio.evaluate(a=>{(window as any).qaAudio=a;});await button('恢复测试值').click();await expect(audio).toHaveCount(0);assert.equal(await page.evaluate(()=>(window as any).qaAudio.paused),true);await expect(label).toHaveText('尚未播放');
 await frame.getByRole('button',{name:'播放演出',exact:true}).click();await advance(5);await button('播放计时').click();await expect.poll(()=>audio.evaluate((a:HTMLAudioElement)=>!a.paused)).toBe(true);await audio.evaluate(a=>{(window as any).qaAudio=a;});await button('关闭预览').click();await expect.poll(()=>app.windows().length).toBe(1);
 assert.equal(await fs.readFile(projectFile,'utf8'),diskBefore);await expect(editor.getByRole('button',{name:'保存界面',exact:true})).toBeDisabled();assert.deepEqual(errors,[]);
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',renderer:'dist',checks:['真实按钮触发时间轴，等待期间不提前改字','图片按片段起止显示，控件随后动画','手动推进不播放声音','真实音频使用截取偏移，连续计时不反复重建或播放','暂停保持时钟和音频位置，继续与有限结束','恢复与关闭预演停止音频','预演不修改草稿或磁盘']},null,2));
}catch(error){await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>undefined);await fs.writeFile(path.join(output,'failure.txt'),String(error)+'\n'+errors.join('\n'));throw error;}
finally{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();console.log(output);}
