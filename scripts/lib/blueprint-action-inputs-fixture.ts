import { createProject } from '../../src/core/model';
import { blueprintFromPerformance, exposePerformanceInputs, performanceInputs } from '../../src/core/blueprint-authoring';
import { createVisualObject } from '../../src/core/visual-object';
import { createAudioClip } from '../../src/core/audio-clip';
import { arrangePerformanceTimeline, performanceTimeline } from '../../src/core/performance-timeline';
import { synchronizeBlueprintSignatures } from '../../src/core/blueprint';

export function blueprintActionInputsFixture() {
  const project = createProject('蓝图源演出参数验收');
  for (const id of ['red', 'blue', 'green']) project.assets.push({ id, name: id, kind: 'image', path: id + '.png' });
  for (const id of ['source_audio', 'bound_audio']) project.assets.push({ id, name: id, kind: 'audio', path: id + '.wav' });
  const visual = { ...createVisualObject('image', 'red'), instanceId: 'bound_picture', name: '源图片', width: .4, height: .4, duration: 3, retimeOnDuration: true,
    curves: { x: [{ at: 0, value: .2, easing: 'linear' as const }, { at: 3, value: .8, easing: 'linear' as const }] } };
  const audio = { ...createAudioClip('source_audio', '源声音', 10), duration: 3, offset: 1 };
  const graph = blueprintFromPerformance(project, [visual, audio], '输入覆盖时间轴'); project.blueprints.push(graph);
  const picture = graph.nodes[1], sound = graph.nodes[2];
  Object.assign(picture.properties, { object_duration: 6, object_assetId: 'green' });
  Object.assign(sound.properties, { clip_duration: 4, clip_offset: 2, clip_volume: .3 });
  for (const [nodeId, pinId, name, defaultValue] of [[picture.id, 'object_assetId', '替换图片', 'blue'], [sound.id, 'clip_assetId', '替换音频', 'bound_audio']]) {
    exposePerformanceInputs(graph, [{ ...performanceInputs(graph).find(p => p.nodeId === nodeId && p.pinId === pinId)!, name, defaultValue }]);
  }
  synchronizeBlueprintSignatures(project);
  const model = performanceTimeline(project, graph); arrangePerformanceTimeline(project, graph, model.clips, model.tracks);
  return { project, graph, pictureId: picture.id, soundId: sound.id };
}
