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
const root=path.resolve('.'), output=path.join(root,'artifacts/ui-dock',new Date().toISOString().replaceAll(':','-'));
await fs.mkdir(output,{recursive:true});
const project=createProject('高级UI编辑验收');
for(const name of ['新的蓝图','界面交互','小游戏逻辑'])project.blueprints.push(createBlueprintGraph('function',name));const alias=createBlueprintGraph('function','别名占用');alias.callName='新的蓝图 2';project.blueprints.push(alias);
const projectFile=path.join(output,'project.vns.json');await fs.writeFile(projectFile,JSON.stringify(project));
const server=await createServer({root,server:{host:'127.0.0.1',port:0,watch:{ignored:['**/artifacts/**','**/resources/**','**/release/**']}}});await server.listen();
const app=await launchDesktopFixture({root,projectFile,profile:path.join(output,'profile'),devUrl:'http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port}),page=await app.firstWindow();
try {
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});
 await page.locator('[data-workspace-tab="ui"]').click();
 const dock=page.getByLabel('界面面板布局',{exact:true});await expect(dock).toBeVisible();
 await expect(page.locator('.ui-component-tools')).toHaveCount(0);
 const plus=dock.locator('[data-dock-panel="hierarchy"] > header').getByRole('button',{name:'添加组件',exact:true});await plus.click();
 const menu=page.getByLabel('添加组件菜单',{exact:true});await expect(menu).toBeVisible();await menu.getByLabel('搜索添加组件').fill('文字');await menu.getByRole('button',{name:'文字',exact:true}).click();await expect(menu).toBeHidden();
 await expect(dock.locator('[data-hierarchy-id]')).toHaveCount(1);await expect(dock.locator('[data-dock-panel="inspector"] .inspector')).toBeVisible();
 await page.getByRole('button',{name:'保存界面',exact:true}).click();await expect(page.locator('.dirty-dot')).toHaveCount(0);
 let saved=JSON.parse(await fs.readFile(projectFile,'utf8'));assert.equal(saved.ui.components.length,1);assert.equal(saved.ui.components[0].kind,'text');
 const original=await fs.readFile(projectFile,'utf8');
 for(const [label,dx,dy] of [['调整左侧面板宽度',70,0],['调整右侧面板宽度',-60,0],['调整画布与页面设置高度',0,-70]] as const){const divider=dock.getByRole('separator',{name:label});const before=await divider.getAttribute('aria-valuenow');const r=(await divider.boundingBox())!;await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();await page.mouse.move(r.x+r.width/2+dx,r.y+r.height/2+dy,{steps:8});await page.mouse.up();assert.notEqual(await divider.getAttribute('aria-valuenow'),before);}
 await dock.locator('[data-dock-panel="hierarchy"] > header').dragTo(dock.locator('[data-dock-panel="inspector"] > header'));
 await expect(dock.locator('[data-dock-panel="hierarchy"]')).toHaveAttribute('data-dock-slot','right');
 await plus.click();await expect(menu).toBeVisible();await page.keyboard.press('Escape');await expect(menu).toBeHidden();
 await page.screenshot({path:path.join(output,'docked.png')});
 await page.locator('[data-workspace-tab="assets"]').click();await page.locator('[data-workspace-tab="ui"]').click();await expect(dock.locator('[data-dock-panel="hierarchy"]')).toHaveAttribute('data-dock-slot','right');
 await expect(page.getByRole('button',{name:'保存界面',exact:true})).toBeDisabled();assert.equal(await fs.readFile(projectFile,'utf8'),original);
 await page.getByRole('button',{name:'恢复默认界面布局',exact:true}).click();await expect(dock.locator('[data-dock-panel="hierarchy"]')).toHaveAttribute('data-dock-slot','left');
 await page.screenshot({path:path.join(output,'default.png')});
 await plus.click();await menu.getByRole('button',{name:'按钮',exact:true}).click();await expect(dock.locator('[data-hierarchy-id]')).toHaveCount(2);
 await page.locator('[data-workspace-tab="assets"]').click();await expect(page.getByRole('dialog',{name:'保存界面修改',exact:true})).toBeVisible();await page.getByRole('button',{name:'不保存',exact:true}).click();await page.locator('[data-workspace-tab="ui"]').click();await expect(dock.locator('[data-hierarchy-id]')).toHaveCount(1);assert.equal(await fs.readFile(projectFile,'utf8'),original);
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',checks:['标题栏加号菜单搜索并添加文字','旧整行添加控件已移除','组件属性在独立面板显示','三个分隔线鼠标调整','拖动标题交换面板位置','菜单Escape关闭','离开返回保留布局','布局调整不污染工程或保存状态','恢复默认布局','添加后离开仍提示保存，放弃恢复磁盘版本']}));console.log(output);
} catch(error){await page.screenshot({path:path.join(output,'failure.png')});throw error;}
finally {await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();await server.close();}
