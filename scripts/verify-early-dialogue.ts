import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject } from '../src/core/model';
import { buildProject, runRenpy } from '../src/runtime/service';
import { writeTestTone } from './lib/test-tone';
import { PNG } from 'pngjs';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';

const output = path.resolve('artifacts/early-dialogue', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const project = createProject('Early dialogue'); project.width = 800; project.height = 450;
project.playerDefaults = { textSpeed: 12, fullscreen: false };
await writeTestTone(path.join(output, 'voice.wav'), 12);
project.assets.push({ id: 'voice', name: 'Test voice', kind: 'audio', category: 'voice', path: 'voice.wav' });
const story = project.nodes.find(n => n.kind === 'passage')!;
const marker = blueprintFromPerformance(project, [{ kind: 'pause', seconds: .2 }, { kind: 'startDialogue' }, { kind: 'pause', seconds: 1.3 }, { kind: 'startDialogue' }]);
project.blueprints.push(marker);
story.lines = [
 { id: 'before', text: 'Before.', actions: [] },
 { id: 'early', voiceId: 'voice', text: 'The dialogue starts here [literal] {braces} and keeps revealing across the remaining stage actions.', actions: [
  { kind: 'pause', seconds: .4 }, { kind: 'startDialogue' }, { kind: 'pause', seconds: 1.6 },
  { kind: 'startDialogue' }, { kind: 'pause', seconds: 1.6 },
 ] },
 { id: 'after', text: 'After.', actions: [] },
 { id: 'blueprint', voiceId: 'voice', text: 'Blueprint dialogue starts during the remaining animation.', actions: [{ kind: 'blueprint', blueprintId: marker.id }] },
 { id: 'end', text: 'Done.', actions: [] },
];
const game = path.join(output, 'game'), sdk = path.resolve('resources/runtime');
const built = await buildProject({ project, projectDir: output, outputDir: game, sdkRoot: sdk });
assert.ok(built.ok, built.log + JSON.stringify(built.diagnostics));
await fs.writeFile(path.join(game, 'game/testcases.rpy'), `
init 1000 python:
    import json as qa_json, time as qa_time
    qa_frames = []
    qa_voices = []
    persistent.qa_voice_count = 0
    qa_original_voice = voice
    def qa_voice(*args, **kwargs):
        qa_voices.append(args)
        persistent.qa_voice_count += 1
        return qa_original_voice(*args, **kwargs)
    voice = qa_voice
    qa_original_render = VNDialogueText.render
    def qa_render(self, width, height, st, at):
        result = qa_original_render(self, width, height, st, at)
        if vn_current_line == "early":
            interface = renpy.display.interface
            qa_frames.append(dict(clock=vn_bp_clock(), started=(vn_line_dialogue or {}).get("started"), text=self.text, slow=self.slow, dt=interface.frame_time - (interface.interact_time or interface.frame_time)))
        return result
    VNDialogueText.render = qa_render

testsuite global:
    before testcase:
        $ _test.timeout = 15
        $ _test.transition_timeout = .1
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit

testcase early:
    click id "vn_main_start"
    pause until "Before."
    pause .7
    advance
    pause .55
    assert eval vn_line_dialogue["started"] is not None
    $ persistent.qa_early_start = vn_line_dialogue["started"]
    assert eval renpy.get_widget("say", "what").text[0].startswith("The dialogue")
    screenshot "early-1.png"
    pause .65
    screenshot "early-2.png"
    assert eval len(qa_voices) == 1
    assert eval persistent.qa_voice_count == 1
    assert eval renpy.music.get_playing(channel="voice") is not None
    click id "what"
    assert eval vn_line_dialogue.get("revealed")
    run Function(renpy.save, "during-actions")
    pause .3
    run Function(renpy.load, "during-actions")
    pause .2
    assert eval vn_line_dialogue["started"] == persistent.qa_early_start
    assert eval vn_line_dialogue.get("revealed")
    pause 2.8
    assert eval vn_current_line == "early"
    assert eval vn_line_dialogue["started"] == persistent.qa_early_start
    assert eval vn_line_dialogue.get("revealed")
    assert eval len(qa_voices) == 1
    assert eval persistent.qa_voice_count == 1
    assert eval len([h for h in _history_list if h.what.startswith("The dialogue")]) == 1
    screenshot "revealed.png"
    advance
    pause until "After."
    pause .6
    advance
    pause .4
    assert eval vn_current_line == "blueprint"
    assert eval vn_line_dialogue["started"] is not None
    assert eval renpy.get_widget("say", "what").text[0].startswith("Blueprint dialogue")
    assert eval persistent.qa_voice_count == 2
    pause 1.5
    assert eval persistent.qa_voice_count == 2
    assert eval len([h for h in _history_list if h.what.startswith("Blueprint dialogue")]) == 1
    click id "what"
    pause .1
    advance
    pause until "Done."
    $ qa_json.dump(qa_frames, open(config.basedir + "/frames.json", "w"))
`);
const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 60000, onData: text => process.stdout.write(text), env: { RENPY_RENDERER: 'gl2', PYTHONUNBUFFERED: '1' } });
await fs.writeFile(path.join(output, 'runtime.log'), result.log);
assert.equal(result.code, 0, result.log.slice(-5000));
const count = async (name: string) => {
 const file = (await fs.readdir(game, { recursive: true })).find(file => file.endsWith(name)); assert.ok(file, name);
 const png = PNG.sync.read(await fs.readFile(path.join(game, file)));
 let pixels = 0;
 for (let y = Math.round(png.height * .74); y < png.height * .94; y++) for (let x = Math.round(png.width * .04); x < png.width * .96; x++) {
  const i = (y * png.width + x) * 4; if (png.data[i] > 190 && png.data[i + 1] > 190 && png.data[i + 2] > 190) pixels++;
 }
 return pixels;
};
const earlyPixels = await count('early-1.png'), laterPixels = await count('early-2.png'), revealedPixels = await count('revealed.png');
assert.ok(laterPixels > earlyPixels + 20, JSON.stringify({ earlyPixels, laterPixels }));
assert.ok(revealedPixels > laterPixels + 20);
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', earlyPixels, laterPixels, revealedPixels, checks: ['one voice start', 'visible progressive reveal', 'save/load during suffix actions', 'click reveal persists', 'single history entry', 'literal brackets and braces', 'blueprint marker and repeated marker'] }, null, 2));
console.log(output);
