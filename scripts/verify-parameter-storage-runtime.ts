import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject } from '../src/core/model';
import { buildProject, runRenpy } from '../src/runtime/service';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { createUiParameterBinding } from '../src/core/ui-logic';

const root = path.resolve('.'), output = path.join(root, 'artifacts/parameter-storage-runtime', new Date().toISOString().replaceAll(':', '-'));
const game = path.join(output, 'game'), sdk = path.join(root, 'resources/runtime');
const project = createProject('参数存储行为验证');
project.nodes.find(node => node.kind === 'passage')!.lines[0].text = '参数存储验证：停留在此句。';
project.variables = [
  { id: 'story_probe', name: '剧情参数', type: 'number', initial: 3, persistent: false },
  { id: 'persistent_probe', name: '本地参数', type: 'number', initial: 10, persistent: true, parameterSetId: 'parameters_game' },
];
project.ui.components.push({ id: 'state_caption', kind: 'text', page: 'say', text: '参数可见', x: .1, y: .1, width: .5, height: .12, visibleWhen: { kind: 'compare', variableId: 'story_probe', operator: 'gte', value: 7 } });
project.variables.push({ id: 'caption_probe', name: '联动文字', type: 'string', initial: '初始文字', persistent: false });
createUiParameterBinding(project, 'state_caption', 'text', 'caption_probe', 'ui:say');
const report: Record<string, unknown> = { status: 'running', runs: [] };
let assertions = 0;
await fs.mkdir(output, { recursive: true });
try {
const built = await buildProject({ project, outputDir: game, sdkRoot: sdk }); assert.ok(built.ok, JSON.stringify(built.diagnostics));
await fs.writeFile(path.join(output, 'build.log'), built.log);
const prefix = `testsuite global:
    before testcase:
        $ _test.timeout = 20.0
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit
`;
const cases = [
`testcase saves_and_new_game:
    run Start()
    pause 0.2
    assert eval vn_parameter_get("story_probe") == 3
    assert eval vn_parameter_get("persistent_probe") == 10
    run Function(vn_parameter_set, "caption_probe", "参数驱动界面")
    pause until eval vn_ui_get("state_caption", "text") == "参数驱动界面"
    assert eval not vn_ui_component_available("state_caption")
    run Function(vn_parameter_set, "story_probe", 7)
    run Function(vn_parameter_set, "persistent_probe", 20)
    assert eval vn_ui_component_available("state_caption")
    run FileSave("parameter_storage", confirm=False, slot=True)
    run Function(vn_parameter_set, "story_probe", 9)
    run Function(vn_parameter_set, "persistent_probe", 30)
    run FileLoad("parameter_storage", confirm=False, slot=True)
    pause 0.2
    assert eval vn_parameter_get("story_probe") == 7
    assert eval vn_parameter_get("persistent_probe") == 30
    pause until eval vn_ui_get("state_caption", "text") == "参数驱动界面"
    assert eval vn_parameter_get("caption_probe") == "参数驱动界面"
    screenshot "restored-parameter-ui.png"
    run MainMenu(confirm=False)
    run Start()
    pause 0.2
    assert eval vn_parameter_get("story_probe") == 3
    assert eval vn_parameter_get("persistent_probe") == 30
    assert eval vn_parameter_get("caption_probe") == "初始文字"
`,
`testcase after_process_restart:
    assert eval vn_parameter_get("persistent_probe") == 30
    run Start()
    pause 0.2
    assert eval vn_parameter_get("story_probe") == 3
    assert eval vn_parameter_get("persistent_probe") == 30
    run FileLoad("parameter_storage", confirm=False, slot=True)
    pause 0.2
    assert eval vn_parameter_get("story_probe") == 7
    assert eval vn_parameter_get("persistent_probe") == 30
    run Function(vn_parameter_reset_settings)
    assert eval vn_parameter_get("story_probe") == 7
    assert eval vn_parameter_get("persistent_probe") == 10
`,
];
for (const [index, testcase] of cases.entries()) {
  await fs.writeFile(path.join(game, 'game/testcases.rpy'), prefix + testcase);
  const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 60000 });
  await fs.writeFile(path.join(output, `runtime-${index + 1}.log`), result.log);
  for (const folder of [path.join(game, 'tests/screenshots'), path.join(game, 'game/tests/screenshots')]) if (await fs.stat(folder).then(stat => stat.isDirectory()).catch(() => false)) await fs.cp(folder, path.join(output, 'screenshots'), { recursive: true });
  assert.ok(result.code === 0 && /Test cases\s*:\s*1\s*\|\s*1 passed/.test(result.log), result.log.slice(-5000));
  const count = Number(result.log.match(/Assertions\s*:\s*(\d+)/)?.[1]); assert.equal(count, (testcase.match(/^    assert /gm) ?? []).length); assertions += count;
  (report.runs as unknown[]).push({ case: index + 1, assertions: count, status: 'passed' });
}
// The previous processes created real number-valued saves and persistence.
// Rebuild the same game ID with changed types and load those files unchanged.
project.variables.find(variable => variable.id === 'story_probe')!.type = 'string';
project.variables.find(variable => variable.id === 'story_probe')!.initial = '新的剧情值';
project.variables.find(variable => variable.id === 'persistent_probe')!.type = 'boolean';
project.variables.find(variable => variable.id === 'persistent_probe')!.initial = false;
const caption = project.ui.components.find(component => component.id === 'state_caption')!;
caption.visibleWhen = { kind: 'compare', variableId: 'story_probe', operator: 'eq', value: '新的剧情值' };
const migrated = await buildProject({ project, outputDir: game, sdkRoot: sdk }); assert.ok(migrated.ok, JSON.stringify(migrated.diagnostics));
const migrationCase = `testcase changed_parameter_types:
    run Start()
    pause 0.2
    assert eval vn_parameter_get("persistent_probe") is False
    assert eval vn_parameter_get("story_probe") == "新的剧情值"
    run FileLoad("parameter_storage", confirm=False, slot=True)
    pause 0.2
    assert eval vn_parameter_get("persistent_probe") is False
    assert eval vn_parameter_get("story_probe") == "新的剧情值"
    assert eval vn_parameter_get("caption_probe") == "参数驱动界面"
    pause until eval vn_ui_get("state_caption", "text") == "参数驱动界面"
    assert eval vn_ui_component_available("state_caption")
`;
await fs.writeFile(path.join(game, 'game/testcases.rpy'), prefix + migrationCase);
const migration = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 60000 });
await fs.writeFile(path.join(output, 'runtime-migration.log'), migration.log);
assert.ok(migration.code === 0 && /Test cases\s*:\s*1\s*\|\s*1 passed/.test(migration.log), migration.log.slice(-5000));
const migrationAssertions = Number(migration.log.match(/Assertions\s*:\s*(\d+)/)?.[1]); assert.equal(migrationAssertions, 6); assertions += migrationAssertions;
(report.runs as unknown[]).push({ case: 'changed-types', assertions: migrationAssertions, status: 'passed' });
report.assertions = assertions; report.cases = 3; report.status = 'passed';
report.checks = ['普通参数读档恢复存档值，新游戏恢复初始值', '持久化参数不随旧存档回退，新游戏及进程重启保留', '恢复玩家设置默认值只重置设置参数', '参数驱动界面文字和条件显示，读档保持绑定', '改类型后的游戏真实读取上一版存档与持久化，只重置不兼容值'];
} catch (error) { report.status = 'failed'; report.error = String(error); process.exitCode = 1; console.error(error); }
finally {
  try {
    for (const folder of [path.join(game, 'tests/screenshots'), path.join(game, 'game/tests/screenshots')]) if (await fs.stat(folder).then(stat => stat.isDirectory()).catch(() => false)) await fs.cp(folder, path.join(output, 'screenshots'), { recursive: true });
    report.cleanup = await cleanVerificationDirectories(output, ['game', 'saves']);
  } catch (error) { report.status = 'failed'; report.cleanupError = String(error); process.exitCode = 1; }
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
}
console.log(output);
