import { blueprintNodeDefaults } from '../src/core/blueprint';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { projectSchema } from '../src/core/model';
import { buildProject, runRenpy } from '../src/runtime/service';
import { pythonLiteral } from '../src/runtime/literals';
import { initialPreviewStage, linePreviewSnapshot, linePlaybackPlan, sampleLinePlayback } from '../src/core/line-preview';
const root=path.resolve('.'),projectDir=path.resolve(process.argv[2]),output=path.join(projectDir,'native',new Date().toISOString().replaceAll(':','-')),sdk=path.join(root,'resources/runtime'),game=path.join(output,'game');await fs.mkdir(output,{recursive:true});
const project=projectSchema.parse(JSON.parse(await fs.readFile(path.join(projectDir,'project.vns.json'),'utf8'))),passage=project.nodes.find(n=>n.kind==='passage')!;project.entryId=passage.id;
const graph=project.blueprints[0],node=graph.nodes.find(n=>n.type==='showCharacter')!;
const sourcePinDefaults = new Map(node.pins.map(pin => [pin.id, pin.defaultValue]));
node.type='showCharacter';node.properties.characterId='';node.pins=blueprintNodeDefaults('showCharacter').pins.map(pin => sourcePinDefaults.has(pin.id) ? { ...pin, defaultValue: sourcePinDefaults.get(pin.id) } : pin);node.properties.expressionId='';
passage.lines.forEach(line=>line.speakerId=project.characters[0].id);
const input=(pin:string)=>graph.exposedInputs.find(i=>graph.links.some(l=>l.toPinId===pin&&graph.nodes.find(n=>n.id===l.fromNodeId)?.properties.inputId===i.id))!.id;
passage.lines.push({id:'override',speakerId:project.characters[0].id,text:'覆盖位置与时长',actions:[{kind:'blueprint',blueprintId:graph.id,inputs:{[input('x')]:.8,[input('duration')]:3}}]});
const line=passage.lines[0],snapshot=linePreviewSnapshot(project,{nodeId:passage.id,lineId:line.id}),plan=linePlaybackPlan(snapshot.before,snapshot.actions),actor=project.characters[0].id;
const samples=[0,.25,.5,1,1.5,2].map(time=>({time,pose:sampleLinePlayback(snapshot.before,plan,time*1000).state.actors.get(actor)}));
assert.equal(plan.dialogueAt,500);
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
            motion = vn_show_offsets(${show.x}, ${show.y}, ${show.scale}, ${show.duration ?? .5}, ${pythonLiteral(show.moveOffsets)}).function
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
            motion = vn_show_offsets(${show.x}, ${show.y}, ${show.scale}, ${show.duration ?? .5}, ${pythonLiteral(show.moveOffsets)}).function
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
    $ print("QA_TRANSITION_FIRST", renpy.get_ongoing_transition("master"), renpy.display.interface.transition_time)
    assert eval renpy.get_ongoing_transition("master") is not None
    $ renpy.session["qa_transition_start"] = renpy.display.interface.transition_time["master"]
    screenshot "during-transition.png"
    advance
    pause until ${pythonLiteral(passage.lines[1].text)}
    assert eval renpy.game.context().scene_lists.get_displayable_by_tag("master", "vn_actor_${actor}") is qa_live_actor
    $ print("QA_TRANSITION_NEXT", renpy.get_ongoing_transition("master"), renpy.display.interface.transition_time)
    assert eval renpy.get_ongoing_transition("master") is not None
    assert eval renpy.display.interface.transition_time["master"] == renpy.session["qa_transition_start"]
    screenshot "next-line-moving.png"
    pause until eval qa_time.monotonic() - qa_entrance_start >= 2.2
    assert eval abs(qa_x(qa_live_actor.state.xpos) - ${samples.at(-1)!.pose!.x}) < .001
    assert eval abs(qa_live_actor.state.alpha - 1.0) < .001
    assert eval renpy.get_ongoing_transition("master") is None
    screenshot "next-line-complete.png"
    run FileSave("qa_dynamic_move")
    run FileLoad("qa_dynamic_move", confirm=False)
    pause .1
    assert eval renpy.showing("vn_actor_${actor}")
    assert eval abs(qa_x(renpy.game.context().scene_lists.get_displayable_by_tag("master", "vn_actor_${actor}").state.xpos) - ${samples.at(-1)!.pose!.x}) < .001
    advance until "覆盖位置与时长"
    $ qa_live_actor = renpy.display.core.displayable_by_tag("master", "vn_actor_${actor}")
    assert eval qa_live_actor.function.target[0] == .8 and qa_live_actor.function.duration == 3.0
    assert eval qa_live_actor.function.initial == qa_live_actor.function.target
    pause until eval qa_live_actor.st >= 3.0
    assert eval abs(qa_x(qa_live_actor.state.xpos) - .8) < .001
    screenshot "override-complete.png"
`);
const result=await runRenpy(sdk,game,['test','--report-detailed'],{savedir:path.join(output,'saves'),timeoutMs:60000,env:{RENPY_RENDERER:'gl2'}});await fs.writeFile(path.join(output,'runtime.log'),result.log);assert.equal(result.code,0,result.log);await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',samples,dialogueAt:plan.dialogueAt,checks:['native master-layer transition active before and after dialogue change', 'transition start time unchanged across dialogue', 'transition expires at original duration', 'offset samples, parameter override and completed save/load']},null,2));console.log(output);

