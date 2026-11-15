import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProject, type Project, type StageAction } from '../src/core/model';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { blueprintNodeDefaults, connectBlueprintPins } from '../src/core/blueprint';
import { addProjectGraphs, projectGraphs } from '../src/core/project-resources';
import { createVisualObject } from '../src/core/visual-object';
import { performanceTimeline } from '../src/core/performance-timeline';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { interleaveProjectTimelines } from '../src/core/timeline-interleave';

// Preserve the six in-memory fixtures and measurement order of the 2026-11-14
// sampling-performance.json diagnostic. No real project, GUI or temporary source.
// Counts/results are included so a later run can verify fixture equivalence before
// comparing timings; random authoring IDs are intentionally not a fixture hash.
const timeoutMsPerCase = 10_000, warmupPerOperation = 1, samplesPerOperation = 3;
type Mode = 'text24' | 'calls8';
type Operation = 'performanceTimeline' | 'projectPreview';
type Event = { phase: string; operation?: Operation; index?: number; ms?: number; [key: string]: unknown };
const emit = (event: Event) => console.log(JSON.stringify(event));
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

function timeline(project: Project, actions: StageAction[], name: string) {
  const graph = blueprintFromPerformance(project, actions, name), clips = graph.nodes.filter(node => node.type !== 'event');
  clips.forEach(node => { if (node.type === 'callFunction') node.properties.wait = false; });
  const tail = blueprintNodeDefaults('delay'); tail.properties.seconds = 2; graph.nodes.push(tail);
  const previous = clips.at(-1) ?? graph.nodes[0];
  assert.equal(connectBlueprintPins(graph, previous.id, previous.type === 'event' ? 'exec' : 'exec_out', tail.id, 'exec_in'), undefined);
  graph.timelineComponent = true;
  graph.timeline = {
    tailNodeId: tail.id,
    tracks: clips.map((_, index) => ({ id: 'track_' + index, name: '轨道 ' + index })),
    clips: clips.map((node, index) => ({ nodeId: node.id, trackId: 'track_' + index })),
  };
  addProjectGraphs(project, graph); return graph;
}

function runCase(mode: Mode, libraryGraphs: number) {
  const project = createProject();
  const leaf = timeline(project, [{ ...createVisualObject('text'), text: '库中的字幕', duration: 2 }], '字幕资源');
  for (let index = 0; index < libraryGraphs; index++) {
    timeline(project, Array.from({ length: 4 }, () => ({ kind: 'blueprint', blueprintId: leaf.id })), '未使用资源 ' + index);
  }
  const active = mode === 'text24'
    ? timeline(project, Array.from({ length: 24 }, (_, index) => ({ ...createVisualObject('text'), text: '当前文字 ' + index, duration: 2 })), '当前文字时间轴')
    : timeline(project, Array.from({ length: 8 }, () => ({ kind: 'blueprint', blueprintId: leaf.id })), '当前调用时间轴');
  const sourceHash = () => createHash('sha256').update(JSON.stringify(project)).digest('hex');
  const originalHash = sourceHash();
  const counts = (value: Project) => ({ graphs: projectGraphs(value).length, nodes: projectGraphs(value).reduce((sum, graph) => sum + graph.nodes.length, 0) });
  const started = performance.now(), preparedProject = interleaveProjectTimelines(project), prepareMs = performance.now() - started;
  const authored = counts(project), prepared = counts(preparedProject);
  const activeClips = mode === 'text24' ? 24 : 8, privateCalls = libraryGraphs * 4 + (mode === 'calls8' ? 8 : 0);
  assert.deepEqual(authored, { graphs: libraryGraphs + 2, nodes: libraryGraphs * 6 + activeClips + 5 });
  assert.deepEqual(prepared, { graphs: authored.graphs + privateCalls, nodes: authored.nodes + privateCalls * 3 });
  emit({ phase: 'setup', authored, prepared, generated: { graphs: prepared.graphs - authored.graphs, nodes: prepared.nodes - authored.nodes }, prepareMs, activeClips: active.timeline!.clips.length });
  const operations: Record<Operation, () => Record<string, number>> = {
    performanceTimeline: () => {
      const model = performanceTimeline(project, active);
      assert.equal(model.reason, undefined);
      return { clips: model.clips.length, until: model.until };
    },
    projectPreview: () => {
      const context = previewActionContext(project);
      const actions = expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: active.id }], context);
      assert.equal(context.incomplete, false);
      return { actions: actions.length, visualActions: actions.filter(action => action.kind === 'visual').length };
    },
  };
  for (const phase of ['warmup', 'sample'] as const) {
    const rounds = phase === 'warmup' ? warmupPerOperation : samplesPerOperation;
    for (let index = 0; index < rounds; index++) for (const operation of ['performanceTimeline', 'projectPreview'] as const) {
      const started = performance.now(), result = operations[operation](), ms = performance.now() - started;
      assert.deepEqual(result, operation === 'performanceTimeline' ? { clips: activeClips, until: 2 } : { actions: activeClips + 1, visualActions: activeClips });
      emit({ phase, index, operation, ms, result });
    }
  }
  const sourceUnchanged = sourceHash() === originalHash;
  assert.equal(sourceUnchanged, true); emit({ phase: 'complete', sourceUnchanged });
}

const caseIndex = process.argv.indexOf('--case');
if (caseIndex >= 0) {
  try {
    const mode = process.argv[caseIndex + 1], libraryGraphs = Number(process.argv[caseIndex + 2]);
    assert.ok(mode === 'text24' || mode === 'calls8'); assert.ok([1, 8, 24].includes(libraryGraphs));
    runCase(mode, libraryGraphs);
  } catch (error) { emit({ phase: 'error', error: error instanceof Error ? error.stack : String(error) }); process.exitCode = 1; }
} else {
  const outputIndex = process.argv.indexOf('--output');
  if (outputIndex >= 0 && !process.argv[outputIndex + 1]) throw new Error('--output requires a report path');
  const output = path.resolve(outputIndex >= 0 ? process.argv[outputIndex + 1] : 'artifacts/timeline-workflow-2026-11-14/validation-main/sampling-performance-' + new Date().toISOString().replaceAll(':', '-') + '.json');
  const cases = [];
  const timestamp = new Date().toISOString();
  for (const mode of ['text24', 'calls8'] as const) for (const libraryGraphs of [1, 8, 24]) {
    const child = spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), '--case', mode, String(libraryGraphs)], {
      cwd: path.resolve(fileURLToPath(new URL('..', import.meta.url))), encoding: 'utf8', windowsHide: true, timeout: timeoutMsPerCase, maxBuffer: 1024 * 1024,
    });
    const events: Event[] = [], parseErrors: string[] = [];
    for (const line of (child.stdout ?? '').split(/\r?\n/).filter(Boolean)) {
      try { events.push(JSON.parse(line) as Event); } catch { parseErrors.push(line); }
    }
    const complete = child.status === 0 && events.some(event => event.phase === 'complete') && !parseErrors.length;
    const metrics = Object.fromEntries((['performanceTimeline', 'projectPreview'] as const).map(operation => {
      const samplesMs = events.filter(event => event.phase === 'sample' && event.operation === operation).map(event => event.ms!);
      return [operation, { samplesMs, medianMs: samplesMs.length ? median(samplesMs) : null }];
    }));
    const entry = {
      mode, libraryGraphs, status: complete ? 'complete' : child.error && 'code' in child.error && child.error.code === 'ETIMEDOUT' ? 'timeout' : 'failed',
      exitCode: child.status, signal: child.signal, metrics, events,
      ...(child.error ? { error: String(child.error) } : {}), ...(child.stderr ? { stderr: child.stderr } : {}), ...(parseErrors.length ? { parseErrors } : {}),
    };
    cases.push(entry); console.log(mode + ' / library ' + libraryGraphs + ': ' + entry.status);
  }
  const report = {
    timestamp, node: process.version, platform: process.platform,
    methodology: {
      fixture: 'In-memory synthetic project with one simple two-second text leaf; 1/8/24 unrelated library graphs each contain four immediate leaf calls; active graph has 24 direct texts or eight leaf calls, all at zero on separate rows.',
      operations: { performanceTimeline: 'Current active graph model, including its per-node isolated sampling.', projectPreview: 'expandPreviewActions for the active graph from the original project; includes timelinePlaybackLayout of the full library and playback preparation.' },
      warmupPerOperation, samplesPerOperation, timeoutMsPerCase,
      constraints: 'Each case runs in a separate bounded process. Host workload is not controlled. Preparation-only time is an unwarmed setup observation. Compare setup counts and operation results before comparing against the original in-memory diagnostic; this is not a historical-version benchmark.',
    },
    cases, finishedAt: new Date().toISOString(), status: cases.every(entry => entry.status === 'complete') ? 'complete' : 'failed',
  };
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(output);
  if (report.status !== 'complete') process.exitCode = 1;
}
