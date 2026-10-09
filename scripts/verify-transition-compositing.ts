
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { expect } from '@playwright/test';
import { createProject } from '../src/core/model';
import { createVisualObject } from '../src/core/visual-object';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';
import { buildProject, runRenpy } from '../src/runtime/service';
const root=path.resolve('.'),output=path.join(root,'artifacts/transition-compositing',new Date().toISOString().replaceAll(':','-'));await fs.mkdir(output,{recursive:true});
const project=createProject('过渡合成验收');project.width=800;project.height=450;
for(const [id,rgb]of [['red',[255,0,0]],['blue',[0,0,255]]] as const){const png=new PNG({width:800,height:450});for(let i=0;i<png.data.length;i+=4)png.data.set([...rgb,255],i);await fs.writeFile(path.join(output,id+'.png'),PNG.sync.write(png));project.assets.push({id,name:id,kind:'image',path:id+'.png',width:800,height:450});}
const visual=createVisualObject('solid');visual.color='#00ff00';visual.width=.2;visual.height=.2;visual.duration=10;visual.keyframes[0].x=.25;visual.keyframes[0].y=.25;
const passage=project.nodes.find(n=>n.kind==='passage')!;
const camera={kind:'camera' as const,x:.1,y:0,zoom:1,rotation:0,duration:0,easing:'linear' as const,wait:false};
const mode=process.argv.includes('fade')?'fade':'dissolve';
passage.lines=[{id:'old',text:'旧画面',actions:[{kind:'background',assetId:'red',transition:'none'},visual,camera,{kind:'pause',seconds:.5}]},{id:'new',text:'新画面',actions:[{kind:'background',assetId:'blue',transition:mode,duration:2,wait:false},{...camera,x:.2}]}];
project.entryId=passage.id;const projectFile=path.join(output,'project.vns.json');await fs.writeFile(projectFile,JSON.stringify(project));
const app=await launchDesktopFixture({root,projectFile,profile:path.join(output,'profile')}),page=await app.firstWindow();const pixels:number[][][]=[],errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
const sample=(png:PNG,x:number,y:number)=>Array.from(png.data.subarray((Math.floor(y*png.height)*png.width+Math.floor(x*png.width))*4,(Math.floor(y*png.height)*png.width+Math.floor(x*png.width))*4+3));
try{
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});await openStoryMode(page,'script');await page.locator('#line-new textarea').click();
 for(const time of [.5,1,1.5]){
  const input=page.getByLabel('定位演出时间（秒）',{exact:true});await input.fill(String(time));await input.press('Tab');
  await expect(page.locator('.preview-transition-ghost [data-visual-instance="'+visual.instanceId+'"]')).toHaveCount(1);
  const image=PNG.sync.read(await page.locator('.preview-scene-layers').screenshot({path:path.join(output,'browser-'+time+'.png')}));pixels.push([sample(image,.35,.25),sample(image,.75,.25)]);
 }
 assert.deepEqual(errors,[]);
}finally{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();}
const sdk=path.join(root,'resources/runtime'),game=path.join(output,'game');const build=await buildProject({project,projectDir:output,outputDir:game,sdkRoot:sdk});assert.ok(build.ok,build.log);await fs.mkdir(path.join(game,'tests'),{recursive:true});
await fs.writeFile(path.join(game,'game/testcases.rpy'),`
init -999 python:
    import renpy as _engine
    _engine.safe_mode_checked = True
init python:
    class QAFrozenTransition(renpy.Displayable):
        def __init__(self, child, time):
            super(QAFrozenTransition, self).__init__()
            self.child, self.time = child, time
        def render(self, width, height, st, at):
            return renpy.render(self.child, width, height, self.time, self.time)
    def qa_frames():
        for time in (.5, 1.0, 1.5):
            old = Fixed(Solid("#ff0000"), Transform(Solid("#00ff00", xysize=(160,90)), pos=(.35,.25), anchor=(.5,.5)), xysize=(800,450))
            new = Solid("#0000ff", xysize=(800,450))
            trans = ${mode==='fade'?'renpy.display.transition.Fade(1.0, 0.0, 1.0, old_widget=old, new_widget=new)':'renpy.display.transition.Dissolve(2.0, old_widget=old, new_widget=new)'}
            renpy.render_to_file(QAFrozenTransition(trans,time), "tests/native-"+str(time)+".png", width=800, height=450, resize=True)
testsuite global:
    teardown:
        exit
testcase composite:
    run Function(qa_frames)
`);
const result=await runRenpy(sdk,game,['test','--report-detailed'],{savedir:path.join(output,'saves'),timeoutMs:60000});await fs.writeFile(path.join(output,'runtime.log'),result.log);assert.equal(result.code,0,result.log);
const native=[];for(const [index,time]of ['0.5','1.0','1.5'].entries()){const png=PNG.sync.read(await fs.readFile(path.join(game,'tests/native-'+time+'.png')));const values=[sample(png,.35,.25),sample(png,.75,.25)];native.push(values);values.forEach((point,j)=>point.forEach((value,k)=>assert.ok(Math.abs(value-pixels[index][j][k])<=3,JSON.stringify({time,native:values,browser:pixels[index]}))));}
await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',mode,pixels,native,checks:['old visual retained at its own camera position','old/new layer premultiplied color mixing at three phases','browser pixels compared with actual RenPy transition renderer'],errors},null,2));console.log(output);
