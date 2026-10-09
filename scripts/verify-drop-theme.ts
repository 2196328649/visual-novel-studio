import { PNG } from 'pngjs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { createServer } from 'vite';
import { createProject } from '../src/core/model';
import { blueprintNodeDefaults, createBlueprintGraph } from '../src/core/blueprint';
import { launchDesktopFixture } from './lib/desktop-fixture';
const root=path.resolve('.'), output=path.join(root,'artifacts/drop-theme',new Date().toISOString().replaceAll(':','-'));
await fs.mkdir(output,{recursive:true});
const project=createProject('拖放与主题验收'), graph=createBlueprintGraph('effect','拖放测试');
const literal=blueprintNodeDefaults('literal');literal.pins[0].dataType='asset';literal.x=600;literal.y=0;graph.nodes.push(literal);project.blueprints.push(graph); project.assets.push({id:'drop_audio',name:'音频测试',kind:'audio',path:'test.ogg'});
for(const [id,w,h] of [['wide',1600,200],['tall',200,1600]] as const){const png=new PNG({width:w,height:h});for(let i=0;i<png.data.length;i+=4){png.data[i]=240;png.data[i+1]=130;png.data[i+2]=20;png.data[i+3]=255;}await fs.writeFile(path.join(output,id+'.png'),PNG.sync.write(png));project.assets.push({id,name:id,kind:'image',path:id+'.png'});}
const projectFile=path.join(output,'project.vns.json'); await fs.writeFile(projectFile,JSON.stringify(project));
const server=await createServer({root,server:{host:'127.0.0.1',port:0,watch:{ignored:['**/artifacts/**','**/resources/**','**/release/**']}}}); await server.listen();
const app=await launchDesktopFixture({root,projectFile,profile:path.join(output,'profile'),devUrl:`http://127.0.0.1:${(server.httpServer!.address() as {port:number}).port}`}), page=await app.firstWindow();
const checks:string[]=[];
try {
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1700,1050));
 await page.locator('[data-workspace-tab="blueprint"]').click();
 await page.getByRole('button',{name:'框选全部节点',exact:true}).click();
 await page.waitForTimeout(300);
 for(let i=0;i<2;i++) {
  if(i) {await page.getByRole('button',{name:'缩小画布',exact:true}).click();await page.waitForTimeout(200);}
  const canvas=page.locator('.generic-blueprint-workspace .flow-container');
  const point=await page.locator('.react-flow__node').first().evaluate(el=>{const b=el.getBoundingClientRect();return {x:Math.round(b.x+20),y:Math.round(b.y+20)};});
  const expected=await page.locator('.react-flow__viewport').evaluate((el,p)=>{const matrix=new DOMMatrix(getComputedStyle(el).transform);const b=el.closest('.react-flow')!.getBoundingClientRect();return {x:(p.x-b.x-matrix.e)/matrix.a,y:(p.y-b.y-matrix.f)/matrix.d};},point);
  await canvas.evaluate((el,p)=>{const data=new DataTransfer();data.setData('application/vns-asset','drop_audio');el.dispatchEvent(new DragEvent('drop',{bubbles:true,clientX:p.x,clientY:p.y,dataTransfer:data}));},point);
  await page.getByRole('button',{name:'保存工程',exact:true}).click();await expect(page.locator('.dirty-dot')).toHaveCount(0);
  const saved=JSON.parse(await fs.readFile(projectFile,'utf8'));const node=saved.blueprints.find((g:any)=>g.id===graph.id).nodes.at(-1);
  assert.ok(Math.abs(node.x-expected.x)<1 && Math.abs(node.y-expected.y)<1,JSON.stringify({node,expected}));
 } checks.push('重叠区域拖放与缩放后拖放保留鼠标坐标');
 await page.getByRole('button',{name:'作品设置',exact:true}).click();
 await page.getByRole('button',{name:'游戏导出',exact:true}).click();
 const colors=[];
 for(const theme of ['codexLight','codexDark']) {
  await page.evaluate(async theme=>{const modulePath='/src/renderer/editor-theme.ts';const m=await import(modulePath);m.setEditorTheme(theme);},theme);
  const button=page.getByRole('button',{name:'一键配置',exact:true}); await expect(button).toBeVisible();
  const color=await button.evaluate(el=>{const s=getComputedStyle(el);return {color:s.color,background:s.backgroundColor};});
  assert.notEqual(color.color,color.background);colors.push({theme,...color});
  await page.screenshot({path:path.join(output,theme+'.png')});
 } checks.push('亮白与黑白主题一键配置文字颜色');
 await page.getByRole('button',{name:'关闭作品设置',exact:true}).click();
 await page.locator('[data-workspace-tab="assets"]').click();
 await expect.poll(()=>page.locator('.content-thumbnail img').evaluateAll(els=>els.every(el=>(el as HTMLImageElement).naturalWidth>0))).toBe(true);
 await page.screenshot({path:path.join(output,'assets.png')});
 const cards=await page.locator('.content-item').evaluateAll(els=>els.slice(0,20).map(el=>{const r=el.getBoundingClientRect(),thumb=el.querySelector('.content-thumbnail')!.getBoundingClientRect();return {text:el.textContent,height:r.height,thumbHeight:thumb.height,clipped:thumb.bottom>r.bottom};}));
 await page.locator('[data-content-key="asset:drop_audio"]').click();
 await page.locator('[data-workspace-tab="blueprint"]').click();
 await page.locator('.react-flow__node[data-id="'+literal.id+'"] .graph-node-title').click();
 await expect(page.getByRole('combobox',{name:'固定值',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'使用资源管理器选中素材：固定值',exact:true}).click();
 await page.getByRole('button',{name:'保存工程',exact:true}).click();await expect(page.locator('.dirty-dot')).toHaveCount(0);
 const selectedProject=JSON.parse(await fs.readFile(projectFile,'utf8'));assert.equal(selectedProject.blueprints.find((g:any)=>g.id===graph.id).nodes.find((n:any)=>n.id===literal.id).properties.value,'drop_audio');
 await page.getByRole('button',{name:'浏览固定值',exact:true}).click();
 await page.getByRole('textbox',{name:'搜索可选资源',exact:true}).fill('音频测试');
 await page.getByRole('button',{name:'预览资源 音频测试',exact:true}).dblclick();
 checks.push('固定值没有素材下拉框；资源管理器选中素材直接使用、搜索窗口双击选择');
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({checks,colors,cards},null,2));console.log(output);
} catch(e){await page.screenshot({path:path.join(output,'failure.png')});throw e;}
finally {await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();await server.close();}
