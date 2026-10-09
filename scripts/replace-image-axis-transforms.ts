import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { canonicalImageVisual, imageTransform, imageTransformText } from '../src/core/image-transform';
import { applyTextScript, textCommandAction } from '../src/core/text-script';
import { projectSchema } from '../src/core/model';

const output = path.resolve('work/image-axis-replacement', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const records = [];
for (const [index, argument] of process.argv.slice(2).entries()) {
  const file = path.resolve(argument), bytes = await fs.readFile(file);
  const project = projectSchema.parse(JSON.parse(bytes.toString('utf8')));
  const source = project.scriptText?.content;
  if (!source) continue;
  let replacements = 0;
  const updated = source.split('\n').map(line => {
    if (!/^\s*[@／/]\s*显示图片\s*[:：]/.test(line)) return line;
    const field = line.match(/变换\s*=\s*(\{[^{}\n]*\})/);
    if (!field) return line;
    const value = JSON.parse(field[1]);
    if (!('尺寸' in value) && typeof value.缩放 !== 'number') return line;
    const base = textCommandAction(project, line.replace(field[1], JSON.stringify({ 位置: value.位置, 旋转: value.旋转, 不透明度: value.不透明度 })), true);
    assert.ok(base?.kind === 'visual' && base.content === 'image');
    const shaped = { ...base, width: value.尺寸?.[0] ?? 1, height: value.尺寸?.[1] ?? 1, keyframes: [{ ...base.keyframes[0], scale: value.缩放 ?? 1 }] };
    const canonical = canonicalImageVisual(project, shaped);
    assert.ok(canonical, 'Image crop requires manual review: ' + line);
    replacements++;
    return line.replace(field[1], imageTransformText(imageTransform(canonical)));
  }).join('\n');
  const parsed = applyTextScript(project, updated);
  assert.deepEqual(parsed.issues.filter(issue => issue.severity === 'error'), []);
  const beforeShows = source.split('\n').filter(line => /^\s*@显示角色/.test(line));
  assert.deepEqual(updated.split('\n').filter(line => /^\s*@显示角色/.test(line)), beforeShows);
  assert.deepEqual(parsed.project.scenes, project.scenes, 'scene performances must stay unchanged');
  const candidate = path.join(output, `${index}-project.vns.json`);
  const next = JSON.stringify(parsed.project, null, 2) + '\n';
  await fs.writeFile(candidate, next);
  await fs.writeFile(path.join(output, `${index}-before.json`), bytes);
  records.push({ file, candidate, replacements, before: digest(bytes), after: digest(next) });
}
await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify({ status: 'prepared', records }, null, 2));
console.log(output);
