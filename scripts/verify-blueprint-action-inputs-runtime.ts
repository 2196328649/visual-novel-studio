import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { projectSchema } from '../src/core/model';
import { buildProject, runRenpy } from '../src/runtime/service';

const root = path.resolve('.'), projectFile = path.resolve(process.argv[2]), output = path.join(root, 'artifacts/blueprint-action-inputs-runtime', new Date().toISOString().replaceAll(':', '-'));
const project = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8'))), graph = project.blueprints.find(g => g.name === '输入覆盖时间轴'); assert.ok(graph);
await fs.mkdir(output, { recursive: true }); const game = path.join(output, 'game'), sdk = path.join(root, 'resources/runtime');
const built = await buildProject({ project, projectDir: path.dirname(projectFile), outputDir: game, sdkRoot: sdk }); assert.ok(built.ok, JSON.stringify(built.diagnostics));
await fs.writeFile(path.join(game, 'game/testcases.rpy'), `
init 100 python:
    qa_objects = {}
    qa_original_show = vn_show_visual
    def qa_show(data):
        qa_objects[data["instanceId"]] = data
        qa_original_show(data)
    vn_show_visual = qa_show
label qa_source_inputs:
    scene
    call vn_blueprint_${graph.id}(vn_bp_launch_${graph.id}=True)
    "检查图片和声音输入。"
    return
testsuite global:
    before testcase:
        $ _test.timeout = 20.0
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit
testcase source_edits_keep_inputs:
    click id "vn_main_start"
    run Jump("qa_source_inputs")
    pause until "检查图片和声音输入。"
    assert eval qa_objects["bound_picture"]["assetId"] == "blue"
    assert eval qa_objects["bound_picture"]["duration"] == 6.0
    assert eval qa_objects["bound_picture"]["curves"]["x"][-1]["at"] == 6.0
    assert eval qa_objects["bound_picture"]["width"] == 0.5
    assert eval abs(vn_visual_pose(qa_objects["bound_picture"], 3)["x"] - 0.5) < 0.000001
    assert eval len(vn_audio_clips) == 1
    assert eval list(vn_audio_clips.values())[0]["assetId"] == "bound_audio"
    assert eval list(vn_audio_clips.values())[0]["duration"] == 4.0
    assert eval list(vn_audio_clips.values())[0]["offset"] == 2.0
    assert eval list(vn_audio_clips.values())[0]["volume"] == 0.8
    assert eval list(vn_audio_clips.values())[0]["fadeIn"] == 0.2
    assert eval list(vn_audio_clips.values())[0].get("sourceDuration") is None
    pause 3.0
    screenshot "bound-picture.png"
    pause 1.5
    assert eval not vn_audio_clips
    screenshot "audio-ended.png"
    pause 2.0
    screenshot "finished.png"
`);
const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 60000, env: { SDL_VIDEO_WINDOW_POS: '2400,0' } });
await fs.writeFile(path.join(output, 'runtime.log'), result.log); assert.ok(result.code === 0 && /Test cases\s*:\s*1\s*\|\s*1 passed/.test(result.log), result.log.slice(-4000));
const pixels: Record<string, number> = {};
for (const name of ['bound-picture.png', 'audio-ended.png', 'finished.png']) {
  const png = PNG.sync.read(await fs.readFile(path.join(game, 'tests/screenshots', name))); let blue = 0;
  for (let i = 0; i < png.data.length; i += 4) if (png.data[i] < 100 && png.data[i + 1] < 140 && png.data[i + 2] > 180) blue++;
  pixels[name] = blue;
}
assert.ok(pixels['bound-picture.png'] > 1000 && pixels['audio-ended.png'] > 1000); assert.equal(pixels['finished.png'], 0);
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', source: projectFile, assertions: 13, bluePixels: pixels, checks: ['桌面保存工程原生运行', '图片仍使用连线素材与6秒时钟', '音频仍使用连线素材和截取参数，音量应用直接修改', '换源不沿用原元数据', '音频4秒结束与图片6秒结束'] }, null, 2)); console.log(output);
