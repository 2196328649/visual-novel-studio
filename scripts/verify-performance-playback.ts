import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { createProject } from '../src/core/model';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { createVisualObject } from '../src/core/visual-object';
import { performanceTimeline, arrangePerformanceTimeline } from '../src/core/performance-timeline';
import { buildProject, runRenpy } from '../src/runtime/service';

const root = path.resolve('.'), output = path.join(root, 'artifacts/performance-playback', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const project = createProject('播放与转场验收'), sceneId = project.scenes[0].id;
project.width = 800; project.height = 450; project.playerDefaults = { textSpeed: 0, masterVolume: 0 };
const green = new PNG({ width: 80, height: 45 }); for (let i = 0; i < green.data.length; i += 4) { green.data[i] = 40; green.data[i + 1] = 180; green.data[i + 2] = 95; green.data[i + 3] = 255; }
await fs.writeFile(path.join(output, 'green.png'), PNG.sync.write(green));
project.assets.push({ id: 'green', name: 'next scene', kind: 'image', path: 'green.png' });
const create = (id: string, seconds: number, delayed = false) => {
  const object = createVisualObject('solid'); object.instanceId = id; object.duration = seconds; object.width = 1; object.height = 1; object.color = '#df384b';
  const graph = blueprintFromPerformance(project, delayed ? [object, { kind: 'pause', seconds: .6 }, { ...object, instanceId: id + '_later', duration: seconds }] : [object], id);
  graph.id = id + '_graph'; graph.timelineComponent = true; graph.performanceKind = 'standalone';
  const model = performanceTimeline(project, graph); arrangePerformanceTimeline(project, graph, model.clips, model.tracks); project.blueprints.push(graph); return graph;
};
const protectedGraph = create('protected', 1.6), skippedGraph = create('skippable', 2, true), endingGraph = create('ending', .5);
const interludeGraph = create('interlude', .4), nestedGraph = blueprintFromPerformance(project, [{ kind: 'blueprint', blueprintId: interludeGraph.id }], 'nested_interlude');
nestedGraph.id = 'nested_interlude_graph'; nestedGraph.performanceKind = 'standalone'; project.blueprints.push(nestedGraph);
const base = (id: string) => ({ id, name: id, sceneId, x: 0, y: 0 });
project.entryId = 'protected'; project.nodes = [
  { ...base('protected'), kind: 'passage', lines: [{ id: 'protected_line', text: '', silent: true, actions: [{ kind: 'blueprint', blueprintId: protectedGraph.id }], playback: { clickSkip: false, transition: { mode: 'color', outDuration: .35, hold: .2, inDuration: .35, color: '#000000' } } }], next: 'interlude' },
  { ...base('interlude'), kind: 'passage', lines: [{ id: 'interlude_line', text: '', silent: true, actions: [{ kind: 'blueprint', blueprintId: nestedGraph.id }], playback: { clickSkip: false, transition: { mode: 'color', outDuration: .2, hold: .1, inDuration: .2, color: '#000000' } } }], next: 'dialogue' },
  { ...base('dialogue'), kind: 'passage', lines: [{ id: 'dialogue_line', text: 'Protected performance finished.', actions: [{ kind: 'background', assetId: 'green', transition: 'none' }] }], next: 'chapter' },
  { ...base('chapter'), kind: 'passage', lines: [{ id: 'chapter_line', text: '', silent: true, actions: [{ kind: 'chapter', title: 'Protected chapter', subtitle: '', duration: 1.4 }], playback: { clickSkip: false } }], next: 'chapter_done' },
  { ...base('chapter_done'), kind: 'passage', lines: [{ id: 'chapter_done_line', text: 'Chapter finished.', actions: [] }], next: 'skippable' },
  { ...base('skippable'), kind: 'passage', lines: [{ id: 'skippable_line', text: '', silent: true, actions: [{ kind: 'blueprint', blueprintId: skippedGraph.id }], playback: { clickSkip: true } }], next: 'skip_done' },
  { ...base('skip_done'), kind: 'passage', lines: [{ id: 'skip_done_line', text: 'Whole performance skipped.', actions: [] }], next: 'ending' },
  { ...base('ending'), kind: 'passage', lines: [{ id: 'ending_line', text: '', silent: true, actions: [{ kind: 'blueprint', blueprintId: endingGraph.id }], playback: { clickSkip: false, onComplete: 'title' } }] },
];
const game = path.join(output, 'game'), sdk = path.join(root, 'resources/runtime');
await fs.writeFile(path.join(output, 'project.vns.json'), JSON.stringify(project, null, 2));
const built = await buildProject({ project, projectDir: output, outputDir: game, sdkRoot: sdk });
assert.ok(built.ok, JSON.stringify(built.diagnostics) + built.log);
await fs.writeFile(path.join(game, 'game/testcases.rpy'), `
init python:
    import time as qa_time
    import json as qa_json
    qa_frames = []
    qa_draw = renpy.display.core.Interface.draw_screen
    def qa_record_draw(self, root_widget, fullscreen_video, draw):
        qa_draw(self, root_widget, fullscreen_video, draw)
        if draw and vn_current_node in ("protected", "dialogue"):
            surface = renpy.display.draw.screenshot(renpy.display.interface.surftree)
            qa_frames.append(dict(time=qa_time.monotonic(), node=vn_current_node, pixel=list(surface.get_at((400, 90)))[:3], cover=bool(renpy.get_screen("vn_performance_cover", layer="master"))))
    renpy.display.core.Interface.draw_screen = qa_record_draw

    def qa_hidden_dialogue():
        assert renpy.get_widget("say", "window") is None
        screen = renpy.get_screen("say")
        if screen is not None:
            surface = renpy.render_to_surface(screen, 160, 90, resize=True)
            width, height = surface.get_size()
            assert not any(surface.get_at((x, y))[3] for y in range(height) for x in range(width))

testsuite global:
    before testcase:
        $ _test.timeout = 20.0
        $ _test.transition_timeout = 0.05
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
        $ preferences.afm_enable = False
    teardown:
        exit

testcase playback:
    click id "vn_main_start"
    pause .3
    assert eval vn_performance_active and vn_current_node == "protected"
    $ qa_json.dump(dict(until=vn_performance_until, pause_end=vn_performance_pause_end, runtime=vn_bp_clock()), open(config.basedir + "/saved-playback.json", "w"))
    run FileSave("qa_performance", confirm=False, slot=True)
    assert eval renpy.can_load("qa_performance")
    pause .15
    run FileLoad("qa_performance", confirm=False, slot=True)
    assert eval vn_performance_active and not vn_performance_settings["clickSkip"]
    assert eval abs(vn_performance_until - qa_json.load(open(config.basedir + "/saved-playback.json"))["until"]) < .01 and not _dismiss_pause
    $ qa_started = qa_time.monotonic()
    click pos (650, 100)
    pause .2
    assert eval vn_performance_active and vn_current_node == "protected"
    screenshot "protected-click.png"
    pause until "Protected performance finished."
    assert eval qa_time.monotonic() - qa_started > 1
    assert eval not vn_performance_active and not vn_performance_transition
    assert eval not renpy.showing("vn_visual_protected") and not renpy.showing("vn_visual_interlude")
    screenshot "following-dialogue.png"
    click pos (650, 100)
    pause until eval renpy.get_screen("vn_chapter_title", layer="master") is not None
    pause .3
    click pos (650, 100)
    pause .2
    assert eval renpy.get_screen("vn_chapter_title", layer="master") is not None
    run Function(qa_hidden_dialogue)
    pause until "Chapter finished."
    click pos (650, 100)
    pause .25
    assert eval vn_current_node == "skippable"
    $ qa_started = qa_time.monotonic()
    click pos (650, 100)
    pause until "Whole performance skipped."
    assert eval qa_time.monotonic() - qa_started < 1
    assert eval not renpy.showing("vn_visual_skippable") and not renpy.showing("vn_visual_skippable_later")
    assert eval _dismiss_pause
    screenshot "skipped.png"
    click pos (650, 100)
    pause until screen "main_menu"
    assert eval renpy.get_screen("vn_ending") is None
    assert eval not vn_performance_active and not vn_performance_transition
    screenshot "returned-title.png"
    $ qa_json.dump(qa_frames, open(config.basedir + "/frames.json", "w"))
`);
const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 90000, env: { RENPY_RENDERER: 'gl2', SDL_VIDEO_WINDOW_POS: '2400,0' } });
await fs.writeFile(path.join(output, 'runtime.log'), result.log);
assert.equal(result.code, 0, result.log.slice(-8000));
assert.match(result.log, /Test cases\s*:\s*1\s*\|\s*1 passed/);
const frames = JSON.parse(await fs.readFile(path.join(game, 'frames.json'), 'utf8')) as { pixel: number[]; node: string; cover: boolean }[];
assert.ok(frames.some(frame => frame.pixel.every(v => v < 5)), 'transition reaches full black');
assert.ok(frames.some(frame => frame.cover), 'transition cover is observed on the stage layer');
assert.ok(frames.some(frame => Math.abs(frame.pixel[0] - 40) < 5 && Math.abs(frame.pixel[1] - 180) < 5), 'next scene is visible');
const active = frames.filter(frame => frame.node === 'protected' && !frame.cover);
assert.ok(active.slice(-4).every(frame => frame.pixel[0] > 180), 'last visual frame persists until fade starts');
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', frames: frames.length, checks: ['protected timeline and chapter ignore clicks', 'save/load preserves protected playback and deadline', 'entire performance skips including delayed clips', 'fade through full black between performances and to dialogue', 'nested timeline completes and cleans up its visual tags', 'last frame does not disappear before fade', 'ending returns to title without default caption'] }, null, 2));
console.log(output);
