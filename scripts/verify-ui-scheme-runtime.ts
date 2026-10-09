import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject } from '../src/core/model';
import { createUiParameterBinding } from '../src/core/ui-logic';
import { buildProject, runRenpy } from '../src/runtime/service';
import { variableReference } from '../src/runtime/expressions';
const root=path.resolve('.'),sdk=path.join(root,'resources/runtime'),output=path.join(root,'artifacts/ui-scheme-runtime',new Date().toISOString().replaceAll(':','-'));
const project=createProject('界面方案联动');
project.variables.push({id:'visible',name:'显示标题',type:'boolean',initial:true,persistent:false});
const component=(id:string)=>({id,kind:'text' as const,page:'main' as const,text:id,x:.1,y:.1,width:.6,height:.1});
project.ui.instances=[{id:'scheme_a',name:'方案A',components:[component('title_a')]},{id:'scheme_b',name:'方案B',components:[component('title_b')]},{id:'derived',name:'继承A',baseUiId:'scheme_a',components:[]}];
project.ui.activeInstanceId='scheme_a';createUiParameterBinding(project,'title_a','visible','visible','ui:main');
project.ui.activeInstanceId='scheme_b';createUiParameterBinding(project,'title_b','visible','visible','ui:main');
await fs.mkdir(output,{recursive:true});const reports=[];
for(const [instance,active,inactive] of [['scheme_a','title_a','title_b'],['scheme_b','title_b','title_a'],['derived','title_a','title_b']]) {
 project.ui.activeInstanceId=instance;const build=path.join(output,instance);
 const result=await buildProject({project,sdkRoot:sdk,outputDir:build,development:true});if(!result.ok)throw Error(result.log);
 await fs.writeFile(path.join(build,'game/testcases.rpy'),`testsuite global:
    before testcase:
        $ _test.timeout = 12.0
    teardown:
        exit

testcase scope_and_inheritance:
    pause until eval "${active}" in vn_ui_overrides
    assert eval "${inactive}" not in vn_ui_overrides
    assert eval renpy.get_widget("main_menu", "vn_component_${active}") is not None
    assert eval renpy.get_widget("main_menu", "vn_component_${inactive}") is None
    $ ${variableReference(project,'visible')} = False
    pause until eval vn_ui_get("${active}", "visible") is False
    assert eval "${inactive}" not in vn_ui_overrides
    $ ${variableReference(project,'visible')} = True
    pause until eval vn_ui_get("${active}", "visible") is True
    click id "vn_main_start"
    $ ${variableReference(project,'visible')} = False
    pause 0.2
    assert eval vn_ui_get("${active}", "visible") is True
`);
 const run=await runRenpy(sdk,build,['test','--report-detailed'],{savedir:path.join(output,'saves-'+instance),timeoutMs:60000,env:{SDL_VIDEO_WINDOW_POS:'2400,0'}});await fs.writeFile(path.join(output,instance+'.log'),run.log);
 const passed=run.code===0&&/Test cases\s*:\s*1\s*\|\s*1 passed/.test(run.log);reports.push({instance,passed});if(!passed)throw Error(run.log.slice(-4000));
}
await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',reports,checks:['两套方案仅挂载自身联动','参数变化不写入未激活方案','继承方案继续使用基础方案联动','离开页面停止更新']}));console.log(output);
