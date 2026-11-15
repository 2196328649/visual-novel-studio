import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { createProject, projectSchema, type UiComponent } from '../src/core/model';
import { pythonLiteral as q } from '../src/runtime/literals';
import { buildProject, runRenpy } from '../src/runtime/service';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { isolateRenpySaves } from './lib/renpy-saves';
import { preserveRenpyScreenshots } from './lib/text-typography';

// Prepared for the coordinated verification phase. Uses only a generated project,
// local SDK fonts and synthetic images; no authored project or player saves.
const sdk = path.resolve(process.env.VNS_RENPY_SDK ?? 'resources/runtime');
const output = path.resolve('artifacts/ui-collection-inspector-runtime', new Date().toISOString().replaceAll(':', '-') + '-' + process.pid);
const source = path.join(output, 'source'), game = path.join(output, 'game');
const evidencePath = path.join(output, 'displayable-pixels.json');
const baseFont = 'assets/collection-base.ttf', partFont = 'assets/collection-part.ttf';
const baseColor = '#d6d6d6', chapterColor = '#ff4455', captionColor = '#55ee66', numberColor = '#5599ff', navigationColor = '#dd77ff';
const alignments = ['left', 'center', 'right'] as const;
type List = NonNullable<UiComponent['list']>;
interface Sample { name: string; passed: boolean; actual: unknown; expected: unknown }
const report: { status: string; phase: string; checks: unknown[]; cases?: number; assertions?: number; samples?: number; failedSamples?: string[]; error?: string; cleanup?: unknown; coverage: string[] } = {
  status: 'running', phase: 'prepare', checks: [], coverage: [
    '真实存档和生成页面：章节、摘要、编号、分页的独立字体、字号、颜色与左中右像素位置',
    '显示文字关闭及恢复、旧 summaryFontSize/numberTextColor/pageTextColor 与默认底栏回退',
    '历史两种排列的姓名及正文样式、内部对齐宽度、旧 historyNameFontSize 回退',
    '历史默认/自定义/取消滚动条，悬停/拖动/不可用状态，只有悬停图片，页比例变化和图片适配',
    '极小下拉行高、字号和宽度仍产生有效的文字及视口尺寸',
  ],
};
const saveReport = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
async function check(name: string, result: { code: number; log: string }) {
  await fs.writeFile(path.join(output, name + '.log'), result.log);
  report.checks.push({ name, code: result.code });
  await saveReport();
  assert.equal(result.code, 0, result.log.slice(-9000));
}

function thumbPng(color: string) {
  const image = new PNG({ width: 32, height: 32 });
  const rgb = [1, 3, 5].map(offset => Number.parseInt(color.slice(offset, offset + 2), 16));
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) image.data.set([
    ...(x < 4 || x >= 28 || y < 4 || y >= 28 ? [238, 238, 238] : rgb), 255,
  ], (y * 32 + x) * 4);
  return PNG.sync.write(image);
}

function fixture() {
  const project = createProject('集合部件文字与滚动条验收');
  project.id = 'ui_collection_inspector_runtime'; project.width = 1000; project.height = 720;
  project.resourceSettings = { importMode: 'copy', directory: 'assets', ...project.resourceSettings, syncFolders: false };
  project.ui.fontSize = 26; project.ui.textColor = baseColor; project.ui.fontAssetId = 'collection_base';
  project.ui.pages = { save: { layout: 'custom' }, history: { layout: 'custom' } };
  project.playerDefaults = { textSpeed: 0, masterVolume: 0 };
  project.assets = [
    { id: 'collection_base', name: '集合基础字体', kind: 'font', category: 'font', path: baseFont },
    { id: 'collection_part', name: '集合部件字体', kind: 'font', category: 'font', path: partFont },
    ...['idle', 'hover', 'pressed', 'disabled'].map(state => ({ id: 'collection_' + state, name: state, kind: 'image' as const, category: 'ui' as const, path: `assets/collection-${state}.png`, width: 32, height: 32 })),
  ];
  const passage = project.nodes.find(node => node.kind === 'passage');
  assert.ok(passage?.kind === 'passage');
  passage.lines = [{ id: 'collection_fixture_line', text: '保留此句以创建隔离存档。', actions: [], textPresentation: { speed: 'instant' } }];
  const add = (id: string, kind: 'saveSlots' | 'historyList', list: List) => {
    project.ui.components.push({
      id: id + '_control', page: kind === 'saveSlots' ? 'save' : 'history', kind, name: id, text: '', x: .04, y: 60 / 720, width: .84, height: 600 / 720,
      style: { fontSize: 26, fontAssetId: 'collection_base', textColor: baseColor, background: '#181818' }, list,
    });
  };
  const save: List = {
    columns: 1, rows: 1, itemWidth: 840, itemHeight: 500, gapX: 12, gapY: 12, pageCount: 2,
    navigation: 'bottom', navigationRect: { x: .05, y: .9, width: .9, height: .08 },
    thumbnail: { x: .02, y: .02, width: .15, height: .12 }, chapter: { x: .05, y: .2, width: .9, height: .14 },
    caption: { x: .05, y: .4, width: .9, height: .2 }, number: { x: .05, y: .68, width: .9, height: .14 },
    showLabels: true, showDelete: false, captionMode: 'story', summaryFontSize: 19,
    numberTextColor: '#55aaff', pageTextColor: '#cc8899', pageSelectedTextColor: '#ffee44',
  };
  const override = (fontSize: number, textColor: string, align: typeof alignments[number]) => ({ fontAssetId: 'collection_part', fontSize, textColor, align });
  for (const align of alignments) add('save_' + align, 'saveSlots', { ...save, textStyles: {
    chapter: override(36, chapterColor, align), caption: override(30, captionColor, align),
    number: override(27, numberColor, align), navigation: override(25, navigationColor, align),
  } });
  const styled = project.ui.components.find(component => component.id === 'save_center_control')!.list!;
  add('save_hidden', 'saveSlots', { ...styled, showLabels: false });
  add('save_legacy', 'saveSlots', save);
  add('save_partial', 'saveSlots', { ...save, textStyles: { caption: { textColor: captionColor } } });
  const footer = { ...save, chapter: undefined, caption: undefined, summaryFontSize: 55 };
  add('save_footer', 'saveSlots', footer);
  add('save_footer_styled', 'saveSlots', { ...footer, textStyles: { caption: override(23, captionColor, 'right') } });
  const history: List = { historyNameWidth: 160, historyNameFontSize: 19, historyPaddingY: 12, voiceButtonSize: 40, gapX: 14, gapY: 12 };
  for (const layout of ['columns', 'stacked'] as const) {
    for (const align of alignments) add(`history_${layout}_${align}`, 'historyList', { ...history, historyLayout: layout,
      textStyles: { historyName: override(27, chapterColor, align), historyText: override(31, captionColor, align) },
    });
    add('history_legacy_' + layout, 'historyList', { ...history, historyLayout: layout });
  }
  const historyBar: NonNullable<List['historyScrollbar']> = {
    rect: { x: .94, y: 0, width: .06, height: 1 }, trackWidth: 5,
    thumb: { idle: 'collection_idle', hover: 'collection_hover', pressed: 'collection_pressed', disabled: 'collection_disabled', fit: 'nineSlice', borders: { left: 4, top: 4, right: 4, bottom: 4 } },
  };
  add('history_bar', 'historyList', { ...history, historyScrollbar: historyBar });
  add('history_bar_hover', 'historyList', { ...history, historyScrollbar: { ...historyBar, thumb: { hover: 'collection_hover', fit: 'stretch' } } });
  const cancelled = { ...history, historyScrollbar: historyBar };
  delete (cancelled as List).historyScrollbar;
  add('history_cancelled', 'historyList', cancelled);
  return projectSchema.parse(project);
}

await fs.mkdir(output, { recursive: true });
const previousSaves = process.env.RENPY_PATH_TO_SAVES;
try {
  await fs.mkdir(path.join(source, 'assets'), { recursive: true });
  await isolateRenpySaves(output);
  const project = fixture();
  await fs.copyFile(path.join(sdk, 'sdk-fonts/SourceHanSansLite.ttf'), path.join(source, baseFont));
  await fs.copyFile(path.join(sdk, 'renpy/common/DejaVuSans.ttf'), path.join(source, partFont));
  for (const [state, color] of Object.entries({ idle: '#ef3030', hover: '#30df50', pressed: '#3366ee', disabled: '#ba66cc' })) await fs.writeFile(path.join(source, `assets/collection-${state}.png`), thumbPng(color));
  await fs.writeFile(path.join(source, 'project.vns.json'), JSON.stringify(project, null, 2));
  await fs.writeFile(path.join(output, 'fixture.project.json'), JSON.stringify(project, null, 2));
  report.phase = 'build';
  const built = await buildProject({ project, projectDir: source, outputDir: game, sdkRoot: sdk, development: true });
  await check('compile', { code: built.ok ? 0 : 1, log: built.log + JSON.stringify(built.diagnostics) });
  const generatedScreens = await fs.readFile(path.join(game, 'game/screens.rpy'), 'utf8');
  for (const component of project.ui.components) {
    const declaration = `screen vn_components_${component.page}_component_${component.id}(`;
    assert.ok(generatedScreens.includes(declaration), 'Missing generated built-in component screen: ' + declaration);
  }
  report.checks.push({ name: 'generated-built-in-component-screens', count: project.ui.components.length });
  await fs.mkdir(path.join(game, 'tests/pixels'), { recursive: true });
  const show = (page: string) => `    run Show("qa_collection_authored", page=${q(page)})\n    move pos (8, 8)\n    pause .2`;
  const textCheck = (name: string, text: string, size: number, color: string, align: number, width: number, font = partFont, navigation = false) =>
    `    assert eval qa_col_text(${q(name)}, ${text}, ${size}, ${q(color)}, ${align}, ${width}, ${q(font)}, ${q(navigation)})`;
  const saveChecks = (page: string, align: number, legacy = false) => [
    textCheck(page + '-chapter', q('Aa Chapter'), legacy ? 26 : 36, legacy ? baseColor : chapterColor, legacy ? 0 : align, 756, legacy ? baseFont : partFont),
    textCheck(page + '-caption', q('Aa Caption'), legacy ? 19 : 30, legacy ? baseColor : captionColor, legacy ? 0 : align, 756, legacy ? baseFont : partFont),
    textCheck(page + '-number', q('01'), legacy ? 26 : 27, legacy ? '#55aaff' : numberColor, legacy ? .5 : align, 756, legacy ? baseFont : partFont),
    textCheck(page + '-navigation', q('2'), legacy ? 20 : 25, legacy ? '#cc8899' : navigationColor, legacy ? .5 : align, 105, legacy ? baseFont : partFont, true),
  ].join('\n');
  const historyChecks = (page: string, layout: string, align: number, legacy = false) => [
    textCheck(page + '-name', q('Aa Name'), legacy ? 19 : 27, legacy ? baseColor : chapterColor, legacy ? (layout === 'columns' ? 1 : 0) : align, layout === 'columns' ? 160 : 784, legacy ? baseFont : partFont),
    textCheck(page + '-text', q('Aa Dialogue'), legacy ? 26 : 31, legacy ? baseColor : captionColor, legacy ? 0 : align, layout === 'columns' ? 502 : 780, legacy ? baseFont : partFont),
  ].join('\n');
  const tests = String.raw`init -999 python:
    import renpy as _qa_col_engine
    _qa_col_engine.safe_mode_checked = True

init 1000 python:
    def qa_col_record(name, passed, actual, expected):
        import json
        if not hasattr(qa_col_record, "samples"):
            qa_col_record.samples = []
        qa_col_record.samples.append(dict(name=name, passed=bool(passed), actual=actual, expected=expected))
        with open(@@EVIDENCE@@, "w", encoding="utf-8") as output:
            json.dump(dict(samples=qa_col_record.samples), output, ensure_ascii=False, indent=2)
        if not passed:
            raise AssertionError("%s: actual=%r expected=%r" % (name, actual, expected))
        return True

    def qa_col_metadata(data):
        data.update(vn_ui_chapter="Aa Chapter", vn_ui_scene="Aa Scene", vn_ui_excerpt="Aa Caption")
    config.save_json_callbacks.append(qa_col_metadata)

    def qa_col_visit(predicate):
        found = []
        renpy.get_screen("qa_collection_authored").visit_all(lambda d: found.append(d) if predicate(d) else None)
        return found

    def qa_col_find_text(text):
        found = qa_col_visit(lambda d: isinstance(d, renpy.text.text.Text) and d.get_all_text() == text)
        if len(found) != 1:
            raise AssertionError("Expected one text %r, found %d" % (text, len(found)))
        return found[0]

    def qa_col_ink(surface, color):
        rgb = [int(round(channel * 255)) for channel in Color(color).rgb]
        points = [(x, y) for y in range(surface.get_height()) for x in range(surface.get_width())
            if surface.get_at((x, y))[3] > 160 and all(abs(surface.get_at((x, y))[i] - rgb[i]) < 26 for i in range(3))]
        if len(points) < 5:
            raise AssertionError("No rendered text/image pixels in " + color)
        return dict(left=min(p[0] for p in points), right=max(p[0] for p in points) + 1,
            top=min(p[1] for p in points), bottom=max(p[1] for p in points) + 1, pixels=len(points))

    def qa_col_text(name, text, size, color, align, width, font, navigation=False):
        widget = qa_col_find_text(text)
        actual = dict(font=widget.style.font, size=widget.style.size, color=list(Color(widget.style.color)), align=widget.style.text_align)
        expected = dict(font=font, size=size, color=list(Color(color)), align=align)
        qa_col_record(name + "-style", actual == expected, actual, expected)
        if navigation:
            placement = widget.get_placement()
            qa_col_record(name + "-placement", placement[0] == align and placement[2] == align and widget.style.xmaximum == width,
                [placement[0], placement[2], widget.style.xmaximum], [align, align, width])
            display = renpy.get_displayable("qa_collection_authored", "vn_file_page_2", base=True)
            width, height, padding = width + 16, 48, 8
        else:
            qa_col_record(name + "-min-width", widget.style.min_width == width, widget.style.min_width, width)
            display, height, padding = widget, 256, 0
        surface = renpy.render_to_surface(display, width, height, resize=True)
        qa_col_record(name + "-render-width", surface.get_width() == width, surface.get_width(), width)
        ink = qa_col_ink(surface, color)
        anchor = ink["left"] if align == 0 else ink["right"] if align == 1 else (ink["left"] + ink["right"]) / 2.0
        target = padding if align == 0 else width - padding if align == 1 else width / 2.0
        qa_col_record(name + "-ink-position", abs(anchor - target) <= 7, ink, dict(anchor=target, tolerance=7))
        renpy.render_to_file(display, "tests/pixels/" + name + ".png", width, height, resize=True)
        return True

    def qa_col_labels_visible(visible):
        texts = [d.get_all_text() for d in qa_col_visit(lambda d: isinstance(d, renpy.text.text.Text))]
        present = "Aa Chapter" in texts and "Aa Caption" in texts
        absent = "Aa Chapter" not in texts and "Aa Caption" not in texts
        return qa_col_record("labels-" + str(visible), (present if visible else absent) and "01" in texts and "2" in texts, texts, dict(labels=visible, numberAndNavigation=True))

    def qa_col_selected_page():
        button = renpy.get_displayable("qa_collection_authored", "vn_file_page_1", base=True)
        surface = renpy.render_to_surface(button, 121, 48, resize=True)
        ink = qa_col_ink(surface, "#ffee44")
        return qa_col_record("selected-navigation-hover-color", button.is_selected() and ink["pixels"] > 5, ink, dict(color="#ffee44", selected=True))

    def qa_col_history(count):
        _history_list[:] = []
        for index in range(count):
            entry = renpy.character.HistoryEntry()
            entry.who, entry.what, entry.who_args, entry.voice = "Aa Name", "Aa Dialogue" if index == 0 else "Aa Dialogue %d" % index, {}, None
            _history_list.append(entry)
        renpy.restart_interaction()

    def qa_col_bar(page="history_bar"):
        return renpy.get_widget("qa_collection_authored", "vn_component_" + page + "_control_scrollbar")

    def qa_col_default_bar(page):
        viewport = renpy.get_widget("qa_collection_authored", "vn_component_" + page + "_control_viewport")
        bars = qa_col_visit(lambda d: isinstance(d, renpy.display.behavior.Bar) and d.adjustment is viewport.yadjustment)
        return qa_col_record(page + "-native-scrollbar", qa_col_bar(page) is None and len(bars) == 1 and bars[0].adjustment.range > 0,
            dict(custom=qa_col_bar(page) is not None, native=len(bars)), dict(custom=False, native=1))

    def qa_col_bar_state(state, color, page="history_bar"):
        bar = qa_col_bar(page)
        thumb = bar.style.thumb
        actual = dict(state=getattr(thumb, "state", None), height=bar.thumb_dim, page=bar.adjustment.page, range=bar.adjustment.range)
        qa_col_record(page + "-" + state, isinstance(thumb, VnHistoryThumb) and thumb.state == state, actual, dict(state=state))
        surface = renpy.render_to_surface(thumb, 50, int(bar.thumb_dim), resize=True)
        rgba = list(surface.get_at((surface.get_width() // 2, surface.get_height() // 2)))
        reference = list(renpy.render_to_surface(Solid(color), 4, 4, resize=True).get_at((2, 2)))
        qa_col_record(page + "-" + state + "-pixel", all(abs(a-b) <= 4 for a,b in zip(rgba, reference)), rgba, reference)
        qa_col_record(page + "-" + state + "-size", surface.get_size() == (50, int(bar.thumb_dim)), list(surface.get_size()), [50, int(bar.thumb_dim)])
        renpy.render_to_file(thumb, "tests/pixels/" + page + "-" + state + ".png", 50, int(bar.thumb_dim), resize=True)
        return True

    def qa_col_thumb_fit():
        skin = dict(idle="assets/collection-idle.png", borders=dict(left=4, top=4, right=4, bottom=4))
        for fit in ("stretch", "contain", "cover", "nineSlice"):
            thumb = VnHistoryThumb(dict(skin, fit=fit), "idle", 48, 144, "#dddddd")
            surface = renpy.render_to_surface(thumb, 48, 144, resize=True)
            top, left, middle = [list(surface.get_at(point)) for point in ((24, 6), (2, 72), (24, 72))]
            expected = fit == "contain" and top[3] == 0 and left[3] > 200 or fit == "stretch" and min(top[:3]) > 220 and min(left[:3]) > 220 or fit == "cover" and min(top[:3]) > 220 and left[0] > left[1] + 100 or fit == "nineSlice" and top[0] > top[1] + 100 and min(left[:3]) > 220
            qa_col_record("thumb-fit-" + fit, surface.get_size() == (48, 144) and expected and middle[0] > middle[1] + 100,
                dict(top=top, left=left, middle=middle, size=list(surface.get_size())), fit)
            renpy.render_to_file(thumb, "tests/pixels/thumb-fit-" + fit + ".png", 48, 144, resize=True)
        nine = VnHistoryThumb(dict(skin, fit="nineSlice"), "idle", 48, 144, "#dddddd")
        plain = VnHistoryThumb({}, "idle", 48, 144, "#dddddd")
        tiny = VnHistoryThumb({}, "idle", 48, 7, "#dddddd")
        heights = [renpy.render(display, 48, 1, 0, 0).get_size()[1] for display in (nine, plain, tiny)]
        return qa_col_record("thumb-minimum-and-small-track", heights == [9, 16, 7], heights, [9, 16, 7])

screen qa_collection_authored(page):
    modal True
    zorder 250
    add Solid("#101010")
    # Each variant is a legal save/history component. Use its generated screen
    # alone so overlapping variants cannot interfere with displayable evidence.
@@PAGES@@

testsuite global:
    before testcase:
        $ _test.timeout = 25.0
        $ _test.transition_timeout = .05
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
        $ preferences.transitions = 0
    teardown:
        exit

testcase save_parts_and_legacy:
    pause until screen "main_menu"
    run Start()
    pause until eval vn_current_line == "collection_fixture_line"
    run FilePage("1")
    run FileSave(1, confirm=False, page="1")
    pause .2
    assert eval FileLoadable(1, page="1") and FileJson(1, "vn_ui_chapter", page="1") == "Aa Chapter"
@@SAVE_STYLED@@
    move id "vn_file_page_1" pos (.5, .5)
    pause .2
    assert eval qa_col_selected_page()
@@SAVE_HIDDEN@@
    assert eval qa_col_labels_visible(False)
    screenshot "save-labels-hidden.png"
@@SAVE_RESTORED@@
    assert eval qa_col_labels_visible(True)
@@SAVE_LEGACY@@
@@SAVE_PARTIAL@@
@@SAVE_FOOTER@@
    run Hide("qa_collection_authored")

testcase history_parts_and_legacy:
    $ qa_col_history(1)
@@HISTORY_STYLED@@
@@HISTORY_LEGACY@@
    run Hide("qa_collection_authored")

testcase history_scrollbar_geometry_and_states:
    $ qa_col_history(24)
@@HISTORY_DEFAULT@@
    assert eval qa_col_default_bar("history_legacy_stacked")
@@HISTORY_CUSTOM@@
    pause until eval qa_col_bar().adjustment.range > 0
    assert eval qa_col_bar_state("idle", "#ef3030")
    $ qa_col_initial_thumb = qa_col_bar().thumb_dim
    move id "vn_component_history_bar_control_scrollbar" pos (.5, .5)
    pause .2
    assert eval qa_col_bar_state("hover", "#30df50")
    $ renpy.test.testmouse.press_mouse(1)
    pause .2
    assert eval qa_col_bar_state("pressed", "#3366ee")
    screenshot "history-scrollbar-pressed.png"
    $ renpy.test.testmouse.release_mouse(1)
    move pos (8, 8)
    $ qa_col_history(90)
    pause .2
    assert eval qa_col_record("thumb-follows-page-ratio", 9 <= qa_col_bar().thumb_dim < qa_col_initial_thumb, qa_col_bar().thumb_dim, dict(min=9, lessThan=qa_col_initial_thumb))
    assert eval qa_col_bar_state("idle", "#ef3030")
    $ qa_col_history(1)
    pause .2
    assert eval qa_col_bar().adjustment.range == 0
    assert eval qa_col_bar_state("disabled", "#ba66cc")
    screenshot "history-scrollbar-disabled.png"
    $ qa_col_history(24)
@@HISTORY_HOVER_ONLY@@
    assert eval qa_col_bar_state("idle", "#dddddd", "history_bar_hover")
    move id "vn_component_history_bar_hover_control_scrollbar" pos (.5, .5)
    pause .2
    assert eval qa_col_bar_state("hover", "#30df50", "history_bar_hover")
@@HISTORY_CANCELLED@@
    assert eval qa_col_default_bar("history_cancelled")
    screenshot "history-scrollbar-cancelled.png"
    assert eval qa_col_thumb_fit()
    run Hide("qa_collection_authored")

testcase preference_popup_small_dimensions:
    run Show("vn_preference_popup", key="skipAll", character_id=None, options={"options": [{"label": "A", "value": False}], "itemHeight": .2}, x=40, y=40, width=1, button_height=1, font_size=26, text_color="#ffffff", surface="#181818", font="assets/collection-part.ttf")
    pause .2
    assert eval renpy.get_widget("vn_preference_popup", "vn_ui_preference_popup_frame").style.xmaximum == 9
    assert eval renpy.get_displayable("vn_preference_popup", "vn_preference_option_0", base=True).style.ymaximum == 5
    assert eval renpy.get_widget("vn_preference_popup", "vn_preference_option_0_label").style.size == 1
    run Hide("vn_preference_popup")
`.replace('@@EVIDENCE@@', q(evidencePath.split(path.sep).join('/')))
    .replace('@@PAGES@@', project.ui.components.map((component, index) => `    ${index ? 'elif' : 'if'} page == ${q(component.id.replace(/_control$/, ''))}:\n        use vn_components_${component.page}_component_${component.id}()`).join('\n'))
    .replace('@@SAVE_STYLED@@', alignments.map((align, index) => `${show('save_' + align)}\n${saveChecks('save_' + align, index / 2)}\n    screenshot ${q('save-' + align + '.png')}`).join('\n'))
    .replace('@@SAVE_HIDDEN@@', show('save_hidden')).replace('@@SAVE_RESTORED@@', show('save_center'))
    .replace('@@SAVE_LEGACY@@', show('save_legacy') + '\n' + saveChecks('save_legacy', 0, true) + '\n    screenshot "save-legacy.png"')
    .replace('@@SAVE_PARTIAL@@', show('save_partial') + '\n' + textCheck('save-partial-caption', q('Aa Caption'), 19, captionColor, 0, 756, baseFont))
    .replace('@@SAVE_FOOTER@@', show('save_footer') + '\n' + textCheck('save-footer', 'FileTime(1, page="1", format="%Y-%m-%d %H:%M")', 20, baseColor, 0, 840, baseFont) + '\n' + show('save_footer_styled') + '\n' + textCheck('save-footer-styled', 'FileTime(1, page="1", format="%Y-%m-%d %H:%M")', 23, captionColor, 1, 840))
    .replace('@@HISTORY_STYLED@@', ['columns', 'stacked'].flatMap(layout => alignments.map((align, index) => {
      const page = `history_${layout}_${align}`;
      return show(page) + '\n' + historyChecks(page, layout, index / 2) + `\n    screenshot ${q(page + '.png')}`;
    })).join('\n'))
    .replace('@@HISTORY_LEGACY@@', ['columns', 'stacked'].map(layout => show('history_legacy_' + layout) + '\n' + historyChecks('history_legacy_' + layout, layout, 0, true)).join('\n'))
    .replace('@@HISTORY_DEFAULT@@', show('history_legacy_stacked')).replace('@@HISTORY_CUSTOM@@', show('history_bar'))
    .replace('@@HISTORY_HOVER_ONLY@@', show('history_bar_hover')).replace('@@HISTORY_CANCELLED@@', show('history_cancelled'));
  await fs.writeFile(path.join(output, 'testcases.rpy'), tests);
  await fs.writeFile(path.join(game, 'game/testcases.rpy'), tests);
  report.phase = 'lint';
  const options = { savedir: path.join(output, 'saves'), timeoutMs: 180000, env: { RENPY_RENDERER: 'gl2' } };
  await check('lint', await runRenpy(sdk, game, ['lint'], options));
  report.phase = 'runtime';
  const result = await runRenpy(sdk, game, ['test', '--report-detailed', '--report-skipped'], { ...options, onData: text => process.stdout.write(text) });
  await check('runtime', result);
  report.cases = (tests.match(/^testcase /gm) ?? []).length;
  report.assertions = (tests.match(/^    assert /gm) ?? []).length;
  assert.match(result.log, new RegExp('Test cases\\s*:\\s*' + report.cases + '\\s*\\|\\s*' + report.cases + ' passed'));
  assert.equal(Number(result.log.match(/Assertions\s*:\s*(\d+)/)?.[1]), report.assertions, 'Every authored runtime assertion must run.');
  const evidence = JSON.parse(await fs.readFile(evidencePath, 'utf8')) as { samples: Sample[] };
  report.samples = evidence.samples.length;
  report.failedSamples = evidence.samples.filter(sample => !sample.passed).map(sample => sample.name);
  assert.ok(report.samples >= 150, 'Expected typography, placement, scrollbar and pixel checks.');
  assert.deepEqual(report.failedSamples, []);
  report.status = 'passed'; report.phase = 'complete';
} catch (error) {
  report.status = 'failed'; report.error = String(error); process.exitCode = 1;
} finally {
  try {
    const evidence = JSON.parse(await fs.readFile(evidencePath, 'utf8')) as { samples: Sample[] };
    report.samples = evidence.samples.length;
    report.failedSamples = evidence.samples.filter(sample => !sample.passed).map(sample => sample.name);
  } catch { /* A failure before the player starts has no displayable evidence. */ }
  try {
    await preserveRenpyScreenshots(game, path.join(output, 'screenshots'));
    for (const relative of ['tests/pixels', 'game/tests/pixels']) {
      const directory = path.join(game, relative);
      if (await fs.stat(directory).then(stat => stat.isDirectory()).catch(() => false)) await fs.cp(directory, path.join(output, 'pixel-images'), { recursive: true });
    }
  } catch (error) {
    report.status = 'failed'; report.error = [report.error, 'Evidence preservation: ' + String(error)].filter(Boolean).join('\n'); process.exitCode = 1;
  }
  try {
    report.cleanup = await cleanVerificationDirectories(output, ['source', 'game', 'saves', 'renpy-saves']);
    if ((report.cleanup as Awaited<ReturnType<typeof cleanVerificationDirectories>>).errors.length) throw new Error('Isolated directory cleanup failed.');
  } catch (error) {
    report.status = 'failed'; report.error = [report.error, String(error)].filter(Boolean).join('\n'); process.exitCode = 1;
  }
  if (previousSaves === undefined) delete process.env.RENPY_PATH_TO_SAVES; else process.env.RENPY_PATH_TO_SAVES = previousSaves;
  await saveReport(); console.log(path.join(output, 'report.json'));
  if (report.error) console.error(report.error);
}
