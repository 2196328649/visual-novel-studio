import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject, type BlueprintNode, type UiAnimationKey } from '../src/core/model';
import { blueprintNodeDefaults, createBlueprintGraph, connectBlueprintPins, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { createUiEventGraph, ensureUiClickEvent } from '../src/core/ui-logic';
import { createUiAnimationClip, addUiAnimationTrack } from '../src/core/ui-animation-clips';
import { buildProject, runRenpy } from '../src/runtime/service';

const root=path.resolve('.'),output=path.join(root,'artifacts/ui-animation-clips-runtime',new Date().toISOString().replaceAll(':','-'));await fs.mkdir(output,{recursive:true});
const project=createProject('命名控件动画原生验收');project.ui.pages={...project.ui.pages,main:{layout:'custom'}};
project.ui.components.push({id:'target',kind:'text',page:'main',text:'起始文字',x:.1,y:.4,width:.3,height:.1},...['play','stop','reset','wait','replace','property','start'].map((id,i)=>({id,kind:'button' as const,page:'main' as const,text:id,x:.01+i*.14,y:.1,width:.13,height:.1,...(id==='start'?{action:'start' as const}:{})})),{id:'saved_target',kind:'text',page:'say',text:'关键帧保存',x:.1,y:.1,width:.3,height:.1});
const key=(id:string,time:number,value:number,easing:UiAnimationKey['easing']='linear'):UiAnimationKey=>({id,time,value,easing});
const clip=createUiAnimationClip(project,'ui:main');clip.name='往返并淡出';clip.duration=3;
addUiAnimationTrack(clip,project.ui.components[0],'x').keys=[key('x0',0,.1),key('x1',1,.9),key('x2',2,.3)];
addUiAnimationTrack(clip,project.ui.components[0],'opacity').keys=[key('o0',0,1),key('o2',2,0)];
const savedClip=createUiAnimationClip(project,'ui:say');savedClip.duration=4;addUiAnimationTrack(savedClip,project.ui.components.find(c=>c.id==='saved_target')!,'x').keys=[key('save0',0,.1),key('save1',1,.6),key('save2',2,.2),key('save4',4,.9,'easeout')];
const graph=createUiEventGraph(project,'ui:main','主菜单控件动画');
const node=(type:BlueprintNode['type'],properties:BlueprintNode['properties']={})=>{const n=blueprintNodeDefaults(type);Object.assign(n.properties,properties);graph.nodes.push(n);return n;};
const chain=(...nodes:BlueprintNode[])=>{for(let i=0;i<nodes.length-1;i++)assert.equal(connectBlueprintPins(graph,nodes[i].id,nodes[i].type.startsWith('event')?'exec':'exec_out',nodes[i+1].id,'exec_in'),undefined);};
const event=(id:string)=>ensureUiClickEvent(project,graph,id,'ui:main');
chain(event('play'),node('playUiAnimation',{animationId:clip.id,wait:false}),node('setUiProperty',{componentId:'target',property:'text',value:'已启动'}));
chain(event('stop'),node('stopUiAnimationPlayback',{animationId:clip.id,finish:false}));chain(event('reset'),node('resetUiComponent',{componentId:'target'}));
const shared=createBlueprintGraph('function','共享命名动画'),sharedPlay=blueprintNodeDefaults('playUiAnimation');sharedPlay.properties={animationId:clip.id,wait:true};shared.nodes.push(sharedPlay);project.blueprints.push(shared);connectBlueprintPins(shared,shared.nodes[0].id,'exec',sharedPlay.id,'exec_in');
chain(event('wait'),node('callFunction',{graphId:shared.id}),node('setUiProperty',{componentId:'target',property:'text',value:'原等待结束'}));
chain(event('replace'),node('callFunction',{graphId:shared.id}),node('setUiProperty',{componentId:'target',property:'text',value:'替换回调结束'}));
chain(event('property'),node('animateUiProperty',{componentId:'target',property:'x',value:.8,duration:1,easing:'linear',wait:false}),node('stopUiAnimationPlayback',{animationId:clip.id,finish:true}));
const saved=createUiEventGraph(project,'ui:say','存档关键帧动画'),savedPlay=blueprintNodeDefaults('playUiAnimation');savedPlay.properties={animationId:savedClip.id,wait:false};saved.nodes.push(savedPlay);connectBlueprintPins(saved,saved.nodes[0].id,'exec',savedPlay.id,'exec_in');
const passage=project.nodes.find(n=>n.kind==='passage')!;passage.lines=[{id:'save_line',text:'这里测试关键帧动画的保存与读取。',actions:[]}];project.entryId=passage.id;
synchronizeBlueprintSignatures(project);await fs.writeFile(path.join(output,'project.vns.json'),JSON.stringify(project));
const game=path.join(output,'game'),sdk=path.join(root,'resources/runtime');const built=await buildProject({project,outputDir:game,sdkRoot:sdk,development:true});assert.ok(built.ok,built.log);
await fs.writeFile(path.join(game,'game/testcases.rpy'),`default qa_x = 0.0
default qa_opacity = 0.0
default qa_saved_x = 0.0
default qa_saved_token = 0
default qa_saved_elapsed = 0.0
testsuite global:
    before testcase:
        $ _test.timeout = 15.0
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit

testcase named_widget_animation:
    pause until eval renpy.get_screen("main_menu") is not None
    click id "vn_component_play"
    pause 0.5
    assert eval 0.35 < vn_ui_get("target", "x") < 0.65
    assert eval 0.6 < vn_ui_get("target", "opacity") < 0.85
    assert eval vn_ui_get("target", "text") == "已启动"
    screenshot "moving.png"
    click id "vn_component_stop"
    $ qa_x = vn_ui_get("target", "x")
    $ qa_opacity = vn_ui_get("target", "opacity")
    pause 0.3
    assert eval vn_ui_get("target", "x") == qa_x and vn_ui_get("target", "opacity") == qa_opacity
    assert eval not vn_ui_animations
    click id "vn_component_reset"
    click id "vn_component_wait"
    pause 0.2
    click id "vn_component_replace"
    pause 1.4
    assert eval vn_ui_get("target", "text") == "起始文字"
    assert eval 0.45 < vn_ui_get("target", "x") < 0.85
    pause 0.8
    assert eval vn_ui_get("target", "x") == 0.3
    assert eval vn_ui_get("target", "opacity") == 0
    assert eval vn_ui_get("target", "text") == "起始文字"
    pause until eval vn_ui_get("target", "text") == "原等待结束"
    assert eval not vn_ui_animations
    click id "vn_component_reset"
    click id "vn_component_play"
    pause 0.3
    click id "vn_component_property"
    assert eval vn_ui_get("target", "opacity") == 0
    assert eval len(vn_ui_animations) == 1
    pause until eval not vn_ui_animations
    assert eval vn_ui_get("target", "x") == 0.8
    click id "vn_component_start"
    pause until "这里测试关键帧动画的保存与读取。"
    pause 0.5
    $ qa_saved_x = vn_ui_get("saved_target", "x")
    assert eval 0.25 < qa_saved_x < 0.5
    $ qa_saved_token = vn_ui_animations[("saved_target", "x")]["token"]
    $ qa_saved_elapsed = vn_ui_animations[("saved_target", "x")]["elapsed"]
    $ print("NAMED_QA_SAVE", qa_saved_x, repr(vn_ui_animations))
    run FileSave("qa_named_widget", confirm=False, slot=True)
    assert eval renpy.can_load("qa_named_widget")
    pause 0.9
    run FileLoad("qa_named_widget", confirm=False, slot=True)
    $ print("NAMED_QA_LOAD", qa_saved_x, vn_ui_get("saved_target", "x"), repr(vn_ui_animations))
    assert eval abs(vn_ui_get("saved_target", "x") - qa_saved_x) < 0.03
    assert eval vn_ui_animations[("saved_target", "x")]["token"] == qa_saved_token
    assert eval abs(vn_ui_animations[("saved_target", "x")]["elapsed"] - qa_saved_elapsed) < 0.03
    pause 0.2
    assert eval qa_saved_x + 0.04 < vn_ui_get("saved_target", "x") < qa_saved_x + 0.2
    pause until eval not vn_ui_animations
    assert eval vn_ui_get("saved_target", "x") == 0.9
    screenshot "loaded-complete.png"
`);
const result=await runRenpy(sdk,game,['test','--report-detailed'],{savedir:path.join(output,'saves'),timeoutMs:90000,env:{SDL_VIDEO_WINDOW_POS:'2400,0'}});await fs.writeFile(path.join(output,'runtime.log'),result.log);
const passed=result.code===0&&/Test cases\s*:\s*1\s*\|\s*1 passed/.test(result.log);await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:passed?'passed':'failed',checks:['命名多轨道关键帧在菜单中连续播放','停止保留所有轨道中间值','共享动画图重入、反向运动与末帧保持后恢复外层等待','停止命名动画不影响后来替换该属性的动画','真实保存读取保留关键帧段内进度并完成']},null,2));console.log(output);assert.ok(passed,result.log.slice(-5000));
