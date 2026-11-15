import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph } from '../src/core/blueprint';
import { createProject, type BlueprintGraph, type Character, type Project, type StageAction, type StoryLine, type VisualObject } from '../src/core/model';
import { createVisualObject } from '../src/core/visual-object';
import { pythonLiteral as q } from '../src/runtime/literals';
import { buildProject, runRenpy } from '../src/runtime/service';
import { isolateRenpySaves } from './lib/renpy-saves';
import { preserveRenpyScreenshots } from './lib/text-typography';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

// 由主任务在全部产品修改完成后统一运行。只创建合成工程，不读取作者工程、
// 用户存档或历史验收目录；观察包装器原样调用产品函数并保留返回值。
const args = process.argv.slice(2);
assert.ok(args.length <= 1 && args.every(arg => /^--case=[a-z_]+$/.test(arg)), 'Usage: verify-authoring-fixes-runtime.ts [--case=name]');
const requested = args[0]?.slice('--case='.length);
const output = path.resolve('artifacts/authoring-fixes-2026-11-11', 'runtime-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const source = path.join(output, 'source'), game = path.join(output, 'game'), saves = path.join(output, 'saves');
const sdk = process.env.VNS_RENPY_SDK ?? path.resolve('resources/runtime');
const previousRenpySaves = process.env.RENPY_PATH_TO_SAVES;
const colors = { red: [224, 40, 32], green: [32, 224, 96], dark: [6, 8, 12], blue: [32, 80, 224], yellow: [224, 192, 32] } as const;
const noActorTransition = { enter: { mode: 'none' as const, duration: 0 }, expression: { mode: 'none' as const, duration: 0 }, exit: { mode: 'none' as const, duration: 0 } };
const background = (assetId: string): StageAction => ({ kind: 'background', assetId, transition: 'none' });
const line = (id: string, actions: StageAction[] = []): StoryLine => ({ id, text: id + '.', actions });
const show = (characterId: string, expressionId: string): StageAction => ({ kind: 'show', characterId, expressionId, x: .5, y: .78, scale: 1, layer: 10, lifetime: 'line', transition: 'none', duration: 0, actorTransitions: noActorTransition });

function connect(graph: BlueprintGraph, from: string, out: string, to: string, input: string) {
  assert.equal(connectBlueprintPins(graph, from, out, to, input), undefined, `Invalid fixture link ${out} -> ${input}`);
}

function countingBlueprint(id: string, variableId: string): BlueprintGraph {
  const graph = createBlueprintGraph('effect', id); graph.id = id;
  const read = blueprintNodeDefaults('getVariable'), add = blueprintNodeDefaults('math'), write = blueprintNodeDefaults('setVariable');
  read.properties = { scope: 'project', variableId }; read.pins[0].dataType = 'number';
  add.properties = { operation: 'add', b: 1 };
  write.properties = { scope: 'project', variableId }; write.pins.find(pin => pin.id === 'value')!.dataType = 'number';
  graph.nodes.push(read, add, write);
  connect(graph, graph.nodes[0].id, 'exec', write.id, 'exec_in');
  connect(graph, read.id, 'value', add.id, 'a');
  connect(graph, add.id, 'result', write.id, 'value');
  return graph;
}

interface LegacyStep { character: Character; expression: string; oldCalls: number; ownCalls: number; enabled: boolean }
function legacyCharacters(): LegacyStep[] {
  const local: Character = { id: 'legacy_local', name: '旧本地绑定', color: '#ffffff', blueprintId: 'qa_old_graph', defaultExpressionId: 'legacy_pose', expressions: [{ id: 'legacy_pose', name: '立绘', assetId: 'red' }], actorTransitions: noActorTransition };
  const localOff: Character = { ...local, id: 'legacy_local_off', name: '本地停用', blueprintDisabled: true, expressions: [{ id: 'local_off_pose', name: '立绘', assetId: 'red' }], defaultExpressionId: 'local_off_pose' };
  const inherited: Character = { id: 'legacy_inherited', name: '继承绑定', color: '#ffffff', baseCharacterId: local.id, expressions: [] };
  const inheritedOff: Character = { ...inherited, id: 'legacy_inherited_off', name: '本角色停用继承绑定', blueprintDisabled: true };
  // 保存后的两份角色版本：还原操作与产品一致，只删除本地 marker。
  // 原生验收比较各版本的真实执行；界面按钮和撤销由桌面用例覆盖。
  const inheritedRestored: Character = { ...inheritedOff, id: 'legacy_inherited_restored', name: '已还原继承绑定' };
  delete inheritedRestored.blueprintDisabled;
  const localRestored: Character = { ...localOff, id: 'legacy_local_restored', name: '已还原本地绑定', expressions: [{ id: 'local_restored_pose', name: '立绘', assetId: 'red' }], defaultExpressionId: 'local_restored_pose' };
  delete localRestored.blueprintDisabled;
  const parentOff: Character = { ...local, id: 'legacy_parent_off', name: '上级已停用', blueprintDisabled: true, expressions: [{ id: 'parent_off_pose', name: '立绘', assetId: 'red' }], defaultExpressionId: 'parent_off_pose' };
  const childOfOff: Character = { id: 'legacy_child_of_off', name: '继承上级停用', color: '#ffffff', baseCharacterId: parentOff.id, expressions: [] };
  const own: Character = { ...childOfOff, id: 'legacy_child_own', name: '上级停用但拥有自己的绑定', blueprintId: 'qa_own_graph' };
  const ownOff: Character = { ...own, id: 'legacy_child_own_off', name: '本地停用自己的绑定', blueprintDisabled: true };
  const ownRestored: Character = { ...ownOff, id: 'legacy_child_own_restored', name: '已还原自己的绑定' };
  delete ownRestored.blueprintDisabled;
  return [
    { character: local, expression: 'legacy_pose', oldCalls: 1, ownCalls: 0, enabled: true },
    { character: inherited, expression: 'legacy_pose', oldCalls: 2, ownCalls: 0, enabled: true },
    { character: localOff, expression: 'local_off_pose', oldCalls: 2, ownCalls: 0, enabled: false },
    { character: inheritedOff, expression: 'legacy_pose', oldCalls: 2, ownCalls: 0, enabled: false },
    { character: inheritedRestored, expression: 'legacy_pose', oldCalls: 3, ownCalls: 0, enabled: true },
    { character: localRestored, expression: 'local_restored_pose', oldCalls: 4, ownCalls: 0, enabled: true },
    { character: parentOff, expression: 'parent_off_pose', oldCalls: 4, ownCalls: 0, enabled: false },
    { character: childOfOff, expression: 'parent_off_pose', oldCalls: 4, ownCalls: 0, enabled: false },
    { character: own, expression: 'parent_off_pose', oldCalls: 4, ownCalls: 1, enabled: true },
    { character: ownOff, expression: 'parent_off_pose', oldCalls: 4, ownCalls: 1, enabled: false },
    { character: ownRestored, expression: 'parent_off_pose', oldCalls: 4, ownCalls: 2, enabled: true },
  ];
}

function zeroVisual(content: 'image' | 'video', assetId: string): VisualObject {
  const object = createVisualObject(content, assetId);
  Object.assign(object, { instanceId: 'qa_zero_' + content, width: .4, height: .4, persistent: true, transitionWait: true, wait: false,
    visualTransitions: { enter: { mode: 'move', duration: 0 }, replace: { mode: 'fade', duration: 0 }, exit: { mode: 'dissolve', duration: 0 } } });
  object.keyframes[0].y = .38;
  if (content === 'video') Object.assign(object, { loop: true, muted: true, sourceDuration: 3, mediaOffset: 0, fadeIn: 0, fadeOut: 0 });
  return object;
}

const legacySteps = legacyCharacters();
const soundText = {
  first: 'Typing inherited first: this long line uses the character sound while the letters continue to appear one by one.',
  muted: 'Typing muted middle: this equally long line keeps revealing letters with an explicit zero volume and no sound playback.',
  resumed: 'Typing inherited again: the following line has no local sound override and resumes the same character sound.',
};
function fixture(): Project {
  const project = createProject('编辑行为修复原生验收');
  project.width = 800; project.height = 450;
  // 音频文件本身静音。保留非零混音音量，让真实 vn_typing 通道可以运行。
  project.playerDefaults = { textSpeed: 0, fullscreen: false, masterVolume: 1 };
  project.assets = [
    ...(['red', 'green', 'dark'] as const).map(id => ({ id, name: id, kind: 'image' as const, path: 'assets/' + id + '.png', width: id === 'dark' ? 800 : 180, height: id === 'dark' ? 450 : 300 })),
    { id: 'blip', name: '有效静音打字音', kind: 'audio', path: 'assets/blip.wav' },
    ...(['blue', 'yellow'] as const).map(id => ({ id: 'video_' + id, name: '合成视频' + id, kind: 'video' as const, path: 'assets/' + id + '.webm', width: 128, height: 72 })),
  ];
  project.variables = ['old_calls', 'own_calls'].map(id => ({ id, name: id, type: 'number', initial: 0, persistent: false }));
  project.blueprints = [countingBlueprint('qa_old_graph', 'old_calls'), countingBlueprint('qa_own_graph', 'own_calls')];
  project.characters = [
    ...legacySteps.map(step => step.character),
    { id: 'typing_actor', name: '打字音角色', color: '#ffffff', expressions: [], textPresentation: { typeSoundId: 'blip', typeSoundEvery: 1, typeSoundVolume: .6 } },
    { id: 'actor_a', name: '备用角色甲', color: '#ffffff', expressions: [{ id: 'a_pose', name: '甲表情', assetId: 'red' }], actorTransitions: noActorTransition },
    { id: 'actor_b', name: '实际角色乙', color: '#ffffff', expressions: [{ id: 'b_pose', name: '乙表情', assetId: 'green' }], actorTransitions: noActorTransition },
  ];
  const wired = createBlueprintGraph('effect', '接线角色乙与乙的表情'); wired.id = 'qa_wired_role';
  const literal = blueprintNodeDefaults('literal'), actor = blueprintNodeDefaults('showCharacter');
  literal.properties.value = 'actor_b'; literal.pins[0].dataType = 'character';
  actor.properties = { characterId: 'actor_a', expressionId: 'b_pose', x: .5, y: .78, scale: 1, layer: 10, presetId: '', lifetime: 'line', transition: 'none', duration: 0 };
  wired.nodes.push(literal, actor);
  connect(wired, wired.nodes[0].id, 'exec', actor.id, 'exec_in');
  connect(wired, literal.id, 'value', actor.id, 'characterId');
  project.blueprints.push(wired);
  const sceneId = project.scenes[0].id;
  const ready = project.nodes.find(node => node.kind === 'passage')!;
  assert.equal(ready.kind, 'passage');
  if (ready.kind !== 'passage') throw new Error('Missing initial passage');
  ready.lines = [line('qa_ready', [background('dark')])]; ready.next = ready.id; project.entryId = ready.id;
  const passage = (id: string, lines: StoryLine[], next = id, scene = sceneId) => project.nodes.push({ kind: 'passage', id, sceneId: scene, name: id, x: 500, y: 500, lines, next });
  // 本地绑定走显式表情编译分支，继承角色留空表情，走真实运行时默认表情／绑定解析。
  passage('qa_legacy', [line('qa_legacy_before', [background('dark')]), ...legacySteps.map(step => ({
    ...line('qa_line_' + step.character.id, [show(step.character.id, step.character.baseCharacterId ? '' : step.expression)]), text: step.character.id + '.',
  }))]);
  passage('qa_typing', [
    { id: 'qa_typing_first', speakerId: 'typing_actor', text: soundText.first, actions: [background('dark')], textPresentation: { speed: 'cps', cps: 15 } },
    { id: 'qa_typing_muted', speakerId: 'typing_actor', text: soundText.muted, actions: [], textPresentation: { speed: 'cps', cps: 15, typeSoundVolume: 0 } },
    { id: 'qa_typing_resumed', speakerId: 'typing_actor', text: soundText.resumed, actions: [], textPresentation: { speed: 'cps', cps: 15 } },
  ]);
  passage('qa_wired', [line('qa_wired_before', [background('dark'), show('actor_a', 'a_pose')]), line('qa_wired_after', [{ kind: 'blueprint', blueprintId: wired.id }])]);
  passage('qa_zero', [
    line('qa_zero_before', [background('dark')]),
    line('qa_image_enter', [zeroVisual('image', 'red')]),
    line('qa_image_replace', [zeroVisual('image', 'green')]),
    line('qa_image_hide', [{ kind: 'hideVisual', instanceId: 'qa_zero_image', wait: true }]),
    line('qa_video_enter', [zeroVisual('video', 'video_blue')]),
    line('qa_video_replace', [zeroVisual('video', 'video_yellow')]),
    line('qa_video_hide', [{ kind: 'hideVisual', instanceId: 'qa_zero_video', exitTransition: { mode: 'move', duration: 0 }, wait: true }]),
  ], 'qa_jump_zero_dissolve');
  project.scenes.push({ id: 'qa_scene_two', chapterId: project.chapters[0].id, name: '零秒叠化目标', entryActions: [background('green')] },
    { id: 'qa_scene_three', chapterId: project.chapters[0].id, name: '零秒淡黑目标', entryActions: [background('red')] });
  project.nodes.push({ kind: 'jump', id: 'qa_jump_zero_dissolve', sceneId, name: '零秒叠化', x: 800, y: 500, target: 'qa_scene_dissolve', sceneTransition: { mode: 'dissolve', duration: 0, color: '#000000' } },
    { kind: 'jump', id: 'qa_jump_zero_fade', sceneId: 'qa_scene_two', name: '零秒淡黑', x: 1100, y: 500, target: 'qa_scene_fade', sceneTransition: { mode: 'fade', duration: 0, color: '#000000' } });
  passage('qa_scene_dissolve', [line('qa_scene_dissolve_done')], 'qa_jump_zero_fade', 'qa_scene_two');
  passage('qa_scene_fade', [line('qa_scene_fade_done')], 'qa_scene_fade', 'qa_scene_three');
  return project;
}

interface NativeCase { name: string; source: string }
const begin = (name: string, passage: string, text: string) => `testcase ${name}:
    click id "vn_main_start"
    pause until "qa_ready."
    $ af_begin(${q(name)})
    run Jump(${q('vn_node_' + passage)})
    pause until ${q(text)}
    move pos (780, 80)
`;
const advance = (text: string) => `    $ renpy.test.testmouse.click_mouse(1, 780, 80)
    pause until ${q(text)}
`;
function nativeCases(): NativeCase[] {
  const legacy = begin('legacy_blueprint', 'qa_legacy', 'qa_legacy_before.') + `    assert eval (vn_parameter_get("old_calls"), vn_parameter_get("own_calls")) == (0, 0)
` + legacySteps.map(step => advance(step.character.id + '.') + `    assert eval af_actor(${q(step.character.id)}, ${q(step.expression)})
    assert eval (vn_parameter_get("old_calls"), vn_parameter_get("own_calls")) == (${step.oldCalls}, ${step.ownCalls})
    assert eval bool(vn_bp_character_label(${q(step.character.id)})) == ${q(step.enabled)}
    screenshot ${q(step.character.id + '.png')}
`).join('') + `    assert eval [row["value"] for row in af_probe.writes if row["parameter"] == "old_calls"] == [1, 2, 3, 4]
    assert eval [row["value"] for row in af_probe.writes if row["parameter"] == "own_calls"] == [1, 2]
`;
  const typing = begin('typing_sound', 'qa_typing', soundText.first) + `    $ af_probe.sound_baseline = VnTypeSound.played
    pause .4
    assert eval af_what().slow
    assert eval af_what().vn_type_sound["volume"] == .6
    assert eval VnTypeSound.played > af_probe.sound_baseline and renpy.music.get_playing(channel="vn_typing") is not None
    assert eval af_sound_calls("qa_typing_first") and all(row["volume"] == .6 for row in af_sound_calls("qa_typing_first"))
    screenshot "typing-inherited.png"
    $ renpy.test.testmouse.click_mouse(1, 780, 80)
    pause until eval not af_what().slow
    $ af_probe.sound_baseline = VnTypeSound.played
${advance(soundText.muted)}    pause .4
    assert eval af_what().slow and af_what().vn_type_sound is None
    assert eval VnTypeSound.played == af_probe.sound_baseline
    assert eval renpy.music.get_playing(channel="vn_typing") is None
    assert eval not af_sound_calls("qa_typing_muted")
    screenshot "typing-muted.png"
    $ renpy.test.testmouse.click_mouse(1, 780, 80)
    pause until eval not af_what().slow
${advance(soundText.resumed)}    pause .4
    assert eval af_what().slow and af_what().vn_type_sound["volume"] == .6
    assert eval VnTypeSound.played > af_probe.sound_baseline and renpy.music.get_playing(channel="vn_typing") is not None
    assert eval af_sound_calls("qa_typing_resumed") and all(row["volume"] == .6 for row in af_sound_calls("qa_typing_resumed"))
    screenshot "typing-resumed.png"
    $ renpy.test.testmouse.click_mouse(1, 780, 80)
    pause until eval not af_what().slow
    pause .1
    assert eval renpy.music.get_playing(channel="vn_typing") is None
`;
  const zero = begin('zero_transitions', 'qa_zero', 'qa_zero_before.') + `    assert eval preferences.transitions and not renpy.is_skipping()
` + (['image', 'video'] as const).map(content => {
    const firstColor = content === 'image' ? 'red' : 'blue', nextColor = content === 'image' ? 'green' : 'yellow', instance = 'qa_zero_' + content;
    return advance('qa_' + content + '_enter.') + `    pause until eval af_ready(${q(instance)}, ${q(firstColor)})
    assert eval af_zero_visual(${q(instance)}, "enter")
    assert eval af_immediate_pose(${q(instance)}) and af_first_frame(${q(instance)}, ${q(firstColor)})
    screenshot ${q(content + '-zero-enter.png')}
` + advance('qa_' + content + '_replace.') + `    pause until eval af_ready(${q(instance)}, ${q(nextColor)})
    assert eval af_zero_visual(${q(instance)}, "replace")
    assert eval af_immediate_pose(${q(instance)}) and af_first_frame(${q(instance)}, ${q(nextColor)})
    screenshot ${q(content + '-zero-replace.png')}
` + advance('qa_' + content + '_hide.') + `    assert eval af_zero_visual(${q(instance)}, "exit")
    assert eval ${q('vn_visual_' + instance)} not in vn_visual_instances and not renpy.showing(${q('vn_visual_' + instance)})
    pause until eval af_line_pixel(${q('qa_' + content + '_hide')}, "dark")
${content === 'video' ? `    assert eval af_video_stopped(${q(instance)})\n` : ''}    screenshot ${q(content + '-zero-hide.png')}
`;
  }).join('') + advance('qa_scene_dissolve_done.') + `    assert eval af_zero_scene("dissolve") and vn_pending_scene_transition is None
    pause until eval af_line_pixel("qa_scene_dissolve_done", "green")
    assert eval vn_current_scene == "qa_scene_two"
    screenshot "scene-zero-dissolve.png"
` + advance('qa_scene_fade_done.') + `    assert eval af_zero_scene("fade") and vn_pending_scene_transition is None
    pause until eval af_line_pixel("qa_scene_fade_done", "red")
    assert eval vn_current_scene == "qa_scene_three"
    assert eval len(af_probe.scenes) == 2 and not af_probe.stage_transitions
    screenshot "scene-zero-fade.png"
`;
  const wired = begin('wired_character', 'qa_wired', 'qa_wired_before.') + `    assert eval af_actor("actor_a", "a_pose")
` + advance('qa_wired_after.') + `    assert eval af_actor("actor_b", "b_pose")
    assert eval not renpy.showing(vn_actor_tag("actor_a", "")) and vn_actor_tag("actor_a", "") not in vn_actor_instances
    pause until eval af_line_pixel("qa_wired_after", "green")
    assert eval len(vn_actor_instances) == 1
    screenshot "wired-character-b.png"
`;
  return [{ name: 'legacy_blueprint', source: legacy }, { name: 'typing_sound', source: typing }, { name: 'zero_transitions', source: zero }, { name: 'wired_character', source: wired }];
}

function observer(): string {
  return `init -999 python:
    import renpy as af_engine
    af_engine.safe_mode_checked = True

init 1000 python:
    import time as af_time, json as af_json, os as af_os
    def af_probe():
        pass
    def af_copy(value):
        return af_json.loads(af_json.dumps(value))
    def af_now():
        return af_time.monotonic() - af_probe.started
    def af_begin(name):
        af_probe.name, af_probe.started, af_probe.watch = name, af_time.monotonic(), True
        af_probe.writes, af_probe.sounds, af_probe.visuals, af_probe.poses, af_probe.frames = [], [], [], [], []
        af_probe.scenes, af_probe.stage_transitions, af_probe.active = [], [], {}
        af_probe.serial, af_probe.sound_baseline = 0, VnTypeSound.played
    def af_what():
        return renpy.get_widget("say", "what")
    def af_actor(character, expression):
        tag = vn_actor_tag(character, "")
        row = vn_actor_instances.get(tag)
        return bool(row and row["characterId"] == character and row["expressionId"] == expression and renpy.showing(tag))
    def af_sound_calls(line):
        return [row for row in af_probe.sounds if row["line"] == line]
    def af_parameter_set(*args, **kwargs):
        result = af_parameter_set.original(*args, **kwargs)
        parameter = args[0] if args else kwargs.get("parameter_id")
        if af_probe.watch and parameter in ("old_calls", "own_calls"):
            af_probe.writes.append(dict(time=af_now(), line=vn_current_line, parameter=parameter, value=vn_parameter_get(parameter)))
        return result
    def af_sound_play(*args, **kwargs):
        result = af_sound_play.original(*args, **kwargs)
        if af_probe.watch and kwargs.get("channel") == "vn_typing":
            af_probe.sounds.append(dict(time=af_now(), line=vn_current_line, file=str(args[0]), volume=kwargs.get("relative_volume")))
        return result
    def af_install(data):
        tag = "vn_visual_" + data["instanceId"]
        previous = vn_visual_instances.get(tag)
        outer = vn_flow_transition_request is not None or vn_game_flow_transition_request is not None
        phase = "replace" if previous else "enter"
        rule = af_copy(vn_visual_rule(data, phase))
        result = af_install.original(data)
        if af_probe.watch:
            af_probe.serial += 1
            entry = vn_visual_instances.get(tag) or {}
            blend = entry.get("blend")
            row = dict(serial=af_probe.serial, instance=data["instanceId"], content=data["content"], phase=phase, rule=rule,
                seconds=result, blendDuration=blend.rule["duration"] if blend is not None else None,
                preferences=preferences.transitions, skipping=bool(renpy.is_skipping()), outerFlow=outer, time=af_now(), decoded=False)
            af_probe.visuals.append(row)
            af_probe.active[tag] = row
        return result
    def af_hide(instance_id, rule=None):
        tag = "vn_visual_" + instance_id
        old = vn_visual_instances.get(tag)
        movie = old["data"].get("_vn_movie") if old else None
        channel = movie.channel if movie is not None else None
        authored = af_copy(rule or (vn_visual_rule(old["data"], "exit") if old else None))
        outer = vn_flow_transition_request is not None or vn_game_flow_transition_request is not None
        result = af_hide.original(instance_id, rule)
        if af_probe.watch:
            af_probe.serial += 1
            row = dict(serial=af_probe.serial, instance=instance_id, phase="exit", rule=authored, seconds=result,
                existed=old is not None, showing=renpy.showing(tag), registered=tag in vn_visual_instances,
                preferences=preferences.transitions, skipping=bool(renpy.is_skipping()), outerFlow=outer, time=af_now(),
                mediaChannel=channel, mediaPlayingAfter=renpy.music.get_playing(channel=channel) if channel is not None else None)
            af_probe.visuals.append(row)
            af_probe.active.pop(tag, None)
        return result
    def af_display(st, at, data, viewport=None):
        result = af_display.original(st, at, data, viewport)
        tag = "vn_visual_" + data["instanceId"]
        row = af_probe.active.get(tag)
        if af_probe.watch and row and (vn_visual_instances.get(tag) or {}).get("data") is data and hasattr(result[0], "state"):
            state = result[0].state
            if len(af_probe.poses) < 2000:
                af_probe.poses.append(dict(serial=row["serial"], time=af_now(), alpha=state.alpha, x=float(state.xpos), y=float(state.ypos), age=st))
        return result
    def af_movie_texture(channel, *args, **kwargs):
        result = af_movie_texture.original(channel, *args, **kwargs)
        # 只读原调用拿到的帧，不再调用一次解码器。new 排除已缓存的旧纹理。
        if af_probe.watch and result[0] is not None and result[1]:
            for tag, row in af_probe.active.items():
                data = (vn_visual_instances.get(tag) or {}).get("data") or {}
                movie = data.get("_vn_movie")
                if movie is not None and movie.channel == channel:
                    if not row["decoded"]:
                        row["decodedAt"] = af_now()
                    row["decoded"] = True
        return result
    def af_draw(self, root_widget, fullscreen_video, draw):
        result = af_draw.original(self, root_widget, fullscreen_video, draw)
        if draw and af_probe.watch and af_probe.name in ("zero_transitions", "wired_character"):
            started = af_time.monotonic()
            surface = renpy.display.draw.screenshot(renpy.display.interface.surftree)
            width, height = surface.get_size()
            visible = []
            for tag, row in af_probe.active.items():
                data = (vn_visual_instances.get(tag) or {}).get("data") or {}
                movie = data.get("_vn_movie")
                visible.append(dict(serial=row["serial"], ready=row["content"] != "video" or row["decoded"],
                    channel=movie.channel if movie is not None else None, position=renpy.music.get_pos(channel=movie.channel) if movie is not None else None))
            af_probe.frames.append(dict(time=af_now(), line=vn_current_line, visible=visible,
                pixel=list(surface.get_at((int(width * .5), int(height * .38))))[:3], readbackMs=(af_time.monotonic() - started) * 1000))
        return result
    def af_scene():
        pending = af_copy(vn_pending_scene_transition)
        started, count = af_time.monotonic(), len(af_probe.stage_transitions)
        result = af_scene.original()
        if af_probe.watch and pending is not None:
            af_probe.scenes.append(dict(transition=pending, elapsed=af_time.monotonic() - started,
                stageCalls=len(af_probe.stage_transitions) - count, cleared=vn_pending_scene_transition is None))
        return result
    def af_stage(transition, duration):
        if af_probe.watch:
            af_probe.stage_transitions.append(dict(time=af_now(), duration=duration))
        return af_stage.original(transition, duration)
    def af_latest(instance, phase=None):
        return next((row for row in reversed(af_probe.visuals) if row["instance"] == instance and (phase is None or row["phase"] == phase)), None)
    def af_zero_visual(instance, phase):
        row = af_latest(instance, phase)
        if not row or not row["rule"] or row["rule"]["duration"] != 0 or row["rule"]["mode"] == "none" or row["seconds"] != 0:
            return False
        if not row["preferences"] or row["skipping"] or row["outerFlow"]:
            return False
        return row["existed"] and not row["showing"] and not row["registered"] if phase == "exit" else row["blendDuration"] is None
    def af_immediate_pose(instance):
        row = af_latest(instance)
        poses = [pose for pose in af_probe.poses if pose["serial"] == row["serial"]] if row else []
        return bool(poses) and all(abs(pose["alpha"] - 1) < .00001 and abs(pose["x"] - .5) < .00001 and abs(pose["y"] - .38) < .00001 for pose in poses)
    def af_color(pixel, name):
        expected = ${q(colors)}[name]
        return all(abs(a - b) <= 14 for a, b in zip(pixel, expected))
    def af_visible_frames(instance):
        row = af_latest(instance)
        return [frame for frame in af_probe.frames if any(item["serial"] == row["serial"] and item["ready"] for item in frame["visible"])] if row else []
    def af_ready(instance, color):
        frames = af_visible_frames(instance)
        return bool(frames) and af_color(frames[-1]["pixel"], color)
    def af_first_frame(instance, color):
        frames = af_visible_frames(instance)
        return bool(frames) and af_color(frames[0]["pixel"], color)
    def af_zero_scene(mode):
        rows = [row for row in af_probe.scenes if row["transition"]["mode"] == mode]
        return len(rows) == 1 and rows[0]["transition"]["duration"] == 0 and rows[0]["stageCalls"] == 0 and rows[0]["cleared"]
    def af_video_stopped(instance):
        row = af_latest(instance, "exit")
        return bool(row and row["mediaChannel"] is not None and row["mediaPlayingAfter"] is None and renpy.music.get_playing(channel=row["mediaChannel"]) is None)
    def af_line_pixel(line, color):
        return any(row["line"] == line and af_color(row["pixel"], color) for row in af_probe.frames)
    def af_dump():
        if not af_probe.watch:
            return
        evidence = dict(name=af_probe.name, writes=af_probe.writes, sounds=af_probe.sounds, visuals=af_probe.visuals,
            poses=af_probe.poses, frames=af_probe.frames, scenes=af_probe.scenes, stageTransitions=af_probe.stage_transitions,
            finalParameters={key: vn_parameter_get(key) for key in ("old_calls", "own_calls")}, typingPlayed=VnTypeSound.played)
        with open(af_os.path.join(${q(path.join(output, 'traces'))}, af_probe.name + ".json"), "w", encoding="utf-8") as stream:
            af_json.dump(evidence, stream, ensure_ascii=False, indent=2)
        af_probe.watch = False
    af_begin("initial")
    af_probe.watch = False
    af_parameter_set.original, vn_parameter_set = vn_parameter_set, af_parameter_set
    af_sound_play.original, renpy.sound.play = renpy.sound.play, af_sound_play
    af_install.original, vn_install_visual = vn_install_visual, af_install
    af_hide.original, vn_hide_visual = vn_hide_visual, af_hide
    af_display.original, vn_visual_display = vn_visual_display, af_display
    af_movie_texture.original, renpy.display.video.get_movie_texture = renpy.display.video.get_movie_texture, af_movie_texture
    af_draw.original, renpy.display.core.Interface.draw_screen = renpy.display.core.Interface.draw_screen, af_draw
    af_scene.original, vn_apply_scene_transition = vn_apply_scene_transition, af_scene
    af_stage.original, vn_stage_transition = vn_stage_transition, af_stage

testsuite global:
    before testcase:
        $ _test.timeout = 20.0
        $ _test.transition_timeout = 10.0
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
        $ preferences.transitions = 2
        $ preferences.afm_enable = False
        if not screen "main_menu":
            run MainMenu(confirm=False)
        pause until screen "main_menu"
    after testcase:
        $ af_dump()
        run MainMenu(confirm=False)
        pause until screen "main_menu"
    teardown:
        exit

`;
}

const allCases = nativeCases(), cases = requested ? allCases.filter(item => item.name === requested) : allCases;
assert.ok(cases.length > 0, 'Unknown case: ' + requested + '; available: ' + allCases.map(item => item.name).join(', '));
const assertions = (items: NativeCase[]) => items.reduce((count, item) => count + (item.source.match(/^    assert /gm) ?? []).length, 0);
const report: Record<string, unknown> = {
  status: 'running', output, checks: [], caseSelection: requested ?? 'all', caseNames: cases.map(item => item.name),
  expectedCases: cases.length, expectedAssertions: assertions(cases), fullSuiteCases: allCases.length, fullSuiteAssertions: assertions(allCases),
  coverage: ['旧角色本地／继承绑定、停用和删除本地标记后的恢复、上级停用与子角色自有绑定', '真实逐字显示中的本句零音量、下一句角色音量继承、真实播放调用与通道清理', '图片与无音轨视频的零秒入场／替换／离场，跳转模块零秒叠化／淡黑', '角色引脚静态数据线为乙且表情属于乙时，显示乙并清理旧角色甲'],
  limits: ['角色还原采用与界面相同的删除标记操作生成独立作者数据版本；界面交互另由桌面验收覆盖。', '音频素材是有效静音WAV；检查真实播放调用与通道，不宣称扬声器声学验收。', '视觉只采样实际绘制的中央内部像素与运行时姿态；视频解码等待单独记录，不当作过渡时长。'],
  temporaryPaths: [source, game, saves, path.join(output, 'renpy-saves')],
};
const saveReport = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const check = async (name: string, result: { code: number; log: string }) => {
  await fs.writeFile(path.join(output, name + '.log'), result.log);
  (report.checks as unknown[]).push({ name, code: result.code }); await saveReport();
  assert.equal(result.code, 0, name + ': ' + result.log.slice(-10000));
};
let failure: unknown;
await fs.mkdir(path.join(output, 'screenshots'), { recursive: true });
await fs.mkdir(path.join(output, 'traces'), { recursive: true });
try {
  report.renpySaves = await isolateRenpySaves(output);
  await fs.mkdir(path.join(source, 'assets'), { recursive: true });
  const project = fixture(), original = structuredClone(project), tests = observer() + cases.map(item => item.source).join('\n');
  await fs.writeFile(path.join(output, 'fixture.json'), JSON.stringify(project, null, 2));
  await fs.writeFile(path.join(source, 'project.vns.json'), JSON.stringify(project, null, 2));
  await fs.writeFile(path.join(output, 'testcases.rpy'), tests);
  for (const id of ['red', 'green', 'dark'] as const) {
    const png = new PNG({ width: id === 'dark' ? 800 : 180, height: id === 'dark' ? 450 : 300 });
    for (let offset = 0; offset < png.data.length; offset += 4) png.data.set([...colors[id], 255], offset);
    await fs.writeFile(path.join(source, 'assets', id + '.png'), PNG.sync.write(png));
  }
  const samples = 24000, wav = Buffer.alloc(44 + samples);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + samples, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28);
  wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write('data', 36); wav.writeUInt32LE(samples, 40); wav.fill(128, 44);
  await fs.writeFile(path.join(source, 'assets/blip.wav'), wav);
  for (const id of ['blue', 'yellow'] as const) {
    const hex = colors[id].map(value => value.toString(16).padStart(2, '0')).join('');
    execFileSync(process.env.VNS_FFMPEG ?? 'ffmpeg', ['-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=0x${hex}:size=128x72:rate=20`,
      '-t', '3', '-c:v', 'libvpx', '-pix_fmt', 'yuv420p', '-an', path.join(source, 'assets', id + '.webm')], { windowsHide: true, timeout: 30000 });
  }
  const built = await buildProject({ project, projectDir: source, outputDir: game, sdkRoot: sdk, development: true });
  assert.deepEqual(project, original, 'Building must not mutate the authored fixture.');
  await check('compile', { code: built.ok ? 0 : 1, log: built.log + '\n' + JSON.stringify(built.diagnostics, null, 2) });
  await fs.copyFile(path.join(game, 'game/story.rpy'), path.join(output, 'generated-story.rpy'));
  await fs.writeFile(path.join(game, 'game/testcases.rpy'), tests);
  const options = { savedir: saves, timeoutMs: 180000, env: { PYTHONUNBUFFERED: '1', RENPY_RENDERER: 'gl2' } };
  await check('lint', await runRenpy(sdk, game, ['lint'], options));
  const result = await runRenpy(sdk, game, ['test', '--report-detailed', '--report-skipped'], { ...options, onData: text => process.stdout.write(text) });
  report.cases = Number(result.log.match(/Test cases\s*:\s*(\d+)/)?.[1] ?? 0);
  report.assertions = Number(result.log.match(/Assertions\s*:\s*(\d+)/)?.[1] ?? 0);
  await check('runtime', result);
  assert.match(result.log, /Status: PASSED/);
  assert.match(result.log, new RegExp('Test cases\\s*:\\s*' + cases.length + '\\s*\\|\\s*' + cases.length + ' passed'));
  assert.equal(report.assertions, assertions(cases), 'Every native assertion must execute.');
  for (const item of cases) {
    const trace = JSON.parse(await fs.readFile(path.join(output, 'traces', item.name + '.json'), 'utf8')) as { name: string };
    assert.equal(trace.name, item.name, 'Every native case must preserve its evidence.');
  }
  report.status = 'passed';
} catch (error) {
  failure = error; report.status = 'failed'; report.error = error instanceof Error ? error.stack : String(error);
} finally {
  try {
    await preserveRenpyScreenshots(game, path.join(output, 'screenshots'));
    const runtimeSources = ['story.rpy', 'screens.rpy', '00-vn-dialogue.rpy', '00-vn-ui.rpy', '00-vn-parameters.rpy', '01-vn-chapter.rpy', '01-vn-game-flow.rpy'];
    for (const name of runtimeSources) {
      const candidate = path.join(game, 'game', name);
      if (await fs.stat(candidate).then(stat => stat.isFile()).catch(() => false)) {
        await fs.mkdir(path.join(output, 'generated'), { recursive: true });
        await fs.copyFile(candidate, path.join(output, 'generated', name));
      }
    }
    for (const name of ['errors.txt', 'traceback.txt', 'log.txt', 'report.html', 'test-report.html', 'tests/report.html']) {
      const candidate = path.join(game, name);
      if (await fs.stat(candidate).then(stat => stat.isFile()).catch(() => false)) await fs.copyFile(candidate, path.join(output, path.basename(name)));
    }
    report.traceFiles = (await fs.readdir(path.join(output, 'traces'))).filter(name => name.endsWith('.json'));
    report.screenshotCount = (await fs.readdir(path.join(output, 'screenshots'))).filter(name => name.endsWith('.png')).length;
  } catch (error) { report.status = 'failed'; report.evidenceError = String(error); failure ??= error; }
  try {
    const cleanup = await cleanVerificationDirectories(output, ['source', 'game', 'saves', 'renpy-saves']); report.cleanup = cleanup;
    assert.deepEqual(cleanup.errors, [], 'Only the four verified temporary directories may be removed.');
  } catch (error) { report.status = 'failed'; report.cleanupError = String(error); failure ??= error; }
  if (previousRenpySaves === undefined) delete process.env.RENPY_PATH_TO_SAVES;
  else process.env.RENPY_PATH_TO_SAVES = previousRenpySaves;
  await saveReport(); console.log(path.join(output, 'report.json'));
}
if (failure) throw failure;
