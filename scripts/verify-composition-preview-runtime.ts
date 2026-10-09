import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { projectSchema } from '../src/core/model';
import { buildProject, runRenpy } from '../src/runtime/service';

const root = path.resolve('.'), source = path.resolve(process.argv[2]);
const project = projectSchema.parse(JSON.parse(await fs.readFile(source, 'utf8')));
const graphs = ['预览验收', '混合复用'].map(name => project.blueprints.find(graph => graph.name === name)!);
assert.ok(graphs.every(Boolean));
const output = path.join(root, 'artifacts/composition-preview-runtime', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true }); const game = path.join(output, 'game'), sdk = path.join(root, 'resources/runtime');
const built = await buildProject({ project, projectDir: path.dirname(source), outputDir: game, sdkRoot: sdk }); assert.ok(built.ok, built.log);
await fs.writeFile(path.join(game, 'game/testcases.rpy'), `
init -999 python:
    import renpy as _qa_engine
    _qa_engine.safe_mode_checked = True
init 100 python:
    qa_visuals = []
    qa_audio = []
    qa_visual_original = vn_show_visual
    qa_audio_original = vn_audio_clip_play
    def qa_visual_record(data):
        qa_visuals.append(data)
        qa_visual_original(data)
    def qa_audio_record(data):
        qa_audio.append(data)
        qa_audio_original(data)
    vn_show_visual = qa_visual_record
    vn_audio_clip_play = qa_audio_record
label qa_mixed_compositions:
    scene
    call vn_blueprint_${graphs[0].id}
    call vn_blueprint_${graphs[1].id}
    "混合组合已完成。"
    return
testsuite global:
    before testcase:
        $ _test.timeout = 25.0
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit
testcase mixed_compositions:
    run Jump("qa_mixed_compositions")
    pause until "混合组合已完成。"
    assert eval len(qa_visuals) == 2
    assert eval len(qa_audio) == 2
    assert eval qa_visuals[0]["instanceId"] != qa_visuals[1]["instanceId"]
    assert eval qa_audio[0]["instanceId"] != qa_audio[1]["instanceId"]
    assert eval all(abs(data["duration"] - 5) < .000001 for data in qa_visuals + qa_audio)
    assert eval all(data["children"][0]["color"] == "#33ff55" for data in qa_visuals)
    assert eval all(data["keyframes"][0]["rotation"] == 25 for data in qa_visuals)
    assert eval all(abs(data["keyframes"][0]["scale"] - .8) < .000001 for data in qa_visuals)
    assert eval all(data["assetId"] == "music" for data in qa_audio)
    assert eval vn_visual_with_inputs(dict(qa_visuals[0], parameters=None, parameterValues=None), {}, {})["duration"] == 5
    screenshot "finished.png"
`);
const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 65000, env: { SDL_VIDEO_WINDOW_POS: '2400,0' } });
await fs.writeFile(path.join(output, 'runtime.log'), result.log);
const passed = result.code === 0 && /Test cases\s*:\s*1\s*\|\s*1 passed/.test(result.log);
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: passed ? 'passed' : 'failed', source, checks: ['界面制作并拖放复用的画面与音乐组合实际原生编译播放', '重复调用保持独立画面与音频实例', '画面变换、颜色、音乐素材及时长保留'] }, null, 2));
console.log(output); assert.ok(passed, result.log.slice(-3500));
