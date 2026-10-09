import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema } from '../src/core/model';
import { addParameter, addParameterSet, copyParameter, copyParameterSet, gameParametersId, pasteParameter, storyParametersId } from '../src/core/parameter-sets';

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
  copy.setting!.options!.push('困难'); assert.deepEqual(original.setting.options, ['简单', '普通']);
  assert.equal(projectSchema.safeParse(project).success, true);
});

test('cut and paste moves the live parameter, preserving its ID and newer edits', () => {
  const project = createProject(), id = addParameter(project, gameParametersId);
  const clipboard = copyParameter(project, id, true);
  project.variables.find(variable => variable.id === id)!.initial = 38;
  const count = project.variables.length, result = pasteParameter(project, clipboard, storyParametersId);
  assert.equal(result.variableId, id); assert.equal(project.variables.length, count);
  const moved = project.variables.find(variable => variable.id === id)!;
  assert.equal(moved.initial, 38); assert.equal(moved.persistent, true); assert.equal(moved.parameterSetId, storyParametersId);
});

test('parameter sets copy their custom contents with independent IDs and names', () => {
  const project = createProject(), set = addParameterSet(project, '测试设置', 'settings');
  project.parameterSets![0].description = '说明';
  const id = addParameter(project, set, 'boolean');
  const copied = pasteParameter(project, copyParameterSet(project, set));
  assert.notEqual(copied.setId, set); assert.notEqual(copied.variableId, id);
  assert.equal(project.parameterSets!.at(-1)!.name, '测试设置 副本');
  assert.equal(project.parameterSets!.at(-1)!.kind, 'settings');
  assert.equal(project.parameterSets!.at(-1)!.description, '说明');
  assert.equal(project.variables.find(variable => variable.id === copied.variableId)!.parameterSetId, copied.setId);
  assert.equal(projectSchema.safeParse(project).success, true);
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
