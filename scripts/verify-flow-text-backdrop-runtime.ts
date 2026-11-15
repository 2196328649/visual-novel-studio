import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { parseProject } from '../src/desktop/project-store';
import { flowNodeAppearance } from '../src/core/flow-style';
import { storyFlowLayout } from '../src/core/story-flow';
import { uiTextOutlines } from '../src/core/ui-text-effects';
import { uiSkinData } from '../src/runtime/ui-runtime';
import { buildProject, runRenpy } from '../src/runtime/service';
import { pythonLiteral } from '../src/runtime/literals';
import { isolateRenpySaves } from './lib/renpy-saves';
import { findScreenshot, preserveRenpyScreenshots } from './lib/text-typography';
import { flowTextBackdropFixture, assertBacking, backingPixels, cropPng } from './lib/flow-text-backdrop-fixture';
import { finishFlowNativeVerification, flowRuntimeOutput, flowRuntimeTraceSource, recordFlowNativeResult } from './lib/flow-runtime-verification';

const root = path.resolve('.'), output = flowRuntimeOutput('flow-text-backdrop');
const source = path.join(output, 'source'), game = path.join(output, 'game'), sdk = path.join(root, 'resources/runtime');
const previousSaves = process.env.RENPY_PATH_TO_SAVES;
const evidence: Record<string, unknown> = {};
const report: Record<string, unknown> = { status: 'running', output, evidence };
let phase = 'fixture', failure: unknown;
await fs.mkdir(output, { recursive: true });
try {
  await isolateRenpySaves(output);
  const fixture = await flowTextBackdropFixture(source), project = parseProject(fixture.project).project;
  const map = project.ui.components[0], graph = storyFlowLayout(project, map);
  await fs.writeFile(path.join(output, 'fixture.vns.json'), JSON.stringify(project, null, 2));
  phase = 'build';
  const built = await buildProject({ project, projectDir: source, outputDir: game, sdkRoot: sdk });
  await fs.writeFile(path.join(output, 'build.json'), JSON.stringify(built, null, 2));
  assert.equal(built.ok, true, JSON.stringify(built));
  const assetPath = (id?: string) => project.assets.find(asset => asset.id === id)?.path;
  const font = assetPath(map.style?.fontAssetId)!;
  const looks = Object.fromEntries(graph.nodes.map(node => {
    const look = flowNodeAppearance(project, map, node);
    return [node.id, { node: { name: node.name, parts: node.parts }, skin: uiSkinData(project, look.skin), font: assetPath(look.style?.fontAssetId), style: look.style,
      textOutlines: uiTextOutlines(look, false), captionParts: look.style?.captionParts?.map(part => Object.fromEntries(Object.entries({ font: assetPath(part.fontAssetId), size: part.fontSize, color: part.color, gap: part.gap }).filter(([, value]) => value !== undefined))) }];
  }));
  const options = { layout: 'grid', columns: 1, rows: 4, itemWidth: 547, itemHeight: 90, gapY: 80, lockUnread: false, confirmJump: false, flowLooks: looks };
  const native = graph.nodes.map(node => `    assert eval renpy.get_widget("flowchart", "vn_component_ai_flowchart_items_${node.id}_shadow").alpha == 0.9`).join('\n');
  const tests = `
init -999 python:
    import renpy as _engine
    _engine.safe_mode_checked = True
${flowRuntimeTraceSource(output)}
init python:
    import json as qa_json
    qa_shadow_enabled = True
    qa_legacy_shadow = False
    qa_runtime_evidence = {}
    qa_directory_options = ${pythonLiteral(options)}
    qa_original_shadow = vn_ui_text_shadow
    qa_original_flow_appearance = vn_flow_appearance

    def qa_shadow(caption, font, size, bold, width, height, look, align=0.5):
        if not qa_shadow_enabled:
            return Null(width=width, height=height)
        actual = dict(look, shadowBlur=7, shadowSpread=look.get("shadowSpread", 0), shadowOpacity=.4) if qa_legacy_shadow else look
        return qa_original_shadow(caption, font, size, bold, width, height, actual, align)
    vn_ui_text_shadow = qa_shadow

    def qa_flow_appearance(look, zoom=1.0):
        actual = qa_original_flow_appearance(look, zoom)
        qa_runtime_evidence.setdefault("zooms", {})[str(round(zoom, 2))] = actual
        return actual
    vn_flow_appearance = qa_flow_appearance

    def qa_change_shadow(enabled, legacy=False):
        global qa_shadow_enabled, qa_legacy_shadow
        qa_shadow_enabled, qa_legacy_shadow = enabled, legacy
        renpy.restart_interaction()

    def qa_write_evidence():
        with open(${pythonLiteral(path.join(output, 'runtime-evidence.json').replaceAll('\\', '/'))}, "w", encoding="utf-8") as file:
            qa_json.dump(qa_runtime_evidence, file, ensure_ascii=False, indent=2)

screen qa_directory():
    modal True
    zorder 250
    add Solid("#555555")
    fixed:
        pos (70, 65)
        xysize (700, 770)
        use vn_collection("flowchart", 700, 770, 60, "#ffffff", "#555555", {}, qa_directory_options, "qa_directory", ${pythonLiteral(font)})

screen qa_colors():
    modal True
    zorder 270
    add Solid("#dddddd")
    fixed:
        pos (100, 150)
        use vn_styled_button("{color=#ffcc66}记 第一回{/color}{space=16}{font=${font}}醉梦{/font}", NullAction(), "qa_color", 800, 140, 42, "#ffffff", "#dddddd", {}, ${pythonLiteral(font)}, appearance=dict(shadowBlur=14, shadowSpread=4, shadowOpacity=.9), caption_align=0.0)

testsuite global:
    before testcase:
        $ _test.timeout = 20.0
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.transitions = 0
        $ persistent.vn_seen_nodes = ${pythonLiteral(fixture.entries.map(entry => entry.id))}
    teardown:
        exit

testcase backing:
    pause until screen "main_menu"
    run VnUiMenu("flowchart")
    pause until screen "flowchart"
    pause .3
${native}
    run Function(qa_trace, "branch-100", alpha=[renpy.get_widget("flowchart", "vn_component_ai_flowchart_items_" + node + "_shadow").alpha for node in ${pythonLiteral(graph.nodes.map(node => node.id))}])
    screenshot "branch-100-backing.png"
    run Function(qa_change_shadow, False)
    pause .2
    screenshot "branch-100-none.png"
    run Function(qa_change_shadow, True, True)
    pause .2
    screenshot "branch-100-legacy.png"
    run Function(qa_change_shadow, True)
    click id "vn_component_ai_flowchart_items_zoom_out"
    click id "vn_component_ai_flowchart_items_zoom_out"
    click id "vn_component_ai_flowchart_items_zoom_out"
    click id "vn_component_ai_flowchart_items_zoom_out"
    click id "vn_component_ai_flowchart_items_zoom_out"
    pause .2
    assert eval abs(qa_runtime_evidence["zooms"]["0.5"]["shadowSpread"] - 2.5) < .01
    run Function(qa_trace, "branch-50", appearance=qa_runtime_evidence["zooms"]["0.5"])
    screenshot "branch-50-backing.png"
    run Function(qa_change_shadow, False)
    pause .2
    screenshot "branch-50-none.png"
    run Function(qa_change_shadow, True)
    run Show("qa_directory")
    pause .2
    screenshot "directory-backing.png"
    run Function(qa_change_shadow, False)
    pause .2
    screenshot "directory-none.png"
    run Function(qa_change_shadow, True)
    run Show("qa_colors")
    pause .2
    screenshot "colored-backing.png"
    run Function(qa_change_shadow, False)
    pause .2
    screenshot "colored-none.png"
    assert eval abs(qa_original_shadow("x", style.default.font, 30, False, 100, 60, dict(shadowBlur=4, shadowColor="#00000080", shadowOpacity=.5)).alpha - .5 * 128 / 255.0) < .001
    assert eval abs(qa_original_shadow("x", style.default.font, 30, False, 100, 60, dict(shadowBlur=4)).alpha - .7) < .001
    run Function(qa_write_evidence)
    run Function(qa_trace, "backing-complete", evidence=qa_runtime_evidence)
`;
  await fs.writeFile(path.join(game, 'game/testcases.rpy'), tests);
  await fs.writeFile(path.join(output, 'testcases.rpy'), tests);
  phase = 'play';
  const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 180000, env: { RENPY_RENDERER: 'gl2' } });
  await fs.writeFile(path.join(output, 'run.log'), result.log);
  await preserveRenpyScreenshots(game, path.join(output, 'screenshots'));
  recordFlowNativeResult(report, tests, result, 1);
  phase = 'actual backing pixels';
  const image = async (name: string) => { const file = await findScreenshot(path.join(output, 'screenshots'), name); assert.ok(file, name); return PNG.sync.read(await fs.readFile(file)); };
  for (const [mode, zoom] of [['branch-100', 1], ['branch-50', .5], ['directory', 1]] as const) {
    const on = await image(`${mode}-backing.png`), off = await image(`${mode}-none.png`);
    const sx = on.width / project.width, sy = on.height / project.height;
    for (const [index, node] of graph.nodes.entries()) {
      const box = { x: (mode === 'directory' ? 70 : node.x * zoom) * sx, y: (mode === 'directory' ? 65 + index * 170 : node.y * zoom) * sy, width: node.width * zoom * sx, height: node.height * zoom * sy };
      const corrected = cropPng(on, box), none = cropPng(off, box);
      evidence[`${mode}-${index}`] = assertBacking(corrected, none, `${mode}-${index}`);
      await fs.writeFile(path.join(output, `${mode}-${index}.png`), PNG.sync.write(corrected));
      if (mode === 'branch-100') {
        const legacy = cropPng(await image('branch-100-legacy.png'), box);
        evidence[`legacy-${index}`] = backingPixels(legacy, none);
        assert.ok(backingPixels(corrected, none).strong > backingPixels(legacy, none).strong, 'dark backing should gain area over the legacy shadow');
      }
    }
  }
  const colored = await image('colored-backing.png'), coloredOff = await image('colored-none.png');
  const colorArea = { x: 90 * colored.width / project.width, y: 140 * colored.height / project.height, width: 820 * colored.width / project.width, height: 160 * colored.height / project.height };
  evidence.colored = assertBacking(cropPng(colored, colorArea), cropPng(coloredOff, colorArea), 'colored caption still has black backing');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.phase = phase; report.error = error instanceof Error ? error.stack : String(error); failure = error;
} finally {
  const finishFailure = await finishFlowNativeVerification(output, game, report, previousSaves); failure ??= finishFailure;
}
if (failure) throw failure;
