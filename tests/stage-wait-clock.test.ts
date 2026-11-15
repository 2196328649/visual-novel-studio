import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createProject } from '../src/core/model';
import { createBlueprintRuntime } from '../src/runtime/blueprint-runtime';
import { blueprintTaskRuntime } from '../src/runtime/blueprint-task-runtime';
import { createFlowTransitionRuntime } from '../src/runtime/flow-transition-runtime';
import { visualTransitionsRuntime } from '../src/runtime/visual-transitions';

function pythonFunction(source: string, name: string) {
  const lines = source.split('\n'), start = lines.findIndex(line => line.startsWith('    def ' + name + '('));
  assert.ok(start >= 0, '缺少实际运行时函数：' + name);
  let end = start + 1;
  while (end < lines.length && (!lines[end].trim() || lines[end].startsWith('        '))) end++;
  return lines.slice(start, end).map(line => line.slice(4)).join('\n');
}

test('等待中保存的舞台进度跨重复读档、重存、交互重启、菜单、回滚与滞后渲染保持连续', () => {
  const transition = createFlowTransitionRuntime();
  const functions = [
    pythonFunction(createBlueprintRuntime(createProject('舞台计时')), 'vn_bp_clock'),
    ...['vn_stage_sample_frame_clock', 'vn_stage_render_delta', 'vn_stage_retain_wait_clock', 'vn_stage_restore_wait_clock', 'vn_stage_clock'].map(name => pythonFunction(transition, name)),
    ...['vn_bp_wait_owned', 'vn_bp_sample_wait_context', 'vn_bp_poll_task'].map(name => pythonFunction(blueprintTaskRuntime, name)),
  ].join('\n');
  // Execute the emitted Python itself. The host models Ren'Py's documented
  // boundary: saves retain data but restore the statement's Context.runtime;
  // ordinary rollback restores both. No SDK, display, game or temp files run.
  const script = `
import copy, json
from types import SimpleNamespace as NS

current = NS(runtime=1.2, info=NS())
depth = 0
now = 100.0
retains = 0
ended = []
interface = NS(frame_time=now)
def retain():
    global retains
    retains += 1
def noop():
    pass
renpy = NS(context=lambda: current.info, context_nesting_level=lambda: depth,
    game=NS(context=lambda: current), display=NS(interface=interface, core=NS(get_time=lambda: now)),
    retain_after_load=retain, end_interaction=lambda value: ended.append(value))
vn_bp_task = None
vn_bp_task_alive = lambda task: True
vn_bp_prune_task_resources = vn_ui_native_dispatch_navigation = vn_ui_image_poll = noop
vn_ui_video_poll = vn_ui_spine_poll = vn_bp_async_tick = vn_bp_interrupt_wait = noop
vn_game_flow_transition_active = vn_flow_transition_active = None
${functions}

def close(actual, expected):
    assert abs(actual - expected) < 1e-8, (actual, expected)
def frame(value):
    global now
    now = value
    interface.frame_time = value
def clock():
    return vn_bp_clock() + vn_stage_render_delta()
def save_state():
    # A single copy preserves shared owner/wait identities like pickle.
    return copy.deepcopy((current, vn_bp_wait))
def load_state(saved):
    global current, vn_bp_wait
    current, vn_bp_wait = copy.deepcopy(saved)
    vn_stage_restore_wait_clock()
def wait_record(duration, elapsed=0.0):
    return dict(owner=current.info, depth=depth, duration=duration, elapsed=elapsed)

vn_bp_wait = wait_record(6.0)
vn_bp_poll_task.sample = (vn_bp_wait, now, current)
vn_stage_sample_frame_clock()
initial = save_state()
frame(100.75)
vn_bp_poll_task()
close(clock(), 1.95)
close(vn_bp_wait['elapsed'], .75)
assert current.info.vn_stage_wait_clock['wait'] is vn_bp_wait and retains == 1
saved = save_state()

# Completed interaction time is added by Ren'Py once; the saved sample must
# not add it a second time during an ordinary screen/interaction restart.
current.runtime += .75
vn_stage_sample_frame_clock()
close(clock(), 1.95)
frame(101.0)
vn_bp_poll_task()
close(clock(), 2.2)

# Long offline time is ignored. Loading the same save always restores .75s,
# rather than accumulating compensation from the previously resumed session.
for stamp in (900.0, 1500.0):
    frame(stamp)
    load_state(saved)
    close(vn_bp_clock(), 1.95)
    close(vn_stage_render_delta(), 0)
    close(current.info.vn_stage_clock_offset, .75)
    close(vn_bp_wait['elapsed'], .75)
    vn_stage_sample_frame_clock()
    vn_bp_poll_task()
    frame(stamp + .25)
    vn_bp_poll_task()
    close(clock(), 2.2)
    close(vn_bp_wait['elapsed'], 1.0)

# Resaving during the resumed interaction keeps its additional .25s once.
resaved = save_state()
frame(2000.0)
load_state(resaved)
close(vn_bp_clock(), 2.2)
close(current.info.vn_stage_clock_offset, 1.0)
vn_stage_sample_frame_clock()
vn_bp_poll_task()
frame(2005.0)
vn_bp_poll_task()
assert ended == [False]
close(vn_bp_wait['elapsed'], 6.0)
current.runtime += 5.0
vn_bp_wait = None
vn_stage_sample_frame_clock()
close(vn_bp_clock(), 7.2)
close(7.2 - vn_stage_clock(), 0)
# There must be no extra tail wait for the already consumed first second.
finished = save_state()
frame(2100.0)
load_state(finished)
close(vn_bp_clock(), 7.2)

# A menu inherits the established offset by value; its copied info still has
# the parent's sample, which must never be applied to the child or rewritten.
load_state(resaved)
parent, parent_wait = current, vn_bp_wait
parent_sample = current.info.vn_stage_wait_clock
current = NS(runtime=.2, info=copy.copy(parent.info))
depth = 1
vn_stage_restore_wait_clock()
close(current.info.vn_stage_clock_offset, 1.0)
vn_bp_wait = wait_record(3.0)
vn_stage_sample_frame_clock()
vn_bp_poll_task()
frame(2100.3)
vn_bp_poll_task()
assert parent.info.vn_stage_wait_clock is parent_sample
assert current.info.vn_stage_wait_clock['owner'] is current.info
current, vn_bp_wait, depth = parent, parent_wait, 0
close(vn_bp_clock(), 2.2)

# Ordinary rollback restores info and engine runtime together; it does not
# call the load correction or carry frame samples from the abandoned context.
current, vn_bp_wait = copy.deepcopy(initial)
close(vn_bp_clock(), 1.2)
close(vn_stage_render_delta(), 0)
assert not hasattr(current.info, 'vn_stage_clock_offset')

# Old saves and a changed wait keep the existing clock semantics.
current = NS(runtime=4.0, info=NS(vn_stage_clock_offset=.2))
vn_bp_wait = dict(duration=2.0, elapsed=0.0)
vn_stage_restore_wait_clock()
close(vn_bp_clock(), 4.2)
vn_stage_sample_frame_clock()
vn_stage_retain_wait_clock(now)
current.info.vn_stage_wait_clock['clock'] = 99.0
vn_bp_wait = dict(duration=2.0, elapsed=0.0)
vn_stage_restore_wait_clock()
close(vn_bp_clock(), 4.2)

# Debugger pause freezes get_time and pumps no task timers. Even repeated
# calls with a frozen sample cannot advance either the wait or stage clock.
frame(3000.0)
vn_stage_sample_frame_clock()
vn_bp_poll_task()
frozen = (clock(), vn_bp_wait['elapsed'])
for _ in range(20):
    vn_bp_poll_task()
    assert (clock(), vn_bp_wait['elapsed']) == frozen
frame(3000.3)
vn_bp_poll_task()
close(clock() - frozen[0], .3)

# Absolute stage deadlines continue excluding an owned transition. The
# compensation changes the raw clock; it does not clear the transition hold.
current.info.vn_stage_transition_offset = .4
vn_game_flow_transition_active = dict(owner=current.info, depth=depth, clock=2.5)
close(vn_stage_clock(), 2.5)
vn_game_flow_transition_active = None
close(vn_stage_clock(), vn_bp_clock() - .4)

# A real input/timer event can precede the next draw. With a frame 200ms
# behind, retain the event's stage position alongside that same wait update;
# normal visual rendering must still use the unchanged frame timestamp.
current = NS(runtime=1.2, info=NS())
frame(4000.0)
vn_bp_wait = wait_record(6.0)
vn_bp_poll_task.sample = (vn_bp_wait, now, current)
vn_stage_sample_frame_clock()
frame(4000.55)
now = 4000.75
vn_bp_poll_task()
close(vn_bp_wait['elapsed'], .75)
close(vn_stage_render_delta(), .55)
close(vn_stage_render_delta(now), .75)
close(clock(), 1.75)
close(current.info.vn_stage_wait_clock['clock'], 1.95)
late_frame_saved = save_state()
vn_bp_poll_task()
close(vn_bp_wait['elapsed'], .75)
close(current.info.vn_stage_wait_clock['clock'], 1.95)

# Repeated events without another frame still save the consumed wait time.
# Both the lagged-frame save and the later save restore once on every load,
# and a new event after loading can progress without a redraw as well.
for stamp, elapsed in ((4000.9, .9), (4001.0, 1.0)):
    now = stamp
    vn_bp_poll_task()
    close(vn_bp_wait['elapsed'], elapsed)
    close(current.info.vn_stage_wait_clock['clock'], 1.2 + elapsed)
    close(vn_stage_render_delta(), .55)
    close(interface.frame_time, 4000.55)
no_frame_saved = save_state()
for snapshot, elapsed in ((late_frame_saved, .75), (no_frame_saved, 1.0)):
    for stamp in (5000.0, 5500.0):
        frame(stamp)
        load_state(snapshot)
        close(vn_bp_clock(), 1.2 + elapsed)
        close(vn_bp_wait['elapsed'], elapsed)
        close(vn_stage_render_delta(now), 0)
        vn_stage_sample_frame_clock()
        vn_bp_poll_task()
        now = stamp + .2
        vn_bp_poll_task()
        close(vn_bp_wait['elapsed'], elapsed + .2)
        close(current.info.vn_stage_wait_clock['clock'], 1.4 + elapsed)
        close(vn_stage_render_delta(), 0)

# An explicit event timestamp must not bypass the frame sample's context
# and committed-clock checks after a context change, commit or offset change.
current = NS(runtime=4.0, info=NS())
frame(6000.0)
vn_stage_sample_frame_clock()
current = NS(runtime=4.0, info=NS())
now = 6000.2
close(vn_stage_render_delta(now), 0)
vn_bp_wait = wait_record(2.0)
vn_stage_retain_wait_clock(now)
close(current.info.vn_stage_wait_clock['clock'], 4.0)
vn_stage_sample_frame_clock()
current.runtime += .3
close(vn_stage_render_delta(now), 0)
vn_stage_retain_wait_clock(now)
close(current.info.vn_stage_wait_clock['clock'], 4.3)
vn_stage_sample_frame_clock()
current.info.vn_stage_clock_offset = .4
close(vn_stage_render_delta(now), 0)
vn_stage_retain_wait_clock(now)
close(current.info.vn_stage_wait_clock['clock'], 4.7)
vn_stage_sample_frame_clock()
close(vn_stage_render_delta(5999.0), 0)
print(json.dumps({'groups': 11, 'retains': retains, 'tail': 7.2}))
`;
  const python = process.env.VNS_TEST_PYTHON ?? (process.platform === 'win32'
    ? path.resolve('resources/runtime/lib/py3-windows-x86_64/python.exe') : 'python3');
  const result = spawnSync(python, ['-I', '-B', '-c', script], { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).groups, 11);
});

test('只在实际等待已更新后保留舞台采样，读档先恢复时钟再恢复过渡', () => {
  const poll = pythonFunction(blueprintTaskRuntime, 'vn_bp_poll_task');
  const guard = poll.indexOf('if vn_bp_wait is None:'), update = poll.indexOf('vn_bp_wait = dict(');
  const waitSample = poll.indexOf('vn_bp_poll_task.sample = (vn_bp_wait, now, context)');
  const sample = poll.indexOf('vn_stage_retain_wait_clock(now)'), retained = poll.indexOf('renpy.retain_after_load()');
  assert.ok(guard < update && update < waitSample && waitSample < sample && sample < retained);
  const transition = createFlowTransitionRuntime();
  assert.match(transition, /init 1001 python:\n\s+# [^\n]+\n\s+config\.after_load_callbacks\.insert\(0, vn_stage_restore_wait_clock\)/);
  assert.equal(transition.includes('periodic_callbacks'), false, '不得引入额外的全局计时器');
});

test('真实菜单继承父等待时不会关闭菜单、改父记录或消耗父剩余时间', () => {
  const transition = createFlowTransitionRuntime();
  const functions = [
    pythonFunction(createBlueprintRuntime(createProject('菜单等待隔离')), 'vn_bp_clock'),
    ...['vn_stage_sample_frame_clock', 'vn_stage_render_delta', 'vn_stage_retain_wait_clock', 'vn_stage_restore_wait_clock', 'vn_stage_clock'].map(name => pythonFunction(transition, name)),
    ...['vn_bp_wait_owned', 'vn_bp_sample_wait_context', 'vn_bp_poll_task', 'vn_bp_pause'].map(name => pythonFunction(blueprintTaskRuntime, name)),
  ].join('\n');
  const script = `
import copy, json
from types import SimpleNamespace as NS

current = NS(runtime=1.2, info=NS())
depth, now, retained, pruned, interrupted, alive = 0, 100.0, 0, 0, 0, True
ended, scoped, pause_calls = [], [], []
interface = NS(frame_time=now)
def noop(*args):
    pass
def retain():
    global retained
    retained += 1
def prune():
    global pruned
    pruned += 1
def interrupt():
    global interrupted
    interrupted += 1
def dynamic(name):
    assert name == 'vn_bp_wait'
    scoped.append((current, vn_bp_wait))
renpy = NS(context=lambda: current.info, context_nesting_level=lambda: depth,
    game=NS(context=lambda: current), display=NS(interface=interface, core=NS(get_time=lambda: now)),
    retain_after_load=retain, end_interaction=lambda value: ended.append((depth, value)),
    context_dynamic=dynamic, is_skipping=lambda: False)
vn_bp_task = None
vn_bp_task_alive = lambda task: alive
vn_bp_protect_flow_skip = lambda task: True
vn_bp_number = lambda value, *args: float(value)
vn_bp_prune_task_resources = prune
vn_ui_native_dispatch_navigation = vn_ui_image_poll = vn_ui_video_poll = vn_ui_spine_poll = vn_bp_async_tick = noop
vn_bp_interrupt_wait = interrupt
vn_game_flow_transition_active = vn_flow_transition_active = None
vn_flow_transition_flush = vn_game_flow_source_extend = noop
${functions}

def close(actual, expected):
    assert abs(actual - expected) < 1e-8, (actual, expected)
def frame(value):
    global now
    now = value
    interface.frame_time = value
def enter_interaction():
    vn_bp_sample_wait_context()
    vn_stage_sample_frame_clock()
def record(seconds, elapsed=0.0):
    return dict(owner=current.info, depth=depth, duration=seconds, elapsed=elapsed)
def save_parent(parent, wait):
    # Native save discards child dynamic values and serializes the base
    # Context together with the matching store root, preserving identity.
    return copy.deepcopy((parent, wait))
def load_parent(saved, stamp):
    global current, vn_bp_wait, depth
    frame(stamp)
    current, vn_bp_wait = copy.deepcopy(saved)
    depth = 0
    vn_stage_restore_wait_clock()
    enter_interaction()

# Main wait advances .75 seconds before a regular native menu opens. The
# menu shallow-copies context.info and inherits the very same global wait.
vn_bp_wait = record(6.0)
enter_interaction()
frame(100.75)
vn_bp_poll_task()
parent, parent_wait = current, vn_bp_wait
parent_saved = parent.info.vn_stage_wait_clock
close(parent_wait['elapsed'], .75)
close(parent_saved['clock'], 1.95)
current, depth = NS(runtime=parent.runtime, info=copy.copy(parent.info)), 1
enter_interaction()
assert not vn_bp_wait_owned(vn_bp_wait)
retains_before, prunes_before = retained, pruned
for stamp in (101.0, 104.0, 108.0):
    frame(stamp)
    vn_bp_poll_task()
    vn_stage_retain_wait_clock(now)
    assert vn_bp_wait is parent_wait
    assert parent.info.vn_stage_wait_clock is parent_saved
    assert current.info.vn_stage_wait_clock is parent_saved
assert ended == [] and interrupted == 0
assert retained == retains_before and pruned == prunes_before + 3
close(vn_bp_wait['elapsed'], .75)

# Even a cancelled inherited task cannot terminate the unrelated menu.
alive = False
vn_bp_poll_task()
assert interrupted == 0 and vn_bp_wait is parent_wait
alive = True
menu_saved = save_parent(parent, parent_wait)

# Returning commits only the outer event's .75s, matching Ren'Py's
# interact_core finally. It then restarts and resets the process-local
# wait sample, so eight seconds spent in the menu are not added.
parent.runtime += .75
current, depth = parent, 0
enter_interaction()
close(vn_bp_clock(), 1.95)
close(vn_bp_wait['elapsed'], .75)
frame(108.25)
vn_bp_poll_task()
close(vn_bp_wait['elapsed'], 1.0)
close(current.info.vn_stage_wait_clock['clock'], 2.2)
assert ended == []

# Menu save -> repeated load resumes the original parent wait and offsets
# exactly once. A child context's copied retention record cannot win.
for stamp in (200.0, 400.0):
    load_parent(menu_saved, stamp)
    assert vn_bp_wait_owned(vn_bp_wait)
    assert current.info.vn_stage_wait_clock['wait'] is vn_bp_wait
    assert current.info.vn_stage_wait_clock['owner'] is current.info
    close(vn_bp_wait['elapsed'], .75)
    close(vn_bp_clock(), 1.95)
    close(current.info.vn_stage_clock_offset, .75)
    frame(stamp + .25)
    vn_bp_poll_task()
    close(vn_bp_wait['elapsed'], 1.0)
    close(current.info.vn_stage_wait_clock['clock'], 2.2)

# A page callback dynamically replaces the wait and may run its own wait.
# On return, restoring the parent dictionary does not consume child time.
parent, parent_wait = current, vn_bp_wait
parent_saved = parent.info.vn_stage_wait_clock
current, depth = NS(runtime=parent.runtime, info=copy.copy(parent.info)), 1
vn_bp_wait = None
frame(401.0)
enter_interaction()
vn_bp_wait = record(.3)
enter_interaction()
frame(401.3)
vn_bp_poll_task()
assert ended == [(1, False)]
assert current.info.vn_stage_wait_clock['owner'] is current.info
assert parent.info.vn_stage_wait_clock is parent_saved
close(parent_wait['elapsed'], 1.0)
current, vn_bp_wait, depth = parent, parent_wait, 0
frame(402.0)
enter_interaction()
frame(402.2)
vn_bp_poll_task()
close(vn_bp_wait['elapsed'], 1.2)

# Direct child waits are scoped too, even if no compiled callback label
# predeclared vn_bp_wait=None. Its hard flow guard and elapsed work remain.
parent, parent_wait = current, vn_bp_wait
parent_saved = parent.info.vn_stage_wait_clock
current, depth = NS(runtime=parent.runtime, info=copy.copy(parent.info)), 1
frame(403.0)
enter_interaction()
def pause(seconds, hard=False, modal=True):
    pause_calls.append((seconds, hard, modal))
    assert vn_bp_wait_owned(vn_bp_wait) and vn_bp_wait is not parent_wait
    close(vn_bp_wait['duration'], .5)
    close(vn_bp_wait['elapsed'], 0.0)
    assert scoped[-1] == (current, parent_wait)
    enter_interaction()
    frame(now + seconds)
    vn_bp_poll_task()
    return False
renpy.pause = pause
assert vn_bp_pause(.5) is False
assert pause_calls == [(.5, True, False)]
assert vn_bp_wait is None and parent.info.vn_stage_wait_clock is parent_saved
assert ended[-1] == (1, False)
current, vn_bp_wait, depth = parent, scoped[-1][1], 0
enter_interaction()
close(vn_bp_wait['elapsed'], 1.2)

# Context identity is checked even when code is polled before a new
# interaction callback: a process sample cannot move into a copied context.
sample_parent = current
vn_bp_poll_task.sample = (vn_bp_wait, now - 50.0, sample_parent)
current = NS(runtime=parent.runtime, info=copy.copy(parent.info))
vn_bp_wait = dict(vn_bp_wait, owner=current.info, depth=0)
vn_bp_poll_task.sample = (vn_bp_wait, now - 50.0, sample_parent)
vn_bp_poll_task()
close(vn_bp_wait['elapsed'], 1.2)

# New waits have a separate identity; a same-context restart keeps the
# existing one, but a different wait starts with no inherited wall delta.
old_wait = vn_bp_wait
vn_bp_wait = record(2.0)
frame(500.0)
enter_interaction()
frame(500.2)
vn_bp_poll_task()
close(vn_bp_wait['elapsed'], .2)
frame(500.3)
enter_interaction()
frame(500.5)
vn_bp_poll_task()
close(vn_bp_wait['elapsed'], .5)
close(old_wait['elapsed'], 1.2)

# Legacy ownerless saved waits are resumable only in the primary context.
legacy = dict(duration=3.0, elapsed=.4)
assert vn_bp_wait_owned(legacy)
depth = 1
assert not vn_bp_wait_owned(legacy)
depth = 0

# The owner consumes the remaining interval and ends only its own wait.
load_parent(menu_saved, 600.0)
ended.clear()
frame(605.24)
vn_bp_poll_task()
assert ended == []
frame(605.25)
vn_bp_poll_task()
assert ended == [(0, False)]
close(vn_bp_wait['elapsed'], 6.0)
current.runtime += 5.25
vn_bp_wait = None
enter_interaction()
close(vn_stage_clock(), 7.2)
print(json.dumps({'groups': 9}))
`;
  const python = process.env.VNS_TEST_PYTHON ?? (process.platform === 'win32'
    ? path.resolve('resources/runtime/lib/py3-windows-x86_64/python.exe') : 'python3');
  const result = spawnSync(python, ['-I', '-B', '-c', script], { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).groups, 9);
});

test('菜单只读取祖先视觉时钟，有限对象和替换过渡回主上下文后仍能正常结束', () => {
  const transition = createFlowTransitionRuntime();
  const functions = [
    pythonFunction(createBlueprintRuntime(createProject('菜单视觉时钟')), 'vn_bp_clock'),
    ...['vn_stage_sample_frame_clock', 'vn_stage_render_delta', 'vn_stage_retain_wait_clock', 'vn_stage_restore_wait_clock'].map(name => pythonFunction(transition, name)),
    ...['vn_bp_wait_owned', 'vn_bp_sample_wait_context', 'vn_bp_poll_task'].map(name => pythonFunction(blueprintTaskRuntime, name)),
    ...['vn_visual_owner_context', 'vn_visual_clock', 'vn_visual_age', 'vn_visual_cleanup', 'vn_install_visual'].map(name => pythonFunction(visualTransitionsRuntime, name)),
  ].join('\n');
  const blendLines = visualTransitionsRuntime.split('\n');
  const blendStart = blendLines.findIndex(line => line.startsWith('    class VNVisualBlend('));
  const blendEnd = blendLines.findIndex((line, index) => index > blendStart && line.startsWith('    def vn_visual_snapshot('));
  assert.ok(blendStart >= 0 && blendEnd > blendStart);
  const blend = blendLines.slice(blendStart, blendEnd).map(line => line.slice(4)).join('\n');
  const script = `
import copy, json
from types import SimpleNamespace as NS
contexts = [NS(runtime=1.2, info=NS())]
now = 100.0
interface = NS(frame_time=now)
stopped, hidden = [], []
def noop(*args, **kwargs):
    pass
class Displayable:
    pass
renpy = NS(context=lambda: contexts[-1].info, context_nesting_level=lambda: len(contexts) - 1,
    game=NS(context=lambda: contexts[-1], contexts=contexts), Displayable=Displayable,
    display=NS(interface=interface, core=NS(get_time=lambda: now)), retain_after_load=noop,
    end_interaction=noop, showing=lambda tag: True, hide=lambda tag: hidden.append(tag),
    render=lambda child, *args: child, redraw=noop)
config = NS(screen_width=960, screen_height=540)
vn_bp_task = None
vn_bp_task_alive = lambda task: task != 'cancelled'
vn_bp_prune_task_resources = vn_ui_native_dispatch_navigation = vn_ui_image_poll = noop
vn_ui_video_poll = vn_ui_spine_poll = vn_bp_async_tick = vn_bp_interrupt_wait = noop
vn_stop_visual_media = lambda data: stopped.append(data['name'])
vn_visual_holds_final = lambda data: False
Fixed = lambda child=None, **kwargs: child
DynamicDisplayable = lambda fn, data: data
Null = lambda **kwargs: 'empty'
vn_visual_live = noop
${functions}
${blend}
def frame(value):
    global now
    now = value
    interface.frame_time = value
def interaction():
    vn_bp_sample_wait_context()
    vn_stage_sample_frame_clock()
def close(actual, expected):
    assert abs(actual - expected) < 1e-8, (actual, expected)
def make_visual(name):
    return dict(name=name, _vn_owner=contexts[-1].info, _vn_depth=len(contexts)-1,
        _vn_started=vn_bp_clock(), duration=6.0, persistent=False)

vn_bp_wait = dict(owner=contexts[0].info, depth=0, duration=6.0, elapsed=0.0)
interaction()
data = make_visual('parent')
replacement = VNVisualBlend('previous', data, dict(mode='none', duration=2.0), [dict(name='retired')])
frame(100.75)
vn_bp_poll_task()
close(vn_visual_age(data, True), .75)
close(replacement.age(True), .75)
parent = contexts[0]
saved_wait = vn_bp_wait
saved = copy.deepcopy((parent, saved_wait, data, replacement))

# Shallow-copied menu Context.runtime grows independently while the parent's
# last active wait retains the time from its uncommitted opening event.
contexts.append(NS(runtime=parent.runtime, info=copy.copy(parent.info)))
interaction()
contexts[-1].runtime += 8.0
frame(109.0)
vn_bp_poll_task()
close(vn_visual_age(data, True), .75)
close(replacement.age(True), .75)
assert not replacement.finished and len(replacement.old_data) == 1
vn_visual_instances = {'parent': dict(data=data, blend=replacement)}
renpy.showing = lambda tag: False
vn_visual_cleanup()
assert 'parent' in vn_visual_instances and stopped == [] and hidden == []

# Retention cannot stand in for an already ended/replaced wait, even when
# the saved record has a numerically later clock. Its exact active identity
# and owner/depth must agree, not only the copied context.info attribute.
parent.info.vn_bp_active_wait = None
close(vn_visual_age(data, True), 0.0)
parent.info.vn_bp_active_wait = dict(saved_wait)
close(vn_visual_age(data, True), 0.0)
parent.info.vn_bp_active_wait = saved_wait
parent.info.vn_stage_wait_clock = dict(parent.info.vn_stage_wait_clock, depth=1)
close(vn_visual_age(data, True), 0.0)
parent.info.vn_stage_wait_clock = dict(parent.info.vn_stage_wait_clock, depth=0)
close(vn_visual_age(data, True), .75)

# Real cancellation still cleans a foreign record. The child's own expired
# objects are also cleaned instead of disabling the cleanup pass wholesale.
cancelled = dict(data, name='cancelled', _vn_task='cancelled')
child = make_visual('child')
child['_vn_started'] -= 7.0
vn_visual_instances.update(cancelled=dict(data=cancelled), child=dict(data=child))
renpy.showing = lambda tag: True
vn_visual_cleanup()
assert set(vn_visual_instances) == {'parent'}
assert stopped == ['cancelled', 'child'] and hidden == ['cancelled']

# On menu return the owner uses its regular committed/runtime+frame clock.
# A completed blend stops retired media; the finite object then expires.
contexts.pop()
parent.runtime += .75
interaction()
frame(109.5)
vn_bp_poll_task()
close(vn_visual_age(data, True), 1.25)
close(replacement.age(True), 1.25)
frame(110.25)
vn_bp_poll_task()
replacement.render(960, 540, 0, 0)
assert replacement.finished and replacement.old_data == []
assert stopped[-1] == 'retired'
parent.runtime += 5.25
vn_bp_wait = None
interaction()
vn_visual_cleanup()
assert vn_visual_instances == {} and stopped[-1] == 'parent'

# Native save roots preserve the owner and its active wait as one graph.
# Repeated loads must restore both the parent's pose and blend progress.
for stamp in (200.0, 500.0):
    loaded, vn_bp_wait, data, replacement = copy.deepcopy(saved)
    contexts[:] = [loaded]
    frame(stamp)
    vn_stage_restore_wait_clock()
    interaction()
    assert data['_vn_owner'] is loaded.info and replacement.clock['_vn_owner'] is loaded.info
    assert loaded.info.vn_bp_active_wait is vn_bp_wait
    close(vn_visual_age(data, True), .75)
    close(replacement.age(True), .75)
    assert not replacement.finished and len(replacement.old_data) == 1
    frame(stamp + .2)
    vn_bp_poll_task()
    close(vn_visual_age(data, True), .95)
    close(replacement.age(True), .95)

# Old data and finished callback contexts use the previous local-clock
# behavior. A recycled depth can never adopt a different context's clock.
old = dict(_vn_started=vn_bp_clock() - .3)
close(vn_visual_age(old, True), .5)
missing = dict(old, _vn_owner=NS(), _vn_depth=0)
close(vn_visual_age(missing, True), .5)
data['_vn_flow_hold'] = True
close(vn_visual_age(data, True), 0.0)
data['_vn_flow_frozen_age'] = .4
close(vn_visual_age(data, True), .4)

# A child explicitly re-showing a persistent instance must not take the
# same-config shortcut when that displayable only belongs to its parent.
# This remains true after the child's scene has cleared its master layer.
vn_visual_rule = lambda data, phase: dict(mode='none', duration=0.0)
vn_visual_seconds = lambda rule: 0.0
vn_flow_transition_request = vn_game_flow_transition_request = None
vn_flow_transition_holding = lambda: False
vn_visual_flow_state = vn_performance_extend = noop
vn_visual_retired = lambda entry: [entry['data']]
Transform = lambda *args, **kwargs: None
shows = []
renpy.show = lambda tag, **kwargs: shows.append(tag)
contexts[:] = [NS(runtime=5.0, info=NS())]
template = dict(name='persistent', instanceId='persistent', content='solid', persistent=True,
    duration=0.0, layer=1, color='#ffffff')
vn_visual_instances = {}
renpy.showing = lambda tag: True
vn_install_visual(dict(template, _vn_task='first'))
root_data = vn_visual_instances['vn_visual_persistent']['data']
assert root_data['_vn_owner'] is contexts[0].info and len(shows) == 1
contexts[0].runtime += .4
vn_install_visual(dict(template, _vn_task='repeated'))
assert vn_visual_instances['vn_visual_persistent']['data'] is root_data
assert root_data['_vn_started'] == 5.0 and root_data['_vn_task'] == 'repeated' and len(shows) == 1
contexts.append(NS(runtime=5.4, info=copy.copy(contexts[0].info)))
renpy.showing = lambda tag: False
vn_install_visual(dict(template, _vn_task='child'))
child_data = vn_visual_instances['vn_visual_persistent']['data']
assert child_data is not root_data and child_data['_vn_owner'] is contexts[1].info
assert child_data['_vn_depth'] == 1 and len(shows) == 2
assert root_data['_vn_task'] == 'repeated'
renpy.showing = lambda tag: True
contexts.append(NS(runtime=5.4, info=copy.copy(contexts[1].info)))
vn_install_visual(dict(template, _vn_task='nested'))
assert vn_visual_instances['vn_visual_persistent']['data']['_vn_owner'] is contexts[2].info
assert len(shows) == 3
print(json.dumps({'groups': 7}))
`;
  const python = process.env.VNS_TEST_PYTHON ?? (process.platform === 'win32'
    ? path.resolve('resources/runtime/lib/py3-windows-x86_64/python.exe') : 'python3');
  const result = spawnSync(python, ['-I', '-B', '-c', script], { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).groups, 7);
});
