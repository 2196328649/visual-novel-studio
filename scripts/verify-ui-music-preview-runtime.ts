import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createUiMusicPreviewFixture, writeUiMusicPreviewAudio } from './lib/ui-music-preview-fixture';
import { synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { buildProject, runRenpy } from '../src/runtime/service';

const root=path.resolve('.'),output=path.join(root,'artifacts/ui-music-preview-runtime',new Date().toISOString().replaceAll(':','-')),sdk=path.join(root,'resources/runtime');
for(const native of [false,true]){
 const directory=path.join(output,native?'native':'custom'),project=createUiMusicPreviewFixture(native);synchronizeBlueprintSignatures(project);await writeUiMusicPreviewAudio(directory);await fs.writeFile(path.join(directory,'project.vns.json'),JSON.stringify(project));
 const game=path.join(directory,'game'),built=await buildProject({project,projectDir:directory,outputDir:game,sdkRoot:sdk});assert.ok(built.ok,JSON.stringify(built.diagnostics));
 const control=(action:string,label:string)=>native?`click "${label}"`:`click id "vn_component_${action.toLowerCase()}"`;
 const source=native?'click "测试音乐 1"':'click id "vn_component_music_list_assets/voice_12.wav"';
 await fs.writeFile(path.join(game,'game/testcases.rpy'),`
init python:
    def qa_music_unlock():
        for name, filename in vn_music_entries:
            renpy.mark_audio_seen(filename)

testsuite global:
    before testcase:
        $ _test.timeout = 20.0
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit
testcase music_room:
    assert eval len(vn_music_entries) == 13
    run Function(qa_music_unlock)
    run Play("music", "assets/voice_5.wav", loop=True)
    pause 0.2
    click id "vn_component_open_music"
    assert screen "music_room"
    assert eval renpy.music.get_pause(channel="music") is True
    ${source}
    pause 0.5
    assert eval renpy.music.get_playing(channel="vn_musicroom") == "assets/voice_${native?0:12}.wav"
    ${control('musicPlayPause','播放 / 暂停')}
    assert eval renpy.music.get_pause(channel="vn_musicroom") is True
    ${source}
    assert eval renpy.music.get_pause(channel="vn_musicroom") is False
    ${control('musicNext','下一首')}
    pause 0.5
    assert eval renpy.music.get_playing(channel="vn_musicroom") == "assets/voice_${native?1:0}.wav"
    ${control('musicPrevious','上一首')}
    pause 0.5
    assert eval renpy.music.get_playing(channel="vn_musicroom") == "assets/voice_${native?0:12}.wav"
    ${control('musicLoop','循环')}
    assert eval vn_music_room.loop is False
    ${control('musicShuffle','随机')}
    assert eval vn_music_room.shuffle is True
    ${control('musicShuffle','随机')}
    ${native?'':'click id "vn_component_music_list_page_3"\n    click id "vn_component_music_list_assets/voice_0.wav"\n    pause 0.5\n    assert eval renpy.music.get_playing(channel="vn_musicroom") == "assets/voice_0.wav"'}
    screenshot "music-controls.png"
    ${control('musicStop','停止')}
    pause until eval renpy.music.get_playing(channel="vn_musicroom") is None
    assert eval renpy.music.get_playing(channel="vn_musicroom") is None
    ${native?'click "测试音乐 1"':'click id "vn_component_music_list_assets/voice_0.wav"'}
    pause 0.5
    ${native?'click id "vn_game_menu_return"':'click id "vn_component_music_back"'}
    assert not screen "music_room"
    pause until eval renpy.music.get_playing(channel="vn_musicroom") is None
    assert eval renpy.music.get_pause(channel="music") is False
    assert eval renpy.music.get_playing(channel="music") == "assets/voice_5.wav"
    run Function(renpy.music.set_pause, True, channel="music")
    click id "vn_component_open_music"
    ${native?'click id "vn_game_menu_return"':'click id "vn_component_music_back"'}
    assert eval renpy.music.get_pause(channel="music") is True
`);
 const result=await runRenpy(sdk,game,['test','--report-detailed'],{savedir:path.join(directory,'saves'),timeoutMs:60000,env:{SDL_VIDEO_WINDOW_POS:'2400,0'}});await fs.writeFile(path.join(directory,'runtime.log'),result.log);assert.ok(result.code===0&&/Test cases\s*:\s*1\s*\|\s*1 passed/.test(result.log),result.log.slice(-4500));
 await fs.writeFile(path.join(directory,'report.json'),JSON.stringify({status:'passed',native,assertions:native?15:16,checks:['共享曲目发现','实际原生选曲、暂停、续播、上一首下一首','循环及随机状态、停止',...(native?[]:['自定义列表末页选曲']),'离页停止鉴赏并恢复原音乐及原暂停状态']},null,2));
}
console.log(output);
