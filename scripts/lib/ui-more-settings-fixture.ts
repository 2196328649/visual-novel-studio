import assert from 'node:assert/strict';
import { createProject, type Project } from '../../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintNodeValuePins } from '../../src/core/blueprint';
import { uiNativePreferencesFixture } from './ui-native-preferences-fixture';

export function uiMoreSettingsFixture(mode: 'custom' | 'replaced' = 'custom') {
  const project = uiNativePreferencesFixture(); project.name = '通用参数界面验收';
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
    // Replacing all standard controls must not introduce any extra parameter UI.
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

/** The author deliberately places controls; grouping a variable never does this. */
export function placeParameterControls(project: Project) {
  for (const [index, id] of ['custom', 'enabled', 'language', 'nickname', 'bottom'].entries()) {
    const variable = project.variables.find(item => item.id === id)!;
    project.ui.components.push({ id: id + '_control', kind: 'preference', page: 'preferences', text: variable.name,
      parameterId: id, x: .1, y: .21 + index * .11, width: .34, height: .10 });
  }
  Object.assign(project.ui.components.find(item => item.id === 'placed_control')!, { y: .77 });
  Object.assign(project.ui.components.find(item => item.id === 'settings_back')!, { y: .88, height: .08 });
  Object.assign(project.ui.components.find(item => item.id === 'settings_reset')!, { x: .5, y: .88, width: .36, height: .08 });
}

/** A live blueprint can narrow a control after its initial values were valid. */
export function addResetValidationControl(project: Project) {
  project.variables.push(
    { id: 'reset_minimum', name: '滑条起点', type: 'number', initial: 50, persistent: false, resetWithSettings: true },
    { id: 'reset_value', name: '滑条测试值', type: 'number', initial: 60, persistent: false, resetWithSettings: false },
  );
  project.ui.components.push({ id: 'reset_range', kind: 'preference', page: 'preferences', text: '范围联动', parameterId: 'reset_value',
    x: .1, y: .38, width: .3, height: .08, controlRange: { min: 0, max: 100, step: 1 },
    propertyControls: { minimum: { mode: 'follow', parameterId: 'reset_minimum' } } });
  const graph = createBlueprintGraph('effect', '缩小滑条范围'), set = blueprintNodeDefaults('setUiProperty');
  set.properties = { componentId: 'reset_range', property: 'maximum', value: 20 };
  graph.nodes.push(set); synchronizeBlueprintNodeValuePins(project, graph, set);
  assert.equal(connectBlueprintPins(graph, graph.nodes[0].id, 'exec', set.id, 'exec_in'), undefined);
  project.blueprints.push(graph);
  project.ui.components.push({ id: 'narrow_range', kind: 'button', page: 'preferences', text: '缩小范围', action: 'blueprint', blueprintId: graph.id,
    x: .5, y: .38, width: .3, height: .08 });
}

/** Saving and restoring are independent choices, including legacy group data. */
export function parameterLifecycleFixture() {
  const project = createProject('通用参数生命周期验收');
  project.playerDefaults = { textSpeed: 0, musicVolume: .7, fullscreen: false, windowSize: '1280x720' };
  const passage = project.nodes.find(node => node.kind === 'passage')!;
  assert.equal(passage.kind, 'passage');
  passage.lines = [{ id: 'lc_wait', text: '参数生命周期测试停留在此句。', actions: [] }];
  project.parameterSets = [
    { id: 'lc_story_group', name: '剧情和蓝图', kind: 'story' },
    { id: 'lc_settings_group', name: '旧设置组', kind: 'settings' },
  ];
  project.variables = [
    { id: 'lc_slot_keep', name: '随档进度', type: 'number', initial: 1, persistent: false, resetWithSettings: false, parameterSetId: 'lc_story_group' },
    { id: 'lc_slot_reset', name: '可恢复的随档变量', type: 'number', initial: 2, persistent: false, resetWithSettings: true, parameterSetId: 'lc_story_group' },
    { id: 'lc_local_reset', name: '可恢复的本机变量', type: 'number', initial: 3, persistent: true, resetWithSettings: true, parameterSetId: 'lc_story_group' },
    { id: 'lc_local_keep', name: '保留的本机变量', type: 'number', initial: 4, persistent: true, resetWithSettings: false, parameterSetId: 'lc_settings_group' },
    // Deliberately omit resetWithSettings: the old settings group grants it.
    { id: 'lc_legacy', name: '旧设置参数', type: 'number', initial: 5, persistent: true, parameterSetId: 'lc_settings_group' },
    { id: 'lc_progress', name: '跨周目剧情进度', type: 'number', initial: 6, persistent: true, resetWithSettings: false, parameterSetId: 'lc_story_group' },
    { id: 'lc_read_value', name: '蓝图读到的值', type: 'number', initial: -1, persistent: false, resetWithSettings: false, parameterSetId: 'lc_story_group' },
  ];
  project.ui.pages = { preferences: { layout: 'custom', background: '#193038' } };
  project.ui.components.push(
    { id: 'lc_slider', kind: 'preference', page: 'preferences', text: '可恢复的随档变量', parameterId: 'lc_slot_reset',
      x: .12, y: .25, width: .7, height: .13, controlRange: { min: 0, max: 100, step: 1 } },
    { id: 'lc_back', kind: 'button', page: 'preferences', text: '返回游戏', action: 'return', x: .12, y: .72, width: .3, height: .1 },
  );
  const readGraph = createBlueprintGraph('effect', '读取控件使用的变量');
  const read = blueprintNodeDefaults('getVariable'), record = blueprintNodeDefaults('setVariable');
  read.properties = { variableId: 'lc_slot_reset' }; record.properties = { variableId: 'lc_read_value' };
  readGraph.nodes.push(read, record);
  synchronizeBlueprintNodeValuePins(project, readGraph, read); synchronizeBlueprintNodeValuePins(project, readGraph, record);
  assert.equal(connectBlueprintPins(readGraph, readGraph.nodes[0].id, 'exec', record.id, 'exec_in'), undefined);
  assert.equal(connectBlueprintPins(readGraph, read.id, 'value', record.id, 'value'), undefined);
  const writeGraph = createBlueprintGraph('effect', '设置控件使用的变量'), write = blueprintNodeDefaults('setVariable');
  write.properties = { variableId: 'lc_slot_reset', value: 37 };
  writeGraph.nodes.push(write); synchronizeBlueprintNodeValuePins(project, writeGraph, write);
  assert.equal(connectBlueprintPins(writeGraph, writeGraph.nodes[0].id, 'exec', write.id, 'exec_in'), undefined);
  project.blueprints.push(readGraph, writeGraph);
  project.ui.components.push(
    { id: 'lc_read_button', kind: 'button', page: 'preferences', text: '蓝图读取变量', action: 'blueprint', blueprintId: readGraph.id,
      x: .12, y: .48, width: .3, height: .1 },
    { id: 'lc_write_button', kind: 'button', page: 'preferences', text: '蓝图设为 37', action: 'blueprint', blueprintId: writeGraph.id,
      x: .52, y: .48, width: .3, height: .1 },
  );
  return project;
}
