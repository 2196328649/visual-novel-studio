import { performance } from 'node:perf_hooks';
import { createProject } from '../src/core/model';
import { applyTextScript } from '../src/core/text-script';
import { performanceTextFolds } from '../src/core/text-performance';
import { textDocument } from '../src/core/text-document';

const count = 1500;
const source = '# 段落：正文【passage】\n' + Array.from({ length: count }, (_, i) => `@等待：0.01\n旁白：第${i + 1}句，窗外灯火明灭，我们继续讲述这个故事。`).join('\n');
const project = applyTextScript(createProject(), source).project;
const runs: { parseMs: number; foldsMs: number; hiddenProjectionMs: number; visibleProjectionMs: number; folds: number }[] = [];
for (let i = 0; i < 30; i++) {
  const text = source + '写'.repeat(i + 1), start = performance.now();
  const parsed = applyTextScript(project, text), parsedAt = performance.now();
  const folds = performanceTextFolds(text, parsed), foldedAt = performance.now();
  const measureProjection = (hide: boolean) => {
    const start = performance.now();
    textDocument(text, parsed.sourceMap, { performances: hide ? folds : [] });
    return performance.now() - start;
  };
  // Alternate order so the projection comparison does not always favor one mode.
  const first = measureProjection(i % 2 === 0), second = measureProjection(i % 2 !== 0);
  if (i >= 5) runs.push({ parseMs: parsedAt - start, foldsMs: foldedAt - parsedAt, hiddenProjectionMs: i % 2 === 0 ? first : second, visibleProjectionMs: i % 2 === 0 ? second : first, folds: folds.length });
}
const summary = Object.fromEntries(['parseMs', 'foldsMs', 'hiddenProjectionMs', 'visibleProjectionMs'].map(key => {
  const values = runs.map(run => run[key as keyof typeof run]).sort((a, b) => a - b);
  return [key, { median: values[Math.floor(values.length / 2)], p95: values[Math.ceil(values.length * .95) - 1] }];
}));
console.log(JSON.stringify({ lines: count, characters: source.length, samples: runs.length, summary, runs }, null, 2));
