import { arrangePerformanceTimeline, performanceTimeline, insertTimelineAction } from '../src/core/performance-timeline';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { projectSchema } from '../src/core/model';
import { nodeAfterOffsets } from '../src/core/move-offsets';
import { launchDesktopFixture } from './lib/desktop-fixture';
const root=path.resolve('.'),source=path.join(root,'artifacts/stage-after-entrance/2026-10-01T19-09-59.078Z'),timeline=true;
const output=path.join(root,'artifacts/after-offset-shared',new Date().toISOString().replaceAll(':','-'));await fs.mkdir(output,{recursive:true});
const project=projectSchema.parse(JSON.parse(await fs.readFile(path.join(source,'project.vns.json'),'utf8'))),graph=project.blueprints[0],node=graph.nodes.find(n=>n.type==='showCharacter')!;
if(timeline){graph.timelineComponent=true;const model=performanceTimeline(project,graph);arrangePerformanceTimeline(project,graph,model.clips,model.tracks);}
for(const asset of project.assets){await fs.mkdir(path.dirname(path.join(output,asset.path)),{recursive:true});await fs.copyFile(path.join(source,asset.path),path.join(output,asset.path));}
const other=insertTimelineAction(project,graph,{kind:"shake",direction:"horizontal",amplitude:5,duration:.5,wait:false},.25);
const projectFile=path.join(output,'project.vns.json');await fs.writeFile(projectFile,JSON.stringify(project));
const app=await launchDesktopFixture({root,projectFile,profile:path.join(output,'profile')}),page=await app.firstWindow(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
const open=async()=>{
 await page.locator('[data-workspace-tab="blueprint"]').click();await page.getByLabel('演出目标',{exact:true}).selectOption('graph:'+graph.id);
 if(timeline) await page.locator('.timeline-clip[data-node-id="'+node.id+'"]').click();
 else {await page.getByRole('button',{name:'框选全部节点',exact:true}).click();await page.locator('.react-flow__node[data-id="'+node.id+'"] .graph-node-title').click();}
 await page.locator('.after-offsets-editor summary').click();
};
const save=async()=>{await page.getByRole('button',{name:'保存工程',exact:true}).click();await expect(page.locator('.dirty-dot')).toHaveCount(0);return projectSchema.parse(JSON.parse(await fs.readFile(projectFile,'utf8')));};
try{
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});await open();
 const track=page.getByRole('region',{name:'入场偏移轨道 横向偏移',exact:true});
 const shared=page.locator('.after-offset-track').filter({has:page.getByRole('button',{name:'入场后横向偏移时间轴帧 2',exact:true})});
 const marker=shared.getByRole('button',{name:'入场后横向偏移时间轴帧 2',exact:true});
 await expect(marker).toHaveAttribute('data-absolute-time','3.5');await marker.press('ArrowRight');await expect(marker).toHaveAttribute('data-absolute-time','3.6');
 assert.ok(Math.abs(Number(await page.getByLabel('入场后横向偏移帧 2 秒',{exact:true}).inputValue())-1.6)<1e-8);
 await marker.press('Enter');await expect(page.getByRole('slider',{name:'时间轴播放头',exact:true})).toHaveAttribute('aria-valuenow','3.6');
 await page.getByRole('button',{name:'保留属性轨道',exact:true}).click();
 await page.locator('.timeline-clip[data-node-id="'+other+'"]').click();await expect(marker).toBeVisible();
 await marker.press('ArrowRight');await expect(marker).toHaveAttribute('data-absolute-time','3.7');
 await page.locator('.timeline-clip[data-node-id="'+node.id+'"]').click();
 const start=page.getByLabel('片段开始秒数',{exact:true});await start.fill('1');await start.press('Tab');await expect(marker).toHaveAttribute('data-absolute-time','4.7');
 await marker.press('Enter');await expect(page.getByRole('slider',{name:'时间轴播放头',exact:true})).toHaveAttribute('aria-valuenow','4.7');
 const duration=page.locator('.timeline-inspector').getByLabel('时长',{exact:true});await duration.fill('4');await duration.press('Tab');await expect(marker).toHaveAttribute('data-absolute-time','6.7');
 await marker.press('Enter');await expect(page.getByRole('slider',{name:'时间轴播放头',exact:true})).toHaveAttribute('aria-valuenow','6.7');
 const saved=await save(),g=saved.blueprints.find(g=>g.id===graph.id)!,curves=nodeAfterOffsets(g.nodes.find(n=>n.id===node.id)!)!;
 assert.equal(curves.x![1].at,1.7);assert.deepEqual(g.links.filter(l=>['x','duration'].includes(l.toPinId)),graph.links.filter(l=>['x','duration'].includes(l.toPinId)));
 assert.equal(performanceTimeline(saved,g).clips.find(c=>c.nodeId===node.id)!.at,1);
 await marker.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'shared-track.png')});
 assert.deepEqual(errors,[]);await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',curves,checks:['shared seconds seek/movement','pin persists across clip selection and edits original owner','clip start shifts marker without changing relative seconds','data input wiring retained','duration input shifts later frames without changing their relative seconds'],errors},null,2));
}catch(error){await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>undefined);throw error;}
finally{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();console.log(output);}
