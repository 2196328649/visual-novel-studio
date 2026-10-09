import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { createProject, uiComponentSchema } from '../src/core/model';
import { buildProject, runRenpy } from '../src/runtime/service';
const root=path.resolve('.'), output=path.join(root,'artifacts/chapter-ui-style',new Date().toISOString().replaceAll(':','-'));
await fs.mkdir(output,{recursive:true});
const project=createProject('章节样式验收');project.width=1280;project.height=720;
project.ui.pages={chapterTitle:{layout:'custom'}};
project.ui.components=['left','right'].map((align,index)=>uiComponentSchema.parse({id:'qa_'+align,page:'chapterTitle',kind:'chapterTitle',x:.1,y:.1+index*.45,width:.8,height:.4,style:{align,fontSize:96,textColor:'#ffffff',outlineWidth:2,outlineColor:'#ff0000'}}));
const sdk=path.join(root,'resources/runtime'),game=path.join(output,'game');
const built=await buildProject({project,projectDir:output,outputDir:game,sdkRoot:sdk});assert.ok(built.ok,built.log);
await fs.writeFile(path.join(output,'project.vns.json'),JSON.stringify(project));
await fs.writeFile(path.join(game,'game/testcases.rpy'),`
screen qa_chapter_style():
    add Solid("#000000")
    use vn_components_chapterTitle("文字", "副标题")
testsuite global:
    before testcase:
        $ _test.timeout = 15.0
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit
testcase chapter_style:
    run Show("qa_chapter_style")
    pause .5
    screenshot "styles.png"
`);
const result=await runRenpy(sdk,game,['test','--report-detailed'],{savedir:path.join(output,'saves'),timeoutMs:60000});
await fs.writeFile(path.join(output,'runtime.log'),result.log);assert.equal(result.code,0,result.log);
const png=PNG.sync.read(await fs.readFile(path.join(game,'tests/screenshots/styles.png')));
function bounds(y0:number,y1:number){let left=png.width,right=-1,top=png.height,bottom=-1;for(let y=y0;y<y1;y++)for(let x=0;x<png.width;x++){const i=(y*png.width+x)*4;if(png.data[i]>100&&png.data[i+1]>100&&png.data[i+2]>100){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y)}}assert.ok(right>=left);return {left,right,top,bottom};}
const scale=png.width/1280;
const left=bounds(Math.round(72*scale),Math.round(180*scale)),right=bounds(Math.round(396*scale),Math.round(504*scale));
assert.ok(left.left<150*scale&&right.left>900*scale,JSON.stringify({left,right}));assert.ok(left.bottom-left.top>75*scale,'96号主标题未被限制为64号');
await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',left,right},null,2));console.log(output);
