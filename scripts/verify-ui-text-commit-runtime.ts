import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { textCommitFixture } from './lib/ui-text-commit-fixture';
import { buildProject, runRenpy } from '../src/runtime/service';
import { createUiEventGraph, ensureUiTextCommittedEvent } from '../src/core/ui-logic';
import { blueprintNodeDefaults, connectBlueprintPins, synchronizeBlueprintSignatures } from '../src/core/blueprint';
const root=path.resolve('.'),output=path.join(root,'artifacts/ui-text-commit-runtime',new Date().toISOString().replaceAll(':','-'));await fs.mkdir(output,{recursive:true});
const {project}=textCommitFixture();
project.variables.push(...['modal_text','modal_committed'].map(id=>({id,name:id,type:'string' as const,initial:'弹窗',persistent:false})));
project.ui.customPages[0].components.push({id:'modal_input',kind:'preference',page:'custom',text:'弹窗输入',parameterId:'modal_text',x:.2,y:.62,width:.6,height:.12});
const modalGraph=createUiEventGraph(project,'commit_modal','弹窗输入事件'),modalEvent=ensureUiTextCommittedEvent(project,modalGraph,'modal_input','commit_modal'),modalSet=blueprintNodeDefaults('setVariable');modalSet.properties={variableId:'modal_committed',value:''};modalGraph.nodes.push(modalSet);synchronizeBlueprintSignatures(project);assert.equal(connectBlueprintPins(modalGraph,modalEvent.id,'exec',modalSet.id,'exec_in'),undefined);assert.equal(connectBlueprintPins(modalGraph,modalEvent.id,'value',modalSet.id,'value'),undefined);
const passage=project.nodes.find(n=>n.kind==='passage')!;passage.lines=[{id:'input_save',text:'文字输入存读档验收。',actions:[]}];project.entryId=passage.id;
await fs.writeFile(path.join(output,'project.vns.json'),JSON.stringify(project));
const game=path.join(output,'game'),sdk=path.join(root,'resources/runtime');const built=await buildProject({project,outputDir:game,sdkRoot:sdk,development:true});assert.ok(built.ok,built.log);
await fs.writeFile(path.join(game,'game/testcases.rpy'),`testsuite global:
    before testcase:
        $ _test.timeout = 15.0
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit

testcase text_commit:
    run ShowMenu("preferences")
    pause until screen "preferences"
    assert eval vn_parameter_get("commit_count") == 0
    click id "vn_component_name_control_edit"
    type "AB" id "vn_component_name_control"
    assert eval vn_parameter_get("commit_count") == 0
    assert eval vn_parameter_get("name_control_count") == 2
    keysym "K_RETURN" id "vn_component_name_control"
    assert eval vn_parameter_get("committed") == "初始AB"
    assert eval vn_parameter_get("commit_method") == "enter"
    assert eval vn_parameter_get("commit_count") == 1
    assert eval not renpy.get_editable_input_value()[1] or renpy.get_editable_input_value()[0] is None
    click id "vn_component_toggle_control_toggle"
    assert eval vn_parameter_get("commit_count") == 1
    assert eval vn_parameter_get("toggle") is True
    click id "vn_component_name_control_edit"
    click id "vn_component_name_control_edit"
    assert eval vn_parameter_get("commit_count") == 1
    click id "vn_component_toggle_control_toggle"
    assert eval vn_parameter_get("commit_count") == 2
    assert eval vn_parameter_get("commit_method") == "focusLost"
    assert eval vn_parameter_get("toggle") is False
    click id "vn_component_name_control_edit"
    keysym "K_TAB" id "vn_component_name_control"
    assert eval vn_parameter_get("commit_count") == 3
    assert eval not renpy.get_editable_input_value()[1] or renpy.get_editable_input_value()[0] is None
    click id "vn_component_name_control_edit"
    click id "vn_component_other_name_edit"
    assert eval vn_parameter_get("commit_count") == 4
    type "C" id "vn_component_other_name"
    assert eval vn_parameter_get("name") == "初始ABC"
    assert eval vn_parameter_get("commit_count") == 4
    click id "vn_component_name_control_edit"
    $ vn_ui_set("name_control", "enabled", False)
    pause 0.1
    assert eval not renpy.get_editable_input_value()[1] or renpy.get_editable_input_value()[0] is None
    assert eval vn_parameter_get("commit_count") == 4
    $ vn_ui_set("name_control", "enabled", True)
    click id "vn_component_name_control_edit"
    $ vn_ui_set("name_control", "visible", False)
    pause 0.1
    assert eval vn_parameter_get("commit_count") == 4
    assert eval not renpy.get_editable_input_value()[1] or renpy.get_editable_input_value()[0] is None
    $ vn_ui_set("name_control", "visible", True)
    click id "vn_component_name_control_edit"
    run Function(vn_ui_open_page, "commit_modal")
    pause 0.1
    assert eval vn_parameter_get("commit_count") == 4
    assert eval not renpy.get_editable_input_value()[1] or renpy.get_editable_input_value()[0] is None
    click id "vn_component_modal_input_edit"
    type "X" id "vn_component_modal_input"
    keysym "K_RETURN" id "vn_component_modal_input"
    assert eval vn_parameter_get("modal_committed") == "弹窗X"
    assert eval vn_parameter_get("commit_count") == 4
    click id "vn_component_commit_close"
    assert eval "commit_modal" not in vn_ui_open_pages
    click id "vn_component_name_control_edit"
    run Show("confirm", message="临时确认", yes_action=Hide("confirm"), no_action=Hide("confirm"))
    pause 0.1
    assert eval not renpy.get_editable_input_value()[1] or renpy.get_editable_input_value()[0] is None
    assert eval vn_parameter_get("commit_count") == 4
    click "取消"
    assert not screen "confirm"
    click id "vn_component_name_control_edit"
    run ShowMenu("load")
    pause until screen "load"
    assert eval vn_parameter_get("commit_count") == 4
    run ShowMenu("preferences")
    pause until screen "preferences"
    $ vn_parameter_set("open_on_commit", True)
    click id "vn_component_name_control_edit"
    click id "vn_component_toggle_control_toggle"
    assert eval vn_parameter_get("commit_count") == 5
    assert eval "commit_modal" in vn_ui_open_pages
    assert eval vn_parameter_get("toggle") is False
    screenshot "commit-modal.png"
    click id "vn_component_commit_close"
    assert eval "commit_modal" not in vn_ui_open_pages
    click id "vn_component_name_control_edit"
    keysym "K_RETURN" id "vn_component_name_control"
    assert eval vn_parameter_get("commit_count") == 6
    assert eval "commit_modal" in vn_ui_open_pages
    click id "vn_component_commit_close"
    assert eval vn_parameter_get("commit_count") == 6
    screenshot "text-committed.png"
    run Start()
    pause until "文字输入存读档验收。"
    run ShowMenu("preferences")
    pause until screen "preferences"
    click id "vn_component_name_control_edit"
    run FileSave("qa_text_input", confirm=False, slot=True)
    assert eval renpy.can_load("qa_text_input")
    type "Z" id "vn_component_name_control"
    run FileLoad("qa_text_input", confirm=False, slot=True)
    pause until "文字输入存读档验收。"
    assert eval vn_parameter_get("commit_count") == 6
    assert eval vn_parameter_get("name") == "初始ABC"
    assert eval not renpy.get_editable_input_value()[1] or renpy.get_editable_input_value()[0] is None
`);
const result=await runRenpy(sdk,game,['test','--report-detailed'],{savedir:path.join(output,'saves'),timeoutMs:90000,env:{SDL_VIDEO_WINDOW_POS:'2400,0'}});await fs.writeFile(path.join(output,'runtime.log'),result.log);
const passed=result.code===0&&/Test cases\s*:\s*1\s*\|\s*1 passed/.test(result.log);await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:passed?'passed':'failed',checks:["弹窗自身输入框可提交，底层输入保持取消","编辑过程中存档并读取，恢复参数且不重发提交","Enter单次提交及结束编辑","值改变回调刷新不提交","同值提交、同框点击、外部点击、Tab及输入框切换","隐藏/禁用/模态覆盖/离页取消编辑","提交文字与方式通过真实数据线写变量","提交打开弹窗，无鼠标穿透"]},null,2));console.log(output);assert.ok(passed,result.log.slice(-5000));
