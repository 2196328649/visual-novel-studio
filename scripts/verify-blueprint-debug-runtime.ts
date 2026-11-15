import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { createBlueprintDebugFixture } from './lib/blueprint-debug-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { buildProject, runRenpy, spawnRenpy } from '../src/runtime/service';
import { atomicWrite } from '../src/desktop/project-store';
import { pythonLiteral as q } from '../src/runtime/literals';
import { mergeBlueprintDebugPacket, parseBlueprintDebugPacket, type BlueprintBreakpoint, type BlueprintDebugAction, type BlueprintDebugSnapshot } from '../src/core/blueprint-debug';

const sdk = process.env.VNS_RENPY_SDK ?? 'E:/Tools/renpy-8.5.3-sdk';
const output = path.resolve('artifacts/blueprint-debug-runtime', new Date().toISOString().replaceAll(':', '-'));
const source = path.join(output, 'source'), game = path.join(output, 'game'), sessionId = randomUUID(); await fs.mkdir(source, { recursive: true });
const f = createBlueprintDebugFixture(), before = JSON.stringify(f.project), checks: string[] = [];
const report: Record<string, unknown> = { status: 'running', checks, sessionId };
let snapshot: BlueprintDebugSnapshot | undefined, pending = '', log = '', child: ChildProcess | undefined, closed = false, code: number | null = null;
let closePromise: Promise<void> | undefined, timeout: ReturnType<typeof setTimeout> | undefined;
let revision = 0;
const commands: Record<string, unknown>[] = [], pauses: BlueprintDebugSnapshot[] = [];
const point = (graphId: string, nodeId: string): BlueprintBreakpoint => ({ graphId, nodeId });
const wait = async (predicate: () => boolean, name: string, ms = 20000) => {
  const end = Date.now() + ms;
  while (!predicate()) { if (closed || Date.now() > end) throw new Error('Waiting for ' + name + ' failed.\n' + log.slice(-4000)); await sleep(20); }
};
const stoppedAt = async (graphId: string, nodeId: string, afterRevision = -1, task?: boolean) => {
  await wait(() => !!snapshot && snapshot.revision > afterRevision && snapshot.phase === 'paused' && snapshot.site?.graphId === graphId && snapshot.site.nodeId === nodeId && (task === undefined || !!snapshot.site.taskHandle === task), nodeId);
  const stopped = structuredClone(snapshot!); pauses.push(stopped); return stopped;
};
const send = async (action: BlueprintDebugAction, breakpoints?: BlueprintBreakpoint[]) => {
  const requested = ++revision; commands.push({ sessionId, revision: requested, action, ...(breakpoints ? { breakpoints } : {}) });
  await atomicWrite(path.join(game, 'blueprint-debug-control.json'), JSON.stringify({ version: 1, commands }));
  await wait(() => (snapshot?.acknowledgement ?? 0) >= requested, 'command acknowledgement ' + requested); return snapshot!.revision;
};
try {
  await fs.writeFile(path.join(source, 'project.vns.json'), before);
  const built = await buildProject({ project: f.project, projectDir: source, sdkRoot: sdk, outputDir: game, development: true, previewHost: true, preview: { blueprintDebug: true } });
  await fs.writeFile(path.join(output, 'build.log'), built.log + JSON.stringify(built.diagnostics)); assert.equal(built.ok, true);
  const start = ['    pause until screen "main_menu"', '    click id "vn_main_start" pos (0.5, 0.5)', '    pause until "准备验收通用任务。"'];
  const tests = [
    'label vn_debug_probe:', '    call vn_blueprint_' + f.rootGraph.id + ' from vn_debug_probe_call', '    "调试父调用已完成。"', '    return', '',
    'testsuite global:', '    before testcase:', '        $ _test.timeout = 45.0', '        $ _test.transition_timeout = 0.05', '        $ _test.screenshot_directory = "tests/screenshots"', '        $ preferences.text_cps = 0',
    '    after testcase:', '        if eval not main_menu:', '            run MainMenu(confirm=False)', '        pause until screen "main_menu"', '    teardown:', '        exit', '',
    'testcase normal_call_debug:', ...start, '    run Jump("vn_debug_probe")', '    pause until "调试父调用已完成。"',
    '    assert eval (vn_var_call_done == 1 and vn_var_await_value == 0)', '    assert eval (vn_var_cancelled is False and vn_var_reason == "")',
    '    assert eval (vn_var_started == 1 and vn_var_finished == 1 and vn_bp_frame is None)', '    screenshot "normal-call.png"', '',
    'testcase background_task_debug:', ...start, '    run Jump(' + q('vn_node_' + f.interactive.id) + ')', '    pause until eval (' + q(f.page.id) + ' in vn_ui_open_pages)',
    '    click id "vn_component_task_fast" pos (0.5, 0.5)', '    pause until eval (vn_var_finished == 1)', '    assert eval (vn_var_started == 1 and vn_var_last_value == 2)',
    '    assert eval (vn_bp_async_result(vn_var_handle)["outputs"] == {"value_output": 2, "false_output": False, "empty_output": ""})',
    '    screenshot "background-task.png"', '    click id ' + q('vn_component_' + f.page.components[1].id) + ' pos (0.5, 0.5)', '    pause until "通用任务页面已返回。"', '    assert eval (not vn_ui_open_pages and vn_bp_frame is None)', '',
    'testcase debug_load_and_rollback:', ...start, '    run Jump("vn_debug_probe")', '    pause until "调试父调用已完成。"',
    '    run FileSave("debug-state", confirm=False, slot=True)', '    $ vn_var_await_value = 42', '    run FileLoad("debug-state", confirm=False, slot=True)',
    '    pause until "调试父调用已完成。"', '    assert eval (vn_var_await_value == 0 and _vn_bp_debug.debugger.reason == "loaded")',
    '    assert eval (not _vn_bp_debug.debugger.points and not _vn_bp_debug.debugger.paused)', '    run Rollback()', '    pause until "准备验收通用任务。"',
    '    assert eval (vn_var_started == 0 and vn_var_call_done == 0)', '    run Jump("vn_debug_probe")', '    pause until "调试父调用已完成。"',
    '    assert eval (vn_var_started == 1 and vn_var_call_done == 1)', '    assert eval (_vn_bp_debug.debugger.reason == "rollback" and not _vn_bp_debug.debugger.paused)', '',
  ].join('\n');
  await fs.writeFile(path.join(game, 'game/testcases.rpy'), tests); await fs.writeFile(path.join(output, 'testcases.rpy'), tests);
  const lint = await runRenpy(sdk, game, ['lint'], { savedir: path.join(output, 'saves') }); await fs.writeFile(path.join(output, 'lint.log'), lint.log); assert.equal(lint.code, 0);
  child = spawnRenpy(sdk, game, ['test', '--report-detailed', '--report-skipped'], {
    savedir: path.join(output, 'saves'), env: { VNS_BLUEPRINT_DEBUG: JSON.stringify({ sessionId, breakpoints: [point(f.rootGraph.id, f.rootFirst.id)] }) },
    onData: text => {
      log += text; pending += text;
      const lines = pending.split(/\r?\n/); pending = lines.pop() ?? '';
      for (const line of lines) if (line.startsWith('VNS_BLUEPRINT_DEBUG:')) {
        const packet = parseBlueprintDebugPacket(JSON.parse(line.slice('VNS_BLUEPRINT_DEBUG:'.length)), sessionId);
        if (!packet) throw new Error('Native debugger emitted an invalid packet.');
        snapshot = mergeBlueprintDebugPacket(snapshot, packet);
      }
    },
  });
  closePromise = new Promise(resolve => child!.once('close', exit => { code = exit; closed = true; resolve(); }));
  child.once('error', error => { log += '\n' + String(error); }); timeout = setTimeout(() => child?.kill(), 180000);
  const first = await stoppedAt(f.rootGraph.id, f.rootFirst.id);
  assert.ok(!first.trace.entries.some(entry => entry.nodeId === f.rootFirst.id && entry.kind === 'write'));
  const frozenSequence = first.trace.entries.at(-1)?.sequence, frozenRevision = first.revision;
  commands.push({ sessionId: 'different-session', revision: 99999, action: 'continue' });
  await atomicWrite(path.join(game, 'blueprint-debug-control.json'), JSON.stringify({ version: 1, commands })); await sleep(180);
  assert.equal(snapshot!.phase, 'paused'); assert.equal(snapshot!.acknowledgement, 0); assert.equal(snapshot!.trace.entries.at(-1)?.sequence, frozenSequence);
  checks.push('Breakpoint stops before writes; a stale-session command cannot resume it; no timers or task progress while stopped.');
  await send('stepOver'); await stoppedAt(f.rootGraph.id, f.rootCall.id, frozenRevision);
  let prior = snapshot!.revision; await send('stepInto'); const entered = await stoppedAt(f.worker.id, f.worker.nodes[0].id, prior);
  assert.equal(entered.site!.stack.length, 2); assert.equal(entered.site!.stack[1].callNodeId, f.rootCall.id);
  prior = snapshot!.revision; await send('stepOver'); await stoppedAt(f.worker.id, f.workerFirst.id, prior);
  prior = snapshot!.revision; await send('stepOver'); const delayed = await stoppedAt(f.worker.id, f.workerDelay.id, prior);
  await sleep(220); assert.equal(snapshot!.site!.nodeId, f.workerDelay.id); assert.equal(snapshot!.trace.entries.length, delayed.trace.entries.length);
  const began = Date.now(); prior = snapshot!.revision; await send('stepOver'); const resumed = await stoppedAt(f.worker.id, f.workerWrite.id, prior);
  assert.ok(Date.now() - began >= 250); assert.ok(resumed.trace.entries.some(entry => entry.kind === 'wait')); assert.ok(resumed.trace.entries.some(entry => entry.kind === 'resume'));
  prior = snapshot!.revision; await send('stepOut'); await wait(() => snapshot!.phase === 'paused' && snapshot!.revision > prior && snapshot!.reason === 'callReturned', 'step out return boundary');
  assert.equal(snapshot!.site!.invocationId, entered.site!.invocationId);
  checks.push('Step into/over/out preserve the nested call identity and return node; paused time does not finish a real wait.');
  await send('breakpoints', [point(f.worker.id, f.workerFirst.id)]); const beforeBackground = snapshot!.revision; await send('continue');
  const background = await stoppedAt(f.worker.id, f.workerFirst.id, beforeBackground, true);
  assert.equal(background.site!.pageId, f.page.id); assert.ok((background.site!.pageInstance ?? -1) >= 0); assert.equal(background.site!.stack.length, 1);
  assert.ok(background.trace.entries.some(entry => entry.kind === 'input' && entry.graphId === f.rootGraph.id && entry.value === false));
  assert.ok(background.trace.entries.some(entry => entry.kind === 'input' && entry.graphId === f.rootGraph.id && entry.value === ''));
  assert.ok(!background.trace.entries.some(entry => entry.nodeId === f.lazyRandom.id));
  const generation = snapshot!.generation; await send('clear'); assert.equal(snapshot!.generation, generation + 1); assert.deepEqual(snapshot!.trace.entries, []);
  await send('breakpoints', []); await send('continue');
  checks.push('Background task stops carry their exact page instance and independent call stack; explicit false/empty/zero and lazy reads remain faithful.');
  await closePromise; clearTimeout(timeout); assert.equal(code, 0, log.slice(-6000));
  assert.match(log, /Test cases\s*:\s*3\s*\|\s*3 passed/);
  const assertions = Number(log.match(/Assertions\s*:\s*(\d+)/)?.[1]); assert.equal(assertions, (tests.match(/^    assert /gm) ?? []).length);
  assert.ok(snapshot!.generation > generation + 1); assert.equal(JSON.stringify(f.project), before);
  checks.push('Real save/load and rollback create new observation generations without restoring breakpoints or reissuing commands.');
  report.assertions = assertions; report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error); process.exitCode = 1; console.error(error); }
finally {
  clearTimeout(timeout);
  if (child && !closed) { child.kill(); await closePromise; }
  report.process = { pid: child?.pid, closed, code };
  await fs.writeFile(path.join(output, 'native.log'), log); await fs.writeFile(path.join(output, 'pauses.json'), JSON.stringify(pauses, null, 2));
  for (const screenshots of [path.join(game, 'tests/screenshots'), path.join(game, 'game/tests/screenshots')]) {
    if (await fs.stat(screenshots).then(stat => stat.isDirectory()).catch(() => false)) await fs.cp(screenshots, path.join(output, 'screenshots'), { recursive: true });
  }
  for (const name of ['traceback.txt', 'errors.txt']) { const file = path.join(game, name); if (await fs.stat(file).catch(() => undefined)) await fs.copyFile(file, path.join(output, name)); }
  const cleanup = await cleanVerificationDirectories(output, ['source', 'game', 'saves']); if (cleanup.errors.length) { report.status = 'failed'; report.cleanupErrors = cleanup.errors; process.exitCode = 1; }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(output);
}
