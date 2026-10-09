import { projectToText } from '../src/core/text-script';
import { openStoryMode } from './lib/story-workspace';
import { blueprintNodeDefaults } from '../src/core/blueprint';
import { linePreviewSnapshot } from '../src/core/line-preview';
import { arrangePerformanceTimeline, performanceTimeline } from '../src/core/performance-timeline';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { projectSchema } from '../src/core/model';
import { nodeMoveOffsets } from '../src/core/move-offsets';
import { launchDesktopFixture } from './lib/desktop-fixture';
const root=path.resolve('.'),source=path.join(root,'artifacts/stage-dynamic-move/2026-10-01T17-44-12.455Z'),timeline=process.argv.includes('timeline'),legacy=process.argv.includes('saved'),direct=process.argv.includes('direct');
const output=path.join(root,'artifacts/entrance-offset-editor'+(timeline?'-timeline':'')+(legacy?'-saved':'')+(direct?'-direct':''),new Date().toISOString().replaceAll(':','-'));await fs.mkdir(output,{recursive:true});
const project=projectSchema.parse(JSON.parse(await fs.readFile(path.join(source,'project.vns.json'),'utf8'))),graph=project.blueprints[0],node=graph.nodes.find(n=>n.type==='showCharacter')!;
if(legacy||direct){
 const passage=project.nodes.find(n=>n.kind==='passage')!;
 const action=linePreviewSnapshot(project,{nodeId:passage.id,lineId:passage.lines[0].id}).actions.find(a=>a.kind==='show')!;
 assert.ok(action?.kind==='show'&&action.moveOffsets);
 const inputs=new Set(graph.nodes.filter(n=>n.type==='getInput').map(n=>n.id));
 graph.links=graph.links.filter(l=>!inputs.has(l.fromNodeId)&&!inputs.has(l.toNodeId));graph.nodes=graph.nodes.filter(n=>!inputs.has(n.id));graph.exposedInputs=[];
 if(direct){passage.lines[0].actions=[action,{kind:'pause',seconds:.5}];project.blueprints=[];project.scriptText={format:'vns-text-1',content:projectToText(project)};}
 node.type='savedAction';node.pins=blueprintNodeDefaults('savedAction').pins;node.properties={action:JSON.stringify(action)};
}
if(timeline){graph.timelineComponent=true;const model=performanceTimeline(project,graph);arrangePerformanceTimeline(project,graph,model.clips,model.tracks);}
for(const asset of project.assets){await fs.mkdir(path.dirname(path.join(output,asset.path)),{recursive:true});await fs.copyFile(path.join(source,asset.path),path.join(output,asset.path));}
const projectFile=path.join(output,'project.vns.json');await fs.writeFile(projectFile,JSON.stringify(project));
const app=await launchDesktopFixture({root,projectFile,profile:path.join(output,'profile')}),page=await app.firstWindow(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
const open=async()=>{
 if(direct){await openStoryMode(page,'script');await page.locator('#line-'+project.nodes.find(n=>n.kind==='passage')!.lines[0].id+' textarea').click();await page.locator('[data-workspace-tab="flowchart"]').click();await page.locator('.entrance-offsets-editor summary').click();return;}
 await page.locator('[data-workspace-tab="blueprint"]').click();await page.getByLabel('演出目标',{exact:true}).selectOption('graph:'+graph.id);
 if(timeline) await page.locator('.timeline-clip[data-node-id="'+node.id+'"]').click();
 else {await page.getByRole('button',{name:'框选全部节点',exact:true}).click();await page.locator('.react-flow__node[data-id="'+node.id+'"] .graph-node-title').click();}
 await page.locator('.entrance-offsets-editor summary').click();
};
const save=async()=>{await page.getByRole('button',{name:'保存工程',exact:true}).click();await expect(page.locator('.dirty-dot')).toHaveCount(0);return projectSchema.parse(JSON.parse(await fs.readFile(projectFile,'utf8')));};
try{
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});await open();
 const progress=page.getByLabel('横向偏移帧 2 进度 %',{exact:true});await expect(progress).toHaveValue('50');await progress.fill('60');await progress.press('Tab');
 const value=page.getByLabel('横向偏移帧 2 数值',{exact:true});await value.fill('30');await value.press('Tab');
 await page.getByLabel('横向偏移帧 2 缓动',{exact:true}).selectOption('easeout');
 await page.locator('.entrance-offsets-editor').getByRole('button',{name:'横向偏移时间轴帧 2',exact:true}).press('ArrowRight');
 assert.ok(Math.abs(Number(await progress.inputValue())-60.1)<1e-8);
 await page.locator('.entrance-offsets-editor').getByRole('button',{name:'横向偏移时间轴帧 3',exact:true}).press('ArrowRight');await expect(page.getByLabel('横向偏移帧 3 进度 %',{exact:true})).toHaveValue('100');
 await page.getByRole('checkbox',{name:'纵向偏移曲线',exact:true}).check();await page.getByRole('button',{name:'添加纵向偏移帧',exact:true}).click();
 await page.getByLabel('纵向偏移帧 2 数值',{exact:true}).fill('5');await page.getByLabel('纵向偏移帧 2 数值',{exact:true}).press('Tab');
 await page.getByRole('button',{name:'删除纵向偏移帧 2',exact:true}).click();await page.getByRole('checkbox',{name:'纵向偏移曲线',exact:true}).uncheck();
 if(timeline){await page.getByRole('button',{name:'定位横向偏移帧',exact:true}).nth(1).click();await expect(page.getByRole('slider',{name:'时间轴播放头',exact:true})).toHaveAttribute('aria-valuenow','1.202');}
 const saved=await save();if(direct){const action=saved.nodes.find(n=>n.kind==='passage')!.lines[0].actions[0];assert.equal(action.kind,'show');if(action.kind!=='show')throw Error('Missing show');assert.equal(action.moveOffsets?.x?.[1].value,.3);assert.ok(Math.abs(action.moveOffsets!.x![1].at-.601)<1e-9);assert.equal(saved.blueprints.length,0);await page.screenshot({path:path.join(output,'offset-editor.png')});await page.reload();await expect(page.locator('.project-title strong')).toHaveText(project.name);await open();await expect(page.getByLabel('横向偏移帧 2 数值',{exact:true})).toHaveValue('30');assert.deepEqual(errors,[]);await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',direct,checks:['direct action curve edits','no adapter graph stored','save and reload'],errors},null,2));}else{const g=saved.blueprints.find(g=>g.id===graph.id)!,n=g.nodes.find(n=>n.id===node.id)!,curves=nodeMoveOffsets(n)!;
 if(legacy){assert.equal(n.properties.moveOffsets,undefined);assert.ok(JSON.parse(String(n.properties.action)).moveOffsets);}
 if(timeline){const data=(g:typeof graph)=>g.links.filter(l=>g.nodes.find(n=>n.id===l.toNodeId)?.pins.some(p=>p.id===l.toPinId&&p.dataType!=='exec'));assert.deepEqual(data(g),data(graph));assert.deepEqual(performanceTimeline(saved,g).clips,performanceTimeline(project,graph).clips);}else assert.deepEqual(g.links,graph.links);assert.equal(curves.y,undefined);assert.ok(Math.abs(curves.x![1].at-.601)<1e-9);assert.equal(curves.x![1].value,.3);assert.equal(curves.x![1].easing,'easeout');
 await page.screenshot({path:path.join(output,'offset-editor.png')});await page.reload();await expect(page.locator('.project-title strong')).toHaveText(project.name);await open();await expect(page.getByLabel('横向偏移帧 2 数值',{exact:true})).toHaveValue('30');
 assert.deepEqual(errors,[]);await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',timeline,legacy,curves,checks:['progress/value/easing edit','keyboard marker movement and endpoint clamp','add/remove/disable independent property','wiring and save/reload preserved',...(timeline?['seek relative to component time']:[])],errors},null,2));
}
}catch(error){await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>undefined);throw error;}
finally{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();console.log(output);}
