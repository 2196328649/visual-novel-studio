import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { storyGroupsFixture } from '../tests/fixtures/story-groups';
import { createStoryGroup } from '../src/core/story-groups';
import { blueprintNodeDefaults, createBlueprintGraph, synchronizeBlueprintSignatures, connectBlueprintPins } from '../src/core/blueprint';
import { compileProject } from '../src/runtime/compiler';
import { buildProject, runRenpy } from '../src/runtime/service';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { isolateRenpySaves } from './lib/renpy-saves';

const sdk = process.env.VNS_RENPY_SDK ?? path.resolve('resources/runtime');
const output = path.resolve('artifacts/story-groups-runtime', new Date().toISOString().replaceAll(':', '-'));
const source = path.join(output, 'source'), game = path.join(output, 'game');
await fs.mkdir(source, { recursive: true }); await isolateRenpySaves(output);
const report: { status: string; checks: { name: string; code: number; logPath: string }[]; error?: string } = { status: 'running', checks: [] };
const saveReport = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
async function check(name: string, result: { code: number; log: string }) {
  const logPath = path.join(output, name + '.log'); await fs.writeFile(logPath, result.log);
  report.checks.push({ name, code: result.code, logPath }); await saveReport();
  if (result.code) throw new Error(name + ': ' + result.log.slice(-6000));
}
try {
  const p = storyGroupsFixture(); p.id = 'story_groups_runtime'; p.ui.disabledPages = ['gallery'];
  p.variables.push({ id: 'scene_visits', name: '场景进入次数', type: 'number', initial: 0, persistent: false });
  const counter = createBlueprintGraph('function', '记录车站进入'); p.blueprints.push(counter);
  const read = blueprintNodeDefaults('getVariable'), add = blueprintNodeDefaults('math'), write = blueprintNodeDefaults('setVariable');
  read.properties.variableId = 'scene_visits'; add.properties = { operation: 'add', b: 1 }; write.properties.variableId = 'scene_visits';
  counter.nodes.push(read, add, write); synchronizeBlueprintSignatures(p);
  connectBlueprintPins(counter, counter.nodes[0].id, 'exec', write.id, 'exec_in');
  connectBlueprintPins(counter, read.id, 'value', add.id, 'a'); connectBlueprintPins(counter, add.id, 'result', write.id, 'value');
  p.scenes.find(scene => scene.id === 'station')!.blueprintId = counter.id;
  const before = compileProject(p).files;
  const group = createStoryGroup(p, { name: '车站支线', sceneId: 'station', nodeIds: ['opening', 'choice', 'leave_story', 'stay_story'], groupIds: [] });
  createStoryGroup(p, { name: '留下', sceneId: 'station', parentId: group.id, nodeIds: ['stay_story'], groupIds: [] });
  createStoryGroup(p, { name: '回忆模块', sceneId: 'common', nodeIds: ['memory', 'memory_return'], groupIds: [] });
  assert.deepEqual(compileProject(p).files, before);
  await fs.writeFile(path.join(output, 'project.json'), JSON.stringify(p, null, 2));
  const built = await buildProject({ project: p, projectDir: source, sdkRoot: sdk, outputDir: game, development: true });
  await check('compile', { code: built.ok ? 0 : 1, log: built.log + '\n' + JSON.stringify(built.diagnostics) });
  const tests = `testsuite global:
    before testcase:
        $ _test.timeout = 12.0
        $ _test.transition_timeout = 0.5
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
    after testcase:
        screenshot "last-state.png"
    teardown:
        exit

testcase grouped_branch_save_return:
    pause until screen "main_menu"
    click id "vn_main_start"
    pause until "钟声响起，我们来到车站。"
    assert eval (vn_current_node == "opening")
    assert eval (vn_current_scene == "station")
    assert eval (vn_var_scene_visits == 1)
    click
    pause until screen "choice"
    click "一起离开"
    pause until "请记住这个约定。"
    assert eval (vn_var_scene_visits == 1)
    click
    pause until "船还在等我们。"
    assert eval (vn_current_scene == "port")
    click
    pause until "那时我们还不知道明天的事。"
    assert eval (vn_current_node == "memory")
    assert eval (renpy.call_stack_depth() > 0)
    run FileSave("inside_group", confirm=False, slot=True)
    click
    pause until "我们在灯下继续谈话。"
    assert eval (vn_current_node == "stay_story")
    assert eval (vn_var_scene_visits == 2)
    screenshot "nested-multi-entry.png"
    run FileLoad("inside_group", confirm=False, slot=True)
    pause until "那时我们还不知道明天的事。"
    assert eval (vn_current_node == "memory")
    assert eval (renpy.call_stack_depth() > 0)
    assert eval (vn_var_scene_visits == 1)
    click
    pause until "我们在灯下继续谈话。"
    assert eval (vn_var_scene_visits == 2)
    click
    pause until "夜色渐深。"
    assert eval (vn_var_scene_visits == 2)
    run Rollback(force=True)
    pause until "我们在灯下继续谈话。"
    assert eval (vn_current_node == "stay_story")
    assert eval (vn_var_scene_visits == 2)
    click
    pause until "夜色渐深。"
    click
    pause until screen "main_menu"
    click id "vn_main_start"
    pause until "钟声响起，我们来到车站。"
    assert eval (vn_var_scene_visits == 1)
    click
    pause until screen "choice"
    click "留在车站"
    pause until "我们在灯下继续谈话。"
    assert eval (vn_var_scene_visits == 1)
    screenshot "alternative-branch.png"
    click
    pause until "夜色渐深。"
    click
    pause until screen "main_menu"
`;
  await fs.writeFile(path.join(game, 'game/testcases.rpy'), tests); await fs.writeFile(path.join(output, 'testcases.rpy'), tests);
  const options = { savedir: path.join(output, 'saves'), timeoutMs: 120000 };
  await check('lint', await runRenpy(sdk, game, ['lint'], options));
  const result = await runRenpy(sdk, game, ['test', '--report-detailed', '--report-skipped'], { ...options, onData: text => process.stdout.write(text) });
  await check('branches-save-load-rollback', result);
  if (!/Test cases\s*:\s*1\s*\|\s*1 passed/.test(result.log)) throw new Error('Native testcase did not pass');
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error); console.error(error); process.exitCode = 1; }
finally {
  try {
    for (const folder of [path.join(game, 'tests/screenshots'), path.join(game, 'game/tests/screenshots')]) if (await fs.stat(folder).then(stat => stat.isDirectory()).catch(() => false)) await fs.cp(folder, path.join(output, 'screenshots'), { recursive: true });
    const cleanup = await cleanVerificationDirectories(output, ['source', 'game', 'saves', 'renpy-saves']); assert.deepEqual(cleanup.errors, []);
  } catch (error) { report.status = 'failed'; report.error = [report.error, String(error)].filter(Boolean).join('\n'); process.exitCode = 1; }
  await saveReport();
}
console.log((report.status === 'passed' ? 'PASS: ' : 'FAIL: ') + path.join(output, 'report.json'));
