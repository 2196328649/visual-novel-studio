import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { createProject, projectSchema, type Project } from '../../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph } from '../../src/core/blueprint';
import { performanceNode } from '../../src/core/blueprint-authoring';
import { createTimelinePreset } from '../../src/core/timeline-component';
import { createVisualObject } from '../../src/core/visual-object';
import { flowNodeIds, flowStepNodeId } from '../../src/core/game-flow-graph';

export const gameFlowEditorIds = {
  opening: 'gft_opening', spare: 'gft_spare', timeline: 'gft_opening_timeline', blueprint: 'gft_spare_graph',
  page: 'gft_page', image: 'gft_opening_image', video: 'gft_video',
  scene: 'gft_story_scene', passage: 'gft_story_a', branch: 'gft_story_branch',
} as const;

/** The opening uses the author's real resource shape: a saved visual action in
 * timelinePresets, followed by its tail delay, then a lifecycle next outlet. */
export function gameFlowTransitionsEditorFixture(): Project {
  const ids = gameFlowEditorIds, project = createProject('启动与主菜单连线过渡验收');
  project.id = 'game_flow_transition_editor';
  project.resourceSettings = { importMode: 'copy', directory: 'assets', syncFolders: false };
  project.chapters = [{ id: 'gft_story_chapter', name: '保留原剧情' }];
  project.scenes = [{ id: ids.scene, chapterId: 'gft_story_chapter', name: '原剧情小章节' }];
  project.variables = [{ id: 'gft_story_flag', name: '原剧情分支', type: 'boolean', initial: true, persistent: false }];
  const base = (id: string, name: string, x: number, y: number) => ({ id, name, sceneId: ids.scene, x, y });
  project.entryId = 'gft_story_start';
  project.nodes = [
    { ...base(project.entryId, '故事入口', 40, 200), kind: 'start', next: ids.passage },
    { ...base(ids.passage, '保留原台词与演出', 380, 200), kind: 'passage', next: ids.branch,
      lines: [{ id: 'gft_story_line', text: '开场过渡不改变这句原台词。', actions: [{ kind: 'pause', seconds: .1 }] }],
      transitions: { next: { mode: 'dissolve', duration: .42 } } },
    { ...base(ids.branch, '原有条件分支', 720, 200), kind: 'condition',
      condition: { kind: 'compare', variableId: 'gft_story_flag', operator: 'eq', value: true }, yes: 'gft_story_b', no: 'gft_story_end',
      transitions: { yes: { mode: 'color', color: '#436789', outDuration: .2, hold: .1, inDuration: .3 }, no: { mode: 'none' } } },
    { ...base('gft_story_b', '原剧情后续', 1060, 0), kind: 'passage', next: 'gft_story_end',
      lines: [{ id: 'gft_story_line_b', text: '原剧情参数和出口保持独立。', actions: [] }] },
    { ...base('gft_story_end', '返回标题', 1400, 200), kind: 'end' },
  ];
  project.assets = [
    { id: ids.image, name: '开场画面', kind: 'image', category: 'scene', path: 'assets/opening.png', width: 160, height: 90 },
    { id: ids.video, name: '可插入的短视频', kind: 'video', category: 'video', path: 'assets/intro.webm', width: 160, height: 90 },
  ];
  const timeline = createTimelinePreset(project, '开场动画'); timeline.id = ids.timeline; timeline.nodes[0].id = 'gft_opening_event';
  const image = { ...createVisualObject('image', ids.image), instanceId: 'gft_opening_object', name: '开场画面', duration: 3, wait: false };
  const visual = performanceNode(project, image); visual.id = 'gft_opening_visual'; visual.name = '开场画面';
  const tail = blueprintNodeDefaults('delay'); tail.id = 'gft_opening_tail'; tail.name = '等待全部轨道结束'; tail.properties.seconds = 3;
  timeline.nodes.push(visual, tail);
  for (const [from, output, to] of [[timeline.nodes[0].id, 'exec', visual.id], [visual.id, 'exec_out', tail.id]]) {
    const error = connectBlueprintPins(timeline, from, output, to, 'exec_in'); if (error) throw new Error(error);
  }
  timeline.timeline = { tracks: [{ id: 'gft_opening_track', name: '开场画面' }], clips: [{ nodeId: visual.id, trackId: 'gft_opening_track' }], tailNodeId: tail.id };
  project.timelinePresets = [timeline];
  const spare = createBlueprintGraph('function', '备用动画调用'); spare.id = ids.blueprint; spare.nodes[0].id = 'gft_spare_event';
  const delay = blueprintNodeDefaults('delay'); delay.id = 'gft_spare_delay'; delay.properties.seconds = .1; spare.nodes.push(delay);
  const error = connectBlueprintPins(spare, spare.nodes[0].id, 'exec', delay.id, 'exec_in'); if (error) throw new Error(error);
  project.blueprints = [spare];
  project.ui.pages = { main: { layout: 'custom', background: '#182c40' } };
  project.ui.components = [
    { id: 'gft_title_start', page: 'main', kind: 'button', text: '开始游戏', action: 'start', x: .35, y: .25, width: .3, height: .1 },
    { id: 'gft_title_load', page: 'main', kind: 'button', text: '读取存档', action: 'load', x: .35, y: .4, width: .3, height: .1 },
    { id: 'gft_title_settings', page: 'main', kind: 'button', text: '设置', action: 'preferences', x: .35, y: .55, width: .3, height: .1 },
  ];
  project.ui.customPages = [{ id: ids.page, name: '可插入的说明页', modal: true, background: '#325e58', components: [
    { id: 'gft_page_text', page: 'custom', kind: 'text', text: '说明页', x: .2, y: .25, width: .6, height: .15 },
    { id: 'gft_page_close', page: 'custom', kind: 'button', text: '完成说明', action: 'return', x: .35, y: .65, width: .3, height: .1 },
  ] }];
  const openingId = flowStepNodeId(ids.opening), spareId = flowStepNodeId(ids.spare);
  project.gameFlow = {
    schemaVersion: 1, beforeTitle: { repeat: 'launch', revision: '1', steps: [
      { id: ids.opening, name: '开场动画', kind: 'blueprint', graphId: ids.timeline, inputs: {}, allowSkip: false },
      { id: ids.spare, name: '备用流程模块', kind: 'blueprint', graphId: ids.blueprint, inputs: {}, allowSkip: false },
    ] }, beforeNewGame: [],
    connections: { [flowNodeIds.launch]: openingId, [openingId]: flowNodeIds.title, [flowNodeIds.newGame]: flowNodeIds.story },
    positions: {
      [flowNodeIds.launch]: { x: 40, y: 120 }, [openingId]: { x: 380, y: 120 }, [flowNodeIds.title]: { x: 720, y: 120 },
      [flowNodeIds.newGame]: { x: 1100, y: 120 }, [flowNodeIds.load]: { x: 1100, y: 380 }, [flowNodeIds.story]: { x: 1460, y: 120 },
      [spareId]: { x: 380, y: 470 },
    },
  };
  return projectSchema.parse(project);
}

/** Materialize only this run's isolated resources, during unified acceptance. */
export async function writeGameFlowEditorAssets(directory: string) {
  const assets = path.join(directory, 'assets'); await fs.mkdir(assets, { recursive: true });
  const png = new PNG({ width: 160, height: 90 });
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    const offset = (y * png.width + x) * 4;
    const color = x < 80 ? [179, 63, 82] : [230, 175, 92];
    png.data[offset] = color[0]; png.data[offset + 1] = color[1]; png.data[offset + 2] = color[2]; png.data[offset + 3] = 255;
  }
  await fs.writeFile(path.join(assets, 'opening.png'), PNG.sync.write(png));
  execFileSync(process.env.VNS_FFMPEG ?? 'ffmpeg', ['-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x536894:s=160x90:r=12:d=0.5',
    '-c:v', 'libvpx', '-pix_fmt', 'yuv420p', '-an', path.join(assets, 'intro.webm')], { windowsHide: true, timeout: 30000 });
}
