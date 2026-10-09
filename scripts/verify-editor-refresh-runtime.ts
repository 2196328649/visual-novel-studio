import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { createProject } from '../src/core/model';
import { createChapterPerformance } from '../src/core/chapter-performances';
import { parseProject } from '../src/desktop/project-store';
import { compileProject } from '../src/runtime/compiler';
import { buildProject, runRenpy } from '../src/runtime/service';
import { endingVisible, endingTestHelper } from './lib/ending-fixture';
import { renderedScreenTextHelper } from './lib/renpy-screen-test';

const root = path.resolve('.'), output = path.join(root, 'artifacts/editor-refresh-runtime', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const base = createProject('Chapter and ending migration');
base.width = 800; base.height = 450; base.playerDefaults = { textSpeed: 0, masterVolume: 0 };
const png = new PNG({ width: 160, height: 90 });
for (let i = 0; i < png.data.length; i += 4) { png.data[i] = 40; png.data[i + 1] = 100; png.data[i + 2] = 170; png.data[i + 3] = 255; }
await fs.writeFile(path.join(output, 'title.png'), PNG.sync.write(png));
base.assets.push({ id: 'title_image', name: 'Title image', kind: 'image', path: 'title.png' });
const text = createChapterPerformance(base, 'text', { kind: 'chapter', title: 'Chapter One', subtitle: 'The return', duration: 3, effect: 'ink' });
const image = createChapterPerformance(base, 'image', { kind: 'chapter', title: 'Hidden image title', subtitle: '', titleImageId: 'title_image', duration: 2, effect: 'ink' });
base.blueprints.push(text, image);
const node = (id: string) => ({ id, name: id, sceneId: base.scenes[0].id, x: 0, y: 0 });
base.entryId = 'chapter_text';
const raw = { ...base, nodes: [
  { ...node('chapter_text'), kind: 'passage', next: 'after_text', lines: [{ id: 'chapter_text_line', text: '', silent: true, actions: [{ kind: 'blueprint', blueprintId: text.id }] }] },
  { ...node('after_text'), kind: 'passage', next: 'chapter_image', lines: [{ id: 'after_text_line', text: 'Text chapter finished.', actions: [] }] },
  { ...node('chapter_image'), kind: 'passage', next: 'after_image', lines: [{ id: 'chapter_image_line', text: '', silent: true, actions: [{ kind: 'blueprint', blueprintId: image.id }] }] },
  { ...node('after_image'), kind: 'passage', next: 'old_ending', lines: [{ id: 'after_image_line', text: 'Image chapter finished.', actions: [] }] },
  { ...node('old_ending'), kind: 'end', text: 'The End\nA new beginning.', mode: 'caption', unlockIds: ['title_image'] },
] };
const { project, migrated } = parseProject(raw); assert.equal(migrated, true);
const compiled = compileProject(project);
assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), []);
assert.doesNotMatch(Object.values(compiled.files).join('\n'), /vn_ending/);
const game = path.join(output, 'game'), sdk = path.join(root, 'resources/runtime');
await fs.writeFile(path.join(output, 'project.vns.json'), JSON.stringify(project, null, 2));
try {
  const built = await buildProject({ project, projectDir: output, outputDir: game, sdkRoot: sdk });
  assert.ok(built.ok, JSON.stringify(built.diagnostics) + built.log);
  await fs.writeFile(path.join(game, 'game/testcases.rpy'), `${endingTestHelper}
${renderedScreenTextHelper}
testsuite global:
    before testcase:
        $ _test.timeout = 15.0
        $ _test.transition_timeout = 0.05
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
        $ preferences.afm_enable = False
    teardown:
        exit

testcase chapter_and_migrated_ending:
    click id "vn_main_start"
    pause .7
    assert eval vn_current_node == "chapter_text" and vn_performance_active
    assert eval not vn_performance_settings["clickSkip"]
    assert eval len(vn_chapter_visual_tags) == 1
    assert not screen "say"
    assert eval not vns_test_rendered_texts("quick_menu")
    screenshot "01-text-chapter.png"
    run FileSave("qa_chapter", confirm=False, slot=True)
    click pos (700, 80)
    pause .1
    assert eval vn_current_node == "chapter_text"
    run FileLoad("qa_chapter", confirm=False, slot=True)
    assert eval vn_performance_active
    pause until "Text chapter finished."
    assert eval not vn_performance_active
    assert eval bool(vns_test_rendered_texts("quick_menu"))
    click pos (700, 80)
    pause .6
    assert eval vn_current_node == "chapter_image" and vn_performance_active
    screenshot "02-image-chapter.png"
    pause until "Image chapter finished."
    click pos (700, 80)
    pause until eval ${endingVisible(project, 'old_ending')}
    assert eval "title_image" in persistent.vn_unlocks
    pause .4
    assert eval not vns_test_rendered_texts("quick_menu")
    screenshot "03-migrated-ending.png"
    run FileSave("qa_ending", confirm=False, slot=True)
    click pos (700, 80)
    pause until screen "main_menu"
    assert eval not vn_performance_active and not renpy.showing("vn_visual_ending_title")
    run FileLoad("qa_ending", confirm=False, slot=True)
    pause until eval ${endingVisible(project, 'old_ending')}
    assert eval "title_image" in persistent.vn_unlocks
    screenshot "04-restored-ending.png"
    click pos (700, 80)
    pause until screen "main_menu"
    click id "vn_main_start"
    pause .2
    assert eval vn_current_node == "chapter_text" and vn_performance_active
`);
  const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 90000, env: { RENPY_RENDERER: 'gl2', SDL_VIDEO_WINDOW_POS: '2400,0' } });
  await fs.writeFile(path.join(output, 'runtime.log'), result.log);
  assert.equal(result.code, 0, result.log.slice(-5000));
  assert.match(result.log, /Test cases\s*:\s*1\s*\|\s*1 passed/);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks: ['ordinary text and image chapters render and finish', 'chapter click protection survives save and load', 'legacy caption and unlock migrate to ordinary visual objects', 'ending click skip, save/load, title return and new game', 'compiled runtime contains no retired ending screen'] }, null, 2));
  console.log(output);
} catch (error) { await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', error: String(error) }, null, 2)); console.log(output); throw error; }
