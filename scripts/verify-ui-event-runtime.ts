import { promises as fs } from 'node:fs';
import path from 'node:path';
import { projectSchema } from '../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { buildProject, runRenpy } from '../src/runtime/service';
const root=path.resolve('.'),source=process.env.VNS_UI_EVENT_PROJECT;if(!source)throw Error('Set VNS_UI_EVENT_PROJECT to the desktop-authored fixture.');
const project=projectSchema.parse(JSON.parse(await fs.readFile(source,'utf8'))),graph=project.blueprints.find(g=>g.uiPageId==='ui:main')!;
// Also exercise the new page-show entry in the native engine.
const initial=blueprintNodeDefaults('setUiProperty');initial.properties={componentId:'target',property:'text',value:'页面事件已执行'};graph.nodes.push(initial);synchronizeBlueprintSignatures(project);connectBlueprintPins(graph,graph.nodes[0].id,'exec',initial.id,'exec_in');
const output=path.join(root,'artifacts/ui-event-runtime',new Date().toISOString().replaceAll(':','-')),build=path.join(output,'game'),sdk=path.join(root,'resources/runtime');await fs.mkdir(output,{recursive:true});
const result=await buildProject({project,sdkRoot:sdk,outputDir:build,development:true});if(!result.ok)throw Error(result.log);
await fs.writeFile(path.join(build,'game/testcases.rpy'),`testsuite global:
    before testcase:
        $ _test.timeout = 12.0
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit

testcase widget_events:
    pause until eval vn_ui_get("target", "text") == "页面事件已执行"
    assert eval vn_ui_get("target", "visible") is True
    click id "vn_component_trigger"
    pause until eval vn_ui_get("target", "visible") is False
    assert eval vn_ui_get("target", "text") == "页面事件已执行"
    screenshot "clicked-hidden.png"
`);
const run=await runRenpy(sdk,build,['test','--report-detailed'],{savedir:path.join(output,'saves'),timeoutMs:90000,env:{SDL_VIDEO_WINDOW_POS:'2400,0'}});await fs.writeFile(path.join(output,'runtime.log'),run.log);
const passed=run.code===0&&/Test cases\s*:\s*1\s*\|\s*1 passed/.test(run.log);await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:passed?'passed':'failed',source,checks:['桌面手动创建并保存的点击图运行','页面显示入口自动执行','原生按钮点击隐藏目标文字']}));console.log(output);if(!passed)throw Error(run.log.slice(-4000));
