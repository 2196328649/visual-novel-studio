import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { uiNativePreferencesFixture } from './lib/ui-native-preferences-fixture';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openUiPreviewWindow } from './lib/ui-preview-window';
import { writeUiStageAssets } from './lib/ui-stage-fixture';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph } from '../src/core/blueprint';

// Timed preview keeps running when a file dropped into the project folder is imported,
// and stops when an edit changes what the preview shows.
const root=path.resolve('.'),output=path.join(root,'artifacts/ui-timed-preview-edits',new Date().toISOString().replaceAll(':','-')),shots=path.join(output,'shots');await fs.mkdir(shots,{recursive:true});
const project=uiNativePreferencesFixture();await writeUiStageAssets(output);project.assets.push({id:'tone',name:'测试音频',kind:'audio',path:'tone.wav'});
const music=createBlueprintGraph('effect','音量试听'),play=blueprintNodeDefaults('playMusic');play.properties={assetId:'tone',fade:0,loop:true};music.nodes.push(play);assert.equal(connectBlueprintPins(music,music.nodes[0].id,'exec',play.id,'exec_in'),undefined);project.blueprints.push(music);
// The whole check stays on the title page: the preview and the edited component must be on the same page.
project.ui.components.push({id:'play_sample',page:'main',kind:'button',text:'试听音乐',x:.25,y:.5,width:.3,height:.1,events:{onClick:music.id}});
const projectFile=path.join(output,'project.vns.json');await fs.writeFile(projectFile,JSON.stringify(project));
const app=await launchDesktopFixture({root,projectFile,profile:path.join(output,'profile')}),editor=await app.firstWindow();let page=editor;page.setDefaultTimeout(10000);
const errors:string[]=[];editor.on('pageerror',e=>errors.push(e.message));
const button=(name:string)=>page.getByRole('button',{name,exact:true});let preview=page.locator('.ui-logic-preview-frame');
const native=(name:string)=>preview.getByRole('button',{name,exact:true});
const elapsed=async()=>Number.parseFloat(await page.getByLabel('预演时间',{exact:true}).innerText());
const checks:string[]=[];
try{
 await expect(editor.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});await editor.locator('[data-workspace-tab="ui"]').click();
 await editor.getByLabel('界面编辑模式').getByRole('button',{name:'事件图',exact:true}).click();await editor.getByLabel('事件图页面').selectOption('ui:main');
 page=await openUiPreviewWindow(app,editor);page.on('pageerror',e=>errors.push(e.message));preview=page.locator('.ui-logic-preview-frame');
 await page.getByLabel('按时间预演',{exact:true}).check();await native('试听音乐').click();await button('播放计时').click();
 const audio=page.locator('audio[data-stage-audio]');
 await expect.poll(()=>audio.evaluate((el:HTMLAudioElement)=>!el.paused&&el.readyState>0)).toBe(true);await expect.poll(()=>audio.evaluate((el:HTMLAudioElement)=>el.volume)).toBe(.7);

 // A file appearing in the project folder is imported into the project while the timer runs.
 await editor.screenshot({path:path.join(output,'dropped-screenshot.png')});
 await expect(editor.getByText('已发现 1 项新素材',{exact:true})).toBeVisible({timeout:20000});await expect(editor.locator('.dirty-dot')).toHaveCount(1);
 const afterImport=await elapsed();await expect.poll(elapsed,{timeout:5000}).toBeGreaterThan(afterImport+.5);
 await expect(button('暂停计时')).toBeVisible();assert.equal(await audio.evaluate((el:HTMLAudioElement)=>el.paused),false);
 checks.push('目录中新出现的文件被导入工程（工程变为未保存）时，计时预演和演出声音继续');

 // Switching the editor to design mode does not change the preview; resizing a component on the shown page does.
 await editor.getByLabel('界面编辑模式').getByRole('button',{name:'设计',exact:true}).click();await expect(editor.getByLabel('设计页面',{exact:true})).toHaveValue('main');
 const beforeEdit=await elapsed();await expect.poll(elapsed,{timeout:5000}).toBeGreaterThan(beforeEdit+.5);await expect(button('暂停计时')).toBeVisible();
 await editor.locator('[data-hierarchy-id="open"]').click();const width=editor.getByLabel('宽度 %',{exact:true});await width.fill('40');await width.press('Tab');
 await expect(button('播放计时')).toBeVisible();await expect(page.getByLabel('当前预演页面')).toHaveText('标题');
 const stopped=await elapsed();await page.waitForTimeout(600);assert.equal(await elapsed(),stopped);
 checks.push('切换到设计模式不打断计时；改动当前预演页面中组件的尺寸后计时停止，停留在原页面和时间');
 await button('播放计时').click();await expect.poll(elapsed,{timeout:5000}).toBeGreaterThan(stopped+.3);
 checks.push('停止后可继续播放计时');
 await page.screenshot({path:path.join(shots,'after-edit.png')});
 assert.deepEqual(errors,[]);
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',renderer:'dist',projectFile,checks},null,2));
}catch(error){await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>undefined);await fs.writeFile(path.join(output,'failure.txt'),String(error));throw error;}
finally{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();console.log(output);}
