import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { projectSchema, type StageAction } from '../src/core/model';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { addTimelineActorAnimation, performanceTimeline, arrangePerformanceTimeline } from '../src/core/performance-timeline';
import { chapterFrame, chapterParticle, chapterParticleFrame, chapterSource } from '../src/core/chapter';
import { displayPresetPlacement } from '../src/core/character-presets';
import { buildProject, runRenpy } from '../src/runtime/service';
import { pythonLiteral } from '../src/runtime/literals';
import { initialPreviewStage, linePlaybackPlan, sampleLinePlayback } from '../src/core/line-preview';

const root = path.resolve('.'), template = path.join(root, 'resources/templates/aihong');
const output = path.join(root, 'artifacts/actor-instances-runtime', new Date().toISOString().replaceAll(':', '-'));
const build = path.join(output, 'game'), sdk = path.join(root, 'resources/runtime');
const report: Record<string, unknown> = { status: 'running', output };
await fs.mkdir(output, { recursive: true });
try {
  const p = projectSchema.parse(JSON.parse(await fs.readFile(path.join(template, 'project.vns.json'), 'utf8')));
  p.id = 'actors_qa_' + Date.now(); p.entryId = 'qa_actors';
  p.playerDefaults = { ...p.playerDefaults, fullscreen: false, windowSize: '1280x720' };
  const hero = p.characters.find(c => c.name === '林翩翩')!, normal = hero.defaultExpressionId ?? hero.expressions[0].id, smile = hero.expressions.at(-1)!.id;
  hero.displayPresets = ['left', 'center', 'right'].map((id, i) => ({ id, name: id, x: .2 + .3 * i, y: 1, scale: .72, useDefaultFraming: true }));
  const chapter = p.nodes.find(n => n.kind === 'chapterTitle')!; assert.equal(chapter.kind, 'chapterTitle');
  const background = chapter.backgroundId!, otherBackground = p.nodes.find(n => n.kind === 'chapterTitle' && n.id !== chapter.id)!;
  assert.equal(otherBackground.kind, 'chapterTitle');
  const show = (id: string, lifetime: 'line' | 'persistent' | undefined, presetId = id, expressionId = normal): StageAction => ({ kind: 'show', characterId: hero.id, expressionId, instanceId: id, lifetime, presetId, x: .5, y: 1, scale: 1, layer: 10, transition: 'none' });
  const motion = displayPresetPlacement(p, hero.id, normal, 'right');
  const graph = blueprintFromPerformance(p, [show('blueprint_left', 'persistent', 'left'), show('blueprint_guest', 'line', 'center')]);
  p.blueprints.push(graph);
  const motionId = addTimelineActorAnimation(p, graph, graph.nodes.find(node => node.type === 'showCharacter')!.id);
  const motionNode = graph.nodes.find(node => node.id === motionId)!;
  const timelineMotion = JSON.parse(String(motionNode.properties.action));
  timelineMotion.keyframes[1].rotation = 12;
  timelineMotion.keyframes[1].opacity = .65;
  timelineMotion.keyframes[1].easing = 'easein';
  timelineMotion.keyframes[1].x += .1;
  timelineMotion.curves = { rotation: [{ at: 0, value: 0, easing: 'linear' }, { at: 2, value: 24, easing: 'outquad' }], opacity: [{ at: 0, value: 1, easing: 'linear' }, { at: 2, value: .4, easing: 'easeout' }] };
  motionNode.properties.action = JSON.stringify(timelineMotion);
  const motionTimeline = performanceTimeline(p, graph);
  arrangePerformanceTimeline(p, graph, motionTimeline.clips, motionTimeline.tracks);
  p.scenes.push({ id: 'qa_scene', name: '角色实例验收', chapterId: p.chapters[0].id });
  p.nodes.push({ id: 'qa_actors', name: '角色实例验收', kind: 'passage', sceneId: 'qa_scene', x: 0, y: 0, next: 'ai_ending_shelter', lines: [
    { id: 'three', text: '三个实例：左和右持续，中间仅本句。', actions: [{ kind: 'background', assetId: background, transition: 'none' }, show('left', 'persistent'), show('right', 'persistent'), show('guest', 'line', 'center')] },
    { id: 'background', text: '换背景以后只有左右两个实例。', actions: [{ kind: 'background', assetId: otherBackground.backgroundId!, transition: 'none' }, { kind: 'animate', characterId: hero.id, instanceId: 'right', keyframes: [{ x: .68, y: motion.y, scale: motion.scale, rotation: 8, opacity: .8, duration: .2, easing: 'linear' }], repeat: false, wait: true }] },
    { id: 'expression', text: '只更新右侧表情，并保留持续范围。', actions: [show('right', undefined, 'right', smile)] },
    { id: 'hide_left', text: '手动隐藏左侧，右侧还在。', actions: [{ kind: 'hide', characterId: hero.id, instanceId: 'left', transition: 'none' }] },
    { id: 'hide_right', text: '两个持续实例都已手动隐藏。', actions: [{ kind: 'hide', characterId: hero.id, instanceId: 'right', transition: 'none' }] },
    { id: 'cue', text: '', silent: true, actions: [show('cue', 'line', 'center')] },
    { id: 'cue_say', text: '纯演出行的一次性角色保留到这句。', actions: [] },
    { id: 'cue_after', text: '推进后一次性角色已经清除。', actions: [] },
    { id: 'blueprint', text: '蓝图显示两个独立实例。', actions: [{ kind: 'blueprint', blueprintId: graph.id }] },
    { id: 'blueprint_after', text: '蓝图持续实例跨背景保留。', actions: [{ kind: 'background', assetId: background, transition: 'none' }] },
  ] });
  const built = await buildProject({ project: p, projectDir: template, sdkRoot: sdk, outputDir: build, development: true });
  assert.ok(built.ok, built.log + JSON.stringify(built.diagnostics.filter(d => d.severity === 'error')));
  const emittedStory = await fs.readFile(path.join(build, 'game/story.rpy'), 'utf8');
  const curveTransform = emittedStory.match(/vn_animate_instance\([^\n]*"blueprint_left", (vn_animate_\w+)\)/)?.[1];
  assert.ok(curveTransform, 'compiled actor curve transform');
  const curveBefore = initialPreviewStage();
  curveBefore.actors.set('instance:blueprint_left', { kind: 'show', characterId: hero.id, instanceId: 'blueprint_left', expressionId: normal, layer: 10, transition: 'none', ...timelineMotion.keyframes[0] });
  const curvePlan = linePlaybackPlan(curveBefore, [timelineMotion]);
  const curveSamples = [0, .1, .25, .5, .75, 1, 1.25, 1.5, 1.75, 2, 2.5].map(time => ({ time, pose: sampleLinePlayback(curveBefore, curvePlan, time * 1000).state.actors.get('instance:blueprint_left') }));
  const titleImage = p.assets.find(a => a.id === chapter.titleImageId)!.path;
  const backgroundPath = p.assets.find(a => a.id === background)!.path;
  const samples = [.05, .23, .35, .39, .44, .5, .65, .8, .98];
  const reference = samples.map(time => ({ time, frame: chapterFrame(time, 'ink'), particles: [0, 70, 199].map(i => chapterParticleFrame(chapterParticle(i), time)) }));
  await fs.writeFile(path.join(build, 'game/testcases.rpy'), `init -999 python:
    import renpy as _actor_engine
    _actor_engine.safe_mode_checked = True
init python:
    import time as vn_test_time
    def vn_qa_actor_curves():
        for row in ${pythonLiteral(curveSamples)}:
            transform = ${curveTransform}()
            transform.execute(transform, 0.0, 0.0)
            transform.execute(transform, row["time"], row["time"])
            for prop, field in (("x", "xpos"), ("y", "ypos"), ("scale", "zoom"), ("rotation", "rotate"), ("opacity", "alpha")):
                actual = getattr(transform.state, field)
                if field in ("xpos", "ypos") and hasattr(actual, "relative"):
                    actual = actual.relative + actual.absolute / float(config.screen_width if field == "xpos" else config.screen_height)
                elif field in ("xpos", "ypos") and isinstance(actual, int):
                    actual = actual / float(config.screen_width if field == "xpos" else config.screen_height)
                assert abs(actual - row["pose"][prop]) < .000001, (row["time"], prop, actual, row["pose"][prop])
    def vn_qa_chapter_samples():
        for row in ${pythonLiteral(reference)}:
            actual = vn_chapter_frame(row["time"], "ink")
            assert all(abs(actual[key] - row["frame"][key]) < 0.000001 for key in actual)
            for index, expected in zip((0, 70, 199), row["particles"]):
                actual = vn_chapter_particle_frame(vn_chapter_particle_seeds[index], row["time"])
                assert all(abs(value - expected[key]) < 0.000001 for value, key in zip(actual, ("dx", "dy", "alpha"))), (actual, expected)

testsuite global:
    before testcase:
        $ _test.timeout = 20.0
        $ _test.transition_timeout = .05
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
        if not screen "main_menu":
            run MainMenu(confirm=False)
    teardown:
        exit

testcase actor_lifetimes_and_save:
    run Function(vn_qa_actor_curves)
    click id "vn_component_ai_title_start"
    pause until "三个实例：左和右持续，中间仅本句。"
    assert eval all(renpy.showing("vn_instance_" + key) for key in ("left", "right", "guest"))
    $ vn_qa_left_bounds = renpy.get_image_bounds("vn_instance_left")
    screenshot "three-instances.png"
    run FileSave("qa_actor_three", confirm=False, slot=True)
    assert eval renpy.can_load("qa_actor_three")
    advance until "换背景以后只有左右两个实例。"
    assert eval not renpy.showing("vn_instance_guest")
    assert eval renpy.showing("vn_instance_left") and renpy.showing("vn_instance_right")
    assert eval renpy.get_image_bounds("vn_instance_left") == vn_qa_left_bounds
    pause .3
    assert eval renpy.display.core.displayable_by_tag("master", "vn_instance_right").state.rotate == 8
    screenshot "background-independent-motion.png"
    run FileLoad("qa_actor_three", confirm=False, slot=True)
    pause until "三个实例：左和右持续，中间仅本句。"
    assert eval len(vn_actor_instances) == 3 and vn_actor_instances["vn_instance_guest"]["lifetime"] == "line"
    assert eval renpy.showing("vn_instance_guest")
    screenshot "restored-three-instances.png"
    advance until "只更新右侧表情，并保留持续范围。"
    assert eval vn_actor_instances["vn_instance_right"]["expressionId"] == ${pythonLiteral(smile)}
    assert eval vn_actor_instances["vn_instance_right"]["lifetime"] == "persistent"
    advance until "手动隐藏左侧，右侧还在。"
    assert eval not renpy.showing("vn_instance_left") and renpy.showing("vn_instance_right")
    run Rollback() until "只更新右侧表情，并保留持续范围。"
    assert eval renpy.showing("vn_instance_left") and "vn_instance_left" in vn_actor_instances
    screenshot "rollback-restores-left.png"
    advance until "两个持续实例都已手动隐藏。"
    assert eval len(vn_actor_instances) == 0
    advance until "纯演出行的一次性角色保留到这句。"
    assert eval renpy.showing("vn_instance_cue")
    advance until "推进后一次性角色已经清除。"
    assert eval not renpy.showing("vn_instance_cue")
    advance until "蓝图显示两个独立实例。"
    assert eval renpy.showing("vn_instance_blueprint_left") and renpy.showing("vn_instance_blueprint_guest")
    pause 2.1
    $ print("QA_ACTOR_CURVES", repr(renpy.display.core.displayable_by_tag("master", "vn_instance_blueprint_left").state.rotate), repr(renpy.display.core.displayable_by_tag("master", "vn_instance_blueprint_left").state.alpha))
    assert eval renpy.display.core.displayable_by_tag("master", "vn_instance_blueprint_left").state.rotate == 24
    assert eval abs(renpy.display.core.displayable_by_tag("master", "vn_instance_blueprint_left").state.alpha - .4) < .001
    $ print("QA_GUEST_ROTATE", repr(renpy.display.core.displayable_by_tag("master", "vn_instance_blueprint_guest").state.rotate))
    assert eval (renpy.display.core.displayable_by_tag("master", "vn_instance_blueprint_guest").state.rotate or 0) == 0
    advance until "蓝图持续实例跨背景保留。"
    assert eval renpy.showing("vn_instance_blueprint_left") and not renpy.showing("vn_instance_blueprint_guest")
    screenshot "blueprint-persistent-instance.png"
    run MainMenu(confirm=False)

testcase source_chapter_effect:
    run Function(vn_qa_chapter_samples)
    assert eval len(vn_chapter_particles_for(${pythonLiteral(titleImage)}, ${pythonLiteral(chapter.title)})) == 200
    $ vn_qa_start = vn_test_time.monotonic()
    run Show("vn_chapter_title", title=${pythonLiteral(chapter.title)}, title_image=${pythonLiteral(titleImage)}, background=${pythonLiteral(backgroundPath)}, effect="ink", duration=7.0, _vn_wait=False)
${samples.map((t, i) => `    pause until eval vn_test_time.monotonic() - vn_qa_start >= ${t * 7}
    screenshot "chapter-${i}-${t}.png"`).join('\n')}
    pause until not screen "vn_chapter_title"
    assert screen "main_menu"
`);
  for (const args of [['lint'], ['test', '--report-detailed']]) {
    const run = await runRenpy(sdk, build, args, { savedir: path.join(output, 'saves'), timeoutMs: 120_000 });
    await fs.writeFile(path.join(output, args[0] + '.log'), run.log);
    assert.equal(run.code, 0, run.log.slice(-7000)); console.log(args[0] + ': PASS');
  }
  Object.assign(report, { status: 'passed', checks: ['three instances, line expiration, persistent background change, independent motion and expression', 'real FileSave/FileLoad and rollback restore registry and display list together', 'silent cue and blueprint lifetimes', 'source chapter samples match preview math; actual GPU animation captured'], source: chapterSource.source, screenshots: path.join(build, 'tests/screenshots') });
} catch (error) { report.status = 'failed'; report.error = String(error); process.exitCode = 1; console.error(error); }
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
console.log('REPORT ' + path.join(output, 'report.json'));
