import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { projectSchema } from '../src/core/model';
import { savedBlueprintAction } from '../src/core/blueprint-authoring';
import { buildProject, runRenpy } from '../src/runtime/service';

const root = path.resolve('.'), projectFile = path.resolve(process.argv[2]), output = path.join(root, 'artifacts/audio-clips-authored-runtime', new Date().toISOString().replaceAll(':', '-'));
const project = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const graph = project.blueprints.find(g => g.timeline && g.nodes.filter(n => savedBlueprintAction(n)?.kind === 'audioClip').length === 2); assert.ok(graph);
// The missing media is deliberately unused by the editor fixture.
project.assets = project.assets.filter(a => a.id !== 'missing');
await fs.mkdir(output, { recursive: true });
const game = path.join(output, 'game'), sdk = path.join(root, 'resources/runtime');
const built = await buildProject({ project, projectDir: path.dirname(projectFile), outputDir: game, sdkRoot: sdk }); assert.ok(built.ok, JSON.stringify(built.diagnostics));
await fs.writeFile(path.join(game, 'game/testcases.rpy'), `
label qa_authored_audio:
    call vn_blueprint_${graph.id}
    "桌面编辑的音频片段播放完成。"
    return
label qa_authored_context:
    $ renpy.call_in_new_context("qa_authored_audio")
    return
testsuite global:
    before testcase:
        $ _test.timeout = 15.0
    teardown:
        exit
testcase authored_audio_in_menu_context:
    click id "vn_main_start"
    run Jump("qa_authored_context")
    pause until eval len(vn_audio_clips) == 2
    assert eval all(renpy.music.is_playing(channel=c) for c in vn_audio_clips)
    assert eval set(s["duration"] for s in vn_audio_clips.values()) == {3.0, 4.0}
    assert eval set(s["volume"] for s in vn_audio_clips.values()) == {0.6, 0.25}
    assert eval "from 1.000000000 to 4.000000000" in renpy.music.get_playing(channel="vn_clip_sound 0")
    assert eval renpy.game.context().runtime > 0.9
    pause until eval len(vn_audio_clips) == 1
    assert eval not renpy.music.is_playing(channel="vn_clip_sound 0")
    assert eval renpy.music.is_playing(channel="vn_clip_sound 1")
    pause until "桌面编辑的音频片段播放完成。"
    pause 0.1
    assert eval not vn_audio_clips
`);
const run = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 60000, env: { SDL_VIDEO_WINDOW_POS: '2400,0' } });
await fs.writeFile(path.join(output, 'runtime.log'), run.log);
const passed = run.code === 0 && /Test cases\s*:\s*1\s*\|\s*1 passed/.test(run.log);
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: passed ? 'passed' : 'failed', source: projectFile, checks: ['实际桌面保存工程编译播放', '菜单使用的新上下文计时', '双轨音频与裁剪范围', '独立音量与准确结束'] }, null, 2));
console.log(output); assert.ok(passed, run.log.slice(-3500));
