import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { buildProject, runRenpy } from '../src/runtime/service';
import { pythonLiteral as q } from '../src/runtime/literals';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { isolateRenpySaves } from './lib/renpy-saves';
import { createGameFlowTransitionsRuntimeFixture, gameFlowTransitionColors, gameFlowTransitionScenarioIds, type GameFlowTransitionScenarioId } from './lib/game-flow-transitions-runtime-fixture';
import { writeUiSpineFixtureAssets } from './lib/ui-spine-fixture';

// Prepare first; run only after the entire product implementation is ready.
// Each scenario compiles a real authored top-level flow in its own save/profile
// directory. No test calls a product transition, substitutes a menu screenshot,
// or jumps into the flow labels. Native Start/MainMenu follow the actual routes.
const args = process.argv.slice(2);
assert.ok(args.length <= 1 && args.every(arg => /^--scenario=[a-z_]+$/.test(arg)), 'Usage: verify-game-flow-transitions-runtime.ts [--scenario=name]');
const requested = args[0]?.slice('--scenario='.length);
const scenarios = requested ? gameFlowTransitionScenarioIds.filter(id => id === requested) : [...gameFlowTransitionScenarioIds];
assert.ok(scenarios.length, 'Unknown scenario: ' + requested);
const sdk = process.env.VNS_RENPY_SDK ?? path.resolve('resources/runtime');
const output = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? 'artifacts/editor-refinements-2026-11-10/opening-runtime', 'runtime-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const authorFile = path.resolve(process.env.VNS_AUTHOR_PROJECT ?? '../我的视觉小说1/project.vns.json');
const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const previousRenpySaves = process.env.RENPY_PATH_TO_SAVES;
const report: Record<string, unknown> = { status: 'running', authorFile, scenarioSelection: requested ?? 'all', runs: [],
  observations: 'Actual three-second savedAction image timeline, main-menu screens and pixels, page/logic continuations, page closing source and real skip continue/title, top-level video target and tail, new-game and save/rollback, title policies, input, silent opening and author/title music ownership, looping versus once-only title video/Spine, deferred media failure callbacks. Separate base-context custom pages restore genuinely pending failures and consumed failures through native save/load. No product test branches.',
  samplingLimits: 'Read-only renderer samples are throttled to 35ms. Stage, menu marker, two interior video pixels and two Spine edge pixels are sampled, not every frame or the whole screen. The local 1.2s video is silent: it proves visual playback, positions and lifecycle ordering, not embedded audio volume or synchronization. Spine uses the existing local 4.2 rig fixture, not the author project artwork. The SDK title child context is not saveable: pending save/load coverage belongs to beforeNewGame custom pages, not title restoration.' };
let authorHash: string | undefined, failure: unknown;
await fs.mkdir(output, { recursive: true });
const saveReport = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));

function solidPng(rgb: readonly number[]) {
  const png = new PNG({ width: 32, height: 32 });
  for (let offset = 0; offset < png.data.length; offset += 4) { png.data[offset] = rgb[0]; png.data[offset + 1] = rgb[1]; png.data[offset + 2] = rgb[2]; png.data[offset + 3] = 255; }
  return PNG.sync.write(png);
}

function toneWav(frequency = 440) {
  const rate = 22050, samples = rate * 8, data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF', 0); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(Math.sin(i / rate * Math.PI * frequency) * 1100), 44 + i * 2);
  return data;
}

function nativeCases(scenario: GameFlowTransitionScenarioId) {
  const cases: { name: string; source: string }[] = [];
  const add = (name: string, body: string) => cases.push({ name, source: `testcase ${name}:\n    $ gft_probe.case = ${q(name)}\n${body.trimEnd()}\n` });
  const titleMusic = scenario === 'no_title_music' ? 'None' : q('assets/menu-tone.wav');
  const menuVideo = scenario === 'title_loop_video' || scenario === 'title_once_video';
  const menuSpine = scenario === 'title_loop_spine' || scenario === 'title_once_spine';
  const liveVideos = scenario === 'title_loop_video' ? '("gft_menu_video", "gft_broken_video")' : '("gft_menu_video",)';
  const liveSpines = scenario === 'title_loop_spine' ? '("gft_menu_spine", "gft_broken_spine")' : '("gft_menu_spine",)';
  const titleClean = menuVideo ? 'gft_clean(' + liveVideos + ')' : menuSpine ? 'gft_clean((), ' + liveSpines + ')' : 'gft_clean()';
  const openingMusic = scenario === 'authored_opening_music' || scenario === 'no_title_music' ? q('assets/opening-tone.wav') : 'None';
  const title = `    pause until eval gft_title_ready()
    assert eval renpy.get_screen("main_menu") is not None and main_menu
    assert eval gft_probe.frames[-1]["menu"] and gft_is(gft_probe.frames[-1]["pixel"], "blue") and gft_is(gft_probe.frames[-1]["marker"], "yellow")
    assert eval persistent.vn_var_gft_menu_shows == 1 and persistent.vn_var_gft_button_clicks == 0
    assert eval ${titleClean} and renpy.music.get_playing(channel="music") == ${titleMusic}
    assert eval config.main_menu_music is None and vn_main_menu_music == ${titleMusic} and vn_main_menu_music_fadein == 0
    assert eval gft_title_music_boundary(${titleMusic})`;
  const imagePlayed = `    assert eval gft_step_duration("gft_intro", 0) >= 2.85
    assert eval gft_step_color_span("gft_intro", 0, "red") >= 2.6
    assert eval len(gft_steps("gft_intro")) == 1 and gft_graph_count("gft_opening") == 1
    assert eval gft_step_music("gft_intro", 0, ${openingMusic}, 2.6)`;
  const menuEffect = `    assert eval gft_edge_order() == [("flow:step:gft_intro", "next")]
    assert eval gft_edge_blend(0, "red", "blue", .64)
    assert eval gft_marker_blend(0, "red", "yellow")
    assert eval gft_menu_show_after_transition(0, 0)
    assert eval gft_music_continuous(0)`;
  const cancelPage = `    pause until eval "gft_page" in vn_ui_open_pages and gft_graph_count("gft_page_shown") == 1 and not gft_transition_running()
    pause until eval gft_step_color_span("gft_page_step", 0, "green") >= .2
    assert eval persistent.vn_var_gft_page_shows == 1 and gft_probe.frames[-1]["step"] == "gft_page_step" and not gft_probe.frames[-1]["transitioning"]
    click "跳过"
${title}
${imagePlayed}
    assert eval len(gft_steps("gft_page_step")) == 1 and gft_steps("gft_page_step")[0]["pageReason"] == "cancelled"
    assert eval gft_graph_count("gft_page_shown") == 1 and persistent.vn_var_gft_page_shows == 1 and gft_graph_count("gft_main_shown") == 1
    assert eval gft_edge_blend(0, "red", "green", .48)
    assert eval gft_clean() and vn_game_flow_source_hold is None and not vn_game_flow_source_cover_visible() and vn_game_flow_transition_snapshot is None`;

  if (scenario === 'image_dissolve') {
    add('three_second_image_tail_dissolves_into_actual_menu', `
${title}
${imagePlayed}
${menuEffect}
    screenshot "image-dissolve-real-title.png"`);
    add('new_game_first_frame_save_rollback_and_launch_repeat', `
    pause until eval gft_title_ready()
    click id "vn_component_gft_start"
    pause until eval len(gft_probe.edges) == 2 and gft_in_edge(1) and gft_now() - gft_probe.edges[1]["time"] >= .12
    run Function(gft_save_during_transition, "gft-inside-start", _update_screens=False)
    pause until "游戏入口过渡已进入剧情。"
    assert eval not main_menu and persistent.vn_var_gft_story_entries == 1
    assert eval gft_edge_order() == [("flow:step:gft_intro", "next"), ("flow:step:gft_prelude_step", "next")]
    assert eval gft_edge_blend(1, "green", "blue", .42)
    assert eval len(gft_steps("gft_prelude_step")) == 1 and gft_graph_count("gft_prelude") == 1
    assert eval len(gft_probe.saves) == 1 and gft_probe.saves[0]["duringTransition"] and renpy.can_load("gft-inside-start")
    assert eval renpy.music.get_playing(channel="music") is None and gft_clean()
    $ renpy.save("gft-story")
    keysym "dismiss"
    pause until "这是回退验证的第二句。"
    run Rollback(force=True, checkpoints=1)
    pause until "游戏入口过渡已进入剧情。"
    assert eval len(gft_probe.edges) == 2 and persistent.vn_var_gft_story_entries == 1 and gft_clean()
    run FileLoad("gft-story", confirm=False, slot=True)
    pause until eval len(gft_probe.loads) == 1
    pause until "游戏入口过渡已进入剧情。"
    assert eval len(gft_probe.edges) == 2 and len(gft_edge_withs(1)) == 1 and gft_graph_count("gft_prelude") == 1 and gft_clean()
    run FileLoad("gft-inside-start", confirm=False, slot=True)
    pause until eval len(gft_probe.loads) == 2
    pause until "游戏入口过渡已进入剧情。"
    assert eval len(gft_probe.edges) == 2 and len(gft_edge_withs(1)) == 1 and gft_graph_count("gft_prelude") == 1 and gft_clean()
    assert eval persistent.vn_var_gft_story_entries == 1
    run MainMenu(confirm=False)
    pause until eval gft_title_ready()
    assert eval len(gft_steps("gft_intro")) == 1 and len(gft_probe.edges) == 2 and persistent.vn_var_gft_menu_shows == 2
    assert eval gft_clean() and renpy.music.get_playing(channel="music") == "assets/menu-tone.wav"
    assert eval gft_title_music_boundary("assets/menu-tone.wav")
    screenshot "launch-return-does-not-replay.png"`);
  } else if (scenario === 'image_color') {
    add('color_out_hold_in_uses_image_tail_and_menu_layers', `
${title}
${imagePlayed}
    assert eval gft_edge_order() == [("flow:step:gft_intro", "next")]
    assert eval gft_edge_color(0, "red", "blue", .24, .2, .28)
    assert eval gft_marker_blend(0, "black", "yellow") and gft_music_continuous(0)
    assert eval gft_menu_show_after_transition(0, 0)
    screenshot "color-real-title.png"`);
    add('title_repeat_physical_click_does_not_reach_menu_buttons', `
    pause until eval gft_title_ready()
    click id "vn_component_gft_start"
    pause until "游戏入口过渡已进入剧情。"
    run MainMenu(confirm=False)
    pause until eval len(gft_probe.edges) == 2 and gft_in_edge(1) and gft_now() - gft_probe.edges[1]["time"] >= .12
    run Function(gft_click_during_transition, _update_screens=False)
    pause until eval gft_title_ready()
    assert eval len(gft_probe.inputs) == 1 and gft_probe.inputs[0]["duringTransition"]
    assert eval persistent.vn_var_gft_button_clicks == 0 and persistent.vn_var_gft_story_entries == 1
    assert eval len(gft_steps("gft_intro")) == 2 and gft_graph_count("gft_opening") == 2 and persistent.vn_var_gft_menu_shows == 2
    assert eval gft_step_music("gft_intro", 1, None, 2.6) and gft_music_continuous(1, "assets/menu-tone.wav") and gft_title_music_boundary("assets/menu-tone.wav")
    assert eval gft_clean()
    click id "vn_component_gft_touch"
    pause until eval persistent.vn_var_gft_button_clicks == 1
    assert eval persistent.vn_var_gft_button_clicks == 1
    screenshot "post-transition-click-works-once.png"`);
    add('transition_preference_and_authored_skip_preserve_completion', `
    pause until eval gft_title_ready()
    click id "vn_component_gft_start"
    pause until "游戏入口过渡已进入剧情。"
    $ preferences.transitions = 0
    run MainMenu(confirm=False)
    pause until eval gft_title_ready()
    assert eval len(gft_probe.edges) == 3 and gft_transition_span(2) < .2
    assert eval len(gft_steps("gft_intro")) == 3 and gft_step_duration("gft_intro", 2) >= 2.85
    assert eval gft_step_music("gft_intro", 2, None, 2.6) and gft_title_music_boundary("assets/menu-tone.wav")
    assert eval persistent.vn_var_gft_menu_shows == 3 and gft_clean()
    $ preferences.transitions = 2
    click id "vn_component_gft_start"
    pause until "游戏入口过渡已进入剧情。"
    run MainMenu(confirm=False)
    pause until eval len(gft_steps("gft_intro")) == 4 and gft_now() - gft_steps("gft_intro")[3]["start"] >= .35
    click "跳过这一项"
    pause until eval gft_title_ready()
    assert eval .2 <= gft_step_duration("gft_intro", 3) < 2.5
    assert eval gft_step_music("gft_intro", 3, None, .1) and gft_title_music_boundary("assets/menu-tone.wav")
    assert eval len(gft_probe.edges) == 4 and persistent.vn_var_gft_menu_shows == 4
    assert eval persistent.vn_var_gft_button_clicks == 1 and gft_clean()
    screenshot "skip-and-preference-complete.png"`);
  } else if (scenario === 'image_none') {
    add('explicit_none_and_empty_new_game_route_transition', `
${title}
${imagePlayed}
    assert eval gft_edge_order() == [("flow:step:gft_intro", "next")] and gft_probe.edges[0]["spec"]["mode"] == "none"
    assert eval gft_transition_span(0) < .2
    assert eval not gft_has_mixed(0, "red", "blue")
    click id "vn_component_gft_start"
    pause until eval len(gft_probe.edges) == 2 and gft_in_edge(1) and gft_now() - gft_probe.edges[1]["time"] >= .12
    run Function(gft_escape_during_transition, _update_screens=False)
    pause until "游戏入口过渡已进入剧情。"
    assert eval gft_edge_order() == [("flow:step:gft_intro", "next"), ("flow:newGame", "next")]
    assert eval gft_edge_blend(1, "blue", "green", .42)
    assert eval len(gft_probe.inputs) == 1 and gft_probe.inputs[0]["key"] == "K_ESCAPE" and gft_probe.inputs[0]["duringTransition"] and gft_escape_stayed_in_story()
    assert eval persistent.vn_var_gft_story_entries == 1 and gft_clean() and renpy.music.get_playing(channel="music") is None
    screenshot "empty-newgame-edge-first-story-frame.png"`);
  } else if (scenario === 'image_default') {
    add('absent_transition_keeps_default_flow_and_music', `
${title}
${imagePlayed}
    assert eval not gft_probe.edges and not [row for row in gft_probe.withs if row["gameFlow"]]
    assert eval gft_graph_count("gft_main_shown") == 1
    click id "vn_component_gft_start"
    pause until "游戏入口过渡已进入剧情。"
    run MainMenu(confirm=False)
    pause until eval gft_title_ready()
    assert eval len(gft_steps("gft_intro")) == 1 and not gft_probe.edges
    assert eval persistent.vn_var_gft_menu_shows == 2 and gft_clean()
    screenshot "default-return-title.png"`);
  } else if (scenario === 'page_logic_chain') {
    add('page_and_transparent_logic_continue_to_next_real_frame', `
${title}
${imagePlayed}
    assert eval gft_edge_order() == [("flow:step:gft_intro", "next"), ("flow:step:gft_page_step", "next"), ("flow:step:gft_logic_step", "next"), ("flow:step:gft_after_page_step", "next")]
    assert eval gft_edge_blend(0, "red", "green", .48)
    assert eval gft_music_continuous(0, None) and gft_step_music("gft_page_step", 0, None, .5) and gft_music_continuous(3, "assets/menu-tone.wav")
    assert eval not gft_edge_withs(1) and gft_probe.edges[1]["spec"]["mode"] == "color"
    assert eval gft_probe.edges[2]["spec"]["mode"] == "none" and gft_transition_span(2) < .2 and not gft_has_mixed(2, "green", "red")
    assert eval gft_edge_blend(3, "red", "blue", .64) and gft_marker_blend(3, "red", "yellow")
    assert eval persistent.vn_var_gft_page_shows == 1 and persistent.vn_var_gft_logic_count == 1
    assert eval gft_graph_count("gft_page_shown") == 1 and gft_graph_count("gft_logic") == 1 and gft_graph_count("gft_after_page") == 1
    assert eval gft_step_color_span("gft_page_step", 0, "green") >= .5
    assert eval gft_step_color_span("gft_after_page_step", 0, "red") >= .48
    assert eval gft_clean() and not vn_ui_open_pages and not vn_ui_page_sessions
    screenshot "chain-final-real-title.png"`);
  } else if (scenario === 'video_tail') {
    add('native_video_last_frame_transitions_then_releases_resources', `
${title}
    assert eval gft_step_duration("gft_intro", 0) >= 1.05
    assert eval gft_step_music("gft_intro", 0, None, .8)
    assert eval gft_step_color_span("gft_intro", 0, "magenta") >= .3 and gft_step_color_span("gft_intro", 0, "cyan") >= .3
    assert eval gft_edge_order() == [("flow:step:gft_intro", "next")]
    assert eval gft_edge_blend(0, "cyan", "blue", .64) and gft_marker_blend(0, "cyan", "yellow")
    assert eval gft_media_released() and gft_clean() and gft_music_continuous(0)
    click id "vn_component_gft_start"
    pause until "游戏入口过渡已进入剧情。"
    run MainMenu(confirm=False)
    pause until eval gft_title_ready()
    assert eval len(gft_steps("gft_intro")) == 1 and len(gft_probe.edges) == 1 and gft_media_released()
    screenshot "video-tail-no-black-flash.png"`);
  } else if (scenario === 'page_tail') {
    add('closed_auto_page_snapshot_transitions_to_actual_menu_once', `
${title}
${imagePlayed}
    assert eval gft_edge_order() == [("flow:step:gft_intro", "next"), ("flow:step:gft_page_step", "next")]
    assert eval gft_edge_blend(0, "red", "green", .48)
    assert eval gft_step_color_span("gft_page_step", 0, "green") >= .5
    assert eval gft_page_source_captured_once("gft_page_step", "gft_page", 1)
    assert eval gft_edge_blend(1, "green", "blue", .64) and gft_marker_blend(1, "green", "yellow")
    assert eval gft_menu_show_after_transition(1, 0) and gft_music_continuous(1)
    assert eval gft_graph_count("gft_page_shown") == 1 and persistent.vn_var_gft_page_shows == 1 and gft_graph_count("gft_main_shown") == 1
    assert eval len(gft_probe.captures) == 2 and gft_clean() and not vn_ui_open_pages and not vn_ui_page_sessions
    screenshot "closed-page-source-real-title.png"`);
  } else if (scenario === 'video_target') {
    add('page_enters_held_top_level_movie_then_full_clip_and_menu', `
${title}
${imagePlayed}
    assert eval gft_edge_order() == [("flow:step:gft_intro", "next"), ("flow:step:gft_page_step", "next"), ("flow:step:gft_target_video", "next")]
    assert eval gft_edge_blend(0, "red", "green", .48) and gft_step_color_span("gft_page_step", 0, "green") >= .5
    assert eval gft_page_source_captured_once("gft_page_step", "gft_page", 1)
    assert eval gft_edge_blend(1, "green", "magenta", 1.4) and gft_marker_blend(1, "green", "magenta")
    assert eval gft_top_movie_held_first_frame(1, "gft_target_video")
    assert eval gft_top_movie_full_clip_after_release(1, "gft_target_video", 1.2)
    assert eval gft_step_color_span("gft_target_video", 0, "magenta") >= .44 and gft_step_color_span("gft_target_video", 0, "cyan") >= .44
    assert eval gft_edge_blend(2, "cyan", "blue", .64) and gft_marker_blend(2, "cyan", "yellow")
    assert eval gft_graph_count("gft_page_shown") == 1 and persistent.vn_var_gft_page_shows == 1 and gft_graph_count("gft_main_shown") == 1
    assert eval len(gft_steps("gft_target_video")) == 1 and len(gft_probe.movieReleases) == 1 and len(gft_probe.captures) == 3
    assert eval gft_menu_show_after_transition(2, 0) and gft_music_continuous(0, None) and gft_music_continuous(1, None) and gft_music_continuous(2, "assets/menu-tone.wav")
    assert eval gft_step_music("gft_page_step", 0, None, .5) and gft_step_music("gft_target_video", 0, None, 1.8)
    assert eval gft_clean() and gft_media_released() and not vn_ui_open_pages and not vn_ui_page_sessions
    screenshot "top-level-video-target-full-clip.png"`);
  } else if (scenario === 'page_cancel_continue') {
    add('real_page_skip_continues_with_one_source_capture_and_transition', `
${cancelPage}
    assert eval gft_edge_order() == [("flow:step:gft_intro", "next"), ("flow:step:gft_page_step", "next")]
    assert eval gft_page_source_captured_once("gft_page_step", "gft_page", 1)
    assert eval gft_edge_blend(1, "green", "blue", .64) and gft_marker_blend(1, "green", "yellow")
    assert eval gft_menu_show_after_transition(1, 0) and gft_music_continuous(1)
    assert eval len(gft_probe.captures) == 2
    screenshot "page-skip-continue-no-gap.png"`);
  } else if (scenario === 'page_cancel_title') {
    add('real_page_skip_to_title_discards_source_and_authored_next_edge', `
${cancelPage}
    assert eval gft_edge_order() == [("flow:step:gft_intro", "next")]
    assert eval len([row for row in gft_probe.withs if row["gameFlow"] and row["transition"] is not None]) == 1
    assert eval gft_steps("gft_page_step")[0]["endState"]["sourceHold"] is None and not gft_steps("gft_page_step")[0]["endState"]["sourceCoverVisible"] and gft_steps("gft_page_step")[0]["endState"]["snapshotBytes"] == 0
    assert eval not any(frame["state"]["sourceHold"] or frame["state"]["sourceCoverVisible"] for frame in gft_probe.frames if frame["time"] >= gft_steps("gft_page_step")[0]["end"])
    assert eval persistent.vn_var_gft_story_entries == 0 and persistent.vn_var_gft_button_clicks == 0
    screenshot "page-skip-title-no-source-retained.png"`);
  } else if (scenario === 'authored_opening_music' || scenario === 'no_title_music') {
    add(scenario === 'authored_opening_music' ? 'authored_opening_music_survives_page_and_video_then_title_takes_over' : 'silent_title_clears_authored_opening_music_at_its_reveal', `
${title}
${imagePlayed}
    assert eval gft_edge_order() == [("flow:step:gft_intro", "next"), ("flow:step:gft_page_step", "next"), ("flow:step:gft_target_video", "next")]
    assert eval gft_music_continuous(0, "assets/opening-tone.wav") and gft_music_continuous(1, "assets/opening-tone.wav") and gft_music_continuous(2, ${titleMusic})
    assert eval gft_step_music("gft_page_step", 0, "assets/opening-tone.wav", .5) and gft_step_music("gft_target_video", 0, "assets/opening-tone.wav", 1.8)
    assert eval gft_authored_music_preserved()
    assert eval gft_edge_blend(0, "red", "green", .48) and gft_edge_blend(1, "green", "magenta", 1.4) and gft_edge_blend(2, "cyan", "blue", .64)
    assert eval gft_top_movie_held_first_frame(1, "gft_target_video") and gft_top_movie_full_clip_after_release(1, "gft_target_video", 1.2)
    assert eval gft_menu_show_after_transition(2, 0) and persistent.vn_var_gft_page_shows == 1 and gft_graph_count("gft_main_shown") == 1
    assert eval gft_clean() and gft_media_released()
    screenshot "authored-music-title-boundary.png"
    click id "vn_component_gft_start"
    pause until "游戏入口过渡已进入剧情。"
    assert eval renpy.music.get_playing(channel="music") is None and gft_clean()
    run MainMenu(confirm=False)
    pause until eval gft_title_ready()
    assert eval len(gft_steps("gft_intro")) == 1 and persistent.vn_var_gft_menu_shows == 2 and gft_title_music_boundary(${titleMusic})
    assert eval renpy.music.get_playing(channel="music") == ${titleMusic} and gft_clean()`);
  } else if (scenario === 'title_loop_video' || scenario === 'title_once_video') {
    const videoEvidence = scenario === 'title_loop_video' ? `
    assert eval gft_ui_loop_video_during_transition(0, "gft_menu_video")
    pause until eval gft_now() - gft_edge_withs(0)[0]["end"] >= .7
    assert eval gft_ui_video_keeps_playing(0, "gft_menu_video")
    assert eval persistent.vn_var_gft_video_ended == 0 and persistent.vn_var_gft_video_failed == 0
    pause until eval persistent.vn_var_gft_broken_video_failed == 1
    assert eval gft_ui_video_failure_deferred(0, "gft_broken_video")
    screenshot "title-loop-video-keeps-moving.png"` : `
    assert eval gft_ui_once_video_held(0, "gft_menu_video")
    pause until eval persistent.vn_var_gft_video_ended == 1
    assert eval gft_ui_once_video_finished(0, "gft_menu_video", 1.2)
    pause until eval gft_now() - gft_video_end_events()[0]["time"] >= .3
    assert eval persistent.vn_var_gft_video_ended == 1 and persistent.vn_var_gft_video_failed == 0 and gft_graph_count("gft_video_ended_handler") == 1
    screenshot "title-once-video-completes-after-reveal.png"`;
    add(scenario === 'title_loop_video' ? 'looping_title_video_animates_inside_long_reveal_without_early_onshow' : 'once_only_title_video_keeps_first_frame_then_plays_whole_clip', `
${title}
${imagePlayed}
    assert eval gft_edge_order() == [("flow:step:gft_intro", "next")]
    assert eval gft_edge_blend(0, "red", "blue", 2.8) and gft_marker_blend(0, "red", "yellow")
    assert eval gft_menu_show_after_transition(0, 0) and gft_music_continuous(0, "assets/menu-tone.wav")
${videoEvidence}
    assert eval ${titleClean} and gft_graph_count("gft_main_shown") == 1
    click id "vn_component_gft_start"
    pause until "游戏入口过渡已进入剧情。"
    pause until eval all(gft_ui_video_released(component_id) for component_id in ${liveVideos})
    assert eval gft_clean() and gft_media_released() and renpy.music.get_playing(channel="music") is None
    screenshot "title-video-resources-released-in-story.png"`);
  } else if (scenario === 'title_loop_spine' || scenario === 'title_once_spine') {
    const spineEvidence = scenario === 'title_loop_spine' ? `
    assert eval gft_ui_loop_spine_during_transition(0, "gft_menu_spine")
    pause until eval gft_now() - gft_edge_withs(0)[0]["end"] >= .7
    assert eval gft_ui_spine_keeps_playing(0, "gft_menu_spine")
    assert eval persistent.vn_var_gft_spine_completed == 0 and persistent.vn_var_gft_spine_failed == 0
    pause until eval persistent.vn_var_gft_broken_spine_failed == 1
    assert eval gft_ui_spine_failure_deferred(0, "gft_broken_spine")
    screenshot "title-loop-spine-moves-through-color-reveal.png"` : `
    assert eval gft_ui_once_spine_held(0, "gft_menu_spine")
    pause until eval persistent.vn_var_gft_spine_completed == 1
    assert eval gft_ui_once_spine_finished(0, "gft_menu_spine", .6)
    pause until eval gft_now() - gft_spine_completed_events()[0]["time"] >= .3
    assert eval persistent.vn_var_gft_spine_completed == 1 and persistent.vn_var_gft_spine_failed == 0 and gft_graph_count("gft_spine_completed_handler") == 1
    screenshot "title-once-spine-completes-after-color-reveal.png"`;
    add(scenario === 'title_loop_spine' ? 'looping_title_spine_moves_inside_color_reveal_and_defers_failure' : 'once_only_title_spine_waits_for_color_reveal_then_finishes_once', `
${title}
${imagePlayed}
    assert eval gft_edge_order() == [("flow:step:gft_intro", "next")]
    assert eval gft_edge_color(0, "red", "blue", 1.4, 0, 1.4) and gft_marker_blend(0, "black", "yellow")
    assert eval gft_menu_show_after_transition(0, 0) and gft_music_continuous(0, "assets/menu-tone.wav")
${spineEvidence}
    assert eval ${titleClean} and gft_graph_count("gft_main_shown") == 1
    click id "vn_component_gft_start"
    pause until "游戏入口过渡已进入剧情。"
    pause until eval all(gft_ui_spine_released(component_id) for component_id in ${liveSpines})
    assert eval gft_clean() and renpy.music.get_playing(channel="music") is None
    screenshot "title-spine-resources-released-in-story.png"`);
  } else if (scenario === 'title_preview') {
    add('title_only_preview_skips_opening_without_consuming_profile_policy', `
${title}
    assert eval not gft_steps("gft_intro") and not gft_probe.edges and gft_graph_count("gft_opening") == 0
    assert eval not (persistent.vn_game_flow_seen or {}) and not renpy.session.get("vn_flow_preview_seen", {})
    click id "vn_component_gft_start"
    pause until "游戏入口过渡已进入剧情。"
    run MainMenu(confirm=False)
    pause until eval gft_title_ready()
    assert eval len(gft_steps("gft_intro")) == 1 and gft_graph_count("gft_opening") == 1
    assert eval gft_step_music("gft_intro", 0, None, 2.6) and gft_music_continuous(0, "assets/menu-tone.wav") and gft_title_music_boundary("assets/menu-tone.wav")
    assert eval gft_edge_blend(0, "red", "blue", .64) and gft_marker_blend(0, "red", "yellow")
    assert eval not (persistent.vn_game_flow_seen or {}) and renpy.session.get("vn_flow_preview_seen", {}).get("profile") is True
    click id "vn_component_gft_start"
    pause until "游戏入口过渡已进入剧情。"
    run MainMenu(confirm=False)
    pause until eval gft_title_ready()
    assert eval len(gft_steps("gft_intro")) == 1 and len(gft_probe.edges) == 1 and persistent.vn_var_gft_menu_shows == 3
    assert eval gft_clean() and not (persistent.vn_game_flow_seen or {})
    assert eval gft_title_music_boundary("assets/menu-tone.wav") and renpy.music.get_playing(channel="music") == "assets/menu-tone.wav"
    screenshot "title-preview-policy-isolation.png"`);
  }
  if (scenario === 'pending_video_load' || scenario === 'pending_spine_load') {
    const video = scenario === 'pending_video_load';
    const released = video ? 'gft_ui_video_released("gft_pending_media")' : 'gft_ui_spine_released("gft_pending_media")';
    add(video ? 'custom_page_video_pending_failure_survives_real_save_load_once' : 'custom_page_spine_pending_failure_survives_real_save_load_once', `
    pause until eval gft_title_ready()
    click id "vn_component_gft_start"
    pause until eval gft_pending_save_window()
    run Function(gft_save_and_load_pending_media, "gft-media-pending", _update_screens=False)
    pause until eval len(gft_probe.pendingLoads) == 1
    assert eval len(gft_probe.pendingSaves) == 1 and renpy.can_load("gft-media-pending")
    assert eval gft_probe.pendingSaves[0]["duringTransition"] and gft_probe.pendingSaves[0]["rootTransition"] and gft_probe.pendingSaves[0]["step"] == "gft_pending_page_step"
    assert eval gft_probe.pendingSaves[0]["status"] == "failed" and gft_probe.pendingSaves[0]["eventPending"] and not gft_probe.pendingSaves[0]["didShow"]
    assert eval gft_probe.pendingSaves[0]["baseContext"] and gft_probe.pendingSaves[0]["sessionOwnerMatches"] and gft_probe.pendingSaves[0]["rowOwnerMatches"] and gft_probe.pendingSaves[0]["pageInstanceMatches"]
    assert eval gft_probe.pendingSaves[0]["shows"] == gft_probe.pendingSaves[0]["failed"] == 0 and gft_probe.pendingSaves[0]["liveOwnerMatches"] and gft_probe.pendingSaves[0]["taskAlive"]
    assert eval gft_pending_loaded_record(0, True) and gft_probe.pendingLoads[0]["shows"] == gft_probe.pendingLoads[0]["failed"] == 0
    assert eval not gft_probe.pendingLoads[0]["live"] and not gft_probe.pendingLoads[0]["nativeResource"] and not gft_probe.pendingLoads[0]["playing"]
    assert eval not gft_probe.pendingLoads[0]["activeTransition"] and not gft_probe.pendingLoads[0]["pendingTransition"]
    pause until eval gft_pending_page_ready()
    pause .25
    assert eval vn_var_gft_pending_shows == vn_var_gft_pending_failed == 1 and not gft_pending_snapshot()["eventPending"]
    assert eval gft_pending_snapshot()["status"] == "failed" and gft_pending_snapshot()["error"] == gft_probe.pendingSaves[0]["error"] and bool(gft_pending_snapshot()["error"])
    assert eval gft_pending_snapshot()["baseContext"] and gft_pending_snapshot()["sessionOwnerMatches"] and gft_pending_snapshot()["rowOwnerMatches"] and gft_pending_snapshot()["pageInstanceMatches"]
    assert eval gft_pending_snapshot()["liveOwnerMatches"] and gft_pending_snapshot()["taskAlive"] and gft_pending_snapshot()["pageToken"] == gft_probe.pendingSaves[0]["pageToken"]
    assert eval gft_pending_snapshot()["sourceSequence"] == gft_probe.pendingSaves[0]["sourceSequence"] and gft_pending_snapshot()["lastSample"] == gft_probe.pendingSaves[0]["lastSample"]
    assert eval gft_graph_count("gft_pending_page_shown") == gft_graph_count("gft_pending_failed_handler") == 1 and gft_pending_callback_after_restore()
    assert eval len(gft_steps("gft_pending_prelude_step")) == len(gft_steps("gft_pending_page_step")) == 1 and gft_graph_count("gft_pending_prelude") == 1
    assert eval gft_edge_order() == [("flow:step:gft_intro", "next"), ("flow:step:gft_pending_prelude_step", "next")] and vn_game_flow_transition_snapshot is None
    screenshot "${scenario}-pending-restored-once.png"
    run Function(gft_save_consumed_media, "gft-media-consumed", _update_screens=False)
    assert eval len(gft_probe.pendingSaves) == 2 and renpy.can_load("gft-media-consumed") and gft_probe.pendingSaves[1]["didShow"] and not gft_probe.pendingSaves[1]["eventPending"]
    click id "vn_component_gft_pending_close"
    pause until "游戏入口过渡已进入剧情。"
    assert eval ${released} and gft_clean() and "gft_pending_page" not in vn_ui_page_sessions
    run FileLoad("gft-media-consumed", confirm=False, slot=True)
    pause until eval len(gft_probe.pendingLoads) == 2
    assert eval gft_pending_loaded_record(1, False) and gft_probe.pendingLoads[1]["shows"] == gft_probe.pendingLoads[1]["failed"] == 1
    assert eval not gft_probe.pendingLoads[1]["live"] and not gft_probe.pendingLoads[1]["nativeResource"] and not gft_probe.pendingLoads[1]["playing"]
    pause until eval gft_pending_page_ready()
    $ renpy.restart_interaction()
    pause .3
    assert eval vn_var_gft_pending_shows == vn_var_gft_pending_failed == 1 and gft_graph_count("gft_pending_page_shown") == gft_graph_count("gft_pending_failed_handler") == 1
    assert eval len(gft_probe.pendingEvents) == 1 and gft_pending_snapshot()["status"] == "failed" and not gft_pending_snapshot()["eventPending"]
    assert eval gft_pending_snapshot()["rowOwnerMatches"] and gft_pending_snapshot()["liveOwnerMatches"] and gft_pending_snapshot()["taskAlive"] and gft_pending_snapshot()["pageToken"] == gft_probe.pendingSaves[1]["pageToken"]
    assert eval gft_pending_snapshot()["sourceSequence"] == gft_probe.pendingSaves[1]["sourceSequence"] and gft_pending_snapshot()["lastSample"] == gft_probe.pendingSaves[1]["lastSample"]
    assert eval gft_graph_count("gft_pending_prelude") == 1 and len(gft_steps("gft_pending_page_step")) == 1 and len(gft_probe.edges) == 2
    screenshot "${scenario}-consumed-load-no-repeat.png"
    click id "vn_component_gft_pending_close"
    pause until "游戏入口过渡已进入剧情。"
    assert eval ${released} and gft_clean() and "gft_pending_page" not in vn_ui_page_sessions and renpy.music.get_playing(channel="music") is None`);
  }
  assert.ok(cases.length, 'Every flow scenario needs explicit native coverage: ' + scenario);
  return cases;
}

function observer(scenario: GameFlowTransitionScenarioId, directory: string) {
  return String.raw`init -999 python:
    import renpy as _gft_engine
    _gft_engine.safe_mode_checked = True

init 999 python:
    import json as gft_json
    import os as gft_os
    import time as gft_time

    # These function attributes are test evidence, outside saved/rollback state.
    # Only the completed renderer and scalar runtime diagnostics are observed.
    def gft_probe():
        pass

    gft_probe.started = gft_time.monotonic()
    gft_probe.case = "cold-launch"
    gft_probe.frames, gft_probe.edges, gft_probe.withs = [], [], []
    gft_probe.steps, gft_probe.graphs, gft_probe.loads, gft_probe.labels = [], [], [], []
    gft_probe.music, gft_probe.inputs, gft_probe.saves, gft_probe.captures = [], [], [], []
    gft_probe.movieReleases = []
    gft_probe.menuScreens = []
    gft_probe.mediaEvents = []
    gft_probe.pendingSaves, gft_probe.pendingLoads, gft_probe.pendingEvents = [], [], []
    gft_probe.pendingSlot = None
    gft_probe.title_host, gft_probe.pending_menu_flush = False, None
    gft_probe.sample_at = -1.0
    gft_probe.shots, gft_probe.channels = {}, set(["movie"])
    gft_probe.active_step, gft_probe.active_with = None, None

    def gft_now():
        return gft_time.monotonic() - gft_probe.started

    def gft_json_copy(value):
        return gft_json.loads(gft_json.dumps(value))

    def gft_is(pixel, shade):
        return all(abs(actual - expected) <= 25 for actual, expected in zip(pixel, @@COLORS@@[shade]))

    def gft_mixed(pixel, first, last):
        a, b = @@COLORS@@[first], @@COLORS@@[last]
        longest = max(range(3), key=lambda axis: abs(b[axis] - a[axis]))
        if abs(b[longest] - a[longest]) < 50:
            return False
        progress = (pixel[longest] - a[longest]) / float(b[longest] - a[longest])
        return .12 <= progress <= .88 and all(abs(pixel[axis] - (a[axis] * (1 - progress) + b[axis] * progress)) <= 28 for axis in range(3))

    def gft_transition_running():
        interface = renpy.game.interface
        # SDK dictionaries may retain a completed layer until the interaction
        # boundary. Ask the SDK's actual delay clock, not the dictionary's size.
        return bool(vn_game_flow_transition_active is not None
            or any(interface.get_ongoing_transition(layer) is not None for layer in interface.ongoing_transition))

    def gft_active_state():
        active = vn_game_flow_transition_active
        request = vn_game_flow_transition_request
        scope = vn_game_flow_source_scope
        hold = vn_game_flow_source_hold
        return dict(active=active is not None, pending=request is not None,
            source=(active or request or {}).get("nodeId"), port=(active or request or {}).get("port"),
            snapshotBytes=len(vn_game_flow_transition_snapshot or b""), movie=vn_game_flow_movie is not None,
            scope={key: scope.get(key) for key in ("token", "preserve", "until", "presented", "captured")} if scope else None,
            sourceHold={key: hold.get(key) for key in ("token", "pageId", "pageToken")} if hold else None,
            sourceCoverVisible=bool(vn_game_flow_source_cover_visible()),
            retiredMedia=len(vn_flow_retired_visual_media),
            flushOwner=getattr(vn_game_flow_transition_flush, "owner", None) is not None)

    def gft_active_edge():
        active = vn_game_flow_transition_active
        if active is None:
            return None
        return next((row["index"] for row in reversed(gft_probe.edges)
            if row["source"] == active.get("nodeId") and row["port"] == active.get("port") and row["spec"] == active.get("transition")), None)

    def gft_visual(tag, entry):
        data = entry["data"]
        movie = data.get("_vn_movie")
        channel = movie.channel if movie is not None else None
        if channel:
            gft_probe.channels.add(channel)
        return dict(tag=tag, content=data.get("content"), instanceId=data.get("instanceId"),
            duration=data.get("duration"), age=vn_visual_age(data) if "_vn_started" in data else None,
            showing=renpy.showing(tag, layer="master"), expired=bool(data.get("_vn_expired")),
            keepFinal=bool(data.get("_vn_keep_final_frame")), held=bool(data.get("_vn_flow_hold")),
            gameFlowToken=(data.get("_vn_game_flow_source") or {}).get("token"), gameFlowEnd=data.get("_vn_game_flow_end"),
            sourceHeld=vn_game_flow_source_holds(data),
            channel=channel, playing=renpy.music.get_playing(channel=channel) if channel and renpy.music.channel_defined(channel) else None)

    def gft_ui_video(component_id):
        # Observers never call snapshot/presence/get: those create page tasks.
        config_row = vn_ui_videos.get(component_id)
        if config_row is None:
            return None
        channel = config_row["channel"]
        gft_probe.channels.add(channel)
        row = vn_ui_video_states.get(component_id)
        live = getattr(vn_ui_video_poll, "live", {}).get(component_id)
        return dict(channel=channel, record=row is not None, live=live is not None,
            status=(row or {}).get("status"), mode=(row or {}).get("mode"), loop=(row or {}).get("loop"),
            position=(row or {}).get("position"), sourceSequence=(row or {}).get("sourceSequence"),
            sequence=(row or {}).get("sequence"), eventPending=bool((row or {}).get("eventPending")),
            owner=id(row["owner"]) if row and row.get("owner") is not None else None,
            started=bool((live or {}).get("started")), decoded=bool((live or {}).get("decoded")), held=bool((live or {}).get("flowHeld")),
            playing=renpy.music.get_playing(channel=channel), rawPosition=renpy.music.get_pos(channel=channel), paused=renpy.music.get_pause(channel=channel))

    def gft_ui_spine(component_id):
        row = vn_spine_states.get(component_id)
        live = vns_spine._live.get(component_id)
        native = (live or {}).get("native")
        values = ((live or {}).get("pending") or {}).get("values", {})
        return dict(record=row is not None, live=live is not None, native=bool(native and native.handle),
            owner=id(row["owner"]) if row and row.get("owner") is not None else None,
            status=(row or {}).get("status"), position=(row or {}).get("time"), renderPosition=values.get("time"), renderStatus=values.get("status"),
            duration=(row or {}).get("duration"), durationKnown=bool((row or {}).get("durationKnown")),
            sourceSequence=(row or {}).get("sourceSequence"), eventPending=bool((row or {}).get("eventPending")),
            loop=(row or {}).get("loop"), paused=(row or {}).get("paused"), suspended=(row or {}).get("suspended"))

    def gft_capture(force=False):
        if not renpy.game.interface.started:
            return
        now = gft_now()
        if not force and now - gft_probe.sample_at < .035:
            return
        gft_probe.sample_at = now
        surface = renpy.display.draw.screenshot(renpy.game.interface.surftree)
        w, h = surface.get_size()
        def pixel(x, y):
            return list(surface.get_at((int(w * x), int(h * y)))[:3])
        frame = dict(time=now, case=gft_probe.case, pixel=pixel(.73, .28), marker=pixel(.89, .13),
            videoPixels=[pixel(.60, .44), pixel(.68, .50)],
            spinePixels=[pixel(.696, .411), pixel(.696, .529)],
            frameSize=[w, h], menu=bool(renpy.get_screen("main_menu")), mainMenu=bool(main_menu),
            currentNode=vn_current_node, phase=vn_flow_phase,
            step=(vn_flow_active_step or {}).get("id"), stepIndex=gft_probe.active_step,
            edge=len(gft_probe.edges) - 1 if gft_probe.edges else None, withIndex=gft_probe.active_with,
            transitioning=gft_transition_running(), transitionEdge=gft_active_edge(), state=gft_active_state(),
            rootTransition=bool(renpy.game.interface.get_ongoing_transition(None)), transitionPause=bool(renpy.game.interface.trans_pause),
            menuShows=persistent.vn_var_gft_menu_shows, buttonClicks=persistent.vn_var_gft_button_clicks,
            pageShows=persistent.vn_var_gft_page_shows, logicCount=persistent.vn_var_gft_logic_count,
            videoEnded=persistent.vn_var_gft_video_ended, videoFailed=persistent.vn_var_gft_video_failed,
            brokenVideoFailed=persistent.vn_var_gft_broken_video_failed,
            spineCompleted=persistent.vn_var_gft_spine_completed, spineFailed=persistent.vn_var_gft_spine_failed,
            brokenSpineFailed=persistent.vn_var_gft_broken_spine_failed,
            pages=list(vn_ui_open_pages), music=renpy.music.get_playing(channel="music"), musicPosition=renpy.music.get_pos(channel="music"),
            movie=renpy.music.get_playing(channel="movie"), visuals=[gft_visual(tag, entry) for tag, entry in vn_visual_instances.items()])
        for channel in renpy.audio.audio.channels:
            # SDK numeric aliases share this registry with named channels.
            # Movie ownership supplies its real named channel separately.
            if isinstance(channel, str) and ("movie" in channel.lower() or "gft" in channel.lower()):
                gft_probe.channels.add(channel)
        if vn_game_flow_movie is not None and vn_game_flow_movie.channel:
            gft_probe.channels.add(vn_game_flow_movie.channel)
        movie = vn_game_flow_movie
        movie_channel = movie.channel if movie is not None else None
        frame["topMovie"] = dict(identity=id(movie), channel=movie_channel,
            playing=renpy.music.get_playing(channel=movie_channel), position=renpy.music.get_pos(channel=movie_channel),
            paused=renpy.music.get_pause(channel=movie_channel)) if movie_channel and renpy.music.channel_defined(movie_channel) else None
        frame["uiVideos"] = {component_id: gft_ui_video(component_id) for component_id in vn_ui_videos}
        frame["uiSpines"] = {component_id: gft_ui_spine(component_id) for component_id in vn_spine_components}
        frame["media"] = {channel: renpy.music.get_playing(channel=channel) for channel in gft_probe.channels if renpy.music.channel_defined(channel)}
        gft_probe.frames.append(frame)
        # Keep a few real rendered frames in memory; encode screenshots after
        # the testcase, so writing evidence never consumes transition time.
        edge = frame["edge"]
        if edge is not None:
            flags = ["first"] if not any(key.startswith(str(edge) + "-") for key in gft_probe.shots) else []
            if frame["transitioning"] and not any(gft_is(frame["pixel"], shade) for shade in @@COLORS@@):
                flags.append("mixed")
            if frame["menu"] and gft_is(frame["pixel"], "blue") and gft_is(frame["marker"], "yellow"):
                flags.append("menu")
            if gft_is(frame["pixel"], "black"):
                flags.append("black")
            if frame["step"] == "gft_target_video" and frame["topMovie"] and not frame["transitioning"]:
                flags.extend(shade for shade in ("magenta", "cyan") if gft_is(frame["pixel"], shade))
            if frame["uiVideos"]:
                for shade in ("magenta", "cyan"):
                    if frame["transitioning"] and gft_video_blend_kind(frame) == shade:
                        flags.append("video-blend-" + shade)
                    elif not frame["transitioning"] and all(gft_is(value, shade) for value in frame["videoPixels"]):
                        flags.append("video-" + shade)
            if frame["uiSpines"]:
                pose = gft_spine_pose(frame, "black" if frame["transitioning"] else None)
                if pose is not None:
                    flags.append(("spine-blend-" if frame["transitioning"] else "spine-") + str(pose))
            for flag in flags:
                key = str(edge) + "-" + flag
                if key not in gft_probe.shots:
                    gft_probe.shots[key] = surface.copy()

    def gft_draw(self, *args, **kwargs):
        result = gft_draw.original(self, *args, **kwargs)
        gft_capture()
        return result

    def gft_queue(spec, *args, **kwargs):
        if spec is not None:
            node = args[0] if args else kwargs.get("node_id")
            port = args[1] if len(args) > 1 else kwargs.get("port", "next")
            gft_probe.edges.append(dict(index=len(gft_probe.edges), time=gft_now(), source=node, port=port,
                spec=gft_json_copy(spec), phase=vn_flow_phase, case=gft_probe.case))
        return gft_queue.original(spec, *args, **kwargs)

    def gft_with(trans, *args, **kwargs):
        row = dict(time=gft_now(), transition=type(trans).__name__ if trans is not None else None,
            edge=gft_active_edge(), gameFlow=vn_game_flow_transition_active is not None, case=gft_probe.case,
            state=gft_active_state())
        index = len(gft_probe.withs)
        gft_probe.withs.append(row)
        previous = gft_probe.active_with
        gft_probe.active_with = index
        try:
            return gft_with.original(trans, *args, **kwargs)
        finally:
            row["end"] = gft_now()
            row["elapsed"] = row["end"] - row["time"]
            gft_probe.active_with = previous

    def gft_source_capture(*args, **kwargs):
        row = dict(time=gft_now(), step=(vn_flow_active_step or {}).get("id"), state=gft_active_state(), pages=list(vn_ui_open_pages), case=gft_probe.case)
        gft_probe.captures.append(row)
        try:
            return gft_source_capture.original(*args, **kwargs)
        finally:
            row["end"] = gft_now()
            row["bytes"] = len(vn_game_flow_transition_snapshot or b"")

    def gft_movie_resume(data, *args, **kwargs):
        if not data.get("_vn_game_flow_movie"):
            return gft_movie_resume.original(data, *args, **kwargs)
        movie = data.get("_vn_movie")
        row = dict(time=gft_now(), step=(vn_flow_active_step or {}).get("id"), identity=id(movie), channel=movie.channel,
            duringTransition=gft_transition_running(), positionBefore=renpy.music.get_pos(channel=movie.channel),
            file=movie._play, held=bool(data.get("_vn_flow_hold")))
        gft_probe.movieReleases.append(row)
        try:
            return gft_movie_resume.original(data, *args, **kwargs)
        finally:
            row["end"] = gft_now()
            row["positionAfter"] = renpy.music.get_pos(channel=movie.channel)

    def gft_begin_step(step_id, kind, allow_skip, *args, **kwargs):
        index = len(gft_probe.steps)
        gft_probe.steps.append(dict(id=step_id, index=index, kind=kind, start=gft_now(), musicStart=renpy.music.get_playing(channel="music"), allowSkip=allow_skip, phase=vn_flow_phase, case=gft_probe.case))
        gft_probe.active_step = index
        return gft_begin_step.original(step_id, kind, allow_skip, *args, **kwargs)

    def gft_end_step(*args, **kwargs):
        if gft_probe.active_step is not None:
            row = gft_probe.steps[gft_probe.active_step]
            row["end"] = gft_now()
            row["musicEnd"] = renpy.music.get_playing(channel="music")
            row["cancelled"] = bool((vn_flow_active_step or {}).get("cancelled"))
            if row["kind"] == "page":
                row["pageReason"] = vn_ui_last_page_reason
                row["endState"] = gft_active_state()
            gft_probe.active_step = None
        return gft_end_step.original(*args, **kwargs)

    def gft_enter_frame(graph_id, *args, **kwargs):
        gft_probe.graphs.append(dict(time=gft_now(), graph=graph_id, case=gft_probe.case, transition=gft_transition_running()))
        return gft_enter_frame.original(graph_id, *args, **kwargs)

    def gft_run_blueprint(blueprint_id, *args, **kwargs):
        event_id = args[0] if args else kwargs.get("event_id")
        values = args[1] if len(args) > 1 else kwargs.get("event_values")
        if blueprint_id in ("gft_menu_video_events", "gft_menu_spine_events") and event_id is not None:
            gft_probe.mediaEvents.append(dict(time=gft_now(), graph=blueprint_id, event=event_id,
                values=gft_json_copy(values), transition=gft_transition_running(), menuShows=persistent.vn_var_gft_menu_shows))
        if blueprint_id == "gft_pending_media_events" and event_id is not None:
            gft_probe.pendingEvents.append(dict(time=gft_now(), graph=blueprint_id, event=event_id,
                values=gft_json_copy(values), snapshot=gft_pending_snapshot()))
        return gft_run_blueprint.original(blueprint_id, *args, **kwargs)

    def gft_music_play(*args, **kwargs):
        channel = args[1] if len(args) > 1 else kwargs.get("channel", "music")
        if channel == "music":
            gft_probe.music.append(dict(time=gft_now(), action="play", files=args[0] if args else kwargs.get("filenames"), channel=channel,
                during=gft_transition_running(), menu=bool(renpy.get_screen("main_menu")), before=renpy.music.get_playing(channel=channel),
                ifChanged=kwargs.get("if_changed", False), fadein=kwargs.get("fadein", 0), case=gft_probe.case))
        return gft_music_play.original(*args, **kwargs)

    def gft_music_stop(*args, **kwargs):
        channel = args[0] if args else kwargs.get("channel", "music")
        if channel == "music":
            gft_probe.music.append(dict(time=gft_now(), action="stop", channel=channel, during=gft_transition_running(), case=gft_probe.case))
        return gft_music_stop.original(*args, **kwargs)

    def gft_show_screen(name, *args, **kwargs):
        if not gft_probe.title_host:
            return gft_show_screen.original(name, *args, **kwargs)
        gft_probe.title_host = False
        row = dict(time=gft_now(), name=name, case=gft_probe.case)
        gft_probe.menuScreens.append(row)
        result = gft_show_screen.original(name, *args, **kwargs)
        row["end"] = gft_now()
        gft_probe.pending_menu_flush = row
        return result

    def gft_flush(*args, **kwargs):
        row = gft_probe.pending_menu_flush
        if row is not None:
            gft_probe.pending_menu_flush = None
            row.update(flush=gft_now(), music=renpy.music.get_playing(channel="music"))
        try:
            return gft_flush.original(*args, **kwargs)
        finally:
            if row is not None:
                row["flushed"] = gft_now()

    def gft_label(name, abnormal):
        if name == "main_menu":
            gft_probe.title_host = True
        if name in ("start", "before_main_menu", "main_menu", "_main_menu", "_main_menu_screen", "_game_menu", "_enter_game_menu", "game_menu", "_hide_windows", "vn_game_flow_before_title", "vn_game_flow_before_new_game"):
            gft_probe.labels.append(dict(time=gft_now(), name=name, abnormal=bool(abnormal), case=gft_probe.case))

    def gft_load():
        gft_probe.loads.append(dict(time=gft_now(), node=vn_current_node, edges=len(gft_probe.edges)))
        if "gft_pending_page" in vn_custom_pages:
            # All product after-load hooks have run, but no page timer, render
            # or media poll has. This proves restoration of the saved pending
            # row, rather than a fresh decoder failing after it was recreated.
            gft_probe.pendingLoads.append(dict(gft_pending_snapshot(), slot=gft_probe.pendingSlot))

    def gft_steps(step_id):
        return [row for row in gft_probe.steps if row["id"] == step_id]

    def gft_step_duration(step_id, index):
        row = gft_steps(step_id)[index]
        return row.get("end", gft_now()) - row["start"]

    def gft_step_color_span(step_id, index, shade):
        row = gft_steps(step_id)[index]
        frames = [frame for frame in gft_probe.frames if row["start"] <= frame["time"] <= row.get("end", gft_now()) and not frame["transitioning"] and gft_is(frame["pixel"], shade)]
        return max([frame["time"] for frame in frames] or [0]) - min([frame["time"] for frame in frames] or [0])

    def gft_graph_count(graph_id):
        return len([row for row in gft_probe.graphs if row["graph"] == graph_id])

    def gft_edge_order():
        return [(row["source"], row["port"]) for row in gft_probe.edges]

    def gft_edge_withs(index):
        # A queue may be overwritten without ever playing. Ordinary SDK withs,
        # including menu navigation after this edge, belong to neither request.
        return [row for row in gft_probe.withs if row["gameFlow"] and row["edge"] == index and row["transition"] is not None and "end" in row]

    def gft_transition_span(index):
        rows = gft_edge_withs(index)
        return sum(row["elapsed"] for row in rows)

    def gft_edge_frames(index):
        return [frame for frame in gft_probe.frames if frame["edge"] == index]

    def gft_in_edge(index):
        return gft_active_edge() == index and gft_transition_running()

    def gft_has_mixed(index, source, target):
        return any(gft_mixed(frame["pixel"], source, target) for frame in gft_edge_frames(index) if frame["transitionEdge"] == index and frame["transitioning"])

    def gft_edge_blend(index, source, target, duration):
        frames = gft_edge_frames(index)
        start = gft_probe.edges[index]["time"]
        earlier = [frame for frame in gft_probe.frames if frame["time"] <= start and gft_is(frame["pixel"], source)]
        native = gft_edge_withs(index)
        progressing = [frame for frame in frames if frame["transitionEdge"] == index and frame["transitioning"]]
        # The real source reaches the first 24% of the actual root transition;
        # a black gap or a transition of only the master layer cannot pass.
        beginning = min([row["time"] for row in native] or [start])
        early = [frame for frame in progressing if frame["time"] - beginning <= max(.1, duration * .24)]
        source_id = gft_probe.edges[index]["source"] or ""
        steps = gft_steps(source_id.removeprefix("flow:step:")) if source_id.startswith("flow:step:") else []
        ended = [step for step in steps if step.get("end", float("inf")) <= beginning + .01]
        boundary = max([step["end"] for step in ended] or [start])
        continuity = [frame for frame in gft_probe.frames if boundary - .12 <= frame["time"] <= beginning + max(.1, duration * .24)]
        return bool(earlier and progressing and native and early
            and continuity and all(gft_is(frame["pixel"], source) or gft_mixed(frame["pixel"], source, target) for frame in continuity)
            and any(gft_is(frame["pixel"], source) or gft_mixed(frame["pixel"], source, target) for frame in early)
            and any(gft_mixed(frame["pixel"], source, target) for frame in progressing)
            and any(gft_is(frame["pixel"], target) for frame in frames)
            and not any(gft_is(frame["pixel"], "black") for frame in progressing)
            and duration * .8 <= gft_transition_span(index) <= duration + .65)

    def gft_edge_color(index, source, target, out_time, hold, in_time):
        frames = gft_edge_frames(index)
        native = gft_edge_withs(index)
        if not native:
            return False
        start = min(row["time"] for row in native)
        active = [frame for frame in frames if frame["transitionEdge"] == index and frame["transitioning"]]
        black = [frame for frame in active if gft_is(frame["pixel"], "black")]
        duration = out_time + hold + in_time
        return bool(any(gft_is(frame["pixel"], source) for frame in gft_probe.frames if frame["time"] <= start)
            and any(gft_mixed(frame["pixel"], source, "black") for frame in active)
            # Zero hold can cross its pure-black midpoint between the 35ms
            # samples. Both visible fade halves remain mandatory; a positive
            # authored hold still requires actual black frames and its span.
            and (hold == 0 or black and max(frame["time"] for frame in black) - min(frame["time"] for frame in black) >= max(0, hold - .075))
            and any(gft_mixed(frame["pixel"], "black", target) for frame in active)
            and any(gft_is(frame["pixel"], target) for frame in frames)
            and duration * .8 <= gft_transition_span(index) <= duration + .65)

    def gft_marker_blend(index, source, target):
        return any(gft_mixed(frame["marker"], source, target) for frame in gft_edge_frames(index) if frame["transitionEdge"] == index and frame["transitioning"])

    def gft_menu_show_after_transition(index, occurrence):
        shows = [row for row in gft_probe.graphs if row["graph"] == "gft_main_shown"]
        rows = gft_edge_withs(index)
        return bool(rows and len(shows) > occurrence and not shows[occurrence]["transition"] and shows[occurrence]["time"] >= max(row["end"] for row in rows))

    def gft_music_continuous(index, expected="assets/menu-tone.wav"):
        frames = [frame for frame in gft_edge_frames(index) if frame["transitionEdge"] == index and frame["transitioning"]]
        # Replacing author music uses the SDK's existing 16ms fadeout. Keep
        # every early sample as evidence, but judge stable output after that
        # handoff plus one sample tick. Silence/author-only edges have no grace.
        handoffs = [row for row in gft_probe.music if expected == "assets/menu-tone.wav" and row["action"] == "play"
            and row.get("files") == expected and row.get("before") == "assets/opening-tone.wav"
            and gft_probe.edges[index]["time"] <= row["time"] <= (frames[-1]["time"] if frames else -1)
            and any("flush" in screen and screen["end"] <= row["time"] <= screen["flush"] for screen in gft_probe.menuScreens)]
        boundary = max([row["time"] + float(config.fadeout_audio) + .035 for row in handoffs] or [-1])
        stable = [frame for frame in frames if frame["time"] >= boundary]
        return bool(stable and all(frame["music"] == expected for frame in stable)
            and all(frame["music"] in ("assets/opening-tone.wav", None, expected) for frame in frames if frame["time"] < boundary)
            and not any(row["during"] for row in gft_probe.music if row["time"] >= frames[0]["time"] and row["time"] <= frames[-1]["time"]))

    def gft_step_music(step_id, occurrence, expected, minimum_span):
        steps = gft_steps(step_id)
        if len(steps) <= occurrence:
            return False
        step = steps[occurrence]
        # The author music node executes within the first step; its brief
        # initial render can precede that statement. The long visible window,
        # end state and play/stop trace separately prove ownership.
        frames = [frame for frame in gft_probe.frames if frame["stepIndex"] == step["index"]
            and step["start"] + .08 <= frame["time"] <= step.get("end", gft_now())]
        return bool(len(frames) >= 3 and frames[-1]["time"] - frames[0]["time"] >= minimum_span
            and all(frame["music"] == expected for frame in frames)
            and step.get("musicEnd") == expected and (expected is not None or step["musicStart"] is None))

    def gft_title_music_boundary(expected):
        screens = gft_probe.menuScreens
        if not screens or any("flush" not in screen for screen in screens):
            return False
        for screen in screens:
            actions = [row for row in gft_probe.music if screen["end"] <= row["time"] <= screen["flush"]]
            matching = [row for row in actions if row["action"] == ("play" if expected else "stop")
                and (not expected or row.get("files") == expected and row.get("ifChanged") is True and row.get("fadein") == 0)]
            if len(matching) != 1 or len(actions) != 1:
                return False
        # An SDK pre-play before the opening cannot be hidden by the later
        # correct play call. Only actual title-host show -> flush is allowed.
        return all(any(screen["end"] <= row["time"] <= screen["flush"] for screen in screens)
            for row in gft_probe.music if row["action"] == "play" and row.get("files") == "assets/menu-tone.wav")

    def gft_authored_music_preserved():
        plays = [row for row in gft_probe.music if row["action"] == "play" and row.get("files") == "assets/opening-tone.wav"]
        steps = gft_steps("gft_intro")
        if len(plays) != 1 or not steps or not gft_probe.menuScreens:
            return False
        start, boundary = plays[0]["time"], gft_probe.menuScreens[0]["time"]
        return bool(steps[0]["start"] <= start <= steps[0]["start"] + .5
            and not any(start < row["time"] < boundary for row in gft_probe.music)
            and any(row["action"] == "stop" and row["time"] <= steps[0]["start"] for row in gft_probe.music))

    def gft_media_released(allowed_channels=()):
        channels = gft_probe.channels | {row["channel"] for row in vn_ui_videos.values()}
        return all(renpy.music.get_playing(channel=channel) is None for channel in channels
            if channel not in allowed_channels and renpy.music.channel_defined(channel))

    def gft_video_blend_kind(frame):
        # Require both interior points and reject the other colour hypothesis.
        # Merely observing changing RGB would also pass a frozen first frame.
        for shade, other in (("magenta", "cyan"), ("cyan", "magenta")):
            if all(gft_mixed(value, "red", shade) and not gft_mixed(value, "red", other) for value in frame["videoPixels"]):
                return shade
        return None

    def gft_ui_video_transition_frames(edge, component_id):
        return [frame for frame in gft_edge_frames(edge) if frame["transitionEdge"] == edge and frame["rootTransition"]
            and frame["uiVideos"].get(component_id) and frame["uiVideos"][component_id]["decoded"]]

    def gft_ui_loop_video_during_transition(edge, component_id):
        frames = gft_ui_video_transition_frames(edge, component_id)
        playing = [frame for frame in frames if frame["uiVideos"][component_id]["rawPosition"] is not None
            and frame["uiVideos"][component_id]["playing"] == "assets/opening.webm" and not frame["uiVideos"][component_id]["paused"]]
        positions = [frame["uiVideos"][component_id]["rawPosition"] for frame in playing]
        colours = [gft_video_blend_kind(frame) for frame in playing]
        runs = [shade for index, shade in enumerate(colours) if shade and (index == 0 or shade != colours[index - 1])]
        return bool(len(playing) >= 6 and playing[-1]["time"] - playing[0]["time"] >= 1.2
            and max(positions) - min(positions) >= .35 and len(set(frame["uiVideos"][component_id]["sourceSequence"] for frame in playing)) == 1
            and all(frame["uiVideos"][component_id]["loop"] and not frame["uiVideos"][component_id]["held"] for frame in playing)
            and all(frame["menuShows"] == 0 and frame["videoEnded"] == 0 and frame["videoFailed"] == 0 for frame in frames)
            and "magenta" in runs and "cyan" in runs and any(a != b for a, b in zip(runs, runs[1:])))

    def gft_ui_video_keeps_playing(edge, component_id):
        withs = gft_edge_withs(edge)
        if not withs:
            return False
        end = max(row["end"] for row in withs)
        frames = [frame for frame in gft_probe.frames if end + .05 <= frame["time"] <= end + .8
            and frame["uiVideos"].get(component_id) and frame["uiVideos"][component_id]["rawPosition"] is not None]
        positions = [frame["uiVideos"][component_id]["rawPosition"] for frame in frames]
        return bool(len(frames) >= 4 and frames[-1]["time"] - frames[0]["time"] >= .4 and max(positions) - min(positions) >= .3
            and all(frame["uiVideos"][component_id]["playing"] == "assets/opening.webm" and not frame["uiVideos"][component_id]["paused"] for frame in frames)
            and any(all(gft_is(value, "magenta") or gft_is(value, "cyan") for value in frame["videoPixels"]) for frame in frames))

    def gft_ui_once_video_held(edge, component_id):
        frames = gft_ui_video_transition_frames(edge, component_id)
        held = [frame for frame in frames if frame["uiVideos"][component_id]["paused"]]
        # SDK get_pos returns None before its clock starts, including t == 0.
        # Observe the actual decoded first frame and pause flag in that case;
        # never replace an unavailable native clock with a fabricated zero.
        positions = [frame["uiVideos"][component_id]["rawPosition"] for frame in held if frame["uiVideos"][component_id]["rawPosition"] is not None]
        return bool(len(held) >= 6 and held[-1]["time"] - held[0]["time"] >= 1.5
            and (not positions or max(positions) - min(positions) <= .06 and max(positions) <= .15)
            and len(held) == len(frames)
            and all(not frame["uiVideos"][component_id]["loop"] and frame["uiVideos"][component_id]["held"]
                and frame["uiVideos"][component_id]["playing"] == "assets/opening.webm"
                and frame["uiVideos"][component_id]["position"] == 0 for frame in held)
            and len({frame["uiVideos"][component_id]["sourceSequence"] for frame in held}) == 1
            and all(all(gft_is(value, "red") or gft_mixed(value, "red", "magenta") or gft_is(value, "magenta")
                for value in frame["videoPixels"]) for frame in held)
            and any(gft_video_blend_kind(frame) == "magenta" for frame in held)
            and not any(gft_video_blend_kind(frame) == "cyan" for frame in frames)
            and all(frame["menuShows"] == 0 and frame["videoEnded"] == 0 and frame["videoFailed"] == 0 for frame in frames))

    def gft_video_end_events():
        return [row for row in gft_probe.graphs if row["graph"] == "gft_video_ended_handler"]

    def gft_ui_once_video_finished(edge, component_id, duration):
        withs, ended = gft_edge_withs(edge), gft_video_end_events()
        if len(withs) != 1 or len(ended) != 1:
            return False
        end, done = withs[0]["end"], ended[0]["time"]
        frames = [frame for frame in gft_probe.frames if end <= frame["time"] <= done and frame["uiVideos"].get(component_id)]
        early = [frame for frame in frames if frame["time"] <= end + .2 and frame["uiVideos"][component_id]["rawPosition"] is not None]
        spans = {}
        for shade in ("magenta", "cyan"):
            times = [frame["time"] for frame in frames if all(gft_is(value, shade) for value in frame["videoPixels"])]
            spans[shade] = max(times or [0]) - min(times or [0])
        return bool(early and min(frame["uiVideos"][component_id]["rawPosition"] for frame in early) <= .15
            and duration - .1 <= done - end <= duration + .8 and not ended[0]["transition"]
            and spans["magenta"] >= .3 and spans["cyan"] >= .3 and gft_menu_show_after_transition(edge, 0)
            and persistent.vn_var_gft_video_ended == 1 and persistent.vn_var_gft_video_failed == 0)

    def gft_ui_video_released(component_id):
        return bool(component_id not in vn_ui_video_states and component_id not in getattr(vn_ui_video_poll, "live", {})
            and renpy.music.get_playing(channel=vn_ui_videos[component_id]["channel"]) is None)

    def gft_ui_video_failure_deferred(edge, component_id):
        frames = [frame for frame in gft_edge_frames(edge) if frame["transitionEdge"] == edge and frame["rootTransition"]]
        pending = [frame for frame in frames if frame["uiVideos"].get(component_id)
            and frame["uiVideos"][component_id]["status"] == "failed" and frame["uiVideos"][component_id]["eventPending"]]
        events = [row for row in gft_probe.graphs if row["graph"] == "gft_broken_video_failed_handler"]
        shows = [row for row in gft_probe.graphs if row["graph"] == "gft_main_shown"]
        withs = gft_edge_withs(edge)
        return bool(pending and len(events) == len(shows) == len(withs) == 1
            and all(frame["brokenVideoFailed"] == 0 and frame["menuShows"] == 0 for frame in frames)
            and not events[0]["transition"] and events[0]["time"] >= shows[0]["time"] >= withs[0]["end"]
            and persistent.vn_var_gft_broken_video_failed == 1 and not vn_ui_video_states[component_id].get("eventPending", False))

    def gft_spine_pose(frame, source=None):
        def is_shade(value, shade, other):
            if source is None:
                return gft_is(value, shade)
            return (gft_mixed(value, source, shade) or gft_is(value, shade)) and not (gft_mixed(value, source, other) or gft_is(value, other))
        upper, lower = frame["spinePixels"]
        if is_shade(upper, "warm", "blue") and is_shade(lower, "blue", "warm"):
            return 0
        if is_shade(upper, "blue", "warm") and is_shade(lower, "warm", "blue"):
            return 1
        return None

    def gft_spine_position(frame, component_id):
        row = frame["uiSpines"][component_id]
        return row["renderPosition"] if row["renderPosition"] is not None else row["position"]

    def gft_ui_spine_transition_frames(edge, component_id):
        return [frame for frame in gft_edge_frames(edge) if frame["transitionEdge"] == edge and frame["rootTransition"]
            and frame["uiSpines"].get(component_id) and frame["uiSpines"][component_id]["native"] and frame["uiSpines"][component_id]["record"]
            and gft_spine_position(frame, component_id) is not None]

    def gft_ui_loop_spine_during_transition(edge, component_id):
        frames = gft_ui_spine_transition_frames(edge, component_id)
        positions = [gft_spine_position(frame, component_id) for frame in frames]
        poses = {gft_spine_pose(frame, "black") for frame in frames}
        # Fade's outgoing half can render a destination without revealing it.
        # The two inverse occupancy patterns must both occur in the actual
        # black -> destination half, not merely as different fade brightness.
        return bool(len(frames) >= 6 and frames[-1]["time"] - frames[0]["time"] >= 1.2
            and max(positions) - min(positions) >= .25 and {0, 1}.issubset(poses)
            and len({frame["uiSpines"][component_id]["sourceSequence"] for frame in frames}) == 1
            and all(frame["uiSpines"][component_id]["loop"] and not frame["uiSpines"][component_id]["paused"]
                and not frame["uiSpines"][component_id]["suspended"] for frame in frames)
            and all(frame["menuShows"] == 0 and frame["spineCompleted"] == 0 and frame["spineFailed"] == 0 for frame in frames))

    def gft_ui_spine_keeps_playing(edge, component_id):
        withs = gft_edge_withs(edge)
        if not withs:
            return False
        end = max(row["end"] for row in withs)
        frames = [frame for frame in gft_probe.frames if end + .03 <= frame["time"] <= end + .8
            and frame["uiSpines"].get(component_id) and frame["uiSpines"][component_id]["native"]
            and gft_spine_position(frame, component_id) is not None]
        positions = [gft_spine_position(frame, component_id) for frame in frames]
        return bool(len(frames) >= 4 and frames[-1]["time"] - frames[0]["time"] >= .4
            and max(positions) - min(positions) >= .25 and {0, 1}.issubset({gft_spine_pose(frame) for frame in frames})
            and all(not frame["uiSpines"][component_id]["suspended"] for frame in frames))

    def gft_ui_once_spine_held(edge, component_id):
        frames = gft_ui_spine_transition_frames(edge, component_id)
        positions = [gft_spine_position(frame, component_id) for frame in frames]
        poses = {gft_spine_pose(frame, "black") for frame in frames} - {None}
        return bool(len(frames) >= 6 and frames[-1]["time"] - frames[0]["time"] >= 1.2
            and max(positions) <= .002 and max(positions) - min(positions) <= .002 and len(poses) == 1
            and all(not frame["uiSpines"][component_id]["loop"] and frame["uiSpines"][component_id]["suspended"] for frame in frames)
            and all(frame["menuShows"] == 0 and frame["spineCompleted"] == 0 and frame["spineFailed"] == 0 for frame in frames))

    def gft_spine_completed_events():
        return [row for row in gft_probe.graphs if row["graph"] == "gft_spine_completed_handler"]

    def gft_ui_once_spine_finished(edge, component_id, duration):
        withs, completed = gft_edge_withs(edge), gft_spine_completed_events()
        if len(withs) != 1 or len(completed) != 1:
            return False
        end, done = withs[0]["end"], completed[0]["time"]
        frames = [frame for frame in gft_probe.frames if end <= frame["time"] <= done and frame["uiSpines"].get(component_id)
            and gft_spine_position(frame, component_id) is not None]
        positions = [gft_spine_position(frame, component_id) for frame in frames]
        events = [row for row in gft_probe.mediaEvents if row["graph"] == "gft_menu_spine_events"]
        payloads = [value for event in events for value in (event["values"] or {}).values()]
        return bool(frames and min(positions) <= .12 and max(positions) - min(positions) >= .3
            and duration - .1 <= done - end <= duration + .9 and not completed[0]["transition"]
            and {0, 1}.issubset({gft_spine_pose(frame) for frame in frames}) and gft_menu_show_after_transition(edge, 0)
            and len(events) == len(payloads) == 1 and events[0]["menuShows"] == 1 and not events[0]["transition"]
            and payloads[0].get("assetId") == "rig_a" and payloads[0].get("animation") == "quick" and payloads[0].get("error") == ""
            and abs(payloads[0].get("duration", 0) - duration) < .002 and abs(payloads[0].get("position", 0) - duration) < .002
            and persistent.vn_var_gft_spine_completed == 1 and persistent.vn_var_gft_spine_failed == 0)

    def gft_ui_spine_failure_deferred(edge, component_id):
        frames = [frame for frame in gft_edge_frames(edge) if frame["transitionEdge"] == edge and frame["rootTransition"]]
        pending = [frame for frame in frames if frame["uiSpines"].get(component_id)
            and frame["uiSpines"][component_id]["status"] == "failed" and frame["uiSpines"][component_id]["eventPending"]]
        events = [row for row in gft_probe.graphs if row["graph"] == "gft_broken_spine_failed_handler"]
        shows, withs = [row for row in gft_probe.graphs if row["graph"] == "gft_main_shown"], gft_edge_withs(edge)
        return bool(pending and len(events) == len(shows) == len(withs) == 1
            and all(frame["brokenSpineFailed"] == 0 and frame["menuShows"] == 0 for frame in frames)
            and not events[0]["transition"] and events[0]["time"] >= shows[0]["time"] >= withs[0]["end"]
            and persistent.vn_var_gft_broken_spine_failed == 1 and not vn_spine_states[component_id].get("eventPending", False))

    def gft_ui_spine_released(component_id):
        return bool(component_id not in vn_spine_states and component_id not in vns_spine._live and component_id not in vns_spine._resources
            and not any(key[0] == component_id for key in vns_spine._players))

    def gft_page_source_captured_once(step_id, page_id, edge):
        captures = [row for row in gft_probe.captures if row["step"] == step_id]
        steps, withs = gft_steps(step_id), gft_edge_withs(edge)
        shows = [row for row in gft_probe.graphs if row["graph"] == "gft_page_shown"]
        return bool(len(captures) == len(steps) == len(withs) == len(shows) == 1
            and page_id in captures[0]["pages"] and captures[0]["bytes"] > 0
            and captures[0]["state"]["scope"]["preserve"]
            and shows[0]["time"] <= captures[0]["time"] <= steps[0]["end"] <= withs[0]["time"]
            and not shows[0]["transition"] and withs[0]["state"]["snapshotBytes"] > 0
            and all(page_id not in frame["pages"] for frame in gft_edge_frames(edge) if frame["transitionEdge"] == edge))

    def gft_top_movie_held_first_frame(edge, step_id):
        frames = [frame for frame in gft_edge_frames(edge) if frame["transitionEdge"] == edge and frame["rootTransition"] and frame["step"] == step_id]
        held = [frame for frame in frames if frame["topMovie"] and frame["topMovie"]["paused"] and frame["topMovie"]["position"] is not None]
        positions = [frame["topMovie"]["position"] for frame in held]
        return bool(len(held) >= 4 and held[-1]["time"] - held[0]["time"] >= .8
            and max(positions) - min(positions) <= .06
            and all(frame["topMovie"]["playing"] == "assets/opening.webm" for frame in held)
            and all(gft_is(frame["pixel"], "green") or gft_mixed(frame["pixel"], "green", "magenta") or gft_is(frame["pixel"], "magenta") for frame in frames))

    def gft_top_movie_full_clip_after_release(edge, step_id, duration):
        releases = [row for row in gft_probe.movieReleases if row["step"] == step_id]
        steps, withs = gft_steps(step_id), gft_edge_withs(edge)
        if len(releases) != 1 or len(steps) != 1 or len(withs) != 1:
            return False
        release = releases[0]
        early = [frame for frame in gft_probe.frames if frame["step"] == step_id and release["end"] <= frame["time"] <= release["end"] + .15
            and not frame["transitioning"] and frame["topMovie"] and frame["topMovie"]["position"] is not None]
        return bool(release["time"] >= withs[0]["end"] and not release["duringTransition"] and not release["held"]
            and release["file"] == "assets/opening.webm" and duration - .1 <= steps[0]["end"] - release["end"] <= duration + .65
            and early and min(frame["topMovie"]["position"] for frame in early) <= .15
            and all(frame["topMovie"]["identity"] == release["identity"] and not frame["topMovie"]["paused"] for frame in early))

    def gft_clean(allowed_ui_videos=(), allowed_ui_spines=()):
        allowed_channels = set()
        for component_id in tuple(allowed_ui_videos) + tuple(allowed_ui_spines):
            native = vn_ui_native_current_menu()
            is_video = component_id in allowed_ui_videos
            row = vn_ui_video_states.get(component_id) if is_video else vn_spine_states.get(component_id)
            live = getattr(vn_ui_video_poll, "live", {}).get(component_id) if is_video else vns_spine._live.get(component_id)
            if not native or native.get("page") != "ui:main" or not native.get("didShow") or not renpy.get_screen("main_menu"):
                return False
            if not row or not live or row.get("owner") is not native.get("owner") or live.get("owner") is not row.get("owner"):
                return False
            if is_video:
                allowed_channels.add(vn_ui_videos[component_id]["channel"])
        spine_live = vns_spine._live if vn_spine_components else {}
        spine_resources = vns_spine._resources if vn_spine_components else {}
        spine_players = vns_spine._players if vn_spine_components else {}
        return (vn_flow_active_step is None and vn_game_flow_transition_request is None and vn_game_flow_transition_active is None
            and vn_game_flow_transition_snapshot is None and vn_game_flow_source_scope is None and vn_game_flow_movie is None
            and vn_game_flow_source_hold is None and not vn_game_flow_source_cover_visible()
            and getattr(vn_game_flow_transition_flush, "owner", None) is None and not renpy.showing("vn_game_flow_movie", layer="master")
            and not vn_flow_retired_visual_media and not vn_visual_instances and not vn_audio_clips and not vn_ui_open_pages and not vn_ui_page_sessions
            and not renpy.get_screen("vn_performance_cover", layer="master")
            and not (set(vn_ui_video_states) - set(allowed_ui_videos)) and not (set(getattr(vn_ui_video_poll, "live", {})) - set(allowed_ui_videos))
            and not (set(vn_spine_states) - set(allowed_ui_spines)) and not (set(spine_live) - set(allowed_ui_spines))
            and not (set(spine_resources) - set(allowed_ui_spines)) and not ({key[0] for key in spine_players} - set(allowed_ui_spines))
            and gft_media_released(allowed_channels))

    def gft_title_ready():
        native = vn_ui_native_current_menu()
        return bool(gft_probe.frames and renpy.get_screen("main_menu") and not gft_transition_running()
            and gft_probe.frames[-1]["menu"] and gft_is(gft_probe.frames[-1]["pixel"], "blue") and gft_is(gft_probe.frames[-1]["marker"], "yellow")
            and native and native.get("page") == "ui:main" and native.get("didShow")
            and vn_flow_active_step is None and vn_game_flow_transition_request is None and vn_game_flow_transition_active is None)

    def gft_click_during_transition():
        # testast.Click waits for transitions before clicking. The SDK's native
        # event helper posts the identical pointer input immediately, through
        # actual product hit-testing; never invoke a widget's action directly.
        from renpy.test.testmouse import click_mouse
        during = gft_transition_running()
        gft_probe.inputs.append(dict(time=gft_now(), duringTransition=during, position=[480, 359]))
        assert during, "The click must be delivered inside the actual transition."
        click_mouse(1, 480, 359)

    def gft_escape_during_transition():
        # Keep the physical KEYDOWN/KEYUP path through SDK underlay handling.
        # The testcase's normal keysym statement would wait until with ends.
        from renpy.test.testkey import queue_keysym
        during = gft_transition_running()
        gft_probe.inputs.append(dict(time=gft_now(), duringTransition=during, key="K_ESCAPE"))
        assert during and gft_active_edge() == 1, "Esc must reach the real empty-new-game transition."
        queue_keysym(renpy.test.testexecution.node_executor.node, "K_ESCAPE")

    def gft_escape_stayed_in_story():
        sent = gft_probe.inputs[-1]
        return (renpy.get_screen("menu") is None and not renpy.context()._menu
            and not any(row["time"] >= sent["time"] and row["name"] in ("_game_menu", "_enter_game_menu", "game_menu", "_hide_windows") for row in gft_probe.labels))

    def gft_save_during_transition(slot):
        during = gft_transition_running()
        assert during, "The save must be created inside the real new-game transition."
        gft_probe.saves.append(dict(time=gft_now(), duringTransition=during, state=gft_active_state(), slot=slot))
        renpy.save(slot)

    def gft_pending_snapshot():
        # Only read existing dictionaries: snapshot/get/presence would create
        # tasks or rows and invalidate this save-restoration evidence.
        component_id, page_id = "gft_pending_media", "gft_pending_page"
        video = component_id in vn_ui_videos
        session = vn_ui_page_sessions.get(page_id) or {}
        row = (vn_ui_video_states if video else vn_spine_states).get(component_id) or {}
        live = (getattr(vn_ui_video_poll, "live", {}) if video else vns_spine._live).get(component_id)
        task = (live or {}).get("task")
        base = renpy.game.contexts[0]
        channel = vn_ui_videos[component_id]["channel"] if video else None
        return dict(time=gft_now(), baseContext=len(renpy.game.contexts) == 1 and renpy.game.context() is base and base.rollback and not main_menu,
            pageOpen=page_id in vn_ui_open_pages, pageToken=session.get("token"), didShow=session.get("didShow"),
            sessionOwnerMatches=bool(session and session.get("owner") is base.info),
            rowOwnerMatches=bool(row and session and row.get("owner") is session.get("mediaOwner")),
            pageInstanceMatches=bool(row and session and row.get("pageInstance") == session.get("token")),
            record=bool(row), status=row.get("status"), eventPending=row.get("eventPending"), assetId=row.get("assetId"), error=row.get("error"),
            sourceSequence=row.get("sourceSequence"), lastSample=row.get("lastSample"), sequence=row.get("sequence"),
            live=live is not None, liveOwnerMatches=bool(live and row and live.get("owner") is row.get("owner")),
            taskAlive=bool(task and vn_bp_task_alive(task) and task.get("native") is None and task.get("page") == page_id and task.get("pageToken") == session.get("token")),
            nativeResource=bool(component_id in vns_spine._resources) if not video else False,
            playing=renpy.music.get_playing(channel=channel) if channel else None,
            shows=getattr(renpy.store, "vn_var_gft_pending_shows", None), failed=getattr(renpy.store, "vn_var_gft_pending_failed", None),
            duringTransition=gft_transition_running(), rootTransition=renpy.game.interface.get_ongoing_transition(None) is not None,
            activeTransition=vn_game_flow_transition_active is not None, pendingTransition=vn_game_flow_transition_request is not None,
            step=(vn_flow_active_step or {}).get("id"))

    def gft_pending_save_window():
        state = gft_pending_snapshot()
        return bool(state["baseContext"] and state["pageOpen"] and state["rootTransition"] and state["activeTransition"]
            and state["step"] == "gft_pending_page_step" and state["status"] == "failed" and state["eventPending"]
            and not state["didShow"] and state["shows"] == state["failed"] == 0)

    def gft_save_and_load_pending_media(slot):
        # Native SDK save/load in the *same* test action prevents the reveal
        # from finishing between saving and loading. No product state is set.
        assert gft_pending_save_window(), "A real failed decoder must still be pending inside the base-context page transition."
        gft_probe.pendingSlot = slot
        gft_probe.pendingSaves.append(dict(gft_pending_snapshot(), slot=slot))
        renpy.save(slot)
        renpy.load(slot)

    def gft_pending_loaded_record(index, pending):
        saved, loaded = gft_probe.pendingSaves[index], gft_probe.pendingLoads[index]
        fields = ("slot", "pageToken", "status", "assetId", "error", "sequence", "sourceSequence", "lastSample", "shows", "failed")
        return bool(all(saved.get(key) == loaded.get(key) for key in fields)
            and loaded["baseContext"] and loaded["pageOpen"] and loaded["record"] and loaded["status"] == "failed"
            and loaded["eventPending"] is pending and loaded["didShow"] is (not pending)
            and loaded["sessionOwnerMatches"] and loaded["rowOwnerMatches"] and loaded["pageInstanceMatches"])

    def gft_pending_page_ready():
        state = gft_pending_snapshot()
        return bool(state["pageOpen"] and state["didShow"] and state["status"] == "failed" and not state["eventPending"]
            and state["shows"] == state["failed"] == 1 and state["live"] and state["liveOwnerMatches"] and state["taskAlive"] and not state["duringTransition"])

    def gft_pending_callback_after_restore():
        events = gft_probe.pendingEvents
        shows = [row for row in gft_probe.graphs if row["graph"] == "gft_pending_page_shown"]
        if len(events) != 1 or len(shows) != 1 or not gft_probe.pendingLoads:
            return False
        event, loaded = events[0], gft_probe.pendingLoads[0]
        state = event["snapshot"]
        values = (event["values"] or {}).get("gft_pending_failed_event", {})
        return bool(event["event"] == "gft_pending_failed_event" and event["time"] >= shows[0]["time"] >= loaded["time"]
            and state["didShow"] and state["shows"] == 1 and state["failed"] == 0 and not state["eventPending"] and not state["duringTransition"]
            and state["rowOwnerMatches"] and state["liveOwnerMatches"] and state["taskAlive"] and state["pageToken"] == loaded["pageToken"]
            and values.get("assetId") == loaded["assetId"] and values.get("error") == loaded["error"] and bool(values.get("error")))

    def gft_save_consumed_media(slot):
        assert gft_pending_page_ready(), "Save only after the restored failure and page entry were consumed."
        gft_probe.pendingSlot = slot
        gft_probe.pendingSaves.append(dict(gft_pending_snapshot(), slot=slot))
        renpy.save(slot)

    def gft_dump():
        for key, surface in gft_probe.shots.items():
            renpy.pygame.image.save(surface, gft_os.path.join(@@SHOTS@@, key + ".png"))
        data = {key: getattr(gft_probe, key) for key in ("case", "frames", "edges", "withs", "steps", "graphs", "loads", "labels", "music", "inputs", "saves", "captures", "movieReleases", "menuScreens", "mediaEvents")}
        if "gft_pending_page" in vn_custom_pages:
            data.update({key: getattr(gft_probe, key) for key in ("pendingSaves", "pendingLoads", "pendingEvents")})
        data["scenario"] = @@SCENARIO@@
        data["mediaChannels"] = sorted(gft_probe.channels)
        with open(gft_os.path.join(@@TRACES@@, gft_probe.case + ".json"), "w", encoding="utf-8") as handle:
            gft_json.dump(data, handle, ensure_ascii=False, indent=2)

    gft_draw.original = renpy.display.core.Interface.draw_screen
    renpy.display.core.Interface.draw_screen = gft_draw
    gft_queue.original, vn_game_flow_transition_queue = vn_game_flow_transition_queue, gft_queue
    gft_with.original, renpy.with_statement = renpy.with_statement, gft_with
    gft_source_capture.original, vn_game_flow_transition_capture = vn_game_flow_transition_capture, gft_source_capture
    gft_movie_resume.original, vn_visual_resume_flow_movie = vn_visual_resume_flow_movie, gft_movie_resume
    gft_begin_step.original, vn_flow_begin_step = vn_flow_begin_step, gft_begin_step
    gft_end_step.original, vn_flow_end_step = vn_flow_end_step, gft_end_step
    gft_enter_frame.original, vn_bp_enter_frame = vn_bp_enter_frame, gft_enter_frame
    gft_run_blueprint.original, vn_run_blueprint = vn_run_blueprint, gft_run_blueprint
    gft_music_play.original, renpy.music.play = renpy.music.play, gft_music_play
    gft_music_stop.original, renpy.music.stop = renpy.music.stop, gft_music_stop
    gft_show_screen.original, renpy.show_screen = renpy.show_screen, gft_show_screen
    gft_flush.original, vn_game_flow_transition_flush = vn_game_flow_transition_flush, gft_flush
    config.label_callbacks.append(gft_label)
    config.after_load_callbacks.append(gft_load)

testsuite global:
    before testcase:
        $ _test.timeout = 30.0
        $ _test.transition_timeout = 10.0
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
        $ preferences.transitions = 2
        $ config.skipping = None
    after testcase:
        $ gft_dump()
    teardown:
        exit

`.replaceAll('@@COLORS@@', q(gameFlowTransitionColors)).replaceAll('@@SHOTS@@', q(path.join(directory, 'screenshots')))
    .replaceAll('@@TRACES@@', q(path.join(directory, 'traces'))).replaceAll('@@SCENARIO@@', q(scenario));
}

try {
  authorHash = digest(await fs.readFile(authorFile)); report.authorSha256Before = authorHash;
  for (const scenario of scenarios) {
    const directory = path.join(output, scenario), source = path.join(directory, 'source'), game = path.join(directory, 'game'), saves = path.join(directory, 'saves');
    await fs.mkdir(path.join(source, 'assets'), { recursive: true });
    await fs.mkdir(path.join(directory, 'screenshots'), { recursive: true });
    await fs.mkdir(path.join(directory, 'traces'), { recursive: true });
    const cases = nativeCases(scenario), tests = observer(scenario, directory) + cases.map(item => item.source).join('\n');
    const assertions = cases.reduce((sum, item) => sum + (item.source.match(/^    assert /gm) ?? []).length, 0);
    const record: Record<string, unknown> = { scenario, status: 'running', caseNames: cases.map(item => item.name), expectedCases: cases.length, expectedAssertions: assertions,
      temporaryPaths: [source, game, saves, path.join(directory, 'renpy-saves')], checks: [] };
    (report.runs as unknown[]).push(record);
    const check = async (name: string, result: { code: number; log: string }) => {
      const logPath = path.join(directory, name + '.log'); await fs.writeFile(logPath, result.log);
      (record.checks as unknown[]).push({ name, code: result.code, logPath }); await saveReport();
      assert.equal(result.code, 0, scenario + '/' + name + ': ' + result.log.slice(-10000));
    };
    try {
      record.renpySaves = await isolateRenpySaves(directory);
      const fixture = createGameFlowTransitionsRuntimeFixture(scenario), original = structuredClone(fixture.project);
      await fs.writeFile(path.join(source, 'project.vns.json'), JSON.stringify(fixture.project, null, 2));
      await fs.writeFile(path.join(directory, 'fixture.json'), JSON.stringify(fixture.project, null, 2));
      await fs.writeFile(path.join(directory, 'testcases.rpy'), tests);
      for (const shade of ['red', 'blue', 'green', 'yellow'] as const) await fs.writeFile(path.join(source, 'assets', shade + '.png'), solidPng(gameFlowTransitionColors[shade]));
      await fs.writeFile(path.join(source, 'assets/menu-tone.wav'), toneWav());
      await fs.writeFile(path.join(source, 'assets/opening-tone.wav'), toneWav(660));
      if (scenario === 'title_loop_video') await fs.writeFile(path.join(source, 'assets/broken.webm'), 'intentionally invalid local video fixture');
      if (scenario === 'title_loop_spine' || scenario === 'title_once_spine') await writeUiSpineFixtureAssets(source);
      if (scenario === 'pending_video_load') await fs.writeFile(path.join(source, 'assets/broken.webm'), 'intentionally invalid local video fixture');
      if (scenario === 'pending_spine_load') await writeUiSpineFixtureAssets(source);
      execFileSync(process.env.VNS_FFMPEG ?? 'ffmpeg', ['-nostdin', '-v', 'error', '-y',
        '-f', 'lavfi', '-i', 'color=c=0xdc20d0:size=160x90:rate=30:duration=0.6',
        '-f', 'lavfi', '-i', 'color=c=0x20dcdd:size=160x90:rate=30:duration=0.6',
        '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libvpx', '-pix_fmt', 'yuv420p', '-an', path.join(source, 'assets/opening.webm')], { windowsHide: true, timeout: 30000 });
      const built = await buildProject({ project: fixture.project, projectDir: source, sdkRoot: sdk, spineRuntimeDir: path.resolve('resources/spine'), outputDir: game, development: true, preview: fixture.preview });
      assert.deepEqual(fixture.project, original, 'Building must not mutate authored flow transitions.');
      await check('compile', { code: built.ok ? 0 : 1, log: built.log + '\n' + JSON.stringify(built.diagnostics, null, 2) });
      record.generatedSource = {};
      for (const [name, evidence] of [['01-vn-game-flow.rpy', 'generated-flow.rpy'], ['story.rpy', 'generated-story.rpy'], ['options.rpy', 'generated-options.rpy']]) {
        const compiled = await fs.readFile(path.join(game, 'game', name));
        await fs.writeFile(path.join(directory, evidence), compiled);
        (record.generatedSource as Record<string, unknown>)[name] = { evidence, sha256: digest(compiled) };
      }
      await fs.writeFile(path.join(game, 'game/testcases.rpy'), tests);
      const options = { savedir: saves, timeoutMs: 180000, env: { RENPY_RENDERER: 'gl2' } };
      await check('lint', await runRenpy(sdk, game, ['lint'], options));
      const native = await runRenpy(sdk, game, ['test', '--report-detailed', '--report-skipped'], { ...options, onData: text => process.stdout.write(text) });
      record.cases = Number(native.log.match(/Test cases\s*:\s*(\d+)/)?.[1] ?? 0);
      record.assertions = Number(native.log.match(/Assertions\s*:\s*(\d+)/)?.[1] ?? 0);
      await check('runtime', native);
      assert.match(native.log, new RegExp('Test cases\\s*:\\s*' + cases.length + '\\s*\\|\\s*' + cases.length + ' passed'));
      assert.equal(record.assertions, assertions, 'Every native assertion must execute.');
      const traces = (await fs.readdir(path.join(directory, 'traces'))).filter(name => name.endsWith('.json'));
      assert.equal(traces.length, cases.length, 'Every native testcase must retain its own trace.');
      record.traceFiles = traces; record.status = 'passed';
    } catch (error) {
      record.status = 'failed'; record.error = error instanceof Error ? error.stack : String(error);
      failure ??= error;
    } finally {
      try {
        for (const folder of [path.join(game, 'tests/screenshots'), path.join(game, 'game/tests/screenshots')]) {
          if (await fs.stat(folder).then(stat => stat.isDirectory()).catch(() => false)) await fs.cp(folder, path.join(directory, 'screenshots'), { recursive: true });
        }
        for (const name of ['errors.txt', 'traceback.txt', 'log.txt', 'report.html', 'test-report.html', 'tests/report.html']) {
          const candidate = path.join(game, name);
          if (await fs.stat(candidate).then(stat => stat.isFile()).catch(() => false)) await fs.copyFile(candidate, path.join(directory, path.basename(name)));
        }
        record.traceFiles = (await fs.readdir(path.join(directory, 'traces'))).filter(name => name.endsWith('.json'));
        record.screenshotCount = (await fs.readdir(path.join(directory, 'screenshots'))).filter(name => name.endsWith('.png')).length;
      } catch (error) { record.status = 'failed'; record.evidenceError = String(error); failure ??= error; }
      try {
        record.cleanup = await cleanVerificationDirectories(directory, ['source', 'game', 'saves', 'renpy-saves']);
        assert.deepEqual((record.cleanup as { errors: unknown[] }).errors, []);
      } catch (error) { record.status = 'failed'; record.cleanupError = String(error); failure ??= error; }
      await saveReport();
    }
  }
  report.status = failure ? 'failed' : 'passed';
} catch (error) { failure ??= error; report.status = 'failed'; report.error = error instanceof Error ? error.stack : String(error); }
finally {
  try {
    const after = digest(await fs.readFile(authorFile)); report.authorSha256After = after;
    if (authorHash !== undefined) assert.equal(after, authorHash, 'The author project must remain unchanged.');
  } catch (error) { report.status = 'failed'; report.authorProtectionError = String(error); failure ??= error; }
  if (previousRenpySaves === undefined) delete process.env.RENPY_PATH_TO_SAVES;
  else process.env.RENPY_PATH_TO_SAVES = previousRenpySaves;
  report.totalCases = (report.runs as Record<string, unknown>[]).reduce((sum, row) => sum + Number(row.cases ?? 0), 0);
  report.totalAssertions = (report.runs as Record<string, unknown>[]).reduce((sum, row) => sum + Number(row.assertions ?? 0), 0);
  await saveReport(); console.log(path.join(output, 'report.json'));
}
if (failure) throw failure;
