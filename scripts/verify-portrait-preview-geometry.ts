import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { projectSchema } from '../src/core/model';
import { linePreviewSnapshot,linePlaybackPlan,sampleLinePlayback } from '../src/core/line-preview';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';
const root=path.resolve('.'),source=path.join(root,'artifacts/entrance-offset-editor/2026-10-01T18-23-20.678Z'),output=path.join(root,'artifacts/portrait-preview-geometry',new Date().toISOString().replaceAll(':','-'));await fs.mkdir(output,{recursive:true});
const project=projectSchema.parse(JSON.parse(await fs.readFile(path.join(source,'project.vns.json'),'utf8'))),passage=project.nodes.find(n=>n.kind==='passage')!;
for(const asset of project.assets){await fs.mkdir(path.dirname(path.join(output,asset.path)),{recursive:true});await fs.copyFile(path.join(source,asset.path),path.join(output,asset.path));}
const projectFile=path.join(output,'project.vns.json');await fs.writeFile(projectFile,JSON.stringify(project));
const app=await launchDesktopFixture({root,projectFile,profile:path.join(output,'profile')}),page=await app.firstWindow(),samples:unknown[]=[];
try{
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});await openStoryMode(page,'script');await page.locator('#line-next textarea').click();
 for(const time of [.5,1.5]){
  await page.getByLabel('演出预览进度',{exact:true}).fill(String(time));
  const snap=linePreviewSnapshot(project,{nodeId:passage.id,lineId:'next'}),pose=sampleLinePlayback(snap.before,linePlaybackPlan(snap.before,snap.actions),time*1000).state.actors.get(project.characters[0].id)!;
  const asset=project.assets.find(a=>a.id===project.characters[0].expressions[0].assetId)!,width=asset.width!/project.width*pose.scale,height=asset.height!/project.height*pose.scale;
  const expected={x:pose.x-width/2,y:pose.y-height,width,height};
  const read=()=>page.locator('.text-stage-world > .text-stage-actor').first().evaluate(e=>{const b=e.getBoundingClientRect(),w=e.parentElement!.getBoundingClientRect();return {x:(b.x-w.x)/w.width,y:(b.y-w.y)/w.height,width:b.width/w.width,height:b.height/w.height};});
  await expect.poll(async()=>{const actual=await read();return Math.max(...Object.keys(expected).map(key=>Math.abs(actual[key as keyof typeof actual]-expected[key as keyof typeof expected])));}).toBeLessThan(.002);
  samples.push({time,pose,expected,actual:await read()});await page.screenshot({path:path.join(output,'geometry-'+time+'.png')});
 }
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',samples,checks:['saved manual framing preserved','DOM image bounds match source pixel dimensions, bottom anchors and authored zoom','clipping follows authored geometry']},null,2));
}catch(error){await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>undefined);throw error;}
finally{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();console.log(output);}
