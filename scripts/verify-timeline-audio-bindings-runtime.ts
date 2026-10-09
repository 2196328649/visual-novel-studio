import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { projectSchema } from '../src/core/model';
import { buildProject, runRenpy } from '../src/runtime/service';

const root=path.resolve('.'),projectFile=path.resolve(process.argv[2]),output=path.join(root,'artifacts/timeline-audio-bindings-runtime',new Date().toISOString().replaceAll(':','-'));
const project=projectSchema.parse(JSON.parse(await fs.readFile(projectFile,'utf8'))),graph=project.blueprints.find(g=>g.timeline&&g.timeline.clips.length===3);assert.ok(graph);
await fs.mkdir(output,{recursive:true});const game=path.join(output,'game'),sdk=path.join(root,'resources/runtime');
const built=await buildProject({project,projectDir:path.dirname(projectFile),outputDir:game,sdkRoot:sdk});assert.ok(built.ok,JSON.stringify(built.diagnostics));
await fs.writeFile(path.join(game,'game/testcases.rpy'),`
label qa_bound_audio:
    call vn_blueprint_${graph.id}
    "音频参数裁剪播放完成。"
    return
testsuite global:
    before testcase:
        $ _test.timeout = 25.0
    teardown:
        exit
testcase authored_audio_bindings:
    click id "vn_main_start"
    run Jump("qa_bound_audio")
    pause until eval len(vn_audio_clips) == 2
    assert eval set(s["duration"] for s in vn_audio_clips.values()) == {8.0, 1.0}
    assert eval set(s["volume"] for s in vn_audio_clips.values()) == {0.35, 1.0}
    assert eval "from 2.000000000 to 10.000000000" in renpy.music.get_playing(channel="vn_clip_sound 0")
    assert eval "from 3.000000000 to 4.000000000" in renpy.music.get_playing(channel="vn_clip_sound 1")
    pause until eval len(vn_audio_clips) == 1
    assert eval not renpy.music.is_playing(channel="vn_clip_sound 1")
    assert eval renpy.music.is_playing(channel="vn_clip_sound 0")
    pause until eval not vn_audio_clips
    assert eval not renpy.music.is_playing(channel="vn_clip_sound 0")
    pause until eval len(vn_audio_clips) == 1
    assert eval list(vn_audio_clips.values())[0]["duration"] == 1.0
    assert eval "from 0.000000000 to 1.000000000" in renpy.music.get_playing(channel="vn_clip_sound 0")
    pause until "音频参数裁剪播放完成。"
    pause 0.1
    assert eval not vn_audio_clips
`);
const result=await runRenpy(sdk,game,['test','--report-detailed'],{savedir:path.join(output,'saves'),timeoutMs:60000,env:{SDL_VIDEO_WINDOW_POS:'2400,0'}});await fs.writeFile(path.join(output,'runtime.log'),result.log);
const passed=result.code===0&&/Test cases\s*:\s*1\s*\|\s*1 passed/.test(result.log);await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:passed?'passed':'failed',source:projectFile,checks:['桌面保存工程的参数替换素材与截取区间','8秒与1秒片段独立结束','音量参数保留','同轨后续片段按9秒起点播放并结束']},null,2));console.log(output);assert.ok(passed,result.log.slice(-4000));
