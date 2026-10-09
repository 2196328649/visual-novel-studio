import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { createServer } from 'vite';
import { createProject } from '../src/core/model';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { chapterCompositionBlueprint } from '../src/core/chapter-composition-blueprint';
import { blueprintNodeDefaults,callablePins,connectBlueprintPins,synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { performanceTimeline,arrangePerformanceTimeline } from '../src/core/performance-timeline';
import { launchDesktopFixture } from './lib/desktop-fixture';
const root=path.resolve('.'),output=path.join(root,'artifacts/timeline-diagnostics',new Date().toISOString().replaceAll(':','-'));await fs.mkdir(output,{recursive:true});
const project=createProject('子时间轴诊断验收'),child=chapterCompositionBlueprint(project,{title:'标题',subtitle:'',duration:1,effect:'fade'}).graph;child.timelineComponent=true;project.blueprints.push(child);
let model=performanceTimeline(project,child);arrangePerformanceTimeline(project,child,model.clips.map(c=>({...c,at:.5})),model.tracks);
const parent=blueprintFromPerformance(project,[],'父时间轴');parent.timelineComponent=true;project.blueprints.push(parent);
const call=blueprintNodeDefaults('callFunction');call.properties.graphId=child.id;call.pins=callablePins(child);parent.nodes.push(call);connectBlueprintPins(parent,parent.nodes[0].id,'exec',call.id,'exec_in');model=performanceTimeline(project,parent);arrangePerformanceTimeline(project,parent,model.clips,model.tracks);
const delay=child.nodes.find(n=>n.type==='delay'&&n.id!==child.timeline?.tailNodeId)!;const duration=blueprintNodeDefaults('literal');duration.properties.value=.5;duration.pins.find(p=>p.id==='value')!.dataType='number';child.nodes.push(duration);connectBlueprintPins(child,duration.id,'value',delay.id,'seconds');synchronizeBlueprintSignatures(project);
const file=path.join(output,'project.vns.json');await fs.writeFile(file,JSON.stringify(project));const before=await fs.readFile(file,'utf8');
const server=await createServer({root,server:{host:'127.0.0.1',port:0,watch:{ignored:['**/artifacts/**','**/resources/**','**/release/**']}}});await server.listen();
const app=await launchDesktopFixture({root,projectFile:file,profile:path.join(output,'profile'),devUrl:'http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port}),page=await app.firstWindow();
try{
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});await page.locator('.status-bar .error-status').click();
 const diagnostic=page.locator('.diagnostic-item').filter({hasText:'不能交错播放'});await expect(diagnostic).toContainText('内部等待时长由数据连线控制');await expect(diagnostic).toHaveAttribute('data-node-id',delay.id);
 await diagnostic.locator('.diagnostic-main').click();await expect(page.locator('[data-workspace-tab="blueprint"]')).toHaveClass(/active/);
 await page.getByRole('button',{name:'试玩',exact:true}).click();await expect(page.locator('.play-workspace')).toHaveAttribute('data-preview-state','failed',{timeout:45000});await expect(page.locator('.play-workspace')).toContainText('不能交错播放');
 await page.screenshot({path:path.join(output,'diagnostic.png')});expect(await fs.readFile(file,'utf8')).toBe(before);
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',checks:['工程检查显示具体动态等待原因','诊断指向子等待节点并可定位蓝图','试玩明确失败而非顺序播放','不改磁盘工程']},null,2));console.log(output);
}catch(error){await page.screenshot({path:path.join(output,'failure.png')});throw error;}finally{await page.evaluate(()=>window.studio?.controlPreview?.('stop')).catch(()=>undefined);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();await server.close();}
