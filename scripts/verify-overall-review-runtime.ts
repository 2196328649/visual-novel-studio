import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { createProject, projectSchema, type UiComponent } from '../src/core/model';
import { buildProject, runRenpy } from '../src/runtime/service';
import { isolateRenpySaves } from './lib/renpy-saves';
import { finishFlowNativeVerification, flowRuntimeTraceSource, recordFlowNativeResult } from './lib/flow-runtime-verification';

// Pending unified native acceptance. The parent runs this after implementation
// and the shared build; this script never reads an author's existing project.
const root = path.resolve('.');
const permittedRoot = path.join(root, 'artifacts/overall-review-2026-11-13');
const requestedRoot = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? path.join(permittedRoot, 'runtime'));
function inside(parent: string, candidate: string, allowEqual = false) {
  const relative = path.relative(parent, candidate);
  return (allowEqual || relative !== '') && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}
assert.ok(inside(permittedRoot, requestedRoot, true), '原生验收输出必须位于本轮 overall-review-2026-11-13 目录内。');
const output = path.join(requestedRoot, `overall-review-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`);
const sdk = path.join(root, 'resources/runtime'), game = path.join(output, 'game');
const previousSaves = process.env.RENPY_PATH_TO_SAVES;

/** Check each exact parent before creating children; never follow a junction
 * into another task's evidence or a user's directory. No artifact enumeration. */
async function prepareOutput() {
  const workspace = await fs.realpath(root);
  let current = root;
  for (const part of path.relative(root, output).split(path.sep)) {
    current = path.join(current, part);
    const stat = await fs.lstat(current).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    });
    if (current === output) assert.equal(stat, undefined, '每次原生验收必须使用新目录。');
    if (stat) assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), '拒绝非目录或链接输出路径：' + current);
    else await fs.mkdir(current);
    assert.ok(inside(workspace, await fs.realpath(current)), '输出路径离开工作区：' + current);
  }
}

function fixture() {
  const project = createProject('整体检查：剧情目录当前位置');
  project.id = 'overall_review_flow_current';
  project.width = 1280; project.height = 800;
  project.playerDefaults = { textSpeed: 0, masterVolume: 0 };
  project.chapters = [
    { id: 'chapter_one', name: '第一章：初遇' },
    { id: 'chapter_two', name: '第二章：同行' },
    { id: 'chapter_epilogue', name: '尾声' },
  ];
  project.scenes = project.chapters.map((chapter, index) => ({ id: `scene_${index}`, chapterId: chapter.id, name: chapter.name }));
  project.entryId = 'entry_one';
  project.nodes = [
    { id: 'entry_one', kind: 'start', sceneId: 'scene_0', name: '第一章入口', x: 0, y: 0, next: 'body_one' },
    { id: 'body_one', kind: 'passage', sceneId: 'scene_0', name: '第一章未列出的正文', x: 200, y: 0, next: 'entry_two', lines: [
      { id: 'line_one', text: '第一章正文：这里不在目录中单列。', actions: [] },
      { id: 'line_one_continue', text: '第一章继续：仍属于初遇。', actions: [] },
    ] },
    { id: 'entry_two', kind: 'start', sceneId: 'scene_1', name: '第二章入口', x: 400, y: 0, next: 'body_two' },
    { id: 'body_two', kind: 'passage', sceneId: 'scene_1', name: '第二章未列出的正文', x: 600, y: 0, next: 'entry_epilogue', lines: [
      { id: 'line_two', text: '第二章正文：当前章节应已转移。', actions: [] },
    ] },
    { id: 'entry_epilogue', kind: 'start', sceneId: 'scene_2', name: '尾声入口', x: 800, y: 0, next: 'body_epilogue' },
    { id: 'body_epilogue', kind: 'passage', sceneId: 'scene_2', name: '分组外的正文', x: 1000, y: 0, next: 'end', lines: [
      { id: 'line_epilogue', text: '尾声正文：已离开分组。', actions: [] },
    ] },
    { id: 'end', kind: 'end', sceneId: 'scene_2', name: '返回标题', x: 1200, y: 0 },
  ];
  const appearance: UiComponent['style'] = { fontSize: 28, textColor: '#ffffff', selectedTextColor: '#ffda80', background: '#080b0e' };
  const directory: UiComponent = {
    id: 'qa_script', name: '跟随剧本目录', kind: 'flowchart', page: 'flowchart', text: '', x: .035, y: .18, width: .44, height: .65,
    style: { ...appearance },
    list: { layout: 'grid', columns: 1, rows: 3, itemWidth: 560, itemHeight: 84, gapY: 18, lockUnread: false, showProgress: true, confirmJump: false,
      flowContent: { mode: 'script' } },
  };
  const grouped: UiComponent = {
    id: 'qa_custom', name: '自定义分组目录', kind: 'flowchart', page: 'flowchart', text: '', x: .525, y: .18, width: .44, height: .65,
    style: { ...appearance },
    list: { layout: 'grid', columns: 1, rows: 3, itemWidth: 560, itemHeight: 84, gapY: 18, lockUnread: false, showProgress: true, confirmJump: false,
      flowContent: { mode: 'custom', custom: {
        entries: [
          { nodeId: 'entry_one', name: '初遇', action: 'inspect' },
          { nodeId: 'entry_two', name: '同行', action: 'inspect' },
          { nodeId: 'entry_epilogue', name: '尾声', action: 'inspect' },
        ],
        groups: [{ id: 'first_act', name: '第一幕', nodeIds: ['entry_one', 'entry_two'] }],
      } } },
  };
  project.ui.pages = { flowchart: { layout: 'custom', background: '#131a21' } };
  project.ui.components = [
    { id: 'qa_script_heading', kind: 'text', page: 'flowchart', text: '目录 · 跟随剧本', x: .035, y: .055, width: .44, height: .07, style: { fontSize: 32, textColor: '#ffffff' } },
    { id: 'qa_custom_heading', kind: 'text', page: 'flowchart', text: '目录 · 自定义分组', x: .525, y: .055, width: .44, height: .07, style: { fontSize: 32, textColor: '#ffffff' } },
    directory, grouped,
    { id: 'qa_hint', kind: 'text', page: 'flowchart', text: '实际剧情在未列出的正文中；金色文字和“当前”应跟随所属章节。', x: .035, y: .84, width: .75, height: .07, style: { fontSize: 22, textColor: '#b8c5cf' } },
    { id: 'qa_close', kind: 'button', page: 'flowchart', text: '返回剧情', action: 'return', x: .82, y: .89, width: .145, height: .07 },
  ];
  // Compile the actual reopened schema, including grid/script from the outset.
  // In particular, do not create graph options and later relabel them as grid.
  return projectSchema.parse(JSON.parse(JSON.stringify(project)));
}

const tests = `
init -999 python:
    import renpy as _engine
    _engine.safe_mode_checked = True
${flowRuntimeTraceSource(output)}
init python:
    def qa_has(identity):
        return renpy.get_widget("flowchart", identity) is not None
    def qa_text(identity):
        return renpy.get_widget("flowchart", identity + "_label").get_all_text()
    def qa_selected(identity):
        return bool(renpy.display.behavior.is_selected(renpy.get_widget("flowchart", identity).action))
    def qa_trace_view(name):
        buttons = {}
        for component in ("qa_script", "qa_custom"):
            for entry in ("first_act", "entry_one", "entry_two", "entry_epilogue", "body_one", "body_two", "body_epilogue"):
                identity = "vn_component_" + component + "_" + entry
                if qa_has(identity):
                    buttons[identity] = dict(selected=qa_selected(identity), text=qa_text(identity))
        qa_trace(name, current=vn_current_node, line=vn_current_line, seen=list(persistent.vn_seen_nodes), buttons=buttons)

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

testcase script_directory_real_progress_and_save_load:
    pause until screen "main_menu"
    run Start()
    pause until "第一章正文：这里不在目录中单列。"
    assert eval vn_current_node == "body_one" and vn_current_line == "line_one"
    run FileSave("overall_flow_checkpoint", confirm=False, slot=True)
    assert eval renpy.can_load("overall_flow_checkpoint")
    run VnUiMenu("flowchart")
    pause until screen "flowchart"
    pause .2
    assert eval vn_flow_options_qa_script["layout"] == "grid"
    assert eval "flowGraph" not in vn_flow_options_qa_script
    assert eval vn_flow_options_qa_script["flowLocations"]["body_one"] == "entry_one"
    assert eval [entry[0] for entry in vn_flow_options_qa_script["flowEntries"]] == ["entry_one", "entry_two", "entry_epilogue"]
    assert eval not qa_has("vn_component_qa_script_body_one")
    assert eval qa_selected("vn_component_qa_script_entry_one")
    assert eval not qa_selected("vn_component_qa_script_entry_two") and not qa_selected("vn_component_qa_script_entry_epilogue")
    assert eval "第一章：初遇 · 当前" in qa_text("vn_component_qa_script_entry_one")
    assert eval "当前" not in qa_text("vn_component_qa_script_entry_two")
    screenshot "01-script-current-first-chapter.png"
    run Function(qa_trace_view, "script-first-chapter")
    click id "vn_component_qa_close"
    pause until "第一章正文：这里不在目录中单列。"
    advance until "第二章正文：当前章节应已转移。"
    assert eval vn_current_node == "body_two" and vn_current_line == "line_two"
    run VnUiMenu("flowchart")
    pause until screen "flowchart"
    pause .2
    assert eval qa_selected("vn_component_qa_script_entry_two")
    assert eval not qa_selected("vn_component_qa_script_entry_one") and not qa_selected("vn_component_qa_script_entry_epilogue")
    assert eval "第二章：同行 · 当前" in qa_text("vn_component_qa_script_entry_two")
    assert eval "当前" not in qa_text("vn_component_qa_script_entry_one")
    screenshot "02-script-current-second-chapter.png"
    run Function(qa_trace_view, "script-second-chapter")
    click id "vn_component_qa_close"
    pause until "第二章正文：当前章节应已转移。"
    run FileLoad("overall_flow_checkpoint", confirm=False, slot=True)
    pause until "第一章正文：这里不在目录中单列。"
    assert eval vn_current_node == "body_one" and vn_current_line == "line_one"
    run VnUiMenu("flowchart")
    pause until screen "flowchart"
    pause .2
    assert eval qa_selected("vn_component_qa_script_entry_one") and not qa_selected("vn_component_qa_script_entry_two")
    assert eval "第一章：初遇 · 当前" in qa_text("vn_component_qa_script_entry_one")
    assert eval "当前" not in qa_text("vn_component_qa_script_entry_two")
    assert eval "entry_two" in persistent.vn_seen_nodes
    screenshot "03-script-current-restored-after-load.png"
    run Function(qa_trace_view, "script-restored-after-load")
    click id "vn_component_qa_close"
    run MainMenu(confirm=False)

testcase custom_directory_group_scope_follows_real_story:
    pause until screen "main_menu"
    run Start()
    pause until "第一章正文：这里不在目录中单列。"
    assert eval vn_current_node == "body_one"
    run VnUiMenu("flowchart")
    pause until screen "flowchart"
    pause .2
    assert eval "flowLocations" not in vn_flow_options_qa_custom and vn_flow_options_qa_custom["flowGraph"]["locations"]["body_one"] == "first_act"
    assert eval qa_selected("vn_component_qa_custom_first_act") and not qa_selected("vn_component_qa_custom_entry_epilogue")
    assert eval "第一幕 · 当前" in qa_text("vn_component_qa_custom_first_act")
    assert eval not qa_has("vn_component_qa_custom_entry_one") and not qa_has("vn_component_qa_custom_entry_two")
    screenshot "04-custom-root-current-group.png"
    run Function(qa_trace_view, "custom-root-current-group")
    click id "vn_component_qa_custom_first_act"
    pause .2
    assert eval not qa_has("vn_component_qa_custom_first_act") and not qa_has("vn_component_qa_custom_entry_epilogue")
    assert eval qa_selected("vn_component_qa_custom_entry_one") and not qa_selected("vn_component_qa_custom_entry_two")
    assert eval "初遇 · 当前" in qa_text("vn_component_qa_custom_entry_one")
    assert eval "当前" not in qa_text("vn_component_qa_custom_entry_two")
    assert eval qa_selected("vn_component_qa_script_entry_one")
    assert eval vn_current_node == "body_one" and "first_act" not in persistent.vn_seen_nodes
    screenshot "05-custom-group-current-first-member.png"
    run Function(qa_trace_view, "custom-group-first-member")
    click id "vn_component_qa_custom_group_back"
    pause .2
    assert eval qa_selected("vn_component_qa_custom_first_act") and not qa_has("vn_component_qa_custom_entry_one")
    click id "vn_component_qa_close"
    pause until "第一章正文：这里不在目录中单列。"
    advance until "第二章正文：当前章节应已转移。"
    assert eval vn_current_node == "body_two"
    run VnUiMenu("flowchart")
    pause until screen "flowchart"
    pause .2
    assert eval qa_selected("vn_component_qa_custom_first_act")
    click id "vn_component_qa_custom_first_act"
    pause .2
    assert eval qa_selected("vn_component_qa_custom_entry_two") and not qa_selected("vn_component_qa_custom_entry_one")
    assert eval "同行 · 当前" in qa_text("vn_component_qa_custom_entry_two")
    assert eval "当前" not in qa_text("vn_component_qa_custom_entry_one")
    assert eval qa_selected("vn_component_qa_script_entry_two")
    screenshot "06-custom-group-current-second-member.png"
    run Function(qa_trace_view, "custom-group-second-member")
    click id "vn_component_qa_close"
    pause until "第二章正文：当前章节应已转移。"
    advance until "尾声正文：已离开分组。"
    assert eval vn_current_node == "body_epilogue"
    run VnUiMenu("flowchart")
    pause until screen "flowchart"
    pause .2
    assert eval qa_selected("vn_component_qa_custom_entry_epilogue") and not qa_selected("vn_component_qa_custom_first_act")
    assert eval "尾声 · 当前" in qa_text("vn_component_qa_custom_entry_epilogue")
    assert eval "当前" not in qa_text("vn_component_qa_custom_first_act")
    screenshot "07-custom-root-current-outside-group.png"
    run Function(qa_trace_view, "custom-root-outside-group")
    click id "vn_component_qa_custom_first_act"
    pause .2
    assert eval not qa_selected("vn_component_qa_custom_entry_one") and not qa_selected("vn_component_qa_custom_entry_two")
    assert eval "当前" not in qa_text("vn_component_qa_custom_entry_one") and "当前" not in qa_text("vn_component_qa_custom_entry_two")
    assert eval not qa_has("vn_component_qa_custom_first_act") and not qa_has("vn_component_qa_custom_entry_epilogue")
    assert eval qa_selected("vn_component_qa_script_entry_epilogue")
    assert eval vn_current_node == "body_epilogue" and "first_act" not in persistent.vn_seen_nodes
    screenshot "08-custom-group-has-no-current-outside-scope.png"
    run Function(qa_trace_view, "custom-group-outside-scope")
    click id "vn_component_qa_custom_group_back"
    pause .2
    assert eval qa_selected("vn_component_qa_custom_entry_epilogue") and not qa_selected("vn_component_qa_custom_first_act")
    click id "vn_component_qa_close"
    run MainMenu(confirm=False)
`;

/** Generated product sources are evidence too, and must survive fixture cleanup. */
async function preserveGeneratedSources() {
  const saved: string[] = [];
  const visit = async (directory: string, relative = ''): Promise<void> => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    })) {
      const next = path.join(relative, entry.name), source = path.join(directory, entry.name);
      if (entry.isDirectory() && !['fonts', 'assets', 'cache', 'saves', 'python-packages'].includes(entry.name)) await visit(source, next);
      else if (entry.isFile() && entry.name.endsWith('.rpy')) {
        const destination = path.join(output, 'generated-source', next);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.copyFile(source, destination); saved.push(next);
      }
    }
  };
  await visit(path.join(game, 'game'));
  return saved;
}

/** Keep originals and provide <=1280px views before anyone inspects the images. */
async function screenshotViews(names: string[]) {
  const evidence: { original: string; view: string; originalSize: number[]; viewSize: number[] }[] = [];
  for (const name of names) {
    const source = path.join(output, 'screenshots', name), destination = path.join(output, 'views', name);
    assert.ok(inside(path.join(output, 'screenshots'), source) && inside(path.join(output, 'views'), destination));
    const bytes = await fs.readFile(source), image = PNG.sync.read(bytes);
    const scale = Math.min(1, 1280 / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale)), height = Math.max(1, Math.round(image.height * scale));
    await fs.mkdir(path.dirname(destination), { recursive: true });
    if (scale === 1) await fs.writeFile(destination, bytes);
    else {
      const view = new PNG({ width, height });
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const sx = Math.min(image.width - 1, (x + .5) / scale - .5), sy = Math.min(image.height - 1, (y + .5) / scale - .5);
        const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(image.width - 1, x0 + 1), y1 = Math.min(image.height - 1, y0 + 1);
        const dx = sx - x0, dy = sy - y0;
        for (let c = 0; c < 4; c++) view.data[(y * width + x) * 4 + c] = Math.round(
          image.data[(y0 * image.width + x0) * 4 + c] * (1 - dx) * (1 - dy) + image.data[(y0 * image.width + x1) * 4 + c] * dx * (1 - dy) +
          image.data[(y1 * image.width + x0) * 4 + c] * (1 - dx) * dy + image.data[(y1 * image.width + x1) * 4 + c] * dx * dy);
      }
      await fs.writeFile(destination, PNG.sync.write(view));
    }
    evidence.push({ original: path.relative(output, source), view: path.relative(output, destination), originalSize: [image.width, image.height], viewSize: [width, height] });
  }
  return evidence;
}

await prepareOutput();
const report: Record<string, unknown> = { status: 'running', output, expectedCases: 2, expectedAssertions: tests.split('\n').filter(line => line.trim().startsWith('assert ')).length,
  coverage: ['script/grid 目录跟随真实未列正文及跨章节', '实际 FileSave/FileLoad 恢复当前位置', '自定义目录的根组卡、组内入口与组外位置隔离'] };
let failure: unknown, phase = 'fixture';
try {
  await isolateRenpySaves(output);
  const project = fixture();
  await fs.writeFile(path.join(output, 'fixture.vns.json'), JSON.stringify(project, null, 2));
  await fs.writeFile(path.join(output, 'testcases.rpy'), tests);
  phase = 'build';
  const built = await buildProject({ project, projectDir: path.join(output, 'source'), outputDir: game, sdkRoot: sdk });
  await fs.writeFile(path.join(output, 'build.json'), JSON.stringify(built, null, 2));
  assert.equal(built.ok, true, JSON.stringify(built));
  await fs.writeFile(path.join(game, 'game/testcases.rpy'), tests);
  phase = 'native interactions';
  // runRenpy waits for its own child's close event and kills only that child on
  // timeout. No global process matching or shutdown of another running game.
  const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 240000,
    env: { RENPY_RENDERER: 'gl2', PYTHONUNBUFFERED: '1' }, onData: text => process.stdout.write(text) });
  await fs.writeFile(path.join(output, 'run.log'), result.log);
  recordFlowNativeResult(report, tests, result, 2);
  report.status = 'passed';
} catch (error) {
  failure = error; report.status = 'failed'; report.phase = phase; report.error = error instanceof Error ? error.stack : String(error);
} finally {
  let sourcePreserved = false;
  try { report.generatedSources = await preserveGeneratedSources(); sourcePreserved = true; }
  catch (error) { failure ??= error; report.status = 'failed'; report.sourceEvidenceError = String(error); }
  const finishFailure = await finishFlowNativeVerification(output, game, report, previousSaves, { cleanup: sourcePreserved });
  failure ??= finishFailure;
  try {
    report.screenshotViews = await screenshotViews((report.screenshots as string[] | undefined) ?? []);
    if (report.status === 'passed') {
      const saved = new Set(((report.screenshots as string[] | undefined) ?? []).map(name => path.basename(name)));
      for (const match of tests.matchAll(/^    screenshot "([^"]+)"/gm)) assert.ok(saved.has(match[1]), 'native screen evidence was not preserved: ' + match[1]);
    }
  } catch (error) { failure ??= error; report.status = 'failed'; report.screenshotEvidenceError = String(error); }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
}
if (failure) throw failure;
