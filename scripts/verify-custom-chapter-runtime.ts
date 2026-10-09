import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { projectSchema } from '../src/core/model';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { buildProject, runRenpy } from '../src/runtime/service';
const root=path.resolve('.'),projectDir=path.resolve(process.argv[2]),output=path.join(projectDir,'native',new Date().toISOString().replaceAll(':','-')),sdk=path.join(root,'resources/runtime'),game=path.join(output,'game');
await fs.mkdir(output,{recursive:true});
const project=projectSchema.parse(JSON.parse(await fs.readFile(path.join(projectDir,'project.vns.json'),'utf8')));
const graph=project.blueprints.find(g=>g.name==='标题演出')!;assert.ok(graph);
const action={kind:'blueprint' as const,blueprintId:graph.id};
const visual=expandPreviewActions(project,[action],previewActionContext(project)).find(a=>a.kind==='visual');assert.ok(visual?.kind==='visual');
const passage=project.nodes.find(n=>n.kind==='passage')!;passage.lines=[{id:'verify_custom_title',text:'生成标题验收',actions:[action]}];project.entryId=passage.id;
const built=await buildProject({project,projectDir,outputDir:game,sdkRoot:sdk});assert.ok(built.ok,built.log);
await fs.writeFile(path.join(game,'game/testcases.rpy'),`
init -999 python:
    import renpy as _engine
    _engine.safe_mode_checked = True
testsuite global:
    before testcase:
        $ _test.timeout = 15.0
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit
testcase custom_title:
    click id "vn_main_start"
    pause .8
    assert eval renpy.showing("vn_visual_${visual!.instanceId}")
    screenshot "title-and-subtitle.png"
    pause 2.2
    screenshot "title-and-subtitle-particles.png"
    pause until "生成标题验收"
`);
const result=await runRenpy(sdk,game,['test','--report-detailed'],{savedir:path.join(output,'saves'),timeoutMs:60000,env:{RENPY_RENDERER:'gl2'}});await fs.writeFile(path.join(output,'runtime.log'),result.log);assert.equal(result.code,0,result.log);await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',instanceId:visual!.instanceId},null,2));console.log(output);
