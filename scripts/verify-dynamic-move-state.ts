import { blueprintNodeDefaults } from '../src/core/blueprint';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { projectSchema } from '../src/core/model';
import { buildProject, runRenpy } from '../src/runtime/service';
import { pythonLiteral } from '../src/runtime/literals';
import { initialPreviewStage, linePreviewSnapshot, linePlaybackPlan, sampleLinePlayback } from '../src/core/line-preview';
const root=path.resolve('.'),projectDir=path.resolve(process.argv[2]),output=path.join(projectDir,'native-state',new Date().toISOString().replaceAll(':','-')),sdk=path.join(root,'resources/runtime'),game=path.join(output,'game');await fs.mkdir(output,{recursive:true});
const project=projectSchema.parse(JSON.parse(await fs.readFile(path.join(projectDir,'project.vns.json'),'utf8'))),passage=project.nodes.find(n=>n.kind==='passage')!;project.entryId=passage.id;
const graph=project.blueprints[0],shown=graph.nodes.find(n=>n.type==='showCharacter')!;
const sourcePinDefaults = new Map(shown.pins.map(pin => [pin.id, pin.defaultValue]));
shown.type='showCharacter';shown.properties.characterId='';shown.pins=blueprintNodeDefaults('showCharacter').pins.map(pin => sourcePinDefaults.has(pin.id) ? { ...pin, defaultValue: sourcePinDefaults.get(pin.id) } : pin);shown.properties.expressionId='';
const firstActor=project.characters[0], otherActor={...structuredClone(firstActor),id:'qa_other',name:'另一位说话人',defaultExpressionId:'qa_other_normal',expressions:[{...firstActor.expressions[0],id:'qa_other_normal'}],blueprintId:undefined};project.characters.push(otherActor);
passage.lines[0].speakerId=firstActor.id;passage.lines[1].speakerId=firstActor.id;
const xInput=graph.nodes.find(n=>n.type==='getInput'&&graph.links.some(l=>l.fromNodeId===n.id&&l.toPinId==='x'))!.properties.inputId as string;
const durationInput=graph.nodes.find(n=>n.type==='getInput'&&graph.links.some(l=>l.fromNodeId===n.id&&l.toPinId==='duration'))!.properties.inputId as string;
passage.lines.push({id:'other',speakerId:otherActor.id,text:'另一位说话人使用同一移动',actions:[{kind:'blueprint',blueprintId:graph.id,inputs:{[xInput]:.8,[durationInput]:3}}]});
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
default qa_saved_st = 0.0
default qa_saved_initial = None
init -999 python:
    import renpy as _engine
    _engine.safe_mode_checked = True
init python:
    import time as qa_time
    def qa_x(value):
        if hasattr(value, "relative"):
            return value.relative + value.absolute / float(config.screen_width)
        return value / float(config.screen_width) if isinstance(value, int) else value
    def qa_geometry():
        import math
        assert qa_live_actor.state.rotate_pad is False and qa_live_actor.state.transform_anchor is True
        width = ${project.assets.find(a=>a.id===firstActor.expressions[0].assetId)!.width!} * ${show.scale}
        height = ${project.assets.find(a=>a.id===firstActor.expressions[0].assetId)!.height!} * ${show.scale}
        for angle in (0, 30, -30, 90):
            trans = vn_show_offsets(.5, 1.0, ${show.scale}, 1, {"rotation": [{"at": 0, "value": angle, "easing": "linear"}]})
            trans.add(qa_live_actor.child)
            size = renpy.render(trans, config.screen_width, config.screen_height, 0.0, 0.0).get_size()
            radians = math.radians(angle)
            expected = (abs(width * math.cos(radians)) + abs(height * math.sin(radians)), abs(width * math.sin(radians)) + abs(height * math.cos(radians)))
            assert abs(size[0] - expected[0]) < 2 and abs(size[1] - expected[1]) < 2
            placement = trans.get_placement()
            assert abs(float(placement[2]) - (size[0] / 2 - height / 2 * math.sin(radians))) < 2
            assert abs(float(placement[3]) - (size[1] / 2 + height / 2 * math.cos(radians))) < 2
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
    $ qa_saved_st = qa_live_actor.st
    $ qa_saved_initial = qa_live_actor.function.initial
    assert eval 0.0 < qa_saved_st < 1.8
    $ renpy.session["qa_motion"] = (qa_saved_st, qa_saved_initial, qa_time.monotonic())
    $ print("QA_SAVE", qa_saved_st, qa_saved_initial)
    run FileSave("qa_moving", confirm=False, slot=True)
    assert eval renpy.can_load("qa_moving")
    pause .3
    run FileLoad("qa_moving", confirm=False, slot=True)
    pause .05
    $ qa_live_actor = renpy.display.core.displayable_by_tag("master", "vn_actor_${actor}")
    $ print("QA_LOAD", repr(qa_live_actor.function.initial), repr(qa_saved_initial), qa_live_actor.st, qa_saved_st)
    assert eval qa_live_actor.function.initial == renpy.session["qa_motion"][1]
    $ print("QA_CLOCK", qa_live_actor.st, renpy.session["qa_motion"][0])
    assert eval qa_live_actor.st >= renpy.session["qa_motion"][0] - .1 and qa_live_actor.st < renpy.session["qa_motion"][0] + qa_time.monotonic() - renpy.session["qa_motion"][2] + .2
    screenshot "loaded-during-move.png"
    advance
    pause until ${pythonLiteral(passage.lines[1].text)}
    assert eval renpy.game.context().scene_lists.get_displayable_by_tag("master", "vn_actor_${actor}") is qa_live_actor
    screenshot "next-line-moving.png"
    pause until eval qa_live_actor.st >= 2.0
    assert eval abs(qa_x(qa_live_actor.state.xpos) - ${samples.at(-1)!.pose!.x}) < .001
    assert eval abs(qa_live_actor.state.alpha - 1.0) < .001
    $ renpy.session["qa_render_size"] = renpy.render(qa_live_actor, config.screen_width, config.screen_height, qa_live_actor.st, qa_live_actor.at).get_size()
    $ print("QA_RENDER_BEFORE", renpy.session["qa_render_size"], qa_live_actor.state.zoom, qa_live_actor.state.rotate, qa_live_actor.state.rotate_pad)
    assert eval abs(renpy.session["qa_render_size"][0] - ${project.assets.find(a=>a.id===firstActor.expressions[0].assetId)!.width! * samples.at(-1)!.pose!.scale}) <= 2
    assert eval abs(renpy.session["qa_render_size"][1] - ${project.assets.find(a=>a.id===firstActor.expressions[0].assetId)!.height! * samples.at(-1)!.pose!.scale}) <= 2
    $ print("QA_RENDER_SIZE", renpy.session["qa_render_size"], qa_live_actor.state.zoom)
    run Function(qa_geometry)
    screenshot "next-line-complete.png"
    run FileSave("qa_dynamic_move")
    run FileLoad("qa_dynamic_move", confirm=False)
    pause .1
    assert eval renpy.showing("vn_actor_${actor}")
    assert eval abs(qa_x(renpy.game.context().scene_lists.get_displayable_by_tag("master", "vn_actor_${actor}").state.xpos) - ${samples.at(-1)!.pose!.x}) < .001
    run Rollback() until ${pythonLiteral(line.text)}
    $ qa_live_actor = renpy.display.core.displayable_by_tag("master", "vn_actor_${actor}")
    assert eval qa_live_actor.function.initial == renpy.session["qa_motion"][1]
    advance until "另一位说话人使用同一移动"
    $ qa_other = renpy.display.core.displayable_by_tag("master", "vn_actor_qa_other")
    assert eval qa_other is not None and qa_other.function.target[0] == .8 and qa_other.function.duration == 3.0
    assert eval vn_actor_instances["vn_actor_qa_other"]["expressionId"] == "qa_other_normal"
    assert eval abs(qa_other.function.initial[0] - .65) < .000001
    $ renpy.session["qa_other_st"] = qa_other.st
    run FileSave("qa_other_moving", confirm=False, slot=True)
    pause .2
    run FileLoad("qa_other_moving", confirm=False, slot=True)
    pause .05
    $ qa_other = renpy.display.core.displayable_by_tag("master", "vn_actor_qa_other")
    assert eval qa_other.st >= renpy.session["qa_other_st"] - .1
    assert eval abs(qa_other.function.initial[0] - .65) < .000001
    assert eval qa_other.function.target[0] == .8 and qa_other.function.duration == 3.0
    pause until eval qa_other.st >= 3.0
    assert eval abs(qa_x(qa_other.state.xpos) - .8) < .001
    screenshot "other-speaker-complete.png"
`);
const result=await runRenpy(sdk,game,['test','--report-detailed'],{savedir:path.join(output,'saves'),timeoutMs:60000,env:{RENPY_RENDERER:'gl2'}});await fs.writeFile(path.join(output,'runtime.log'),result.log);assert.equal(result.code,0,result.log);await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',samples,dialogueAt:plan.dialogueAt,checks:['source framing pin defaults preserved', 'native image size and bottom rotation anchor at 0, 30, -30 and 90 degrees', 'analytic first/replacement movement', 'mid-movement load preserves initial pose and does not restart elapsed time', 'cross-line display object continuity', 'completed movement save/load', 'ordinary rollback after load', 'new speaker default expression and overridden target/duration', 'second speaker mid-movement save/load'],clock:'RenPy shown time; load may include elapsed wall time, not an exact frozen-frame restore'},null,2));console.log(output);

