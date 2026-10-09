import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { validateProject } from '../src/core/validate';
import { createProject, type UiComponent } from '../src/core/model';
import { blueprintNodeDefaults, createBlueprintGraph, connectBlueprintPins, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openUiPreviewWindow, showUiPreviewTestData } from './lib/ui-preview-window';

const root=path.resolve('.'),output=path.join(root,'artifacts/ui-preview-navigation',new Date().toISOString().replaceAll(':','-'));
await fs.mkdir(output,{recursive:true});
const project=createProject('高级 UI 菜单预演验收');project.width=960;project.height=540;
project.playerDefaults={musicVolume:.8,characterVolume:.7};
project.variables.push({id:'visits',name:'进入次数',type:'number',initial:0,persistent:false},{id:'key_count',name:'按键次数',type:'number',initial:0,persistent:false},{id:'main_tick',name:'标题计时',type:'number',initial:0,persistent:false},{id:'menu_tick',name:'设置计时',type:'number',initial:0,persistent:false});
const increment=(id:string,pageId?:string,type?:'eventKey'|'eventTimer')=>{
 const graph=createBlueprintGraph('ui',id),entry=type?blueprintNodeDefaults(type):graph.nodes[0],read=blueprintNodeDefaults('getVariable'),add=blueprintNodeDefaults('math'),write=blueprintNodeDefaults('setVariable');
 if(type){entry.properties={pageId:pageId!,key:'K_a',interval:1,repeat:true};graph.nodes.push(entry);}read.properties.variableId=id;add.properties={operation:'add',b:1};write.properties.variableId=id;graph.nodes.push(read,add,write);connectBlueprintPins(graph,entry.id,'exec',write.id,'exec_in');connectBlueprintPins(graph,read.id,'value',add.id,'a');connectBlueprintPins(graph,add.id,'result',write.id,'value');project.blueprints.push(graph);return graph.id;
};
const init=increment('visits');increment('key_count','ui:preferences','eventKey');increment('main_tick','ui:main','eventTimer');increment('menu_tick','ui:preferences','eventTimer');
const button=(id:string,page:UiComponent['page'],text:string,action:UiComponent['action'],y:number,x=.12):UiComponent=>({id,page,text,action,kind:'button',x,y,width:.32,height:.14,style:{background:'#245775',textColor:'#ffffff',fontSize:32}});
const components:UiComponent[]=[button('open_settings','main','前往设置','preferences',.2),button('open_save','main','前往存档','save',.42),button('open_load','main','前往读档','load',.64),button('open_voices','preferences','角色音量','voiceSettings',.56),button('back_settings','preferences','返回标题','return',.77),button('back_voices','voiceSettings','返回设置','return',.65),button('back_save','save','返回标题','return',.72),button('dialogue_settings','say','对话中打开设置','preferences',.2)];
components[0].shortcut='e';
components.push({id:'music_volume',kind:'preference',page:'preferences',text:'音乐音量',preference:'musicVolume',x:.12,y:.3,width:.72,height:.12,style:{textColor:'#ffffff',fontSize:28}},{id:'character_volume',kind:'preference',page:'voiceSettings',text:'其他角色音量',preference:'characterVolume',x:.12,y:.3,width:.72,height:.12,style:{textColor:'#ffffff',fontSize:28}}, {...button('save_only','save','仅存档可见',undefined,.3),saveMode:'save'}, {...button('load_only','save','仅读档可见',undefined,.3),saveMode:'load'});
components.push({id:'dialogue_text',kind:'text',page:'say',text:'对白',binding:'dialogue',x:.1,y:.6,width:.8,height:.25});
project.ui.instances=[{id:'navigation_scheme',name:'菜单验收方案',components,blueprintId:init,pages:{main:{layout:'custom',background:'#182536'},preferences:{layout:'custom',background:'#1a4239'},voiceSettings:{layout:'custom',background:'#413155'},save:{layout:'custom',background:'#283b51'},say:{layout:'custom',background:'#182536'}}}];project.ui.activeInstanceId='navigation_scheme';
synchronizeBlueprintSignatures(project);expect(validateProject(project).filter(d=>d.severity==='error')).toEqual([]);
const projectFile=path.join(output,'project.vns.json');await fs.writeFile(projectFile,JSON.stringify(project));
const app=await launchDesktopFixture({root,projectFile,profile:path.join(output,'profile')}),editor=await app.firstWindow();let page=editor;
try {
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});await page.locator('[data-workspace-tab="ui"]').click();await page.getByLabel('界面编辑模式').getByRole('button',{name:'事件图',exact:true}).click();page = await openUiPreviewWindow(app, editor); await showUiPreviewTestData(page);
 const before=await fs.readFile(projectFile,'utf8'),frame=page.getByLabel('参数联动预演画面',{exact:true}),pageName=page.getByLabel('当前预演页面',{exact:true}),visits=page.getByLabel('预演参数 进入次数',{exact:true});
 const click=async(name:string)=>frame.getByRole('button',{name,exact:true}).click();
 await expect(pageName).toHaveText('标题');await expect(visits).toHaveValue('1');await frame.focus();await page.keyboard.press('e');await expect(pageName).toHaveText('设置');await expect(visits).toHaveValue('2');await expect(frame).toHaveCSS('background-color','rgb(26, 66, 57)');
 await expect(page.getByRole('button',{name:'触发 A',exact:true})).toHaveCount(1);await frame.focus();await page.keyboard.press('a');await expect(page.getByLabel('预演参数 按键次数',{exact:true})).toHaveValue('1');
 const music=frame.getByRole('slider',{name:'音乐音量',exact:true});await music.fill('0.25');await click('角色音量');await expect(pageName).toHaveText('角色音量');await expect(page.getByRole('button',{name:'触发 A',exact:true})).toHaveCount(0);await expect(frame).toHaveCSS('background-color','rgb(65, 49, 85)');
 const character=frame.getByRole('slider',{name:'其他角色音量',exact:true});await character.fill('0.3');await click('返回设置');await expect(music).toHaveValue('0.25');await expect(visits).toHaveValue('4');await click('角色音量');await expect(character).toHaveValue('0.3');await click('返回设置');
 await pageName.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'settings.png')});await click('返回标题');await click('前往存档');await expect(pageName).toHaveText('存档');await expect(frame.getByRole('button',{name:'仅存档可见',exact:true})).toHaveCount(1);await expect(frame.getByRole('button',{name:'仅读档可见',exact:true})).toHaveCount(0);await click('返回标题');await click('前往读档');await expect(pageName).toHaveText('读档');await expect(frame.getByRole('button',{name:'仅读档可见',exact:true})).toHaveCount(1);await expect(frame.getByRole('button',{name:'仅存档可见',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'恢复测试值',exact:true}).click();await expect(pageName).toHaveText('标题');await expect(visits).toHaveValue('1');await page.getByLabel('按时间预演',{exact:true}).check();await page.getByRole('button',{name:'推进 1 秒',exact:true}).click();await expect(page.getByLabel('预演参数 标题计时',{exact:true})).toHaveValue('1');await click('前往设置');await page.getByRole('button',{name:'推进 1 秒',exact:true}).click();await expect(page.getByLabel('预演参数 设置计时',{exact:true})).toHaveValue('1');await expect(page.getByLabel('预演参数 标题计时',{exact:true})).toHaveValue('1');await click('返回标题');await page.getByRole('button',{name:'推进 0.1 秒',exact:true}).click();await expect(page.getByLabel('预演参数 标题计时',{exact:true})).toHaveValue('1');await page.getByRole('button',{name:'推进 1 秒',exact:true}).click();await expect(page.getByLabel('预演参数 标题计时',{exact:true})).toHaveValue('2');
 await editor.getByLabel('事件图页面',{exact:true}).selectOption('ui:say');await expect(pageName).toHaveText('对话');await showUiPreviewTestData(page);await click('对话中打开设置');await expect(pageName).toHaveText('设置');await click('返回标题');await expect(pageName).toHaveText('对话');
 await expect(editor.locator('.dirty-dot')).toHaveCount(0);expect(await fs.readFile(projectFile,'utf8')).toBe(before);
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',compiled:true,checks:['菜单点击与快捷键进入设置','当前页面快捷键更新','方案页面颜色与组件','跨页面保留音乐和角色音量','每次进入页面初始化','存档读档组件隔离','恢复起点及初值','计时器离开停止与进入重新计时','对话菜单返回原页','UI草稿和磁盘不变']},null,2));console.log(output);
} catch(error){await page.screenshot({path:path.join(output,'failure.png')});throw error;}
finally{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();}
