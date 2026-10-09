import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { createProject } from '../src/core/model';
import { textCommandAction } from '../src/core/text-script';
import { buildProject, runRenpy } from '../src/runtime/service';

const custom = process.argv.includes('--custom-ui');
const output = path.resolve('artifacts/dialogue-typewriter', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const project = createProject('Dialogue typewriter regression');
project.width = 800; project.height = 450;
project.playerDefaults = { textSpeed: 50, masterVolume: 0, fullscreen: false };
if (custom) project.ui.components = [
  { id: 'speaker', page: 'say', kind: 'text', text: '', binding: 'speaker', x: .05, y: .64, width: .8, height: .1, style: { fontSize: 24 } },
  { id: 'dialogue', page: 'say', kind: 'text', text: '', binding: 'dialogue', x: .05, y: .75, width: .9, height: .23, style: { fontSize: 26, textColor: '#ffffff' } },
];
for (const [id, rgb] of [['red', [210, 40, 50]], ['green', [35, 180, 90]]] as const) {
  const png = new PNG({ width: 120, height: 250 });
  for (let i = 0; i < png.data.length; i += 4) png.data.set([...rgb, 255], i);
  await fs.writeFile(path.join(output, id + '.png'), PNG.sync.write(png));
  project.assets.push({ id, name: id, kind: 'image', path: id + '.png', width: 120, height: 250 });
}
project.characters = ['a', 'b'].map((id, i) => ({ id, name: id.toUpperCase(), color: '#ffffff', expressions: [{ id: id + '_normal', name: 'Normal', assetId: i ? 'green' : 'red' }] }));
const show = textCommandAction(project, '@显示角色')!;
const story = project.nodes.find(n => n.kind === 'passage')!;
project.entryId = story.id;
story.lines = [
  { id: 'before', text: 'Before.', actions: [] },
  { id: 'enter', speakerId: 'a', text: 'Entering with typewriter.', actions: [show] },
  { id: 'same', speakerId: 'a', text: 'Same actor types again.', actions: [show] },
  { id: 'switch', speakerId: 'b', text: 'Another actor types.', actions: [show] },
  { id: 'exit', text: 'Narration types again.', actions: [] },
  { id: 'pause', text: 'Text follows the wait.', actions: [{ kind: 'pause', seconds: .6 }] },
  { id: 'end', text: 'Done.', actions: [] },
];
const game = path.join(output, 'game'), sdk = path.resolve('resources/runtime');
const built = await buildProject({ project, projectDir: output, outputDir: game, sdkRoot: sdk });
assert.ok(built.ok, built.log + JSON.stringify(built.diagnostics));
const cases = ['enter', 'same', 'switch', 'exit', 'pause'];
await fs.writeFile(path.join(game, 'game/testcases.rpy'), `
init 1000 python:
    import json as qa_json, time as qa_time
    qa_frames = []
    qa_render = VNDialogueText.render
    def qa_record(self, width, height, st, at):
        result = qa_render(self, width, height, st, at)
        if vn_current_line:
            qa_frames.append(dict(line=vn_current_line, text=self.text, slow=self.slow, st=st, at=at, clock=vn_bp_clock(), data=vn_line_dialogue, maximum=self.get_layout().max_time if self.get_layout() else None))
        return result
    VNDialogueText.render = qa_record

testsuite global:
    before testcase:
        $ _test.timeout = 15
        $ _test.transition_timeout = .1
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 50
        $ preferences.transitions = 2
        $ preferences.afm_enable = False
    teardown:
        $ qa_json.dump(qa_frames, open(config.basedir + "/frames.json", "w"))
        exit

testcase typewriter:
    click id "vn_main_start"
    pause until "Before."
    pause 1
${cases.map(id => `    click pos (700, 100)
    pause until eval vn_current_line == ${JSON.stringify(id)} and renpy.get_widget("say", "what") is not None and renpy.get_widget("say", "what").text[0] == vn_line_dialogue["text"]
    pause .08
    assert eval renpy.get_widget("say", "what").slow
    screenshot "${id}-start.png"
    pause .14
    screenshot "${id}-later.png"
    click id "what"
    pause .12
    assert eval vn_current_line == ${JSON.stringify(id)}
    screenshot "${id}-revealed.png"`).join('\n')}
    click pos (700, 100)
    pause until "Done."
`);
const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 60000, onData: text => process.stdout.write(text), env: { RENPY_RENDERER: 'gl2', PYTHONUNBUFFERED: '1' } });
await fs.writeFile(path.join(output, 'runtime.log'), result.log);
console.log(output);
assert.equal(result.code, 0, result.log.slice(-5000));
const files = await fs.readdir(game, { recursive: true });
async function pixels(name: string) {
  const file = files.find(file => file.endsWith(name)); assert.ok(file, name);
  const png = PNG.sync.read(await fs.readFile(path.join(game, file)));
  let count = 0;
  for (let y = Math.round(png.height * .55); y < png.height * .94; y++) for (let x = Math.round(png.width * .04); x < png.width * .96; x++) {
    const i = (y * png.width + x) * 4;
    if (png.data[i] > 190 && png.data[i + 1] > 190 && png.data[i + 2] > 190) count++;
  }
  return count;
}
const checks = [];
for (const id of cases) checks.push({ id, start: await pixels(id + '-start.png'), later: await pixels(id + '-later.png'), revealed: await pixels(id + '-revealed.png') });
console.log(JSON.stringify(checks));
for (const check of checks) {
  assert.ok(check.later > check.start + 20, check.id + ' reveals additional letters: ' + JSON.stringify(check));
  assert.ok(check.revealed > check.later + 20, check.id + ' remains partially revealed until clicked: ' + JSON.stringify(check));
}
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', custom, checks }, null, 2));
