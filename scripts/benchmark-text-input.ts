import { performance } from 'node:perf_hooks';
import { createProject } from '../src/core/model';
import { applyTextScript } from '../src/core/text-script';
import { performanceTextDocument } from '../src/core/text-performance';
import { linePreviewSnapshot } from '../src/core/line-preview';
import { createTextScriptReader } from '../src/core/text-script-cache';

const count = 1500;
const source = '# 段落：正文【passage】\n' + Array.from({ length: count }, (_, i) => `@等待：0.01\n旁白：第${i + 1}句，窗外灯火明灭，我们继续讲述这个故事。`).join('\n');
const project = applyTextScript(createProject(), source).project;
const shared = process.argv.includes('--shared');
const paused = process.argv.includes('--paused');
const read = shared ? createTextScriptReader() : applyTextScript;
const runs = [];
for (let i = 0; i < 5; i++) {
  const text = source + '写'.repeat(i + 1), start = performance.now();
  performanceTextDocument(project, text, true, undefined, undefined, read);
  const projected = performance.now();
  const committed = { ...project, scriptText: { ...project.scriptText!, content: text } };
  const parsed = read(committed, text), parsedAt = performance.now();
  const node = parsed.project.nodes.find(node => node.kind === 'passage')!;
  if (!paused) linePreviewSnapshot(parsed.project, { nodeId: node.id, lineId: node.lines.at(-1)!.id });
  const previewed = performance.now();
  runs.push({ projectionMs: projected - start, parseMs: parsedAt - projected, previewMs: previewed - parsedAt, totalMs: previewed - start });
}
console.log(JSON.stringify({ lines: count, characters: source.length, shared, paused, runs }, null, 2));
