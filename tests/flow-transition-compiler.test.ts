import assert from 'node:assert/strict';
import test from 'node:test';
import { createBlueprintGraph } from '../src/core/blueprint';
import { storyTransition, storyTransitionPorts, type FlowTransition } from '../src/core/flow-transitions';
import { createProject, type PassageNode, type Project, type StoryNode } from '../src/core/model';
import { performancePlayback } from '../src/core/standalone-performance';
import { compileProject } from '../src/runtime/compiler';
import { createFlowTransitionLookahead } from '../src/runtime/flow-transition-runtime';

const base = { sceneId: 'scene', x: 0, y: 0 };
const dissolve: FlowTransition = { mode: 'dissolve', duration: 0.8 };
const color: FlowTransition = { mode: 'color', outDuration: 0.2, hold: 0.1, inDuration: 0.3, color: '#112233' };

function fixture(nodes: StoryNode[], entryId = nodes[0].id): Project {
  return {
    ...createProject('连线过渡编译契约'), entryId,
    chapters: [{ id: 'chapter', name: '第一章' }],
    scenes: [{ id: 'scene', name: '测试场景', chapterId: 'chapter' }],
    variables: [{ id: 'score', name: '得分', type: 'number', initial: 0, persistent: false }],
    nodes,
  };
}

function performance(id: string, next: string): PassageNode {
  return { ...base, id, name: id, kind: 'passage', next, lines: [{
    id: `${id}_line`, text: '', silent: true, actions: [{ kind: 'pause', seconds: 0.1 }],
    playback: { transition: { mode: 'color', outDuration: 0.2, hold: 0.1, inDuration: 0.2, color: '#000000' } },
  }] };
}

function dialogue(id: string, next: string): PassageNode {
  return { ...base, id, name: id, kind: 'passage', next, lines: [{ id: `${id}_line`, text: '这里开始新的画面。', actions: [] }] };
}

function ending(id = 'ending'): StoryNode { return { ...base, kind: 'end', id, name: id }; }
function returning(id = 'back'): StoryNode { return { ...base, kind: 'return', id, name: id }; }

function compileStory(project: Project): string {
  const result = compileProject(project);
  assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
  assert.ok(result.files['game/story.rpy']);
  return result.files['game/story.rpy'];
}

/** Inspect only one authored label, avoiding unrelated runtime implementation text. */
function labelBody(story: string, label: string): string {
  const marker = `label ${label}:`;
  const start = story.indexOf(marker);
  assert.notEqual(start, -1, `缺少标签 ${label}`);
  const end = story.indexOf('\nlabel ', start + marker.length);
  return story.slice(start + marker.length, end < 0 ? undefined : end);
}

function lineBody(story: string, node: PassageNode): string {
  return labelBody(story, `vn_line_${node.id}_${node.lines[0].id}`);
}

function queueLines(body: string): string[] {
  return body.split('\n').filter(line => /^\s*\$ vn_flow_transition_queue\(/.test(line));
}

function inOrder(body: string, ...parts: string[]): void {
  let offset = 0;
  for (const part of parts) {
    const at = body.indexOf(part, offset);
    assert.notEqual(at, -1, `未按执行顺序找到 ${part}\n${body}`);
    offset = at + part.length;
  }
}

function assertDeferred(body: string, expected: boolean): void {
  assert.equal(body.includes('keep_final_frame=True'), expected);
  assert.equal(body.includes('defer_transition=True'), expected);
}

test('旧章节标题返回标题时不执行保留的下一出口过渡', () => {
  const chapter: StoryNode = {
    ...base, kind: 'chapterTitle', id: 'chapter_title', name: '旧章节演出',
    title: '第一章', subtitle: '', duration: 0.1, next: 'ending',
    playback: { onComplete: 'title' }, transitions: { next: dissolve },
  };
  const project = fixture([chapter, ending()]), before = structuredClone(project);
  assert.deepEqual(storyTransitionPorts(chapter, project), []);
  const body = labelBody(compileStory(project), 'vn_node_chapter_title');
  assert.match(body, /jump vn_end_return/);
  assert.doesNotMatch(body, /jump vn_node_ending/);
  assert.deepEqual(queueLines(body), []);
  assert.deepEqual(project, before);
});

test('调用体先显示对白时不会把返回出口的过渡提前到调用之前', () => {
  const source = performance('source', 'caller');
  const project = fixture([
    source,
    { ...base, kind: 'call', id: 'caller', name: '调用对白', target: 'callee', next: 'ending', transitions: { next: dissolve } },
    dialogue('callee', 'back'), returning(), ending(),
  ]);
  assert.equal(createFlowTransitionLookahead(project)(source), false);
  const story = compileStory(project), body = labelBody(story, 'vn_node_caller');
  assertDeferred(lineBody(story, source), false);
  assert.deepEqual(queueLines(lineBody(story, source)), []);
  assert.equal(queueLines(body).length, 1);
  inOrder(body, 'call vn_node_callee', ', "caller", "next")', 'jump vn_node_ending');
});

test('无画面的赋值和条件调用允许延后旧收尾，但仍在运行时执行一次真实分支', () => {
  const source = performance('source', 'caller');
  const project = fixture([
    source,
    { ...base, kind: 'call', id: 'caller', name: '调用计算', target: 'increment', next: 'ending', transitions: { next: dissolve } },
    { ...base, kind: 'set', id: 'increment', name: '得分加一', variableId: 'score', operation: 'add', value: 1, next: 'gate' },
    { ...base, kind: 'condition', id: 'gate', name: '检查得分', condition: { kind: 'compare', variableId: 'score', operator: 'gte', value: 1 }, yes: 'back_yes', no: 'back_no' },
    returning('back_yes'), returning('back_no'), ending(),
  ]);
  assert.equal(createFlowTransitionLookahead(project)(source), true);
  const story = compileStory(project);
  assertDeferred(lineBody(story, source), true);
  assert.deepEqual(queueLines(lineBody(story, source)), []);
  const increment = labelBody(story, 'vn_node_increment'), gate = labelBody(story, 'vn_node_gate');
  assert.equal(increment.match(/\bvn_parameter_set\(/g)?.length, 1);
  assert.match(increment, /vn_parameter_set\("score", vn_var_score \+ 1, False\)/);
  inOrder(increment, 'vn_parameter_set(', 'jump vn_node_gate');
  inOrder(gate, 'if (vn_var_score >= 1):', 'jump vn_node_back_yes', 'else:', 'jump vn_node_back_no');
  assert.deepEqual(queueLines(increment + gate), []);
  const caller = labelBody(story, 'vn_node_caller');
  assert.equal(queueLines(caller).length, 1);
  inOrder(caller, 'call vn_node_increment', ', "caller", "next")', 'jump vn_node_ending');
});

test('嵌套调用和条件环的前瞻终止，只有全透明的调用链能越过返回边界', () => {
  for (const visibleLeaf of [false, true]) {
    const source = performance('source', 'outer');
    const leaf: StoryNode = visibleLeaf ? dialogue('leaf', 'gate')
      : { ...base, kind: 'set', id: 'leaf', name: '叶子计算', variableId: 'score', operation: 'add', value: 1, next: 'gate' };
    const project = fixture([
      source,
      { ...base, kind: 'call', id: 'outer', name: '外层调用', target: 'inner', next: 'ending', transitions: { next: dissolve } },
      { ...base, kind: 'call', id: 'inner', name: '内层调用', target: 'leaf', next: 'outer_back' },
      leaf,
      { ...base, kind: 'condition', id: 'gate', name: '条件循环', condition: { kind: 'compare', variableId: 'score', operator: 'gte', value: 1 }, yes: 'inner_back', no: 'loop' },
      { ...base, kind: 'jump', id: 'loop', name: '继续检查', target: 'gate' },
      returning('inner_back'), returning('outer_back'), ending(),
    ]);
    const lookahead = createFlowTransitionLookahead(project);
    assert.equal(lookahead(source), !visibleLeaf);
    assert.equal(lookahead(source), !visibleLeaf, '缓存不能改变判断');
    const story = compileStory(project);
    assertDeferred(lineBody(story, source), !visibleLeaf);
    assert.deepEqual(queueLines(labelBody(story, 'vn_node_inner')), []);
    inOrder(labelBody(story, 'vn_node_outer'), 'call vn_node_inner', ', "outer", "next")', 'jump vn_node_ending');
  }
});

test('共享演出返回实际调用处以后才排入该调用的后续过渡，返回节点不猜测调用者', () => {
  const inside = performance('inside', 'back');
  const project = fixture([
    { ...base, kind: 'choice', id: 'route', name: '选择调用处', prompt: '选择路线', choices: [{ id: 'route_a', text: '甲', target: 'caller_a' }, { id: 'route_b', text: '乙', target: 'caller_b' }] },
    { ...base, kind: 'call', id: 'caller_a', name: '甲调用', target: 'inside', next: 'after_a', transitions: { target: { mode: 'none' }, next: dissolve } },
    { ...base, kind: 'call', id: 'caller_b', name: '乙调用', target: 'inside', next: 'after_b', transitions: { next: color } },
    inside, returning(), ending('after_a'), ending('after_b'),
  ]);
  assert.equal(createFlowTransitionLookahead(project)(inside), true);
  const story = compileStory(project), body = lineBody(story, inside);
  assertDeferred(body, true);
  assert.deepEqual(queueLines(body), []);
  assert.deepEqual(queueLines(labelBody(story, 'vn_node_back')), []);
  assert.match(labelBody(story, 'vn_node_back'), /\n    return\s*$/);
  assert.doesNotMatch(labelBody(story, 'vn_node_back'), /\b(?:call|jump) vn_node_/);
  const callerA = labelBody(story, 'vn_node_caller_a'), callerB = labelBody(story, 'vn_node_caller_b');
  assert.equal(queueLines(callerA).length, 2);
  inOrder(callerA, ', "caller_a", "target")', 'call vn_node_inside', ', "caller_a", "next")', 'jump vn_node_after_a');
  assert.equal(queueLines(callerB).length, 1);
  inOrder(callerB, 'call vn_node_inside', ', "caller_b", "next")', 'jump vn_node_after_b');
  assert.match(queueLines(callerA)[1], /"mode": "dissolve"/);
  assert.match(queueLines(callerB)[0], /"mode": "color"/);
});

test('断开的可选出口和已删除端口保留数据但不排入过渡，重新连接仅启用真实出口', () => {
  const source = performance('source', 'interaction');
  const interaction: Extract<StoryNode, { kind: 'interaction' }> = {
    ...base, kind: 'interaction', id: 'interaction', name: '查看画面', prompt: '点击查看', showHints: true, timeoutSeconds: 0,
    hotspots: [{ id: 'open', name: '继续', x: 0.2, y: 0.2, width: 0.2, height: 0.2, target: 'ending' }],
    transitions: { cancel: color, timeout: dissolve, removed_hotspot: { mode: 'none' } },
  };
  const project = fixture([source, interaction, ending()]), before = structuredClone(interaction.transitions);
  assert.equal(createFlowTransitionLookahead(project)(source), false);
  assert.deepEqual(queueLines(compileStory(project)), []);
  assert.deepEqual(interaction.transitions, before);
  interaction.cancel = 'ending';
  const body = labelBody(compileStory(project), 'vn_node_interaction');
  assert.equal(queueLines(body).length, 1);
  inOrder(body, 'if vn_interaction_result == "cancel":', ', "interaction", "cancel")', 'jump vn_node_ending');
  assert.deepEqual(interaction.transitions, before);
});

test('继承的返回标题设置先于保留的连线生效，明确覆盖为继续后才启用连线', () => {
  const source = performance('source', 'ending'), graph = createBlueprintGraph('effect', '返回标题演出');
  graph.playback = { onComplete: 'title', transition: source.lines[0].playback!.transition };
  source.lines[0].actions.unshift({ kind: 'blueprint', blueprintId: graph.id });
  delete source.lines[0].playback;
  source.transitions = { next: dissolve };
  const project = fixture([source, ending()]);
  project.blueprints.push(graph);
  assert.equal(performancePlayback(project, source.lines[0]).onComplete, 'title');
  assert.deepEqual(storyTransitionPorts(source, project), []);
  const body = lineBody(compileStory(project), source);
  assertDeferred(body, false);
  inOrder(body, 'vn_performance_finish(', '    jump vn_end_return');
  // Generated unreachable fallthrough is harmless: no queue may execute before returning to title.
  const reachable = body.slice(0, body.indexOf('    jump vn_end_return'));
  assert.deepEqual(queueLines(reachable), []);
  assert.doesNotMatch(reachable, /jump vn_node_ending/);
  source.lines[0].playback = { onComplete: 'next' };
  assert.equal(performancePlayback(project, source.lines[0]).onComplete, 'next');
  assert.deepEqual(storyTransitionPorts(source, project), [{ port: 'next', target: 'ending' }]);
  const continued = lineBody(compileStory(project), source);
  assertDeferred(continued, true);
  assert.doesNotMatch(continued, /jump vn_end_return/);
  assert.equal(queueLines(continued).length, 1);
  inOrder(continued, 'vn_performance_finish(', ', "source", "next")', 'jump vn_node_ending');
});

test('名为constructor的真实选项不读取对象原型，仅明确保存的过渡会编译', () => {
  const source = performance('source', 'choice');
  const choice: Extract<StoryNode, { kind: 'choice' }> = {
    ...base, kind: 'choice', id: 'choice', name: '合法选项身份', prompt: '继续？',
    choices: [{ id: 'constructor', text: '继续', target: 'ending' }], transitions: {},
  };
  const project = fixture([source, choice, ending()]);
  assert.equal(storyTransition(choice, 'constructor'), undefined);
  assert.equal(createFlowTransitionLookahead(project)(source), false);
  assert.deepEqual(queueLines(compileStory(project)), []);
  choice.transitions = { constructor: dissolve };
  assert.deepEqual(storyTransition(choice, 'constructor'), dissolve);
  const body = labelBody(compileStory(project), 'vn_node_choice');
  assert.equal(queueLines(body).length, 1);
  inOrder(body, ', "choice", "constructor")', 'jump vn_node_ending');
});

test('读档只补播未消费的旧过渡阶段，保持上下文隔离和玩家的过渡偏好', () => {
  const story = compileStory(fixture([dialogue('source', 'ending'), ending()]));
  const runtimeFunction = (name: string): string => {
    const start = story.indexOf(`\n    def ${name}(`);
    assert.notEqual(start, -1, `缺少运行时函数 ${name}`);
    const end = story.indexOf('\n    def ', start + 1);
    return story.slice(start, end < 0 ? undefined : end);
  };
  // Each phase must become consumed in the load snapshot before entering a
  // saveable native interaction, or loading there would replay that phase.
  inOrder(runtimeFunction('vn_performance_reveal'),
    'vn_performance_transition = None', 'if vn_flow_transition_legacy_pending:',
    'renpy.retain_after_load()', 'vn_stage_transition(');
  inOrder(runtimeFunction('vn_apply_scene_transition'),
    'vn_pending_scene_transition = None', 'if vn_flow_transition_legacy_pending:',
    'renpy.retain_after_load()', 'vn_stage_transition(');

  const play = runtimeFunction('vn_flow_transition_play');
  inOrder(play,
    'if spec is None and vn_flow_transition_legacy_pending and (vn_performance_transition is not None or vn_pending_scene_transition is not None) and renpy.game.after_rollback and renpy.game.interface.suppress_transition:',
    'vn_flow_transition_play.restoring = owner_context', 'renpy.with_statement(None)',
    'vn_flow_transition_legacy()', 'finally:',
    'if renpy.game.context() is owner_context and vn_flow_transition_active is record:',
    'vn_flow_transition_resume()',
    'if getattr(vn_flow_transition_play, "restoring", None) is owner_context:',
    'vn_flow_transition_play.restoring = None');

  const stage = runtimeFunction('vn_stage_transition');
  inOrder(stage,
    'if getattr(vn_flow_transition_play, "restoring", None) is renpy.game.context() and renpy.game.after_rollback and renpy.game.interface.suppress_transition and preferences.transitions and not renpy.is_skipping():',
    'renpy.mode("with")', 'renpy.transition(transition, layer="master", force=True)',
    'root_transition = config.with_callback(root_transition, None)',
    'if not root_transition:', 'renpy.game.interface.with_none()', 'return False',
    'renpy.transition(root_transition, force=True)',
    'return renpy.ui.interact(type="with", trans_pause=True, suppress_overlay=not config.overlay_during_with, mouse="with", clear=True)',
    'return renpy.with_statement({"master": transition, None: Pause(duration)})');
  assert.equal(stage.match(/config\.with_callback\(/g)?.length, 1, '恢复不能重复执行过渡回调');
  assert.doesNotMatch(play + stage, /\b(?:suppress_transition|after_rollback)\s*=(?!=)|always\s*=\s*True/,
    '恢复新阶段不能修改引擎全局抑制或绕过玩家的关闭／跳过设置');
});
