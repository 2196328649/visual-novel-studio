import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createUiVoicePreviewFixture, writeUiVoicePreviewAudio } from './lib/ui-voice-preview-fixture';
import { buildProject, runRenpy } from '../src/runtime/service';
const root=path.resolve('.'),output=process.env.VNS_VOICE_RUNTIME_OUTPUT??path.join(root,'artifacts/ui-voice-runtime',new Date().toISOString().replaceAll(':','-')),build=path.join(output,'game'),sdk=path.join(root,'resources/runtime');
const {project}=createUiVoicePreviewFixture();await writeUiVoicePreviewAudio(output);await fs.writeFile(path.join(output,'project.vns.json'),JSON.stringify(project));
const built=await buildProject({project,projectDir:output,sdkRoot:sdk,outputDir:build,development:true});if(!built.ok)throw Error(built.log);
await fs.writeFile(path.join(build,'game/testcases.rpy'),`init -999 python:
    import renpy as _engine
    _engine.safe_mode_checked = True
testsuite global:
    before testcase:
        $ _test.timeout = 2.0
    teardown:
        exit
testcase voice_collection:
    $ persistent.vn_unlocks = ["voice_%d" % i for i in range(13)]
    $ persistent.vn_favorite_voices = list(persistent.vn_unlocks)
    click id "vn_component_open_voices"
    pause until screen "voice_collection"
    assert eval renpy.get_widget("voice_collection", "vn_component_voice_list_caption_voice_0").get_all_text().endswith("…")
    click id "vn_component_voice_list_page_1"
    assert eval renpy.get_widget("voice_collection", "vn_component_voice_list_voice_12") is not None
    click id "vn_component_voice_list_favorite_voice_12"
    assert eval renpy.get_widget("voice_collection", "vn_component_voice_list_voice_0") is not None
    assert eval "voice_12" not in persistent.vn_favorite_voices
    click id "vn_component_voice_list_voice_0"
    pause until eval renpy.music.get_playing(channel="vn_replayvoice") == "assets/voice_0.wav"
    click id "vn_component_voice_list_favorite_voice_1"
    assert eval renpy.music.get_playing(channel="vn_replayvoice") == "assets/voice_0.wav"
    click id "vn_component_voice_list_favorite_voice_0"
    pause until eval renpy.music.get_playing(channel="vn_replayvoice") is None
    assert eval renpy.music.get_playing(channel="vn_replayvoice") is None
    click id "vn_component_voice_list_voice_2"
    pause until eval renpy.music.get_playing(channel="vn_replayvoice") == "assets/voice_2.wav"
    click id "vn_component_voice_confirm"
    pause until screen "confirm"
    assert eval renpy.music.get_playing(channel="vn_replayvoice") == "assets/voice_2.wav"
    click id "vn_component_no"
    assert screen "voice_collection"
    click id "vn_component_voices_back"
    pause until screen "main_menu"
    pause until eval renpy.music.get_playing(channel="vn_replayvoice") is None
    assert eval renpy.music.get_playing(channel="vn_replayvoice") is None
    click id "vn_component_open_voices"
    assert eval renpy.get_widget("voice_collection", "vn_component_voice_list_voice_2") is not None
    $ persistent.vn_unlocks = []
    $ renpy.restart_interaction()
    assert eval not renpy.get_widget("voice_collection", "vn_component_voice_list_voice_2").is_sensitive()
    click id "vn_component_voice_list_favorite_voice_2"
    assert eval "voice_2" not in persistent.vn_favorite_voices
`);
const run=await runRenpy(sdk,build,['test','--report-detailed'],{savedir:path.join(output,'saves'),timeoutMs:60000});await fs.writeFile(path.join(output,'runtime.log'),run.log);const passed=run.code===0&&/Test cases\s*:\s*1\s*\|\s*1 passed/.test(run.log);
await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:passed?'passed':'failed',checks:['长提示省略、分页与末页删除回退','删除其他/正在播放收藏的区别','确认框不停止声音，退出语音页面停止','离页重入与锁定收藏移除']},null,2));console.log(output);if(!passed)throw Error(run.log.slice(-4500));
