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
const root=path.resolve('.'), output=path.join(root,'artifacts/ui-character-volumes',new Date().toISOString().replaceAll(':','-'));
await fs.mkdir(output,{recursive:true});
const project=createProject('高级UI编辑验收');
project.playerDefaults={characterVolume:.8};project.characters=['hero','npc'].map(id=>({id,name:id,color:'#ffffff',expressions:[]}));
project.variables.push({id:'caption',name:'显示',type:'string',initial:'默认',persistent:false});
project.ui.components=[{id:'title_probe',kind:'text',page:'preferences',text:'默认',style:{playerOpacity:true},x:.1,y:.1,width:.5,height:.1},
{id:'volume',kind:'preference',page:'preferences',preference:'characterVolume',preferenceCharacterId:'hero',text:'预演音乐',x:.1,y:.3,width:.5,height:.1},
{id:'speed',kind:'preference',page:'preferences',preference:'characterVolume',preferenceCharacterId:'npc',text:'预演速度',x:.1,y:.5,width:.5,height:.1},
{id:'window',kind:'preference',page:'preferences',preference:'characterVolume',text:'预演窗口',x:.1,y:.7,width:.5,height:.1}];
project.ui.components.push({id:'opacity',kind:'preference',page:'preferences',preference:'dialogueOpacity',text:'预演透明度',x:.1,y:.85,width:.5,height:.1});
const graph=createUiParameterBinding(project,'title_probe','text','caption','ui:preferences');
const reader=graph.nodes.find(n=>n.type==='getVariable')!;reader.type='getPlayerPreference';reader.properties={preference:'characterVolume',characterId:'hero'};
const format=blueprintNodeDefaults('formatText');format.properties.format='音量 {value}';graph.nodes.push(format);const links=graph.links.filter(l=>l.fromNodeId===reader.id);graph.links=graph.links.filter(l=>l.fromNodeId!==reader.id);synchronizeBlueprintSignatures(project);connectBlueprintPins(graph,reader.id,'value',format.id,'value');for(const link of links)connectBlueprintPins(graph,format.id,'text',link.toNodeId,link.toPinId);
const key=blueprintNodeDefaults('eventKey');key.properties={pageId:'ui:preferences',key:'K_e'};const setter=blueprintNodeDefaults('setPlayerPreference');setter.properties={preference:'characterVolume',characterId:'npc',value:.4};graph.nodes.push(key,setter);synchronizeBlueprintSignatures(project);connectBlueprintPins(graph,key.id,'exec',setter.id,'exec_in');
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
 const hero=page.getByLabel('预演音乐',{exact:true}),npc=page.getByLabel('预演速度',{exact:true}),other=page.getByLabel('预演窗口',{exact:true});
 await hero.focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');await expect(hero).toHaveValue('0.01');await expect(object).toContainText('音量 0.01');await expect(npc).toHaveValue('0.8');await expect(other).toHaveValue('0.8');
 await page.getByRole('button',{name:'触发 E',exact:true}).click();await expect(npc).toHaveValue('0.4');await expect(hero).toHaveValue('0.01');await expect(other).toHaveValue('0.8');
 await other.focus();await page.keyboard.press('Home');await expect(other).toHaveValue('0');await expect(npc).toHaveValue('0.4');await expect(hero).toHaveValue('0.01');
 await page.getByRole('button',{name:'恢复测试值',exact:true}).click();for(const slider of [hero,npc,other])await expect(slider).toHaveValue('0.8');await expect(object).toContainText('音量 0.8');
 await expect(page.locator('.dirty-dot')).toHaveCount(0);expect(await fs.readFile(projectFile,'utf8')).toBe(savedBefore);
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',checks:['角色音量滑块独立','读取角色音量蓝图跟随目标角色','蓝图写入另一角色只更新对应滑块','其他语音与角色隔离','恢复全部角色音量','工程未修改']}));console.log(output);
} catch(error){await page.screenshot({path:path.join(output,'failure.png')});throw error;}
finally {await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();await server.close();}
