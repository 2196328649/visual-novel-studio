import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { createAudioClip } from '../src/core/audio-clip';
import { blueprintFromPerformance, exposePerformanceInputs, performanceInputs, rawSavedBlueprintAction } from '../src/core/blueprint-authoring';
import { synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { mergeBlueprintDebugPacket, parseBlueprintDebugPacket, type BlueprintDebugSnapshot } from '../src/core/blueprint-debug';
import { duplicateTimelineSelection } from '../src/core/composition-authoring';
import { createProject, projectSchema, type BlueprintGraph, type VariableValue, type VisualObject } from '../src/core/model';
import { arrangePerformanceTimeline, performanceTimeline } from '../src/core/performance-timeline';
import { canLaunchTimeline } from '../src/core/timeline-launch';
import { createVisualObject } from '../src/core/visual-object';
import { addVisualParameter } from '../src/core/visual-parameters';
import { atomicWrite } from '../src/desktop/project-store';
import { pythonLiteral } from '../src/runtime/literals';
import { buildProject, runRenpy, spawnRenpy } from '../src/runtime/service';
import { finishFlowNativeVerification, flowRuntimeTraceSource, recordFlowNativeResult } from './lib/flow-runtime-verification';
import { isolateRenpySaves } from './lib/renpy-saves';

// Execute only in the coordinated validation phase. This suite creates its own
// reusable timeline and WAV, and never loads an author's project or save folder.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
assert.equal(path.resolve(process.cwd()).toLowerCase(), root.toLowerCase(), '请从 editor 工作区运行。');
const defaultArtifactRoot = path.join(root, 'artifacts/timeline-workflow-2026-11-14');
const regressionArtifactRoot = path.join(root, 'artifacts/code-health-review-2026-11-14/regression-runtime');
// Keep the historical default for existing callers. A coordinated regression
// must opt into this round's new root before any output directory is touched.
const artifactOverride = process.env.VNS_ARTIFACT_ROOT;
const artifactRoot = artifactOverride === undefined ? defaultArtifactRoot : path.resolve(artifactOverride);
if (artifactOverride !== undefined) assert.equal(artifactRoot.toLowerCase(), regressionArtifactRoot.toLowerCase(), '显式 VNS_ARTIFACT_ROOT 只允许本轮 regression-runtime 目录。');
const output = path.join(artifactRoot, 'runtime-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const source = path.join(output, 'source'), game = path.join(output, 'game'), sdk = path.join(root, 'resources/runtime');
const previousSaves = process.env.RENPY_PATH_TO_SAVES;
const seconds = 6, overlapAt = 1.2, cardStartY = .32, cardEndY = .62;
const report: Record<string, unknown> = {
  status: 'running', output, artifactRoot, sdk, fixture: 'fixture/project.vns.json', checks: [],
  coverage: '产品复制操作产生的两个同资源调用，作者坐标断点真实暂停及继续、重叠显示与音轨、嵌套组合输入、两次真实读档的视觉进度和音画同步、动画姿态像素、独立结束和父时间轴等待。探针只读取真实运行时状态。',
  limits: '960×540 合成工程，文字和色块及本地生成的低振幅 WAV；不覆盖旧版本存档迁移或所有嵌套调用深度。',
  saveInput: '通过低于任务守卫的非模态按钮发送真实鼠标事件，执行原生 FileSave／FileLoad。',
  samplingNotes: 'native03 在同步 PNG 截图之后从绘制回调直接 run FileSave，绕过普通输入事件分发，造成 64ms 的额外采样空档。本用例保留截图，改走普通按钮点击；不手动刷新产品采样、不提高固定误差预算，也不宣称任意阻塞后的直接 renpy.save 都有同样保证。',
};
const inside = (parent: string, candidate: string) => {
  const relative = path.relative(parent, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};
const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

async function prepareOutput() {
  const workspace = await fs.realpath(root);
  let current = root;
  for (const part of path.relative(root, output).split(path.sep)) {
    current = path.join(current, part);
    const stat = await fs.lstat(current).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    });
    if (current === output) assert.equal(stat, undefined, '每次验收必须使用全新目录。');
    if (stat) assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), '拒绝链接或非目录输出：' + current);
    else await fs.mkdir(current);
    assert.ok(inside(workspace, await fs.realpath(current)), '验收输出离开工作区。');
  }
}

function tone() {
  const rate = 22050, samples = rate * seconds, bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++) bytes.writeInt16LE(Math.round(Math.sin(index * Math.PI * 2 * 330 / rate) * 64), 44 + index * 2);
  return bytes;
}

function fixture() {
  const project = createProject('重叠复用时间轴 · 实例隔离');
  project.id = 'qa_timeline_instances'; project.width = 960; project.height = 540;
  project.playerDefaults = { textSpeed: 0, masterVolume: .1 };
  project.ui.pages = { main: { background: '#101722' }, say: { showQuickMenu: false } };
  project.nodes.find(node => node.kind === 'passage')!.lines = [{ id: 'qa_ready', text: '验收就绪。', actions: [] }];
  project.assets.push({ id: 'qa_tone', name: '本地生成的测试音', kind: 'audio', category: 'sound', path: 'assets/qa-tone.wav' });

  const solid = { ...createVisualObject('solid'), instanceId: 'qa_card_background', name: 'QA Background', color: '#283d5a', layer: 0, duration: seconds };
  const title = { ...createVisualObject('text'), instanceId: 'qa_card_title', name: 'QA Title', text: 'SOURCE', width: .92, height: .8, fontSize: 32, layer: 1, duration: seconds };
  const content = { ...createVisualObject('group'), instanceId: 'qa_card_content', name: 'QA Content', duration: seconds, children: [solid, title] };
  const titleParameter = addVisualParameter(content, title.instanceId, ['text'], 'string', title.text, '标题');
  const sizeParameter = addVisualParameter(content, title.instanceId, ['fontSize'], 'number', title.fontSize, '字号');
  const card = { ...createVisualObject('group'), instanceId: 'qa_card', name: 'QA Card', width: .4, height: .36, duration: seconds, children: [content] };
  card.keyframes[0].y = cardStartY;
  card.curves = { y: [{ at: 0, value: cardStartY, easing: 'linear' }, { at: seconds, value: cardEndY, easing: 'linear' }] };
  const parameters = {
    title: addVisualParameter(card, content.instanceId, ['parameterValues', titleParameter], 'string', title.text, '标题'),
    size: addVisualParameter(card, content.instanceId, ['parameterValues', sizeParameter], 'number', title.fontSize, '字号'),
    x: addVisualParameter(card, card.instanceId, ['keyframes', 0, 'x'], 'number', .5, '横向位置'),
    color: addVisualParameter(card, solid.instanceId, ['color'], 'string', solid.color, '卡片颜色'),
  };
  const audio = { ...createAudioClip('qa_tone', 'QA Tone', seconds, 'sound'), instanceId: 'qa_audio' };
  const child = blueprintFromPerformance(project, [card, audio], '复用卡片与音轨');
  child.id = 'qa_instances_child'; child.timelineComponent = true; project.blueprints.push(child);
  const arrange = (graph: BlueprintGraph, at: (id: string) => number) => {
    const model = performanceTimeline(project, graph); assert.equal(model.reason, undefined);
    arrangePerformanceTimeline(project, graph, model.clips.map(clip => ({ ...clip, at: at(clip.nodeId) })), model.tracks);
  };
  arrange(child, () => 0);
  const visualNode = child.nodes.find(node => rawSavedBlueprintAction(node)?.kind === 'visual')!;
  const audioNode = child.nodes.find(node => rawSavedBlueprintAction(node)?.kind === 'audioClip')!;
  const expose = (nodeId: string, pinId: string, name: string) => {
    const field = performanceInputs(child).find(field => field.nodeId === nodeId && field.pinId === pinId);
    assert.ok(field, '必须通过真实输入字段公开：' + name);
    exposePerformanceInputs(child, [{ ...field, name }]); return child.exposedInputs.at(-1)!.id;
  };
  const inputs = Object.fromEntries(Object.entries(parameters).map(([name, id]) => [name, expose(visualNode.id, 'object_parameter_' + id, name)]));
  inputs.volume = expose(audioNode.id, 'clip_volume', 'volume');
  synchronizeBlueprintSignatures(project);
  assert.ok(canLaunchTimeline(project, child), '此夹具必须覆盖无需内联的立即启动子时间轴。');
  const childBefore = JSON.stringify(child);

  const values = (title: string, size: number, x: number, color: string, volume: number): Record<string, VariableValue> => Object.fromEntries(Object.entries({ title, size, x, color, volume }).map(([name, value]) => [inputs[name], value]));
  const parent = blueprintFromPerformance(project, [{ kind: 'blueprint', blueprintId: child.id, inputs: values('LEFT A', 32, .27, '#c94858', .2) }], '复用时间轴重叠');
  parent.id = 'qa_instances_parent'; parent.timelineComponent = true; project.blueprints.push(parent);
  arrange(parent, () => 0);
  const first = parent.nodes.find(node => node.type === 'callFunction')!;
  const [copyId] = duplicateTimelineSelection(project, parent, [first.id]);
  const second = parent.nodes.find(node => node.id === copyId)!;
  for (const [id, value] of Object.entries(values('RIGHT B', 48, .73, '#3276cf', .55))) second.properties['arg_' + id] = value;
  arrange(parent, id => id === second.id ? overlapAt : 0);
  synchronizeBlueprintSignatures(project);
  assert.equal(first.properties.graphId, child.id); assert.equal(second.properties.graphId, child.id);
  assert.equal(first.properties.wait, false); assert.equal(second.properties.wait, false);
  assert.equal(JSON.stringify(child), childBefore, '复制与排布调用不得改动被复用资源。');
  assert.equal(performanceTimeline(project, parent).until, seconds + overlapAt);
  const rawIds = (item: VisualObject): string[] => [item.instanceId, ...(item.children ?? []).flatMap(rawIds)];
  return { project: projectSchema.parse(JSON.parse(JSON.stringify(project))), childId: child.id, visualNodeId: visualNode.id, parentId: parent.id, callIds: [first.id, second.id], rawVisualIds: rawIds(card), rawAudioId: audio.instanceId };
}

function testSource(parentId: string, rawVisualIds: string[], rawAudioId: string, childId: string, visualNodeId: string) {
  return `
init -999 python:
    import renpy as qa_engine
    qa_engine.safe_mode_checked = True
${flowRuntimeTraceSource(output)}
default qa_started = 0.0
default qa_done = -1.0
init python:
    import renpy.test.testexecution as qa_test_execution
    class QAInstanceProbe(object):
        def __init__(self):
            self.saves, self.loads, self.snapshots = [], [], []
            self.resumed = None
    qa_test_execution.timeline_instance_probe = QAInstanceProbe()
    def qa_probe():
        return qa_test_execution.timeline_instance_probe
    def qa_debug_ready():
        debugger = _vn_bp_debug.debugger
        assert debugger is not None and debugger.points == {(${pythonLiteral(childId)}, ${pythonLiteral(visualNodeId)})}
        private_graphs = sorted(graph for graph, authored in vn_bp_debug_origins["graphs"].items() if authored == ${pythonLiteral(childId)})
        assert len(private_graphs) == 2 and ${pythonLiteral(childId)} not in private_graphs, "The two timed calls must actually compile into private graphs"
        nodes = {}
        for graph in private_graphs:
            nodes[graph] = [node for node, origin in vn_bp_debug_origins["nodes"][graph].items()
                if origin.get("graphId") == ${pythonLiteral(childId)} and origin.get("nodeId") == ${pythonLiteral(visualNodeId)} and origin.get("breakpoint") is not False]
            assert len(nodes[graph]) == 1 and nodes[graph][0] != ${pythonLiteral(visualNodeId)}
            assert renpy.has_label("vn_blueprint_" + graph) and (graph, nodes[graph][0]) in vn_bp_debug_nodes
        qa_trace("authored-breakpoint-setup", private_graphs=nodes, authored=dict(graphId=${pythonLiteral(childId)}, nodeId=${pythonLiteral(visualNodeId)}))
        return True
    def qa_objects(data):
        result = [data]
        for child in data.get("children") or []:
            result.extend(qa_objects(child))
        return result
    def qa_cards():
        result = []
        for tag, entry in vn_visual_instances.items():
            data = entry["data"]
            # Sample the same live clock as vn_visual_live. context.runtime
            # alone advances only after the current interaction has returned.
            age = vn_visual_age(data, True)
            if data.get("name") != "QA Card" or not renpy.showing(tag) or age >= data["duration"]:
                continue
            tree = qa_objects(data)
            title = next(item for item in tree if item.get("name") == "QA Title")
            background = next(item for item in tree if item.get("name") == "QA Background")
            result.append(dict(tag=tag, id=data["instanceId"], ids=[item["instanceId"] for item in tree],
                title=title["text"], size=title["fontSize"], x=data["keyframes"][0]["x"], color=background["color"],
                age=age, pose=vn_visual_pose(data, age), width=data["width"], height=data["height"],
                duration=data["duration"], showing=renpy.showing(tag),
                targets=[target["instanceId"] for item in tree for parameter in item.get("parameters") or [] for target in parameter["targets"]]))
        return sorted(result, key=lambda row: row["title"])
    def qa_audio():
        return sorted([dict(channel=channel, id=data["instanceId"], volume=data["volume"], duration=data["duration"],
            offset=data["offset"], elapsed=data["elapsed"], playing=renpy.music.is_playing(channel=channel))
            for channel, data in vn_audio_clips.items() if data.get("assetId") == "qa_tone"], key=lambda row: row["volume"])
    def qa_clock_state():
        # Read only scalar diagnostics. Never retain/serialize the actual
        # context, wait record or display sample in external evidence.
        context, owner, wait = renpy.game.context(), renpy.context(), vn_bp_wait
        now, frame = renpy.display.core.get_time(), renpy.display.interface.frame_time
        guard = getattr(vn_bp_poll_task, "sample", None)
        render_sample = getattr(vn_stage_sample_frame_clock, "sample", None)
        persisted = getattr(owner, "vn_stage_wait_clock", None)
        origin = render_sample[2] if render_sample else None
        audio_samples = getattr(vn_audio_clip_tick, "samples", {})
        return dict(context_runtime=context.runtime, bp_clock=vn_bp_clock(), stage_clock=vn_stage_clock(),
            offset=getattr(owner, "vn_stage_clock_offset", 0.0), transition_offset=getattr(owner, "vn_stage_transition_offset", 0.0),
            wall=now, frame=frame, frame_origin=origin, render_delta=vn_stage_render_delta(),
            render_sample_clock=render_sample[1] if render_sample else None,
            render_context_matches=bool(render_sample and render_sample[0] is context),
            guard_wall=guard[1] if guard else None, guard_age_seconds=now - guard[1] if guard else None,
            guard_wall_since_frame_origin=guard[1] - origin if guard and origin is not None else None,
            frame_minus_guard_wall=frame - guard[1] if guard else None,
            guard_wait_matches=bool(guard and wait is not None and guard[0] is wait),
            wait_present=wait is not None, wait_elapsed=wait.get("elapsed") if wait is not None else None,
            wait_duration=wait.get("duration") if wait is not None else None,
            persisted_stage_clock=persisted.get("clock") if persisted else None,
            persisted_wait_matches=bool(persisted and wait is not None and persisted.get("wait") is wait),
            persisted_owner_matches=bool(persisted and persisted.get("owner") is owner),
            persisted_depth=persisted.get("depth") if persisted else None, depth=renpy.context_nesting_level(),
            persisted_depth_matches=bool(persisted and persisted.get("depth") == renpy.context_nesting_level()),
            audio_samples=[dict(channel=channel, wall=sample[1], age_seconds=now - sample[1],
                current_matches=sample[0] is vn_audio_clips.get(channel)) for channel, sample in sorted(audio_samples.items())])
    def qa_state():
        return dict(time=vn_stage_clock() - qa_started, done=qa_done, cards=qa_cards(), audio=qa_audio(),
            deadline=getattr(renpy.store, "vn_bp_timeline_end_${parentId}", 0.0) - qa_started,
            frame=renpy.display.interface.frame_time, frame_seconds=renpy.display.interface.frame_duration, clocks=qa_clock_state())
    def qa_snapshot(name):
        state = qa_state()
        qa_probe().snapshots.append(dict(name=name, state=state))
        qa_trace(name, state=state, saves=qa_probe().saves, loads=qa_probe().loads, tolerances=qa_sampling_tolerances())
        return state
    def qa_screenshot(name):
        # Screenshot evaluates its filename in the same rendered frame that it
        # captures. Record the pose here, not in the preceding testcase step.
        qa_snapshot("frame-" + name)
        return name + ".png"
    def qa_sampling_tolerances():
        # Playback snapshots use the existing 20ms wait timer. Allow that
        # cadence and one bounded display frame at the save boundary; a slow
        # test must not turn the allowance into the 750ms regression.
        sample, frame, jitter = .020, min(1.0 / 30.0, max(1.0 / 60.0, renpy.display.interface.frame_duration)), .002
        return dict(wait_sample_seconds=sample, display_frame_seconds=frame, numeric_jitter_seconds=jitter,
            visual_restore_seconds=sample + frame + jitter, av_skew_seconds=sample + 2 * frame)
    def qa_av_continuity(before, after):
        # Audio timers and rendering can each lag one frame, in addition to
        # one wait-sample interval. Do not double the whole restore allowance.
        # Crossing zero between samples is not lost playback.
        tolerance = qa_sampling_tolerances()["av_skew_seconds"]
        assert len(before["cards"]) == len(after["cards"]) == len(before["audio"]) == len(after["audio"]) == 2
        for old_card, card, old_sound, sound in zip(before["cards"], after["cards"], before["audio"], after["audio"]):
            assert old_card["id"] == card["id"] and old_sound["id"] == sound["id"]
            old_skew, skew = old_card["age"] - old_sound["elapsed"], card["age"] - sound["elapsed"]
            assert abs(skew) <= abs(old_skew) + tolerance, "Visual/audio drift increased for %s: %.6f -> %.6f" % (card["title"], old_skew, skew)
    def qa_both():
        state = qa_snapshot("two-independent-calls")
        cards, audio = state["cards"], state["audio"]
        assert len(cards) == 2 and len(audio) == 2, "Repeated calls replaced an existing visual or audio instance"
        assert [row["title"] for row in cards] == ["LEFT A", "RIGHT B"]
        assert [row["size"] for row in cards] == [32, 48]
        assert [row["x"] for row in cards] == [.27, .73]
        assert [row["color"] for row in cards] == ["#c94858", "#3276cf"]
        ids = [identity for row in cards for identity in row["ids"]]
        assert len(ids) == 8 and len(set(ids)) == 8 and set(ids).isdisjoint(${pythonLiteral(rawVisualIds)})
        assert all(set(row["targets"]).issubset(row["ids"]) for row in cards), "Nested public parameters lost their target identities"
        assert all(row["showing"] and row["tag"] == "vn_visual_" + row["id"] and row["duration"] == ${seconds} for row in cards)
        assert len(set(row["id"] for row in audio)) == 2 and all(row["id"] != ${pythonLiteral(rawAudioId)} for row in audio)
        assert [row["volume"] for row in audio] == [.2, .55]
        assert all(row["playing"] and row["duration"] == ${seconds} and row["offset"] == 0 for row in audio)
        assert .9 < cards[0]["age"] - cards[1]["age"] < 1.5
        assert .9 < audio[0]["elapsed"] - audio[1]["elapsed"] < 1.5
        for card in cards:
            assert abs(card["pose"]["y"] - (${cardStartY} + card["age"] * ${(cardEndY - cardStartY) / seconds})) < .00001
        assert state["done"] < 0 and ${seconds + overlapAt - .05} <= state["deadline"] < ${seconds + overlapAt + .5}
        return True
    qa_original_save = renpy.save
    def qa_save(slot, *args, **kwargs):
        if slot == "qa_instances":
            qa_probe().saves.append(qa_state())
            qa_snapshot("native-save")
        return qa_original_save(slot, *args, **kwargs)
    def qa_loaded():
        qa_probe().loads.append(qa_state())
        qa_snapshot("native-load-%d" % len(qa_probe().loads))
    def qa_restored(expected_loads):
        assert qa_both()
        assert len(qa_probe().saves) == 1 and len(qa_probe().loads) == expected_loads
        saved, loaded, now = qa_probe().saves[-1], qa_probe().loads[-1], qa_snapshot("restored-playback-%d" % expected_loads)
        tolerance = qa_sampling_tolerances()["visual_restore_seconds"]
        assert [(row["title"], row["ids"]) for row in saved["cards"]] == [(row["title"], row["ids"]) for row in loaded["cards"]]
        assert [(row["channel"], row["id"]) for row in saved["audio"]] == [(row["channel"], row["id"]) for row in loaded["audio"]]
        assert len(loaded["cards"]) == 2 and len(loaded["audio"]) == 2 and loaded["done"] < 0
        assert saved["cards"][1]["age"] > .5, "Save late enough to expose loss of the current interaction's visual time"
        for previous, resumed, current in zip(saved["cards"], loaded["cards"], now["cards"]):
            assert abs(resumed["age"] - previous["age"]) <= tolerance, "Load changed %s visual age: %.6f -> %.6f" % (previous["title"], previous["age"], resumed["age"])
            assert current["age"] >= previous["age"] - tolerance, "Visual playback rewound after load"
            assert abs(resumed["pose"]["y"] - previous["pose"]["y"]) <= ${(cardEndY - cardStartY) / seconds} * tolerance + .00001, "Loaded animation pose jumped"
        for previous, resumed in zip(saved["audio"], loaded["audio"]):
            assert abs(resumed["elapsed"] - previous["elapsed"]) <= tolerance, "Audio position changed at the load boundary"
        for previous, resumed in zip(saved["audio"], now["audio"]):
            assert previous["elapsed"] - .2 <= resumed["elapsed"] <= previous["elapsed"] + .8, "Audio restarted or skipped after load"
        qa_av_continuity(saved, loaded)
        qa_av_continuity(saved, now)
        if expected_loads > 1:
            first = qa_probe().loads[0]
            assert all(abs(row["age"] - old["age"]) <= tolerance for row, old in zip(loaded["cards"], first["cards"])), "Repeated loading accumulates a visual time offset"
        qa_trace("save-load-continuity-%d" % expected_loads, tolerances=qa_sampling_tolerances(), saved=saved, loaded=loaded, resumed=now)
        qa_probe().resumed = now
        return True
    def qa_progressed(expected_loads):
        assert len(qa_probe().loads) == expected_loads
        now, previous = qa_snapshot("audio-continues-after-load-%d" % expected_loads), qa_probe().resumed
        assert len(now["audio"]) == 2 and all(row["playing"] for row in now["audio"])
        assert all(row["elapsed"] > old["elapsed"] + .15 for row, old in zip(now["audio"], previous["audio"]))
        assert all(row["age"] > old["age"] + .15 for row, old in zip(now["cards"], previous["cards"]))
        qa_av_continuity(previous, now)
        qa_av_continuity(qa_probe().saves[-1], now)
        return True
    def qa_second_only():
        state = qa_snapshot("first-call-ended")
        assert len(state["cards"]) == 1 and state["cards"][0]["title"] == "RIGHT B"
        assert len(state["audio"]) == 1 and state["audio"][0]["volume"] == .55 and state["audio"][0]["playing"]
        assert state["done"] < 0, "Parent returned before its later call completed"
        return True
    def qa_finished():
        state = qa_snapshot("parent-finished")
        assert ${seconds + overlapAt - .12} <= qa_done < ${seconds + overlapAt + 1.3}, "Parent did not wait for the last overlapping call"
        assert not state["cards"] and not state["audio"]
        assert all(not renpy.music.is_playing(channel=row["channel"]) for row in qa_probe().saves[-1]["audio"])
        return True
    renpy.save = qa_save
init 1000 python:
    config.after_load_callbacks.append(qa_loaded)

screen qa_instance_controls():
    # Match ordinary user controls: input first visits the product guard at
    # zorder 200. The testcase queues real mouse events instead of calling a
    # save action directly from the post-render test callback.
    zorder 60
    modal False
    hbox:
        xalign .98
        yalign .98
        spacing 8
        textbutton "存档":
            id "qa_instance_save"
            action FileSave("qa_instances", confirm=False, slot=True)
            xysize (84, 32)
            text_size 18
            text_color "#d5dce8"
            background Solid("#28303a")
            hover_background Solid("#3c4a5c")
        textbutton "读档":
            id "qa_instance_load"
            action FileLoad("qa_instances", confirm=False, slot=True)
            xysize (84, 32)
            text_size 18
            text_color "#d5dce8"
            background Solid("#28303a")
            hover_background Solid("#3c4a5c")

label qa_instances:
    scene
    window hide
    show screen qa_instance_controls
    $ qa_done = -1.0
    $ qa_started = vn_stage_clock()
    call vn_blueprint_${parentId}
    $ qa_done = vn_stage_clock() - qa_started
    hide screen qa_instance_controls
    "两个独立调用均已结束。"
    return

testsuite global:
    before testcase:
        $ _test.timeout = 20.0
        $ _test.transition_timeout = .05
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
        $ preferences.afm_enable = False
    teardown:
        exit

testcase repeated_timeline_calls_keep_independent_instances:
    click id "vn_main_start"
    pause until "验收就绪。"
    assert eval qa_debug_ready()
    run Jump("qa_instances")
    pause until eval len(qa_audio()) == 2
    pause .65
    assert eval qa_both()
    screenshot qa_screenshot("01-two-calls")
    click id "qa_instance_save" pos (.5, .5)
    assert eval renpy.can_load("qa_instances")
    pause .2
    click id "qa_instance_load" pos (.5, .5)
    pause .15
    assert eval qa_restored(1)
    screenshot qa_screenshot("02-restored-calls")
    pause .25
    assert eval qa_progressed(1)
    click id "qa_instance_load" pos (.5, .5)
    pause .15
    assert eval qa_restored(2)
    screenshot qa_screenshot("02b-restored-again")
    pause .25
    assert eval qa_progressed(2)
    pause until eval len(qa_cards()) == 1 and len(qa_audio()) == 1
    assert eval qa_second_only()
    screenshot "03-first-call-ended.png"
    pause until "两个独立调用均已结束。"
    pause .1
    assert eval qa_finished()
    screenshot "04-parent-finished.png"
`;
}

async function runDebugTest(fixtureData: ReturnType<typeof fixture>) {
  const sessionId = randomUUID();
  const point = { graphId: fixtureData.childId, nodeId: fixtureData.visualNodeId };
  const commands: Record<string, unknown>[] = [], pauses: BlueprintDebugSnapshot[] = [], packets: string[] = [];
  const observedVisualInvocations = new Set<number>();
  let snapshot: BlueprintDebugSnapshot | undefined, pending = '', log = '', revision = 0, closed = false, timedOut = false;
  let packetError: unknown, processError: unknown, result: { code: number; log: string } | undefined;
  const wait = async (predicate: () => boolean, name: string, timeoutMs = 20000) => {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (packetError) throw packetError;
      if (processError) throw processError;
      assert.ok(!closed && Date.now() < deadline, '等待原生调试' + name + '失败。\n' + log.slice(-5000));
      await sleep(20);
    }
  };
  const child = spawnRenpy(sdk, game, ['test', '--report-detailed', '--report-skipped'], {
    savedir: path.join(output, 'saves'),
    env: { RENPY_RENDERER: 'gl2', VNS_BLUEPRINT_DEBUG: JSON.stringify({ sessionId, breakpoints: [point] }) },
    onData: text => {
      process.stdout.write(text); log = (log + text).slice(-1_000_000); pending += text;
      const lines = pending.split(/\r?\n/); pending = lines.pop() ?? '';
      for (const line of lines) if (line.startsWith('VNS_BLUEPRINT_DEBUG:')) {
        try {
          const packet = parseBlueprintDebugPacket(JSON.parse(line.slice('VNS_BLUEPRINT_DEBUG:'.length)), sessionId);
          assert.ok(packet, '原生调试器输出了无法读取的数据包。');
          packets.push(JSON.stringify(packet)); snapshot = mergeBlueprintDebugPacket(snapshot, packet);
          for (const entry of packet.entries) if (entry.kind === 'node' && entry.graphId === point.graphId && entry.nodeId === point.nodeId && entry.invocationId !== undefined) observedVisualInvocations.add(entry.invocationId);
        } catch (error) { packetError ??= error; child.kill(); }
      }
    },
  });
  const timeout = setTimeout(() => { timedOut = true; child.kill(); }, 90000);
  const native = new Promise<void>(resolve => {
    child.once('error', error => { processError = error; });
    child.once('close', code => {
      clearTimeout(timeout); closed = true;
      result = { code: timedOut ? 124 : code ?? 1, log: log + (timedOut ? '\n运行超时。' : '') };
      resolve();
    });
  });
  const send = async (action: 'continue' | 'breakpoints', breakpoints?: { graphId: string; nodeId: string }[]) => {
    const requested = ++revision;
    commands.push({ sessionId, revision: requested, action, ...(breakpoints ? { breakpoints } : {}) });
    await atomicWrite(path.join(game, 'blueprint-debug-control.json'), JSON.stringify({ version: 1, commands }));
    await wait(() => (snapshot?.acknowledgement ?? 0) >= requested, '命令确认 ' + requested);
  };
  try {
    let afterRevision = -1;
    for (const callId of fixtureData.callIds) {
      await wait(() => !!snapshot && snapshot.revision > afterRevision && snapshot.phase === 'paused' && snapshot.reason === 'breakpoint'
        && snapshot.site?.graphId === point.graphId && snapshot.site.nodeId === point.nodeId, '作者节点断点');
      const stopped = structuredClone(snapshot!); pauses.push(stopped);
      assert.deepEqual(stopped.breakpoints, [point], '断点必须直接使用可编辑资源的坐标。');
      assert.deepEqual(stopped.site!.stack.map(frame => frame.graphId), [fixtureData.parentId, fixtureData.childId]);
      assert.equal(stopped.site!.stack.at(-1)!.callNodeId, callId, '复用模块必须指回本次调用。');
      assert.equal(stopped.site!.stack.at(-1)!.id, stopped.site!.invocationId);
      assert.ok(!stopped.trace.entries.some(entry => entry.kind === 'node' && entry.graphId === point.graphId && entry.nodeId === point.nodeId
        && entry.invocationId === stopped.site!.invocationId), '断点必须在真实视觉节点执行之前暂停。');
      const lastSequence = stopped.trace.entries.at(-1)?.sequence;
      await sleep(180);
      assert.equal(snapshot!.phase, 'paused'); assert.equal(snapshot!.site!.invocationId, stopped.site!.invocationId);
      assert.equal(snapshot!.trace.entries.at(-1)?.sequence, lastSequence, '暂停期间不得继续执行时间轴。');
      afterRevision = snapshot!.revision;
      if (pauses.length === fixtureData.callIds.length) await send('breakpoints', []);
      await send('continue');
    }
    assert.notEqual(pauses[0].site!.invocationId, pauses[1].site!.invocationId, '两次真实调用必须具有独立的调试调用帧。');
    await native;
    if (packetError) throw packetError;
    if (processError) throw processError;
    assert.ok(result, '原生验收没有返回进程结果。');
    assert.equal(result.code, 0, result.log.slice(-8000));
    for (const stopped of pauses) assert.ok(observedVisualInvocations.has(stopped.site!.invocationId), 'continue之后必须真实执行此前暂停的视觉节点。');
    const setup = JSON.parse(await fs.readFile(path.join(output, 'traces/authored-breakpoint-setup.json'), 'utf8'));
    const privateGraphs = Object.keys(setup.values.private_graphs);
    assert.equal(privateGraphs.length, 2);
    const story = await fs.readFile(path.join(game, 'game/story.rpy'), 'utf8');
    const parentLabel = 'label vn_blueprint_' + fixtureData.parentId, from = story.indexOf(parentLabel);
    assert.ok(from >= 0);
    const until = story.indexOf('\nlabel ', from + parentLabel.length), parentBody = story.slice(from, until < 0 ? undefined : until);
    for (const graph of privateGraphs) assert.ok(parentBody.includes('call vn_blueprint_' + graph + '('), '父时间轴必须实际调用具有作者断点映射的私有实例。');
    (report.checks as unknown[]).push({ name: 'authored-breakpoint-pauses-two-private-invocations-and-continues', ok: true,
      point, privateGraphs, invocations: pauses.map(stopped => stopped.site!.invocationId) });
    return result;
  } finally {
    if (!closed) child.kill();
    await native;
    report.debug = { sessionId, point, commands, pauses: pauses.length, packets: packets.length, pid: child.pid, exited: closed,
      code: result?.code, packetError: packetError ? String(packetError) : undefined, processError: processError ? String(processError) : undefined };
    await Promise.all([
      fs.writeFile(path.join(output, 'runtime.log'), result?.log ?? log),
      fs.writeFile(path.join(output, 'debug-pauses.json'), JSON.stringify(pauses, null, 2)),
      fs.writeFile(path.join(output, 'debug-packets.jsonl'), packets.join('\n') + '\n'),
    ]);
  }
}

async function preserveGenerated(directory: string, relative = ''): Promise<void> {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  });
  for (const entry of entries) {
    const child = path.join(directory, entry.name), next = path.join(relative, entry.name);
    if (entry.isDirectory() && !['assets', 'fonts', 'cache', 'saves', 'tests'].includes(entry.name)) await preserveGenerated(child, next);
    else if (entry.isFile() && entry.name.endsWith('.rpy')) {
      const destination = path.join(output, 'generated-source', next);
      await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.copyFile(child, destination);
    }
  }
}

async function compressScreenshots(directory: string): Promise<void> {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  });
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await compressScreenshots(file);
    else if (entry.isFile() && entry.name.endsWith('.png')) {
      const image = PNG.sync.read(await fs.readFile(file)), ratio = Math.min(1, 1280 / Math.max(image.width, image.height));
      const resized = new PNG({ width: Math.max(1, Math.floor(image.width * ratio)), height: Math.max(1, Math.floor(image.height * ratio)) });
      for (let y = 0; y < resized.height; y++) for (let x = 0; x < resized.width; x++) {
        const sourceIndex = (Math.min(image.height - 1, Math.floor(y / ratio)) * image.width + Math.min(image.width - 1, Math.floor(x / ratio))) * 4;
        image.data.copy(resized.data, (y * resized.width + x) * 4, sourceIndex, sourceIndex + 4);
      }
      await fs.writeFile(file, PNG.sync.write(resized, { deflateLevel: 9 }));
    }
  }
}

async function checkRenderedCards() {
  const files = report.screenshots as string[];
  const evidence = [], positions: number[][] = [];
  for (const name of ['01-two-calls.png', '02-restored-calls.png', '02b-restored-again.png']) {
    const relative = files.find(file => path.basename(file) === name); assert.ok(relative, '缺少原生画面证据：' + name);
    const image = PNG.sync.read(await fs.readFile(path.join(output, 'screenshots', relative)));
    const frame = JSON.parse(await fs.readFile(path.join(output, 'traces', 'frame-' + path.basename(name, '.png') + '.json'), 'utf8'));
    const cards = frame.values.state.cards as { title: string; color: string; age: number; width: number; height: number; pose: { x: number; y: number } }[];
    assert.equal(cards.length, 2);
    const rendered = cards.map(card => {
      const color = [1, 3, 5].map(offset => parseInt(card.color.slice(offset, offset + 2), 16));
      let minX = image.width, minY = image.height, maxX = -1, maxY = -1, colorPixels = 0;
      for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
        const index = (y * image.width + x) * 4;
        if (color.every((value, channel) => Math.abs(image.data[index + channel] - value) <= 10)) {
          minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); colorPixels++;
        }
      }
      assert.ok(colorPixels > image.width * image.height * .05, name + '：缺少独立卡片 ' + card.title);
      const center = [(minX + maxX + 1) / 2, (minY + maxY + 1) / 2];
      const expected = [card.pose.x * image.width, card.pose.y * image.height];
      assert.ok(center.every((value, index) => Math.abs(value - expected[index]) <= 3), name + '：动画实际位置与同一绘制帧不一致 ' + card.title);
      assert.ok(Math.abs(maxX - minX + 1 - card.width * image.width) <= 3 && Math.abs(maxY - minY + 1 - card.height * image.height) <= 3, name + '：卡片裁切或尺寸不正确');
      let textPixels = 0;
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const index = (y * image.width + x) * 4;
        if (image.data[index] > 220 && image.data[index + 1] > 220 && image.data[index + 2] > 220) textPixels++;
      }
      assert.ok(textPixels > 30, name + '：卡片标题没有实际显示 ' + card.title);
      assert.ok(card.pose.y > cardStartY + .025, name + '：动画仍停在初始姿态');
      return { title: card.title, age: card.age, expected, center, bounds: [minX, minY, maxX, maxY], colorPixels, textPixels };
    });
    positions.push(rendered.map(card => card.center[1]));
    evidence.push({ name, size: [image.width, image.height], rendered });
  }
  assert.ok(positions[1].every((value, index) => value > positions[0][index] + 1), '恢复后的两个动画都必须继续从保存时的姿态向前移动。');
  (report.checks as unknown[]).push({ name: 'rendered-independent-animated-cards-before-and-after-two-loads', ok: true, evidence });
}

let failure: unknown;
await prepareOutput();
try {
  await fs.mkdir(path.join(source, 'assets'), { recursive: true }); await isolateRenpySaves(output);
  const fixtureData = fixture(), project = fixtureData.project;
  const projectText = JSON.stringify(project, null, 2), projectBefore = JSON.stringify(project), audioBytes = tone();
  await fs.mkdir(path.join(output, 'fixture/assets'), { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(source, 'project.vns.json'), projectText), fs.writeFile(path.join(output, 'fixture/project.vns.json'), projectText),
    fs.writeFile(path.join(source, 'assets/qa-tone.wav'), audioBytes), fs.writeFile(path.join(output, 'fixture/assets/qa-tone.wav'), audioBytes),
  ]);
  report.fixtureIdentity = { project: hash(projectText), audio: hash(audioBytes), child: fixtureData.childId, visualNode: fixtureData.visualNodeId, parent: fixtureData.parentId, calls: fixtureData.callIds, rawVisualIds: fixtureData.rawVisualIds, rawAudioId: fixtureData.rawAudioId };
  const tests = testSource(fixtureData.parentId, fixtureData.rawVisualIds, fixtureData.rawAudioId, fixtureData.childId, fixtureData.visualNodeId);
  await fs.writeFile(path.join(output, 'testcases.rpy'), tests);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  const built = await buildProject({ project, projectDir: source, sdkRoot: sdk, outputDir: game, development: true, previewHost: true, preview: { blueprintDebug: true } });
  await fs.writeFile(path.join(output, 'compile.log'), built.log + '\n' + JSON.stringify(built.diagnostics, null, 2));
  (report.checks as unknown[]).push({ name: 'compile', ok: built.ok, diagnostics: built.diagnostics });
  assert.ok(built.ok, built.log + JSON.stringify(built.diagnostics));
  assert.equal(JSON.stringify(project), projectBefore, '运行时实例作用域处理不得修改作者工程对象。');
  await fs.writeFile(path.join(game, 'game/testcases.rpy'), tests);
  await preserveGenerated(path.join(game, 'game'));
  await fs.copyFile(path.join(game, 'source-map.json'), path.join(output, 'source-map.json'));
  const options = { savedir: path.join(output, 'saves'), timeoutMs: 90000, env: { RENPY_RENDERER: 'gl2' } };
  const lint = await runRenpy(sdk, game, ['lint'], options);
  await fs.writeFile(path.join(output, 'lint.log'), lint.log);
  (report.checks as unknown[]).push({ name: 'lint', code: lint.code }); assert.equal(lint.code, 0, lint.log);
  const result = await runDebugTest(fixtureData);
  // The engine counts testcase statements, not Python assertions inside probes.
  recordFlowNativeResult(report, tests.slice(tests.indexOf('\ntestsuite global:')), result, 1);
  assert.equal(JSON.stringify(project), projectBefore);
  assert.equal(hash(await fs.readFile(path.join(source, 'project.vns.json'))), hash(projectText));
  assert.equal(hash(await fs.readFile(path.join(source, 'assets/qa-tone.wav'))), hash(audioBytes));
  (report.checks as unknown[]).push({ name: 'authored-resource-identity-preserved', ok: true });
  report.status = 'passed';
} catch (error) { failure = error; report.status = 'failed'; report.error = String(error); console.error(error); }
finally {
  // The shared finalizer preserves screenshots and failures first, then checks
  // every real path before deleting only this run's source/game/save folders.
  let keepTemporary = false;
  try { await preserveGenerated(path.join(game, 'game')); }
  catch (error) { keepTemporary = true; failure ??= error; report.status = 'failed'; report.generatedSourceError = String(error); }
  const finishError = await finishFlowNativeVerification(output, game, report, previousSaves, { cleanup: !keepTemporary });
  failure ??= finishError;
  try {
    await compressScreenshots(path.join(output, 'screenshots'));
    if (report.status === 'passed') await checkRenderedCards();
  }
  catch (error) { failure ??= error; report.status = 'failed'; report.screenshotError = String(error); }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  if (failure) process.exitCode = 1;
}
