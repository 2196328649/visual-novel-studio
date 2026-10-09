import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { projectSchema } from '../src/core/model';
import { synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { createUiMusicPreviewFixture, writeUiMusicPreviewAudio } from './lib/ui-music-preview-fixture';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openUiPreviewWindow, showUiPreviewTestData } from './lib/ui-preview-window';

const root=path.resolve('.'),output=path.join(root,'artifacts/ui-music-preview',new Date().toISOString().replaceAll(':','-'));
for(const native of [false,true]){
 const directory=path.join(output,native?'native':'custom'),project=createUiMusicPreviewFixture(native);synchronizeBlueprintSignatures(project);await writeUiMusicPreviewAudio(directory);
 const projectFile=path.join(directory,'project.vns.json');await fs.writeFile(projectFile,JSON.stringify(projectSchema.parse(project)));const before=await fs.readFile(projectFile,'utf8');
 const app=await launchDesktopFixture({root,projectFile,profile:path.join(directory,'profile')}),editor=await app.firstWindow(),errors:string[]=[];let page=editor;page.on('pageerror',e=>errors.push(e.message));app.on('window',w=>w.on('pageerror',e=>errors.push(e.message)));
 try{
  await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});await page.locator('[data-workspace-tab="ui"]').click();await page.getByLabel('界面编辑模式').getByRole('button',{name:'事件图',exact:true}).click();await page.getByLabel('事件图页面').selectOption('ui:main');page=await openUiPreviewWindow(app,editor);await showUiPreviewTestData(page);await page.getByLabel('按时间预演',{exact:true}).check();
  let frame=page.getByLabel('参数联动预演画面',{exact:true}),audio=page.getByLabel('音乐预演播放器',{exact:true});
  const button=(name:string)=>frame.getByRole('button',{name,exact:true});
  const track=(id:number)=>frame.locator('[data-music-control="track:track_'+id+'"]');
  const playing=async(id:number)=>{await expect.poll(()=>audio.evaluate(e=>{const a=e as HTMLAudioElement;return {playing:!a.paused&&a.currentTime>.01,src:a.currentSrc};})).toEqual({playing:true,src:expect.stringContaining('voice_'+id+'.wav')});};
  await button('打开音乐鉴赏').click();await expect(page.getByText('部分节点尚未预演；舞台演出需开启“按时间预演”，其他未支持行为请使用试玩检查。',{exact:true})).toHaveCount(0);
  await expect(button('播放 / 暂停')).toHaveAttribute('aria-disabled','true');
  if(native){
   const viewport=frame.getByLabel('标准音乐滚动区域');expect(await viewport.evaluate(e=>e.scrollHeight>e.clientHeight)).toBe(true);
   await track(12).click();await playing(12);await button('播放 / 暂停').click();await expect.poll(()=>audio.evaluate(e=>(e as HTMLAudioElement).paused)).toBe(true);
   await button('下一首').click();await playing(0);await button('停止').click();await expect(audio).not.toHaveAttribute('src');
   await frame.screenshot({path:path.join(directory,'standard-music.png')});await button('返回').click();await expect(page.getByLabel('当前预演页面')).toHaveText('标题');
  }else{
   await expect(frame.locator('[data-music-control^="track:"]')).toHaveCount(4);await expect(track(12)).toContainText('[name] {b}');await frame.getByRole('button',{name:'音乐第 4 页',exact:true}).click();await expect(frame.locator('[data-music-control^="track:"]')).toHaveCount(1);await track(0).click();await playing(0);
   expect(await audio.evaluate(e=>(e as HTMLAudioElement).volume)).toBeCloseTo(.4,4);await button('音乐音量 25%').click();expect(await audio.evaluate(e=>(e as HTMLAudioElement).volume)).toBeCloseTo(.2,4);
   await button('静音').click();expect(await audio.evaluate(e=>(e as HTMLAudioElement).volume)).toBe(0);await button('静音').click();
   await button('播放 / 暂停').click();await expect.poll(()=>audio.evaluate(e=>(e as HTMLAudioElement).paused)).toBe(true);const held=await audio.evaluate(e=>(e as HTMLAudioElement).currentTime);await track(0).click();await playing(0);expect(await audio.evaluate(e=>(e as HTMLAudioElement).currentTime)).toBeGreaterThanOrEqual(held);
   await button('上一首').click();await playing(12);await button('下一首').click();await playing(0);
   await frame.getByRole('button',{name:'音乐第 1 页',exact:true}).click();await track(12).click();await playing(12);await button('循环').click();await audio.evaluate(e=>{const a=e as HTMLAudioElement;a.currentTime=a.duration-.05;});await expect(audio).not.toHaveAttribute('src');
   await track(12).click();await playing(12);await button('循环').click();await audio.evaluate(e=>{const a=e as HTMLAudioElement;a.currentTime=a.duration-.05;});await playing(0);
   await button('随机').click();await button('下一首').click();await expect.poll(()=>audio.evaluate(e=>(e as HTMLAudioElement).currentSrc)).not.toContain('voice_0.wav');await button('随机').click();
   await track(12).click();await playing(12);await button('试听中确认').click();await playing(12);await button('放弃').click();await playing(12);await frame.screenshot({path:path.join(directory,'playing-music.png')});
   await button('返回标题').click();await expect(audio).not.toHaveAttribute('src');await button('打开音乐鉴赏').click();await expect(frame.getByRole('button',{name:'音乐第 1 页',exact:true})).toHaveAttribute('aria-current','page');
   await page.getByText('音乐测试数据',{exact:true}).click();await page.getByLabel('全部音乐已解锁',{exact:true}).uncheck();await expect(track(12)).toBeDisabled();await expect(button('下一首')).toHaveAttribute('aria-disabled','true');
   await page.getByRole('button',{name:'浏览添加已解锁音乐',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'预览资源 测试音乐 12',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'使用所选资源',exact:true}).click();await expect(track(11)).toBeEnabled();await expect(track(12)).toBeDisabled();await track(11).click();await playing(11);
   await page.getByRole('button',{name:'关闭预览',exact:true}).click();await expect.poll(()=>app.windows().length).toBe(1);page=await openUiPreviewWindow(app,editor);frame=page.getByLabel('参数联动预演画面',{exact:true});audio=page.getByLabel('音乐预演播放器',{exact:true});await button('打开音乐鉴赏').click();await showUiPreviewTestData(page);await expect(audio).not.toHaveAttribute('src');
   const source=path.join(directory,'assets/voice_11.wav'),missing=source+'.missing';await fs.rename(source,missing);
   try{await track(11).click();await expect(page.getByText('音乐试听失败，请检查素材文件和音频格式。',{exact:true})).toBeVisible();await expect(audio).not.toHaveAttribute('src');}finally{await fs.rename(missing,source);}
   await track(11).click();await playing(11);await expect(page.getByText('音乐试听失败，请检查素材文件和音频格式。',{exact:true})).toHaveCount(0);
   await page.getByRole('button',{name:'恢复测试值',exact:true}).click();await expect(audio).not.toHaveAttribute('src');
  }
  await expect(editor.locator('.dirty-dot')).toHaveCount(0);expect(await fs.readFile(projectFile,'utf8')).toBe(before);expect(errors).toEqual([]);
  await fs.writeFile(path.join(directory,'report.json'),JSON.stringify({status:'passed',compiledBuild:true,native,checks:native?['标准滚动曲目列表','选曲暂停及切歌、停止','返回标题','预演未写入工程']:['作者曲目顺序、四页、字面标题','真实播放、主音量和音乐音量、静音','暂停续播、上一首下一首','自然结束、列表循环、随机切换','确认覆盖不中断、退出停止、重开回首页','部分解锁禁用、独立窗口关闭停止','缺失素材提示及修复重试','恢复测试值，工程及草稿不变'],errors},null,2));
 }catch(error){await page.screenshot({path:path.join(directory,'failure.png')});throw error;}
 finally{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();}
}
console.log(output);
