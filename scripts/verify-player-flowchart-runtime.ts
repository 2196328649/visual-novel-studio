import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { createProject, type UiComponent } from '../src/core/model';
import { applyTextScript } from '../src/core/text-script';
import { storyMenuEntries } from '../src/core/story-menu';
import { storyFlowOwner } from '../src/core/story-flow-authoring';
import { buildProject, runRenpy } from '../src/runtime/service';
import { pythonLiteral } from '../src/runtime/literals';
import { isolateRenpySaves } from './lib/renpy-saves';
import { findScreenshot, preserveRenpyScreenshots } from './lib/text-typography';
import { finishFlowNativeVerification, flowRuntimeOutput, flowRuntimeTraceSource, recordFlowNativeResult } from './lib/flow-runtime-verification';

const root = path.resolve('.'), output = flowRuntimeOutput('player-flowchart');
const sdk = path.join(root, 'resources/runtime'), game = path.join(output, 'game');
const previousSaves = process.env.RENPY_PATH_TO_SAVES;
const project = applyTextScript(createProject('玩家剧情图文字验收'), '#章节：左对齐\n旁白：左\n#章节：居中\n旁白：中\n#章节：右对齐\n旁白：右\n#章节：分段继承\n旁白：继承\n#章节：局部覆盖\n旁白：覆盖').project;
project.width = 1280; project.height = 900;
project.ui.components = [];
project.ui.pages = { ...project.ui.pages, flowchart: { layout: 'custom', background: '#101010' } };
const entries = storyMenuEntries(project, 'flowchart');
const alignments = ['left', 'center', 'right', 'left', 'center'] as const;
const letterSpacing = [3, -2, 0, 3, 0] as const;
const captionParts = [[{}, {}], [{}, {}], [{}, {}], [{ letterSpacing: 0 }, {}], [{ letterSpacing: 3 }, {}]];
assert.equal(entries.length, letterSpacing.length, 'fixture should contain one entry for each spacing case');
project.ui.flowStyles = alignments.map((align, index) => ({ id: `align_${index}`, name: align + index, style: { align, letterSpacing: letterSpacing[index], captionParts: captionParts[index] } }));
entries.forEach((entry, index) => { storyFlowOwner(project, entry.owner)!.flowchart = { name: 'AAAA｜BBBB', styleId: `align_${index}` }; });
const map: UiComponent = { id: 'qa_map', name: '玩家剧情图', page: 'flowchart', kind: 'flowchart', text: '', x: 0, y: 0, width: 1, height: 1, style: { fontSize: 42, textColor: '#ffffff', background: '#242424', hoverBackground: '#242424', selectedBackground: '#242424', shadowBlur: 4, shadowOpacity: .7, captionParts: [{ fontSize: 18 }, {}] }, list: { layout: 'flow', lockUnread: true, itemWidth: 720, itemHeight: 110, flowViewport: { x: 0, y: 0, width: 1, height: 1 }, flowShowControls: false, flowShowVerticalScrollbar: false, flowPositions: Object.fromEntries(entries.map((entry, index) => [entry.id, { x: 90, y: 50 + index * 170 }])) } };
project.ui.components.push(map);
await fs.mkdir(output, { recursive: true });
const evidence: Record<string, unknown> = {};
const report: Record<string, unknown> = { status: 'running', output, evidence };
let phase = 'fixture', failure: unknown;
try {
  await isolateRenpySaves(output);
  await fs.writeFile(path.join(output, 'fixture.vns.json'), JSON.stringify(project, null, 2));
  phase = 'build';
  const built = await buildProject({ project, projectDir: path.join(output, 'source'), outputDir: game, sdkRoot: sdk });
  await fs.writeFile(path.join(output, 'build.json'), JSON.stringify(built, null, 2));
  assert.equal(built.ok, true, JSON.stringify(built));
  const options = { layout: 'grid', columns: 1, rows: entries.length, itemWidth: 720, itemHeight: 110, gapY: 60, flowLooks: Object.fromEntries(entries.map((entry, index) => [entry.id, { node: { name: 'AAAA BBBB', parts: ['AAAA', 'BBBB'] }, style: { fontSize: 42, textColor: '#ffffff', background: '#242424', align: alignments[index], letterSpacing: letterSpacing[index] }, captionParts: captionParts[index] }])) };
  const text = `
init -999 python:
    import renpy as _engine
    _engine.safe_mode_checked = True
${flowRuntimeTraceSource(output)}
init python:
    def qa_texts(name):
        items = []
        renpy.get_screen(name).visit_all(lambda d: items.append(d.get_all_text()) if isinstance(d, renpy.text.text.Text) else None)
        return items

    def qa_flow_width(slots, spacing, scale=1.0):
        caption = vn_flow_markup(["AAAA", "BBBB"], slots, style.default.font, 42, scale, spacing)
        probe = renpy.text.text.Text(caption, substitute=False, font=style.default.font, size=42, layout="nobreak")
        return renpy.render(probe, 32768, 32768, 0, 0).get_size()[0]

    def qa_flow_fit_size(spacing):
        caption = vn_flow_markup(["AAAA", "BBBB"], [{}, {}], style.default.font, 42, letter_spacing=spacing)
        return vn_flow_font_size(caption, style.default.font, 42, 200, 80)

    def qa_shadow_widths(spacing):
        caption = "{color=#ffffff}" + vn_flow_markup(["AAAA", "BBBB"], [{}, {}], style.default.font, 42, letter_spacing=spacing) + "{/color}"
        face = renpy.text.text.Text(caption, substitute=False, font=style.default.font, size=42, color="#ffffff", layout="nobreak")
        shadow = renpy.text.text.Text(vn_ui_uncolored(caption), substitute=False, font=style.default.font, size=42, color="#000000", layout="nobreak")
        return renpy.render(face, 32768, 32768, 0, 0).get_size()[0], renpy.render(shadow, 32768, 32768, 0, 0).get_size()[0]

screen qa_directory():
    modal True
    zorder 250
    add Solid("#101010")
    fixed:
        pos (90, 0)
        xysize (900, 900)
        use vn_collection("flowchart", 900, 900, 42, "#ffffff", "#242424", {}, ${pythonLiteral(options)}, "qa_directory", style.default.font)

screen qa_ordinary():
    zorder 300
    fixed:
        pos (90, 845)
        xysize (720, 50)
        use vn_styled_button("Aa", NullAction(), "qa_plain", 720, 50, 42, "#ffffff", "#242424", {}, style.default.font)

testsuite global:
    before testcase:
        $ _test.timeout = 20.0
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.transitions = 0
        $ persistent.vn_seen_nodes = ${pythonLiteral(entries.map(entry => entry.id))}
    teardown:
        exit

testcase alignment:
    pause until screen "main_menu"
    run VnUiMenu("flowchart")
    pause until screen "flowchart"
    pause .3
${entries.map((entry, index) => `    assert eval renpy.get_widget("flowchart", "vn_component_qa_map_${entry.id}_label").style.text_align == ${{ left: 0.0, center: 0.5, right: 1.0 }[alignments[index]]}
    assert eval "{space=16}" in renpy.get_widget("flowchart", "vn_component_qa_map_${entry.id}_label").get_all_text()`).join('\n')}
    run Show("qa_ordinary")
    pause .2
    assert eval renpy.get_widget("qa_ordinary", "qa_plain_label").style.text_align == 0.5
    screenshot "branch-alignments.png"
    run Function(qa_trace, "branch", texts=qa_texts("flowchart"), alignments=[renpy.get_widget("flowchart", "vn_component_qa_map_" + node + "_label").style.text_align for node in ${pythonLiteral(entries.map(entry => entry.id))}], widths=[qa_flow_width(${pythonLiteral(captionParts[0])}, 3), qa_flow_width(${pythonLiteral(captionParts[1])}, -2), qa_flow_width(${pythonLiteral(captionParts[2])}, 0), qa_flow_width(${pythonLiteral(captionParts[3])}, 3), qa_flow_width(${pythonLiteral(captionParts[4])}, 0)])
    run Hide("qa_ordinary")
    run Show("qa_directory")
    pause .3
${entries.map((entry, index) => `    assert eval renpy.get_widget("qa_directory", "qa_directory_${entry.id}_label").style.text_align == ${{ left: 0.0, center: 0.5, right: 1.0 }[alignments[index]]}
    assert eval "{space=16}" in renpy.get_widget("qa_directory", "qa_directory_${entry.id}_label").get_all_text()`).join('\n')}
    screenshot "directory-alignments.png"
    run Function(qa_trace, "directory", texts=qa_texts("qa_directory"), alignments=[renpy.get_widget("qa_directory", "qa_directory_" + node + "_label").style.text_align for node in ${pythonLiteral(entries.map(entry => entry.id))}], widths=[qa_flow_width(${pythonLiteral(captionParts[0])}, 3), qa_flow_width(${pythonLiteral(captionParts[1])}, -2), qa_flow_width(${pythonLiteral(captionParts[2])}, 0), qa_flow_width(${pythonLiteral(captionParts[3])}, 3), qa_flow_width(${pythonLiteral(captionParts[4])}, 0)])
    run Hide("qa_directory")
    assert eval qa_flow_width(None, 3) > qa_flow_width(None, 0) > qa_flow_width(None, -2)
    assert eval qa_flow_width([{}, {}], 3) == qa_flow_width(None, 3)
    assert eval qa_flow_width([{"letterSpacing": 0}, {}], 3) < qa_flow_width(None, 3)
    assert eval qa_flow_width([{"letterSpacing": 0}, {}], 3) > qa_flow_width(None, 0)
    assert eval qa_flow_width([{"letterSpacing": 3}, {}], 0) > qa_flow_width(None, 0)
    assert eval qa_flow_width([{"letterSpacing": -2}, {}], 0) < qa_flow_width(None, 0)
    assert eval qa_flow_width(None, 0) < qa_flow_width(None, 3, .5) < qa_flow_width(None, 3)
    assert eval qa_flow_fit_size(3) < qa_flow_fit_size(0) < qa_flow_fit_size(-2)
    assert eval qa_shadow_widths(3)[0] == qa_shadow_widths(3)[1]
    # Literal punctuation, default spacing, and the last-slot matching rule.
    assert eval vn_flow_markup(["{literal}"], None, style.default.font, 42) == "{{literal}"
    assert eval vn_flow_markup(["{literal}"], [{}], style.default.font, 42) == "{{literal}"
    assert eval "{{literal}" in vn_flow_markup(["{literal}"], [{"size": 18}], style.default.font, 42)
    assert eval "{size=37}" in vn_flow_markup(["one"], [{"size": 18}, {"size": 37}], style.default.font, 42)
    assert eval "{space=16}" in vn_flow_markup(["one", "two"], [{"gap": None}, {}], style.default.font, 42)
    assert eval vn_flow_parts({"name": "AAAA BBBB", "parts": ["AAAA", "BBBB"]}, "AAAA BBBB · 已读", False) == ["AAAA", "BBBB · 已读"]
    $ persistent.vn_seen_nodes = []
    assert eval not VnStoryStart("flowchart", ${pythonLiteral(entries[1].id)}, "vn_node_${entries[1].id}", "中", True).get_sensitive()
    assert eval VnStoryStart("flowchart", ${pythonLiteral(entries[0].id)}, "vn_node_${entries[0].id}", "左", True).get_sensitive()
    run Function(qa_trace, "alignment-complete", reached=list(persistent.vn_seen_nodes))
`;
  await fs.writeFile(path.join(game, 'game/testcases.rpy'), text);
  await fs.writeFile(path.join(output, 'testcases.rpy'), text);
  phase = 'play';
  const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 180000, env: { RENPY_RENDERER: 'gl2' } });
  await fs.writeFile(path.join(output, 'run.log'), result.log);
  await preserveRenpyScreenshots(game, path.join(output, 'screenshots'));
  recordFlowNativeResult(report, text, result, 1);
  phase = 'actual glyph positions';
  for (const mode of ['branch', 'directory']) {
    const file = await findScreenshot(path.join(output, 'screenshots'), `${mode}-alignments.png`); assert.ok(file);
    const png = PNG.sync.read(await fs.readFile(file)), sx = png.width / project.width, sy = png.height / project.height;
    const bounds: { min: number; max: number; pixels: number }[] = [];
    for (let index = 0; index < entries.length; index++) {
      let min = Infinity, max = -Infinity, pixels = 0;
      const top = (mode === 'branch' ? 50 : 0) + index * 170;
      for (let y = Math.round(top * sy); y < Math.round((top + 110) * sy); y++) for (let x = Math.round(90 * sx); x < Math.round(810 * sx); x++) {
        const at = (y * png.width + x) * 4;
        if (Math.min(png.data[at], png.data[at + 1], png.data[at + 2]) > 190) { min = Math.min(min, x); max = Math.max(max, x); pixels++; }
      }
      assert.ok(pixels > 20, `${mode}:${index}: no caption ink`);
      const actual = alignments[index] === 'left' ? min : alignments[index] === 'center' ? (min + max + 1) / 2 : max + 1;
      const expected = { left: 126, center: 450, right: 774 }[alignments[index]] * sx;
      assert.ok(Math.abs(actual - expected) < 13 * sx, `${mode}:${index}: ${JSON.stringify({ min, max, expected, actual })}`);
      bounds.push({ min, max, pixels });
    }
    const inkWidths = bounds.map(item => item.max - item.min + 1);
    assert.ok(inkWidths[0] > inkWidths[2] + 10, `${mode}: positive spacing should widen rendered glyphs: ${JSON.stringify(inkWidths)}`);
    assert.ok(inkWidths[2] > inkWidths[1] + 10, `${mode}: negative spacing should tighten rendered glyphs: ${JSON.stringify(inkWidths)}`);
    assert.ok(inkWidths[0] > inkWidths[3] + 5 && inkWidths[3] > inkWidths[2] + 5, `${mode}: a part-level zero must override only that part: ${JSON.stringify(inkWidths)}`);
    assert.ok(inkWidths[4] > inkWidths[2] + 5, `${mode}: a part-level positive spacing should affect rendered glyphs: ${JSON.stringify(inkWidths)}`);
    evidence[mode] = bounds;
  }
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.phase = phase; report.error = error instanceof Error ? error.stack : String(error); failure = error;
} finally {
  const finishFailure = await finishFlowNativeVerification(output, game, report, previousSaves); failure ??= finishFailure;
}
if (failure) throw failure;
