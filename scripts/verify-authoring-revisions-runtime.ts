import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { createProject } from '../src/core/model';
import { createVisualObject } from '../src/core/visual-object';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { arrangePerformanceTimeline, performanceTimeline } from '../src/core/performance-timeline';
import { applyTextScript } from '../src/core/text-script';
import { buildProject, runRenpy } from '../src/runtime/service';
import { saveProject } from '../src/desktop/project-store';

const root = path.resolve('.'), output = path.join(root, 'artifacts/authoring-revisions', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const base = createProject('轨道层级与进度解锁验收');
base.width = 800; base.height = 450; base.playerDefaults = { textSpeed: 0, masterVolume: 0 };
base.parameterSets = [{ id: 'progress_set', name: '剧情进度', kind: 'story' }];
base.variables = [{ id: 'progress', name: '章节进度', type: 'number', initial: 0, persistent: true, parameterSetId: 'progress_set' }];
for (const [id, color] of [['red', [220, 40, 40]], ['blue', [40, 70, 220]]] as const) {
  const png = new PNG({ width: 80, height: 45 });
  for (let i = 0; i < png.data.length; i += 4) { png.data[i] = color[0]; png.data[i + 1] = color[1]; png.data[i + 2] = color[2]; png.data[i + 3] = 255; }
  await fs.writeFile(path.join(output, id + '.png'), PNG.sync.write(png));
  base.assets.push({ id, name: id, kind: 'image', path: id + '.png', category: 'scene' });
}
base.ui.pages = { gallery: { layout: 'custom' } };
base.ui.components = [{ id: 'gallery', kind: 'galleryGrid', page: 'gallery', text: '', x: .1, y: .15, width: .8, height: .7, list: { columns: 2, rows: 1, galleryGroups: [
  { id: 'second_chapter', name: '第2章', assetIds: ['red'], unlockWhen: { kind: 'compare', variableId: 'progress', operator: 'gte', value: 2 } },
  { id: 'after_second', name: '第2章之后', assetIds: ['blue'], unlockWhen: { kind: 'compare', variableId: 'progress', operator: 'gt', value: 2 } },
] } }];
const graphs = [false, true].map(reverse => {
  const picture = { ...createVisualObject('image', 'red'), instanceId: reverse ? 'picture_back' : 'picture_front', name: '前景图片', duration: 1.5 };
  const graph = blueprintFromPerformance(base, [picture, { kind: 'chapter', title: '章节演出', subtitle: '', duration: 3.5, effect: 'none', wait: false }], reverse ? '章节在上' : '图片在上');
  graph.timelineComponent = true; graph.performanceKind = 'standalone'; graph.playback = { clickSkip: false };
  base.blueprints.push(graph);
  const model = performanceTimeline(base, graph);
  arrangePerformanceTimeline(base, graph, model.clips.map(clip => ({ ...clip, at: graph.nodes.find(node => node.id === clip.nodeId)?.type === 'showChapter' ? 0 : 1 })), reverse ? [...model.tracks].reverse() : model.tracks);
  return graph;
});
const parsed = applyTextScript(base, `@入口：更新进度【progress_update】
# 段落：更新进度【progress_update】
@设置：如果 章节进度 < 2，章节进度 = 2
# 段落：结果【progress_result】
旁白：Progress updated.
@结局演出：文字=未完待续，时长=1.5
@返回标题界面`);
assert.deepEqual(parsed.issues, []);
const project = parsed.project;
await saveProject(path.join(output, 'project.vns.json'), project);
const game = path.join(output, 'game'), sdk = path.join(root, 'resources/runtime');
const built = await buildProject({ project, projectDir: output, outputDir: game, sdkRoot: sdk });
assert.ok(built.ok, JSON.stringify(built.diagnostics) + built.log);
await fs.writeFile(path.join(game, 'game/testcases.rpy'), `
init python:
    import time as qa_time

${graphs.map((graph, index) => `label qa_layer_${index}:
    window hide
    $ vn_performance_begin({"clickSkip": False, "onComplete": "next"})
    call vn_blueprint_${graph.id}
    $ vn_performance_finish({"clickSkip": False, "onComplete": "next"})
    "Layer ${index} finished."
    return
`).join('\n')}

label qa_skippable:
    window hide
    $ vn_performance_begin({"clickSkip": True, "onComplete": "next"})
    call vn_blueprint_${graphs[0].id}
    $ vn_performance_finish({"clickSkip": True, "onComplete": "next"})
    "Skipped."
    return

testsuite global:
    before testcase:
        $ _test.timeout = 20.0
        $ _test.transition_timeout = .05
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
        $ preferences.afm_enable = False
    teardown:
        exit

testcase revisions:
    $ persistent.vn_var_progress = 0
    click id "vn_main_start"
    pause until "Progress updated."
    assert eval persistent.vn_var_progress == 2
    run ShowMenu("gallery")
    assert eval renpy.get_widget("gallery", "vn_gallery_second_chapter").is_sensitive()
    assert eval not renpy.get_widget("gallery", "vn_gallery_after_second").is_sensitive()
    screenshot "progress-two.png"
    $ persistent.vn_unlocks = ["blue"]
    $ renpy.restart_interaction()
    pause .1
    assert eval not renpy.get_widget("gallery", "vn_gallery_after_second").is_sensitive()
    $ vn_parameter_set("progress", 3)
    pause .1
    assert eval renpy.get_widget("gallery", "vn_gallery_after_second").is_sensitive()
    click id "vn_gallery_after_second"
    assert screen "vn_gallery_image"
    assert eval renpy.get_screen("vn_gallery_image").scope["paths"] == ["blue.png"]
    screenshot "unlocked-blue.png"
    keysym "K_ESCAPE"
    assert not screen "vn_gallery_image"
    keysym "K_ESCAPE"
    pause .15
    assert not screen "gallery"
    assert eval not _menu
    $ vn_parameter_set("progress", 5)
    run Jump("vn_node_progress_update")
    pause until "Progress updated."
    assert eval persistent.vn_var_progress == 5
    click pos (650, 100)
    pause .3
    assert eval vn_performance_active
    assert eval renpy.showing("vn_visual_ending_title")
    assert not screen "vn_ending"
    screenshot "ordinary-ending.png"
    click pos (650, 100)
    pause until screen "main_menu"
    assert eval persistent.vn_var_progress == 5
    run ShowMenu("gallery")
    assert eval renpy.get_widget("gallery", "vn_gallery_after_second").is_sensitive()
    keysym "K_ESCAPE"
    pause until screen "main_menu"
    click id "vn_main_start"
    pause until "Progress updated."
    assert eval persistent.vn_var_progress == 5

    run Jump("qa_layer_0")
    pause 1.4
    assert eval renpy.get_screen("vn_chapter_title", layer="master") is not None
    assert eval dict(renpy.get_zorder_list("master"))["vn_chapter_title"] < dict(renpy.get_zorder_list("master"))["vn_visual_picture_front"]
    screenshot "image-above-chapter.png"
    click pos (650, 100)
    pause .15
    assert eval vn_performance_active
    pause 1.1
    screenshot "image-ended-chapter.png"
    pause until "Layer 0 finished."
    run Jump("qa_layer_1")
    pause 1.4
    assert eval dict(renpy.get_zorder_list("master"))["vn_chapter_title"] > dict(renpy.get_zorder_list("master"))["vn_visual_picture_back"]
    screenshot "chapter-above-image.png"
    pause until "Layer 1 finished."
    run Jump("qa_skippable")
    pause .3
    $ qa_started = qa_time.monotonic()
    click pos (650, 100)
    pause until "Skipped."
    assert eval qa_time.monotonic() - qa_started < 1
    assert eval renpy.get_screen("vn_chapter_title", layer="master") is None
`);
const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 90000, env: { RENPY_RENDERER: 'gl2', SDL_VIDEO_WINDOW_POS: '2400,0' } });
await fs.writeFile(path.join(output, 'runtime.log'), result.log);
assert.equal(result.code, 0, result.log.slice(-7000));
assert.match(result.log, /Test cases\s*:\s*1\s*\|\s*1 passed/);
const files = await fs.readdir(path.join(game, 'tests/screenshots'), { recursive: true });
for (const [name, red] of [['image-above-chapter.png', true], ['image-ended-chapter.png', false], ['chapter-above-image.png', false]] as const) {
  const file = files.find(file => file.endsWith(name)); assert.ok(file, name);
  const png = PNG.sync.read(await fs.readFile(path.join(game, 'tests/screenshots', file))), i = (Math.floor(png.height / 4) * png.width + Math.floor(png.width / 2)) * 4;
  assert.ok(red ? png.data[i] > 180 && png.data[i + 2] < 80 : png.data[i] < 25 && png.data[i + 2] < 25, name + ': ' + [...png.data.slice(i, i + 3)]);
}
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks: ['上轨图片遮住下轨章节演出', '交换轨道后章节演出遮住图片', '图片到期后下方章节继续可见', '章节演出允许和禁止点击跳过', '普通结局演出后返回标题', '条件赋值保留高进度', '图鉴 >=2 与 >2 的边界、看过图片不绕过参数条件', '返回标题及重新开局保留参数解锁'] }, null, 2));
console.log(output);
