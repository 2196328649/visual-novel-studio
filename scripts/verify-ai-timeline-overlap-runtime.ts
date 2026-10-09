import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { projectSchema } from '../src/core/model';
import { rawSavedBlueprintAction } from '../src/core/blueprint-authoring';
import { buildProject, runRenpy } from '../src/runtime/service';

const root = path.resolve('.'), projectFile = path.resolve(process.argv[2]), output = path.join(root, 'artifacts/ai-timeline-overlap-runtime', new Date().toISOString().replaceAll(':', '-'));
const project = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8'))), graph = project.blueprints.find(g => g.timeline?.clips.length === 2); assert.ok(graph);
const objects = graph.timeline!.clips.map(c => rawSavedBlueprintAction(graph.nodes.find(n => n.id === c.nodeId)!));
assert.ok(objects.every(o => o?.kind === 'visual')); const first = objects[0]!.instanceId, second = objects[1]!.instanceId;
await fs.mkdir(output, { recursive: true }); const game = path.join(output, 'game'), sdk = path.join(root, 'resources/runtime');
const built = await buildProject({ project, projectDir: path.dirname(projectFile), outputDir: game, sdkRoot: sdk }); assert.ok(built.ok, JSON.stringify(built.diagnostics));
const source = `
init 100 python:
    qa_shows = []
    qa_times = []
    qa_original_show = vn_show_visual
    def qa_show(data):
        qa_shows.append((data["instanceId"], data["duration"]))
        qa_times.append(vn_bp_clock())
        qa_original_show(data)
    vn_show_visual = qa_show
label qa_ai_timeline:
    scene
    call vn_blueprint_${graph.id}
    "时间轴已完成。"
    return
testsuite global:
    before testcase:
        $ _test.timeout = 20.0
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit
testcase corrected_timeline:
    click id "vn_main_start"
    run Jump("qa_ai_timeline")
    pause until eval len(qa_shows) == 1
    assert eval qa_shows[0] == ("${first}", 5.0)
    assert eval not renpy.showing("vn_visual_${second}", layer="master")
    pause 3.5
    assert eval len(qa_shows) == 1
    screenshot "first-only.png"
    pause until eval len(qa_shows) == 2
    assert eval qa_shows[1] == ("${second}", 1.0)
    assert eval 4.99 <= qa_times[1] - qa_times[0] <= 5.25
    pause 0.2
    screenshot "second-only.png"
    pause until "时间轴已完成。"
    assert eval len(qa_shows) == 2
    pause 0.2
    screenshot "finished.png"
`;
await fs.writeFile(path.join(game, 'game/testcases.rpy'), source);
const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 60000, env: { SDL_VIDEO_WINDOW_POS: '2400,0' } });
await fs.writeFile(path.join(output, 'runtime.log'), result.log); assert.ok(result.code === 0 && /Test cases\s*:\s*1\s*\|\s*1 passed/.test(result.log), result.log.slice(-4000));
const counts: Record<string, { red: number; blue: number }> = {};
for (const name of ['first-only.png', 'second-only.png', 'finished.png']) {
  const file = path.join(game, 'tests/screenshots', name), png = PNG.sync.read(await fs.readFile(file)); let red = 0, blue = 0;
  for (let i = 0; i < png.data.length; i += 4) { if (png.data[i] > 180 && png.data[i + 1] < 100 && png.data[i + 2] < 120) red++; if (png.data[i] < 100 && png.data[i + 1] < 140 && png.data[i + 2] > 180) blue++; }
  counts[name] = { red, blue };
}
assert.ok(counts['first-only.png'].red > 1000); assert.equal(counts['first-only.png'].blue, 0);
assert.ok(counts['second-only.png'].blue > 1000); assert.equal(counts['second-only.png'].red, 0); assert.deepEqual(counts['finished.png'], { red: 0, blue: 0 });
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', source: projectFile, assertions: 6, pixels: counts, checks: ['AI桌面保存工程原生编译运行', '第一张实际5秒且第二张不提前，调用时钟间隔验证', '第二张实际1秒，交接画面没有第一张残留', '末尾两张均消失'] }, null, 2)); console.log(output);
