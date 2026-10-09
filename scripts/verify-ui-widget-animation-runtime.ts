import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject, type BlueprintNode } from '../src/core/model';
import { blueprintNodeDefaults, blueprintPin, createBlueprintGraph, connectBlueprintPins, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { createUiEventGraph, ensureUiClickEvent } from '../src/core/ui-logic';
import { buildProject, runRenpy } from '../src/runtime/service';

const root=path.resolve('.'),output=path.join(root,'artifacts/ui-widget-animation-runtime',new Date().toISOString().replaceAll(':','-'));
await fs.mkdir(output,{recursive:true});const project=createProject('控件动画原生验收');
project.ui.pages={...project.ui.pages,main:{layout:'custom'}};
project.ui.components.push({id:'target',kind:'text',page:'main',text:'移动与淡出',x:.1,y:.45,width:.3,height:.1},
  ...['play','stop','reset','wait','replace','start'].map((id,i)=>({id,kind:'button' as const,page:'main' as const,text:id,x:.02+i*.16,y:.1,width:.14,height:.1,...(id==='start'?{action:'start' as const}:{})})),
  {id:'saved_target',kind:'text',page:'say',text:'保存中动画',x:.1,y:.1,width:.3,height:.1});
const graph=createUiEventGraph(project,'ui:main','主菜单控件动画');
const node=(type:BlueprintNode['type'],properties:BlueprintNode['properties']={})=>{const n=blueprintNodeDefaults(type);Object.assign(n.properties,properties);graph.nodes.push(n);return n;};
const chain=(...nodes:BlueprintNode[])=>{for(let i=0;i<nodes.length-1;i++)assert.equal(connectBlueprintPins(graph,nodes[i].id,nodes[i].type.startsWith('event')?'exec':'exec_out',nodes[i+1].id,'exec_in'),undefined);};
const event=(id:string)=>ensureUiClickEvent(project,graph,id,'ui:main');
const animate=(property:string,value:number,duration:number,wait=false)=>node('animateUiProperty',{componentId:'target',property,value,duration,wait,easing:'linear'});
chain(event('play'),animate('x',.9,2),animate('opacity',0,2),node('setUiProperty',{componentId:'target',property:'text',value:'已启动'}));
chain(event('stop'),node('stopUiAnimation',{componentId:'target',property:'all',finish:false}));
chain(event('reset'),node('resetUiComponent',{componentId:'target'}));
const shared=createBlueprintGraph('function','共享控件动画');shared.exposedInputs.push(blueprintPin('target','目标','input','number',.7),blueprintPin('seconds','秒数','input','number',.5));
const sharedTween=blueprintNodeDefaults('animateUiProperty');sharedTween.properties={componentId:'target',property:'x',value:.7,duration:.5,wait:true,easing:'linear'};
const readTarget=blueprintNodeDefaults('getInput'),readSeconds=blueprintNodeDefaults('getInput');readTarget.properties.inputId='target';readSeconds.properties.inputId='seconds';shared.nodes.push(sharedTween,readTarget,readSeconds);project.blueprints.push(shared);synchronizeBlueprintSignatures(project);
connectBlueprintPins(shared,shared.nodes[0].id,'exec',sharedTween.id,'exec_in');connectBlueprintPins(shared,readTarget.id,'value',sharedTween.id,'value');connectBlueprintPins(shared,readSeconds.id,'value',sharedTween.id,'duration');
chain(event('wait'),node('callFunction',{graphId:shared.id,arg_target:.7,arg_seconds:.5}),node('setUiProperty',{componentId:'target',property:'text',value:'等待结束'}));
chain(event('replace'),node('callFunction',{graphId:shared.id,arg_target:.4,arg_seconds:.4}),node('setUiProperty',{componentId:'target',property:'text',value:'替换结束'}));
const saved=createUiEventGraph(project,'ui:say','存档控件动画'),animation=blueprintNodeDefaults('animateUiProperty');
animation.properties={componentId:'saved_target',property:'x',value:.9,duration:4,wait:false,easing:'linear'};saved.nodes.push(animation);connectBlueprintPins(saved,saved.nodes[0].id,'exec',animation.id,'exec_in');
const passage=project.nodes.find(n=>n.kind==='passage')!;passage.lines=[{id:'save_line',text:'此处保存读取控件动画。',actions:[]}];project.entryId=passage.id;
synchronizeBlueprintSignatures(project);await fs.writeFile(path.join(output,'project.vns.json'),JSON.stringify(project));
const game=path.join(output,'game'),sdk=path.join(root,'resources/runtime');const built=await buildProject({project,outputDir:game,sdkRoot:sdk,development:true});assert.ok(built.ok,built.log);
await fs.writeFile(path.join(game,'game/testcases.rpy'),`default qa_stopped = 0.0
default qa_saved_x = 0.0
testsuite global:
    before testcase:
        $ _test.timeout = 12.0
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit

testcase widget_animation:
    pause until eval renpy.get_screen("main_menu") is not None
    click id "vn_component_play"
    pause 0.5
    assert eval 0.22 < vn_ui_get("target", "x") < 0.5
    assert eval 0.5 < vn_ui_get("target", "opacity") < 0.85
    assert eval vn_ui_get("target", "text") == "已启动"
    screenshot "moving.png"
    click id "vn_component_stop"
    $ qa_stopped = vn_ui_get("target", "x")
    pause 0.35
    assert eval vn_ui_get("target", "x") == qa_stopped
    assert eval not vn_ui_animations
    click id "vn_component_reset"
    assert eval vn_ui_get("target", "x") == 0.1
    assert eval vn_ui_get("target", "opacity") == 1
    click id "vn_component_wait"
    pause 0.15
    assert eval vn_ui_get("target", "text") == "移动与淡出"
    click id "vn_component_replace"
    pause 0.15
    assert eval vn_ui_get("target", "text") == "移动与淡出"
    pause until eval vn_ui_get("target", "text") == "等待结束"
    assert eval vn_ui_get("target", "x") == 0.4
    click id "vn_component_start"
    pause until "此处保存读取控件动画。"
    pause 0.5
    $ qa_saved_x = vn_ui_get("saved_target", "x")
    assert eval 0.17 < qa_saved_x < 0.4
    run FileSave("qa_widget", confirm=False, slot=True)
    assert eval renpy.can_load("qa_widget")
    pause 0.8
    run FileLoad("qa_widget", confirm=False, slot=True)
    assert eval abs(vn_ui_get("saved_target", "x") - qa_saved_x) < 0.07
    pause 0.25
    assert eval qa_saved_x + 0.02 < vn_ui_get("saved_target", "x") < qa_saved_x + 0.12
    pause until eval not vn_ui_animations
    assert eval vn_ui_get("saved_target", "x") == 0.9
    screenshot "loaded-complete.png"
`);
const result=await runRenpy(sdk,game,['test','--report-detailed'],{savedir:path.join(output,'saves'),timeoutMs:90000,env:{SDL_VIDEO_WINDOW_POS:'2400,0'}});
await fs.writeFile(path.join(output,'runtime.log'),result.log);const passed=result.code===0&&/Test cases\s*:\s*1\s*\|\s*1 passed/.test(result.log);
await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:passed?'passed':'failed',checks:['主菜单按钮并行移动与淡出，中间值真实变化','不等待立即执行后续节点','停止保持中间值，重置恢复默认','等待结束后继续执行，嵌套调用同一共享动画后恢复原等待','剧情控件动画真实保存读取，保留进度并完成']},null,2));console.log(output);assert.ok(passed,result.log.slice(-5000));
