import test from 'node:test';
import assert from 'node:assert/strict';
import { blueprintNodeDefaults, callablePins, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { addGameFlowStep } from '../src/core/game-flow-graph';
import { gameFlowStepSchema } from '../src/core/game-flow-schema';
import { createProject, projectSchema, type BlueprintGraph, type BlueprintNode } from '../src/core/model';
import { arrangePerformanceTimeline, performanceTimeline } from '../src/core/performance-timeline';
import { addProjectGraphs, projectGraphs } from '../src/core/project-resources';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { createVisualObject } from '../src/core/visual-object';
import { compileProject, type CompileResult } from '../src/runtime/compiler';

function labelBody(source: string, name: string): string {
  const header = new RegExp(`^label ${name}(?:\\([^\\n]*\\))?:\\n`, 'm').exec(source);
  assert.ok(header, `缺少生成标签 ${name}`);
  const end = source.indexOf('\nlabel ', header.index + header[0].length);
  return source.slice(header.index, end < 0 ? undefined : end);
}

function pythonFunction(source: string, name: string): string {
  const header = new RegExp(`^    def ${name}\\([^\\n]*\\):\\n`, 'm').exec(source);
  assert.ok(header, `缺少运行时函数 ${name}`);
  const following = source.slice(header.index + header[0].length);
  const end = following.search(/\n(?=    (?:def |class )|(?:init|label|screen|default|define) )/);
  return source.slice(header.index, end < 0 ? undefined : header.index + header[0].length + end);
}

function sourceStatements(compiled: CompileResult, nodeId: string): string {
  return compiled.files['game/story.rpy'].split('\n').filter((_line, index) => compiled.sourceMap[`game/story.rpy:${index + 1}`]?.nodeId === nodeId).join('\n');
}

function compile(project: Parameters<typeof compileProject>[0]): CompileResult {
  const before = JSON.stringify(project);
  const compiled = compileProject(project);
  assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), []);
  assert.equal(JSON.stringify(project), before, '编译不能改写步骤设置或共享演出');
  return compiled;
}

function flowCalls(source: string, phase: 'before_title' | 'before_new_game') {
  const body = labelBody(source, `vn_game_flow_${phase}`);
  const calls = [...body.matchAll(/\$ vn_flow_begin_step\("([a-z][a-z0-9_]*)", "blueprint", (False|True),[^\n]*\)\n\s+call vn_blueprint_([a-z][a-z0-9_]*) from vn_flow_call_([a-z][a-z0-9_]*)\n\s+\$ vn_flow_end_step\(\)/g)];
  assert.equal(calls.length, (body.match(/\$ vn_flow_begin_step\(/g) ?? []).length, '每一步必须先建立作用域、调用资源，再结束作用域');
  return calls.map(([, stepId, allowSkip, graphId, callId]) => ({ stepId, allowSkip: allowSkip === 'True', graphId, callId }));
}

function link(graph: BlueprintGraph, from: BlueprintNode, to: BlueprintNode) {
  assert.equal(connectBlueprintPins(graph, from.id, from.type === 'event' ? 'exec' : 'exec_out', to.id, 'exec_in'), undefined);
}

function fixture() {
  const project = createProject('游戏流程跳过契约');
  project.variables.push({ id: 'skip_after_wait', name: '等待后的执行', type: 'number', initial: 0, persistent: false });
  const card = createVisualObject('solid'); card.instanceId = 'skip_card'; card.duration = 3;
  const timeline = blueprintFromPerformance(project, [card], '共享开场演出'); timeline.id = 'skip_timeline';
  timeline.playback = { clickSkip: true };
  addProjectGraphs(project, timeline);
  const plan = performanceTimeline(project, timeline);
  assert.equal(plan.reason, undefined);
  arrangePerformanceTimeline(project, timeline, plan.clips.map(clip => ({ ...clip, at: .4 })), plan.tracks);

  const ordinary = createBlueprintGraph('function', '普通等待'); ordinary.id = 'skip_ordinary';
  const wait = blueprintNodeDefaults('delay'); wait.id = 'skip_delay'; wait.properties.seconds = .6;
  const afterWait = blueprintNodeDefaults('setVariable'); afterWait.id = 'skip_write';
  afterWait.properties = { variableId: 'skip_after_wait', value: 1 };
  ordinary.nodes.push(wait, afterWait); link(ordinary, ordinary.nodes[0], wait); link(ordinary, wait, afterWait);

  const macro = createBlueprintGraph('macro', '嵌套演出'); macro.id = 'skip_macro';
  const timelineCall = blueprintNodeDefaults('callFunction'); timelineCall.id = 'skip_timeline_call';
  timelineCall.properties.graphId = timeline.id; timelineCall.pins = callablePins(timeline);
  macro.nodes.push(timelineCall); link(macro, macro.nodes[0], timelineCall);

  const wrapper = createBlueprintGraph('function', '流程调用入口'); wrapper.id = 'skip_wrapper';
  const macroCall = blueprintNodeDefaults('callMacro'); macroCall.id = 'skip_macro_call';
  macroCall.properties.graphId = macro.id; macroCall.pins = callablePins(macro);
  const ordinaryCall = blueprintNodeDefaults('callFunction'); ordinaryCall.id = 'skip_ordinary_call';
  ordinaryCall.properties.graphId = ordinary.id; ordinaryCall.pins = callablePins(ordinary);
  wrapper.nodes.push(macroCall, ordinaryCall); link(wrapper, wrapper.nodes[0], macroCall); link(wrapper, macroCall, ordinaryCall);
  addProjectGraphs(project, ordinary, macro, wrapper);
  synchronizeBlueprintSignatures(project);
  return { project, timeline, ordinary, macro, wrapper, wait, afterWait, timelineCall, macroCall, ordinaryCall };
}

test('旧步骤缺省禁止跳过，JSON保存后保留显式false与true并且不修改输入', () => {
  for (const input of [
    { id: 'legacy_blueprint', kind: 'blueprint', graphId: 'skip_timeline' },
    { id: 'legacy_page', kind: 'page', pageId: 'ui:preferences' },
    { id: 'legacy_video', kind: 'video', assetId: 'skip_movie' },
  ]) {
    const before = JSON.stringify(input);
    assert.equal(gameFlowStepSchema.parse(input).allowSkip, false);
    assert.equal(gameFlowStepSchema.parse({ ...input, allowSkip: true }).allowSkip, true);
    assert.equal(JSON.stringify(input), before);
  }
  const { project, timeline } = fixture();
  const legacy = { ...project, gameFlow: {
    schemaVersion: 1,
    beforeTitle: { steps: [
      { id: 'legacy_default', kind: 'blueprint', graphId: timeline.id },
      { id: 'legacy_true', kind: 'blueprint', graphId: timeline.id, allowSkip: true },
    ] },
    beforeNewGame: [{ id: 'legacy_false', kind: 'blueprint', graphId: timeline.id, allowSkip: false }],
  } };
  const original = JSON.stringify(legacy), restored = projectSchema.parse(JSON.parse(original));
  assert.equal(JSON.stringify(legacy), original);
  assert.deepEqual(restored.gameFlow?.beforeTitle.steps.map(step => step.allowSkip), [false, true]);
  assert.equal(restored.gameFlow?.beforeNewGame[0].allowSkip, false);
  const reloaded = projectSchema.parse(JSON.parse(JSON.stringify(restored)));
  assert.deepEqual(reloaded.gameFlow, restored.gameFlow);
  assert.deepEqual(flowCalls(compile(reloaded).files['game/01-vn-game-flow.rpy'], 'before_title'), [
    { stepId: 'legacy_default', allowSkip: false, graphId: timeline.id, callId: 'legacy_default' },
    { stepId: 'legacy_true', allowSkip: true, graphId: timeline.id, callId: 'legacy_true' },
  ]);
});

test('同一演出在两条流程中逐步骤保存跳过设置，修改一处不会改变共享资源或另一处', () => {
  const { project, timeline } = fixture(), resourceBefore = structuredClone(timeline);
  const locked = addGameFlowStep(project, 'beforeTitle', { id: 'locked_opening', kind: 'blueprint', graphId: timeline.id, allowSkip: false });
  const optional = addGameFlowStep(project, 'beforeTitle', { id: 'optional_opening', kind: 'blueprint', graphId: timeline.id, allowSkip: true });
  const setup = addGameFlowStep(project, 'beforeNewGame', { id: 'locked_setup', kind: 'blueprint', graphId: timeline.id });
  assert.deepEqual(timeline, resourceBefore, '步骤开关不能覆盖共享演出的clickSkip默认');
  const restored = projectSchema.parse(JSON.parse(JSON.stringify(project)));
  const textRoundTrip = applyTextScript(restored, projectToText(restored));
  assert.deepEqual(textRoundTrip.issues, []);
  assert.deepEqual(textRoundTrip.project.gameFlow, restored.gameFlow);
  assert.deepEqual(projectGraphs(restored).find(graph => graph.id === timeline.id), resourceBefore);
  const runtime = compile(textRoundTrip.project).files['game/01-vn-game-flow.rpy'];
  assert.deepEqual(flowCalls(runtime, 'before_title'), [
    { stepId: locked.id, allowSkip: false, graphId: timeline.id, callId: locked.id },
    { stepId: optional.id, allowSkip: true, graphId: timeline.id, callId: optional.id },
  ]);
  assert.deepEqual(flowCalls(runtime, 'before_new_game'), [{ stepId: setup.id, allowSkip: false, graphId: timeline.id, callId: setup.id }]);
  const edited = structuredClone(restored); edited.gameFlow!.beforeTitle.steps[0].allowSkip = true;
  const editedRuntime = compile(edited).files['game/01-vn-game-flow.rpy'];
  assert.deepEqual(flowCalls(editedRuntime, 'before_title').map(call => call.allowSkip), [true, true]);
  assert.equal(flowCalls(editedRuntime, 'before_new_game')[0].allowSkip, false);
  assert.equal(restored.gameFlow!.beforeTitle.steps[0].allowSkip, false);
  assert.deepEqual(projectGraphs(edited).find(graph => graph.id === timeline.id), resourceBefore);
});

test('流程到函数、宏、时间轴及普通等待的完整调用均先继承任务再保护跳过', () => {
  const f = fixture();
  const step = addGameFlowStep(f.project, 'beforeTitle', { id: 'nested_opening', kind: 'blueprint', graphId: f.wrapper.id });
  const compiled = compile(f.project), story = compiled.files['game/story.rpy'];
  assert.deepEqual(flowCalls(compiled.files['game/01-vn-game-flow.rpy'], 'before_title'), [{ stepId: step.id, allowSkip: false, graphId: f.wrapper.id, callId: step.id }]);
  for (const graph of [f.wrapper, f.macro, f.timeline, f.ordinary]) {
    const body = labelBody(story, `vn_blueprint_${graph.id}`);
    const inherit = body.indexOf('$ vn_bp_task = vn_bp_task or vn_bp_task_create()');
    const protect = body.indexOf('$ vn_bp_protect_flow_skip(vn_bp_task)');
    const firstNode = body.indexOf('if not vn_bp_task_alive(vn_bp_task):');
    assert.ok(inherit >= 0 && protect > inherit && firstNode > protect, graph.name);
    assert.ok(body.indexOf('$ renpy.dynamic("vn_bp_task", "vn_bp_wait")') < inherit);
    assert.equal((body.match(/\$ vn_bp_protect_flow_skip\(vn_bp_task\)/g) ?? []).length, 1);
    assert.doesNotMatch(body.slice(0, protect), /call vn_blueprint_|vn_bp_pause\(|vn_performance_pause\(/);
  }
  for (const [call, target] of [[f.macroCall, f.macro], [f.timelineCall, f.timeline], [f.ordinaryCall, f.ordinary]] as const) {
    const rows = sourceStatements(compiled, call.id);
    assert.match(rows, new RegExp(`call vn_blueprint_${target.id} from vn_blueprint_nested_${call.id}\\n\\s+if not vn_bp_task_alive\\(vn_bp_task\\):\\n\\s+\\$ vn_bp_leave_frame\\(\\)\\n\\s+return`));
  }
  const ordinaryWait = sourceStatements(compiled, f.wait.id);
  assert.match(ordinaryWait, /elif vn_bp_task is not None:\n\s+\$ vn_bp_pause\(0\.6\)/);
  assert.ok(ordinaryWait.includes('$ renpy.checkpoint(hard=False)'));
  const tail = f.timeline.nodes.find(node => node.id === f.timeline.timeline?.tailNodeId)!;
  const gap = f.timeline.nodes.find(node => node.type === 'delay' && node.id !== tail.id)!;
  assert.ok(gap, '合成时间轴必须同时包含间隔等待和尾等待');
  assert.ok(sourceStatements(compiled, gap.id).includes('vn_performance_pause(max(0.0,'));
  assert.ok(sourceStatements(compiled, tail.id).includes(`vn_performance_pause(max(0.0, vn_bp_timeline_end_${f.timeline.id} - vn_stage_clock()))`));
  assert.match(pythonFunction(story, 'vn_performance_pause'), /if not vn_performance_active:\n\s+return vn_bp_pause\(seconds\)/);
  assert.match(sourceStatements(compiled, f.afterWait.id), /if not vn_bp_task_alive\(vn_bp_task\):[\s\S]*return[\s\S]*vn_parameter_set\("skip_after_wait", 1, False\)/);
});

test('生成保护仅读取所属蓝图步骤，普通演出的clickSkip设置与显式跳过入口保留', () => {
  const { project, timeline } = fixture();
  addGameFlowStep(project, 'beforeTitle', { id: 'protected_contract', kind: 'blueprint', graphId: timeline.id });
  const passage = project.nodes.find(node => node.kind === 'passage')!;
  passage.lines = [
    { id: 'ordinary_allowed', text: '', silent: true, actions: [{ kind: 'blueprint', blueprintId: timeline.id }], playback: { clickSkip: true } },
    { id: 'ordinary_protected', text: '', silent: true, actions: [{ kind: 'blueprint', blueprintId: timeline.id }], playback: { clickSkip: false } },
    { id: 'ordinary_dialogue', text: '普通剧情仍可以继续。', actions: [{ kind: 'pause', seconds: .2 }] },
  ];
  const compiled = compile(project), story = compiled.files['game/story.rpy'];
  const helper = pythonFunction(story, 'vn_bp_protect_flow_skip');
  assert.match(helper, /flow = \(task or \{\}\)\.get\("flow"\) or \{\}/);
  assert.match(helper, /if flow\.get\("kind"\) != "blueprint" or flow\.get\("allowSkip", False\):\n\s+return False/);
  assert.match(helper, /renpy\.dynamic\(_skipping=False, _dismiss_pause=False\)\n\s+renpy\.stop_skipping\(\)\n\s+return True/);
  assert.doesNotMatch(helper, /vn_flow_active_step|vn_performance_settings|vn_bp_task_create|\.get\("page"/);
  for (const [lineId, setting] of [['ordinary_allowed', 'True'], ['ordinary_protected', 'False']] as const) {
    const body = labelBody(story, `vn_line_${passage.id}_${lineId}`);
    assert.match(body, new RegExp(`vn_performance_begin\\(\\{"clickSkip": ${setting}`));
    assert.ok(body.includes(`call vn_blueprint_${timeline.id}`));
    assert.doesNotMatch(body, /vn_bp_protect_flow_skip|_skipping\s*=/);
  }
  const dialogue = labelBody(story, `vn_line_${passage.id}_ordinary_dialogue`);
  assert.match(dialogue, /else:\n\s+pause 0\.2/);
  assert.ok(dialogue.includes(`id vn_say_${passage.id}_ordinary_dialogue`));
  const flowRuntime = compiled.files['game/01-vn-game-flow.rpy'];
  assert.match(pythonFunction(flowRuntime, 'vn_flow_request_skip'), /if not vn_flow_active_step or not vn_flow_active_step\.get\("allowSkip"\):\n\s+return/);
  assert.match(flowRuntime, /if vn_flow_active_step and vn_flow_active_step\.get\("kind"\) == "blueprint" and vn_flow_active_step\.get\("allowSkip"\):\n\s+textbutton "跳过这一项" action Function\(vn_flow_request_skip\)/);
});

test('暂停入口补保护只提升hard等待，并保留取消检查、可恢复计时与finally清理', () => {
  const { project } = fixture(), story = compile(project).files['game/story.rpy'];
  const pause = pythonFunction(story, 'vn_bp_pause');
  assert.match(pause, /^    def vn_bp_pause\(seconds, hard=False\):/);
  assert.match(pause, /if not vn_bp_task_alive\(vn_bp_task\):\n\s+return True/);
  assert.match(pause, /if vn_bp_protect_flow_skip\(vn_bp_task\):\n\s+hard = True/);
  assert.doesNotMatch(pause, /^\s+hard\s*=\s*(?:False|vn_bp_protect_flow_skip\()/m);
  assert.ok(pause.indexOf('vn_bp_protect_flow_skip(vn_bp_task)') < pause.indexOf('vn_flow_transition_flush()'));
  assert.ok(pause.indexOf('vn_bp_protect_flow_skip(vn_bp_task)') < pause.indexOf('while vn_bp_task_alive(vn_bp_task)'));
  assert.ok(pause.indexOf('renpy.retain_after_load()') < pause.indexOf('renpy.pause('));
  assert.match(pause, /while vn_bp_task_alive\(vn_bp_task\) and not renpy\.is_skipping\(\) and vn_bp_wait\["elapsed"\] < vn_bp_wait\["duration"\]:/);
  assert.match(pause, /renpy\.pause\([^\n]*hard=hard, modal=False\)/);
  assert.match(pause, /return not vn_bp_task_alive\(vn_bp_task\)\n\s+finally:\n\s+vn_bp_wait = None/);
  assert.match(pythonFunction(story, 'vn_bp_task_alive'), /if \(task\.get\("flow"\) or \{\}\)\.get\("cancelled", False\):\n\s+return False/);
  assert.match(pythonFunction(story, 'vn_bp_poll_task'), /if not vn_bp_task_alive\(vn_bp_task\):\n\s+vn_bp_interrupt_wait\(\)/);
});
