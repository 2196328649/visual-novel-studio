import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject } from '../src/core/model';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { chapterCompositionBlueprint } from '../src/core/chapter-composition-blueprint';
import { blueprintNodeDefaults, callablePins, connectBlueprintPins } from '../src/core/blueprint';
import { arrangePerformanceTimeline, performanceTimeline } from '../src/core/performance-timeline';
import { buildProject, runRenpy } from '../src/runtime/service';
const root=path.resolve('.'),sdk=path.join(root,'resources/runtime'),output=path.join(root,'artifacts/nested-timeline-runtime',new Date().toISOString().replaceAll(':','-')),build=path.join(output,'game');
const project=createProject('重叠子时间轴验收');
const childResult=chapterCompositionBlueprint(project,{title:'重叠标题',subtitle:'',duration:3,effect:'fade'}),child=childResult.graph;
child.timelineComponent=true;project.blueprints.push(child);
const parent=blueprintFromPerformance(project,[],'外层');parent.timelineComponent=true;project.blueprints.push(parent);
const call=blueprintNodeDefaults('callFunction');call.properties.graphId=child.id;call.properties['arg_'+childResult.chapterInputs.duration]=4;call.pins=callablePins(child);parent.nodes.push(call);
connectBlueprintPins(parent,parent.nodes[0].id,'exec',call.id,'exec_in');
const stop=blueprintNodeDefaults('stopMusic');stop.properties.fade=0;parent.nodes.push(stop);connectBlueprintPins(parent,call.id,'exec_out',stop.id,'exec_in');
const model=performanceTimeline(project,parent);arrangePerformanceTimeline(project,parent,model.clips.map(clip=>({...clip,at:clip.nodeId===call.id?0.2:1})),model.tracks);
await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'project.vns.json'),JSON.stringify(project));
const result=await buildProject({project,sdkRoot:sdk,outputDir:build,development:true});if(!result.ok)throw Error(result.log);
const story=path.join(build,'game/story.rpy');let source=await fs.readFile(story,'utf8');
source=source.split('\n').flatMap(line=>line.includes(`call vn_blueprint_${child.id}`)?[line,'    $ qa_child_return = renpy.get_game_runtime() - qa_start']:line.includes('$ renpy.music.stop(')?[line,'    $ qa_stop_at = renpy.get_game_runtime() - qa_start']:[line]).join('\n');
await fs.writeFile(story,source);
await fs.writeFile(path.join(build,'game/testcases.rpy'),`default qa_start = 0.0
default qa_child_return = -1.0
default qa_stop_at = -1.0
default qa_done = -1.0
label qa_overlap:
    $ qa_start = renpy.get_game_runtime()
    call vn_blueprint_${parent.id}
    $ qa_done = renpy.get_game_runtime() - qa_start
    "重叠演出结束。"
    return

label qa_blocking:
    $ qa_done = -1.0
    $ qa_start = renpy.get_game_runtime()
    call vn_blueprint_${child.id}
    $ qa_done = renpy.get_game_runtime() - qa_start
    "普通调用结束。"
    return

testsuite global:
    before testcase:
        $ _test.timeout = 15.0
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit

testcase overlapping_child_save_load:
    click id "vn_main_start"
    run Jump("qa_overlap")
    pause until eval qa_stop_at >= 0.0
    assert eval 0.15 <= qa_child_return < 0.6
    assert eval 0.9 <= qa_stop_at < 1.5
    assert eval qa_done == -1.0
    screenshot "overlapping-title.png"
    run FileSave("qa_overlap", confirm=False, slot=True)
    assert eval renpy.can_load("qa_overlap")
    pause 0.2
    run FileLoad("qa_overlap", confirm=False, slot=True)
    assert eval qa_done == -1.0
    assert eval vn_bp_timeline_end_${parent.id} - qa_start >= 4.1
    pause until "重叠演出结束。"
    assert eval 4.0 <= qa_done < 5.2
    run Jump("qa_blocking")
    pause 0.3
    assert eval qa_done == -1.0
    click pos (100, 100)
    pause until "普通调用结束。"
    assert eval 0.25 <= qa_done < 1.5
`);
const run=await runRenpy(sdk,build,['test','--report-detailed'],{savedir:path.join(output,'saves'),timeoutMs:90000,env:{SDL_VIDEO_WINDOW_POS:'2400,0'}});await fs.writeFile(path.join(output,'runtime.log'),run.log);
const passed=run.code===0&&/Test cases\s*:\s*1\s*\|\s*1 passed/.test(run.log);await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:passed?'passed':'failed',checks:['子时间轴立即返回，外层1秒处动作准时执行','调用参数把默认3秒改成4秒并传播结束时刻','重叠播放中的真实保存读取','外层等待至4.2秒之后再进入台词','普通独立调用仍等待且允许点击跳过']}));console.log(output);if(!passed)throw Error(run.log.slice(-4500));
