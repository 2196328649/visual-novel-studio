import { promises as fs } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createProject, type Project } from '../src/core/model';
import { blueprintFromPerformance, exposePerformanceInputs, performanceInputs } from '../src/core/blueprint-authoring';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph } from '../src/core/blueprint';
import { arrangePerformanceTimeline, performanceTimeline } from '../src/core/performance-timeline';
import { createParameterControl, gameParametersId } from '../src/core/parameter-sets';
import { buildProject, runRenpy } from '../src/runtime/service';

const root = path.resolve('.'), sdk = path.join(root, 'resources/runtime');
const output = path.join(root, 'artifacts/authoring-runtime', new Date().toISOString().replaceAll(':', '-'));
const build = path.join(output, 'game');
const templateRoot = path.join(root, 'resources/templates/aihong');
const template = JSON.parse(await fs.readFile(path.join(templateRoot, 'project.vns.json'), 'utf8')) as Project;
const project = createProject('演出轨道与自定义设置原生验证');
project.width = 960; project.height = 540;
project.playerDefaults = { masterVolume: 0, textSpeed: 0 };
project.ui.chapterTransition = structuredClone(template.ui.chapterTransition);
const background = template.assets.find(asset => asset.name === '章节进场 · 夜宴庭院')!;
const maskIds = Object.values(project.ui.chapterTransition ?? {});
for (const asset of template.assets.filter(asset => asset.id === background.id || maskIds.includes(asset.id))) {
  const file = path.join(output, asset.path);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.copyFile(path.join(templateRoot, asset.path), file);
  project.assets.push(structuredClone(asset));
}
project.variables = [
  { id: 'reduce_flash', name: '减少闪烁', type: 'boolean', initial: false, persistent: true, parameterSetId: gameParametersId },
  { id: 'intensity', name: '镜头强度', type: 'number', initial: 2, persistent: true, parameterSetId: gameParametersId, setting: { min: 0, max: 10, step: .5 } },
  { id: 'difficulty', name: '演出模式', type: 'string', initial: '完整', persistent: true, parameterSetId: gameParametersId, setting: { options: ['完整', '简洁'] } },
  { id: 'nickname', name: '称呼', type: 'string', initial: '', persistent: true, parameterSetId: gameParametersId },
  { id: 'blueprint_observed', name: '蓝图读取结果', type: 'boolean', initial: false, persistent: false },
];
project.ui.pages = { ...project.ui.pages, preferences: { layout: 'custom' } };
project.ui.components = project.ui.components.filter(component => component.page !== 'preferences');
const controls: Record<string, string> = {};
for (const [index, variable] of project.variables.slice(0, 4).entries()) {
  controls[variable.id] = createParameterControl(project, variable.id);
  Object.assign(project.ui.components.find(component => component.id === controls[variable.id])!, { x: .12, y: .08 + index * .18, width: .64, height: .15 });
}
project.ui.components.push({ id: 'prefs_return', kind: 'button', page: 'preferences', text: '返回', action: 'return', x: .78, y: .85, width: .18, height: .1 });
const capture = createBlueprintGraph('function', '读取玩家设置');
const read = blueprintNodeDefaults('getVariable'), write = blueprintNodeDefaults('setVariable');
read.properties.variableId = 'reduce_flash'; write.properties.variableId = 'blueprint_observed';
capture.nodes.push(read, write);
connectBlueprintPins(capture, capture.nodes[0].id, 'exec', write.id, 'exec_in');
connectBlueprintPins(capture, read.id, 'value', write.id, 'value');
project.blueprints.push(capture);
const graph = blueprintFromPerformance(project, [
  { kind: 'chapter', title: '第一章', subtitle: '城破', duration: 1.2, backgroundId: background.id, effect: 'ink', wait: false },
  { kind: 'camera', x: .1, y: 0, zoom: 1.15, rotation: 0, duration: 1, easing: 'linear', wait: false },
  { kind: 'shake', direction: 'horizontal', duration: 1, amplitude: 22, wait: false },
], '哀鸿进场演出');
const model = performanceTimeline(project, graph);
arrangePerformanceTimeline(project, graph, model.clips.map(clip => ({ ...clip, at: 0 })), model.tracks);
const parameters = performanceInputs(graph);
exposePerformanceInputs(graph, ['title', 'duration', 'backgroundId'].map(pinId => parameters.find(input => input.nodeId === graph.nodes.find(node => node.type === 'showChapter')!.id && input.pinId === pinId)!));
project.blueprints.push(graph);
const [title, duration, picture] = graph.exposedInputs;
const passage = project.nodes.find(node => node.kind === 'passage')!;
passage.lines = [
  { id: 'ready', text: '准备验证演出和设置。', actions: [{ kind: 'background', assetId: background.id, transition: 'none' }] },
  { id: 'first_done', text: '第一章演出结束。', actions: [{ kind: 'blueprint', blueprintId: capture.id }, { kind: 'blueprint', blueprintId: graph.id }] },
  { id: 'second_done', text: '第二章演出结束。', actions: [{ kind: 'blueprint', blueprintId: graph.id, inputs: { [title.id]: '第二章 · 传入标题', [duration.id]: 2.2, [picture.id]: background.id } }] },
];
const report: { status: string; checks: string[]; output: string; error?: string } = { status: 'running', checks: [], output };
await fs.mkdir(output, { recursive: true });
try {
  await fs.writeFile(path.join(output, 'project.vns.json'), JSON.stringify(project, null, 2));
  const built = await buildProject({ project, projectDir: output, sdkRoot: sdk, outputDir: build, development: true });
  await fs.writeFile(path.join(output, 'compile.log'), built.log + '\n' + JSON.stringify(built.diagnostics, null, 2));
  assert.ok(built.ok, built.log.slice(-6000) + JSON.stringify(built.diagnostics));
  report.checks.push('轨道、公开参数和自定义设置通过原生编译。');
  await fs.writeFile(path.join(build, 'game/testcases.rpy'), `init python:
    def _authoring_motion():
        scene = renpy.game.context().scene_lists
        camera = scene.camera_transform.get("master")
        shake = scene.layer_transform.get("master")
        return camera is not None and shake is not None and 1.001 < camera.state.zoom < 1.149 and abs(shake.state.xoffset) > 0.1

testsuite global:
    before testcase:
        $ _test.timeout = 15.0
        $ _test.transition_timeout = 0.05
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
        $ preferences.afm_enable = False
    teardown:
        exit

testcase custom_settings_and_timeline:
    click id "vn_main_start"
    pause until "准备验证演出和设置。"
    run FileSave("authoring_ready", confirm=False, slot=True)
    run ShowMenu("preferences")
    pause until screen "preferences"
    click id "vn_component_${controls.reduce_flash}_toggle"
    assert eval (persistent.vn_var_reduce_flash is True)
    click id "vn_component_${controls.intensity}_control" pos (0.75, 0.5)
    assert eval (6.5 <= persistent.vn_var_intensity <= 8.5)
    click id "vn_component_${controls.difficulty}_option_1"
    assert eval (persistent.vn_var_difficulty == "简洁")
    click id "vn_component_${controls.nickname}_edit"
    type "Player"
    assert eval (persistent.vn_var_nickname == "Player")
    screenshot "custom-settings.png"
    click id "vn_component_prefs_return"
    pause until "准备验证演出和设置。"
    run FileLoad("authoring_ready", confirm=False, slot=True)
    pause until "准备验证演出和设置。"
    assert eval (persistent.vn_var_reduce_flash is True and persistent.vn_var_nickname == "Player")
    assert eval (persistent.vn_var_difficulty == "简洁" and persistent.vn_var_intensity >= 6.5)
    $ _authoring_started = __import__("time").monotonic()
    keysym "dismiss"
    pause until screen "vn_chapter_title"
    assert eval (renpy.get_screen("vn_chapter_title").scope["title"] == "第一章")
    pause until eval _authoring_motion()
    assert not "第一章演出结束。"
    screenshot "chapter-overlapping-motion.png"
    pause until "第一章演出结束。"
    assert eval (__import__("time").monotonic() - _authoring_started >= 1.1)
    assert eval (vn_var_blueprint_observed is True)
    pause until not screen "vn_chapter_title"
    $ _authoring_started = __import__("time").monotonic()
    keysym "dismiss"
    pause until screen "vn_chapter_title"
    assert eval (renpy.get_screen("vn_chapter_title").scope["title"] == "第二章 · 传入标题")
    assert eval (renpy.get_screen("vn_chapter_title").scope["duration"] == 2.2)
    assert eval (renpy.get_screen("vn_chapter_title").scope["background"] == ${JSON.stringify(background.path.replaceAll('\\', '/'))})
    pause 1.5
    assert not "第二章演出结束。"
    screenshot "reused-chapter.png"
    pause until "第二章演出结束。"
    assert eval (__import__("time").monotonic() - _authoring_started >= 2.1)
    $ vn_parameter_reset_settings()
    assert eval (persistent.vn_var_reduce_flash is False and persistent.vn_var_intensity == 2)
    assert eval (persistent.vn_var_difficulty == "完整" and persistent.vn_var_nickname == "")
`);
  const lint = await runRenpy(sdk, build, ['lint']); await fs.writeFile(path.join(output, 'lint.log'), lint.log);
  assert.equal(lint.code, 0, lint.log.slice(-5000));
  const run = await runRenpy(sdk, build, ['test', '--report-detailed', '--report-skipped'], { savedir: path.join(output, 'saves'), timeoutMs: 110000, onData: data => { for (const line of data.split(/\r?\n/)) if (line.startsWith('[rpytest]')) console.log(line); } });
  await fs.writeFile(path.join(output, 'runtime.log'), run.log);
  assert.equal(run.code, 0, run.log.slice(-6000));
  assert.match(run.log, /Test cases\s*:\s*1\s*\|\s*1 passed/);
  report.checks.push('开关、数值滑条、文字选项和输入框实际操作通过；读取旧剧情存档后玩家设置保留。', '蓝图读取到设置控件修改的同一参数；恢复设置回到初始值。', '章节、镜头与震动同时执行；复用调用传入标题、图片和时长，实际等待至最长轨道结束。');
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error); process.exitCode = 1; console.error(error); }
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
console.log('Report: ' + path.join(output, 'report.json'));
