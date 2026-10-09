import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createUiConfirmPreviewFixture } from './lib/ui-confirm-preview-fixture';
import { buildProject, runRenpy } from '../src/runtime/service';
import { variableReference } from '../src/runtime/expressions';
const root = path.resolve('.'), sdk = path.join(root, 'resources/runtime'), output = path.join(root, 'artifacts/ui-confirm-runtime', new Date().toISOString().replaceAll(':', '-')), build = path.join(output, 'game');
const { project, nestedGraph, menuGraph } = createUiConfirmPreviewFixture();
project.ui.components.find(c=>c.id==='yes')!.events={onClick:nestedGraph.id};
project.ui.components.push(
 { ...project.ui.components.find(c=>c.id==='open_menu')!, id:'ordinary_menu', text:'普通设置入口', action:'preferences', blueprintId:undefined, x:.55 },
 { ...project.ui.components.find(c=>c.id==='voices')!, id:'gallery_menu', text:'打开标准画廊', action:'gallery', x:.55 },
);
project.nodes.find(node=>node.kind==='passage')!.lines=[
 {id:'menu_ready',text:'剧情菜单准备。',actions:[]},
 {id:'menu_returned',text:'剧情菜单已返回。',actions:[{kind:'blueprint',blueprintId:menuGraph.id}]},
];
await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, 'project.vns.json'), JSON.stringify(project));
const result = await buildProject({ project, sdkRoot: sdk, outputDir: build, development: true }); if (!result.ok) throw Error(result.log || JSON.stringify(result.diagnostics));
const v = (id: string) => variableReference(project, id);
await fs.writeFile(path.join(build, 'game/testcases.rpy'), `init -999 python:
    import renpy as _engine
    _engine.safe_mode_checked = True
testsuite global:
    before testcase:
        $ _test.timeout = 12.0
    teardown:
        exit
testcase confirm_and_menu:
    click id "vn_component_ask"
    pause until screen "confirm"
    assert eval ${v('after')} == 0
    click id "vn_component_no"
    pause until eval ${v('result')} == "已取消"
    assert eval ${v('after')} == 1
    click id "vn_component_ask"
    click id "vn_component_yes"
    pause until eval renpy.get_screen("confirm").scope["message"] == "内层确认"
    assert eval ${v('after')} == 1
    click id "vn_component_yes"
    pause until eval ${v('result')} == "已确认"
    assert eval ${v('nested')} == "内层确认完成"
    assert eval ${v('after')} == 2
    click id "vn_component_open_menu"
    pause until screen "preferences"
    $ before_base = ${v('base_ticks')}
    $ before_menu = ${v('menu_ticks')}
    pause 1.2
    assert eval ${v('base_ticks')} == before_base
    assert eval ${v('menu_ticks')} > before_menu
    assert eval ${v('after')} == 2
    click id "vn_component_voices"
    pause until screen "voice_settings"
    click id "vn_component_voices_return"
    pause until screen "preferences"
    click id "vn_component_menu_return"
    pause until eval ${v('after')} == 3
    assert screen "main_menu"
    assert eval not vn_bp_menu_active
    click id "vn_component_open_menu"
    pause until screen "preferences"
    assert eval main_menu
    assert eval not renpy.display.behavior.is_sensitive(FileSave(1))
    keysym "K_ESCAPE"
    pause until eval ${v('after')} == 4
    assert screen "main_menu"
    click id "vn_component_open_menu"
    click id "vn_component_gallery_menu"
    pause until screen "gallery"
    click id "vn_game_menu_return"
    pause until eval ${v('after')} == 5
    assert screen "main_menu"
    click id "vn_component_original_page"
    pause until screen "vn_custom_page_waiting_page"
    click id "vn_component_page_menu"
    pause until screen "preferences"
    click id "vn_component_menu_return"
    pause until eval ${v('after')} == 6
    assert screen "vn_custom_page_waiting_page"
    click id "vn_component_close_button"
    pause until eval ${v('after')} == 7
    assert screen "main_menu"
    click id "vn_component_ordinary_menu"
    pause until screen "preferences"
    assert eval not vn_bp_menu_active
    click id "vn_component_menu_return"
    pause until screen "main_menu"
    assert eval ${v('after')} == 7
    assert eval not vn_bp_menu_active
    run Start()
    pause until "剧情菜单准备。"
    assert eval not main_menu
    $ story_before = ${v('after')}
    advance until screen "preferences"
    assert eval vn_bp_menu_active and not main_menu
    click id "vn_component_menu_return"
    pause until "剧情菜单已返回。"
    assert eval ${v('after')} == story_before + 1
    assert eval not vn_bp_menu_active
    run ShowMenu("preferences")
    pause until screen "preferences"
    assert eval not vn_bp_menu_active and not main_menu
    click id "vn_component_menu_return"
    pause until "剧情菜单已返回。"
    assert eval ${v('after')} == story_before + 1
`);
const run = await runRenpy(sdk, build, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 60000 }); await fs.writeFile(path.join(output, 'runtime.log'), run.log);
const passed = run.code === 0 && /Test cases\s*:\s*1\s*\|\s*1 passed/.test(run.log);
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: passed ? 'passed' : 'failed', checks: ['确认取消及独立分支', '点击回调内嵌套确认，外层响应等待', '蓝图菜单暂停底层计时，页面内计时继续', '角色音量返回设置，菜单关闭恢复调用', 'Esc和标准菜单返回按钮恢复蓝图', '标题状态仍禁止存档', '自定义等待页调用菜单后返回原页', '调用标志恢复，普通标题菜单返回保持正常', '剧情蓝图菜单返回后继续对白，普通游戏菜单返回回归'] }, null, 2)); console.log(output); if (!passed) throw Error(run.log.slice(-4000));
