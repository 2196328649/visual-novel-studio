import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createUiPagePreviewFixture } from './lib/ui-page-preview-fixture';
import { buildProject, runRenpy } from '../src/runtime/service';
import { variableReference } from '../src/runtime/expressions';
const root = path.resolve('.'), sdk = path.join(root, 'resources/runtime'), output = path.join(root, 'artifacts/ui-page-wait-runtime', new Date().toISOString().replaceAll(':', '-')), build = path.join(output, 'game');
const { project } = createUiPagePreviewFixture();
await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, 'project.vns.json'), JSON.stringify(project));
const result = await buildProject({ project, sdkRoot: sdk, outputDir: build, development: true }); if (!result.ok) throw Error(result.log || JSON.stringify(result.diagnostics));
const v = (id: string) => variableReference(project, id);
await fs.writeFile(path.join(build, 'game/testcases.rpy'), `init -999 python:
    import renpy as _engine
    _engine.safe_mode_checked = True
testsuite global:
    before testcase:
        $ _test.timeout = 12.0
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit

testcase waiting_pages:
    click id "vn_component_open_button"
    pause until screen "vn_custom_page_waiting_page"
    assert eval ${v('after')} == 0
    assert eval ${v('result')} == "尚未返回"
    $ before_base = ${v('base_ticks')}
    $ before_page = ${v('page_ticks')}
    pause 1.2
    assert eval ${v('base_ticks')} > before_base
    assert eval ${v('page_ticks')} > before_page
    click id "vn_component_nested_button"
    pause until screen "vn_custom_page_nested_page"
    assert eval ${v('after')} == 0
    click id "vn_component_nested_close"
    pause until eval ${v('nested')} == "子页完成"
    assert eval ${v('after')} == 0
    click id "vn_component_close_button"
    pause until eval ${v('result')} == "已确认"
    assert eval ${v('after')} == 1
    $ stopped = ${v('page_ticks')}
    pause 0.8
    assert eval ${v('page_ticks')} == stopped
    click id "vn_component_open_button"
    pause until screen "vn_custom_page_waiting_page"
    run Function(vn_ui_cancel_page, "waiting_page")
    pause until eval ${v('result')} == "取消"
    assert eval ${v('after')} == 2
`);
const run = await runRenpy(sdk, build, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 90000, env: { SDL_VIDEO_WINDOW_POS: '2400,0' } });
await fs.writeFile(path.join(output, 'runtime.log'), run.log);
const passed = run.code === 0 && /Test cases\s*:\s*1\s*\|\s*1 passed/.test(run.log);
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: passed ? 'passed' : 'failed', checks: ['等待页结果及延后执行', '嵌套等待独立返回', '底层及等待页计时器', '关闭停止计时与取消返回'] }, null, 2)); console.log(output); if (!passed) throw Error(run.log.slice(-4000));
