import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema, type ParameterDefaults } from '../src/core/model';
import { addParameter, addParameterSet, changeParameterSetDefaults, createParameterControl, gameParametersId, moveParameter, parameterControlPageProblem, parameterResetsWithSettings, parameterSetDefaults, parameterSetFor, parameterSets, parametersResetWithSettings, removeParameterSet, renameParameterSet, setParameterKind, storyParametersId } from '../src/core/parameter-sets';
import { shareProjectBranches } from '../src/core/project-history';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { compileProject } from '../src/runtime/compiler';
import { validateProject } from '../src/core/validate';
test('existing state belongs to the story set without allocating duplicate variables', () => {
  const project = createProject(); const id = addParameter(project, storyParametersId);
  delete project.variables.find(variable => variable.id === id)!.parameterSetId;
  assert.equal(parameterSetFor(project, project.variables.at(-1)!).id, storyParametersId);
  assert.equal(parameterSets(project).length, 2);
  assert.equal(project.parameterSets, undefined);
});
test('removing a group preserves IDs, values and persistence', () => {
  const project = createProject();
  project.parameterSets = [{ id: 'my_options', name: '辅助选项', kind: 'settings' }];
  const id = addParameter(project, 'my_options', 'boolean');
  assert.equal(project.variables.find(variable => variable.id === id)?.persistent, true);
  removeParameterSet(project, 'my_options');
  assert.equal(project.variables.find(variable => variable.id === id)?.parameterSetId, storyParametersId);
  assert.equal(project.variables.find(variable => variable.id === id)?.initial, false);
  assert.throws(() => removeParameterSet(project, gameParametersId));
});
test('custom settings bind to native controls and the same blueprint-visible store', () => {
  const project = createProject(), id = addParameter(project, gameParametersId, 'boolean');
  const variable = project.variables.find(variable => variable.id === id)!; variable.name = '减少闪烁';
  const control = createParameterControl(project, id);
  assert.equal(createParameterControl(project, id), control);
  assert.equal(project.ui.components.find(component => component.id === control)?.parameterId, id);
  assert.equal(parametersResetWithSettings(project).length, 1);
  assert.equal(projectSchema.safeParse(project).success, true);
  const output = compileProject(project);
  assert.deepEqual(output.diagnostics.filter(d => d.severity === 'error'), []);
  assert.ok(output.files['game/story.rpy'].includes('default persistent.vn_var_' + id));
  assert.ok(output.files['game/screens.rpy'].includes('use vn_parameter_control("' + id + '"'));
  assert.match(output.files['game/00-vn-parameters.rpy'], /setattr\(owner, "vn_var_" \+ parameter_id, value\)/);
  assert.match(output.files['game/00-vn-preferences.rpy'], /vn_parameter_reset_settings/);
});
test('parameter metadata survives source edits and schema serialization', () => {
  const project = createProject(), id = addParameter(project, gameParametersId, 'string');
  const variable = project.variables.find(variable => variable.id === id)!;
  variable.initial = '普通'; variable.setting = { options: ['普通', '简洁'] };
  const parsed = applyTextScript(projectSchema.parse(project), projectToText(project));
  assert.deepEqual(parsed.issues, []); assert.deepEqual(parsed.project.variables, project.variables);
  assert.deepEqual(validateProject(parsed.project).filter(d => d.severity === 'error'), []);
});
test('invalid menu ranges and missing bound parameters produce specific diagnostics', () => {
  const project = createProject(), id = addParameter(project, gameParametersId);
  createParameterControl(project, id);
  project.variables.find(variable => variable.id === id)!.setting = { min: 5, max: 2 };
  assert.ok(validateProject(project).some(d => d.message.includes('范围下限不能大于上限')));
  project.variables = project.variables.filter(variable => variable.id !== id);
  const issue = validateProject(project).find(d => d.message.includes('绑定的参数'));
  assert.ok(issue?.ui?.componentId);
});
test('history retains untouched references and still keeps undo snapshots immutable', () => {
  const before = createProject(), draft = structuredClone(before);
  draft.ui.textColor = '#ffccaa';
  const after = shareProjectBranches(before, draft);
  assert.notEqual(after, before); assert.notEqual(after.ui, before.ui);
  assert.equal(after.nodes, before.nodes); assert.equal(after.assets, before.assets); assert.equal(after.blueprints, before.blueprints);
  assert.notEqual(before.ui.textColor, after.ui.textColor);
  assert.equal(shareProjectBranches(before, structuredClone(before)), before);
});

test('legacy group defaults and reset reads remain pure through schema, compile and text roundtrip', () => {
  const project = createProject();
  project.parameterSets = [{ id: 'legacy', name: '旧设置组', kind: 'settings', defaults: { persistent: false, resetWithSettings: false } }];
  project.variables = [
    { id: 'legacy_hidden', name: '旧隐藏开关', type: 'boolean', initial: false, persistent: false, parameterSetId: 'legacy', setting: { visible: false } },
    { id: 'legacy_asset', name: '旧素材', type: 'asset', assetKind: 'image', initial: '', persistent: true, parameterSetId: 'legacy' },
    { id: 'chapter', name: '章节进度', type: 'number', initial: 0, persistent: true },
    { id: 'internal', name: '内部状态', type: 'boolean', initial: false, persistent: true, parameterSetId: 'legacy', resetWithSettings: false },
    { id: 'opt_in', name: '本局可恢复', type: 'string', initial: '', persistent: false, resetWithSettings: true },
  ];
  const before = structuredClone(project), parsed = projectSchema.parse(project);
  assert.equal(Object.hasOwn(parsed.variables[0], 'resetWithSettings'), false);
  assert.deepEqual(parametersResetWithSettings(parsed).map(variable => variable.id), ['legacy_hidden', 'legacy_asset', 'opt_in']);
  for (const variable of parsed.variables) assert.equal(parameterResetsWithSettings(parsed, variable), ['legacy_hidden', 'legacy_asset', 'opt_in'].includes(variable.id));
  const defaults = parameterSetDefaults(parsed.parameterSets![0]);
  assert.deepEqual(defaults, { persistent: false, resetWithSettings: false });
  defaults.persistent = true;
  assert.equal(parsed.parameterSets![0].defaults!.persistent, false);
  assert.deepEqual(compileProject(parsed).diagnostics.filter(item => item.severity === 'error'), []);
  assert.deepEqual(applyTextScript(parsed, projectToText(parsed)).project.variables, parsed.variables);
  assert.deepEqual(project, before); assert.deepEqual(parsed.variables, before.variables);
});

test('new group defaults are complete, independent and apply only to new parameters', () => {
  for (const persistent of [false, true]) for (const resetWithSettings of [false, true]) {
    const project = createProject(), defaults: ParameterDefaults = { persistent, resetWithSettings };
    const group = addParameterSet(project, '通用变量', 'story', defaults);
    defaults.persistent = !persistent;
    const oldId = addParameter(project, group, 'boolean');
    const old = project.variables.find(variable => variable.id === oldId)!;
    assert.equal(old.persistent, persistent); assert.equal(old.resetWithSettings, resetWithSettings); assert.equal(old.initial, false);
    const before = structuredClone(old);
    changeParameterSetDefaults(project, group, { persistent: !persistent, resetWithSettings: !resetWithSettings });
    assert.deepEqual(old, before);
    const nextId = addParameter(project, group, 'string'), next = project.variables.find(variable => variable.id === nextId)!;
    assert.equal(next.persistent, !persistent); assert.equal(next.resetWithSettings, !resetWithSettings); assert.equal(next.initial, '');
    const explicit = addParameter(project, group, 'number', { persistent: false, resetWithSettings: false });
    assert.equal(project.variables.find(variable => variable.id === explicit)!.persistent, false);
    assert.equal(project.variables.find(variable => variable.id === explicit)!.resetWithSettings, false);
    assert.equal(projectSchema.safeParse(project).success, true);
  }
});

test('group moves and removal preserve legacy reset membership and only change organization', () => {
  const project = createProject();
  const group = addParameterSet(project, '旧设置组', 'settings');
  project.variables = [
    { id: 'old', name: '旧设置', type: 'number', initial: 17, persistent: false, parameterSetId: group },
    { id: 'state', name: '进度', type: 'string', initial: '', persistent: true },
    { id: 'removed', name: '删除分组时留下', type: 'boolean', initial: false, persistent: true, parameterSetId: group },
  ];
  const control = createParameterControl(project, 'old', 'ui:main');
  const ui = structuredClone(project.ui);
  renameParameterSet(project, group, '只改分类名');
  moveParameter(project, 'old', storyParametersId);
  moveParameter(project, 'state', group);
  assert.equal(project.variables[0].resetWithSettings, true);
  assert.equal(project.variables[1].resetWithSettings, false);
  assert.equal(project.variables[0].persistent, false); assert.equal(project.variables[0].initial, 17);
  assert.equal(project.variables[1].persistent, true); assert.equal(project.variables[1].initial, '');
  removeParameterSet(project, group);
  assert.equal(project.variables[2].resetWithSettings, true);
  assert.ok(project.variables.every(variable => variable.parameterSetId === storyParametersId));
  assert.deepEqual(parametersResetWithSettings(project).map(variable => variable.id), ['old', 'removed']);
  assert.deepEqual(project.ui, ui); assert.equal(project.ui.components.find(item => item.id === control)?.parameterId, 'old');
  setParameterKind(project.variables[0], 'string');
  assert.equal(project.variables[0].resetWithSettings, true); assert.equal(project.variables[0].persistent, false);
});

test('default edits snapshot old reset rules and reject missing, malformed or full groups before mutation', () => {
  const project = createProject();
  project.variables = [{ id: 'old', name: '旧设置', type: 'boolean', initial: false, persistent: true, parameterSetId: gameParametersId }];
  changeParameterSetDefaults(project, gameParametersId, { persistent: false, resetWithSettings: false });
  assert.equal(project.variables[0].resetWithSettings, true);
  assert.deepEqual(project.parameterSets![0].defaults, { persistent: false, resetWithSettings: false });
  const newId = addParameter(project, gameParametersId), member = project.variables.find(variable => variable.id === newId)!;
  assert.equal(member.resetWithSettings, false); assert.equal(member.persistent, false);
  const before = structuredClone(project);
  assert.throws(() => changeParameterSetDefaults(project, 'missing', { persistent: true, resetWithSettings: true }), /不存在/);
  assert.throws(() => changeParameterSetDefaults(project, gameParametersId, { persistent: true } as ParameterDefaults));
  assert.throws(() => removeParameterSet(project, 'missing'), /不存在/);
  assert.deepEqual(project, before);
  const full = createProject();
  full.parameterSets = Array.from({ length: 128 }, (_, index) => ({ id: 'group_' + index, name: '组' + index, kind: 'story' as const }));
  full.variables = [{ id: 'legacy', name: '旧值', type: 'boolean', initial: false, persistent: true, parameterSetId: gameParametersId }];
  assert.equal(Object.hasOwn(full.variables[0], 'resetWithSettings'), false);
  const original = structuredClone(full);
  assert.throws(() => changeParameterSetDefaults(full, gameParametersId, { persistent: false, resetWithSettings: false }), /上限/);
  assert.throws(() => renameParameterSet(full, gameParametersId, '改名'), /上限/);
  assert.deepEqual(full, original);
});

test('free variables do not acquire UI range or option constraints from storage, reset or grouping', () => {
  const project = createProject();
  project.variables = [
    { id: 'free_number', name: '蓝图分数', type: 'number', initial: 700, persistent: true, resetWithSettings: true, parameterSetId: gameParametersId, setting: { min: 5, max: 2 } },
    { id: 'free_text', name: '内部名字', type: 'string', initial: '内部值', persistent: false, resetWithSettings: true, parameterSetId: gameParametersId, setting: { options: ['玩家可选值'] } },
  ];
  assert.deepEqual(validateProject(project).filter(item => item.severity === 'error'), []);
  const id = createParameterControl(project, 'free_number');
  assert.ok(validateProject(project).some(item => item.ui?.componentId === id && item.message.includes('范围')));
  project.variables[0].setting = { min: 0, max: 100 };
  assert.deepEqual(validateProject(project).filter(item => item.severity === 'error'), []);
  assert.equal(project.variables[0].initial, 700);
});

test('authored control range validation uses linked initial properties and respects explicit equal endpoints', () => {
  const project = createProject();
  project.variables = [
    { id: 'value', name: '数值', type: 'number', initial: 25, persistent: false, setting: { min: 20, max: 10 } },
    { id: 'upper', name: '范围上限', type: 'number', initial: 100, persistent: false },
  ];
  const id = createParameterControl(project, 'value', 'ui:main'), control = project.ui.components.find(item => item.id === id)!;
  control.propertyControls = { maximum: { mode: 'follow', parameterId: 'upper' } };
  assert.deepEqual(validateProject(project).filter(item => item.severity === 'error'), []);
  control.controlRange = { min: 20, max: 10, step: 1 };
  assert.deepEqual(validateProject(project).filter(item => item.severity === 'error'), []);
  project.variables[1].initial = 20;
  assert.deepEqual(validateProject(project).filter(item => item.severity === 'error'), []);
  project.variables[1].initial = 19;
  assert.ok(validateProject(project).some(item => item.severity === 'error' && item.ui?.componentId === id));
});

test('explicit controls target the requested page and active scheme, ignore plain references and reject invalid targets atomically', () => {
  const project = createProject(), id = addParameter(project, storyParametersId, 'boolean');
  project.ui.components.push({ id: 'plain_reference', kind: 'text', page: 'main', parameterId: id, text: '只是显示', x: 0, y: 0, width: .2, height: .1 });
  project.ui.customPages = [{ id: 'overlay', name: '状态面板', modal: false, components: [] }];
  project.ui.instances = [{ id: 'scheme', name: '当前方案', components: [] }]; project.ui.activeInstanceId = 'scheme';
  const main = createParameterControl(project, id, 'ui:main'), overlay = createParameterControl(project, id, 'overlay');
  assert.notEqual(main, 'plain_reference'); assert.notEqual(main, overlay);
  assert.equal(project.ui.instances[0].components.find(item => item.id === main)?.page, 'main');
  assert.equal(project.ui.customPages[0].components.find(item => item.id === overlay)?.page, 'custom');
  assert.equal(createParameterControl(project, id, 'overlay'), overlay);
  assert.equal(createParameterControl(project, id, 'ui:main'), main);
  project.ui.disabledPages = ['preferences'];
  const assetId = addParameter(project, storyParametersId, 'image');
  const before = structuredClone(project);
  for (const target of ['missing', 'ui:preferences', 'ui:chapterTitle']) {
    assert.ok(parameterControlPageProblem(project, target));
    assert.throws(() => createParameterControl(project, id, target));
  }
  assert.throws(() => createParameterControl(project, assetId, 'overlay'), /素材/);
  assert.deepEqual(project, before); assert.equal(projectSchema.safeParse(project).success, true);
});
