// Image and audio parameters in the real Ren'Py runtime: @设置-style writes, a parameter-bound
// image component with its fallback, blueprint music playback (empty = skip), stale-asset
// repair after load, and "restore default" for a persistent asset parameter.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProject, projectSchema, type BlueprintGraph, type StoryNode, type UiComponent } from '../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { gameParametersId, storyParametersId } from '../src/core/parameter-sets';
import { compileProject } from '../src/runtime/compiler';
import { buildProject, runRenpy } from '../src/runtime/service';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { endingPerformanceNodes } from '../src/core/ending-migration';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const example = path.join(root, 'resources', 'example'), sdk = path.join(root, 'resources', 'runtime');
const output = path.join(root, 'artifacts', 'asset-parameters-runtime', new Date().toISOString().replaceAll(':', '-'));
const game = path.join(output, 'game');
const report: { status: string; checks: { name: string; code: number }[]; cases?: number; assertions?: number; screenshots?: number; error?: string; cleanup?: unknown } = { status: 'running', checks: [] };
const save = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
async function check(name: string, result: { code: number; log: string }) {
  await fs.writeFile(path.join(output, name + '.log'), result.log); report.checks.push({ name, code: result.code }); await save();
  assert.equal(result.code, 0, name + ': ' + result.log.slice(-8000));
}
try {
  await fs.mkdir(output, { recursive: true });
  const sample = projectSchema.parse(JSON.parse(await fs.readFile(path.join(example, 'project.vns.json'), 'utf8')));
  const images = sample.assets.filter(asset => asset.kind === 'image'), music = sample.assets.find(asset => asset.kind === 'audio')!;
  const [own, first, second] = images;
  assert.ok(own && first && second && music, 'The bundled example needs three images and one audio file.');
  const project = createProject('素材参数运行验收');
  project.id = 'asset_parameters_runtime';
  project.assets = [own, first, second, music].map(asset => structuredClone(asset));
  project.variables = [
    { id: 'ap_avatar', name: '头像', type: 'asset', assetKind: 'image', initial: first.id, persistent: false, parameterSetId: storyParametersId },
    { id: 'ap_theme', name: '主题曲', type: 'asset', assetKind: 'audio', initial: '', persistent: false, parameterSetId: storyParametersId },
    { id: 'ap_skin', name: '界面皮肤', type: 'asset', assetKind: 'image', initial: first.id, persistent: true, parameterSetId: gameParametersId },
  ];
  const portrait: UiComponent = { id: 'ap_portrait', page: 'say', kind: 'image', text: '', assetId: own.id, assetParameterId: 'ap_avatar', x: .72, y: .08, width: .2, height: .3 };
  project.ui.components.push(portrait);
  const graph: BlueprintGraph = { id: 'ap_play', name: '播放主题曲', kind: 'function', nodes: [], links: [], exposedInputs: [], exposedOutputs: [] };
  const event = blueprintNodeDefaults('event', 0), read = blueprintNodeDefaults('getVariable', 1), play = blueprintNodeDefaults('playMusic', 2);
  event.id = 'ap_event'; read.id = 'ap_read'; read.properties.variableId = 'ap_theme'; play.id = 'ap_music'; play.properties.fade = 0;
  graph.nodes.push(event, read, play); project.blueprints = [graph];
  synchronizeBlueprintSignatures(project);
  for (const [from, fromPin, to, toPin] of [[event, 'exec', play, 'exec_in'], [read, 'value', play, 'assetId']] as const) assert.equal(connectBlueprintPins(graph, from.id, fromPin, to.id, toPin), undefined);
  const base = { sceneId: project.scenes[0].id, x: 0, y: 0 };
  const set = (id: string, variableId: string, value: string, next: string): StoryNode => ({ ...base, id, name: '设置 ' + id, kind: 'set', variableId, operation: 'set', value, next });
  const line = (id: string, text: string, play = false) => ({ id: id + '_line', text, actions: play ? [{ kind: 'blueprint' as const, blueprintId: graph.id }] : [] });
  project.entryId = 'ap_start';
  project.nodes = [
    { ...base, id: 'ap_start', name: '开始', kind: 'start', next: 'ap_first' },
    { ...base, id: 'ap_first', name: '初始', kind: 'passage', next: 'ap_set_avatar', lines: [line('ap_first', '参数为初始头像，主题曲为空。', true)] },
    set('ap_set_avatar', 'ap_avatar', second.id, 'ap_set_theme'), set('ap_set_theme', 'ap_theme', music.id, 'ap_second'),
    { ...base, id: 'ap_second', name: '切换', kind: 'passage', next: 'ap_clear', lines: [line('ap_second', '头像与主题曲已切换。', true)] },
    set('ap_clear', 'ap_avatar', '', 'ap_third'),
    { ...base, id: 'ap_third', name: '清空', kind: 'passage', next: 'ap_finish', lines: [line('ap_third', '头像参数已清空。')] },
    ...endingPerformanceNodes(project, { ...base, id: 'ap_finish', name: '结束' }, '素材参数验收结束。'),
  ];
  const parsed = projectSchema.parse(project);
  const compiled = compileProject(parsed);
  assert.deepEqual(compiled.diagnostics.filter(item => item.severity === 'error'), []);
  const built = await buildProject({ project: parsed, projectDir: example, sdkRoot: sdk, outputDir: game, development: true });
  await check('compile', { code: built.ok ? 0 : 1, log: built.log + '\n' + JSON.stringify(built.diagnostics) });
  const q = JSON.stringify, path_ = (id: string) => q(parsed.assets.find(asset => asset.id === id)!.path.replaceAll('\\', '/'));
  const shown = 'vn_bp_optional_asset(vn_ui_get("ap_portrait", "image"), "image")';
  const tests = [
    'testcase asset_parameters_follow_story_and_blueprints:',
    '    click id "vn_main_start"', '    advance until "参数为初始头像，主题曲为空。"',
    `    assert eval (vn_var_ap_avatar == ${q(first.id)} and ${shown} == ${path_(first.id)})`,
    '    assert eval (vn_var_ap_theme == "" and renpy.music.get_playing(channel="music") is None)',
    '    screenshot "01-initial-avatar.png"',
    '    advance until "头像与主题曲已切换。"',
    `    assert eval (vn_var_ap_avatar == ${q(second.id)} and ${shown} == ${path_(second.id)})`,
    `    assert eval (renpy.music.get_playing(channel="music") == ${path_(music.id)})`,
    '    screenshot "02-switched-avatar.png"',
    '    advance until "头像参数已清空。"',
    `    assert eval (vn_var_ap_avatar == "" and ${shown} == ${path_(own.id)})`,
    '    screenshot "03-fallback-image.png"',
    '    $ vn_var_ap_avatar = "deleted_asset"',
    `    assert eval (${shown} == ${path_(own.id)})`,
    '    run Function(vn_parameter_repair_assets)',
    `    assert eval (vn_var_ap_avatar == ${q(first.id)})`,
    '',
    'testcase persistent_asset_parameter_repair_and_reset:',
    '    run Function(vn_parameter_set, "ap_skin", ' + q(second.id) + ', False)',
    `    assert eval (persistent.vn_var_ap_skin == ${q(second.id)})`,
    '    $ persistent.vn_var_ap_skin = "removed_in_new_build"',
    '    run Function(vn_parameter_repair_assets)',
    `    assert eval (persistent.vn_var_ap_skin == ${q(first.id)})`,
    '    run Function(vn_parameter_set, "ap_skin", ' + q(second.id) + ', False)',
    '    run Function(vn_parameter_reset_settings, False)',
    `    assert eval (persistent.vn_var_ap_skin == ${q(first.id)})`,
    '    assert eval not renpy.has_screen("vn_parameter_settings")',
  ];
  await fs.writeFile(path.join(game, 'game', 'testcases.rpy'), [
    'testsuite global:', '    before testcase:', '        $ _test.timeout = 15.0', '        $ _test.transition_timeout = 0.05',
    '        $ _test.screenshot_directory = "tests/screenshots"', '        $ preferences.text_cps = 0', '        $ preferences.afm_enable = False',
    '        if not screen "main_menu":', '            run MainMenu(confirm=False)', '    teardown:', '        exit', '', ...tests, '',
  ].join('\n'));
  const options = { savedir: path.join(output, 'saves'), timeoutMs: 180000 };
  await check('lint', await runRenpy(sdk, game, ['lint'], options));
  const result = await runRenpy(sdk, game, ['test', '--report-detailed', '--report-skipped'], { ...options, onData: text => process.stdout.write(text) });
  await check('runtime', result);
  report.cases = tests.filter(item => item.startsWith('testcase ')).length;
  assert.match(result.log, new RegExp('Test cases\\s*:\\s*' + report.cases + '\\s*\\|\\s*' + report.cases + ' passed'));
  report.assertions = Number(result.log.match(/Assertions\s*:\s*(\d+)/)?.[1]);
  assert.equal(report.assertions, tests.filter(item => item.startsWith('    assert ')).length);
  const screenshots = path.join(game, 'tests', 'screenshots');
  if (await fs.stat(screenshots).then(stat => stat.isDirectory()).catch(() => false)) await fs.cp(screenshots, path.join(output, 'screenshots'), { recursive: true });
  report.screenshots = (await fs.readdir(path.join(output, 'screenshots')).catch(() => [])).length;
  assert.equal(report.screenshots, 3);
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = error instanceof Error ? error.stack ?? error.message : String(error); console.error(error); process.exitCode = 1; }
finally {
  try {
    if (await fs.stat(path.join(game, 'game', 'testcases.rpy')).then(stat => stat.isFile()).catch(() => false)) await fs.copyFile(path.join(game, 'game', 'testcases.rpy'), path.join(output, 'testcases.rpy'));
    report.cleanup = await cleanVerificationDirectories(output, ['game', 'saves']);
  } catch (error) { report.status = 'failed'; report.error = [report.error, 'Cleanup: ' + String(error)].filter(Boolean).join('\n'); process.exitCode = 1; }
  await save(); console.log(path.join(output, 'report.json'));
}
