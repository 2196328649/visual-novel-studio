import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { projectSchema } from '../src/core/model';
import { buildProject, runRenpy } from '../src/runtime/service';

const root = path.resolve('.'), source = process.env.VNS_UI_EVENT_PROJECT;
if (!source) throw Error('Set VNS_UI_EVENT_PROJECT to the desktop-authored timeline fixture.');
const project = projectSchema.parse(JSON.parse(await fs.readFile(source, 'utf8')));
const owner = project.blueprints.find(g => g.uiPageId === 'ui:main')!;
const call = owner.nodes.find(n => n.type === 'callFunction')!;
const timeline = project.blueprints.find(g => g.id === call.properties.graphId)!;
const nested = timeline.nodes.find(n => n.type === 'callFunction')!;
assert.ok(timeline.timelineComponent && nested);
const output = path.join(root, 'artifacts/ui-event-timeline-runtime', new Date().toISOString().replaceAll(':', '-'));
const game = path.join(output, 'game'), sdk = path.join(root, 'resources/runtime'); await fs.mkdir(output, { recursive: true });
const built = await buildProject({ project, projectDir: path.dirname(source), outputDir: game, sdkRoot: sdk, development: true });
assert.ok(built.ok, built.log);
await fs.writeFile(path.join(game, 'game/testcases.rpy'), `init python:
    vn_test_timeline_labels = []
    def vn_test_record_label(name, abnormal):
        vn_test_timeline_labels.append(name)
    config.label_callbacks.append(vn_test_record_label)

testsuite global:
    before testcase:
        $ _test.timeout = 15.0
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit

testcase ui_event_timeline:
    pause until eval renpy.get_screen("main_menu") is not None
    assert eval vn_ui_get("target", "visible") is True
    assert eval "vn_blueprint_${timeline.id}" not in vn_test_timeline_labels
    click id "vn_component_trigger"
    pause until eval vn_ui_get("target", "visible") is False
    assert eval "vn_blueprint_${timeline.id}" in vn_test_timeline_labels
    assert eval "vn_blueprint_${nested.properties.graphId}" in vn_test_timeline_labels
    assert eval vn_ui_get("target", "text") == "演出完成前显示"
    screenshot "after-timeline.png"
`);
const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 90000, env: { SDL_VIDEO_WINDOW_POS: '2400,0' } });
await fs.writeFile(path.join(output, 'runtime.log'), result.log);
const passed = result.code === 0 && /Test cases\s*:\s*1\s*\|\s*1 passed/.test(result.log);
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: passed ? 'passed' : 'failed', source, checks: ['桌面实际保存工程原生构建', '页面显示不误触发点击时间轴', '按钮点击进入父时间轴及内部时间轴', '演出返回后继续执行控件隐藏节点'] }, null, 2));
console.log(output); assert.ok(passed, result.log.slice(-4500));
