import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createProject, projectSchema, type StoryNode, type UiComponent } from '../src/core/model';
import { createScreens, playerFlowRuntimeData } from '../src/runtime/screens';
import { createStoryMenuRuntime } from '../src/runtime/story-menu-runtime';
import { createPlayerFlowCallRuntime } from '../src/runtime/player-flow-call-runtime';
import { compileProject } from '../src/runtime/compiler';
import { createSpatialUiWidgets } from '../src/runtime/spatial-ui-widgets';
import { createUiWidgets } from '../src/runtime/ui-widgets';

function fixture() {
  const project = createProject('共用子剧情'), sceneId = project.scenes[0].id;
  const base = (id: string) => ({ id, name: id, sceneId, x: 0, y: 0 });
  const passage = (id: string, name: string, next?: string): StoryNode => ({ ...base(id), kind: 'passage', name, next, lines: [{ id: id + '_line', text: name, actions: [] }], flowchart: { visible: true } });
  project.chapters[0].flowchart = { visible: false };
  project.nodes = [
    passage('a', '问候', 'call_first'), { ...base('call_first'), kind: 'call', target: 'x', next: 'b' },
    passage('b', '回信', 'call_second'), { ...base('call_second'), kind: 'call', target: 'x', next: 'c' }, passage('c', '启程', 'finish'),
    passage('x', '寄书 [原文]｜重逢', 'call_nested'), { ...base('call_nested'), kind: 'call', target: 'y', next: 'return_x' },
    { ...base('return_x'), kind: 'return' }, passage('y', '商议', 'return_y'), { ...base('return_y'), kind: 'return' }, { ...base('finish'), kind: 'end' },
  ];
  project.entryId = 'a';
  const component: UiComponent = { id: 'map', kind: 'flowchart', page: 'flowchart', text: '', x: 0, y: 0, width: 1, height: 1, list: { layout: 'flow', lockUnread: true, showProgress: true } };
  project.ui.components = [component];
  return { project, component };
}

test('shared call runtime data has two independent references and one compiled body', () => {
  const { project, component } = fixture();
  const before = JSON.stringify({ project, component }), data = playerFlowRuntimeData(project, component);
  const references = data.flowGraph!.nodes.filter(node => node.callId);
  assert.deepEqual(new Set(references.map(node => node.id)), new Set(['call:call_first', 'call:call_second']));
  for (const reference of references) {
    assert.equal(reference.viewId, 'call-body:x');
    assert.equal(reference.nodeId, 'x');
    assert.equal(reference.memberIds, undefined, 'a shared body never replaces the real call-site unlock identity');
    assert.equal(reference.name, '寄书 [原文] 重逢');
  }
  assert.equal(Object.keys(data.flowViews!).filter(id => id === 'call-body:x').length, 1);
  assert.deepEqual(data.flowViews!['call-body:x'].entries.map(entry => entry[0]), ['x', 'call:call_nested']);
  assert.deepEqual(data.flowViews!['call-body:y'].entries.map(entry => entry[0]), ['y']);
  assert.ok(data.flowViews!['call-body:x'].nodeIds!.includes('return_x'));
  assert.equal(data.flowViews!['call-body:x'].nodeIds!.includes('call_first'), false);
  assert.equal(data.flowGraph!.callLocations!.call_first, 'call:call_first');
  assert.equal(data.flowGraph!.callLocations!.call_second, 'call:call_second');
  assert.equal(data.flowLooks['call:call_first'].node.callId, 'call_first');
  assert.equal(data.flowLooks['call:call_second'].node.callId, 'call_second');
  assert.equal(data.flowLooks.y.node.name, '商议');
  assert.deepEqual(data.flowLooks.x.node.parts, ['寄书 [原文]', '重逢']);
  assert.equal(JSON.stringify({ project, component }), before, 'derived runtime data does not rewrite the project');
});

test('directories use the same call scopes, independent references and current-location contract', () => {
  const { project, component } = fixture();
  const branch = playerFlowRuntimeData(project, component);
  component.list!.layout = 'grid';
  const directory = playerFlowRuntimeData(project, component);
  assert.deepEqual(directory.flowEntries, branch.flowEntries);
  assert.deepEqual(directory.flowViews, branch.flowViews);
  assert.deepEqual(directory.flowGraph, branch.flowGraph);
  assert.equal(directory.flowComponentId, 'map');
  const reopened = projectSchema.parse(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(playerFlowRuntimeData(reopened, reopened.ui.components[0]), directory);
  const widgets = createUiWidgets(project.ui);
  const button = widgets.split('screen vn_styled_button(')[1].split('screen vn_skin_slots(')[0];
  assert.match(button, /caption_align=0\.5, browse_hint=False\):/, 'ordinary buttons keep the existing presentation by default');
  assert.match(button, /browse_hint and not skin\.get\("hideText", False\) and renpy\.display\.behavior\.is_sensitive\(action\)/, 'hidden and locked cards must not offer entry');
  assert.match(button, /tooltip \("双击查看子剧情，或按 Enter 进入" if browse_hint else None\)/);
  assert.match(button, /clipping True\n\s+add VnBrowseHint\([^\n]+\) id \(identity \+ "_browse_hint"\)/, 'a tiny card clips the visible vector object to the reserved padding');
  assert.match(button, /VnBrowseHint\(max\(1, min\(22, font_size, button_padding\[0\], height - button_padding\[1\] \* 2\)\)/, 'the vector fits the existing padding without shrinking the caption');
  const hint = widgets.split('    class VnBrowseHint(renpy.Displayable):')[1].split('    class VnHistoryThumb(')[0];
  assert.match(hint, /renpy\.Render\(self\.size, self\.size\)/);
  assert.match(hint, /drawing\.canvas\(\)\.lines\(self\.style\.color, False, self\.points, self\.line_width\)/, 'entry arrows are native strokes and follow the button state color');
  assert.doesNotMatch(hint, /Text\(|\bfont\s*=|›/, 'missing project-font glyphs cannot replace the entry arrow with a box');
  assert.match(widgets, /browse_hint=bool\(node\.get\("callId"\)\)/, 'only branch-map call cards offer browsing');
  assert.match(widgets, /browse_hint=kind == "flowchart" and bool\(entry_node\.get\("callId"\)\)/, 'directories and built-in flowcharts use the same call-only hint');
});

test('manual groups inside a shared body compile one view and retain only their allowed nodes', () => {
  const { project, component } = fixture();
  component.list!.flowContent = { mode: 'custom', custom: {
    entries: ['a', 'b', 'c', 'x', 'y'].map(nodeId => ({ nodeId })),
    groups: [{ id: 'letters', name: '书信', nodeIds: ['x'] }],
  } };
  const data = playerFlowRuntimeData(project, component);
  const grouped = data.flowViews!['group-view:call-body:x:letters'];
  assert.ok(grouped);
  assert.equal(grouped.parentViewId, 'call-body:x');
  assert.deepEqual(grouped.entries.map(entry => entry[0]), ['x']);
  assert.equal(grouped.nodeIds!.includes('a'), false);
  assert.equal(data.flowLooks['group-view:call-body:x:letters'].node.viewId, 'group-view:call-body:x:letters');
  assert.equal(data.flowGroups, undefined, 'call navigation does not serialize a second copy of manual group bodies');
});

test('ordinary maps do not gain derived call fields or fake replay labels', () => {
  const project = createProject(), component: UiComponent = { id: 'plain', kind: 'flowchart', page: 'flowchart', text: '', x: 0, y: 0, width: 1, height: 1 };
  const data = playerFlowRuntimeData(project, component);
  assert.equal(Object.hasOwn(data, 'flowViews'), false);
  assert.equal(Object.hasOwn(data, 'flowComponentId'), false);
  assert.equal(Object.hasOwn(data, 'flowGraph'), false);
  assert.ok(data.flowEntries.every(entry => String(entry[2]).startsWith('vn_node_')));
  assert.equal(createScreens(project).includes('vn_flow_options_:native-flow'), false);
});

test('the built-in directory shares call navigation without requiring an authored control', () => {
  const { project } = fixture();
  project.ui.components = [];
  const screens = createScreens(project);
  assert.match(screens, /globals\(\)\["vn_flow_options_:native-flow"\] =/);
  assert.match(screens, /"flowComponentId": ":native-flow"/);
  assert.match(screens, /"callId": "call_second"/);
  const flowScreen = screens.split('screen flowchart():')[1].split('screen staff_roll():')[0];
  assert.match(flowScreen, /use vn_collection\("flowchart"/);
  assert.match(flowScreen, /globals\(\)\["vn_flow_options_:native-flow"\]/);
  assert.doesNotMatch(flowScreen, /VnStoryStart\(/);
});

test('call replay uses existing RenPy return labels and a consumed launch request', () => {
  const { project } = fixture(), compiled = compileProject(project);
  assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), []);
  const story = compiled.files['game/story.rpy'];
  assert.match(story, /call vn_node_x from vn_return_call_first\n\s+jump vn_node_b/);
  assert.match(story, /call vn_node_x from vn_return_call_second\n\s+jump vn_node_c/);
  assert.match(story, /call vn_node_y from vn_return_call_nested/);
  const runtime = createStoryMenuRuntime(project), helper = createPlayerFlowCallRuntime(project);
  assert.ok(runtime.includes(helper));
  assert.match(helper, /for context in renpy\.game\.contexts:/);
  assert.match(helper, /context\.get_return_stack\(\)/);
  assert.match(helper, /request = renpy\.session\.pop\(vn_flow_replay_key, None\)/);
  assert.match(helper, /context\.call\(vn_story_nodes\[vn_story_call_targets\[call_id\]\]\["label"\], return_site="vn_return_" \+ call_id\)/);
  assert.match(helper, /config\.after_load_callbacks\.append\(vn_flow_replay_after_load\)/);
  assert.match(helper, /len\(trail\) > len\(views\)/);
  assert.match(helper, /call_id not in body\.get\("nodeIds"/);
  assert.match(runtime, /action = Confirm\(prompt, action\)/);
  assert.match(runtime, /VnStoryStart\("flowchart", node_id, vn_story_nodes\[node_id\]\["label"\]/, 'ordinary replay remains on its existing action');
});

function pythonFunction(source: string, name: string): string {
  const lines = source.split('\n'), start = lines.findIndex(line => line.startsWith('    def ' + name + '('));
  assert.ok(start >= 0, `缺少实际运行时函数：${name}`);
  let end = start + 1;
  while (end < lines.length && (!lines[end].trim() || lines[end].startsWith('        '))) end++;
  return lines.slice(start, end).map(line => line.slice(4)).join('\n');
}

test('actual emitted helpers isolate call sites, validate replay paths and consume requests once', () => {
  const { project, component } = fixture(), helper = createPlayerFlowCallRuntime(project), spatial = createSpatialUiWidgets();
  const functions = [
    ...['vn_flow_call_chain', 'vn_flow_root_view', 'vn_flow_view', 'vn_flow_valid_trail', 'vn_flow_enter_trail', 'vn_flow_location', 'vn_flow_context', 'vn_flow_open_gesture', 'vn_flow_replay_plan', 'vn_flow_replay_take', 'vn_flow_replay_cleanup', 'vn_flow_replay_after_load'].map(name => pythonFunction(helper, name)),
    ...['vn_flow_entry', 'vn_flow_members', 'vn_flow_locked', 'vn_flow_current', 'vn_flow_caption', 'vn_flow_progress', 'vn_flow_node_shown', 'vn_flow_edge_alpha'].map(name => pythonFunction(spatial, name)),
  ].join('\n');
  const script = `
import builtins as vn_flow_builtins, json, copy
from types import SimpleNamespace as NS

data = json.loads(${JSON.stringify(JSON.stringify(playerFlowRuntimeData(project, component)))})
data.update(lockUnread=True, showProgress=True, flowLockedNode='hide')
vn_flow_options_map = data
vn_story_nodes = dict((identity, dict(label='vn_node_' + identity)) for identity in ${JSON.stringify(project.nodes.map(node => node.id))})
vn_story_call_targets = dict(call_first='x', call_second='x', call_nested='y')
vn_story_call_returns = dict(('vn_return_' + key, key) for key in vn_story_call_targets)
vn_flow_replay_key = 'vn_flow_replay:test'
main_menu = False
vn_current_node = 'y'
persistent = NS(vn_seen_nodes=['a', 'call_first', 'x', 'call_nested', 'y'])
parent = NS(get_return_stack=lambda: ['unrelated', 'vn_return_call_first', 'vn_return_call_nested', ('opaque', 1)])
menu = NS(get_return_stack=lambda: ['_game_menu', 'vn_ui_return'])
now = 10.0
renpy = NS(game=NS(contexts=[parent, menu], interface=NS(last_event=None)), session={}, has_label=lambda label: label in vn_story_call_returns,
    display=NS(core=NS(get_time=lambda: now), behavior=NS(pygame=NS(MOUSEBUTTONUP=1))))
_restart = None
def vn_story_unlocked(kind, identity, locked=True):
    return not locked or identity == 'a' or identity in persistent.vn_seen_nodes

${functions}

assert vn_flow_call_chain() == ['call_first', 'call_nested']
assert not vn_flow_locked('call:call_first', data)
assert vn_flow_locked('call:call_second', data), 'shared X progress must not unlock another call'
root = data['flowGraph']
assert vn_flow_location(data, root) == 'call:call_first'
first = vn_flow_enter_trail(data, [], 'call:call_first')
second = vn_flow_enter_trail(data, [], 'call:call_second')
assert first == [dict(viewId='call-body:x', callId='call_first')]
assert second == [dict(viewId='call-body:x', callId='call_second')]
xgraph = data['flowViews']['call-body:x']['graph']
ygraph = data['flowViews']['call-body:y']['graph']
assert vn_flow_location(data, xgraph, first) == 'call:call_nested'
assert vn_flow_location(data, xgraph, second) is None, 'browsing the other invocation must not select the current node'
nested = vn_flow_enter_trail(data, first, 'call:call_nested')
assert vn_flow_location(data, ygraph, nested) == 'y'
assert vn_flow_current('y', data, vn_flow_context(data, ygraph, nested))
assert vn_flow_progress(root['nodes'], root['progressIds'])[1] == 5, 'A/B/C/X/Y count shared bodies once'
plan = vn_flow_replay_plan(data, 'y', nested)
assert plan == dict(nodeId='y', calls=['call_first', 'call_nested'], returns=['vn_return_call_first', 'vn_return_call_nested'])
assert vn_flow_replay_plan(data, 'b', nested) is None
assert vn_flow_replay_plan(data, 'x', second) is None, 'replay requires the selected call site to be reached'
for invalid in [None, 3, 'wrong', [dict(viewId='missing')], [dict(viewId='call-body:x', callId='call_nested')], nested + nested, [dict(viewId='call-body:x', callId=[])]]:
    assert vn_flow_replay_plan(data, 'y', invalid) is None
assert vn_flow_replay_plan(data, [], nested) is None
assert vn_flow_replay_plan(data, 'y', nested[:-1]) is None

payload = dict(componentId='map', identity='y', trail=nested)
renpy.session[vn_flow_replay_key] = copy.deepcopy(payload)
assert vn_flow_replay_take() == plan
assert vn_flow_replay_key not in renpy.session
assert vn_flow_replay_take() is None
for change in [dict(componentId='other'), dict(identity='b'), dict(trail=[dict(viewId='call-body:y', callId='call_nested')])]:
    renpy.session[vn_flow_replay_key] = dict(payload, **change)
    assert vn_flow_replay_take() is None
    assert vn_flow_replay_key not in renpy.session
renpy.session[vn_flow_replay_key] = payload
vn_flow_replay_cleanup()
assert vn_flow_replay_key not in renpy.session
renpy.session[vn_flow_replay_key] = payload
_restart = (None, 'vn_flow_replay', '_main_menu')
vn_flow_replay_cleanup()
assert vn_flow_replay_key in renpy.session
vn_flow_replay_after_load()
assert vn_flow_replay_key not in renpy.session

# Double-click state is local to one map. Keyboard activation never needs a
# second press, and returning or entering another view clears it.
gesture = {}
renpy.game.interface.last_event = NS(type=1, pos=(10, 20), touch=False)
assert not vn_flow_open_gesture(gesture, 'first')
now += .2
assert vn_flow_open_gesture(gesture, 'first')
assert not gesture
assert not vn_flow_open_gesture(gesture, 'first')
now += .6
assert not vn_flow_open_gesture(gesture, 'first')
now += .1
assert not vn_flow_open_gesture(gesture, 'second')
renpy.game.interface.last_event = NS(type=2)
assert vn_flow_open_gesture(gesture, 'second')

# Old data without call views retains its direct location map, including IDs
# that happen to be named 'current' or 'graph'.
legacy = dict(flowLooks={})
vn_current_node = 'hidden'
assert vn_flow_current('y', legacy, dict(current='x', graph='x', hidden='y'))
main_menu = True
assert vn_flow_call_chain() == []
assert vn_flow_location(data, root) is None
print(json.dumps(dict(groups=8)))
`;
  const python = process.env.VNS_TEST_PYTHON ?? (process.platform === 'win32' ? path.resolve('resources/runtime/lib/py3-windows-x86_64/python.exe') : 'python3');
  const result = spawnSync(python, ['-I', '-B', '-'], { input: script, encoding: 'utf8', windowsHide: true, timeout: 15_000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).groups, 8);
});
