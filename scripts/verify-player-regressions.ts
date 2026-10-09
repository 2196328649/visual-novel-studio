import { endingPerformanceNodes } from '../src/core/ending-migration';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { projectSchema, type VisualObject } from '../src/core/model';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { chapterCompositionBlueprint } from '../src/core/chapter-composition-blueprint';
import { arrangePerformanceTimeline, performanceTimeline } from '../src/core/performance-timeline';
import { buildProject, runRenpy } from '../src/runtime/service';
import { pythonLiteral } from '../src/runtime/literals';
import { writeUiHistoryAudio } from './lib/ui-history-preview-fixture';

const root = path.resolve('.'), template = path.join(root, 'resources/templates/aihong');
const output = path.join(root, 'artifacts/player-regressions', new Date().toISOString().replaceAll(':', '-'));
const sdk = path.join(root, 'resources/runtime');
await fs.mkdir(output, { recursive: true });
const project = projectSchema.parse(JSON.parse(await fs.readFile(path.join(template, 'project.vns.json'), 'utf8')));
project.name = '跳过、历史与章节边界验收';
project.width = 1920; project.height = 1080;
project.playerDefaults = { ...project.playerDefaults, fullscreen: false, windowSize: '1280x720' };
project.ui.instances = []; project.ui.activeInstanceId = undefined; project.ui.customPages = [];
project.ui.components = project.ui.components.filter(c => ['say', 'history', 'voiceCollection', 'messageBox', 'chapterTitle'].includes(c.page));
project.ui.pages!.main = { layout: 'native' };
project.ui.pages!.choice = { layout: 'native' };
project.blueprints = []; project.variables = []; project.chapters = [{ id: 'qa_chapter', name: '验收章节' }];
project.scenes = [{ id: 'qa_scene', name: '验收场景', chapterId: 'qa_chapter', entryActions: [] }];
project.nodes = [{ id: 'qa_start', kind: 'start', name: '开始', sceneId: 'qa_scene', x: 0, y: 0, next: 'qa_dialogue' },
  { id: 'qa_dialogue', kind: 'passage', name: '真实对白', sceneId: 'qa_scene', x: 100, y: 0, next: 'qa_choice', lines: [
    { id: 'first', speakerId: project.characters[0].id, voiceId: 'voice_0', text: '第一条有声对白，用于历史重播与收藏验收。', actions: [{ kind: 'background', assetId: 'ai_story_banquet', transition: 'none' }] },
    { id: 'second', speakerId: project.characters[0].id, voiceId: 'voice_1', text: '第二条有声对白，返回历史后继续停留在此处。', actions: [] },
    { id: 'third', text: '没有语音的旁白。', actions: [] },
    { id: 'chapter', text: '', silent: true, actions: [] },
    { id: 'after', text: '跳过章节后到达这里。', actions: [] },
  ] },
  { id: 'qa_choice', kind: 'choice', name: '跳过停止点', sceneId: 'qa_scene', x: 200, y: 0, prompt: '', choices: [{ id: 'choose', text: '等待玩家选择', target: 'qa_end' }] },
  ...endingPerformanceNodes(project, { id: 'qa_end', name: '结束', sceneId: 'qa_scene', x: 300, y: 0 }, '结束')];
project.entryId = 'qa_start';
const chapter = { kind: 'chapter' as const, title: '章节边界验收', subtitle: '', duration: 7, effect: 'ink' as const, backgroundId: 'ai_presentation_chapter_one', titleImageId: 'ai_presentation_title_one' };
const original = blueprintFromPerformance(project, [chapter], '章节进入演出'); project.blueprints.push(original);
const timeline = performanceTimeline(project, original); arrangePerformanceTimeline(project, original, timeline.clips, timeline.tracks);
const converted = chapterCompositionBlueprint(project, chapter).graph; project.blueprints.push(converted);
const legacy = chapterCompositionBlueprint(project, chapter).graph;
const legacyNode = legacy.nodes.find(node => node.type === 'savedAction')!;
const legacyObject = JSON.parse(String(legacyNode.properties.action)) as VisualObject;
legacyObject.children![1].curves = legacyObject.curves; delete legacyObject.curves;
delete legacyObject.chapterPresentation;
legacyNode.properties.action = JSON.stringify(legacyObject); project.blueprints.push(legacy);
const passage = project.nodes.find(n => n.kind === 'passage')!;
passage.lines[3].actions = [original, converted, legacy].map(graph => ({ kind: 'blueprint', blueprintId: graph.id }));
const convertedObject = JSON.parse(String(converted.nodes.find(node => node.type === 'savedAction')!.properties.action)) as VisualObject;
project.assets.push(...[0, 1].map(index => ({ id: `voice_${index}`, name: `验收语音 ${index}`, kind: 'audio' as const, category: 'voice' as const, path: `assets/voice_${index}.wav` })));
const sourceText = JSON.stringify({ ui: project.ui, chapter, characters: project.characters });
project.assets = project.assets.filter(a => ['ai_story_banquet', 'voice_0', 'voice_1'].includes(a.id) || sourceText.includes(a.id));
await writeUiHistoryAudio(output);
for (const asset of project.assets.filter(a => !a.id.startsWith('voice_'))) {
  await fs.mkdir(path.dirname(path.join(output, asset.path)), { recursive: true });
  await fs.copyFile(path.join(template, asset.path), path.join(output, asset.path));
}
await fs.writeFile(path.join(output, 'project.vns.json'), JSON.stringify(project, null, 2));
const game = path.join(output, 'game');
const built = await buildProject({ project: projectSchema.parse(project), projectDir: output, outputDir: game, sdkRoot: sdk });
await fs.writeFile(path.join(output, 'compile.log'), built.log + JSON.stringify(built.diagnostics));
assert.ok(built.ok, JSON.stringify(built.diagnostics));
const cases = ['screen', 'blueprint', 'converted', 'legacy'];
await fs.writeFile(path.join(game, 'game/testcases.rpy'), `
init python:
    import json as qa_json
    import time as qa_time
    qa_frames = []
    qa_capture_name = None
    qa_draw = renpy.display.core.Interface.draw_screen
    def qa_record_draw(self, root_widget, fullscreen_video, draw):
        qa_draw(self, root_widget, fullscreen_video, draw)
        if qa_capture_name and draw:
            surface = renpy.display.draw.screenshot(renpy.display.interface.surftree)
            width, height = surface.get_size()
            points = [(0.1, 0.1), (0.7, 0.2), (0.5, 0.8)]
            pixels = [list(surface.get_at((int(width * x), int(height * y))))[:3] for x, y in points]
            qa_frames.append(dict(name=qa_capture_name, time=qa_time.monotonic(), pixels=pixels, chapter=bool(renpy.get_screen("vn_chapter_title"))))
    renpy.display.core.Interface.draw_screen = qa_record_draw
    def qa_start_capture(name):
        global qa_capture_name
        qa_capture_name = name
    def qa_stop_capture():
        global qa_capture_name
        qa_capture_name = None
        with open(renpy.config.basedir + "/frames.json", "w") as stream:
            qa_json.dump(qa_frames, stream)

${cases.map(name => `label qa_${name}:
    scene expression Solid("#7abca8")
    window hide
    pause 0.1
    $ qa_start_capture(${pythonLiteral(name)})
    ${name === 'screen' ? `call screen vn_chapter_title(title=${pythonLiteral(chapter.title)}, duration=${chapter.duration}, effect="ink", background="assets/ai_presentation_chapter_one.png", title_image="assets/ai_presentation_title_one.png")` : `call vn_blueprint_${name === 'blueprint' ? original.id : name === 'legacy' ? legacy.id : converted.id}`}
    pause .12
    $ qa_stop_capture()
    "章节播放完成 ${name}"
    return`).join('\n')}

label qa_skip_running_chapter:
    scene expression Solid("#7abca8")
    window hide
    $ vn_show_visual(${pythonLiteral(convertedObject)})
    pause .4
    $ config.skipping = "slow"
    pause .1
    $ config.skipping = None
    "运行中的章节已跳过"
    return

testsuite global:
    before testcase:
        $ _test.timeout = 18.0
        $ _test.transition_timeout = 0.05
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
    teardown:
        exit

testcase player_regressions:
    click id "vn_main_start"
    assert "第一条有声对白，用于历史重播与收藏验收。"
    assert eval not preferences.skip_unseen
    assert eval not Skip().get_sensitive()
    assert eval renpy.get_widget("say", "vn_component_ai_dialogue_skip").is_sensitive()
    click id "vn_component_ai_dialogue_skip"
    assert screen "confirm"
    screenshot "skip-unread-confirm.png"
    click id "vn_component_ai_confirm_no"
    assert eval not preferences.skip_unseen and not config.skipping
    assert "第一条有声对白，用于历史重播与收藏验收。"
    click pos (900, 600)
    assert "第二条有声对白，返回历史后继续停留在此处。"
    screenshot "current-scene.png"
    click id "vn_component_ai_dialogue_history"
    assert screen "history"
    assert eval len(_history_list) == 2
    assert eval vn_ui_pages["history"]["backgroundOpacity"] == 0
    click id "vn_component_ai_history_items_0_replay"
    pause 0.15
    assert eval renpy.music.get_playing(channel="vn_replayvoice") == "assets/voice_0.wav"
    click id "vn_component_ai_history_items_0_favorite"
    assert eval len(persistent.vn_voice_collection) == 1
    assert eval persistent.vn_voice_collection[0]["text"] == "第一条有声对白，用于历史重播与收藏验收。"
    assert eval renpy.get_widget("history", "vn_component_ai_history_items_0_favorite").is_selected()
    screenshot "transparent-history.png"
    click id "vn_component_ai_history_back"
    assert "第二条有声对白，返回历史后继续停留在此处。"
    pause 0.1
    assert eval renpy.music.get_playing(channel="vn_replayvoice") is None
    click id "vn_component_ai_dialogue_history"
    assert eval renpy.get_widget("history", "vn_component_ai_history_items_0_favorite").is_selected()
    click id "vn_component_ai_history_items_0_favorite"
    assert eval not persistent.vn_voice_collection
    click id "vn_component_ai_history_back"
    $ config.skip_delay = 600000
    click id "vn_component_ai_dialogue_skip"
    assert screen "confirm"
    click id "vn_component_ai_confirm_yes"
    assert eval preferences.skip_unseen and config.skipping == "slow"
    assert eval renpy.get_widget("say", "vn_component_ai_dialogue_skip").is_selected()
    click id "vn_component_ai_dialogue_skip"
    assert eval not config.skipping
    assert "第二条有声对白，返回历史后继续停留在此处。"
    $ config.skip_delay = 5
    click id "vn_component_ai_dialogue_skip"
    pause until screen "choice"
    assert screen "choice"
    pause 0.2
    assert screen "choice"
    assert eval not renpy.get_screen("vn_chapter_title")
    assert eval not renpy.showing(${pythonLiteral('vn_visual_' + convertedObject.instanceId)})
    assert eval not renpy.showing(${pythonLiteral('vn_visual_' + legacyObject.instanceId)})
    screenshot "skip-stops-at-choice.png"
${cases.map(name => `    run Function(renpy.jump, "qa_${name}")
    pause until "章节播放完成 ${name}"
    pause 0.08
    run Function(qa_stop_capture)
    assert not screen "vn_chapter_title"
    screenshot "chapter-finished-${name}.png"`).join('\n')}
    run Function(renpy.jump, "qa_skip_running_chapter")
    pause until "运行中的章节已跳过"
    assert eval not renpy.showing(${pythonLiteral('vn_visual_' + convertedObject.instanceId)})
    assert eval not vn_chapter_visual_tags
`);
const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 90000, env: { SDL_VIDEO_WINDOW_POS: '2400,0', RENPY_RENDERER: 'gl2' } });
await fs.writeFile(path.join(output, 'runtime.log'), result.log);
assert.equal(result.code, 0, result.log.slice(-6000));
assert.match(result.log, /Test cases\s*:\s*1\s*\|\s*1 passed/);
const frames = JSON.parse(await fs.readFile(path.join(game, 'frames.json'), 'utf8')) as { name: string; time: number; pixels: number[][]; chapter: boolean }[];
const boundaries = cases.map(name => {
  const rows = frames.filter(frame => frame.name === name);
  assert.ok(rows.length >= 20, `${name}: insufficient live frames ${rows.length}`);
  const base = [122, 188, 168];
  const firstDelta = Math.max(...rows[0].pixels.flatMap(pixel => pixel.map((value, i) => Math.abs(value - base[i]))));
  const lastDelta = Math.max(...rows.at(-1)!.pixels.flatMap(pixel => pixel.map((value, i) => Math.abs(value - base[i]))));
  const steps = rows.slice(1).map((row, index) => Math.max(...row.pixels.flatMap((pixel, j) => pixel.map((value, k) => Math.abs(value - rows[index].pixels[j][k])))));
  const maxStep = Math.max(...steps);
  assert.ok(firstDelta < 8, `${name}: first frame flashes (${firstDelta})`);
  assert.ok(lastDelta < 8, `${name}: last frame flashes (${lastDelta})`);
  assert.ok(maxStep < 40, `${name}: abrupt frame change (${maxStep})`);
  return { name, frames: rows.length, firstDelta, lastDelta, maxStep, seconds: rows.at(-1)!.time - rows[0].time };
});
const screenshot = async (name: string) => PNG.sync.read(await fs.readFile(path.join(game, 'tests/screenshots', name)));
const scene = await screenshot('current-scene.png'), history = await screenshot('transparent-history.png');
const filterAsset = project.assets.find(a => a.id === project.ui.components.find(c => c.id === 'ai_history_background')!.assetId)!;
const filter = PNG.sync.read(await fs.readFile(path.join(output, filterAsset.path)));
const comparisons = [.2, .4, .6, .8].map(x => {
  const at = (Math.floor(scene.height * .88) * scene.width + Math.floor(scene.width * x)) * 4;
  const maskAt = (Math.floor(filter.height * .88) * filter.width + Math.floor(filter.width * x)) * 4;
  const opacity = filter.data[maskAt + 3] / 255;
  const expected = [0, 1, 2].map(c => Math.round(filter.data[maskAt + c] * opacity + scene.data[at + c] * (1 - opacity)));
  const actual = [0, 1, 2].map(c => history.data[at + c]);
  const delta = Math.max(...actual.map((value, c) => Math.abs(value - expected[c])));
  assert.ok(delta <= 4, `history scene is obscured: ${JSON.stringify({ x, expected, actual, delta })}`);
  return { x, opacity, expected, actual, delta };
});
const nativeProject = structuredClone(project), nativeGame = path.join(output, 'native-game');
nativeProject.ui.pages!.history = { layout: 'native' };
nativeProject.ui.components = nativeProject.ui.components.filter(component => component.page !== 'history');
const nativeBuild = await buildProject({ project: nativeProject, projectDir: output, outputDir: nativeGame, sdkRoot: sdk });
assert.ok(nativeBuild.ok, JSON.stringify(nativeBuild.diagnostics));
await fs.writeFile(path.join(nativeGame, 'game/testcases.rpy'), `
testsuite global:
    before testcase:
        $ _test.timeout = 18.0
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
    teardown:
        exit
testcase native_history:
    click id "vn_main_start"
    assert "第一条有声对白，用于历史重播与收藏验收。"
    click pos (900, 600)
    assert "第二条有声对白，返回历史后继续停留在此处。"
    screenshot "current-scene.png"
    click id "vn_component_ai_dialogue_history"
    assert screen "history"
    assert eval vn_ui_pages["history"]["backgroundOpacity"] == 0.8
    assert eval len(_history_list) == 2
    click id "vn_history_replay_0"
    pause 0.15
    assert eval renpy.music.get_playing(channel="vn_replayvoice") == "assets/voice_0.wav"
    click id "vn_history_favorite_0"
    assert eval len(persistent.vn_voice_collection) == 1
    assert eval VnFavoriteVoice("assets/voice_0.wav", vn_capture_history_voice(_history_list[0])).get_selected()
    assert "取消收藏"
    screenshot "transparent-history.png"
    click id "vn_game_menu_return"
    assert "第二条有声对白，返回历史后继续停留在此处。"
    pause 0.1
    assert eval renpy.music.get_playing(channel="vn_replayvoice") is None
`);
const nativeResult = await runRenpy(sdk, nativeGame, ['test', '--report-detailed'], { savedir: path.join(output, 'native-saves'), timeoutMs: 60000, env: { SDL_VIDEO_WINDOW_POS: '2400,0', RENPY_RENDERER: 'gl2' } });
await fs.writeFile(path.join(output, 'native-runtime.log'), nativeResult.log);
assert.equal(nativeResult.code, 0, nativeResult.log.slice(-6000));
assert.match(nativeResult.log, /Test cases\s*:\s*1\s*\|\s*1 passed/);
const nativeScene = PNG.sync.read(await fs.readFile(path.join(nativeGame, 'tests/screenshots/current-scene.png')));
const nativeHistory = PNG.sync.read(await fs.readFile(path.join(nativeGame, 'tests/screenshots/transparent-history.png')));
const background = [1, 3, 5].map(index => Number.parseInt(nativeProject.ui.background.slice(index, index + 2), 16));
const nativeComparisons = [.2, .4, .6, .8].map(x => {
  const at = (Math.floor(nativeScene.height * .88) * nativeScene.width + Math.floor(nativeScene.width * x)) * 4;
  const expected = background.map((value, c) => Math.round(value * .8 + nativeScene.data[at + c] * .2));
  const actual = [0, 1, 2].map(c => nativeHistory.data[at + c]);
  const delta = Math.max(...actual.map((value, c) => Math.abs(value - expected[c])));
  assert.ok(delta <= 4, `native history scene is obscured: ${JSON.stringify({ x, expected, actual, delta })}`);
  return { x, opacity: .8, expected, actual, delta };
});
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', assertions: Number(result.log.match(/Assertions\s*:\s*(\d+)/)?.[1]), nativeHistoryAssertions: Number(nativeResult.log.match(/Assertions\s*:\s*(\d+)/)?.[1]), boundaries, historyCompositing: comparisons, nativeHistoryCompositing: nativeComparisons, defaultSkipPreferencePreserved: true, realCompiledDialogue: true }, null, 2));
console.log(output);
