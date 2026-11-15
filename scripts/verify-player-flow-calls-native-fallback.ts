import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject, projectSchema, type StoryNode } from '../src/core/model';
import { buildProject, runRenpy } from '../src/runtime/service';
import { isolateRenpySaves } from './lib/renpy-saves';
import { finishFlowNativeVerification, flowRuntimeOutput, flowRuntimeTraceSource, recordFlowNativeResult } from './lib/flow-runtime-verification';
import { playerFlowHintVerificationSource } from './lib/player-flow-hint-verification';

// The main calls suite has authored controls. This small companion exercises
// the actual built-in flowchart screen, with no authored controls or QA screen.
const root = path.resolve('.');
const outputRoot = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? 'artifacts/player-flow-calls-2026-11-14/native-fallback');
const output = path.join(outputRoot, path.basename(flowRuntimeOutput('player-flow-calls-native-fallback')));
const relativeOutput = path.relative(root, output);
assert.ok(relativeOutput && !path.isAbsolute(relativeOutput) && relativeOutput !== '..' && !relativeOutput.startsWith('..' + path.sep));
const sdk = path.join(root, 'resources/runtime'), game = path.join(output, 'game'), source = path.join(output, 'source');
const previousSaves = process.env.RENPY_PATH_TO_SAVES;

const fixture = createProject('默认剧情目录调用与返回验收');
fixture.id = 'player_flow_call_native_fallback';
fixture.width = 1280; fixture.height = 800;
fixture.chapters = [{ id: 'qa_chapter', name: '默认目录验收', flowchart: { visible: false } }];
fixture.scenes = [{ id: 'qa_scene', name: '两次寄书', chapterId: 'qa_chapter', flowchart: { visible: false } }];
fixture.entryId = 'a';
const base = (id: string, name: string) => ({ id, name, sceneId: 'qa_scene', x: 0, y: 0 });
const passage = (id: string, name: string, text: string, next: string): StoryNode => ({
  ...base(id, name), kind: 'passage', next, textHeading: true, flowchart: { visible: true },
  lines: [{ id: 'line_' + id, text, actions: [] }],
});
const call = (id: string, target: string, next: string): StoryNode => ({ ...base(id, '内部调用'), kind: 'call', target, next });
fixture.nodes = [
  passage('a', '启程', '默认目录：出发前。', 'call_first'),
  call('call_first', 'x', 'b'),
  passage('b', '第一次返回', '默认目录：第一次调用已返回。', 'call_second'),
  call('call_second', 'x', 'c'),
  passage('c', '第二次返回', '默认目录：第二次调用已返回。', 'end'),
  passage('x', '寄书', '默认目录：共享寄书正文。', 'call_nested'),
  call('call_nested', 'y', 'x_after'),
  passage('x_after', '寄书办妥', '默认目录：内层调用已返回。', 'return_x'),
  { ...base('return_x', '寄书返回'), kind: 'return' },
  passage('y', '托付', '默认目录：托付等待。', 'return_y'),
  { ...base('return_y', '托付返回'), kind: 'return' },
  { ...base('end', '结束'), kind: 'end' },
];
// createProject leaves every page on its native default. Do not add any
// components, layout overrides, synthetic screen or replacement-page flag.
const project = projectSchema.parse(JSON.parse(JSON.stringify(fixture)));
assert.deepEqual(project.ui.components, []);
assert.deepEqual(project.ui.customPages, []);
assert.equal(project.ui.pages?.flowchart, undefined);

const report: Record<string, unknown> = {
  status: 'running', output,
  temporaryPaths: [source, game, path.join(output, 'saves'), path.join(output, 'renpy-saves')],
  limits: [
    'Two native cases open the actual built-in flowchart screen through VnUiMenu, from the title menu and from the running story.',
    'This fixture has zero authored UI controls, no custom pages, and no flowchart layout override or QA screen.',
    'Real pointer and keyboard navigation reaches the same shared body; accepted replays execute both native returns to the selected caller continuation.',
    'Only this generated story and its private saves/persistent state are used; no author project or historical artifact directory is opened.',
  ],
};
let failure: unknown, phase = 'fixture';
const tests = `
init -999 python:
    import renpy as _engine
    _engine.safe_mode_checked = True
${flowRuntimeTraceSource(output)}
${playerFlowHintVerificationSource()}
init python:
    def qa_options():
        return globals()['vn_flow_options_:native-flow']
    def qa_has(identity):
        return renpy.get_widget('flowchart', identity) is not None
    def qa_action(identity):
        return renpy.get_widget('flowchart', identity).action
    def qa_trail(identity):
        return [dict(step) for step in qa_action(identity).trail]
    def qa_selected(identity):
        return qa_has(identity) and renpy.display.behavior.is_selected(qa_action(identity))
    def qa_stack_sizes():
        context = renpy.game.context()
        return [len(context.return_stack), len(context.call_location_stack), len(context.abnormal_stack), len(context.dynamic_stack)]
    def qa_stack_balanced():
        sizes = qa_stack_sizes()
        return sizes[0] == sizes[1] == sizes[2] and sizes[3] == sizes[0] + 2

testsuite global:
    before testcase:
        $ _test.timeout = 30.0
        $ _test.screenshot_directory = 'tests/screenshots'
        $ preferences.transitions = 0
        $ preferences.text_cps = 0
        if screen 'confirm':
            click id 'vn_confirm_no' pos (.5, .5)
            pause until not screen 'confirm'
        if screen 'flowchart':
            click id 'vn_game_menu_return' pos (.5, .5)
            pause until not screen 'flowchart'
        if eval not main_menu:
            run MainMenu(confirm=False)
        pause until screen 'main_menu'
        $ persistent.vn_seen_nodes = []
        $ persistent.vn_seen_chapters = []
    teardown:
        exit

testcase title_default_directory_navigation_and_first_caller_replay:
    run VnUiMenu('flowchart')
    pause until screen 'flowchart'
    pause .2
    assert eval main_menu and qa_has('vn_game_menu_return') and 'flowchart' not in vn_ui_replaced_pages and vn_ui_pages.get('flowchart', {}).get('layout') != 'custom'
    assert eval qa_options()['flowComponentId'] == ':native-flow' and [entry[0] for entry in qa_options()['flowEntries']] == ['a', 'call:call_first', 'b', 'call:call_second', 'c']
    assert eval qa_has('vn_flow_native_call:call_first') and qa_has('vn_flow_native_call:call_second') and not qa_has('vn_flow_native_x') and not qa_has('vn_flow_native_y')
    assert eval set((edge['from'], edge['to']) for edge in qa_options()['flowGraph']['edges']) == {('a', 'call:call_first'), ('call:call_first', 'b'), ('b', 'call:call_second'), ('call:call_second', 'c')}
    assert eval qa_flow_hint_check('flowchart', ['vn_flow_native_call:' + caller + '_browse_hint' for caller in ('call_first', 'call_second')], 'vector-hints-root')
    assert eval not qa_has('vn_flow_native_a_browse_hint') and not qa_has('vn_flow_native_b_browse_hint')
    move id 'vn_flow_native_call:call_first' pos (.5, .5)
    pause .08
    assert eval GetTooltip('flowchart') == '双击查看子剧情，或按 Enter 进入'
    run Function(qa_trace, 'native-default-title-root', entries=qa_options()['flowEntries'], component=qa_options()['flowComponentId'], graph=qa_options()['flowGraph'], replaced=list(vn_ui_replaced_pages))
    screenshot '01-real-default-directory-at-title.png'
    click id 'vn_flow_native_call:call_first' pos (.5, .5)
    pause .08
    assert eval not qa_has('vn_flow_native_x')
    click id 'vn_flow_native_call:call_first' pos (.5, .5)
    pause .2
    assert eval qa_has('vn_flow_native_x') and qa_has('vn_flow_native_call:call_nested') and qa_has('vn_flow_native_group_back')
    assert eval qa_trail('vn_flow_native_x') == [{'viewId': 'call-body:x', 'callId': 'call_first'}]
    assert eval qa_flow_hint_check('flowchart', ['vn_flow_native_call:call_nested_browse_hint'], 'vector-hints-nested')
    assert eval not qa_has('vn_flow_native_x_browse_hint') and not qa_has('vn_flow_native_x_after_browse_hint')
    move id 'vn_flow_native_call:call_nested' pos (.5, .5)
    pause .08
    assert eval GetTooltip('flowchart') == '双击查看子剧情，或按 Enter 进入'
    move id 'vn_flow_native_x' pos (.5, .5)
    pause .08
    assert eval GetTooltip('flowchart') is None
    keysym 'K_RETURN' id 'vn_flow_native_call:call_nested' pos (.5, .5)
    pause .2
    assert eval qa_has('vn_flow_native_y') and qa_trail('vn_flow_native_y') == [{'viewId': 'call-body:x', 'callId': 'call_first'}, {'viewId': 'call-body:y', 'callId': 'call_nested'}]
    screenshot '02-real-default-directory-nested-body.png'
    click id 'vn_flow_native_group_back' pos (.5, .5)
    pause .1
    assert eval qa_has('vn_flow_native_x') and not qa_has('vn_flow_native_y')
    click id 'vn_flow_native_group_back' pos (.5, .5)
    pause .1
    assert eval qa_has('vn_flow_native_call:call_first') and qa_has('vn_flow_native_call:call_second') and not qa_has('vn_flow_native_x')
    assert eval persistent.vn_seen_nodes == [] and vn_flow_replay_key not in renpy.session
    click id 'vn_game_menu_return' pos (.5, .5)
    pause until screen 'main_menu'
    assert eval main_menu and renpy.get_screen('flowchart') is None
    run VnUiMenu('flowchart')
    pause until screen 'flowchart'
    keysym 'K_RETURN' id 'vn_flow_native_call:call_first' pos (.5, .5)
    keysym 'K_RETURN' id 'vn_flow_native_call:call_nested' pos (.5, .5)
    click id 'vn_flow_native_y' pos (.5, .5)
    pause until '默认目录：托付等待。'
    assert eval not main_menu and not renpy.get_screen('confirm') and vn_current_node == 'y' and vn_flow_call_chain() == ['call_first', 'call_nested']
    assert eval qa_stack_balanced() and vn_flow_replay_key not in renpy.session
    advance until '默认目录：内层调用已返回。'
    assert eval vn_current_node == 'x_after' and vn_flow_call_chain() == ['call_first'] and qa_stack_balanced()
    advance until '默认目录：第一次调用已返回。'
    assert eval vn_current_node == 'b' and vn_flow_call_chain() == [] and qa_stack_balanced() and vn_flow_replay_key not in renpy.session
    run Function(qa_trace, 'native-default-first-replay-return', current=vn_current_node, calls=vn_flow_call_chain(), stacks=qa_stack_sizes())
    screenshot '03-default-directory-replay-reached-first-continuation.png'

testcase game_default_directory_current_return_and_second_caller_replay:
    run Start()
    pause until '默认目录：出发前。'
    advance until '默认目录：第一次调用已返回。'
    advance until '默认目录：托付等待。'
    assert eval vn_current_node == 'y' and vn_flow_call_chain() == ['call_second', 'call_nested'] and qa_stack_balanced()
    run VnUiMenu('flowchart')
    pause until screen 'flowchart'
    pause .2
    assert eval not main_menu and len(renpy.game.contexts) > 1 and qa_has('vn_game_menu_return') and 'flowchart' not in vn_ui_replaced_pages
    assert eval qa_selected('vn_flow_native_call:call_second') and not qa_selected('vn_flow_native_call:call_first')
    screenshot '04-real-default-game-menu-second-caller.png'
    keysym 'K_RETURN' id 'vn_flow_native_call:call_second' pos (.5, .5)
    pause .2
    assert eval qa_selected('vn_flow_native_call:call_nested') and qa_trail('vn_flow_native_x') == [{'viewId': 'call-body:x', 'callId': 'call_second'}]
    keysym 'K_RETURN' id 'vn_flow_native_call:call_nested' pos (.5, .5)
    pause .2
    assert eval qa_selected('vn_flow_native_y') and qa_trail('vn_flow_native_y') == [{'viewId': 'call-body:x', 'callId': 'call_second'}, {'viewId': 'call-body:y', 'callId': 'call_nested'}]
    click id 'vn_game_menu_return' pos (.5, .5)
    pause until '默认目录：托付等待。'
    assert eval renpy.get_screen('flowchart') is None and vn_current_node == 'y' and vn_flow_call_chain() == ['call_second', 'call_nested'] and qa_stack_balanced()
    run VnUiMenu('flowchart')
    pause until screen 'flowchart'
    keysym 'K_RETURN' id 'vn_flow_native_call:call_second' pos (.5, .5)
    keysym 'K_RETURN' id 'vn_flow_native_call:call_nested' pos (.5, .5)
    click id 'vn_flow_native_y' pos (.5, .5)
    pause until screen 'confirm'
    assert eval '托付' in renpy.get_screen('confirm').scope['message'] and vn_current_node == 'y' and vn_flow_replay_key not in renpy.session
    screenshot '05-real-default-directory-replay-confirmation.png'
    click id 'vn_confirm_yes' pos (.5, .5)
    pause until '默认目录：托付等待。'
    assert eval not main_menu and not renpy.get_screen('confirm') and vn_current_node == 'y' and vn_flow_call_chain() == ['call_second', 'call_nested']
    assert eval qa_stack_balanced() and vn_flow_replay_key not in renpy.session
    advance until '默认目录：内层调用已返回。'
    assert eval vn_current_node == 'x_after' and vn_flow_call_chain() == ['call_second'] and qa_stack_balanced()
    advance until '默认目录：第二次调用已返回。'
    assert eval vn_current_node == 'c' and vn_flow_call_chain() == [] and qa_stack_balanced() and vn_flow_replay_key not in renpy.session
    run Function(qa_trace, 'native-default-second-replay-return', current=vn_current_node, calls=vn_flow_call_chain(), stacks=qa_stack_sizes())
    screenshot '06-default-directory-replay-reached-second-continuation.png'
`;

async function fingerprints() {
  const files = [
    'src/core/player-flow-projection.ts', 'src/core/player-flow-content.ts', 'src/core/player-flow-content-schema.ts',
    'src/core/story-flow.ts', 'src/core/story-flow-connections.ts', 'src/core/story-menu.ts',
    'src/runtime/screens.ts', 'src/runtime/story-menu-runtime.ts', 'src/runtime/player-flow-call-runtime.ts',
    'src/runtime/spatial-ui-widgets.ts', 'src/runtime/ui-widgets.ts', 'src/runtime/compiler.ts',
  ];
  return Promise.all(files.map(async file => ({ file, sha256: createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex') })));
}

async function preserveSources() {
  const gameRoot = path.join(game, 'game'), destination = path.join(output, 'generated-source');
  const copy = async (directory: string, relative = ''): Promise<void> => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    })) {
      const next = path.join(relative, entry.name), filename = path.join(directory, entry.name);
      if (entry.isDirectory() && !['assets', 'fonts', 'gui', 'saves', 'cache', 'tests'].includes(entry.name)) await copy(filename, next);
      else if (entry.isFile() && entry.name.endsWith('.rpy')) {
        await fs.mkdir(path.dirname(path.join(destination, next)), { recursive: true });
        await fs.copyFile(filename, path.join(destination, next));
      }
    }
  };
  await copy(gameRoot);
  for (const name of ['source-map.json', 'build-manifest.json']) {
    const content = await fs.readFile(path.join(game, name)).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    });
    if (content) await fs.writeFile(path.join(output, name), content);
  }
}

try {
  await fs.mkdir(source, { recursive: true });
  report.sourceBefore = await fingerprints();
  await isolateRenpySaves(output);
  const fixtureBytes = JSON.stringify(project, null, 2);
  report.fixtureSha256 = createHash('sha256').update(fixtureBytes).digest('hex');
  report.authoredUiControls = project.ui.components.length;
  report.customPages = project.ui.customPages.length;
  report.flowchartPageOverride = project.ui.pages?.flowchart ?? null;
  await fs.writeFile(path.join(output, 'fixture.vns.json'), fixtureBytes);
  await fs.writeFile(path.join(source, 'project.vns.json'), fixtureBytes);
  await fs.writeFile(path.join(output, 'testcases.rpy'), tests);
  phase = 'build';
  const built = await buildProject({ project, projectDir: source, outputDir: game, sdkRoot: sdk });
  await fs.writeFile(path.join(output, 'build.json'), JSON.stringify(built, null, 2));
  report.fixtureDiagnostics = built.diagnostics;
  assert.equal(built.ok, true, JSON.stringify(built));
  await fs.writeFile(path.join(game, 'game/testcases.rpy'), tests);
  phase = 'native interactions';
  const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 180000,
    env: { RENPY_RENDERER: 'gl2', PYTHONUNBUFFERED: '1' }, onData: text => process.stdout.write(text) });
  await fs.writeFile(path.join(output, 'run.log'), result.log);
  recordFlowNativeResult(report, tests, result, 2);
  report.sourceAfter = await fingerprints();
  assert.deepEqual(report.sourceAfter, report.sourceBefore, 'Native verification must use one unchanged product snapshot.');
  report.status = 'passed';
} catch (error) {
  failure = error; report.status = 'failed'; report.phase = phase; report.error = error instanceof Error ? error.stack : String(error);
} finally {
  try { await preserveSources(); }
  catch (error) { failure ??= error; report.status = 'failed'; report.sourceEvidenceError = String(error); }
  const finishFailure = await finishFlowNativeVerification(output, game, report, previousSaves, { cleanup: !report.sourceEvidenceError });
  failure ??= finishFailure;
}
if (failure) throw failure;
