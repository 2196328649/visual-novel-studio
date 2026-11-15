import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { blueprintNodeDefaults, connectBlueprintPins, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { createProject, projectSchema, type ActorTransitions, type BlueprintGraph, type Project, type StageAction } from '../src/core/model';
import { arrangePerformanceTimeline, performanceTimeline } from '../src/core/performance-timeline';
import { addProjectGraphs } from '../src/core/project-resources';
import { compileProject } from '../src/runtime/compiler';
import { pythonLiteral as q } from '../src/runtime/literals';
import { spawnRenpy } from '../src/runtime/service';
import { finishFlowNativeVerification, flowRuntimeTraceSource, recordFlowNativeResult } from './lib/flow-runtime-verification';
import { isolateRenpySaves } from './lib/renpy-saves';

// Prepared for the coordinated validation phase. This file does not use an
// author's project or template. Every display and cancellation is emitted by
// the real compiler; the probes only copy final actor rules and stack values.
const root = path.resolve('.'), sdk = path.join(root, 'resources/runtime');
const output = path.join(root, 'artifacts/code-health-review-2026-11-14/actor-runtime', `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`);
const game = path.join(output, 'game'), fixtureRoot = path.join(output, 'fixture');
const previousSaves = process.env.RENPY_PATH_TO_SAVES;
const nodeRules: ActorTransitions = { enter: { mode: 'none', duration: 0 }, expression: { mode: 'dissolve', duration: .12 }, exit: { mode: 'none', duration: 0 } };
const outsideRules: ActorTransitions = { enter: { mode: 'fade', duration: .3 }, expression: { mode: 'fade', duration: .09 }, exit: { mode: 'dissolve', duration: .1 } };
const parentRules: ActorTransitions = { enter: { mode: 'fade', duration: .12 }, exit: { mode: 'move', duration: .06 } };
const innerRules: ActorTransitions = { enter: { mode: 'dissolve', duration: .08 } };
const flatRules = { ...parentRules, ...innerRules };
const inheritedRules = { ...nodeRules, ...outsideRules, ...flatRules };
const report: Record<string, unknown> = {
  status: 'running', output, sdk,
  coverage: 'showCharacter 与 savedAction 经外层真实调用和两层时间轴内联后的过渡优先级；角色回调继承；后继兄弟及正常返回不泄漏；真实页面关闭取消后的动态栈恢复。',
  limits: '960×540 合成PNG角色，三个小型场景。断言最终运行时规则及调用栈，截图辅助核对真实显示；不替代所有角色过渡的逐帧视觉验收。',
  checks: [], processes: [],
};
type OwnedProcess = { child: ChildProcess; state: { name: string; pid?: number; closed: boolean; code?: number | null; signal?: string | null; timedOut?: boolean; error?: string } };
const owned: OwnedProcess[] = [];
const inside = (parent: string, candidate: string) => {
  const relative = path.relative(parent, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};

async function prepareOutput() {
  const workspace = await fs.realpath(root);
  let directory = root;
  for (const part of path.relative(root, output).split(path.sep)) {
    directory = path.join(directory, part);
    const stat = await fs.lstat(directory).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    });
    if (directory === output) assert.equal(stat, undefined, '验收必须使用全新目录。');
    if (stat) assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), '拒绝链接或非目录输出：' + directory);
    else await fs.mkdir(directory);
    assert.ok(inside(workspace, await fs.realpath(directory)), '验收输出离开工作区。');
  }
}

function show(characterId: string, x: number): Extract<StageAction, { kind: 'show' }> {
  return { kind: 'show', characterId, expressionId: characterId + '_normal', x, y: .66, scale: 1, layer: 10, lifetime: 'persistent', transition: 'none', duration: 0, wait: false, actorTransitions: nodeRules };
}
function addGraph(project: Project, id: string, actions: StageAction[]) {
  const graph = blueprintFromPerformance(project, actions, id); graph.id = id;
  addProjectGraphs(project, graph); return graph;
}
function timeline(project: Project, graph: BlueprintGraph, times: number[]) {
  graph.timelineComponent = true;
  const model = performanceTimeline(project, graph); assert.equal(model.reason, undefined);
  assert.equal(model.clips.length, times.length);
  arrangePerformanceTimeline(project, graph, model.clips.map((clip, i) => ({ ...clip, at: times[i], trackId: 'row_' + i })), times.map((_, i) => ({ id: 'row_' + i, name: '轨道 ' + i })));
}

function fixture() {
  const project = createProject('时间轴角色过渡原生验收');
  project.id = 'qa_actor_overrides'; project.width = 960; project.height = 540;
  project.playerDefaults = { textSpeed: 0, masterVolume: 0, fullscreen: false };
  project.ui.pages = { main: { background: '#172536' }, say: { showQuickMenu: false } };
  project.variables = [{ id: 'qa_cancel_late', name: '取消后不应执行', type: 'number', initial: 0, persistent: false }];
  const colors: [string, number[]][] = [['hero', [201, 72, 88]], ['witness', [74, 160, 94]], ['sibling', [55, 122, 202]], ['returned', [217, 174, 55]]];
  project.assets = colors.map(([id]) => ({ id, name: '合成色块 ' + id, kind: 'image', path: 'assets/' + id + '.png', width: 96, height: 160, visibleBounds: { x: 0, y: 0, width: 96, height: 160 } }));
  const cases = ['normal', 'saved', 'cancel'].map(prefix => {
    for (const [id] of colors) project.characters.push({
      id: prefix + '_' + id, name: prefix + ' ' + id, color: '#ffffff',
      expressions: [{ id: prefix + '_' + id + '_normal', name: '通常', assetId: id }],
      actorTransitions: { enter: { mode: 'move', duration: .04 } },
    });
    const callback = addGraph(project, prefix + '_callback', [show(prefix + '_witness', .4), ...(prefix === 'cancel' ? [{ kind: 'pause' as const, seconds: 5 }] : [])]);
    if (prefix === 'cancel') {
      const late = blueprintNodeDefaults('setVariable'); Object.assign(late.properties, { variableId: 'qa_cancel_late', value: 1 });
      const previous = callback.nodes.at(-1)!; callback.nodes.push(late);
      assert.equal(connectBlueprintPins(callback, previous.id, 'exec_out', late.id, 'exec_in'), undefined);
    }
    project.characters.find(character => character.id === prefix + '_hero')!.blueprintId = callback.id;
    const leaf = addGraph(project, prefix + '_leaf', [show(prefix + '_hero', .2)]);
    if (prefix === 'saved') {
      const saved = blueprintNodeDefaults('savedAction'); saved.id = leaf.nodes[1].id;
      saved.properties.action = JSON.stringify(show(prefix + '_hero', .2)); leaf.nodes[1] = saved;
    }
    timeline(project, leaf, [.1]);
    const middle = addGraph(project, prefix + '_middle', [{ kind: 'blueprint', blueprintId: leaf.id, actorTransitions: innerRules }]);
    timeline(project, middle, [.15]);
    const parent = addGraph(project, prefix + '_parent', [{ kind: 'blueprint', blueprintId: middle.id, actorTransitions: parentRules }, show(prefix + '_sibling', .6)]);
    timeline(project, parent, [0, prefix === 'cancel' ? 6 : .8]);
    const outside = addGraph(project, prefix + '_outside', [{ kind: 'blueprint', blueprintId: parent.id, actorTransitions: outsideRules }, show(prefix + '_returned', .8)]);
    return { prefix, callback, leaf, parent, outside };
  });
  const sceneId = project.scenes[0].id, ending = project.nodes.find(node => node.kind === 'end');
  assert.ok(ending, '合成工程必须保留真实结束节点。');
  const first = project.nodes.find(node => node.kind === 'passage')!; first.lines = [{ id: 'qa_ready', text: '准备原生角色过渡验收。', actions: [] }];
  for (const row of cases.filter(row => row.prefix !== 'cancel')) project.nodes.push({
    id: 'qa_' + row.prefix, kind: 'passage', name: row.prefix, sceneId, x: 600, y: 300, next: ending.id,
    lines: [{ id: 'qa_' + row.prefix + '_done', text: row.prefix + ' 角色演出已正常返回。', actions: [{ kind: 'blueprint', blueprintId: row.outside.id }] }],
  });
  const cancel = cases.find(row => row.prefix === 'cancel')!;
  const opener = addGraph(project, 'qa_page_opener', []);
  const open = blueprintNodeDefaults('showUiPage'); Object.assign(open.properties, { pageId: 'qa_actor_page', wait: true, modalMode: 'modeless' }); opener.nodes.push(open);
  assert.equal(connectBlueprintPins(opener, opener.nodes[0].id, 'exec', open.id, 'exec_in'), undefined);
  const closer = addGraph(project, 'qa_page_closer', []);
  const close = blueprintNodeDefaults('closeUiPage'); Object.assign(close.properties, { pageId: 'qa_actor_page', result: '关闭' }); closer.nodes.push(close);
  assert.equal(connectBlueprintPins(closer, closer.nodes[0].id, 'exec', close.id, 'exec_in'), undefined);
  project.ui.customPages = [{ id: 'qa_actor_page', name: '角色过渡取消验收', modal: false, opening: { presentation: 'overlay' }, components: [
    { id: 'qa_actor_run', kind: 'button', page: 'custom', text: '运行角色演出', x: .12, y: .08, width: .3, height: .12, action: 'blueprint', blueprintId: cancel.outside.id },
    { id: 'qa_actor_close', kind: 'button', page: 'custom', text: '关闭页面', x: .58, y: .08, width: .3, height: .12, action: 'blueprint', blueprintId: closer.id },
  ] }];
  project.nodes.push({ id: 'qa_cancel', kind: 'passage', name: '页面取消', sceneId, x: 600, y: 600, next: ending.id,
    lines: [{ id: 'qa_cancel_done', text: '页面关闭后的角色显示已完成。', actions: [{ kind: 'blueprint', blueprintId: opener.id }, show('cancel_returned', .8)] }] });
  synchronizeBlueprintSignatures(project);
  return { project: projectSchema.parse(JSON.parse(JSON.stringify(project))), colors, cases };
}

function testSource() {
  const common = (prefix: string) => `    $ qa_begin(${q(prefix)})
    click id 'vn_main_start'
    pause until '准备原生角色过渡验收。'
    run Jump(${q('vn_node_qa_' + prefix)})`;
  const normal = (prefix: string) => `testcase ${prefix}_nested_rules_and_return:
${common(prefix)}
    pause until ${q(prefix + ' 角色演出已正常返回。')}
    assert eval qa_show_is(${q(prefix + '_hero')}, ${q(inheritedRules)}, ${q([outsideRules, flatRules])})
    assert eval qa_show_is(${q(prefix + '_witness')}, ${q(inheritedRules)}, ${q([outsideRules, flatRules])})
    assert eval qa_callback_is(${q(prefix)}, ${q([outsideRules, flatRules])})
    assert eval qa_show_is(${q(prefix + '_sibling')}, ${q({ ...nodeRules, ...outsideRules })}, ${q([outsideRules])})
    assert eval qa_show_is(${q(prefix + '_returned')}, ${q(nodeRules)}, [])
    assert eval vn_actor_transition_overrides == [] and renpy.context_nesting_level() == 0
    assert eval all(renpy.showing(vn_actor_tag(${q(prefix + '_')} + role)) for role in ('hero', 'witness', 'sibling', 'returned'))
    $ qa_snapshot(${q(prefix + '-returned')})
    pause .35
    screenshot ${q(prefix + '-actors.png')}
`;
  return `init -999 python:
    import renpy as qa_engine
    qa_engine.safe_mode_checked = True
${flowRuntimeTraceSource(output)}
init 1000 python:
    import json as qa_json
    import renpy.test.testexecution as qa_execution
    qa_execution.actor_override_rows = []
    qa_execution.actor_override_case = 'initial'
    def qa_copy(value):
        return qa_json.loads(qa_json.dumps(value))
    def qa_stack():
        return [qa_copy(qa_json.loads(value) if isinstance(value, str) else value) for value in vn_actor_transition_overrides]
    def qa_begin(name):
        qa_execution.actor_override_rows = []
        qa_execution.actor_override_case = name
    def qa_record(kind, name, **values):
        row = dict(kind=kind, name=name, stack=qa_stack(), depth=renpy.context_nesting_level(), **values)
        qa_execution.actor_override_rows.append(row)
        qa_trace(qa_execution.actor_override_case + '-%02d-' % len(qa_execution.actor_override_rows) + kind, observation=row)
    qa_original_actor_show = vn_actor_show
    def qa_actor_show(*args, **kwargs):
        result = qa_original_actor_show(*args, **kwargs)
        tag = args[0] if args else kwargs['tag']
        actor = vn_actor_instances.get(tag, {})
        qa_record('show', actor.get('characterId', ''), rules=qa_copy(actor.get('transitions')), showing=renpy.showing(tag))
        return result
    vn_actor_show = qa_actor_show
    def qa_label(name, abnormal):
        if name in ('vn_blueprint_normal_callback', 'vn_blueprint_saved_callback', 'vn_blueprint_cancel_callback'):
            qa_record('callback', name)
    config.label_callbacks.append(qa_label)
    def qa_rows(kind, name):
        return [row for row in qa_execution.actor_override_rows if row['kind'] == kind and row['name'] == name]
    def qa_show_is(name, rules, stack):
        rows = qa_rows('show', name)
        return len(rows) == 1 and rows[0]['rules'] == rules and rows[0]['stack'] == stack and rows[0]['showing']
    def qa_callback_is(prefix, stack):
        rows = qa_rows('callback', 'vn_blueprint_' + prefix + '_callback')
        return len(rows) == 1 and rows[0]['stack'] == stack
    def qa_snapshot(name):
        qa_trace(name, stack=qa_stack(), depth=renpy.context_nesting_level(), page_open='qa_actor_page' in vn_ui_open_pages,
            late=vn_var_qa_cancel_late, observations=qa_copy(qa_execution.actor_override_rows))

testsuite global:
    before testcase:
        $ _test.timeout = 18.0
        $ _test.transition_timeout = .05
        $ _test.screenshot_directory = 'tests/screenshots'
        $ preferences.text_cps = 0
        $ preferences.afm_enable = False
        $ preferences.transitions = 2
    after testcase:
        if not screen 'main_menu':
            run MainMenu(confirm=False)
        pause until screen 'main_menu'
    teardown:
        exit

${normal('normal')}
${normal('saved')}
testcase page_close_restores_cancelled_dynamic_scope:
${common('cancel')}
    pause until eval 'qa_actor_page' in vn_ui_open_pages
    click id 'vn_component_qa_actor_run'
    pause until eval vn_bp_wait is not None and vn_bp_wait['duration'] == 5 and (vn_bp_task or {}).get('page') == 'qa_actor_page'
    assert eval qa_show_is('cancel_hero', ${q(inheritedRules)}, ${q([outsideRules, flatRules])})
    assert eval qa_show_is('cancel_witness', ${q(inheritedRules)}, ${q([outsideRules, flatRules])})
    assert eval qa_callback_is('cancel', ${q([outsideRules, flatRules])})
    assert eval qa_stack() == ${q([outsideRules, flatRules])} and vn_var_qa_cancel_late == 0
    $ qa_snapshot('cancel-before-page-close')
    screenshot 'cancel-callback-wait.png'
    click id 'vn_component_qa_actor_close'
    pause until '页面关闭后的角色显示已完成。'
    assert eval vn_actor_transition_overrides == [] and renpy.context_nesting_level() == 0
    assert eval vn_var_qa_cancel_late == 0 and not qa_rows('show', 'cancel_sibling')
    assert eval qa_show_is('cancel_returned', ${q(nodeRules)}, [])
    assert eval 'qa_actor_page' not in vn_ui_open_pages and vn_bp_wait is None and not vn_running_blueprint_events
    $ qa_snapshot('cancel-returned')
    screenshot 'cancel-restored.png'
`;
}

async function runOwned(name: string, command: string[], timeoutMs = 90000): Promise<{ code: number; log: string }> {
  let log = '';
  const child = spawnRenpy(sdk, game, command, { savedir: path.join(output, 'saves'), env: { RENPY_RENDERER: 'gl2' }, onData: text => { log = (log + text).slice(-1_000_000); process.stdout.write(text); } });
  const state: OwnedProcess['state'] = { name, pid: child.pid, closed: false };
  owned.push({ child, state }); (report.processes as unknown[]).push(state);
  const result = await new Promise<{ code: number; log: string }>(resolve => {
    const timeout = setTimeout(() => { state.timedOut = true; child.kill(); }, timeoutMs);
    child.on('error', error => { state.error = String(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timeout); Object.assign(state, { closed: true, code, signal });
      resolve({ code: state.timedOut ? 124 : state.error ? 1 : code ?? 1, log: log + (state.error ? '\n' + state.error : '') + (state.timedOut ? '\n验收超时。' : '') });
    });
  });
  await fs.writeFile(path.join(output, name + '.log'), result.log);
  (report.checks as unknown[]).push({ name, code: result.code });
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  return result;
}

let failure: unknown;
await prepareOutput();
try {
  await fs.mkdir(path.join(fixtureRoot, 'assets'), { recursive: true }); await isolateRenpySaves(output);
  const { project, colors, cases } = fixture(), tests = testSource(), before = structuredClone(project);
  await fs.writeFile(path.join(fixtureRoot, 'project.vns.json'), JSON.stringify(project, null, 2));
  await fs.writeFile(path.join(output, 'fixture.project.json'), JSON.stringify(project, null, 2));
  await fs.writeFile(path.join(output, 'testcases.rpy'), tests);
  const compiled = compileProject(project, { development: true });
  report.diagnostics = compiled.diagnostics;
  assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), []);
  assert.deepEqual(project, before, '生成验收不能改变合成作者工程。');
  // These guards establish that native execution tests the repaired lowering,
  // rather than accidentally passing through three ordinary nested calls.
  for (const row of cases) {
    const parent = compiled.files['game/story.rpy'].split('label vn_blueprint_' + row.parent.id)[1]?.split('\nlabel ')[0];
    assert.ok(parent?.includes('$ renpy.dynamic("vn_actor_transition_overrides")'), row.prefix + ' 必须执行动态作用域。');
    assert.ok(parent.includes('vn_actor_transition_overrides = vn_actor_transition_overrides + ['), row.prefix + ' 必须执行内联调用覆盖。');
    assert.equal(parent.includes('call vn_blueprint_' + row.leaf.id), false, row.prefix + ' 叶时间轴必须已经内联。');
  }
  for (const [relative, content] of Object.entries(compiled.files)) {
    const destination = path.resolve(game, relative); assert.ok(inside(game, destination));
    await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.writeFile(destination, content);
    if (relative.endsWith('.rpy')) {
      const preserved = path.join(output, 'generated-source', relative);
      await fs.mkdir(path.dirname(preserved), { recursive: true }); await fs.writeFile(preserved, content);
    }
  }
  await fs.writeFile(path.join(output, 'source-map.json'), JSON.stringify(compiled.sourceMap, null, 2));
  for (const [id, rgba] of colors) {
    const png = new PNG({ width: 96, height: 160 });
    for (let index = 0; index < png.data.length; index += 4) { png.data[index] = rgba[0]; png.data[index + 1] = rgba[1]; png.data[index + 2] = rgba[2]; png.data[index + 3] = 255; }
    const asset = path.join(fixtureRoot, 'assets', id + '.png'); await fs.writeFile(asset, PNG.sync.write(png));
    await fs.mkdir(path.join(game, 'game/assets'), { recursive: true }); await fs.copyFile(asset, path.join(game, 'game/assets', id + '.png'));
  }
  await fs.mkdir(path.join(game, 'game/fonts'), { recursive: true });
  await fs.copyFile(path.join(sdk, 'sdk-fonts/SourceHanSansLite.ttf'), path.join(game, 'game/fonts/SourceHanSansLite.ttf'));
  await fs.writeFile(path.join(game, 'game/testcases.rpy'), tests);
  for (const command of ['compile', 'lint']) {
    const result = await runOwned(command, [command]); assert.equal(result.code, 0, result.log.slice(-8000));
  }
  const native = await runOwned('runtime', ['test', '--report-detailed', '--report-skipped']);
  recordFlowNativeResult(report, tests, native, 3); report.status = 'passed';
} catch (error) { failure = error; report.status = 'failed'; report.error = String(error); console.error(error); }
finally {
  // Only exact ChildProcess handles created above are ever signalled. Await a
  // close event before deleting this run's game; never kill by executable name.
  for (const { child, state } of owned.filter(item => !item.state.closed)) {
    child.kill();
    await new Promise<void>(resolve => {
      const timeout = setTimeout(resolve, 10000);
      child.once('close', () => { clearTimeout(timeout); resolve(); });
    });
  }
  const allClosed = owned.every(item => item.state.closed);
  report.ownedProcessesClosed = allClosed;
  if (!allClosed) { failure ??= new Error('自有原生进程尚未确认退出，保留本轮临时目录。'); report.status = 'failed'; report.error ??= String(failure); }
  const finishError = await finishFlowNativeVerification(output, game, report, previousSaves, { cleanup: allClosed });
  failure ??= finishError;
  if (failure) process.exitCode = 1;
}
