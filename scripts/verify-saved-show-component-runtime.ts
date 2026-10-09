import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { projectSchema } from '../src/core/model';
import { compileProject } from '../src/runtime/compiler';
import { buildProject, runRenpy } from '../src/runtime/service';
import { pythonLiteral } from '../src/runtime/literals';
import { initialPreviewStage, linePreviewSnapshot, linePlaybackPlan, sampleLinePlayback } from '../src/core/line-preview';
const root=path.resolve('.'),projectDir=path.resolve(process.argv[2]),output=path.join(projectDir,'native',new Date().toISOString().replaceAll(':','-')),sdk=path.join(root,'resources/runtime'),game=path.join(output,'game');await fs.mkdir(output,{recursive:true});
const project=projectSchema.parse(JSON.parse(await fs.readFile(path.join(projectDir,'project.vns.json'),'utf8'))),passage=project.nodes.find(n=>n.kind==='passage')!;project.entryId=passage.id;
const line=passage.lines[0],snapshot=linePreviewSnapshot(project,{nodeId:passage.id,lineId:line.id}),plan=linePlaybackPlan(snapshot.before,snapshot.actions),actor=project.characters[0].id;
const samples=[0,.25,.5,1,1.5,2].map(time=>({time,pose:sampleLinePlayback(snapshot.before,plan,time*1000).state.actors.get(actor)}));
assert.ok(project.blueprints[0].timelineComponent);assert.ok(project.blueprints[0].nodes.some(n=>n.type==='savedAction'));assert.equal(plan.dialogueAt,2000);
const show=snapshot.actions.find(action=>action.kind==='show')!;assert.ok(show?.kind==='show'&&show.moveOffsets);
const seeded=initialPreviewStage();seeded.actors.set(actor,{...show,x:.1,y:.8,scale:.7,rotation:0,opacity:.4});
const replacePlan=linePlaybackPlan(seeded,[show]);
const replacementSamples=[0,.25,.5,1,1.5,2].map(time=>({time,pose:sampleLinePlayback(seeded,replacePlan,time*1000).state.actors.get(actor)}));
const built=await buildProject({project,projectDir,outputDir:game,sdkRoot:sdk});assert.ok(built.ok,built.log);
const storyFile=path.join(game,'game/story.rpy');let story=await fs.readFile(storyFile,'utf8');story=story.replace('    call vn_blueprint_'+project.blueprints[0].id, '    $ qa_entrance_start = qa_time.monotonic()\n    call vn_blueprint_'+project.blueprints[0].id);await fs.writeFile(storyFile,story);
await fs.writeFile(path.join(game,'game/testcases.rpy'),`
default qa_entrance_start = None
default qa_live_actor = None
init -999 python:
    import renpy as _engine
    _engine.safe_mode_checked = True
init python:
    import time as qa_time
    def qa_x(value):
        if hasattr(value, "relative"):
            return value.relative + value.absolute / float(config.screen_width)
        return value / float(config.screen_width) if isinstance(value, int) else value
    def qa_entrance():
        for row in ${pythonLiteral(samples)}:
            transform = Transform()
            motion = VNMoveOffsetMotion(${show.x}, ${show.y}, ${show.scale}, ${show.duration ?? .5}, ${pythonLiteral(show.moveOffsets)}, False)
            motion(transform, 0.0, 0.0)
            motion(transform, row["time"], row["time"])
            actual = transform.state.xpos
            if hasattr(actual, "relative"):
                actual = actual.relative + actual.absolute / float(config.screen_width)
            assert abs(actual - row["pose"]["x"]) < .000001
            actual_y = transform.state.ypos
            if hasattr(actual_y, "relative"):
                actual_y = actual_y.relative + actual_y.absolute / float(config.screen_height)
            elif isinstance(actual_y, int):
                actual_y = actual_y / float(config.screen_height)
            assert abs(actual_y - row["pose"]["y"]) < .000001
            for prop, field in (("scale", "zoom"), ("rotation", "rotate"), ("opacity", "alpha")):
                assert abs(getattr(transform.state, field) - row["pose"][prop]) < .000001

        for row in ${pythonLiteral(replacementSamples)}:
            transform = Transform(xpos=.1, ypos=.8, zoom=.7, alpha=.4)
            motion = VNMoveOffsetMotion(${show.x}, ${show.y}, ${show.scale}, ${show.duration ?? .5}, ${pythonLiteral(show.moveOffsets)}, True)
            motion(transform, 0.0, 0.0)
            motion(transform, row["time"], row["time"])
            for prop, field in (("x", "xpos"), ("y", "ypos"), ("scale", "zoom"), ("rotation", "rotate"), ("opacity", "alpha")):
                assert abs(getattr(transform.state, field) - row["pose"][prop]) < .000001

testsuite global:
    before testcase:
        $ _test.timeout = 30.0
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit
testcase entrance:
    run Function(qa_entrance)
    click id "vn_main_start"
    pause until ${pythonLiteral(line.text)}
    run SetVariable("qa_live_actor", renpy.game.context().scene_lists.get_displayable_by_tag("master", "vn_actor_${actor}"))
    assert eval qa_live_actor is not None
    assert eval qa_time.monotonic() - qa_entrance_start >= 1.9
    assert eval abs(qa_x(qa_live_actor.state.xpos) - ${samples.at(-1)!.pose!.x}) < .001
    assert eval qa_live_actor.rotate_pad is False and qa_live_actor.transform_anchor is True
    screenshot "component-complete.png"
    advance
    pause until ${pythonLiteral(passage.lines[1].text)}
    assert eval renpy.game.context().scene_lists.get_displayable_by_tag("master", "vn_actor_${actor}") is qa_live_actor
    screenshot "next-line-persistent.png"
    pause until eval qa_time.monotonic() - qa_entrance_start >= 2.2
    assert eval abs(qa_x(qa_live_actor.state.xpos) - ${samples.at(-1)!.pose!.x}) < .001
    assert eval abs(qa_live_actor.state.alpha - 1.0) < .001
    screenshot "next-line-complete.png"
    run FileSave("qa_dynamic_move")
    run FileLoad("qa_dynamic_move", confirm=False)
    pause .1
    assert eval renpy.showing("vn_actor_${actor}")
    assert eval abs(qa_x(renpy.game.context().scene_lists.get_displayable_by_tag("master", "vn_actor_${actor}").state.xpos) - ${samples.at(-1)!.pose!.x}) < .001
`);
const result=await runRenpy(sdk,game,['test','--report-detailed'],{savedir:path.join(output,'saves'),timeoutMs:60000,env:{RENPY_RENDERER:'gl2'}});await fs.writeFile(path.join(output,'runtime.log'),result.log);assert.equal(result.code,0,result.log);await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',samples,dialogueAt:plan.dialogueAt},null,2));console.log(output);

