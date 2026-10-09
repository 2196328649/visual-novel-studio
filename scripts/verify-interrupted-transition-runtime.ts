
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { createProject } from '../src/core/model';
import { linePreviewSnapshot, linePlaybackPlan, sampleLinePlayback } from '../src/core/line-preview';
import { buildProject, runRenpy } from '../src/runtime/service';
const root=path.resolve('.'),output=path.join(root,'artifacts/interrupted-transition',new Date().toISOString().replaceAll(':','-'));await fs.mkdir(output,{recursive:true});
const project=createProject('连续过渡验收');project.width=800;project.height=450;
for(const [id,rgb]of [['red',[255,0,0]],['blue',[0,0,255]],['green',[0,255,0]]] as const){const png=new PNG({width:800,height:450});for(let i=0;i<png.data.length;i+=4)png.data.set([...rgb,255],i);await fs.writeFile(path.join(output,id+'.png'),PNG.sync.write(png));project.assets.push({id,name:id,kind:'image',path:id+'.png',width:800,height:450});}
const passage=project.nodes.find(n=>n.kind==='passage')!;project.entryId=passage.id;passage.lines=[];
const cases=[];for(const first of ['dissolve','fade'] as const)for(const second of ['dissolve','fade'] as const){const id=first+'_'+second;cases.push(id);passage.lines.push({id,text:id,actions:[{kind:'background',assetId:'red',transition:'none'},{kind:'pause',seconds:.1},{kind:'background',assetId:'blue',transition:first,duration:2,wait:false},{kind:'pause',seconds:.3},{kind:'background',assetId:'green',transition:second,duration:2,wait:false},{kind:'pause',seconds:.1}]});}
for(const line of passage.lines){const snap=linePreviewSnapshot(project,{nodeId:passage.id,lineId:line.id}),plan=linePlaybackPlan(snap.before,snap.actions),frame=sampleLinePlayback(snap.before,plan,500);assert.equal(frame.transition?.before.backgroundId,'blue');assert.equal(frame.state.backgroundId,'green');assert.ok(Math.abs(frame.transition!.progress-.05)<1e-8);}
await fs.writeFile(path.join(output,'project.vns.json'),JSON.stringify(project));const sdk=path.join(root,'resources/runtime'),game=path.join(output,'game');const build=await buildProject({project,projectDir:output,outputDir:game,sdkRoot:sdk});assert.ok(build.ok,build.log);await fs.mkdir(path.join(game,'tests'),{recursive:true});
await fs.writeFile(path.join(game,'game/testcases.rpy'),`
init -999 python:
    import renpy as _engine
    _engine.safe_mode_checked = True
init python:
    def qa_capture(name):
        trans = renpy.display.interface.instantiated_transition["master"]
        assert renpy.get_ongoing_transition("master") is not None
        renpy.render_to_file(renpy.display.interface.transition_from["master"], "tests/"+name+"-old.png", width=800, height=450, resize=True)
        renpy.render_to_file(renpy.display.interface.old_scene["master"], "tests/"+name+"-new.png", width=800, height=450, resize=True)
testsuite global:
    teardown:
        exit
testcase interrupted:
    click id "vn_main_start"
${cases.map((id,i)=>`    pause until "${id}"
    run Function(qa_capture, "${id}")
    pause 2.1
    assert eval renpy.get_ongoing_transition("master") is None
${i<cases.length-1?'    advance':''}`).join('\n')}
`);
const result=await runRenpy(sdk,game,['test','--report-detailed'],{savedir:path.join(output,'saves'),timeoutMs:60000});await fs.writeFile(path.join(output,'runtime.log'),result.log);assert.equal(result.code,0,result.log);
const pixels=[];for(const id of cases){const pair=[];for(const [which,expected]of [['old',[0,0,255]],['new',[0,255,0]]] as const){const png=PNG.sync.read(await fs.readFile(path.join(game,'tests',id+'-'+which+'.png'))),offset=(Math.floor(png.height*.3)*png.width+Math.floor(png.width*.5))*4,rgb=Array.from(png.data.subarray(offset,offset+3));assert.ok(rgb.every((value,i)=>Math.abs(value-expected[i])<=1),JSON.stringify({id,which,rgb,expected}));pair.push(rgb);}pixels.push({id,pair});}
await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',pixels,checks:['four dissolve/fade interruption combinations','actual native transition source is previous target, not previous partially blended output','preview agrees on source, destination, and new transition clock','new transition expires after its own duration'],limitation:'This records native replacement semantics; it does not promise a visually smooth continuation of the interrupted blend.'},null,2));console.log(output);
