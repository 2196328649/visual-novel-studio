import test from 'node:test';
import assert from 'node:assert/strict';
import { blueprintNodeDefaults, createBlueprintGraph } from '../src/core/blueprint';
import { blueprintStateScope, blueprintStateVariable, blueprintStateVariables } from '../src/core/blueprint-state';
import { createProject, projectSchema, type ParameterDefaults, type VariableValue } from '../src/core/model';
import { moveParameter, parameterResetsWithSettings, parameterSetDefaults, parameterSets, gameParametersId, storyParametersId } from '../src/core/parameter-sets';
import { mutateProject } from '../src/core/project-mutation';
import { createUiGraphVariable } from '../src/core/ui-logic';
import { setUiPropertyControl, uiPropertyControlFor } from '../src/core/ui-property-control';

const behaviors: ParameterDefaults[] = [
  { persistent: false, resetWithSettings: false },
  { persistent: false, resetWithSettings: true },
  { persistent: true, resetWithSettings: false },
  { persistent: true, resetWithSettings: true },
];
const values: ReadonlyArray<readonly ['boolean' | 'number' | 'string', VariableValue]> = [
  ['boolean', false], ['number', 0], ['string', ''],
];

test('UI graph variables keep explicit storage and reset independently across groups and serialization', () => {
  const project = createProject('统一变量创建');
  project.parameterSets = [
    { id: 'custom_story', name: '本机分类', kind: 'story', defaults: { persistent: true, resetWithSettings: false } },
    { id: 'custom_settings', name: '存档分类', kind: 'settings', defaults: { persistent: false, resetWithSettings: true } },
  ];
  for (const setId of parameterSets(project).map(set => set.id)) for (const behavior of behaviors) for (const [type, initial] of values) {
    const variable = createUiGraphVariable(project, `变量 ${project.variables.length}`, type, initial, setId, behavior);
    assert.equal(variable.initial, initial);
    assert.equal(variable.parameterSetId, setId);
    assert.equal(variable.persistent, behavior.persistent);
    assert.equal(variable.resetWithSettings, behavior.resetWithSettings);
    assert.equal(parameterResetsWithSettings(project, variable), behavior.resetWithSettings);
    const loaded = projectSchema.parse(JSON.parse(JSON.stringify(project)));
    const saved = loaded.variables.find(item => item.id === variable.id)!;
    assert.equal(saved.initial, initial);
    assert.equal(saved.persistent, behavior.persistent);
    assert.equal(saved.resetWithSettings, behavior.resetWithSettings);
    assert.equal(parameterResetsWithSettings(loaded, saved), behavior.resetWithSettings);
    const oppositeSetId = setId === storyParametersId ? gameParametersId : storyParametersId;
    moveParameter(project, variable.id, oppositeSetId);
    assert.equal(variable.parameterSetId, oppositeSetId);
    assert.equal(variable.persistent, behavior.persistent);
    assert.equal(parameterResetsWithSettings(project, variable), behavior.resetWithSettings);
  }
});

test('old UI graph creation calls use group creation defaults while partial options override only their field', () => {
  const project = createProject();
  project.parameterSets = [
    { id: 'custom_story', name: '本机分类', kind: 'story', defaults: { persistent: true, resetWithSettings: false } },
    { id: 'custom_settings', name: '存档分类', kind: 'settings', defaults: { persistent: false, resetWithSettings: true } },
  ];
  for (const set of parameterSets(project)) {
    const defaults = parameterSetDefaults(set);
    const ordinary = createUiGraphVariable(project, `${set.id}默认`, 'boolean', false, set.id);
    assert.equal(ordinary.persistent, defaults.persistent);
    assert.equal(parameterResetsWithSettings(project, ordinary), defaults.resetWithSettings);
    const stored = createUiGraphVariable(project, `${set.id}保存`, 'number', 0, set.id, { persistent: !defaults.persistent });
    assert.equal(stored.persistent, !defaults.persistent);
    assert.equal(parameterResetsWithSettings(project, stored), defaults.resetWithSettings);
    const reset = createUiGraphVariable(project, `${set.id}恢复`, 'string', '', set.id, { resetWithSettings: !defaults.resetWithSettings });
    assert.equal(reset.persistent, defaults.persistent);
    assert.equal(parameterResetsWithSettings(project, reset), !defaults.resetWithSettings);
  }
});

test('blueprint shared variable lifetime follows explicit storage after moving classification', () => {
  const project = createProject(), graph = createBlueprintGraph('function', '读取变量');
  project.blueprints.push(graph);
  const local = createUiGraphVariable(project, '随存档的选项', 'boolean', false, gameParametersId, { persistent: false, resetWithSettings: true });
  const machine = createUiGraphVariable(project, '跨周目进度', 'number', 0, storyParametersId, { persistent: true, resetWithSettings: false });
  for (const variable of [local, machine]) {
    const node = blueprintNodeDefaults('getVariable'); node.properties = { variableId: variable.id };
    assert.equal(blueprintStateScope(project, node), variable.persistent ? 'player' : 'project');
    assert.equal(blueprintStateVariable(project, graph, node)?.id, variable.id);
    moveParameter(project, variable.id, variable.parameterSetId === storyParametersId ? gameParametersId : storyParametersId);
    assert.equal(blueprintStateScope(project, node), variable.persistent ? 'player' : 'project');
    assert.equal(blueprintStateVariable(project, graph, node)?.id, variable.id);
  }
  assert.ok(blueprintStateVariables(project, graph, 'project').some(variable => variable.id === local.id));
  assert.ok(!blueprintStateVariables(project, graph, 'project').some(variable => variable.id === machine.id));
  assert.ok(blueprintStateVariables(project, graph, 'player').some(variable => variable.id === machine.id));
  assert.ok(!blueprintStateVariables(project, graph, 'player').some(variable => variable.id === local.id));
});

test('creating a control source and its association is one transaction and rejects a partial creation', () => {
  const before = createProject();
  before.ui.components.push({ id: 'caption', kind: 'text', page: 'main', text: '', x: 0, y: 0, width: .2, height: .1 });
  const snapshot = structuredClone(before);
  const after = mutateProject(before, draft => {
    const variable = createUiGraphVariable(draft, '控件透明度', 'number', 0, gameParametersId, { persistent: true, resetWithSettings: false });
    setUiPropertyControl(draft, 'caption', 'ui:main', 'opacity', { mode: 'sync', parameterId: variable.id });
  });
  assert.deepEqual(before, snapshot);
  const variable = after.variables.find(item => item.name === '控件透明度')!;
  assert.equal(variable.initial, 0);
  assert.equal(variable.persistent, true);
  assert.equal(parameterResetsWithSettings(after, variable), false);
  assert.equal(uiPropertyControlFor(after, after.ui.components.find(item => item.id === 'caption')!, 'opacity')?.control.parameterId, variable.id);
  assert.throws(() => mutateProject(before, draft => {
    const source = createUiGraphVariable(draft, '无效透明度', 'number', 2, storyParametersId, { persistent: false, resetWithSettings: true });
    setUiPropertyControl(draft, 'caption', 'ui:main', 'opacity', { mode: 'follow', parameterId: source.id });
  }), /初始值/);
  assert.deepEqual(before, snapshot);
});
