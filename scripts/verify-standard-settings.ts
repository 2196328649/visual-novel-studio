import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProject, type UiComponent } from '../src/core/model';
import { buildProject, runRenpy } from '../src/runtime/service';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sdk = path.join(root, 'resources/runtime');
const output = path.join(root, 'artifacts/standard-settings-verification', new Date().toISOString().replaceAll(':', '-'));
const game = path.join(output, 'game');
const report: { status: string; steps: { name: string; code: number; assertions?: number }[]; error?: string } = { status: 'running', steps: [] };
const save = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
async function step(name: string, result: { code: number; log: string }, assertions = false) {
  await fs.writeFile(path.join(output, `${name}.log`), result.log);
  report.steps.push({ name, code: result.code, assertions: assertions ? Number(result.log.match(/Assertions\s*:\s*(\d+)/)?.[1] ?? 0) : undefined });
  await save();
  if (result.code !== 0 || assertions && !result.log.includes('Status: PASSED')) throw new Error(result.log.slice(-7000));
  console.log(`${name}: PASS`);
}
try {
  await fs.mkdir(output, { recursive: true });
  const project = createProject('标准设置替换验收');
  project.characters = [{ id: 'actor', name: '角色', color: '#ffffff', expressions: [] }];
  const geometry = { text: '', x: 0.55, y: 0.25, width: 0.3, height: 0.1 };
  project.ui.components = [
    { ...geometry, id: 'voice_stop', kind: 'button', page: 'preferences', action: 'setPlayerPreference', preference: 'voiceSustain', preferenceValue: false, text: '停止当前配音' },
    { ...geometry, id: 'resolution', kind: 'preferenceChoice', page: 'preferences', preference: 'windowSize', y: 0.4 },
    { ...geometry, id: 'other_volume', kind: 'preference', page: 'voiceSettings', preference: 'characterVolume' },
  ] satisfies UiComponent[];
  await fs.writeFile(path.join(output, 'authored-project.json'), JSON.stringify(project, null, 2));
  const compiled = await buildProject({ project, sdkRoot: sdk, outputDir: game });
  await step('compile', { code: compiled.ok ? 0 : 1, log: compiled.log + JSON.stringify(compiled.diagnostics) });
  await fs.writeFile(path.join(game, 'game/testcases.rpy'), `testsuite global:
    before testcase:
        $ _test.timeout = 15.0
        $ _test.transition_timeout = 0.05
    teardown:
        exit
testcase standard_controls_are_replaced_individually:
    click id "vn_main_preferences"
    assert screen "preferences"
    assert eval renpy.get_widget("preferences", "vn_preference_voiceSustain_0") is None
    assert eval renpy.get_widget("preferences", "vn_preference_voiceSustain_1") is not None
    assert eval all(renpy.get_widget("preferences", "vn_preference_windowSize_%d" % i) is None for i in range(4))
    assert eval renpy.get_widget("preferences", "vn_component_resolution_choice") is not None
    run VnSetPreference("voiceSustain", True)
    click id "vn_component_voice_stop"
    assert eval vn_preference_get("voiceSustain") is False
    run ShowMenu("voice_settings")
    assert eval renpy.get_widget("voice_settings", "vn_character_volume_other") is None
    assert eval renpy.get_widget("voice_settings", "vn_character_volume_actor") is not None
    assert eval renpy.get_widget("voice_settings", "vn_component_other_volume_control") is not None
    click id "vn_component_other_volume_control" pos (0.3, 0.5)
    assert eval 0.2 < vn_preference_get("characterVolume") < 0.4
    assert eval vn_preference_get("characterVolume", "actor") == 1
    screenshot "standard-character-controls.png"
    click "返回设置"
    assert screen "preferences"
`);
  await step('runtime', await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves') }), true);
  report.status = 'passed'; await save(); console.log(`Report: ${path.join(output, 'report.json')}`);
} catch (error) {
  report.status = 'failed'; report.error = error instanceof Error ? error.stack : String(error);
  await save(); console.error(report.error); process.exitCode = 1;
}
