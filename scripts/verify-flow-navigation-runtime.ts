import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { createProject, projectSchema, type StoryNode, type UiComponent } from '../src/core/model';
import { setStoryFlowPaginationRect, setStoryFlowScrollbarRect, storyFlowLayout } from '../src/core/story-flow';
import { storyMenuEntries } from '../src/core/story-menu';
import { buildProject, runRenpy } from '../src/runtime/service';
import { uiSkinData } from '../src/runtime/ui-runtime';
import { pythonLiteral } from '../src/runtime/literals';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { isolateRenpySaves } from './lib/renpy-saves';
import { findScreenshot, preserveRenpyScreenshots } from './lib/text-typography';

const root = path.resolve('.');
const output = path.join(path.resolve(process.env.VNS_ARTIFACT_ROOT ?? 'artifacts/flow-navigation-runtime'), 'native-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const source = path.join(output, 'source'), game = path.join(output, 'game'), sdk = path.join(root, 'resources/runtime');
const previousSaves = process.env.RENPY_PATH_TO_SAVES;
const project = createProject('剧情图浏览位置与外观验收'); project.width = 1280; project.height = 800;
const sceneId = project.scenes[0].id;
project.nodes = Array.from({ length: 6 }, (_, index): StoryNode => ({ id: `entry_${index}`, name: `剧情 ${index + 1}`, kind: 'passage', sceneId, x: index * 240, y: 0, next: index < 5 ? `entry_${index + 1}` : undefined, flowchart: { visible: true, name: `剧情 ${index + 1}` }, lines: [{ id: `line_${index}`, text: `剧情 ${index + 1}`, actions: [] }] }));
project.nodes[5] = { id: 'entry_5', name: '剧情 6', kind: 'end', sceneId, x: 1200, y: 0, flowchart: { visible: true, name: '剧情 6' } };
project.entryId = 'entry_0'; project.ui.components = [];
const colors = { track: [223, 48, 160], thumb: [50, 230, 96], page: [233, 181, 42], current: [39, 132, 232] };
project.assets = Object.keys(colors).map(id => ({ id, name: id, kind: 'image', path: `assets/${id}.png` }));
const map: UiComponent = { id: 'native_flow', page: 'flowchart', kind: 'flowchart', text: '', x: 0, y: 0, width: 1, height: 1, list: { layout: 'flow', flowViewport: { x: .1, y: .1, width: .8, height: .8 }, flowShowControls: false, flowShowVerticalScrollbar: false, flowPositions: { entry_5: { x: 2200, y: 1600 } }, flowScrollbar: { rect: { x: .15, y: .9, width: .7, height: .075 }, trackId: 'track', trackHeight: 5, thumbHeight: 31, thumb: { idle: 'thumb', fit: 'nineSlice', borders: { left: 4, top: 0, right: 4, bottom: 0 }, brightness: { pressed: .65 } } } } };
const directory: UiComponent = { ...map, id: 'native_directory', list: { layout: 'grid', columns: 1, rows: 2, itemWidth: 720, itemHeight: 80, gapY: 12, navigationRect: { x: .1, y: .8, width: .8, height: .1 }, pageSkin: { idle: 'page', selected: 'current' } } };
project.ui.components.push(map);
// Round trip old data first; simply opening it must not introduce the new fields.
const oldMap = projectSchema.parse(JSON.parse(JSON.stringify(project))).ui.components.find(c => c.id === map.id)!;
assert.equal(oldMap.list?.flowPaginationStyle, undefined);
const automaticMap = structuredClone(oldMap); setStoryFlowScrollbarRect(automaticMap);
const restoredDirectory = structuredClone(directory); setStoryFlowPaginationRect(restoredDirectory);
const oldPrevious: UiComponent = { ...directory, list: { ...directory.list, navigationRect: undefined } };
const movedPrevious = structuredClone(oldPrevious); setStoryFlowPaginationRect(movedPrevious, directory.list!.navigationRect);
const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
assert.deepEqual(automaticMap.list?.flowScrollbar, clean({ ...oldMap.list!.flowScrollbar, rect: undefined }), 'restoring position keeps every scrollbar appearance override');
assert.deepEqual(restoredDirectory.list?.pageSkin, directory.list?.pageSkin, 'restoring pagination position keeps the normal and selected skins');
assert.equal(restoredDirectory.list?.flowPaginationStyle, 'numbers');
assert.equal(movedPrevious.list?.flowPaginationStyle, 'previousNext');
const mapOptions = (component: UiComponent) => clean({ ...component.list, lockUnread: false, flowGraph: storyFlowLayout(project, component), flowScrollbar: component.list?.flowScrollbar ? { ...component.list.flowScrollbar, trackPath: 'assets/track.png', thumb: uiSkinData(project, component.list.flowScrollbar.thumb) } : undefined });
const directoryOptions = (component: UiComponent) => clean({ ...component.list, lockUnread: false, pageSkin: uiSkinData(project, component.list?.pageSkin) });
const entries = storyMenuEntries(project, 'flowchart');
assert.equal(entries.length, 6);
const flowCases = { legacy: mapOptions(oldMap), automatic: mapOptions(automaticMap), native: mapOptions({ ...oldMap, list: { ...oldMap.list, flowScrollbar: undefined, flowDirection: 'vertical' } }) };
const directoryCases = { legacy: directoryOptions(directory), automatic: directoryOptions(restoredDirectory), previous: directoryOptions(oldPrevious), moved: directoryOptions(movedPrevious) };
const report: Record<string, unknown> = { status: 'running', output, scope: '自动滚动条外观和动态显示区域；手动位置不受显示区域影响；旧格式与两种分页的自动/自定义位置' };
let phase = 'fixture', failure: unknown;
const tests = `
init -999 python:
    import renpy as _engine
    _engine.safe_mode_checked = True
init python:
    import json as qa_json
    qa_flow_cases = ${pythonLiteral(flowCases)}
    qa_directory_cases = ${pythonLiteral(directoryCases)}
    qa_flow_options = qa_flow_cases["legacy"]
    qa_directory_options = qa_directory_cases["legacy"]
    qa_width, qa_height = 1000, 520
    qa_kind = "flowchart"
    qa_evidence = {}

    def qa_flow(case):
        global qa_flow_options, qa_width, qa_height
        qa_flow_options = dict(qa_flow_cases[case])
        qa_width, qa_height = 1000, 520
        renpy.hide_screen("qa_flow")
        renpy.show_screen("qa_flow")
        renpy.restart_interaction()

    def qa_resize():
        global qa_width, qa_height
        qa_width, qa_height = 800, 400
        renpy.restart_interaction()

    def qa_viewport():
        qa_flow_options["flowViewport"] = dict(x=.2, y=.15, width=.6, height=.6)
        renpy.restart_interaction()

    def qa_controls():
        qa_flow_options["flowShowControls"] = True
        qa_flow_options["flowShowVerticalScrollbar"] = True
        renpy.restart_interaction()

    def qa_vertical():
        qa_flow_options["flowDirection"] = "vertical"
        renpy.restart_interaction()

    def qa_directory(case, kind="flowchart"):
        global qa_directory_options, qa_kind
        qa_directory_options = dict(qa_directory_cases[case])
        qa_kind = kind
        renpy.hide_screen("qa_directory")
        renpy.show_screen("qa_directory")
        renpy.restart_interaction()

    def qa_bar():
        return renpy.get_widget("qa_flow", "qa_map_scroll_x")

    def qa_view():
        return renpy.get_widget("qa_flow", "qa_map_viewport")

    def qa_texts():
        found = []
        renpy.get_screen("qa_directory").visit_all(lambda d: found.append(d.get_all_text()) if isinstance(d, renpy.text.text.Text) else None)
        return found

    def qa_record(name):
        bar, view = qa_bar(), qa_view()
        qa_evidence[name] = dict(width=bar.width, height=bar.height, page_x=view.xadjustment.page, page_y=view.yadjustment.page, axis="y" if bar.adjustment is view.yadjustment else "x", skin=getattr(bar.style.thumb, "skin", None), options=qa_json.loads(qa_json.dumps(qa_flow_options)), area=[qa_width, qa_height])
        with open(${pythonLiteral(path.join(output, 'runtime-evidence.json').replaceAll('\\', '/'))}, "w", encoding="utf-8") as file:
            qa_json.dump(qa_evidence, file, ensure_ascii=False, indent=2)

screen qa_flow():
    modal True
    zorder 250
    add Solid("#151a21")
    fixed:
        pos (70, 60)
        xysize (qa_width, qa_height)
        use vn_story_flow(qa_width, qa_height, 26, "#ffffff", "#354152", {}, qa_flow_options, "qa_map", style.default.font)

screen qa_directory():
    modal True
    zorder 260
    add Solid("#151a21")
    fixed:
        pos (100, 100)
        xysize (900, 480)
        use vn_collection(qa_kind, 900, 480, 28, "#ffffff", "#354152", {}, qa_directory_options, "qa_directory", style.default.font)

testsuite global:
    before testcase:
        $ _test.timeout = 20.0
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.transitions = 0
        $ preferences.set_mute("music", True)
        $ persistent.vn_seen_nodes = ${pythonLiteral(entries.map(entry => entry.id))}
    teardown:
        exit

testcase flow_position_and_appearance:
    pause until screen "main_menu"
    run Function(qa_flow, "legacy")
    move pos (1200, 20)
    pause .3
    assert eval qa_bar().width == 700 and qa_bar().height == 31
    assert eval qa_view().xadjustment.page == 800 and qa_view().yadjustment.page == 416
    assert eval qa_bar().adjustment is qa_view().xadjustment
    assert eval qa_bar().style.thumb.skin["idle"] == "assets/thumb.png" and qa_bar().style.thumb.skin["fit"] == "nineSlice"
    run Function(qa_record, "legacy")
    screenshot "01-legacy-custom.png"
    run Function(qa_viewport)
    run Function(qa_controls)
    pause .3
    assert eval qa_bar().width == 700 and qa_bar().height == 31
    assert eval qa_view().xadjustment.page == 576 and qa_view().yadjustment.page == 268
    assert eval qa_flow_options["flowScrollbar"]["rect"] == dict(x=.15, y=.9, width=.7, height=.075)
    assert eval qa_bar().style.thumb.skin["borders"]["left"] == 4 and qa_bar().style.thumb.skin["brightness"]["pressed"] == .65
    run Function(qa_record, "custom_changed_viewport")
    screenshot "01b-custom-changed-viewport.png"
    run Function(qa_flow, "automatic")
    pause .3
    assert eval "rect" not in qa_flow_options["flowScrollbar"]
    assert eval qa_bar().width == 800 and qa_bar().height == 31
    assert eval qa_view().xadjustment.page == 800 and qa_view().yadjustment.page == 377
    assert eval qa_bar().style.thumb.skin["brightness"]["pressed"] == .65
    run Function(qa_record, "automatic")
    screenshot "02-automatic-skin.png"
    run Function(qa_viewport)
    pause .3
    assert eval qa_bar().width == 600 and qa_bar().height == 31
    assert eval qa_view().xadjustment.page == 600 and qa_view().yadjustment.page == 273
    assert eval "rect" not in qa_flow_options["flowScrollbar"]
    assert eval qa_bar().style.thumb.skin["idle"] == "assets/thumb.png"
    run Function(qa_record, "automatic_changed_viewport")
    screenshot "02b-automatic-changed-viewport.png"
    run Function(qa_flow, "automatic")
    pause .3
    drag id "qa_map_scroll_x" pos (.05, .5) to id "qa_map_scroll_x" pos (.95, .5) steps 20
    assert eval qa_view().xadjustment.value > qa_view().xadjustment.range * .8
    run Function(qa_resize)
    move pos (1200, 20)
    pause .3
    assert eval qa_bar().width == 640 and qa_bar().height == 31
    assert eval qa_view().xadjustment.page == 640 and qa_view().yadjustment.page == 281
    assert eval "rect" not in qa_flow_options["flowScrollbar"]
    run Function(qa_record, "resized")
    screenshot "03-automatic-resized.png"
    run Function(qa_controls)
    pause .3
    assert eval qa_bar().width == 616 and qa_view().xadjustment.page == 616
    assert eval qa_view().yadjustment.page == 237
    assert id "qa_map_zoom_in"
    assert id "qa_map_scroll_y"
    run Function(qa_vertical)
    pause .3
    assert eval qa_bar().adjustment is qa_view().yadjustment
    drag id "qa_map_scroll_x" pos (.05, .5) to id "qa_map_scroll_x" pos (.95, .5) steps 20
    assert eval qa_view().yadjustment.value > qa_view().yadjustment.range * .8
    run Function(qa_record, "vertical")
    screenshot "04-automatic-vertical.png"
    run Function(qa_flow, "native")
    pause .3
    assert eval qa_bar().height == 16 and qa_bar().width == 800
    assert eval qa_view().yadjustment.page == 392
    assert eval qa_bar().adjustment is qa_view().yadjustment
    run Function(qa_record, "native_vertical")
    run Hide("qa_flow")
    pause .2

testcase directory_style_and_position:
    pause until screen "main_menu"
    run Function(qa_directory, "legacy")
    move pos (1200, 20)
    pause .3
    assert eval "flowPaginationStyle" not in qa_directory_options
    assert id "qa_directory_page_2"
    assert eval "上一页" not in qa_texts() and "下一页" not in qa_texts()
    screenshot "05-legacy-numbers.png"
    run Function(qa_directory, "automatic")
    pause .3
    assert eval "navigationRect" not in qa_directory_options and qa_directory_options["flowPaginationStyle"] == "numbers"
    assert id "qa_directory_page_2"
    assert eval qa_directory_options["pageSkin"]["idle"] == "assets/page.png" and qa_directory_options["pageSkin"]["selected"] == "assets/current.png"
    click id "qa_directory_page_2"
    move pos (1200, 20)
    pause .3
    assert eval ${pythonLiteral(entries[4].name)} in qa_texts() and ${pythonLiteral(entries[0].name)} not in qa_texts()
    screenshot "06-automatic-numbers.png"
    run Function(qa_directory, "previous")
    pause .3
    assert eval "flowPaginationStyle" not in qa_directory_options
    assert eval renpy.get_widget("qa_directory", "qa_directory_page_0") is None
    assert eval "上一页" in qa_texts() and "下一页" in qa_texts()
    screenshot "07-legacy-previous-next.png"
    run Function(qa_directory, "moved")
    pause .3
    assert eval qa_directory_options["flowPaginationStyle"] == "previousNext" and qa_directory_options["navigationRect"]["y"] == .8
    assert eval renpy.get_widget("qa_directory", "qa_directory_page_0") is None
    click "下一页"
    move pos (1200, 20)
    pause .3
    assert eval ${pythonLiteral(entries[2].name)} in qa_texts() and ${pythonLiteral(entries[0].name)} not in qa_texts()
    assert eval "2 / 3" in qa_texts()
    screenshot "08-custom-previous-next.png"
    click "上一页"
    pause .3
    assert eval ${pythonLiteral(entries[0].name)} in qa_texts() and ${pythonLiteral(entries[2].name)} not in qa_texts()
    run Function(qa_directory, "automatic", "chapterList")
    pause .3
    assert eval renpy.get_widget("qa_directory", "qa_directory_page_0") is None
    assert eval "上一页" in qa_texts() and "下一页" in qa_texts()
    run Hide("qa_directory")
    pause .2
`;

function colorBounds(image: PNG, color: number[], region = { left: 0, top: 0, right: image.width, bottom: image.height }) {
  let left = image.width, right = -1, top = image.height, bottom = -1, pixels = 0;
  for (let y = Math.max(0, Math.floor(region.top)); y < Math.min(image.height, Math.ceil(region.bottom)); y++) for (let x = Math.max(0, Math.floor(region.left)); x < Math.min(image.width, Math.ceil(region.right)); x++) {
    const at = (y * image.width + x) * 4;
    if (color.every((channel, index) => Math.abs(image.data[at + index] - channel) <= 12)) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); pixels++; }
  }
  return { left, right, top, bottom, pixels };
}

await fs.mkdir(output, { recursive: true });
try {
  await fs.mkdir(path.join(source, 'assets'), { recursive: true });
  await isolateRenpySaves(output);
  for (const [name, color] of Object.entries(colors)) {
    const png = new PNG({ width: 32, height: 32 });
    for (let offset = 0; offset < png.data.length; offset += 4) { png.data[offset] = color[0]; png.data[offset + 1] = color[1]; png.data[offset + 2] = color[2]; png.data[offset + 3] = 255; }
    await fs.writeFile(path.join(source, `assets/${name}.png`), PNG.sync.write(png));
  }
  await fs.writeFile(path.join(output, 'fixture.vns.json'), JSON.stringify(project, null, 2));
  await fs.writeFile(path.join(output, 'testcases.rpy'), tests);
  await fs.writeFile(path.join(output, 'input-cases.json'), JSON.stringify({ flowCases, directoryCases }, null, 2));
  phase = 'build';
  const built = await buildProject({ project, projectDir: source, outputDir: game, sdkRoot: sdk });
  await fs.writeFile(path.join(output, 'build.json'), JSON.stringify(built, null, 2));
  assert.equal(built.ok, true, JSON.stringify(built));
  await fs.writeFile(path.join(game, 'game/testcases.rpy'), tests);
  phase = 'native interactions';
  const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 180000, env: { RENPY_RENDERER: 'gl2', PYTHONUNBUFFERED: '1' }, onData: text => process.stdout.write(text) });
  await fs.writeFile(path.join(output, 'run.log'), result.log);
  report.code = result.code;
  report.expectedAssertions = tests.split('\n').filter(line => line.trim().startsWith('assert ')).length;
  report.assertions = Number(result.log.match(/Assertions\s*:\s*(\d+)/)?.[1] ?? NaN);
  report.cases = Number(result.log.match(/Test cases\s*:\s*(\d+)/)?.[1] ?? NaN);
  assert.equal(result.code, 0, result.log.slice(-8000));
  assert.match(result.log, /Test cases\s*:\s*2\s*\|\s*2 passed/);
  assert.equal(report.assertions, report.expectedAssertions, 'every authored native assertion must execute');
  await preserveRenpyScreenshots(game, path.join(output, 'screenshots'));
  phase = 'rendered geometry and skins';
  const pixels: Record<string, unknown> = {};
  report.pixels = pixels;
  for (const [name, thumbY, trackRight, trackWidth] of [
    ['01-legacy-custom.png', 532, 919, 700],
    ['01b-custom-changed-viewport.png', 532, 919, 700],
    ['02-automatic-skin.png', 497, 969, 800],
    ['02b-automatic-changed-viewport.png', 419, 869, 600],
    ['03-automatic-resized.png', 389, 789, 640],
  ] as const) {
    const file = await findScreenshot(path.join(output, 'screenshots'), name); assert.ok(file, name);
    const image = PNG.sync.read(await fs.readFile(file)), sx = image.width / project.width, sy = image.height / project.height;
    const thumb = colorBounds(image, colors.thumb), track = colorBounds(image, colors.track);
    // The solid thumb covers the track wherever the thumb rests. Their union
    // recovers the visible rail extent even at either endpoint after dragging.
    const rail = { left: Math.min(thumb.left, track.left), right: Math.max(thumb.right, track.right) };
    assert.ok(thumb.pixels > 100 && track.pixels > 100, `${name}: missing authored rail/skin`);
    assert.ok(Math.abs(thumb.top / sy - thumbY) < 3, `${name}: thumb vertical placement ${JSON.stringify(thumb)}`);
    assert.ok(Math.abs((thumb.bottom - thumb.top + 1) / sy - 31) < 3, `${name}: thumb height`);
    assert.ok(Math.abs((track.bottom - track.top + 1) / sy - 5) < 3, `${name}: authored track height`);
    assert.ok(Math.abs(rail.right / sx - trackRight) < 3, `${name}: track horizontal placement ${JSON.stringify(rail)}`);
    assert.ok(Math.abs((rail.right - rail.left + 1) / sx - trackWidth) < 3, `${name}: authored rail width`);
    pixels[name] = { thumb, track, rail, scale: { x: sx, y: sy } };
  }
  for (const [name, expectedLeft, expectedTop] of [['05-legacy-numbers.png', 190, 484], ['06-automatic-numbers.png', 446, 540]] as const) {
    const file = await findScreenshot(path.join(output, 'screenshots'), name); assert.ok(file, name);
    const image = PNG.sync.read(await fs.readFile(file)), sx = image.width / project.width, sy = image.height / project.height;
    const page = colorBounds(image, colors.page), current = colorBounds(image, colors.current);
    assert.ok(page.pixels > 100 && current.pixels > 100, `${name}: both normal and selected page backgrounds must remain`);
    assert.ok(Math.abs(page.top / sy - expectedTop) < 3 && Math.abs(current.top / sy - expectedTop) < 3, `${name}: numeric navigation vertical placement`);
    assert.ok(Math.abs(Math.min(page.left, current.left) / sx - expectedLeft) < 3, `${name}: numeric navigation horizontal placement`);
    pixels[name] = { page, current, scale: { x: sx, y: sy } };
  }
  for (const [name, expectedLeft, expectedRight, expectedTop, expectedBottom] of [['07-legacy-previous-next.png', 100, 1000, 540, 580], ['08-custom-previous-next.png', 190, 910, 484, 532]] as const) {
    const file = await findScreenshot(path.join(output, 'screenshots'), name); assert.ok(file, name);
    const image = PNG.sync.read(await fs.readFile(file)), sx = image.width / project.width, sy = image.height / project.height;
    // The rows end at y=272. This lower region contains only the actual previous/
    // next controls and page counter, so the check observes their rendered ink.
    const ink = colorBounds(image, [255, 255, 255], { left: 100 * sx, top: 400 * sy, right: 1000 * sx, bottom: 600 * sy });
    assert.ok(ink.pixels > 100, `${name}: no visible pagination text`);
    assert.ok(ink.top / sy >= expectedTop - 2 && (ink.bottom + 1) / sy <= expectedBottom + 2, `${name}: previous/next text must lie inside its own navigation rectangle: ${JSON.stringify(ink)}`);
    assert.ok(ink.left / sx >= expectedLeft - 2 && (ink.right + 1) / sx <= expectedRight + 2, `${name}: previous/next text must fit the navigation width`);
    pixels[name] = { ink, expectedLeft, expectedRight, expectedTop, expectedBottom, scale: { x: sx, y: sy } };
  }
  report.status = 'passed';
} catch (error) { failure = error; report.status = 'failed'; report.phase = phase; report.error = String(error); }
finally {
  let preserved = false;
  try {
    await preserveRenpyScreenshots(game, path.join(output, 'screenshots'));
    for (const name of ['errors.txt', 'traceback.txt', 'log.txt']) if (await fs.stat(path.join(game, name)).then(stat => stat.isFile()).catch(() => false)) await fs.copyFile(path.join(game, name), path.join(output, name));
    preserved = true;
  } catch (error) {
    report.status = 'failed'; report.preservationError = String(error); failure ??= error;
  } finally {
    if (previousSaves === undefined) delete process.env.RENPY_PATH_TO_SAVES; else process.env.RENPY_PATH_TO_SAVES = previousSaves;
    if (preserved) {
      try {
        report.cleanup = await cleanVerificationDirectories(output, ['source', 'game', 'saves', 'renpy-saves']);
        if ((report.cleanup as { errors: unknown[] }).errors.length) { report.status = 'failed'; failure ??= new Error('Native fixture cleanup failed'); }
      } catch (error) { report.status = 'failed'; report.cleanupError = String(error); failure ??= error; }
    } else { report.status = 'failed'; failure ??= new Error('Could not preserve native evidence; retained this run'); }
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(output);
  }
}
if (failure) throw failure;
