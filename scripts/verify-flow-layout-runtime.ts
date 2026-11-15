import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { createProject, type StoryNode, type UiComponent } from '../src/core/model';
import { flowEdgePoints, flowEdgeSegments, storyFlowLayout } from '../src/core/story-flow';
import { buildProject, runRenpy } from '../src/runtime/service';
import { pythonLiteral } from '../src/runtime/literals';
import { isolateRenpySaves } from './lib/renpy-saves';
import { findScreenshot, preserveRenpyScreenshots } from './lib/text-typography';
import { finishFlowNativeVerification, flowRuntimeOutput, flowRuntimeTraceSource, recordFlowNativeResult } from './lib/flow-runtime-verification';

// The game draws what the flowchart options describe: direction, line styles, locked nodes and lines.
const root = path.resolve('.'), output = flowRuntimeOutput('flow-layout');
const game = path.join(output, 'game'), sdk = path.join(root, 'resources/runtime');
const previousSaves = process.env.RENPY_PATH_TO_SAVES;
const project = createProject('流程图布局验收'), sceneId = project.scenes[0].id;
project.width = 1920; project.height = 1080;
const base = (id: string) => ({ id, name: id, sceneId, x: 0, y: 0 });
const passage = (id: string, next?: string): StoryNode => ({ ...base(id), kind: 'passage', lines: [{ id: id + '_line', text: id, actions: [] }], next, flowchart: { visible: true, name: id } });
project.nodes = [passage('entry', 'choice'), { ...base('choice'), kind: 'choice', textHeading: false, prompt: '', choices: [{ id: 'a', text: '左', target: 'left' }, { id: 'b', text: '右', target: 'right' }] }, passage('left', 'merge'), passage('right', 'merge'), passage('merge', 'end'), { ...base('end'), kind: 'end', flowchart: { visible: true, name: 'end' } }];
project.entryId = 'entry';
project.nodes.find(node => node.id === 'left')!.flowchart = { visible: true, name: '记 第一回｜left' };
const flow = (list: UiComponent['list']): UiComponent => ({ id: 'flow', page: 'flowchart', kind: 'flowchart', text: '', x: 0, y: 0, width: 1, height: 1, list: { layout: 'flow', lockUnread: true, ...list } });
project.ui.components = project.ui.components.filter(component => component.kind !== 'flowchart');
project.ui.components.push(flow({ flowDirection: 'vertical', flowLineStyle: 'curve', flowLockedLine: 'dim', flowLockedCaption: '？？？', flowPositions: { right: { x: 1200, y: 240 } } }));
project.ui.components.at(-1)!.style = { fontSize: 44, captionParts: [{ fontSize: 20, color: '#ffcc66', gap: 24 }, {}], shadowBlur: 8, shadowSpread: 3, shadowOpacity: .8 };
const screen = (name: string, list: UiComponent['list']) => {
  const options = pythonLiteral({ ...list, lockUnread: true, flowShowControls: false, flowShowVerticalScrollbar: false, flowGraph: storyFlowLayout(project, flow(list)) });
  return `screen ${name}():\n    modal True\n    zorder 200\n    add Solid("#20242c")\n    use vn_story_flow(${project.width}, ${project.height}, 30, "#ffffff", "#3c5a7a", {}, ${options}, "${name}", style.default.font)\n`;
};
const texture = { flowLinePath: 'line-h.png', flowVerticalLinePath: 'line-v.png' };
const curve = flowEdgePoints({ x: 0, y: 360, width: 120, height: 80 }, { x: 700, y: 560, width: 120, height: 80 }, false, 'curve');
const textureCases = [
  { name: 'short', points: [[120, 120], [216, 120]], bounds: [118, 108, 100, 24], label: [120, 65] },
  { name: 'long', points: [[120, 220], [824, 220]], bounds: [118, 208, 708, 24], label: [120, 165] },
  { name: 'vertical-only texture', points: [[120, 320], [472, 320]], options: { flowVerticalLinePath: 'line-v.png' }, bounds: [118, 308, 356, 24], label: [120, 265] },
  { name: 'vertical', points: [[1000, 100], [1000, 372]], bounds: [988, 98, 24, 276], label: [1050, 110] },
  { name: 'curve', points: curve, bounds: [108, 388, 604, 224], label: [120, 350] },
  { name: 'dimmed curve', points: curve.map(([x, y]) => [x, y + 300]), alpha: .35, bounds: [108, 688, 604, 224], label: [120, 650] },
  { name: 'return curve', points: flowEdgePoints({ x: 1200, y: 600, width: 120, height: 80 }, { x: 1050, y: 460, width: 120, height: 80 }, false, 'curve'), bounds: [1014, 424, 344, 228], label: [1080, 750] },
].map(item => ({ ...item, options: item.options ?? texture, alpha: item.alpha ?? 1 }));
const evidence: Record<string, { dots: number; expected: number; peak: number }> = {};
const report: Record<string, unknown> = { status: 'running', output, evidence };
let phase = 'fixture', failure: unknown;
await fs.mkdir(output, { recursive: true });
try {
await isolateRenpySaves(output);
await fs.writeFile(path.join(output, 'fixture.vns.json'), JSON.stringify(project, null, 2));
await fs.writeFile(path.join(output, 'texture-cases.json'), JSON.stringify(textureCases, null, 2));
phase = 'build';
const built = await buildProject({ project, projectDir: path.join(output, 'source'), outputDir: game, sdkRoot: sdk });
await fs.writeFile(path.join(output, 'build.json'), JSON.stringify(built, null, 2));
assert.equal(built.ok, true, JSON.stringify(built));
await fs.copyFile(path.join(root, 'resources/templates/aihong/assets/ai_ui_75d56faa1d705e8e.png'), path.join(game, 'game/line-h.png'));
await fs.copyFile(path.join(root, 'resources/templates/aihong/assets/ai_ui_98e8b0b73680cc92.png'), path.join(game, 'game/line-v.png'));
const tests = `
define config.savedir = ${JSON.stringify(path.join(output, 'saves').replaceAll('\\', '/'))}
init -999 python:
    import renpy as _engine
    _engine.safe_mode_checked = True
${flowRuntimeTraceSource(output)}
init python:
    def qa_visit(name, test):
        found = []
        renpy.get_screen(name).visit_all(lambda d: found.append(d) if test(d) else None)
        return found

    def qa_rotated(name):
        return len(qa_visit(name, lambda d: isinstance(d, renpy.display.transform.Transform) and abs((d.rotate or 0) % 90) > 0.001))

    def qa_dimmed(name):
        return len(qa_visit(name, lambda d: isinstance(d, renpy.display.transform.Transform) and abs(d.alpha - 0.35) < 0.001))

    def qa_texts(name):
        return sorted(d.get_all_text() for d in qa_visit(name, lambda d: isinstance(d, renpy.text.text.Text)))

${screen('qa_elbow', {})}
${screen('qa_hidden', { flowLineStyle: 'straight', flowLockedNode: 'hide', flowLockedLine: 'hide' })}
${screen('qa_straight', { flowLineStyle: 'straight', flowLockedLine: 'dim', flowLineWidth: 8, flowLineColor: '#ffcc66', flowPositions: { merge: { x: 1300, y: 700 }, end: { x: 900, y: 40 } } })}

init python:
    qa_texture_cases = ${pythonLiteral(textureCases)}

screen qa_textured():
    modal True
    zorder 200
    add Solid("#20242c")
    for case in qa_texture_cases:
        $ connector = vn_flow_edge(dict(points=case["points"]), case["options"], 1.0, 16, case["alpha"])
        add connector[0] pos connector[1]
        text case["name"] pos tuple(case["label"]) size 24 color "#ffffff"

testsuite global:
    before testcase:
        $ _test.timeout = 20.0
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.set_mute("music", True)
        $ preferences.transitions = 0
        $ persistent.vn_seen_nodes = ["left"]
    teardown:
        exit

testcase flow_layouts:
    pause until screen "main_menu"
    run VnUiMenu("flowchart")
    pause until screen "flowchart"
    pause 0.3
    screenshot "01-vertical-curve.png"
    # Each caption has a blurred copy; the copy drops the label's own color.
    assert eval len([text for text in qa_texts("flowchart") if "？？？" in text]) == 6 and any("entry" in text for text in qa_texts("flowchart"))
    assert eval len([text for text in qa_texts("flowchart") if "记 第一回" in text and text.startswith("{color=#ffcc66}{size=20}") and "{space=24}" in text]) == 1
    assert eval len([text for text in qa_texts("flowchart") if "记 第一回" in text and text.startswith("{size=20}")]) == 1
    assert eval "未到达" not in qa_texts("flowchart")
    assert eval qa_rotated("flowchart") > 0
    # Only the connector with both ends reached keeps its full strength.
    assert eval qa_dimmed("flowchart") > 0
    run Function(qa_trace, "vertical-curve", texts=qa_texts("flowchart"), rotated=qa_rotated("flowchart"), dimmed=qa_dimmed("flowchart"))

    # Automatic elbows draw as before.
    run Show("qa_elbow")
    pause 0.3
    screenshot "02-elbow.png"
    assert eval qa_rotated("qa_elbow") == 0 and qa_dimmed("qa_elbow") == 0
    assert eval qa_texts("qa_elbow").count("未到达") == 3
    run Function(qa_trace, "elbow", texts=qa_texts("qa_elbow"), rotated=qa_rotated("qa_elbow"), dimmed=qa_dimmed("qa_elbow"))
    run Hide("qa_elbow")

    # Locked parts can be hidden.
    run Show("qa_hidden")
    pause 0.3
    screenshot "03-hidden.png"
    assert eval len(qa_texts("qa_hidden")) == 2 and "entry" in qa_texts("qa_hidden") and any("记 第一回" in text for text in qa_texts("qa_hidden"))
    assert eval qa_rotated("qa_hidden") == 0 and qa_dimmed("qa_hidden") == 0
    run Function(qa_trace, "hidden", texts=qa_texts("qa_hidden"), rotated=qa_rotated("qa_hidden"), dimmed=qa_dimmed("qa_hidden"))
    run Hide("qa_hidden")

    # Straight lines follow hand-placed nodes.
    run Show("qa_straight")
    pause 0.3
    screenshot "04-straight.png"
    assert eval qa_rotated("qa_straight") == 4
    assert eval qa_dimmed("qa_straight") == 4
    run Function(qa_trace, "straight", rotated=qa_rotated("qa_straight"), dimmed=qa_dimmed("qa_straight"))
    run Hide("qa_straight")

    # Actual source textures on short/long/vertical/curved strips, including a
    # single supplied orientation and opacity applied after assembling the curve.
    run Show("qa_textured")
    pause 0.3
    screenshot "05-texture-spacing.png"
    run Function(qa_trace, "textured", cases=qa_texture_cases)
`;
await fs.writeFile(path.join(game, 'game/testcases.rpy'), tests);
await fs.writeFile(path.join(output, 'testcases.rpy'), tests);
phase = 'play';
const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 180000, env: { RENPY_RENDERER: 'gl2' } });
await fs.writeFile(path.join(output, 'run.log'), result.log);
console.log(output); console.log(result.log.slice(-2500));
recordFlowNativeResult(report, tests, result, 1);
await preserveRenpyScreenshots(game, path.join(output, 'screenshots'));
phase = 'actual texture pixels';
const screenshot = await findScreenshot(path.join(output, 'screenshots'), '05-texture-spacing.png');
assert.ok(screenshot);
const png = PNG.sync.read(await fs.readFile(screenshot));
const nativeTexture = PNG.sync.read(await fs.readFile(path.join(root, 'resources/templates/aihong/assets/ai_ui_75d56faa1d705e8e.png')));
let nativeContrast = 0;
for (let i = 0; i < nativeTexture.data.length; i += 4) {
  const value = Math.min(nativeTexture.data[i], nativeTexture.data[i + 1], nativeTexture.data[i + 2]);
  nativeContrast = Math.max(nativeContrast, (value - 32) * nativeTexture.data[i + 3] / 255);
}
for (const item of textureCases) {
  const [bx, by, bw, bh] = item.bounds, scaleX = png.width / project.width, scaleY = png.height / project.height;
  const x0 = Math.round(bx * scaleX), y0 = Math.round(by * scaleY), width = Math.round(bw * scaleX), height = Math.round(bh * scaleY);
  // The authored dots have their own alpha (~47%); compare against their actual
  // contrast on this background, then account for the line's separate dim state.
  const mask = new Uint8Array(width * height), threshold = 32 + nativeContrast * item.alpha * .5;
  let peak = 0, dots = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = ((y0 + y) * png.width + x0 + x) * 4, value = Math.min(png.data[index], png.data[index + 1], png.data[index + 2]);
    peak = Math.max(peak, value);
    if (value > threshold) mask[y * width + x] = 1;
  }
  // Count visible connected dots, not renderer objects or texture dimensions.
  for (let start = 0; start < mask.length; start++) if (mask[start]) {
    const pending = [start]; mask[start] = 0; let pixels = 0;
    while (pending.length) {
      const index = pending.pop()!, x = index % width, y = Math.floor(index / width); pixels++;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, next = ny * width + nx;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height && mask[next]) { mask[next] = 0; pending.push(next); }
      }
    }
    if (pixels >= 2) dots++;
  }
  const expected = flowEdgeSegments(item.points as [number, number][]).reduce((sum, segment) => sum + segment.length, 0) / 8;
  evidence[item.name] = { dots, expected, peak };
  assert.ok(dots >= expected * .65 && dots <= expected * 1.35, `${item.name}: ${JSON.stringify(evidence[item.name])}`);
}
const opacity = (evidence['dimmed curve'].peak - 32) / (evidence.curve.peak - 32);
assert.ok(Math.abs(opacity - .35) < .09, JSON.stringify({ opacity, evidence }));
report.opacity = opacity; report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.phase = phase; report.error = error instanceof Error ? error.stack : String(error); failure = error;
} finally {
  const finishFailure = await finishFlowNativeVerification(output, game, report, previousSaves); failure ??= finishFailure;
}
if (failure) throw failure;
