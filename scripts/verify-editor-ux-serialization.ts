import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire, Module } from 'node:module';
import { build } from 'esbuild';
import { createProject, type Project } from '../src/core/model';

// Run after the completed implementation. Both serializers use the same current
// dependencies; only the precisely preserved projectToText implementation varies.
const root = path.resolve('.');
const output = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? 'artifacts/editor-ux-2026-11-12');
const baselineFile = path.join(output, 'serialization-baseline.ts.txt');
const currentFile = path.join(root, 'src/core/text-script.ts');
const digest = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const require = createRequire(import.meta.url);
async function serializer(contents: string, variant: string): Promise<(project: Project) => string> {
  const filename = path.join(root, 'src/core', `text-script-${variant}.cjs`);
  const result = await build({ stdin: { contents, resolveDir: path.join(root, 'src/core'), sourcefile: filename + '.ts', loader: 'ts' },
    bundle: true, platform: 'node', target: 'node22', format: 'cjs', write: false, logLevel: 'silent' });
  const compiled = new Module(filename);
  compiled.filename = filename;
  compiled.require = require;
  (compiled as unknown as { _compile(code: string, filename: string): void })._compile(result.outputFiles[0].text, filename);
  return compiled.exports.projectToText;
}
function largeProject(): Project {
  const project = createProject('多章节序列化样本');
  project.chapters = Array.from({ length: 40 }, (_, i) => ({ id: `chapter_${i}`, name: `第${i}章` }));
  project.scenes = Array.from({ length: 400 }, (_, i) => ({ id: `scene_${i}`, name: `小章节${i}`, chapterId: `chapter_${i % 40}` }));
  project.characters = Array.from({ length: 500 }, (_, i) => ({ id: `actor_${i}`, name: `角色${i}`, color: '#ffffff', expressions: [] }));
  project.assets = Array.from({ length: 1000 }, (_, i) => ({ id: `audio_${i}`, name: `配音${i}`, kind: 'audio', path: `sound_${i}.wav` }));
  project.nodes = Array.from({ length: 4000 }, (_, i) => ({ id: `passage_${i}`, name: `段落${i}`, kind: 'passage', sceneId: `scene_${i % 400}`, x: 0, y: 0,
    next: i < 3999 ? `passage_${i + 1}` : undefined,
    lines: Array.from({ length: 3 }, (_, j) => ({ id: `line_${i}_${j}`, text: `第${i}段第${j}句。中文标点、换行和 emoji 😀。`,
      speakerId: `actor_${(i + j) % 500}`, voiceId: `audio_${(i * 3 + j) % 1000}`, actions: [] })) }));
  project.entryId = 'passage_0';
  return project;
}
const summary = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: values.length, medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))], samplesMs: values };
};
const baselineSection = await fs.readFile(baselineFile, 'utf8'), newSource = await fs.readFile(currentFile, 'utf8');
const start = newSource.indexOf('function firstById'), end = newSource.indexOf('export function importedTextProject');
assert.ok(start >= 0 && end > start);
const oldSource = newSource.slice(0, start) + baselineSection.trimEnd() + '\n\n' + newSource.slice(end);
assert.ok(!baselineSection.includes('function firstById'), 'Baseline must contain the pre-change implementation.');
assert.ok(newSource.includes('function firstById'), 'Run against the completed indexed serializer.');
const [before, after] = await Promise.all([serializer(oldSource, 'before'), serializer(newSource, 'after')]);
const sourceFiles = [path.resolve('../我的视觉小说1/project.vns.json'), path.resolve('resources/templates/aihong/project.vns.json')];
const sources = await Promise.all(sourceFiles.map(async file => { const bytes = await fs.readFile(file); return { file, sha256: digest(bytes), project: JSON.parse(bytes.toString('utf8')) as Project }; }));
const cases = [...sources, { file: 'synthetic:40chapters/400scenes/4000passages/12000lines', sha256: '', project: largeProject() }];
const results: Record<string, unknown>[] = [];
for (const { file, project } of cases) {
  const expected = before(project), actual = after(project);
  assert.equal(actual, expected, `${file}: exact exported text must be unchanged`);
  for (let i = 0; i < 4; i++) { before(project); after(project); }
  const samples = { before: [] as number[], after: [] as number[] };
  for (let batch = 0; batch < 8; batch++) for (const variant of ['before', 'after', 'after', 'before'] as const) {
    const start = performance.now();
    const text = (variant === 'before' ? before : after)(project);
    samples[variant].push(performance.now() - start);
    assert.equal(text, expected);
  }
  const result = { file, chapters: project.chapters.length, scenes: project.scenes.length, nodes: project.nodes.length,
    lines: project.nodes.reduce((sum, node) => sum + (node.kind === 'passage' ? node.lines.length : 0), 0),
    bytes: Buffer.byteLength(actual), outputSha256: digest(actual), exactOutputMatch: true, before: summary(samples.before), after: summary(samples.after) };
  results.push(result); console.log(JSON.stringify(result));
}
for (const source of sources) assert.equal(digest(await fs.readFile(source.file)), source.sha256);
await fs.mkdir(path.join(output, 'validation-main'), { recursive: true });
await fs.writeFile(path.join(output, 'validation-main/serialization.json'), JSON.stringify({ status: 'passed',
  baselineSectionSha256: digest(baselineSection), baselineSha256: digest(oldSource), sourceSha256: digest(newSource), inputFiles: sources.map(({ file, sha256 }) => ({ file, sha256 })), results,
  limits: ['仅测整篇序列化，不代表整次输入延迟。', '没有延迟同步或跨调用缓存，复杂演出和局部文字的辅助函数仍有查找开销。', 'ABBA顺序减少预热偏差；同进程样本不等同长期用户体验。'], temporaryFiles: [] }, null, 2));
