import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assetFiles, projectSchema, targets, type Condition, type VariableValue } from '../src/core/model';
import { validateProject } from '../src/core/validate';
import { buildProject, runRenpy } from '../src/runtime/service';
import { renderedScreenTextHelper } from './lib/renpy-screen-test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'resources/templates/aihong');
const runDir = path.join(root, 'artifacts/aihong-story-verification', new Date().toISOString().replaceAll(':', '-'));
const buildDir = path.join(runDir, 'game');
const sdk = path.join(root, 'resources/runtime');
const report: { status: string; routes: number; endings: string[]; steps: { name: string; code: number; logPath: string }[]; error?: string } = { status: 'running', routes: 0, endings: [], steps: [] };
const save = () => fs.writeFile(path.join(runDir, 'report.json'), JSON.stringify(report, null, 2));
async function step(name: string, result: { code: number; log: string }) {
  const logPath = path.join(runDir, `${name}.log`); await fs.writeFile(logPath, result.log);
  report.steps.push({ name, code: result.code, logPath }); await save();
  console.log(`${name}: ${result.code === 0 ? 'PASS' : 'FAIL'}`);
  if (result.code !== 0) throw new Error(`${name}: ${result.log.slice(-5000)}`);
}
try {
  await fs.mkdir(runDir, { recursive: true });
  const project = projectSchema.parse(JSON.parse(await fs.readFile(path.join(source, 'project.vns.json'), 'utf8')));
  assert.equal(project.chapters.length, 2); assert.equal(project.nodes.filter(node => node.kind === 'end').length, 3);
  assert.deepEqual(validateProject(project).filter(issue => issue.severity === 'error'), []);
  for (const file of project.assets.flatMap(assetFiles)) await fs.access(path.join(source, file));
  const visited = new Set<string>(), endings = new Set<string>();
  const matches = (condition: Condition, state: Record<string, VariableValue>): boolean => {
    if (condition.kind === 'not') return !matches(condition.condition, state);
    if (condition.kind !== 'compare') return condition.kind === 'all' ? condition.conditions.every(item => matches(item, state)) : condition.conditions.some(item => matches(item, state));
    const value = state[condition.variableId];
    return condition.operator === 'eq' ? value === condition.value : condition.operator === 'ne' ? value !== condition.value : condition.operator === 'gte' ? value >= condition.value : condition.operator === 'gt' ? value > condition.value : condition.operator === 'lte' ? value <= condition.value : value < condition.value;
  };
  function visit(id: string, state: Record<string, VariableValue>, depth = 0) {
    assert.ok(depth < 100, 'An example route must terminate');
    const node = project.nodes.find(node => node.id === id); assert.ok(node, `Missing target ${id}`); visited.add(id);
    if (node.kind === 'end') { endings.add(id); report.routes++; return; }
    if (node.kind === 'set' && (!node.when || matches(node.when, state))) state = { ...state, [node.variableId]: node.operation === 'add' ? Number(state[node.variableId]) + Number(node.value) : node.value };
    if (node.kind === 'condition') { const next = matches(node.condition, state) ? node.yes : node.no; assert.ok(next); visit(next, state, depth + 1); return; }
    const outgoing = targets(node); assert.ok(outgoing.length, `Dead end ${node.id}`);
    for (const port of outgoing) { assert.ok(port.target, `Empty branch ${node.id}:${port.port}`); visit(port.target, { ...state }, depth + 1); }
  }
  visit(project.entryId, Object.fromEntries(project.variables.map(variable => [variable.id, variable.initial])));
  assert.equal(visited.size, project.nodes.length); assert.equal(endings.size, 3);
  report.endings = [...endings]; await save();
  const built = await buildProject({ project, projectDir: source, sdkRoot: sdk, outputDir: buildDir, development: true });
  await step('compile', { code: built.ok ? 0 : 1, log: built.log + JSON.stringify(built.diagnostics) });
  const endingText = (id: string) => { const node = project.nodes.find(node => node.id === id); assert.ok(node?.kind === 'passage'); const action = node.lines[0].actions[0]; assert.ok(action.kind === 'blueprint'); return JSON.stringify(action.inputs!.caption); };
  await fs.writeFile(path.join(buildDir, 'game/testcases.rpy'), `${renderedScreenTextHelper}
init python:
    def vns_test_visual_texts():
        result = []
        displayable = renpy.game.context().scene_lists.get_displayable_by_tag("master", "vn_visual_ending_title")
        def collect(child):
            if isinstance(child, renpy.text.text.Text):
                result.append(child.get_all_text())
        if displayable is not None:
            displayable.visit_all(collect)
        return result

testsuite global:
    before testcase:
        $ _test.timeout = 15.0
        $ _test.transition_timeout = 0.05
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
        $ preferences.afm_enable = False
        if not screen "main_menu":
            run MainMenu(confirm=False)
        $ persistent.vn_unlocks = []
        $ persistent.vn_var_ai_chapter_progress = 0
        $ persistent.vn_var_ai_ending_shelter_reached = False
        $ persistent.vn_var_ai_ending_dream_reached = False
        $ persistent.vn_var_ai_ending_boat_reached = False
        $ renpy.save_persistent()
    teardown:
        exit

testcase shelter_and_chapter_transition:
    pause until eval renpy.music.get_pos(channel="music") is not None and renpy.music.get_pos(channel="music") > 0.25
    assert eval renpy.music.get_playing(channel="music") == "assets/ai_presentation_music_main.ogg"
    assert eval preferences.get_volume("music") > 0 and not preferences.get_mute("music")
    click id "vn_component_ai_title_start"
    pause until eval any(tag.startswith("vn_visual_") for tag in renpy.get_showing_tags("master"))
    pause 1.1
    assert eval renpy.music.get_playing(channel="music") == "assets/ai_story_music_wine.ogg"
    screenshot "chapter-one.png"
    pause 2.0
    screenshot "chapter-one-dissolve.png"
    advance until eval vn_current_node == "opening"
    assert eval vn_var_ai_caution == 0 and vn_var_ai_route_known is False
    assert eval renpy.showing("vn_background_ai_story_banquet")
    assert eval persistent.vn_var_ai_chapter_progress == 1
    pause until eval renpy.music.get_pos(channel="music") is not None and renpy.music.get_pos(channel="music") > 0.2
    assert eval renpy.music.get_playing(channel="music") == "assets/ai_story_music_wine.ogg"
    pause until screen "say"
    pause 0.7
    screenshot "banquet.png"
    advance until screen "choice"
    click "记下劝告，放下酒坛"
    advance until eval vn_current_node == "ai_memory"
    assert eval vn_var_ai_caution == 1
    screenshot "memory.png"
    advance until screen "choice"
    click "随人流奔逃，先离开街口"
    pause until eval any(tag.startswith("vn_visual_") for tag in renpy.get_showing_tags("master"))
    pause 1.1
    assert eval renpy.music.get_playing(channel="music") == "assets/ai_story_music_rain.ogg"
    screenshot "chapter-two.png"
    advance until screen "choice"
    assert eval vn_current_node == "ai_choice_room"
    screenshot "home-choice.png"
    click "入左屋，安分守己"
    advance until eval vn_current_node == "ai_child"
    screenshot "child.png"
    advance until screen "choice"
    click "关好院门，先让她暖过来"
    advance until eval renpy.showing("vn_visual_ending_title")
    assert eval vn_current_node == "ai_ending_shelter"
    pause 0.7
    screenshot "ending-shelter.png"
    assert eval ${endingText('ai_ending_shelter')} in vns_test_visual_texts()
    advance until screen "main_menu"
    assert eval persistent.vn_var_ai_ending_shelter_reached is True
    assert eval persistent.vn_var_ai_ending_boat_reached is False
    assert eval persistent.vn_var_ai_chapter_progress == 2
    run ShowMenu("gallery")
    assert eval renpy.get_widget("gallery", "vn_gallery_ai_story_banquet").is_sensitive()
    assert eval not renpy.get_widget("gallery", "vn_gallery_ai_story_boat").is_sensitive()
    assert eval not renpy.has_screen("chapter_select")
    assert eval not renpy.has_screen("voice_collection")
    screenshot "gallery-shelter-boat-locked.png"
    keysym "K_ESCAPE"
    assert screen "main_menu"
    click id "vn_component_ai_title_start"
    advance until screen "choice"
    assert eval persistent.vn_var_ai_chapter_progress == 2
    assert eval persistent.vn_var_ai_ending_shelter_reached is True

testcase dream_route_and_new_game_reset:
    click id "vn_component_ai_title_start"
    advance until screen "choice"
    assert eval vn_var_ai_caution == 0 and vn_var_ai_route_known is False
    click "借酒压下心事"
    advance until screen "choice"
    click "随人流奔逃，先离开街口"
    advance until screen "choice"
    click "入右屋，窥视街道"
    advance until eval renpy.showing("vn_visual_ending_title")
    assert eval vn_current_node == "ai_ending_dream"
    pause 0.7
    screenshot "ending-dream.png"
    assert eval ${endingText('ai_ending_dream')} in vns_test_visual_texts()
    assert eval vn_var_ai_caution == 0
    advance until screen "main_menu"
    assert eval persistent.vn_var_ai_ending_dream_reached is True
    assert eval persistent.vn_var_ai_ending_boat_reached is False

testcase boat_route_and_save_restore:
    click id "vn_component_ai_title_start"
    advance until screen "choice"
    click "记下劝告，放下酒坛"
    advance until screen "choice"
    click "沿墙慢行，辨认废井旁的小路"
    advance until screen "choice"
    assert eval vn_current_node == "ai_choice_room"
    assert eval vn_var_ai_caution == 1 and vn_var_ai_route_known is True
    assert eval persistent.vn_var_ai_chapter_progress == 2
    run FileSave("story-route", confirm=False, slot=True)
    click "入左屋，安分守己"
    advance until screen "choice"
    click "关好院门，先让她暖过来"
    advance until eval renpy.showing("vn_visual_ending_title")
    assert eval vn_current_node == "ai_ending_shelter"
    run FileLoad("story-route", confirm=False, slot=True)
    pause until screen "choice"
    assert eval vn_current_node == "ai_choice_room"
    assert eval vn_var_ai_caution == 1 and vn_var_ai_route_known is True
    assert eval persistent.vn_var_ai_ending_shelter_reached is True
    assert eval persistent.vn_var_ai_chapter_progress == 2
    click "入左屋，安分守己"
    advance until screen "choice"
    click "收好盘缠，寻找避兵的小路"
    advance until eval renpy.showing("vn_visual_ending_title")
    assert eval vn_current_node == "ai_ending_boat"
    pause 0.7
    screenshot "ending-boat.png"
    assert eval ${endingText('ai_ending_boat')} in vns_test_visual_texts()
    advance until screen "main_menu"
    assert eval persistent.vn_var_ai_ending_boat_reached is True
    run ShowMenu("gallery")
    assert eval renpy.get_widget("gallery", "vn_gallery_ai_story_boat").is_sensitive()
    screenshot "gallery-boat-unlocked.png"
    click id "vn_gallery_ai_story_boat"
    assert screen "vn_gallery_image"
    screenshot "gallery-boat-detail.png"
    keysym "K_ESCAPE"
    assert not screen "vn_gallery_image"
    keysym "K_ESCAPE"
    assert screen "main_menu"

testcase scout_discovers_route:
    click id "vn_component_ai_title_start"
    advance until screen "choice"
    click "记下劝告，放下酒坛"
    advance until screen "choice"
    click "随人流奔逃，先离开街口"
    advance until screen "choice"
    assert eval vn_var_ai_route_known is False
    click "入右屋，窥视街道"
    advance until screen "choice"
    assert eval vn_var_ai_route_known is True
    click "收好盘缠，寻找避兵的小路"
    advance until eval renpy.showing("vn_visual_ending_title")
    assert eval vn_current_node == "ai_ending_boat"
    pause 0.7
    assert eval ${endingText('ai_ending_boat')} in vns_test_visual_texts()
    advance until screen "main_menu"

testcase unknown_route_returns_to_shelter:
    click id "vn_component_ai_title_start"
    advance until screen "choice"
    click "借酒压下心事"
    advance until screen "choice"
    click "随人流奔逃，先离开街口"
    advance until screen "choice"
    click "入左屋，安分守己"
    advance until screen "choice"
    click "收好盘缠，寻找避兵的小路"
    advance until eval vn_current_node == "ai_no_route"
    assert eval vn_var_ai_route_known is False
    advance until eval renpy.showing("vn_visual_ending_title")
    assert eval vn_current_node == "ai_ending_shelter"
    pause 0.7
    assert eval ${endingText('ai_ending_shelter')} in vns_test_visual_texts()
    advance until screen "main_menu"
`);
  await step('lint', await runRenpy(sdk, buildDir, ['lint']));
  const runtime = await runRenpy(sdk, buildDir, ['test', '--report-detailed'], { savedir: path.join(runDir, 'saves'), timeoutMs: 240000, onData: data => process.stdout.write(data) });
  await step('runtime', runtime);
  assert.match(runtime.log, /Test cases\s*:\s*5\s*\|\s*5 passed/);
  report.status = 'passed'; await save(); console.log(`PASS: ${report.routes} model routes, 3 endings, 5 native tests. Report: ${path.join(runDir, 'report.json')}`);
} catch (error) { report.status = 'failed'; report.error = String(error); await fs.mkdir(runDir, { recursive: true }); await save(); console.error(error); console.log(`Report: ${path.join(runDir, 'report.json')}`); process.exitCode = 1; }
