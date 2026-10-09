import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { projectSchema } from '../src/core/model';
import { blueprintNodeDefaults, blueprintPin, connectBlueprintPins, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { exposePerformanceInputs, performanceInputs, rawSavedBlueprintAction } from '../src/core/blueprint-authoring';
import { createAudioClip } from '../src/core/audio-clip';
import { createVisualObject, patchVisualClipNode } from '../src/core/visual-object';
import { insertTimelineAction, performanceTimeline } from '../src/core/performance-timeline';
import { buildProject, runRenpy } from '../src/runtime/service';
import { pythonLiteral } from '../src/runtime/literals';

const source = process.argv[2];
if (!source) throw new Error('Pass the project saved by verify-timeline-media-editing.ts.');
const root = path.resolve('.'), sourceFile = path.resolve(source);
const output = path.join(root, 'artifacts/timeline-media-runtime', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const project = projectSchema.parse(JSON.parse(await fs.readFile(sourceFile, 'utf8')));
for (const asset of project.assets) {
  assert.ok(!asset.externalPath && !path.isAbsolute(asset.path), 'This acceptance fixture must contain local generated media');
  const destination = path.join(output, asset.path);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(path.join(path.dirname(sourceFile), asset.path), destination);
}
const graph = project.blueprints.find(item => item.timelineComponent)!;
const owner = project.blueprints.find(item => item.nodes.some(node => node.properties.graphId === graph.id))!;
const call = owner.nodes.find(node => node.properties.graphId === graph.id)!;
const musicNode = graph.nodes.find(node => rawSavedBlueprintAction(node)?.kind === 'audioClip')!;
const videoNode = graph.nodes.find(node => { const action = rawSavedBlueprintAction(node); return action?.kind === 'visual' && action.content === 'video'; })!;
assert.ok(graph && owner && call && musicNode && videoNode);
patchVisualClipNode(videoNode, { volume: .35, muted: false });
for (const [id, color] of [['qa_red', [220, 40, 40]], ['qa_blue', [40, 70, 220]]] as const) {
  const png = new PNG({ width: 32, height: 32 });
  for (let index = 0; index < png.data.length; index += 4) png.data.set([...color, 255], index);
  await fs.writeFile(path.join(output, id + '.png'), PNG.sync.write(png));
  project.assets.push({ id, name: id, kind: 'image', category: 'scene', path: id + '.png' });
}
execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x284bdc:size=160x90:rate=10', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=22050', '-t', '6', '-c:v', 'libvpx', '-c:a', 'libvorbis', path.join(output, 'qa_video.webm')]);
project.assets.push({ id: 'qa_video', name: '传入视频', kind: 'video', path: 'qa_video.webm' });
const picture = { ...createVisualObject('image', 'qa_red'), duration: .75 };
graph.timeline!.tracks.push({ id: 'qa_picture', name: '图片' }, { id: 'qa_sound', name: '音效' });
const pictureNode = insertTimelineAction(project, graph, picture, 0, 'qa_picture');
const sound = { ...createAudioClip('music', '音效参数', 6, 'sound'), offset: .2, duration: 1 };
const soundNode = insertTimelineAction(project, graph, sound, 2, 'qa_sound');
const fields = performanceInputs(graph);
for (const [nodeId, pinId] of [[musicNode.id, 'clip_duration'], [videoNode.id, 'object_muted'], [videoNode.id, 'object_duration'], [videoNode.id, 'object_mediaOffset'], [pictureNode, 'object_assetId'], [soundNode, 'clip_assetId']]) {
  const field = fields.find(field => field.nodeId === nodeId && field.pinId === pinId)!;
  exposePerformanceInputs(graph, [{ ...field, name: nodeId === soundNode ? '音效素材' : field.name }]);
}
const inputFor = (nodeId: string, pinId: string) => {
  const link = graph.links.find(link => link.toNodeId === nodeId && link.toPinId === pinId)!;
  const read = graph.nodes.find(node => node.id === link.fromNodeId)!;
  return graph.exposedInputs.find(pin => pin.id === read.properties.inputId)!;
};
const inputs = {
  music: inputFor(musicNode.id, 'clip_assetId'), video: inputFor(videoNode.id, 'object_assetId'),
  picture: inputFor(pictureNode, 'object_assetId'), sound: inputFor(soundNode, 'clip_assetId'),
  duration: inputFor(musicNode.id, 'clip_duration'), muted: inputFor(videoNode.id, 'object_muted'),
  video_duration: inputFor(videoNode.id, 'object_duration'), video_offset: inputFor(videoNode.id, 'object_mediaOffset'),
};
for (const [name, input] of Object.entries(inputs)) {
  owner.exposedInputs.push(blueprintPin(name, name, 'input', input.dataType, input.dataType === 'asset' ? '' : input.defaultValue));
  const read = blueprintNodeDefaults('getInput'); read.properties.inputId = name; owner.nodes.push(read);
  synchronizeBlueprintSignatures(project);
  assert.equal(connectBlueprintPins(owner, read.id, 'value', call.id, 'arg_' + input.id), undefined);
}
assert.equal(performanceTimeline(project, graph).until, 6);
await fs.writeFile(path.join(output, 'project.vns.json'), JSON.stringify(project, null, 2));
const game = path.join(output, 'game'), sdk = path.join(root, 'resources/runtime');
const built = await buildProject({ project, projectDir: output, outputDir: game, sdkRoot: sdk });
assert.ok(built.ok, JSON.stringify(built.diagnostics));
const argument = (name: string, value: unknown) => 'vn_bp_in_' + owner.id + '_' + name + '=' + pythonLiteral(value);
const overrides = [argument('music', 'music'), argument('video', 'qa_video'), argument('picture', 'qa_blue'), argument('sound', 'alternate'), argument('duration', 3), argument('muted', true)].join(', ');
const fallback = [argument('music', ''), argument('video', ''), argument('picture', ''), argument('sound', ''), argument('duration', 3)].join(', ');
const clamped = [argument('duration', 0), argument('video_duration', 99), argument('video_offset', 4)].join(', ');
const music = rawSavedBlueprintAction(musicNode)!;
const video = rawSavedBlueprintAction(videoNode)!;
assert.ok(music.kind === 'audioClip' && video.kind === 'visual');
const variantLabel = (name: string, args = '') => `label qa_media_${name}:
    scene
    window hide
    $ qa_media_done = False
    $ qa_media_visuals = {}
    $ qa_media_started = vn_bp_clock()
    call vn_blueprint_${owner.id}(${args})
    $ qa_media_elapsed = vn_bp_clock() - qa_media_started
    $ qa_media_done = True
    "${name}播放完成。"
    return
`;
await fs.writeFile(path.join(game, 'game/testcases.rpy'), `
default qa_media_done = False
default qa_media_started = 0.0
default qa_media_elapsed = 0.0
default qa_media_visuals = {}
default qa_movie_position = 0.0
init 100 python:
    qa_original_show_visual = vn_show_visual
    def qa_record_visual(data):
        qa_media_visuals[data["instanceId"]] = data
        return qa_original_show_visual(data)
    vn_show_visual = qa_record_visual
    def qa_active_movie():
        return next((movie for movie in renpy.display.video.channel_movie.values() if renpy.music.is_playing(channel=movie.channel)), None)
    def qa_video_position():
        movie = qa_active_movie()
        return (renpy.music.get_pos(channel=movie.channel) or 0.0) if movie else 0.0
    def qa_check_media(variant):
        # Inspect this short overlap in one frame; separate test commands
        # advance the live media clock between assertions.
        overridden = variant == "override"
        footage = qa_media_visuals["${video.instanceId}"]
        music = vn_audio_clips["vn_clip_music 0"]
        sound = vn_audio_clips["vn_clip_sound 0"]
        movie = qa_active_movie()
        assert not qa_media_done, "Timeline returned before its last clip"
        assert footage["assetId"] == ("qa_video" if overridden else "video")
        assert footage["mediaOffset"] == 1.0 and footage["duration"] == 3.0
        assert abs(vn_visual_media_gain(footage, .5) - .5) < .000001
        assert abs(vn_visual_media_gain(footage, 2.5) - .5) < .000001
        assert footage["muted"] is overridden
        assert music["assetId"] == ("music" if overridden else "alternate")
        assert music["offset"] == 1.0
        duration = 5.0 if variant == "default" else 3.0
        assert music["duration"] == duration
        assert sound["assetId"] == ("alternate" if overridden else "music")
        assert "from 1.000000000 to %.9f" % (1 + duration) in renpy.music.get_playing(channel="vn_clip_music 0")
        assert "from 1.000000000 to 4.000000000" in renpy.music.get_playing(channel=movie.channel)
        gain = renpy.audio.audio.get_channel(movie.channel).context.secondary_volume
        assert gain == 0.0 if overridden else abs(gain - .35) < .03
        return True
${variantLabel('default')}
${variantLabel('override', overrides)}
${variantLabel('fallback', fallback)}
${variantLabel('clamped', clamped)}
testsuite global:
    before testcase:
        $ _test.timeout = 25.0
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
    teardown:
        exit
testcase authored_media_timeline:
    click id "vn_main_start"
    run Jump("qa_media_default")
    pause until eval "${picture.instanceId}" in qa_media_visuals
    assert eval qa_media_visuals["${picture.instanceId}"]["assetId"] == "qa_red"
    screenshot "default-image.png"
    pause until eval len(vn_audio_clips) == 2 and qa_active_movie() is not None
    assert eval qa_check_media("default")
    $ qa_movie_position = qa_video_position()
    pause .25
    assert eval qa_video_position() > qa_movie_position + .1
    screenshot "default-video.png"
    pause until eval qa_active_movie() is None and "vn_clip_music 0" in vn_audio_clips and vn_audio_clips["vn_clip_music 0"]["elapsed"] >= 3.2
    assert eval not qa_media_done and renpy.music.is_playing(channel="vn_clip_music 0")
    screenshot "video-ended.png"
    pause until "default播放完成。"
    assert eval qa_media_done and 5.8 <= qa_media_elapsed < 7.0
    pause .1
    assert eval not vn_audio_clips
    run Jump("qa_media_override")
    pause until eval "${picture.instanceId}" in qa_media_visuals
    assert eval qa_media_visuals["${picture.instanceId}"]["assetId"] == "qa_blue"
    screenshot "override-image.png"
    pause until eval len(vn_audio_clips) == 2 and qa_active_movie() is not None
    assert eval qa_check_media("override")
    screenshot "override-video.png"
    pause until "override播放完成。"
    assert eval qa_media_done and 3.8 <= qa_media_elapsed < 5.0
    pause .1
    assert eval not vn_audio_clips and qa_active_movie() is None
    run Jump("qa_media_fallback")
    pause until eval "${picture.instanceId}" in qa_media_visuals
    assert eval qa_media_visuals["${picture.instanceId}"]["assetId"] == "qa_red"
    pause until eval len(vn_audio_clips) == 2 and qa_active_movie() is not None
    assert eval qa_check_media("fallback")
    pause until "fallback播放完成。"
    assert eval qa_media_done and 3.8 <= qa_media_elapsed < 5.0
    pause .1
    assert eval not vn_audio_clips
    run Jump("qa_media_clamped")
    pause until eval "${video.instanceId}" in qa_media_visuals
    assert eval qa_media_visuals["${video.instanceId}"]["duration"] == 2.0 and qa_media_visuals["${video.instanceId}"]["mediaOffset"] == 4.0
    pause until "clamped播放完成。"
    assert eval qa_media_done and 2.8 <= qa_media_elapsed < 4.0
    pause .1
    assert eval not vn_audio_clips and qa_active_movie() is None
`);
const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 90000, env: { SDL_VIDEO_WINDOW_POS: '2400,0' } });
await fs.writeFile(path.join(output, 'runtime.log'), result.log);
assert.ok(result.code === 0 && /Test cases\s*:\s*1\s*\|\s*1 passed/.test(result.log), result.log.slice(-5000));
const locate = async (directory: string, name: string): Promise<string | undefined> => {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { const found = await locate(file, name); if (found) return found; }
    else if (entry.name === name) return file;
  }
};
const images: Record<string, { red: number; blue: number; colors: number }> = {};
for (const name of ['default-image.png', 'override-image.png', 'default-video.png', 'override-video.png', 'video-ended.png']) {
  const file = await locate(path.join(game, 'tests/screenshots'), name); assert.ok(file);
  await fs.copyFile(file, path.join(output, name));
  const png = PNG.sync.read(await fs.readFile(file)), colors = new Set<string>();
  let red = 0, blue = 0;
  for (let y = Math.floor(png.height * .25); y < png.height * .75; y++) for (let x = Math.floor(png.width * .25); x < png.width * .75; x++) {
    const index = (y * png.width + x) * 4, [r, g, b] = png.data.subarray(index, index + 3);
    if (r > 150 && g < 110 && b < 110) red++;
    if (b > 150 && r < 110 && g < 130) blue++;
    colors.add(r + ',' + g + ',' + b);
  }
  images[name] = { red, blue, colors: colors.size };
}
assert.ok(images['default-image.png'].red > 1000 && images['override-image.png'].blue > 1000);
assert.ok(images['default-video.png'].colors > 100, 'Native video must decode changing footage');
assert.ok(images['override-video.png'].blue > 1000, 'Passed video must replace the actual decoded picture');
assert.ok(images['video-ended.png'].red + images['video-ended.png'].blue < 100, 'Video must disappear at its trimmed end while music continues');
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', source: sourceFile, images, checks: ['实际桌面保存的音视频片段导出运行', '蓝图调用时替换图片、音乐、音效和视频', '未传入和空值使用组件默认素材', '入点与出点用于实际音视频解码', '视频持续播放，淡入淡出、音量和静音真实生效', '视频先结束，音乐仍继续', '默认最后片段6秒完成，传入时长后4秒完成', '传入99秒视频时长按实际素材尾部裁剪，3秒完成', '组件结束后全部媒体停止'] }, null, 2));
console.log(output);
