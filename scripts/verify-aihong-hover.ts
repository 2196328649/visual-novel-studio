import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { projectSchema } from '../src/core/model';
import { buildProject, runRenpy } from '../src/runtime/service';
const root = path.resolve('.'), template = path.join(root, 'resources/templates/aihong');
const output = path.join(root, 'artifacts/aihong-hover', new Date().toISOString().replaceAll(':', '-'));
const project = projectSchema.parse(JSON.parse(await fs.readFile(path.join(template, 'project.vns.json'), 'utf8')));
project.playerDefaults = { ...project.playerDefaults, fullscreen: false, windowSize: '1280x720' };
const sdk = path.join(root, 'resources/runtime'), game = path.join(output, 'game');
await fs.mkdir(output, { recursive: true });
const built = await buildProject({ project, projectDir: template, sdkRoot: sdk, outputDir: game, development: true });
assert.ok(built.ok, built.log + JSON.stringify(built.diagnostics));
await fs.writeFile(path.join(game, 'game/testcases.rpy'), `init 999 python:
    vn_feedback = []
    vn_original_play = renpy.audio.music.play
    def vn_record_play(filenames, channel="music", **kwargs):
        if channel == "vn_ui_feedback":
            vn_feedback.append(filenames)
        return vn_original_play(filenames, channel=channel, **kwargs)
    renpy.audio.music.play = vn_record_play

testsuite global:
    before testcase:
        $ _test.timeout = 15.0
        $ _test.transition_timeout = 0.05
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit

testcase original_menu_sounds:
    pause until screen "main_menu"
    move pos (2, 2)
    $ vn_feedback[:] = []
    move id "vn_component_ai_title_start"
    pause 0.05
    assert eval len(vn_feedback) == 1
    assert eval vn_feedback[-1].endswith("Highlight_New.ogg")
    pause 0.3
    assert eval len(vn_feedback) == 1
    screenshot "title-hover.png"
    click id "vn_component_ai_title_settings"
    pause until screen "preferences"
    move id "vn_component_ai_settings_buttonback"
    pause 0.05
    assert eval vn_feedback[-1].endswith("鼠标滑动.ogg")
    $ vn_count = len(vn_feedback)
    move id "vn_component_ai_settings_isnotfullscreen_window"
    pause 0.05
    assert eval len(vn_feedback) == vn_count
    click id "vn_component_ai_settings_buttonback"
    pause until screen "main_menu"
    click id "vn_component_ai_title_archive"
    pause until screen "load"
    move id "vn_component_ai_save_back"
    pause 0.05
    assert eval vn_feedback[-1].endswith("鼠标滑动.ogg")
    click id "vn_component_ai_save_back"
    pause until screen "main_menu"
    click id "vn_component_ai_title_gallery"
    pause until screen "gallery"
    move id "vn_component_ai_gallery_soundroom"
    pause 0.05
    assert eval vn_feedback[-1].endswith("鼠标滑动.ogg")
    click id "vn_component_ai_gallery_soundroom"
    pause until screen "music_room"
    move id "vn_component_ai_musicroom_buttonback"
    pause 0.05
    assert eval vn_feedback[-1].endswith("鼠标滑动.ogg")
    screenshot "music-hover.png"
`);
const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 90000, env: { SDL_VIDEO_WINDOW_POS: '2400,0' } });
await fs.writeFile(path.join(output, 'runtime.log'), result.log);
const passed = result.code === 0 && /Test cases\s*:\s*1\s*\|\s*1 passed/.test(result.log);
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: passed ? 'passed' : 'failed', checks: ['原模板标题、设置、读档、画廊、音乐页音效与静音例外'] }, null, 2));
console.log(output); assert.ok(passed, result.log.slice(-4500));
