import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { createProject, type Project, type UiComponent } from '../src/core/model';
import { moveStoryFlowLayout, storyFlowLayout, type StoryFlowLayout } from '../src/core/story-flow';

// Run after all product changes. The baseline is retained evidence, not executable source in the checkout.
const root = path.resolve('.');
const output = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? 'artifacts/player-flow-fixes-2026-11-13/validation-main');
const baselinePath = path.resolve(process.argv.find(argument => argument.startsWith('--baseline='))?.slice('--baseline='.length)
  ?? 'artifacts/player-flow-fixes-2026-11-13/validation-main/story-flow.before.ts.txt');
const relative = path.relative(root, output);
assert.ok(relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
const baseline = await fs.readFile(baselinePath, 'utf8');
const moduleSource = baseline.replace(/from '(\.\/[^']+)'/g, (_, source: string) => `from '${pathToFileURL(path.resolve(root, 'src/core', source + '.ts')).href}'`);
const javascript = ts.transpileModule(moduleSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const previous = (await import('data:text/javascript;base64,' + Buffer.from(javascript).toString('base64'))).storyFlowLayout as typeof storyFlowLayout;

function fixture(count: number, reversed: boolean, grouped = false) {
  const project = createProject(), sceneId = project.scenes[0].id;
  project.nodes = Array.from({ length: count }, (_, index) => ({ id: `node_${index}`, name: `节点${index}`, sceneId, x: 0, y: 0,
    kind: 'passage' as const, lines: [{ id: `line_${index}`, text: '性能比较台词', actions: [] }], ...(index + 1 < count ? { next: `node_${index + 1}` } : {}) }));
  const entries = project.nodes.map(node => ({ nodeId: node.id }));
  if (reversed) entries.reverse();
  const component: UiComponent = { id: 'map', kind: 'flowchart', page: 'flowchart', text: '', x: 0, y: 0, width: 1, height: 1,
    list: { layout: 'flow', flowContent: { mode: 'custom', custom: { entries,
      ...(grouped ? { groups: Array.from({ length: Math.ceil(count / 10) }, (_, index) => ({
        id: `group_${index}`, name: `分组${index}`, nodeIds: project.nodes.slice(index * 10, index * 10 + 10).map(node => node.id),
      })) } : {}),
    } } } };
  return { project, component };
}

const comparable = (graph: StoryFlowLayout) => ({ ...graph, edges: graph.edges.map(({ endpoints: _endpoints, ...edge }) => edge) });
const measure = (work: () => unknown) => {
  work();
  const samples: number[] = [];
  for (let i = 0; i < 7; i++) { const start = performance.now(); work(); samples.push(performance.now() - start); }
  return { medianMs: [...samples].sort((a, b) => a - b)[3], samplesMs: samples };
};

const cases = [];
for (const count of [100, 300, 600]) for (const reversed of [false, true]) {
  const { project, component } = fixture(count, reversed);
  assert.deepEqual(comparable(storyFlowLayout(project, component)), previous(project, component), 'layout and routes must remain equivalent');
  cases.push({ count, reversed, before: measure(() => previous(project, component)), after: measure(() => storyFlowLayout(project, component)) });
}

// Stable ordering includes merges, self-loops, cycles and arbitrary authored order.
let random = 347912;
const next = () => (random = Math.imul(random, 1664525) + 1013904223 >>> 0) / 2 ** 32;
let equivalenceChecks = 0;
for (let attempt = 0; attempt < 80; attempt++) {
  const { project, component } = fixture(4 + attempt % 19, attempt % 2 === 0, attempt % 5 === 0);
  project.nodes = project.nodes.map(node => ({ ...node, kind: 'choice' as const, prompt: '', choices: Array.from({ length: Math.floor(next() * 4) }, (_, index) => ({
    id: `choice_${index}`, text: `路线${index}`, target: `node_${Math.floor(next() * project.nodes.length)}`,
  })) }));
  component.list!.flowDirection = attempt % 2 ? 'vertical' : 'horizontal';
  component.list!.flowLineStyle = (['elbow', 'curve', 'straight'] as const)[attempt % 3];
  assert.deepEqual(comparable(storyFlowLayout(project, component)), previous(project, component), `geometry/route difference in case ${attempt}`);
  equivalenceChecks++;
}

const { project, component } = fixture(600, true);
const graph = storyFlowLayout(project, component), nodeId = 'node_300', position = { x: 4000, y: 1500 };
const fullDrag = () => {
  const changed = structuredClone(component);
  changed.list!.flowContent!.custom!.positions = { [nodeId]: position };
  return storyFlowLayout(project, changed);
};
const drag = { beforeFullLayout: measure(fullDrag), afterGeometryOnly: measure(() => moveStoryFlowLayout(graph, component, nodeId, position)) };
const full = fullDrag(), moved = moveStoryFlowLayout(graph, component, nodeId, position);
assert.deepEqual(moved.nodes, full.nodes);
assert.deepEqual(moved.edges, full.edges);
assert.deepEqual(moved.locations, full.locations);
await fs.mkdir(output, { recursive: true });
const report = { status: 'passed', baselinePath, baselineSha256: createHash('sha256').update(baseline).digest('hex'), cases, equivalenceChecks, drag,
  scope: '同一进程的合成剧情布局函数测量；不包含React绘制，不代表真实作品整页响应。拖动预览保留开始时画布范围，落盘后重算。', temporaryPaths: [] };
await fs.writeFile(path.join(output, 'layout-performance.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ report: path.join(output, 'layout-performance.json'), cases: cases.map(item => ({ count: item.count, reversed: item.reversed, beforeMs: item.before.medianMs, afterMs: item.after.medianMs })), equivalenceChecks, drag }, null, 2));
