import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { createProject } from '../src/core/model';
import { createVisualObject } from '../src/core/visual-object';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { arrangePerformanceTimeline, performanceTimeline } from '../src/core/performance-timeline';
import { buildProject, runRenpy } from '../src/runtime/service';
import { blueprintNodeDefaults, callablePins, connectBlueprintPins } from '../src/core/blueprint';

const root = path.resolve('.'), output = path.join(root, 'artifacts/timeline-layer-runtime', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const project = createProject('轨道层级与片段结束验收');
for (const [id, color] of [['red', [220, 40, 40]], ['blue', [40, 70, 220]]] as const) {
  const png = new PNG({ width: 160, height: 90 });
  for (let i = 0; i < png.data.length; i += 4) { png.data[i] = color[0]; png.data[i + 1] = color[1]; png.data[i + 2] = color[2]; png.data[i + 3] = 255; }
  await fs.writeFile(path.join(output, id + '.png'), PNG.sync.write(png));
  project.assets.push({ id, name: id, kind: 'image', path: id + '.png' });
}
const red = { ...createVisualObject('image', 'red'), instanceId: 'red_clip', layer: -500, duration: 1.4, imageFit: 'contain' as const };
const blue = { ...createVisualObject('image', 'blue'), instanceId: 'blue_clip', layer: 500, duration: 3, imageFit: 'contain' as const };
const graphs = [false, true].map(reverse => {
  const graph = blueprintFromPerformance(project, [red, blue], reverse ? '蓝图在上' : '红图在上'); project.blueprints.push(graph);
  const model = performanceTimeline(project, graph);
  arrangePerformanceTimeline(project, graph, model.clips.map(c => ({ ...c, at: 0 })), reverse ? [...model.tracks].reverse() : model.tracks);
  return graph;
});
const parents = [0, .25].map(delay => {
  const child = blueprintFromPerformance(project, [red, blue], '内层 ' + delay); project.blueprints.push(child);
  const inside = performanceTimeline(project, child); arrangePerformanceTimeline(project, child, inside.clips.map(c => ({ ...c, at: delay })), inside.tracks);
  const parent = blueprintFromPerformance(project, [{ ...blue, instanceId: 'outer_blue' }], '外层 ' + delay); project.blueprints.push(parent);
  const call = blueprintNodeDefaults('callFunction'); call.properties = { graphId: child.id, wait: false }; call.pins = callablePins(child);
  const last = parent.nodes.at(-1)!; parent.nodes.push(call); connectBlueprintPins(parent, last.id, 'exec_out', call.id, 'exec_in');
  const model = performanceTimeline(project, parent); arrangePerformanceTimeline(project, parent, model.clips.map(c => ({ ...c, at: 0 })), model.tracks);
  return parent;
});
const game = path.join(output, 'game'), sdk = path.join(root, 'resources/runtime');
const built = await buildProject({ project, projectDir: output, outputDir: game, sdkRoot: sdk }); assert.ok(built.ok, JSON.stringify(built.diagnostics));
await fs.writeFile(path.join(output, 'project.vns.json'), JSON.stringify(project));
await fs.writeFile(path.join(game, 'game/testcases.rpy'), `
label qa_red_above:
    scene
    call vn_blueprint_${graphs[0].id}(vn_bp_launch_${graphs[0].id}=True)
    "观察上方红色片段。"
    return
label qa_blue_above:
    scene
    call vn_blueprint_${graphs[1].id}(vn_bp_launch_${graphs[1].id}=True)
    "观察调整轨道后的蓝色片段。"
    return
${parents.map((parent, index) => `label qa_nested_${index}:
    scene
    call vn_blueprint_${parent.id}(vn_bp_launch_${parent.id}=True)
    "嵌套层级 ${index}。"
    return`).join('\n')}
testsuite global:
    before testcase:
        $ _test.timeout = 15.0
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit
testcase track_order_and_expiry:
    click id "vn_main_start"
    run Jump("qa_red_above")
    pause until "观察上方红色片段。"
    pause 0.25
    assert eval dict(renpy.get_zorder_list("master"))["vn_visual_red_clip"] > dict(renpy.get_zorder_list("master"))["vn_visual_blue_clip"]
    screenshot "red-above.png"
    pause 1.4
    screenshot "red-ended-blue-visible.png"
    run Jump("qa_blue_above")
    pause until "观察调整轨道后的蓝色片段。"
    pause 0.25
    assert eval dict(renpy.get_zorder_list("master"))["vn_visual_blue_clip"] > dict(renpy.get_zorder_list("master"))["vn_visual_red_clip"]
    screenshot "blue-above.png"
    run Jump("qa_nested_0")
    pause until "嵌套层级 0。"
    pause 0.25
    assert eval dict(renpy.get_zorder_list("master"))["vn_visual_outer_blue"] > dict(renpy.get_zorder_list("master"))["vn_visual_red_clip"]
    screenshot "nested-immediate.png"
    run Jump("qa_nested_1")
    pause until "嵌套层级 1。"
    pause 0.25
    assert eval dict(renpy.get_zorder_list("master"))["vn_visual_outer_blue"] > dict(renpy.get_zorder_list("master"))["vn_visual_red_clip"]
    screenshot "nested-delayed.png"
`);
const run = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 60000, env: { SDL_VIDEO_WINDOW_POS: '2400,0' } });
await fs.writeFile(path.join(output, 'runtime.log'), run.log);
assert.equal(run.code, 0, run.log.slice(-3500));
const files = await fs.readdir(path.join(game, 'tests/screenshots'), { recursive: true });
for (const [name, expected] of [['red-above.png', 'red'], ['red-ended-blue-visible.png', 'blue'], ['blue-above.png', 'blue'], ['nested-immediate.png', 'blue'], ['nested-delayed.png', 'blue']]) {
  const file = files.find(file => file.endsWith(name)); assert.ok(file, JSON.stringify(files));
  const png = PNG.sync.read(await fs.readFile(path.join(game, 'tests/screenshots', file))), i = (Math.floor(png.height / 4) * png.width + Math.floor(png.width / 2)) * 4;
  assert.ok(expected === 'red' ? png.data[i] > 180 && png.data[i + 2] < 80 : png.data[i + 2] > 180 && png.data[i] < 80, name + ': ' + [...png.data.slice(i, i + 3)]);
}
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks: ['原生上轨覆盖下轨，忽略旧数值层级', '红片段结束后显示仍在播放的蓝片段', '交换轨道顺序后原生画面同步', '即时及带内部延迟的嵌套时间轴位于父轨道分配范围', '五个实际屏幕截图颜色核对'] }, null, 2));
console.log(output);
