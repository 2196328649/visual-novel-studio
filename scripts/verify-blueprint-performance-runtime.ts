import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createBlueprintExecutionPerformanceFixture, blueprintPerformanceSizes } from './lib/blueprint-performance-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { compileProject } from '../src/runtime/compiler';
import { buildProject, runRenpy } from '../src/runtime/service';
import { pythonLiteral } from '../src/runtime/literals';

const sdk = process.env.VNS_RENPY_SDK ?? 'E:/Tools/renpy-8.5.3-sdk';
const output = path.resolve('artifacts/blueprint-performance-runtime', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const report: { status: string; runs: unknown[]; error?: string } = { status: 'running', runs: [] };
const warmups = 5, samples = 25, q = pythonLiteral;
try {
  for (const size of blueprintPerformanceSizes) {
    const runDir = path.join(output, String(size)), source = path.join(runDir, 'source'), game = path.join(runDir, 'game');
    await fs.mkdir(source, { recursive: true });
    try {
    const f = createBlueprintExecutionPerformanceFixture(size), before = JSON.stringify(f.project);
    const fixtureSha256 = createHash('sha256').update(before).digest('hex');
    const compileStarted = performance.now(), compiled = compileProject(f.project), compileMs = performance.now() - compileStarted;
    assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), []);
    await fs.writeFile(path.join(source, 'project.vns.json'), JSON.stringify(f.project));
    const built = await buildProject({ project: f.project, projectDir: source, sdkRoot: sdk, outputDir: game, development: true });
    await fs.writeFile(path.join(runDir, 'build.log'), built.log + JSON.stringify(built.diagnostics)); assert.equal(built.ok, true);
    const tests = [
      'label vn_perf_measure:',
      '    $ renpy.test.testexecution.perf_samples = []',
      '    $ renpy.test.testexecution.perf_repeat = 0',
      '    while renpy.test.testexecution.perf_repeat < ' + (warmups + samples) + ':',
      '        $ vn_var_perf_result = 0',
      '        $ renpy.test.testexecution.perf_start = __import__("time").perf_counter()',
      '        call vn_blueprint_' + f.graph.id + ' from vn_perf_call_' + size,
      '        $ renpy.test.testexecution.perf_elapsed = (__import__("time").perf_counter() - renpy.test.testexecution.perf_start) * 1000',
      '        if vn_var_perf_result != ' + f.expected + ':',
      '            $ raise Exception("The measured graph did not complete every counted action.")',
      '        if renpy.test.testexecution.perf_repeat >= ' + warmups + ':',
      '            $ renpy.test.testexecution.perf_samples.append(renpy.test.testexecution.perf_elapsed)',
      '        $ renpy.test.testexecution.perf_repeat += 1',
      '    python:',
      '        import json',
      '        with open(' + q(path.join(runDir, 'native-metrics.json')) + ', "w", encoding="utf-8") as handle:',
      '            json.dump(dict(nodes=' + size + ', executed_actions=' + f.expected + ', warmups=' + warmups + ', elapsed_ms=renpy.test.testexecution.perf_samples), handle)',
      '    "原生性能计量完成。"',
      '    return', '',
      'testsuite global:', '    before testcase:', '        $ _test.timeout = 60.0', '        $ _test.transition_timeout = 0.05', '        $ preferences.text_cps = 0', '    teardown:', '        exit', '',
      'testcase complete_generated_execution:', '    pause until screen "main_menu"', '    click id "vn_main_start" pos (0.5, 0.5)', '    pause until "性能执行完成。"',
      '    assert eval (vn_var_perf_result == ' + f.expected + ')',
      '    run Jump("vn_perf_measure")', '    pause until "原生性能计量完成。"',
      '    assert eval (vn_var_perf_result == ' + f.expected + ' and len(renpy.test.testexecution.perf_samples) == ' + samples + ')',
      '    assert eval (vn_bp_frame is None and vn_bp_task is None)', '',
    ].join('\n');
    await fs.writeFile(path.join(runDir, 'testcases.rpy'), tests);
    await fs.writeFile(path.join(game, 'game/testcases.rpy'), tests);
    const options = { savedir: path.join(runDir, 'saves'), timeoutMs: 180000 };
    const lint = await runRenpy(sdk, game, ['lint'], options); await fs.writeFile(path.join(runDir, 'lint.log'), lint.log); assert.equal(lint.code, 0);
    const result = await runRenpy(sdk, game, ['test', '--report-detailed', '--report-skipped'], options);
    await fs.writeFile(path.join(runDir, 'runtime.log'), result.log); assert.equal(result.code, 0); assert.match(result.log, /Test cases\s*:\s*1\s*\|\s*1 passed/);
    const measurements = JSON.parse(await fs.readFile(path.join(runDir, 'native-metrics.json'), 'utf8')) as { elapsed_ms: number[] };
    assert.equal(measurements.elapsed_ms.length, samples); assert.ok(measurements.elapsed_ms.every(value => Number.isFinite(value) && value >= 0));
    const sorted = [...measurements.elapsed_ms].sort((a, b) => a - b);
    report.runs.push({ fixtureSha256, nodes: size, executedActions: f.expected, compileMs, warmups, samples, medianMs: sorted[Math.floor(samples / 2)], p95Ms: sorted[Math.floor(samples * .95)], maximumMs: sorted.at(-1), measurements });
    assert.equal(JSON.stringify(f.project), before);
    } finally {
      const cleanup = await cleanVerificationDirectories(runDir, ['source', 'game', 'saves']); assert.deepEqual(cleanup.errors, []);
    }
  }
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error); console.error(error); process.exitCode = 1; }
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(output);
