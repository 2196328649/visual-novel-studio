import { openStoryMode } from './lib/story-workspace';
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
const root=path.resolve('.'), output=path.join(root,'artifacts/ui-field-audit',new Date().toISOString().replaceAll(':','-'));
await fs.mkdir(output,{recursive:true});
const project=createProject('高级UI编辑验收');
const png=new PNG({width:8,height:8});png.data.fill(255);await fs.writeFile(path.join(output,'pixel.png'),PNG.sync.write(png));project.assets=[{id:'image',kind:'image',name:'图片',path:'pixel.png'}];project.ui.components=[{id:'image_component',kind:'image',page:'main',assetId:'image',text:'',name:'图片组件',x:.1,y:.1,width:.2,height:.2},{id:'text_component',kind:'text',page:'main',text:'测试文字',x:.4,y:.1,width:.2,height:.2}];
const projectFile=path.join(output,'project.vns.json');await fs.writeFile(projectFile,JSON.stringify(project));
const server=await createServer({root,server:{host:'127.0.0.1',port:0,watch:{ignored:['**/artifacts/**','**/resources/**','**/release/**']}}});await server.listen();
const app=await launchDesktopFixture({root,projectFile,profile:path.join(output,'profile'),devUrl:'http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port}),page=await app.firstWindow();
try {
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});
 await page.locator('[data-workspace-tab="ui"]').click();await page.locator('[data-hierarchy-id="image_component"]').click();
 const props=page.locator('.ui-component-properties');await expect(props.getByLabel('图片素材',{exact:true})).toBeVisible();for(const label of ['组件字号','组件文字色','组件字体','文字对齐'])await expect(props.getByLabel(label,{exact:true})).toHaveCount(0);
 await expect(props.getByRole('slider',{name:/^组件不透明度/})).toBeVisible();await page.screenshot({path:path.join(output,'image-properties.png')});
 await page.locator('[data-hierarchy-id="text_component"]').click();await expect(props.getByLabel('组件字号',{exact:true})).toBeVisible();await expect(props.getByLabel('组件文字色',{exact:true})).toBeVisible();
 await expect(page.getByLabel('选择界面实例',{exact:true})).toBeVisible();await expect(page.locator('.ui-instance-toolbar > label').first()).toHaveAttribute('title',/供游戏使用的界面方案/);
 await page.locator('[data-workspace-tab="script"]').click();await openStoryMode(page,'text');await expect(page.getByLabel('文本章节',{exact:true})).toHaveCount(0);await expect(page.locator('.text-editor-toolbar').getByRole('button',{name:'插入指令',exact:true})).toHaveCount(0);await expect(page.locator('.text-panel-heading').getByRole('button',{name:'隐藏演出',exact:true})).toBeVisible();
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',checks:['图片不显示字号、文字色、字体和对齐','图片仍能编辑素材和透明度','文字保留字号和文字色','界面方案有明确用途说明','文本无重复章节选择和插入按钮','隐藏演出在标题栏']}));console.log(output);
}finally {await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();await server.close();}
