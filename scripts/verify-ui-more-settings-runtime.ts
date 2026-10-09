import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { uiMoreSettingsFixture } from './lib/ui-more-settings-fixture';
import { buildProject, runRenpy } from '../src/runtime/service';

const root = path.resolve('.'), output = path.join(root, 'artifacts/ui-more-settings-runtime', new Date().toISOString().replaceAll(':', '-')), sdk = path.join(root, 'resources/runtime');
await fs.mkdir(output, { recursive: true });
const reports = [];
for (const mode of ['custom', 'replaced'] as const) {
  const folder = path.join(output, mode), project = uiMoreSettingsFixture(mode), game = path.join(folder, 'game'); await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, 'project.vns.json'), JSON.stringify(project));
  const built = await buildProject({ project, outputDir: game, sdkRoot: sdk }); assert.ok(built.ok, JSON.stringify(built.diagnostics));
  const source = `
testsuite global:
    before testcase:
        $ _test.timeout = 20.0
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit
testcase more_settings:
    click id "vn_component_open_wait"
    assert screen "preferences"
    assert eval vn_parameter_get("story") == 3
    click "更多设置"
    assert screen "vn_parameter_settings_menu"
    assert not screen "preferences"
    assert eval set(vn_parameter_unplaced(["placed"])) == set(["custom", "enabled", "language", "nickname", "bottom"])
    click id "vn_parameter_custom" pos (0.7, 0.5)
    assert eval 43 <= vn_parameter_get("custom") <= 47
    click id "vn_parameter_enabled_toggle"
    assert eval vn_parameter_get("enabled") is False
    click id "vn_parameter_language_option_1"
    assert eval vn_parameter_get("language") == "English"
    scroll amount 4 pos (0.7, 0.7)
    click id "vn_parameter_nickname_edit"
    type "X" id "vn_parameter_nickname"
    keysym "K_RETURN" id "vn_parameter_nickname"
    assert eval vn_parameter_get("nickname") == "PlayerX"
    click id "vn_parameter_bottom" pos (0.6, 0.5)
    assert eval 17 <= vn_parameter_get("bottom") <= 19
    screenshot "more-settings.png"
    click id "vn_game_menu_return"
    assert screen "preferences"
    assert eval vn_parameter_get("story") == 3
    click "更多设置"
    assert eval vn_parameter_get("language") == "English"
    keysym "K_ESCAPE"
    assert screen "preferences"
    assert eval vn_parameter_get("story") == 3
    click id "vn_component_settings_reset"
    click "取消"
    assert eval vn_parameter_get("language") == "English"
    click id "vn_component_settings_reset"
    click "确认"
    assert eval vn_parameter_get("custom") == 25 and vn_parameter_get("enabled") is True
    assert eval vn_parameter_get("language") == "中文" and vn_parameter_get("nickname") == "Player"
    assert eval vn_parameter_get("hidden") is True and vn_parameter_get("placed") is True
    click id "vn_component_settings_back"
    assert screen "main_menu"
    assert eval vn_parameter_get("story") == 9
`;
  await fs.writeFile(path.join(game, 'game/testcases.rpy'), source);
  const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(folder, 'saves'), timeoutMs: 90000, env: { SDL_VIDEO_WINDOW_POS: '2400,0' } });
  await fs.writeFile(path.join(folder, 'runtime.log'), result.log); assert.ok(result.code === 0 && /Test cases\s*:\s*1\s*\|\s*1 passed/.test(result.log), result.log.slice(-5000));
  reports.push({ mode, assertions: source.split('\n').filter(line => line.trim().startsWith('assert ')).length });
}
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', reports, checks: ['两种完整自定义设置入口', '真实滑块/开关/选项/文字输入及滚动', '返回与Escape保留菜单等待', '确认取消/接受及默认值恢复', '菜单结束后蓝图继续'] }, null, 2)); console.log(output);
