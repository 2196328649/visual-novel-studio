import assert from 'node:assert/strict';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintNodeValuePins } from '../../src/core/blueprint';
import { uiNativePreferencesFixture } from './ui-native-preferences-fixture';

export function uiMoreSettingsFixture(mode: 'custom' | 'replaced' = 'custom') {
  const project = uiNativePreferencesFixture(); project.name = '更多设置交互验收';
  project.variables.push(
    { id: 'placed', name: '已放置参数', type: 'boolean', initial: true, persistent: true, parameterSetId: 'parameters_game' },
    { id: 'enabled', name: '显示提示', type: 'boolean', initial: true, persistent: true, parameterSetId: 'parameters_game' },
    { id: 'language', name: '字幕语言', type: 'string', initial: '中文', persistent: true, parameterSetId: 'parameters_game', setting: { options: ['中文', 'English'] } },
    { id: 'nickname', name: '称呼', type: 'string', initial: 'Player', persistent: true, parameterSetId: 'parameters_game' },
    { id: 'bottom', name: '提示停留时长', type: 'number', initial: 10, persistent: true, parameterSetId: 'parameters_game', setting: { min: 0, max: 30, step: 1 } },
  );
  project.ui.components.push(
    { id: 'placed_control', kind: 'preference', page: 'preferences', text: '已放置参数', parameterId: 'placed', x: .1, y: .2, width: .3, height: .08 },
    { id: 'settings_back', kind: 'button', page: 'preferences', text: '完成设置', action: 'return', x: .1, y: .7, width: .3, height: .09 },
    { id: 'settings_reset', kind: 'button', page: 'preferences', text: '恢复初始设置', action: 'resetPreferences', x: .1, y: .55, width: .3, height: .09 },
  );
  if (mode === 'custom') project.ui.pages = { ...project.ui.pages, preferences: { layout: 'custom', background: '#193038' } };
  else {
    // Include a real full-page authored panel to verify the native shortcut remains on top.
    project.ui.components.unshift({ id: 'settings_panel', kind: 'panel', page: 'preferences', text: '', x: 0, y: .2, width: 1, height: .8, layer: -1 });
    (['textSpeed', 'autoForwardTime', 'musicVolume', 'soundVolume', 'voiceVolume'] as const).forEach((preference, index) => project.ui.components.push({
      id: 'replacement_' + preference.toLowerCase(), kind: 'preference', page: 'preferences', text: preference, preference, x: .48, y: .25 + index * .1, width: .25, height: .065,
    }));
    (['window', 'fullscreen', 'skipSeen', 'skipAll', 'transitions', 'mute'] as const).forEach((action, index) => project.ui.components.push({
      id: 'replacement_' + action.toLowerCase(), kind: 'button', page: 'preferences', text: action, action, x: .78, y: .25 + index * .09, width: .16, height: .07,
    }));
  }
  const graph = createBlueprintGraph('effect', '设置后继续'), menu = blueprintNodeDefaults('uiAction'), after = blueprintNodeDefaults('setVariable');
  menu.properties = { screen: 'preferences' }; after.properties = { variableId: 'story', value: 9 };
  graph.nodes.push(menu, after); synchronizeBlueprintNodeValuePins(project, graph, after);
  assert.equal(connectBlueprintPins(graph, graph.nodes[0].id, 'exec', menu.id, 'exec_in'), undefined);
  assert.equal(connectBlueprintPins(graph, menu.id, 'exec_out', after.id, 'exec_in'), undefined);
  project.blueprints.push(graph);
  project.ui.components.push({ id: 'open_wait', kind: 'button', page: 'main', text: '蓝图打开设置', action: 'blueprint', blueprintId: graph.id, x: .25, y: .4, width: .5, height: .12 });
  return project;
}
