import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { uiImageFixturePng } from './lib/ui-image-fixture';
import { createUiLayoutFixture, uiLayoutFixtureExpectations } from './lib/ui-layout-fixture';
import { type UiComponent } from '../src/core/model';
import { resolveUiLayout, uiTransformPoint } from '../src/core/ui-layout';
import { pythonLiteral } from '../src/runtime/literals';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { isolateRenpySaves } from './lib/renpy-saves';
import { compileProject } from '../src/runtime/compiler';
import { buildProject, runRenpy } from '../src/runtime/service';

const sdk = process.env.VNS_RENPY_SDK ?? path.resolve('resources/runtime');
const output = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? 'artifacts', 'ui-layout-runtime', new Date().toISOString().replaceAll(':', '-'));
const source = path.join(output, 'source'), game = path.join(output, 'game');
const report: { status: string; checks: { name: string; code: number; logPath: string }[]; cases?: number; assertions?: number; error?: string; cleanup?: unknown; performance?: unknown; controlBounds?: unknown } = { status: 'running', checks: [] };
const save = async () => { await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); };
async function check(name: string, result: { code: number; log: string }) {
  const logPath = path.join(output, name + '.log'); await fs.writeFile(logPath, result.log);
  report.checks.push({ name, code: result.code, logPath }); await save();
  if (result.code) throw new Error(name + ': ' + result.log.slice(-9000));
}
try {
  await fs.mkdir(path.join(source, 'assets'), { recursive: true });
  await isolateRenpySaves(output);
  const f = createUiLayoutFixture(), count = 200;
  f.project.variables.push({ id: 'layout_boolean', name: '布局开关', type: 'boolean', initial: false, persistent: false });
  f.project.ui.customPages.push({ id: 'layout_perf', name: '布局性能场景', modal: true, background: '#14242e', components: [
    { id: 'layout_perf_panel', page: 'custom', kind: 'panel', text: '', x: .08, y: .08, width: .82, height: .7, layout: { version: 1, flow: 'vertical', scroll: 'vertical', clip: true, gap: 4 } },
    ...Array.from({ length: count }, (_, i): UiComponent => ({ id: 'layout_perf_' + i, page: 'custom', parentId: 'layout_perf_panel', kind: i % 3 ? 'preferenceChoice' : 'preference', parameterId: i % 3 === 2 ? 'layout_boolean' : i % 3 ? 'layout_option' : 'layout_number', text: '控件 ' + i, x: 0, y: 0, width: .9, height: .15 })),
    { id: 'layout_perf_close', page: 'custom', kind: 'button', action: 'return', text: '关闭布局性能页', x: .4, y: .86, width: .3, height: .09 },
  ] });
  f.project.variables.push({ id: 'layout_long_option', name: '长选项', type: 'string', initial: '第一项内容较长', persistent: false, setting: { options: ['第一项内容较长', '第二项内容也较长', '第三项需要横向滚动', '最后一项'] } });
  f.project.ui.customPages.push({ id: 'layout_compact', name: '小尺寸参数控件', modal: true, background: '#14242e', components: [
    { id: 'layout_compact_panel', page: 'custom', kind: 'panel', text: '', x: .08, y: .12, width: .7, height: .6, layout: { version: 1, flow: 'vertical', scroll: 'vertical', clip: true, gap: 4 } },
    ...(['layout_boolean', 'layout_option', 'layout_text', 'layout_long_option'] as const).map((parameterId, i): UiComponent => ({ id: 'layout_compact_' + i, page: 'custom', parentId: 'layout_compact_panel', kind: 'preferenceChoice', parameterId, text: ['开关', '选项', '文字', '长选项'][i], x: 0, y: 0, width: i === 3 ? .3 : .85, height: .11 })),
    { id: 'layout_compact_spacer', page: 'custom', parentId: 'layout_compact_panel', kind: 'panel', text: '', x: 0, y: 0, width: 1, height: 2 },
    { id: 'layout_compact_close', page: 'custom', kind: 'button', action: 'return', text: '关闭小尺寸控件', x: .4, y: .84, width: .3, height: .1 },
  ] });
  const original = structuredClone(f.project), expected = uiLayoutFixtureExpectations(f);
  assert.deepEqual(compileProject(f.project).diagnostics.filter(issue => issue.severity === 'error'), []); assert.deepEqual(f.project, original);
  await fs.writeFile(path.join(output, 'layout-expectations.json'), JSON.stringify(expected, null, 2));
  await fs.writeFile(path.join(source, 'project.vns.json'), JSON.stringify(f.project, null, 2));
  await fs.writeFile(path.join(source, 'assets/layout-grid.png'), uiImageFixturePng());
  const built = await buildProject({ project: f.project, projectDir: source, sdkRoot: sdk, outputDir: game, development: true });
  await check('compile', { code: built.ok ? 0 : 1, log: built.log + JSON.stringify(built.diagnostics) });
  // Instrument only this generated fixture's evaluation count. The production
  // runtime is untouched, and callbacks continue through the real resolver.
  const screenPath = path.join(game, 'game/screens.rpy'); let screens = await fs.readFile(screenPath, 'utf8');
  const begin = screens.indexOf('screen vn_components_custom_layout_perf('), at = screens.indexOf('\n    $ _vn_layout =', begin);
  assert.ok(begin >= 0 && at > begin); screens = screens.slice(0, at) + '\n    $ vn_test_layout_frame()' + screens.slice(at); await fs.writeFile(screenPath, screens);
  const start = ['    pause until screen "main_menu"', '    click id "vn_main_start" pos (0.5, 0.5)', '    pause until eval ("layout_page" in vn_ui_open_pages)', '    move pos (8, 8)'];
  const nativeRows = resolveUiLayout(f.project.ui.components.filter(c => c.page === 'preferences'), f.project), nativePanel = nativeRows.get('layout_native_panel')!;
  const nativeWheelPoint = uiTransformPoint(nativePanel.renderMatrix, { x: nativePanel.width / 2, y: nativePanel.height / 2 });
  const tests = String.raw`default vn_test_layout_task = None
default vn_test_layout_token = None

init 1000 python:
    vn_test_layout_expected = @@EXPECTED@@
    vn_test_layout_native_wheel = tuple(@@NATIVE_WHEEL@@)
    vn_test_layout_original_resolve = vn_ui_layout_resolve

    def vn_test_layout_frame():
        vn_test_layout_frame.count += 1
    vn_test_layout_frame.count = 0

    def vn_test_layout_counted(identities=None):
        identities = list(identities) if identities is not None else None
        measured = identities is not None and "layout_perf_panel" in identities
        started = __import__("time").perf_counter() if measured else 0
        rows = vn_test_layout_original_resolve(identities)
        if measured:
            vn_test_layout_counted.count += 1
            vn_test_layout_counted.seconds += __import__("time").perf_counter() - started
        return rows
    vn_test_layout_counted.count = 0
    vn_test_layout_counted.seconds = 0
    vn_ui_layout_resolve = vn_test_layout_counted

    def vn_test_layout_metrics(reset=False):
        if reset:
            vn_test_layout_frame.count = vn_test_layout_counted.count = 0
            vn_test_layout_counted.seconds = 0
            return True
        frames, solves = vn_test_layout_frame.count, vn_test_layout_counted.count
        result = dict(controls=200, evaluations=frames, solves=solves, solveSeconds=vn_test_layout_counted.seconds)
        with open(@@METRICS_PATH@@, "w", encoding="utf-8") as stream:
            __import__("json").dump(result, stream, indent=2)
        return frames > 0 and 0 < solves <= frames * 3 + 8

    def vn_test_layout_equal(actual, expected):
        if isinstance(expected, bool): return actual is expected
        if isinstance(expected, (int, float)):
            return __import__("math").isfinite(actual) and abs(actual-expected) <= 1e-6 * max(1,abs(expected))
        if isinstance(expected, (list, tuple)):
            return len(actual) == len(expected) and all(vn_test_layout_equal(a,b) for a,b in zip(actual,expected))
        return actual == expected

    def vn_test_layout_matches(name):
        rows = vn_ui_layout_resolve(vn_ui_layout_pages["layout_page"])
        for identity, fields in vn_test_layout_expected[name]["rows"].items():
            for field, value in fields.items():
                if not vn_test_layout_equal(rows[identity][field], value):
                    raise Exception("Layout mismatch: %s %s %s: %r != %r" % (name,identity,field,rows[identity][field],value))
        panel = rows["layout_panel"]
        for property in ("scrollX","scrollY","scrollMinimumX","scrollMinimumY","scrollMaximumX","scrollMaximumY","contentWidth","contentHeight"):
            if not vn_test_layout_equal(vn_ui_get("layout_panel",property),panel[property]): return False
        return True

    def vn_test_layout_apply(name):
        for identity in vn_ui_layout_pages["layout_page"]: vn_ui_reset(identity)
        for entry in vn_test_layout_expected[name]["changes"]:
            vn_ui_set(entry["componentId"],entry["property"],entry["value"])

    def vn_test_layout_point(name, point):
        value = vn_test_layout_expected[name][point]
        if value is None: raise Exception("Fixture must provide an actual visible/overflow click: " + name + " " + point)
        return tuple(int(v) for v in value)

    def vn_test_layout_reject(property, value):
        before = __import__("copy").deepcopy(vn_ui_overrides)
        try:
            vn_ui_set("layout_panel", property, value)
        except Exception:
            return before == vn_ui_overrides
        return False

    def vn_test_layout_stale_option():
        task = vn_bp_task_create("layout_controls", create_native=False)
        action = VnSelectControlOption("layout_choices",2,vn_ui_control_options_key("layout_choices"),task,True)
        before = vn_var_layout_option
        vn_ui_set("layout_controls_panel","scrollY",1000000)
        action()
        return vn_var_layout_option == before and not vn_ui_component_available("layout_choices")

    vn_test_control_bounds = []

    def vn_test_layout_control_bounds(page):
        rows = vn_ui_layout_resolve(vn_ui_layout_pages[page])
        measured = []
        for identity, row in rows.items():
            box = renpy.get_widget("vn_blueprint_pages", "vn_component_" + identity + "_bounds")
            if box is None or row["clippedOut"]: continue
            width, height = int(round(row["width"])), int(round(row["height"]))
            size = renpy.render(box, width, height, 0, 0).get_size()
            assert size == (width, height), (identity, size, width, height)
            children = []
            previous_bottom = 0
            for child, offset in zip(box.children, box.offsets):
                child_size = renpy.render(child, width, height, 0, 0).get_size()
                assert offset[1] >= previous_bottom, (identity, "overlapping label/body", offset, previous_bottom)
                assert 0 <= offset[1] and offset[1] + child_size[1] <= height, (identity, "vertical overflow", offset, child_size, height)
                previous_bottom = offset[1] + child_size[1]
                children.append(dict(type=type(child).__name__, offset=offset, size=child_size))
            measured.append(dict(id=identity, size=size, children=children))
        vn_test_control_bounds.append(dict(page=page, controls=measured))
        with open(@@CONTROL_BOUNDS_PATH@@, "w", encoding="utf-8") as stream:
            __import__("json").dump(vn_test_control_bounds, stream, indent=2)
        return len(measured) >= 3

    def vn_test_layout_option_view():
        return renpy.get_widget("vn_blueprint_pages", "vn_component_layout_compact_3_options_view")

    def vn_test_layout_options_at_end():
        adjustment = vn_test_layout_option_view().xadjustment
        return adjustment.range > 0 and adjustment.value == adjustment.range

    def vn_test_layout_button(identity, suffix):
        screen = renpy.get_screen("vn_blueprint_pages")
        widget = renpy.get_widget("vn_blueprint_pages", "vn_component_" + identity + suffix)
        if isinstance(widget, renpy.display.behavior.Button): return widget
        # A screen-language textbutton ID identifies its Text child. Ren'Py's
        # test selector fallback does not apply ancestor transforms to that
        # child's position, so use its button's actual on-screen focus region.
        buttons = []
        screen.child.visit_all(lambda child: buttons.append(child) if isinstance(child, renpy.display.behavior.Button) and widget in child.children else None)
        assert len(buttons) == 1, (identity, suffix, len(buttons))
        return buttons[0]

    def vn_test_layout_control_point(identity, suffix):
        widget = vn_test_layout_button(identity, suffix)
        focus = next((focus for focus in renpy.display.focus.focus_list if focus.widget is widget and focus.x is not None), None)
        assert focus is not None, (identity, suffix, "not focusable")
        point = (int(focus.x + focus.w / 2), int(focus.y + focus.h / 2))
        hit = renpy.display.render.focus_at_point(*point)
        assert hit and hit.widget is widget, (identity, suffix, point, "not hit")
        return point

    def vn_test_layout_option_point():
        row = vn_ui_layout_row("layout_compact_3")
        return tuple(int(value) for value in vn_ui_matrix_point(row["renderMatrix"], (row["width"] / 2, row["height"] * .7)))

testsuite global:
    before testcase:
        $ _test.timeout = 20.0
        $ _test.transition_timeout = 0.05
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
    after testcase:
        $ vn_ui_pygame.key.set_mods(0)
        run MainMenu(confirm=False)
        pause until screen "main_menu"
    teardown:
        exit

testcase canonical_pixel_layout_and_actual_clipped_hit:
@@START@@
    assert eval vn_test_layout_matches("initial")
    click pos (vn_test_layout_point("initial","outsideThird"))
    assert eval vn_var_layout_hit == 0
    click pos (vn_test_layout_point("initial","insideThird"))
    assert eval vn_var_layout_hit == 3
    screenshot "layout-initial-clip"

testcase transformed_real_buttons_and_affine_coordinates:
@@START@@
    click id "vn_component_layout_action_apply"
    assert eval vn_test_layout_matches("transformed")
    click id "vn_component_layout_item_0"
    assert eval vn_var_layout_hit == 1
    click pos (vn_test_layout_point("transformed","outsideThird"))
    assert eval vn_var_layout_hit == 1
    click pos (vn_test_layout_point("transformed","insideThird"))
    assert eval vn_var_layout_hit == 3
    click id "vn_component_layout_action_observe"
    assert eval vn_test_layout_equal(vn_var_layout_x,vn_test_layout_expected["transformed"]["rows"]["layout_panel"]["bounds"][0])
    assert eval vn_test_layout_equal(vn_var_layout_width,vn_test_layout_expected["transformed"]["rows"]["layout_panel"]["bounds"][2])
    screenshot "layout-affine-actual-clicks"

testcase actual_wheel_clamp_background_and_hidden_slots:
@@START@@
    click id "vn_component_layout_action_apply"
    scroll amount 1 pos (vn_test_layout_point("transformed","wheel"))
    assert eval vn_ui_get("layout_panel","scrollY") == 40
    assert eval vn_test_layout_equal(vn_ui_layout_row("layout_background")["matrix"],vn_test_layout_expected["transformed"]["rows"]["layout_background"]["matrix"])
    scroll amount 10 pos (vn_test_layout_point("transformed","wheel"))
    assert eval vn_test_layout_matches("scrolled")
    screenshot "layout-wheel-clamped"
    click id "vn_component_layout_action_hide"
    assert eval vn_test_layout_matches("hidden")
    click id "vn_component_layout_action_reset"
    assert eval vn_test_layout_matches("initial")

testcase shifted_wheel_nested_transform_mirror_and_zero_scale:
@@START@@
    $ vn_test_layout_apply("horizontal")
    assert eval vn_test_layout_matches("horizontal")
    $ vn_ui_pygame.key.set_mods(vn_ui_pygame.KMOD_SHIFT)
    scroll amount 2 pos (vn_test_layout_point("horizontal","wheel"))
    $ vn_ui_pygame.key.set_mods(0)
    assert eval vn_ui_get("layout_panel","scrollX") == 80 and vn_ui_get("layout_panel","scrollY") == 0
    screenshot "layout-horizontal-wheel"
    $ vn_test_layout_apply("mirrored")
    assert eval vn_test_layout_matches("mirrored")
    click pos (vn_test_layout_point("mirrored","insideThird"))
    assert eval vn_var_layout_hit == 3
    screenshot "layout-mirrored-scroll"
    $ vn_test_layout_apply("nested")
    assert eval vn_test_layout_matches("nested")
    screenshot "layout-nested-affine"
    $ vn_test_layout_apply("zero")
    assert eval vn_test_layout_matches("zero")
    pause 0.1
    assert eval renpy.get_widget("vn_blueprint_pages","vn_component_layout_item_0") is None
    assert eval not vn_ui_component_available("layout_item_0")
    screenshot "layout-zero-scale"

testcase typed_rejections_preserve_overrides:
@@START@@
    $ vn_test_assert_result = vn_test_layout_reject("anchorX",2)
    assert eval vn_test_assert_result
    $ vn_test_assert_result = vn_test_layout_reject("scaleX",True)
    assert eval vn_test_assert_result
    $ vn_test_assert_result = vn_test_layout_reject("layoutRotation",float("nan"))
    assert eval vn_test_assert_result
    $ vn_test_assert_result = vn_test_layout_reject("scrollMode","diagonal")
    assert eval vn_test_assert_result
    $ vn_test_assert_result = vn_test_layout_reject("contentHeight",100)
    assert eval vn_test_assert_result
    assert eval vn_test_layout_matches("initial")

testcase modal_instance_lifetime_and_common_system_template:
@@START@@
    click id "vn_component_layout_action_apply"
    $ vn_test_layout_task = vn_bp_task_create("layout_page",create_native=False)
    click id "vn_component_layout_action_child"
    pause until eval "layout_child" in vn_ui_open_pages
    assert eval not vn_ui_layout_scroll("layout_panel",0,40,vn_test_layout_task)
    assert eval vn_test_layout_matches("transformed")
    $ vn_test_layout_task = vn_bp_task_create("layout_child",create_native=False)
    move id "vn_component_layout_child_panel" pos (.5,.5)
    assert eval vn_ui_get("layout_child_panel","scrollMaximumY") > 0 and vn_ui_component_available("layout_child_panel")
    screenshot "layout-child-before-wheel"
    scroll amount 2 pos (640,350)
    assert eval vn_ui_get("layout_child_panel","scrollY") > 0
    screenshot "layout-modal-child-scroll"
    click id "vn_component_layout_child_close"
    pause until eval "layout_child" not in vn_ui_open_pages
    click id "vn_component_layout_action_child"
    pause until eval "layout_child" in vn_ui_open_pages
    assert eval not vn_ui_layout_scroll("layout_child_panel",0,40,vn_test_layout_task)
    assert eval not vn_ui_layout_scroll("layout_child_panel",0,40,vn_bp_task_create("layout_page",create_native=False))
    assert eval vn_ui_get("layout_child_panel","scrollY") == 0
    click id "vn_component_layout_child_close"
    click id "vn_component_layout_action_native"
    pause until screen "preferences"
    $ vn_test_layout_task = vn_bp_task_create("ui:preferences",create_native=False)
    click id "vn_component_layout_native_item_0"
    assert eval vn_var_layout_hit == 10
    scroll amount 2 pos (vn_test_layout_native_wheel)
    assert eval vn_ui_get("layout_native_panel","scrollY") == 80
    screenshot "layout-system-template-scroll"
    click id "vn_component_layout_native_close"
    pause until eval renpy.get_screen("preferences") is None
    click id "vn_component_layout_action_native"
    pause until screen "preferences"
    assert eval not vn_ui_layout_scroll("layout_native_panel",0,40,vn_test_layout_task)
    assert eval vn_ui_get("layout_native_panel","scrollY") == 0
    click id "vn_component_layout_native_close"

testcase focused_controls_pruned_after_animation_and_real_scroll:
@@START@@
    click id "vn_component_layout_action_controls"
    pause until eval "layout_controls" in vn_ui_open_pages
    click id "vn_component_layout_controls_animate"
    pause until eval vn_ui_get("layout_input","focused")
    pause until eval vn_ui_get("layout_input","y") == 2
    assert eval not vn_ui_get("layout_input","focused") and vn_var_layout_committed == 0
    screenshot "layout-animation-pruned-input"
    click id "vn_component_layout_controls_reset"
    click id "vn_component_layout_controls_focus"
    pause until eval vn_ui_get("layout_input","focused")
    scroll amount 8 pos (945,402)
    assert eval not vn_ui_get("layout_input","focused") and vn_var_layout_committed == 0
    click id "vn_component_layout_controls_reset"
    $ vn_test_assert_result = vn_test_layout_stale_option()
    assert eval vn_test_assert_result
    screenshot "layout-scroll-pruned-input"
    click id "vn_component_layout_controls_close"
    click id "vn_component_layout_action_native"
    pause until screen "preferences"
    click id "vn_component_layout_popup_choice"
    pause until screen "vn_preference_popup"
    $ vn_test_layout_token = renpy.get_widget("vn_preference_popup","vn_ui_preference_popup_frame").get_placement()[0]
    $ vn_ui_set("layout_popup","x",vn_ui_get("layout_popup","x") + .1)
    pause until eval renpy.get_widget("vn_preference_popup","vn_ui_preference_popup_frame").get_placement()[0] != vn_test_layout_token
    assert eval abs(renpy.get_widget("vn_preference_popup","vn_ui_preference_popup_frame").get_placement()[0] - vn_test_layout_token - 128) < 1.1
    screenshot "layout-popup-follows-transformed-source"
    $ vn_ui_set("layout_popup","visible",False)
    pause until eval renpy.get_screen("vn_preference_popup") is None
    assert eval renpy.get_screen("vn_preference_popup") is None
    click id "vn_component_layout_native_close"

testcase save_load_rollback_close_reopen_and_new_game:
@@START@@
    click id "vn_component_layout_action_apply"
    click id "vn_component_layout_action_scroll"
    $ vn_test_layout_token = vn_ui_page_token("layout_page")
    $ renpy.save("layout-state")
    click id "vn_component_layout_action_hide"
    assert eval vn_test_layout_matches("hidden")
    run FileLoad("layout-state", confirm=False, slot=True)
    pause until eval "layout_page" in vn_ui_open_pages
    assert eval vn_test_layout_matches("scrolled")
    assert eval vn_ui_page_token("layout_page") == vn_test_layout_token
    screenshot "layout-loaded-state"
    click id "vn_component_layout_action_close"
    pause until "布局页关闭后继续剧情。"
    assert eval all(identity not in vn_ui_overrides for identity in vn_ui_layout_pages["layout_page"])
    run Rollback()
    pause until eval "layout_page" in vn_ui_open_pages
    assert eval vn_test_layout_matches("scrolled")
    assert eval vn_ui_page_token("layout_page") == vn_test_layout_token
    run MainMenu(confirm=False)
    pause until screen "main_menu"
    click id "vn_main_start" pos (.5,.5)
    pause until eval "layout_page" in vn_ui_open_pages
    assert eval vn_test_layout_matches("initial")

testcase background_task_uses_the_same_scroll_override:
@@START@@
    click id "vn_component_layout_action_background"
    pause until eval vn_var_layout_background_done == 1
    assert eval vn_ui_get("layout_panel","scrollY") == 80
    assert eval vn_ui_overrides["layout_panel"]["scrollY"] == 80
    screenshot "layout-background-task"

testcase two_hundred_native_controls_share_screen_geometry:
@@START@@
    $ vn_test_layout_metrics(True)
    $ vn_ui_open_page("layout_perf")
    pause until eval "layout_perf" in vn_ui_open_pages
    pause 0.35
    $ vn_test_assert_result = vn_test_layout_metrics()
    assert eval vn_test_assert_result
    assert eval vn_ui_get("layout_perf_panel","scrollMaximumY") > 0
    $ vn_test_assert_result = vn_test_layout_control_bounds("layout_perf")
    assert eval vn_test_assert_result
    screenshot "layout-200-controls-before-click"
    click pos (vn_test_layout_control_point("layout_perf_2", "_toggle"))
    assert eval vn_var_layout_boolean is True
    click pos (vn_test_layout_control_point("layout_perf_1", "_option_1"))
    assert eval vn_var_layout_option == "B"
    scroll amount 1 pos (vn_test_layout_control_point("layout_perf_1", "_option_1"))
    assert eval vn_ui_get("layout_perf_panel","scrollY") > 0
    scroll amount 5 pos (1100,490)
    assert eval vn_ui_get("layout_perf_panel","scrollY") > 0
    $ vn_test_assert_result = vn_test_layout_control_bounds("layout_perf")
    assert eval vn_test_assert_result
    screenshot "layout-200-controls"
    click id "vn_component_layout_perf_close"

testcase compact_controls_keep_bounds_and_long_options_remain_reachable:
@@START@@
    $ vn_ui_open_page("layout_compact")
    pause until eval "layout_compact" in vn_ui_open_pages
    pause 0.1
    $ vn_test_assert_result = vn_test_layout_control_bounds("layout_compact")
    assert eval vn_test_assert_result
    screenshot "layout-compact-before-click"
    click pos (vn_test_layout_control_point("layout_compact_0", "_toggle"))
    assert eval vn_var_layout_boolean is True
    click pos (vn_test_layout_control_point("layout_compact_1", "_option_2"))
    assert eval vn_var_layout_option == "C"
    click id "vn_component_layout_compact_2_edit"
    assert eval vn_ui_get("layout_compact_2", "focused")
    type "AB" id "vn_component_layout_compact_2"
    keysym "K_RETURN" id "vn_component_layout_compact_2"
    assert eval vn_var_layout_text == "初始文字AB" and not vn_ui_get("layout_compact_2", "focused")
    assert eval vn_test_layout_option_view().xadjustment.range > 0
    screenshot "layout-compact-controls"
    scroll amount 1 pos (vn_test_layout_option_point())
    assert eval vn_test_layout_option_view().xadjustment.value > 0 and vn_ui_get("layout_compact_panel", "scrollY") == 0
    scroll amount 1 pos (vn_test_layout_option_point()) until eval vn_test_layout_options_at_end()
    assert eval vn_test_layout_options_at_end()
    assert eval vn_ui_get("layout_compact_panel", "scrollY") == 0
    click pos (vn_test_layout_control_point("layout_compact_3", "_option_3"))
    assert eval vn_var_layout_long_option == "最后一项"
    $ vn_test_assert_result = vn_test_layout_control_bounds("layout_compact")
    assert eval vn_test_assert_result
    screenshot "layout-long-option-selected"
    scroll amount 1 pos (vn_test_layout_option_point())
    assert eval vn_ui_get("layout_compact_panel", "scrollY") > 0
    screenshot "layout-options-wheel-handoff"
    click id "vn_component_layout_compact_close"
`.replaceAll('@@START@@', start.join('\n')).replace('@@EXPECTED@@', pythonLiteral(expected)).replace('@@NATIVE_WHEEL@@', pythonLiteral([Math.round(nativeWheelPoint.x), Math.round(nativeWheelPoint.y)])).replace('@@METRICS_PATH@@', pythonLiteral(path.join(output, 'layout-performance.json'))).replace('@@CONTROL_BOUNDS_PATH@@', pythonLiteral(path.join(output, 'control-bounds.json')));
  await fs.writeFile(path.join(output, 'testcases.rpy'), tests);
  await fs.writeFile(path.join(game, 'game/testcases.rpy'), tests);
  const options = { savedir: path.join(output, 'saves'), timeoutMs: 300000 };
  await check('lint', await runRenpy(sdk, game, ['lint'], options));
  const native = await runRenpy(sdk, game, ['test', '--report-detailed', '--report-skipped'], { ...options, onData: text => process.stdout.write(text) });
  await check('runtime', native); report.cases = (tests.match(/^testcase /gm) ?? []).length;
  assert.match(native.log, new RegExp('Test cases\\s*:\\s*' + report.cases + '\\s*\\|\\s*' + report.cases + ' passed'));
  report.assertions = Number(native.log.match(/Assertions\s*:\s*(\d+)/)?.[1]);
  assert.equal(report.assertions, (tests.match(/^    assert /gm) ?? []).length);
  report.performance = JSON.parse(await fs.readFile(path.join(output, 'layout-performance.json'), 'utf8'));
  report.controlBounds = JSON.parse(await fs.readFile(path.join(output, 'control-bounds.json'), 'utf8'));
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error); process.exitCode = 1; }
finally {
  try {
    for (const directory of [path.join(game, 'tests/screenshots'), path.join(game, 'game/tests/screenshots')]) {
      if (await fs.stat(directory).then(stat => stat.isDirectory()).catch(() => false)) await fs.cp(directory, path.join(output, 'screenshots'), { recursive: true });
    }
  } catch (error) { report.status = 'failed'; report.error = [report.error, 'Screenshot preservation failed: ' + String(error)].filter(Boolean).join('\n'); process.exitCode = 1; }
  // Preservation failures must never bypass fixture cleanup.
  try {
    report.cleanup = await fs.stat(output).catch(() => undefined) ? await cleanVerificationDirectories(output, ['source', 'game', 'saves', 'renpy-saves']) : { removed: [], absent: [], errors: [] };
    if ((report.cleanup as { errors: unknown[] }).errors.length) throw new Error('Verification cleanup failed.');
  } catch (error) { report.status = 'failed'; report.error = [report.error, String(error)].filter(Boolean).join('\n'); process.exitCode = 1; }
  await save(); console.log(path.join(output, 'report.json')); if (report.error) console.error(report.error);
}
