import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectSchema } from '../src/core/model';
import { buildProject, runRenpy } from '../src/runtime/service';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const template = path.join(root, 'resources/templates/aihong');
const sdk = path.join(root, 'resources/runtime');
const runDir = path.join(root, 'artifacts/aihong-ui-verification', new Date().toISOString().replaceAll(':', '-'));
const buildDir = path.join(runDir, 'game');
const report: { status: string; steps: { name: string; code: number; logPath: string }[]; screenshots: string[]; error?: string } = { status: 'running', steps: [], screenshots: [] };
const save = () => fs.writeFile(path.join(runDir, 'report.json'), JSON.stringify(report, null, 2));
async function step(name: string, result: { code: number; log: string }) {
  const logPath = path.join(runDir, `${name}.log`);
  await fs.writeFile(logPath, result.log);
  report.steps.push({ name, code: result.code, logPath }); await save();
  console.log(`${name}: ${result.code === 0 ? 'PASS' : 'FAIL'}`);
  if (result.code !== 0) throw new Error(`${name}: ${result.log.slice(-6000)}`);
}
try {
  await fs.mkdir(runDir, { recursive: true });
  const project = projectSchema.parse(JSON.parse(await fs.readFile(path.join(template, 'project.vns.json'), 'utf8')));
  const opening = project.nodes.find(node => node.id === 'opening');
  if (opening?.kind !== 'passage' || !opening.lines[1]) throw new Error('The demonstration story has no voiced opening line.');
  const music = project.assets.find(asset => asset.kind === 'audio');
  const firstBackground = opening.lines[0].actions.find(action => action.kind === 'background');
  if (!music || firstBackground?.kind !== 'background') throw new Error('The template story requires opening music and a background.');
  // Use an existing audio waveform only in this in-memory fixture. The bundled
  // adaptation deliberately has no mismatched original voice recordings.
  opening.lines[1].voiceId = music.id;
  // This broader widget regression opts into the optional filter/stop controls.
  // The template's original-style hidden controls are covered by verify-voice-collection-pages.
  project.ui.components.find(c => c.id === 'ai_voicecollection_items')!.list!.showVoiceControls = true;
  const voicePath = music.path.replaceAll('\\', '/');
  const speakerId = opening.lines[1].speakerId!;
  const firstChapter = project.chapters[0], secondChapter = project.chapters[1];
  const secondChapterNode = project.nodes.find(node => node.kind === 'chapterTitle' && project.scenes.find(scene => scene.id === node.sceneId)?.chapterId === secondChapter.id)!;
  const built = await buildProject({ project, projectDir: template, sdkRoot: sdk, outputDir: buildDir, development: true });
  await step('compile', { code: built.ok ? 0 : 1, log: built.log + JSON.stringify(built.diagnostics) });
  await fs.writeFile(path.join(buildDir, 'game', 'testcases.rpy'), `define _test.timeout = 20.0

testsuite global:
    before testcase:
        $ _test.timeout = 20.0
        $ _test.transition_timeout = 0.05
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
        $ preferences.afm_enable = False
        $ preferences.afm_time = 1000
    teardown:
        exit

testcase original_title_button_states:
    assert screen "main_menu"
    assert eval renpy.get_widget("main_menu", "vn_main_start") is None
    assert eval renpy.get_widget("main_menu", "vn_component_ai_title_start").vn_bounds == (272, 86)
    assert eval not renpy.get_widget("main_menu", "vn_component_ai_title_extrastory").is_sensitive()
    pause until eval vn_spine_states["ai_title_animation"]["time"] > 0.1
    assert eval renpy.get_widget("main_menu", "vn_spine_ai_title_animation") is not None
    move pos (8, 8)
    screenshot "title-idle.png"
    pause 1.0
    screenshot "title-loop.png"
    move id "vn_component_ai_title_start"
    pause 0.1
    assert eval renpy.get_widget("main_menu", "vn_component_ai_title_start").style.prefix == "hover_"
    screenshot "title-hover.png"
    run Function(renpy.test.testmouse.press_mouse, 1)
    pause 0.1
    assert eval renpy.get_widget("main_menu", "vn_component_ai_title_start").vn_held
    assert eval renpy.get_widget("main_menu", "vn_component_ai_title_start").style.prefix == "activate_"
    screenshot "title-held.png"
    move pos (8, 8)
    run Function(renpy.test.testmouse.release_mouse, 1)
    pause 0.1
    assert screen "main_menu"
    assert eval not renpy.get_widget("main_menu", "vn_component_ai_title_start").vn_held
    assert eval renpy.display.focus.get_grab() is None
    click id "vn_component_ai_title_plotmap"
    assert screen "flowchart"
    $ vn_test_flow_range = renpy.get_widget("flowchart", "vn_component_ai_flowchart_items_viewport").xadjustment.range
    click id "vn_component_ai_flowchart_items_zoom_in"
    pause 0.2
    assert eval renpy.get_widget("flowchart", "vn_component_ai_flowchart_items_viewport").xadjustment.range > vn_test_flow_range
    click id "vn_component_ai_flowchart_items_zoom_out"
    screenshot "flow-locked.png"
    click id "vn_component_ai_flowchart_chapters"
    assert screen "chapter_select"
    assert eval renpy.get_widget("chapter_select", ${JSON.stringify(`vn_component_ai_chapter_items_${firstChapter.id}`)}).is_sensitive()
    assert eval not renpy.get_widget("chapter_select", ${JSON.stringify(`vn_component_ai_chapter_items_${secondChapter.id}`)}).is_sensitive()
    screenshot "chapters-locked.png"
    click id ${JSON.stringify(`vn_component_ai_chapter_items_${firstChapter.id}`)}
    pause until screen "vn_chapter_title"
    advance until ${JSON.stringify(opening.lines[0].text)}
    assert eval not main_menu
    run MainMenu(confirm=False)
    assert screen "main_menu"
    click pos (1600, 980)
    assert screen "main_menu"
    click id "vn_component_ai_title_settings"
    assert screen "preferences"
    move pos (8, 8)
    screenshot "settings.png"
    click id "vn_component_ai_settings_resolution_choice"
    assert screen "vn_preference_popup"
    screenshot "settings-window-sizes.png"
    keysym "K_ESCAPE"
    click id "vn_component_ai_settings_characters"
    assert screen "voice_settings"
    move pos (8, 8)
    screenshot "settings-character-volumes.png"
    click id "vn_component_ai_voice_close"
    pause 0.2
    screenshot "settings-after-character-return.png"
    $ print("VOICE_RETURN", bool(renpy.get_screen("preferences")), bool(renpy.get_screen("voice_settings")), bool(renpy.get_screen("main_menu")))
    assert screen "preferences"
    click id "vn_component_ai_settings_initbutton"
    assert screen "confirm"
    move pos (8, 8)
    screenshot "settings-reset-confirmation.png"
    move id "vn_component_ai_confirm_no"
    pause 0.1
    run Function(renpy.test.testmouse.press_mouse, 1)
    pause 0.1
    assert eval renpy.get_widget("confirm", "vn_component_ai_confirm_no").vn_held
    run Function(renpy.test.testmouse.release_mouse, 1)
    assert not screen "confirm"
    assert screen "preferences"
    click id "vn_component_ai_settings_buttonback"
    assert screen "main_menu"

testcase original_dialogue_and_real_save:
    click id "vn_component_ai_title_start"
    advance until ${JSON.stringify(opening.lines[1].text)}
    assert screen "say"
    assert eval renpy.get_widget("say", "what") is not None
    assert eval renpy.get_widget("say", "who") is not None
    assert eval renpy.get_widget("say", "vn_component_ai_dialogue_save").vn_bounds == (78, 69)
    move pos (8, 8)
    screenshot "dialogue-idle.png"
    move id "vn_component_ai_dialogue_save"
    pause 0.1
    screenshot "dialogue-hover.png"
    run Function(renpy.test.testmouse.press_mouse, 1)
    pause 0.1
    assert eval renpy.get_widget("say", "vn_component_ai_dialogue_save").vn_held
    assert eval renpy.get_widget("say", "vn_component_ai_dialogue_save").style.prefix == "activate_"
    screenshot "dialogue-held.png"
    assert eval renpy.get_widget("say", "vn_component_ai_dialogue_save").vn_held
    run Function(renpy.test.testmouse.release_mouse, 1)
    pause until screen "save"
    assert screen "save"
    run FilePage(1)
    click id "vn_file_slot_1"
    assert eval renpy.can_load("1-1")
    assert eval FileJson(1, "vn_ui_excerpt") == ${JSON.stringify(opening.lines[1].text)}
    screenshot "save.png"
    click id "vn_component_ai_save_back"
    assert screen "say"
    click id "vn_component_ai_dialogue_auto"
    assert eval preferences.afm_enable
    assert eval renpy.get_widget("say", "vn_component_ai_dialogue_auto").is_selected()
    screenshot "dialogue-auto-selected.png"
    click id "vn_component_ai_dialogue_auto"
    assert eval not preferences.afm_enable
    click id "vn_component_ai_dialogue_load"
    assert screen "load"
    click id "vn_file_slot_1"
    if screen "confirm":
        click id "vn_component_ai_confirm_yes"
    assert not screen "load"
    assert screen "say"
    assert eval vn_current_node == "opening"
    advance until ${JSON.stringify(opening.lines[2].text)}
    click id "vn_component_ai_dialogue_history"
    assert screen "history"
    $ vn_test_voice_history = next(i for i, entry in enumerate(_history_list) if getattr(getattr(entry, "voice", None), "filename", None) == ${JSON.stringify(voicePath)})
    $ vn_test_history_id = "vn_component_ai_history_items_%d" % vn_test_voice_history
    assert eval renpy.get_widget("history", vn_test_history_id + "_replay") is not None
    run Function(vn_preference_set, "characterVolume", 0.31, ${JSON.stringify(speakerId)})
    click id (vn_test_history_id + "_replay")
    assert eval renpy.music.get_playing(channel="vn_replayvoice") == ${JSON.stringify(voicePath)}
    assert eval abs(renpy.audio.audio.get_channel("vn_replayvoice").context.secondary_volume - 0.31) < 0.001
    click id (vn_test_history_id + "_favorite")
    assert eval ${JSON.stringify(music.id)} in persistent.vn_favorite_voices
    assert eval renpy.get_widget("history", vn_test_history_id + "_favorite").is_selected()
    screenshot "history.png"
    click id "vn_component_ai_history_back"
    assert screen "say"
    pause until eval renpy.music.get_playing(channel="vn_replayvoice") is None
    assert eval renpy.music.get_playing(channel="vn_replayvoice") is None

testcase collections_and_audio_return:
    click id "vn_component_ai_dialogue_save"
    assert screen "save"
    click id "vn_component_ai_save_back"
    run ShowMenu("gallery")
    assert screen "gallery"
    assert eval renpy.get_widget("gallery", "vn_component_ai_gallery_items") is not None
    assert eval renpy.render(renpy.get_widget("gallery", ${JSON.stringify(`vn_gallery_thumb_${firstBackground.assetId}`)}), 376, 184, 0, 0).get_size() == (376, 184)
    screenshot "gallery.png"
    click id ${JSON.stringify(`vn_gallery_${firstBackground.assetId}`)}
    assert screen "vn_gallery_image"
    click "关闭"
    assert not screen "vn_gallery_image"
    click id "vn_component_ai_gallery_soundroom"
    assert screen "music_room"
    assert eval renpy.music.get_pause(channel="music")
    click id ${JSON.stringify(`vn_component_ai_musicroom_items_${music.path}`)}
    assert eval renpy.music.get_playing(channel="vn_musicroom") == ${JSON.stringify(music.path)}
    screenshot "music.png"
    click id "vn_component_ai_musicroom_voicecollection"
    assert screen "voice_collection"
    pause until eval renpy.music.get_playing(channel="vn_musicroom") is None
    assert eval renpy.get_widget("voice_collection", ${JSON.stringify(`vn_component_ai_voicecollection_items_${music.id}`)}) is not None
    assert eval renpy.get_widget("voice_collection", ${JSON.stringify(`vn_component_ai_voicecollection_items_${music.id}`)}).vn_bounds[1] < 200
    assert eval renpy.get_widget("voice_collection", ${JSON.stringify(`vn_component_ai_voicecollection_items_favorite_${music.id}`)}).vn_bounds == (68, 68)
    click id ${JSON.stringify(`vn_component_ai_voicecollection_items_${music.id}`)}
    assert eval renpy.music.get_playing(channel="vn_replayvoice") == ${JSON.stringify(voicePath)}
    pause 0.1
    screenshot "voice-collection.png"
    click id "vn_component_ai_voicecollection_items_stop"
    pause until eval renpy.music.get_playing(channel="vn_replayvoice") is None
    assert eval renpy.music.get_playing(channel="vn_replayvoice") is None
    click id ${JSON.stringify(`vn_component_ai_voicecollection_items_favorite_${music.id}`)}
    assert eval ${JSON.stringify(music.id)} not in persistent.vn_favorite_voices
    screenshot "voice-empty-favorites.png"
    click id "vn_component_ai_voicecollection_items_filter"
    click id ${JSON.stringify(`vn_component_ai_voicecollection_items_${music.id}`)}
    assert eval renpy.music.get_playing(channel="vn_replayvoice") == ${JSON.stringify(voicePath)}
    click id "vn_component_ai_voicecollection_buttonback"
    assert screen "say"
    pause until eval renpy.music.get_playing(channel="vn_replayvoice") is None
    assert eval renpy.music.get_playing(channel="vn_replayvoice") is None
    assert eval not renpy.music.get_pause(channel="music")

testcase chapter_and_flow_progress:
    advance until screen "choice"
    click "记下劝告，放下酒坛"
    advance until screen "choice"
    click "沿墙慢行，辨认废井旁的小路"
    advance until screen "choice"
    assert eval vn_var_ai_caution == 1 and vn_var_ai_route_known is True
    assert eval ${JSON.stringify(secondChapter.id)} in persistent.vn_seen_chapters
    run ShowMenu("flowchart")
    assert screen "flowchart"
    assert eval renpy.get_widget("flowchart", ${JSON.stringify(`vn_component_ai_flowchart_items_${secondChapterNode.id}`)}).is_sensitive()
    click id "vn_component_ai_flowchart_items_locate"
    pause 0.2
    assert eval renpy.get_widget("flowchart", "vn_component_ai_flowchart_items_viewport").xadjustment.value > 0
    screenshot "flow-progress.png"
    click id "vn_component_ai_flowchart_chapters"
    assert screen "chapter_select"
    assert eval renpy.get_widget("chapter_select", ${JSON.stringify(`vn_component_ai_chapter_items_${secondChapter.id}`)}).is_selected()
    screenshot "chapters-progress.png"
    click id ${JSON.stringify(`vn_component_ai_chapter_items_${firstChapter.id}`)}
    assert screen "confirm"
    move id "vn_component_ai_confirm_no"
    pause 0.1
    run Function(renpy.test.testmouse.press_mouse, 1)
    pause 0.1
    assert eval renpy.get_widget("confirm", "vn_component_ai_confirm_no").vn_held
    run Function(renpy.test.testmouse.release_mouse, 1)
    assert screen "chapter_select"
    assert eval vn_var_ai_caution == 1 and vn_var_ai_route_known is True
    click id ${JSON.stringify(`vn_component_ai_chapter_items_${firstChapter.id}`)}
    move id "vn_component_ai_confirm_yes"
    pause 0.1
    run Function(renpy.test.testmouse.press_mouse, 1)
    pause 0.1
    assert eval renpy.get_widget("confirm", "vn_component_ai_confirm_yes").vn_held
    run Function(renpy.test.testmouse.release_mouse, 1)
    pause until screen "vn_chapter_title"
    advance until ${JSON.stringify(opening.lines[1].text)}
    assert eval vn_current_node == "opening"
    assert eval vn_var_ai_caution == 0 and vn_var_ai_route_known is False
    assert eval ${JSON.stringify(secondChapter.id)} in persistent.vn_seen_chapters
    assert eval abs(vn_preference_get("characterVolume", ${JSON.stringify(speakerId)}) - 0.31) < 0.001
    assert eval not main_menu
    assert eval renpy.showing("vn_actor_" + ${JSON.stringify(speakerId)})
    assert eval len([tag for tag in renpy.get_showing_tags() if tag.startswith("vn_actor_")]) == 1
    screenshot "speaker-and-chapter-restart.png"
`);
  await step('lint', await runRenpy(sdk, buildDir, ['lint']));
  await step('runtime', await runRenpy(sdk, buildDir, ['test', '--report-detailed'], { savedir: path.join(runDir, 'saves'), timeoutMs: 210_000 }));
  const screenshotDir = path.join(buildDir, 'tests/screenshots');
  report.screenshots = (await fs.readdir(screenshotDir)).filter(name => name.endsWith('.png')).map(name => path.join(screenshotDir, name));
  report.status = 'passed'; await save(); console.log(JSON.stringify({ report: path.join(runDir, 'report.json'), screenshots: report.screenshots.length }));
} catch (error) {
  report.status = 'failed'; report.error = error instanceof Error ? error.message : String(error);
  await fs.mkdir(runDir, { recursive: true }); await save(); console.error(report.error); process.exitCode = 1;
}
