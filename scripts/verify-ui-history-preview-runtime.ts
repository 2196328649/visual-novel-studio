import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createUiHistoryFixture, writeUiHistoryAudio } from './lib/ui-history-preview-fixture';
import { synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { buildProject, runRenpy } from '../src/runtime/service';

const root=path.resolve('.'),output=path.join(root,'artifacts/ui-history-preview-runtime',new Date().toISOString().replaceAll(':','-')),sdk=path.join(root,'resources/runtime');
for(const native of [false,true]){
 const directory=path.join(output,native?'native':'custom'),project=createUiHistoryFixture(native);synchronizeBlueprintSignatures(project);await writeUiHistoryAudio(directory);await fs.writeFile(path.join(directory,'project.vns.json'),JSON.stringify(project));
 const game=path.join(directory,'game'),built=await buildProject({project,projectDir:directory,outputDir:game,sdkRoot:sdk});assert.ok(built.ok,JSON.stringify(built.diagnostics));
 await fs.writeFile(path.join(game,'game/testcases.rpy'),`
init python:
    import types
    def qa_history_records():
        _history_list[:] = []
        for who, text, filename in [("角色", "测试有声对白", "assets/voice_0.wav"), (None, "没有语音的旁白", None), ("角色", "同一语音的另一条记录", "assets/voice_0.wav")]:
            entry = renpy.character.HistoryEntry()
            entry.who, entry.what, entry.who_args = who, text, {"color": "#ffffff"}
            entry.voice = types.SimpleNamespace(filename=filename) if filename else None
            _history_list.append(entry)
        persistent.vn_unlocks = ["voice_0", "voice_1"]
        persistent.vn_favorite_voices = []
        persistent.vn_voice_collection = []
        persistent.vn_voice_favorite_order = []

testsuite global:
    before testcase:
        $ _test.timeout = 20.0
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit
testcase history_and_favorites:
    run Function(qa_history_records)
    click id "vn_component_open_history"
    assert screen "history"
    assert "没有语音的旁白"
    $ qa_first = _history_list[0].vn_voice_log
    $ qa_third = _history_list[2].vn_voice_log
    assert eval qa_first["id"] != qa_third["id"]
    ${native?'click id "vn_history_replay_0"':'click id "vn_component_history_list_0_replay"'}
    pause 0.2
    assert eval renpy.music.get_playing(channel="vn_replayvoice") == "assets/voice_0.wav"
    assert eval abs(renpy.audio.audio.get_channel("vn_replayvoice").context.secondary_volume - 0.6) < 0.001
    ${native?'click id "vn_history_favorite_0"':'click id "vn_component_history_list_0_favorite"'}
    assert eval [entry["id"] for entry in persistent.vn_voice_collection] == [qa_first["id"]]
    ${native?'':'assert eval not renpy.get_widget("history", "vn_component_history_list_2_favorite").is_selected()\n    assert eval renpy.get_widget("history", "vn_component_history_list_1_replay") is None'}
    ${native?'click id "vn_history_favorite_2"':'click id "vn_component_history_list_2_favorite"'}
    assert eval [entry["id"] for entry in persistent.vn_voice_collection] == [qa_first["id"], qa_third["id"]]
    ${native?'click id "vn_history_favorite_0"':'click id "vn_component_history_list_0_favorite"'}
    assert eval persistent.vn_favorite_voices == []
    assert eval [entry["id"] for entry in persistent.vn_voice_collection] == [qa_third["id"]]
    assert eval renpy.music.get_playing(channel="vn_replayvoice") == "assets/voice_0.wav"
    screenshot "history-controls.png"
    click id "vn_component_history_favorites"
    assert screen "voice_collection"
    pause until eval renpy.music.get_playing(channel="vn_replayvoice") is None
    assert eval [entry["id"] for entry in persistent.vn_voice_collection] == [qa_third["id"]]
    click id ("${native?'vn_voice_collection':'vn_component_voice_list'}_" + qa_third["id"])
    pause 0.2
    assert eval renpy.music.get_playing(channel="vn_replayvoice") == "assets/voice_0.wav"
    click id "vn_component_favorites_history"
    assert screen "history"
    pause until eval renpy.music.get_playing(channel="vn_replayvoice") is None
    assert eval [entry["id"] for entry in persistent.vn_voice_collection] == [qa_third["id"]]
    run SetField(persistent, "vn_unlocks", [])
    assert eval not VnReplayVoice("assets/voice_0.wav").get_sensitive()
    assert eval not VnFavoriteVoice("assets/voice_0.wav").get_sensitive()
    ${native?'click id "vn_game_menu_return"':'click id "vn_component_history_back"'}
    assert not screen "history"
`);
 const result=await runRenpy(sdk,game,['test','--report-detailed'],{savedir:path.join(directory,'saves'),timeoutMs:60000,env:{SDL_VIDEO_WINDOW_POS:'2400,0'}});await fs.writeFile(path.join(directory,'runtime.log'),result.log);assert.ok(result.code===0&&/Test cases\s*:\s*1\s*\|\s*1 passed/.test(result.log),result.log.slice(-4500));
 const assertions=Number(result.log.match(/Assertions\s*:\s*(\d+)/)?.[1]);await fs.writeFile(path.join(directory,'report.json'),JSON.stringify({status:'passed',native,assertions,testData:'Isolated legacy HistoryEntry records; no real player save or original game accessed.',checks:['实际历史页语音与收藏按钮','角色音量、收藏期间保持试听','旧历史中重复音频的不同对白获得独立身份、无语音行布局','只删除目标记录，同文件另一条保留','历史/收藏互切停声但保留收藏','锁定语音不能播放或切换收藏']},null,2));
}
console.log(output);
