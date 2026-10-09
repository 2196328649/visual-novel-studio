import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { projectSchema } from '../src/core/model';
import { synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { createUiVoicePreviewFixture, writeUiVoicePreviewAudio } from './lib/ui-voice-preview-fixture';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openUiPreviewWindow, showUiPreviewTestData } from './lib/ui-preview-window';
const root=path.resolve('.'),output=process.env.VNS_VOICE_PREVIEW_OUTPUT??path.join(root,'artifacts/ui-voice-preview',new Date().toISOString().replaceAll(':','-'));
const {project}=createUiVoicePreviewFixture();synchronizeBlueprintSignatures(project);await writeUiVoicePreviewAudio(output);
const projectFile=path.join(output,'project.vns.json');await fs.writeFile(projectFile,JSON.stringify(projectSchema.parse(project)));const before=await fs.readFile(projectFile,'utf8');
const app=await launchDesktopFixture({root,projectFile,profile:path.join(output,'profile')}),editor=await app.firstWindow();let page=editor,errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));app.on('window',w=>w.on('pageerror',error=>errors.push(error.message)));
try{
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});await page.locator('[data-workspace-tab="ui"]').click();await page.getByLabel('界面编辑模式').getByRole('button',{name:'事件图',exact:true}).click();await page.getByLabel('事件图页面').selectOption('ui:main');page = await openUiPreviewWindow(app, editor); await showUiPreviewTestData(page);
 await page.getByLabel('按时间预演',{exact:true}).check();
 let frame=page.getByLabel('参数联动预演画面',{exact:true}),audio=page.getByLabel('语音预演播放器',{exact:true}),rows=frame.locator('[data-voice-entry]');
 const control=(id:string)=>frame.locator('[data-voice-control="'+id+'"]');const playing=async(id:string)=>{await expect.poll(()=>audio.evaluate(e=>{const a=e as HTMLAudioElement;return {playing:!a.paused&&a.currentTime>0.01,src:a.currentSrc};})).toEqual({playing:true,src:expect.stringContaining(id+'.wav')});};
 await frame.getByRole('button',{name:'打开语音收藏',exact:true}).click();await expect(frame).toContainText('尚未收藏语音');await page.getByText('语音测试数据',{exact:true}).click();await page.getByRole('button',{name:'收藏全部语音',exact:true}).click();await expect(rows).toHaveCount(12);
 const caption=rows.first().locator('[data-voice-caption]');expect(await caption.evaluate(e=>e.scrollWidth>e.clientWidth)).toBe(true);await expect(caption).toContainText('[name] {b}');
 await control('page:1').click();await expect(rows).toHaveCount(1);await control('favorite:voice_12').click();await expect(rows).toHaveCount(12);await expect(control('page:1')).toHaveCount(0);await expect(page.getByLabel('语音测试收藏数量',{exact:true})).toHaveText('12 / 13');
 await control('play:voice_0').click();await playing('voice_0');expect(await audio.evaluate(e=>(e as HTMLAudioElement).volume)).toBeCloseTo(.24,4);
 await control('play:voice_1').click();await playing('voice_1');await control('favorite:voice_0').click();await playing('voice_1');await control('favorite:voice_1').click();await expect(audio).not.toHaveAttribute('src');
 await page.getByRole('button',{name:'收藏全部语音',exact:true}).click();await control('play:voice_0').click();await playing('voice_0');
 await frame.getByRole('button',{name:'试听中确认',exact:true}).click();await playing('voice_0');await expect(control('play:voice_0')).toHaveAttribute('aria-pressed','true');await page.keyboard.press('Escape');await playing('voice_0');
 await frame.screenshot({path:path.join(output,'playing-frame.png')});await frame.getByRole('button',{name:'返回标题',exact:true}).click();await expect(audio).not.toHaveAttribute('src');
 await frame.getByRole('button',{name:'打开语音收藏',exact:true}).click();await expect(rows).toHaveCount(12);await control('play:voice_0').click();await playing('voice_0');
 await audio.evaluate(e=>{const a=e as HTMLAudioElement;a.currentTime=a.duration-.04;});await expect(audio).not.toHaveAttribute('src',{timeout:3000});await expect(control('play:voice_0')).toHaveAttribute('aria-pressed','false');
 await page.getByText('语音测试数据',{exact:true}).click();await page.getByLabel('全部语音已解锁',{exact:true}).uncheck();await expect(control('play:voice_0')).toBeDisabled();await expect(control('favorite:voice_0')).toBeEnabled();
 await page.getByRole('button',{name:'浏览添加已解锁语音',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'预览资源 测试语音 2',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'使用所选资源',exact:true}).click();
 await expect(control('play:voice_1')).toBeEnabled();await expect(control('play:voice_0')).toBeDisabled();await control('favorite:voice_0').click();await expect(rows).toHaveCount(12);
 await control('filter').click();await expect(rows).toHaveCount(12);await expect(control('favorite:voice_0')).toBeDisabled();await frame.screenshot({path:path.join(output,'partial-unlocks-frame.png')});
 await page.getByRole('button',{name:'恢复测试值',exact:true}).click();await frame.getByRole('button',{name:'打开语音收藏',exact:true}).click();await expect(frame).toContainText('尚未收藏语音');
 await page.getByText('语音测试数据',{exact:true}).click();await page.getByRole('button',{name:'收藏全部语音',exact:true}).click();await control('play:voice_1').click();await playing('voice_1');await page.getByRole('button',{name:'关闭预览',exact:true}).click();await expect.poll(()=>app.windows().length).toBe(1);
 page=await openUiPreviewWindow(app,editor);frame=page.getByLabel('参数联动预演画面',{exact:true});audio=page.getByLabel('语音预演播放器',{exact:true});rows=frame.locator('[data-voice-entry]');await frame.getByRole('button',{name:'打开语音收藏',exact:true}).click();await expect(audio).not.toHaveAttribute('src');await showUiPreviewTestData(page);await page.getByText('语音测试数据',{exact:true}).click();await page.getByRole('button',{name:'收藏全部语音',exact:true}).click();
 const source=path.join(output,'assets/voice_11.wav'),missing=source+'.missing-test';await fs.rename(source,missing);
 try{await control('play:voice_11').click();await expect(page.getByText('语音试听失败，请检查素材文件和音频格式。',{exact:true})).toBeVisible();await expect(audio).not.toHaveAttribute('src');}finally{await fs.rename(missing,source);}
 await control('play:voice_11').click();await playing('voice_11');await expect(page.getByText('语音试听失败，请检查素材文件和音频格式。',{exact:true})).toHaveCount(0);
 await expect(editor.locator('.dirty-dot')).toHaveCount(0);expect(await fs.readFile(projectFile,'utf8')).toBe(before);expect(errors).toEqual([]);
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',compiledBuild:true,checks:['收藏测试数据、两列六行分页、末页删除自动回退','长对白按字面显示并省略','真实音频播放、切换、角色/语音/主音量乘积、自然结束','删除其他收藏保持播放、删除当前收藏停止','确认框覆盖时继续，离页和关闭窗口停止，重开不自动重播','部分解锁、不可播放的收藏仍能移除、筛选','素材缺失提示，恢复素材后再次播放','恢复测试值、UI草稿及磁盘不变'],errors},null,2));console.log(output);
}catch(error){await page.screenshot({path:path.join(output,'failure.png')});throw error;}
finally{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();}
