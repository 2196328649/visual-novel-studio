import { projectGraphs, withProjectGraphs, setProjectGraphs } from './project-resources';
import type { BlueprintGraph, Project, StageAction, VariableValue } from './model';
import { expandPreviewActions, previewActionContext } from './preview-actions';
import { actionText, textCommandAction } from './text-script';
import { renameBlueprint } from './blueprint-names';

/** Consolidate generated per-chapter image wrappers only when their animation is identical.
 * Different backgrounds/title art become call arguments; custom graphs stay independent. */
export function consolidateChapterPresets(project: Project): boolean {
  const images = projectGraphs(project).filter(g => g.chapterVariant === 'image' && /^章节进入演出(?: \d+|图片版)?$/.test(g.name));
  const primary = images.find(g => g.name === '章节进入演出图片版') ?? images[0];
  if (!primary) return false;
  const signature = (g: BlueprintGraph) => {
    const inputs = Object.fromEntries(g.exposedInputs.map(p => [p.id, p.dataType === 'asset' ? '' : primary.exposedInputs.find(q => q.name === p.name)?.defaultValue ?? p.defaultValue ?? '']));
    const context = previewActionContext(project), actions = expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: g.id, inputs }], context);
    return context.incomplete ? undefined : JSON.stringify(actions, function (key, value) { return key === 'instanceId' || key === 'text' && this.content === 'image' ? undefined : value; });
  };
  const base = images.length > 1 ? signature(primary) : undefined;
  const hasHook = (value: unknown, id: string): boolean => {
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    // Action calls below can carry translated arguments; UI, character and
    // minigame hooks cannot, so their preset defaults must remain independent.
    if (record.blueprintId === id && record.kind !== 'blueprint' || record.onShowBlueprintId === id) return true;
    return Object.values(record).some(child => hasHook(child, id));
  };
  const hasReference = (value: unknown, id: string): boolean => value === id || !!value && typeof value === 'object' && Object.values(value).some(child => hasReference(child, id));
  const graphReferences = (graph: BlueprintGraph, id: string) => graph.nodes.some(node => {
    if (hasReference(node.properties, id)) return true;
    if (node.type === 'savedAction' && typeof node.properties.action === 'string') {
      try { return hasReference(JSON.parse(node.properties.action), id); } catch { return false; }
    }
    return false;
  });
  let changed = false;
  for (const duplicate of images.filter(g => g !== primary)) {
    const candidate = signature(duplicate);
    const withoutRootLayer = (text: string) => JSON.stringify(JSON.parse(text).map((a: StageAction) => a.kind === 'visual' && a.name === '标题演出组合' ? { ...a, layer: 0 } : a));
    const outside = JSON.stringify(withProjectGraphs({ ...project }, projectGraphs(project).filter(g => g !== duplicate)));
    const calledByName = project.scriptText?.content.split('\n').some(row => { try { const a = textCommandAction(project, row); return a?.kind === 'blueprint' && a.blueprintId === duplicate.id; } catch { return false; } });
    if (!base || !candidate || candidate !== base && (outside.includes(JSON.stringify(duplicate.id)) || calledByName || withoutRootLayer(candidate) !== withoutRootLayer(base))) continue;
    // A logic call or scene hook may bind dynamic inputs. Leave those authored wrappers intact.
    if (duplicate.exposedOutputs.length || duplicate.nodes.some(n => !['event', 'getInput', 'callFunction'].includes(n.type))) continue;
    if (projectGraphs(project).some(g => g !== duplicate && graphReferences(g, duplicate.id)) || hasHook(withProjectGraphs({ ...project }, []), duplicate.id)) continue;
    const replace = (action: Extract<StageAction, { kind: 'blueprint' }>) => {
      const inputs: Record<string, VariableValue> = {};
      for (const pin of duplicate.exposedInputs) {
        const target = primary.exposedInputs.find(p => p.name === pin.name);
        if (!target) continue;
        const value = action.inputs?.[pin.id] ?? pin.defaultValue;
        if (value !== undefined && value !== target.defaultValue) inputs[target.id] = value;
      }
      return { ...action, blueprintId: primary.id, inputs: Object.keys(inputs).length ? inputs : undefined };
    };
    const rewrite = (source: string) => source.split('\n').map(row => {
      if (!/^\s*[@／/]/.test(row)) return row;
      try { const action = textCommandAction(project, row); return action?.kind === 'blueprint' && action.blueprintId === duplicate.id ? (row.match(/^\s*/)?.[0] ?? '') + actionText(project, replace(action)) : row; } catch { return row; }
    }).join('\n');
    if (project.scriptText) project.scriptText.content = rewrite(project.scriptText.content);
    const visit = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      const record = value as Record<string, unknown>;
      if (record.kind === 'blueprint' && record.blueprintId === duplicate.id) Object.assign(record, replace(record as Extract<StageAction, { kind: 'blueprint' }>));
      for (const child of Object.values(record)) visit(child);
    };
    [project.nodes, project.scenes, project.effects, project.characters].forEach(visit);
    project.effects.forEach(effect => { effect.commands = effect.commands.map(rewrite); });
    for (const graph of projectGraphs(project)) for (const node of graph.nodes) if (node.type === 'sceneAction' && typeof node.properties.command === 'string') node.properties.command = rewrite(node.properties.command);
    const childIds = duplicate.nodes.filter(n => n.type === 'callFunction').map(n => String(n.properties.graphId));
    setProjectGraphs(project, projectGraphs(project).filter(g => g !== duplicate));
    for (const id of childIds) {
      const rest = JSON.stringify(withProjectGraphs({ ...project }, projectGraphs(project).filter(g => g.id !== id)));
      if (!rest.includes(id)) setProjectGraphs(project, projectGraphs(project).filter(g => g.id !== id));
    }
    changed = true;
  }
  if (primary.name === '章节进入演出' && !projectGraphs(project).some(g => g !== primary && (g.name === '章节进入演出图片版' || g.callName === '章节进入演出图片版'))) {
    renameBlueprint(project, primary.id, { name: '章节进入演出图片版', callName: '章节进入演出' });
    for (const call of primary.nodes.filter(n => n.type === 'callFunction')) {
      const child = projectGraphs(project).find(g => g.id === call.properties.graphId);
      if (child?.name === '章节进入演出 · 时间轴') child.name = call.name = '章节进入演出图片版 · 时间轴';
    }
    changed = true;
  }
  return changed;
}
