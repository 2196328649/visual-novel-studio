import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { buttonEventFixture } from './lib/ui-button-event-fixture';
import { buildProject, runRenpy } from '../src/runtime/service';
const root=path.resolve('.'),output=path.join(root,'artifacts/ui-button-events-runtime',new Date().toISOString().replaceAll(':','-'));await fs.mkdir(output,{recursive:true});
const {project}=buttonEventFixture();await fs.writeFile(path.join(output,'project.vns.json'),JSON.stringify(project));
const game=path.join(output,'game'),sdk=path.join(root,'resources/runtime');const built=await buildProject({project,outputDir:game,sdkRoot:sdk,development:true});assert.ok(built.ok,built.log);
await fs.writeFile(path.join(game,'game/testcases.rpy'),`testsuite global:
    before testcase:
        $ _test.timeout = 12.0
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit

testcase button_events:
    pause until eval renpy.get_screen("main_menu") is not None
    move pos (8, 8)
    $ vn_ui_set("trace", "text", "")
    move id "vn_component_target"
    pause 0.1
    $ print("BUTTON_TRACE", repr(vn_ui_get("trace", "text")))
    assert eval vn_ui_get("trace", "text") == "H"
    $ renpy.test.testmouse.press_mouse(1)
    pause 0.1
    $ print("BUTTON_TRACE", repr(vn_ui_get("trace", "text")))
    assert eval vn_ui_get("trace", "text") == "HP"
    screenshot "pressed.png"
    move pos (8, 8)
    pause 0.1
    $ print("BUTTON_TRACE", repr(vn_ui_get("trace", "text")))
    assert eval vn_ui_get("trace", "text") == "HPU"
    $ renpy.test.testmouse.release_mouse(1)
    pause 0.1
    $ print("BUTTON_TRACE", repr(vn_ui_get("trace", "text")))
    assert eval vn_ui_get("trace", "text") == "HPUR"
    $ vn_ui_set("trace", "text", "")
    click id "vn_component_target"
    pause 0.15
    $ print("BUTTON_TRACE", repr(vn_ui_get("trace", "text")))
    assert eval vn_ui_get("trace", "text") == "HPRC"
    pause 0.2
    $ print("BUTTON_TRACE", repr(vn_ui_get("trace", "text")))
    assert eval vn_ui_get("trace", "text") == "HPRC"
    move pos (8, 8)
    $ vn_ui_set("trace", "text", "")
    move id "vn_component_hide"
    $ renpy.test.testmouse.press_mouse(1)
    pause 0.1
    assert eval vn_ui_get("hide", "visible") is False
    $ print("BUTTON_TRACE", repr(vn_ui_get("trace", "text")))
    assert eval vn_ui_get("trace", "text") == "HP"
    $ renpy.test.testmouse.release_mouse(1)
    pause 0.1
    $ print("BUTTON_TRACE", repr(vn_ui_get("trace", "text")))
    assert eval vn_ui_get("trace", "text") == "HP"
    assert eval renpy.display.focus.get_grab() is None
    move pos (8, 8)
    $ vn_ui_set("trace", "text", "")
    move id "vn_component_disable"
    $ renpy.test.testmouse.press_mouse(1)
    pause 0.1
    assert eval vn_ui_get("disable", "enabled") is False
    $ renpy.test.testmouse.release_mouse(1)
    pause 0.1
    $ print("BUTTON_TRACE", repr(vn_ui_get("trace", "text")))
    assert eval vn_ui_get("trace", "text") == "HP"
    assert eval renpy.display.focus.get_grab() is None
    move pos (8, 8)
    $ vn_ui_set("trace", "text", "")
    move id "vn_component_target"
    $ renpy.test.testmouse.press_mouse(1)
    pause 0.1
    move pos (8, 8)
    move id "vn_component_target"
    $ renpy.test.testmouse.release_mouse(1)
    pause 0.1
    $ print("BUTTON_TRACE", repr(vn_ui_get("trace", "text")))
    assert eval vn_ui_get("trace", "text") == "HPUHRC"
    $ vn_ui_set("trace", "text", "")
    keysym "K_RETURN" id "vn_component_target"
    pause 0.1
    $ print("BUTTON_KEY_TRACE", repr(vn_ui_get("trace", "text")))
    assert eval vn_ui_get("trace", "text") == "PRC"
    $ vn_ui_set("trace", "text", "")
    keysym "K_SPACE" id "vn_component_target"
    pause 0.1
    $ print("BUTTON_KEY_TRACE", repr(vn_ui_get("trace", "text")))
    assert eval vn_ui_get("trace", "text") == "PRC"
    move pos (8, 8)
    $ vn_ui_set("trace", "text", "")
    move id "vn_component_modal"
    $ renpy.test.testmouse.press_mouse(1)
    pause 0.1
    assert eval vn_ui_get("trace", "text") == "HP"
    assert eval renpy.display.focus.get_grab() is None
    $ renpy.test.testmouse.release_mouse(1)
    assert eval vn_ui_open_pages.get("button_overlay") == "shown"
    assert eval renpy.get_screen("vn_blueprint_pages") is not None
    screenshot "modal.png"
    click id "vn_component_overlay_close"
    pause 0.1
    assert eval vn_ui_get("trace", "text") == "HP"
    assert eval "button_overlay" not in vn_ui_open_pages
    move id "vn_component_modal"
    $ vn_ui_set("trace", "text", "")
    keysym "K_RETURN" id "vn_component_modal"
    pause 0.1
    click id "vn_component_overlay_close"
    assert eval vn_ui_get("trace", "text") == "P"
    move pos (8, 8)
    $ vn_ui_set("trace", "text", "")
    click id "vn_component_release_modal"
    pause 0.1
    assert eval vn_ui_get("trace", "text") == "HPR"
    click id "vn_component_overlay_close"
    assert eval vn_ui_get("trace", "text") == "HPR"
    move pos (8, 8)
    $ vn_ui_set("trace", "text", "")
    click id "vn_component_restore"
    assert eval vn_ui_get("trace", "text") == "HP"
    assert eval vn_ui_get("restore", "enabled") is True
    assert eval renpy.display.focus.get_grab() is None
    move pos (8, 8)
    move id "vn_component_restore"
    pause 0.1
    $ vn_ui_set("trace", "text", "")
    keysym "K_SPACE" id "vn_component_restore"
    $ print("BUTTON_RESTORED_KEY_TRACE", repr(vn_ui_get("trace", "text")))
    assert eval vn_ui_get("trace", "text") == "P"
    move pos (8, 8)
    $ vn_ui_set("trace", "text", "")
    click id "vn_component_target"
    assert eval vn_ui_get("trace", "text") == "HPRC"
`);
const result=await runRenpy(sdk,game,['test','--report-detailed'],{savedir:path.join(output,'saves'),timeoutMs:90000,env:{SDL_VIDEO_WINDOW_POS:'2400,0'}});await fs.writeFile(path.join(output,'runtime.log'),result.log);
const passed=result.code===0&&/Test cases\s*:\s*1\s*\|\s*1 passed/.test(result.log);await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:passed?'passed':'failed',checks:['原生鼠标悬停、按住、移出与松开顺序','移出松开不点击，重新进入再松开可点击','普通点击及Enter/Space无重复事件','按下事件隐藏或禁用自身时取消后续松开/点击并释放抓取','主菜单按下及松开事件打开非等待模态页面，返回按钮真正关闭页面','键盘按下事件打开模态页面时取消后续松开和点击','同事件中禁用后重新启用不恢复已取消的按压，普通按钮仍可点击']},null,2));console.log(output);assert.ok(passed,result.log.slice(-4500));
