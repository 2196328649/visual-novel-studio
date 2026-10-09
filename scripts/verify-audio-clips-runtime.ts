import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject } from '../src/core/model';
import { createAudioClip } from '../src/core/audio-clip';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { arrangePerformanceTimeline, performanceTimeline } from '../src/core/performance-timeline';
import { buildProject, runRenpy } from '../src/runtime/service';

const root = path.resolve('.'), output = path.join(root, 'artifacts/audio-clips-runtime', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const project = createProject('音频剪辑运行验收');
const rate = 22050, size = rate * 8 * 2, b = Buffer.alloc(44 + size);
b.write('RIFF'); b.writeUInt32LE(36 + size, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(size, 40);
for (let i = 0; i < size / 2; i++) b.writeInt16LE(Math.round(1600 * Math.sin(2 * Math.PI * 440 * i / rate)), 44 + i * 2);
await fs.writeFile(path.join(output, 'tone.wav'), b); project.assets.push({ id: 'tone', name: '音频素材', kind: 'audio', path: 'tone.wav' });
const first = { ...createAudioClip('tone', 'First', 8), duration: 4, offset: .5, volume: .6, fadeIn: 1, fadeOut: 1 };
const second = { ...createAudioClip('tone', 'Second', 8), duration: 6, volume: .25 };
const graph = blueprintFromPerformance(project, [first, second]); project.blueprints.push(graph);
const model = performanceTimeline(project, graph);
arrangePerformanceTimeline(project, graph, model.clips.map((c, i) => ({ ...c, at: i * .3, trackId: 'audio' + i })), [{ id: 'audio0', name: '声音一' }, { id: 'audio1', name: '声音二' }]);
const game = path.join(output, 'game'), sdk = path.join(root, 'resources/runtime');
const built = await buildProject({ project, projectDir: output, outputDir: game, sdkRoot: sdk }); assert.ok(built.ok, JSON.stringify(built.diagnostics));
await fs.writeFile(path.join(output, 'project.vns.json'), JSON.stringify(project));
await fs.writeFile(path.join(game, 'game/testcases.rpy'), `
default qa_done = False
default qa_saved_elapsed = 0.0
label qa_audio:
    $ qa_done = False
    call vn_blueprint_${graph.id}
    $ qa_done = True
    "音频片段播放结束。"
    return
testsuite global:
    before testcase:
        $ _test.timeout = 20.0
    teardown:
        exit
testcase audio_clips_save_load:
    click id "vn_main_start"
    run Jump("qa_audio")
    pause until eval len(vn_audio_clips) == 2
    assert eval all(renpy.music.is_playing(channel=c) for c in vn_audio_clips)
    assert eval set(s["offset"] for s in vn_audio_clips.values()) == {0.0, 0.5}
    assert eval 0.0 < renpy.audio.audio.get_channel("vn_clip_sound 0").context.secondary_volume < 0.6
    pause 0.9
    assert eval abs(renpy.audio.audio.get_channel("vn_clip_sound 0").context.secondary_volume - 0.6) < 0.05
    assert eval abs(renpy.audio.audio.get_channel("vn_clip_sound 1").context.secondary_volume - 0.25) < 0.01
    $ qa_saved_elapsed = vn_audio_clips["vn_clip_sound 0"]["elapsed"]
    $ renpy.retain_after_load()
    run FileSave("qa_audio_clip", confirm=False, slot=True)
    assert eval renpy.can_load("qa_audio_clip")
    pause 0.3
    run FileLoad("qa_audio_clip", confirm=False, slot=True)
    pause 0.15
    assert eval not qa_done
    assert eval len(vn_audio_clips) == 2
    assert eval qa_saved_elapsed <= vn_audio_clips["vn_clip_sound 0"]["elapsed"] < qa_saved_elapsed + 0.5
    assert eval float(renpy.music.get_playing(channel="vn_clip_sound 0").split()[1]) > 1.0
    pause until eval vn_audio_clips["vn_clip_sound 0"]["elapsed"] >= 3.4
    assert eval 0.0 < renpy.audio.audio.get_channel("vn_clip_sound 0").context.secondary_volume < 0.4
    pause until eval len(vn_audio_clips) == 1
    assert eval not renpy.music.is_playing(channel="vn_clip_sound 0")
    assert eval renpy.music.is_playing(channel="vn_clip_sound 1")
    pause until "音频片段播放结束。"
    pause 0.1
    assert eval not vn_audio_clips
    assert eval not renpy.music.is_playing(channel="vn_clip_sound 1")
`);
const run = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 90000, env: { SDL_VIDEO_WINDOW_POS: '2400,0' } });
await fs.writeFile(path.join(output, 'runtime.log'), run.log);
const passed = run.code === 0 && /Test cases\s*:\s*1\s*\|\s*1 passed/.test(run.log);
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: passed ? 'passed' : 'failed', checks: ['同一素材在两个音轨独立播放', '截取偏移与音量及淡入淡出', '实际保存加载恢复素材偏移和剩余时长', '首片段停止而第二片段继续', '等待至末片段结束'] }, null, 2));
console.log(output); assert.ok(passed, run.log.slice(-5000));
