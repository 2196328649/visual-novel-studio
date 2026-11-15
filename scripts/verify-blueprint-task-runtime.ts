import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { CustomUiPage } from '../src/core/model';
import { createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { createVisualObject } from '../src/core/visual-object';
import { createAudioClip } from '../src/core/audio-clip';
import { arrangePerformanceTimeline, performanceTimeline } from '../src/core/performance-timeline';
import { createCustomUiPage } from '../src/core/game-flow';
import { addGameFlowStep } from '../src/core/game-flow-graph';
import { createUiPagePreviewFixture } from './lib/ui-page-preview-fixture';
import { writeUiStageAssets } from './lib/ui-stage-fixture';
import { buildProject, runRenpy } from '../src/runtime/service';

const sdk = process.env.VNS_RENPY_SDK ?? 'E:/Tools/renpy-8.5.3-sdk';
const output = path.resolve('artifacts/blueprint-task-runtime', new Date().toISOString().replaceAll(':', '-'));
const source = path.join(output, 'source'), game = path.join(output, 'game');
const report: { status: string; checks: { name: string; code: number; logPath: string }[]; error?: string; cleanup?: unknown } = { status: 'running', checks: [] };
await fs.mkdir(source, { recursive: true });
const saveReport = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
async function check(name: string, result: { code: number; log: string }) {
  const logPath = path.join(output, name + '.log'); await fs.writeFile(logPath, result.log);
  report.checks.push({ name, code: result.code, logPath }); await saveReport();
  if (result.code) throw new Error(name + ': ' + result.log.slice(-6000));
}

try {
  const f = createUiPagePreviewFixture(), p = f.project;
  p.id = 'blueprint_task_verification'; p.name = '蓝图跳过与页面任务验收';
  p.ui.disabledPages = ['gallery'];
  p.variables.push({ id: 'phase', name: '验收阶段', type: 'string', initial: '', persistent: false },
    ...['late', 'page_work', 'primary', 'saved_shows'].map(id => ({ id, name: id, type: 'number' as const, initial: 0, persistent: false })));
  const graph = (name: string) => { const g = createBlueprintGraph('function', name); p.blueprints.push(g); return g; };
  const baseline = createCustomUiPage(p, '不属于当前演出的叠加页'); baseline.modal = false;
  const transient = createCustomUiPage(p, '当前演出的临时页'); transient.modal = false;
  const worker = graph('内层等待'), delay = f.add(worker, 'delay', { seconds: 120 });
  f.chain(worker, worker.nodes[0], delay); f.increment(worker, delay, 'late');
  const nested = graph('循环与依次执行');
  const marker = f.add(nested, 'setVariable', { variableId: 'phase', value: 'delay' });
  const open = f.add(nested, 'showUiPage', { pageId: transient.id, wait: false });
  const sequence = f.add(nested, 'sequence'), loop = f.add(nested, 'forLoop', { firstIndex: 0, lastIndex: 2 });
  const call = f.add(nested, 'callFunction', { graphId: worker.id });
  f.chain(nested, nested.nodes[0], marker, open, sequence);
  f.link(nested, sequence, 'then_0', loop, 'exec_in'); f.link(nested, loop, 'loop_body', call, 'exec_in');
  f.link(nested, loop, 'completed', f.add(nested, 'setVariable', { variableId: 'late', value: 20 }), 'exec_in');
  f.link(nested, sequence, 'then_1', f.add(nested, 'setVariable', { variableId: 'late', value: 30 }), 'exec_in');
  const animation = graph('控件动画等待'), animationMarker = f.add(animation, 'setVariable', { variableId: 'phase', value: 'animation' });
  const animate = f.add(animation, 'animateUiProperty', { componentId: baseline.components[0].id, property: 'opacity', value: 0, duration: 120, wait: true });
  f.chain(animation, animation.nodes[0], animationMarker, animate); f.increment(animation, animate, 'late');
  const confirmation = graph('确认等待'), confirmationMarker = f.add(confirmation, 'setVariable', { variableId: 'phase', value: 'confirm' });
  const confirm = f.add(confirmation, 'confirmMessage', { message: '跳过不应等于确认或取消分支' });
  f.chain(confirmation, confirmation.nodes[0], confirmationMarker, confirm);
  for (const pin of ['yes', 'no']) f.link(confirmation, confirm, pin, f.add(confirmation, 'setVariable', { variableId: 'late', value: pin === 'yes' ? 40 : 50 }), 'exec_in');
  const timelines = ['gap', 'tail'].map(kind => {
    const visual = createVisualObject('text'); Object.assign(visual, { text: kind + ' 长时间演出', duration: 120, wait: false });
    const timeline = blueprintFromPerformance(p, [visual], kind + ' 时间轴'); p.blueprints.push(timeline);
    const model = performanceTimeline(p, timeline);
    arrangePerformanceTimeline(p, timeline, model.clips.map(c => ({ ...c, at: kind === 'gap' ? 120 : 0 })), model.tracks);
    const wrapper = graph(kind + ' 调用入口'), mark = f.add(wrapper, 'setVariable', { variableId: 'phase', value: kind });
    const call = f.add(wrapper, 'callFunction', { graphId: timeline.id, wait: true });
    f.chain(wrapper, wrapper.nodes[0], mark, call); f.increment(wrapper, call, 'late');
    return { wrapper, visual, timeline };
  });
  // A finite audio clip belongs to the skipped item; background music is not
  // globally reset. This asset is synthesized inside the isolated fixture.
  await writeUiStageAssets(source);
  p.assets.push({ id: 'task_tone', kind: 'audio', name: '验收声音', path: 'tone.wav' });
  const audio = graph('声音片段等待'), sound = createAudioClip('task_tone', '任务声音', 3);
  sound.wait = true;
  const audioMarker = f.add(audio, 'setVariable', { variableId: 'phase', value: 'audio' });
  const play = f.add(audio, 'savedAction', { action: JSON.stringify(sound) });
  f.chain(audio, audio.nodes[0], audioMarker, play); f.increment(audio, play, 'late');
  addGameFlowStep(p, 'beforeTitle', { kind: 'page', pageId: baseline.id, wait: false, modal: false });
  for (const g of [nested, animation, confirmation, ...timelines.map(t => t.wrapper), audio]) addGameFlowStep(p, 'beforeTitle', { kind: 'blueprint', graphId: g.id, allowSkip: true });
  const finish = graph('进入标题'), closeBaseline = f.add(finish, 'closeUiPage', { pageId: baseline.id });
  f.chain(finish, finish.nodes[0], closeBaseline, f.add(finish, 'setVariable', { variableId: 'phase', value: 'title' }));
  addGameFlowStep(p, 'beforeTitle', { kind: 'blueprint', graphId: finish.id });

  // A page-owned on-show task must be cancelled while an external page caller
  // still resumes once. Reopening uses a new token, including the same callback.
  const showLast = f.show.nodes.find(n => n.type === 'setVariable')!;
  const showDelay = f.add(f.show, 'delay', { seconds: 1.2 });
  f.chain(f.show, showLast, showDelay); f.increment(f.show, showDelay, 'page_work');
  f.chain(f.closer, f.close, f.add(f.closer, 'setVariable', { variableId: 'late', value: 60 }));
  const primary = graph('页面关闭后的主操作'); f.increment(primary, primary.nodes[0], 'primary');
  const closeButton = p.ui.customPages.find(page => page.id === 'waiting_page')!.components[0];
  closeButton.events = { onClick: f.closer.id }; closeButton.blueprintId = primary.id;
  const closeParent = graph('子页关闭父页'), parentClose = f.add(closeParent, 'closeUiPage', { pageId: 'waiting_page', result: '父页完成' });
  f.chain(closeParent, closeParent.nodes[0], parentClose); f.increment(closeParent, parentClose, 'late');
  p.ui.customPages.find(page => page.id === 'nested_page')!.components[0].blueprintId = closeParent.id;
  const selfClosing: CustomUiPage = createCustomUiPage(p, '显示后立即关闭');
  const closeSelf = graph('显示时关闭自己');
  const selfClose = f.add(closeSelf, 'closeUiPage', { pageId: selfClosing.id });
  f.chain(closeSelf, closeSelf.nodes[0], selfClose); f.increment(closeSelf, selfClose, 'late');
  selfClosing.onShowBlueprintId = closeSelf.id;
  const savedPage: CustomUiPage = createCustomUiPage(p, '存档中的页面实例'); savedPage.modal = false;
  const savedShow = graph('存档页显示次数'); f.increment(savedShow, savedShow.nodes[0], 'saved_shows'); savedPage.onShowBlueprintId = savedShow.id;
  const savedWait = graph('可恢复的等待');
  const savedMarker = f.add(savedWait, 'setVariable', { variableId: 'phase', value: 'saved_wait' });
  const savedOpen = f.add(savedWait, 'showUiPage', { pageId: savedPage.id, wait: false, modalMode: 'modeless' });
  const savedDelay = f.add(savedWait, 'delay', { seconds: 3 });
  const savedClose = f.add(savedWait, 'closeUiPage', { pageId: savedPage.id });
  f.chain(savedWait, savedWait.nodes[0], savedMarker, savedOpen, savedDelay, savedClose, f.add(savedWait, 'setVariable', { variableId: 'phase', value: 'resumed' }));
  addGameFlowStep(p, 'beforeNewGame', { kind: 'blueprint', graphId: savedWait.id, allowSkip: false });
  const passage = p.nodes.find(node => node.kind === 'passage')!;
  passage.lines[0].text = '等待恢复后进入剧情。';
  synchronizeBlueprintSignatures(p);
  await fs.writeFile(path.join(source, 'project.vns.json'), JSON.stringify(p, null, 2));
  const built = await buildProject({ project: p, projectDir: source, sdkRoot: sdk, outputDir: game, development: true });
  await check('compile', { code: built.ok ? 0 : 1, log: built.log + '\n' + JSON.stringify(built.diagnostics) });
  const q = JSON.stringify;
  await fs.writeFile(path.join(game, 'game', 'testcases.rpy'), `testsuite global:
    before testcase:
        $ _test.timeout = 15.0
        $ _test.transition_timeout = 0.5
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
    after testcase:
        screenshot "last-state.png"
    teardown:
        exit

testcase skip_and_page_tasks:
    pause until eval (vn_var_phase == "delay")
    assert eval (${q(baseline.id)} in vn_ui_open_pages)
    assert eval (${q(transient.id)} in vn_ui_open_pages)
    screenshot "nested-delay.png"
    click "跳过这一项"
    pause until eval (vn_var_phase == "animation")
    assert eval (vn_var_late == 0)
    assert eval (${q(baseline.id)} in vn_ui_open_pages)
    assert eval (${q(transient.id)} not in vn_ui_open_pages)
    assert eval (bool(vn_ui_animations))
    click "跳过这一项"
    pause until screen "confirm"
    assert eval (vn_var_late == 0)
    assert eval (not vn_ui_animations)
    screenshot "skippable-confirmation.png"
    click "跳过这一项"
    pause until eval (vn_var_phase == "gap")
    assert eval (vn_var_late == 0)
    assert eval (not renpy.get_screen("confirm"))
    click "跳过这一项"
    pause until eval (vn_var_phase == "tail")
    assert eval (vn_var_late == 0)
    assert eval (isinstance(vn_bp_timeline_end_${timelines[1].timeline.id}, (int, float)))
    assert eval (renpy.showing(${q('vn_visual_' + timelines[1].visual.instanceId)}))
    click "跳过这一项"
    pause until eval (vn_var_phase == "audio")
    assert eval (vn_var_late == 0)
    assert eval (not renpy.showing(${q('vn_visual_' + timelines[1].visual.instanceId)}))
    assert eval (bool(vn_audio_clips))
    click "跳过这一项"
    pause until screen "main_menu"
    assert eval (vn_var_phase == "title")
    assert eval (vn_var_late == 0)
    assert eval (not vn_audio_clips and not vn_ui_animations)
    assert eval (not vn_ui_open_pages and not vn_ui_page_sessions)
    assert eval (vn_flow_active_step is None and vn_bp_task is None)
    screenshot "clean-title.png"
    click id "vn_component_open_button"
    pause until eval (vn_var_opens == 1)
    $ old_task = vn_bp_task_create("waiting_page")
    assert eval (vn_bp_task_alive(old_task))
    click id "vn_component_close_button"
    pause until eval (vn_var_after == 1)
    assert eval (vn_var_result == "已确认")
    assert eval (vn_var_late == 0 and vn_var_primary == 0 and vn_var_page_work == 0)
    assert eval (not vn_bp_task_alive(old_task))
    click id "vn_component_open_button"
    pause until eval (vn_var_opens == 2)
    assert eval (old_task["pageToken"] != vn_ui_page_token("waiting_page"))
    assert eval (not vn_bp_task_alive(old_task))
    pause 0.4
    assert eval (vn_var_page_work == 0)
    pause until eval (vn_var_page_work == 1)
    assert eval (vn_var_after == 1)
    click id "vn_component_nested_button"
    pause until eval ("nested_page" in vn_ui_open_pages)
    $ ticks_before_modal = vn_var_page_ticks
    pause 0.6
    assert eval (vn_var_page_ticks > ticks_before_modal)
    screenshot "nested-pages.png"
    click id "vn_component_nested_close"
    pause until eval (vn_var_after == 2)
    assert eval (vn_var_result == "父页完成")
    assert eval (vn_var_nested == "尚未返回")
    assert eval (vn_var_late == 0 and vn_var_primary == 0 and vn_var_page_work == 1)
    assert eval (not vn_ui_open_pages and not vn_ui_page_sessions and not vn_ui_page_completions)
    run Function(vn_ui_open_page, ${q(selfClosing.id)})
    pause 0.3
    assert eval (not vn_ui_open_pages and not vn_ui_page_sessions)
    assert eval (vn_var_late == 0)
    assert eval (not vn_running_blueprint_events)
    run Start()
    pause until eval (vn_var_phase == "saved_wait" and vn_var_saved_shows == 1)
    run Function(vn_flow_request_skip)
    assert eval (not vn_flow_skip_requested and not vn_flow_active_step["cancelled"])
    pause 0.4
    run FileSave("task_wait", confirm=False, slot=True)
    $ vn_var_saved_shows = 99
    run FileLoad("task_wait", confirm=False, slot=True)
    pause until eval (vn_var_saved_shows == 1)
    assert eval (vn_var_phase == "saved_wait")
    assert eval (vn_ui_page_sessions[${q(savedPage.id)}]["didShow"])
    pause 0.2
    assert eval (vn_var_phase == "saved_wait")
    pause until "等待恢复后进入剧情。"
    assert eval (vn_var_phase == "resumed" and vn_var_saved_shows == 1)
    assert eval (vn_bp_task is None and vn_bp_wait is None and not vn_ui_open_pages)
    screenshot "restored-wait-completed.png"
`);
  const options = { savedir: path.join(output, 'saves'), timeoutMs: 120000 };
  await check('lint', await runRenpy(sdk, game, ['lint'], options));
  const result = await runRenpy(sdk, game, ['test', '--report-detailed', '--report-skipped'], { ...options, onData: text => process.stdout.write(text) });
  await check('native-cancellation', result);
  if (!/Test cases\s*:\s*1\s*\|\s*1 passed/.test(result.log)) throw new Error('Native test did not report a passed testcase');
  report.status = 'passed'; await saveReport(); console.log('PASS: ' + path.join(output, 'report.json'));
} catch (error) { report.status = 'failed'; report.error = String(error); await saveReport(); console.error(error); process.exitCode = 1; }
finally {
  try {
    for (const [from, to] of [[path.join(source, 'project.vns.json'), path.join(output, 'fixture.project.json')], [path.join(game, 'game/testcases.rpy'), path.join(output, 'testcases.rpy')]]) {
      if (await fs.stat(from).then(stat => stat.isFile()).catch(() => false)) await fs.copyFile(from, to);
    }
    for (const directory of [path.join(game, 'tests/screenshots'), path.join(game, 'game/tests/screenshots')]) {
      if (await fs.stat(directory).then(stat => stat.isDirectory()).catch(() => false)) await fs.cp(directory, path.join(output, 'screenshots'), { recursive: true });
    }
  } catch (error) { report.status = 'failed'; report.error = [report.error, 'Evidence preservation failed: ' + String(error)].filter(Boolean).join('\n'); process.exitCode = 1; }
  try {
    report.cleanup = await cleanVerificationDirectories(output, ['source', 'game', 'saves']);
    if ((report.cleanup as { errors: unknown[] }).errors.length) throw new Error('Verification cleanup failed.');
  } catch (error) { report.status = 'failed'; report.error = [report.error, String(error)].filter(Boolean).join('\n'); process.exitCode = 1; }
  await saveReport();
}
