import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
const output = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve('artifacts/followup-regression', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const scripts = ['verify-early-dialogue.ts', 'verify-preview-controls.ts', 'verify-editor-layout-followup.ts', 'verify-chapter-entry-presets.ts', 'verify-chapter-entry-runtime.ts', 'verify-chapter-four-regions-runtime.ts', 'verify-menu-right-click.ts'];
const results = process.argv[2] ? JSON.parse(await fs.readFile(path.join(output, 'report.json'), 'utf8')).results.filter(r => r.code === 0) : [];
for (const script of scripts) {
  if (results.some(r => r.script === script)) continue;
  const args = script === 'verify-chapter-entry-runtime.ts' ? [path.dirname(results.find(r => r.script === 'verify-chapter-entry-presets.ts').report)] : [];
  let log = ''; const start = Date.now(); console.log('RUN ' + script);
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/' + script, ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { log += data.toString(); });
    child.on('error', reject); child.on('close', resolve);
  });
  const file = path.join(output, script.replace('.ts', '.log')); await fs.writeFile(file, log);
  const result = { script, code, seconds: (Date.now() - start) / 1000, log: file };
  if (code === 0) {
    const directory = log.trim().split(/\r?\n/).at(-1).trim();
    result.report = path.join(directory, 'report.json');
    assert.equal(JSON.parse(await fs.readFile(result.report, 'utf8')).status, 'passed');
  }
  results.push(result);
  const status = code !== 0 ? 'failed' : results.length === scripts.length ? 'passed' : 'running';
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status, results }, null, 2));
  console.log((code === 0 ? 'PASS ' : 'FAIL ') + script + ' ' + result.seconds + 's');
  if (code !== 0) { console.log(log.slice(-5000)); process.exitCode = 1; break; }
}
console.log(output);
