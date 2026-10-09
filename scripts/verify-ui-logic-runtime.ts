import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject } from '../src/core/model';
import { createUiParameterBinding } from '../src/core/ui-logic';
import { buildProject, runRenpy } from '../src/runtime/service';
import { variableReference } from '../src/runtime/expressions';
const root=path.resolve('.'),sdk=path.join(root,'resources/runtime'),output=path.join(root,'artifacts/ui-logic-runtime',new Date().toISOString().replaceAll(':','-')),build=path.join(output,'game');
const project=createProject('高级界面参数联动');
project.variables.push({id:'ui_visible',name:'显示',type:'boolean',initial:true,persistent:false},{id:'ui_text',name:'文字',type:'string',initial:'初始文字',persistent:false});
project.ui.components.push({id:'main_probe',kind:'text',page:'main',text:'主菜单联动',x:.1,y:.1,width:.6,height:.1});
project.ui.customPages.push({id:'dynamic_page',name:'动态界面',components:[{id:'custom_probe',kind:'text',page:'custom',text:'占位',x:.1,y:.3,width:.6,height:.1}],modal:false});
createUiParameterBinding(project,'main_probe','visible','ui_visible','ui:main');createUiParameterBinding(project,'custom_probe','text','ui_text','dynamic_page');
await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'project.vns.json'),JSON.stringify(project));
const result=await buildProject({project,sdkRoot:sdk,outputDir:build,development:true});if(!result.ok)throw Error(result.log);
await fs.writeFile(path.join(build,'game/testcases.rpy'),`testsuite global:
    before testcase:
        $ _test.timeout = 12.0
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit

testcase ui_parameter_changes:
    pause until eval vn_ui_get("main_probe", "visible") is True
    $ ${variableReference(project,'ui_visible')} = False
    pause until eval vn_ui_get("main_probe", "visible") is False
    $ ${variableReference(project,'ui_visible')} = True
    pause until eval vn_ui_get("main_probe", "visible") is True
    screenshot "visible-title.png"
    click id "vn_main_start"
    pause 0.2
    $ ${variableReference(project,'ui_visible')} = False
    pause 0.2
    assert eval vn_ui_get("main_probe", "visible") is True
    run Show("vn_custom_page_dynamic_page")
    pause until eval vn_ui_get("custom_probe", "text") == "初始文字"
    $ ${variableReference(project,'ui_text')} = "参数已变化"
    pause until eval vn_ui_get("custom_probe", "text") == "参数已变化"
    screenshot "dynamic-text.png"
    run Hide("vn_custom_page_dynamic_page")
    $ ${variableReference(project,'ui_text')} = "关闭后不更新"
    pause 0.2
    assert eval vn_ui_get("custom_probe", "text") == "参数已变化"
`);
const run=await runRenpy(sdk,build,['test','--report-detailed'],{savedir:path.join(output,'saves'),timeoutMs:90000,env:{SDL_VIDEO_WINDOW_POS:'2400,0'}});await fs.writeFile(path.join(output,'runtime.log'),run.log);
const passed=run.code===0&&/Test cases\s*:\s*1\s*\|\s*1 passed/.test(run.log);await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:passed?'passed':'failed',checks:['普通页面开关参数驱动显示','离开普通页面停止更新','自定义页面文字参数变化','关闭自定义页面停止更新']}));console.log(output);if(!passed)throw Error(run.log.slice(-4000));
