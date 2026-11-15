import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject, projectSchema, type UiComponent } from '../src/core/model';
import { playerFlowRuntimeData } from '../src/runtime/screens';
import { buildProject, runRenpy } from '../src/runtime/service';
import { pythonLiteral as py } from '../src/runtime/literals';
import { isolateRenpySaves } from './lib/renpy-saves';
import { finishFlowNativeVerification, flowRuntimeOutput, flowRuntimeTraceSource, recordFlowNativeResult } from './lib/flow-runtime-verification';

const root = path.resolve('.'), output = flowRuntimeOutput('player-flow-modes');
const sdk = path.join(root, 'resources/runtime'), game = path.join(output, 'game');
const previousSaves = process.env.RENPY_PATH_TO_SAVES;
const project = createProject('剧情图双模式原生验收');
project.width = 1280; project.height = 800;
project.chapters = [{ id: 'chapter_one', name: '剧本第一章' }, { id: 'chapter_two', name: '剧本第二章' }, { id: 'chapter_three', name: '剧本结尾' }];
project.scenes = project.chapters.map((chapter, index) => ({ id: `scene_${index}`, chapterId: chapter.id, name: `原始小章节${index + 1}` }));
project.entryId = 'intro';
project.nodes = [
  { id: 'intro', kind: 'passage', sceneId: 'scene_0', name: '开场来源', x: 0, y: 0, next: 'detail', lines: [{ id: 'line_intro', text: '开场存档锚点。', actions: [] }] },
  { id: 'detail', kind: 'passage', sceneId: 'scene_0', name: '隐藏的内部段落', x: 200, y: 0, next: 'route_two', lines: [{ id: 'line_detail', text: '同一组内的内部段落。', actions: [] }] },
  { id: 'route_two', kind: 'passage', sceneId: 'scene_1', name: '第二章来源', x: 400, y: 0, next: 'finale', lines: [{ id: 'line_two', text: '第二章重玩锚点。', actions: [] }] },
  { id: 'finale', kind: 'passage', sceneId: 'scene_2', name: '结尾来源', x: 600, y: 0, next: 'end', lines: [{ id: 'line_finale', text: '结尾锚点。', actions: [] }] },
  { id: 'end', kind: 'end', sceneId: 'scene_2', name: '返回', x: 800, y: 0 },
];
project.ui.pages = { flowchart: { layout: 'custom', background: '#131a21' } };
project.ui.flowStyles = [{ id: 'entry_style', name: '双字体', style: { textColor: '#80d4ca', letterSpacing: 1.5, background: '#050708', captionParts: [{ fontSize: 18 }, { fontSize: 30 }] } }];
const branch: UiComponent = {
  id: 'qa_map', name: '左侧分支图', kind: 'flowchart', page: 'flowchart', text: '', x: .02, y: .1, width: .59, height: .72,
  style: { fontSize: 28, background: '#000000', textColor: '#ffffff', selectedTextColor: '#ffda80' },
  list: { layout: 'flow', itemWidth: 360, itemHeight: 80, lockUnread: true, flowLockedNode: 'hide', flowLockedLine: 'show', showProgress: true, confirmJump: false, flowShowVerticalScrollbar: false,
    flowViewport: { x: 0, y: 0, width: 1, height: 1 }, flowContent: { mode: 'custom', custom: {
      entries: [{ nodeId: 'intro', name: '壹｜开端', styleId: 'entry_style', action: 'inspect' }, { nodeId: 'route_two', name: '贰｜重玩第二章' }, { nodeId: 'finale', name: '三｜只看结尾', action: 'inspect' }],
      positions: { finale: { x: 40, y: 230 } },
      groups: [{ id: 'act_one', name: '第一幕（两段剧情）', nodeIds: ['intro', 'route_two'], position: { x: 40, y: 30 }, positions: { intro: { x: 30, y: 30 }, route_two: { x: 30, y: 170 } } }],
    } } },
};
const directory: UiComponent = {
  id: 'qa_directory', name: '右侧独立目录', kind: 'flowchart', page: 'flowchart', text: '', x: .65, y: .1, width: .33, height: .72,
  style: { fontSize: 26, background: '#050708', textColor: '#ffffff' },
  list: { layout: 'grid', columns: 1, rows: 3, itemWidth: 360, itemHeight: 80, gapY: 16, lockUnread: true, flowLockedNode: 'hide', showProgress: true, confirmJump: false,
    flowContent: { mode: 'custom', custom: { entries: [{ nodeId: 'intro', name: '目录的独立名字', action: 'inspect' }, { nodeId: 'finale', name: '目录结尾', action: 'inspect' }], groups: [{ id: 'directory_group', name: '目录分组', nodeIds: ['intro', 'finale'] }] } } },
};
project.ui.components = [branch, directory,
  { id: 'qa_close', kind: 'button', page: 'flowchart', text: '返回', action: 'return', x: .85, y: .9, width: .12, height: .065 },
];
const legacy: UiComponent = { ...branch, id: 'legacy', list: { ...branch.list, flowContent: undefined, flowPositions: { intro: { x: 30, y: 30 }, route_two: { x: 30, y: 150 }, finale: { x: 30, y: 270 } } } };
const legacyData = playerFlowRuntimeData(project, legacy);
const legacyOptions = { ...legacy.list, ...legacyData };
// Compile after a real JSON/schema roundtrip, as a reopened author project would be.
const loaded = projectSchema.parse(JSON.parse(JSON.stringify(project)));
const report: Record<string, unknown> = { status: 'running', output };
let failure: unknown, phase = 'fixture';
const tests = `
init -999 python:
    import renpy as _engine
    _engine.safe_mode_checked = True
${flowRuntimeTraceSource(output)}
init python:
    qa_legacy_options = ${py(legacyOptions)}
    def qa_has(screen_name, identity):
        return renpy.get_widget(screen_name, identity) is not None
    def qa_text(screen_name, identity):
        return renpy.get_widget(screen_name, identity).get_all_text()
    def qa_selected(screen_name, identity):
        return renpy.display.behavior.is_selected(renpy.get_widget(screen_name, identity).action)

screen qa_legacy():
    modal True
    zorder 250
    add Solid("#131a21")
    fixed:
        pos (40, 40)
        xysize (750, 650)
        use vn_collection("flowchart", 750, 650, 28, "#ffffff", "#000000", {}, qa_legacy_options, "qa_legacy_map", style.default.font)
    fixed:
        pos (830, 40)
        xysize (400, 650)
        use vn_collection("flowchart", 400, 650, 28, "#ffffff", "#000000", {}, dict(qa_legacy_options, layout="grid", rows=3), "qa_legacy_directory", style.default.font)

testsuite global:
    before testcase:
        $ _test.timeout = 25.0
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.transitions = 0
        if not screen "main_menu":
            run MainMenu(confirm=False)
        $ persistent.vn_seen_nodes = []
        $ persistent.vn_seen_chapters = []
    teardown:
        exit

testcase independent_groups_and_inspect:
    pause until screen "main_menu"
    run VnUiMenu("flowchart")
    pause until screen "flowchart"
    pause .3
    assert eval qa_has("flowchart", "vn_component_qa_map_act_one")
    assert eval qa_has("flowchart", "vn_component_qa_directory_directory_group")
    assert eval not qa_has("flowchart", "vn_component_qa_map_intro")
    assert eval not qa_has("flowchart", "vn_component_qa_map_finale")
    assert eval vn_flow_progress(vn_flow_options_qa_map["flowGraph"]["nodes"]) == (0, 3)
    assert eval vn_flow_caption("act_one", "第一幕", vn_flow_options_qa_map) == "第一幕 · 已读 0/2"
    assert eval all(vn_flow_edge_alpha(edge, vn_flow_options_qa_map) == 0 for edge in vn_flow_options_qa_map["flowGraph"]["edges"])
    assert eval not VnFlowEntry("route_two", vn_flow_options_qa_map).get_sensitive()
    screenshot "01-independent-root.png"
    click id "vn_component_qa_map_act_one"
    pause .2
    assert eval qa_has("flowchart", "vn_component_qa_map_intro")
    assert eval not qa_has("flowchart", "vn_component_qa_map_route_two")
    assert eval qa_has("flowchart", "vn_component_qa_directory_directory_group")
    assert eval persistent.vn_seen_nodes == []
    assert eval "{size=18}" in qa_text("flowchart", "vn_component_qa_map_intro_label")
    assert eval "{size=30}" in qa_text("flowchart", "vn_component_qa_map_intro_label")
    assert eval "{k=1.5}" in qa_text("flowchart", "vn_component_qa_map_intro_label")
    click id "vn_component_qa_map_intro"
    pause until screen "vn_story_inspect"
    assert eval persistent.vn_seen_nodes == [] and main_menu
    assert eval renpy.get_screen("vn_story_inspect").scope["node_id"] == "intro"
    assert eval renpy.get_screen("vn_story_inspect").scope["caption"] == "壹 开端"
    screenshot "02-inspect-without-progress.png"
    click id "vn_story_inspect_close"
    click id "vn_component_qa_directory_directory_group"
    pause .2
    assert eval qa_has("flowchart", "vn_component_qa_map_intro") and qa_has("flowchart", "vn_component_qa_directory_intro")
    assert eval "目录的独立名字" in qa_text("flowchart", "vn_component_qa_directory_intro_label")
    assert eval not qa_has("flowchart", "vn_component_qa_directory_route_two")
    assert eval not qa_has("flowchart", "vn_component_qa_directory_finale")
    click id "vn_component_qa_map_group_back"
    pause .2
    assert eval qa_has("flowchart", "vn_component_qa_map_act_one") and qa_has("flowchart", "vn_component_qa_directory_intro")
    click id "vn_component_qa_directory_group_back"
    # Testcase Python assignments do not refresh an already open screen.
    run SetField(persistent, "vn_seen_nodes", ["intro", "route_two", "finale"])
    pause .2
    assert eval qa_has("flowchart", "vn_component_qa_map_finale")
    assert eval vn_flow_progress(vn_flow_options_qa_map["flowGraph"]["nodes"]) == (3, 3)
    assert eval vn_flow_caption("act_one", "第一幕", vn_flow_options_qa_map) == "第一幕 · 已读 2/2"
    click id "vn_component_qa_map_act_one"
    click id "vn_component_qa_directory_directory_group"
    pause .2
    assert eval qa_has("flowchart", "vn_component_qa_map_route_two") and qa_has("flowchart", "vn_component_qa_directory_finale")
    screenshot "03-independent-group-interiors.png"
    run Function(qa_trace, "independent-groups", visited=list(persistent.vn_seen_nodes), branch=[entry[0] for entry in vn_flow_options_qa_map["flowEntries"]], directory=[entry[0] for entry in vn_flow_options_qa_directory["flowEntries"]])
    click id "vn_component_qa_close"

testcase script_compatibility_and_hidden_edges:
    pause until screen "main_menu"
    run Show("qa_legacy")
    pause .3
    assert eval qa_has("qa_legacy", "qa_legacy_map_intro") and qa_has("qa_legacy", "qa_legacy_directory_intro")
    assert eval "剧本第一章" in qa_text("qa_legacy", "qa_legacy_map_intro_label")
    assert eval "剧本第一章" in qa_text("qa_legacy", "qa_legacy_directory_intro_label")
    assert eval not qa_has("qa_legacy", "qa_legacy_map_route_two") and not qa_has("qa_legacy", "qa_legacy_directory_route_two")
    assert eval len(qa_legacy_options["flowGraph"]["edges"]) == 2
    assert eval all(vn_flow_edge_alpha(edge, qa_legacy_options) == 0 for edge in qa_legacy_options["flowGraph"]["edges"])
    assert eval not vn_flow_locked("intro", qa_legacy_options) and vn_flow_locked("route_two", qa_legacy_options)
    screenshot "04-script-legacy-visibility.png"
    run SetField(persistent, "vn_seen_nodes", ["intro", "route_two", "finale"])
    pause .2
    assert eval qa_has("qa_legacy", "qa_legacy_map_finale") and qa_has("qa_legacy", "qa_legacy_directory_finale")
    assert eval all(vn_flow_edge_alpha(edge, qa_legacy_options) == 1 for edge in qa_legacy_options["flowGraph"]["edges"])
    run Function(qa_trace, "legacy-script", entries=qa_legacy_options["flowEntries"], visited=list(persistent.vn_seen_nodes))
    run Hide("qa_legacy")

testcase progress_save_load_and_replay:
    pause until screen "main_menu"
    run Start()
    pause until "开场存档锚点。"
    assert eval vn_current_node == "intro"
    run FileSave("qa_flow_checkpoint", confirm=False, slot=True)
    assert eval renpy.can_load("qa_flow_checkpoint")
    advance until "同一组内的内部段落。"
    assert eval vn_current_node == "detail"
    run VnUiMenu("flowchart")
    pause until screen "flowchart"
    pause .2
    assert eval qa_selected("flowchart", "vn_component_qa_map_act_one")
    assert eval qa_selected("flowchart", "vn_component_qa_directory_directory_group")
    assert eval vn_flow_caption("act_one", "第一幕", vn_flow_options_qa_map) == "第一幕 · 已读 1/2"
    assert eval vn_flow_caption("act_one", "第一幕", vn_flow_options_qa_map, vn_flow_options_qa_map["flowGraph"]["locations"]) == "第一幕 · 当前"
    click id "vn_component_qa_map_act_one"
    pause .2
    assert eval qa_selected("flowchart", "vn_component_qa_map_intro")
    click id "vn_component_qa_map_intro"
    pause until screen "vn_story_inspect"
    assert eval vn_current_node == "detail" and not main_menu
    assert eval "act_one" not in persistent.vn_seen_nodes and "directory_group" not in persistent.vn_seen_nodes
    click id "vn_story_inspect_close"
    click id "vn_component_qa_close"
    pause until "同一组内的内部段落。"
    run FileLoad("qa_flow_checkpoint", confirm=False, slot=True)
    pause until "开场存档锚点。"
    assert eval vn_current_node == "intro"
    run VnUiMenu("flowchart")
    pause until screen "flowchart"
    pause .2
    assert eval qa_has("flowchart", "vn_component_qa_map_act_one") and qa_has("flowchart", "vn_component_qa_directory_directory_group")
    assert eval "目录的独立名字" == vn_flow_options_qa_directory["flowLooks"]["intro"]["node"]["name"]
    run SetField(persistent, "vn_seen_nodes", persistent.vn_seen_nodes + ["route_two"])
    click id "vn_component_qa_map_act_one"
    pause .2
    click id "vn_component_qa_map_route_two"
    pause until "第二章重玩锚点。"
    assert eval vn_current_node == "route_two" and not main_menu
    assert eval "act_one" not in persistent.vn_seen_nodes and "directory_group" not in persistent.vn_seen_nodes
    run VnUiMenu("flowchart")
    pause until screen "flowchart"
    pause .2
    assert eval qa_has("flowchart", "vn_component_qa_map_act_one") and qa_has("flowchart", "vn_component_qa_directory_directory_group")
    assert eval qa_selected("flowchart", "vn_component_qa_map_act_one")
    screenshot "05-replay-real-node-and-independent-root.png"
    run Function(qa_trace, "save-load-replay", current=vn_current_node, visited=list(persistent.vn_seen_nodes))
    click id "vn_component_qa_close"
    run MainMenu(confirm=False)
`;

try {
  await fs.mkdir(output, { recursive: true });
  await isolateRenpySaves(output);
  await fs.writeFile(path.join(output, 'fixture.vns.json'), JSON.stringify(loaded, null, 2));
  await fs.writeFile(path.join(output, 'testcases.rpy'), tests);
  phase = 'build';
  const built = await buildProject({ project: loaded, projectDir: path.join(output, 'source'), outputDir: game, sdkRoot: sdk });
  await fs.writeFile(path.join(output, 'build.json'), JSON.stringify(built, null, 2));
  assert.equal(built.ok, true, JSON.stringify(built));
  await fs.writeFile(path.join(game, 'game/testcases.rpy'), tests);
  phase = 'native interactions';
  const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 240000, env: { RENPY_RENDERER: 'gl2', PYTHONUNBUFFERED: '1' }, onData: text => process.stdout.write(text) });
  await fs.writeFile(path.join(output, 'run.log'), result.log);
  recordFlowNativeResult(report, tests, result, 3);
  report.status = 'passed';
} catch (error) { failure = error; report.status = 'failed'; report.phase = phase; report.error = error instanceof Error ? error.stack : String(error); }
finally {
  const finishFailure = await finishFlowNativeVerification(output, game, report, previousSaves);
  failure ??= finishFailure;
}
if (failure) throw failure;
