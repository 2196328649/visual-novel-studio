import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { uiNativePreferencesFixture } from './lib/ui-native-preferences-fixture';
import { buildProject, runRenpy } from '../src/runtime/service';

const root=path.resolve('.'),output=path.join(root,'artifacts/ui-native-preferences-runtime',new Date().toISOString().replaceAll(':','-'));await fs.mkdir(output,{recursive:true});
const project=uiNativePreferencesFixture(),game=path.join(output,'game'),sdk=path.join(root,'resources/runtime');await fs.writeFile(path.join(output,'project.vns.json'),JSON.stringify(project));
const built=await buildProject({project,outputDir:game,sdkRoot:sdk});assert.ok(built.ok,JSON.stringify(built.diagnostics));
await fs.writeFile(path.join(game,'game/testcases.rpy'),`
testsuite global:
    before testcase:
        $ _test.timeout = 20.0
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit
testcase standard_preference_state:
    click id "vn_component_open"
    assert screen "preferences"
    run Function(VnPreferenceValue("musicVolume").changed, 0.25)
    pause 0.2
    assert eval abs(vn_preference_get("musicVolume") - 0.25) < 0.000001
    assert eval abs(vn_ui_get("linked_volume", "value") - 0.25) < 0.000001
    run Function(VnPreferenceValue("textSpeed").changed, 200)
    assert eval vn_preference_get("textSpeed") == 0
    run Preference("skip", "all")
    assert eval vn_preference_get("skipAll") is True
    run Preference("transitions", "toggle")
    assert eval _preferences.transitions == 0
    run Preference("all mute", "toggle")
    assert eval _preferences.get_mute("music") is True
    run ShowMenu("voice_settings")
    click id "vn_character_volume_hero" pos (0.3, 0.5)
    assert eval 0.25 < vn_preference_get("characterVolume", "hero") < 0.35
    assert eval abs(vn_preference_get("characterVolume", "other") - 0.8) < 0.000001
    assert eval abs(vn_preference_get("characterVolume") - 0.8) < 0.000001
    screenshot "character-volumes.png"
    click id "vn_game_menu_return"
    assert screen "preferences"
    run Function(vn_parameter_set, "custom", 44)
    run Function(vn_parameter_set, "hidden", False)
    run Function(vn_parameter_set, "story", 8)
    run Confirm("恢复全部初始设置吗？", Function(vn_reset_preferences))
    click "取消"
    assert eval vn_parameter_get("custom") == 44
    run Confirm("恢复全部初始设置吗？", Function(vn_reset_preferences))
    click "确认"
    assert eval abs(vn_preference_get("musicVolume") - 0.7) < 0.000001
    assert eval abs(vn_preference_get("characterVolume", "hero") - 0.8) < 0.000001
    assert eval _preferences.get_mute("music") is False
    assert eval vn_parameter_get("custom") == 25 and vn_parameter_get("hidden") is True
    assert eval vn_parameter_get("story") == 8
    assert eval _preferences.transitions == 0
    screenshot "settings-restored.png"
`);
const result=await runRenpy(sdk,game,['test','--report-detailed'],{savedir:path.join(output,'saves'),timeoutMs:60000,env:{SDL_VIDEO_WINDOW_POS:'2400,0'}});await fs.writeFile(path.join(output,'runtime.log'),result.log);assert.ok(result.code===0&&/Test cases\s*:\s*1\s*\|\s*1 passed/.test(result.log),result.log.slice(-4000));
await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',assertions:18,projectFile:path.join(output,'project.vns.json'),checks:['标准设置页和蓝图读取共用设置值','原生滑块端点与跳过/静音动作','实际角色滑块点击保持其他角色隔离','原生确认取消/确认及设置默认值恢复','剧情参数和非作者设置的转场偏好保持']},null,2));console.log(output);
