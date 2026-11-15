import { createProject, type UiComponent } from '../../src/core/model';
import { blueprintNodeDefaults, createBlueprintGraph, synchronizeBlueprintSignatures } from '../../src/core/blueprint';

export function createUiResourceMigrationFixture() {
  const project = createProject('资源改名与界面草稿迁移'); project.id = 'ui_resource_migration';
  project.assets.push({ id: 'resource_used', name: '在用图片', kind: 'image', path: 'assets/used.png', width: 1, height: 1 }, { id: 'resource_unused', name: '可删除图片', kind: 'image', path: 'assets/unused.png', width: 1, height: 1 });
  const controls: UiComponent[] = [{ id: 'resource_image', kind: 'image', page: 'preferences', assetId: 'resource_used', text: '', x: .1, y: .1, width: .4, height: .4 }, { id: 'resource_button', kind: 'button', page: 'preferences', text: '换图', x: .1, y: .6, width: .3, height: .1 }];
  project.ui.components = controls;
  project.ui.instances = [{ id: 'resource_parent', name: '原方案', components: structuredClone(controls) }, { id: 'resource_derived', name: '派生方案', baseUiId: 'resource_parent', components: [] }];
  const cases = [undefined, 'resource_parent', 'resource_derived'].map(instanceId => {
    const graph = createBlueprintGraph('ui', '图片事件 · ' + (instanceId ?? 'base')); graph.id = 'resource_graph_' + (instanceId ?? 'base'); graph.uiPageId = 'ui:preferences'; graph.uiInstanceId = instanceId ?? 'base';
    graph.exposedInputs = [{ id: 'public_picture', name: '公开图片', dataType: 'asset', direction: 'input', required: false, defaultValue: 'resource_used' }];
    const event = blueprintNodeDefaults('eventClick'); event.id = graph.id + '_click'; event.name = '换图点击 · ' + (instanceId ?? 'base'); event.properties.componentId = 'resource_button';
    const set = blueprintNodeDefaults('setUiProperty'); set.id = graph.id + '_set'; set.properties = { componentId: 'resource_image', property: 'imageAssetId', value: 'resource_used' };
    graph.nodes.push(event, set); graph.links.push({ id: graph.id + '_wire', fromNodeId: event.id, fromPinId: 'exec', toNodeId: set.id, toPinId: 'exec_in' }); project.blueprints.push(graph);
    return { graph, event, set, instanceId };
  });
  const module = createBlueprintGraph('function', '旧名称模块'); module.id = 'resource_module'; module.callName = '稳定调用'; module.exposedInputs = [{ id: 'public_text', name: '公开文字', direction: 'input', dataType: 'string', required: false, defaultValue: '保留值' }]; project.blueprints.push(module);
  const caller = createBlueprintGraph('function', '旧文本调用者'); caller.id = 'resource_caller'; const action = blueprintNodeDefaults('sceneAction'); action.id = 'resource_named_command'; action.properties.command = '@通用蓝图：稳定调用'; caller.nodes.push(action); caller.links.push({ id: 'resource_named_link', fromNodeId: caller.nodes[0].id, fromPinId: 'exec', toNodeId: action.id, toPinId: 'exec_in' }); project.blueprints.push(caller);
  synchronizeBlueprintSignatures(project);
  return { project, cases, module, caller, controls };
}
