
import {promises as fs} from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {projectSchema} from '../src/core/model';import {buildProject,runRenpy} from '../src/runtime/service';
const root=path.resolve('.'),source=path.join(root,'resources/templates/aihong'),output=path.join(root,'artifacts/music-page-verification',new Date().toISOString().replaceAll(':','-')),game=path.join(output,'game'),sdk=path.join(root,'resources/runtime');await fs.mkdir(output,{recursive:true});
const project=projectSchema.parse(JSON.parse(await fs.readFile(path.join(source,'project.vns.json'),'utf8')));const built=await buildProject({project,projectDir:source,outputDir:game,sdkRoot:sdk,development:true});assert.ok(built.ok,built.log);
await fs.writeFile(path.join(game,'game/testcases.rpy'),`
init -999 python:
    import renpy as _engine
    _engine.safe_mode_checked = True
testsuite global:
    before testcase:
        $ _test.timeout = 30.0
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit
testcase pages:
    pause 2
    move pos (8, 8)
    screenshot "title.png"
    click id "vn_component_ai_title_settings"
    assert screen "preferences"
    move pos (8, 8)
    screenshot "settings.png"
    click id "vn_component_ai_settings_characters"
    assert screen "voice_settings"
    move pos (8, 8)
    screenshot "character-volume.png"
    click id "vn_component_ai_voice_close"
    run ShowMenu("load")
    assert screen "load"
    screenshot "load.png"
    run ShowMenu("gallery")
    assert screen "gallery"
    screenshot "gallery.png"
    click id "vn_component_ai_gallery_soundroom"
    assert screen "music_room"
    screenshot "music-locked.png"
    python:
        for track_name, track_path in vn_music_entries:
            renpy.mark_audio_seen(track_path)
    run ShowMenu("music_room")
    pause 0.2
    assert eval all(vn_music_room.is_unlocked(track_path) for track_name, track_path in vn_music_entries)
    screenshot "music.png"
    click id "vn_component_ai_musicroom_items_assets/ai_story_music_city.ogg"
    pause 0.4
    assert eval renpy.music.get_playing(channel="vn_musicroom") == "assets/ai_story_music_city.ogg"
    click id "vn_component_ai_musicroom_items_page_1"
    screenshot "music-page-2.png"
    click id "vn_component_ai_musicroom_items_assets/ai_music_room_20.ogg"
    pause 0.4
    assert eval renpy.music.get_playing(channel="vn_musicroom") == "assets/ai_music_room_20.ogg"
    click id "vn_component_ai_musicroom_items_page_0"
    screenshot "music-return-page-1.png"
    click id "vn_component_ai_musicroom_voicecollection"
    assert screen "voice_collection"
    screenshot "voice-collection.png"
    assert eval renpy.music.get_playing(channel="vn_musicroom") is None
`);
const result=await runRenpy(sdk,game,['test','--report-detailed'],{savedir:path.join(output,'saves'),timeoutMs:60000});await fs.writeFile(path.join(output,'runtime.log'),result.log);assert.equal(result.code,0,result.log);await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',source,original:path.join(root,'artifacts/original-pages-2026-10-02'),screenshots:await fs.readdir(path.join(game,'tests/screenshots')),limitation:'Current template default unlock/save state differs from the original user profile. Capture alone is not fidelity verification.'},null,2));console.log(output);
