import { createUiParameterBinding } from '../src/core/ui-logic';
import { PNG } from 'pngjs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { createServer } from 'vite';
import { createProject } from '../src/core/model';
import { blueprintNodeDefaults, createBlueprintGraph, connectBlueprintPins, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { launchDesktopFixture } from './lib/desktop-fixture';
const root=path.resolve('.'), output=path.join(root,'artifacts/ui-player-preferences',new Date().toISOString().replaceAll(':','-'));
await fs.mkdir(output,{recursive:true});
const project=createProject('高级UI编辑验收');
project.playerDefaults={musicVolume:.8,textSpeed:35,windowSize:'1280x720'};
project.variables.push({id:'caption',name:'显示',type:'string',initial:'默认',persistent:false});
project.ui.components=[{id:'title_probe',kind:'text',page:'preferences',text:'默认',style:{playerOpacity:true},x:.1,y:.1,width:.5,height:.1},
{id:'volume',kind:'preference',page:'preferences',preference:'musicVolume',text:'预演音乐',x:.1,y:.3,width:.5,height:.1},
{id:'speed',kind:'preference',page:'preferences',preference:'textSpeed',text:'预演速度',x:.1,y:.5,width:.5,height:.1},
{id:'window',kind:'preferenceChoice',page:'preferences',preference:'windowSize',text:'预演窗口',x:.1,y:.7,width:.5,height:.1}];
project.ui.components.push({id:'opacity',kind:'preference',page:'preferences',preference:'dialogueOpacity',text:'预演透明度',x:.1,y:.85,width:.5,height:.1});
const graph=createUiParameterBinding(project,'title_probe','text','caption','ui:preferences');
const reader=graph.nodes.find(n=>n.type==='getVariable')!;reader.type='getPlayerPreference';reader.properties={preference:'musicVolume'};
const format=blueprintNodeDefaults('formatText');format.properties.format='音量 {value}';graph.nodes.push(format);const links=graph.links.filter(l=>l.fromNodeId===reader.id);graph.links=graph.links.filter(l=>l.fromNodeId!==reader.id);synchronizeBlueprintSignatures(project);connectBlueprintPins(graph,reader.id,'value',format.id,'value');for(const link of links)connectBlueprintPins(graph,format.id,'text',link.toNodeId,link.toPinId);
const key=blueprintNodeDefaults('eventKey');key.properties={pageId:'ui:preferences',key:'K_e'};const setter=blueprintNodeDefaults('setPlayerPreference');setter.properties={preference:'musicVolume',value:.4};graph.nodes.push(key,setter);synchronizeBlueprintSignatures(project);connectBlueprintPins(graph,key.id,'exec',setter.id,'exec_in');
const projectFile=path.join(output,'project.vns.json');await fs.writeFile(projectFile,JSON.stringify(project));
const server=await createServer({root,server:{host:'127.0.0.1',port:0,watch:{ignored:['**/artifacts/**','**/resources/**','**/release/**']}}});await server.listen();
const app=await launchDesktopFixture({root,projectFile,profile:path.join(output,'profile'),devUrl:'http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port}),page=await app.firstWindow();
try {
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});
 await page.locator('[data-workspace-tab="ui"]').click();await page.getByLabel('设计页面', { exact: true }).selectOption({ label: '设置' });await page.getByRole('button',{name:'高级 UI 蓝图',exact:true}).click();
 await expect(page.locator('.dirty-dot')).toHaveCount(0);
 const savedBefore=await fs.readFile(projectFile,'utf8');
 await page.locator('.ui-logic-preview > summary').click();
 const object=page.locator('[data-preview-component="title_probe"]');
 await expect(object).toContainText('音量 0.8');
 const volume=page.getByLabel('预演音乐',{exact:true});await volume.focus();await page.keyboard.press('Home');await expect(object).toContainText('音量 0');await page.keyboard.press('ArrowRight');await expect(object).toContainText('音量 0.01');
 await page.getByRole('button',{name:'触发 E',exact:true}).click();await expect(volume).toHaveValue('0.4');await expect(object).toContainText('音量 0.4');
 const speed=page.getByLabel('预演速度',{exact:true});await speed.focus();await page.keyboard.press('End');await expect(speed).toHaveValue('201');await page.keyboard.press('ArrowLeft');await expect(speed).toHaveValue('200');
 const choice=page.getByLabel('预演窗口',{exact:true});await choice.selectOption({label:'1920 × 1080'});await expect(choice.locator('option:checked')).toHaveText('1920 × 1080');
 const opacity=page.getByLabel('预演透明度',{exact:true});await opacity.focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');await expect(object).toHaveCSS('opacity','0.01');
 await page.getByRole('button',{name:'恢复测试值',exact:true}).click();await expect(volume).toHaveValue('0.8');await expect(speed).toHaveValue('35');await expect(choice.locator('option:checked')).toHaveText('1280 × 720');
 await expect(page.locator('.dirty-dot')).toHaveCount(0);expect(await fs.readFile(projectFile,'utf8')).toBe(savedBefore);
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',checks:['音量滑块联动读取玩家选项蓝图','蓝图设置玩家选项回写预演控件','文字速度瞬间显示端点及回退','窗口选项选择与恢复','对话透明度预演影响绑定外观','预演不写工程默认值'],changesRealPlayerSettings:false}));console.log(output);
} catch(error){await page.screenshot({path:path.join(output,'failure.png')});throw error;}
finally {await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();await server.close();}
