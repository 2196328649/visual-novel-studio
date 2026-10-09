import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
const output = path.resolve('artifacts/v08-final-package', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const results = [];
async function run(script, args = [], env = process.env) {
  let log = ''; const started = Date.now(); console.log('RUN ' + script);
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...(script.endsWith('.ts') ? ['--import', 'tsx'] : []), 'scripts/' + script, ...args], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { log += data.toString(); });
    child.on('error', reject); child.on('close', resolve);
  });
  const file = path.join(output, script + '.log'); await fs.writeFile(file, log);
  results.push({ script, code, log: file, seconds: (Date.now() - started) / 1000 });
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: code === 0 ? 'running' : 'failed', results }, null, 2));
  if (code !== 0) { console.log(log.slice(-5000)); throw new Error(script + ' failed'); }
  console.log('PASS ' + script); return log.trim().split(/\r?\n/).at(-1).trim();
}
const release = await run('verify-v08-release.mjs');
const report = JSON.parse(await fs.readFile(path.join(release, 'report.json'), 'utf8')); assert.equal(report.status, 'passed');
const env = { ...process.env, VNS_INSTALLED_EXE: report.checks.find(c => c.kind === 'installer').executable };
const editor = await run('verify-v08-editor.ts', [], env);
const followup = await run('verify-followup-regression.mjs', [], env);
const portable = await run('verify-v08-portable.ts');
const projects = await run('verify-followup-projects.ts');
await run('finalize-v08-verification.mjs', [release, portable, editor, 'artifacts/v08-regression/2026-10-07T08-33-46.216Z', followup, projects]);
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', release, portable, editor, followup, projects, results }, null, 2));
console.log(output);
