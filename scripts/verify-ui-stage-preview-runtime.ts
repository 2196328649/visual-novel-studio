import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { uiStageFixture, writeUiStageAssets } from './lib/ui-stage-fixture';
import { buildProject, runRenpy } from '../src/runtime/service';

const root=path.resolve('.'),output=path.join(root,'artifacts/ui-stage-preview-runtime',new Date().toISOString().replaceAll(':','-'));
await writeUiStageAssets(output);const {project,image}=uiStageFixture();await fs.writeFile(path.join(output,'project.vns.json'),JSON.stringify(project));
const game=path.join(output,'game'),sdk=path.join(root,'resources/runtime'),built=await buildProject({project,projectDir:output,outputDir:game,sdkRoot:sdk,development:true});assert.ok(built.ok,built.log);
await fs.writeFile(path.join(game,'game/testcases.rpy'),`testsuite global:
    before testcase:
        $ _test.timeout = 15.0
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit

testcase ui_stage_coordination:
    pause until eval renpy.get_screen("main_menu") is not None
    click id "vn_component_play"
    pause 0.65
    assert eval vn_ui_get("label", "text") == "尚未播放"
    assert eval renpy.showing("vn_visual_${image.instanceId}")
    assert eval len(vn_audio_clips) == 1
    assert eval any(renpy.music.get_playing(channel) for channel in vn_audio_clips)
    assert eval all(state["offset"] == 0.5 for state in vn_audio_clips.values())
    screenshot "during-stage.png"
    pause until eval vn_ui_get("label", "text") == "演出完成"
    assert eval vn_ui_get("label", "opacity") > 0.75
    pause until eval vn_ui_get("label", "text") == "全部完成"
    assert eval vn_ui_get("label", "opacity") == 0.3
    assert eval not vn_audio_clips
    screenshot "complete.png"
`);
const result=await runRenpy(sdk,game,['test','--report-detailed'],{savedir:path.join(output,'saves'),timeoutMs:90000,env:{SDL_VIDEO_WINDOW_POS:'2400,0'}});await fs.writeFile(path.join(output,'runtime.log'),result.log);
const passed=result.code===0&&/Test cases\s*:\s*1\s*\|\s*1 passed/.test(result.log);await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:passed?'passed':'failed',checks:['真实点击后的舞台图片与独立声音','等待演出完成后执行改字和控件动画','源偏移、有限声音结束','完成后的控件透明度']},null,2));console.log(output);assert.ok(passed,result.log.slice(-5000));
