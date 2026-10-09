import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema } from '../src/core/model';
import { addParameter, createParameterControl, gameParametersId, parameterSetFor, parameterSets, removeParameterSet, settingsParameters, storyParametersId } from '../src/core/parameter-sets';
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
  assert.equal(settingsParameters(project).length, 1);
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
  assert.ok(validateProject(project).some(d => d.message.includes('最大值')));
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
