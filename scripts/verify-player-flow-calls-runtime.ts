import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject, projectSchema, type Project, type StoryNode, type UiComponent } from '../src/core/model';
import { playerFlowRuntimeData } from '../src/runtime/screens';
import { buildProject, runRenpy } from '../src/runtime/service';
import { pythonBlockLiteral, pythonLiteral as py } from '../src/runtime/literals';
import { isolateRenpySaves } from './lib/renpy-saves';
import { finishFlowNativeVerification, flowRuntimeOutput, flowRuntimeTraceSource, recordFlowNativeResult } from './lib/flow-runtime-verification';
import { playerFlowHintVerificationSource } from './lib/player-flow-hint-verification';

// Run only after the coordinated product build. No author project or historical
// artifact directory is read; every game and save belongs to this fresh run.
const root = path.resolve('.');
const outputRoot = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? 'artifacts/player-flow-calls-2026-11-14/runtime');
const output = path.join(outputRoot, path.basename(flowRuntimeOutput('player-flow-calls')));
const relativeOutput = path.relative(root, output);
assert.ok(relativeOutput && !path.isAbsolute(relativeOutput) && relativeOutput !== '..' && !relativeOutput.startsWith('..' + path.sep));
const sdk = path.join(root, 'resources/runtime'), game = path.join(output, 'game'), source = path.join(output, 'source');
const previousSaves = process.env.RENPY_PATH_TO_SAVES;

const mainEntries = ['a', 'b', 'c', 'x', 'x_after', 'y'];
const mainVisits = [...mainEntries, 'call_first', 'call_second', 'call_nested', 'x_detail', 'return_x', 'return_y'];
const rootPositions = {
  a: { x: 36, y: 20 }, 'call:call_first': { x: 36, y: 122 }, b: { x: 36, y: 224 },
  'call:call_second': { x: 36, y: 326 }, c: { x: 36, y: 428 },
};
const bodyPositions = {
  'call-body:x': { x: { x: 36, y: 26 }, 'call:call_nested': { x: 36, y: 146 }, x_after: { x: 36, y: 266 } },
  'call-body:y': { y: { x: 36, y: 26 } },
};

function createFixture(): Project {
  const project = createProject('调用与返回原生验收');
  project.id = 'player_flow_calls_acceptance';
  project.width = 1280; project.height = 800;
  project.chapters = [{ id: 'qa_chapter', name: '验收故事', flowchart: { visible: false } }];
  project.scenes = [{ id: 'qa_scene', name: '共享寄书剧情', chapterId: 'qa_chapter', flowchart: { visible: false } }];
  project.variables = [{ id: 'qa_group_visible', name: '单独验收分组图', type: 'boolean', initial: false, persistent: false }];
  project.entryId = 'a';
  const base = (id: string, name: string) => ({ id, name, sceneId: 'qa_scene', x: 0, y: 0, textHeading: false });
  const passage = (id: string, name: string, text: string, next: string, visible = false): StoryNode => ({
    ...base(id, name), kind: 'passage', next, textHeading: visible,
    lines: [{ id: 'line_' + id, text, actions: [] }], ...(visible ? { flowchart: { visible: true } } : {}),
  });
  const call = (id: string, target: string, next: string): StoryNode => ({ ...base(id, '内部调用'), kind: 'call', target, next });
  project.nodes = [
    passage('a', '启程', '出发前的存档锚点。', 'call_first', true),
    call('call_first', 'x', 'b'),
    passage('b', '第一次返回', '第一次调用已经返回。', 'call_second', true),
    call('call_second', 'x', 'c'),
    passage('c', '第二次返回', '第二次调用已经返回。', 'end', true),
    passage('x', '寄书', '寄书等待锚点。', 'x_detail', true),
    passage('x_detail', '寄书内部', '寄书内部续句。', 'call_nested'),
    call('call_nested', 'y', 'x_after'),
    passage('x_after', '寄书办妥', '寄书已经办妥。', 'return_x', true),
    { ...base('return_x', '寄书返回'), kind: 'return' },
    passage('y', '托付', '托付等待锚点。', 'return_y', true),
    { ...base('return_y', '托付返回'), kind: 'return' },
    { ...base('end', '故事结束'), kind: 'end' },
    passage('rec_lead', '循环前', '循环入口。', 'call_recursive'),
    call('call_recursive', 'rec_body', 'rec_after'),
    passage('rec_after', '循环后', '循环调用返回。', 'end'),
    passage('rec_body', '回望', '递归正文。', 'rec_choice'),
    { ...base('rec_choice', '继续或结束'), kind: 'choice', prompt: '是否再看一遍？', choices: [
      { id: 'again', text: '再看一遍', target: 'recursive_again' }, { id: 'finish', text: '结束', target: 'rec_return' },
    ] },
    call('recursive_again', 'rec_body', 'rec_return'),
    { ...base('rec_return', '循环返回'), kind: 'return' },
    passage('no_return_lead', '终章前', '不会返回的调用。', 'call_no_return'),
    call('call_no_return', 'no_return_body', 'no_return_after'),
    passage('no_return_body', '落幕', '此处结束故事。', 'end'),
    passage('no_return_after', '不会执行的后续', '不可达的返回后续。', 'end'),
  ];
  project.nodes.find(node => node.id === 'x')!.flowchart = { visible: true, name: '第一回｜寄书', styleId: 'qa_letter_style' };
  project.ui.pages = { flowchart: { layout: 'custom', background: '#192621' } };
  project.ui.flowStyles = [{ id: 'qa_letter_style', name: '寄书黑底双字号', style: {
    background: '#000000', textColor: '#f0e4c3', selectedTextColor: '#ffe299', letterSpacing: 1.5,
    captionParts: [{ fontSize: 18, color: '#9aa793' }, { fontSize: 30, color: '#f0e4c3' }],
  } }];
  const branch: UiComponent = {
    id: 'qa_call_map', name: '自定义分支图', page: 'flowchart', kind: 'flowchart', text: '', x: .02, y: .10, width: .59, height: .76,
    style: { fontSize: 27, textColor: '#f1eddb', selectedTextColor: '#ffe299', background: '#080c09', borderWidth: 1, borderColor: '#56695a' },
    list: { layout: 'flow', itemWidth: 480, itemHeight: 72, gapX: 32, gapY: 30, flowDirection: 'vertical',
      flowViewport: { x: 0, y: 0, width: 1, height: 1 }, flowShowControls: false, flowShowVerticalScrollbar: false,
      lockUnread: true, flowLockedNode: 'hide', flowLockedLine: 'show', showProgress: true, confirmJump: true,
      flowContent: { mode: 'custom', custom: {
        entries: mainEntries.map(nodeId => ({ nodeId, ...(nodeId === 'x' ? { name: '上篇｜寄书', styleId: 'qa_letter_style' } : {}) })),
        positions: structuredClone(rootPositions), views: structuredClone(bodyPositions),
      } },
    },
  };
  const directory: UiComponent = {
    id: 'qa_call_directory', name: '跟随剧本目录', page: 'flowchart', kind: 'flowchart', text: '', x: .65, y: .10, width: .33, height: .76,
    style: { fontSize: 25, textColor: '#f1eddb', selectedTextColor: '#ffe299', background: '#080c09' },
    list: { layout: 'grid', columns: 1, rows: 5, itemWidth: 400, itemHeight: 76, gapY: 15,
      lockUnread: true, flowLockedNode: 'hide', flowLockedLine: 'show', showProgress: true, confirmJump: true,
      flowPositions: structuredClone(rootPositions), flowContent: { mode: 'script', scriptViews: structuredClone(bodyPositions) },
    },
  };
  const grouped = structuredClone(branch);
  grouped.id = 'qa_call_grouped'; grouped.name = '含显示分组的子剧情';
  grouped.visibleWhen = { kind: 'compare', variableId: 'qa_group_visible', operator: 'eq', value: true };
  grouped.list!.flowContent!.custom!.groups = [{ id: 'letter_group', name: '往返信件', nodeIds: ['x', 'x_after'] }];
  grouped.list!.flowContent!.custom!.views = {
    ...bodyPositions,
    'call-body:x': { 'group-view:call-body:x:letter_group': { x: 36, y: 26 }, 'call:call_nested': { x: 36, y: 146 } },
    'group-view:call-body:x:letter_group': { x: { x: 36, y: 26 }, x_after: { x: 36, y: 146 } },
  };
  project.ui.components = [branch, directory, grouped,
    { id: 'qa_call_heading', kind: 'text', page: 'flowchart', text: '同一段寄书剧情，两处调用各自继续', x: .04, y: .025, width: .90, height: .055, style: { fontSize: 27, textColor: '#f1eddb' } },
    { id: 'qa_call_close', kind: 'button', page: 'flowchart', text: '返回游戏', action: 'return', x: .80, y: .91, width: .16, height: .06 },
  ];
  return projectSchema.parse(JSON.parse(JSON.stringify(project)));
}

const project = createFixture();
const special: UiComponent = {
  id: 'qa_special', name: '递归与终结验收', kind: 'flowchart', page: 'flowchart', text: '', x: 0, y: 0, width: .92, height: .75,
  style: { fontSize: 27, textColor: '#ffffff', background: '#000000' },
  list: { layout: 'flow', itemWidth: 430, itemHeight: 80, gapX: 70, gapY: 40, flowDirection: 'vertical',
    flowViewport: { x: 0, y: 0, width: 1, height: 1 }, flowShowControls: false, flowShowVerticalScrollbar: false, lockUnread: false,
    flowContent: { mode: 'custom', custom: {
      entries: ['rec_lead', 'rec_body', 'rec_after', 'no_return_lead', 'no_return_body', 'no_return_after'].map(nodeId => ({ nodeId })),
      positions: { rec_lead: { x: 30, y: 30 }, 'call:call_recursive': { x: 30, y: 160 }, rec_after: { x: 30, y: 290 },
        no_return_lead: { x: 610, y: 30 }, 'call:call_no_return': { x: 610, y: 160 }, no_return_after: { x: 610, y: 370 } },
      views: { 'call-body:rec_body': { rec_body: { x: 30, y: 30 }, 'call:recursive_again': { x: 30, y: 180 } },
        'call-body:no_return_body': { no_return_body: { x: 30, y: 30 } } },
    } },
  },
};
const specialOptions = { ...special.list, ...playerFlowRuntimeData(project, special) };
const mainOptions = Object.fromEntries(project.ui.components.filter(component => component.kind === 'flowchart').map(component => [component.id, playerFlowRuntimeData(project, component)]));
const report: Record<string, unknown> = { status: 'running', output, temporaryPaths: [source, game, path.join(output, 'saves'), path.join(output, 'renpy-saves')], limits: [
  'Only this generated story and its private saves/persistent state are used; no author project is opened.',
  'Nine native cases use real widget clicks/keys for navigation, confirmation, replay and the game-menu context; no manually constructed execution stack is used.',
  'Native Rollback crosses the inner return of a reconstructed replay call stack, then forward play returns through both callers again.',
  'The recursive and nonreturning story paths are presentation fixtures; recursion is browsed but not executed without a bound.',
  'The built-in directory is rendered through its real compiled registry in a QA screen because this fixture deliberately has authored flowchart controls.',
] };
let failure: unknown, phase = 'fixture';

const tests = `
init -999 python:
    import renpy as _engine
    _engine.safe_mode_checked = True
${flowRuntimeTraceSource(output)}
${playerFlowHintVerificationSource()}
init python:
    qa_call_special = ${pythonBlockLiteral(specialOptions, 1)}
    qa_call_visits = ${py(mainVisits)}
    def qa_widget(screen_name, identity):
        return renpy.get_widget(screen_name, identity)
    def qa_has(screen_name, identity):
        return qa_widget(screen_name, identity) is not None
    def qa_text(screen_name, identity):
        return qa_widget(screen_name, identity).get_all_text()
    def qa_action(screen_name, identity):
        return qa_widget(screen_name, identity).action
    def qa_selected(screen_name, identity):
        widget = qa_widget(screen_name, identity)
        return widget is not None and renpy.display.behavior.is_selected(widget.action)
    def qa_trail(screen_name, identity):
        return [dict(step) for step in qa_action(screen_name, identity).trail]
    def qa_edges(options, view_id=None):
        graph = options.get('flowViews', {}).get(view_id, {}).get('graph') if view_id else options['flowGraph']
        return set((edge['from'], edge['to']) for edge in graph['edges'])
    def qa_stack_sizes():
        context = renpy.game.context()
        return [len(context.return_stack), len(context.call_location_stack), len(context.abnormal_stack), len(context.dynamic_stack)]
    def qa_stack_balanced():
        sizes = qa_stack_sizes()
        return sizes[0] == sizes[1] == sizes[2] and sizes[3] == sizes[0] + 2
    def qa_native_options():
        return globals()['vn_flow_options_:native-flow']
    def qa_call_snapshot(screen_name, identity):
        widget = qa_widget(screen_name, identity)
        action = widget.action if widget is not None else None
        now = renpy.display.core.get_time()
        event = renpy.game.interface.last_event
        gesture = dict(action.gesture) if action is not None and action.gesture is not None else {}
        return dict(time=now, widget=widget is not None, actionId=id(action),
            gesture=gesture, gestureId=id(action.gesture) if action is not None else None,
            gestureAge=now - gesture['time'] if 'time' in gesture else None,
            lastEventType=getattr(event, 'type', None), lastEventPosition=getattr(event, 'pos', None),
            mousePosition=renpy.test.testmouse.mouse_pos,
            navigationCount=len(action.navigation or []) if action is not None else 0,
            trail=list(action.trail) if action is not None else None,
            candidate=vn_flow_enter_trail(action.options, action.trail, action.identity) if action is not None else None,
            entered=qa_has(screen_name, 'vn_component_qa_call_map_x'))

screen qa_call_special_screen():
    modal True
    zorder 200
    add Solid('#192621')
    fixed:
        pos (45, 55)
        xysize (1180, 600)
        use vn_collection('flowchart', 1180, 600, 27, '#ffffff', '#000000', {}, qa_call_special, 'qa_special', style.default.font)
    textbutton '关闭验收图' id 'qa_special_close' action Hide('qa_call_special_screen') pos (1020, 715)

screen qa_call_grouped_screen():
    modal True
    zorder 200
    add Solid('#192621')
    fixed:
        pos (60, 45)
        xysize (1100, 620)
        use vn_collection('flowchart', 1100, 620, 27, '#ffffff', '#080c09', {}, vn_flow_options_qa_call_grouped, 'qa_grouped', style.default.font)
    textbutton '关闭验收图' id 'qa_grouped_close' action Hide('qa_call_grouped_screen') pos (1020, 715)

screen qa_call_native_screen():
    modal True
    zorder 190
    add Solid('#192621')
    fixed:
        pos (60, 45)
        xysize (1100, 620)
        use vn_collection('flowchart', 1100, 620, 27, '#ffffff', '#080c09', {}, qa_native_options(), 'vn_flow_native', style.default.font)
    textbutton '关闭验收图' id 'qa_native_close' action Hide('qa_call_native_screen') pos (1020, 715)

testsuite global:
    before testcase:
        $ _test.timeout = 30.0
        $ _test.screenshot_directory = 'tests/screenshots'
        $ preferences.transitions = 0
        $ preferences.text_cps = 0
        # A failed case may leave a title-menu child open. MainMenu is disabled
        # in that context, so first leave the existing UI through its own action.
        if screen 'confirm':
            click id 'vn_confirm_no' pos (.5, .5)
            pause until not screen 'confirm'
        if screen 'qa_call_special_screen':
            run Hide('qa_call_special_screen')
        if screen 'qa_call_grouped_screen':
            run Hide('qa_call_grouped_screen')
        if screen 'qa_call_native_screen':
            run Hide('qa_call_native_screen')
        if screen 'flowchart':
            click id 'vn_component_qa_call_close' pos (.5, .5)
            pause until not screen 'flowchart'
        if eval not main_menu:
            run MainMenu(confirm=False)
        pause until screen 'main_menu'
        $ persistent.vn_seen_nodes = []
        $ persistent.vn_seen_chapters = []
    teardown:
        exit

testcase sequential_calls_and_independent_navigation:
    run SetField(persistent, 'vn_seen_nodes', list(qa_call_visits))
    run VnUiMenu('flowchart')
    pause until screen 'flowchart'
    pause .2
    assert eval qa_edges(vn_flow_options_qa_call_map) == {('a', 'call:call_first'), ('call:call_first', 'b'), ('b', 'call:call_second'), ('call:call_second', 'c')}
    assert eval qa_edges(vn_flow_options_qa_call_directory) == qa_edges(vn_flow_options_qa_call_map)
    assert eval [entry[0] for entry in vn_flow_options_qa_call_directory['flowEntries']] == ['a', 'call:call_first', 'b', 'call:call_second', 'c']
    assert eval not qa_has('flowchart', 'vn_component_qa_call_map_x') and not qa_has('flowchart', 'vn_component_qa_call_directory_x')
    assert eval '寄书' in qa_text('flowchart', 'vn_component_qa_call_map_call:call_first_label') and '寄书' in qa_text('flowchart', 'vn_component_qa_call_map_call:call_second_label')
    assert eval '{size=18}' in qa_text('flowchart', 'vn_component_qa_call_map_call:call_first_label') and '{size=30}' in qa_text('flowchart', 'vn_component_qa_call_map_call:call_first_label')
    assert eval vn_flow_options_qa_call_map['flowLooks']['call:call_first']['style']['background'] == '#000000'
    assert eval vn_flow_options_qa_call_map['flowLooks']['call:call_first']['node']['parts'] == ['上篇', '寄书'] and vn_flow_options_qa_call_directory['flowLooks']['call:call_first']['node']['parts'] == ['第一回', '寄书']
    assert eval qa_flow_hint_check('flowchart', [prefix + '_call:' + caller + '_browse_hint' for prefix in ('vn_component_qa_call_map', 'vn_component_qa_call_directory') for caller in ('call_first', 'call_second')], 'vector-hints-root')
    assert eval not qa_has('flowchart', 'vn_component_qa_call_map_a_browse_hint') and not qa_has('flowchart', 'vn_component_qa_call_directory_a_browse_hint')
    move id 'vn_component_qa_call_map_call:call_first' pos (.5, .5)
    pause .08
    assert eval GetTooltip('flowchart') == '双击查看子剧情，或按 Enter 进入'
    screenshot '01-sequential-shared-call-root.png'
    # The native test runner randomizes unspecified click positions. A real
    # double-click must use the same point as well as the same time window.
    click id 'vn_component_qa_call_map_call:call_first' pos (.5, .5)
    pause .08
    assert eval not qa_has('flowchart', 'vn_component_qa_call_map_x')
    $ renpy.test.testexecution.qa_call_first_click = qa_call_snapshot('flowchart', 'vn_component_qa_call_map_call:call_first')
    click id 'vn_component_qa_call_map_call:call_first' pos (.5, .5)
    pause .2
    run Function(qa_trace, 'call-double-click', first=renpy.test.testexecution.qa_call_first_click, second=qa_call_snapshot('flowchart', 'vn_component_qa_call_map_call:call_first'))
    assert eval qa_has('flowchart', 'vn_component_qa_call_map_x') and qa_has('flowchart', 'vn_component_qa_call_map_call:call_nested')
    assert eval qa_has('flowchart', 'vn_component_qa_call_directory_call:call_first') and not qa_has('flowchart', 'vn_component_qa_call_directory_x')
    keysym 'K_RETURN' id 'vn_component_qa_call_directory_call:call_second'
    pause .2
    assert eval qa_trail('flowchart', 'vn_component_qa_call_map_x') == [{'viewId': 'call-body:x', 'callId': 'call_first'}]
    assert eval qa_trail('flowchart', 'vn_component_qa_call_directory_x') == [{'viewId': 'call-body:x', 'callId': 'call_second'}]
    assert eval qa_flow_hint_check('flowchart', [prefix + '_call:call_nested_browse_hint' for prefix in ('vn_component_qa_call_map', 'vn_component_qa_call_directory')], 'vector-hints-nested')
    assert eval not qa_has('flowchart', 'vn_component_qa_call_map_x_browse_hint') and not qa_has('flowchart', 'vn_component_qa_call_directory_x_browse_hint')
    move id 'vn_component_qa_call_directory_call:call_nested' pos (.5, .5)
    pause .08
    assert eval GetTooltip('flowchart') == '双击查看子剧情，或按 Enter 进入'
    move id 'vn_component_qa_call_map_x' pos (.5, .5)
    pause .08
    assert eval GetTooltip('flowchart') is None
    screenshot '02-independent-call-contexts.png'
    keysym 'K_RETURN' id 'vn_component_qa_call_map_call:call_nested'
    pause .2
    assert eval qa_has('flowchart', 'vn_component_qa_call_map_y') and not qa_has('flowchart', 'vn_component_qa_call_map_x')
    assert eval qa_trail('flowchart', 'vn_component_qa_call_map_y') == [{'viewId': 'call-body:x', 'callId': 'call_first'}, {'viewId': 'call-body:y', 'callId': 'call_nested'}]
    click id 'vn_component_qa_call_map_group_back'
    pause .1
    assert eval qa_has('flowchart', 'vn_component_qa_call_map_x') and qa_has('flowchart', 'vn_component_qa_call_directory_x')
    click id 'vn_component_qa_call_map_group_back'
    pause .1
    assert eval qa_has('flowchart', 'vn_component_qa_call_map_call:call_first') and qa_has('flowchart', 'vn_component_qa_call_directory_x')
    keysym 'K_ESCAPE'
    pause .2
    assert eval renpy.get_screen('flowchart') is not None and qa_has('flowchart', 'vn_component_qa_call_directory_call:call_second')
    assert eval persistent.vn_seen_nodes == qa_call_visits and main_menu
    run Function(qa_trace, 'navigation', edges=sorted(qa_edges(vn_flow_options_qa_call_map)), views=sorted(vn_flow_options_qa_call_map['flowViews']), visits=list(persistent.vn_seen_nodes))
    click id 'vn_component_qa_call_close'

testcase call_site_unlocks_do_not_leak_shared_content:
    run SetField(persistent, 'vn_seen_nodes', ['a', 'call_first', 'x', 'x_detail', 'call_nested', 'y', 'x_after'])
    run VnUiMenu('flowchart')
    pause until screen 'flowchart'
    pause .2
    assert eval not vn_flow_locked('call:call_first', vn_flow_options_qa_call_map) and vn_flow_locked('call:call_second', vn_flow_options_qa_call_map)
    assert eval qa_has('flowchart', 'vn_component_qa_call_map_call:call_first') and not qa_has('flowchart', 'vn_component_qa_call_map_call:call_second')
    assert eval qa_has('flowchart', 'vn_component_qa_call_directory_call:call_first') and not qa_has('flowchart', 'vn_component_qa_call_directory_call:call_second')
    assert eval all(vn_flow_edge_alpha(edge, vn_flow_options_qa_call_map) == (1.0 if edge['from'] == 'a' else 0.0) for edge in vn_flow_options_qa_call_map['flowGraph']['edges'])
    assert eval vn_flow_replay_plan(vn_flow_options_qa_call_map, 'x', [{'viewId': 'call-body:x', 'callId': 'call_second'}]) is None
    assert eval vn_flow_replay_plan(vn_flow_options_qa_call_map, 'y', [{'viewId': 'call-body:x', 'callId': 'call_first'}]) is None
    assert eval vn_flow_replay_plan(vn_flow_options_qa_call_map, 'x', [{'viewId': 'call-body:x', 'callId': 'unknown_caller'}]) is None
    screenshot '03-first-call-seen-second-still-hidden.png'
    keysym 'K_RETURN' id 'vn_component_qa_call_map_call:call_first'
    pause .2
    assert eval qa_has('flowchart', 'vn_component_qa_call_map_x') and not qa_has('flowchart', 'vn_component_qa_call_directory_call:call_second')
    click id 'vn_component_qa_call_map_group_back'
    run SetField(persistent, 'vn_seen_nodes', list(qa_call_visits))
    pause .2
    assert eval qa_has('flowchart', 'vn_component_qa_call_map_call:call_second') and qa_has('flowchart', 'vn_component_qa_call_directory_call:call_second')
    assert eval all(vn_flow_edge_alpha(edge, vn_flow_options_qa_call_map) == 1.0 for edge in vn_flow_options_qa_call_map['flowGraph']['edges'])
    assert eval all(not identity.startswith('call:') and not identity.startswith('call-body:') for identity in persistent.vn_seen_nodes)
    run Function(qa_trace, 'call-site-unlocks', visits=list(persistent.vn_seen_nodes))
    click id 'vn_component_qa_call_close'

testcase game_menu_current_tracks_caller_and_save_load:
    run Start()
    pause until '出发前的存档锚点。'
    advance until '寄书等待锚点。'
    assert eval vn_current_node == 'x' and vn_flow_call_chain() == ['call_first']
    run FileSave('qa_first_call', confirm=False, slot=True)
    assert eval renpy.can_load('qa_first_call') and qa_stack_balanced()
    advance until '寄书内部续句。'
    run VnUiMenu('flowchart')
    pause until screen 'flowchart'
    pause .2
    assert eval len(renpy.game.contexts) > 1 and vn_flow_call_chain() == ['call_first']
    assert eval qa_selected('flowchart', 'vn_component_qa_call_map_call:call_first') and qa_selected('flowchart', 'vn_component_qa_call_directory_call:call_first')
    assert eval not qa_selected('flowchart', 'vn_component_qa_call_map_call:call_second')
    keysym 'K_RETURN' id 'vn_component_qa_call_map_call:call_first'
    pause .2
    assert eval qa_selected('flowchart', 'vn_component_qa_call_map_x') and vn_current_node == 'x_detail'
    screenshot '04-hidden-dialogue-current-in-first-call.png'
    click id 'vn_component_qa_call_close'
    pause until '寄书内部续句。'
    advance until '第一次调用已经返回。'
    assert eval vn_current_node == 'b' and vn_flow_call_chain() == [] and qa_stack_balanced()
    advance until '寄书等待锚点。'
    assert eval vn_current_node == 'x' and vn_flow_call_chain() == ['call_second']
    run VnUiMenu('flowchart')
    pause until screen 'flowchart'
    pause .2
    assert eval qa_selected('flowchart', 'vn_component_qa_call_map_call:call_second') and not qa_selected('flowchart', 'vn_component_qa_call_map_call:call_first')
    keysym 'K_RETURN' id 'vn_component_qa_call_map_call:call_first'
    keysym 'K_RETURN' id 'vn_component_qa_call_directory_call:call_second'
    pause .2
    assert eval not qa_selected('flowchart', 'vn_component_qa_call_map_x') and qa_selected('flowchart', 'vn_component_qa_call_directory_x')
    assert eval qa_action('flowchart', 'vn_component_qa_call_map_x').locations['current'] is None
    screenshot '05-shared-body-correct-and-other-caller.png'
    run Function(qa_trace, 'second-call-current', current=vn_current_node, chain=vn_flow_call_chain(), first_trail=qa_trail('flowchart', 'vn_component_qa_call_map_x'), second_trail=qa_trail('flowchart', 'vn_component_qa_call_directory_x'))
    click id 'vn_component_qa_call_close'
    pause until '寄书等待锚点。'
    run FileLoad('qa_first_call', confirm=False, slot=True)
    pause until '寄书等待锚点。'
    assert eval vn_current_node == 'x' and vn_flow_call_chain() == ['call_first'] and qa_stack_balanced()
    run VnUiMenu('flowchart')
    pause until screen 'flowchart'
    pause .2
    assert eval qa_selected('flowchart', 'vn_component_qa_call_map_call:call_first') and not qa_selected('flowchart', 'vn_component_qa_call_map_call:call_second')
    assert eval vn_flow_replay_key not in renpy.session
    click id 'vn_component_qa_call_close'

testcase nested_second_call_cancel_confirm_and_loaded_replay:
    run Start()
    pause until '出发前的存档锚点。'
    advance until '第一次调用已经返回。'
    advance until '托付等待锚点。'
    assert eval vn_current_node == 'y' and vn_flow_call_chain() == ['call_second', 'call_nested']
    run VnUiMenu('flowchart')
    pause until screen 'flowchart'
    pause .2
    assert eval qa_selected('flowchart', 'vn_component_qa_call_map_call:call_second')
    keysym 'K_RETURN' id 'vn_component_qa_call_map_call:call_first'
    keysym 'K_RETURN' id 'vn_component_qa_call_directory_call:call_second'
    pause .2
    assert eval not qa_selected('flowchart', 'vn_component_qa_call_map_call:call_nested') and qa_selected('flowchart', 'vn_component_qa_call_directory_call:call_nested')
    keysym 'K_RETURN' id 'vn_component_qa_call_directory_call:call_nested'
    pause .2
    assert eval qa_selected('flowchart', 'vn_component_qa_call_directory_y')
    assert eval vn_flow_replay_plan(vn_flow_options_qa_call_directory, 'y', qa_trail('flowchart', 'vn_component_qa_call_directory_y'))['calls'] == ['call_second', 'call_nested']
    click id 'vn_component_qa_call_directory_y'
    pause until screen 'confirm'
    assert eval vn_flow_replay_key not in renpy.session and vn_current_node == 'y'
    assert eval '托付' in renpy.get_screen('confirm').scope['message']
    click id 'vn_confirm_no'
    pause .2
    assert eval not renpy.get_screen('confirm') and vn_flow_replay_key not in renpy.session and vn_flow_call_chain() == ['call_second', 'call_nested']
    screenshot '06-nested-replay-cancel-keeps-context.png'
    click id 'vn_component_qa_call_directory_y'
    pause until screen 'confirm'
    click id 'vn_confirm_yes'
    pause until '托付等待锚点。'
    assert eval not main_menu and vn_current_node == 'y' and vn_flow_call_chain() == ['call_second', 'call_nested']
    assert eval vn_flow_replay_key not in renpy.session and qa_stack_balanced()
    run Function(qa_trace, 'nested-replay-start', current=vn_current_node, chain=vn_flow_call_chain(), stacks=qa_stack_sizes())
    run FileSave('qa_nested_replay', confirm=False, slot=True)
    assert eval renpy.can_load('qa_nested_replay')
    advance until '寄书已经办妥。'
    assert eval vn_current_node == 'x_after' and vn_flow_call_chain() == ['call_second'] and qa_stack_balanced() and vn_flow_replay_key not in renpy.session
    # Restore the real engine checkpoint across return_y, including all call
    # frames created by the replay wrapper; no helper mutates the call stack.
    run Rollback() until '托付等待锚点。'
    assert eval vn_current_node == 'y' and vn_flow_call_chain() == ['call_second', 'call_nested'] and qa_stack_balanced() and vn_flow_replay_key not in renpy.session
    run Function(qa_trace, 'nested-replay-rollback-across-return', current=vn_current_node, chain=vn_flow_call_chain(), stacks=qa_stack_sizes(), pending=vn_flow_replay_key in renpy.session)
    screenshot '12-nested-replay-rollback-restores-inner-caller.png'
    advance until '寄书已经办妥。'
    assert eval vn_current_node == 'x_after' and vn_flow_call_chain() == ['call_second'] and qa_stack_balanced() and vn_flow_replay_key not in renpy.session
    advance until '第二次调用已经返回。'
    assert eval vn_current_node == 'c' and vn_flow_call_chain() == [] and qa_stack_balanced()
    assert eval vn_flow_replay_key not in renpy.session
    run Function(qa_trace, 'nested-replay-forward-after-rollback', current=vn_current_node, chain=vn_flow_call_chain(), stacks=qa_stack_sizes(), pending=vn_flow_replay_key in renpy.session)
    run FileLoad('qa_nested_replay', confirm=False, slot=True)
    pause until '托付等待锚点。'
    assert eval vn_flow_call_chain() == ['call_second', 'call_nested'] and qa_stack_balanced() and vn_flow_replay_key not in renpy.session
    advance until '寄书已经办妥。'
    assert eval vn_current_node == 'x_after' and vn_flow_call_chain() == ['call_second'] and qa_stack_balanced()
    advance until '第二次调用已经返回。'
    assert eval vn_current_node == 'c' and vn_flow_call_chain() == [] and qa_stack_balanced()
    run Function(qa_trace, 'nested-replay-return-and-load', current=vn_current_node, chain=vn_flow_call_chain(), stacks=qa_stack_sizes())

testcase main_menu_nested_replay_returns_to_first_continuation:
    run SetField(persistent, 'vn_seen_nodes', list(qa_call_visits))
    run VnUiMenu('flowchart')
    pause until screen 'flowchart'
    keysym 'K_RETURN' id 'vn_component_qa_call_map_call:call_first'
    keysym 'K_RETURN' id 'vn_component_qa_call_map_call:call_nested'
    pause .2
    assert eval main_menu and qa_trail('flowchart', 'vn_component_qa_call_map_y')[0]['callId'] == 'call_first'
    click id 'vn_component_qa_call_map_y'
    pause until '托付等待锚点。'
    assert eval not renpy.get_screen('confirm') and not main_menu and vn_flow_call_chain() == ['call_first', 'call_nested']
    assert eval vn_flow_replay_key not in renpy.session and qa_stack_balanced()
    advance until '寄书已经办妥。'
    assert eval vn_flow_call_chain() == ['call_first'] and qa_stack_balanced()
    advance until '第一次调用已经返回。'
    assert eval vn_current_node == 'b' and vn_flow_call_chain() == [] and qa_stack_balanced()
    run Function(qa_trace, 'first-call-replay-return', current=vn_current_node, chain=vn_flow_call_chain(), stacks=qa_stack_sizes())
    run VnUiMenu('flowchart')
    pause until screen 'flowchart'
    pause .2
    assert eval qa_selected('flowchart', 'vn_component_qa_call_map_b') and not qa_selected('flowchart', 'vn_component_qa_call_map_call:call_second')
    screenshot '07-first-call-replay-reaches-own-continuation.png'
    click id 'vn_component_qa_call_close'

testcase ordinary_replay_keeps_legacy_empty_call_stack:
    run Start()
    pause until '出发前的存档锚点。'
    advance until '托付等待锚点。'
    run SetField(persistent, 'vn_seen_nodes', list(qa_call_visits))
    run VnUiMenu('flowchart')
    pause until screen 'flowchart'
    click id 'vn_component_qa_call_directory_b'
    pause until screen 'confirm'
    assert eval vn_flow_replay_key not in renpy.session
    click id 'vn_confirm_yes'
    pause until '第一次调用已经返回。'
    assert eval vn_current_node == 'b' and vn_flow_call_chain() == [] and qa_stack_balanced()
    assert eval vn_flow_replay_key not in renpy.session
    advance until '托付等待锚点。'
    assert eval vn_current_node == 'y' and vn_flow_call_chain() == ['call_second', 'call_nested'] and qa_stack_balanced()
    run Function(qa_trace, 'ordinary-replay', current=vn_current_node, chain=vn_flow_call_chain(), stacks=qa_stack_sizes())

testcase recursion_is_finite_and_terminal_calls_have_no_return_edge:
    run Show('qa_call_special_screen')
    pause .3
    assert eval ('no_return_lead', 'call:call_no_return') in qa_edges(qa_call_special)
    assert eval not any(source == 'call:call_no_return' for source, target in qa_edges(qa_call_special))
    assert eval ('rec_lead', 'call:call_recursive') in qa_edges(qa_call_special) and ('call:call_recursive', 'rec_after') in qa_edges(qa_call_special)
    assert eval qa_has('qa_call_special_screen', 'qa_special_no_return_after')
    screenshot '08-terminal-call-does-not-invent-a-return.png'
    keysym 'K_RETURN' id 'qa_special_call:call_recursive'
    pause .2
    assert eval qa_has('qa_call_special_screen', 'qa_special_rec_body') and qa_has('qa_call_special_screen', 'qa_special_call:recursive_again')
    assert eval qa_trail('qa_call_special_screen', 'qa_special_rec_body') == [{'viewId': 'call-body:rec_body', 'callId': 'call_recursive'}]
    keysym 'K_RETURN' id 'qa_special_call:recursive_again'
    keysym 'K_RETURN' id 'qa_special_call:recursive_again'
    keysym 'K_RETURN' id 'qa_special_call:recursive_again'
    pause .2
    assert eval qa_trail('qa_call_special_screen', 'qa_special_rec_body') == [{'viewId': 'call-body:rec_body', 'callId': 'call_recursive'}]
    assert eval main_menu and vn_flow_call_chain() == [] and persistent.vn_seen_nodes == []
    screenshot '09-recursive-reference-keeps-one-body.png'
    click id 'qa_special_group_back'
    pause .2
    assert eval qa_has('qa_call_special_screen', 'qa_special_call:call_recursive') and not qa_has('qa_call_special_screen', 'qa_special_rec_body')
    keysym 'K_RETURN' id 'qa_special_call:call_no_return'
    pause .2
    assert eval qa_has('qa_call_special_screen', 'qa_special_no_return_body') and not qa_has('qa_call_special_screen', 'qa_special_no_return_after')
    assert eval qa_edges(qa_call_special, 'call-body:no_return_body') == set()
    assert eval vn_flow_replay_plan(qa_call_special, 'rec_body', [{'viewId': 'call-body:rec_body', 'callId': 'call_recursive'}, {'viewId': 'call-body:rec_body', 'callId': 'recursive_again'}]) is None
    run Function(qa_trace, 'recursion-and-terminal', root_edges=sorted(qa_edges(qa_call_special)), recursive_edges=sorted(qa_edges(qa_call_special, 'call-body:rec_body')))
    click id 'qa_special_close'

testcase display_group_inside_body_preserves_replay_caller:
    run SetField(persistent, 'vn_seen_nodes', list(qa_call_visits))
    run Start()
    pause until '出发前的存档锚点。'
    run Show('qa_call_grouped_screen')
    pause .3
    keysym 'K_RETURN' id 'qa_grouped_call:call_second'
    pause .2
    assert eval qa_has('qa_call_grouped_screen', 'qa_grouped_group-view:call-body:x:letter_group') and not qa_has('qa_call_grouped_screen', 'qa_grouped_x')
    click id 'qa_grouped_group-view:call-body:x:letter_group'
    pause .2
    assert eval qa_has('qa_call_grouped_screen', 'qa_grouped_x') and qa_has('qa_call_grouped_screen', 'qa_grouped_x_after')
    assert eval qa_trail('qa_call_grouped_screen', 'qa_grouped_x') == [{'viewId': 'call-body:x', 'callId': 'call_second'}, {'viewId': 'group-view:call-body:x:letter_group'}]
    assert eval vn_flow_replay_plan(vn_flow_options_qa_call_grouped, 'x', qa_trail('qa_call_grouped_screen', 'qa_grouped_x'))['calls'] == ['call_second']
    screenshot '10-display-group-within-shared-body.png'
    click id 'qa_grouped_group_back'
    pause .2
    assert eval qa_has('qa_call_grouped_screen', 'qa_grouped_group-view:call-body:x:letter_group') and qa_has('qa_call_grouped_screen', 'qa_grouped_call:call_nested')
    click id 'qa_grouped_group-view:call-body:x:letter_group'
    click id 'qa_grouped_x'
    pause until screen 'confirm'
    assert eval vn_current_node == 'a' and vn_flow_replay_key not in renpy.session
    click id 'vn_confirm_yes'
    pause until '寄书等待锚点。'
    assert eval vn_current_node == 'x' and vn_flow_call_chain() == ['call_second'] and qa_stack_balanced()
    advance until '托付等待锚点。'
    assert eval vn_flow_call_chain() == ['call_second', 'call_nested'] and qa_stack_balanced()
    advance until '第二次调用已经返回。'
    assert eval vn_current_node == 'c' and vn_flow_call_chain() == [] and qa_stack_balanced() and vn_flow_replay_key not in renpy.session
    run Function(qa_trace, 'grouped-replay', current=vn_current_node, chain=vn_flow_call_chain(), stacks=qa_stack_sizes())

testcase built_in_directory_uses_registered_call_navigation_and_replay:
    run Start()
    pause until '出发前的存档锚点。'
    run Show('qa_call_native_screen')
    pause .3
    assert eval qa_native_options()['flowComponentId'] == ':native-flow'
    assert eval [entry[0] for entry in qa_native_options()['flowEntries']] == ['a', 'call:call_first', 'b', 'call:call_second', 'c']
    assert eval qa_has('qa_call_native_screen', 'vn_flow_native_call:call_first') and qa_has('qa_call_native_screen', 'vn_flow_native_call:call_second') and not qa_has('qa_call_native_screen', 'vn_flow_native_x')
    keysym 'K_RETURN' id 'vn_flow_native_call:call_second'
    pause .2
    assert eval qa_trail('qa_call_native_screen', 'vn_flow_native_x') == [{'viewId': 'call-body:x', 'callId': 'call_second'}]
    keysym 'K_RETURN' id 'vn_flow_native_call:call_nested'
    pause .2
    assert eval qa_trail('qa_call_native_screen', 'vn_flow_native_y') == [{'viewId': 'call-body:x', 'callId': 'call_second'}, {'viewId': 'call-body:y', 'callId': 'call_nested'}]
    assert eval vn_flow_replay_plan(qa_native_options(), 'y', qa_trail('qa_call_native_screen', 'vn_flow_native_y'))['calls'] == ['call_second', 'call_nested']
    screenshot '11-built-in-directory-shared-body.png'
    click id 'vn_flow_native_y'
    pause until screen 'confirm'
    assert eval vn_flow_replay_key not in renpy.session and vn_current_node == 'a'
    click id 'vn_confirm_yes'
    pause until '托付等待锚点。'
    assert eval vn_current_node == 'y' and vn_flow_call_chain() == ['call_second', 'call_nested'] and qa_stack_balanced()
    assert eval vn_flow_replay_key not in renpy.session
    advance until '寄书已经办妥。'
    assert eval vn_flow_call_chain() == ['call_second'] and qa_stack_balanced()
    advance until '第二次调用已经返回。'
    assert eval vn_current_node == 'c' and vn_flow_call_chain() == [] and qa_stack_balanced()
    run Function(qa_trace, 'native-directory-replay', current=vn_current_node, chain=vn_flow_call_chain(), stacks=qa_stack_sizes())
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
  await fs.writeFile(path.join(output, 'fixture.vns.json'), fixtureBytes);
  await fs.writeFile(path.join(source, 'project.vns.json'), fixtureBytes);
  await fs.writeFile(path.join(output, 'compiled-map-data.json'), JSON.stringify({ ...mainOptions, qa_special: specialOptions }, null, 2));
  await fs.writeFile(path.join(output, 'testcases.rpy'), tests);
  phase = 'build';
  const built = await buildProject({ project, projectDir: source, outputDir: game, sdkRoot: sdk });
  await fs.writeFile(path.join(output, 'build.json'), JSON.stringify(built, null, 2));
  report.fixtureDiagnostics = built.diagnostics;
  assert.equal(built.ok, true, JSON.stringify(built));
  await fs.writeFile(path.join(game, 'game/testcases.rpy'), tests);
  phase = 'native interactions';
  const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 420000,
    env: { RENPY_RENDERER: 'gl2', PYTHONUNBUFFERED: '1' }, onData: text => process.stdout.write(text) });
  await fs.writeFile(path.join(output, 'run.log'), result.log);
  recordFlowNativeResult(report, tests, result, 9);
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
