import test from 'node:test';
import assert from 'node:assert/strict';
import { blueprintNodeDefaults, blueprintPin, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures, type BlueprintDataType } from '../src/core/blueprint';
import { blueprintActorExpression, blueprintActorExpressionChoices, blueprintActorInputs, createBlueprintActorInputAnalysis } from '../src/core/blueprint-actor-inputs';
import { blueprintNumericPresentation } from '../src/core/blueprint-presentation';
import { unknownBlueprintValue } from '../src/core/blueprint-static-values';
import { validateBlueprints } from '../src/core/blueprint-validation';
import { createProject, projectSchema, type BlueprintNode, type VariableValue } from '../src/core/model';
import { playerPreferences, validPlayerPreference } from '../src/core/preferences';
import { compileProject } from '../src/runtime/compiler';

function fixture() {
  const project = createProject('蓝图字段一致性');
  project.assets = [{ id: 'portrait', name: '立绘', kind: 'image', path: 'portrait.png' }];
  project.characters = [
    { id: 'actor_a', name: '甲', color: '#ffffff', expressions: [{ id: 'a_pose', name: '通常', assetId: 'portrait' }] },
    { id: 'actor_b', name: '乙', color: '#ffffff', expressions: [{ id: 'b_pose', name: '通常', assetId: 'portrait' }] },
  ];
  const graph = createBlueprintGraph('effect', '角色输入'); graph.id = 'actor_inputs';
  const show = blueprintNodeDefaults('showCharacter'); show.id = 'actor_show';
  show.properties.characterId = 'actor_a';
  graph.nodes.push(show); project.blueprints = [graph];
  assert.equal(connectBlueprintPins(graph, graph.nodes[0].id, 'exec', show.id, 'exec_in'), undefined);
  const literal = (id: string, value: VariableValue, type: BlueprintDataType = 'string') => {
    const node = blueprintNodeDefaults('literal'); node.id = id; node.properties.value = value; node.pins[0].dataType = type;
    graph.nodes.push(node); return node;
  };
  const wire = (source: BlueprintNode, pinId: string) => assert.equal(connectBlueprintPins(graph, source.id, 'value', show.id, pinId), undefined);
  return { project, graph, show, literal, wire };
}

test('static actor and expression inputs include pin defaults and retain the authored default reference', () => {
  const { project, graph, show } = fixture();
  delete show.properties.characterId;
  show.pins.find(pin => pin.id === 'characterId')!.defaultValue = 'actor_b';
  show.pins.find(pin => pin.id === 'expressionId')!.defaultValue = 'b_pose';
  const before = JSON.stringify(project), actual = blueprintActorInputs(project, graph, show);
  assert.equal(actual.character?.id, 'actor_b'); assert.equal(actual.characterLinked, false);
  assert.equal(actual.expressionValue, 'b_pose'); assert.deepEqual(actual.problems, []);
  assert.equal(JSON.stringify(project), before);
  assert.deepEqual(validateBlueprints(project).filter(issue => issue.nodeId === show.id && issue.severity === 'error'), []);
});

test('a literal actor wire resolves its actual role and diagnoses retained expressions from the old role', () => {
  const { project, graph, show, literal, wire } = fixture();
  show.properties.expressionId = 'a_pose'; wire(literal('actual_actor', 'actor_b', 'character'), 'characterId');
  const before = JSON.stringify(project), actual = blueprintActorInputs(project, graph, show);
  assert.equal(actual.character?.id, 'actor_b'); assert.equal(actual.characterLinked, true); assert.equal(actual.runtimeCharacter, false);
  assert.match(actual.characterDescription, /乙.*来自/);
  assert.equal(actual.problems.find(issue => issue.pinId === 'expressionId')?.severity, 'error');
  assert.ok(validateBlueprints(project).some(issue => issue.nodeId === show.id && issue.severity === 'error' && /表情.*a_pose.*实际角色.*乙/.test(issue.message)));
  assert.ok(compileProject(project).diagnostics.some(issue => issue.severity === 'error' && issue.nodeId === show.id));
  assert.equal(JSON.stringify(project), before);
  show.properties.expressionId = 'b_pose';
  assert.deepEqual(blueprintActorInputs(project, graph, show).problems, []);
});

test('linked expression values use their expression rather than the saved fallback and survive reload', () => {
  const { project, graph, show, literal, wire } = fixture();
  wire(literal('actual_actor', 'actor_b', 'character'), 'characterId');
  show.properties.expressionId = 'a_pose'; wire(literal('actual_expression', 'b_pose'), 'expressionId');
  synchronizeBlueprintSignatures(project);
  const loaded = projectSchema.parse(JSON.parse(JSON.stringify(project))), loadedGraph = loaded.blueprints[0], loadedShow = loadedGraph.nodes.find(node => node.id === show.id)!;
  assert.equal(blueprintActorInputs(loaded, loadedGraph, loadedShow).expressionValue, 'b_pose');
  assert.deepEqual(blueprintActorInputs(loaded, loadedGraph, loadedShow).problems, []);
  assert.equal(loadedShow.properties.expressionId, 'a_pose');
  const expression = loadedGraph.nodes.find(node => node.id === 'actual_expression')!; expression.properties.value = 'a_pose';
  assert.ok(validateBlueprints(loaded).some(issue => issue.nodeId === loadedShow.id && /表情.*实际角色.*乙/.test(issue.message)));
});

test('external role inputs remain unknown despite defaults, and warn without rewriting fixed expressions', () => {
  const { project, graph, show } = fixture();
  graph.exposedInputs = [blueprintPin('actor', '执行角色', 'input', 'character', 'actor_b')];
  const input = blueprintNodeDefaults('getInput'); input.id = 'role_reader'; input.properties.inputId = 'actor'; input.pins[0].dataType = 'character';
  graph.nodes.push(input); assert.equal(connectBlueprintPins(graph, input.id, 'value', show.id, 'characterId'), undefined);
  show.properties.expressionId = 'a_pose';
  const before = JSON.stringify(project), actual = blueprintActorInputs(project, graph, show);
  assert.equal(actual.character, undefined); assert.equal(actual.characterValue, unknownBlueprintValue); assert.equal(actual.runtimeCharacter, true);
  assert.ok(actual.problems.some(issue => issue.severity === 'warning' && /a_pose/.test(issue.message)));
  const diagnostics = validateBlueprints(project).filter(issue => issue.nodeId === show.id);
  assert.ok(diagnostics.some(issue => issue.code === 'blueprint-actor-expression-runtime' && issue.severity === 'warning'));
  assert.ok(!diagnostics.some(issue => issue.severity === 'error'));
  assert.equal(JSON.stringify(project), before);
  show.properties.expressionId = '';
  assert.deepEqual(blueprintActorInputs(project, graph, show).problems, []);
});

test('pure selection role wires are resolved while live-state role wires stay runtime dependent', () => {
  const { project, graph, show, literal } = fixture();
  const select = blueprintNodeDefaults('select'); select.id = 'chosen_actor';
  select.pins.filter(pin => ['true_value', 'false_value', 'result'].includes(pin.id)).forEach(pin => { pin.dataType = 'character'; });
  select.properties.condition = true; select.properties.true_value = 'actor_b'; select.properties.false_value = 'actor_a';
  graph.nodes.push(select);
  assert.equal(connectBlueprintPins(graph, select.id, 'result', show.id, 'characterId'), undefined);
  assert.equal(blueprintActorInputs(project, graph, show).character?.id, 'actor_b');
  const live = blueprintNodeDefaults('getMinigameValue'); live.id = 'live_role'; live.pins[0].dataType = 'character'; live.properties.defaultValue = 'actor_b'; graph.nodes.push(live);
  assert.equal(connectBlueprintPins(graph, live.id, 'value', show.id, 'characterId'), undefined);
  assert.equal(blueprintActorInputs(project, graph, show).characterValue, unknownBlueprintValue);
  const fixed = literal('fixed_role', 'actor_b', 'character');
  assert.equal(connectBlueprintPins(graph, fixed.id, 'value', show.id, 'characterId'), undefined);
  assert.equal(blueprintActorInputs(project, graph, show).character?.id, 'actor_b');
});

test('expression names shared by roles remain valid and preserved, including inherited expressions', () => {
  const { project, graph, show, literal, wire } = fixture();
  wire(literal('actual_actor', 'actor_b', 'character'), 'characterId'); show.properties.expressionId = '通常';
  let actual = blueprintActorInputs(project, graph, show);
  assert.deepEqual(actual.problems, []); assert.equal(blueprintActorExpression(actual.character!, '通常')?.id, 'b_pose');
  assert.equal(show.properties.expressionId, '通常');
  project.characters.push({ id: 'child', name: '旧关联角色', color: '#ffffff', expressions: [], baseCharacterId: 'actor_b' });
  graph.nodes.find(node => node.id === 'actual_actor')!.properties.value = 'child';
  actual = blueprintActorInputs(project, graph, show);
  assert.deepEqual(actual.problems, []); assert.equal(blueprintActorExpression(actual.character!, '通常')?.id, 'b_pose');
});

test('expression choice labels preserve name-before-ID collisions and the last repeated name', () => {
  const { project, graph, show } = fixture();
  project.characters[0].expressions = [
    { id: 'a_pose', name: '甲表情', assetId: 'portrait' },
    { id: 'b_pose', name: 'a_pose', assetId: 'portrait' },
    { id: 'c_pose', name: '重复名称', assetId: 'portrait' },
    { id: 'd_pose', name: '重复名称', assetId: 'portrait' },
  ];
  show.properties.expressionId = 'a_pose';
  const before = JSON.stringify(project), character = blueprintActorInputs(project, graph, show).character!;
  assert.equal(blueprintActorExpression(character, 'a_pose')?.id, 'b_pose');
  assert.equal(blueprintActorExpression(character, '重复名称')?.id, 'd_pose');
  const choices = blueprintActorExpressionChoices(character, 'a_pose'), selected = choices.filter(choice => choice.value === 'a_pose');
  assert.equal(selected.length, 1); assert.match(selected[0].label, /^a_pose.*名称优先.*b_pose.*原值 a_pose/);
  assert.doesNotMatch(selected[0].label, /甲表情/);
  assert.match(blueprintActorExpressionChoices(character, '重复名称')[0].label, /表情名称引用.*d_pose/);
  assert.deepEqual(blueprintActorInputs(project, graph, show).problems, []);
  assert.equal(JSON.stringify(project), before);
});

test('math-dependent role selections stay unknown across modulo rounding and unsafe integer intermediates', () => {
  const examples = [
    { operation: 'add', a: 3, b: 4, compared: 7, expression: 'b_pose', extraAdd: false },
    { operation: 'modulo', a: .1, b: .3, compared: .1, expression: 'b_pose', extraAdd: false },
    { operation: 'add', a: 9007199254740992, b: 1, compared: 9007199254740992, expression: 'a_pose', extraAdd: false },
    { operation: 'add', a: Number.MAX_SAFE_INTEGER, b: 1, compared: 9007199254740992, expression: 'a_pose', extraAdd: true },
    { operation: 'add', a: 4503599627370496, b: 4503599627370495, compared: Number.MAX_SAFE_INTEGER, expression: 'a_pose', extraAdd: true },
  ];
  for (const example of examples) {
    const { project, graph, show } = fixture();
    const math = blueprintNodeDefaults('math'); math.id = 'calculated_condition'; Object.assign(math.properties, { operation: example.operation, a: example.a, b: example.b }); graph.nodes.push(math);
    let calculated = math;
    if (example.extraAdd) {
      const next = blueprintNodeDefaults('math'); next.id = 'next_calculation'; next.properties.b = 1; graph.nodes.push(next);
      assert.equal(connectBlueprintPins(graph, math.id, 'result', next.id, 'a'), undefined); calculated = next;
    }
    const compare = blueprintNodeDefaults('compare'); compare.id = 'compared_condition'; compare.properties.b = example.compared; graph.nodes.push(compare);
    assert.equal(connectBlueprintPins(graph, calculated.id, 'result', compare.id, 'a'), undefined);
    const select = blueprintNodeDefaults('select'); select.id = 'chosen_role'; select.properties.true_value = 'actor_b'; select.properties.false_value = 'actor_a';
    select.pins.filter(pin => ['true_value', 'false_value', 'result'].includes(pin.id)).forEach(pin => { pin.dataType = 'character'; }); graph.nodes.push(select);
    assert.equal(connectBlueprintPins(graph, compare.id, 'result', select.id, 'condition'), undefined);
    assert.equal(connectBlueprintPins(graph, select.id, 'result', show.id, 'characterId'), undefined);
    show.properties.expressionId = example.expression;
    const before = JSON.stringify(project), actual = blueprintActorInputs(project, graph, show);
    assert.equal(actual.characterValue, unknownBlueprintValue); assert.equal(actual.runtimeCharacter, true);
    assert.ok(actual.problems.some(issue => issue.code === 'blueprint-actor-expression-runtime' && issue.severity === 'warning'));
    assert.ok(!validateBlueprints(project).some(issue => issue.nodeId === show.id && issue.severity === 'error'));
    assert.equal(JSON.stringify(project), before);
  }
});

test('unsafe numeric primitive defaults and literals cannot select a falsely known role', () => {
  for (const sourceKind of ['property', 'pinDefault', 'literal'] as const) {
    const { project, graph, show, literal } = fixture();
    const compare = blueprintNodeDefaults('compare'); compare.id = 'unsafe_comparison'; compare.properties.operator = 'gt'; compare.properties.b = 0;
    if (sourceKind === 'property') compare.properties.a = 9007199254740992;
    if (sourceKind === 'pinDefault') compare.pins.find(pin => pin.id === 'a')!.defaultValue = 9007199254740992;
    graph.nodes.push(compare);
    if (sourceKind === 'literal') assert.equal(connectBlueprintPins(graph, literal('unsafe_literal', 9007199254740992, 'number').id, 'value', compare.id, 'a'), undefined);
    const select = blueprintNodeDefaults('select'); select.id = 'chosen_role'; select.properties.true_value = 'actor_b'; select.properties.false_value = 'actor_a';
    select.pins.filter(pin => ['true_value', 'false_value', 'result'].includes(pin.id)).forEach(pin => { pin.dataType = 'character'; }); graph.nodes.push(select);
    assert.equal(connectBlueprintPins(graph, compare.id, 'result', select.id, 'condition'), undefined);
    assert.equal(connectBlueprintPins(graph, select.id, 'result', show.id, 'characterId'), undefined); show.properties.expressionId = 'a_pose';
    const before = JSON.stringify(project), actual = blueprintActorInputs(project, graph, show);
    assert.equal(actual.characterValue, unknownBlueprintValue); assert.ok(!actual.problems.some(issue => issue.severity === 'error'));
    assert.equal(JSON.stringify(project), before);
  }
});

test('numeric operation dependencies stay runtime dependent without changing their shared evaluator', () => {
  for (const [type, outputType] of [['clamp', 'number'], ['abs', 'number'], ['round', 'number'], ['inRange', 'boolean'], ['nearlyEqual', 'boolean'], ['mapRange', 'number'], ['lerp', 'number']] as const) {
    const { project, graph, show } = fixture();
    const numeric = blueprintNodeDefaults(type); numeric.id = 'numeric_condition'; graph.nodes.push(numeric);
    const select = blueprintNodeDefaults('select'); select.id = 'chosen_role'; select.properties.true_value = 'actor_b'; select.properties.false_value = 'actor_a';
    select.pins.filter(pin => ['true_value', 'false_value', 'result'].includes(pin.id)).forEach(pin => { pin.dataType = 'character'; }); graph.nodes.push(select);
    if (outputType === 'boolean') assert.equal(connectBlueprintPins(graph, numeric.id, 'result', select.id, 'condition'), undefined);
    else {
      const compare = blueprintNodeDefaults('compare'); compare.id = 'compared_condition'; compare.properties.b = 0; graph.nodes.push(compare);
      assert.equal(connectBlueprintPins(graph, numeric.id, 'result', compare.id, 'a'), undefined);
      assert.equal(connectBlueprintPins(graph, compare.id, 'result', select.id, 'condition'), undefined);
    }
    assert.equal(connectBlueprintPins(graph, select.id, 'result', show.id, 'characterId'), undefined); show.properties.expressionId = 'a_pose';
    const before = JSON.stringify(project), actual = blueprintActorInputs(project, graph, show);
    assert.equal(actual.characterValue, unknownBlueprintValue); assert.match(actual.characterDescription, /来自.*执行时确定/);
    assert.ok(actual.problems.some(issue => issue.severity === 'warning')); assert.ok(!actual.problems.some(issue => issue.severity === 'error'));
    assert.equal(JSON.stringify(project), before);
  }
});

test('preset controls follow the preset wire, not the x wire, and validate known role-specific presets', () => {
  const { project, graph, show, literal, wire } = fixture();
  wire(literal('x_position', .9, 'number'), 'x');
  assert.equal(blueprintActorInputs(project, graph, show).presetLinked, false);
  show.properties.presetId = 'left'; wire(literal('actual_preset', 'center'), 'presetId');
  let actual = blueprintActorInputs(project, graph, show);
  assert.equal(actual.presetLinked, true); assert.equal(actual.presetValue, 'center'); assert.ok(actual.presetSourceLabel);
  assert.equal(show.properties.presetId, 'left');
  graph.nodes.find(node => node.id === 'actual_preset')!.properties.value = 'missing_custom';
  actual = blueprintActorInputs(project, graph, show);
  assert.ok(actual.problems.some(issue => issue.pinId === 'presetId' && issue.severity === 'error'));
});

test('missing literal roles are diagnosed without silently selecting a role or clearing the expression', () => {
  const { project, graph, show, literal, wire } = fixture();
  wire(literal('missing_role', 'gone', 'character'), 'characterId'); show.properties.expressionId = 'a_pose';
  const before = JSON.stringify(project), actual = blueprintActorInputs(project, graph, show);
  assert.equal(actual.character, undefined); assert.equal(actual.runtimeCharacter, false);
  assert.ok(actual.problems.some(issue => issue.pinId === 'characterId' && /gone/.test(issue.message)));
  assert.equal(JSON.stringify(project), before);
});

test('cyclic or excessively deep role expressions conservatively stay unknown without rewriting data', () => {
  const { project, graph, show } = fixture();
  const select = blueprintNodeDefaults('select'); select.id = 'cycle_role'; select.properties.condition = true;
  graph.nodes.push(select);
  graph.links.push({ id: 'role_wire', fromNodeId: select.id, fromPinId: 'result', toNodeId: show.id, toPinId: 'characterId' });
  graph.links.push({ id: 'cycle_wire', fromNodeId: select.id, fromPinId: 'result', toNodeId: select.id, toPinId: 'true_value' });
  assert.equal(blueprintActorInputs(project, graph, show).characterValue, unknownBlueprintValue);
  graph.links = graph.links.filter(link => link.id !== 'cycle_wire');
  let previous = select;
  for (let index = 0; index < 300; index++) {
    const next = blueprintNodeDefaults('select'); next.id = 'deep_role_' + index; next.properties.condition = true; next.properties.true_value = 'actor_b'; graph.nodes.push(next);
    graph.links.push({ id: 'deep_wire_' + index, fromNodeId: next.id, fromPinId: 'result', toNodeId: previous.id, toPinId: 'true_value' });
    previous = next;
  }
  const before = JSON.stringify(project);
  assert.equal(blueprintActorInputs(project, graph, show).characterValue, unknownBlueprintValue);
  assert.equal(JSON.stringify(project), before);
});

test('one immutable analysis shares field results and a new snapshot cannot reuse stale role data', () => {
  const { project, graph, show, literal, wire } = fixture();
  wire(literal('actual_actor', 'actor_b', 'character'), 'characterId');
  const analysis = createBlueprintActorInputAnalysis(project), first = analysis(graph, show);
  assert.equal(analysis(graph, show), first);
  const nextProject = structuredClone(project), nextGraph = nextProject.blueprints[0], nextShow = nextGraph.nodes.find(node => node.id === show.id)!;
  nextGraph.nodes.find(node => node.id === 'actual_actor')!.properties.value = 'actor_a';
  assert.equal(createBlueprintActorInputAnalysis(nextProject)(nextGraph, nextShow).character?.id, 'actor_a');
  assert.equal(first.character?.id, 'actor_b');
});

test('blueprint preference editing uses engine limits and common steps while accepting authored large values', () => {
  const { project, graph } = fixture();
  for (const [preference, value] of [['textSpeed', 1000], ['autoForwardTime', 60]] as const) {
    const node = blueprintNodeDefaults('setPlayerPreference'); node.id = 'set_' + preference; node.properties.preference = preference; node.properties.value = value; graph.nodes.push(node);
    const before = JSON.stringify(node), presentation = blueprintNumericPresentation(node, 'value');
    assert.equal(presentation.min, 0); assert.equal(presentation.max, undefined); assert.equal(presentation.step, playerPreferences[preference].step);
    assert.equal(validPlayerPreference(preference, value), true); assert.equal(JSON.stringify(node), before);
    assert.ok(!validateBlueprints(project).some(issue => issue.nodeId === node.id && issue.severity === 'error'));
  }
  const volume = blueprintNodeDefaults('setPlayerPreference'); volume.properties.preference = 'musicVolume';
  assert.equal(blueprintNumericPresentation(volume, 'value').max, 1);
  assert.equal(validPlayerPreference('textSpeed', -1), false);
  assert.equal(validPlayerPreference('autoForwardTime', Infinity), false);
});

test('actor scale and layer share unrestricted legal numeric presentation while layer stays integral', () => {
  const { project, graph, show } = fixture();
  assert.deepEqual(blueprintNumericPresentation(show, 'scale'), { step: .05 });
  assert.deepEqual(blueprintNumericPresentation(show, 'layer'), { step: 1 });
  for (const [scale, layer] of [[6, 150], [.01, -10], [-1, 200]]) {
    Object.assign(show.properties, { scale, layer });
    const before = JSON.stringify(project);
    assert.ok(!validateBlueprints(project).some(issue => issue.nodeId === show.id && issue.severity === 'error'));
    assert.equal(JSON.stringify(project), before);
  }
  show.properties.layer = 1.5;
  assert.ok(validateBlueprints(project).some(issue => issue.nodeId === show.id && issue.severity === 'error' && /层级/.test(issue.message)));
  assert.equal(graph.nodes.find(node => node.id === show.id)!.properties.layer, 1.5);
});
