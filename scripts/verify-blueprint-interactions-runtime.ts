import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject } from '../src/core/model';
import { addInteractionBlueprintExample, addParallelMotionExample } from '../src/core/blueprint-examples';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph } from '../src/core/blueprint';
import { buildProject, runRenpy } from '../src/runtime/service';
import { variableReference } from '../src/runtime/expressions';

const root = path.resolve('.'), sdk = path.join(root, 'resources/runtime');
const output = path.join(root, 'artifacts/blueprint-interactions-runtime', new Date().toISOString().replaceAll(':', '-'));
const build = path.join(output, 'game');
const project = createProject('蓝图交互与并行演出验收');
const game = addInteractionBlueprintExample(project), overlay = addInteractionBlueprintExample(project), motion = addParallelMotionExample(project);
project.variables.push({ id: 'key_probe', name: '第二个按键回调', type: 'boolean', initial: false, persistent: false });
const keyGraph = createBlueprintGraph('function', '第二个按键回调');
const key = blueprintNodeDefaults('eventKey'), recordKey = blueprintNodeDefaults('setVariable');
key.properties.pageId = game.pageId; recordKey.properties = { variableId: 'key_probe', value: true }; keyGraph.nodes.push(key, recordKey);
connectBlueprintPins(keyGraph, key.id, 'exec', recordKey.id, 'exec_in'); project.blueprints.push(keyGraph);
const graph = project.blueprints.find(graph => graph.id === game.graphId)!;
const timeInput = graph.exposedInputs.find(input => input.name === '限时秒数')!.id;
project.blueprints.find(graph => graph.id === overlay.graphId)!.nodes.find(node => node.type === 'showUiPage')!.properties.wait = false;
for (const node of project.blueprints.find(graph => graph.id === motion)!.nodes) if (node.type === 'camera' || node.type === 'shake') node.properties.duration = 2;
const passage = project.nodes.find(node => node.kind === 'passage')!;
passage.lines = [
  { id: 'ready', text: '交互测试准备。', actions: [] },
  { id: 'first_done', text: '第一次交互结束。', actions: [{ kind: 'blueprint', blueprintId: game.graphId, inputs: { [timeInput]: 20 } }] },
  { id: 'second_done', text: '第二次交互结束。', actions: [{ kind: 'blueprint', blueprintId: game.graphId, inputs: { [timeInput]: 2 } }] },
  { id: 'overlay_done', text: '叠加界面显示期间，剧情也能继续。', actions: [{ kind: 'blueprint', blueprintId: overlay.graphId }] },
  { id: 'motion_done', text: '镜头与震动播放完成。', actions: [{ kind: 'blueprint', blueprintId: motion }] },
];
const v = (id: string) => variableReference(project, id);
const report: { status: string; checks: string[]; output: string; error?: string } = { status: 'running', checks: [], output };
await fs.mkdir(output, { recursive: true });
const saveReport = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
try {
  await fs.writeFile(path.join(output, 'project.vns.json'), JSON.stringify(project, null, 2));
  const built = await buildProject({ project, sdkRoot: sdk, outputDir: build, development: true });
  await fs.writeFile(path.join(output, 'compile.log'), built.log + '\n' + JSON.stringify(built.diagnostics, null, 2));
  if (!built.ok) throw new Error(`Compile failed: ${built.log.slice(-5000)} ${JSON.stringify(built.diagnostics)}`);
  report.checks.push('普通蓝图、组件事件、自定义界面与镜头演出通过 Ren’Py 编译。');
  await fs.writeFile(path.join(build, 'game/testcases.rpy'), `init python:
    def _vns_simultaneous_motion():
        scene = renpy.game.context().scene_lists
        camera = scene.camera_transform.get("master")
        shake = scene.layer_transform.get("master")
        return camera is not None and shake is not None and 1.001 < camera.state.zoom < 1.149 and abs(shake.state.xoffset) > 0.1

testsuite global:
    before testcase:
        $ _test.timeout = 12.0
        $ _test.transition_timeout = 0.05
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
        $ preferences.afm_enable = False
        if not screen "main_menu":
            run MainMenu(confirm=False)
    teardown:
        exit

testcase blueprint_game_and_motion:
    click id "vn_main_start"
    pause until "交互测试准备。"
    advance until screen "vn_custom_page_${game.pageId}"
    assert eval (${v(game.scoreId)} == 0)
    screenshot "game-start.png"
    click id "vn_component_${game.targetId}"
    pause until eval (${v(game.scoreId)} == 1)
    keysym "K_SPACE"
    pause until eval (${v(game.scoreId)} == 2)
    assert eval (${v('key_probe')} is True)
    assert eval (0.15 <= vn_ui_get("${game.targetId}", "x") <= 0.69)
    run FileSave("blueprint_game", confirm=False, slot=True)
    click id "vn_component_${game.targetId}"
    pause until eval (${v(game.scoreId)} == 3)
    run FileLoad("blueprint_game", confirm=False, slot=True)
    pause until screen "vn_custom_page_${game.pageId}"
    assert eval (${v(game.scoreId)} == 2)
    click id "vn_component_${game.targetId}"
    pause until eval (${v(game.scoreId)} == 3)
    keysym "K_SPACE"
    pause until eval (${v(game.scoreId)} == 4)
    click id "vn_component_${game.targetId}"
    pause until eval (${v(game.resultId)} == "成功")
    assert eval (vn_ui_get("${game.targetId}", "enabled") is False)
    $ _vns_remaining = ${v(game.remainingId)}
    pause 1.1
    assert eval (${v(game.remainingId)} == _vns_remaining)
    screenshot "game-success.png"
    click id "vn_component_${game.closeId}"
    pause until "第一次交互结束。"
    assert eval ("${game.pageId}" not in vn_ui_open_pages)
    assert eval (vn_bp_out_${graph.id}_${graph.exposedOutputs[0].id} == "成功")

    advance until screen "vn_custom_page_${game.pageId}"
    assert eval (${v(game.scoreId)} == 0 and vn_ui_get("${game.targetId}", "enabled") is True)
    pause until eval (${v(game.resultId)} == "失败")
    screenshot "game-timeout.png"
    click id "vn_component_${game.closeId}"
    pause until "第二次交互结束。"
    assert eval (vn_bp_out_${graph.id}_${graph.exposedOutputs[0].id} == "失败")

    advance until "叠加界面显示期间，剧情也能继续。"
    assert eval (vn_ui_open_pages.get("${overlay.pageId}") == "shown")
    click id "vn_component_${overlay.targetId}"
    pause until eval (${v(overlay.scoreId)} == 1)
    keysym "K_ESCAPE"
    pause until eval ("${overlay.pageId}" not in vn_ui_open_pages)
    $ _vns_stopped = ${v(overlay.remainingId)}
    pause 1.1
    assert eval (${v(overlay.remainingId)} == _vns_stopped)

    # Advance keeps dismissing until the next dialogue, which would skip the wait.
    $ _vns_motion_started_at = __import__("time").monotonic()
    keysym "dismiss"
    pause until eval _vns_simultaneous_motion()
    assert not "镜头与震动播放完成。"
    screenshot "simultaneous-camera-shake.png"
    pause until "镜头与震动播放完成。"
    assert eval (__import__("time").monotonic() - _vns_motion_started_at >= 1.8)
    # Let the new dialogue interaction render its first frame before inspecting it.
    pause 0.05
    assert eval (abs(renpy.game.context().scene_lists.camera_transform["master"].state.zoom - 1.15) < 0.001)
    assert eval (abs(renpy.game.context().scene_lists.layer_transform["master"].state.xoffset) < 0.001)
    screenshot "motion-finished.png"
`);
  const lint = await runRenpy(sdk, build, ['lint']); await fs.writeFile(path.join(output, 'lint.log'), lint.log);
  if (lint.code) throw new Error(lint.log.slice(-5000));
  report.checks.push('原生 lint 通过。'); await saveReport();
  const run = await runRenpy(sdk, build, ['test', '--report-detailed', '--report-skipped'], { savedir: path.join(output, 'saves'), timeoutMs: 100000, onData: data => { for (const line of data.split(/\r?\n/)) if (line.startsWith('[rpytest]')) console.log(line); } });
  await fs.writeFile(path.join(output, 'runtime.log'), run.log);
  if (run.code || !/Test cases\s*:\s*1\s*\|\s*1 passed/.test(run.log)) throw new Error(run.log.slice(-5000));
  report.checks.push('鼠标与空格计分、随机移动、倒计时成功/失败、再次调用重置、关闭返回结果均通过。', '界面中途存档、读档恢复得分；叠加界面关闭后停止定时器。', '同一时刻检测到镜头缩放和震动偏移，结束后镜头到位、震动归零。');
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = error instanceof Error ? error.message : String(error); process.exitCode = 1; console.error(report.error); }
await saveReport(); console.log(`Report: ${path.join(output, 'report.json')}`);
