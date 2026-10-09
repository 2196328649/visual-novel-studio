import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { createProject } from '../src/core/model';
import { buildProject, runRenpy } from '../src/runtime/service';
import { pythonLiteral } from '../src/runtime/literals';

const output = path.resolve('artifacts/particle-rendering', new Date().toISOString().replaceAll(':', '-'));
const project = createProject('粒子批量渲染验收'); project.width = 800; project.height = 450;
project.playerDefaults = { textSpeed: 0, fullscreen: false, masterVolume: 0 };
const story = project.nodes.find(n => n.kind === 'passage')!;
story.lines = [{ id: 'ready', text: 'Ready.', actions: [] }]; project.entryId = story.id;
const particles = Array.from({ length: 96 }, (_, i) => ({ x: (i % 16) / 15, y: Math.floor(i / 16) / 5,
  size: [1.8, 3.2, 7.9, 18.2, 36.9, 70][i % 6], opacity: [0, .07, .3, .72, 1][i % 5], color: ['#ffffff', '#ef3272', '#00a5c8', '#30205088'][i % 4] }));
particles.push({ x: .5, y: .5, size: 70, opacity: .5, color: '#ffa020' }, { x: .52, y: .53, size: 48, opacity: .7, color: '#003080' });
const game = path.join(output, 'game'), sdk = path.resolve('resources/runtime');
const built = await buildProject({ project, projectDir: output, outputDir: game, sdkRoot: sdk }); assert.ok(built.ok, built.log);
const scenarios = [false, true].flatMap(glyph => [false, true].map(transformed => ({ glyph, transformed, id: `${glyph ? 'glyph' : 'square'}-${transformed ? 'transformed' : 'plain'}` })));
await fs.writeFile(path.join(game, 'game/testcases.rpy'), `
init 1000 python:
    qa_particles = ${pythonLiteral(particles)}
    def qa_reference(glyph):
        child = Fixed(xysize=(800, 450))
        for p in qa_particles:
            if p["opacity"] <= 0 or p["size"] <= 0:
                continue
            size = max(1, int(p["size"]))
            sprite = Solid(p["color"], xysize=(size, size))
            if glyph:
                sprite = Transform(sprite, mesh=True, shader="vn.chapter_particle")
            child.add(Transform(sprite, xpos=absolute(p["x"] * 800 - size * .5), ypos=absolute(p["y"] * 450 - size * .5), alpha=p["opacity"], subpixel=True))
        return child
    def qa_snapshot(glyph, transformed, reference):
        global vn_interface_visible, quick_menu
        vn_interface_visible = False
        quick_menu = False
        renpy.hide_screen("say")
        renpy.scene()
        renpy.show("qa_background", what=Solid("#203050"))
        child = qa_reference(glyph) if reference else VNVisualParticles(qa_particles, 800, 450, glyph, "#ffffff")
        if transformed:
            child = Transform(child, zoom=.74, rotate=17, alpha=.65, subpixel=True)
        renpy.show("qa_particles", what=Transform(child, align=(.5, .5), subpixel=True))
        renpy.restart_interaction()

label qa_particle_save:
    $ qa_snapshot(True, True, False)
    "Hold particles."

testsuite global:
    before testcase:
        $ _test.timeout = 15
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit
testcase rendering:
    click id "vn_main_start"
    pause until "Ready."
${scenarios.flatMap(s => [true, false].map(reference => `    run Function(qa_snapshot, ${pythonLiteral(s.glyph)}, ${pythonLiteral(s.transformed)}, ${pythonLiteral(reference)})
    pause .1
    screenshot "${s.id}-${reference ? 'reference' : 'batch'}.png"`)).join('\n')}
    run Jump("qa_particle_save")
    pause .1
    assert eval renpy.showing("qa_particles")
    screenshot "saved.png"
    run FileSave("particle_batch", confirm=False, slot=True)
    assert eval renpy.can_load("particle_batch")
    run FileLoad("particle_batch", confirm=False, slot=True)
    pause .1
    assert eval renpy.showing("qa_particles")
    screenshot "restored.png"
`);
const run = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 60000, env: { RENPY_RENDERER: 'gl2' } });
await fs.writeFile(path.join(output, 'runtime.log'), run.log); assert.equal(run.code, 0, run.log.slice(-6000));
const compare = async (aName: string, bName: string) => {
  const directory = path.join(game, 'tests/screenshots');
  const a = PNG.sync.read(await fs.readFile(path.join(directory, aName + '.png'))), b = PNG.sync.read(await fs.readFile(path.join(directory, bName + '.png')));
  assert.equal(a.width, b.width); assert.equal(a.height, b.height);
  let error = 0, maxDelta = 0, changed = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    let peak = 0;
    for (let c = 0; c < 3; c++) { const delta = Math.abs(a.data[i + c] - b.data[i + c]); error += delta; peak = Math.max(peak, delta); }
    maxDelta = Math.max(maxDelta, peak); if (peak > 3) changed++;
  }
  return { a: aName, b: bName, meanError: error / (a.width * a.height * 3), maxDelta, changedFraction: changed / (a.width * a.height) };
};
const comparisons = await Promise.all(scenarios.map(s => compare(s.id + '-reference', s.id + '-batch')));
const restored = await compare('saved', 'restored');
const passed = comparisons.every(c => c.meanError < .01 && c.maxDelta <= 2) && restored.maxDelta === 0;
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: passed ? 'passed' : 'failed', comparisons, restored, checks: ['soft glyphs and square particles', 'subpixel placement and ordered alpha overlap', 'parent scale, rotation and opacity', 'save/load after rendering native meshes'] }, null, 2));
console.log(output); console.log(JSON.stringify({ comparisons, restored }));
assert.ok(passed, 'Batched particles must match individual sprite rendering');
