import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { BlueprintViewCache } from '../src/renderer/blueprint-view';
import { BlueprintViewBaseline } from './lib/blueprint-view-baseline';
import { createBlueprintPerformanceFixture, createBlueprintExecutionPerformanceFixture, blueprintPerformanceSizes, editPerformanceNode } from './lib/blueprint-performance-fixture';
import { mutateProject } from '../src/core/project-mutation';
import { synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { previewActionContext, expandPreviewActions } from '../src/core/preview-actions';
import { BlueprintTraceRecorder } from '../src/core/blueprint-trace';
import type { Project } from '../src/core/model';

const output = path.resolve('artifacts/blueprint-pipeline-performance', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const rounds = 50, warmups = 8;
const noop = () => {}, collapsed = new Set<string>();
const summarize = (samples: number[]) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return { samples: samples.length, medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))], maxMs: sorted.at(-1) };
};
function measure<T>(run: () => T) {
  for (let index = 0; index < warmups; index++) run();
  const heapBefore = process.memoryUsage().heapUsed, samples: number[] = [];
  for (let index = 0; index < rounds; index++) { const started = performance.now(); run(); samples.push(performance.now() - started); }
  return { ...summarize(samples), heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore };
}
const report: Record<string, unknown> = { status: 'running', node: process.version, rounds, warmups, notes: [
  'The frozen baseline is the pre-PERF-01 view algorithm, not a previously released application.',
  'Both paths use the identical authored fixture and current node definitions. No timing ratio is an acceptance threshold.',
  'Heap deltas are observational (GC is not forced), not retained-memory or leak measurements.',
], editing: [], preview: [] };
try {
  for (const size of blueprintPerformanceSizes) {
    const f = createBlueprintPerformanceFixture(size), original = JSON.stringify(f.project);
    const change = (draft: Project) => editPerformanceNode(draft, f.editable.id, node => { node.properties.a = 12.75; });
    const full = () => mutateProject(f.project, draft => { change(draft); synchronizeBlueprintSignatures(draft); });
    const incremental = () => mutateProject(f.project, draft => { change(draft); synchronizeBlueprintSignatures(draft, f.project); });
    const edited = incremental(); assert.deepEqual(edited, full()); assert.equal(edited.blueprints[1], f.project.blueprints[1]);
    const moved = mutateProject(f.project, draft => { editPerformanceNode(draft, f.editable.id, node => { node.x += 48; }); synchronizeBlueprintSignatures(draft, f.project); });
    const linked = mutateProject(f.project, draft => { draft.blueprints[0].links.push({ id: 'perf_connection', fromNodeId: f.source.id, fromPinId: 'value', toNodeId: f.target.id, toPinId: 'a' }); synchronizeBlueprintSignatures(draft, f.project); });
    const unrelated = mutateProject(f.project, draft => { draft.blueprints[1].nodes[1].properties.b = 900; synchronizeBlueprintSignatures(draft, f.project); });
    const phases: Record<string, unknown> = {};
    for (const [name, next, expected] of [['parameter', edited, 1], ['movement', moved, 0], ['connection', linked, 1], ['unrelatedGraph', unrelated, 0]] as const) {
      const baseline = new BlueprintViewBaseline(), optimized = new BlueprintViewCache({ assumeImmutable: true });
      baseline.update(f.project, f.graph, [], noop, collapsed, noop);
      const before = optimized.update(f.project, f.graph, [], noop, collapsed, noop);
      const after = optimized.update(next, next.blueprints[0], [], noop, collapsed, noop);
      const rebuilt = after.filter((row, index) => row.data !== before[index].data).length;
      assert.equal(rebuilt, expected, name + ': only affected node content may rebuild');
      assert.equal(optimized.stats.defensiveCopies, 0);
      const stats = optimized.stats;
      const baselineResult = baseline.update(next, next.blueprints[0], [], noop, collapsed, noop);
      assert.deepEqual(after.map(row => [row.data.summary, [...row.data.inputSources]]), baselineResult.map(row => [row.data.summary, [...row.data.inputSources]]));
      const cycle = (cache: BlueprintViewCache | BlueprintViewBaseline) => () => {
        cache.update(f.project, f.graph, [], noop, collapsed, noop);
        cache.update(next, next.blueprints[0], [], noop, collapsed, noop);
      };
      // Alternate order by size to avoid always warming the optimized path second.
      const timings: Record<string, unknown> = {};
      for (const kind of (size === 200 ? ['optimized', 'baseline'] : ['baseline', 'optimized'])) timings[kind] = measure(cycle(kind === 'baseline' ? baseline : optimized));
      phases[name] = { rebuilds: rebuilt, stats, roundTripUpdates: 2, ...timings };
    }
    (report.editing as unknown[]).push({ nodes: size, links: f.graph.links.length, fixtureSha256: createHash('sha256').update(original).digest('hex'), bytes: Buffer.byteLength(original), transaction: { full: measure(full), incremental: measure(incremental) }, phases });
    assert.equal(JSON.stringify(f.project), original);

    const execution = createBlueprintExecutionPerformanceFixture(size), executionBefore = JSON.stringify(execution.project);
    const run = (trace: boolean) => {
      const context = previewActionContext(execution.project);
      if (trace) context.trace = new BlueprintTraceRecorder();
      expandPreviewActions(execution.project, [{ kind: 'blueprint', blueprintId: execution.graph.id }], context);
      assert.equal(context.incomplete, false); assert.equal(context.variables.perf_result, execution.expected);
      return context;
    };
    const plain = run(false), traced = run(true);
    assert.deepEqual(traced.variables, plain.variables);
    (report.preview as unknown[]).push({ nodes: size, executedActions: execution.expected, withoutTrace: measure(() => run(false)), withTrace: measure(() => run(true)), traceEntries: traced.trace!.snapshot().entries.length });
    assert.equal(JSON.stringify(execution.project), executionBefore);
  }
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error); process.exitCode = 1; }
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
console.log(output);
