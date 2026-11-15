import test from 'node:test';
import assert from 'node:assert/strict';
import { blueprintPerformanceSizes, createBlueprintPerformanceFixture, createBlueprintExecutionPerformanceFixture } from '../scripts/lib/blueprint-performance-fixture';
import { projectSchema, targets } from '../src/core/model';
import { previewUiLogic } from '../src/core/ui-logic-preview';
import { compileProject } from '../src/runtime/compiler';

for (const size of blueprintPerformanceSizes) {
  test(size + ' node performance fixtures have deterministic source, real story links and complete execution', () => {
    const editor = createBlueprintPerformanceFixture(size), f = createBlueprintExecutionPerformanceFixture(size);
    assert.deepEqual(createBlueprintPerformanceFixture(size).project, editor.project);
    assert.deepEqual(createBlueprintExecutionPerformanceFixture(size).project, f.project);
    assert.equal(editor.graph.nodes.length, size); assert.equal(f.graph.nodes.length, size);
    for (const project of [editor.project, f.project]) {
      projectSchema.parse(project);
      assert.deepEqual(compileProject(project).diagnostics.filter(issue => issue.severity === 'error'), []);
      const start = project.nodes.find(node => node.id === project.entryId)!;
      assert.deepEqual(targets(start), [{ port: 'next', target: 'perf_passage' }]);
      assert.deepEqual(targets(project.nodes.find(node => node.id === 'perf_passage')!), [{ port: 'next', target: 'perf_end' }]);
    }
    const before = structuredClone(f.project);
    const result = previewUiLogic(f.project, f.page.components, f.page.id, {}, [{ kind: 'click', componentId: f.button.id }], { trace: true });
    assert.equal(result.variables.perf_result, f.expected); assert.equal(result.exhausted, false); assert.equal(result.incomplete, false);
    assert.deepEqual(f.project, before);
  });
}