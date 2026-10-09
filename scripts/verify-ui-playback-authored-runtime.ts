import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { projectSchema } from '../src/core/model';
import { buildProject, runRenpy } from '../src/runtime/service';

const root=path.resolve('.'),source=process.env.VNS_UI_PLAYBACK_PROJECT;
if(!source)throw Error('Set VNS_UI_PLAYBACK_PROJECT to the desktop-authored project.');
const project=projectSchema.parse(JSON.parse(await fs.readFile(source,'utf8')));
const output=path.join(root,'artifacts/ui-playback-authored-runtime',new Date().toISOString().replaceAll(':','-')),game=path.join(output,'game'),sdk=path.join(root,'resources/runtime');
await fs.mkdir(output,{recursive:true});const built=await buildProject({project,projectDir:path.dirname(source),outputDir:game,sdkRoot:sdk,development:true});assert.ok(built.ok,built.log);
await fs.writeFile(path.join(game,'game/testcases.rpy'),`default qa_x = 0.0
testsuite global:
    before testcase:
        $ _test.timeout = 12.0
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit

testcase authored_playback:
    pause until eval renpy.get_screen("main_menu") is not None
    move pos (8, 8)
    move id "vn_component_hover"
    pause 0.5
    $ qa_x = vn_ui_get("target", "x")
    assert eval 0.22 < qa_x < 0.35
    move pos (8, 8)
    assert eval abs(vn_ui_get("target", "x") - qa_x) < 0.05
    pause 0.2
    assert eval vn_ui_get("target", "x") < qa_x - 0.03
    pause until eval not vn_ui_animations
    assert eval vn_ui_get("target", "x") == 0.1
    click id "vn_component_loops"
    assert eval vn_ui_animations[("target", "x")]["mode"] == "pingpong"
    assert eval vn_ui_animations[("target", "x")]["loops"] == 2 and vn_ui_animations[("target", "x")]["speed"] == 2
    pause 2.3
    assert eval vn_ui_get("trace", "text") == "等待操作"
    assert eval vn_ui_animations[("target", "x")]["elapsed"] > 2
    screenshot "second-cycle.png"
    pause until eval vn_ui_get("trace", "text") == "往返完成"
    assert eval vn_ui_get("target", "x") == 0.1 and vn_ui_get("target", "opacity") == 1
    click id "vn_component_loops"
    pause 0.3
    click id "vn_component_stop"
    $ qa_x = vn_ui_get("target", "x")
    pause 0.3
    assert eval vn_ui_get("target", "x") == qa_x and not vn_ui_animations
`);
const result=await runRenpy(sdk,game,['test','--report-detailed'],{savedir:path.join(output,'saves'),timeoutMs:90000,env:{SDL_VIDEO_WINDOW_POS:'2400,0'}});
await fs.writeFile(path.join(output,'runtime.log'),result.log);const passed=result.code===0&&/Test cases\s*:\s*1\s*\|\s*1 passed/.test(result.log);
await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:passed?'passed':'failed',source,checks:['桌面实际保存的换向/循环事件图直接编译运行','鼠标悬停移出连续换向','已保存数据连线传入两次循环和两倍速','等待两个往返后继续、停止冻结']},null,2));console.log(output);assert.ok(passed,result.log.slice(-4500));
