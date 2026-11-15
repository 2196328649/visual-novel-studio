import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadProject } from '../src/desktop/project-store';
import { buildProject, runRenpy } from '../src/runtime/service';
import { storyMenuEntries } from '../src/core/story-menu';
import { isolateRenpySaves } from './lib/renpy-saves';

// The template answers clicks with the original game's sounds, on buttons and on flowchart nodes alike.
const root = path.resolve('.'), source = path.join(root, 'resources/templates/aihong');
const output = path.join(root, 'artifacts/ui-click-sounds', new Date().toISOString().replaceAll(':', '-'));
const game = path.join(output, 'game'), sdk = path.join(root, 'resources/runtime');
const project = (await loadProject(path.join(source, 'project.vns.json'))).project;
const entry = storyMenuEntries(project, 'flowchart')[0].id;
await fs.mkdir(output, { recursive: true }); await isolateRenpySaves(output);
const built = await buildProject({ project, projectDir: source, outputDir: game, sdkRoot: sdk });
assert.equal(built.ok, true, JSON.stringify(built));
await fs.writeFile(path.join(game, 'game/testcases.rpy'), `
define config.savedir = ${JSON.stringify(path.join(output, 'saves').replaceAll('\\', '/'))}
init -999 python:
    import renpy as _engine
    _engine.safe_mode_checked = True
init python:
    def qa_sound():
        return renpy.music.get_playing(channel="vn_ui_feedback") or ""

    def qa_quiet():
        renpy.music.stop(channel="vn_ui_feedback")

testsuite global:
    before testcase:
        $ _test.timeout = 20.0
        $ preferences.set_mute("music", True)
        $ preferences.transitions = 0
        $ persistent.vn_seen_nodes = ${JSON.stringify(project.nodes.map(node => node.id))}
    teardown:
        exit

testcase click_sounds:
    pause until screen "main_menu"
    # Title buttons use the original's long confirm sound.
    click id "vn_component_ai_title_gallery"
    pause until screen "gallery"
    assert eval qa_sound().endswith("Click_New.ogg")
    # Tabs have no sound of their own and follow the default.
    $ qa_quiet()
    pause 0.1
    click id "vn_component_ai_gallery_soundroom"
    pause until screen "music_room"
    assert eval qa_sound().endswith("点击1.ogg")
    # Back buttons have their own.
    $ qa_quiet()
    pause 0.1
    click id "vn_component_ai_musicroom_buttonback"
    pause until screen "main_menu"
    assert eval qa_sound().endswith("点击2.ogg")
    # Items of the map take the sound set on the map.
    click id "vn_component_ai_title_plotmap"
    pause until screen "flowchart"
    $ qa_quiet()
    pause 0.3
    click id "vn_component_ai_flowchart_items_${entry}"
    pause 0.2
    assert eval qa_sound().endswith("Click_New.ogg")
`);
const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 180000, env: { RENPY_RENDERER: 'gl2' } });
await fs.writeFile(path.join(output, 'run.log'), result.log);
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: result.code === 0 ? 'passed' : 'failed', code: result.code }, null, 2));
console.log(output); console.log(result.log.slice(-1800));
assert.equal(result.code, 0);
