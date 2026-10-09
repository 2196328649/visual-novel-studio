import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject, effectiveUiTheme, projectSchema } from '../src/core/model';
import { applyTextScript } from '../src/core/text-script';
import { storyMenuEntries } from '../src/core/story-menu';
import { buildProject, runRenpy } from '../src/runtime/service';
import { writeTestTone } from './lib/test-tone';
import { PNG } from 'pngjs';

const output = path.resolve('artifacts/chapter-four-regions-runtime', new Date().toISOString().replaceAll(':', '-'));
const templateDir = path.resolve('resources/templates/aihong'), sdk = path.resolve('resources/runtime');
await fs.mkdir(output, { recursive: true });
const template = projectSchema.parse(JSON.parse(await fs.readFile(path.join(templateDir, 'project.vns.json'), 'utf8')));
const theme = effectiveUiTheme(template.ui), p = createProject('章节四区与流程图验收');
p.width = 1920; p.height = 1080; p.playerDefaults = { textSpeed: 0, fullscreen: false };
p.ui.chapterTransition = structuredClone(theme.chapterTransition);
p.ui.pages = { ...p.ui.pages, chapterTitle: structuredClone(theme.pages?.chapterTitle) };
p.ui.components = [...p.ui.components.filter(c => c.page !== 'chapterTitle'), ...structuredClone(theme.components.filter(c => c.page === 'chapterTitle'))];
const references = JSON.stringify(p.ui);
const assets = template.assets.filter(a => references.includes(a.id) || (a.kind === 'font' && /SourceHanSerif|喜鹊燕书/.test(a.name)) || a.path.endsWith('ai_presentation_title_one.png'));
for (const asset of assets) {
  const target = path.join(output, asset.path); await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(path.join(templateDir, asset.path), target); p.assets.push(structuredClone(asset));
}
for (const [id, seconds, category] of [['bgm', 60, 'bgm'], ['hit', 72, 'sound'], ['replacement', .25, 'sound']] as const) {
  await writeTestTone(path.join(output, id + '.wav'), seconds);
  p.assets.push({ id, name: id, kind: 'audio', path: id + '.wav', category });
}
for (const [id, color] of [['qa_background', [50, 25, 90]], ['qa_overlay', [220, 170, 90]], ['qa_mask', [255, 255, 255]], ['qa_decoration', [25, 90, 160]]] as const) {
  const png = new PNG({ width: 64, height: 64 }); for (let i = 0; i < png.data.length; i += 4) png.data.set([...color, 255], i);
  await fs.writeFile(path.join(output, id + '.png'), PNG.sync.write(png));
  p.assets.push({ id, name: id, kind: 'image', category: 'scene', path: id + '.png' });
}
const title = assets.find(a => a.path.endsWith('ai_presentation_title_one.png'))!; assert.ok(title);
const parsed = applyTextScript(p, `#章节(显示名称=酒醒): 第一章 · 酒醒城破
旁白：开始章节验收。
@背景音乐：bgm
@章节进入演出文字版：章节音效=hit
@独立演出：四区文字
旁白：文字章节结束。
@章节进入演出：章节题图=${title.id}，章节音效=hit
@独立演出：原版题图
旁白：图片章节结束。
@章节进入演出文字版：时长=2，章节音效=无，章节背景=qa_background，笔触叠图=qa_overlay，笔触遮罩=qa_mask，章节标题背景=qa_decoration
@独立演出：替换背景与无音效
旁白：无音效章节结束。
@章节进入演出文字版：时长=2，章节音效=replacement，章节背景=无，笔触叠图=无，笔触遮罩=无，章节标题背景=无
@独立演出：替换短音效
旁白：替换音效章节结束。
#小章节：默认隐藏的小节
旁白：小节正文。
#段落：默认隐藏的段落
旁白：段落正文。
#章节(流程图=否): 第二章
旁白：隐藏章节正文。
#小章节(流程图=是，显示名称=可选入口): 显式入口
旁白：可选入口正文。
#章节: 第三章
旁白：第三章正文。
@返回标题界面`);
assert.deepEqual(parsed.issues, []);
const project = parsed.project;
assert.deepEqual(storyMenuEntries(project, 'flowchart').map(e => e.name), ['酒醒', '可选入口', '第三章']);
await fs.writeFile(path.join(output, 'project.vns.json'), JSON.stringify(project, null, 2));
const game = path.join(output, 'game');
const built = await buildProject({ project, projectDir: output, outputDir: game, sdkRoot: sdk });
assert.ok(built.ok, built.log + JSON.stringify(built.diagnostics));
await fs.writeFile(path.join(game, 'game/testcases.rpy'), `
init 999 python:
    qa_visuals = []
    qa_sound_calls = []
    qa_show_visual_original = vn_show_visual
    def qa_show_visual(data):
        qa_visuals.append(vn_prepare_visual(vn_visual_copy.deepcopy(data)))
        return qa_show_visual_original(data)
    vn_show_visual = qa_show_visual
    qa_play_original = renpy.music.play
    def qa_play(filenames, *args, **kwargs):
        if kwargs.get("channel") == "sound":
            qa_sound_calls.append(filenames)
        return qa_play_original(filenames, *args, **kwargs)
    renpy.music.play = qa_play
    def qa_walk(data):
        return [data] + [nested for child in data.get("children", []) for nested in qa_walk(child)]
testsuite global:
    before testcase:
        $ _test.timeout = 20
        $ _test.transition_timeout = .1
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit
testcase chapters:
    assert eval [e[1] for e in vn_flow_entries] == ["酒醒", "可选入口", "第三章"]
    click id "vn_main_start"
    pause until "开始章节验收。"
    pause .5
    $ qa_chapter_started = renpy.get_game_runtime()
    click pos (1700, 200)
    pause 2.0
    assert eval vn_performance_active
    assert eval renpy.get_widget("say", "window") is None
    assert eval len(qa_sound_calls) == 1
    assert eval renpy.music.get_playing(channel="music").endswith("bgm.wav")
    assert eval sorted(c["text"] for c in qa_walk(qa_visuals[-1]) if c.get("content") == "text") == sorted(["- 记或忆 -", "- 第一回 -", "醉梦", "1645 弘光元年"])
    assert eval all(c.get("fontAssetId") for c in qa_walk(qa_visuals[-1]) if c.get("content") == "text")
    assert eval all(c.get("textItalic") is True for c in qa_walk(qa_visuals[-1]) if c.get("name") in ("右侧字", "右侧字字形粒子"))
    assert eval all(not c.get("textItalic") for c in qa_walk(qa_visuals[-1]) if c.get("content") == "text" and c.get("name") != "右侧字")
    screenshot "four-regions.png"
    pause until "文字章节结束。"
    assert eval renpy.get_game_runtime() - qa_chapter_started < 10
    pause .5
    assert eval renpy.get_widget("say", "window") is not None
    assert eval renpy.music.get_playing(channel="music").endswith("bgm.wav")
    click pos (1700, 200)
    pause 2.0
    assert eval len(qa_sound_calls) == 2
    assert eval renpy.get_widget("say", "window") is None
    assert eval renpy.music.get_playing(channel="music").endswith("bgm.wav")
    screenshot "original-image.png"
    pause until "图片章节结束。"
    run ShowMenu("flowchart")
    pause until screen "flowchart"
    assert "酒醒"
    assert "可选入口"
    assert "第三章"
    screenshot "chapter-flowchart.png"
    $ renpy.test.testmouse.click_mouse(3, 1700, 400)
    pause until eval not renpy.get_screen("flowchart")
    assert "图片章节结束。"
    click pos (1700, 200)
    pause 1
    assert eval len(qa_sound_calls) == 2
    assert eval any(c.get("assetId") == "qa_background" for c in qa_walk(qa_visuals[-1]))
    assert eval any(c.get("assetId") == "qa_overlay" and c.get("maskAssetId") == "qa_mask" for c in qa_walk(qa_visuals[-1]))
    assert eval any(c.get("assetId") == "qa_decoration" for c in qa_walk(qa_visuals[-1]))
    assert eval renpy.music.get_playing(channel="music").endswith("bgm.wav")
    screenshot "replaced-background-layers.png"
    pause until "无音效章节结束。"
    click pos (1700, 200)
    pause 1
    assert eval len(qa_sound_calls) == 3
    assert eval qa_sound_calls[-1].endswith("replacement.wav")
    assert eval all(not c.get("path") and not c.get("maskPath") for c in qa_walk(qa_visuals[-1]) if c.get("content") == "image")
    pause until "替换音效章节结束。"
    assert eval renpy.music.get_playing(channel="music").endswith("bgm.wav")
`);
const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 90000, env: { RENPY_RENDERER: 'gl2' } });
await fs.writeFile(path.join(output, 'runtime.log'), result.log);
assert.equal(result.code, 0, result.log.slice(-5000));
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks: ['four independent text areas with original fonts', 'reference title screenshot', '72-second sound does not extend the chapter', 'sound once per chapter; BGM continues', 'empty sound produces no new playback', 'sound replacement is passed to the actual runtime', 'background, overlay, mask and decoration replacements reach the runtime', 'only requested flow entries', 'flowchart right click returns to game'] }, null, 2));
console.log(output);
