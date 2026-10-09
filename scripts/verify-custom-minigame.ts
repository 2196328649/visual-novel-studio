import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { createProject, projectSchema, type UiComponent } from '../src/core/model';
import { compileProject } from '../src/runtime/compiler';
import { buildProject, runRenpy } from '../src/runtime/service';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'artifacts', 'custom-minigame-source');
const output = path.join(root, 'artifacts', 'custom-minigame-build');
await fs.mkdir(path.join(source, 'scripts'), { recursive: true });
await fs.writeFile(path.join(source, 'scripts', 'minigame_logic.rpy'), `label custom_minigame_entry:
    $ vn_minigame_set("status", "脚本已初始化")
    $ vn_minigame_set("progress", 0.65)
    return
`, 'utf8');

const project = createProject('自定义小游戏运行验证');
const intro = project.nodes.find(node => node.kind === 'passage');
if (intro?.kind === 'passage') intro.lines[0].text = '开始挑战';
project.assets.push({ id: 'minigame_script', name: '小游戏脚本', kind: 'script', path: 'scripts/minigame_logic.rpy' });

const initGraph = createBlueprintGraph('minigame', '小游戏初始化');
const setValue = blueprintNodeDefaults('setMinigameValue', 1);
setValue.properties = { key: 'progress', value: 0.4 };
const getValue = blueprintNodeDefaults('getMinigameValue', 2);
getValue.properties = { key: 'progress', defaultValue: 0 };
getValue.pins[0].dataType = 'number';
const setProgress = blueprintNodeDefaults('setUiProperty', 3);
setProgress.properties = { componentId: 'game_progress', property: 'value', value: 0 };
const valuePin = setProgress.pins.find(pin => pin.id === 'value');
if (valuePin) { valuePin.dataType = 'number'; valuePin.defaultValue = 0; }
initGraph.nodes.push(setValue, getValue, setProgress);
assert.equal(connectBlueprintPins(initGraph, initGraph.nodes[0].id, 'exec', setValue.id, 'exec_in'), undefined);
assert.equal(connectBlueprintPins(initGraph, setValue.id, 'exec_out', setProgress.id, 'exec_in'), undefined);
assert.equal(connectBlueprintPins(initGraph, getValue.id, 'value', setProgress.id, 'value'), undefined);

const finishGraph = createBlueprintGraph('ui', '完成小游戏');
const finish = blueprintNodeDefaults('finishMinigame', 1);
finish.properties.result = 'success';
finishGraph.nodes.push(finish);
assert.equal(connectBlueprintPins(finishGraph, finishGraph.nodes[0].id, 'exec', finish.id, 'exec_in'), undefined);
project.blueprints = [initGraph, finishGraph];

const components: UiComponent[] = [
  { id: 'game_panel', page: 'custom', kind: 'panel', text: '', x: 0.15, y: 0.12, width: 0.7, height: 0.76, style: { background: '#182124' } },
  { id: 'game_title', page: 'custom', kind: 'text', text: '', binding: 'minigameTitle', x: 0.25, y: 0.2, width: 0.5, height: 0.1 },
  { id: 'game_prompt', page: 'custom', kind: 'text', text: '', binding: 'minigamePrompt', x: 0.25, y: 0.34, width: 0.5, height: 0.1 },
  { id: 'game_status', page: 'custom', kind: 'text', text: '', binding: 'minigameStatus', x: 0.25, y: 0.46, width: 0.5, height: 0.08 },
  { id: 'game_progress', page: 'custom', kind: 'progress', text: '', value: 0, x: 0.25, y: 0.58, width: 0.5, height: 0.05 },
  { id: 'game_finish', page: 'custom', kind: 'button', text: '完成', action: 'blueprint', blueprintId: finishGraph.id, x: 0.4, y: 0.7, width: 0.2, height: 0.1 },
];
project.ui.customPages = [{ id: 'game_page', name: '小游戏交互页', components, background: '#101719', modal: true }];
project.minigames = [
  { id: 'blueprint_game', name: '蓝图小游戏', mode: 'blueprint', blueprintId: initGraph.id, uiPageId: 'game_page' },
  { id: 'script_game', name: '脚本小游戏', mode: 'script', script: { assetId: 'minigame_script', entry: 'custom_minigame_entry', args: {} }, uiPageId: 'game_page' },
];

const passage = project.nodes.find(node => node.kind === 'passage');
const ending = project.nodes.find(node => node.kind === 'end');
assert.ok(passage?.kind === 'passage' && ending);
passage.next = 'blueprint_game_node';
const gameNode = (id: string, minigameId: string, next: string) => ({
  id, sceneId: passage.sceneId, name: id, x: 500, y: 100, kind: 'minigame' as const, template: 'custom' as const,
  title: '自定义挑战', prompt: '完成当前互动', password: '', caseSensitive: false, attempts: 1, targetClicks: 1, timeLimit: 10,
  minigameId, success: next, failure: next, cancel: next,
});
project.nodes.push(gameNode('blueprint_game_node', 'blueprint_game', 'script_game_node'), gameNode('script_game_node', 'script_game', ending.id));
synchronizeBlueprintSignatures(project);
projectSchema.parse(project);

const compiled = compileProject(project);
assert.deepEqual(compiled.diagnostics.filter(item => item.severity === 'error'), []);
assert.match(compiled.files['game/screens.rpy'], /screen vn_custom_page_game_page/);
assert.match(compiled.files['game/screens.rpy'], /screen vn_minigame_custom/);
assert.match(compiled.files['game/story.rpy'], /vn_minigame_set\("progress", 0\.4\)/);
assert.match(compiled.files['game/story.rpy'], /vn_minigame_get\("progress", 0\)/);
assert.match(compiled.files['game/story.rpy'], /vn_finish_minigame\("success"\)/);
assert.match(compiled.files['game/story.rpy'], /call expression "custom_minigame_entry" pass \(\*\*\{\}\)/);

const result = await buildProject({ project, projectDir: source, sdkRoot: path.resolve(root, '..'), outputDir: output, development: true });
if (!result.ok) throw new Error(result.log || result.diagnostics.map(item => item.message).join('\n'));
await fs.writeFile(path.join(output, 'game', 'testcases.rpy'), `testsuite global:\r\n    before testcase:\r\n        $ _test.timeout = 12.0\r\n        $ _test.transition_timeout = 0.05\r\n        $ preferences.text_cps = 0\r\n        $ preferences.afm_enable = False\r\n    teardown:\r\n        exit\r\n\r\ntestcase custom_minigame_blueprint_and_script:\r\n    click id "vn_main_start"\r\n    advance\r\n    pause until screen "vn_minigame_custom"\r\n    assert eval (vn_minigame_get("progress", 0) == 0.4)\r\n    click id "vn_component_game_finish"\r\n    pause until eval renpy.get_screen("vn_minigame_custom") is not None and vn_minigame_context.get("minigameId") == "script_game"\r\n    assert eval (vn_minigame_status() == "脚本已初始化")\r\n    assert eval (vn_minigame_get("progress", 0) == 0.65)\r\n    click id "vn_component_game_finish"\r\n    advance until "故事结束"\r\n`);
const testcasePath = path.join(output, 'game', 'testcases.rpy');
const testcaseSource = await fs.readFile(testcasePath, 'utf8');
await fs.writeFile(testcasePath, testcaseSource.replace('click id "vn_main_start"\r\n    advance\r\n    pause until screen "vn_minigame_custom"\r\n', 'click id "vn_main_start"\r\n    advance until screen "vn_minigame_custom"\r\n'));
const sdk = path.resolve(root, '..');
const lint = await runRenpy(sdk, output, ['lint']);
if (lint.code !== 0) throw new Error(`Ren'Py lint failed:\n${lint.log}`);
const tested = await runRenpy(sdk, output, ['test', '--report-detailed', '--report-skipped'], { timeoutMs: 120000 });
if (tested.code !== 0 || !/Test cases\s*:\s*1\s*\|\s*1 passed/.test(tested.log)) throw new Error(`Ren'Py custom minigame test failed:\n${tested.log}`);
console.log(`Custom Blueprint and .rpy minigames compiled successfully: ${output}`);
