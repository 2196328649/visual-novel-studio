import { projectGraphs } from './project-resources';
import type { Project } from './model';
import { rawSavedBlueprintAction } from './blueprint-authoring';
import { visualInputFields } from './visual-object';

/** Add the original era lettering's slant once, preserving explicit author choices. */
export function upgradeChapterPresetTypography(project: Project): boolean {
  let changed = false;
  for (const owner of projectGraphs(project).filter(graph => graph.chapterVariant === 'text' && (graph.chapterPresetRevision ?? 1) < 3)) {
    const graphs = owner.timeline ? [owner] : owner.nodes.filter(node => node.type === 'callFunction').flatMap(node => projectGraphs(project).filter(graph => graph.id === node.properties.graphId));
    let matched = false;
    for (const graph of graphs) for (const node of graph.nodes) {
      const root = rawSavedBlueprintAction(node);
      if (root?.kind !== 'visual' || root.content !== 'group' || root.name !== '标题演出组合') continue;
      const objects = root.children?.find(child => child.content === 'group' && child.name === '整体淡入淡出')?.children;
      if (!objects || !['第一行小字', '第二行小字', '章节标题', '右侧字'].every(name => objects.some(object => object.content === 'text' && object.name === name))) continue;
      const era = objects.find(object => object.content === 'text' && object.name === '右侧字')!;
      let updated = false;
      for (const object of objects.filter(object => object === era || object.glyphParticles?.source === 'text' && object.name === '右侧字字形粒子')) {
        if (object.textItalic === undefined) { object.textItalic = era.textItalic ?? true; updated = true; }
      }
      if (updated) node.properties.action = JSON.stringify(root);
      // Add only the new inputs, keeping authored pin defaults and literal overrides.
      for (const field of visualInputFields(root).filter(field => field.path.at(-1) === 'textItalic')) {
        const id = 'object_' + field.key;
        if (!node.pins.some(pin => pin.id === id)) node.pins.push({ id, name: field.name, direction: 'input', dataType: 'boolean', defaultValue: field.value, required: false });
      }
      graph.chapterPresetRevision = 3;
      matched = true;
    }
    if (matched) { owner.chapterPresetRevision = 3; changed = true; }
  }
  return changed;
}
