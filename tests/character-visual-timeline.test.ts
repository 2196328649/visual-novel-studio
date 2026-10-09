import { addProjectGraphs, projectGraphs } from '../src/core/project-resources';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema } from '../src/core/model';
import { blueprintFromPerformance, savedBlueprintAction } from '../src/core/blueprint-authoring';
import { createCharacterVisualObject, createVisualObject } from '../src/core/visual-object';
import { arrangePerformanceTimeline, insertTimelineAction, performanceTimeline } from '../src/core/performance-timeline';
import { interleaveProjectTimelines } from '../src/core/timeline-interleave';
import { timelineLayerPlans } from '../src/core/timeline-editing';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';

function characterProject() {
  const project = createProject('角色图片时间轴');
  project.assets.push({ id: 'hero_normal', name: '主角·普通', kind: 'image', path: 'hero.png', width: 1000, height: 1800 });
  project.characters.push({ id: 'hero', name: '主角', color: '#ffffff', expressions: [{ id: 'normal', name: '普通', assetId: 'hero_normal' }], defaultExpressionId: 'normal' });
  return project;
}

test('character library clips are ordinary visual image clips and survive save/reload', () => {
  const project = characterProject();
  const object = createCharacterVisualObject(project, 'hero');
  assert.equal(object.content, 'image');
  assert.equal(object.characterId, 'hero');
  assert.equal(object.expressionId, 'normal');
  assert.equal(object.assetId, 'hero_normal');
  assert.match(object.name, /主角/);
  assert.ok(object.width > 0 && object.height > 0);

  const graph = blueprintFromPerformance(project, [], '图片角色时间轴');
  graph.timelineComponent = true;
  addProjectGraphs(project, graph);
  const nodeId = insertTimelineAction(project, graph, object, 0);
  const node = graph.nodes.find(item => item.id === nodeId)!;
  assert.equal(savedBlueprintAction(node)?.kind, 'visual');
  const saved = projectSchema.parse(JSON.parse(JSON.stringify(project)));
  const savedGraph = projectGraphs(saved).find(item => item.id === graph.id)!;
  const savedNode = savedGraph.nodes.find(item => item.id === nodeId)!;
  const action = savedBlueprintAction(savedNode);
  assert.equal(action?.kind, 'visual');
  assert.equal(action?.content, 'image');
  assert.equal(action?.characterId, 'hero');
  assert.equal(action?.expressionId, 'normal');
  assert.equal(performanceTimeline(saved, savedGraph).reason, undefined);
  assert.equal(expandPreviewActions(saved, [{ kind: 'blueprint', blueprintId: savedGraph.id }], previewActionContext(saved)).some(item => item.kind === 'visual'), true);
});

test('track order assigns higher visual layers to tracks above lower tracks', () => {
  const project = characterProject();
  const background = createVisualObject('solid'); background.name = '背景';
  const foreground = createVisualObject('solid'); foreground.name = '前景';
  const graph = blueprintFromPerformance(project, [background, foreground], '轨道层级时间轴');
  graph.timelineComponent = true;
  addProjectGraphs(project, graph);
  const model = performanceTimeline(project, graph);
  const tracks = [
    { id: foreground.instanceId, name: '前景' },
    { id: background.instanceId, name: '背景' },
  ];
  arrangePerformanceTimeline(project, graph, model.clips.map((clip, index) => ({ ...clip, at: 0, trackId: tracks[index === 0 ? 1 : 0].id })), tracks);
  const plans = timelineLayerPlans(project);
  const [backgroundNode, foregroundNode] = graph.nodes.filter(node => node.type === 'savedAction');
  assert.ok((plans.get(graph.id)?.offsets.get(foregroundNode.id) ?? 0) > (plans.get(graph.id)?.offsets.get(backgroundNode.id) ?? 0));
  const expanded = interleaveProjectTimelines(project);
  const expandedGraph = projectGraphs(expanded).find(item => item.id === graph.id)!;
  assert.ok(Number(expandedGraph.nodes.find(node => node.id === foregroundNode.id)?.properties.__timelineLayerOffset) > Number(expandedGraph.nodes.find(node => node.id === backgroundNode.id)?.properties.__timelineLayerOffset));
});
