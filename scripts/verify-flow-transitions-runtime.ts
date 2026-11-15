import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { createProject, type BlueprintGraph, type BlueprintNode, type PassageNode, type Project, type StageAction, type StoryNode, type VisualObject } from '../src/core/model';
import type { FlowTransition } from '../src/core/flow-transition-schema';
import { arrangePerformanceTimeline, performanceTimeline } from '../src/core/performance-timeline';
import { buildProject, runRenpy } from '../src/runtime/service';
import { pythonLiteral as q } from '../src/runtime/literals';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { isolateRenpySaves } from './lib/renpy-saves';

// Prepare first; run only after the complete product change and final editor build.
// All tested edges come from authored project data. Jump() only selects each
// isolated scenario's starting passage; it never substitutes for a tested edge.
// Dismiss each source once: Ren'Py's test "advance" repeats dismiss while waiting
// for the next say, which would prematurely dismiss a transition or a wait.
const args = process.argv.slice(2);
assert.ok(args.length <= 1 && args.every(arg => /^--case=[a-z][a-z0-9_]*$/.test(arg)), 'Usage: verify-flow-transitions-runtime.ts [--case=testcase_name]');
const selectedCase = args[0]?.slice('--case='.length);
const sdk = process.env.VNS_RENPY_SDK ?? path.resolve('resources/runtime');
const output = path.resolve('artifacts/flow-transitions-2026-11-09', 'runtime-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const source = path.join(output, 'source'), game = path.join(output, 'game'), saves = path.join(output, 'saves');
const authorFile = path.resolve(process.env.VNS_AUTHOR_PROJECT ?? '../我的视觉小说1/project.vns.json');
const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const previousRenpySaves = process.env.RENPY_PATH_TO_SAVES;
const report: Record<string, unknown> = {
  status: 'running', authorFile, checks: [], testSelection: selectedCase ?? 'all',
  temporaryPaths: [source, game, saves, path.join(output, 'renpy-saves')],
  observations: 'Real compiled story edges; native master-layer transitions, frame pixels, UI marker, text/audio/video playback, counters, wait and save/load boundaries. No product test probes.',
};
let authorHash: string | undefined, failure: unknown;
await fs.mkdir(path.join(output, 'screenshots'), { recursive: true });
await fs.mkdir(path.join(output, 'traces'), { recursive: true });
const saveReport = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
async function check(name: string, result: { code: number; log: string }) {
  const logPath = path.join(output, name + '.log');
  await fs.writeFile(logPath, result.log);
  (report.checks as unknown[]).push({ name, code: result.code, logPath });
  await saveReport();
  assert.equal(result.code, 0, name + ': ' + result.log.slice(-12000));
}

const dissolve = (duration: number): FlowTransition => ({ mode: 'dissolve', duration });
const color = (outDuration: number, hold: number, inDuration: number, shade = '#000000'): FlowTransition => ({ mode: 'color', outDuration, hold, inDuration, color: shade });
const background = (assetId: string): StageAction => ({ kind: 'background', assetId, transition: 'none' });
const legacyColor = { mode: 'color' as const, outDuration: .2, hold: .12, inDuration: .2, color: '#000000' };

function fixture(): Project {
  const p = createProject('剧情连线过渡游戏验收');
  p.id = 'flow_transition_runtime'; p.width = 960; p.height = 540; p.ui.fontSize = 24;
  p.characters = []; p.nodes = []; p.blueprints = []; p.variables = [];
  // A transparent authored ending page exposes the real master-layer result;
  // an opaque title/menu would conceal a source-frame resurrection after load.
  p.ui.pages = { gameOver: { layout: 'native', background: '#000000', backgroundOpacity: 0 }, chapterTitle: { layout: 'native', appearance: { accent: '#20e060' } } };
  p.ui.components.push({ id: 'ft_ending_label', page: 'gameOver', kind: 'text', text: '结束舞台验收', x: .35, y: .78, width: .3, height: .08 });
  p.chapters = [{ id: 'ft_chapter', name: '连线过渡验收' }];
  p.scenes = [
    { id: 'ft_scene_a', name: '源场景', chapterId: 'ft_chapter' },
    { id: 'ft_scene_b', name: '目标场景', chapterId: 'ft_chapter', entryActions: [background('ft_blue')] },
  ];
  p.assets = [
    ...['red', 'blue', 'green', 'dark'].map(name => ({ id: 'ft_' + name, name, kind: 'image' as const, category: 'scene' as const, path: `assets/${name}.png`, width: 16, height: 16 })),
    { id: 'ft_voice', name: '验收声音', kind: 'audio', category: 'voice', path: 'assets/tone.wav' },
    { id: 'ft_video', name: '先品红后青色的短视频', kind: 'video', category: 'video', path: 'assets/transition-video.webm', width: 128, height: 96 },
    ...['atl', 'offset'].map(name => ({ id: 'ft_actor_' + name, name: '角色运动像素 ' + name, kind: 'image' as const, category: 'portrait' as const, path: `assets/actor-${name}.png`, width: 96, height: 120 })),
  ];
  // No modern actor-transition rules: these two characters exercise the legacy
  // ATL gate and VNMoveOffsetMotion, rather than the independent blend runtime.
  p.characters = ['atl', 'offset'].map(name => ({ id: 'ft_' + name, name: '角色 ' + name, color: '#ffffff', expressions: [{ id: 'ft_' + name + '_normal', name: '常态', assetId: 'ft_actor_' + name }] }));
  for (const id of ['ft_scene_a_entries', 'ft_scene_b_entries', 'ft_count', 'ft_called', 'ft_returned', 'ft_wait_entries', 'ft_wait_finishes', 'ft_short_entries', 'ft_motion_entries']) {
    p.variables.push({ id, name: id, type: 'number', initial: 0, persistent: false });
  }
  p.variables.push({ id: 'ft_branch', name: '实际选择的条件分支', type: 'boolean', initial: true, persistent: false });

  function graph(id: string): BlueprintGraph {
    const g = createBlueprintGraph('function', id); g.id = id; p.blueprints.push(g); return g;
  }
  function bpNode(g: BlueprintGraph, id: string, type: BlueprintNode['type'], properties: BlueprintNode['properties'] = {}) {
    const n = blueprintNodeDefaults(type); n.id = id; Object.assign(n.properties, properties); g.nodes.push(n); return n;
  }
  function wire(g: BlueprintGraph, from: BlueprintNode, to: BlueprintNode, out = 'exec_out', input = 'exec_in') {
    synchronizeBlueprintSignatures(p);
    const result = connectBlueprintPins(g, from.id, from.type === 'event' && out === 'exec_out' ? 'exec' : out, to.id, input);
    assert.equal(result, undefined, `Fixture blueprint wire ${g.id}: ${String(result)}`);
  }
  function increment(g: BlueprintGraph, after: BlueprintNode, variableId: string, prefix: string) {
    const read = bpNode(g, prefix + '_read', 'getVariable', { variableId });
    const add = bpNode(g, prefix + '_add', 'math', { b: 1 });
    const write = bpNode(g, prefix + '_write', 'setVariable', { variableId });
    wire(g, read, add, 'value', 'a'); wire(g, add, write, 'result', 'value'); wire(g, after, write); return write;
  }
  for (const scene of p.scenes) {
    const g = graph(scene.id + '_init'); increment(g, g.nodes[0], scene.id + '_entries', scene.id);
    scene.blueprintId = g.id;
  }
  const wait = graph('ft_wait_graph');
  const beforeWait = increment(wait, wait.nodes[0], 'ft_wait_entries', 'ft_wait_before');
  const delay = bpNode(wait, 'ft_wait_delay', 'delay', { seconds: 1.0 }); wire(wait, beforeWait, delay);
  increment(wait, delay, 'ft_wait_finishes', 'ft_wait_after');
  const shortCounter = graph('ft_short_graph'); increment(shortCounter, shortCounter.nodes[0], 'ft_short_entries', 'ft_short');
  const motionCounter = graph('ft_motion_graph'); increment(motionCounter, motionCounter.nodes[0], 'ft_motion_entries', 'ft_motion');

  let position = 0;
  const base = (id: string, sceneId = 'ft_scene_a') => ({ id, name: id, sceneId, x: position++ * 260, y: 120 });
  function passage(id: string, text: string, actions: StageAction[] = [], next = 'ft_end', sceneId = 'ft_scene_a'): PassageNode {
    const n: PassageNode = { ...base(id, sceneId), kind: 'passage', lines: [{ id: id + '_line', text, actions }], next };
    p.nodes.push(n); return n;
  }
  function add(node: StoryNode) { p.nodes.push(node); return node; }
  function set(id: string, next: string, variableId = 'ft_count') {
    return add({ ...base(id), kind: 'set', variableId, operation: 'add', value: 1, next });
  }
  function condition(id: string, yes: string, no = yes, sceneId = 'ft_scene_a') {
    return add({ ...base(id, sceneId), kind: 'condition', condition: { kind: 'compare', variableId: 'ft_branch', operator: 'eq', value: true }, yes, no });
  }
  function solid(instanceId: string, duration: number, shade: string, full = true): VisualObject {
    return {
      kind: 'visual', instanceId, name: instanceId, content: 'solid', text: '', color: shade,
      width: full ? 1 : .12, height: full ? 1 : .12, layer: 10, fontSize: 48, duration, wait: false,
      keyframes: [{ x: full ? .5 : .22, y: full ? .5 : .28, scale: 1, rotation: 0, opacity: 1, duration: 0, easing: 'linear' }],
    };
  }
  function performance(id: string, next: string, legacy = false) {
    const n = passage(id, '', [solid(id + '_solid', .24, '#e02820')], next);
    n.lines[0].silent = true;
    n.lines[0].playback = { clickSkip: false, ...(legacy ? { transition: legacyColor } : {}) };
    return n;
  }

  p.entryId = 'ft_ready';
  passage('ft_ready', '游戏连线验收已准备。', [background('ft_red')]);
  add({ ...base('ft_end'), kind: 'end' });
  const same = passage('ft_same_source', '同场景过渡之前。', [background('ft_red')], 'ft_same_count');
  same.transitions = { next: dissolve(.48) }; set('ft_same_count', 'ft_same_target');
  passage('ft_same_target', '同场景过渡完成。', [background('ft_blue')], 'ft_same_after');
  passage('ft_same_after', '存档和回滚的后一行。', [background('ft_green')]);

  const chain = passage('ft_chain_source', '逻辑链过渡之前。', [background('ft_red')], 'ft_chain_first');
  chain.transitions = { next: dissolve(.42) };
  const first = set('ft_chain_first', 'ft_chain_second'); first.transitions = { next: { mode: 'none' } };
  set('ft_chain_second', 'ft_chain_condition');
  const conditional = condition('ft_chain_condition', 'ft_chain_target'); conditional.transitions = { yes: color(.2, .16, .2, '#ffffff') };
  passage('ft_chain_target', '逻辑链只有最后一项过渡。', [background('ft_blue')]);

  passage('ft_choice_source', '同一目的地的两个出口。', [background('ft_red')], 'ft_choice');
  add({ ...base('ft_choice'), kind: 'choice', prompt: '选择实际出口', choices: [
    { id: 'ft_choice_left', text: '从左侧叠化', target: 'ft_choice_target' },
    { id: 'ft_choice_right', text: '从右侧淡白', target: 'ft_choice_target' },
  ], transitions: { ft_choice_left: dissolve(.36), ft_choice_right: color(.18, .12, .18, '#ffffff') } });
  passage('ft_choice_target', '两个出口已到达同一目的地。', [background('ft_blue')]);

  passage('ft_call_source', '调用之前。', [background('ft_red')], 'ft_call');
  add({ ...base('ft_call'), kind: 'call', target: 'ft_call_count', next: 'ft_return_count', transitions: { target: dissolve(.36), next: color(.18, .1, .18) } });
  set('ft_call_count', 'ft_call_body', 'ft_called');
  passage('ft_call_body', '子模块内部的台词。', [background('ft_green')], 'ft_return');
  add({ ...base('ft_return'), kind: 'return' });
  set('ft_return_count', 'ft_call_after', 'ft_returned');
  passage('ft_call_after', '调用返回后才触发继续出口。', [background('ft_blue')]);

  passage('ft_legacy_source', '旧演出与条件分支之前。', [background('ft_dark')], 'ft_legacy_performance');
  performance('ft_legacy_performance', 'ft_legacy_condition', true);
  const legacyConditional = condition('ft_legacy_condition', 'ft_legacy_jump'); legacyConditional.transitions = { yes: { mode: 'none' } };
  add({ ...base('ft_legacy_jump'), kind: 'jump', target: 'ft_legacy_target', sceneTransition: { mode: 'dissolve', duration: .2, color: '#000000', parameters: { fixture: 'preserved' } } });
  passage('ft_legacy_target', '场景参数与旧过渡已保留。', [], 'ft_end', 'ft_scene_b');

  passage('ft_silent_source', '无旧转场的短演出之前。', [background('ft_dark')], 'ft_silent_performance');
  performance('ft_silent_performance', 'ft_silent_jump');
  add({ ...base('ft_silent_jump'), kind: 'jump', target: 'ft_silent_condition', sceneTransition: { mode: 'dissolve', duration: .16, color: '#000000' } });
  const silentConditional = condition('ft_silent_condition', 'ft_silent_target', 'ft_silent_target', 'ft_scene_b');
  silentConditional.transitions = { yes: color(.3, .12, .3) };
  passage('ft_silent_target', '源演出的红色末帧已保留。', [], 'ft_end', 'ft_scene_b');

  passage('ft_terminal_source', '旧演出随后直接结束。', [background('ft_dark')], 'ft_terminal_performance');
  const terminal = performance('ft_terminal_performance', 'ft_terminal_condition', true);
  terminal.lines[0].playback!.transition = { ...legacyColor, outDuration: .3, hold: .12, inDuration: .4 };
  const terminalConditional = condition('ft_terminal_condition', 'ft_silent_target', 'ft_end'); terminalConditional.transitions = { yes: dissolve(.2) };
  const endExplicit = passage('ft_end_source', '这条结束连线也有过渡。', [background('ft_red')]);
  endExplicit.transitions = { next: color(.24, .12, .24) };

  passage('ft_late_call_source', '只在调用返回后设置新过渡。', [background('ft_dark')], 'ft_late_call_performance');
  performance('ft_late_call_performance', 'ft_late_call', true);
  add({ ...base('ft_late_call'), kind: 'call', target: 'ft_late_call_body', next: 'ft_late_call_after', transitions: { next: { mode: 'none' } } });
  passage('ft_late_call_body', '旧结束转场应在子模块台词前完成。', [background('ft_green')], 'ft_return');
  passage('ft_late_call_after', '调用继续出口现在直接切换。', [background('ft_blue')]);

  const waitSource = passage('ft_wait_source', '蓝图等待与保存之前。', [background('ft_red')], 'ft_wait_target');
  waitSource.transitions = { next: color(.18, .1, .18) };
  passage('ft_wait_target', '蓝图等待已经完整结束。', [background('ft_blue'), { kind: 'blueprint', blueprintId: wait.id }]);
  const pauseSource = passage('ft_pause_source', '普通等待之前。', [background('ft_red')], 'ft_pause_target');
  pauseSource.transitions = { next: dissolve(.42) };
  passage('ft_pause_target', '普通等待已经完整结束。', [background('ft_blue'), { kind: 'pause', seconds: .8 }]);
  const earlySource = passage('ft_early_source', '提前对白之前。', [background('ft_red')], 'ft_early_target');
  earlySource.transitions = { next: color(.18, .12, .18) };
  const early = passage('ft_early_target', '对白与配音在过渡后开始。', [background('ft_blue'), { kind: 'startDialogue' }, { kind: 'pause', seconds: .9 }]);
  early.lines[0].voiceId = 'ft_voice';

  const shortSource = passage('ft_short_source', '长过渡与短目标演出之前。', [background('ft_red')], 'ft_short_target');
  shortSource.transitions = { next: color(.4, .4, .4) };
  const text: VisualObject = { ...solid('ft_short_text', .72, '#20e060'), content: 'text', width: .66, height: .16, text: '完整显示的目标文字', fontSize: 48, layer: 11,
    keyframes: [{ x: .5, y: .43, scale: 1, rotation: 0, opacity: 1, duration: 0, easing: 'linear' }], textMotion: { speed: 'instant' } };
  const video: VisualObject = { ...solid('ft_short_video', .72, '#ffffff'), content: 'video', assetId: 'ft_video', width: .22, height: .2, layer: 12, muted: true, loop: false, mediaOffset: 0, sourceDuration: 1.2,
    keyframes: [{ x: .73, y: .28, scale: 1, rotation: 0, opacity: 1, duration: 0, easing: 'linear' }] };
  const short = passage('ft_short_target', '', [background('ft_blue'), { kind: 'blueprint', blueprintId: shortCounter.id },
    solid('ft_short_solid', .72, '#20e060', false), text, video,
    { kind: 'audioClip', instanceId: 'ft_short_audio', name: '短目标声音', assetId: 'ft_voice', duration: .72, offset: 0, volume: .05, fadeIn: 0, fadeOut: 0, bus: 'sound', wait: false },
  ], 'ft_short_done');
  short.lines[0].silent = true; short.lines[0].playback = { clickSkip: false };
  passage('ft_short_done', '短目标演出已经完整结束。', [background('ft_blue')]);

  const motionSource = passage('ft_motion_source', '角色与逐字文字的长过渡之前。', [background('ft_red')], 'ft_motion_target');
  motionSource.transitions = { next: color(.4, .4, .4) };
  const revealGroup: VisualObject = { ...solid('ft_reveal_group', 1, '#ffffff'), content: 'group', children: [
    { ...text, instanceId: 'ft_reveal_text', text: '逐字动画完整保留', duration: 1, startAt: 0, textMotion: { speed: 'duration', duration: .6 } },
  ] };
  // Actors are installed before the timeline reaches its tail. The tail is the
  // first interaction, so one real incoming flow transition holds all three
  // targets and its time must be excluded from the compiled timeline deadline.
  const revealTimeline = blueprintFromPerformance(p, [revealGroup], '逐字文字时间轴');
  revealTimeline.id = 'ft_reveal_timeline'; p.blueprints.push(revealTimeline);
  const revealTiming = performanceTimeline(p, revealTimeline);
  arrangePerformanceTimeline(p, revealTimeline, revealTiming.clips, revealTiming.tracks);
  const actorShow = (name: string, x: number): Extract<StageAction, { kind: 'show' }> => ({ kind: 'show', characterId: 'ft_' + name, expressionId: 'ft_' + name + '_normal', lifetime: 'persistent',
    x, y: .3, scale: 1, layer: 12, transition: 'move', duration: .6, wait: false });
  const motionTarget = passage('ft_motion_target', '', [background('ft_blue'), { kind: 'blueprint', blueprintId: motionCounter.id },
    actorShow('atl', .32), { ...actorShow('offset', .65), afterOffsets: { x: [{ at: 0, value: 0, easing: 'linear' }, { at: .2, value: .08, easing: 'linear' }] } },
    { kind: 'blueprint', blueprintId: revealTimeline.id },
  ], 'ft_motion_done');
  motionTarget.lines[0].silent = true; motionTarget.lines[0].playback = { clickSkip: false };
  passage('ft_motion_done', '角色移动和逐字文字时间轴已经完整结束。');

  const chapterSource = passage('ft_raw_chapter_source', '原始章节标题的长过渡之前。', [background('ft_red')], 'ft_raw_chapter_count');
  chapterSource.transitions = { next: color(.4, .4, .4) };
  set('ft_raw_chapter_count', 'ft_raw_chapter');
  add({ ...base('ft_raw_chapter'), kind: 'chapterTitle', title: '章节动画必须完整播放', subtitle: '', duration: .8, effect: 'fade', backgroundId: 'ft_blue', next: 'ft_raw_chapter_done' });
  passage('ft_raw_chapter_done', '原始章节标题已经完整结束。', [background('ft_blue')]);

  passage('ft_media_legacy_source', '旧双过渡与短媒体之前。', [background('ft_dark')], 'ft_media_legacy_performance');
  performance('ft_media_legacy_performance', 'ft_media_legacy_condition', true);
  const mediaLegacyConditional = condition('ft_media_legacy_condition', 'ft_short_target', 'ft_media_legacy_jump');
  mediaLegacyConditional.transitions = { yes: { mode: 'none' } };
  add({ ...base('ft_media_legacy_jump'), kind: 'jump', target: 'ft_media_legacy_target', sceneTransition: { mode: 'dissolve', duration: .8, color: '#000000' } });
  const legacyShort = passage('ft_media_legacy_target', '', structuredClone(short.lines[0].actions), 'ft_media_legacy_done', 'ft_scene_b');
  legacyShort.lines[0].silent = true; legacyShort.lines[0].playback = { clickSkip: false };
  passage('ft_media_legacy_done', '旧双过渡后的短媒体完整结束。', [background('ft_blue')], 'ft_end', 'ft_scene_b');

  const loopingSource = (instanceId: string): VisualObject => ({ ...video, instanceId, duration: 1.2, persistent: true, loop: true });
  const clearVideo = passage('ft_video_clear_source', '源循环视频跨场景之前。', [background('ft_red'), loopingSource('ft_clear_movie')], 'ft_video_clear_target');
  clearVideo.transitions = { next: dissolve(.72) };
  passage('ft_video_clear_target', '源视频已跨场景替换成蓝色。', [], 'ft_end', 'ft_scene_b');
  const replaceVideo = passage('ft_video_replace_source', '相同标识视频替换之前。', [background('ft_red'), loopingSource('ft_replace_movie')], 'ft_video_replace_target');
  replaceVideo.transitions = { next: color(.22, .08, .3) };
  passage('ft_video_replace_target', '相同标识的新视频完整开始。', [{ ...video, instanceId: 'ft_replace_movie' }]);

  const interactionSource = passage('ft_interaction_source', '互动出口之前。', [background('ft_red')], 'ft_interaction');
  interactionSource.transitions = { next: { mode: 'none' } };
  add({ ...base('ft_interaction'), kind: 'interaction', prompt: '互动结果出口验收', showHints: true,
    hotspots: [{ id: 'ft_hotspot', name: '实际热点', x: .3, y: .35, width: .3, height: .2, target: 'ft_result' }],
    timeoutSeconds: 2, timeout: 'ft_result', cancel: 'ft_result',
    transitions: { ft_hotspot: dissolve(.24), timeout: color(.12, .08, .12), cancel: { mode: 'none' } } });
  passage('ft_minigame_source', '小游戏出口之前。', [background('ft_red')], 'ft_minigame');
  add({ ...base('ft_minigame'), kind: 'minigame', template: 'timedClicks', title: '真实小游戏结果', prompt: '点击一次即可成功', password: '1234', caseSensitive: false,
    attempts: 1, targetClicks: 1, timeLimit: 2, success: 'ft_result', failure: 'ft_result', cancel: 'ft_result',
    transitions: { success: dissolve(.24), failure: color(.12, .08, .12), cancel: { mode: 'none' } } });
  passage('ft_result', '真实结果出口已进入目标。', [background('ft_blue')]);

  // Keep all authored branches connected for diagnostics. Scenarios start at
  // their own source passage so the launcher's long list is never a test input.
  const routes = p.nodes.filter(n => n.kind === 'passage' && n.id.endsWith('_source'));
  const ready = p.nodes.find(n => n.id === 'ft_ready') as PassageNode; ready.next = 'ft_routes';
  add({ ...base('ft_routes'), kind: 'choice', prompt: '选择验收情景', choices: routes.map(n => ({ id: n.id + '_entry', text: n.name, target: n.id })) });
  return p;
}

function solidPng(rgb: readonly number[], width = 16, height = 16) {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) { png.data[i] = rgb[0]; png.data[i + 1] = rgb[1]; png.data[i + 2] = rgb[2]; png.data[i + 3] = 255; }
  return PNG.sync.write(png);
}
function toneWav() {
  const rate = 22050, frames = rate * 2, data = Buffer.alloc(44 + frames * 2);
  data.write('RIFF'); data.writeUInt32LE(36 + frames * 2, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) data.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * 330 / rate) * 150), 44 + i * 2);
  return data;
}

function nativeTests() {
  const start = (name: string, sourceId: string, text: string) => `    pause until screen "main_menu"
    $ ft_begin_case(${q(name)})
    click id "vn_main_start" pos (0.5, 0.5)
    pause until "游戏连线验收已准备。"
    run Jump(${q('vn_node_' + sourceId)})
    pause until ${q(text)}
    move pos (8, 8)`;
  const cases: { name: string; source: string }[] = [];
  const add = (name: string, sourceId: string, text: string, body: string) => cases.push({ name, source: `testcase ${name}:\n${start(name, sourceId, text)}\n${body.trimEnd()}\n` });
  add('same_scene_pixels_hud_save_and_rollback', 'ft_same_source', '同场景过渡之前。', `
    keysym "dismiss"
    pause until "同场景过渡完成。"
    assert eval ft_modes() == ["dissolve"] and ft_ports() == [("ft_same_source", "next")]
    assert eval vn_var_ft_scene_a_entries == 1 and vn_var_ft_scene_b_entries == 0 and vn_var_ft_count == 1
    assert eval ft_single_timing(.48) and ft_red_to_blue(0) and ft_hud_unchanged(0)
    assert eval not vn_flow_transition_pending() and not renpy.get_screen("vn_performance_cover", layer="master")
    screenshot "01-same-scene-blue"
    $ renpy.save("ft-same-checkpoint")
    keysym "dismiss"
    pause until "存档和回滚的后一行。"
    run Rollback(force=True, checkpoints=1)
    pause until "同场景过渡完成。"
    assert eval vn_var_ft_count == 1 and len(ft_probe.stages) == 1 and not vn_flow_transition_pending()
    run FileLoad("ft-same-checkpoint", confirm=False, slot=True)
    pause until eval len(ft_probe.loads) == 1
    pause until "同场景过渡完成。"
    assert eval vn_var_ft_count == 1 and vn_var_ft_scene_a_entries == 1 and len(ft_probe.stages) == 1
    assert eval not vn_flow_transition_pending()
`);
  add('transparent_logic_last_explicit_edge_wins', 'ft_chain_source', '逻辑链过渡之前。', `
    keysym "dismiss"
    pause until "逻辑链只有最后一项过渡。"
    assert eval [(r["node"], r["port"], r["spec"]["mode"]) for r in ft_probe.queues] == [("ft_chain_source", "next", "dissolve"), ("ft_chain_first", "next", "none"), ("ft_chain_condition", "yes", "color")]
    assert eval ft_modes() == ["color"] and ft_ports() == [("ft_chain_condition", "yes")]
    assert eval vn_var_ft_count == 2 and vn_var_ft_scene_a_entries == 1
    assert eval ft_single_timing(.56) and ft_has_pixel(0, "white") and ft_red_to_blue(0) and ft_hud_unchanged(0)
    assert eval not vn_flow_transition_pending()
`);
  for (const [suffix, option, mode, seconds] of [['left', '从左侧叠化', 'dissolve', .36], ['right', '从右侧淡白', 'color', .48]] as const) {
    add('choice_same_destination_' + suffix, 'ft_choice_source', '同一目的地的两个出口。', `
    keysym "dismiss"
    pause until screen "choice"
    click ${q(option)}
    pause until "两个出口已到达同一目的地。"
    assert eval ft_modes() == [${q(mode)}] and ft_ports() == [("ft_choice", ${q('ft_choice_' + suffix)})]
    assert eval ft_single_timing(${seconds}) and ft_red_to_blue(0) and ft_hud_unchanged(0)
    assert eval vn_var_ft_scene_a_entries == 1 and not vn_flow_transition_pending()
`);
  }
  add('call_target_and_return_next_are_independent', 'ft_call_source', '调用之前。', `
    keysym "dismiss"
    pause until "子模块内部的台词。"
    assert eval ft_ports() == [("ft_call", "target")] and ft_modes() == ["dissolve"]
    assert eval vn_var_ft_called == 1 and vn_var_ft_returned == 0 and vn_var_ft_scene_a_entries == 1
    assert eval ft_has_pixel(0, "red") and ft_has_pixel(0, "green") and ft_hud_unchanged(0)
    keysym "dismiss"
    pause until "调用返回后才触发继续出口。"
    assert eval ft_ports() == [("ft_call", "target"), ("ft_call", "next")] and ft_modes() == ["dissolve", "color"]
    assert eval vn_var_ft_called == 1 and vn_var_ft_returned == 1 and vn_var_ft_scene_a_entries == 1
    assert eval ft_has_pixel(1, "black") and ft_has_pixel(1, "blue") and ft_hud_unchanged(1)
    assert eval not vn_flow_transition_pending()
`);
  for (const useExplicit of [true, false]) {
    add(useExplicit ? 'explicit_none_overrides_legacy_visuals_only' : 'untaken_explicit_branch_preserves_legacy_scene_transition', 'ft_legacy_source', '旧演出与条件分支之前。', `
    $ vn_parameter_set("ft_branch", ${useExplicit ? 'True' : 'False'})
    keysym "dismiss"
    pause until "场景参数与旧过渡已保留。"
    assert eval vn_current_scene == "ft_scene_b" and vn_var_ft_scene_b_entries == 1 and vn_var_ft_scene_a_entries == 1
    assert eval vn_scene_parameters.get("fixture") == "preserved"
    assert eval ${useExplicit ? 'ft_modes() == ["none"] and ft_ports() == [("ft_legacy_condition", "yes")] and len(ft_probe.stages) == 1 and ft_probe.stages[0]["duration"] == 0' : 'ft_modes() == ["color", "legacy"] and ft_ports()[0] == ("ft_legacy_performance", "next") and [round(r["duration"], 3) for r in ft_probe.stages] == [.52, .2]'}
    assert eval ${useExplicit ? 'ft_probe.stages[0]["elapsed"] < .15' : 'ft_has_pixel(0, "red") and ft_has_pixel(0, "black") and ft_has_pixel(0, "blue") and ft_hud_unchanged(0)'}
    assert eval not vn_flow_transition_pending() and vn_pending_scene_transition is None and vn_performance_transition is None
    assert eval not renpy.get_screen("vn_performance_cover", layer="master")
    screenshot ${q(useExplicit ? '02-explicit-none' : '03-fallback-and-scene-transition')}
`);
  }
  add('silent_source_without_legacy_keeps_real_last_frame', 'ft_silent_source', '无旧转场的短演出之前。', `
    keysym "dismiss"
    pause until "源演出的红色末帧已保留。"
    assert eval ft_modes() == ["color"] and ft_ports() == [("ft_silent_condition", "yes")]
    assert eval ft_single_timing(.72) and ft_red_to_blue(0) and ft_has_pixel(0, "black") and ft_hud_unchanged(0)
    assert eval ft_early_source_is_red(0) and vn_var_ft_scene_b_entries == 1 and vn_var_ft_scene_a_entries == 1
    assert eval not vn_flow_transition_pending() and vn_pending_scene_transition is None
`);
  add('untaken_explicit_branch_keeps_terminal_legacy_out_and_hold', 'ft_terminal_source', '旧演出随后直接结束。', `
    $ vn_parameter_set("ft_branch", False)
    keysym "dismiss"
    pause until screen "vn_game_over"
    assert eval len(ft_probe.stages) == 1 and abs(ft_probe.stages[0]["duration"] - .42) < .000001
    assert eval ft_has_pixel(0, "red") and ft_has_pixel(0, "black") and ft_hud_unchanged(0)
    assert eval ft_probe.stages[0]["elapsed"] >= .32 and not vn_flow_transition_pending()
    assert eval not renpy.get_screen("vn_performance_cover", layer="master")
`);
  add('explicit_ending_edge_has_visible_transition', 'ft_end_source', '这条结束连线也有过渡。', `
    keysym "dismiss"
    pause until screen "vn_game_over"
    assert eval ft_modes() == ["color"] and ft_ports() == [("ft_end_source", "next")]
    assert eval ft_single_timing(.6) and ft_has_pixel(0, "red") and ft_has_pixel(0, "black") and ft_hud_unchanged(0)
    assert eval not vn_flow_transition_pending() and not renpy.get_screen("vn_performance_cover", layer="master")
    pause .1
    $ ft_capture_frame(True, "terminal")
    assert eval ft_pixel_is(ft_probe.frames[-1]["pixel"], "black")
`);
  add('save_inside_ending_transition_keeps_black_terminal_stage', 'ft_end_source', '这条结束连线也有过渡。', `
    $ ft_probe.save_slot = "ft-ending-transition"
    keysym "dismiss"
    pause until screen "vn_game_over"
    assert eval len(ft_probe.saves) == 1 and not ft_probe.saves[0]["pending"] and renpy.can_load("ft-ending-transition")
    assert eval len(ft_probe.stages) == 1 and ft_ports() == [("ft_end_source", "next")]
    pause .1
    $ ft_capture_frame(True, "terminal-before-load")
    assert eval ft_pixel_is(ft_probe.frames[-1]["pixel"], "black")
    run FileLoad("ft-ending-transition", confirm=False, slot=True)
    pause until eval len(ft_probe.loads) == 1
    pause until screen "vn_game_over"
    pause .1
    $ ft_capture_frame(True, "terminal-after-load")
    assert eval len(ft_probe.stages) == 1 and not vn_flow_transition_pending()
    assert eval ft_pixel_is(ft_probe.frames[-1]["pixel"], "black") and vn_var_ft_scene_a_entries == 1
    assert eval not renpy.get_screen("vn_performance_cover", layer="master")
    screenshot "05-ending-transition-loaded-black-stage"
`);
  add('future_call_next_does_not_delay_legacy_into_callee', 'ft_late_call_source', '只在调用返回后设置新过渡。', `
    keysym "dismiss"
    pause until "旧结束转场应在子模块台词前完成。"
    assert eval not ft_probe.queues and len(ft_probe.stages) == 2
    assert eval [round(r["duration"], 3) for r in ft_probe.stages] == [.2, .2]
    assert eval any(ft_has_pixel(i, "black") for i in range(2)) and ft_stage_span() >= .4
    keysym "dismiss"
    pause until "调用继续出口现在直接切换。"
    assert eval ft_ports()[-1] == ("ft_late_call", "next") and ft_modes()[-1] == "none"
    assert eval len(ft_probe.stages) == 3 and not vn_flow_transition_pending()
`);
  add('ordinary_pause_begins_after_transition', 'ft_pause_source', '普通等待之前。', `
    keysym "dismiss"
    pause until "普通等待已经完整结束。"
    assert eval ft_modes() == ["dissolve"] and ft_ports() == [("ft_pause_source", "next")]
    assert eval ft_say_time("ft_pause_target") - ft_probe.stages[0]["end"] >= .65
    assert eval ft_visible_wait("ft_pause_target", .55) and not vn_flow_transition_pending()
`);
  add('blueprint_wait_save_restore_does_not_replay_transition_or_entry', 'ft_wait_source', '蓝图等待与保存之前。', `
    keysym "dismiss"
    pause until eval vn_bp_wait is not None and vn_bp_wait.get("elapsed", 0) > .15
    assert eval vn_current_node == "ft_wait_target" and vn_var_ft_wait_entries == 1 and vn_var_ft_wait_finishes == 0
    assert eval len(ft_probe.stages) == 1 and not vn_flow_transition_pending() and ft_probe.active is None
    $ renpy.save("ft-wait-checkpoint")
    pause until "蓝图等待已经完整结束。"
    assert eval vn_var_ft_wait_entries == 1 and vn_var_ft_wait_finishes == 1
    run FileLoad("ft-wait-checkpoint", confirm=False, slot=True)
    pause until eval len(ft_probe.loads) == 1 and vn_bp_wait is not None
    assert eval vn_var_ft_wait_entries == 1 and vn_var_ft_wait_finishes == 0 and not vn_flow_transition_pending()
    pause until "蓝图等待已经完整结束。"
    assert eval vn_var_ft_wait_entries == 1 and vn_var_ft_wait_finishes == 1 and len(ft_probe.stages) == 1
    assert eval ft_visible_wait("ft_wait_target", .6) and ft_hud_unchanged(0)
`);
  add('early_dialogue_and_voice_start_after_transition', 'ft_early_source', '提前对白之前。', `
    keysym "dismiss"
    pause until eval vn_line_dialogue is not None and vn_line_dialogue.get("started") is not None
    assert eval len(ft_probe.stages) == 1 and not vn_flow_transition_pending()
    assert eval len(ft_probe.early) == 1 and ft_probe.early[0]["time"] >= ft_probe.stages[0]["end"]
    assert eval not any(f["voice"] for f in ft_stage_frames(0)) and renpy.music.get_playing(channel="voice") is not None
    assert eval ft_visible_wait("ft_early_target", 0) and vn_current_node == "ft_early_target"
    pause .2
    screenshot "04-early-dialogue-after-transition"
`);
  add('short_target_keeps_full_visual_text_audio_duration', 'ft_short_source', '长过渡与短目标演出之前。', `
    keysym "dismiss"
    pause until "短目标演出已经完整结束。"
    assert eval ft_modes() == ["color"] and ft_ports() == [("ft_short_source", "next")]
    assert eval ft_single_timing(1.2) and vn_var_ft_short_entries == 1
    assert eval ft_short_media_survives(ft_probe.stages[0]["end"], .56)
    assert eval ft_video_first_frame_is_frozen(0)
    assert eval ft_video_plays_after(ft_probe.stages[0]["end"], .5)
    assert eval ft_say_time("ft_short_done") - ft_probe.stages[0]["end"] >= .57
    assert eval not vn_flow_transition_pending() and not vn_audio_clips
`);
  add('actor_gates_and_nested_typewriter_timeline_start_after_transition', 'ft_motion_source', '角色与逐字文字的长过渡之前。', `
    keysym "dismiss"
    pause until "角色移动和逐字文字时间轴已经完整结束。"
    assert eval ft_modes() == ["color"] and ft_ports() == [("ft_motion_source", "next")]
    assert eval ft_single_timing(1.2) and vn_var_ft_motion_entries == 1 and vn_var_ft_scene_a_entries == 1
    assert eval ft_actor_motion_after(0, "atl", .32, .035)
    assert eval ft_actor_motion_after(0, "offset", .73, .1)
    assert eval ft_typewriter_after(0)
    assert eval .86 <= ft_say_time("ft_motion_done") - ft_probe.stages[0]["end"] <= 1.45
    assert eval ft_hud_unchanged(0) and ft_flow_idle()
    screenshot "06-actors-and-typewriter-timeline-complete"
`);
  add('raw_chapter_clock_survives_transition_and_native_menu_context', 'ft_raw_chapter_source', '原始章节标题的长过渡之前。', `
    keysym "dismiss"
    pause until eval ft_probe.active is not None and ft_now() - ft_probe.active["start"] >= .2
    run ShowMenu("save")
    pause until screen "save"
    assert eval renpy.context()._menu and vn_flow_transition_active is not None
    pause .35
    $ ft_capture_frame(True, "chapter-native-menu")
    assert eval ft_probe.frames[-1]["chapter"] is not None and ft_probe.frames[-1]["chapter"]["started"] is None
    click id "vn_game_menu_return"
    pause until eval not renpy.get_screen("save")
    pause until "原始章节标题已经完整结束。"
    assert eval ft_modes() == ["color"] and ft_ports() == [("ft_raw_chapter_source", "next")]
    assert eval vn_var_ft_count == 1 and vn_var_ft_scene_a_entries == 1
    assert eval ft_chapter_after(0)
    assert eval .65 <= ft_say_time("ft_raw_chapter_done") - ft_probe.stages[0]["end"] <= 1.2
    assert eval not renpy.get_screen("vn_chapter_title", layer="master") and ft_flow_idle()
    screenshot "07-raw-chapter-complete-after-menu"
`);
  add('save_inside_transition_restores_unfrozen_target_without_replay', 'ft_short_source', '长过渡与短目标演出之前。', `
    $ ft_probe.save_slot = "ft-inside-transition"
    keysym "dismiss"
    pause until "短目标演出已经完整结束。"
    assert eval len(ft_probe.saves) == 1 and not ft_probe.saves[0]["pending"] and renpy.can_load("ft-inside-transition")
    assert eval len(ft_probe.stages) == 1 and vn_var_ft_short_entries == 1
    assert eval ft_short_media_survives(ft_probe.stages[0]["end"], .56)
    assert eval ft_video_first_frame_is_frozen(0)
    assert eval ft_video_plays_after(ft_probe.stages[0]["end"], .5)
    assert eval ft_say_time("ft_short_done") - ft_probe.stages[0]["end"] >= .57
    run FileLoad("ft-inside-transition", confirm=False, slot=True)
    pause until eval len(ft_probe.loads) == 1
    pause until "短目标演出已经完整结束。"
    assert eval len(ft_probe.stages) == 1 and vn_var_ft_short_entries == 1 and not vn_flow_transition_pending()
    assert eval ft_short_media_survives(ft_probe.loads[0]["time"], .45)
    assert eval ft_video_plays_after(ft_probe.loads[0]["time"], .4)
    assert eval ft_say_time("ft_short_done") - ft_probe.loads[0]["time"] >= .45
    assert eval not vn_audio_clips and not renpy.get_screen("vn_performance_cover", layer="master")
`);
  add('legacy_fallback_and_scene_transition_hold_short_media_until_both_finish', 'ft_media_legacy_source', '旧双过渡与短媒体之前。', `
    $ vn_parameter_set("ft_branch", False)
    keysym "dismiss"
    pause until "旧双过渡后的短媒体完整结束。"
    assert eval ft_modes() == ["color", "legacy"] and ft_ports()[0] == ("ft_media_legacy_performance", "next")
    assert eval [round(r["duration"], 3) for r in ft_probe.stages] == [.52, .8] and ft_stage_span() >= 1.1
    assert eval vn_var_ft_short_entries == 1 and vn_var_ft_scene_b_entries == 1
    assert eval ft_video_first_frame_is_frozen(0)
    assert eval ft_video_first_frame_is_frozen(1)
    assert eval ft_short_media_survives(ft_probe.stages[1]["end"], .56, "ft_media_legacy_target")
    assert eval ft_video_plays_after(ft_probe.stages[1]["end"], .5, "ft_media_legacy_target")
    assert eval ft_say_time("ft_media_legacy_done") - ft_probe.stages[1]["end"] >= .57
    assert eval ft_hud_unchanged(0) and ft_hud_unchanged(1) and not vn_flow_transition_pending() and not vn_audio_clips
`);
  add('save_each_legacy_phase_resumes_only_unconsumed_transition', 'ft_media_legacy_source', '旧双过渡与短媒体之前。', `
    $ vn_parameter_set("ft_branch", False)
    $ ft_probe.save_plan = [(0, "ft-legacy-phase-zero"), (1, "ft-legacy-phase-one")]
    keysym "dismiss"
    pause until "旧双过渡后的短媒体完整结束。"
    assert eval [(s["stage"], s["slot"]) for s in ft_probe.saves] == [(0, "ft-legacy-phase-zero"), (1, "ft-legacy-phase-one")]
    assert eval all(not s["pending"] and renpy.can_load(s["slot"]) for s in ft_probe.saves)
    assert eval ft_modes() == ["color", "legacy"] and [round(r["duration"], 3) for r in ft_probe.stages] == [.52, .8]
    assert eval vn_var_ft_short_entries == 1 and vn_var_ft_scene_b_entries == 1
    assert eval ft_short_media_survives(ft_probe.stages[1]["end"], .56, "ft_media_legacy_target")
    assert eval ft_video_plays_after(ft_probe.stages[1]["end"], .5, "ft_media_legacy_target")
    run FileLoad("ft-legacy-phase-one", confirm=False, slot=True)
    pause until eval len(ft_probe.loads) == 1
    pause until "旧双过渡后的短媒体完整结束。"
    assert eval len(ft_probe.stages) == 2 and vn_var_ft_short_entries == 1 and vn_var_ft_scene_b_entries == 1
    assert eval ft_short_media_survives(ft_probe.loads[0]["time"], .45, "ft_media_legacy_target")
    assert eval ft_video_plays_after(ft_probe.loads[0]["time"], .4, "ft_media_legacy_target")
    assert eval ft_flow_idle() and not vn_audio_clips
    run FileLoad("ft-legacy-phase-zero", confirm=False, slot=True)
    pause until eval len(ft_probe.loads) == 2
    pause until "旧双过渡后的短媒体完整结束。"
    assert eval ft_modes() == ["color", "legacy", "legacy"] and [round(r["duration"], 3) for r in ft_probe.stages] == [.52, .8, .8]
    assert eval ft_probe.stages[2]["start"] >= ft_probe.loads[1]["time"] and vn_var_ft_short_entries == 1 and vn_var_ft_scene_b_entries == 1
    assert eval ft_video_first_frame_is_frozen(2)
    assert eval ft_short_media_survives(ft_probe.stages[2]["end"], .56, "ft_media_legacy_target")
    assert eval ft_video_plays_after(ft_probe.stages[2]["end"], .5, "ft_media_legacy_target")
    assert eval ft_say_time("ft_media_legacy_done") - ft_probe.stages[2]["end"] >= .57
    assert eval ft_flow_idle() and not vn_audio_clips and not renpy.get_screen("vn_performance_cover", layer="master")
`);
  add('departing_video_preserves_last_frame_then_releases_channel_on_scene_change', 'ft_video_clear_source', '源循环视频跨场景之前。', `
    pause until eval ft_latest_video_is("ft_video_clear_source", "cyan")
    $ ft_probe.source_channel = ft_video_channel("ft_clear_movie")
    assert eval ft_probe.source_channel is not None and renpy.music.get_playing(channel=ft_probe.source_channel) is not None
    keysym "dismiss"
    pause until "源视频已跨场景替换成蓝色。"
    assert eval ft_modes() == ["dissolve"] and ft_ports() == [("ft_video_clear_source", "next")]
    assert eval ft_early_video_is(0, "cyan")
    assert eval ft_video_has_pixel(0, "blue")
    assert eval ft_hud_unchanged(0)
    assert eval vn_var_ft_scene_b_entries == 1 and not vn_flow_transition_pending()
    pause .1
    assert eval renpy.music.get_playing(channel=ft_probe.source_channel) is None
    $ ft_capture_frame(True, "departing-video-released")
    assert eval ft_pixel_is(ft_probe.frames[-1]["videoPixel"], "blue")
`);
  add('same_instance_video_replacement_preserves_source_then_plays_new_media', 'ft_video_replace_source', '相同标识视频替换之前。', `
    pause until eval ft_latest_video_is("ft_video_replace_source", "cyan")
    $ ft_probe.source_channel = ft_video_channel("ft_replace_movie")
    assert eval ft_probe.source_channel is not None and renpy.music.get_playing(channel=ft_probe.source_channel) is not None
    keysym "dismiss"
    pause until "相同标识的新视频完整开始。"
    assert eval ft_modes() == ["color"] and ft_ports() == [("ft_video_replace_source", "next")]
    assert eval ft_early_video_is(0, "cyan")
    assert eval ft_video_first_frame_is_frozen(0)
    assert eval ft_hud_unchanged(0)
    $ ft_probe.target_channel = ft_video_channel("ft_replace_movie")
    assert eval ft_probe.target_channel is not None and ft_probe.target_channel != ft_probe.source_channel
    assert eval renpy.music.get_playing(channel=ft_probe.source_channel) is None
    pause .56
    assert eval ft_video_plays_after(ft_probe.stages[0]["end"], .5, "ft_video_replace_target")
    pause .3
    assert eval renpy.music.get_playing(channel=ft_probe.source_channel) is None and renpy.music.get_playing(channel=ft_probe.target_channel) is None
    assert eval vn_var_ft_scene_a_entries == 1 and not vn_flow_transition_pending()
`);
  for (const disabled of [true, false]) {
    add(disabled ? 'disabled_transition_preference_commits_without_mask' : 'skip_commits_without_mask_and_new_game_resets', 'ft_same_source', '同场景过渡之前。', `
    $ ${disabled ? 'preferences.transitions = 0' : 'preferences.skip_unseen = True'}
    ${disabled ? 'keysym "dismiss"' : 'run Skip(fast=True, confirm=False)'}
    pause until ${disabled ? '"同场景过渡完成。"' : 'screen "vn_game_over"'}
    $ config.skipping = None
    assert eval len(ft_probe.stages) == 1 and ft_probe.stages[0]["elapsed"] < .2
    assert eval not vn_flow_transition_pending() and not renpy.get_screen("vn_performance_cover", layer="master")
    $ preferences.transitions = 2
    run MainMenu(confirm=False)
    pause until screen "main_menu"
    click id "vn_main_start" pos (0.5, 0.5)
    pause until "游戏连线验收已准备。"
    assert eval not vn_flow_transition_pending() and vn_var_ft_count == 0 and vn_var_ft_scene_a_entries == 1
    assert eval len(ft_probe.stages) == 1
`);
  }
  for (const [kind, port, action, mode] of [
    ['interaction', 'ft_hotspot', 'click id "vn_hotspot_ft_hotspot" pos (0.5, 0.5)', 'dissolve'],
    ['interaction', 'timeout', 'pause 2.3', 'color'],
    ['interaction', 'cancel', 'click id "vn_interaction_cancel"', 'none'],
    ['minigame', 'success', 'click id "vn_minigame_click" pos (0.5, 0.5)', 'dissolve'],
    ['minigame', 'failure', 'pause 2.3', 'color'],
    ['minigame', 'cancel', 'click id "vn_minigame_cancel"', 'none'],
  ] as const) {
    add('actual_' + kind + '_' + port + '_exit', 'ft_' + kind + '_source', kind === 'interaction' ? '互动出口之前。' : '小游戏出口之前。', `
    keysym "dismiss"
    pause until screen ${q(kind === 'interaction' ? 'vn_interaction' : 'vn_minigame_timed_clicks')}
    ${action}
    pause until "真实结果出口已进入目标。"
    assert eval ft_ports()[-1] == (${q('ft_' + kind)}, ${q(port)}) and ft_modes()[-1] == ${q(mode)}
    assert eval len([r for r in ft_probe.queues if r["node"] == ${q('ft_' + kind)}]) == 1
    assert eval vn_var_ft_scene_a_entries == 1 and not vn_flow_transition_pending()
`);
  }

  assert.equal(cases.length, 31, 'The complete flow-transition runtime suite must retain all 31 scenarios.');
  assert.equal(cases.reduce((sum, item) => sum + (item.source.match(/^    assert /gm) ?? []).length, 0), 175, 'The complete runtime suite must retain all 175 native assertions.');
  const chosen = selectedCase ? cases.filter(item => item.name === selectedCase) : cases;
  assert.ok(chosen.length > 0, `Unknown --case=${selectedCase}. Available cases: ${cases.map(item => item.name).join(', ')}`);
  report.caseNames = chosen.map(item => item.name);
  return String.raw`init -999 python:
    import renpy as _ft_engine
    _ft_engine.safe_mode_checked = True

init 999 python:
    import ctypes as ft_ctypes
    import json as ft_json
    import os as ft_os
    import sys as ft_sys
    import time as ft_time

    # These observers invoke the actual product functions and actual renderer.
    # Transient function attributes keep evidence across rollback/load/new game;
    # none of the evidence is inserted into the product's saved runtime state.
    def ft_probe():
        pass

    def ft_copy(value):
        return ft_json.loads(ft_json.dumps(value)) if value is not None else None

    def ft_request(value):
        # Runtime requests also hold their owning Ren'Py context. Keep only the
        # authored, serializable evidence; dumping owner/depth is unnecessary.
        return {key: ft_copy(value.get(key)) for key in ("transition", "nodeId", "port")} if value is not None else None

    def ft_now():
        return ft_time.monotonic() - ft_probe.started

    def ft_begin_case(name):
        ft_probe.name = name
        ft_probe.started = ft_time.monotonic()
        ft_probe.stages, ft_probe.queues, ft_probe.flushes, ft_probe.frames = [], [], [], []
        ft_probe.say, ft_probe.early, ft_probe.loads, ft_probe.saves = [], [], [], []
        ft_probe.active, ft_probe.context, ft_probe.save_slot = None, None, None
        ft_probe.save_plan = []
        ft_probe.source_channel, ft_probe.target_channel = None, None
        ft_probe.sample_at = -1.0
        ft_probe.pixel_checks = {}
        ft_probe.watch = True
        renpy.show_screen("ft_probe_hud")

    def ft_dump():
        data = {key: getattr(ft_probe, key) for key in ("name", "stages", "queues", "flushes", "frames", "say", "early", "loads", "saves", "source_channel", "target_channel")}
        data["pixelReadChecks"] = ft_verify_pixel_reads()
        data["observer"] = {}
        for key in ("readbackSeconds", "rgbCopySeconds", "greenScanSeconds", "actorScanSeconds", "snapshotSeconds", "diagnosticsSeconds", "screenshotsSeconds", "totalSeconds"):
            values = [frame["observer"][key] for frame in ft_probe.frames]
            data["observer"][key] = dict(count=len(values), total=sum(values), mean=sum(values) / len(values) if values else 0, maximum=max(values) if values else 0)
        with open(ft_os.path.join(@@TRACES@@, ft_probe.name + ".json"), "w", encoding="utf-8") as stream:
            ft_json.dump(data, stream, ensure_ascii=False, indent=2)
        assert all(row["equal"] for row in data["pixelReadChecks"]), "Bulk pixel reads must exactly match the original get_at observer; see pixelReadChecks."

    def ft_visual_state(tag, entry):
        # Read scalar diagnostics only. Never create channels, render a second
        # displayable, tick a clock or release resources from an observer.
        data = entry["data"]
        movie = data.get("_vn_movie")
        channel = movie.channel if movie is not None else None
        has_channel = channel is not None and renpy.music.channel_defined(channel)
        clock = data.get("_vn_text_clock") or {}
        return dict(tag=tag, entryId=id(entry), dataId=id(data), content=data.get("content"),
            instanceId=data.get("instanceId"), showing=renpy.showing(tag, layer="master"),
            duration=data.get("duration"), persistent=bool(data.get("persistent")), exiting=bool(entry.get("exiting")),
            started=data.get("_vn_started"), age=vn_visual_age(data) if "_vn_started" in data else None,
            renderAge=vn_visual_age(data, True) if "_vn_started" in data else None,
            held=bool(data.get("_vn_flow_hold")), frozenAge=data.get("_vn_flow_frozen_age"), expired=bool(data.get("_vn_expired")),
            keepFinal=bool(data.get("_vn_keep_final_frame")), holdFinal=bool(data.get("_vn_hold_final_frame")),
            performanceEnd=data.get("_vn_performance_end"), taskAlive=vn_bp_task_alive(data.get("_vn_task")),
            textClock={key: clock.get(key) for key in ("holding", "started", "frozen")},
            mediaStopped=bool(data.get("_vn_media_stopped")), mediaRetired=bool(data.get("_vn_flow_retired")),
            mediaHeld=bool(data.get("_vn_flow_movie_paused")), movieId=id(movie) if movie is not None else None,
            channel=channel, playing=renpy.music.get_playing(channel=channel) if has_channel else None,
            paused=renpy.music.get_pause(channel=channel) if has_channel else None,
            mediaPosition=renpy.music.get_pos(channel=channel) if has_channel else None)

    def ft_read_pixels(surface):
        # The bundled renpy.pygame Surface exposes lock/unlock and the read-only
        # _pixels_address property. A screenshot may be a bordered subsurface:
        # use its real pitch, masks and byte order, never width * 4 / fixed RGBA.
        # Unsupported formats/platform APIs keep the original get_at observer.
        info = dict(mode="get_at", addressType=None)
        locked = False
        try:
            width, height = surface.get_size()
            pitch, size = surface.get_pitch(), surface.get_bytesize()
            masks, shifts = surface.get_masks()[:3], surface.get_shifts()[:3]
            info.update(pitch=pitch, bytesPerPixel=size, masks=list(masks), shifts=list(shifts), byteOrder=ft_sys.byteorder)
            if width <= 0 or height <= 0 or size not in (3, 4) or pitch < width * size:
                info["fallback"] = "unsupported surface dimensions, pixel size or pitch"
                return None, info
            if any(shift < 0 or shift % 8 or shift >= size * 8 or mask != (255 << shift) for mask, shift in zip(masks, shifts)):
                info["fallback"] = "RGB channels are not separate full bytes"
                return None, info
            offsets = tuple(shift // 8 if ft_sys.byteorder == "little" else size - 1 - shift // 8 for shift in shifts)
            if len(set(offsets)) != 3:
                info["fallback"] = "overlapping RGB channel masks"
                return None, info
            surface.lock()
            locked = True
            address = surface._pixels_address
            info["addressType"] = type(address).__name__
            if isinstance(address, ft_ctypes.c_void_p):
                address = address.value
            if not isinstance(address, int) or isinstance(address, bool) or address <= 0:
                info["fallback"] = "pixel address is not a non-null integer or ctypes.c_void_p"
                return None, info
            # Copy only through the last visible pixel; the last row's trailing
            # padding is not assumed to belong to this (possibly sub-)surface.
            data = ft_ctypes.string_at(address, (height - 1) * pitch + width * size)
            info["mode"] = "locked-rgb-bytes"
            return (data, pitch, size, offsets), info
        except (AttributeError, TypeError, ValueError, OverflowError, NotImplementedError) as error:
            info["fallback"] = type(error).__name__ + ": " + str(error)
            return None, info
        finally:
            if locked:
                surface.unlock()

    def ft_rgb_rows(pixels, bounds):
        data, pitch, size, offsets = pixels
        x0, y0, x1, y1 = bounds
        stride = size * 3
        for y in range(y0, y1, 3):
            start, stop = y * pitch + x0 * size, y * pitch + x1 * size
            # Bytes slicing performs the stride extraction in C. The original
            # three-pixel grid and every RGB sample are retained, in row order.
            yield tuple(data[start + offset:stop + offset:stride] for offset in offsets)

    def ft_green_bounds(node, width, height):
        if node not in ("ft_short_target", "ft_media_legacy_target", "ft_motion_target", "ft_raw_chapter"):
            return None
        x0, y0, x1, y1 = (.12, .3, .88, .67) if node == "ft_raw_chapter" else (.2, .34, .8, .52)
        return int(width * x0), int(height * y0), int(width * x1), int(height * y1)

    def ft_green_pixels(surface, bounds, pixels=None):
        if bounds is None:
            return 0
        if pixels is not None:
            return sum(sum(g > 120 and g > r * 1.6 and g > b * 1.3 for r, g, b in zip(*row)) for row in ft_rgb_rows(pixels, bounds))
        x0, y0, x1, y1 = bounds
        result = 0
        for y in range(y0, y1, 3):
            for x in range(x0, x1, 3):
                r, g, b = surface.get_at((x, y))[:3]
                result += int(g > 120 and g > r * 1.6 and g > b * 1.3)
        return result

    def ft_actor_pixels_reference(surface, width, height):
        # Distinct flat portrait colors identify actual rendered positions,
        # including alpha interpolation; the blue/red backgrounds cannot match.
        sums = {"atl": [0, 0], "offset": [0, 0]}
        for y in range(int(height * .075), int(height * .315), 3):
            for x in range(int(width * .05), int(width * .82), 3):
                r, g, b = surface.get_at((x, y))[:3]
                key = "atl" if r > 95 and g > 65 and r > g * 1.3 and g > b * .7 else "offset" if r < 90 and g > 100 and b > 105 and g > r * 1.5 and g > b * .55 else None
                if key is not None:
                    sums[key][0] += 1
                    sums[key][1] += x / float(width)
        return {key: dict(count=value[0], x=value[1] / value[0] if value[0] else None) for key, value in sums.items()}

    def ft_actor_pixels(surface, width, height, pixels=None):
        if pixels is None:
            return ft_actor_pixels_reference(surface, width, height)
        bounds = int(width * .05), int(height * .075), int(width * .82), int(height * .315)
        xs = range(bounds[0], bounds[2], 3)
        width_float = float(width)
        sums = {"atl": [0, 0], "offset": [0, 0]}
        for row in ft_rgb_rows(pixels, bounds):
            for x, r, g, b in zip(xs, *row):
                key = "atl" if r > 95 and g > 65 and r > g * 1.3 and g > b * .7 else "offset" if r < 90 and g > 100 and b > 105 and g > r * 1.5 and g > b * .55 else None
                if key is not None:
                    sums[key][0] += 1
                    sums[key][1] += x / width_float
        return {key: dict(count=value[0], x=value[1] / value[0] if value[0] else None) for key, value in sums.items()}

    def ft_verify_pixel_reads():
        # Recheck one retained real screenshot per scanned node, after gameplay
        # assertions have finished. Prefer snapshots with visible text/actors.
        # Running the old slow observer here cannot consume a tested animation.
        rows = []
        for node, candidate in ft_probe.pixel_checks.items():
            surface = candidate["surface"]
            width, height = surface.get_size()
            bounds = ft_green_bounds(node, width, height)
            start = ft_time.monotonic()
            pixels, reader = ft_read_pixels(surface)
            copied = ft_time.monotonic()
            fast = dict(greenText=ft_green_pixels(surface, bounds, pixels),
                actors=ft_actor_pixels(surface, width, height, pixels) if candidate["expected"]["actors"] is not None else None)
            scanned = ft_time.monotonic()
            slow = dict(greenText=ft_green_pixels(surface, bounds),
                actors=ft_actor_pixels_reference(surface, width, height) if candidate["expected"]["actors"] is not None else None)
            finished = ft_time.monotonic()
            rows.append(dict(node=node, capturedAt=candidate["time"], frameSize=[width, height], reader=reader,
                expected=candidate["expected"], bulk=fast, getAt=slow, equal=pixels is not None and fast == slow == candidate["expected"],
                bulkReadSeconds=copied - start, bulkScanSeconds=scanned - copied, getAtScanSeconds=finished - scanned))
        ft_probe.pixel_checks = {}
        return rows

    def ft_capture_frame(force=False, phase=None):
        if not getattr(ft_probe, "watch", False) or not renpy.game.interface.started:
            return
        now = ft_now()
        if not force and now - ft_probe.sample_at < .035:
            return
        ft_probe.sample_at = now
        observer_start = ft_time.monotonic()
        surface = renpy.display.draw.screenshot(renpy.game.interface.surftree)
        w, h = surface.get_size()
        readback_end = ft_time.monotonic()
        pixel = lambda x, y: list(surface.get_at((int(w * x), int(h * y)))[:3])
        bounds = ft_green_bounds(vn_current_node, w, h)
        scan_actors = vn_current_node in ("ft_motion_target", "ft_motion_done")
        pixels, reader = ft_read_pixels(surface) if bounds is not None or scan_actors else (None, dict(mode="three-point-get_at"))
        copy_end = ft_time.monotonic()
        green_text = ft_green_pixels(surface, bounds, pixels)
        green_end = ft_time.monotonic()
        actors = ft_actor_pixels(surface, w, h, pixels) if scan_actors else None
        actor_end = ft_time.monotonic()
        if pixels is not None:
            signal = int(green_text > 0) + sum(int(value["count"] > 0) for value in (actors or {}).values())
            previous = ft_probe.pixel_checks.get(vn_current_node)
            if previous is None or signal > previous["signal"]:
                ft_probe.pixel_checks[vn_current_node] = dict(surface=surface.copy(), time=now, signal=signal,
                    expected=dict(greenText=green_text, actors=actors))
        snapshot_end = ft_time.monotonic()
        active = ft_probe.active
        chapter = renpy.get_screen("vn_chapter_title", layer="master")
        chapter_clock = chapter.scope.get("_vn_clock") if chapter else None
        frame = dict(time=now, node=vn_current_node, line=vn_current_line,
            stage=active["index"] if active is not None else None, phase=phase,
            pixel=pixel(.22, .28), videoPixel=pixel(.73, .28), hud=pixel(.9, .13), greenText=green_text,
            menu=bool(renpy.context()._menu),
            actors=actors,
            chapter={key: chapter_clock.get(key) for key in ("held", "started")} if chapter_clock is not None else None,
            voice=renpy.music.get_playing(channel="voice"),
            audio=[dict(channel=channel, elapsed=state["elapsed"], duration=state["duration"], playing=bool(renpy.music.get_playing(channel=channel)),
                held=bool(state.get("_vn_flow_hold")), mediaPosition=renpy.music.get_pos(channel=channel) if renpy.music.channel_defined(channel) else None) for channel, state in vn_audio_clips.items() if state.get("instanceId") == "ft_short_audio"],
            visuals=[ft_visual_state(tag, entry) for tag, entry in vn_visual_instances.items()],
            clocks=dict(blueprint=vn_bp_clock(), stage=vn_stage_clock(), frame=renpy.game.interface.frame_time, interaction=renpy.game.interface.interact_time,
                performanceUntil=vn_performance_until, performanceActive=vn_performance_active),
            pending=vn_flow_transition_pending())
        ft_probe.frames.append(frame)
        diagnostics_end = ft_time.monotonic()
        if active is not None and active["duration"] > 0:
            progress = max(0, now - active["start"]) / active["duration"]
            for key, threshold in (("source", 0), ("middle", .45), ("target", .88)):
                if progress >= threshold and key not in active["screenshots"]:
                    filename = ft_probe.name + "-%02d-" % active["index"] + key + ".png"
                    renpy.screenshot(ft_os.path.join(@@SHOTS@@, filename))
                    active["screenshots"][key] = filename
        observer_end = ft_time.monotonic()
        frame["observer"] = dict(reader=reader, frameSize=[w, h],
            greenSamples=len(range(bounds[0], bounds[2], 3)) * len(range(bounds[1], bounds[3], 3)) if bounds is not None else 0,
            actorSamples=len(range(int(w * .05), int(w * .82), 3)) * len(range(int(h * .075), int(h * .315), 3)) if scan_actors else 0,
            readbackSeconds=readback_end - observer_start, rgbCopySeconds=copy_end - readback_end,
            greenScanSeconds=green_end - copy_end, actorScanSeconds=actor_end - green_end, snapshotSeconds=snapshot_end - actor_end,
            diagnosticsSeconds=diagnostics_end - snapshot_end, screenshotsSeconds=observer_end - diagnostics_end, totalSeconds=observer_end - observer_start)

    def ft_draw(self, *args, **kwargs):
        result = ft_draw.original(self, *args, **kwargs)
        ft_capture_frame()
        return result

    def ft_queue(spec, node_id=None, port=None):
        ft_probe.queues.append(dict(time=ft_now(), node=node_id, port=port, spec=ft_copy(spec), current=vn_current_node))
        return ft_queue.original(spec, node_id, port)

    def ft_with_context(original, *args, **kwargs):
        pending = vn_flow_transition_request if vn_flow_transition_request is not None else vn_flow_transition_fallback
        if pending is None:
            return original(*args, **kwargs)
        previous = ft_probe.context
        context = dict(request=ft_request(pending), explicit=vn_flow_transition_request is not None, start=ft_now(), node=vn_current_node)
        ft_probe.flushes.append(context)
        ft_probe.context = context
        try:
            return original(*args, **kwargs)
        finally:
            context["end"] = ft_now()
            context["pendingAfter"] = vn_flow_transition_pending()
            ft_probe.context = previous

    def ft_flush(*args, **kwargs):
        return ft_with_context(ft_flush.original, *args, **kwargs)

    def ft_finish():
        return ft_with_context(ft_finish.original)

    def ft_stage(transition, duration):
        context = ft_probe.context
        request = ft_copy(context["request"]) if context else None
        # A fallback may be followed by the independent legacy scene transition.
        # Only its first native call consumes that fallback request.
        if context and any(r.get("contextStart") == context["start"] for r in ft_probe.stages):
            request = None
        row = dict(index=len(ft_probe.stages), start=ft_now(), duration=float(duration), native=type(transition).__name__,
            request=request, explicit=bool(context and context["explicit"]), contextStart=context["start"] if context else None,
            node=vn_current_node, line=vn_current_line, scene=vn_current_scene, screenshots={})
        ft_probe.stages.append(row)
        previous = ft_probe.active
        ft_probe.active = row
        ft_capture_frame(True, "before")
        try:
            return ft_stage.original(transition, duration)
        finally:
            row["end"] = ft_now()
            row["elapsed"] = row["end"] - row["start"]
            ft_capture_frame(True, "after")
            ft_probe.active = previous

    def ft_start_dialogue():
        ft_probe.early.append(dict(time=ft_now(), node=vn_current_node, pending=vn_flow_transition_pending()))
        return ft_start_dialogue.original()

    def ft_say_event(event, **kwargs):
        if event == "begin" and getattr(ft_probe, "watch", False):
            ft_probe.say.append(dict(time=ft_now(), node=vn_current_node, line=vn_current_line, pending=vn_flow_transition_pending()))

    def ft_after_load():
        if getattr(ft_probe, "watch", False):
            ft_probe.loads.append(dict(time=ft_now(), node=vn_current_node, pending=vn_flow_transition_pending()))

    def ft_maybe_save():
        active = ft_probe.active
        if active is None or ft_now() - active["start"] < .34:
            return
        slot = ft_probe.save_slot
        ft_probe.save_slot = None
        if not slot and ft_probe.save_plan and ft_probe.save_plan[0][0] == active["index"]:
            _, slot = ft_probe.save_plan.pop(0)
        if not slot:
            return
        ft_probe.saves.append(dict(time=ft_now(), slot=slot, node=vn_current_node, pending=vn_flow_transition_pending(), stage=active["index"]))
        renpy.save(slot)

    def ft_modes():
        return [(r["request"] or {}).get("transition", {}).get("mode", "legacy") for r in ft_probe.stages]

    def ft_ports():
        return [((r["request"] or {}).get("nodeId"), (r["request"] or {}).get("port")) for r in ft_probe.stages]

    def ft_stage_frames(index):
        return [f for f in ft_probe.frames if f["stage"] == index]

    def ft_pixel_is(rgb, shade):
        r, g, b = rgb
        return {"red": r > 125 and r > g * 1.8 and r > b * 1.8,
            "blue": b > 125 and b > r * 1.7 and b > g * 1.4,
            "green": g > 120 and g > r * 1.5 and g > b * 1.3,
            "black": max(rgb) < 30, "white": min(rgb) > 220,
            "magenta": r > 100 and b > 100 and g < 85,
            "cyan": g > 120 and b > 120 and r < 85}[shade]

    def ft_has_pixel(index, shade):
        return any(ft_pixel_is(f["pixel"], shade) for f in ft_stage_frames(index))

    def ft_red_to_blue(index):
        frames = ft_stage_frames(index)
        red = [f["time"] for f in frames if ft_pixel_is(f["pixel"], "red")]
        blue = [f["time"] for f in frames if ft_pixel_is(f["pixel"], "blue")]
        return bool(red and blue and min(red) < max(blue))

    def ft_early_source_is_red(index):
        row = ft_probe.stages[index]
        frames = [f for f in ft_stage_frames(index) if .015 <= f["time"] - row["start"] <= row["duration"] * .22]
        return bool(frames) and any(ft_pixel_is(f["pixel"], "red") for f in frames)

    def ft_hud_unchanged(index):
        frames = ft_stage_frames(index)
        return len(frames) >= 3 and all(max(abs(actual - expected) for actual, expected in zip(f["hud"], (240, 208, 32))) <= 6 for f in frames)

    def ft_single_timing(seconds):
        return len(ft_probe.stages) == 1 and abs(ft_probe.stages[0]["duration"] - seconds) < .000001 and seconds * .82 <= ft_probe.stages[0]["elapsed"] <= seconds + 2.0

    def ft_stage_span():
        return ft_probe.stages[-1]["end"] - ft_probe.stages[0]["start"]

    def ft_say_time(node):
        return max([r["time"] for r in ft_probe.say if r["node"] == node] or [-1])

    def ft_visible_wait(node, seconds):
        frames = [f for f in ft_probe.frames if f["node"] == node and f["stage"] is None and not f["pending"] and ft_pixel_is(f["pixel"], "blue")]
        return bool(frames) and frames[-1]["time"] - frames[0]["time"] >= seconds

    def ft_flow_idle():
        return not vn_flow_transition_pending() and vn_flow_transition_active is None and vn_flow_transition_captured is None and not vn_flow_transition_legacy_pending and vn_pending_scene_transition is None and vn_performance_transition is None

    def ft_actor_motion_after(index, key, target, displacement):
        row = ft_probe.stages[index]
        held = [f for f in ft_stage_frames(index) if f["actors"] is not None and f["time"] - row["start"] >= row["duration"] * .76]
        frames = [f for f in ft_probe.frames if f["node"] == "ft_motion_target" and f["stage"] is None and f["time"] >= row["end"] and f["actors"][key]["count"] >= 12]
        settled = [f for f in frames if .84 <= f["time"] - row["end"] <= 1.05]
        return bool(held and all(f["actors"][key]["count"] <= 2 for f in held) and len(frames) >= 5 and settled
            and max(f["actors"][key]["x"] for f in frames) - min(f["actors"][key]["x"] for f in frames) >= displacement
            and all(abs(f["actors"][key]["x"] - target) <= .015 for f in settled))

    def ft_typewriter_after(index):
        row = ft_probe.stages[index]
        held = [f for f in ft_stage_frames(index) if f["node"] == "ft_motion_target" and f["time"] - row["start"] >= row["duration"] * .76]
        frames = [f for f in ft_probe.frames if f["node"] == "ft_motion_target" and f["stage"] is None and f["time"] >= row["end"]]
        early = [f["greenText"] for f in frames if .05 <= f["time"] - row["end"] <= .24]
        full = [f["greenText"] for f in frames if .62 <= f["time"] - row["end"] <= .86]
        # Ren'Py may draw its first glyph at text time zero. The held first
        # pose must remain incomplete, then reveal the remaining real glyphs.
        return bool(held and early and full and min(full) >= 50 and max(f["greenText"] for f in held) <= max(full) * .25
            and min(early) < max(full) * .6 and 0 < max(early) < max(full) * .75
            and any(f["time"] - row["end"] >= .84 and f["greenText"] >= max(full) * .9 for f in frames))

    def ft_chapter_after(index):
        row = ft_probe.stages[index]
        held = [f for f in ft_stage_frames(index) if f["node"] == "ft_raw_chapter" and not f["menu"] and f["chapter"] is not None]
        frames = [f for f in ft_probe.frames if f["node"] == "ft_raw_chapter" and f["stage"] is None and not f["menu"] and f["time"] >= row["end"]]
        visible = [f for f in frames if f["greenText"] >= 12 and ft_pixel_is(f["pixel"], "blue")]
        present = [f for f in frames if f["chapter"] is not None]
        return bool(held and all(f["greenText"] <= 2 and f["chapter"]["started"] is None for f in held)
            and visible and max(f["time"] for f in visible) - row["end"] >= .56
            and present and max(f["time"] for f in present) - row["end"] >= .7)

    def ft_short_media_survives(after, seconds, node="ft_short_target"):
        frames = [f for f in ft_probe.frames if f["time"] >= after and f["node"] == node and f["stage"] is None]
        complete = [f for f in frames if ft_pixel_is(f["pixel"], "green") and f["greenText"] >= 12 and any(a["playing"] and a["elapsed"] < a["duration"] for a in f["audio"])]
        return bool(complete) and max(f["time"] for f in complete) - after >= seconds

    def ft_video_first_frame_is_frozen(index):
        row = ft_probe.stages[index]
        frames = [f for f in ft_stage_frames(index) if f["time"] - row["start"] >= row["duration"] * .76 and f["phase"] != "before"]
        # Decode a real texture during the fade-in; a paused flag alone cannot
        # prove a Movie has acquired its first frame. The second marker color
        # must not appear until this flow transition releases the new media.
        return bool(frames) and any(ft_pixel_is(f["videoPixel"], "magenta") for f in frames) and not any(ft_pixel_is(f["videoPixel"], "cyan") for f in frames)

    def ft_video_plays_after(after, seconds, node="ft_short_target"):
        frames = [f for f in ft_probe.frames if f["time"] >= after and f["stage"] is None and f["node"] == node]
        first = [f["time"] for f in frames if ft_pixel_is(f["videoPixel"], "magenta")]
        moved = [f["time"] for f in frames if ft_pixel_is(f["videoPixel"], "cyan")]
        return bool(first and moved and min(first) < min(moved) and max(moved) - after >= seconds)

    def ft_video_channel(instance_id):
        movie = vn_visual_instances.get("vn_visual_" + instance_id, {}).get("data", {}).get("_vn_movie")
        return movie.channel if movie is not None else None

    def ft_latest_video_is(node, shade):
        return bool(ft_probe.frames and ft_probe.frames[-1]["node"] == node and ft_pixel_is(ft_probe.frames[-1]["videoPixel"], shade))

    def ft_video_has_pixel(index, shade):
        return any(ft_pixel_is(f["videoPixel"], shade) for f in ft_stage_frames(index))

    def ft_early_video_is(index, shade):
        row = ft_probe.stages[index]
        frames = [f for f in ft_stage_frames(index) if .015 <= f["time"] - row["start"] <= row["duration"] * .24]
        return bool(frames) and any(ft_pixel_is(f["videoPixel"], shade) for f in frames)

    ft_probe.name, ft_probe.started, ft_probe.watch = "initial", ft_time.monotonic(), False
    ft_probe.stages, ft_probe.queues, ft_probe.flushes, ft_probe.frames = [], [], [], []
    ft_probe.say, ft_probe.early, ft_probe.loads, ft_probe.saves = [], [], [], []
    ft_probe.active, ft_probe.context, ft_probe.save_slot = None, None, None
    ft_probe.save_plan = []
    ft_probe.source_channel, ft_probe.target_channel = None, None
    ft_probe.sample_at = -1.0
    ft_probe.pixel_checks = {}
    ft_draw.original = renpy.display.core.Interface.draw_screen
    renpy.display.core.Interface.draw_screen = ft_draw
    ft_stage.original, vn_stage_transition = vn_stage_transition, ft_stage
    ft_queue.original, vn_flow_transition_queue = vn_flow_transition_queue, ft_queue
    ft_flush.original, vn_flow_transition_flush = vn_flow_transition_flush, ft_flush
    ft_finish.original, vn_flow_transition_finish = vn_flow_transition_finish, ft_finish
    ft_start_dialogue.original, vn_start_dialogue = vn_start_dialogue, ft_start_dialogue
    config.all_character_callbacks.append(ft_say_event)
    config.after_load_callbacks.append(ft_after_load)
    config.always_shown_screens.append("ft_probe_hud")
    config.always_shown_screens.append("ft_probe_save_timer")

screen ft_probe_hud():
    zorder 10000
    add Solid("#f0d020") xpos .85 ypos .08 xysize (96, 54)

screen ft_probe_save_timer():
    timer .03 repeat True action Function(ft_maybe_save, _update_screens=False)

testsuite global:
    before testcase:
        $ _test.timeout = 30.0
        $ _test.transition_timeout = 10.0
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
        $ preferences.transitions = 2
        $ config.skipping = None
    after testcase:
        $ ft_dump()
        $ ft_probe.watch = False
        $ ft_probe.save_slot = None
        $ ft_probe.save_plan = []
        $ config.skipping = None
        $ preferences.transitions = 2
        run MainMenu(confirm=False)
        pause until screen "main_menu"
    teardown:
        exit

@@CASES@@`.replaceAll('@@TRACES@@', q(path.join(output, 'traces'))).replaceAll('@@SHOTS@@', q(path.join(output, 'screenshots'))).replace('@@CASES@@', chosen.map(item => item.source).join('\n'));
}

try {
  const tests = nativeTests();
  const cases = (tests.match(/^testcase /gm) ?? []).length, assertions = (tests.match(/^    assert /gm) ?? []).length;
  report.expectedCases = cases; report.expectedAssertions = assertions;
  await fs.writeFile(path.join(output, 'testcases.rpy'), tests);
  // This applies to buildProject's implicit compile as well as explicit lint/test.
  report.renpySaves = await isolateRenpySaves(output);
  authorHash = digest(await fs.readFile(authorFile)); report.authorSha256Before = authorHash;
  const project = fixture(), original = structuredClone(project);
  report.fixtureProjectId = project.id;
  await fs.mkdir(path.join(source, 'assets'), { recursive: true });
  await fs.writeFile(path.join(source, 'project.vns.json'), JSON.stringify(project, null, 2));
  await fs.writeFile(path.join(output, 'fixture.json'), JSON.stringify(project, null, 2));
  for (const [name, rgb] of Object.entries({ red: [224, 40, 32], blue: [32, 64, 224], green: [32, 224, 96], dark: [6, 6, 10] })) {
    await fs.writeFile(path.join(source, 'assets', name + '.png'), solidPng(rgb));
  }
  await fs.writeFile(path.join(source, 'assets/actor-atl.png'), solidPng([236, 128, 24], 96, 120));
  await fs.writeFile(path.join(source, 'assets/actor-offset.png'), solidPng([32, 220, 221], 96, 120));
  await fs.writeFile(path.join(source, 'assets/tone.wav'), toneWav());
  execFileSync(process.env.VNS_FFMPEG ?? 'ffmpeg', [
    '-nostdin', '-v', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=0xdc20d0:size=128x96:rate=30:duration=0.24',
    '-f', 'lavfi', '-i', 'color=c=0x20dcdd:size=128x96:rate=30:duration=0.96',
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]',
    '-c:v', 'libvpx', '-pix_fmt', 'yuv420p', '-an', path.join(source, 'assets/transition-video.webm'),
  ], { windowsHide: true, timeout: 30000 });
  const built = await buildProject({ project, projectDir: source, sdkRoot: sdk, outputDir: game, development: true });
  assert.deepEqual(project, original, 'Building must not mutate authored transitions.');
  await check('compile', { code: built.ok ? 0 : 1, log: built.log + '\n' + JSON.stringify(built.diagnostics, null, 2) });
  await fs.writeFile(path.join(game, 'game/testcases.rpy'), tests);
  const options = { savedir: saves, timeoutMs: 300000, env: { RENPY_RENDERER: 'gl2' } };
  await check('lint', await runRenpy(sdk, game, ['lint'], options));
  const native = await runRenpy(sdk, game, ['test', '--report-detailed', '--report-skipped'], { ...options, onData: text => process.stdout.write(text) });
  report.cases = Number(native.log.match(/Test cases\s*:\s*(\d+)/)?.[1] ?? 0);
  report.assertions = Number(native.log.match(/Assertions\s*:\s*(\d+)/)?.[1] ?? 0);
  await check('runtime', native);
  assert.match(native.log, new RegExp('Test cases\\s*:\\s*' + cases + '\\s*\\|\\s*' + cases + ' passed'));
  assert.equal(report.assertions, assertions, 'Every native assertion must execute.');
  const traceFiles = (await fs.readdir(path.join(output, 'traces'))).filter(name => name.endsWith('.json'));
  assert.equal(traceFiles.length, cases, 'Each testcase must preserve its native trace.');
  report.traceFiles = traceFiles;
  report.screenshotCount = (await fs.readdir(path.join(output, 'screenshots'))).filter(name => name.endsWith('.png')).length;
  report.status = 'passed';
} catch (error) {
  failure = error; report.status = 'failed'; report.error = error instanceof Error ? error.stack : String(error);
} finally {
  try {
    for (const directory of [path.join(game, 'tests/screenshots'), path.join(game, 'game/tests/screenshots')]) {
      if (await fs.stat(directory).then(stat => stat.isDirectory()).catch(() => false)) await fs.cp(directory, path.join(output, 'screenshots'), { recursive: true });
    }
    for (const name of ['errors.txt', 'traceback.txt', 'log.txt', 'report.html', 'test-report.html', 'tests/report.html']) {
      const candidate = path.join(game, name);
      if (await fs.stat(candidate).then(stat => stat.isFile()).catch(() => false)) await fs.copyFile(candidate, path.join(output, path.basename(name)));
    }
    report.traceFiles = (await fs.readdir(path.join(output, 'traces'))).filter(name => name.endsWith('.json'));
    report.screenshotCount = (await fs.readdir(path.join(output, 'screenshots'))).filter(name => name.endsWith('.png')).length;
  } catch (error) { report.status = 'failed'; report.evidenceError = String(error); failure ??= error; }
  try {
    const after = digest(await fs.readFile(authorFile)); report.authorSha256After = after;
    if (authorHash !== undefined) assert.equal(after, authorHash, 'The author project must remain unchanged.');
  } catch (error) { report.status = 'failed'; report.authorProtectionError = String(error); failure ??= error; }
  try {
    report.cleanup = await cleanVerificationDirectories(output, ['source', 'game', 'saves', 'renpy-saves']);
    assert.deepEqual((report.cleanup as { errors: unknown[] }).errors, []);
  } catch (error) { report.status = 'failed'; report.cleanupError = String(error); failure ??= error; }
  if (previousRenpySaves === undefined) delete process.env.RENPY_PATH_TO_SAVES;
  else process.env.RENPY_PATH_TO_SAVES = previousRenpySaves;
  await saveReport(); console.log(path.join(output, 'report.json'));
}
if (failure) throw failure;
