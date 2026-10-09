import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { projectSchema } from '../src/core/model';
import { createUiEventGraph, ensureUiClickEvent } from '../src/core/ui-logic';
import { blueprintNodeDefaults, connectBlueprintPins, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { buildProject, runRenpy } from '../src/runtime/service';

if (!process.argv[2]) throw Error('Pass the saved desktop project.');
const root = path.resolve('.'), projectFile = path.resolve(process.argv[2]);
const project = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8'))), [first, other] = project.ui.animations!;
assert.equal(first.name, other.name); assert.equal(first.tracks[0].keys[1].value, .8); assert.equal(other.tracks[0].keys[1].value, .2);
// The saved fixture only authors animations. Add test launchers through the
// normal button-event path; keep all saved animation data and the source file.
const launcher = createUiEventGraph(project, 'ui:main', '验收播放入口');
for (const [id, clip] of [['qa_first', first], ['qa_other', other]] as const) {
  project.ui.components.push({ id, kind: 'button', page: 'main', text: id, x: id === 'qa_first' ? .1 : .5, y: .7, width: .3, height: .1 });
  const event = ensureUiClickEvent(project, launcher, id, 'ui:main'), play = blueprintNodeDefaults('playUiAnimation'); play.properties = { animationId: clip.id, wait: false }; launcher.nodes.push(play);
  assert.equal(connectBlueprintPins(launcher, event.id, 'exec', play.id, 'exec_in'), undefined);
}
synchronizeBlueprintSignatures(project);
const output = path.join(root, 'artifacts/ai-animation-selection-runtime', new Date().toISOString().replaceAll(':', '-')), game = path.join(output, 'game'), sdk = path.join(root, 'resources/runtime');
await fs.mkdir(output, { recursive: true });
const built = await buildProject({ project, projectDir: path.dirname(projectFile), outputDir: game, sdkRoot: sdk, development: true }); assert.ok(built.ok, built.log);
await fs.writeFile(path.join(game, 'game/testcases.rpy'), `testsuite global:
    before testcase:
        $ _test.timeout = 12.0
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit

testcase ai_selected_widget_key:
    pause until eval renpy.get_screen("main_menu") is not None
    assert eval abs(vn_ui_get("animated_text", "x") - 0.2) < 0.0001
    assert eval vn_ui_get("animated_text", "text") == "当前动画"
    click id "vn_component_qa_first"
    pause until eval vn_ui_get("animated_text", "x") > 0.45
    assert eval vn_ui_get("animated_text", "x") < 0.65
    screenshot "selected-animation-moving.png"
    pause until eval not vn_ui_animations
    assert eval abs(vn_ui_get("animated_text", "x") - 0.8) < 0.0001
    assert eval abs(vn_ui_get("animated_text", "opacity") - 1.0) < 0.0001
    screenshot "selected-animation-finished.png"
    click id "vn_component_qa_other"
    pause 0.1
    pause until eval not vn_ui_animations
    assert eval abs(vn_ui_get("animated_text", "x") - 0.2) < 0.0001
    assert eval vn_ui_get("animated_text", "text") == "当前动画"
    screenshot "namesake-unchanged.png"
`);
const run = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 90000, env: { SDL_VIDEO_WINDOW_POS: '2400,0' } });
await fs.writeFile(path.join(output, 'runtime.log'), run.log);
const passed = run.code === 0 && /Test cases\s*:\s*1\s*\|\s*1 passed/.test(run.log);
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: passed ? 'passed' : 'failed', projectFile, testPlaybackButtonsAdded: true, checks: ['桌面AI保存的动画原样编译，添加测试播放按钮', '按动画ID播放修改的关键帧并到达0.8', '其他轨道和同名动画仍保持原值'] }, null, 2)); console.log(output); if (!passed) throw Error(run.log.slice(-4000));
