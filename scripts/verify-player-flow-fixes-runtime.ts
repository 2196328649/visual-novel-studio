import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject, projectSchema, type Project, type StoryNode, type UiComponent } from '../src/core/model';
import { playerFlowRuntimeData } from '../src/runtime/screens';
import { buildProject, runRenpy } from '../src/runtime/service';
import { pythonBlockLiteral, pythonLiteral as py } from '../src/runtime/literals';
import { isolateRenpySaves } from './lib/renpy-saves';
import { finishFlowNativeVerification, flowRuntimeOutput, flowRuntimeTraceSource, recordFlowNativeResult } from './lib/flow-runtime-verification';

// This suite never reads an author project or historical verification output.
const artifactRoot = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? 'artifacts/player-flow-fixes-2026-11-13');
const output = path.join(artifactRoot, path.basename(flowRuntimeOutput('player-flow-fixes')));
const sdk = path.resolve('resources/runtime');
const scriptTitle = '章节 [qa_missing_name] {b} [[保留]] {{花括号}}';
const customTitle = '本图 [qa_other_name] {color=red} [[原样]] {{文本}}';
const plainTitle = '普通中文章节';
const captionLiteral = (text: string) => text.replaceAll('{', '{{');
const prompt = (title: string) => `从「${title}」重新开始？当前未保存的进度将丢失。`;

function fixture(authoredConfirm: boolean) {
  const project = createProject('玩家剧情图修复原生验收');
  project.width = 1280; project.height = 800;
  project.chapters = [
    { id: 'chapter_boot', name: '开场', flowchart: { visible: false } },
    { id: 'chapter_target', name: scriptTitle },
    { id: 'chapter_edges', name: '连线来源', flowchart: { visible: false } },
  ];
  project.scenes = project.chapters.map(chapter => ({ id: 'scene_' + chapter.id, chapterId: chapter.id, name: '小章节' }));
  project.entryId = 'boot';
  const passage = (id: string, text: string, sceneId = 'scene_chapter_edges'): StoryNode => ({
    id, name: id, kind: 'passage', sceneId, x: 0, y: 0, next: 'end', lines: [{ id: 'line_' + id, text, actions: [] }],
  });
  const sources: StoryNode[] = Array.from({ length: 9 }, (_, index) => ({
    id: `source_${index}`, name: `来源 ${index + 1}`, kind: 'choice', sceneId: 'scene_chapter_edges', x: 0, y: 0, prompt: '路线',
    choices: [{ id: `source_${index}_joint`, text: '组到节点', target: 'joint' }, { id: `source_${index}_member`, text: '组到组', target: `target_${index}` }],
  }));
  project.nodes = [passage('boot', '开场等待验收。', 'scene_chapter_boot'), passage('replay_target', '重玩已进入目标。', 'scene_chapter_target'),
    ...sources, ...Array.from({ length: 9 }, (_, index) => passage(`target_${index}`, '目标成员')),
    passage('joint', '共同目标'), passage('source_unrelated', '无关来源'), passage('target_unrelated', '无关目标'),
    { id: 'end', name: '结束', kind: 'end', sceneId: 'scene_chapter_edges', x: 0, y: 0 }];
  if (authoredConfirm) {
    project.ui.pages = { messageBox: { layout: 'custom', background: '#1b2c3b', backgroundOpacity: .95 } };
    project.ui.components = [
      { id: 'qa_prompt', kind: 'text', page: 'messageBox', text: '', binding: 'confirmation', x: .12, y: .22, width: .76, height: .33, style: { fontSize: 30, textColor: '#ffffff' } },
      { id: 'qa_yes', kind: 'button', page: 'messageBox', text: '确认', action: 'confirmYes', x: .24, y: .62, width: .2, height: .08 },
      { id: 'qa_no', kind: 'button', page: 'messageBox', text: '取消', action: 'confirmNo', x: .56, y: .62, width: .2, height: .08 },
    ];
  }
  return projectSchema.parse(JSON.parse(JSON.stringify(project)));
}

function maps(project: Project) {
  const script: UiComponent = { id: 'script_map', kind: 'flowchart', page: 'flowchart', text: '', x: 0, y: 0, width: .9, height: .65,
    style: { fontSize: 26, textColor: '#ffffff' }, list: { layout: 'flow', itemWidth: 920, itemHeight: 100, flowPositions: { replay_target: { x: 30, y: 30 } },
      flowViewport: { x: 0, y: 0, width: 1, height: 1 }, flowShowVerticalScrollbar: false, flowShowControls: false, confirmJump: true } };
  const custom: UiComponent = {
    ...script, id: 'custom_map',
    list: {
      ...script.list,
      flowContent: {
        mode: 'custom',
        custom: { entries: [{ nodeId: 'replay_target', name: customTitle }], positions: { replay_target: { x: 30, y: 30 } } },
      },
    },
  };
  const plain: UiComponent = {
    ...custom, id: 'plain_map',
    list: {
      ...custom.list,
      flowContent: { mode: 'custom', custom: { entries: [{ nodeId: 'replay_target', name: plainTitle }] } },
    },
  };
  const sources = [...Array.from({ length: 9 }, (_, index) => `source_${index}`), 'source_unrelated'];
  const targets = [...Array.from({ length: 9 }, (_, index) => `target_${index}`), 'target_unrelated'];
  const edges: UiComponent = { ...script, id: 'edge_map', list: { ...script.list, itemWidth: 280, itemHeight: 90,
    lockUnread: true, flowLockedNode: 'hide', flowLockedLine: 'dim',
    flowContent: { mode: 'custom', custom: { entries: [...sources, 'joint', ...targets].map(nodeId => ({ nodeId })), positions: { joint: { x: 540, y: 30 } },
      groups: [{ id: 'sources', name: '十名来源成员', nodeIds: sources, position: { x: 30, y: 30 } }, { id: 'targets', name: '十名目标成员', nodeIds: targets, position: { x: 540, y: 230 } }] } } } };
  const options = (component: UiComponent) => ({ ...component.list, ...playerFlowRuntimeData(project, component) });
  return { script: options(script), custom: options(custom), plain: options(plain), edges: options(edges) };
}

function nativeTests(project: Project, destination: string, authoredConfirm: boolean) {
  const no = authoredConfirm ? 'vn_component_qa_no' : 'vn_confirm_no';
  const yes = authoredConfirm ? 'vn_component_qa_yes' : 'vn_confirm_yes';
  const scenarios = [
    ...(['script', 'custom'] as const).flatMap(mode => ['flow', 'grid'].map(presentation => ({
      id: `${mode}_${presentation}`, title: mode === 'script' ? scriptTitle : customTitle,
      open: `run Show("qa_map", content=${py(mode)}, presentation=${py(presentation)})`, screen: 'qa_map',
      activate: 'click id "qa_replay_replay_target"', close: 'run Hide("qa_map")',
    }))),
    { id: 'plain', title: plainTitle, open: 'run Show("qa_map", content="plain", presentation="grid")', screen: 'qa_map', activate: 'click id "qa_replay_replay_target"', close: 'run Hide("qa_map")' },
    { id: 'chapter_collection', title: scriptTitle, open: 'run Show("qa_chapters")', screen: 'qa_chapters', activate: 'click id "qa_chapters_chapter_target"', close: 'run Hide("qa_chapters")' },
    // The test runner's `run` discards Return()'s result; a real button click
    // propagates it to ui.interact() and closes the menu like player input.
    { id: 'native_flow', title: scriptTitle, open: 'run VnUiMenu("flowchart")', screen: 'flowchart', activate: 'run qa_native_action("flowchart", "replay_target")', close: 'click id "vn_game_menu_return"' },
    { id: 'native_chapter', title: scriptTitle, open: 'run VnUiMenu("chapter_select")', screen: 'chapter_select', activate: 'run qa_native_action("chapter_select", "chapter_target")', close: 'click id "vn_game_menu_return"' },
  ];
  return `
init -999 python:
    import renpy as _engine
    _engine.safe_mode_checked = True
${flowRuntimeTraceSource(destination)}
init python:
    qa_maps = ${pythonBlockLiteral(maps(project), 1)}
    def qa_texts(screen_name):
        texts = []
        renpy.get_screen(screen_name).visit_all(lambda displayable: texts.append(displayable.get_all_text()) if isinstance(displayable, renpy.text.text.Text) else None)
        return texts
    def qa_native_action(screen_name, identity):
        actions = []
        def collect(displayable):
            action = getattr(displayable, "action", None)
            if isinstance(action, VnStoryStart) and action.identity == identity:
                actions.append(action)
        renpy.get_screen(screen_name).visit_all(collect)
        return actions[0] if actions else None
    def qa_edge(target):
        return next(edge for edge in qa_maps["edges"]["flowGraph"]["edges"] if edge["from"] == "sources" and edge["to"] == target)

screen qa_map(content="script", presentation="flow", confirm=True):
    modal True
    zorder 100
    add Solid("#131a21")
    fixed:
        pos (70, 70)
        xysize (1120, 540)
        use vn_collection("flowchart", 1120, 540, 26, "#ffffff", "#283133", {}, dict(qa_maps[content], layout=presentation, rows=1, confirmJump=confirm), "qa_replay", style.default.font)

screen qa_chapters():
    modal True
    zorder 100
    add Solid("#131a21")
    fixed:
        pos (70, 70)
        xysize (1120, 540)
        use vn_collection("chapterList", 1120, 540, 26, "#ffffff", "#283133", {}, {"rows": 3, "itemHeight": 100}, "qa_chapters", style.default.font)

screen qa_edges():
    modal True
    zorder 100
    add Solid("#131a21")
    fixed:
        pos (70, 70)
        xysize (1120, 540)
        use vn_collection("flowchart", 1120, 540, 26, "#ffffff", "#283133", {}, qa_maps["edges"], "qa_edges", style.default.font)

testsuite global:
    before testcase:
        $ _test.timeout = 25.0
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.transitions = 0
        $ preferences.text_cps = 0
        if not screen "main_menu":
            run MainMenu(confirm=False)
        $ persistent.vn_seen_nodes = []
        $ persistent.vn_seen_chapters = []
    teardown:
        exit

testcase literal_replay_confirmations:
    run Start()
    pause until "开场等待验收。"
${scenarios.map(scenario => `    ${scenario.open}
    pause until screen ${py(scenario.screen)}
    pause .2
    assert eval ${py(captionLiteral(scenario.title))} in qa_texts(${py(scenario.screen)})
${scenario.id.startsWith('native_') ? `    assert eval qa_native_action(${py(scenario.screen)}, ${py(scenario.id === 'native_flow' ? 'replay_target' : 'chapter_target')}).caption == ${py(scenario.title)}
` : ''}    ${scenario.activate}
    pause until screen "confirm"
    pause .2
    assert eval renpy.get_screen("confirm").scope["message"] == ${py(captionLiteral(prompt(scenario.title)).replaceAll('[', '[['))}
    assert eval ${py(captionLiteral(prompt(scenario.title)))} in qa_texts("confirm")
    assert eval vn_current_node == "boot"
    screenshot ${py('title-' + scenario.id + '.png')}
    click id ${py(no)}
    assert eval not renpy.get_screen("confirm") and vn_current_node == "boot"
    ${scenario.close}
    pause until "开场等待验收。"`).join('\n')}
    run Show("qa_map", content="custom", presentation="grid")
    click id "qa_replay_replay_target"
    pause until screen "confirm"
    click id ${py(yes)}
    pause until "重玩已进入目标。"
    assert eval vn_current_node == "replay_target" and not main_menu
    run Function(qa_trace, "literal-confirmations", current=vn_current_node)

${(['script', 'custom'] as const).flatMap(mode => [false, true].map(fromMain => `testcase ${mode}_${fromMain ? 'main_menu_start' : 'confirmation_disabled'}:
${fromMain ? '    pause until screen "main_menu"' : '    run Start()\n    pause until "开场等待验收。"'}
    run Show("qa_map", content=${py(mode)}, presentation="grid", confirm=${py(fromMain)})
    pause .2
    click id "qa_replay_replay_target"
    pause until "重玩已进入目标。"
    assert eval vn_current_node == "replay_target" and not main_menu
    assert eval not renpy.get_screen("confirm")
    screenshot ${py(`${mode}-${fromMain ? 'main-start' : 'no-confirm'}.png`)}
`)).join('\n')}
testcase complete_group_endpoints:
    run SetField(persistent, "vn_seen_nodes", ["source_8", "joint", "target_8"])
    run Show("qa_edges")
    pause .3
    assert eval len(qa_edge("joint")["endpoints"]) == 9 and len(qa_edge("joint")["paths"]) == 8
    assert eval len(qa_edge("targets")["endpoints"]) == 9 and len(qa_edge("targets")["paths"]) == 8
    assert eval all(path["nodeIds"][0] != "source_8" for path in qa_edge("joint")["paths"])
    assert eval vn_flow_edge_alpha(qa_edge("joint"), qa_maps["edges"]) == 1.0
    assert eval vn_flow_edge_alpha(qa_edge("targets"), qa_maps["edges"]) == 1.0
    screenshot "edges-ninth-route-reached.png"
    run SetField(persistent, "vn_seen_nodes", ["source_unrelated", "joint", "target_unrelated"])
    assert eval not vn_flow_locked("sources", qa_maps["edges"]) and not vn_flow_locked("targets", qa_maps["edges"])
    assert eval vn_flow_edge_alpha(qa_edge("joint"), qa_maps["edges"]) == 0.0
    assert eval vn_flow_edge_alpha(qa_edge("targets"), qa_maps["edges"]) == 0.0
    assert eval vn_flow_edge_alpha(qa_edge("joint"), dict(qa_maps["edges"], flowLockedNode="show")) == 0.35
    assert eval vn_flow_edge_alpha(qa_edge("targets"), dict(qa_maps["edges"], flowLockedNode="show")) == 0.35
    assert eval vn_flow_edge_alpha(qa_edge("targets"), dict(qa_maps["edges"], lockUnread=False)) == 1.0
    screenshot "edges-only-unrelated-members.png"
    run SetField(persistent, "vn_seen_nodes", ["source_8", "joint", "target_7"])
    assert eval vn_flow_edge_alpha(qa_edge("joint"), qa_maps["edges"]) == 1.0
    assert eval vn_flow_edge_alpha(qa_edge("targets"), qa_maps["edges"]) == 0.0
    assert eval vn_flow_edge_alpha(qa_edge("targets"), dict(qa_maps["edges"], flowLockedNode="show")) == 0.35
    assert eval vn_flow_edge_alpha(dict(qa_edge("joint"), endpoints=[]), qa_maps["edges"]) == 0.0
    assert eval vn_flow_edge_alpha(dict(qa_edge("joint"), endpoints=[]), dict(qa_maps["edges"], lockUnread=False)) == 0.0
    assert eval vn_flow_edge_alpha(dict(qa_edge("joint"), **{"from": "unvisited_display"}), qa_maps["edges"]) == 0.0
    $ legacy_edge = {key: value for key, value in qa_edge("joint").items() if key != "endpoints"}
    assert eval vn_flow_edge_alpha(legacy_edge, qa_maps["edges"]) == 0.0
    run SetField(persistent, "vn_seen_nodes", ["source_0", "joint"])
    assert eval vn_flow_edge_alpha(legacy_edge, qa_maps["edges"]) == 1.0
    assert eval vn_flow_edge_alpha(dict(legacy_edge, paths=[]), qa_maps["edges"]) == 0.0
    assert eval vn_flow_edge_alpha(dict(legacy_edge, **{"from": "source_0", "paths": []}), qa_maps["edges"]) == 1.0
    run Function(qa_trace, "complete-endpoints", node_edge=qa_edge("joint"), group_edge=qa_edge("targets"))
    run Hide("qa_edges")
`;
}

const report: Record<string, unknown> = { status: 'running', output, runs: [] };
let failure: unknown;
await fs.mkdir(output, { recursive: true });
for (const authoredConfirm of [false, true]) {
  const destination = path.join(output, authoredConfirm ? 'authored-confirm' : 'native-confirm');
  const game = path.join(destination, 'game'), source = path.join(destination, 'source');
  const previousSaves = process.env.RENPY_PATH_TO_SAVES;
  const runReport: Record<string, unknown> = { status: 'running', output: destination, authoredConfirm, profile: 'Native Ren\'Py only; saves and persistent state use private run directories.' };
  let phase = 'fixture';
  try {
    await fs.mkdir(source, { recursive: true });
    await isolateRenpySaves(destination);
    const project = fixture(authoredConfirm), tests = nativeTests(project, destination, authoredConfirm);
    await fs.writeFile(path.join(destination, 'fixture.vns.json'), JSON.stringify(project, null, 2));
    await fs.writeFile(path.join(source, 'project.vns.json'), JSON.stringify(project, null, 2));
    await fs.writeFile(path.join(destination, 'testcases.rpy'), tests);
    phase = 'build';
    const built = await buildProject({ project, projectDir: source, outputDir: game, sdkRoot: sdk });
    await fs.writeFile(path.join(destination, 'build.json'), JSON.stringify(built, null, 2));
    assert.equal(built.ok, true, JSON.stringify(built));
    await fs.writeFile(path.join(game, 'game/testcases.rpy'), tests);
    phase = 'native interactions';
    const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(destination, 'saves'), timeoutMs: 300000,
      env: { RENPY_RENDERER: 'gl2', PYTHONUNBUFFERED: '1' }, onData: text => process.stdout.write(text) });
    await fs.writeFile(path.join(destination, 'run.log'), result.log);
    recordFlowNativeResult(runReport, tests, result, tests.split('\n').filter(line => line.startsWith('testcase ')).length);
    runReport.status = 'passed';
  } catch (error) {
    failure ??= error; runReport.status = 'failed'; runReport.phase = phase; runReport.error = error instanceof Error ? error.stack : String(error);
  } finally {
    const finishFailure = await finishFlowNativeVerification(destination, game, runReport, previousSaves, { cleanup: false });
    failure ??= finishFailure;
    (report.runs as unknown[]).push(runReport);
    report.status = failure ? 'failed' : 'running';
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  }
}
report.status = failure ? 'failed' : 'passed';
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
console.log(path.join(output, 'report.json'));
if (failure) throw failure;
