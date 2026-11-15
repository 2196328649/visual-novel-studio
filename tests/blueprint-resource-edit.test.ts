import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlueprintInterfaceFixture } from '../scripts/lib/blueprint-interface-fixture';
import { blueprintResourceEditedProject } from '../src/core/blueprint-resource-edit';
import { applyBlueprintInterfaceChange, inspectBlueprintInterfaceChange, type BlueprintInterfaceChange } from '../src/core/blueprint-interface';
import { applyTextScript } from '../src/core/text-script';
import { projectSchema, type Project } from '../src/core/model';

function change(project: Project, graphId: string, edit: BlueprintInterfaceChange) {
  const plan = inspectBlueprintInterfaceChange(project, graphId, edit);
  return blueprintResourceEditedProject(project, draft => { applyBlueprintInterfaceChange(draft, graphId, edit, plan.confirmationKey); });
}
function story(project: Project) {
  const node = project.nodes.find(node => node.kind === 'passage');
  if (node?.kind !== 'passage') throw new Error('Missing passage');
  return node.lines[0];
}

test('named blueprint edits preserve authored text formatting and do not reparse unrelated drafts', () => {
  const { project, module } = createBlueprintInterfaceFixture(), before = JSON.stringify(project);
  const next = blueprintResourceEditedProject(project, draft => { draft.blueprints.find(g => g.id === module.id)!.description = '新的说明'; }, () => { throw new Error('Unnecessary text parse'); });
  assert.equal(next.scriptText, project.scriptText);
  assert.equal(next.blueprints.find(g => g.id === module.id)?.description, '新的说明');
  assert.deepEqual(story(next), story(project)); assert.equal(JSON.stringify(project), before);
  assert.equal(next.assets, project.assets); assert.equal(next.characters, project.characters);
});

test('an invalidating interface change persists original values and can be repaired while the text call is invalid', () => {
  const { project, module, caller, call } = createBlueprintInterfaceFixture();
  const changed = change(project, module.id, { kind: 'update', direction: 'input', pinId: 'amount', patch: { dataType: 'boolean', defaultValue: false } });
  assert.equal(changed.blueprints.find(g => g.id === caller.id)?.nodes.find(n => n.id === call.id)?.pins.find(p => p.id === 'arg_amount')?.dataType, 'boolean');
  assert.deepEqual(story(changed).actions, story(project).actions);
  assert.equal(changed.scriptText!.content, project.scriptText!.content);
  assert.ok(applyTextScript(changed, changed.scriptText!.content).issues.some(issue => issue.severity === 'error'));
  const saved = projectSchema.parse(JSON.parse(JSON.stringify(changed)));
  const repaired = change(saved, module.id, { kind: 'update', direction: 'input', pinId: 'amount', patch: { dataType: 'number', defaultValue: 2 } });
  assert.deepEqual(applyTextScript(repaired, repaired.scriptText!.content).issues.filter(issue => issue.severity === 'error'), []);
  assert.deepEqual(repaired.blueprints, project.blueprints); assert.deepEqual(story(repaired), story(project));
});

test('removing an interface argument patches only its synchronized story command, not comments or prose', () => {
  const { project, module } = createBlueprintInterfaceFixture();
  const next = change(project, module.id, { kind: 'remove', direction: 'input', pinId: 'amount' });
  const action = story(next).actions[0]; assert.equal(action.kind, 'blueprint');
  if (action.kind === 'blueprint') assert.equal(action.inputs, undefined);
  assert.equal(story(next).text, story(project).text);
  const withoutCall = (source: string) => source.split('\n').filter(row => !row.startsWith('@接口验收模块')).join('\n');
  assert.equal(withoutCall(next.scriptText!.content), withoutCall(project.scriptText!.content));
  assert.notEqual(next.scriptText!.content, project.scriptText!.content);
  const parsed = applyTextScript(next, next.scriptText!.content);
  assert.deepEqual(parsed.issues.filter(issue => issue.severity === 'error'), []);
  assert.deepEqual(story(parsed.project).actions, story(next).actions);
});

for (const invalid of [false, true]) test('resource synchronization preserves an independent ' + (invalid ? 'invalid' : 'valid') + ' text draft', () => {
  const { project, module } = createBlueprintInterfaceFixture();
  project.scriptText!.content = invalid ? project.scriptText!.content + '\n@不存在的指令：1' : project.scriptText!.content.replace('模块接口回归台词', '尚未应用的草稿台词');
  const before = JSON.stringify(project), next = change(project, module.id, { kind: 'remove', direction: 'input', pinId: 'amount' });
  assert.equal(next.scriptText!.content, project.scriptText!.content);
  assert.equal(story(next).text, '模块接口回归台词'); assert.equal(JSON.stringify(project), before);
});

test('a rejected named-resource edit leaves both graph and source snapshots untouched', () => {
  const { project, module } = createBlueprintInterfaceFixture(), before = JSON.stringify(project);
  assert.throws(() => blueprintResourceEditedProject(project, draft => { draft.blueprints.find(g => g.id === module.id)!.name = '未提交'; throw new Error('拒绝修改'); }), /拒绝修改/);
  assert.equal(JSON.stringify(project), before);
});
