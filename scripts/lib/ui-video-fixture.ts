import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject, type BlueprintGraph, type BlueprintNode, type UiComponent, type VariableValue } from '../../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../../src/core/blueprint';
import { createUiEventGraph, ensureUiClickEvent, ensureUiVideoEvent } from '../../src/core/ui-logic';
import type { UiProperty } from '../../src/core/ui-properties';
import { uiImageFixturePng } from './ui-image-fixture';

/** One authored fixture is shared by core replay, Electron and Ren'Py. */
export function createUiVideoFixture() {
  const project = createProject('视频控件播放与实例事件'); project.id = 'ui_video_fixture'; project.width = 1280; project.height = 720;
  for (const [id, initial] of Object.entries({ video_ended: 0, video_failed: 0, video_event_asset: '', video_event_position: 0, video_event_duration: 0, video_event_known: false, video_event_error: '', video_status: '', video_position: 0, video_duration: 0, video_known: false, video_progress: 0, video_playing: false, video_paused: false, video_error: '', video_can_seek: true, video_job_done: false })) project.variables.push({ id, name: id, type: typeof initial as 'number' | 'string' | 'boolean', initial, persistent: false });
  project.assets.push(...(['a', 'b', 'broken'] as const).map(name => ({ id: 'movie_' + name, name: '视频 ' + name, kind: 'video' as const, category: 'video' as const, path: 'assets/movie-' + name + '.webm' })), { id: 'movie_poster', name: '视频封面', kind: 'image', path: 'assets/movie-poster.png' });
  const actions = [['play', '播放视频'], ['pause', '暂停视频'], ['resume', '继续视频'], ['stop', '停止视频'], ['restart', '从头重播'], ['loop', '开启循环'], ['once', '关闭循环'], ['swap', '切换视频'], ['same', '相同素材'], ['clear', '清空视频'], ['restore', '恢复设计素材'], ['reset', '重置视频控件'], ['hide', '隐藏视频'], ['show', '显示视频'], ['fail', '播放损坏视频'], ['observe', '读取视频状态'], ['background', '后台控制视频'], ['child', '打开视频子页'], ['native', '打开视频模板'], ['close', '关闭视频页']] as const;
  const movie: UiComponent = { id: 'movie', page: 'custom', kind: 'video', name: '被测视频', text: '', assetId: 'movie_a', posterId: 'movie_poster', loop: false, x: .04, y: .03, width: .55, height: .34 };
  const mirror: UiComponent = { ...movie, id: 'movie_mirror', name: '独立视频', x: .63, width: .33, loop: true };
  const page = { id: 'video_page', name: '视频场景', modal: true, background: '#263847', components: [movie, mirror, ...actions.map(([id, text], i): UiComponent => ({ id: 'video_action_' + id, page: 'custom', kind: 'button', text, x: .025 + i % 5 * .195, y: .42 + Math.floor(i / 5) * .14, width: .18, height: .1, style: { fontSize: 20 }, ...(id === 'close' ? { action: 'return' as const } : {}) }))] };
  const child = { id: 'video_child', name: '视频子页', modal: true, background: '#172733', components: [{ ...movie, id: 'movie_child', assetId: 'movie_b', loop: true, x: .2, y: .14, width: .6, height: .38 }, { id: 'video_child_close', page: 'custom', kind: 'button', text: '关闭视频子页', action: 'return', x: .35, y: .74, width: .3, height: .1 }] as UiComponent[] };
  project.ui.customPages.push(page, child);
  project.ui.pages ??= {}; project.ui.pages.preferences = { layout: 'custom', background: '#20313d' };
  project.ui.components = project.ui.components.filter(c => c.page !== 'preferences');
  project.ui.components.push({ ...movie, id: 'movie_native', page: 'preferences', assetId: 'movie_b', loop: true, x: .2, y: .16, width: .6, height: .4 }, { id: 'video_native_close', page: 'preferences', kind: 'button', text: '关闭视频模板', action: 'return', x: .35, y: .75, width: .3, height: .1 });
  const graph = createUiEventGraph(project, page.id, '视频同源场景'); let serial = 0;
  const node = (owner: BlueprintGraph, type: BlueprintNode['type'], properties: Record<string, VariableValue> = {}) => {
    const n = blueprintNodeDefaults(type); n.id = 'video_node_' + ++serial; Object.assign(n.properties, properties); n.x = 80 + serial % 5 * 380; n.y = 400 + Math.floor(serial / 5) * 260; owner.nodes.push(n); synchronizeBlueprintSignatures(project); return n;
  };
  const wire = (owner: BlueprintGraph, from: BlueprintNode, output: string, to: BlueprintNode, input: string) => assert.equal(connectBlueprintPins(owner, from.id, output, to.id, input), undefined);
  const next = (owner: BlueprintGraph, from: BlueprintNode, to: BlueprintNode) => { wire(owner, from, from.pins.find(pin => pin.direction === 'output' && pin.dataType === 'exec')!.id, to, 'exec_in'); return to; };
  const action = (name: typeof actions[number][0]) => ensureUiClickEvent(project, graph, 'video_action_' + name, page.id);
  const step = (previous: BlueprintNode, type: BlueprintNode['type'], properties: Record<string, VariableValue> = {}) => next(graph, previous, node(graph, type, properties));
  const mutations: Record<string, BlueprintNode> = {};
  for (const [name, type, properties] of [['play', 'playUiVideo', { restart: false }], ['restart', 'playUiVideo', { restart: true }], ['pause', 'pauseUiVideo', { paused: true }], ['resume', 'pauseUiVideo', { paused: false }], ['stop', 'stopUiVideo', {}]] as [typeof actions[number][0], BlueprintNode['type'], Record<string, VariableValue>][]) mutations[name] = step(action(name), type, { componentId: 'movie', ...properties });
  for (const [name, property, value] of [['loop', 'videoLoop', true], ['once', 'videoLoop', false], ['swap', 'video', 'movie_b'], ['same', 'video', 'movie_a'], ['clear', 'video', ''], ['fail', 'video', 'movie_broken'], ['hide', 'visible', false], ['show', 'visible', true]] as [typeof actions[number][0], UiProperty, VariableValue][]) mutations[name] = step(action(name), 'setUiProperty', { componentId: 'movie', property, value });
  mutations.restore = step(action('restore'), 'resetUiProperty', { componentId: 'movie', property: 'video' });
  mutations.reset = step(action('reset'), 'resetUiComponent', { componentId: 'movie' });
  step(action('child'), 'showUiPage', { pageId: child.id, wait: true }); step(action('native'), 'showUiPage', { pageId: 'ui:preferences', wait: true });
  let observe = action('observe');
  for (const [property, variableId] of [['videoStatus', 'video_status'], ['videoPosition', 'video_position'], ['videoDuration', 'video_duration'], ['videoDurationKnown', 'video_known'], ['videoProgress', 'video_progress'], ['videoPlaying', 'video_playing'], ['videoPaused', 'video_paused'], ['videoError', 'video_error'], ['videoCanSeek', 'video_can_seek']] as [UiProperty, string][]) {
    const read = node(graph, 'getUiProperty', { componentId: 'movie', property }), store = node(graph, 'setVariable', { variableId }); wire(graph, read, 'value', store, 'value'); observe = next(graph, observe, store);
  }
  const eventRoots: Record<string, BlueprintNode> = {};
  for (const [trigger, variableId] of [['ended', 'video_ended'], ['failed', 'video_failed']] as const) {
    const event = eventRoots[trigger] = ensureUiVideoEvent(project, graph, 'movie', page.id, trigger), read = node(graph, 'getVariable', { variableId }), add = node(graph, 'math', { operation: 'add', b: 1 }), store = node(graph, 'setVariable', { variableId });
    wire(graph, read, 'value', add, 'a'); wire(graph, add, 'result', store, 'value'); let tail = next(graph, event, store);
    for (const [pin, variableId] of [['assetId', 'video_event_asset'], ['position', 'video_event_position'], ['duration', 'video_event_duration'], ['durationKnown', 'video_event_known'], ['error', 'video_event_error']]) {
      const store = node(graph, 'setVariable', { variableId });
      if (pin === 'assetId') { const text = node(graph, 'formatText', { format: '{value}' }); wire(graph, event, pin, text, 'value'); wire(graph, text, 'text', store, 'value'); }
      else wire(graph, event, pin, store, 'value');
      tail = next(graph, tail, store);
    }
  }
  const background = createBlueprintGraph('function', '后台视频控制'); project.blueprints.push(background);
  let tail = next(background, background.nodes[0], node(background, 'setUiProperty', { componentId: 'movie', property: 'video', value: 'movie_b' }));
  tail = next(background, tail, node(background, 'pauseUiVideo', { componentId: 'movie', paused: true }));
  next(background, tail, node(background, 'setVariable', { variableId: 'video_job_done', value: true }));
  step(action('background'), 'startTask', { graphId: background.id, scope: 'page', pageId: page.id, seconds: .2, conflict: 'parallel' });
  const open = createBlueprintGraph('function', '打开视频场景'); project.blueprints.push(open); next(open, open.nodes[0], node(open, 'showUiPage', { pageId: page.id, wait: true }));
  const passage = project.nodes.find(n => n.kind === 'passage'); if (!passage || passage.kind !== 'passage') throw new Error('Missing passage'); passage.lines[0].text = '视频页关闭后继续剧情。'; passage.lines[0].actions = [{ kind: 'blueprint', blueprintId: open.id }];
  const editGraph = createBlueprintGraph('function', '视频属性创作'); project.blueprints.push(editGraph);
  const editorSet = node(editGraph, 'setUiProperty', { componentId: 'movie', property: 'video', value: 'movie_a' }), editorGet = node(editGraph, 'getUiProperty', { componentId: 'movie', property: 'videoStatus' });
  synchronizeBlueprintSignatures(project);
  return { project, page, movie, mirror, child, graph, background, editGraph, editorSet, editorGet, mutations, eventRoots, node, wire, next, open };
}

/** Generate tiny local test videos only during the final acceptance run. */
export async function writeUiVideoFixtureAssets(directory: string) {
  await fs.mkdir(path.join(directory, 'assets'), { recursive: true });
  for (const [name, filter] of [['a', 'testsrc2=size=96x64:rate=20'], ['b', 'color=c=blue:size=128x72:rate=20']] as const) {
    execFileSync(process.env.VNS_FFMPEG ?? 'ffmpeg', ['-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', filter, '-t', name === 'a' ? '2' : '3', '-c:v', 'libvpx', '-pix_fmt', 'yuv420p', '-an', path.join(directory, 'assets/movie-' + name + '.webm')], { windowsHide: true, timeout: 30000 });
  }
  await fs.writeFile(path.join(directory, 'assets/movie-broken.webm'), 'intentionally invalid video fixture');
  await fs.writeFile(path.join(directory, 'assets/movie-poster.png'), uiImageFixturePng());
}
