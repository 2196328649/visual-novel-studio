import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema } from '../src/core/model';
import { cloneData, mutateProject, projectEditSnapshot, projectReadSnapshot } from '../src/core/project-mutation';
import { sameProjectValue, shareProjectBranches, singleProjectChange } from '../src/core/project-history';
import { addParameter, createParameterControl, gameParametersId } from '../src/core/parameter-sets';
import { addInteractionBlueprintExample } from '../src/core/blueprint-examples';
import { createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';

test('small edits preserve previous snapshots and unrelated project branches', () => {
  const before = createProject(), original = structuredClone(before);
  const after = mutateProject(before, draft => { draft.ui.fontSize = 48; });
  assert.deepEqual(before, original);
  assert.equal(after.ui.fontSize, 48);
  assert.notEqual(after.ui, before.ui);
  for (const key of ['nodes', 'assets', 'characters', 'blueprints', 'scenes'] as const) assert.equal(after[key], before[key]);
  const second = mutateProject(after, draft => { draft.ui.textColor = '#ffccaa'; });
  assert.equal(second.ui.fontSize, 48);
  assert.notEqual(second.ui.textColor, after.ui.textColor);
  assert.deepEqual(structuredClone(second), second);
  assert.deepEqual(projectSchema.parse(second), second);
});

test('no-op transactions keep identity and failures do not change the document', () => {
  const before = createProject(), original = structuredClone(before);
  assert.equal(mutateProject(before, draft => { draft.name = before.name; }), before);
  assert.throws(() => mutateProject(before, draft => { draft.name = 'discard'; draft.nodes.length = 0; throw Error('invalid edit'); }), /invalid edit/);
  assert.deepEqual(before, original);
  assert.equal(shareProjectBranches(before, mutateProject(before, draft => { draft.assets = [...draft.assets]; })), before);
});

test('draft copies include pending changes without leaking proxies or sharing mutable copies', () => {
  const before = createProject();
  const after = mutateProject(before, draft => {
    draft.ui.fontSize = 42;
    const ui = cloneData(draft.ui);
    const mixed = cloneData({ entries: [draft.ui], name: draft.name });
    assert.equal(ui.fontSize, 42);
    assert.equal(mixed.entries[0].fontSize, 42);
    ui.fontSize = 50; mixed.entries[0].fontSize = 60;
    assert.equal(draft.ui.fontSize, 42);
    draft.ui = ui;
  });
  assert.equal(after.ui.fontSize, 50);
  assert.notEqual(before.ui.fontSize, 50);
  assert.deepEqual(structuredClone(after), after);
});

test('copy helpers retain native cloning errors and ordinary value types', () => {
  const value = { date: new Date(1234), bytes: new Uint8Array([1, 2]), map: new Map([['a', 1]]) };
  assert.deepEqual(cloneData(value), value);
  assert.notEqual(cloneData(value).bytes, value.bytes);
  assert.throws(() => cloneData({ callback: () => undefined }), { name: 'DataCloneError' });
});

test('existing parameter and blueprint operations produce the same data inside transactions', () => {
  const before = createProject();
  const withExample = mutateProject(before, draft => { addInteractionBlueprintExample(draft); synchronizeBlueprintSignatures(draft); });
  const after = mutateProject(withExample, draft => {
    const id = addParameter(draft, gameParametersId, 'string');
    createParameterControl(draft, id);
    const first = draft.blueprints[0];
    const duplicate = cloneData(first); duplicate.id = 'copied_graph'; duplicate.name += ' copy';
    draft.blueprints.push(duplicate);
    synchronizeBlueprintSignatures(draft);
  });
  assert.equal(before.blueprints.length, 0);
  assert.equal(after.blueprints.length, withExample.blueprints.length + 1);
  assert.equal(withExample.variables.some(item => after.variables.at(-1)?.id === item.id), false);
  assert.deepEqual(projectSchema.parse(after), after);
  assert.doesNotThrow(() => structuredClone(after));
});

test('array edits and property deletion leave their prior history snapshots intact', () => {
  const before = createProject();
  before.assets = ['a', 'b', 'c'].map(id => ({ id, name: id, kind: 'image', path: `assets/${id}.png`, sourcePath: id }));
  const after = mutateProject(before, draft => {
    draft.assets.reverse(); draft.assets.splice(1, 1); delete draft.assets[0].sourcePath;
  });
  assert.deepEqual(before.assets.map(item => item.id), ['a', 'b', 'c']);
  assert.deepEqual(after.assets.map(item => item.id), ['c', 'a']);
  assert.equal(after.assets[0].sourcePath, undefined);
  assert.equal(before.assets[2].sourcePath, 'c');
  assert.equal(after.assets[1], before.assets[0]);
});

test('typing grouping identifies a single field and separates other fields or collection operations', () => {
  const before = createProject();
  const one = mutateProject(before, draft => { draft.ui.fontSize = 42; });
  const two = mutateProject(one, draft => { draft.ui.fontSize = 44; });
  assert.equal(singleProjectChange(before, one), singleProjectChange(one, two));
  assert.notEqual(singleProjectChange(before, one), singleProjectChange(before, mutateProject(before, draft => { draft.name += '2'; })));
  assert.equal(singleProjectChange(before, mutateProject(before, draft => { draft.name += '2'; draft.ui.fontSize = 42; })), undefined);
  assert.equal(singleProjectChange(before, mutateProject(before, draft => { draft.nodes.pop(); })), undefined);
  assert.equal(sameProjectValue({ optional: undefined }, {}), true);
  assert.equal(sameProjectValue({ value: 0 }, { value: -0 }), true);
  assert.equal(sameProjectValue({ value: undefined }, { value: null }), false);
});


test('transaction snapshots share untouched resources and include stable pending edits', () => {
  const before = createProject();
  before.blueprints.push(createBlueprintGraph('function', '第一张'), createBlueprintGraph('function', '另一张'));
  const after = mutateProject(before, draft => {
    const start = projectEditSnapshot(draft);
    assert.equal(start, before);
    draft.blueprints[0].nodes[0].name = '修改事件';
    const captured = projectReadSnapshot(draft);
    assert.equal(captured.assets, before.assets);
    assert.equal(captured.ui, before.ui);
    assert.equal(captured.nodes, before.nodes);
    assert.equal(captured.blueprints[1], before.blueprints[1]);
    assert.equal(captured.blueprints[0].links, before.blueprints[0].links);
    assert.equal(captured.blueprints[0].nodes[0].name, '修改事件');
    draft.blueprints[0].nodes[0].name = '稍后修改';
    assert.equal(captured.blueprints[0].nodes[0].name, '修改事件');
    assert.doesNotThrow(() => structuredClone(captured));
  });
  assert.equal(after.blueprints[0].nodes[0].name, '稍后修改');
  assert.equal(before.blueprints[0].nodes[0].name, '事件开始');
});

test('pre-edit captures include materialized graphs without sharing their later raw mutations', () => {
  const before = createProject();
  mutateProject(before, draft => {
    const graph = createBlueprintGraph('function', '刚物化的演出');
    draft.blueprints.push(graph);
    const captured = projectEditSnapshot(draft);
    assert.equal(captured.blueprints.length, 1);
    draft.blueprints[0].nodes[0].x = 900;
    draft.blueprints[0].nodes[0].name = '随后编辑';
    assert.notEqual(captured.blueprints[0].nodes[0].x, 900);
    assert.equal(captured.blueprints[0].nodes[0].name, '事件开始');
    assert.equal(captured.assets, before.assets);
    assert.doesNotThrow(() => structuredClone(captured));
  });
  assert.equal(before.blueprints.length, 0);
});

test('plain read snapshots preserve identity but edit snapshots defend mutable callers', () => {
  const project = createProject();
  assert.equal(projectReadSnapshot(project), project);
  const snapshot = projectEditSnapshot(project);
  project.ui.fontSize = 90;
  project.blueprints.push(createBlueprintGraph('function', '新增'));
  assert.notEqual(snapshot.ui.fontSize, 90);
  assert.equal(snapshot.blueprints.length, 0);
});
