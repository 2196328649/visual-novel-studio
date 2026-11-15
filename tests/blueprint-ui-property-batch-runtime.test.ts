import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlueprintUiPropertyBatchRuntimeFixture } from '../scripts/lib/blueprint-ui-property-batch-runtime-fixture';
import { blueprintUiPropertyDefinition, setBlueprintUiPropertyRows } from '../src/core/blueprint-ui-property-batch';
import { compileProject } from '../src/runtime/compiler';
import { createBlueprintAsyncProgram } from '../src/runtime/blueprint-async-program';
import { uiPropertyWriteExpression } from '../src/runtime/ui-property-batch-runtime';

test('foreground and task compiler evaluate every stable row input before one batch write', () => {
  const f = createBlueprintUiPropertyBatchRuntimeFixture(), before = structuredClone(f.project);
  const compiled = compileProject(f.project);
  assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), []);
  assert.deepEqual(f.project, before);
  const source = Object.values(compiled.files).join('\n');
  assert.match(source, /\$ vn_ui_set_many\("pc_default", \[\("x", 0\.5, "override"\), \("y", [^\n]*vn_ui_get\("pc_default", "x"\)[^\n]*, "override"\), \("text", "同一节点的三项写入", "override"\)\]\)/);
  assert.match(source, /def vn_bp_async_node_pb_worker_/);
  assert.match(source, /vn_ui_set_many\("pc_default", \[\("x", 0\.6, "override"\), \("y", [^\n]*vn_ui_get\("pc_default", "x"\)[^\n]*, "override"\), \("text", "后台已完成批次", "override"\)\]\)/);
  assert.match(source, /vn_ui_set\("pc_default", "text", "旧单项仍可运行", "override"\)/);
});

test('the batch expression emits retained row IDs in authored order after reorder', () => {
  const f = createBlueprintUiPropertyBatchRuntimeFixture(), definition = blueprintUiPropertyDefinition(f.snapshot);
  setBlueprintUiPropertyRows(f.snapshot, [...definition.rows!].reverse());
  const visited: string[] = [];
  const expression = uiPropertyWriteExpression(f.snapshot, pin => { visited.push(pin); return 'input_' + pin + '()'; });
  assert.deepEqual(visited, ['value_row_2', 'value_row_1', 'value_row_0', 'componentId']);
  assert.equal(expression, 'vn_ui_set_many(input_componentId(), [("text", input_value_row_2(), "override"), ("y", input_value_row_1(), "override"), ("x", input_value_row_0(), "override")])');
});

test('malformed definitions reject direct code generation and both project compiler paths', () => {
  for (const kind of ['version', 'json', 'empty', 'unknown', 'mode', 'duplicate'] as const) {
    const f = createBlueprintUiPropertyBatchRuntimeFixture();
    for (const target of [f.snapshot, f.taskBatch]) {
      if (kind === 'version') target.properties.propertyBatchVersion = 99;
      else if (kind === 'json') target.properties.propertyWrites = '{invalid';
      else if (kind === 'empty') target.properties.propertyWrites = '[]';
      else {
        const rows = blueprintUiPropertyDefinition(target).rows!;
        if (kind === 'unknown') rows[0].property = 'deletedProperty';
        if (kind === 'mode') rows[0].writeMode = 'silentlyIgnore';
        if (kind === 'duplicate') rows[1].property = rows[0].property;
        target.properties.propertyWrites = JSON.stringify(rows);
      }
      assert.throws(() => uiPropertyWriteExpression(target, pin => 'input_' + pin), /设置组件属性无效/);
    }
    const original = structuredClone(f.project), compiled = compileProject(f.project);
    assert.ok(compiled.diagnostics.some(issue => issue.severity === 'error'), kind);
    assert.deepEqual(compiled.files, {}, kind);
    assert.deepEqual(f.project, original, kind);
    assert.throws(() => createBlueprintAsyncProgram(f.project, (_graph, _node, pin) => 'input_' + pin), /设置组件属性无效/, kind);
  }
});
