import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { createProject, projectSchema, type VisualObject } from '../src/core/model';
import { createMediaVisual } from '../src/core/media-command';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { blueprintFromPerformance, exposePerformanceInputs, performanceInputs } from '../src/core/blueprint-authoring';
import { buildProject, runRenpy } from '../src/runtime/service';
import { assetSourcePath } from '../src/desktop/project-store';

if (!process.argv[2]) throw new Error('Pass the project saved by verify-media-commands-editor.ts.');
const root = path.resolve('.'), sourceFile = path.resolve(process.argv[2]);
const source = projectSchema.parse(JSON.parse(await fs.readFile(sourceFile, 'utf8')));
const parsed = applyTextScript(source, source.scriptText!.content); assert.deepEqual(parsed.issues, []);
const actions = parsed.project.nodes.flatMap(node => node.kind === 'passage' ? node.lines.flatMap(line => line.actions) : []);
const authored = (id: string) => structuredClone(actions.find(action => action.kind === 'visual' && action.instanceId === id) as VisualObject);
const picture = authored('overlay'), caption = authored('caption'), video = authored('clip');
assert.ok(picture?.assetId && video?.assetId && caption?.text);
const output = path.join(root, 'artifacts/media-commands-runtime', new Date().toISOString().replaceAll(':', '-'));
const game = path.join(output, 'game'), sdk = path.join(root, 'resources/runtime'); await fs.mkdir(output, { recursive: true });
const project = createProject('通用媒体原生验收');
project.assets = source.assets.map(asset => ({ ...asset, externalPath: assetSourcePath(path.dirname(sourceFile), asset) }));
for (const object of [picture, video]) { object.width = .3; object.height = .3 * project.width / project.height; object.keyframes[0].x = .5; object.keyframes[0].y = .35; }
caption.keyframes[0].y = .7;
const noImage = { kind: 'hideVisual' as const, instanceId: picture.instanceId };
const noVideo = { kind: 'hideVisual' as const, instanceId: video.instanceId };
const timed = createMediaVisual('video', video.assetId!, { instanceId: 'timed', duration: 1.2, wait: true, volume: .2, width: .3, height: .3 });
const bound = createMediaVisual('video', video.assetId!, { instanceId: 'bound', loop: true, volume: 0, width: .3, height: .3 });
const graph = blueprintFromPerformance(project, [bound], '传入显示时长'); project.blueprints.push(graph);
exposePerformanceInputs(graph, performanceInputs(graph).filter(field => field.pinId === 'object_duration'));
const node = project.nodes.find(node => node.kind === 'passage')!;
node.lines = [
  { id: 'picture', text: '图片完整容纳。', actions: [picture, caption] },
  { id: 'carried', text: '下一句仍然保留。', actions: [] },
  { id: 'cover', text: '图片等比裁切。', actions: [{ ...picture, imageFit: 'cover' }] },
  { id: 'stretch', text: '图片拉伸。', actions: [{ ...picture, imageFit: 'stretch' }] },
  { id: 'hide', text: '只隐藏了图片。', actions: [noImage] },
  { id: 'silent', text: '', silent: true, playback: { clickSkip: false }, actions: [picture, { kind: 'pause', seconds: .1 }] },
  { id: 'after_silent', text: '独立演出后图片仍然保留。', actions: [] },
  { id: 'video_once', text: '视频单次播放。', actions: [noImage, { ...video, loop: false }] },
  { id: 'video_loop', text: '视频循环播放。', actions: [video] },
  { id: 'video_cover', text: '视频等比裁切。', actions: [{ ...video, imageFit: 'cover' }] },
  { id: 'video_stretch', text: '视频拉伸。', actions: [{ ...video, imageFit: 'stretch' }] },
  { id: 'video_hidden', text: '视频和声音已停止。', actions: [noVideo] },
  { id: 'parallel', text: '两个视频同时播放。', actions: [
    createMediaVisual('video', video.assetId!, { instanceId: 'left', loop: true, x: .25, y: .3, width: .3, height: .3, volume: .2 }),
    createMediaVisual('video', video.assetId!, { instanceId: 'right', loop: true, x: .75, y: .3, width: .3, height: .3, volume: .4 }),
  ] },
  { id: 'one_hidden', text: '另一个视频继续播放。', actions: [{ kind: 'hideVisual', instanceId: 'left' }] },
  { id: 'background', text: '换背景清除了全部对象。', actions: [{ kind: 'background', assetId: picture.assetId!, transition: 'none' }] },
  { id: 'timed', text: '定时视频等待完成。', actions: [timed] },
  { id: 'bound', text: '蓝图已接收视频时长。', actions: [{ kind: 'blueprint', blueprintId: graph.id, inputs: { [graph.exposedInputs[0].id]: .8 } }] },
];
project.scriptText = { format: 'vns-text-1', content: projectToText(project) };
await fs.writeFile(path.join(output, 'project.vns.json'), JSON.stringify(project, null, 2));
const built = await buildProject({ project, projectDir: output, outputDir: game, sdkRoot: sdk });
assert.ok(built.ok, JSON.stringify(built.diagnostics));
await fs.writeFile(path.join(game, 'game/testcases.rpy'), `
default qa_media_objects = {}
default qa_media_shown = {}
default qa_media_frames = {}
init 100 python:
    qa_original_show_visual = vn_show_visual
    def qa_record_visual(data):
        qa_media_objects[data["instanceId"]] = data
        qa_media_shown[data["instanceId"]] = vn_bp_clock()
        return qa_original_show_visual(data)
    vn_show_visual = qa_record_visual
    qa_original_visual_display = vn_visual_display
    def qa_record_display(st, at, data, viewport=None):
        result = qa_original_visual_display(st, at, data, viewport)
        movie = data.get("_vn_movie")
        qa_media_frames[data["instanceId"]] = (st, data["duration"], data.get("persistent"), vn_performance_active, (id(movie), movie.channel, movie._play) if movie else None)
        return result
    vn_visual_display = qa_record_display
    def qa_movies():
        return [movie for movie in renpy.display.video.channel_movie.values() if renpy.music.is_playing(channel=movie.channel)]
    def qa_movie_position():
        movies = qa_movies()
        return (renpy.music.get_pos(channel=movies[0].channel) or 0.0) if movies else 0.0
    def qa_movie_gain():
        return renpy.audio.audio.get_channel(qa_movies()[0].channel).context.secondary_volume
    def qa_assert_stopped():
        assert not qa_movies(), (qa_media_frames, [(id(movie), movie.channel, movie._play, renpy.music.get_pos(channel=movie.channel)) for movie in qa_movies()])
        return True
testsuite global:
    before testcase:
        $ _test.timeout = 20.0
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
    teardown:
        exit
testcase generic_media_commands:
    run Start()
    pause until "图片完整容纳。"
    assert eval renpy.showing("vn_visual_overlay") and renpy.showing("vn_visual_caption")
    screenshot "image-contain.png"
    click
    pause until "下一句仍然保留。"
    pause .2
    assert eval renpy.showing("vn_visual_overlay") and renpy.showing("vn_visual_caption")
    click
    pause until "图片等比裁切。"
    screenshot "image-cover.png"
    click
    pause until "图片拉伸。"
    screenshot "image-stretch.png"
    click
    pause until "只隐藏了图片。"
    assert eval not renpy.showing("vn_visual_overlay") and renpy.showing("vn_visual_caption")
    click
    pause until "独立演出后图片仍然保留。"
    assert eval renpy.showing("vn_visual_overlay") and renpy.showing("vn_visual_caption")
    screenshot "after-silent.png"
    click
    pause until "视频单次播放。"
    pause until eval qa_movie_position() > .15
    assert eval len(qa_movies()) == 1 and abs(qa_movie_gain() - .35) < .01
    screenshot "video-contain.png"
    pause 2.1
    assert eval qa_assert_stopped()
    screenshot "video-ended.png"
    click
    pause until "视频循环播放。"
    pause until eval qa_movie_position() > .1
    pause 4.2
    assert eval len(qa_movies()) == 1 and 0 <= qa_movie_position() < 2.2
    screenshot "video-loop.png"
    click
    pause until "视频等比裁切。"
    pause until eval qa_movie_position() > .1
    assert eval len(qa_movies()) == 1
    screenshot "video-cover.png"
    click
    pause until "视频拉伸。"
    pause until eval qa_movie_position() > .1
    assert eval len(qa_movies()) == 1
    screenshot "video-stretch.png"
    click
    pause until "视频和声音已停止。"
    pause .2
    assert eval not qa_movies() and not renpy.showing("vn_visual_clip") and renpy.showing("vn_visual_caption")
    click
    pause until "两个视频同时播放。"
    pause until eval len(qa_movies()) == 2 and all((renpy.music.get_pos(channel=movie.channel) or 0.0) > .15 for movie in qa_movies())
    assert eval renpy.showing("vn_visual_left") and renpy.showing("vn_visual_right")
    screenshot "two-videos.png"
    click
    pause until "另一个视频继续播放。"
    pause .2
    assert eval len(qa_movies()) == 1 and renpy.showing("vn_visual_right") and not renpy.showing("vn_visual_left")
    assert eval abs(qa_movie_gain() - .4) < .01
    click
    pause until "换背景清除了全部对象。"
    pause .2
    assert eval not qa_movies() and not renpy.showing("vn_visual_right") and not renpy.showing("vn_visual_caption")
    click
    pause until "定时视频等待完成。"
    assert eval 1.1 <= vn_bp_clock() - qa_media_shown["timed"] < 3.0
    pause .1
    assert eval qa_assert_stopped()
    click
    pause until "蓝图已接收视频时长。"
    assert eval qa_media_objects["bound"]["duration"] == .8 and not qa_media_objects["bound"]["persistent"]
    pause .9
    assert eval qa_assert_stopped()
`);
const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 90000, env: { SDL_VIDEO_WINDOW_POS: '2400,0' } });
await fs.writeFile(path.join(output, 'runtime.log'), result.log);
assert.ok(result.code === 0 && /Test cases\s*:\s*1\s*\|\s*1 passed/.test(result.log), result.log.slice(-6500));
const locate = async (directory: string, name: string): Promise<string | undefined> => {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { const found = await locate(file, name); if (found) return found; }
    else if (entry.name === name) return file;
  }
};
const images: Record<string, { red: number; green: number; blue: number; width: number; height: number; leftPixels: number; rightPixels: number }> = {};
for (const name of ['image-contain.png', 'image-cover.png', 'image-stretch.png', 'after-silent.png', 'video-contain.png', 'video-cover.png', 'video-stretch.png', 'video-loop.png', 'video-ended.png', 'two-videos.png']) {
  const source = await locate(path.join(game, 'tests/screenshots'), name); assert.ok(source, name);
  await fs.copyFile(source, path.join(output, name));
  const png = PNG.sync.read(await fs.readFile(source));
  let red = 0, green = 0, blue = 0, minX = png.width, minY = png.height, maxX = -1, maxY = -1, leftPixels = 0, rightPixels = 0;
  for (let y = 0; y < png.height * .64; y++) for (let x = 0; x < png.width; x++) {
    const index = (y * png.width + x) * 4, [r, g, b] = png.data.subarray(index, index + 3);
    const isRed = r > 150 && g < 120 && b < 120, isGreen = g > 150 && r < 120 && b < 140, isBlue = b > 150 && r < 120 && g < 150;
    if (isRed) red++; if (isGreen) green++; if (isBlue) blue++;
    if (isRed || isGreen || isBlue) {
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      if (x < png.width / 2) leftPixels++; else rightPixels++;
    }
  }
  images[name] = { red, green, blue, width: Math.max(0, maxX - minX + 1), height: Math.max(0, maxY - minY + 1), leftPixels, rightPixels };
}
for (const kind of ['image', 'video']) {
  const contain = images[kind + '-contain.png'], cover = images[kind + '-cover.png'], stretch = images[kind + '-stretch.png'];
  assert.ok(contain.red > 1000 && contain.green > 1000 && Math.abs(contain.width / contain.height - 2) < .04, `${kind} contain: ${JSON.stringify(contain)}`);
  assert.ok(cover.blue > 10000 && cover.red + cover.green < 1500 && Math.abs(cover.width / cover.height - 1) < .04, `${kind} cover: ${JSON.stringify(cover)}`);
  assert.ok(stretch.red > 1000 && stretch.green > 1000 && Math.abs(stretch.width / stretch.height - 1) < .04, `${kind} stretch: ${JSON.stringify(stretch)}`);
}
assert.equal(images['video-ended.png'].red + images['video-ended.png'].green + images['video-ended.png'].blue, 0);
assert.ok(images['after-silent.png'].blue > 1000); assert.ok(images['video-loop.png'].blue > 1000);
assert.ok(images['two-videos.png'].leftPixels > 10000 && images['two-videos.png'].rightPixels > 10000, `Both videos must decode visible frames: ${JSON.stringify(images['two-videos.png'])}`);
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', sourceFile, images, checks: [
  '使用编辑器实际导入并保存的图片、视频和文字指令',
  '图片与文字跨台词、跨独立演出保留；相同 ID 替换、指定 ID 隐藏',
  '原生截图像素验证图片和视频的容纳、裁切、拉伸比例',
  '视频单次完整播放后透明，循环视频超过两轮仍在解码',
  '替换视频不叠加旧声音；隐藏、切换背景时停止音视频',
  '不同 ID 的两个视频独立显示、播放和隐藏',
  '定时等待真实延迟；蓝图时长参数切换持续与定时模式',
] }, null, 2));
console.log(output);
