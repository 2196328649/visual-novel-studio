import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { projectSchema } from '../src/core/model';
import { buildProject, runRenpy } from '../src/runtime/service';
import { pythonLiteral } from '../src/runtime/literals';

// Consume the projects made by actual editor interactions, including their public inputs.
const root = path.resolve('.'), source = path.resolve(process.argv[2]);
const projectDir = path.dirname(source);
const output = path.join(root, 'artifacts/composition-editor-runtime', new Date().toISOString().replaceAll(':', '-'));
const project = projectSchema.parse(JSON.parse(await fs.readFile(source, 'utf8')));
const graphs = ['手动重建', '复用验收', '复用默认值'].map(name => project.blueprints.find(graph => graph.name === name)!);
assert.ok(graphs.every(Boolean), 'Pass the resource-instances project produced by verify-composition-editor.ts');
await fs.mkdir(output, { recursive: true });
const game = path.join(output, 'game'), sdk = path.join(root, 'resources/runtime');
const built = await buildProject({ project, projectDir, outputDir: game, sdkRoot: sdk });
await fs.writeFile(path.join(output, 'build.log'), built.log);
assert.ok(built.ok, built.log);
const times = [0, .25, .5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 6.8];
const background = project.assets.find(asset => asset.id === 'ai_presentation_chapter_one')!;
const title = project.assets.find(asset => asset.id === 'ai_presentation_title_one')!;
await fs.writeFile(path.join(game, 'game/testcases.rpy'), `
init -999 python:
    import renpy as _qa_engine
    _qa_engine.safe_mode_checked = True
init 100 python:
    import copy as _qa_copy
    qa_shows = []
    qa_original_show = vn_show_visual
    def qa_show(data):
        qa_shows.append(_qa_copy.deepcopy(data))
        qa_original_show(data)
    vn_show_visual = qa_show
    def qa_objects(data):
        result = [data]
        for child in data.get("children", []):
            result.extend(qa_objects(child))
        return result
    def qa_title(data):
        return next(item for item in qa_objects(data) if item.get("name") == "章节标题")
    def qa_glyph(data):
        return next(item for item in qa_objects(data) if item.get("glyphParticles"))
    def qa_background(data):
        return next(item for item in qa_objects(data) if item.get("name") == "章节背景")
    qa_time = 0.0
    qa_presence_update = vn_chapter_presence_update
    qa_background_update = vn_chapter_ripple_update
    qa_letters_update = vn_chapter_letters_update
    qa_particle_update = vn_chapter_particle_update
    def qa_freeze_presence(duration, effect, trans, st, at):
        return qa_presence_update(duration, effect, trans, qa_time, qa_time)
    def qa_freeze_background(duration, trans, st, at):
        return qa_background_update(duration, trans, qa_time, qa_time)
    def qa_freeze_letters(effect, duration, trans, st, at):
        return qa_letters_update(effect, duration, trans, qa_time, qa_time)
    def qa_freeze_particle(p, duration, trans, st, at):
        return qa_particle_update(p, duration, trans, qa_time, qa_time)
    vn_chapter_presence_update = qa_freeze_presence
    vn_chapter_ripple_update = qa_freeze_background
    vn_chapter_letters_update = qa_freeze_letters
    vn_chapter_particle_update = qa_freeze_particle
    def qa_frame(time, kind):
        global qa_time, quick_menu
        qa_time = time
        quick_menu = False
        renpy.hide_screen("main_menu")
        renpy.hide_screen("say")
        renpy.hide_screen("vn_chapter_title")
        renpy.scene()
        if kind == "original":
            renpy.show_screen("vn_chapter_title", title="第一章", duration=7, effect="ink", background=${pythonLiteral(background.path.replaceAll('\\', '/'))}, title_image=${pythonLiteral(title.path.replaceAll('\\', '/'))}, _vn_wait=False)
        else:
            data = vn_prepare_visual({"manual": qa_manual, "reuse": qa_reuse, "default": qa_default}[kind])
            display, delay = vn_visual_display(time, time, data)
            renpy.show("qa_composition", what=display)
        renpy.restart_interaction()
label qa_compiled_compositions:
    scene
    $ qa_shows = []
    call vn_blueprint_${graphs[0].id}
    $ qa_manual = qa_shows[-1]
    call vn_blueprint_${graphs[1].id}
    $ qa_reuse = qa_shows[-1]
    call vn_blueprint_${graphs[2].id}
    $ qa_default = qa_shows[-1]
    "组合原生验收已到达。"
    return
testsuite global:
    before testcase:
        $ _test.timeout = 40.0
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit
testcase compiled_compositions:
    run Jump("qa_compiled_compositions")
    pause until "组合原生验收已到达。"
    assert eval len(qa_shows) == 3
    assert eval qa_title(qa_manual)["assetId"] == "ai_presentation_title_one"
    assert eval qa_title(qa_reuse)["assetId"] == "ai_presentation_title_two"
    assert eval qa_glyph(qa_reuse)["glyphParticles"]["assetId"] == "ai_presentation_title_two"
    assert eval qa_title(qa_default)["assetId"] == "ai_presentation_title_one"
    assert eval qa_glyph(qa_default)["glyphParticles"]["assetId"] == "ai_presentation_title_one"
    assert eval abs(qa_background(qa_reuse)["ripple"]["speed"] - .075) < .000001
    assert eval abs(qa_background(qa_default)["ripple"]["speed"] - .075) < .000001
    assert eval qa_reuse["instanceId"] != qa_default["instanceId"]
    run Function(qa_frame, 3, "reuse")
    pause .15
    screenshot "reuse-3.png"
    run Function(qa_frame, 3, "default")
    pause .15
    screenshot "default-3.png"
${times.map((time, index) => `    run Function(qa_frame, ${time}, "original")
    pause .15
    screenshot "${index}-original.png"
    run Function(qa_frame, ${time}, "manual")
    pause .15
    screenshot "${index}-manual.png"`).join('\n')}
`);
const runtime = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 115000, env: { SDL_VIDEO_WINDOW_POS: '2400,0' } });
await fs.writeFile(path.join(output, 'runtime.log'), runtime.log);
assert.ok(runtime.code === 0 && /Test cases\s*:\s*1\s*\|\s*1 passed/.test(runtime.log), runtime.log.slice(-4000));
const comparisons = [];
for (const [index, time] of times.entries()) {
  const directory = path.join(game, 'tests/screenshots');
  const a = PNG.sync.read(await fs.readFile(path.join(directory, `${index}-original.png`))), b = PNG.sync.read(await fs.readFile(path.join(directory, `${index}-manual.png`)));
  assert.equal(a.width, b.width); assert.equal(a.height, b.height);
  const diff = new PNG({ width: a.width, height: a.height }); let error = 0, maxChannelDelta = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    for (let c = 0; c < 3; c++) { const delta = Math.abs(a.data[i + c] - b.data[i + c]); error += delta; maxChannelDelta = Math.max(maxChannelDelta, delta); diff.data[i + c] = Math.min(255, delta * 4); }
    diff.data[i + 3] = 255;
  }
  comparisons.push({ time, meanAbsoluteError: error / (a.width * a.height * 3), maxChannelDelta });
  await fs.writeFile(path.join(output, `${index}-difference.png`), PNG.sync.write(diff));
}
const passed = comparisons.every(row => row.meanAbsoluteError <= .001 && row.maxChannelDelta <= 2);
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: passed ? 'passed' : 'failed', source, checks: ['实际界面重建的标题经原生编译调用', '图片参数穿过两层组合及时间轴接口，题字与粒子同时更换', '复用实例与默认实例参数独立，资源来源修改同步', '16 个采样时刻与已有 RenPy 标题演出逐像素比较'], tolerance: { meanAbsoluteError: .001, maxChannelDelta: 2 }, comparisons }, null, 2));
console.log(output); console.log(JSON.stringify(comparisons));
assert.ok(passed, 'Manual editor title differs from existing native chapter rendering');
