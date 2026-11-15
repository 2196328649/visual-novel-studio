import assert from 'node:assert/strict';
import test from 'node:test';
import { createBlueprintGraph } from '../src/core/blueprint';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { defaultShowCharacter, resolveShowTarget } from '../src/core/character-presets';
import { characterDefaultExpression, restoredCharacterDefaultExpression, characterLegacyBlueprint, characterDeletionDependents, removeUnreferencedCharacter } from '../src/core/character-legacy';
import { createProject, effectiveCharacter, projectSchema } from '../src/core/model';
import { mutateProject } from '../src/core/project-mutation';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { validateProject } from '../src/core/validate';
import { createBlueprintRuntime } from '../src/runtime/blueprint-runtime';
import { compileProject } from '../src/runtime/compiler';

function fixture() {
  const project = createProject('旧角色关联');
  project.assets = [{ id: 'portrait', name: '立绘', kind: 'image', path: 'portrait.png', width: 100, height: 200 }];
  const graph = createBlueprintGraph('effect', '旧角色显示后事件'); graph.id = 'old_character_graph';
  project.blueprints.push(graph);
  project.characters = [
    { id: 'parent', name: '旧上级', color: '#ffffff', expressions: [{ id: 'normal', name: '正面', assetId: 'portrait' }, { id: 'surprised', name: '惊讶', assetId: 'portrait' }], defaultExpressionId: 'surprised', blueprintId: graph.id },
    { id: 'child', name: '旧下级', color: '#ffffff', expressions: [], baseCharacterId: 'parent' },
    { id: 'grandchild', name: '旧孙级', color: '#ffffff', expressions: [], baseCharacterId: 'child' },
    { id: 'independent', name: '普通新角色', color: '#ffffff', expressions: [{ id: 'independent_expression', name: '普通', assetId: 'portrait' }] },
  ];
  const passage = project.nodes.find(node => node.kind === 'passage')!;
  passage.lines = [{ id: 'first_line', speakerId: 'child', text: '测试', actions: [defaultShowCharacter({ characterId: 'child', expressionId: 'normal' })] }];
  return { project, graph, passage };
}

function compiledStory(project: ReturnType<typeof createProject>) {
  const compiled = compileProject(project);
  assert.deepEqual(compiled.diagnostics.filter(problem => problem.severity === 'error'), []);
  return compiled.files['game/story.rpy'];
}

function runtimeCharacter(runtime: string, characterId: string) {
  const match = runtime.match(new RegExp(`"${characterId}": (\\{[^\\n]*?\\})(?=, "(?:parent|child|grandchild|independent)": |\\}\\n)`));
  assert.ok(match, `runtime table contains ${characterId}`);
  return match[1];
}

test('default expression reads inherited effective value and restore never writes while browsing', () => {
  const { project } = fixture(), before = structuredClone(project);
  const value = characterDefaultExpression(project, 'child');
  assert.equal(value.expression?.id, 'surprised'); assert.equal(value.source?.id, 'parent');
  assert.equal(restoredCharacterDefaultExpression(project, 'child').expression?.id, 'surprised');
  assert.equal(resolveShowTarget(project, defaultShowCharacter(), 'child')?.expressionId, 'surprised');
  assert.deepEqual(project, before);
  assert.equal(characterDefaultExpression(project, 'independent').source, undefined);
  assert.equal(characterDefaultExpression(project, 'independent').expression?.id, 'independent_expression');
});

test('default expression reports a missing inherited reference without rewriting it', () => {
  const { project } = fixture(); project.characters[0].defaultExpressionId = 'removed_expression';
  const before = structuredClone(project), value = characterDefaultExpression(project, 'child');
  assert.equal(value.missing, true); assert.equal(value.configuredId, 'removed_expression'); assert.equal(value.source?.id, 'parent');
  assert.deepEqual(project, before);
});

test('explicit first expression and restoring inheritance are separate undoable edits', () => {
  const { project } = fixture();
  const selected = mutateProject(project, draft => { draft.characters[1].defaultExpressionId = effectiveCharacter(draft, 'child')!.expressions[0].id; });
  assert.equal(characterDefaultExpression(selected, 'child').expression?.id, 'normal');
  assert.equal(characterDefaultExpression(selected, 'child').source?.id, 'child');
  assert.equal(restoredCharacterDefaultExpression(selected, 'child').expression?.id, 'surprised');
  assert.equal(selected.characters[1].defaultExpressionId, 'normal', 'restore preview has no mutation');
  const restored = mutateProject(selected, draft => { delete draft.characters[1].defaultExpressionId; });
  assert.equal(characterDefaultExpression(restored, 'child').expression?.id, 'surprised');
  assert.equal(Object.hasOwn(restored.characters[1], 'defaultExpressionId'), false);
  assert.equal(project.characters[1].defaultExpressionId, undefined, 'prior editor snapshot remains the undo state');
  assert.equal(characterDefaultExpression(selected, 'child').expression?.id, 'normal');
});

test('old blueprint source remains visible while local disable blocks inherited automatic calls', () => {
  const { project, graph } = fixture();
  assert.equal(characterLegacyBlueprint(project, 'child').source?.id, 'parent');
  assert.equal(characterLegacyBlueprint(project, 'child').enabled, true);
  const stopped = mutateProject(project, draft => { draft.characters[1].blueprintDisabled = true; });
  const binding = characterLegacyBlueprint(stopped, 'child');
  assert.equal(binding.blueprintId, graph.id); assert.equal(binding.disabledBy?.id, 'child'); assert.equal(binding.enabled, false);
  assert.equal(effectiveCharacter(stopped, 'child')?.blueprintId, undefined);
  assert.deepEqual(effectiveCharacter(stopped, 'child')?.expressions, effectiveCharacter(project, 'child')?.expressions);
  assert.equal(effectiveCharacter(stopped, 'grandchild')?.blueprintId, undefined);
  assert.equal(characterLegacyBlueprint(stopped, 'independent').blueprintId, undefined);
  assert.equal(Object.hasOwn(stopped.characters[3], 'blueprintDisabled'), false);
  assert.equal(project.characters[1].blueprintDisabled, undefined);
});

test('ancestor disable does not override a child explicit binding, and local disable restores that binding', () => {
  const { project } = fixture();
  project.characters[0].blueprintDisabled = true;
  assert.equal(effectiveCharacter(project, 'child')?.blueprintId, undefined);
  assert.equal(characterLegacyBlueprint(project, 'child').disabledBy?.id, 'parent');
  project.characters[1].blueprintId = 'own_character_graph';
  assert.equal(effectiveCharacter(project, 'child')?.blueprintId, 'own_character_graph');
  assert.equal(effectiveCharacter(project, 'child')?.blueprintDisabled, undefined);
  assert.equal(characterLegacyBlueprint(project, 'child').disabledBy, undefined);
  assert.equal(effectiveCharacter(project, 'grandchild')?.blueprintId, 'own_character_graph');
  assert.equal(characterLegacyBlueprint(project, 'grandchild').source?.id, 'child');
  project.characters[1].blueprintDisabled = true;
  assert.equal(effectiveCharacter(project, 'child')?.blueprintId, undefined);
  project.characters[2].blueprintId = 'grandchild_own_graph';
  assert.equal(effectiveCharacter(project, 'grandchild')?.blueprintId, 'grandchild_own_graph');
  assert.equal(effectiveCharacter(project, 'grandchild')?.blueprintDisabled, undefined);
  assert.equal(characterLegacyBlueprint(project, 'grandchild').disabledBy, undefined);
  delete project.characters[1].blueprintDisabled;
  assert.equal(effectiveCharacter(project, 'child')?.blueprintId, 'own_character_graph');
  delete project.characters[1].blueprintId;
  assert.equal(effectiveCharacter(project, 'child')?.blueprintId, undefined, 'restore continues to respect ancestor disable');
});

test('schema and text save preserve local disable without adding flags to ordinary characters', () => {
  const { project } = fixture(); project.characters[1].blueprintDisabled = true;
  const saved = projectSchema.parse(JSON.parse(JSON.stringify(project)));
  assert.equal(saved.characters[1].blueprintDisabled, true);
  const restored = applyTextScript(saved, projectToText(saved));
  assert.deepEqual(restored.issues.filter(problem => problem.severity === 'error'), []);
  assert.equal(restored.project.characters.find(character => character.id === 'child')?.blueprintDisabled, true);
  assert.equal(Object.hasOwn(restored.project.characters.find(character => character.id === 'independent')!, 'blueprintDisabled'), false);
  assert.throws(() => projectSchema.parse({ ...project, characters: [{ ...project.characters[1], blueprintDisabled: false }] }));
});

test('compiled explicit shows and runtime automatic/blueprint shows respect disable and restoration', () => {
  const { project, graph, passage } = fixture();
  const wrapper = blueprintFromPerformance(project, [defaultShowCharacter({ characterId: 'child' })], '新显示角色蓝图');
  project.blueprints.push(wrapper);
  passage.lines.push({ id: 'automatic_line', speakerId: 'child', text: '自动显示', actions: [defaultShowCharacter()] }, { id: 'blueprint_line', text: '蓝图显示', actions: [{ kind: 'blueprint', blueprintId: wrapper.id }] });
  const enabled = compiledStory(project);
  assert.match(enabled, /call vn_blueprint_old_character_graph from vn_character_blueprint_child/);
  assert.match(enabled, /call expression vn_bp_character_label\(vn_current_speaker\)/);
  assert.match(enabled, /call expression vn_bp_character_label\(\("child" or vn_current_speaker\)\)/);
  project.characters[1].blueprintDisabled = true;
  const stopped = compiledStory(project);
  assert.doesNotMatch(stopped, /call vn_blueprint_old_character_graph from vn_character_blueprint_child/);
  assert.match(stopped, /vn_bp_show\("child", "normal"/, 'portrait display remains active');
  assert.match(runtimeCharacter(createBlueprintRuntime(project), 'child'), /"blueprint": None/);
  assert.match(runtimeCharacter(createBlueprintRuntime(project), 'parent'), new RegExp(`"blueprint": "${graph.id}"`));
  delete project.characters[1].blueprintDisabled;
  assert.match(compiledStory(project), /call vn_blueprint_old_character_graph from vn_character_blueprint_child/);
  assert.match(runtimeCharacter(createBlueprintRuntime(project), 'child'), new RegExp(`"blueprint": "${graph.id}"`));
});

test('local root disable and inherited disable both change generated runtime tables without hiding portraits', () => {
  const { project, passage } = fixture();
  passage.lines[0].actions = [defaultShowCharacter({ characterId: 'parent', expressionId: 'normal' })];
  project.characters[0].blueprintDisabled = true;
  const stopped = compiledStory(project);
  assert.doesNotMatch(stopped, /call vn_blueprint_old_character_graph from vn_character_blueprint_parent/);
  assert.match(stopped, /vn_bp_show\("parent", "normal"/);
  for (const id of ['parent', 'child', 'grandchild']) assert.match(runtimeCharacter(createBlueprintRuntime(project), id), /"blueprint": None/);
  delete project.characters[0].blueprintDisabled;
  assert.match(compiledStory(project), /call vn_blueprint_old_character_graph from vn_character_blueprint_parent/);
});

test('deletion guard includes indirect dependents and leaves the project intact in a transaction', () => {
  const { project } = fixture(), before = structuredClone(project);
  assert.deepEqual(characterDeletionDependents(project, 'parent').map(character => character.id), ['child', 'grandchild']);
  const guarded = mutateProject(project, draft => { assert.equal(removeUnreferencedCharacter(draft, 'parent'), false); });
  assert.deepEqual(guarded, before);
  assert.deepEqual(validateProject(guarded).filter(problem => /基础角色不存在/.test(problem.message)), []);
  const deleted = mutateProject(project, draft => { assert.equal(removeUnreferencedCharacter(draft, 'independent'), true); });
  assert.equal(deleted.characters.some(character => character.id === 'independent'), false);
  assert.equal(project.characters.some(character => character.id === 'independent'), true, 'previous snapshot supports undo');
  assert.equal(removeUnreferencedCharacter(deleted, 'missing_character'), false);
});

test('dependency inspection terminates on cycles and still protects a directly referenced role', () => {
  const { project } = fixture(); project.characters[0].baseCharacterId = 'grandchild';
  assert.deepEqual(characterDeletionDependents(project, 'parent').map(character => character.id), ['child', 'grandchild']);
  assert.equal(removeUnreferencedCharacter(project, 'parent'), false);
  project.characters[1].baseCharacterId = 'already_missing_parent';
  assert.equal(characterDeletionDependents(project, 'already_missing_parent').length, 3);
});
