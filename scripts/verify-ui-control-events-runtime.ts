import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { controlEventFixture } from './lib/ui-control-event-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { isolateRenpySaves } from './lib/renpy-saves';
import { buildProject, runRenpy } from '../src/runtime/service';
import { createUiEventGraph, ensureUiValueChangedEvent } from '../src/core/ui-logic';
import { blueprintNodeDefaults, connectBlueprintPins, synchronizeBlueprintSignatures } from '../src/core/blueprint';
const root = path.resolve('.'), output = path.join(root, 'artifacts/ui-control-events-runtime', new Date().toISOString().replaceAll(':', '-'));
const game = path.join(output, 'game'), sdk = path.join(root, 'resources/runtime');
const previousSaveRoot = process.env.RENPY_PATH_TO_SAVES;
const report: { status: string; checks: { name: string; code: number; logPath: string }[]; coverage: string[]; cases?: number; assertions?: number; error?: string; cleanup?: unknown } = {
  status: 'running', checks: [], coverage: ["真实滑块鼠标、连续拖动和键盘改变；布尔切换、文字选项及文本输入", "新旧值数据引脚驱动事件图", "同值、初始化及程序写入不触发", "玩家音量及选项控件", "禁用与重新启用", "拖动中打开弹窗取消抓取，关闭后状态清理", "叠加模态页面中的控件可操作，同参数控件独立身份"],
};
await fs.mkdir(output, { recursive: true });
const save = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
async function check(name: string, result: { code: number; log: string }) {
  const logPath = path.join(output, name + '.log'); await fs.writeFile(logPath, result.log);
  report.checks.push({ name, code: result.code, logPath }); await save();
  if (result.code) throw new Error(name + ': ' + result.log.slice(-9000));
}
try {
  await isolateRenpySaves(output);
  const {project,node,link,entries,endings}=controlEventFixture();
  project.ui.customPages.push({id:'value_modal',name:'值改变弹窗',modal:true,components:[{id:'value_modal_close',kind:'button',page:'custom',text:'关闭弹窗',action:'return',x:.3,y:.4,width:.4,height:.1}]});
  const compare=node('compare',{operator:'gte',b:90}),branch=node('branch'),open=node('showUiPage',{pageId:'value_modal',wait:false});link(entries.get('level_control')!,'value',compare,'a');link(compare,'result',branch,'condition');link(endings.get('level_control')!,'exec_out',branch,'exec_in');link(branch,'true',open,'exec_in');
  project.ui.customPages.push({id:'nested_controls',name:'上层设置弹窗',modal:true,components:[{id:'nested_toggle',kind:'preference',page:'custom',text:'弹窗选项',parameterId:'toggle',x:.2,y:.2,width:.5,height:.2}]});
  const nestedGraph=createUiEventGraph(project,'nested_controls','弹窗设置事件'),nestedEvent=ensureUiValueChangedEvent(project,nestedGraph,'nested_toggle','nested_controls');
  for(const [pin,variable] of [['value','toggle_control_value'],['previous','toggle_control_previous']]){const setter=blueprintNodeDefaults('setVariable');Object.assign(setter.properties,{variableId:variable,value:false});const last=nestedGraph.nodes.at(-1)!;nestedGraph.nodes.push(setter);assert.equal(connectBlueprintPins(nestedGraph,last.id,last===nestedEvent?'exec':'exec_out',setter.id,'exec_in'),undefined);assert.equal(connectBlueprintPins(nestedGraph,nestedEvent.id,pin,setter.id,'value'),undefined);}
  synchronizeBlueprintSignatures(project);
  await fs.writeFile(path.join(output,'project.vns.json'),JSON.stringify(project));
  const built=await buildProject({project,outputDir:game,sdkRoot:sdk,development:true});
  await check('compile', { code: built.ok ? 0 : 1, log: built.log + JSON.stringify(built.diagnostics) });
  const tests = `testsuite global:
    before testcase:
        $ _test.timeout = 15.0
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit

testcase control_events:
    run ShowMenu("preferences")
    pause until screen "preferences"
    assert eval vn_parameter_get("level_control_count") == 0
    assert eval vn_parameter_get("volume_control_count") == 0
    click id "vn_component_level_control_control" pos (0.7, 0.5)
    pause 0.1
    assert eval vn_parameter_get("level") > 60
    assert eval vn_parameter_get("level_control_value") == vn_parameter_get("level")
    assert eval vn_parameter_get("level_control_previous") == 10
    assert eval vn_parameter_get("level_control_count") == 1
    assert eval renpy.display.focus.get_grab() is None
    keysym "K_RETURN" id "vn_component_level_control_control" pos (0.7, 0.5)
    $ before_count = vn_parameter_get("level_control_count")
    keysym "K_RIGHT" id "vn_component_level_control_control" pos (0.7, 0.5)
    $ print("CONTROL_KEY", before_count, vn_parameter_get("level_control_count"), vn_parameter_get("level"), renpy.display.focus.get_grab())
    assert eval vn_parameter_get("level_control_count") == before_count + 1
    keysym "K_RETURN" id "vn_component_level_control_control" pos (0.7, 0.5)
    click id "vn_component_toggle_control_toggle"
    assert eval vn_parameter_get("toggle_control_value") is True
    assert eval vn_parameter_get("toggle_control_previous") is False
    click id "vn_component_mode_control_option_1"
    assert eval vn_parameter_get("mode_control_value") == "困难"
    assert eval vn_parameter_get("mode_control_previous") == "普通"
    click id "vn_component_mode_control_option_1"
    assert eval vn_parameter_get("mode_control_count") == 1
    click id "vn_component_name_control_edit"
    type "AB" id "vn_component_name_control"
    assert eval vn_parameter_get("name_control_value").endswith("AB")
    assert eval vn_parameter_get("name_control_previous").endswith("A")
    click id "vn_component_volume_control_control" pos (0.4, 0.5)
    assert eval 0.3 < vn_preference_get("musicVolume") < 0.5
    assert eval abs(vn_parameter_get("volume_control_value") - vn_preference_get("musicVolume")) < 0.001
    assert eval vn_parameter_get("volume_control_previous") == 1.0
    click id "vn_component_voice_control_choice"
    click id "vn_preference_option_0"
    assert eval vn_preference_get("voiceSustain") is True
    assert eval vn_parameter_get("voice_control_value") is True
    assert eval vn_parameter_get("voice_control_previous") is False
    $ before_count = vn_parameter_get("level_control_count")
    $ vn_parameter_set("level", 20)
    pause 0.1
    assert eval vn_parameter_get("level_control_count") == before_count
    $ vn_ui_set("level_control", "enabled", False)
    click id "vn_component_level_control_control" pos (0.9, 0.5)
    assert eval vn_parameter_get("level") == 20
    assert eval vn_parameter_get("level_control_count") == before_count
    $ vn_ui_set("level_control", "enabled", True)
    click id "vn_component_level_control_control" pos (0.5, 0.5)
    assert eval vn_parameter_get("level_control_count") == before_count + 1
    move id "vn_component_level_control_control" pos (0.2, 0.5)
    $ renpy.test.testmouse.press_mouse(1)
    pause 0.05
    $ before_drag_count = vn_parameter_get("level_control_count")
    move id "vn_component_level_control_control" pos (0.4, 0.5)
    pause 0.05
    move id "vn_component_level_control_control" pos (0.6, 0.5)
    pause 0.05
    assert eval vn_parameter_get("level_control_count") >= before_drag_count + 2
    move id "vn_component_level_control_control" pos (0.96, 0.5)
    pause 0.1
    assert eval "value_modal" in vn_ui_open_pages
    assert eval renpy.display.focus.get_grab() is None
    $ renpy.test.testmouse.release_mouse(1)
    click id "vn_component_value_modal_close"
    assert eval "value_modal" not in vn_ui_open_pages
    screenshot "controls.png"
    run Function(vn_ui_open_page, "value_modal")
    run Function(vn_ui_open_page, "nested_controls")
    click id "vn_component_nested_toggle_toggle"
    assert eval vn_parameter_get("toggle") is False
    assert eval vn_parameter_get("toggle_control_value") is False
    assert eval vn_parameter_get("toggle_control_previous") is True
    run Function(vn_ui_close_page, "nested_controls")
    click id "vn_component_value_modal_close"
    assert eval not vn_ui_open_pages
`;
  await fs.writeFile(path.join(output, 'testcases.rpy'), tests);
  await fs.writeFile(path.join(game, 'game/testcases.rpy'), tests);
  const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 90000, env: { SDL_VIDEO_WINDOW_POS: '2400,0' } });
  await check('runtime', result); report.cases = (tests.match(/^testcase /gm) ?? []).length;
  assert.match(result.log, new RegExp('Test cases\\s*:\\s*' + report.cases + '\\s*\\|\\s*' + report.cases + ' passed'));
  report.assertions = Number(result.log.match(/Assertions\s*:\s*(\d+)/)?.[1]);
  assert.equal(report.assertions, (tests.match(/^    assert /gm) ?? []).length);
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error); process.exitCode = 1; }
finally {
  try {
    for (const directory of [path.join(game, 'tests/screenshots'), path.join(game, 'game/tests/screenshots')]) {
      if (await fs.stat(directory).then(stat => stat.isDirectory()).catch(() => false)) await fs.cp(directory, path.join(output, 'screenshots'), { recursive: true });
    }
  } catch (error) { report.status = 'failed'; report.error = [report.error, 'Screenshot preservation failed: ' + String(error)].filter(Boolean).join('\n'); process.exitCode = 1; }
  // Only this run's explicit children are disposable; keep its source fixture,
  // generated testcase, logs and screenshots as acceptance evidence.
  try {
    report.cleanup = await cleanVerificationDirectories(output, ['game', 'saves', 'renpy-saves']);
    if ((report.cleanup as { errors: unknown[] }).errors.length) throw new Error('Verification cleanup failed.');
  } catch (error) { report.status = 'failed'; report.error = [report.error, String(error)].filter(Boolean).join('\n'); process.exitCode = 1; }
  if (previousSaveRoot === undefined) delete process.env.RENPY_PATH_TO_SAVES; else process.env.RENPY_PATH_TO_SAVES = previousSaveRoot;
  await save(); console.log(path.join(output, 'report.json')); if (report.error) console.error(report.error);
}
