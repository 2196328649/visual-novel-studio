import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { projectSchema } from '../src/core/model';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { buildProject, runRenpy } from '../src/runtime/service';
const root=path.resolve('.'),source=path.resolve(process.argv[2]),output=path.join(root,'artifacts/move-runtime',new Date().toISOString().replaceAll(':','-')),game=path.join(output,'game'),sdk=path.join(root,'resources/runtime');await fs.mkdir(output,{recursive:true});
const project=projectSchema.parse(JSON.parse(await fs.readFile(path.join(source,'project.vns.json'),'utf8'))),passage=project.nodes.find(n=>n.kind==='passage')!,actor=project.characters[0],show={kind:'show' as const,characterId:actor.id,expressionId:actor.expressions[0].id,x:.2,y:1,scale:.6,layer:10,transition:'move' as const,duration:2,wait:true};
const graph=blueprintFromPerformance(project,[{...show,x:.7,y:.9,scale:.5}],'移动显示');project.blueprints.push(graph);passage.lines=[{id:'first',text:'直接移动完成',actions:[show]},{id:'second',text:'蓝图移动完成',actions:[{kind:'blueprint',blueprintId:graph.id}]}];project.entryId=passage.id;
const built=await buildProject({project,projectDir:source,outputDir:game,sdkRoot:sdk});assert.ok(built.ok,built.log);
await fs.writeFile(path.join(game,'game/testcases.rpy'),`
init -999 python:
    import renpy as _engine
    _engine.safe_mode_checked = True
init python:
    import math as qa_math
    def qa_move():
        for event in ("show", "replace"):
            for t in (0.0, .1, .5, 1.0, 1.5, 2.0):
                transform = vn_move_stage(.7, .9, .5, 2.0)
                transform.state.xpos = .1
                transform.state.ypos = .8
                transform.state.zoom = .6
                transform.state.alpha = .4
                transform.set_transform_event(event)
                transform.execute(transform, 0.0, 0.0)
                transform.execute(transform, t, t)
                factor = qa_math.sin(min(1.0, t / 2.0) * qa_math.pi / 2.0)
                start = (.55, .9, .5, 0.0) if event == "show" else (.1, .8, .6, .4)
                for field, initial, target in zip(("xpos", "ypos", "zoom", "alpha"), start, (.7, .9, .5, 1.0)):
                    actual = getattr(transform.state, field)
                    if hasattr(actual, "relative"):
                        actual = actual.relative + actual.absolute / float(config.screen_width if field == "xpos" else config.screen_height)
                    elif field in ("xpos", "ypos") and isinstance(actual, int):
                        actual /= float(config.screen_width if field == "xpos" else config.screen_height)
                    assert abs(actual - (initial + (target - initial) * factor)) < .000001, (event,t,field,actual)

testsuite global:
    before testcase:
        $ _test.timeout = 30.0
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit
testcase move:
    run Function(qa_move)
    click id "vn_main_start"
    pause until "直接移动完成"
    pause .1
    assert eval renpy.showing("vn_actor_${actor.id}")
    screenshot "direct.png"
    advance until "蓝图移动完成"
    pause .1
    assert eval renpy.showing("vn_actor_${actor.id}")
    screenshot "blueprint.png"
`);
const result=await runRenpy(sdk,game,['test','--report-detailed'],{savedir:path.join(output,'saves'),timeoutMs:60000,env:{RENPY_RENDERER:'gl2'}});await fs.writeFile(path.join(output,'runtime.log'),result.log);assert.equal(result.code,0,result.log);await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed'},null,2));console.log(output);
