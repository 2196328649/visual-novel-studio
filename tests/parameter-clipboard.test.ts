import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema } from '../src/core/model';
import { addParameter, addParameterSet, copyParameter, copyParameterSet, gameParametersId, parameterResetsWithSettings, pasteParameter, storyParametersId } from '../src/core/parameter-sets';

test('copied parameters get distinct names and IDs while retaining defaults and storage settings', () => {
  const project = createProject(), id = addParameter(project, gameParametersId, 'string');
  const original = project.variables.find(variable => variable.id === id)!;
  original.name = '难度'; original.initial = '普通'; original.setting = { options: ['简单', '普通'] };
  const clipboard = copyParameter(project, id);
  const first = pasteParameter(project, clipboard, storyParametersId), second = pasteParameter(project, clipboard, storyParametersId);
  const copy = project.variables.find(variable => variable.id === first.variableId)!;
  assert.notEqual(first.variableId, id); assert.notEqual(first.variableId, second.variableId);
  assert.equal(copy.name, '难度 副本'); assert.equal(project.variables.at(-1)!.name, '难度 副本 2');
  assert.equal(copy.initial, '普通'); assert.equal(copy.persistent, true);
  assert.equal(copy.resetWithSettings, true);
  copy.setting!.options!.push('困难'); assert.deepEqual(original.setting.options, ['简单', '普通']);
  assert.equal(projectSchema.safeParse(project).success, true);
});

test('cut and paste moves the live parameter, preserving its ID and newer edits', () => {
  const project = createProject(), id = addParameter(project, gameParametersId);
  const clipboard = copyParameter(project, id, true);
  project.variables.find(variable => variable.id === id)!.initial = 38;
  project.variables.find(variable => variable.id === id)!.resetWithSettings = false;
  const count = project.variables.length, result = pasteParameter(project, clipboard, storyParametersId);
  assert.equal(result.variableId, id); assert.equal(project.variables.length, count);
  const moved = project.variables.find(variable => variable.id === id)!;
  assert.equal(moved.initial, 38); assert.equal(moved.persistent, true); assert.equal(moved.parameterSetId, storyParametersId);
  assert.equal(moved.resetWithSettings, false);
});

test('parameter sets copy their custom contents with independent IDs and names', () => {
  const project = createProject(), set = addParameterSet(project, '测试设置', 'settings');
  project.parameterSets![0].description = '说明';
  const id = addParameter(project, set, 'boolean');
  const copied = pasteParameter(project, copyParameterSet(project, set));
  assert.notEqual(copied.setId, set); assert.notEqual(copied.variableId, id);
  assert.equal(project.parameterSets!.at(-1)!.name, '测试设置 副本');
  assert.equal(project.parameterSets!.at(-1)!.kind, 'settings');
  assert.deepEqual(project.parameterSets!.at(-1)!.defaults, { persistent: true, resetWithSettings: true });
  assert.equal(project.parameterSets!.at(-1)!.description, '说明');
  assert.equal(project.variables.find(variable => variable.id === copied.variableId)!.parameterSetId, copied.setId);
  assert.equal(projectSchema.safeParse(project).success, true);
});

test('copies resolve legacy reset policy at the source without mutating it or adopting destination defaults', () => {
  const source = createProject(), target = createProject();
  source.parameterSets = [{ id: 'custom_group', name: '旧组', kind: 'settings' }];
  source.variables = [{ id: 'old_state', name: '旧值', type: 'string', initial: '', persistent: false, parameterSetId: 'custom_group', setting: { visible: false } }];
  target.parameterSets = [{ id: 'custom_group', name: '同ID不同意义', kind: 'story', defaults: { persistent: true, resetWithSettings: false } }];
  const before = structuredClone(source);
  const copied = pasteParameter(target, copyParameter(source, 'old_state'), 'custom_group');
  const value = target.variables.find(variable => variable.id === copied.variableId)!;
  assert.equal(value.persistent, false); assert.equal(value.initial, ''); assert.equal(value.resetWithSettings, true);
  assert.equal(parameterResetsWithSettings(target, value), true);
  const groupCopy = pasteParameter(target, copyParameterSet(source, 'custom_group'));
  assert.deepEqual(target.parameterSets!.find(group => group.id === groupCopy.setId)!.defaults, { persistent: true, resetWithSettings: true });
  assert.equal(target.variables.find(variable => variable.id === groupCopy.variableId)!.resetWithSettings, true);
  assert.deepEqual(source, before);
});

test('paste rejects missing destinations and stale or foreign cuts without changing the project', () => {
  const project = createProject(), id = addParameter(project, storyParametersId), clipboard = copyParameter(project, id, true);
  const before = structuredClone(project);
  assert.throws(() => pasteParameter(project, clipboard, 'missing'), /目标/); assert.deepEqual(project, before);
  const foreign = createProject(); assert.throws(() => pasteParameter(foreign, clipboard, storyParametersId), /原工程/);
  project.variables = project.variables.filter(variable => variable.id !== id);
  assert.throws(() => pasteParameter(project, clipboard, gameParametersId), /不存在/);
  assert.equal(project.variables.some(variable => variable.id === id), false);
});
