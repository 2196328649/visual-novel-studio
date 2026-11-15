import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createProject, type BlueprintGraph } from '../src/core/model';
import type { GameFlow } from '../src/core/game-flow-schema';
import type { PreviewOptions } from '../src/core/bridge';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { addGameFlowStep, createCustomUiPage } from '../src/core/game-flow';
import { buildProject, runRenpy } from '../src/runtime/service';

type Scenario = {
  id: string; profile: string; repeat: GameFlow['beforeTitle']['repeat']; revision?: string;
  preview?: 'launch' | 'title'; boot: number; returned: number; seen?: string[];
};
const scenarios: Scenario[] = [
  { id: 'launch-first', profile: 'launch', repeat: 'launch', boot: 1, returned: 1 },
  { id: 'launch-restart', profile: 'launch', repeat: 'launch', boot: 2, returned: 2 },
  { id: 'title-first', profile: 'title', repeat: 'title', boot: 1, returned: 2 },
  { id: 'title-restart', profile: 'title', repeat: 'title', boot: 3, returned: 4 },
  { id: 'profile-first', profile: 'profile', repeat: 'profile', boot: 1, returned: 1, seen: ['profile'] },
  { id: 'profile-restart', profile: 'profile', repeat: 'profile', boot: 1, returned: 1, seen: ['profile'] },
  { id: 'profile-fresh', profile: 'fresh-player', repeat: 'profile', boot: 1, returned: 1, seen: ['profile'] },
  { id: 'version-first', profile: 'version', repeat: 'version', boot: 1, returned: 1, seen: ['version:1'] },
  { id: 'version-restart', profile: 'version', repeat: 'version', boot: 1, returned: 1, seen: ['version:1'] },
  { id: 'version-update', profile: 'version', repeat: 'version', revision: '2', boot: 2, returned: 2, seen: ['version:1', 'version:2'] },
  { id: 'version-return-old', profile: 'version', repeat: 'version', boot: 2, returned: 2, seen: ['version:1', 'version:2'] },
  // Deliberately reuse each isolated preview profile across processes too:
  // first-run markers must remain session-local even in this stricter case.
  { id: 'preview-profile-first', profile: 'profile', repeat: 'profile', preview: 'launch', boot: 1, returned: 1 },
  { id: 'preview-profile-restart', profile: 'profile', repeat: 'profile', preview: 'launch', boot: 2, returned: 2 },
  { id: 'preview-version-first', profile: 'version', repeat: 'version', preview: 'launch', boot: 1, returned: 1 },
  { id: 'preview-version-restart', profile: 'version', repeat: 'version', preview: 'launch', boot: 2, returned: 2 },
  { id: 'preview-title-origin', profile: 'title', repeat: 'title', preview: 'title', boot: 0, returned: 1 },
  { id: 'preview-title-origin-restart', profile: 'title', repeat: 'title', preview: 'title', boot: 1, returned: 2 },
  { id: 'preview-launch-first', profile: 'launch-origin-launch', repeat: 'launch', preview: 'launch', boot: 1, returned: 1 },
  { id: 'preview-launch-restart', profile: 'launch-origin-launch', repeat: 'launch', preview: 'launch', boot: 2, returned: 2 },
  { id: 'preview-each-title-first', profile: 'launch-origin-title', repeat: 'title', preview: 'launch', boot: 1, returned: 2 },
  { id: 'preview-each-title-restart', profile: 'launch-origin-title', repeat: 'title', preview: 'launch', boot: 3, returned: 4 },
  { id: 'preview-title-launch-first', profile: 'title-origin-launch', repeat: 'launch', preview: 'title', boot: 0, returned: 1 },
  { id: 'preview-title-launch-restart', profile: 'title-origin-launch', repeat: 'launch', preview: 'title', boot: 1, returned: 2 },
  { id: 'preview-title-profile-first', profile: 'title-origin-profile', repeat: 'profile', preview: 'title', boot: 0, returned: 1 },
  { id: 'preview-title-profile-restart', profile: 'title-origin-profile', repeat: 'profile', preview: 'title', boot: 1, returned: 2 },
  { id: 'preview-title-version-first', profile: 'title-origin-version', repeat: 'version', preview: 'title', boot: 0, returned: 1 },
  { id: 'preview-title-version-restart', profile: 'title-origin-version', repeat: 'version', preview: 'title', boot: 1, returned: 2 },
];
const root = path.resolve('.'), sdk = process.env.VNS_RENPY_SDK ?? 'E:/Tools/renpy-8.5.3-sdk';
const output = path.join(root, 'artifacts/game-flow-policies', new Date().toISOString().replaceAll(':', '-'));
const playerRoot = path.join(output, 'saves/players');
type Check = { name: string; code: number; logPath: string };
const report: { status: string; scenarios: (Scenario & { savedir: string; checks: Check[]; assertions?: number })[]; playerProfilesUnchanged?: boolean; error?: string } = { status: 'running', scenarios: [] };
await fs.mkdir(output, { recursive: true });
const saveReport = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));

async function profileSnapshot(directory: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const visit = async (folder: string) => {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) result[path.relative(directory, file)] = createHash('sha256').update(await fs.readFile(file)).digest('hex');
    }
  };
  await visit(directory);
  return result;
}

try {
  let playersBeforePreview: Record<string, string> | undefined;
  for (const scenario of scenarios) {
    if (scenario.preview && !playersBeforePreview) playersBeforePreview = await profileSnapshot(playerRoot);
    const folder = path.join(output, scenario.id), source = path.join(folder, 'source'), game = path.join(folder, 'game');
    const savedir = path.join(output, 'saves', scenario.preview ? 'previews' : 'players', scenario.profile);
    const record: (typeof report.scenarios)[number] = { ...scenario, savedir, checks: [] };
    report.scenarios.push(record);
    await fs.mkdir(source, { recursive: true });
    const check = async (name: string, result: { code: number; log: string }) => {
      const logPath = path.join(folder, name + '.log'); await fs.writeFile(logPath, result.log);
      record.checks.push({ name, code: result.code, logPath }); await saveReport();
      if (result.code) throw new Error(scenario.id + ' / ' + name + ': ' + result.log.slice(-6000));
    };
    const p = createProject('启动执行策略与预览隔离验收'); p.id = 'flow_policy_verification';
    p.ui.disabledPages = ['gallery'];
    p.variables = [
      { id: 'visits', name: '启动执行次数', type: 'number', initial: 0, persistent: true },
      { id: 'games', name: '开局次数', type: 'number', initial: 0, persistent: true },
      { id: 'local', name: '本局变量', type: 'number', initial: 7, persistent: false },
      { id: 'setting', name: '玩家设置', type: 'string', initial: 'player-setting', persistent: true },
    ];
    const counter = (variableId: string) => {
      const graph: BlueprintGraph = createBlueprintGraph('function', '记录 ' + variableId); p.blueprints.push(graph);
      const read = blueprintNodeDefaults('getVariable'), add = blueprintNodeDefaults('math'), write = blueprintNodeDefaults('setVariable');
      read.properties.variableId = variableId; add.properties = { operation: 'add', b: 1 }; write.properties.variableId = variableId;
      graph.nodes.push(read, add, write); synchronizeBlueprintSignatures(p);
      for (const edge of [[graph.nodes[0].id, 'exec', write.id, 'exec_in'], [read.id, 'value', add.id, 'a'], [add.id, 'result', write.id, 'value']]) {
        const error = connectBlueprintPins(graph, edge[0], edge[1], edge[2], edge[3]); if (error) throw new Error(error);
      }
      return graph.id;
    };
    addGameFlowStep(p, 'beforeTitle', { kind: 'blueprint', graphId: counter('visits') });
    const page = createCustomUiPage(p, '自动完成的启动页面');
    addGameFlowStep(p, 'beforeTitle', { kind: 'page', pageId: page.id, completion: 'auto', duration: .08 });
    addGameFlowStep(p, 'beforeNewGame', { kind: 'blueprint', graphId: counter('games') });
    p.gameFlow!.beforeTitle.repeat = scenario.repeat; p.gameFlow!.beforeTitle.revision = scenario.revision ?? '1';
    const passage = p.nodes.find(n => n.kind === 'passage')!; passage.lines[0].text = '执行策略已进入剧情。';
    const preview: PreviewOptions | undefined = scenario.preview ? { flowStart: scenario.preview, entryId: passage.id, variables: { local: 42, setting: 'preview-setting' } } : undefined;
    await fs.writeFile(path.join(source, 'project.vns.json'), JSON.stringify(p, null, 2));
    const built = await buildProject({ project: p, projectDir: source, sdkRoot: sdk, outputDir: game, development: true, preview });
    await check('compile', { code: built.ok ? 0 : 1, log: built.log + '\n' + JSON.stringify(built.diagnostics) });
    const sessionSeen = scenario.preview && ['profile', 'version'].includes(scenario.repeat)
      ? [scenario.repeat === 'profile' ? 'profile' : 'version:' + (scenario.revision ?? '1')] : [];
    const bootSessionSeen = scenario.preview === 'title' ? [] : sessionSeen;
    await fs.writeFile(path.join(game, 'game/testcases.rpy'), `testsuite global:
    before testcase:
        $ _test.timeout = 12.0
        $ _test.transition_timeout = 0.5
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
    after testcase:
        screenshot "last-state.png"
    teardown:
        exit

testcase startup_policy:
    pause until screen "main_menu"
    assert eval (persistent.vn_var_visits == ${scenario.boot})
    assert eval (set((persistent.vn_game_flow_seen or {}).keys()) == set(${JSON.stringify(scenario.seen ?? [])}))
    assert eval (set(renpy.session.get("vn_flow_preview_seen", {}).keys()) == set(${JSON.stringify(bootSessionSeen)}))
    assert eval (not vn_ui_open_pages and not vn_ui_page_sessions)
    assert eval (not renpy.session.get("vn_flow_skip_title_once", False))
    assert eval (vn_flow_active_step is None)
    $ games_before = persistent.vn_var_games
    click id "vn_main_start"
    pause until "执行策略已进入剧情。"
    assert eval (persistent.vn_var_games == games_before + 1)
    assert eval (vn_var_local == ${scenario.preview ? 42 : 7})
    assert eval (persistent.vn_var_setting == "${scenario.preview ? 'preview-setting' : 'player-setting'}")
    $ vn_var_local = 29
    run FileSave("policy_save", confirm=False, slot=True)
    run MainMenu(confirm=False)
    pause until screen "main_menu"
    assert eval (persistent.vn_var_visits == ${scenario.returned})
    assert eval (set((persistent.vn_game_flow_seen or {}).keys()) == set(${JSON.stringify(scenario.seen ?? [])}))
    assert eval (set(renpy.session.get("vn_flow_preview_seen", {}).keys()) == set(${JSON.stringify(sessionSeen)}))
    assert eval (not vn_ui_open_pages and not vn_ui_page_sessions)
    run FileLoad("policy_save", confirm=False, slot=True)
    pause until "执行策略已进入剧情。"
    assert eval (vn_var_local == 29)
    assert eval (persistent.vn_var_games == games_before + 1)
    assert eval (persistent.vn_var_visits == ${scenario.returned})
    assert eval (persistent.vn_var_setting == "${scenario.preview ? 'preview-setting' : 'player-setting'}")
`);
    const options = { savedir, timeoutMs: 120000 };
    await check('lint', await runRenpy(sdk, game, ['lint'], options));
    const result = await runRenpy(sdk, game, ['test', '--report-detailed'], options);
    await check('runtime', result);
    if (!/Test cases\s*:\s*1\s*\|\s*1 passed/.test(result.log)) throw new Error(scenario.id + ': missing passed testcase');
    record.assertions = Number(result.log.match(/Assertions\s*:\s*(\d+)\s*\|\s*\d+ passed/)?.[1] ?? 0);
    assert.ok(record.assertions > 0);
    console.log('PASS: ' + scenario.id + ' / ' + record.assertions + ' assertions');
    await saveReport();
  }
  assert.ok(playersBeforePreview && Object.keys(playersBeforePreview).length);
  assert.deepEqual(await profileSnapshot(playerRoot), playersBeforePreview);
  report.playerProfilesUnchanged = true;
  report.status = 'passed'; await saveReport(); console.log('PASS: ' + path.join(output, 'report.json'));
} catch (error) {
  report.status = 'failed'; report.error = String(error); await saveReport(); console.error(error); process.exitCode = 1;
}
