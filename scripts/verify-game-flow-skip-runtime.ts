import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { addGameFlowStep } from '../src/core/game-flow-graph';
import { createProject, projectSchema, type BlueprintGraph, type BlueprintNode } from '../src/core/model';
import { arrangePerformanceTimeline, performanceTimeline } from '../src/core/performance-timeline';
import { createVisualObject } from '../src/core/visual-object';
import { buildProject, runRenpy } from '../src/runtime/service';
import { finishFlowNativeVerification, flowRuntimeTraceSource, recordFlowNativeResult } from './lib/flow-runtime-verification';
import { isolateRenpySaves } from './lib/renpy-saves';

// Pending coordinated validation: run after the complete implementation and
// editor build. Only new synthetic projects and private save folders are used.
const root = path.resolve('.');
const permittedRoot = path.join(root, 'artifacts/game-flow-skip-2026-11-14');
const regressionRoot = path.join(root, 'artifacts/code-health-review-2026-11-14/regression-runtime');
const requestedRoot = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? path.join(permittedRoot, 'runtime'));
const inside = (parent: string, candidate: string, equal = false) => {
  const relative = path.relative(parent, candidate);
  return (equal || relative !== '') && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};
assert.ok(inside(permittedRoot, requestedRoot, true) || inside(regressionRoot, requestedRoot, true), '原生验收输出必须位于 game-flow-skip-2026-11-14 或本轮 code-health-review-2026-11-14/regression-runtime 目录。');
const output = path.join(requestedRoot, `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`);
const source = path.join(output, 'source'), game = path.join(output, 'game'), sdk = path.join(root, 'resources/runtime');
const previousSaves = process.env.RENPY_PATH_TO_SAVES;
const report: Record<string, unknown> = { status: 'running', output, sdk,
  coverage: '实际流程入口、鼠标、Enter、Tab、Ctrl按下/释放、已有快进、允许跳过、确认和页面按钮、存读档、普通对白及独立演出回归。探针只记录真实执行和渲染，不代替输入或提前结束演出。',
  limits: '使用960×540合成工程和有限文字/色块时间轴；画面采样间隔至少60ms。存读档验证本轮生成的保存点，不代表所有旧版本存档续点。未读取作者工程。', checks: [] };
const saveReport = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));

async function prepareOutput() {
  const workspace = await fs.realpath(root);
  let current = root;
  for (const part of path.relative(root, output).split(path.sep)) {
    current = path.join(current, part);
    const stat = await fs.lstat(current).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    });
    if (current === output) assert.equal(stat, undefined, '每次验收使用全新目录。');
    if (stat) assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), '拒绝链接或非目录输出：' + current);
    else await fs.mkdir(current);
    assert.ok(inside(workspace, await fs.realpath(current)), '验收输出离开工作区。');
  }
}

function fixture() {
  const project = createProject('流程演出允许跳过 · 原生回归');
  project.id = 'game_flow_skip_verification';
  project.width = 960; project.height = 540;
  project.playerDefaults = { textSpeed: 0, masterVolume: 0 };
  project.assets = []; project.characters = []; project.blueprints = []; project.timelinePresets = [];
  project.variables = [
    { id: 'scenario', name: '验收入口', type: 'string', initial: 'idle', persistent: true },
    { id: 'phase', name: '执行位置', type: 'string', initial: '', persistent: false },
    { id: 'answer', name: '确认结果', type: 'string', initial: '', persistent: false },
    ...['work', 'page_shows'].map(id => ({ id, name: id, type: 'number' as const, initial: 0, persistent: false })),
  ];
  project.ui.fontSize = 24;
  project.ui.pages = { main: { layout: 'custom', background: '#14212e' }, say: { showQuickMenu: false } };
  project.ui.components = [
    { id: 'qa_title', kind: 'text', page: 'main', text: '流程演出跳过回归', x: .12, y: .12, width: .76, height: .16, style: { fontSize: 36 } },
    { id: 'qa_start', kind: 'button', page: 'main', text: '开始验收', action: 'start', x: .35, y: .58, width: .3, height: .13 },
  ];

  const graph = (id: string, kind: BlueprintGraph['kind'] = 'function') => {
    const result = createBlueprintGraph(kind, id); result.id = id; result.nodes[0].id = id + '_entry';
    project.blueprints.push(result); return result;
  };
  const node = (target: BlueprintGraph, type: BlueprintNode['type'], properties: BlueprintNode['properties'] = {}) => {
    const result = blueprintNodeDefaults(type); result.id = `${target.id}_n${target.nodes.length}`;
    Object.assign(result.properties, properties); target.nodes.push(result); return result;
  };
  const wire = (target: BlueprintGraph, from: BlueprintNode, to: BlueprintNode, output = from.type.startsWith('event') ? 'exec' : 'exec_out', input = 'exec_in') => {
    synchronizeBlueprintSignatures(project);
    assert.equal(connectBlueprintPins(target, from.id, output, to.id, input), undefined, `${target.id}: ${from.id}/${output} → ${to.id}/${input}`);
  };
  const chain = (target: BlueprintGraph, ...nodes: BlueprintNode[]) => nodes.slice(1).forEach((item, index) => wire(target, nodes[index], item));
  const mark = (target: BlueprintGraph, value: string) => node(target, 'setVariable', { variableId: 'phase', value });
  const increment = (target: BlueprintGraph, after: BlueprintNode, variableId: string) => {
    const read = node(target, 'getVariable', { variableId }), add = node(target, 'math', { operation: 'add', b: 1 }), write = node(target, 'setVariable', { variableId });
    wire(target, read, add, 'value', 'a'); wire(target, add, write, 'result', 'value'); wire(target, after, write); return write;
  };
  const timeline = (id: string, gap: number, duration: number, color = '#df384b') => {
    const solid = createVisualObject('solid'); Object.assign(solid, { instanceId: id + '_solid', color, duration });
    const text = createVisualObject('text'); Object.assign(text, { instanceId: id + '_text', text: '完整演出 · ' + id, fontSize: 34, width: .85, duration });
    const result = blueprintFromPerformance(project, [solid, text], id); result.id = id;
    result.performanceKind = 'standalone'; result.timelineComponent = true;
    (project.timelinePresets ??= []).push(result);
    const model = performanceTimeline(project, result);
    arrangePerformanceTimeline(project, result, model.clips.map(clip => ({ ...clip, at: gap })), model.tracks);
    return result;
  };
  const choice = (target: BlueprintGraph, cases: string[]) => {
    const read = node(target, 'getVariable', { variableId: 'scenario' });
    const select = node(target, 'switchValue', { choiceVersion: 1, keyType: 'string', cases: JSON.stringify(cases.map(id => ({ id, name: id, key: id }))) });
    wire(target, target.nodes[0], select); wire(target, read, select, 'value', 'key'); return select;
  };

  const intro = timeline('qa_intro', 1.6, 2.8);
  // No allowSkip field: the same legacy/default unchecked state reported by
  // the user is normalized by the real project schema, rather than patched.
  addGameFlowStep(project, 'beforeTitle', { id: 'qa_launch', kind: 'blueprint', graphId: intro.id });

  const closePage = graph('qa_close_page', 'ui');
  chain(closePage, closePage.nodes[0], node(closePage, 'closeUiPage', { pageId: 'qa_page', result: '已确认' }));
  const showPage = graph('qa_show_page', 'ui'); increment(showPage, showPage.nodes[0], 'page_shows');
  project.ui.customPages = [{ id: 'qa_page', name: '演出内可操作页面', modal: true, background: '#24413a', onShowBlueprintId: showPage.id,
    components: [
      { id: 'qa_page_label', kind: 'text', page: 'custom', text: '页面按钮仍可点击', x: .12, y: .2, width: .76, height: .14 },
      { id: 'qa_page_close', kind: 'button', page: 'custom', text: '确认并继续', action: 'blueprint', blueprintId: closePage.id, x: .35, y: .62, width: .3, height: .13 },
    ] }];
  addGameFlowStep(project, 'beforeTitle', { id: 'qa_launch_page', kind: 'page', pageId: 'qa_page', allowSkip: false });

  const worker = graph('qa_worker'), workerDelay = node(worker, 'delay', { seconds: 1.1 });
  wire(worker, worker.nodes[0], workerDelay); increment(worker, workerDelay, 'work');
  const loop = graph('qa_nested');
  const repeat = node(loop, 'forLoop', { firstIndex: 0, lastIndex: 2 }), calledWorker = node(loop, 'callFunction', { graphId: worker.id });
  wire(loop, loop.nodes[0], repeat); wire(loop, repeat, calledWorker, 'loop_body');
  const saved = graph('qa_saved');
  const counted = increment(saved, saved.nodes[0], 'work'); wire(saved, counted, node(saved, 'delay', { seconds: 3.2 }));
  const protectedDelay = graph('qa_existing_skip');
  chain(protectedDelay, protectedDelay.nodes[0], node(protectedDelay, 'delay', { seconds: 2.4 }));
  const confirmed = graph('qa_confirm');
  const confirm = node(confirmed, 'confirmMessage', { message: '不允许跳过不会禁用演出里的确认按钮。' }); wire(confirmed, confirmed.nodes[0], confirm);
  for (const answer of ['yes', 'no']) wire(confirmed, confirm, node(confirmed, 'setVariable', { variableId: 'answer', value: answer }), answer);
  const opened = graph('qa_open_page');
  const opening = node(opened, 'showUiPage', { pageId: 'qa_page', wait: true });
  const answer = node(opened, 'setVariable', { variableId: 'answer' }); chain(opened, opened.nodes[0], opening, answer); wire(opened, opening, answer, 'result', 'value');

  // The player enables ordinary fast-forward on an allowed wait, and the next
  // real flow step must stop that existing state before entering its timeline.
  const staging = graph('qa_enable_skip');
  const stageChoice = choice(staging, ['active_slow', 'active_fast']);
  for (const scenario of ['active_slow', 'active_fast']) {
    const start = mark(staging, 'enable_' + scenario); wire(staging, stageChoice, start, 'case_' + scenario);
    wire(staging, start, node(staging, 'delay', { seconds: 5 }));
  }
  addGameFlowStep(project, 'beforeNewGame', { id: 'qa_allowed_entry', kind: 'blueprint', graphId: staging.id, allowSkip: true });

  const protectedEntry = graph('qa_protected');
  const branches: Record<string, BlueprintGraph> = { nested: loop, saved, confirm_yes: confirmed, confirm_no: confirmed, page: opened, active_slow: protectedDelay, active_fast: protectedDelay };
  const protectedChoice = choice(protectedEntry, Object.keys(branches));
  for (const [scenario, target] of Object.entries(branches)) {
    const start = mark(protectedEntry, scenario), call = node(protectedEntry, 'callFunction', { graphId: target.id });
    wire(protectedEntry, protectedChoice, start, 'case_' + scenario); chain(protectedEntry, start, call, mark(protectedEntry, scenario + '_done'));
  }
  addGameFlowStep(project, 'beforeNewGame', { id: 'qa_protected_step', kind: 'blueprint', graphId: protectedEntry.id, allowSkip: false });

  const allowedTimeline = timeline('qa_allowed_timeline', 1.2, 3);
  const allowed = graph('qa_allowed');
  const allowedChoice = choice(allowed, ['click_allowed', 'explicit_allowed']);
  for (const scenario of ['click_allowed', 'explicit_allowed']) {
    const start = mark(allowed, scenario), call = node(allowed, 'callFunction', { graphId: allowedTimeline.id });
    wire(allowed, allowedChoice, start, 'case_' + scenario); chain(allowed, start, call, mark(allowed, scenario + '_done'));
    increment(allowed, allowed.nodes.at(-1)!, 'work');
  }
  addGameFlowStep(project, 'beforeNewGame', { id: 'qa_allowed_step', kind: 'blueprint', graphId: allowed.id, allowSkip: true });

  const standaloneProtected = timeline('qa_standalone_protected', 0, 1.8, '#278c71');
  const standaloneAllowed = timeline('qa_standalone_allowed', 1.1, 2.8, '#8c4db1');
  const sceneId = project.scenes[0].id;
  project.entryId = 'qa_story';
  project.nodes = [
    { id: 'qa_story', name: '普通对白恢复', kind: 'passage', sceneId, x: 0, y: 0, next: 'qa_protected_story', lines: [
      { id: 'qa_story_first', text: '演出完成，普通台词可以点击继续。', actions: [] },
      { id: 'qa_story_second', text: '第二句：点击和快进已经恢复。', actions: [] },
    ] },
    { id: 'qa_protected_story', name: '普通独立演出不允许点击', kind: 'passage', sceneId, x: 240, y: 0, next: 'qa_after_protected', lines: [
      { id: 'qa_protected_line', text: '', silent: true, actions: [{ kind: 'blueprint', blueprintId: standaloneProtected.id }], playback: { clickSkip: false } },
    ] },
    { id: 'qa_after_protected', name: '独立演出自然结束', kind: 'passage', sceneId, x: 480, y: 0, next: 'qa_allowed_story', lines: [
      { id: 'qa_after_protected_line', text: '普通独立演出按自己的设置完整播放。', actions: [] },
    ] },
    { id: 'qa_allowed_story', name: '普通独立演出允许点击', kind: 'passage', sceneId, x: 720, y: 0, next: 'qa_after_allowed', lines: [
      { id: 'qa_allowed_line', text: '', silent: true, actions: [{ kind: 'blueprint', blueprintId: standaloneAllowed.id }], playback: { clickSkip: true } },
    ] },
    { id: 'qa_after_allowed', name: '独立演出点击结束', kind: 'passage', sceneId, x: 960, y: 0, next: 'qa_end', lines: [
      { id: 'qa_after_allowed_line', text: '允许点击的独立演出可以提前结束。', actions: [] },
    ] },
    { id: 'qa_end', name: '完成', kind: 'end', sceneId, x: 1200, y: 0 },
  ];
  synchronizeBlueprintSignatures(project);
  return projectSchema.parse(JSON.parse(JSON.stringify(project)));
}

const tests = `
init -999 python:
    import renpy as qa_engine
    qa_engine.safe_mode_checked = True
${flowRuntimeTraceSource(output)}
init python:
    import time as qa_time
    import renpy.test.testexecution as qa_test_execution
    class QASkipProbe(object):
        def __init__(self):
            self.labels, self.frames, self.saves, self.loads = [], [], [], []
            self.last_frame = 0.0
    qa_test_execution.flow_skip_probe = QASkipProbe()
    def qa_probe():
        return qa_test_execution.flow_skip_probe
    def qa_state():
        return dict(time=qa_time.monotonic(), phase=vn_var_phase, work=vn_var_work,
            flags=dict(skipping=_skipping, dismiss=_dismiss_pause, active=config.skipping),
            wait=dict(duration=vn_bp_wait['duration'], elapsed=vn_bp_wait['elapsed'], depth=vn_bp_wait.get('depth'), owner=vn_bp_wait.get('owner') is renpy.context()) if vn_bp_wait is not None else None,
            flow=dict(vn_flow_active_step) if vn_flow_active_step is not None else None,
            pages=list(vn_ui_open_pages), task=vn_bp_task is not None)
    def qa_label(name, abnormal):
        if name.startswith("vn_blueprint_qa_") or name == "vn_node_qa_story":
            qa_probe().labels.append(dict(name=name, time=qa_time.monotonic(), skipping=config.skipping))
    def qa_labels(name):
        return [row for row in qa_probe().labels if row["name"] == "vn_blueprint_" + name]
    qa_original_draw = renpy.display.core.Interface.draw_screen
    def qa_draw(self, root_widget, fullscreen_video, draw):
        qa_original_draw(self, root_widget, fullscreen_video, draw)
        now = qa_time.monotonic()
        if draw and vn_flow_active_step and vn_flow_active_step["id"] == "qa_launch" and now - qa_probe().last_frame >= .06:
            qa_probe().last_frame = now
            surface = renpy.display.draw.screenshot(renpy.display.interface.surftree)
            qa_probe().frames.append(dict(time=now, pixel=list(surface.get_at((480, 90)))[:3],
                solid=bool(renpy.showing("vn_visual_qa_intro_solid")), state=qa_state()))
    def qa_intro_span():
        rows = [row for row in qa_probe().frames if row["solid"] and row["pixel"][0] > 180 and row["pixel"][1] < 90]
        return rows[-1]["time"] - rows[0]["time"] if len(rows) > 1 else 0.0
    qa_original_save = renpy.save
    def qa_save(slot, *args, **kwargs):
        if slot == "qa_flow_wait":
            qa_probe().saves.append(qa_state())
        return qa_original_save(slot, *args, **kwargs)
    def qa_loaded():
        qa_probe().loads.append(qa_state())
    def qa_snapshot(name):
        qa_trace(name, state=qa_state(), labels=qa_probe().labels, saves=qa_probe().saves, loads=qa_probe().loads, frames=qa_probe().frames)
    def qa_clean():
        return vn_flow_active_step is None and vn_bp_task is None and vn_bp_wait is None and not vn_ui_open_pages
    def qa_ctrl(down):
        # Native key events, held across a real engine pause. This only drives
        # input; no protection, wait, deadline or skipping state is rewritten.
        action = renpy.test.testkey.down if down else renpy.test.testkey.up
        action(renpy.test.testexecution.node_executor.node, "K_LCTRL")
    config.label_callbacks.append(qa_label)
    renpy.display.core.Interface.draw_screen = qa_draw
    renpy.save = qa_save

init 1000 python:
    config.after_load_callbacks.append(qa_loaded)

testsuite global:
    before testcase:
        $ _test.timeout = 20.0
        $ _test.transition_timeout = 0.05
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
        $ preferences.afm_enable = False
        $ preferences.skip_unseen = True
        $ preferences.transitions = 2
    after testcase:
        run Function(qa_ctrl, False, _update_screens=False)
        keysym "stop_skipping"
        if not screen "main_menu":
            run MainMenu(confirm=False)
        pause until screen "main_menu"
    teardown:
        exit

testcase a_launch_default_protects_timeline_gap_and_tail:
    pause until eval vn_flow_active_step is not None and vn_flow_active_step["id"] == "qa_launch" and vn_bp_wait is not None
    assert eval vn_flow_active_step["allowSkip"] is False and not _skipping and not _dismiss_pause
    assert eval vn_bp_wait["duration"] >= 1.5 and not renpy.showing("vn_visual_qa_intro_solid")
    $ qa_intro_start = qa_labels("qa_intro")[0]["time"]
    click pos (830, 110)
    keysym "K_RETURN" pos (830, 110)
    keysym "K_TAB" pos (830, 110)
    run Function(qa_ctrl, True, _update_screens=False)
    pause .22
    assert eval vn_flow_active_step["id"] == "qa_launch" and vn_bp_wait is not None and not config.skipping
    assert eval not renpy.showing("vn_visual_qa_intro_solid")
    run Function(qa_ctrl, False, _update_screens=False)
    screenshot "01-protected-gap.png"
    pause until eval renpy.showing("vn_visual_qa_intro_solid") and vn_bp_wait is not None and vn_bp_wait["duration"] >= 2.5
    assert eval qa_time.monotonic() - qa_intro_start >= 1.5
    click pos (830, 110)
    click pos (830, 110)
    keysym "K_RETURN" pos (830, 110)
    keysym "K_TAB" pos (830, 110)
    run Function(qa_ctrl, True, _update_screens=False)
    pause .25
    assert eval vn_flow_active_step["id"] == "qa_launch" and renpy.showing("vn_visual_qa_intro_solid") and not config.skipping
    run Function(qa_ctrl, False, _update_screens=False)
    screenshot "02-protected-tail.png"
    pause until eval "qa_page" in vn_ui_open_pages
    assert eval qa_time.monotonic() - qa_intro_start >= 4.25 and qa_intro_span() >= 2.5
    assert eval vn_flow_active_step["kind"] == "page" and not vn_flow_active_step["allowSkip"]
    assert eval _skipping and _dismiss_pause and len(qa_labels("qa_intro")) == 1
    screenshot "03-page-step-keeps-buttons.png"
    click id "vn_component_qa_page_close"
    pause until screen "main_menu"
    assert eval qa_clean() and _skipping and _dismiss_pause and vn_var_page_shows == 1
    run Function(qa_snapshot, "launch-natural-and-page", _update_screens=False)

testcase b_nested_loop_waits_ignore_clicks_and_keys:
    pause until screen "main_menu"
    $ persistent.vn_var_scenario = "nested"
    click id "vn_component_qa_start"
    pause until eval vn_var_phase == "nested" and vn_bp_wait is not None
    $ qa_nested_start = qa_labels("qa_nested")[-1]["time"]
    assert eval not _skipping and not _dismiss_pause and vn_bp_task["flow"]["id"] == "qa_protected_step"
    click pos (830, 110)
    keysym "K_RETURN" pos (830, 110)
    keysym "K_TAB" pos (830, 110)
    run Function(qa_ctrl, True, _update_screens=False)
    pause .2
    assert eval vn_var_work == 0 and vn_var_phase == "nested" and not config.skipping
    run Function(qa_ctrl, False, _update_screens=False)
    pause until eval vn_var_work == 1
    click pos (830, 110)
    pause .2
    assert eval vn_var_work == 1 and vn_var_phase == "nested"
    pause until eval vn_var_work == 2
    click pos (830, 110)
    pause .2
    assert eval vn_var_work == 2 and vn_var_phase == "nested"
    screenshot "04-protected-nested-loop.png"
    pause until "演出完成，普通台词可以点击继续。"
    assert eval vn_var_work == 3 and vn_var_phase == "nested_done" and qa_time.monotonic() - qa_nested_start >= 3.15
    assert eval len(qa_labels("qa_worker")) == 3 and qa_clean() and _skipping and _dismiss_pause
    click pos (830, 110)
    pause until "第二句：点击和快进已经恢复。"
    assert eval vn_current_line == "qa_story_second"
    run Function(qa_snapshot, "nested-and-dialogue-restored", _update_screens=False)

testcase c_existing_tab_skip_stops_at_protected_step:
    pause until screen "main_menu"
    $ persistent.vn_var_scenario = "active_slow"
    click id "vn_component_qa_start"
    pause until eval vn_var_phase == "enable_active_slow" and vn_bp_wait is not None
    assert eval _skipping and _dismiss_pause and vn_flow_active_step["allowSkip"]
    keysym "K_TAB" pos (830, 110)
    pause until eval vn_var_phase == "active_slow" and vn_bp_wait is not None
    $ qa_existing_start = qa_labels("qa_existing_skip")[-1]["time"]
    assert eval qa_labels("qa_protected")[-1]["skipping"] == "slow"
    assert eval not config.skipping and not _skipping and not _dismiss_pause
    click pos (830, 110)
    keysym "K_TAB" pos (830, 110)
    pause .25
    assert eval vn_var_phase == "active_slow" and not config.skipping
    pause until "演出完成，普通台词可以点击继续。"
    assert eval qa_time.monotonic() - qa_existing_start >= 2.25 and vn_var_phase == "active_slow_done"
    assert eval qa_clean() and _skipping and _dismiss_pause
    run Function(qa_snapshot, "existing-slow-skip-stopped", _update_screens=False)

testcase d_existing_fast_skip_stops_at_protected_step:
    pause until screen "main_menu"
    $ persistent.vn_var_scenario = "active_fast"
    click id "vn_component_qa_start"
    pause until eval vn_var_phase == "enable_active_fast" and vn_bp_wait is not None
    run Skip(fast=True, confirm=False)
    pause until eval vn_var_phase == "active_fast" and vn_bp_wait is not None
    $ qa_existing_start = qa_labels("qa_existing_skip")[-1]["time"]
    assert eval qa_labels("qa_protected")[-1]["skipping"] == "fast"
    assert eval not config.skipping and not _skipping and not _dismiss_pause
    run Function(qa_ctrl, True, _update_screens=False)
    pause .25
    assert eval vn_var_phase == "active_fast" and not config.skipping
    run Function(qa_ctrl, False, _update_screens=False)
    pause until "演出完成，普通台词可以点击继续。"
    assert eval qa_time.monotonic() - qa_existing_start >= 2.25 and vn_var_phase == "active_fast_done"
    assert eval qa_clean() and _skipping and _dismiss_pause
    run Function(qa_snapshot, "existing-fast-skip-stopped", _update_screens=False)

testcase e_allowed_timeline_remains_click_dismissible:
    pause until screen "main_menu"
    $ persistent.vn_var_scenario = "click_allowed"
    click id "vn_component_qa_start"
    pause until eval vn_var_phase == "click_allowed" and vn_bp_wait is not None
    $ qa_allowed_start = qa_labels("qa_allowed_timeline")[-1]["time"]
    assert eval vn_flow_active_step["allowSkip"] and _skipping and _dismiss_pause
    click pos (830, 110)
    pause until eval renpy.showing("vn_visual_qa_allowed_timeline_solid") and vn_bp_wait is not None and vn_bp_wait["duration"] >= 2.5
    screenshot "05-allowed-timeline.png"
    click pos (830, 110)
    pause until "演出完成，普通台词可以点击继续。"
    assert eval qa_time.monotonic() - qa_allowed_start < 2 and vn_var_phase == "click_allowed_done" and vn_var_work == 1
    assert eval qa_clean() and _skipping and _dismiss_pause
    run Function(qa_snapshot, "allowed-click-dismiss", _update_screens=False)

testcase f_explicit_skip_cancels_nested_work:
    pause until screen "main_menu"
    $ persistent.vn_var_scenario = "explicit_allowed"
    click id "vn_component_qa_start"
    pause until eval vn_var_phase == "explicit_allowed" and vn_bp_wait is not None
    $ qa_allowed_start = qa_labels("qa_allowed_timeline")[-1]["time"]
    screenshot "06-explicit-skip-button.png"
    click "跳过这一项"
    pause until "演出完成，普通台词可以点击继续。"
    assert eval qa_time.monotonic() - qa_allowed_start < 2 and vn_var_phase == "explicit_allowed" and vn_var_work == 0
    assert eval not renpy.showing("vn_visual_qa_allowed_timeline_solid") and qa_clean() and _skipping and _dismiss_pause
    run Function(qa_snapshot, "explicit-skip-cancellation", _update_screens=False)

testcase g_protected_confirmation_yes_and_no_still_work:
    pause until screen "main_menu"
    $ persistent.vn_var_scenario = "confirm_yes"
    click id "vn_component_qa_start"
    pause until screen "confirm"
    assert eval not _skipping and not _dismiss_pause and vn_flow_active_step["id"] == "qa_protected_step"
    click pos (830, 110)
    pause .2
    assert eval renpy.get_screen("confirm") is not None and vn_var_answer == ""
    screenshot "07-protected-confirmation.png"
    click id "vn_confirm_yes"
    pause until "演出完成，普通台词可以点击继续。"
    assert eval vn_var_answer == "yes" and vn_var_phase == "confirm_yes_done" and qa_clean() and _skipping and _dismiss_pause
    run MainMenu(confirm=False)
    pause until screen "main_menu"
    $ persistent.vn_var_scenario = "confirm_no"
    click id "vn_component_qa_start"
    pause until screen "confirm"
    click id "vn_confirm_no"
    pause until "演出完成，普通台词可以点击继续。"
    assert eval vn_var_answer == "no" and vn_var_phase == "confirm_no_done" and qa_clean() and _skipping and _dismiss_pause
    run Function(qa_snapshot, "confirm-buttons-kept", _update_screens=False)

testcase h_protected_page_keeps_authored_buttons:
    pause until screen "main_menu"
    $ persistent.vn_var_scenario = "page"
    click id "vn_component_qa_start"
    pause until eval "qa_page" in vn_ui_open_pages and vn_var_page_shows == 1
    assert eval vn_flow_active_step["id"] == "qa_protected_step" and not _skipping and not _dismiss_pause
    click pos (830, 110)
    pause .2
    assert eval "qa_page" in vn_ui_open_pages and vn_var_phase == "page" and vn_var_answer == ""
    screenshot "08-protected-page-buttons.png"
    click id "vn_component_qa_page_close"
    pause until "演出完成，普通台词可以点击继续。"
    assert eval vn_var_answer == "已确认" and vn_var_phase == "page_done" and vn_var_page_shows == 1
    assert eval qa_clean() and _skipping and _dismiss_pause
    run Function(qa_snapshot, "protected-page-buttons-kept", _update_screens=False)

testcase i_saved_wait_restores_protection_and_remaining_time:
    pause until screen "main_menu"
    $ persistent.vn_var_scenario = "saved"
    click id "vn_component_qa_start"
    pause until eval vn_var_phase == "saved" and vn_var_work == 1 and vn_bp_wait is not None and vn_bp_wait["elapsed"] >= .35
    assert eval not _skipping and not _dismiss_pause
    run FileSave("qa_flow_wait", confirm=False, slot=True)
    assert eval renpy.can_load("qa_flow_wait") and len(qa_probe().saves) == 1
    pause .35
    run FileLoad("qa_flow_wait", confirm=False, slot=True)
    pause until eval len(qa_probe().loads) == 1
    assert eval qa_probe().loads[0]["wait"] == qa_probe().saves[0]["wait"]
    assert eval qa_probe().loads[0]["flags"] == qa_probe().saves[0]["flags"] == dict(skipping=False, dismiss=False, active=None)
    assert eval vn_var_phase == "saved" and vn_var_work == 1 and not _skipping and not _dismiss_pause
    click pos (830, 110)
    keysym "K_RETURN" pos (830, 110)
    keysym "K_TAB" pos (830, 110)
    run Function(qa_ctrl, True, _update_screens=False)
    pause .2
    assert eval vn_var_phase == "saved" and vn_var_work == 1 and not config.skipping
    run Function(qa_ctrl, False, _update_screens=False)
    screenshot "09-restored-protected-wait.png"
    pause until "演出完成，普通台词可以点击继续。"
    assert eval qa_time.monotonic() - qa_probe().loads[0]["time"] >= qa_probe().saves[0]["wait"]["duration"] - qa_probe().saves[0]["wait"]["elapsed"] - .15
    assert eval vn_var_work == 1 and vn_var_phase == "saved_done" and len(qa_labels("qa_saved")) == 1
    assert eval qa_clean() and _skipping and _dismiss_pause
    click pos (830, 110)
    pause until "第二句：点击和快进已经恢复。"
    run Function(qa_snapshot, "save-load-and-restore", _update_screens=False)

testcase j_ordinary_dialogue_skip_and_standalone_settings_remain:
    pause until screen "main_menu"
    $ persistent.vn_var_scenario = "idle"
    click id "vn_component_qa_start"
    pause until "演出完成，普通台词可以点击继续。"
    assert eval qa_clean() and _skipping and _dismiss_pause
    run Function(qa_ctrl, True, _update_screens=False)
    pause until eval vn_current_line != "qa_story_first"
    run Function(qa_ctrl, False, _update_screens=False)
    keysym "stop_skipping"
    run MainMenu(confirm=False)
    pause until screen "main_menu"
    click id "vn_component_qa_start"
    pause until "演出完成，普通台词可以点击继续。"
    click pos (830, 110)
    pause until "第二句：点击和快进已经恢复。"
    click pos (830, 110)
    pause until eval vn_performance_active and vn_current_node == "qa_protected_story"
    $ qa_standalone_start = qa_time.monotonic()
    assert eval not vn_performance_settings["clickSkip"] and not _dismiss_pause and _skipping
    click pos (830, 110)
    pause .2
    assert eval vn_performance_active and vn_current_node == "qa_protected_story"
    screenshot "10-standalone-protected.png"
    pause until "普通独立演出按自己的设置完整播放。"
    assert eval qa_time.monotonic() - qa_standalone_start >= 1.6 and not vn_performance_active and _dismiss_pause
    click pos (830, 110)
    pause until eval vn_performance_active and vn_current_node == "qa_allowed_story"
    $ qa_standalone_start = qa_time.monotonic()
    assert eval vn_performance_settings["clickSkip"] and _dismiss_pause and _skipping
    click pos (830, 110)
    pause until "允许点击的独立演出可以提前结束。"
    assert eval qa_time.monotonic() - qa_standalone_start < 1.5 and not vn_performance_active and _dismiss_pause
    assert eval not renpy.showing("vn_visual_qa_standalone_allowed_solid") and qa_clean()
    screenshot "11-standalone-click-finished.png"
    run Function(qa_snapshot, "ordinary-standalone-regression", _update_screens=False)
`;

async function preserveGenerated(directory: string, relative = ''): Promise<void> {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name), next = path.join(relative, entry.name);
    if (entry.isDirectory() && !['assets', 'fonts', 'cache', 'saves', 'tests'].includes(entry.name)) await preserveGenerated(child, next);
    else if (entry.isFile() && entry.name.endsWith('.rpy')) {
      const destination = path.join(output, 'generated-source', next);
      await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.copyFile(child, destination);
    }
  }
}

let failure: unknown;
await prepareOutput();
try {
  await fs.mkdir(source); await isolateRenpySaves(output);
  const project = fixture();
  await fs.writeFile(path.join(source, 'project.vns.json'), JSON.stringify(project, null, 2));
  await fs.writeFile(path.join(output, 'fixture.project.json'), JSON.stringify(project, null, 2));
  await fs.writeFile(path.join(output, 'testcases.rpy'), tests);
  await saveReport();
  const built = await buildProject({ project, projectDir: source, sdkRoot: sdk, outputDir: game, development: true });
  await fs.writeFile(path.join(output, 'compile.log'), built.log + '\n' + JSON.stringify(built.diagnostics, null, 2));
  (report.checks as unknown[]).push({ name: 'compile', ok: built.ok, diagnostics: built.diagnostics });
  assert.ok(built.ok, built.log + JSON.stringify(built.diagnostics));
  await fs.writeFile(path.join(game, 'game', 'testcases.rpy'), tests);
  await preserveGenerated(path.join(game, 'game'));
  const options = { savedir: path.join(output, 'saves'), timeoutMs: 150000, env: { RENPY_RENDERER: 'gl2' } };
  const lint = await runRenpy(sdk, game, ['lint'], options);
  await fs.writeFile(path.join(output, 'lint.log'), lint.log);
  (report.checks as unknown[]).push({ name: 'lint', code: lint.code }); assert.equal(lint.code, 0, lint.log);
  const result = await runRenpy(sdk, game, ['test', '--report-detailed', '--report-skipped'], { ...options, onData: text => process.stdout.write(text) });
  await fs.writeFile(path.join(output, 'runtime.log'), result.log);
  recordFlowNativeResult(report, tests.slice(tests.indexOf('\ntestsuite global:')), result, 10);
  report.status = 'passed';
} catch (error) { failure = error; report.status = 'failed'; report.error = String(error); console.error(error); }
finally {
  const finishError = await finishFlowNativeVerification(output, game, report, previousSaves);
  failure ??= finishError;
  if (failure) process.exitCode = 1;
}
