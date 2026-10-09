import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { createProject, projectSchema, uiComponentSchema } from '../src/core/model';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { arrangePerformanceTimeline, performanceTimeline } from '../src/core/performance-timeline';
import { launchDesktopFixture } from './lib/desktop-fixture';
const root=path.resolve('.'),output=path.join(root,'artifacts/chapter-layout-bounds-' + (process.argv[2] ?? 'long'),new Date().toISOString().replaceAll(':','-'));await fs.mkdir(output,{recursive:true});
const project=createProject('生成排版对照'),chapter={kind:'chapter' as const,title:process.argv[2] === 'empty' ? '' : '同名文字换行\n'.repeat(80),subtitle:'副标题',duration:7,effect:'none' as const};
project.ui.pages={chapterTitle:{layout:'custom'}};project.ui.components=[uiComponentSchema.parse({id:'title',page:'chapterTitle',kind:'chapterTitle',x:.1,y:.1,width:.2,height:.7,style:{fontSize:72}})];
project.nodes.find(n=>n.kind==='passage')!.lines=[{id:'chapter_line',text:'',silent:true,actions:[chapter]}];
const graph=blueprintFromPerformance(project,[chapter],'标题来源');graph.timelineComponent=true;project.blueprints.push(graph);const timeline=performanceTimeline(project,graph);arrangePerformanceTimeline(project,graph,timeline.clips,timeline.tracks);
const file=path.join(output,'project.vns.json');await fs.writeFile(file,JSON.stringify(projectSchema.parse(project)));
const app=await launchDesktopFixture({root,projectFile:file,profile:path.join(output,'profile')}),page=await app.firstWindow();
try{
 if(process.argv[3]) await page.setViewportSize({width:Number(process.argv[3]),height:900});
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});await page.locator('[data-workspace-tab="ui"]').click();await page.getByLabel('设计页面', { exact: true }).selectOption({ label: '章节标题' });
 await expect(page.locator('.ui-chapter-text > span').first()).toHaveText(chapter.title);await page.evaluate(()=>document.fonts.ready);
 const before=await page.locator('.ui-chapter-text > span').evaluateAll(nodes=>nodes.map(node=>{const component=node.closest('.ui-component')!.getBoundingClientRect(),scale=component.width/256,range=document.createRange();range.selectNodeContents(node);const rect=range.getBoundingClientRect();return {x:128+(rect.left-component.left)/scale,y:72+(rect.top-component.top)/scale,width:rect.width/scale,height:rect.height/scale,font:getComputedStyle(node).fontFamily,color:getComputedStyle(node).color};}));
 const visibleBefore=await page.locator('.ui-chapter-text > span').first().evaluate(node=>{const box=node.closest('.ui-component')!.getBoundingClientRect(),scale=box.width/256,range=document.createRange();range.selectNodeContents(node);return [...range.getClientRects()].filter(r=>r.width>0&&r.top<box.bottom&&r.bottom>box.top).map(r=>({x:128+(r.left-box.left)/scale,y:72+(r.top-box.top)/scale,width:r.width/scale,height:r.height/scale}));});
 assert.ok(before.every(b=>b.font.includes('vns_runtime_default')));await page.screenshot({path:path.join(output,'before.png')});
 await page.locator('[data-workspace-tab="blueprint"]').click();await page.getByLabel('演出目标',{exact:true}).selectOption('graph:'+graph.id);await page.locator('.timeline-clip').first().click();await page.getByRole('button',{name:'生成章节组合副本',exact:true}).click();
 await expect(page.getByLabel('演出目标',{exact:true}).locator('option')).toContainText(['标题演出']);
 await page.getByRole('button',{name:'保存工程',exact:true}).click();await expect(page.locator('.dirty-dot')).toHaveCount(0);const saved=projectSchema.parse(JSON.parse(await fs.readFile(file,'utf8'))),copy=saved.blueprints.find(g=>g.name==='标题演出')!;assert.ok(copy);
 await page.getByLabel('演出目标',{exact:true}).selectOption('graph:'+copy.id);await expect(page.locator('[data-visual-text]')).toHaveCount(2);await page.evaluate(()=>document.fonts.ready);
 const after=await page.locator('[data-visual-text] > span').evaluateAll(nodes=>nodes.map(node=>{const svg=node.closest('svg')!,box=svg.getBoundingClientRect(),scale=box.width/1280,range=document.createRange();range.selectNodeContents(node);const rect=range.getBoundingClientRect();return {x:(rect.left-box.left)/scale,y:(rect.top-box.top)/scale,width:rect.width/scale,height:rect.height/scale,color:getComputedStyle(node).color};}));
 await page.screenshot({path:path.join(output,'after.png')});await fs.writeFile(path.join(output,'measurements.json'),JSON.stringify({before,after},null,2));
 for(let i=0;i<2;i++)assert.equal(after[i].color,before[i].color);
 for(let i=process.argv[2] === 'empty' ? 1 : 0;i<2;i++)for(const key of ['x','y','width','height'] as const)assert.ok(Math.abs(before[i][key]-after[i][key])<3,JSON.stringify({i,key,before,after}));
 const visibleAfter=await page.locator('[data-visual-text] > span').first().evaluate(node=>{const box=node.closest('svg')!.getBoundingClientRect(),scale=box.width/1280,range=document.createRange();range.selectNodeContents(node);return [...range.getClientRects()].filter(r=>r.width>0&&(r.top-box.top)/scale<576&&(r.bottom-box.top)/scale>72).map(r=>({x:(r.left-box.left)/scale,y:(r.top-box.top)/scale,width:r.width/scale,height:r.height/scale}));});
 if(process.argv[2] !== 'empty'){assert.equal(visibleBefore.length,visibleAfter.length);for(let i=0;i<visibleBefore.length;i++)for(const key of ['x','y','width','height'] as const)assert.ok(Math.abs(visibleBefore[i][key]-visibleAfter[i][key])<3,JSON.stringify({i,key,visibleBefore,visibleAfter}));}
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',before,after,visibleBefore,visibleAfter},null,2));
}catch(error){await page.screenshot({path:path.join(output,'failure.png')});console.log(await page.locator('body').innerText());throw error;}finally{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(window=>window.destroy())).catch(()=>undefined);await app.close();console.log(output);}
