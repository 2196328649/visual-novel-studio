import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadProject } from '../src/desktop/project-store';
import { buildProject, runRenpy } from '../src/runtime/service';
import { uiSkinData } from '../src/runtime/ui-runtime';
import { pythonLiteral } from '../src/runtime/literals';

const root = path.resolve('.'), source = path.join(root, 'resources/templates/aihong');
const output = path.join(root, 'artifacts/game-flow', new Date().toISOString().replaceAll(':', '-'));
const game = path.join(output, 'game'), sdk = path.join(root, 'resources/runtime');
const project = (await loadProject(path.join(source, 'project.vns.json'))).project;
const flow = project.ui.components.find(component => component.id === 'ai_flowchart_items')!;
const generic = process.env.VNS_FLOW_GENERIC === '1';
if (generic) {
  Object.assign(flow, { x: 0, y: 200 / project.height, width: 1, height: 736 / project.height });
  delete flow.list!.flowViewport; delete flow.list!.flowScrollbar;
  delete flow.list!.flowShowControls; delete flow.list!.flowShowVerticalScrollbar;
}
const flowFont = project.assets.find(asset => asset.id === flow.style?.fontAssetId)!.path;
const compactOptions = pythonLiteral({ flowGraph: { width: 300, height: 200, nodes: [], edges: [] }, flowViewport: { x: 0, y: 0, width: 1, height: .8 }, flowShowControls: false, flowShowVerticalScrollbar: false, flowScrollbar: { rect: { x: .1, y: .85, width: .8, height: .1 }, trackHeight: 4.5, thumbHeight: 20.5, thumb: uiSkinData(project, { idle: 'ai_ui_a441471ec430d257', brightness: { disabled: .4 } }) } });
await fs.mkdir(output, { recursive: true });
const built = await buildProject({ project, projectDir: source, outputDir: game, sdkRoot: sdk });
assert.equal(built.ok, true, JSON.stringify(built));
await fs.writeFile(path.join(game, 'game/testcases.rpy'), `
define config.savedir = ${JSON.stringify(path.join(output, 'saves').replaceAll('\\', '/'))}
init -999 python:
    import renpy as _flow_engine
    _flow_engine.safe_mode_checked = True
init python:
    def qa_flow_texts():
        texts = []
        renpy.get_screen("flowchart").visit_all(lambda d: texts.append(d) if isinstance(d, renpy.text.text.Text) else None)
        return texts

    def qa_flow_bar():
        return renpy.get_widget("flowchart", "vn_component_ai_flowchart_items_scroll_x")

    def qa_thumb_frames():
        frames = []
        qa_flow_bar().style.thumb.visit_all(lambda d: frames.append(d) if isinstance(d, renpy.display.imagelike.Frame) else None)
        return frames

    def qa_voice_texts():
        texts = []
        renpy.get_screen("voice_collection").visit_all(lambda d: texts.append(d.get_all_text()) if isinstance(d, renpy.text.text.Text) else None)
        return texts

    def qa_flow_text_sizes():
        sizes = []
        for text in qa_flow_texts():
            if text.get_all_text() not in ${JSON.stringify(project.nodes.map(node => node.name))}:
                continue
            face = Text(text.get_all_text(), font=text.style.font, size=text.style.size, layout="nobreak", substitute=False, outlines=[])
            sizes.append(dict(caption=text.get_all_text(), face=renpy.render(face, 32768, 32768, 0, 0).get_size(), painted=renpy.render(text, 32768, 32768, 0, 0).get_size(), halo=max(o[0] for o in text.style.outlines)))
        return sizes

screen qa_flow_short():
    modal True
    zorder 200
    add Solid("#333333")
    fixed:
        align (0.5, 0.5)
        xysize (600, 400)
        use vn_story_flow(600, 400, 24, "#ffffff", "#00000000", {}, ${compactOptions}, "qa_short", ${JSON.stringify(flowFont)})

testsuite global:
    before testcase:
        $ _test.timeout = 20.0
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.set_mute("music", True)
        $ preferences.text_cps = 0
        $ persistent.vn_seen_nodes = []
    teardown:
        exit

testcase flow_visuals:
    assert screen "main_menu"
    click id "vn_component_ai_title_plotmap"
    assert screen "flowchart"
    move pos (1800, 160)
    pause 0.3
    $ vp = renpy.get_widget("flowchart", "vn_component_ai_flowchart_items_viewport")
    assert eval abs(qa_flow_bar().thumb_dim / qa_flow_bar().width - vp.xadjustment.page / (vp.xadjustment.range + vp.xadjustment.page)) < 0.01
    assert eval not vn_story_unlocked("flowchart", "opening", True)
    assert eval "兽视与夜宴" not in [t.get_all_text() for t in qa_flow_texts()]
    assert eval not VnStoryStart("flowchart", "opening", "vn_node_opening", "兽视与夜宴", True).get_sensitive()
    screenshot "01-locked.png"
    $ persistent.vn_seen_nodes = ${JSON.stringify(project.nodes.map(node => node.id))}
    $ renpy.restart_interaction()
    pause 0.3
    assert eval not any("已读" in t.get_all_text() or " · 当前" in t.get_all_text() for t in qa_flow_texts())
    assert eval any(t.get_all_text() == "兽视与夜宴" and t.style.font == ${JSON.stringify(flowFont)} for t in qa_flow_texts())
    assert eval any(t.get_all_text() == "兽视与夜宴" and len(t.style.outlines) > 4 and all(o[2] == 0 and o[3] == 0 for o in t.style.outlines) and len(set(str(o[1]) for o in t.style.outlines)) > 4 for t in qa_flow_texts())
    assert eval qa_flow_bar().style.thumb.skin["fit"] == "nineSlice"
    assert eval qa_flow_bar().style.thumb.skin["borders"] == dict(left=24, top=0, right=24, bottom=0)
    assert eval len(qa_thumb_frames()) == 1 and qa_thumb_frames()[0].left == 24 and qa_thumb_frames()[0].right == 24
    screenshot "02-unlocked.png"
    $ open(config.basedir + "/text-sizes.json", "w").write(__import__("json").dumps(qa_flow_text_sizes()))
    assert eval all(item["face"][1] <= 74 and item["painted"][1] <= item["face"][1] + 2 * item["halo"] + 2 for item in qa_flow_text_sizes())
    assert eval renpy.get_widget("flowchart", "vn_component_ai_flowchart_items_opening_current_marker") is None
    move id "vn_component_ai_flowchart_items_opening"
    pause 0.3
    screenshot "03-hover.png"
    move pos (1800, 160)
${generic ? `    click id "vn_component_ai_flowchart_items_zoom_in"` : `    assert eval renpy.get_widget("flowchart", "vn_component_ai_flowchart_items_zoom_in") is None
    assert eval renpy.get_widget("flowchart", "vn_component_ai_flowchart_items_scroll_y") is None
    assert eval vp.xadjustment.page == 1920 and vp.yadjustment.page == 736
    assert eval qa_flow_bar().height == 31
    assert eval abs(qa_flow_bar().width - 733) <= 1
    move id "vn_component_ai_flowchart_items_scroll_x"`}
    pause 0.3
    screenshot "04-zoom.png"
${!generic ? `    $ renpy.test.testmouse.press_mouse(1)
    pause 0.2
    assert eval renpy.display.focus.get_grab() is qa_flow_bar()
    assert eval qa_flow_bar().style.thumb.state == "pressed"
    screenshot "04-held.png"
    $ renpy.test.testmouse.release_mouse(1)
    pause 0.2
    assert eval renpy.display.focus.get_grab() is None` : ''}
    $ vp = renpy.get_widget("flowchart", "vn_component_ai_flowchart_items_viewport")
    $ open(config.basedir + "/viewport.json", "w").write(__import__("json").dumps({"xrange": vp.xadjustment.range, "yrange": vp.yadjustment.range, "xpage": vp.xadjustment.page, "ypage": vp.yadjustment.page}))
    assert id "vn_component_ai_flowchart_items_scroll_x"
    assert eval abs(qa_flow_bar().thumb_dim / qa_flow_bar().width - vp.xadjustment.page / (vp.xadjustment.range + vp.xadjustment.page)) < 0.01
    drag id "vn_component_ai_flowchart_items_scroll_x" pos (0.05, 0.5) to id "vn_component_ai_flowchart_items_scroll_x" pos (0.95, 0.5) steps 20
    assert eval vp.xadjustment.value > vp.xadjustment.range * 0.8
${generic ? `    assert id "vn_component_ai_flowchart_items_scroll_y"
    drag id "vn_component_ai_flowchart_items_scroll_y" pos (0.5, 0.3) to id "vn_component_ai_flowchart_items_scroll_y" pos (0.5, 0.95) steps 20
    assert eval vp.yadjustment.value > vp.yadjustment.range * 0.8` : ''}
    pause 0.3
    screenshot "05-end.png"
${generic ? `    click id "vn_component_ai_flowchart_items_locate"` : `    drag id "vn_component_ai_flowchart_items_scroll_x" pos (0.95, 0.5) to id "vn_component_ai_flowchart_items_scroll_x" pos (0.0, 0.5) steps 20`}
    pause 0.3
    assert eval vp.xadjustment.value == 0
    move id "vn_component_ai_flowchart_items_ai_title_one"
    pause 0.3
    screenshot "06-chapter-hover.png"
    click id "vn_component_ai_flowchart_items_opening"
    pause until screen "say"
    assert eval vn_current_node == "opening"
    click id "vn_component_ai_dialogue_plotmap"
    assert screen "flowchart"
    move pos (1800, 160)
    screenshot "07-current-node.png"
    assert eval renpy.get_widget("flowchart", "vn_component_ai_flowchart_items_opening_current_marker") is not None
    assert eval not any("已读" in t.get_all_text() or " · 当前" in t.get_all_text() for t in qa_flow_texts())
    click id "vn_component_ai_flowchart_items_opening"
    assert screen "confirm"
    click id "vn_component_ai_confirm_yes"
    pause until screen "say"
    assert eval vn_current_node == "opening"
    run MainMenu(confirm=False)
    pause until screen "main_menu"
    click id "vn_component_ai_title_plotmap"
    assert screen "flowchart"
    click id "vn_component_ai_flowchart_back"
    assert screen "main_menu"

testcase short_flow_disabled:
    $ renpy.show_screen("qa_flow_short")
    $ renpy.restart_interaction()
    pause 0.3
    $ compact = renpy.get_widget("qa_flow_short", "qa_short_scroll_x")
    $ compact_vp = renpy.get_widget("qa_flow_short", "qa_short_viewport")
    $ open(config.basedir + "/compact.json", "w").write(__import__("json").dumps({"range": compact.adjustment.range, "page": compact.adjustment.page, "width": compact.width, "height": compact.height, "thumb": compact.thumb_dim, "viewport_range": compact_vp.xadjustment.range, "viewport_page": compact_vp.xadjustment.page}))
    screenshot "08-short-before.png"
    assert eval compact.adjustment.range <= 0
    assert eval compact.thumb_dim == compact.width
    assert eval compact.style.thumb.state == "disabled"
    assert eval compact.height == 20
    screenshot "08-short-disabled.png"
    $ renpy.hide_screen("qa_flow_short")
    $ renpy.restart_interaction()
    pause 0.3
    assert eval renpy.get_screen("qa_flow_short") is None
    screenshot "08-after-short.png"

testcase empty_voice_collection:
    assert screen "main_menu"
    $ persistent.vn_favorite_voices = []
    click id "vn_component_ai_title_gallery"
    pause until screen "gallery"
    assert screen "gallery"
    click id "vn_component_ai_gallery_voicecollection"
    pause until screen "voice_collection"
    assert screen "voice_collection"
    assert eval len(vn_voice_entries) == 0
    assert eval any("尚未收藏语音" in text for text in qa_voice_texts())
    assert eval renpy.get_widget("voice_collection", "vn_component_ai_voicecollection_buttonback") is not None
    screenshot "09-no-voices-collection.png"
    click id "vn_component_ai_voicecollection_buttonback"
    assert screen "main_menu"
`);
const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves') });
await fs.writeFile(path.join(output, 'run.log'), result.log);
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({status: result.code === 0 ? 'passed' : 'failed', code: result.code, variant: generic ? 'generic' : 'aihong', projectFile: path.join(source, 'project.vns.json')}, null, 2));
console.log(output); console.log(result.log.slice(-4500));
assert.equal(result.code, 0);
