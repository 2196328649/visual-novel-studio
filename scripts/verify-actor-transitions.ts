import { createShowCharacterFixture } from './lib/show-character-fixture';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { createProject, type ActorTransitions, type StageAction } from '../src/core/model';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { textCommandAction } from '../src/core/text-script';
import { buildProject, runRenpy } from '../src/runtime/service';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { isolateRenpySaves } from './lib/renpy-saves';
import { actorContinuityCases, actorContinuityObserver, addActorContinuityFixture, type ActorNativeCase } from './lib/actor-continuity-runtime-fixture';

// Prepare all product changes first. This entry point is run by the coordinated
// validation pass; it never reads or writes the author's project as a fixture.
const args = process.argv.slice(2);
assert.ok(args.length <= 1 && args.every(arg => /^--case=[a-z_]+$/.test(arg)), 'Usage: verify-actor-transitions.ts [--case=name]');
const requested = args[0]?.slice('--case='.length);
const output = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? 'artifacts/actor-slots-continuity-2026-11-10', 'runtime-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const source = path.join(output, 'source'), game = path.join(output, 'game'), saves = path.join(output, 'saves');
const sdk = process.env.VNS_RENPY_SDK ?? path.resolve('resources/runtime');
const authorFile = path.resolve(process.env.VNS_AUTHOR_PROJECT ?? '../我的视觉小说1/project.vns.json');
const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const previousRenpySaves = process.env.RENPY_PATH_TO_SAVES;
const report: Record<string, unknown> = { status: 'running', output, authorFile, caseSelection: requested ?? 'all', checks: [],
  authorReferenceSha256: 'b1e0d940857d12387acecea3261e56af4381696f04be2587f0abfc1b666a9470',
  sampling: 'Each actual draw during a named continuity window samples left, center and right interior pixels. Endpoints are read separately. Legacy phase coverage retains its 30ms sampling. Frame gaps and readback time are reported; these probes do not cover every screen pixel.',
  saveScope: 'Normal dialogue FileSave/FileLoad, including the retained legacy case while a nonblocking actor move is still running. Re-establish displayable identity after each load. No claim of saving during a blocking transition or rollback coverage.',
  temporaryPaths: [source, game, saves, path.join(output, 'renpy-saves')] };
let authorHash: string | undefined, failure: unknown;
await fs.mkdir(path.join(output, 'screenshots'), { recursive: true });
await fs.mkdir(path.join(output, 'traces'), { recursive: true });
const saveReport = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const check = async (name: string, result: { code: number; log: string }) => {
  await fs.writeFile(path.join(output, name + '.log'), result.log);
  (report.checks as unknown[]).push({ name, code: result.code }); await saveReport();
  assert.equal(result.code, 0, name + ': ' + result.log.slice(-10000));
};
try {
authorHash = digest(await fs.readFile(authorFile)); report.authorSha256Before = authorHash;
report.renpySaves = await isolateRenpySaves(output);
await fs.mkdir(source, { recursive: true });
const project = createProject('角色过渡验收'); project.width = 800; project.height = 450; project.playerDefaults = { textSpeed: 0, fullscreen: false, masterVolume: 0 };
for (const [id, rgb] of [['red', [220, 40, 50]], ['green', [30, 210, 70]], ['dark', [6, 8, 12]]] as const) {
  const width = id === 'dark' ? 800 : 180, height = id === 'dark' ? 450 : 300;
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) png.data.set([...rgb, 255], i);
  await fs.writeFile(path.join(source, id + '.png'), PNG.sync.write(png));
  project.assets.push({ id, name: id, kind: 'image', path: id + '.png', width, height });
}
const rules: Required<ActorTransitions> = { enter: { mode: 'dissolve', duration: .4 }, exit: { mode: 'dissolve', duration: .7 }, expression: { mode: 'dissolve', duration: .2 } };
project.characters = ['a', 'b', 'c'].map(id => ({ id, name: id.toUpperCase(), color: '#ffffff', expressions: [{ id: id + '_normal', name: 'Normal', assetId: 'red' }, { id: id + '_happy', name: 'Happy', assetId: 'green' }] }));
project.blueprints = [createShowCharacterFixture()];
const show = (characterId = 'a', expressionId = 'normal', extra = {}): StageAction => ({ kind: 'show', characterId, expressionId: characterId + '_' + expressionId, x: .5, y: 1, scale: 1, layer: 10, transition: 'dissolve', lifetime: 'line', actorTransitions: rules, ...extra });
const hideGraph = blueprintFromPerformance(project, [{ kind: 'hide', characterId: 'a', transition: 'dissolve', duration: .25 }], '显式隐藏'); project.blueprints.push(hideGraph);
const nestedShow = blueprintFromPerformance(project, [show('b')], '嵌套显示'); project.blueprints.push(nestedShow);
const nestedCall = blueprintFromPerformance(project, [{ kind: 'blueprint', blueprintId: nestedShow.id, actorTransitions: { exit: { mode: 'move', duration: .1 } } }], '嵌套调用'); project.blueprints.push(nestedCall);
const node = project.nodes.find(n => n.kind === 'passage')!;
project.entryId = node.id; node.next = node.id;
node.lines = [
  { id: 'first', text: 'First.', actions: [] },
  { id: 'enter', text: 'Enter.', actions: [show()] },
  { id: 'same', text: 'Same.', actions: [show()] },
  { id: 'expression', text: 'Expression.', actions: [show('a', 'happy')] },
  { id: 'switch', text: 'Switch.', actions: [show('b', 'normal', { actorTransitions: { ...rules, enter: { mode: 'dissolve', duration: .3 } } })] },
  { id: 'none', text: 'None.', actions: [] },
  { id: 'async', text: 'Async.', actions: [show('a', 'normal', { wait: false, lifetime: 'persistent', actorTransitions: { ...rules, enter: { mode: 'move', duration: 1 } } })] },
  { id: 'persistent', text: 'Persistent.', actions: [] },
  { id: 'explicit', text: 'Explicit.', actions: [{ kind: 'hide', characterId: 'a', transition: 'dissolve', duration: .25 }] },
  { id: 'blueprint', speakerId: 'b', text: 'Blueprint.', actions: [{ kind: 'blueprint', blueprintId: 'fixture_show_character', inputs: { default_framing: false, preset: '', x: .5, y: 1 }, actorTransitions: rules }] },
  { id: 'end', text: 'End.', actions: [] },
  { id: 'fade_enter', text: 'Fade enter.', actions: [show('a', 'normal', { actorTransitions: { ...rules, enter: { mode: 'fade', duration: .2 } } })] },
  { id: 'fade_expression', text: 'Fade expression.', actions: [show('a', 'happy', { actorTransitions: { ...rules, expression: { mode: 'fade', duration: .4 }, exit: { mode: 'move', duration: .5 } } })] },
  { id: 'move_exit', text: 'Move exit.', actions: [] },
  { id: 'offsets', text: 'Offsets.', actions: [show('a', 'normal', { lifetime: 'persistent', afterOffsets: { x: [{ at: 0, value: 0, easing: 'linear' }, { at: .2, value: .1, easing: 'linear' }] } })] },
  { id: 'animate', text: 'Animate.', actions: [{ kind: 'animate', characterId: 'a', wait: true, repeat: false, keyframes: [{ x: .4, y: 1, scale: 1, rotation: 0, opacity: 1, duration: .2, easing: 'linear' }] }] },
  { id: 'bluehide', text: 'Blueprint hide.', actions: [{ kind: 'blueprint', blueprintId: hideGraph.id }] },
  { id: 'reset_show', text: 'Reset show.', actions: [show()] },
  { id: 'reset', text: 'Reset.', actions: [{ kind: 'background', assetId: 'red', transition: 'none' }] },
  { id: 'nested', text: 'Nested.', actions: [{ kind: 'blueprint', blueprintId: nestedCall.id, actorTransitions: { expression: { mode: 'fade', duration: .6 } } }] },
  { id: 'default_reset', text: 'Default reset.', actions: [{ kind: 'background', assetId: 'green', transition: 'none' }] },
  { id: 'default_enter', speakerId: 'a', text: 'Default enter.', actions: [textCommandAction(project, '@显示角色')!] },
  { id: 'default_switch', speakerId: 'b', text: 'Default switch.', actions: [textCommandAction(project, '@显示角色')!] },
  { id: 'default_exit', text: 'Default exit.', actions: [] },
];
addActorContinuityFixture(project);
const legacyCase: ActorNativeCase = { name: 'phases', source: `
testcase phases:
    $ qa_begin_case("phases")
    click id "vn_main_start"
    pause until "First."
    $ started = qa_time.monotonic()
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Enter."
    assert eval .3 < qa_time.monotonic() - started < 1.0
    assert eval vn_actor_instances["vn_actor_a"]["transitions"]["exit"]["duration"] == .7
    screenshot "entered.png"
    $ previous_actor = renpy.display.core.displayable_by_tag("master", "vn_actor_a")
    $ started = qa_time.monotonic()
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Same."
    assert eval qa_time.monotonic() - started < .2
    assert eval renpy.display.core.displayable_by_tag("master", "vn_actor_a") is previous_actor
    $ started = qa_time.monotonic()
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Expression."
    assert eval .12 < qa_time.monotonic() - started < .6
    screenshot "expression.png"
    $ started = qa_time.monotonic()
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Switch."
    assert eval .6 < qa_time.monotonic() - started < .95
    assert eval not renpy.showing("vn_actor_a") and renpy.showing("vn_actor_b")
    screenshot "switched.png"
    $ started = qa_time.monotonic()
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "None."
    assert eval .6 < qa_time.monotonic() - started < 1.1
    assert eval not renpy.showing("vn_actor_b")
    screenshot "departed.png"
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Async."
    pause .2
    $ renpy.session["qa_started_blend"] = vn_actor_instances["vn_actor_a"]["signature"]
    run FileSave("moving", confirm=False, slot=True)
    run FileLoad("moving", confirm=False, slot=True)
    pause until "Async."
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Persistent."
    assert eval vn_actor_instances["vn_actor_a"]["signature"] == renpy.session["qa_started_blend"]
    pause 1.1
    assert eval renpy.showing("vn_actor_a")
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Explicit."
    assert eval not renpy.showing("vn_actor_a")
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Blueprint."
    assert eval vn_actor_instances["vn_actor_b"]["transitions"]["expression"]["duration"] == .2
    assert eval vn_actor_transition_overrides == []
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "End."
    assert eval not renpy.showing("vn_actor_b")
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Fade enter."
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Fade expression."
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Move exit."
    assert eval not renpy.showing("vn_actor_a")
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Offsets."
    pause .3
    assert eval .58 < qa_actor_x("vn_actor_a") < .62
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Animate."
    assert eval .39 < qa_actor_x("vn_actor_a") < .41
    $ started = qa_time.monotonic()
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Blueprint hide."
    assert eval .17 < qa_time.monotonic() - started < .5
    assert eval not renpy.showing("vn_actor_a")
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Reset show."
    $ started = qa_time.monotonic()
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Reset."
    assert eval qa_time.monotonic() - started < .2
    assert eval not vn_actor_pending_exit and not vn_actor_departures
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Nested."
    assert eval vn_actor_instances["vn_actor_b"]["transitions"]["expression"]["duration"] == .6 and vn_actor_instances["vn_actor_b"]["transitions"]["exit"]["duration"] == .1
    assert eval not vn_actor_transition_overrides
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Default reset."
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Default enter."
    assert eval vn_actor_instances["vn_actor_a"]["lifetime"] == "line"
    assert eval vn_actor_instances["vn_actor_a"]["transitions"]["exit"] == dict(mode="dissolve", duration=0.5)
    $ started = qa_time.monotonic()
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Default switch."
    assert eval .4 < qa_time.monotonic() - started < .95
    assert eval not renpy.showing("vn_actor_a") and renpy.showing("vn_actor_b")
    $ started = qa_time.monotonic()
    $ renpy.test.testmouse.click_mouse(1, 700, 100)
    pause until "Default exit."
    assert eval .4 < qa_time.monotonic() - started < .95
    assert eval not vn_actor_instances
` };
const allCases = [legacyCase, ...actorContinuityCases()];
const cases = requested ? allCases.filter(item => item.name === requested) : allCases;
assert.ok(cases.length > 0, 'Unknown case: ' + requested + '; available: ' + allCases.map(item => item.name).join(', '));
const tests = actorContinuityObserver(output) + cases.map(item => item.source).join('\n');
const assertions = cases.reduce((sum, item) => sum + (item.source.match(/^    assert /gm) ?? []).length, 0);
report.caseNames = cases.map(item => item.name); report.expectedCases = cases.length; report.expectedAssertions = assertions;
report.fullSuiteCases = allCases.length; report.fullSuiteAssertions = allCases.reduce((sum, item) => sum + (item.source.match(/^    assert /gm) ?? []).length, 0);
report.coverage = ['legacy phases, max parallel duration, same pose identity, persistent and nonblocking, explicit hide, offsets and animate, nested overrides, bare default show',
  'two line characters, forward/reversed show order, one/both expressions, blank/default resolution, authored and nested blueprint paths',
  'A/B to A/C, empty actions retire, zero and positive pause divide batches',
  'named instances and normal save/load; numbered 1/default/2/3, targeted hide/animate, per-character number 2, restored continuity',
  'reported Chinese text commands with left/right presets and line lifetime, no phase overrides: Yuan shadow + Zhao normal to Yuan serious + Zhao shadow; third speaker has no portrait; actual default .5 second dissolve and same-pose identity'];
await fs.writeFile(path.join(output, 'fixture.json'), JSON.stringify(project, null, 2));
await fs.writeFile(path.join(source, 'project.vns.json'), JSON.stringify(project, null, 2));
await fs.writeFile(path.join(output, 'testcases.rpy'), tests);
const original = structuredClone(project);
const built = await buildProject({ project, projectDir: source, outputDir: game, sdkRoot: sdk, development: true });
assert.deepEqual(project, original, 'Building must not mutate authored actor settings.');
await check('compile', { code: built.ok ? 0 : 1, log: built.log + '\n' + JSON.stringify(built.diagnostics, null, 2) });
await fs.copyFile(path.join(game, 'game/story.rpy'), path.join(output, 'generated-story.rpy'));
await fs.writeFile(path.join(game, 'game/testcases.rpy'), tests);
const options = { savedir: saves, timeoutMs: 180000, env: { PYTHONUNBUFFERED: '1', RENPY_RENDERER: 'gl2' } };
await check('lint', await runRenpy(sdk, game, ['lint'], options));
const result = await runRenpy(sdk, game, ['test', '--report-detailed', '--report-skipped'], { ...options, onData: text => process.stdout.write(text) });
report.cases = Number(result.log.match(/Test cases\s*:\s*(\d+)/)?.[1] ?? 0);
report.assertions = Number(result.log.match(/Assertions\s*:\s*(\d+)/)?.[1] ?? 0);
await check('runtime', result);
assert.match(result.log, new RegExp('Test cases\\s*:\\s*' + cases.length + '\\s*\\|\\s*' + cases.length + ' passed'));
assert.equal(report.assertions, assertions, 'Every native assertion must execute.');
const traces = (await fs.readdir(path.join(output, 'traces'))).filter(name => name.endsWith('.json'));
assert.equal(traces.length, cases.length, 'Every testcase must retain its trace.');
if (cases.some(item => item.name === 'phases')) {
  const trace = JSON.parse(await fs.readFile(path.join(output, 'traces/phases.json'), 'utf8')) as { frames: { line: string; pixel: number[]; time: number }[] };
  for (const line of ['enter', 'expression', 'switch', 'none', 'fade_enter', 'fade_expression', 'move_exit', 'default_enter', 'default_exit']) assert.ok(new Set(trace.frames.filter(f => f.line === line).map(f => f.pixel.join(','))).size >= 3, line + ' actually changes visible pixels');
  report.legacyFrames = trace.frames.length;
}
report.status = 'passed';
} catch (error) {
  failure = error; report.status = 'failed'; report.error = error instanceof Error ? error.stack : String(error);
} finally {
  try {
    for (const directory of [path.join(game, 'tests/screenshots'), path.join(game, 'game/tests/screenshots')]) {
      if (await fs.stat(directory).then(stat => stat.isDirectory()).catch(() => false)) await fs.cp(directory, path.join(output, 'screenshots'), { recursive: true });
    }
    for (const name of ['errors.txt', 'traceback.txt', 'log.txt', 'report.html', 'test-report.html', 'tests/report.html']) {
      const candidate = path.join(game, name);
      if (await fs.stat(candidate).then(stat => stat.isFile()).catch(() => false)) await fs.copyFile(candidate, path.join(output, path.basename(name)));
    }
    report.traceFiles = (await fs.readdir(path.join(output, 'traces'))).filter(name => name.endsWith('.json'));
    report.screenshotCount = (await fs.readdir(path.join(output, 'screenshots'))).filter(name => name.endsWith('.png')).length;
  } catch (error) { report.status = 'failed'; report.evidenceError = String(error); failure ??= error; }
  try {
    const after = digest(await fs.readFile(authorFile)); report.authorSha256After = after;
    if (authorHash !== undefined) assert.equal(after, authorHash, 'The author project must remain unchanged.');
  } catch (error) { report.status = 'failed'; report.authorProtectionError = String(error); failure ??= error; }
  try {
    report.cleanup = await cleanVerificationDirectories(output, ['source', 'game', 'saves', 'renpy-saves']);
    assert.deepEqual((report.cleanup as { errors: unknown[] }).errors, []);
  } catch (error) { report.status = 'failed'; report.cleanupError = String(error); failure ??= error; }
  if (previousRenpySaves === undefined) delete process.env.RENPY_PATH_TO_SAVES;
  else process.env.RENPY_PATH_TO_SAVES = previousRenpySaves;
  await saveReport(); console.log(path.join(output, 'report.json'));
}
if (failure) throw failure;
