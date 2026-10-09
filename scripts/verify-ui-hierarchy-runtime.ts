import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { uiHierarchyFixture } from './lib/ui-hierarchy-fixture';
import { buildProject, runRenpy } from '../src/runtime/service';

const root = path.resolve('.'), output = path.join(root, 'artifacts/ui-hierarchy-runtime', new Date().toISOString().replaceAll(':', '-'));
const { project, entries } = await uiHierarchyFixture(output);
const button = project.ui.components.find(c => c.id === 'memory_button')!;
const ornament = project.ui.components.find(c => c.id === 'ornament')!;
project.ui.components.push(
  { id: 'state_caption', parentId: button.id, inheritState: true, page: 'main', kind: 'text', text: '状态文字', x: 0, y: 0, width: 1, height: .2, style: { fontSize: 20, textColor: '#ffffff', hoverTextColor: '#88ff88', disabledTextColor: '#777777' } },
  { id: 'state_panel', parentId: button.id, inheritState: true, page: 'main', kind: 'panel', text: '', x: .9, y: .1, width: .05, height: .1, style: { background: '#ffffff', hoverBackground: '#88ff88', disabledBackground: '#777777' } },
  { ...ornament, id: 'stopped_group', parentId: button.id, inheritState: false, x: .9, y: 0, width: .1, height: .1 },
  { ...ornament, id: 'stopped_descendant', parentId: 'stopped_group', inheritState: true, x: 0, y: 0, width: 1, height: 1 },
  { id: 'shortcut_child', parentId: button.id, page: 'main', kind: 'button', text: '子按钮', x: .8, y: .85, width: .2, height: .15, action: 'preferences', shortcut: 'K_q' },
);
const game = path.join(output, 'game'), sdk = path.join(root, 'resources/runtime');
const built = await buildProject({ project, projectDir: output, outputDir: game, sdkRoot: sdk, development: true });
await fs.writeFile(path.join(output, 'build.json'), JSON.stringify(built, null, 2)); assert.ok(built.ok, JSON.stringify(built));
await fs.writeFile(path.join(game, 'game/testcases.rpy'), `
init -999 python:
    import renpy as _qa_engine
    _qa_engine.safe_mode_checked = True
init python:
    def qa_child_surface(identity):
        found = []
        renpy.get_widget("main_menu", "vn_component_" + identity).visit_all(lambda d: found.append(d) if isinstance(d, VnUiStateSurface) else None)
        return found[0]

    def qa_child_text(identity):
        found = []
        renpy.get_widget("main_menu", "vn_component_" + identity).visit_all(lambda d: found.append(d) if isinstance(d, renpy.text.text.Text) else None)
        return found[0]

testsuite global:
    before testcase:
        $ _test.timeout = 15.0
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit

testcase children:
    pause until screen "main_menu"
    move pos (8, 8)
    pause 0.2
    assert eval qa_child_surface("button_background").state == "idle"
    screenshot "01-children-idle.png"
    move id "vn_component_memory_button"
    pause 0.2
    assert eval qa_child_surface("button_background").state == "hover"
    assert eval qa_child_surface("ornament").state == "hover"
    assert eval qa_child_surface("stopped_descendant").state == "idle"
    assert eval qa_child_text("state_caption").style.color == Color("#88ff88")
    screenshot "02-children-hover.png"
    $ renpy.test.testmouse.press_mouse(1)
    pause 0.2
    assert eval qa_child_surface("button_background").state == "pressed"
    screenshot "03-children-pressed.png"
    $ renpy.test.testmouse.release_mouse(1)
    pause 0.2
    assert eval vn_ui_get("trace", "text") == "已点击一次"
    $ vn_ui_set("memory_button", "width", 0.35)
    $ vn_ui_set("memory_button", "x", 0.4)
    pause 0.3
    assert eval qa_child_surface("button_background").width == 672
    assert eval vn_ui_get("button_background", "width") == 1
    screenshot "04-parent-resized.png"
    $ vn_ui_set("memory_button", "enabled", False)
    pause 0.2
    assert eval qa_child_surface("button_background").state == "disabled"
    assert eval qa_child_surface("stopped_descendant").state == "disabled"
    assert eval qa_child_text("state_caption").style.color == Color("#777777")
    keysym "K_q"
    pause 0.2
    assert not screen "preferences"
    screenshot "05-children-disabled.png"
    $ vn_ui_set("memory_button", "visible", False)
    pause 0.2
    assert eval renpy.get_widget("main_menu", "vn_component_button_background") is None
    $ vn_ui_set("memory_button", "visible", True)
    $ vn_ui_set("memory_button", "enabled", True)
    pause 0.2
    assert eval renpy.get_widget("main_menu", "vn_component_button_background") is not None
    keysym "K_q"
    pause until screen "preferences"
    keysym "K_ESCAPE"
    pause until screen "main_menu"

testcase flow_styles:
    click id "vn_component_open_flow"
    pause until screen "flowchart"
    move pos (1800, 80)
    screenshot "06-flow-locked.png"
    $ persistent.vn_seen_nodes = ${JSON.stringify(entries.map(e => e.nodeId))}
    $ renpy.restart_interaction()
    pause 0.3
    screenshot "07-flow-styles.png"
    move id "vn_component_flow_${entries[1].nodeId}"
    pause 0.3
    screenshot "08-memory-hover.png"
    $ label = renpy.get_widget("flowchart", "vn_component_flow_${entries[0].nodeId}_label")
    assert eval label.style.color == Color("#ffffff")
    assert eval len(label.style.outlines) == 1
    assert eval renpy.get_widget("flowchart", "vn_component_flow_${entries[0].nodeId}_shadow") is not None
    click id "vn_component_flow_${entries[0].nodeId}"
    pause until screen "say"
    assert eval vn_current_node == "${project.nodes.find(n => n.kind === 'passage')!.id}"
`);
const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 120000, env: { SDL_VIDEO_WINDOW_POS: '2400,0' } });
await fs.writeFile(path.join(output, 'runtime.log'), result.log);
const passed = result.code === 0 && /Test cases\s*:\s*2\s*\|\s*2 passed/.test(result.log);
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: passed ? 'passed' : 'failed', code: result.code, checks: ['父按钮和多级子图同步悬停、按住、禁用', '背景不遮挡点击', '父级移动缩放、隐藏与恢复', '三种命名流程图样式与未解锁状态', '原生柔和阴影与流程图跳转'], entries }, null, 2));
console.log(output); assert.ok(passed, result.log.slice(-6000));
