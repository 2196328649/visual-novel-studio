import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { PNG } from 'pngjs';
import { projectSchema, type Project } from '../src/core/model';
import { mutateProject } from '../src/core/project-mutation';
import { shareProjectBranches } from '../src/core/project-history';
import { pngMetadata } from '../src/desktop/png-metadata';
import { pngMetadataAsync, disposeImageMetadataWorkers } from '../src/desktop/image-metadata-worker-pool';

const output = path.resolve('artifacts/project-edits', new Date().toISOString().replaceAll(':', '-'));
const template = projectSchema.parse(JSON.parse(await fs.readFile('resources/templates/aihong/project.vns.json', 'utf8')));
const rounds = 80;
const edit = (draft: Project) => { draft.ui.components[0].text = '修改后的界面文字'; };
const timings = (run: () => Project) => {
  for (let index = 0; index < 8; index++) run();
  const samples = Array.from({ length: rounds }, () => { const start = performance.now(); run(); return performance.now() - start; }).sort((a, b) => a - b);
  return { medianMs: samples[Math.floor(samples.length / 2)], p95Ms: samples[Math.floor(samples.length * .95)], maxMs: samples.at(-1) };
};
const projects = [500, 5000].map(lines => {
  const project = structuredClone(template);
  const passage = project.nodes.find(node => node.kind === 'passage');
  assert.ok(passage?.kind === 'passage');
  const line = passage.lines[0]; assert.ok(line);
  passage.lines = Array.from({ length: lines }, (_, index) => ({ ...structuredClone(line), id: `benchmark_line_${index}`, text: `第 ${index} 句用于测量编辑时的数据更新成本。` }));
  const original = JSON.stringify(project);
  const cloneAndShare = () => { const next = structuredClone(project); edit(next); return shareProjectBranches(project, next); };
  const copyChangedBranches = () => shareProjectBranches(project, mutateProject(project, edit));
  assert.deepEqual(copyChangedBranches(), cloneAndShare());
  const baseline = timings(cloneAndShare), optimized = timings(copyChangedBranches);
  assert.equal(JSON.stringify(project), original);
  return { lines, projectBytes: Buffer.byteLength(original), rounds, baseline, optimized };
});

async function eventLoopDuring(work: () => Promise<unknown>) {
  let previous = performance.now(), maximumGapMs = 0, ticks = 0;
  const interval = setInterval(() => { const now = performance.now(); maximumGapMs = Math.max(maximumGapMs, now - previous); previous = now; ticks++; }, 5);
  await delay(15);
  const start = performance.now();
  try {
    await work();
    const elapsedMs = performance.now() - start;
    await delay(15);
    return { elapsedMs, maximumGapMs, ticks };
  } finally { clearInterval(interval); }
}

try {
  const png = new PNG({ width: 2048, height: 2048 }); png.data.fill(255);
  const bytes = PNG.sync.write(png);
  const expected = pngMetadata(bytes);
  assert.deepEqual(await pngMetadataAsync(bytes), expected);
  const baseline = await eventLoopDuring(async () => { for (let index = 0; index < 3; index++) pngMetadata(bytes); });
  const optimized = await eventLoopDuring(async () => { for (let index = 0; index < 3; index++) assert.deepEqual(await pngMetadataAsync(bytes), expected); });
  const report = { status: 'passed', measuredAt: new Date().toISOString(), node: process.version,
    scope: 'Data-update microbenchmark; UI latency is measured separately in verify-ui-responsiveness.',
    projects, images: { width: 2048, height: 2048, count: 3, baseline, optimized } };
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report)); console.log(output);
} finally { disposeImageMetadataWorkers(); }
