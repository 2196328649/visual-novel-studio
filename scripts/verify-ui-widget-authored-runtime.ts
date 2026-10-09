import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { projectSchema } from '../src/core/model';
import { buildProject, runRenpy } from '../src/runtime/service';

const root=path.resolve('.'),source=process.env.VNS_UI_ANIMATION_PROJECT;
if(!source)throw Error('Set VNS_UI_ANIMATION_PROJECT to the desktop-authored project.');
const project=projectSchema.parse(JSON.parse(await fs.readFile(source,'utf8')));
const output=path.join(root,'artifacts/ui-widget-authored-runtime',new Date().toISOString().replaceAll(':','-')),game=path.join(output,'game'),sdk=path.join(root,'resources/runtime');
await fs.mkdir(output,{recursive:true});const built=await buildProject({project,projectDir:path.dirname(source),outputDir:game,sdkRoot:sdk,development:true});assert.ok(built.ok,built.log);
await fs.writeFile(path.join(game,'game/testcases.rpy'),`testsuite global:
    before testcase:
        $ _test.timeout = 12.0
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit

testcase authored_widget_animation:
    pause until eval renpy.get_screen("main_menu") is not None
    assert eval vn_ui_get("target", "visible") is True
    click id "vn_component_play"
    pause 0.6
    assert eval 0.23 < vn_ui_get("target", "x") < 0.4
    assert eval 0.5 < vn_ui_get("target", "opacity") < 0.8
    assert eval vn_ui_get("target", "visible") is True
    screenshot "mid-animation.png"
    pause until eval vn_ui_get("target", "visible") is False
    assert eval vn_ui_get("target", "x") == 0.7
    assert eval vn_ui_get("target", "opacity") == 0
    assert eval not vn_ui_animations
    screenshot "completed.png"
`);
const result=await runRenpy(sdk,game,['test','--report-detailed'],{savedir:path.join(output,'saves'),timeoutMs:90000,env:{SDL_VIDEO_WINDOW_POS:'2400,0'}});
await fs.writeFile(path.join(output,'runtime.log'),result.log);const passed=result.code===0&&/Test cases\s*:\s*1\s*\|\s*1 passed/.test(result.log);
await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:passed?'passed':'failed',source,checks:['桌面保存的事件图实际编译运行','变量经数据线决定移动终点','同时淡出且中途仍显示','等待动画结束再隐藏控件']},null,2));console.log(output);assert.ok(passed,result.log.slice(-4500));
