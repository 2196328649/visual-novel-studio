import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createUiHistoryFixture, writeUiHistoryAudio } from './lib/ui-history-preview-fixture';
import { synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { projectSchema } from '../src/core/model';
import { voiceVisitKey } from '../src/core/story-menu';
import { buildProject, runRenpy } from '../src/runtime/service';
import { pythonLiteral } from '../src/runtime/literals';

const root = path.resolve('.'), output = path.join(root, 'artifacts/voice-dialogue-runtime', new Date().toISOString().replaceAll(':', '-'));
const sdk = path.join(root, 'resources/runtime');
for (const native of [false, true]) {
 const directory = path.join(output, native ? 'native' : 'custom'), project = createUiHistoryFixture(native);
 project.name = '对白身份收藏与持久化验收';
 project.characters.push({ id: 'other', name: '另一角色', color: '#eeeeee', expressions: [] });
 const passage = project.nodes.find(n => n.kind === 'passage')!;
 const firstText = '[name] {b} 第一条对白，保持原样。', secondText = '同一音频的第二条对白，属于另一角色。';
 passage.lines = [{ id: 'first', speakerId: 'actor', voiceId: 'voice_0', text: firstText, actions: [] },
  { id: 'second', speakerId: 'other', voiceId: 'voice_0', text: secondText, actions: [] },
  { id: 'third', speakerId: 'actor', voiceId: 'voice_1', text: '第三条对白。', actions: [] }];
 const start = project.nodes.find(n => n.kind === 'start')!; start.next = passage.id; project.entryId = start.id;
 project.ui.components.push({ id: 'start_voice_story', kind: 'button', page: 'main', text: '开始语音测试剧情', action: 'start', x: .05, y: .5, width: .9, height: .12 },
  { id: 'story_history', kind: 'button', page: 'say', text: '打开测试历史', action: 'history', x: .7, y: .03, width: .28, height: .08 });
 if (!native) Object.assign(project.ui.components.find(c => c.id === 'voice_list')!.list!, { voiceOrder: 'favorites', voiceRemoveConfirm: true });
 synchronizeBlueprintSignatures(project); projectSchema.parse(project); await writeUiHistoryAudio(directory);
 await fs.writeFile(path.join(directory, 'project.vns.json'), JSON.stringify(project, null, 2));
 const first = voiceVisitKey(passage.id, 'first'), second = voiceVisitKey(passage.id, 'second');
 const collection = native ? 'vn_voice_collection' : 'vn_component_voice_list';
 const historyControl = (index: number, action: string) => native ? `vn_history_${action}_${index}` : `vn_component_history_list_${index}_${action}`;
 const confirm = native ? '' : '\n    assert screen "confirm"\n    click id "vn_component_yes"';
 const savedir = path.join(directory, 'saves');
 const run = async (game: string, name: string, body: string) => {
  await fs.writeFile(path.join(game, 'game/testcases.rpy'), `testsuite global:
    before testcase:
        $ _test.timeout = 20.0
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit
testcase ${name}:
${body}
`);
  const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir, timeoutMs: 90000, env: { SDL_VIDEO_WINDOW_POS: '2400,0' } });
  await fs.writeFile(path.join(directory, name + '.log'), result.log);
  const passed = result.code === 0 && /Test cases\s*:\s*1\s*\|\s*1 passed/.test(result.log);
  const report = { status: passed ? 'passed' : 'failed', native, assertions: Number(result.log.match(/Assertions\s*:\s*(\d+)/)?.[1]), name };
  await fs.writeFile(path.join(directory, name + '-report.json'), JSON.stringify(report, null, 2));
  assert.ok(passed, result.log.slice(-6000)); return report;
 };
 const game = path.join(directory, 'game');
 const built = await buildProject({ project, projectDir: directory, outputDir: game, sdkRoot: sdk, development: true });
 await fs.writeFile(path.join(directory, 'compile.log'), built.log + JSON.stringify(built.diagnostics)); assert.ok(built.ok);
 const initial = await run(game, 'dialogue_collection', `    $ persistent.vn_unlocks = ["voice_0", "voice_1"]
    $ persistent.vn_favorite_voices = ["voice_1"]
    $ persistent.vn_voice_collection = []
    $ persistent.vn_voice_favorite_order = []
    $ vn_preference_set("characterVolume", 0.2, "other")
    click id "vn_component_start_voice_story"
    assert eval vn_current_line == "first"
    assert eval _history_list[-1].vn_voice_log["id"] == ${pythonLiteral(first)}
    advance until eval vn_current_line == "second"
    assert eval _history_list[-1].vn_voice_log["id"] == ${pythonLiteral(second)}
    run Function(renpy.save, "before-voices")
    click id "vn_component_story_history"
    assert screen "history"
    click id "${historyControl(0, 'favorite')}"
    assert eval [entry["id"] for entry in persistent.vn_voice_collection] == [${pythonLiteral(first)}]
    assert eval not VnFavoriteVoice("assets/voice_0.wav", _history_list[1].vn_voice_log).get_selected()
    click id "${historyControl(1, 'favorite')}"
    assert eval [entry["id"] for entry in persistent.vn_voice_collection] == [${pythonLiteral(first)}, ${pythonLiteral(second)}]
    $ print("VNS_VOICE_LOG:" + __import__("json").dumps(persistent.vn_voice_collection, ensure_ascii=False))
    assert eval persistent.vn_voice_collection[0]["text"] == ${pythonLiteral(firstText)}
    assert eval persistent.vn_voice_collection[1]["text"] == ${pythonLiteral(secondText)}
    assert eval persistent.vn_voice_collection[1]["speakerId"] == "other"
    click id "${historyControl(1, 'replay')}"
    pause 0.2
    assert eval abs(renpy.audio.audio.get_channel("vn_replayvoice").context.secondary_volume - 0.2) < 0.001
    assert eval VnReplayVoice("assets/voice_0.wav", ${pythonLiteral(second)}).get_selected()
    assert eval not VnReplayVoice("assets/voice_0.wav", ${pythonLiteral(first)}).get_selected()
    click id "vn_component_history_favorites"
    assert screen "voice_collection"
    assert eval len(vn_voice_collection_entries(None, True, "favorites")) == 3
    assert eval renpy.render(renpy.get_widget("voice_collection", "${collection}_favorite_${first}_label"), ${native ? 49 : 60}, ${native ? 49 : 76}, 0, 0).get_size()[1] <= ${native ? 49 : 76}
    assert eval persistent.vn_favorite_voices == ["voice_1"]
    click id "${collection}_${first}"
    pause 0.2
    assert eval abs(renpy.audio.audio.get_channel("vn_replayvoice").context.secondary_volume - 0.6) < 0.001
    click id "${collection}_favorite_${second}"${native ? '' : '\n    assert screen "confirm"\n    click id "vn_component_no"\n    assert eval len(persistent.vn_voice_collection) == 2\n    assert eval VnReplayVoice("assets/voice_0.wav", ' + pythonLiteral(first) + ').get_selected()\n    click id "' + collection + '_favorite_' + second + '"'}${confirm}
    assert eval [entry["id"] for entry in persistent.vn_voice_collection] == [${pythonLiteral(first)}]
    assert eval renpy.music.get_playing(channel="vn_replayvoice") == "assets/voice_0.wav"
    click id "vn_component_favorites_history"
    click id "${historyControl(1, 'favorite')}"
    click id "vn_component_history_favorites"
    click id "${collection}_${first}"
    click id "${collection}_favorite_${first}"${confirm}
    pause until eval renpy.music.get_playing(channel="vn_replayvoice") is None
    assert eval [entry["id"] for entry in persistent.vn_voice_collection] == [${pythonLiteral(second)}]
    click id "vn_component_favorites_history"
    click id "${historyControl(0, 'favorite')}"
    assert eval [entry["id"] for entry in persistent.vn_voice_collection] == [${pythonLiteral(second)}, ${pythonLiteral(first)}]
    click id "${native ? 'vn_game_menu_return' : 'vn_component_history_back'}"
    assert screen "say"
    run Function(renpy.load, "before-voices")
    pause until screen "say"
    assert eval vn_current_line == "second"
    assert eval [entry["id"] for entry in persistent.vn_voice_collection] == [${pythonLiteral(second)}, ${pythonLiteral(first)}]
    run Jump("vn_line_${passage.id}_second")
    pause until screen "say"
    click id "vn_component_story_history"
    assert eval _history_list[-1].vn_voice_log["id"] == ${pythonLiteral(second)}
    assert eval VnFavoriteVoice("assets/voice_0.wav", _history_list[-1].vn_voice_log).get_selected()
    assert eval len(persistent.vn_voice_collection) == 2
    $ _history_list[:] = []
    click id "vn_component_history_favorites"
    assert eval len(persistent.vn_voice_collection) == 2
    $ qa_saved_second = next(entry for entry in persistent.vn_voice_collection if entry["id"] == ${pythonLiteral(second)})
    $ persistent.vn_unlocks = []
    $ renpy.restart_interaction()
    assert eval not renpy.get_widget("voice_collection", "${collection}_${second}").is_sensitive()
    click id "${collection}_favorite_${second}"${confirm}
    assert eval len(persistent.vn_voice_collection) == 1
    $ persistent.vn_unlocks = ["voice_0", "voice_1"]
    run VnFavoriteVoice("assets/voice_0.wav", qa_saved_second)
    assert eval [entry["id"] for entry in persistent.vn_voice_collection] == [${pythonLiteral(first)}, ${pythonLiteral(second)}]
    screenshot "independent-dialogue-favorites.png"
    $ renpy.save_persistent()`);
 const revised = structuredClone(project), revisedPassage = revised.nodes.find(n => n.id === passage.id)!;
 assert.equal(revisedPassage.kind, 'passage'); if (revisedPassage.kind === 'passage') for (const line of revisedPassage.lines) { line.text = '已经修订的对白 ' + line.id; if (line.id !== 'third') line.voiceId = undefined; }
 revised.characters.find(c => c.id === 'other')!.name = '修订后的角色名';
 revised.assets.find(a => a.id === 'voice_0')!.path = 'assets/relocated_voice.wav';
 await fs.copyFile(path.join(directory, 'assets/voice_0.wav'), path.join(directory, 'assets/relocated_voice.wav'));
 const reopenedGame = path.join(directory, 'revised-game');
 const reb = await buildProject({ project: revised, projectDir: directory, outputDir: reopenedGame, sdkRoot: sdk, development: true }); assert.ok(reb.ok, reb.log);
 const reopened = await run(reopenedGame, 'reopen_collection', `    assert eval persistent.vn_favorite_voices == ["voice_1"]
    assert eval [entry["id"] for entry in persistent.vn_voice_collection] == [${pythonLiteral(first)}, ${pythonLiteral(second)}]
    assert eval persistent.vn_voice_collection[0]["text"] == ${pythonLiteral(firstText)}
    assert eval persistent.vn_voice_collection[1]["text"] == ${pythonLiteral(secondText)}
    assert eval persistent.vn_voice_collection[1]["who"] == "另一角色"
    click id "vn_component_open_history"
    click id "vn_component_history_favorites"
    assert screen "voice_collection"
    assert eval len(vn_voice_collection_entries(None, True, "favorites")) == 3
    ${native ? '' : 'assert eval "第一条对白" in renpy.get_widget("voice_collection", "' + collection + '_caption_' + first + '").get_all_text()\n    assert eval "第二条对白" in renpy.get_widget("voice_collection", "' + collection + '_caption_' + second + '").get_all_text()'}
    click id "${collection}_${second}"
    pause 0.2
    assert eval renpy.music.get_playing(channel="vn_replayvoice") == "assets/relocated_voice.wav"
    assert eval abs(renpy.audio.audio.get_channel("vn_replayvoice").context.secondary_volume - 0.2) < 0.001
    assert eval VnReplayVoice("assets/voice_0.wav", ${pythonLiteral(second)}).get_selected()
    assert eval not VnReplayVoice("assets/voice_0.wav", ${pythonLiteral(first)}).get_selected()
    screenshot "reopened-dialogue-favorites.png"`);
 await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify({ status: 'passed', native, assertions: initial.assertions + reopened.assertions, runs: [initial, reopened], actualCompiledDialogue: true, originalGameOperated: false,
  checks: ['真实编译对白记录独立身份、同音频不同文字与角色', '独立收藏、目标删除、取消确认、当前与同文件其他条目试听区别', '角色增益、锁定收藏可删、收藏顺序与重新加入', '旧资源收藏保留、真实保存读取后收藏保持', '重复进入同对白不新增重复收藏、历史清空仍保留快照', '重启并修订台词/角色、移走素材与删除对白语音引用后，按素材ID继续试听旧快照'] }, null, 2));
}
console.log(output);
