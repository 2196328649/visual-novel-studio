import { projectGraphs } from './project-resources';
import { type Project, type BlueprintGraph, type VisualObject } from './model';
import { blueprintNodeDefaults, callablePins, connectBlueprintPins, synchronizeBlueprintSignatures } from './blueprint';
import { rawSavedBlueprintAction, exposePerformanceInputs, performanceInputs } from './blueprint-authoring';
import { createVisualObject, syncVisualPins, visualInputFields } from './visual-object';
import { visualInstancePath } from './visual-selection';

/** Add missing slots to generated compositions without rebuilding authored text or curves. */
export function upgradeChapterPresetSlots(project: Project): boolean {
  let changed = false;
  const fallback = projectGraphs(project).find(g => g.chapterVariant === 'image')?.exposedInputs.find(p => p.name === '章节背景')?.defaultValue;
  for (const owner of projectGraphs(project).filter(g => g.chapterVariant && (g.chapterPresetRevision ?? 1) < 2)) {
    const call = owner.nodes.find(n => n.type === 'callFunction');
    const graph = call && projectGraphs(project).find(g => g.id === call.properties.graphId);
    if (!graph || graph.exposedOutputs.length || owner.nodes.some(n => !['event', 'getInput', 'callFunction'].includes(n.type))) continue;
    const node = graph.nodes.find(n => rawSavedBlueprintAction(n)?.kind === 'visual');
    const root = node && rawSavedBlueprintAction(node);
    if (!node || root?.kind !== 'visual' || root.name !== '标题演出组合' || root.content !== 'group') continue;
    const presence = root.children?.find(c => c.name === '整体淡入淡出' && c.content === 'group');
    if (!presence) continue;
    let background = presence.children?.find(c => c.name === '章节背景');
    if (!background) {
      background = { ...createVisualObject('image', typeof fallback === 'string' ? fallback : project.ui.pages?.chapterTitle?.backgroundId), name: '章节背景', duration: root.duration, layer: 0, imageFit: 'cover' };
      background.keyframes[0].x += project.ui.chapterTransition?.backgroundOffsetX ?? 0;
      background.keyframes[0].y += project.ui.chapterTransition?.backgroundOffsetY ?? 0;
      if (root.curves?.opacity && project.ui.chapterTransition?.ripple !== false) background.ripple = { strength: project.ui.chapterTransition?.rippleStrength ?? .03, speed: (project.ui.chapterTransition?.rippleSpeed ?? .05) * 7 / root.duration };
      presence.children = [background, ...(presence.children ?? [])];
    }
    node.properties.action = JSON.stringify(root); syncVisualPins(node, root);
    const fields = visualInputFields(root), inputs = performanceInputs(graph);
    const soundNode = graph.nodes.find(n => n.type === 'playSound');
    if (soundNode && !graph.links.some(l => l.toNodeId === soundNode.id && l.toPinId === 'assetId')) {
      const previous = owner.exposedInputs.find(p => p.name === '章节音效');
      const pin = graph.exposedInputs.find(p => p.name === '章节音效') ?? { id: previous?.id ?? 'chapter_sound', name: '章节音效', dataType: 'asset' as const, direction: 'input' as const, required: false, defaultValue: '' };
      if (!graph.exposedInputs.includes(pin)) graph.exposedInputs.push(pin);
      let reader = graph.nodes.find(n => n.type === 'getInput' && n.properties.inputId === pin.id);
      if (!reader) { reader = blueprintNodeDefaults('getInput'); reader.properties.inputId = pin.id; reader.pins[0].dataType = 'asset'; graph.nodes.push(reader); }
      connectBlueprintPins(graph, reader.id, 'value', soundNode.id, 'assetId');
    }
    const add = (object: VisualObject, property: 'assetId' | 'maskAssetId', name: string) => {
      const indices = visualInstancePath(root, object.instanceId);
      const path = indices && [...indices.flatMap(i => ['children', i]), property];
      const target = fields.find(f => JSON.stringify(f.path) === JSON.stringify(path));
      const input = target && inputs.find(f => f.nodeId === node.id && f.pinId === 'object_' + target.key);
      if (!input || graph.links.some(l => l.toNodeId === node.id && l.toPinId === input.pinId)) return;
      exposePerformanceInputs(graph, [{ ...input, name }]);
    };
    add(background, 'assetId', '章节背景');
    for (const object of presence.children ?? []) {
      if (object.content !== 'image' || object === background || object.name === '章节标题') continue;
      add(object, 'assetId', object.name === '笔触遮罩层' ? '笔触叠图' : object.name);
      if (object.maskAssetId || object.name === '笔触遮罩层') add(object, 'maskAssetId', '笔触遮罩');
    }
    for (const pin of graph.exposedInputs) {
      if (!owner.exposedInputs.some(p => p.id === pin.id)) {
        owner.exposedInputs.push(structuredClone(pin));
        const read = blueprintNodeDefaults('getInput'); read.name = '输入 · ' + pin.name; read.properties.inputId = pin.id; read.pins[0].dataType = pin.dataType;
        read.x = 40; read.y = 230 + (owner.exposedInputs.length - 1) * 140;
        owner.nodes.push(read); call!.pins = callablePins(graph);
        connectBlueprintPins(owner, read.id, 'value', call!.id, 'arg_' + pin.id);
      }
      if (!owner.links.some(l => l.toNodeId === call!.id && l.toPinId === 'arg_' + pin.id)) {
        const read = owner.nodes.find(n => n.type === 'getInput' && n.properties.inputId === pin.id);
        if (read) { call!.pins = callablePins(graph); connectBlueprintPins(owner, read.id, 'value', call!.id, 'arg_' + pin.id); }
      }
    }
    for (const g of [owner, graph]) {
      for (const pin of g.exposedInputs) if (pin.name === '章节音效') pin.defaultValue = '';
      g.chapterPresetRevision = 2;
    }
    changed = true;
  }
  if (changed) synchronizeBlueprintSignatures(project);
  return changed;
}
