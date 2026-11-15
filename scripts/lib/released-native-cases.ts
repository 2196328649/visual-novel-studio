import type { Project } from '../../src/core/model';
import { uiPageHostScreens } from '../../src/core/ui-pages';
import { pythonLiteral } from '../../src/runtime/literals';
import type { authorReleasedRuntimeFixture } from './released-runtime-fixture';

type Authored = ReturnType<typeof authorReleasedRuntimeFixture>;
export interface ReleasedNativeCase { key: string; host: string; saveScope: 'base' | 'base-only'; setup: string[]; afterLoad: string[]; continuation?: string[]; valueId?: string }
const q = JSON.stringify;
export const nativeClick = (id: string) => '    click id ' + q('vn_component_' + id) + ' pos (0.5, 0.5)';
export const releaseStart = ['    pause until screen "main_menu"', '    run Start()', '    pause until screen "say"'];
export const releaseAnchor = ['    run Jump("vn_node_release_anchor")', '    pause until "历史兼容锚点一。"'];
export function releasedNativeCases(project: Project, authored?: Authored): ReleasedNativeCase[] {
  if (!authored) return [{ key: 'untouched_story', host: 'say', saveScope: 'base', setup: releaseStart, afterLoad: ['    pause until screen "say"'] }];
  const cases: ReleasedNativeCase[] = [];
  const entry = (key: keyof typeof uiPageHostScreens, setup: string[], afterLoad: string[], saveScope: ReleasedNativeCase['saveScope'] = 'base', touch = true) => {
    const row = authored.native.find(row => row.key === key)!;
    cases.push({ key, host: row.screen, saveScope, valueId: touch ? row.valueId : undefined,
      setup: [...releaseStart, ...releaseAnchor, ...setup, ...(touch ? [nativeClick(row.touchId), '    assert eval (vn_ui_get(' + q(row.valueId) + ', "text") == ' + q('touched:' + key) + ')'] : [])], afterLoad });
  };
  entry('say', [], releaseAnchor.slice(1));
  entry('choice', ['    run Jump("release_host_choice")', '    pause until screen "choice"'], ['    pause until screen "choice"']);
  entry('chapterTitle', ['    run Jump("release_host_chapter")', '    pause until screen "vn_chapter_title"'], ['    pause until screen "vn_chapter_title"']);
  entry('keyboard', ['    run Jump("release_host_input")', '    pause until screen "input"'], ['    pause until screen "input"'], 'base', false);
  cases.at(-1)!.continuation = ['    type "a" id "input"', '    keysym "K_RETURN"', '    pause until "输入宿主已返回。"', '    assert eval (release_native_input == "旧输入a")'];
  entry('messageBox', ['    run Confirm("历史确认宿主", NullAction(), NullAction())', '    pause until screen "confirm"'], releaseAnchor.slice(1), 'base-only');
  const menus = ['save', 'preferences', 'voiceSettings', 'pause', 'history', 'gallery', 'musicRoom', 'voiceCollection', 'chapterSelect', 'flowchart', 'staff'] as const;
  for (const page of menus) for (const screen of uiPageHostScreens[page]) {
    entry(page, ['    run ShowMenu(' + q(screen) + ')', '    pause until screen ' + q(screen)], releaseAnchor.slice(1), 'base-only');
    cases.at(-1)!.key = page === 'save' ? screen : page; cases.at(-1)!.host = screen;
  }
  for (const row of authored.custom) {
    const waiting = row.key === 'release_waiting';
    cases.push({ key: row.key, host: row.key, saveScope: 'base', valueId: row.valueId,
      setup: [...releaseStart, ...releaseAnchor, '    run Jump(' + q('vn_node_release_story_' + row.key) + ')', '    pause until eval (' + q(row.key) + ' in vn_ui_open_pages)', nativeClick(row.touchId), '    assert eval (vn_ui_get(' + q(row.valueId) + ', "text") == ' + q('touched:' + row.key) + ')'],
      afterLoad: ['    pause until eval (' + q(row.key) + ' in vn_ui_open_pages)'],
      continuation: [nativeClick(row.closeId), '    pause until eval (' + q(row.key) + ' not in vn_ui_open_pages)', ...(waiting ? ['    pause until "历史等待已经返回。"', '    assert eval (vn_var_release_result == "历史结果" and vn_var_release_resumed == 1)'] : [])] });
  }
  const say = authored.native.find(row => row.key === 'say')!;
  cases.push({ key: 'rollback', host: 'say', saveScope: 'base', valueId: say.valueId,
    setup: [...releaseStart, ...releaseAnchor, nativeClick(say.touchId), '    advance until "历史兼容锚点二。"'], afterLoad: ['    pause until "历史兼容锚点二。"'],
    continuation: ['    run Rollback() until "历史兼容锚点一。"', '    run Function(release_snapshot, "rollback_anchor")'] });
  const overlay = authored.custom.find(row => row.key === 'release_overlay')!;
  cases.push({ key: 'rollback_overlay', host: overlay.key, saveScope: 'base', valueId: overlay.valueId,
    setup: [...releaseStart, ...releaseAnchor, '    run Jump("vn_node_release_story_release_overlay")', '    pause until eval ("release_overlay" in vn_ui_open_pages)', nativeClick(overlay.touchId), '    advance until "历史兼容锚点一。"'], afterLoad: ['    pause until "历史兼容锚点一。"'],
    continuation: ['    run Rollback() until "历史叠加页面已打开。"', '    assert eval ("release_overlay" in vn_ui_open_pages)', '    run Function(release_snapshot, "rollback_overlay_anchor")'] });
  return cases;
}

/** Probe code is byte-identical across old and upgraded games. It only observes
 * engine state and drives real hosts; no legacy save records are fabricated. */
export function releasedProbeSource(project: Project) {
  const variables = pythonLiteral(project.variables.map(variable => variable.id));
  const anchor = project.nodes.find(node => node.id === 'release_anchor') ?? project.nodes.find(node => node.kind === 'passage');
  if (!anchor) throw new Error('No story anchor in release project.');
  const screens = pythonLiteral(Object.values(uiPageHostScreens).flat());
  return [
    "testsuite global:", "    before testcase:", "        $ _test.timeout = 30.0", "        $ _test.transition_timeout = 0.05", "        $ _test.screenshot_directory = \"tests/screenshots\"", "        $ preferences.text_cps = 0", "    after testcase:", "        if eval not main_menu:", "            run MainMenu(confirm=False)", "        pause until screen \"main_menu\"", "    teardown:", "        exit", "",
    'default release_native_input = ""', 'init python:',
    '    def release_snapshot(key):',
    '        import json, os',
    '        result = dict(engine=renpy.version_string, variables={identity: getattr(renpy.store, "vn_var_" + identity, None) for identity in ' + variables + '}, overrides=vn_ui_overrides, openPages=vn_ui_open_pages, screens=[name for name in ' + screens + ' if renpy.get_screen(name) is not None], contexts=len(renpy.game.contexts), pageSchema=getattr(renpy.store, "vn_ui_page_schema", None), migrations=getattr(renpy.store, "vn_ui_page_migration_log", []))',
    '        directory = os.environ["VNS_RELEASE_SNAPSHOT_DIR"]',
    '        os.makedirs(directory, exist_ok=True)',
    '        with open(os.path.join(directory, key + ".json"), "w", encoding="utf-8") as target: json.dump(result, target, ensure_ascii=False, indent=2)',
    '', 'label release_host_choice:', '    menu:', '        "历史选择":', '            pass', '    "选择宿主已返回。"', '    jump vn_node_' + anchor.id,
    '', 'label release_host_chapter:', '    call screen vn_chapter_title("历史章节", duration=120)', '    "章节宿主已返回。"', '    jump vn_node_' + anchor.id,
    '', 'label release_host_input:', '    $ release_native_input = renpy.input("历史输入宿主", default="旧输入", length=8)', '    "输入宿主已返回。"', '    jump vn_node_' + anchor.id, '',
  ].join('\n');
}
export function releasedProducerTests(cases: ReleasedNativeCase[], authored?: Authored) {
  const lines: string[] = [];
  for (const row of cases) lines.push('testcase produce_' + row.key + ':', ...row.setup,
    '    assert eval (FileSave(' + q('v080_' + row.key) + ', slot=True).get_sensitive())',
    '    run FileSave(' + q('v080_' + row.key) + ', confirm=False, slot=True)',
    '    run FileLoad(' + q('v080_' + row.key) + ', confirm=False, slot=True)', ...row.afterLoad,
    '    run Function(release_snapshot, ' + q(row.key) + ')', ...(row.continuation ?? []), '');
  if (authored) {
    const main = authored.native.find(row => row.key === 'main')!;
    lines.push('testcase released_title_is_not_saveable:', '    pause until screen "main_menu"', nativeClick(main.touchId),
      '    assert eval (vn_ui_get(' + q(main.valueId) + ', "text") == "touched:main")', '    assert eval (not FileSave("title_forbidden", slot=True).get_sensitive())',
      '    run Function(release_snapshot, "title_not_saveable")', '',
      'testcase released_ending_has_no_game_over_host:', ...releaseStart, '    run Jump("vn_end_return")', '    pause until screen "main_menu"',
      '    assert eval (renpy.get_screen("vn_game_over") is None)', '    run Function(release_snapshot, "ending_returns_title")', '');
  }
  return lines.join('\n');
}
export function releasedConsumerTests(cases: ReleasedNativeCase[]) {
  const lines: string[] = [];
  for (const row of cases) lines.push('testcase consume_' + row.key + ':', '    pause until screen "main_menu"',
    '    run FileLoad(' + q('v080_' + row.key) + ', confirm=False, slot=True)', ...row.afterLoad,
    '    assert eval (vn_ui_page_schema == 1 and vn_ui_page_migration_source == 0)',
    '    run Function(release_snapshot, ' + q(row.key) + ')',
    '    run FileSave(' + q('v081_' + row.key) + ', confirm=False, slot=True)',
    '    run FileLoad(' + q('v081_' + row.key) + ', confirm=False, slot=True)', ...row.afterLoad,
    '    assert eval (vn_ui_page_schema == 1)', '    run Function(release_snapshot, ' + q(row.key + '_resaved') + ')',
    ...(row.continuation ?? []), '');
  return lines.join('\n');
}
