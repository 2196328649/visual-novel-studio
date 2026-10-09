import { promises as fs } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { projectSchema } from '../src/core/model';
import { projectToText } from '../src/core/text-script';
import { buildProject, runRenpy } from '../src/runtime/service';

const root = path.resolve('.'), source = path.join(root, 'resources/templates/aihong');
const output = path.join(root, 'artifacts/voice-collection-pages', new Date().toISOString().replaceAll(':', '-'));
const fixture = path.join(output, 'project'), game = path.join(output, 'game'), sdk = path.join(root, 'resources/runtime');
await fs.cp(source, fixture, { recursive: true });
const project = projectSchema.parse(JSON.parse(await fs.readFile(path.join(fixture, 'project.vns.json'), 'utf8')));
const captions = ['[若我五年后未能成书，我便纵倾尽所有，也要继续写下去。]', '[啊，你慌什么，我闺房没什么见不得人的。]', '[好志向！]', '[知宵，你能同我一起吗？]', '[嗯，我想逃离这一切……再也不回来。]', '[知宵，我想“逃”。]', '[能逃多远，就逃多远……我想逃到没有人认识我的地方。]', '多行对白\n第二行也应保持单行', '{b}文字标签应原样显示{/b} [player]', '第十条独立收藏', '第十一条独立收藏', '第十二条独立收藏', '末页唯一收藏'];
const samples = 16000 * 8, wav = Buffer.alloc(44 + samples * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(i / 16000 * Math.PI * 440 * 2) * 600), 44 + i * 2);
const passage = project.nodes.find(n => n.kind === 'passage')!;
const ids = captions.map((text, i) => {
  const id = `test_voice_${i}`;
  project.assets.push({ id, name: `测试配音${i + 1}`, kind: 'audio', category: 'voice', path: `assets/${id}.wav` });
  passage.lines.push({ id: `test_line_${i}`, text, voiceId: id, actions: [] });
  return id;
});
for (const id of ids) await fs.writeFile(path.join(fixture, `assets/${id}.wav`), wav);
project.ui.components.find(c => c.id === 'ai_voicecollection_items')!.list!.assetIds = ids;
project.scriptText = { format: 'vns-text-1', content: projectToText(project) };
await fs.writeFile(path.join(fixture, 'project.vns.json'), JSON.stringify(project, null, 2));
const built = await buildProject({ project, projectDir: fixture, outputDir: game, sdkRoot: sdk, development: true }); assert.ok(built.ok, built.log);
await fs.writeFile(path.join(game, 'game/testcases.rpy'), `
init -999 python:
    import renpy as _engine
    _engine.safe_mode_checked = True
testsuite global:
    before testcase:
        $ _test.timeout = 30.0
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit
testcase collections:
    pause 1
    python:
        vn_test_ids = ${JSON.stringify(ids)}
        persistent.vn_unlocks = list(vn_test_ids)
        persistent.vn_favorite_voices = vn_test_ids[:7]
        renpy.save_persistent()
    run ShowMenu("voice_collection")
    move pos (8, 8)
    pause 0.2
    assert screen "voice_collection"
    assert eval renpy.get_widget("voice_collection", "vn_component_ai_voicecollection_items_filter") is None
    assert eval renpy.get_widget("voice_collection", "vn_component_ai_voicecollection_items_stop") is None
    assert eval renpy.get_widget("voice_collection", "vn_component_ai_voicecollection_items_test_voice_0").vn_bounds == (701, 94)
    assert eval renpy.get_widget("voice_collection", "vn_component_ai_voicecollection_items_favorite_test_voice_0").vn_bounds == (68, 68)
    assert eval not renpy.get_widget("voice_collection", "vn_component_ai_voicecollection_items_favorite_test_voice_0").is_selected()
    assert eval renpy.get_widget("voice_collection", "vn_component_ai_voicecollection_items_caption_test_voice_0").get_all_text().endswith("…")
    assert eval renpy.get_widget("voice_collection", "vn_component_ai_voicecollection_items_caption_test_voice_2").get_all_text() == "[好志向！]"
    screenshot "seven-favorites.png"
    click id "vn_component_ai_voicecollection_items_test_voice_0"
    pause 0.2
    assert eval renpy.music.get_playing(channel="vn_replayvoice") == "assets/test_voice_0.wav"
    click id "vn_component_ai_voicecollection_items_favorite_test_voice_2"
    assert eval "test_voice_2" not in persistent.vn_favorite_voices
    assert eval renpy.get_widget("voice_collection", "vn_component_ai_voicecollection_items_test_voice_2") is None
    assert eval renpy.music.get_playing(channel="vn_replayvoice") == "assets/test_voice_0.wav"
    screenshot "deleted-other-item.png"
    python:
        persistent.vn_favorite_voices = list(vn_test_ids)
        renpy.save_persistent()
    run ShowMenu("voice_collection")
    pause 0.2
    assert eval renpy.get_widget("voice_collection", "vn_component_ai_voicecollection_items_test_voice_11") is not None
    assert eval renpy.get_widget("voice_collection", "vn_component_ai_voicecollection_items_test_voice_12") is None
    assert eval "\\n" not in renpy.get_widget("voice_collection", "vn_component_ai_voicecollection_items_caption_test_voice_7").get_all_text()
    screenshot "page-one.png"
    click id "vn_component_ai_voicecollection_items_page_1"
    assert eval renpy.get_widget("voice_collection", "vn_component_ai_voicecollection_items_test_voice_12") is not None
    screenshot "page-two.png"
    click id "vn_component_ai_voicecollection_items_test_voice_12"
    pause 0.2
    assert eval renpy.music.get_playing(channel="vn_replayvoice") == "assets/test_voice_12.wav"
    click id "vn_component_ai_voicecollection_items_favorite_test_voice_12"
    pause until eval renpy.music.get_playing(channel="vn_replayvoice") is None
    assert eval renpy.get_widget("voice_collection", "vn_component_ai_voicecollection_items_test_voice_0") is not None
    assert eval renpy.get_widget("voice_collection", "vn_component_ai_voicecollection_items_page_1") is None
    assert eval renpy.get_widget("voice_collection", "vn_component_ai_voicecollection_items_page_0").is_selected()
    screenshot "last-page-deleted.png"
    click id "vn_component_ai_voicecollection_items_test_voice_0"
    pause 0.2
    assert eval renpy.music.get_playing(channel="vn_replayvoice") == "assets/test_voice_0.wav"
    click id "vn_component_ai_voicecollection_soundroom"
    assert screen "music_room"
    pause until eval renpy.music.get_playing(channel="vn_replayvoice") is None
    click id "vn_component_ai_musicroom_voicecollection"
    assert screen "voice_collection"
    assert eval "test_voice_12" not in persistent.vn_favorite_voices
    assert eval len(persistent.vn_favorite_voices) == 12
    python:
        persistent.vn_favorite_voices = []
        renpy.save_persistent()
    run ShowMenu("voice_collection")
    screenshot "empty.png"
`);
const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 90000 });
await fs.writeFile(path.join(output, 'runtime.log'), result.log); assert.equal(result.code, 0, result.log);
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', fixture, original: 'artifacts/original-pages-2026-10-02/voice-collection.png', checks: ['两列六行及原始条目/删除按钮尺寸', '七条测试收藏与原作参照同尺寸对照', '长句省略/短句保留/多行单行化', '隐藏筛选和停止按钮', '独立语音播放及删除另一项不串音', '十三项分页与删除末页唯一项后回到第一页', '离页停止与再次进入保留收藏', '空收藏'], limitation: '隔离生成音频和测试台词；不修改原作玩家资料，不证明原作删除确认或完整解锁规则等价。' }, null, 2));
console.log(output);
