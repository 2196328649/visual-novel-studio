import { PNG } from 'pngjs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { createServer } from 'vite';
import { createProject } from '../src/core/model';
import { blueprintNodeDefaults, createBlueprintGraph } from '../src/core/blueprint';
import { launchDesktopFixture } from './lib/desktop-fixture';
const root=path.resolve('.'), output=path.join(root,'artifacts/ui-logic-editor',new Date().toISOString().replaceAll(':','-'));
await fs.mkdir(output,{recursive:true});
const project=createProject('高级UI编辑验收');
project.variables.push({id:'show_title',name:'显示标题',type:'boolean',initial:true,persistent:false});project.ui.components.push({id:'title_probe',kind:'text',page:'main',text:'测试标题',x:.1,y:.1,width:.5,height:.1});
const projectFile=path.join(output,'project.vns.json');await fs.writeFile(projectFile,JSON.stringify(project));
const server=await createServer({root,server:{host:'127.0.0.1',port:0,watch:{ignored:['**/artifacts/**','**/resources/**','**/release/**']}}});await server.listen();
const app=await launchDesktopFixture({root,projectFile,profile:path.join(output,'profile'),devUrl:'http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port}),page=await app.firstWindow();
try {
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});
 await page.locator('[data-workspace-tab="ui"]').click();
 await page.getByRole('button',{name:'高级 UI 蓝图',exact:true}).click();
 await page.getByLabel('联动组件',{exact:true}).selectOption('title_probe');
 await page.getByRole('button',{name:'创建联动蓝图',exact:true}).click();
 await expect(page.locator('.react-flow__node')).toHaveCount(5);
 assert.equal(JSON.parse(await fs.readFile(projectFile,'utf8')).blueprints.length,0);
 await page.locator('[data-workspace-tab="script"]').click();
 await page.getByRole('dialog',{name:'保存界面修改'}).getByRole('button',{name:'不保存',exact:true}).click();
 await page.locator('[data-workspace-tab="ui"]').click();
 await page.getByRole('button',{name:'高级 UI 蓝图',exact:true}).click();
 await expect(page.getByLabel('高级界面蓝图')).toHaveValue('');
 await page.getByRole('button',{name:'创建联动蓝图',exact:true}).click();
 await page.getByRole('button',{name:'保存界面',exact:true}).click();await expect(page.locator('.dirty-dot')).toHaveCount(0);
 const saved=JSON.parse(await fs.readFile(projectFile,'utf8'));assert.equal(saved.blueprints.length,1);assert.equal(saved.blueprints[0].nodes.find((n:any)=>n.type==='eventTimer').properties.pageId,'ui:main');
 await page.screenshot({path:path.join(output,'advanced-ui.png')});
 await page.getByRole('button',{name:'返回界面设计',exact:true}).click();await expect(page.locator('.ui-canvas')).toBeVisible();
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',checks:['高级UI入口与完整蓝图画布','创建类型匹配的参数联动','未保存退出丢弃蓝图','保存界面写入蓝图','返回界面设计']}));console.log(output);
} catch(error){await page.screenshot({path:path.join(output,'failure.png')});throw error;}
finally {await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();await server.close();}
