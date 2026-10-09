import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject } from '../src/core/model';
import { buildProject, runRenpy } from '../src/runtime/service';

const root = path.resolve('.'), output = path.join(root, 'artifacts/parameter-storage-runtime', new Date().toISOString().replaceAll(':', '-'));
const game = path.join(output, 'game'), sdk = path.join(root, 'resources/runtime');
const project = createProject('参数存储行为验证');
project.nodes.find(node => node.kind === 'passage')!.lines[0].text = '参数存储验证：停留在此句。';
project.variables = [
  { id: 'story_probe', name: '剧情参数', type: 'number', initial: 3, persistent: false },
  { id: 'persistent_probe', name: '本地参数', type: 'number', initial: 10, persistent: true, parameterSetId: 'parameters_game' },
];
const built = await buildProject({ project, outputDir: game, sdkRoot: sdk }); assert.ok(built.ok, JSON.stringify(built.diagnostics));
const prefix = `testsuite global:
    before testcase:
        $ _test.timeout = 20.0
    teardown:
        exit
`;
const cases = [
`testcase saves_and_new_game:
    run Start()
    pause 0.2
    assert eval vn_parameter_get("story_probe") == 3
    assert eval vn_parameter_get("persistent_probe") == 10
    run Function(vn_parameter_set, "story_probe", 7)
    run Function(vn_parameter_set, "persistent_probe", 20)
    run FileSave("parameter_storage", confirm=False, slot=True)
    run Function(vn_parameter_set, "story_probe", 9)
    run Function(vn_parameter_set, "persistent_probe", 30)
    run FileLoad("parameter_storage", confirm=False, slot=True)
    pause 0.2
    assert eval vn_parameter_get("story_probe") == 7
    assert eval vn_parameter_get("persistent_probe") == 30
    run MainMenu(confirm=False)
    run Start()
    pause 0.2
    assert eval vn_parameter_get("story_probe") == 3
    assert eval vn_parameter_get("persistent_probe") == 30
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
  const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 60000, env: { SDL_VIDEO_WINDOW_POS: '2400,0' } });
  await fs.writeFile(path.join(output, `runtime-${index + 1}.log`), result.log);
  assert.ok(result.code === 0 && /Test cases\s*:\s*1\s*\|\s*1 passed/.test(result.log), result.log.slice(-5000));
}
await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ status: 'passed', checks: ['普通参数读档恢复存档值，新游戏恢复初始值', '持久化参数不随旧存档回退，新游戏保留', '重启游戏进程后持久化值保留，普通参数可通过存档恢复', '恢复玩家设置默认值只重置设置参数'] }, null, 2));
console.log(output);
