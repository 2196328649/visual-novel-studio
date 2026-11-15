import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { performanceNode } from '../src/core/blueprint-authoring';
import { addGameFlowStep } from '../src/core/game-flow-graph';
import { createProject, projectSchema, type BlueprintGraph, type BlueprintNode } from '../src/core/model';
import { createVisualObject } from '../src/core/visual-object';
import { buildProject, runRenpy } from '../src/runtime/service';
import { finishFlowNativeVerification, flowRuntimeTraceSource, recordFlowNativeResult } from './lib/flow-runtime-verification';
import { isolateRenpySaves } from './lib/renpy-saves';

// Run only during the parent's coordinated validation phase. Real authored
// buttons enter native menus; no product clock, timer or wait is driven by a
// probe. A finite moving visual and replacement blend remain owned by their
// parent. Ordinary audio/video playback is outside this clock repair.
const root = path.resolve('.');
const permittedRoot = path.join(root, 'artifacts/code-health-review-2026-11-14/runtime');
const requestedRoot = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? permittedRoot);
const inside = (parent: string, candidate: string, equal = false) => {
  const relative = path.relative(parent, candidate);
  return (equal || relative !== '') && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};
assert.ok(inside(permittedRoot, requestedRoot, true), '原生验收输出必须位于本轮 code-health-review-2026-11-14/runtime。');
const output = path.join(requestedRoot, `stage-wait-context-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`);
const source = path.join(output, 'source'), game = path.join(output, 'game'), sdk = path.join(root, 'resources/runtime');
const previousSaves = process.env.RENPY_PATH_TO_SAVES;
const duration = 6, childDuration = .55;
const report: Record<string, unknown> = {
  status: 'running', output, sdk, checks: [],
  coverage: '真实流程步骤中的父等待，原生设置菜单驻留超过父等待期限、父移动色块和替换过渡不被子时钟结束、返回后剩余时间及画面位置、设置页子蓝图独立等待、默认存档页真实保存及两次原生加载、所属流程禁止跳过与普通对白恢复。',
  limits: '960×540隔离合成工程，父等待6秒、菜单子等待0.55秒、有限移动色块及2.5秒渐变替换；不声称菜单中的音频、视频、所有文字效果冻结，也不覆盖任意旧存档。',
  input: '编译自界面按钮的 VnUiMenu；默认存读档 FileAction、默认确认与返回按钮，全部通过真实鼠标事件操作。探针仅记录标量观察，不调用产品采样或结束等待。',
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
    if (directory === output) assert.equal(stat, undefined, '每次验收使用全新目录。');
    if (stat) assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), '拒绝链接或非目录输出：' + directory);
    else await fs.mkdir(directory);
    assert.ok(inside(workspace, await fs.realpath(directory)), '验收输出离开工作区。');
  }
}

function fixture() {
  const project = createProject('原生菜单与父等待隔离');
  project.id = 'qa_wait_context'; project.width = 960; project.height = 540;
  project.assets = []; project.characters = []; project.blueprints = []; project.timelinePresets = [];
  project.playerDefaults = { textSpeed: 0, masterVolume: 0 };
  project.variables = [
    { id: 'qa_phase', name: '等待阶段', type: 'string', initial: '', persistent: false },
    { id: 'qa_child_phase', name: '菜单子等待阶段', type: 'string', initial: '', persistent: false },
  ];
  const graph = (id: string, kind: BlueprintGraph['kind'] = 'function') => {
    const result = createBlueprintGraph(kind, id); result.id = id; result.nodes[0].id = id + '_entry';
    project.blueprints.push(result); return result;
  };
  const node = (target: BlueprintGraph, type: BlueprintNode['type'], properties: BlueprintNode['properties'] = {}) => {
    const result = blueprintNodeDefaults(type); result.id = `${target.id}_n${target.nodes.length}`;
    Object.assign(result.properties, properties); target.nodes.push(result); return result;
  };
  const wire = (target: BlueprintGraph, from: BlueprintNode, to: BlueprintNode) => {
    synchronizeBlueprintSignatures(project);
    assert.equal(connectBlueprintPins(target, from.id, from.type.startsWith('event') ? 'exec' : 'exec_out', to.id, 'exec_in'), undefined);
  };
  const chain = (target: BlueprintGraph, ...items: BlueprintNode[]) => items.slice(1).forEach((item, index) => wire(target, items[index], item));
  const child = graph('qa_native_child_wait', 'ui');
  chain(child, child.nodes[0], node(child, 'setVariable', { variableId: 'qa_child_phase', value: 'waiting' }),
    node(child, 'delay', { seconds: childDuration }), node(child, 'setVariable', { variableId: 'qa_child_phase', value: 'done' }));
  const worker = graph('qa_parent_wait');
  const card = { ...createVisualObject('solid'), instanceId: 'qa_wait_visual', name: 'QA Waiting Card',
    width: .16, height: .2, layer: 10, color: '#c94858', duration, persistent: false };
  card.keyframes[0].x = .2; card.keyframes[0].y = .5;
  card.curves = { x: [{ at: 0, value: .2, easing: 'linear' }, { at: duration, value: .8, easing: 'linear' }] };
  const visual = performanceNode(project, card); visual.id = 'qa_parent_visual'; worker.nodes.push(visual);
  const previous = { ...createVisualObject('solid'), instanceId: 'qa_wait_blend', name: 'QA Old Blend',
    width: .14, height: .2, layer: 11, color: '#e6c44a', duration, persistent: false };
  previous.keyframes[0].x = .82; previous.keyframes[0].y = .5;
  const oldVisual = performanceNode(project, previous); oldVisual.id = 'qa_parent_blend_old'; worker.nodes.push(oldVisual);
  const replacement = performanceNode(project, { ...previous, name: 'QA New Blend', color: '#347ed0',
    visualTransitions: { replace: { mode: 'dissolve', duration: 2.5 } } });
  replacement.id = 'qa_parent_blend_new'; worker.nodes.push(replacement);
  chain(worker, worker.nodes[0], visual, oldVisual, replacement, node(worker, 'delay', { seconds: duration }));
  const parent = graph('qa_wait_entry');
  chain(parent, parent.nodes[0], node(parent, 'showUiPage', { pageId: 'qa_wait_controls', wait: false, modalMode: 'modeless' }),
    node(parent, 'setVariable', { variableId: 'qa_phase', value: 'waiting' }), node(parent, 'callFunction', { graphId: worker.id }),
    node(parent, 'closeUiPage', { pageId: 'qa_wait_controls' }), node(parent, 'setVariable', { variableId: 'qa_phase', value: 'done' }));
  addGameFlowStep(project, 'beforeNewGame', { id: 'qa_wait_flow', kind: 'blueprint', graphId: parent.id, allowSkip: false });
  project.ui.pages = { main: { background: '#182638' }, say: { showQuickMenu: false }, preferences: { layout: 'custom', background: '#1b2f39' } };
  project.ui.components = [
    { id: 'qa_settings_title', kind: 'text', page: 'preferences', text: '真实设置菜单 · 父等待保持', x: .12, y: .18, width: .76, height: .15, style: { fontSize: 34 } },
    { id: 'qa_child_button', kind: 'button', page: 'preferences', text: '运行菜单内的短等待', action: 'blueprint', blueprintId: child.id, x: .3, y: .43, width: .4, height: .12 },
    { id: 'qa_settings_return', kind: 'button', page: 'preferences', text: '返回游戏', action: 'return', x: .36, y: .7, width: .28, height: .11 },
  ];
  project.ui.customPages = [{ id: 'qa_wait_controls', name: '演出中的正常菜单按钮', modal: false, opening: { presentation: 'overlay' },
    components: [
      { id: 'qa_wait_label', kind: 'text', page: 'custom', text: '演出等待进行中', x: .15, y: .12, width: .7, height: .15, style: { fontSize: 36 } },
      { id: 'qa_open_settings', kind: 'button', page: 'custom', text: '设置', action: 'preferences', x: .18, y: .72, width: .18, height: .12 },
      { id: 'qa_open_save', kind: 'button', page: 'custom', text: '存档', action: 'save', x: .41, y: .72, width: .18, height: .12 },
      { id: 'qa_open_load', kind: 'button', page: 'custom', text: '读档', action: 'load', x: .64, y: .72, width: .18, height: .12 },
    ] }];
  const passage = project.nodes.find(item => item.kind === 'passage')!;
  passage.lines = [
    { id: 'qa_wait_done', text: '父等待按剩余时间完成。', actions: [] },
    { id: 'qa_wait_dialogue', text: '普通台词仍可点击继续。', actions: [] },
  ];
  synchronizeBlueprintSignatures(project);
  return { project: projectSchema.parse(JSON.parse(JSON.stringify(project))), passageId: passage.id };
}

function testSource(passageId: string) {
  return `
init -999 python:
    import renpy as qa_engine
    qa_engine.safe_mode_checked = True
${flowRuntimeTraceSource(output)}
init python:
    import time as qa_time
    import renpy.test.testexecution as qa_test_execution
    class QAWaitContextProbe(object):
        def __init__(self):
            self.rows, self.saves, self.loads, self.finishes = [], [], [], []
            self.markers = {}
            self.last_frame = 0.0
    qa_test_execution.wait_context_probe = QAWaitContextProbe()
    def qa_probe():
        return qa_test_execution.wait_context_probe
    def qa_visuals():
        result = []
        for tag, entry in vn_visual_instances.items():
            data, blend = entry['data'], entry.get('blend')
            if data.get('name') not in ('QA Waiting Card', 'QA New Blend'):
                continue
            age = vn_visual_age(data, True)
            result.append(dict(name=data['name'], tag=tag, age=age, pose=vn_visual_pose(data, age),
                width=data['width'], height=data['height'], duration=data['duration'],
                expired=bool(data.get('_vn_expired')), showing=renpy.showing(tag),
                owner_depth=data.get('_vn_depth'), owner_matches=data.get('_vn_owner') is renpy.game.contexts[0].info,
                blend_age=blend.age(True) if blend else None, blend_finished=blend.finished if blend else None,
                blend_retired=len(blend.old_data) if blend else None))
        return sorted(result, key=lambda row: row['name'])
    def qa_state():
        context, owner, wait = renpy.game.context(), renpy.context(), vn_bp_wait
        base = renpy.game.contexts[0]
        saved = getattr(base.info, 'vn_stage_wait_clock', None)
        root_wait = saved.get('wait') if saved else None
        sample = getattr(vn_bp_poll_task, 'sample', None)
        return dict(wall=qa_time.monotonic(), depth=renpy.context_nesting_level(), phase=vn_var_qa_phase,
            child_phase=vn_var_qa_child_phase, wait_id=id(wait) if wait is not None else None,
            elapsed=wait.get('elapsed') if wait is not None else None, duration=wait.get('duration') if wait is not None else None,
            owner=bool(wait is not None and wait.get('owner') is owner), wait_depth=wait.get('depth') if wait is not None else None,
            active_wait=bool(wait is not None and getattr(owner, 'vn_bp_active_wait', None) is wait),
            root_wait_id=id(root_wait) if root_wait is not None else None,
            root_elapsed=root_wait.get('elapsed') if root_wait is not None else None,
            root_duration=root_wait.get('duration') if root_wait is not None else None,
            root_owner=bool(root_wait is not None and root_wait.get('owner') is base.info),
            root_active_wait=bool(root_wait is not None and getattr(base.info, 'vn_bp_active_wait', None) is root_wait),
            root_saved_clock=saved.get('clock') if saved else None,
            root_saved_owner=bool(saved and saved.get('owner') is base.info and saved.get('depth') == 0),
            root_runtime=base.runtime, root_offset=getattr(base.info, 'vn_stage_clock_offset', 0.0),
            stage=vn_stage_clock(), bp=vn_bp_clock(), render_delta=vn_stage_render_delta(),
            visuals=qa_visuals(),
            sample_owned=bool(sample and sample[0] is wait and sample[2] is context),
            flags=dict(skipping=_skipping, dismiss=_dismiss_pause, active=config.skipping),
            frame_seconds=renpy.display.interface.frame_duration)
    def qa_budget():
        # One guard sample plus two bounded frames covers button delivery and
        # the first resumed/completed frame, not seconds of menu residence.
        return .020 + 2 * min(1.0 / 30.0, max(1.0 / 60.0, renpy.display.interface.frame_duration)) + .002
    def qa_mark(name):
        state = qa_state()
        qa_probe().markers[name] = state
        qa_trace(name, state=state, budget=qa_budget())
        return state
    def qa_screenshot(name):
        # Evaluated on the screenshot's drawn frame. The Node-side pixel
        # check compares actual card geometry with this exact sampled pose.
        qa_mark('frame-' + name)
        return name + '.png'
    def qa_visual_continuity(before, after):
        assert len(before) == len(after) == 2
        for old, new in zip(before, after):
            assert old['name'] == new['name'] and old['tag'] == new['tag']
            assert new['owner_matches'] and new['owner_depth'] == 0 and not new['expired']
            assert abs(new['age'] - old['age']) <= qa_budget(), (old, new)
            if old['blend_age'] is not None:
                assert abs(new['blend_age'] - old['blend_age']) <= qa_budget()
                assert new['blend_finished'] == old['blend_finished'] and new['blend_retired'] == old['blend_retired']
    def qa_label(name, abnormal):
        if name == 'vn_node_${passageId}' and vn_var_qa_phase == 'done':
            qa_probe().finishes.append(qa_state())
    qa_original_draw = renpy.display.core.Interface.draw_screen
    def qa_draw(self, root_widget, fullscreen_video, draw):
        qa_original_draw(self, root_widget, fullscreen_video, draw)
        stamp = qa_time.monotonic()
        if draw and vn_var_qa_phase == 'waiting' and stamp - qa_probe().last_frame >= .025:
            qa_probe().last_frame = stamp
            qa_probe().rows.append(qa_state())
    qa_original_save = renpy.save
    def qa_save(slot, *args, **kwargs):
        if slot == '1-1':
            qa_probe().saves.append(qa_state())
            qa_trace('native-menu-save', state=qa_probe().saves[-1])
        return qa_original_save(slot, *args, **kwargs)
    def qa_loaded():
        qa_probe().loads.append(qa_state())
        qa_trace('native-menu-load-%d' % len(qa_probe().loads), state=qa_probe().loads[-1])
    def qa_held(name, minimum):
        old, current = qa_probe().markers[name], qa_mark(name + '-held')
        assert current['depth'] == 1 and current['phase'] == 'waiting'
        assert current['wall'] - old['wall'] >= minimum
        assert current['wait_id'] == old['wait_id'] == current['root_wait_id']
        assert current['elapsed'] == old['elapsed'] == current['root_elapsed']
        assert current['root_saved_clock'] == old['root_saved_clock']
        assert current['root_owner'] and current['root_saved_owner'] and not current['owner']
        assert not current['sample_owned']
        qa_visual_continuity(old['visuals'], current['visuals'])
        assert all(row['age'] < 2.0 for row in current['visuals'])
        replacement = next(row for row in current['visuals'] if row['blend_age'] is not None)
        assert not replacement['blend_finished'] and replacement['blend_retired'] == 1
        return True
    def qa_resumed(name):
        old, current = qa_probe().markers[name], qa_mark(name + '-resumed')
        assert current['depth'] == 0 and current['owner'] and current['wait_depth'] == 0
        # Owner polling copies the elapsed record for rollback. Its current
        # references must agree; only a foreign menu must retain the old id.
        assert current['wait_id'] == current['root_wait_id']
        assert current['active_wait'] and current['root_active_wait'] and current['root_owner'] and current['root_saved_owner']
        assert current['duration'] == old['duration'] == current['root_duration']
        assert current['elapsed'] == current['root_elapsed']
        assert old['elapsed'] <= current['elapsed'] <= old['elapsed'] + qa_budget()
        assert abs(current['stage'] + current['render_delta'] - old['root_saved_clock']) <= qa_budget()
        assert not current['flags']['dismiss'] and not current['flags']['skipping'] and not current['flags']['active']
        qa_visual_continuity(old['visuals'], current['visuals'])
        assert all(row['showing'] for row in current['visuals'])
        return True
    def qa_finished(name):
        current, resumed = qa_probe().finishes[-1], qa_probe().markers[name]
        remaining = resumed['duration'] - resumed['elapsed']
        consumed = current['wall'] - resumed['wall']
        assert abs(consumed - remaining) <= qa_budget(), (consumed, remaining, qa_budget())
        assert current['phase'] == 'done' and current['depth'] == 0 and current['duration'] is None
        assert current['flags']['dismiss'] and current['flags']['skipping']
        assert all(row['age'] >= row['duration'] - qa_budget() for row in current['visuals'])
        qa_trace(name + '-finished', resumed=resumed, finished=current, remaining=remaining, consumed=consumed, budget=qa_budget())
        return True
    def qa_restored(count):
        saved, loaded = qa_probe().saves[-1], qa_probe().loads[-1]
        current = qa_mark('load-%d-resumed' % count)
        assert len(qa_probe().loads) == count and saved['depth'] == 1
        assert saved['root_elapsed'] >= .5 and saved['root_duration'] == ${duration}
        assert loaded['depth'] == 0 and loaded['owner'] and loaded['wait_depth'] == 0
        assert loaded['root_owner'] and loaded['root_saved_owner']
        assert abs(loaded['elapsed'] - saved['root_elapsed']) < 1e-7
        assert abs(loaded['bp'] - saved['root_saved_clock']) < 1e-7
        assert current['elapsed'] >= loaded['elapsed'] and current['elapsed'] < loaded['elapsed'] + .5
        assert not current['flags']['dismiss'] and not current['flags']['skipping'] and not current['flags']['active']
        if count > 1:
            first = qa_probe().loads[0]
            assert abs(loaded['bp'] - first['bp']) < 1e-7
            assert abs(loaded['root_offset'] - first['root_offset']) < 1e-7
        qa_visual_continuity(saved['visuals'], loaded['visuals'])
        assert all(row['showing'] and not row['expired'] for row in current['visuals'])
        qa_trace('loaded-continuity-%d' % count, saved=saved, loaded=loaded, resumed=current, budget=qa_budget())
        return True
    def qa_child_finished():
        before, after = qa_probe().markers['child-menu'], qa_mark('child-menu-returned')
        rows = [row for row in qa_probe().rows if row['wall'] >= before['wall'] and row['depth'] == 2 and row['child_phase'] == 'waiting']
        assert len(rows) >= 2
        assert all(row['owner'] and row['wait_depth'] == 2 and row['duration'] == ${childDuration} for row in rows)
        assert all(row['root_wait_id'] == before['root_wait_id'] and row['root_elapsed'] == before['root_elapsed'] for row in rows)
        assert all(not row['flags']['dismiss'] and not row['flags']['skipping'] and not row['flags']['active'] for row in rows)
        assert rows[-1]['elapsed'] > rows[0]['elapsed']
        assert after['child_phase'] == 'done' and after['depth'] == 1 and not after['owner']
        assert after['elapsed'] == before['elapsed'] and after['wait_id'] == before['wait_id']
        assert after['wall'] - before['wall'] >= ${childDuration}
        qa_visual_continuity(before['visuals'], after['visuals'])
        qa_trace('child-independent-wait', before=before, rows=rows, after=after)
        return True
    def qa_visuals_progressed(marker):
        before, current = qa_probe().markers[marker], qa_mark(marker + '-progressed')
        assert len(current['visuals']) == 2
        for old, new in zip(before['visuals'], current['visuals']):
            assert new['age'] >= old['age'] + .15 and new['showing'] and not new['expired']
            if old['blend_age'] is not None:
                assert new['blend_age'] >= old['blend_age'] + .15
        return True
    def qa_visuals_finished():
        # Expired global records are removed on the next ordinary interaction,
        # and the draw returns no pixels rather than permanently holding them.
        state = qa_mark('finite-visuals-finished')
        assert not state['visuals']
        return True
    config.label_callbacks.append(qa_label)
    renpy.display.core.Interface.draw_screen = qa_draw
    renpy.save = qa_save

init 1002 python:
    config.after_load_callbacks.append(qa_loaded)

testsuite global:
    before testcase:
        $ _test.timeout = 24.0
        $ _test.transition_timeout = .05
        $ _test.screenshot_directory = 'tests/screenshots'
        $ preferences.text_cps = 0
        $ preferences.afm_enable = False
        $ preferences.skip_unseen = True
    after testcase:
        if not screen 'main_menu':
            run MainMenu(confirm=False)
        pause until screen 'main_menu'
    teardown:
        exit

testcase a_native_menu_stays_past_parent_wait_deadline:
    click id 'vn_main_start'
    pause until eval vn_var_qa_phase == 'waiting' and vn_bp_wait is not None and vn_bp_wait['elapsed'] >= .65
    assert eval vn_bp_wait['duration'] == ${duration} and not _skipping and not _dismiss_pause
    click id 'vn_component_qa_open_settings'
    pause until screen 'preferences'
    $ qa_mark('long-menu')
    # Deliberately remain longer than the full parent wait to expose its old
    # end_interaction incorrectly dismissing the native menu's interaction.
    pause ${duration + .25}
    assert screen 'preferences'
    assert eval qa_held('long-menu', ${duration})
    screenshot '01-menu-stays-open.png'
    click id 'vn_component_qa_settings_return'
    pause until eval renpy.context_nesting_level() == 0
    assert eval qa_resumed('long-menu')
    screenshot qa_screenshot('02-parent-resumed')
    click pos (840, 80)
    keysym 'K_RETURN' pos (840, 80)
    pause .2
    assert eval vn_var_qa_phase == 'waiting' and vn_bp_wait is not None and not config.skipping
    assert eval qa_visuals_progressed('long-menu-resumed')
    pause until '父等待按剩余时间完成。'
    assert eval qa_finished('long-menu-resumed')
    click pos (840, 80)
    pause until '普通台词仍可点击继续。'
    assert eval vn_bp_task is None and vn_bp_wait is None
    assert eval qa_visuals_finished()
    screenshot '02b-parent-completed.png'

testcase b_save_inside_native_menu_restores_parent_twice:
    click id 'vn_main_start'
    pause until eval vn_var_qa_phase == 'waiting' and vn_bp_wait is not None and vn_bp_wait['elapsed'] >= .65
    click id 'vn_component_qa_open_save'
    pause until screen 'save'
    $ qa_mark('save-menu')
    # A text selector for '1' also matches FileSave's slot alt text. The
    # isolated fresh save directory already starts on the first file page.
    assert eval FilePageName() == '1' and not renpy.can_load('1-1')
    pause .25
    click id 'vn_file_slot_1'
    pause until eval renpy.can_load('1-1')
    assert screen 'save'
    assert not screen 'confirm'
    assert eval qa_held('save-menu', .2) and len(qa_probe().saves) == 1
    screenshot '03-native-menu-saved.png'
    click '读档'
    pause until screen 'load'
    click id 'vn_file_slot_1'
    pause until screen 'confirm'
    click id 'vn_confirm_yes'
    pause until eval len(qa_probe().loads) == 1 and renpy.context_nesting_level() == 0
    assert eval qa_restored(1)
    pause .2
    click id 'vn_component_qa_open_load'
    pause until screen 'load'
    click id 'vn_file_slot_1'
    pause until screen 'confirm'
    click id 'vn_confirm_yes'
    pause until eval len(qa_probe().loads) == 2 and renpy.context_nesting_level() == 0
    assert eval qa_restored(2)
    screenshot qa_screenshot('04-restored-second-time')
    click pos (840, 80)
    pause .2
    assert eval vn_var_qa_phase == 'waiting' and vn_bp_wait is not None and not _dismiss_pause
    assert eval qa_visuals_progressed('load-2-resumed')
    pause until '父等待按剩余时间完成。'
    assert eval qa_finished('load-2-resumed')

testcase c_native_menu_callback_owns_its_wait:
    click id 'vn_main_start'
    pause until eval vn_var_qa_phase == 'waiting' and vn_bp_wait is not None and vn_bp_wait['elapsed'] >= .65
    click id 'vn_component_qa_open_settings'
    pause until screen 'preferences'
    $ qa_mark('child-menu')
    click id 'vn_component_qa_child_button'
    pause until eval vn_var_qa_child_phase == 'waiting' and vn_bp_wait is not None and renpy.context_nesting_level() == 2
    assert eval vn_bp_wait['duration'] == ${childDuration} and not _skipping and not _dismiss_pause
    click pos (840, 80)
    keysym 'K_RETURN' pos (840, 80)
    pause until eval vn_var_qa_child_phase == 'done' and renpy.context_nesting_level() == 1
    assert screen 'preferences'
    assert eval qa_child_finished()
    screenshot '05-child-wait-finished.png'
    click id 'vn_component_qa_settings_return'
    pause until eval renpy.context_nesting_level() == 0
    assert eval qa_resumed('child-menu')
    pause until '父等待按剩余时间完成。'
    assert eval qa_finished('child-menu-resumed')
`;
}

async function preserveGenerated(directory: string, relative = ''): Promise<void> {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name), next = path.join(relative, entry.name);
    if (entry.isDirectory() && !['assets', 'fonts', 'cache', 'saves', 'tests'].includes(entry.name)) await preserveGenerated(child, next);
    else if (entry.isFile() && entry.name.endsWith('.rpy')) {
      const destination = path.join(output, 'generated-source', next);
      await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.copyFile(child, destination);
    }
  }
}

async function verifyVisualScreenshots() {
  const checks: Record<string, unknown>[] = [];
  for (const name of ['02-parent-resumed', '04-restored-second-time']) {
    const trace = JSON.parse(await fs.readFile(path.join(output, 'traces', 'frame-' + name + '.json'), 'utf8')) as {
      values: { state: { visuals: { name: string; pose: { x: number; y: number }; width: number; height: number }[] } };
    };
    const files: string[] = [];
    const visit = async (directory: string): Promise<void> => {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const candidate = path.join(directory, entry.name);
        if (entry.isDirectory()) await visit(candidate);
        else if (entry.name === name + '.png') files.push(candidate);
      }
    };
    await visit(path.join(game, 'tests', 'screenshots'));
    assert.equal(files.length, 1, '必须保留该实际绘制帧的唯一截图：' + name);
    const image = PNG.sync.read(await fs.readFile(files[0]));
    const card = trace.values.state.visuals.find(row => row.name === 'QA Waiting Card');
    assert.ok(card, '同一帧必须存在有限时长移动色块。');
    let left = image.width, top = image.height, right = -1, bottom = -1, pixels = 0;
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const index = (y * image.width + x) * 4;
      if (Math.abs(image.data[index] - 0xc9) > 3 || Math.abs(image.data[index + 1] - 0x48) > 3 || Math.abs(image.data[index + 2] - 0x58) > 3) continue;
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); pixels++;
    }
    assert.ok(pixels > image.width * image.height * card.width * card.height * .85, '色块不能因菜单中过期而从画面消失。');
    const center = { x: (left + right + 1) / 2, y: (top + bottom + 1) / 2 };
    const expected = { x: card.pose.x * image.width, y: card.pose.y * image.height };
    const error = Math.hypot(center.x - expected.x, center.y - expected.y);
    assert.ok(error <= 1.5, `${name} 实际色块位置与同帧恢复姿态不一致：${error}px`);
    checks.push({ name, width: image.width, height: image.height, pixels, center, expected, errorPixels: error, tolerancePixels: 1.5 });
  }
  report.visualScreenshots = checks;
  await fs.writeFile(path.join(output, 'visual-screenshots.json'), JSON.stringify(checks, null, 2));
}

let failure: unknown;
await prepareOutput();
try {
  await fs.mkdir(source); await isolateRenpySaves(output);
  const { project, passageId } = fixture(), tests = testSource(passageId);
  await fs.writeFile(path.join(source, 'project.vns.json'), JSON.stringify(project, null, 2));
  await fs.writeFile(path.join(output, 'fixture.project.json'), JSON.stringify(project, null, 2));
  await fs.writeFile(path.join(output, 'testcases.rpy'), tests);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  const built = await buildProject({ project, projectDir: source, sdkRoot: sdk, outputDir: game, development: true });
  await fs.writeFile(path.join(output, 'compile.log'), built.log + '\n' + JSON.stringify(built.diagnostics, null, 2));
  (report.checks as unknown[]).push({ name: 'compile', ok: built.ok, diagnostics: built.diagnostics });
  assert.ok(built.ok, built.log + JSON.stringify(built.diagnostics));
  await fs.writeFile(path.join(game, 'game', 'testcases.rpy'), tests);
  await preserveGenerated(path.join(game, 'game'));
  const options = { savedir: path.join(output, 'saves'), timeoutMs: 110000, env: { RENPY_RENDERER: 'gl2' } };
  const lint = await runRenpy(sdk, game, ['lint'], options);
  await fs.writeFile(path.join(output, 'lint.log'), lint.log);
  (report.checks as unknown[]).push({ name: 'lint', code: lint.code }); assert.equal(lint.code, 0, lint.log);
  const result = await runRenpy(sdk, game, ['test', '--report-detailed', '--report-skipped'], { ...options, onData: text => process.stdout.write(text) });
  await fs.writeFile(path.join(output, 'runtime.log'), result.log);
  recordFlowNativeResult(report, tests.slice(tests.indexOf('\ntestsuite global:')), result, 3);
  await verifyVisualScreenshots();
  report.status = 'passed';
} catch (error) { failure = error; report.status = 'failed'; report.error = String(error); console.error(error); }
finally {
  const finishError = await finishFlowNativeVerification(output, game, report, previousSaves);
  failure ??= finishError;
  if (failure) process.exitCode = 1;
}
