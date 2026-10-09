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
const root=path.resolve('.'), output=path.join(root,'artifacts/ui-parameter-controls',new Date().toISOString().replaceAll(':','-'));
await fs.mkdir(output,{recursive:true});
const project=createProject('高级UI编辑验收');
project.variables.push({id:'show_title',name:'显示标题',type:'boolean',initial:true,persistent:false});project.ui.components.push({id:'title_probe',kind:'text',page:'main',text:'测试标题',x:.1,y:.1,width:.5,height:.1});
project.variables.push({id:'preview_text',name:'预演标题',type:'string',initial:'默认标题',persistent:false},{id:'preview_x',name:'预演横向位置',type:'number',initial:.1,persistent:false});
createUiParameterBinding(project,'title_probe','visible','show_title','ui:main');createUiParameterBinding(project,'title_probe','text','preview_text','ui:main');createUiParameterBinding(project,'title_probe','x','preview_x','ui:main');
const button={id:'toggle_button',kind:'button' as const,page:'main' as const,text:'切换显示',x:.65,y:.65,width:.3,height:.2};project.ui.components.push(button);
const clickGraph=createBlueprintGraph('ui','按钮交互');project.blueprints.push(clickGraph);
const click=blueprintNodeDefaults('eventClick');click.properties.componentId=button.id;
const read=blueprintNodeDefaults('getVariable');read.properties.variableId='show_title';
const compare=blueprintNodeDefaults('branch');
const write=blueprintNodeDefaults('setVariable');write.properties={variableId:'show_title',value:false};
const enable=blueprintNodeDefaults('setVariable');enable.properties={variableId:'show_title',value:true};
clickGraph.nodes.push(click,read,compare,write,enable);synchronizeBlueprintSignatures(project);
for(const [from,out,to,input] of [[click.id,'exec',compare.id,'exec_in'],[read.id,'value',compare.id,'condition'],[compare.id,'true',write.id,'exec_in'],[compare.id,'false',enable.id,'exec_in']]){const error=connectBlueprintPins(clickGraph,from,out,to,input);if(error)throw Error(error);}
project.ui.instances=[{id:'other',name:'另一套界面',components:[]}];
for(const [pageId,scope,text] of [['ui:main','base','按键标题'],['ui:say','base','错误页面'],['ui:main','other','错误方案']]) {
 const key=blueprintNodeDefaults('eventKey');key.properties={pageId,uiInstanceId:scope,key:'K_e'};
 const setter=blueprintNodeDefaults('setVariable');setter.properties={variableId:'preview_text',value:text};clickGraph.nodes.push(key,setter);
 const error=connectBlueprintPins(clickGraph,key.id,'exec',setter.id,'exec_in');if(error)throw Error(error);
}
project.variables.find(v=>v.id==='preview_x')!.setting={min:0,max:1,step:.1};
project.variables.push({id:'choice_control',name:'选项参数',type:'string',initial:'甲',persistent:false,setting:{options:['甲','乙']}});
for(const [parameterId,text,y] of [['show_title','画面开关',.25],['preview_text','画面文字',.4],['preview_x','画面位置',.55],['choice_control','画面选项',.8]] as const)project.ui.components.push({id:'control_'+parameterId,kind:'preference',page:'main',parameterId,text,x:.05,y,width:.5,height:.1});
synchronizeBlueprintSignatures(project);
const projectFile=path.join(output,'project.vns.json');await fs.writeFile(projectFile,JSON.stringify(project));
const server=await createServer({root,server:{host:'127.0.0.1',port:0,watch:{ignored:['**/artifacts/**','**/resources/**','**/release/**']}}});await server.listen();
const app=await launchDesktopFixture({root,projectFile,profile:path.join(output,'profile'),devUrl:'http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port}),page=await app.firstWindow();
try {
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});
 await page.locator('[data-workspace-tab="ui"]').click();await page.getByRole('button',{name:'高级 UI 蓝图',exact:true}).click();
 await expect(page.locator('.dirty-dot')).toHaveCount(0);
 const savedBefore=await fs.readFile(projectFile,'utf8');
 await page.locator('.ui-logic-preview > summary').click();
 const object=page.locator('[data-preview-component="title_probe"]');
 await expect(object).toContainText('默认标题');
 await page.getByLabel('画面开关',{exact:true}).uncheck();await expect(object).toHaveCount(0);await page.getByLabel('画面开关',{exact:true}).check();await expect(object).toContainText('默认标题');
 await page.getByLabel('画面文字',{exact:true}).fill('输入');await page.getByLabel('画面文字',{exact:true}).press('e');await expect(object).toContainText('输入e');
 await page.getByLabel('画面位置',{exact:true}).focus();await page.keyboard.press('End');await page.keyboard.press('ArrowLeft');await expect(page.getByLabel('预演参数 预演横向位置',{exact:true})).toHaveValue('0.9');
 const slider=page.getByLabel('画面位置',{exact:true});const rect=(await slider.boundingBox())!;await slider.click({position:{x:rect.width*.7,y:rect.height*.7}});await expect.poll(async()=>Number(await page.getByLabel('预演参数 预演横向位置',{exact:true}).inputValue())).toBeGreaterThan(.5);
 await page.getByLabel('画面选项',{exact:true}).selectOption('乙');await expect(page.getByLabel('预演参数 选项参数',{exact:true})).toHaveValue('乙');
 await page.getByRole('button',{name:'恢复测试值',exact:true}).click();await expect(object).toContainText('默认标题');await expect(page.getByLabel('画面开关',{exact:true})).toBeChecked();await expect(page.getByLabel('画面选项',{exact:true})).toHaveValue('甲');
 await expect(page.locator('.dirty-dot')).toHaveCount(0);expect(await fs.readFile(projectFile,'utf8')).toBe(savedBefore);
 await page.screenshot({path:path.join(output,'controls.png')});
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',checks:['画面参数开关控制可见性','画面文本输入不触发页面按键','画面滑块鼠标及键盘修改参数','画面下拉选项更新参数','恢复测试值','磁盘及未保存状态不变']}));console.log(output);
} catch(error){await page.screenshot({path:path.join(output,'failure.png')});throw error;}
finally {await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();await server.close();}
