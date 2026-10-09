import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { animationPlaybackFixture } from './lib/ui-animation-playback-fixture';
import { buildProject, runRenpy } from '../src/runtime/service';
const root=path.resolve('.'),output=path.join(root,'artifacts/ui-animation-playback-runtime',new Date().toISOString().replaceAll(':','-'));await fs.mkdir(output,{recursive:true});
const {project,clip,savedClip}=animationPlaybackFixture();await fs.writeFile(path.join(output,'project.vns.json'),JSON.stringify(project));
const game=path.join(output,'game'),sdk=path.join(root,'resources/runtime');const built=await buildProject({project,outputDir:game,sdkRoot:sdk,development:true});assert.ok(built.ok,built.log);
await fs.writeFile(path.join(game,'game/testcases.rpy'),`default qa_x = 0.0
default qa_saved_x = 0.0
default qa_saved_token = 0
default qa_saved_elapsed = 0.0
init python:
    def qa_invalid_playback():
        token = vn_ui_play_animation("${clip.id}")
        for mode, loops, speed, current in [("bad", 1, 1, False), ("forward", -1, 1, False), ("forward", 1.5, 1, False), ("forward", True, 1, False), ("forward", 1, 0, False), ("forward", 1, float("nan"), False), ("forward", 1, 1, "true")]:
            try:
                vn_ui_play_animation("${clip.id}", mode, loops, speed, current)
                return False
            except Exception:
                if not vn_ui_animation_active(token):
                    return False
        vn_ui_stop_playback("${clip.id}")
        return True
testsuite global:
    before testcase:
        $ _test.timeout = 15.0
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit

testcase animation_playback:
    pause until eval renpy.get_screen("main_menu") is not None
    move pos (8, 8)
    move id "vn_component_hover"
    pause 0.6
    $ qa_x = vn_ui_get("target", "x")
    assert eval 0.23 < qa_x < 0.4
    move pos (8, 8)
    assert eval abs(vn_ui_get("target", "x") - qa_x) < 0.05
    assert eval vn_ui_animations[("target", "x")]["mode"] == "reverse"
    pause 0.2
    assert eval vn_ui_get("target", "x") < qa_x - 0.03
    $ qa_x = vn_ui_get("target", "x")
    move id "vn_component_hover"
    assert eval abs(vn_ui_get("target", "x") - qa_x) < 0.05
    pause 0.2
    assert eval vn_ui_get("target", "x") > qa_x + 0.03
    move pos (8, 8)
    pause until eval not vn_ui_animations
    assert eval vn_ui_get("target", "x") == 0.1 and vn_ui_get("target", "opacity") == 1
    click id "vn_component_loops"
    assert eval vn_ui_animations[("target", "x")]["loops"] == 2 and vn_ui_animations[("target", "x")]["speed"] == 2
    pause 1.3
    assert eval 0.4 < vn_ui_get("target", "x") < 0.6
    assert eval vn_ui_get("trace", "text") == "等待操作"
    pause 1.0
    assert eval vn_ui_get("trace", "text") == "等待操作"
    assert eval vn_ui_animations[("target", "x")]["elapsed"] > 2
    screenshot "second-loop.png"
    pause until eval vn_ui_get("trace", "text") == "往返完成"
    assert eval vn_ui_get("target", "x") == 0.1 and not vn_ui_animations
    click id "vn_component_infinite"
    pause 2.5
    assert eval vn_ui_get("trace", "text") == "往返完成"
    assert eval vn_ui_animations[("target", "x")]["duration"] is None
    click id "vn_component_stop"
    $ qa_x = vn_ui_get("target", "x")
    pause 0.2
    assert eval vn_ui_get("target", "x") == qa_x
    assert eval vn_ui_get("trace", "text") == "无限等待已结束" and not vn_ui_animations
    click id "vn_component_infinite"
    pause 0.2
    click id "vn_component_finish"
    assert eval vn_ui_get("target", "x") == 0.1 and vn_ui_get("target", "opacity") == 1
    assert eval qa_invalid_playback()
    click id "vn_component_start"
    pause until "在往返回程中保存，读取后继续回程。"
    pause 2.5
    $ qa_saved_x = vn_ui_get("saved_target", "x")
    assert eval 0.6 < qa_saved_x < 0.85
    $ qa_saved_token = vn_ui_animations[("saved_target", "x")]["token"]
    $ qa_saved_elapsed = vn_ui_animations[("saved_target", "x")]["elapsed"]
    run FileSave("qa_playback", confirm=False, slot=True)
    assert eval renpy.can_load("qa_playback")
    pause 0.7
    run FileLoad("qa_playback", confirm=False, slot=True)
    assert eval abs(vn_ui_get("saved_target", "x") - qa_saved_x) < 0.03
    assert eval vn_ui_animations[("saved_target", "x")]["token"] == qa_saved_token
    assert eval abs(vn_ui_animations[("saved_target", "x")]["elapsed"] - qa_saved_elapsed) < 0.03
    assert eval vn_ui_animations[("saved_target", "x")]["mode"] == "pingpong" and vn_ui_animations[("saved_target", "x")]["loops"] == 0
    pause 0.2
    assert eval qa_saved_x - 0.2 < vn_ui_get("saved_target", "x") < qa_saved_x - 0.04
    pause 2.0
    assert eval vn_ui_animation_active(qa_saved_token)
    $ vn_ui_stop_playback("${savedClip.id}", True)
    assert eval vn_ui_get("saved_target", "x") == 0.1 and not vn_ui_animations
    screenshot "loaded-finished.png"
`);
const result=await runRenpy(sdk,game,['test','--report-detailed'],{savedir:path.join(output,'saves'),timeoutMs:90000,env:{SDL_VIDEO_WINDOW_POS:'2400,0'}});await fs.writeFile(path.join(output,'runtime.log'),result.log);
const passed=result.code===0&&/Test cases\s*:\s*1\s*\|\s*1 passed/.test(result.log);await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:passed?'passed':'failed',checks:['真实悬停/移出连续换向与返回初始帧','变量连线控制往返两次与两倍速，等待全部循环','无限倒放跨循环继续等待、冻结停止及方向终点','非法动态参数在修改前被拒绝','真实存读档保留无限往返回程、倍率和播放标识']},null,2));console.log(output);assert.ok(passed,result.log.slice(-5000));
