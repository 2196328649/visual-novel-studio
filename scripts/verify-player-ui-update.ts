import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { projectSchema } from '../src/core/model';
import { buildProject, spawnRenpy } from '../src/runtime/service';
import { writeUiHistoryAudio } from './lib/ui-history-preview-fixture';

const output = path.resolve('artifacts/player-ui-update', new Date().toISOString().replaceAll(':', '-'));
const template = path.resolve('resources/templates/aihong'), sdk = path.resolve('resources/runtime');
await fs.mkdir(output, { recursive: true });
const project = projectSchema.parse(JSON.parse(await fs.readFile(path.join(template, 'project.vns.json'), 'utf8')));
project.name = '玩家界面验收'; project.id = 'player_ui_update';
project.ui.instances = []; project.ui.customPages = []; project.ui.activeInstanceId = undefined;
project.ui.components = project.ui.components.filter(c => ['say', 'history', 'voiceCollection', 'preferences', 'messageBox', 'save'].includes(c.page));
project.ui.pages!.main = { layout: 'native' }; project.ui.disabledPages = [];
project.ui.pages!.choice = { layout: 'native' };
project.blueprints = []; project.variables = []; project.chapters = [{ id: 'chapter', name: '验收' }];
project.scenes = [{ id: 'scene', name: '验收', chapterId: 'chapter', entryActions: [] }];
project.characters = [{ ...project.characters[0], id: 'actor', name: '方知宥', expressions: [project.characters[0].expressions[0]] }];
project.nodes = [{ id: 'start', kind: 'start', name: '开始', sceneId: 'scene', x: 0, y: 0, next: 'story' },
 { id: 'story', kind: 'passage', name: '对白', sceneId: 'scene', x: 100, y: 0, next: 'story', lines: [
  { id: 'first', speakerId: 'actor', voiceId: 'voice_0', text: '这句对白会在演出中继续显示。', actions: [] },
  { id: 'performance', text: '', silent: true, actions: [
    { kind: 'background', assetId: 'ai_story_banquet', transition: 'none' },
    { kind: 'show', characterId: 'actor', expressionId: project.characters[0].expressions[0].id, x: .5, y: 1, scale: 1, layer: 1, transition: 'none' },
    { kind: 'pause', seconds: 3 },
  ] },
  { id: 'after', text: '演出结束，界面仍然显示。', actions: [] },
  { id: 'hide', text: '主动隐藏期间的对白。', actions: [{ kind: 'hideInterface' }] },
  { id: 'show', text: '主动显示后恢复界面。', actions: [{ kind: 'showInterface' }] },
  { id: 'end', text: '验收结束。', actions: [] },
 ] }];
project.entryId = 'start';
project.playerDefaults = { ...project.playerDefaults, fullscreen: false, windowSize: '1280x720', textSpeed: 101 };
const references = JSON.stringify({ ui: project.ui, nodes: project.nodes, characters: project.characters });
project.assets = project.assets.filter(a => references.includes(a.id));
project.assets.push({ id: 'voice_0', name: '验收声音', kind: 'audio', category: 'voice', path: 'assets/voice_0.wav' });
await writeUiHistoryAudio(output);
for (const a of project.assets.filter(a => a.id !== 'voice_0')) { await fs.mkdir(path.dirname(path.join(output, a.path)), { recursive: true }); await fs.copyFile(path.join(template, a.path), path.join(output, a.path)); }
await fs.writeFile(path.join(output, 'project.vns.json'), JSON.stringify(project, null, 2));
const game = path.join(output, 'game');
const built = await buildProject({ project: projectSchema.parse(project), projectDir: output, outputDir: game, sdkRoot: sdk });
await fs.writeFile(path.join(output, 'compile.log'), built.log + JSON.stringify(built.diagnostics));
assert.ok(built.ok, built.log + JSON.stringify(built.diagnostics));
await fs.writeFile(path.join(game, 'game/testcases.rpy'), `
init 1000 python:
    import types, json, os, zipfile, struct
    def qa_thumbnail():
        filename = next(f for f in os.listdir(config.savedir) if f.startswith("clear-") and f.endswith(".save"))
        with zipfile.ZipFile(os.path.join(config.savedir, filename)) as archive:
            data = archive.read("screenshot.png")
        return struct.unpack(">II", data[16:24])
    def qa_history():
        _history_list[:] = []
        texts = ["[走了。]", "我无奈地一笑，掸了掸衣袖上的尘土，欲往院门外走。", "[天色已晚，夜路难行，你不在我这住？]", "[不了，已经够给你添麻烦了。]", "[行……那你回吧，哦，回去后，你快寻些藏身之处，备好钱粮、做些准备！]", "[为何要做这些？莫非兴平伯又要来了？]", "我疑惑问道。", "……", "去年八月，兴平伯高杰兵临城下，欲入城，遭城内百姓拒之门外。"]
        for index, text in enumerate(texts * 2):
            entry = renpy.character.HistoryEntry()
            voiced = index % 9 in [0,2,3,4,5]
            entry.who = ("方知宥" if index % 3 == 0 else "王生") if voiced else None
            entry.what = text
            entry.who_args = {"color": "#ffffff"}
            entry.voice = types.SimpleNamespace(filename="assets/voice_0.wav") if voiced else None
            _history_list.append(entry)
        persistent.vn_unlocks = ["voice_0"]
        persistent.vn_favorite_voices = []
        persistent.vn_voice_collection = []
        persistent.vn_voice_favorite_order = []
    def qa_favorites():
        for entry in _history_list:
            if entry.voice:
                record = vn_capture_history_voice(entry)
                VnFavoriteVoice("assets/voice_0.wav", record)()
    def qa_sizes():
        with open(config.basedir + "/window-options.json", "w") as file:
            json.dump({v: {"dimensions": vn_window_dimensions(v), "available": vn_window_option_available(v)} for v in vn_preference_info["windowSize"]["options"]}, file)

testsuite global:
    before testcase:
        $ _test.timeout = 15
        $ _test.transition_timeout = 0.1
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
        $ preferences.afm_enable = False
    teardown:
        exit

testcase interface:
    click id "vn_main_start"
    assert "这句对白会在演出中继续显示。"
    click pos (800, 400) button 3
    assert eval _windows_hidden
    assert not screen "preferences"
    click pos (800, 400) button 3
    assert eval not _windows_hidden
    assert "这句对白会在演出中继续显示。"
    click pos (800, 400)
    pause 0.3
    assert eval vn_performance_active
    assert eval renpy.showing("vn_actor_actor")
    assert "这句对白会在演出中继续显示。"
    screenshot "performance-retains-dialogue.png"
    pause until "演出结束，界面仍然显示。"
    advance
    assert eval not vn_interface_visible
    assert eval renpy.get_widget("say", "what").style.color[3] == 0
    run FileSave("hidden", confirm=False, slot=True)
    screenshot "explicit-hidden.png"
    advance
    assert eval vn_interface_visible
    assert "主动显示后恢复界面。"
    run FileLoad("hidden", confirm=False, slot=True)
    assert eval not vn_interface_visible
    advance
    assert "主动显示后恢复界面。"
    run Rollback()
    assert eval not vn_interface_visible
    assert eval renpy.get_widget("say", "what").style.color[3] == 0
    advance
    assert "主动显示后恢复界面。"
    run FileSave("clear", confirm=False, slot=True)
    assert eval config.thumbnail_width == 960 and config.thumbnail_height == 540
    assert eval qa_thumbnail() == (960, 540)

testcase history:
    run Function(qa_history)
    run ShowMenu("history")
    assert screen "history"
    assert eval renpy.get_widget("history", "vn_component_ai_history_items_scrollbar") is not None
    screenshot "history-bottom.png"
    $ renpy.get_widget("history", "vn_component_ai_history_items_viewport").yadjustment.change(0)
    pause 0.2
    click id "vn_component_ai_history_items_0_replay"
    pause 0.2
    assert eval renpy.music.get_playing(channel="vn_replayvoice") == "assets/voice_0.wav"
    screenshot "history-top.png"
    run Function(qa_favorites)
    run ShowMenu("voice_collection")
    assert screen "voice_collection"
    screenshot "voice-collection.png"
    $ qa_entry = persistent.vn_voice_collection[0]["id"]
    click id ("vn_component_ai_voicecollection_items_" + qa_entry)
    pause 0.2
    assert eval renpy.music.get_playing(channel="vn_replayvoice") == "assets/voice_0.wav"
    click id ("vn_component_ai_voicecollection_items_favorite_" + qa_entry)
    assert screen "confirm"
    screenshot "voice-remove-confirm.png"
    run Hide("confirm")
    assert eval any(e["id"] == qa_entry for e in persistent.vn_voice_collection)

testcase resolutions:
    run ShowMenu("preferences")
    run Function(qa_sizes)
    click id "vn_component_ai_settings_resolution_choice"
    screenshot "resolution-options.png"
    run Hide("vn_preference_popup")
    ${['640x360','960x540','1280x720','1600x900','1920x1080','2560x1440'].map(v=>`if eval vn_window_option_available("${v}"):
        run VnSetPreference("windowSize", "${v}")
        pause 0.5
        assert eval renpy.get_physical_size() == vn_window_dimensions("${v}")
        assert eval VnSetPreference("windowSize", "${v}").get_selected()`).join('\n    ')}
    run VnSetPreference("fullscreen", True)
    pause 0.5
    assert eval not renpy.get_widget("preferences", "vn_component_ai_settings_resolution_choice").is_sensitive()
    run VnSetPreference("fullscreen", False)
    pause 0.5
    run Stop("vn_replayvoice")
`);
// Ren'Py 8.5.3 can loop in TestPhaseController.update/EndPhase after a test
// combines load and rollback. Stop only this isolated runner once its complete
// assertion report is emitted; standalone EXE exit is checked separately.
let log = '', stoppedAfterReport = false;
const result = await new Promise<number>(resolve => {
  const child = spawnRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), env: { PYTHONUNBUFFERED: '1' }, onData(text) {
    log += text;
    if (/Status: PASSED/.test(log) && /Assertions\s*:\s*35\s*\|\s*35 passed/.test(log)) { stoppedAfterReport = true; child.kill(); }
  } });
  const timeout = setTimeout(() => child.kill(), 120000);
  child.on('close', code => { clearTimeout(timeout); resolve(code ?? 1); });
});
await fs.writeFile(path.join(output, 'runtime.log'), log);
console.log(output); console.log(log.slice(-6500));
assert.ok((result === 0 || stoppedAfterReport) && log.includes('Status: PASSED'));
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', assertions: 35, stoppedAfterReport }, null, 2));
