import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { buttonEventFixture } from './lib/ui-button-event-fixture';
import { addAihongUiSounds } from './lib/aihong-ui-sounds';
import { buildProject, runRenpy } from '../src/runtime/service';

const root = path.resolve('.'), output = path.join(root, 'artifacts/ui-hover-runtime', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const { project } = buttonEventFixture();
await addAihongUiSounds(project, output);
project.ui.components.find(c => c.id === 'target')!.hoverSoundId = 'ai_ui_hover_highlight';
project.ui.components.push({ id: 'silent', kind: 'button', page: 'main', text: 'Silent', hoverSoundId: null, x: .7, y: .85, width: .2, height: .08 });
await fs.writeFile(path.join(output, 'project.vns.json'), JSON.stringify(project));
const game = path.join(output, 'game'), sdk = path.join(root, 'resources/runtime');
const built = await buildProject({ project, projectDir: output, outputDir: game, sdkRoot: sdk, development: true });
assert.ok(built.ok, built.log + JSON.stringify(built.diagnostics));
await fs.writeFile(path.join(game, 'game/testcases.rpy'), `init 999 python:
    vn_hover_calls = []
    vn_original_audio_play = renpy.audio.music.play
    def vn_record_audio_play(filenames, channel="music", **kwargs):
        if channel == "vn_ui_feedback":
            vn_hover_calls.append(filenames)
        return vn_original_audio_play(filenames, channel=channel, **kwargs)
    renpy.audio.music.play = vn_record_audio_play

testsuite global:
    before testcase:
        $ _test.timeout = 12.0
    teardown:
        exit

testcase hover_audio:
    pause until screen "main_menu"
    move pos (8, 8)
    $ vn_hover_calls[:] = []
    $ renpy.music.play("assets/音效/界面/鼠标滑动.ogg", channel="sound", loop=True)
    $ renpy.music.play("assets/音效/界面/鼠标滑动.ogg", channel="voice", loop=True)
    move id "vn_component_target"
    pause 0.05
    assert eval len(vn_hover_calls) == 1
    assert eval vn_hover_calls[-1].endswith("Highlight_New.ogg")
    assert eval renpy.music.get_playing(channel="vn_ui_feedback").endswith("Highlight_New.ogg")
    assert eval renpy.music.get_playing(channel="sound") is not None
    assert eval renpy.music.get_playing(channel="voice") is not None
    pause 0.4
    assert eval len(vn_hover_calls) == 1
    $ renpy.restart_interaction()
    pause 0.1
    assert eval len(vn_hover_calls) == 1
    move pos (8, 8)
    move id "vn_component_target"
    pause 0.05
    assert eval len(vn_hover_calls) == 2
    move id "vn_component_silent"
    pause 0.05
    assert eval len(vn_hover_calls) == 2
    $ vn_ui_set("target", "enabled", False)
    move id "vn_component_target"
    pause 0.05
    assert eval len(vn_hover_calls) == 2
    move pos (8, 8)
    $ vn_ui_set("target", "enabled", True)
    move id "vn_component_modal"
    pause 0.05
    assert eval vn_hover_calls[-1].endswith("鼠标滑动.ogg")
    $ renpy.test.testmouse.press_mouse(1)
    pause 0.1
    $ renpy.test.testmouse.release_mouse(1)
    move id "vn_component_overlay_close"
    pause 0.05
    assert eval vn_hover_calls[-1].endswith("鼠标滑动.ogg")
    click id "vn_component_overlay_close"
    assert eval "button_overlay" not in vn_ui_open_pages
    $ vn_preference_set("soundVolume", 0.25)
    assert eval abs(preferences.get_mixer("sfx") - 0.25) < 0.001
    screenshot "hover.png"
`);
const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 90000, env: { SDL_VIDEO_WINDOW_POS: '2400,0' } });
await fs.writeFile(path.join(output, 'runtime.log'), result.log);
const passed = result.code === 0 && /Test cases\s*:\s*1\s*\|\s*1 passed/.test(result.log);
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: passed ? 'passed' : 'failed' }, null, 2));
console.log(output); assert.ok(passed, result.log.slice(-5000));
