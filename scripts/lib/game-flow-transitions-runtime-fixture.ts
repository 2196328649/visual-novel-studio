import assert from 'node:assert/strict';
import type { PreviewOptions } from '../../src/core/bridge';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../../src/core/blueprint';
import { performanceNode } from '../../src/core/blueprint-authoring';
import type { FlowTransition } from '../../src/core/flow-transition-schema';
import { addGameFlowStep, flowNodeIds, flowStepNodeId } from '../../src/core/game-flow-graph';
import { createProject, type BlueprintGraph, type BlueprintNode, type VisualObject } from '../../src/core/model';
import { ensureUiSpineEvent, ensureUiVideoEvent } from '../../src/core/ui-logic';
import { spineFixtureAssets } from './ui-spine-fixture';

export const gameFlowTransitionScenarioIds = ['image_dissolve', 'image_color', 'image_none', 'image_default', 'page_logic_chain', 'video_tail', 'title_preview', 'page_tail', 'video_target', 'page_cancel_continue', 'page_cancel_title', 'authored_opening_music', 'no_title_music', 'title_loop_video', 'title_once_video', 'title_loop_spine', 'title_once_spine', 'pending_video_load', 'pending_spine_load'] as const;
export type GameFlowTransitionScenarioId = typeof gameFlowTransitionScenarioIds[number];

export const gameFlowTransitionColors = {
  red: [224, 40, 32], blue: [32, 64, 224], green: [32, 224, 96], yellow: [240, 208, 32],
  magenta: [220, 32, 208], cyan: [32, 220, 221], black: [0, 0, 0],
  warm: [240, 100, 55],
} as const;

export const gameFlowTransitionSpecs = {
  dissolve: { mode: 'dissolve', duration: .64 },
  color: { mode: 'color', outDuration: .24, hold: .2, inDuration: .28, color: '#000000' },
  story: { mode: 'dissolve', duration: .42 },
  page: { mode: 'dissolve', duration: .48 },
  movieEntry: { mode: 'dissolve', duration: 1.4 },
  liveMenu: { mode: 'dissolve', duration: 2.8 },
  liveMenuColor: { mode: 'color', outDuration: 1.4, hold: 0, inDuration: 1.4, color: '#000000' },
  logic: { mode: 'color', outDuration: .18, hold: .16, inDuration: .2, color: '#000000' },
} satisfies Record<string, FlowTransition>;

/** A separate native fixture: the opening is the user's real timeline shape,
 * savedAction(image, duration=3, wait=false) -> tail delay(3), stored in
 * timelinePresets. No probe manufactures a source image or calls a transition. */
export function createGameFlowTransitionsRuntimeFixture(scenario: GameFlowTransitionScenarioId) {
  const project = createProject('游戏入口连线过渡 · ' + scenario);
  project.id = 'game_flow_transition_' + scenario;
  project.width = 960; project.height = 540;
  project.blueprints = []; project.timelinePresets = []; project.characters = [];
  project.variables = ['gft_menu_shows', 'gft_button_clicks', 'gft_story_entries', 'gft_page_shows', 'gft_logic_count',
    'gft_video_ended', 'gft_video_failed', 'gft_broken_video_failed', 'gft_spine_completed', 'gft_spine_failed', 'gft_broken_spine_failed']
    .map(id => ({ id, name: id, type: 'number' as const, initial: 0, persistent: true }));
  project.chapters = [{ id: 'gft_chapter', name: '入口验收' }];
  project.scenes = [{ id: 'gft_scene', name: '故事场景', chapterId: 'gft_chapter' }];
  project.assets = [
    ...(['red', 'blue', 'green', 'yellow'] as const).map(shade => ({ id: 'gft_' + shade, name: shade, kind: 'image' as const, category: 'scene' as const, path: 'assets/' + shade + '.png', width: 32, height: 32 })),
    { id: 'gft_music', name: '原有标题音乐', kind: 'audio', category: 'bgm', path: 'assets/menu-tone.wav' },
    { id: 'gft_opening_music', name: '作者明确添加的开场音乐', kind: 'audio', category: 'bgm', path: 'assets/opening-tone.wav' },
    { id: 'gft_movie', name: '品红开头和青色末帧', kind: 'video', category: 'video', path: 'assets/opening.webm', width: 160, height: 90 },
  ];
  project.ui.fontSize = 22;
  project.ui.menuMusicId = 'gft_music'; project.ui.menuMusicFade = 0;
  if (scenario === 'no_title_music') delete project.ui.menuMusicId;
  // Esc has a real destination once gameplay begins, so input-gating coverage
  // cannot pass merely because the game has no menu shortcut configured.
  project.ui.menuShortcutPage = 'preferences';
  project.ui.pages = { main: { layout: 'custom', background: '#2040e0', backgroundOpacity: 1 } };
  project.ui.components = [
    { id: 'gft_title', page: 'main', kind: 'text', text: '真实主菜单', x: .08, y: .07, width: .6, height: .12 },
    { id: 'gft_marker', page: 'main', kind: 'image', text: '', assetId: 'gft_yellow', x: .84, y: .08, width: .1, height: .1 },
    { id: 'gft_start', page: 'main', kind: 'button', text: '开始游戏', action: 'start', x: .36, y: .61, width: .28, height: .11 },
    { id: 'gft_touch', page: 'main', kind: 'button', text: '计数按钮', action: 'blueprint', blueprintId: 'gft_touch_graph', x: .36, y: .76, width: .28, height: .11 },
  ];
  const menuVideo = scenario === 'title_loop_video' || scenario === 'title_once_video';
  if (menuVideo) project.ui.components.push({ id: 'gft_menu_video', name: '过渡中的标题视频', page: 'main', kind: 'video', text: '',
    assetId: 'gft_movie', posterId: 'gft_green', loop: scenario === 'title_loop_video', x: .52, y: .36, width: .24, height: .22 });
  if (scenario === 'title_loop_video') {
    project.assets.push({ id: 'gft_broken_movie', name: '故意损坏的本地视频', kind: 'video', category: 'video', path: 'assets/broken.webm' });
    project.ui.components.push({ id: 'gft_broken_video', name: '等待页面进入后报告失败', page: 'main', kind: 'video', text: '',
      assetId: 'gft_broken_movie', posterId: 'gft_green', loop: true, x: .05, y: .40, width: .12, height: .12 });
  }
  const menuSpine = scenario === 'title_loop_spine' || scenario === 'title_once_spine';
  if (menuSpine) {
    project.assets.push(...structuredClone(spineFixtureAssets));
    project.ui.components.push({ id: 'gft_menu_spine', name: '过渡中的标题骨骼', page: 'main', kind: 'spine', text: '', assetId: 'rig_a',
      spine: { animation: 'quick', skin: 'default', loop: scenario === 'title_loop_spine', autoplay: true }, x: .52, y: .36, width: .24, height: .22 });
    if (scenario === 'title_loop_spine') project.ui.components.push({ id: 'gft_broken_spine', name: '等待页面进入后报告骨骼失败', page: 'main', kind: 'spine', text: '', assetId: 'rig_broken',
      spine: { animation: 'quick', loop: true, autoplay: true }, x: .05, y: .40, width: .12, height: .12 });
  }

  const graph = (id: string, kind: BlueprintGraph['kind'] = 'function'): BlueprintGraph => {
    const result = createBlueprintGraph(kind, id); result.id = id; result.nodes[0].id = id + '_entry';
    project.blueprints.push(result); return result;
  };
  const wire = (g: BlueprintGraph, from: BlueprintNode, to: BlueprintNode, output = from.type === 'event' ? 'exec' : 'exec_out', input = 'exec_in') => {
    synchronizeBlueprintSignatures(project);
    assert.equal(connectBlueprintPins(g, from.id, output, to.id, input), undefined, `Fixture wire ${g.id}: ${from.id} -> ${to.id}`);
  };
  const counter = (id: string, variableId: string, pageId?: string) => {
    const g = graph(id, pageId ? 'ui' : 'function');
    if (pageId) { g.uiPageId = pageId; if (pageId.startsWith('ui:')) g.uiInstanceId = 'base'; }
    const read = blueprintNodeDefaults('getVariable'), add = blueprintNodeDefaults('math'), write = blueprintNodeDefaults('setVariable');
    read.id = id + '_read'; read.properties = { variableId };
    add.id = id + '_add'; add.properties = { operation: 'add', b: 1 };
    write.id = id + '_write'; write.properties = { variableId };
    g.nodes.push(read, add, write);
    wire(g, g.nodes[0], write); wire(g, read, add, 'value', 'a'); wire(g, add, write, 'result', 'value');
    return g;
  };
  counter('gft_main_shown', 'gft_menu_shows', 'ui:main');
  counter('gft_touch_graph', 'gft_button_clicks');
  if (menuVideo) {
    const events = graph('gft_menu_video_events', 'ui'); events.uiPageId = 'ui:main'; events.uiInstanceId = 'base';
    for (const trigger of ['ended', 'failed'] as const) {
      const event = ensureUiVideoEvent(project, events, 'gft_menu_video', 'ui:main', trigger);
      event.id = 'gft_menu_video_' + trigger + '_event';
      const handler = counter('gft_video_' + trigger + '_handler', 'gft_video_' + trigger);
      const call = blueprintNodeDefaults('callFunction'); call.id = 'gft_video_' + trigger + '_call'; call.properties.graphId = handler.id;
      events.nodes.push(call); wire(events, event, call, 'exec');
    }
    if (scenario === 'title_loop_video') {
      const event = ensureUiVideoEvent(project, events, 'gft_broken_video', 'ui:main', 'failed');
      event.id = 'gft_broken_video_failed_event';
      const handler = counter('gft_broken_video_failed_handler', 'gft_broken_video_failed');
      const call = blueprintNodeDefaults('callFunction'); call.id = 'gft_broken_video_failed_call'; call.properties.graphId = handler.id;
      events.nodes.push(call); wire(events, event, call, 'exec');
    }
  }
  if (menuSpine) {
    const events = graph('gft_menu_spine_events', 'ui'); events.uiPageId = 'ui:main'; events.uiInstanceId = 'base';
    for (const trigger of ['completed', 'failed'] as const) {
      const event = ensureUiSpineEvent(project, events, 'gft_menu_spine', 'ui:main', trigger);
      event.id = 'gft_menu_spine_' + trigger + '_event';
      const handler = counter('gft_spine_' + trigger + '_handler', 'gft_spine_' + trigger);
      const call = blueprintNodeDefaults('callFunction'); call.id = 'gft_spine_' + trigger + '_call'; call.properties.graphId = handler.id;
      events.nodes.push(call); wire(events, event, call, 'exec');
    }
    if (scenario === 'title_loop_spine') {
      const event = ensureUiSpineEvent(project, events, 'gft_broken_spine', 'ui:main', 'failed');
      event.id = 'gft_broken_spine_failed_event';
      const handler = counter('gft_broken_spine_failed_handler', 'gft_broken_spine_failed');
      const call = blueprintNodeDefaults('callFunction'); call.id = 'gft_broken_spine_failed_call'; call.properties.graphId = handler.id;
      events.nodes.push(call); wire(events, event, call, 'exec');
    }
  }
  const sceneCounter = counter('gft_scene_enter', 'gft_story_entries');
  project.scenes[0].blueprintId = sceneCounter.id;

  const timeline = (id: string, shade: 'red' | 'green', duration: number, music = false) => {
    const g = createBlueprintGraph('effect', id); g.id = id; g.nodes[0].id = id + '_entry';
    const object: VisualObject = {
      kind: 'visual', instanceId: id + '_image', name: '全屏图片', content: 'image', assetId: 'gft_' + shade,
      text: '', color: '#ffffff', width: 1, height: 1, imageFit: 'stretch', layer: 10, fontSize: 32, duration, wait: false,
      keyframes: [{ x: .5, y: .5, scale: 1, rotation: 0, opacity: 1, duration: 0, easing: 'linear' }],
    };
    const image = performanceNode(project, object); image.id = id + '_visual';
    const tail = blueprintNodeDefaults('delay'); tail.id = id + '_tail'; tail.properties.seconds = duration;
    g.nodes.push(image, tail);
    g.timeline = { tracks: [{ id: id + '_track', name: '图片' }], clips: [{ nodeId: image.id, trackId: id + '_track' }], tailNodeId: tail.id };
    project.timelinePresets!.push(g);
    if (music) {
      // The author starts music once. Later page/video steps must preserve it.
      const audio = performanceNode(project, { kind: 'music', assetId: 'gft_opening_music', loop: true, fade: 0 });
      audio.id = id + '_music_node'; g.nodes.push(audio);
      wire(g, g.nodes[0], audio); wire(g, audio, image);
    } else wire(g, g.nodes[0], image);
    wire(g, image, tail);
    return g;
  };
  const authoredMusic = scenario === 'authored_opening_music' || scenario === 'no_title_music';
  const opening = timeline('gft_opening', 'red', 3, authoredMusic);
  const first = addGameFlowStep(project, 'beforeTitle', scenario === 'video_tail'
    ? { id: 'gft_intro', kind: 'video', assetId: 'gft_movie', allowSkip: false }
    : { id: 'gft_intro', kind: 'blueprint', graphId: opening.id, allowSkip: true });
  const introSource = flowStepNodeId(first.id);
  project.gameFlow!.transitions = {};
  const transitions = project.gameFlow!.transitions;
  if (scenario === 'image_none') transitions[introSource] = { mode: 'none' };
  else if (scenario !== 'image_default') transitions[introSource] = scenario === 'image_color' ? gameFlowTransitionSpecs.color : gameFlowTransitionSpecs.dissolve;
  if (menuVideo) transitions[introSource] = gameFlowTransitionSpecs.liveMenu;
  if (menuSpine) transitions[introSource] = gameFlowTransitionSpecs.liveMenuColor;
  project.gameFlow!.beforeTitle.repeat = scenario === 'image_color' ? 'title' : 'launch';

  let pageId: string | undefined;
  const cancelPage = scenario === 'page_cancel_continue' || scenario === 'page_cancel_title';
  if (scenario === 'page_logic_chain' || scenario === 'page_tail' || scenario === 'video_target' || authoredMusic || cancelPage) {
    pageId = 'gft_page';
    project.ui.customPages = [{ id: pageId, name: '真实自动完成页面', modal: true, background: '#20e060', components: [
      { id: 'gft_page_label', kind: 'text', page: 'custom', text: '页面步骤', x: .08, y: .07, width: .6, height: .15 },
    ] }];
    counter('gft_page_shown', 'gft_page_shows', pageId);
    const page = addGameFlowStep(project, 'beforeTitle', { id: 'gft_page_step', kind: 'page', pageId,
      completion: cancelPage ? 'close' : 'auto', duration: .65,
      ...(cancelPage ? { allowSkip: true, cancel: scenario === 'page_cancel_title' ? 'title' as const : 'continue' as const } : {}),
    });
    transitions[introSource] = gameFlowTransitionSpecs.page;
    if (scenario === 'page_logic_chain') {
      const logic = counter('gft_logic', 'gft_logic_count');
      const logicStep = addGameFlowStep(project, 'beforeTitle', { id: 'gft_logic_step', kind: 'blueprint', graphId: logic.id });
      const afterPage = timeline('gft_after_page', 'red', .6);
      const next = addGameFlowStep(project, 'beforeTitle', { id: 'gft_after_page_step', kind: 'blueprint', graphId: afterPage.id });
      transitions[flowStepNodeId(page.id)] = gameFlowTransitionSpecs.logic;
      transitions[flowStepNodeId(logicStep.id)] = { mode: 'none' };
      transitions[flowStepNodeId(next.id)] = gameFlowTransitionSpecs.dissolve;
    } else if (scenario === 'video_target' || authoredMusic) {
      // A transition longer than the whole 1.2-second video exposes playback
      // consumed during entry. This is the top-level Movie route, not a clip.
      const video = addGameFlowStep(project, 'beforeTitle', { id: 'gft_target_video', kind: 'video', assetId: 'gft_movie', allowSkip: false });
      transitions[flowStepNodeId(page.id)] = gameFlowTransitionSpecs.movieEntry;
      transitions[flowStepNodeId(video.id)] = gameFlowTransitionSpecs.dissolve;
    } else transitions[flowStepNodeId(page.id)] = gameFlowTransitionSpecs.dissolve;
  }

  const storyShade = scenario === 'image_none' ? 'green' : 'blue';
  project.entryId = 'gft_start_node';
  project.nodes = [
    { id: 'gft_start_node', kind: 'start', name: '故事入口', sceneId: 'gft_scene', x: 0, y: 0, next: 'gft_story' },
    { id: 'gft_story', kind: 'passage', name: '第一句', sceneId: 'gft_scene', x: 250, y: 0, next: 'gft_after', lines: [{ id: 'gft_story_line', text: '游戏入口过渡已进入剧情。', actions: [{ kind: 'background', assetId: 'gft_' + storyShade, transition: 'none' }] }] },
    { id: 'gft_after', kind: 'passage', name: '后一句', sceneId: 'gft_scene', x: 500, y: 0, next: 'gft_end', lines: [{ id: 'gft_after_line', text: '这是回退验证的第二句。', actions: [{ kind: 'background', assetId: 'gft_red', transition: 'none' }] }] },
    { id: 'gft_end', kind: 'end', name: '完成', sceneId: 'gft_scene', x: 750, y: 0 },
  ];
  if (scenario === 'image_dissolve') {
    const prelude = timeline('gft_prelude', 'green', .48);
    const step = addGameFlowStep(project, 'beforeNewGame', { id: 'gft_prelude_step', kind: 'blueprint', graphId: prelude.id });
    transitions[flowStepNodeId(step.id)] = gameFlowTransitionSpecs.story;
  }
  if (scenario === 'image_none') transitions[flowNodeIds.newGame] = gameFlowTransitionSpecs.story;
  if (scenario === 'title_preview') project.gameFlow!.beforeTitle.repeat = 'profile';
  const preview: PreviewOptions | undefined = scenario === 'title_preview' ? { flowStart: 'title', entryId: project.entryId } : undefined;
  if (scenario === 'pending_video_load' || scenario === 'pending_spine_load') {
    // The SDK's title is a non-rollback child context and cannot be restored by
    // save/load. Exercise the identical media gate on a real custom page in the
    // normal before-new-game context, with no injected task/owner/pending state.
    const video = scenario === 'pending_video_load';
    project.variables.push(...['gft_pending_shows', 'gft_pending_failed'].map(id => ({ id, name: id, type: 'number' as const, initial: 0, persistent: false })));
    if (video) project.assets.push({ id: 'gft_pending_movie', name: '存读档边界损坏视频', kind: 'video', category: 'video', path: 'assets/broken.webm' });
    else project.assets.push(...structuredClone(spineFixtureAssets));
    project.ui.customPages.push({ id: 'gft_pending_page', name: '转场内待派发事件存读档', modal: true, background: '#20e060', components: [
      { id: 'gft_pending_label', page: 'custom', kind: 'text', text: '真实页面 · 待派发事件存读档', x: .08, y: .07, width: .8, height: .15 },
      video
        ? { id: 'gft_pending_media', page: 'custom', kind: 'video', name: '真实坏视频', text: '', assetId: 'gft_pending_movie', posterId: 'gft_yellow', loop: true, x: .35, y: .3, width: .3, height: .24 }
        : { id: 'gft_pending_media', page: 'custom', kind: 'spine', name: '真实坏骨骼', text: '', assetId: 'rig_broken', spine: { animation: 'quick', loop: true, autoplay: true }, x: .35, y: .3, width: .3, height: .24 },
      { id: 'gft_pending_close', page: 'custom', kind: 'button', text: '关闭验收页面', action: 'return', x: .35, y: .74, width: .3, height: .11 },
    ] });
    counter('gft_pending_page_shown', 'gft_pending_shows', 'gft_pending_page');
    const events = graph('gft_pending_media_events', 'ui'); events.uiPageId = 'gft_pending_page';
    const event = video
      ? ensureUiVideoEvent(project, events, 'gft_pending_media', 'gft_pending_page', 'failed')
      : ensureUiSpineEvent(project, events, 'gft_pending_media', 'gft_pending_page', 'failed');
    event.id = 'gft_pending_failed_event';
    const handler = counter('gft_pending_failed_handler', 'gft_pending_failed');
    const call = blueprintNodeDefaults('callFunction'); call.id = 'gft_pending_failed_call'; call.properties.graphId = handler.id;
    events.nodes.push(call); wire(events, event, call, 'exec');
    const prelude = timeline('gft_pending_prelude', 'red', .48);
    const step = addGameFlowStep(project, 'beforeNewGame', { id: 'gft_pending_prelude_step', kind: 'blueprint', graphId: prelude.id });
    addGameFlowStep(project, 'beforeNewGame', { id: 'gft_pending_page_step', kind: 'page', pageId: 'gft_pending_page', completion: 'close', allowSkip: false });
    transitions[flowStepNodeId(step.id)] = video ? gameFlowTransitionSpecs.liveMenu : gameFlowTransitionSpecs.liveMenuColor;
  }
  synchronizeBlueprintSignatures(project);
  return { project, preview, introSource, pageId, storyShade };
}
