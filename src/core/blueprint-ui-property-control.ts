import { blueprintInputValue } from './blueprint';
import { blueprintUiPropertyDefinition } from './blueprint-ui-property-batch';
import { effectiveUiComponents, type BlueprintGraph, type BlueprintNode, type Project, type UiComponent, type UiPropertyControl } from './model';
import { uiClipComponents } from './ui-animation-clips';
import { uiProperties, type UiProperty } from './ui-properties';
import { uiPropertyControlFor, uiPropertyControlSourceProblem } from './ui-property-control';

export interface BlueprintUiPropertyControl {
  component: UiComponent;
  property: UiProperty;
  control: UiPropertyControl;
  parameterName: string;
  problem?: string;
}

/** Cache only for this analysis/render, so mutable authoring drafts cannot leave stale policies. */
export function createBlueprintUiPropertyControlAnalysis(project: Project) {
  const schemes = new Map<string, Map<string, UiComponent>>();
  let custom: Map<string, { pageId: string; component: UiComponent }> | undefined;
  const targets = new Map<BlueprintGraph, Map<BlueprintNode, UiComponent[]>>();
  const linked = (graph: BlueprintGraph, node: BlueprintNode) => graph.links.some(link => link.toNodeId === node.id && link.toPinId === 'componentId');
  const scheme = (id: string) => {
    let components = schemes.get(id);
    if (!components) {
      components = new Map<string, UiComponent>(id !== 'base' && !project.ui.instances?.some(instance => instance.id === id) ? [] : effectiveUiComponents({ ...project.ui, activeInstanceId: id === 'base' ? undefined : id }).map(component => [component.id, component]));
      schemes.set(id, components);
    }
    return components;
  };
  const candidates = (graph: BlueprintGraph, node: BlueprintNode): UiComponent[] => {
    let cached = targets.get(graph);
    if (!cached) { cached = new Map(); targets.set(graph, cached); }
    if (cached.has(node)) return cached.get(node)!;
    const id = blueprintInputValue(node, 'componentId'), pageId = graph.uiPageId;
    let result: UiComponent[] = [];
    if (!linked(graph, node) && typeof id === 'string' && id) {
      custom ??= new Map(project.ui.customPages.flatMap(page => page.components.map(component => [component.id, { pageId: page.id, component }] as const)));
      const page = custom.get(id);
      if (page && (!pageId || pageId === page.pageId)) result = [page.component];
      else if (!pageId || pageId.startsWith('ui:')) {
        // Unscoped reusable graphs can run in any scheme. Only a policy shared
        // by every possible definition is certain; the editor's active scheme is not evidence.
        const ids = graph.uiInstanceId ? [graph.uiInstanceId] : ['base', ...(project.ui.instances ?? []).map(instance => instance.id)];
        result = [...new Set(ids.flatMap(instanceId => {
          const component = scheme(instanceId).get(id);
          return component && (!pageId || 'ui:' + component.page === pageId) ? [component] : [];
        }))];
      }
    }
    cached.set(node, result);
    return result;
  };
  const fromComponents = (components: UiComponent[], property: string): BlueprintUiPropertyControl | undefined => {
    if (!components.length || !Object.hasOwn(uiProperties, property)) return;
    const resolved = components.map(component => {
      const result = uiPropertyControlFor(project, component, property as UiProperty);
      return result && { ...result, component, parameterName: project.variables.find(parameter => parameter.id === result.control.parameterId)?.name ?? result.control.parameterId,
        problem: uiPropertyControlSourceProblem(project, component, property, result.control) };
    });
    const first = resolved[0];
    if (first && resolved.every(current => current && current.property === first.property && current.control.mode === first.control.mode && current.control.parameterId === first.control.parameterId && current.problem === first.problem)) return first;
  };
  const property = (graph: BlueprintGraph, node: BlueprintNode, name = String(node.properties.property ?? '')) => fromComponents(candidates(graph, node), name);
  const writes = (graph: BlueprintGraph, node: BlueprintNode): BlueprintUiPropertyControl[] => {
    if (node.type === 'playUiAnimation') {
      const clip = project.ui.animations?.find(item => item.id === node.properties.animationId);
      if (!clip || clip.pageId.startsWith('ui:') && clip.uiInstanceId && clip.uiInstanceId !== 'base' && !project.ui.instances?.some(instance => instance.id === clip.uiInstanceId)) return [];
      const components = new Map(uiClipComponents(project, clip).map(component => [component.id, component]));
      return clip.tracks.flatMap(track => {
        const component = components.get(track.componentId), found = component && fromComponents([component], track.property);
        return found ? [found] : [];
      });
    }
    const properties = node.type === 'setUiControlRange' ? ['minimum', 'maximum', 'step']
      : node.type === 'setSpineSpeed' ? ['spineSpeed'] : node.type === 'playSpine' ? ['spineLoop']
      : node.type === 'setUiProperty' ? (blueprintUiPropertyDefinition(node).rows ?? []).map(row => row.property)
      : node.type === 'animateUiProperty' ? [String(node.properties.property ?? '')] : [];
    return properties.flatMap(name => { const found = property(graph, node, name); return found ? [found] : []; });
  };
  return {
    property, writes,
    component: (graph: BlueprintGraph, node: BlueprintNode) => { const all = candidates(graph, node); return all.length === 1 ? all[0] : undefined; },
    contextDependent: (graph: BlueprintGraph, node: BlueprintNode) => linked(graph, node) || candidates(graph, node).length > 1,
    mayUsePropertySource: (graph: BlueprintGraph, node: BlueprintNode, name = String(node.properties.property ?? '')) => linked(graph, node) || Object.hasOwn(uiProperties, name) && candidates(graph, node).some(component => !!uiPropertyControlFor(project, component, name as UiProperty)),
  };
}

export type BlueprintUiPropertyControlAnalysis = ReturnType<typeof createBlueprintUiPropertyControlAnalysis>;

export function blueprintUiPropertyControlTargets(controls: readonly BlueprintUiPropertyControl[]): string {
  const descriptions = [...new Set(controls.map(item => `“${item.component.name || item.component.text || item.component.id} / ${uiProperties[item.property].name}”（参数“${item.parameterName}”）`))];
  return descriptions.slice(0, 3).join('、') + (descriptions.length > 3 ? `等 ${descriptions.length} 项` : '');
}

/** These conflicts explain a retained graph, and must never make old graphs fail to compile. */
export function blueprintUiPropertyWriteWarning(analysis: BlueprintUiPropertyControlAnalysis, graph: BlueprintGraph, node: BlueprintNode): string | undefined {
  const following = analysis.writes(graph, node).filter(item => item.control.mode === 'follow' && !item.problem);
  if (!following.length) return;
  const consequence = node.type === 'playUiAnimation' ? '这段动画不会启动。请调整对应轨道，或将属性改为双向同步/默认设置。'
    : node.type === 'setUiProperty' && !blueprintUiPropertyDefinition(node).legacy ? '这个节点的整组属性都不会修改。请先调整受限属性的控制方式，或从本节点移除这一项。'
    : node.type === 'setUiControlRange' ? '这次范围设置不会写入任何一项。请先调整受限属性的控制方式。'
    : node.type === 'playSpine' ? '播放仍会执行，循环输入会被忽略，沿用来源参数的循环值。'
    : node.type === 'animateUiProperty' ? '这项属性动画不会启动；其他属性和控件事件仍可运行。'
    : '这次赋值不会改写这一项；其他属性和控件事件仍可运行。';
  return blueprintUiPropertyControlTargets(following) + '已设为单向跟随参数。' + consequence;
}
