import test from 'node:test';
import assert from 'node:assert/strict';
import { blueprintNodeDefaults } from '../src/core/blueprint';
import { blueprintComparisonOperations, blueprintNodePresentation, blueprintNumericPresentation } from '../src/core/blueprint-presentation';
import { uiProperties } from '../src/core/ui-properties';

test('compact value nodes keep their semantic family without changing pins or defaults', () => {
  for (const type of ['not', 'and', 'or', 'xor', 'math', 'compare', 'select', 'literal'] as const) {
    const node = blueprintNodeDefaults(type), original = structuredClone(node);
    assert.deepEqual(blueprintNodePresentation(node), { family: 'value', compact: true }); assert.deepEqual(node, original);
  }
  assert.equal(blueprintNodePresentation(blueprintNodeDefaults('eventClick')).family, 'event');
  assert.equal(blueprintNodePresentation(blueprintNodeDefaults('callMacro')).family, 'module');
  assert.equal(blueprintNodePresentation(blueprintNodeDefaults('setUiProperty')).family, 'action');
  assert.equal(blueprintNodePresentation(blueprintNodeDefaults('comment')).family, 'annotation');
});
test('boolean and text comparison editors cannot offer numeric ordering', () => {
  assert.deepEqual(Object.keys(blueprintComparisonOperations('boolean')), ['eq', 'ne']);
  assert.deepEqual(Object.keys(blueprintComparisonOperations('string')), ['eq', 'ne']);
  assert.equal(Object.keys(blueprintComparisonOperations('number')).length, 6);
});
test('numeric presentation uses shared property ranges and authored units, not guessed percentages', () => {
  const node = blueprintNodeDefaults('setUiProperty'); node.properties.property = 'opacity';
  assert.deepEqual(blueprintNumericPresentation(node, 'value'), { unit: uiProperties.opacity.unit, min: uiProperties.opacity.min, max: uiProperties.opacity.max, step: 'any' });
  node.properties.property = 'text'; assert.deepEqual(blueprintNumericPresentation(node, 'value'), {});
  assert.deepEqual(blueprintNumericPresentation(blueprintNodeDefaults('delay'), 'seconds'), { min: 0, step: .1, unit: '秒' });
  assert.equal(blueprintNumericPresentation(blueprintNodeDefaults('camera'), 'rotation').unit, '°');
  assert.equal(blueprintNumericPresentation(blueprintNodeDefaults('callFunction'), 'arg_speed').unit, undefined);
});
