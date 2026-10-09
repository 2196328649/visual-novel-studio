import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject, projectSchema } from '../src/core/model';
import { buildProject, runRenpy } from '../src/runtime/service';

const sourceFile = path.resolve(process.env.VNS_PROFILE_PROJECT ?? 'resources/templates/aihong/project.vns.json');
const output = path.resolve('artifacts/chapter-runtime-profile', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const source = projectSchema.parse(JSON.parse(await fs.readFile(sourceFile, 'utf8')));
const project = createProject('Chapter runtime profile');
project.width = source.width; project.height = source.height;
project.playerDefaults = { textSpeed: 0, masterVolume: 0, fullscreen: false };
project.blueprints = structuredClone(source.blueprints.filter(g => g.id.startsWith('builtin_chapter_text')));
assert.ok(project.blueprints.some(g => g.id === 'builtin_chapter_text'));
const chapter = source.nodes.flatMap(n => n.kind === 'passage' ? n.lines : []).find(l => l.actions.some(a => a.kind === 'blueprint' && a.blueprintId === 'builtin_chapter_text'));
const story = project.nodes.find(n => n.kind === 'passage')!;
project.entryId = story.id;
story.lines = [
  { id: 'ready', text: 'Ready.', actions: [] },
  { id: 'chapter', text: '', silent: true, playback: { clickSkip: false }, actions: [structuredClone(chapter?.actions.find(a => a.kind === 'blueprint' && a.blueprintId === 'builtin_chapter_text') ?? { kind: 'blueprint', blueprintId: 'builtin_chapter_text' })] },
  { id: 'finished', text: 'Finished.', actions: [] },
];
const references = JSON.stringify(project);
project.assets = structuredClone(source.assets.filter(asset => references.includes(asset.id)));
await fs.writeFile(path.join(output, 'project.vns.json'), JSON.stringify(project, null, 2));
const sdk = path.resolve('resources/runtime'), game = path.join(output, 'game');
const built = await buildProject({ project, projectDir: path.dirname(sourceFile), outputDir: game, sdkRoot: sdk });
assert.ok(built.ok, built.log + JSON.stringify(built.diagnostics));
const baselineScreens = process.argv[process.argv.indexOf('--baseline-screens') + 1];
if (process.argv.includes('--baseline-screens')) await fs.copyFile(path.resolve(baselineScreens), path.join(game, 'game/screens.rpy'));
const baselineChapter = process.argv[process.argv.indexOf('--baseline-chapter') + 1];
if (process.argv.includes('--baseline-chapter')) await fs.copyFile(path.resolve(baselineChapter), path.join(game, 'game/01-vn-chapter.rpy'));
await fs.writeFile(path.join(game, 'game/testcases.rpy'), `
init 1000 python:
    import time as qa_time, json as qa_json, cProfile as qa_cprofile, pstats as qa_pstats
    qa_frames = []
    qa_updates = []
    qa_counts = {}
    qa_glyphs = {}
    qa_last_draw = None
    qa_profile = qa_cprofile.Profile()
    qa_instrumented = ${process.argv.includes('--cprofile') ? 'True' : 'False'}
    preferences.gl_framerate = 60
    def qa_counter(name):
        original = globals()[name]
        def counted(*args, **kwargs):
            root_update = name == "vn_visual_display" and len(args) < 4 and vn_current_line == "chapter"
            started = qa_time.perf_counter() if root_update else 0
            if vn_current_line == "chapter":
                qa_counts[name] = qa_counts.get(name, 0) + 1
                if name == "vn_visual_glyph_particles":
                    qa_glyphs[args[0]["instanceId"]] = args[0]["glyphParticles"]
            result = original(*args, **kwargs)
            if root_update:
                qa_updates.append(dict(elapsed=args[0], time=started, buildMs=(qa_time.perf_counter()-started)*1000))
            return result
        globals()[name] = counted
    for qa_name in ("vn_visual_text", "vn_visual_display", "vn_visual_glyph_particles"):
        qa_counter(qa_name)
    qa_draw = renpy.display.core.Interface.draw_screen
    def qa_record(self, root_widget, fullscreen_video, draw):
        global qa_last_draw
        started = qa_time.perf_counter()
        qa_draw(self, root_widget, fullscreen_video, draw)
        finished = qa_time.perf_counter()
        if draw and vn_current_line == "chapter":
            qa_frames.append(dict(clock=vn_bp_clock(), drawMs=(finished-started)*1000, frameMs=(finished-qa_last_draw)*1000 if qa_last_draw else None))
            qa_last_draw = finished
        elif draw:
            qa_last_draw = None
    renpy.display.core.Interface.draw_screen = qa_record

testsuite global:
    before testcase:
        $ _test.timeout = 25
        $ _test.maximum_framerate = False
        $ _test.transition_timeout = .1
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
        $ preferences.transitions = 2
    teardown:
        $ qa_profile.disable()
        $ qa_json.dump(dict(frames=qa_frames, updates=qa_updates, calls=qa_counts, glyphs=qa_glyphs, motionCache=vn_visual_glyph_motion.cache_info()._asdict() if "vn_visual_glyph_motion" in globals() else None, renderer=renpy.get_renderer_info()), open(config.basedir + "/frames.json", "w"))
        if eval qa_instrumented:
            $ qa_pstats.Stats(qa_profile, stream=open(config.basedir + "/profile.txt", "w")).sort_stats("cumulative").print_stats(100)
        exit

testcase chapter:
    click id "vn_main_start"
    pause until "Ready."
    pause .2
    if eval qa_instrumented:
        $ qa_profile.enable()
    click pos (1700, 200)
    pause 2.2
    assert eval vn_performance_active
    ${process.argv.includes('--screenshots') ? 'screenshot "chapter-title.png"' : ''}
    pause 1.2
    ${process.argv.includes('--screenshots') ? 'screenshot "chapter-particles.png"' : ''}
    pause until "Finished."
    assert eval not vn_performance_active
`);
const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 65000, onData: text => process.stdout.write(text), env: { RENPY_RENDERER: 'gl2', PYTHONUNBUFFERED: '1' } });
await fs.writeFile(path.join(output, 'runtime.log'), result.log);
console.log(output);
assert.equal(result.code, 0, result.log.slice(-4000));
type Frame = { clock: number; drawMs: number; frameMs: number | null };
const data: { frames: Frame[]; updates: { elapsed: number; time: number; buildMs: number }[]; calls: Record<string, number>; renderer: unknown } = JSON.parse(await fs.readFile(path.join(game, 'frames.json'), 'utf8'));
const times = data.frames.flatMap(f => f.frameMs === null ? [] : [f.frameMs]).sort((a, b) => a - b);
assert.ok(times.length > 10, 'chapter produced rendered frames');
const updates = data.updates.filter((update, i, all) => !i || update.elapsed > all[i - 1].elapsed + .001);
const intervals = updates.slice(1).map((update, i) => (update.time - updates[i].time) * 1000).sort((a, b) => a - b);
const builds = updates.map(update => update.buildMs).sort((a, b) => a - b);
const stats = (values: number[]) => ({ median: values[Math.floor(values.length * .5)], p95: values[Math.floor(values.length * .95)], maximum: values.at(-1), over50: values.filter(ms => ms > 50).length });
const report = { status: 'passed', sourceFile, requestedFrameLimit: 60, screenshots: process.argv.includes('--screenshots'), baselineScreens: process.argv.includes('--baseline-screens') ? baselineScreens : undefined, baselineChapter: process.argv.includes('--baseline-chapter') ? baselineChapter : undefined, instrumented: process.argv.includes('--cprofile'), frames: data.frames.length, animationUpdates: updates.length, animationFrameMs: stats(intervals), animationBuildMs: stats(builds), frameMs: stats(times), calls: data.calls, renderer: data.renderer };
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
