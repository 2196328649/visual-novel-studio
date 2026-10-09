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
const root=path.resolve('.'), output=path.join(root,'artifacts/ui-button-shortcuts',new Date().toISOString().replaceAll(':','-'));
await fs.mkdir(output,{recursive:true});
const project=createProject('高级UI编辑验收');
project.variables.push({id:'show_title',name:'显示标题',type:'boolean',initial:true,persistent:false});project.ui.components.push({id:'title_probe',kind:'text',page:'main',text:'测试标题',x:.1,y:.1,width:.5,height:.1});
project.variables.push({id:'preview_text',name:'预演标题',type:'string',initial:'默认标题',persistent:false},{id:'preview_x',name:'预演横向位置',type:'number',initial:.1,persistent:false});
createUiParameterBinding(project,'title_probe','visible','show_title','ui:main');createUiParameterBinding(project,'title_probe','text','preview_text','ui:main');createUiParameterBinding(project,'title_probe','x','preview_x','ui:main');
project.variables.push({id:'enable_button',name:'启用按钮',type:'boolean',initial:true,persistent:false},{id:'visible_button',name:'显示按钮',type:'boolean',initial:true,persistent:false});
const button={shortcut:'K_e',enabledWhen:{kind:'compare' as const,variableId:'enable_button',operator:'eq' as const,value:true},visibleWhen:{kind:'compare' as const,variableId:'visible_button',operator:'eq' as const,value:true},id:'toggle_button',kind:'button' as const,page:'main' as const,text:'切换显示',x:.65,y:.65,width:.3,height:.2};project.ui.components.push(button);
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
 const frame=page.getByLabel('参数联动预演画面',{exact:true});await frame.focus();await page.keyboard.press('e');await expect(object).toHaveCount(0);await page.keyboard.press('e');await expect(object).toContainText('默认标题');
 await page.getByLabel('预演参数 启用按钮',{exact:true}).selectOption('false');await frame.focus();await page.keyboard.press('e');await expect(object).toContainText('默认标题');
 await page.getByLabel('预演参数 显示按钮',{exact:true}).selectOption('false');await frame.focus();await page.keyboard.press('e');await expect(object).toContainText('按键标题');
 await page.getByRole('button',{name:'恢复测试值',exact:true}).click();await page.getByRole('button',{name:'触发 E',exact:true}).click();await expect(object).toHaveCount(0);
 await page.getByRole('button',{name:'恢复测试值',exact:true}).click();await expect(object).toContainText('默认标题');
 await expect(page.locator('.dirty-dot')).toHaveCount(0);expect(await fs.readFile(projectFile,'utf8')).toBe(savedBefore);
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',checks:['按钮快捷键执行点击蓝图','按钮优先于同键页面事件','禁用按钮捕获按键而不执行','隐藏按钮允许页面事件','显式触发按钮使用同一规则','恢复及无工程修改']}));console.log(output);
} catch(error){await page.screenshot({path:path.join(output,'failure.png')});throw error;}
finally {await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();await server.close();}
