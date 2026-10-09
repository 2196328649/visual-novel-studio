import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
const output = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve('artifacts/v08-regression', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const scripts = [
  ['verify-show-current-speaker.ts'], ['verify-visual-transitions.ts'], ['verify-v08-editor.ts'], ['verify-single-exe.ts'],
  ['verify-actor-transitions.ts'], ['verify-actor-transitions-editor.ts'], ['verify-dialogue-transitions.ts'],
  ['verify-timeline-media-runtime.ts', 'artifacts/timeline-media-editing/2026-10-05T21-08-00.221Z/project.vns.json'],
  ['verify-blueprint-runtime.ts'], ['verify-editor-refresh.ts'], ['verify-close-save-export.ts'], ['verify-preview-close-dialog.ts'], ['verify-complete-game-export.ts'],
];
const results = process.argv[2] ? JSON.parse(await fs.readFile(path.join(output, 'report.json'), 'utf8')).results.filter(item => item.code === 0) : [];
for (const [script, ...args] of scripts) {
  if (results.some(item => item.script === script)) continue;
  const start = Date.now(); let log = ''; console.log('RUN ' + script);
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/' + script, ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { log += data.toString(); });
    child.on('error', reject); child.on('close', resolve);
  });
  const file = path.join(output, script.replace('.ts', '.log')); await fs.writeFile(file, log);
  results.push({ script, code, seconds: (Date.now() - start) / 1000, log: file });
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: code === 0 ? 'running' : 'failed', results }, null, 2));
  console.log((code === 0 ? 'PASS ' : 'FAIL ') + script + ' ' + results.at(-1).seconds + 's');
  if (code !== 0) { console.log(log.slice(-5000)); process.exitCode = 1; break; }
}
if (results.length === scripts.length && results.every(r => r.code === 0)) await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', results }, null, 2));
console.log(output);
