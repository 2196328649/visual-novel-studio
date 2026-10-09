import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { aiTimelineOverlapFixture } from './lib/ai-timeline-overlap-fixture';
import { rawSavedBlueprintAction, blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { blueprintNodeDefaults, callablePins, connectBlueprintPins } from '../src/core/blueprint';
import { arrangePerformanceTimeline, performanceTimeline } from '../src/core/performance-timeline';
import { createVisualObject } from '../src/core/visual-object';
import { buildProject, runRenpy } from '../src/runtime/service';

const root = path.resolve('.'), output = path.join(root, 'artifacts/legacy-timeline-runtime', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const { project, graph, first, second } = aiTimelineOverlapFixture();
graph.nodes.find(n => n.id === first)!.properties.object_duration = 5;
graph.nodes.find(n => n.id === second)!.properties.object_duration = 4;
const objects = [first, second].map(id => rawSavedBlueprintAction(graph.nodes.find(n => n.id === id)!));
assert.ok(objects.every(o => o?.kind === 'visual'));
const top = objects[0]!.instanceId, bottom = objects[1]!.instanceId;
const foreground = { ...createVisualObject('solid'), name: '前景', color: '#30ed40', duration: 8, width: .2, height: .2 };
const parent = blueprintFromPerformance(project, [foreground], '嵌套旧时间轴'); project.blueprints.push(parent);
const call = blueprintNodeDefaults('callFunction'); call.properties = { graphId: graph.id, wait: false }; call.pins = callablePins(graph);
const last = parent.nodes.at(-1)!; parent.nodes.push(call); connectBlueprintPins(parent, last.id, 'exec_out', call.id, 'exec_in');
const model = performanceTimeline(project, parent); arrangePerformanceTimeline(project, parent, model.clips.map(c => ({ ...c, at: 0 })), model.tracks);
const original = JSON.stringify(project); await fs.writeFile(path.join(output, 'legacy-project.vns.json'), original);
const game = path.join(output, 'game'), sdk = path.join(root, 'resources/runtime');
const built = await buildProject({ project, projectDir: output, outputDir: game, sdkRoot: sdk }); assert.ok(built.ok, JSON.stringify(built.diagnostics));
assert.equal(JSON.stringify(project), original); assert.equal(graph.timeline!.tracks.length, 1);
const source = `
init 100 python:
    qa_visuals = {}
    qa_times = {}
    qa_original_show = vn_show_visual
    def qa_show(data):
        qa_visuals[data["instanceId"]] = data
        qa_times[data["instanceId"]] = vn_bp_clock()
        qa_original_show(data)
    vn_show_visual = qa_show
label qa_legacy:
    scene
    $ qa_visuals.clear()
    $ qa_times.clear()
    call vn_blueprint_${graph.id}
    "旧时间轴完成。"
    return
label qa_nested_legacy:
    scene
    $ qa_visuals.clear()
    $ qa_times.clear()
    call vn_blueprint_${parent.id}
    "嵌套时间轴完成。"
    return
testsuite global:
    before testcase:
        $ _test.timeout = 20.0
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit
testcase legacy_rows:
    click id "vn_main_start"
    run Jump("qa_legacy")
    pause until eval "${bottom}" in qa_visuals
    assert eval qa_visuals["${top}"]["duration"] == 5
    assert eval qa_visuals["${bottom}"]["duration"] == 4
    assert eval qa_visuals["${top}"]["layer"] > qa_visuals["${bottom}"]["layer"]
    assert eval 2.99 <= qa_times["${bottom}"] - qa_times["${top}"] <= 3.25
    pause 0.3
    screenshot "overlap-top.png"
    pause 2.2
    screenshot "top-expired.png"
    pause until "旧时间轴完成。"
    screenshot "finished.png"
    run Jump("qa_nested_legacy")
    pause until eval "${bottom}" in qa_visuals
    assert eval qa_visuals["${foreground.instanceId}"]["layer"] > qa_visuals["${top}"]["layer"] > qa_visuals["${bottom}"]["layer"]
    assert eval 2.99 <= qa_times["${bottom}"] - qa_times["${top}"] <= 3.25
    pause 0.3
    screenshot "nested-overlap.png"
    pause 2.2
    screenshot "nested-top-expired.png"
    pause until "嵌套时间轴完成。"
`;
await fs.writeFile(path.join(game, 'game/testcases.rpy'), source);
const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 60000, env: { SDL_VIDEO_WINDOW_POS: '2400,0' } });
await fs.writeFile(path.join(output, 'runtime.log'), result.log); assert.ok(result.code === 0 && /Test cases\s*:\s*1\s*\|\s*1 passed/.test(result.log), result.log.slice(-4000));
const pixels: Record<string, { red: number; blue: number; green: number }> = {};
for (const name of ['overlap-top.png', 'top-expired.png', 'finished.png', 'nested-overlap.png', 'nested-top-expired.png']) {
  const png = PNG.sync.read(await fs.readFile(path.join(game, 'tests/screenshots', name))); let red = 0, blue = 0, green = 0;
  for (let i = 0; i < png.data.length; i += 4) { if (png.data[i] > 180 && png.data[i + 1] < 100 && png.data[i + 2] < 120) red++; if (png.data[i] < 100 && png.data[i + 1] < 140 && png.data[i + 2] > 180) blue++; if (png.data[i] < 100 && png.data[i + 1] > 180 && png.data[i + 2] < 120) green++; }
  pixels[name] = { red, blue, green };
}
assert.ok(pixels['overlap-top.png'].red > 1000); assert.equal(pixels['overlap-top.png'].blue, 0);
assert.ok(pixels['top-expired.png'].blue > 1000); assert.equal(pixels['top-expired.png'].red, 0);
assert.deepEqual(pixels['finished.png'], { red: 0, blue: 0, green: 0 });
assert.ok(pixels['nested-overlap.png'].red > 1000 && pixels['nested-overlap.png'].green > 1000); assert.equal(pixels['nested-overlap.png'].blue, 0);
assert.ok(pixels['nested-top-expired.png'].blue > 1000 && pixels['nested-top-expired.png'].green > 1000); assert.equal(pixels['nested-top-expired.png'].red, 0);
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', assertions: 6, pixels, checks: ['旧同轨分离保持原时间', '原生上轨在前', '上轨结束后显示下轨', '嵌套范围低于父前景', '编译不写回旧工程'] }, null, 2)); console.log(output);
