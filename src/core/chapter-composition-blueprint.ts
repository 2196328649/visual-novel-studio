import { availableBlueprintName } from './blueprint-names';
import { textEffectInputs } from './ui-text-effects';
import type { Project } from './model';
import { chapterComposition } from './chapter-composition';
import { blueprintFromPerformance, exposePerformanceInputs, performanceInputs, rawSavedBlueprintAction } from './blueprint-authoring';
import { connectBlueprintPins } from './blueprint';
import { visualInstancePath } from './visual-selection';
import { visualInputFields } from './visual-object';
import { arrangePerformanceTimeline, performanceTimeline } from './performance-timeline';

/** Title and emission sources share call parameters; subtitle content remains independent. */
export function chapterCompositionBlueprint(project: Project, chapter: Parameters<typeof chapterComposition>[1], textLayout?: Parameters<typeof chapterComposition>[2], options: Parameters<typeof chapterComposition>[3] = {}) {
  const result = chapterComposition(project, chapter, textLayout, options);
  const graph = blueprintFromPerformance(project, result.actions, availableBlueprintName(project, '标题演出'));
  const timeline = performanceTimeline(project, graph);
  arrangePerformanceTimeline(project, graph, timeline.clips, timeline.tracks);
  const allInputs = performanceInputs(graph);
  const inputs = allInputs.filter(field => {
    const action = rawSavedBlueprintAction(graph.nodes.find(node => node.id === field.nodeId)!);
    const leaf = action?.kind === 'visual' ? visualInputFields(action).find(item => 'object_' + item.key === field.pinId)?.path.at(-1) : undefined;
    return leaf !== 'color' && leaf !== 'maskAssetId' && (field.pinId === 'object_duration' || field.dataType === 'string' || field.dataType === 'asset');
  });
  const chapterInputs: Record<string,string> = {};
  const semanticFields: Record<string,string> = { '章节标题':'title', '章节副标题':'subtitle', '第一行小字':'firstLine', '第二行小字':'secondLine', '右侧字':'rightText', '章节题图':'titleImageId', '章节背景':'backgroundId' };
  const textNames = { title: '章节标题', subtitle: '章节副标题', firstLine: '第一行小字', secondLine: '第二行小字', rightText: '右侧字' };
  const bindingGroups = [
    ...result.imageLayerBindings.map(binding => ({ name: binding.name, bindings: [{ instanceId: binding.instanceId, tail: [binding.property] }] })),
    { name: '章节背景', bindings: result.backgroundInstanceId ? [{instanceId:result.backgroundInstanceId,tail:['assetId']}] : [] },
    { name: '章节题图', bindings: result.titleImageBindings.map(binding => ({ instanceId: binding.instanceId, tail: binding.property === 'assetId' ? ['assetId'] : ['glyphParticles', 'assetId'] })) },
    ...(['title', 'subtitle', 'firstLine', 'secondLine', 'rightText'] as const).map(input => ({ name: textNames[input], bindings: result.titleTextBindings.filter(binding => binding.input === input).map(binding => ({ instanceId: binding.instanceId, tail: ['text'] })) })),
  ];
  result.imageLayerBindings.forEach(binding => { semanticFields[binding.name] = binding.key; });
  const styleNames = new Map<string, number>();
  for (const styleId of new Set(options.titleMode ? [] : result.titleTextBindings.map(binding => binding.styleId))) {
    const bindings = result.titleTextBindings.filter(binding => binding.styleId === styleId);
    const name = textNames[bindings[0].input];
    const number = (styleNames.get(name) ?? 0) + 1; styleNames.set(name, number);
    for (const property of ['fontSize', 'fontAssetId', 'textAlign', 'textVerticalAlign', 'textItalic'] as const) {
      // Expose the new style where it is authored; large custom UI conversions
      // keep their existing interfaces within the blueprint input limit.
      if (property === 'textItalic' && !(options.fourPartText && bindings[0].input === 'rightText')) continue;
      bindingGroups.push({ name: name + (number > 1 ? ` ${number}` : '') + ({ fontSize: '字号', fontAssetId: '字体', textAlign: '水平对齐', textVerticalAlign: '垂直对齐', textItalic: '斜体' }[property]), bindings: bindings.map(binding => ({ instanceId: binding.instanceId, tail: [property] })) });
    }
    for (const [property, field] of Object.entries(textEffectInputs)) bindingGroups.push({ name: name + (number > 1 ? ` ${number}` : '') + field.name, bindings: bindings.map(binding => ({ instanceId: binding.instanceId, tail: ['textEffects', property] })) });
  }
  const bound = new Set<string>();
  for (const group of bindingGroups) {
    const titleTargets = graph.nodes.flatMap(node => {
      const root = rawSavedBlueprintAction(node); if (root?.kind !== 'visual') return [];
      const fields = visualInputFields(root);
      return group.bindings.flatMap(binding => {
        const path = visualInstancePath(root, binding.instanceId); if (!path) return [];
        const fieldPath = [...path.flatMap(index => ['children', index]), ...binding.tail];
        const field = fields.find(field => JSON.stringify(field.path) === JSON.stringify(fieldPath));
        const input = allInputs.find(input => input.nodeId === node.id && input.pinId === 'object_' + field?.key);
        return input ? [input] : [];
      });
    });
    if (titleTargets.length) {
      exposePerformanceInputs(graph, [{ ...titleTargets[0], name: group.name }]);
      const exposed = graph.exposedInputs.find(input => input.name === group.name)!;
      if (semanticFields[group.name]) chapterInputs[semanticFields[group.name]] = exposed.id;
      const reader = graph.nodes.find(node => node.type === 'getInput' && node.properties.inputId === exposed.id)!;
      for (const target of titleTargets.slice(1)) {
        const error = connectBlueprintPins(graph, reader.id, 'value', target.nodeId, target.pinId);
        if (error) throw new Error(error);
      }
    }
    titleTargets.forEach(target => bound.add(target.nodeId + ':' + target.pinId));
  }
  const remaining = inputs.filter(input => !bound.has(input.nodeId + ':' + input.pinId) && (!options.titleMode || input.pinId === 'object_duration' || input.pinId === 'assetId'));
  const names = new Set(graph.exposedInputs.map(pin => pin.name));
  const firstRemaining = graph.exposedInputs.length;
  exposePerformanceInputs(graph, remaining.map(input => {
    let name = input.name, index = 2; while (names.has(name)) name = input.name + ' ' + index++;
    names.add(name); return { ...input, name };
  }));
  remaining.forEach((input,index) => { if(input.pinId === 'object_duration') chapterInputs.duration = graph.exposedInputs[firstRemaining+index].id; if(input.pinId === 'assetId' && graph.nodes.find(node => node.id === input.nodeId)?.type === 'playSound') chapterInputs.soundId = graph.exposedInputs[firstRemaining+index].id; });
  return { graph, warnings: result.warnings, chapterInputs };
}
