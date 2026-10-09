import { createShowCharacterFixture } from './lib/show-character-fixture';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { createProject, type StageAction } from '../src/core/model';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { buildProject, runRenpy } from '../src/runtime/service';

const output = path.resolve('artifacts/show-current-speaker', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const p = createProject('统一显示角色验收'); p.width = 800; p.height = 450; p.playerDefaults = { textSpeed: 0, fullscreen: false };
const png = new PNG({ width: 180, height: 300 }); png.data.fill(255);
await fs.writeFile(path.join(output, 'portrait.png'), PNG.sync.write(png));
p.assets = [{ id: 'portrait', name: '立绘', kind: 'image', path: 'portrait.png', width: 180, height: 300 }];
p.characters = ['a', 'b'].map(id => ({ id, name: id.toUpperCase(), color: '#ffffff', defaultExpressionId: id + '_happy', expressions: [{ id: id + '_normal', name: '普通', assetId: 'portrait' }, { id: id + '_happy', name: '笑', assetId: 'portrait' }] }));
p.characters.push({ id: 'empty', name: '空角色', color: '#ffffff', expressions: [] });
const show: Extract<StageAction, { kind: 'show' }> = { kind: 'show', characterId: '', expressionId: '', presetId: 'default', x: .5, y: 1, scale: 1, layer: 10, lifetime: 'line', transition: 'dissolve', actorTransitions: { enter: { mode: 'dissolve', duration: .1 }, exit: { mode: 'dissolve', duration: .1 } } };
const graph = blueprintFromPerformance(p, [show], '跟随'), legacy = createShowCharacterFixture(); p.blueprints.push(graph, legacy);
const node = p.nodes.find(n => n.kind === 'passage')!; p.entryId = node.id;
node.lines = [
  { id: 'auto_a', speakerId: 'a', text: 'Auto A.', actions: [show] },
  { id: 'auto_b', speakerId: 'b', text: 'Auto B.', actions: [show] },
  { id: 'override', speakerId: 'b', text: 'Override.', actions: [{ ...show, expressionId: '普通' }] },
  { id: 'specified', speakerId: 'b', text: 'Specified.', actions: [{ ...show, characterId: 'a' }] },
  { id: 'narration', text: 'Narration.', actions: [show] },
  { id: 'empty_line', speakerId: 'empty', text: 'No portrait.', actions: [show] },
  { id: 'blueprint', speakerId: 'b', text: 'Blueprint.', actions: [{ kind: 'blueprint', blueprintId: graph.id }] },
  { id: 'legacy', speakerId: 'a', text: 'Legacy.', actions: [{ kind: 'blueprint', blueprintId: legacy.id }] },
  { id: 'persistent', speakerId: 'b', text: 'Persistent.', actions: [{ ...show, lifetime: 'persistent' }] },
  { id: 'kept', text: 'Kept.', actions: [show] },
];
const game = path.join(output, 'game'), sdk = path.resolve('resources/runtime');
const built = await buildProject({ project: p, projectDir: output, outputDir: game, sdkRoot: sdk }); assert.ok(built.ok, JSON.stringify(built.diagnostics));
const checks = [
  ['Auto A.', 'vn_actor_instances["vn_actor_a"]["expressionId"] == "a_happy"'],
  ['Auto B.', 'vn_actor_instances["vn_actor_b"]["expressionId"] == "b_happy" and not renpy.showing("vn_actor_a")'],
  ['Override.', 'vn_actor_instances["vn_actor_b"]["expressionId"] == "b_normal"'],
  ['Specified.', 'vn_actor_instances["vn_actor_a"]["expressionId"] == "a_happy"'],
  ['Narration.', 'not vn_actor_instances'],
  ['No portrait.', 'not vn_actor_instances'],
  ['Blueprint.', 'vn_actor_instances["vn_actor_b"]["expressionId"] == "b_happy"'],
  ['Legacy.', 'vn_actor_instances["vn_actor_a"]["expressionId"] == "a_happy"'],
  ['Persistent.', 'vn_actor_instances["vn_actor_b"]["lifetime"] == "persistent"'],
  ['Kept.', 'renpy.showing("vn_actor_b") and vn_actor_instances["vn_actor_b"]["lifetime"] == "persistent"'],
];
await fs.writeFile(path.join(game, 'game/testcases.rpy'), `testsuite global:
    before testcase:
        $ _test.timeout = 12.0
        $ preferences.text_cps = 0
    teardown:
        exit
testcase unified_show:
    click id "vn_main_start"
${checks.map(([text, check], index) => `${index ? '    $ renpy.test.testmouse.click_mouse(1, 700, 100)\n' : ''}    pause until "${text}"
    assert eval ${check}`).join('\n')}
    run FileSave("speaker", confirm=False, slot=True)
    run FileLoad("speaker", confirm=False, slot=True)
    pause until "Kept."
    assert eval renpy.showing("vn_actor_b")
`);
const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 60000 });
await fs.writeFile(path.join(output, 'runtime.log'), result.log); assert.equal(result.code, 0, result.log);
assert.match(result.log, /Status: PASSED/);
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks: checks.map(c => c[0]), saveLoad: true }, null, 2));
console.log(output);
