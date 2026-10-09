import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { projectSchema } from '../src/core/model';
import { synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { createUiHistoryFixture, writeUiHistoryAudio } from './lib/ui-history-preview-fixture';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openUiPreviewWindow, showUiPreviewTestData } from './lib/ui-preview-window';
import { voiceVisitKey } from '../src/core/story-menu';

const root=path.resolve('.'),output=path.join(root,'artifacts/ui-history-preview',new Date().toISOString().replaceAll(':','-'));
for(const native of [false,true]){
 const directory=path.join(output,native?'native':'custom'),project=createUiHistoryFixture(native);synchronizeBlueprintSignatures(project);await writeUiHistoryAudio(directory);
 const projectFile=path.join(directory,'project.vns.json');await fs.writeFile(projectFile,JSON.stringify(projectSchema.parse(project)));const before=await fs.readFile(projectFile,'utf8');
 const app=await launchDesktopFixture({root,projectFile,profile:path.join(directory,'profile')}),editor=await app.firstWindow(),errors:string[]=[];let page=editor;page.on('pageerror',e=>errors.push(e.message));
 try{
  await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});await page.locator('[data-workspace-tab="ui"]').click();await page.getByLabel('界面编辑模式').getByRole('button',{name:'事件图',exact:true}).click();await page.getByLabel('事件图页面').selectOption('ui:main');page=await openUiPreviewWindow(app,editor);page.on('pageerror',e=>errors.push(e.message));await showUiPreviewTestData(page);
  const key=(lineId:string)=>voiceVisitKey(project.nodes.find(n=>n.kind==='passage')!.id,lineId);
  const frame=page.getByLabel('参数联动预演画面',{exact:true}),audio=page.getByLabel('语音预演播放器',{exact:true});
  const button=(name:string)=>frame.getByRole('button',{name,exact:true}),control=(line:string,action:'play'|'favorite')=>frame.locator('[data-history-control="'+line+':'+action+'"]'),viewport=frame.locator('[data-history-viewport]');
  const playing=async(id:number)=>{await expect.poll(()=>audio.evaluate(e=>{const a=e as HTMLAudioElement;return {playing:!a.paused&&a.currentTime>.01,src:a.currentSrc};})).toEqual({playing:true,src:expect.stringContaining('voice_'+id+'.wav')});};
  await button('打开对话历史').click();await expect(viewport.locator('[data-line-id]')).toHaveCount(15);await expect(frame.locator('[data-line-id="silent_line"]')).toHaveCount(0);await expect(frame.locator('[data-line-id="unvoiced"] button')).toHaveCount(0);
  await expect.poll(()=>viewport.evaluate(e=>e.scrollTop>0&&Math.abs(e.scrollHeight-e.clientHeight-e.scrollTop)<3)).toBe(true);
  await control('duplicate_voice','favorite').click();await expect(control('voice_line_0','favorite')).toHaveAttribute('aria-pressed','false');await expect(control('duplicate_voice','favorite')).toHaveAttribute('aria-pressed','true');
  await control('voice_line_0','play').click();await playing(0);expect(await audio.evaluate(e=>(e as HTMLAudioElement).volume)).toBeCloseTo(.24,4);
  await expect(control('duplicate_voice','play')).toHaveAttribute('aria-pressed','false');const held=await viewport.evaluate(e=>e.scrollTop);await control('voice_line_0','favorite').click();await playing(0);expect(await viewport.evaluate(e=>e.scrollTop)).toBeCloseTo(held,0);
  await expect(frame.locator('[data-line-id="voice_line_0"] [data-history-text]')).toContainText('[name] {b}');
  if(!native){await button('历史内确认').click();await playing(0);await button('放弃').click();await playing(0);}
  await control('voice_line_1','play').click();await playing(1);await control('voice_line_1','favorite').click();
  await button('打开语音收藏').click();await expect(audio).not.toHaveAttribute('src');await expect(frame.locator('[data-voice-entry]')).toHaveCount(3);
  await expect(frame.locator('[data-voice-entry="'+key('duplicate_voice')+'"]')).toContainText('同一语音的另一条记录');
  await page.screenshot({path:path.join(directory,'dialogue-favorites-window.png')});
  await frame.locator('[data-voice-control="play:'+key('voice_line_0')+'"]').click();await playing(0);await expect(frame.locator('[data-voice-control="play:'+key('duplicate_voice')+'"]').first()).toHaveAttribute('aria-pressed','false');await button('返回历史').click();await expect(audio).not.toHaveAttribute('src');await expect(control('voice_line_0','favorite')).toHaveAttribute('aria-pressed','true');
  await control('voice_line_0','play').click();await playing(0);await page.getByText('历史测试记录',{exact:true}).click();await page.getByLabel('历史测试记录来源',{exact:true}).selectOption('empty');await expect(viewport).toContainText('暂无对话记录');await expect(audio).not.toHaveAttribute('src');
  await page.getByLabel('历史测试记录来源',{exact:true}).selectOption('node:'+project.nodes.find(n=>n.kind==='passage')!.id);await expect(viewport.locator('[data-line-id]')).toHaveCount(15);
  await page.getByText('语音测试数据',{exact:true}).click();await page.getByLabel('全部语音已解锁',{exact:true}).uncheck();await expect(control('voice_line_0','play')).toBeDisabled();await expect(control('voice_line_0','favorite')).toBeDisabled();
  await page.getByLabel('全部语音已解锁',{exact:true}).check();await control('voice_line_1','play').click();await playing(1);await audio.evaluate(e=>{const a=e as HTMLAudioElement;a.currentTime=a.duration-.05;});await expect(audio).not.toHaveAttribute('src');await expect(control('voice_line_1','play')).toHaveAttribute('aria-pressed','false');
  await control('voice_line_1','play').click();await playing(1);await page.getByRole('button',{name:'恢复测试值',exact:true}).click();await expect(audio).not.toHaveAttribute('src');await button('打开对话历史').click();
  await control('voice_line_1','favorite').click();await viewport.screenshot({path:path.join(directory,'history-controls.png')});await button(native?'返回':'返回标题').click();await expect(page.getByLabel('当前预演页面')).toHaveText('标题');
  await page.getByRole('button',{name:'恢复测试值',exact:true}).click();await button('打开对话历史').click();await button('打开语音收藏').click();await expect(frame).toContainText('尚未收藏语音');
  await expect(editor.locator('.dirty-dot')).toHaveCount(0);expect(await fs.readFile(projectFile,'utf8')).toBe(before);expect(errors).toEqual([]);await page.close();expect(page.isClosed()).toBe(true);
  await fs.writeFile(path.join(directory,'report.json'),JSON.stringify({status:'passed',compiledBuild:true,native,independentWindow:true,checks:['历史初始滚到末尾、无语音/静默行、长对白按字面显示','重播真实WAV及主/语音/角色音量','重复音频的不同对白独立收藏和选中、保留滚动与播放','三条收藏保留各自台词，切页停声与收藏保留','空历史/选择段落/解锁测试数据','自然结束、独立窗口关闭、返回和恢复测试值','工程草稿与磁盘不变'],errors},null,2));
 }catch(error){await page.screenshot({path:path.join(directory,'failure.png')});throw error;}
 finally{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();}
}
console.log(output);
