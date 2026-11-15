import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, newNode, type Condition, type UiComponent } from '../src/core/model';
import { blueprintNodeDefaults, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { blueprintStateVariable } from '../src/core/blueprint-state';
import { parameterAssignment, parameterNameProblem, renameParameterSet, storyParametersId } from '../src/core/parameter-sets';
import { changeParameterKind, changeParameterStorage, parameterUsages, removeParameter, renameParameter } from '../src/core/parameter-usages';
import { parameterTextReferences } from '../src/core/parameter-references';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { textDocument, refreshTextReferenceNames } from '../src/core/text-document';
import { parseTextCondition } from '../src/core/text-conditions';
import { currentScriptText } from '../src/core/script-text';
import { mutateProject } from '../src/core/project-mutation';
import { validateProject } from '../src/core/validate';

function fixture() {
  const p = createProject();
  p.variables = [{ id: 'score', name: '好感度', type: 'number', initial: 5, persistent: false }, { id: 'replacement', name: '新好感度', type: 'number', initial: 9, persistent: true }];
  const condition: Condition = { kind: 'compare', variableId: 'score', operator: 'gte', value: 1 };
  const set = newNode('set', p.scenes[0].id, 'score'); assert.equal(set.kind, 'set');
  set.when = { kind: 'not', condition: structuredClone(condition) }; p.nodes.push(set);
  const choice = newNode('choice', p.scenes[0].id); assert.equal(choice.kind, 'choice');
  choice.choices = [{ id: 'branch', text: '继续', condition: { kind: 'any', conditions: [structuredClone(condition)] } }]; p.nodes.push(choice);
  const graph = createBlueprintGraph('function', '状态测试'); p.blueprints.push(graph);
  const readers = ['project', 'player', 'call', 'page', undefined].map(scope => {
    const node = blueprintNodeDefaults('getVariable'); node.properties = { variableId: 'score', ...(scope ? { scope } : {}) }; graph.nodes.push(node); return node;
  });
  graph.localVariables = [{ id: 'score', name: '同标识局部状态', type: 'number', initial: 0 }];
  const component: UiComponent = { id: 'slider', name: '好感度滑条', page: 'preferences', kind: 'preference', parameterId: 'score', text: '', x: .1, y: .1, width: .3, height: .1, visibleWhen: structuredClone(condition) };
  p.ui.components = [component];
  p.ui.instances = [{ id: 'owner', name: '有绑定的方案', components: [{ ...structuredClone(component), id: 'own_slider' }] }, { id: 'derived', name: '派生方案', baseUiId: 'owner', components: [] }];
  p.ui.customPages = [{ id: 'custom_page', name: '自定义', modal: true, components: [{ ...structuredClone(component), id: 'page_slider', page: 'custom' }] }];
  return { p, set, choice, graph, readers, condition };
}

test('parameter names use one rule and invalid edits leave definitions and drafts unchanged', () => {
  const { p } = fixture(); const before = structuredClone(p);
  for (const name of ['', '  ', '新好感度', ' 新好感度 ', '换\n行', 'a'.repeat(121)]) {
    assert.ok(parameterNameProblem(p, name, 'score')); assert.throws(() => renameParameter(p, 'score', name)); assert.deepEqual(p, before);
  }
  renameParameter(p, 'score', ' 感情进度 '); assert.equal(p.variables[0].name, '感情进度');
  assert.throws(() => renameParameterSet(p, storyParametersId, '游戏设置'));
  renameParameterSet(p, storyParametersId, ' 故事参数 '); assert.equal(p.parameterSets?.[0].name, '故事参数');
});

test('rename patches only operands in unapplied text and keeps whitespace, values, dialogue and comments', () => {
  const { p } = fixture();
  const source = ['// @设置：好感度=8', '旁白：好感度【score】没有变。', '@设置：好感度 = 9', '/变量 好感度 += 2', '@如果：好感度 >= 2，好感度=3', '@设置：新好感度="好感度"', '@效果定义：保留', '@设置：好感度=1', '@效果结束', '尚未应用的末尾'].join('\r\n');
  p.scriptText = currentScriptText(source);
  renameParameter(p, 'score', '亲密度');
  assert.equal(p.scriptText.content, source.replace('@设置：好感度 =', '@设置：亲密度【score】 =').replace('/变量 好感度 +=', '/变量 亲密度【score】 +=').replace('@如果：好感度 >= 2，好感度=3', '@如果：亲密度【score】 >= 2，亲密度【score】=3'));
  assert.equal(parameterUsages(p, 'score').filter(use => use.location.kind === 'text').length, 3);
});

test('compound conditions replace only JSON parameter operands, including escaped ID strings', () => {
  const { p } = fixture();
  const source = '@条件：{"kind":"all","conditions":[{"kind":"compare","variableId":"sco\\u0072e","operator":"eq","value":"score"},{"kind":"not","condition":{"kind":"compare","variableId":"replacement","operator":"eq","value":9}}]}';
  p.scriptText = currentScriptText(source);
  assert.deepEqual(parameterTextReferences(p, source).map(ref => ref.variableId), ['score', 'replacement']);
  removeParameter(p, 'score', 'replacement');
  assert.equal(p.scriptText.content, source.replace('"sco\\u0072e"', '"replacement"'));
});

test('conditional assignments preserve quoted commas, equals signs and numeric-looking strings', () => {
  const { p } = fixture(); p.variables.push({ id: 'caption', name: '文字', type: 'string', initial: '', persistent: false });
  for (const value of ['true', '0123', '好感度,文字=2', '引号"和值']) {
    const source = '@设置：如果 好感度【score】>=1，文字【caption】=' + JSON.stringify(value);
    const parsed = applyTextScript(p, source);
    assert.deepEqual(parsed.issues, []);
    assert.ok(parsed.project.nodes.some(node => node.kind === 'set' && node.variableId === 'caption' && node.value === value));
    p.scriptText = currentScriptText(source); renameParameter(p, 'score', '好感度');
    assert.equal(p.scriptText.content, source);
  }
});

test('deleted names stay pinned to missing IDs when applying drafts instead of recreating parameters', () => {
  const { p } = fixture(); p.scriptText = currentScriptText('@设置：好感度=8\n旁白：保留文本');
  removeParameter(p, 'score');
  assert.equal(p.scriptText.content, '@设置：好感度【score】=8\n旁白：保留文本');
  const parsed = applyTextScript(p, p.scriptText.content);
  assert.ok(parsed.issues.some(issue => issue.message.includes('引用不存在')));
  assert.equal(parsed.project.variables.some(variable => variable.name === '好感度'), false);
  assert.match(projectToText(p), /已删除参数【score】/);
  assert.ok(validateProject(p).some(issue => issue.nodeId));
});
test('new commands below an existing node heading retain their own draft locations', () => {
  const { p, set } = fixture(); delete set.when;
  p.scriptText = currentScriptText(`# 设置：已有节点【${set.id}】\n@设置：好感度【score】=2\n@设置：好感度【score】=17`);
  const text = parameterUsages(p, 'score').filter(usage => usage.location.kind === 'text');
  assert.equal(text.length, 1); assert.deepEqual(text[0].location, { kind: 'text', sourceLine: 3 });
});

test('stable references remain hidden, editable and parseable even when names contain operators', () => {
  const { p } = fixture(); renameParameter(p, 'score', '分数>=门槛');
  const source = parameterAssignment(p, p.variables[0]);
  assert.equal(textDocument(source).text, '@设置：分数>=门槛=5');
  const parsed = applyTextScript(p, source);
  assert.deepEqual(parsed.issues, []); assert.ok(parsed.project.nodes.some(node => node.kind === 'set' && node.variableId === 'score'));
  assert.equal(parseTextCondition(p, '分数>=门槛【score】 >= 1').kind, 'compare');
  const conditional = '@设置：如果 分数>=门槛【score】 >= 1，分数>=门槛【score】=8';
  assert.equal(textDocument(conditional).text, '@设置：如果 分数>=门槛 >= 1，分数>=门槛=8');
  p.variables[0].name = '新名称'; assert.match(refreshTextReferenceNames(p, source), /新名称【score】/);
});

test('replacement covers story, owned UI definitions and global graph scopes without touching local state', () => {
  const { p, set, readers } = fixture();
  const before = structuredClone(p), usages = parameterUsages(p, 'score');
  assert.equal(usages.filter(usage => usage.location.kind === 'blueprint').length, 3);
  assert.equal(usages.filter(usage => usage.location.kind === 'ui').length, 3);
  assert.deepEqual(p, before, 'usage browsing is read-only');
  const next = mutateProject(p, draft => removeParameter(draft, 'score', 'replacement'));
  assert.deepEqual(p, before, 'undo snapshot remains intact');
  assert.equal(parameterUsages(next, 'score').length, 0);
  const updated = next.nodes.find(node => node.id === set.id); assert.ok(updated?.kind === 'set' && updated.variableId === 'replacement');
  for (const index of [0, 1, 4]) assert.equal(next.blueprints.at(-1)?.nodes.find(node => node.id === readers[index].id)?.properties.variableId, 'replacement');
  for (const index of [2, 3]) assert.equal(next.blueprints.at(-1)?.nodes.find(node => node.id === readers[index].id)?.properties.variableId, 'score');
  assert.deepEqual(next.ui.instances?.[1].components, []);
  assert.equal(next.variables[0].initial, 9, 'replacement values do not merge');
});

test('asset bindings and gallery conditions follow replacements without copying inherited controls', () => {
  const { p, condition } = fixture();
  p.variables.push({ id: 'picture', name: '图片', type: 'asset', assetKind: 'image', initial: '', persistent: false }, { id: 'other_picture', name: '新图片', type: 'asset', assetKind: 'image', initial: '', persistent: false });
  p.ui.components.push({ id: 'image', kind: 'image', page: 'main', text: '', x: 0, y: 0, width: 1, height: 1, assetParameterId: 'picture', list: { galleryUnlockWhen: { art: structuredClone(condition) }, galleryGroups: [{ id: 'group', name: '分组', assetIds: ['art'], unlockWhen: structuredClone(condition), variantUnlockWhen: { art: structuredClone(condition) } }] } });
  removeParameter(p, 'picture', 'other_picture'); removeParameter(p, 'score', 'replacement');
  assert.equal(p.ui.components.at(-1)?.assetParameterId, 'other_picture'); assert.equal(parameterUsages(p, 'score').length, 0);
  assert.throws(() => removeParameter(p, 'replacement', 'other_picture'));
});

test('storage follows the same parameter ID across all global readers, while kind change retains repairable references', () => {
  const { p, graph, readers } = fixture();
  changeParameterStorage(p, 'score', true); synchronizeBlueprintSignatures(p);
  for (const index of [0, 1, 4]) assert.equal(blueprintStateVariable(p, graph, readers[index])?.id, 'score');
  assert.equal(readers[2].properties.scope, 'call'); assert.equal(readers[3].properties.scope, 'page');
  assert.equal(readers[4].properties.scope, undefined);
  p.variables[0].setting = { min: 1, max: 10 }; const count = parameterUsages(p, 'score').length;
  changeParameterKind(p, 'score', 'boolean');
  assert.equal(p.variables[0].initial, false); assert.equal(p.variables[0].setting, undefined);
  assert.equal(parameterUsages(p, 'score').length, count);
  assert.ok(validateProject(p).some(issue => issue.message.includes('类型') || issue.message.includes('比较')));
});
