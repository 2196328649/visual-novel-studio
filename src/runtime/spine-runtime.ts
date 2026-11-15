import { declaredUiComponents, type Project } from '../core/model';
import { projectGraphs } from '../core/project-resources';
import { uiEventInActiveInstance, uiGraphOnPage } from '../core/ui-logic';
import { pythonLiteral } from './literals';

export function createSpineRuntime(project: Project): string {
  const components = declaredUiComponents(project).filter(component => component.kind === 'spine');
  const assets = project.assets.filter(asset => asset.kind === 'spine');
  const definitions = Object.fromEntries(components.map(component => {
    const pageId = component.page === 'custom' ? project.ui.customPages.find(page => page.components.some(c => c.id === component.id))!.id : 'ui:' + component.page;
    const handlers = Object.fromEntries(['completed', 'failed'].map(trigger => [trigger, projectGraphs(project).flatMap(graph => uiGraphOnPage(project, graph, pageId) ? graph.nodes.filter(node => node.type === 'eventSpine' && node.properties.componentId === component.id && node.properties.trigger === trigger && uiEventInActiveInstance(project, node)).map(node => [graph.id, node.id]) : [])]));
    return [component.id, { ...component, pageId, handlers }];
  }));
  return `init python:
    vn_spine_assets = ${pythonLiteral(Object.fromEntries(assets.map(asset => [asset.id, asset])))}
    vn_spine_components = ${pythonLiteral(definitions)}
    ${components.length ? 'import vns_spine\n    vns_spine.install()\n    config.after_load_callbacks.insert(0, vns_spine.clear)' : '# No native library is loaded without a Spine component.'}

    def vn_ui_spine_poll():
        if vn_spine_components: vns_spine.poll()

    def vn_ui_spine_has_live():
        return bool(vn_spine_components) and vns_spine.has_live()

    def vn_ui_spine_release(component_id):
        if component_id in vn_spine_components: vns_spine.release(component_id)

    def vn_ui_spine_reset(component_id):
        if component_id in vn_spine_components: vns_spine.reset(component_id)

    def vn_ui_spine_sync(component_id):
        if component_id in vn_spine_components: vns_spine.sync(component_id)

    def vn_ui_spine_validate_change(component_id, property, value):
        if component_id in vn_spine_components: vns_spine.validate_change(component_id, property, value)

default vn_spine_states = {}
default vn_spine_recovery = {}
`;
}
