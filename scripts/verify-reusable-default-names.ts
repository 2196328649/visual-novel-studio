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
const root=path.resolve('.'), output=path.join(root,'artifacts/reusable-default-names',new Date().toISOString().replaceAll(':','-'));
await fs.mkdir(output,{recursive:true});
const project=createProject('高级UI编辑验收');
for(const name of ['新的蓝图','界面交互','小游戏逻辑'])project.blueprints.push(createBlueprintGraph('function',name));const alias=createBlueprintGraph('function','别名占用');alias.callName='新的蓝图 2';project.blueprints.push(alias);
const projectFile=path.join(output,'project.vns.json');await fs.writeFile(projectFile,JSON.stringify(project));
const server=await createServer({root,server:{host:'127.0.0.1',port:0,watch:{ignored:['**/artifacts/**','**/resources/**','**/release/**']}}});await server.listen();
const app=await launchDesktopFixture({root,projectFile,profile:path.join(output,'profile'),devUrl:'http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port}),page=await app.firstWindow();
try {
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});
 for(let i=0;i<2;i++){await page.locator('[data-workspace-tab="assets"]').click();await page.locator('.content-create').getByRole('button',{name:'新建',exact:true}).click();await page.locator('.content-create-menu').getByRole('button',{name:'蓝图',exact:true}).click();}
 await page.getByRole('button',{name:'保存工程',exact:true}).click();await expect(page.locator('.dirty-dot')).toHaveCount(0);let saved=JSON.parse(await fs.readFile(projectFile,'utf8'));expect(saved.blueprints.slice(-2).map((g:any)=>g.name)).toEqual(['新的蓝图 3','新的蓝图 4']);
 await page.locator('[data-workspace-tab="ui"]').click();await page.getByLabel('设计页面', { exact: true }).selectOption({ label: '自定义页面' });await page.getByRole('button',{name:'新建自定义页面',exact:true}).click();await page.getByLabel('自定义页面名称',{exact:true}).fill('第一章终幕');await page.getByRole('button',{name:'为此页面新建小游戏',exact:true}).click();
 await page.getByRole('button',{name:'保存界面',exact:true}).click();await expect(page.locator('.dirty-dot')).toHaveCount(0);saved=JSON.parse(await fs.readFile(projectFile,'utf8'));expect(saved.ui.customPages[0].name).toBe('第一章终幕');expect(saved.blueprints.slice(-2).map((g:any)=>g.name)).toEqual(['界面交互 2','小游戏逻辑 2']);expect(saved.minigames.at(-1).name).toBe('小游戏 1');expect(saved.minigames.at(-1).uiPageId).toBe(saved.ui.customPages[0].id);
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',checks:['资源管理器新建蓝图避开已有名称和调用别名','连续新建不重名','自定义页面生成通用界面交互名','小游戏逻辑及定义不带页面或章节名','保存后页面和小游戏引用保留']}));console.log(output);
} catch(error){await page.screenshot({path:path.join(output,'failure.png')});throw error;}
finally {await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();await server.close();}
