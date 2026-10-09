import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { projectSchema, type VisualObject } from '../src/core/model';
import { chapterComposition } from '../src/core/chapter-composition';
import { buildProject, runRenpy } from '../src/runtime/service';
import { pythonLiteral } from '../src/runtime/literals';

const root = path.resolve('.'), projectDir = path.join(root, 'resources/templates/aihong');
const output = path.join(root, 'artifacts/chapter-composition-fidelity', new Date().toISOString().replaceAll(':', '-'));
const game = path.join(output, 'game'), sdk = path.join(root, 'resources/runtime');
const project = projectSchema.parse(JSON.parse(await fs.readFile(path.join(projectDir, 'project.vns.json'), 'utf8')));
const chapterSuffix = process.argv.includes('--second') ? 'two' : 'one';
const title = project.assets.find(asset => asset.id === `ai_presentation_title_${chapterSuffix}`);
assert.ok(title, 'chapter title image missing');
const background = project.assets.find(asset => asset.id === `ai_presentation_chapter_${chapterSuffix}`)!;
assert.ok(background);
const chapter = { title: '第一章', subtitle: '', effect: 'ink' as const, duration: 7, backgroundId: background.id, titleImageId: title.id };
const result = chapterComposition(project, chapter), composition = result.actions.at(-1) as VisualObject;
await fs.mkdir(output, { recursive: true });
await fs.writeFile(path.join(output, 'composition.json'), JSON.stringify({ chapter, composition, warnings: result.warnings }, null, 2));
const built = await buildProject({ project, projectDir, outputDir: game, sdkRoot: sdk });
assert.ok(built.ok, built.log);
const times = [0, .25, .5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 6.8];
await fs.writeFile(path.join(game, 'game/testcases.rpy'), `
init -999 python:
    import renpy as _qa_engine
    _qa_engine.safe_mode_checked = True
init python:
    qa_time = 0.0
    qa_presence = vn_chapter_presence_update
    qa_background = vn_chapter_ripple_update
    qa_letters = vn_chapter_letters_update
    qa_particle = vn_chapter_particle_update
    def qa_freeze_presence(duration, effect, trans, st, at):
        return qa_presence(duration, effect, trans, qa_time, qa_time)
    def qa_freeze_background(duration, trans, st, at):
        return qa_background(duration, trans, qa_time, qa_time)
    def qa_freeze_letters(effect, duration, trans, st, at):
        return qa_letters(effect, duration, trans, qa_time, qa_time)
    def qa_freeze_particle(p, duration, trans, st, at):
        return qa_particle(p, duration, trans, qa_time, qa_time)
    vn_chapter_presence_update = qa_freeze_presence
    vn_chapter_ripple_update = qa_freeze_background
    vn_chapter_letters_update = qa_freeze_letters
    vn_chapter_particle_update = qa_freeze_particle
    def qa_frame(time, original):
        global qa_time, quick_menu
        qa_time = time
        quick_menu = False
        renpy.hide_screen("main_menu")
        renpy.hide_screen("say")
        renpy.hide_screen("vn_chapter_title")
        renpy.scene()
        if original:
            renpy.show_screen("vn_chapter_title", title="第一章", duration=7, effect="ink", background=${pythonLiteral(background.path.replaceAll('\\', '/'))}, title_image=${pythonLiteral(title.path.replaceAll('\\', '/'))}, _vn_wait=False)
        else:
            data = vn_prepare_visual(${pythonLiteral(composition)})
            display, delay = vn_visual_display(time, time, data)
            renpy.show("qa_composition", what=display)
        renpy.restart_interaction()

testsuite global:
    before testcase:
        $ _test.timeout = 20.0
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit
testcase chapter_composition:
${times.map((time, index) => `    run Function(qa_frame, ${time}, True)
    pause .15
    screenshot "${index}-original.png"
    run Function(qa_frame, ${time}, False)
    pause .15
    screenshot "${index}-composition.png"`).join('\n')}
`);
const runtime = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 90000 });
await fs.writeFile(path.join(output, 'runtime.log'), runtime.log);
assert.equal(runtime.code, 0, runtime.log.slice(-3000));
const comparisons = [];
for (const [index, time] of times.entries()) {
  const directory = path.join(game, 'tests/screenshots');
  const a = PNG.sync.read(await fs.readFile(path.join(directory, `${index}-original.png`))), b = PNG.sync.read(await fs.readFile(path.join(directory, `${index}-composition.png`)));
  assert.equal(a.width, b.width); assert.equal(a.height, b.height);
  const diff = new PNG({ width: a.width, height: a.height }); let error = 0, changed = 0, maxChannelDelta = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    let peak = 0;
    for (let c = 0; c < 3; c++) { const d = Math.abs(a.data[i + c] - b.data[i + c]); error += d; peak = Math.max(peak, d); diff.data[i + c] = Math.min(255, d * 4); }
    diff.data[i + 3] = 255; maxChannelDelta = Math.max(maxChannelDelta, peak); if (peak > 8) changed++;
  }
  await fs.writeFile(path.join(output, `${index}-difference.png`), PNG.sync.write(diff));
  comparisons.push({ time, meanAbsoluteError: error / (a.width * a.height * 3), maxChannelDelta, changedFraction: changed / (a.width * a.height) });
}
const passed = comparisons.every(row => row.meanAbsoluteError <= .001 && row.maxChannelDelta <= 2);
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: passed ? 'passed' : 'failed', tolerance: { meanAbsoluteError: .001, maxChannelDelta: 2 }, reference: 'existing RenPy chapter implementation using Aihong assets; not a capture of the original Unity game', comparisons }, null, 2));
console.log(output); console.log(JSON.stringify(comparisons, null, 2));
assert.ok(passed, 'Chapter composition images differ from the existing chapter rendering');
