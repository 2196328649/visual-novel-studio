import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject } from '../src/core/model';
import { applyVisualInputs, createVisualObject, retimeVisualObject, visualInputFields, visualCurve, visualDissolve, visualParticles, visualPose } from '../src/core/visual-object';
import { buildProject, runRenpy } from '../src/runtime/service';
import { pythonLiteral } from '../src/runtime/literals';
import { PNG } from 'pngjs';
import { visualGlyphParticles } from '../src/core/visual-glyph-particles';
import { chapterGlyphPoints } from '../src/core/chapter';
import { chapterComposition } from '../src/core/chapter-composition';
import { chapterCompositionBlueprint } from '../src/core/chapter-composition-blueprint';
import { blueprintFromPerformance, exposePerformanceInputs, performanceInputs, rawSavedBlueprintAction } from '../src/core/blueprint-authoring';
import { compileProject } from '../src/runtime/compiler';
import { sampleCamera, type CameraAction } from '../src/core/camera-animation';
import { initialPreviewStage } from '../src/core/line-preview';
import { arrangePerformanceTimeline, performanceTimeline } from '../src/core/performance-timeline';

const root = path.resolve('.'), output = path.join(root, 'artifacts/visual-objects-runtime', new Date().toISOString().replaceAll(':', '-'));
const game = path.join(output, 'game'), sdk = path.join(root, 'resources/runtime');
const project = createProject('演出对象验收');
const cameraCurve: CameraAction = { kind: 'camera', x: .4, y: -.2, zoom: 1.5, rotation: 20, duration: 2, easing: 'easein', wait: true,
  curves: { x: [{ at: 0, value: 0, easing: 'linear' }, { at: 1, value: .1, easing: 'outquad' }, { at: 3, value: .3, easing: 'ease' }], zoom: [{ at: 0, value: 1, easing: 'linear' }, { at: 2, value: 1.8, easing: 'easeout' }] } };
project.blueprints.push(blueprintFromPerformance(project, [cameraCurve], '镜头独立属性曲线'));
const title = createVisualObject('text'), particles = createVisualObject('particles'), picture = createVisualObject('image', 'qa_image');
particles.particles!.lifeCurves = {
  size: [{ at: 0, value: 2, easing: 'linear' }, { at: .4, value: 12, easing: 'easeout' }, { at: 1, value: 0, easing: 'easein' }],
  opacity: [{ at: 0, value: .8, easing: 'linear' }, { at: 1, value: .2, easing: 'outquad' }],
  forceX: [{ at: 0, value: .4, easing: 'linear' }, { at: .3, value: -.2, easing: 'ease' }, { at: 1, value: .1, easing: 'outquad' }],
  forceY: [{ at: 0, value: -.1, easing: 'linear' }, { at: 1, value: .2, easing: 'easein' }],
  speed: [{ at: 0, value: .1, easing: 'linear' }, { at: .5, value: .4, easing: 'easeout' }, { at: 1, value: -.1, easing: 'linear' }],
  red: [{ at: 0, value: 255, easing: 'linear' }, { at: 1, value: 20, easing: 'ease' }],
  green: [{ at: 0, value: 10, easing: 'linear' }, { at: 1, value: 200, easing: 'outquad' }],
  blue: [{ at: 0, value: 127.5, easing: 'linear' }],
};
const group = createVisualObject('group'), solid = createVisualObject('solid'), nested = createVisualObject('group');
group.width = group.height = .2; group.keyframes[0].opacity = .5;
solid.color = '#ff0000';
nested.children = [{ ...createVisualObject('solid'), color: '#00ff00' }]; nested.startAt = 1;
group.children = [solid, { ...solid, instanceId: 'overlap' }, nested];
const glyph = createVisualObject('particles'); glyph.duration = 7; glyph.width = glyph.height = 1;
glyph.glyphParticles = { assetId: 'qa_image', count: 200, emissionStart: 1, timeScale: 1.3, motionScale: .8, sizeScale: 1.2, rect: { x: .1, y: .4, width: .8, height: .16 } };
picture.duration = 4; picture.width = .15; picture.height = .25; picture.keyframes[0].x = .2;
picture.imageFit = 'contain';
picture.ripple = { strength: .03, speed: 1 };
picture.dissolve = { start: 1, end: 3, from: 1, to: -1 };
picture.curves = {
  dissolveStrength: [{ at: 1, value: 1, easing: 'linear' }, { at: 3, value: -1, easing: 'outquad' }],
  rippleStrength: [{ at: 0, value: .01, easing: 'linear' }, { at: 3, value: .04, easing: 'ease' }],
  rippleSpeed: [{ at: 0, value: 1, easing: 'linear' }, { at: 2, value: 2, easing: 'easein' }],
};
// Curves alone must enable the shader without a static ripple configuration.
delete picture.ripple;
title.text = '独立文字对象'; title.duration = 4; particles.duration = 4;
title.keyframes.push({ ...title.keyframes[0], x: .7, rotation: 10, duration: 2, easing: 'linear' });
title.curves = { x: [{ at: 2, value: .7, easing: 'outquad' }, { at: 0, value: .5, easing: 'linear' }], opacity: [{ at: 0, value: 1, easing: 'linear' }, { at: 4, value: .3, easing: 'easeout' }] };
const node = project.nodes.find(node => node.kind === 'passage')!;
if (node.kind !== 'passage') throw Error('missing passage');
node.lines[0].text = '观察四秒对象演出。'; node.lines[0].actions = [title, particles, picture];
const reusable = createVisualObject('group');
reusable.retimeOnDuration = true;
reusable.children = [createVisualObject('text')];
const graph = blueprintFromPerformance(project, [reusable]); project.blueprints.push(graph);
const timeline = performanceTimeline(project, graph); arrangePerformanceTimeline(project, graph, timeline.clips, timeline.tracks);
exposePerformanceInputs(graph, performanceInputs(graph).filter(pin => pin.pinId === 'object_duration' || pin.dataType === 'string'));
const overrides = Object.fromEntries(graph.exposedInputs.map(pin => [pin.id, pin.dataType === 'number' ? 1.5 : '调用参数文字']));
node.lines.push({ id: 'object_call', text: '', silent: true, actions: [{ kind: 'blueprint', blueprintId: graph.id, inputs: overrides }] }, { id: 'object_after', text: '调用结束。', actions: [] });
const overrideGroup = { ...createVisualObject('group'), duration: 6, retimeOnDuration: true, children: [{ ...createVisualObject('solid'), duration: 3, startAt: 1, retimeOnDuration: true, curves: { x: [{ at: 1, value: .8, easing: 'linear' as const }] } }] };
const overrideGraph = blueprintFromPerformance(project, [overrideGroup], '参数仅应用一次'); project.blueprints.push(overrideGraph);
const overrideNode = overrideGraph.nodes.find(node => node.type === 'savedAction')!; overrideNode.properties.object_duration = 12;
const overrideTemplate = rawSavedBlueprintAction(overrideNode)!;
assert.equal(overrideTemplate.kind, 'visual'); if (overrideTemplate.kind !== 'visual') throw Error('missing override template');
const overrideExpected = applyVisualInputs({ ...overrideTemplate, fontAssetId: project.ui.fontAssetId }, { ...Object.fromEntries(visualInputFields(overrideTemplate).map(field => [field.key, field.value])), duration: 12 });

await fs.mkdir(output, { recursive: true });
const png = new PNG({ width: 32, height: 32 });
for (let i = 0; i < png.data.length; i += 4) { png.data[i] = (Math.floor(i / 4) % 32) < 16 ? 70 : 210; png.data[i + 1] = 160; png.data[i + 2] = Math.floor(i / 128) < 16 ? 210 : 70; png.data[i + 3] = 255; }
await fs.writeFile(path.join(output, 'test-image.png'), PNG.sync.write(png));
project.assets.push({ id: 'qa_image', name: '验收图片', kind: 'image', path: 'test-image.png' });
await fs.copyFile(path.join(sdk, 'sdk-fonts/SourceHanSansLite.ttf'), path.join(output, 'test-font.ttf'));
project.assets.push({ id: 'qa_font', name: '验收字体', kind: 'font', path: 'test-font.ttf' });
const textChapterGraph = chapterCompositionBlueprint(project, { title: '同名文字', subtitle: '同名文字', duration: 7, effect: 'ink' }).graph;
project.blueprints.push(textChapterGraph);
const textChapterRoot = rawSavedBlueprintAction(textChapterGraph.nodes.find(node => node.type === 'savedAction')!)!;
assert.equal(textChapterRoot.kind, 'visual'); if (textChapterRoot.kind !== 'visual') throw Error('missing text chapter root');
const overrideCompiled = compileProject(project);
const textChapterLine = Object.values(overrideCompiled.files).flatMap(content => content.split('\n')).find(line => line.includes(' = vn_visual_with_inputs(') && line.includes(textChapterRoot.instanceId))!;
assert.ok(textChapterLine);
const textChapterExpression = textChapterLine.slice(textChapterLine.indexOf('vn_visual_with_inputs('));
const effectOverrides: Record<string, string | number> = { '章节标题描边宽度': 5, '章节标题描边颜色': '#00ff00', '章节标题描边透明度': .4, '章节标题阴影横向偏移': -8, '章节标题阴影纵向偏移': 6, '章节标题阴影颜色': '#0000ff', '章节标题阴影透明度': .8 };
const textChapterInputs = textChapterGraph.exposedInputs.map(input => `        vn_bp_in_${textChapterGraph.id}_${input.id} = ${pythonLiteral(effectOverrides[input.name] ?? (input.name === '章节标题' ? '春日新章' : input.name === '章节副标题' ? '江畔重逢' : input.name === '章节标题字号' ? 72 : input.name === '章节标题字体' ? 'qa_font' : input.name === '章节标题水平对齐' ? 'right' : input.name === '章节标题垂直对齐' ? 'bottom' : input.defaultValue))}`).join('\n');
const cameraTransform = Object.values(overrideCompiled.files).join('\n').match(/camera master at (vn_camera_\w+)/)?.[1];
assert.ok(cameraTransform, 'compiled camera curve transform');
const cameraSamples = [0, .1, .5, 1, 1.5, 2, 2.5, 3, 3.5].map(time => ({ time, pose: sampleCamera(initialPreviewStage().camera, cameraCurve, time) }));
assert.deepEqual(overrideCompiled.diagnostics.filter(item => item.severity === 'error'), []);
const overrideLine = Object.values(overrideCompiled.files).flatMap(content => content.split('\n')).find(line => line.includes(' = vn_visual_with_inputs(') && line.includes(overrideGroup.instanceId))!;
assert.ok(overrideLine, 'actual compiled parameter expression');
const overrideExpression = overrideLine.slice(overrideLine.indexOf('vn_visual_with_inputs('));
const built = await buildProject({ project, projectDir: output, outputDir: game, sdkRoot: sdk });
assert.ok(built.ok, built.log);
await fs.mkdir(path.join(game, 'tests'), { recursive: true });
const samples = [0, .2, .7, 1.9, 2, 3, 3.5, 4].map(time => ({ time, pose: visualPose(title, time), particles: visualParticles(particles, time), dissolve: visualDissolve(picture, time), rippleStrength: visualCurve(picture, 'rippleStrength', time, .01), rippleSpeed: visualCurve(picture, 'rippleSpeed', time, 1) }));
const glyphCurves = { size: [{ at: 0, value: 1, easing: 'linear' as const }, { at: 1, value: .2, easing: 'easein' as const }], opacity: [{ at: 0, value: .8, easing: 'linear' as const }], forceX: [{ at: 0, value: .2, easing: 'linear' as const }, { at: 1, value: -.1, easing: 'easeout' as const }], red: [{ at: 0, value: 127.5, easing: 'linear' as const }] };
const glyphSamples = [false, true].flatMap(custom => [0, 17, 1000000].flatMap(seed => [0, 1, 1.2, 2, 4, 6].map(time => ({ custom, seed, time, particles: visualGlyphParticles({ ...glyph, glyphParticles: { ...glyph.glyphParticles!, seed, lifeCurves: custom ? glyphCurves : undefined } }, time, chapterGlyphPoints(png.data, 32, 32), 32, 32, project.width, project.height) }))));
const chapterGroup = chapterComposition(project, { title: '拆分章节', subtitle: '', duration: 7, effect: 'ink', backgroundId: 'qa_image', titleImageId: 'qa_image' }).actions.at(-1)!;
assert.equal(chapterGroup.kind, 'visual');
if (chapterGroup.kind !== 'visual') throw Error('missing chapter composition');
const retimingFields = visualInputFields(chapterGroup);
const retimingPaths = Object.fromEntries(retimingFields.map(field => [field.key, field.path]));
const retimingSamples = [3.5, 14, 21].map(duration => { const values = { ...Object.fromEntries(retimingFields.map(field => [field.key, field.value])), duration }; return { values, expected: applyVisualInputs(chapterGroup, values) }; });
const zeroRetimingSamples = [0, 14, 0, 3.5, 7].map((duration, index, durations) => {
  let expected = chapterGroup;
  for (const value of durations.slice(0, index + 1)) expected = retimeVisualObject(expected, value);
  return { duration, expected };
});
await fs.writeFile(path.join(game, 'game/testcases.rpy'), `
init -999 python:
    import renpy as _visual_engine
    _visual_engine.safe_mode_checked = True
init python:
    def qa_visual_samples():
        def compare(actual, expected):
            if isinstance(expected, dict):
                assert set(actual) == set(expected)
                for key in expected:
                    compare(actual[key], expected[key])
            elif isinstance(expected, list):
                assert len(actual) == len(expected)
                for a, b in zip(actual, expected):
                    compare(a, b)
            elif isinstance(expected, (int, float)):
                assert abs(actual - expected) < .00000001
            else:
                assert actual == expected
        for row in ${pythonLiteral(retimingSamples)}:
            actual = vn_visual_with_inputs(${pythonLiteral(chapterGroup)}, ${pythonLiteral(retimingPaths)}, row["values"])
            compare(actual, row["expected"])
        compiled_override = ${overrideExpression}
        for row in ${pythonLiteral(cameraSamples)}:
            transform = ${cameraTransform}()
            transform.execute(transform, 0.0, 0.0)
            transform.execute(transform, row["time"], row["time"])
            for prop, field, units in (("x", "xoffset", config.screen_width), ("y", "yoffset", config.screen_height), ("zoom", "zoom", 1), ("rotation", "rotate", 1)):
                actual = getattr(transform.state, field) / float(units)
                assert abs(actual - row["pose"][prop]) < .000001, (row["time"], prop, actual, row["pose"][prop])
        restored = ${pythonLiteral(chapterGroup)}
        for row in ${pythonLiteral(zeroRetimingSamples)}:
            restored = vn_visual_with_inputs(restored, {"duration": ["duration"]}, {"duration": row["duration"]})
            compare(restored, row["expected"])
        compare(compiled_override, ${pythonLiteral(overrideExpected)})
        assert compiled_override["children"][0]["duration"] == 6
        assert compiled_override["children"][0]["curves"]["x"][0]["at"] == 2
        for row in ${pythonLiteral(samples)}:
            pose = vn_visual_pose(${pythonLiteral(title)}, row["time"])
            assert abs(vn_visual_dissolve(${pythonLiteral(picture)}, row["time"]) - row["dissolve"]) < .000001
            assert abs(vn_visual_curve(${pythonLiteral(picture)}, "rippleStrength", row["time"], .01) - row["rippleStrength"]) < .000001
            assert abs(vn_visual_curve(${pythonLiteral(picture)}, "rippleSpeed", row["time"], 1) - row["rippleSpeed"]) < .000001
            assert all(abs(pose[key] - row["pose"][key]) < .000001 for key in ("x", "y", "scale", "rotation", "opacity"))
            actual = vn_visual_particles(${pythonLiteral(particles)}, row["time"])
            assert len(actual) == len(row["particles"])
            assert all(a["color"] == b["color"] for a, b in zip(actual, row["particles"]))
            assert all(abs(a[key] - b[key]) < .000001 for a, b in zip(actual, row["particles"]) for key in ("x", "y", "size", "opacity"))
            for ratio in (.5, 2, 3):
                resized = vn_visual_copy.deepcopy(${pythonLiteral(particles)})
                vn_visual_retime(resized, resized["duration"] * ratio)
                scaled = vn_visual_particles(resized, row["time"] * ratio)
                assert all(a["color"] == b["color"] for a, b in zip(scaled, row["particles"]))
                assert all(abs(a[key] - b[key]) < .000001 for a, b in zip(scaled, row["particles"]) for key in ("x", "y", "size", "opacity"))

    def qa_visual_fit():
        data = ${pythonLiteral(picture)}
        data.update(path="test-image.png", width=320.0 / config.screen_width, height=80.0 / config.screen_height, curves={}, dissolve=None, ripple=None)
        for fit in ("stretch", "contain", "cover", "contain"):
            data["imageFit"] = fit
            display, delay = vn_visual_display(0, 0, data)
            surface = renpy.render_to_surface(display.child, 320, 80, resize=True)
            assert surface.get_size() == (320, 80), (fit, surface.get_size())
            # The opaque square must occupy 80x80 in contain mode, centered in a 320x80 box.
            assert abs(surface.get_at((5, 40))[3] - (0 if fit == "contain" else 255)) <= 1, fit
            assert surface.get_at((160, 40))[3] >= 254, fit
            if fit == "contain":
                assert surface.get_at((110, 40))[3] <= 1
                assert surface.get_at((130, 40))[3] >= 254

    def qa_static_text_updates():
        data = ${pythonLiteral(title)}
        data.update(width=1, height=1, curves={}, text="文字", fontSize=32, textEffects={}, textClip=None)
        for change in ({}, {"text": "新章"}, {"textItalic": True}, {"textItalic": False}, {"color": "#00ff00"}, {"fontSize": 24}, {"textAlign": "left"}, {"textVerticalAlign": "bottom"}, {"textEffects": {"outlineWidth": 2, "outlineColor": "#ff0000"}}, {"textClip": {"x": 0, "y": 0, "width": .15, "height": 1}}, {}):
            data.update(change)
            if data.get("textClip"):
                data["textEffects"]["outlineWidth"] += 1
            display, delay = vn_visual_display(0, 0, data, (160, 80))
            actual = renpy.render_to_surface(display.child, 160, 80, resize=True)
            expected = renpy.render_to_surface(vn_visual_text(data, 160, 80), 160, 80, resize=True)
            assert all(actual.get_at((x, y)) == expected.get_at((x, y)) for y in range(80) for x in range(160)), change

    def qa_visual_group():
        data = vn_prepare_visual(${pythonLiteral(group)})
        for time, channel in ((0, 0), (1.5, 1)):
            display, delay = vn_visual_display(time, time, data)
            canvas = Fixed(Solid("#000000"), Transform(display, align=(.5, .5)), xysize=(600, 400))
            surface = renpy.render_to_surface(canvas, 600, 400, resize=True)
            width, height = surface.get_size()
            pixel = surface.get_at((width // 2, height // 2))
            assert abs(pixel[channel] - 128) <= 3, (time, pixel)
            assert pixel[channel] > pixel[1 - channel] + 80, (time, pixel)

    def qa_visual_glyph():
        data = vn_prepare_visual(${pythonLiteral(glyph)})
        for row in ${pythonLiteral(glyphSamples)}:
            data["glyphParticles"]["seed"] = row["seed"]
            data["glyphParticles"]["lifeCurves"] = ${pythonLiteral(glyphCurves)} if row["custom"] else None
            actual = vn_visual_glyph_particles(data, row["time"], config.screen_width, config.screen_height)
            assert len(actual) == len(row["particles"])
            assert all(abs(a[key] - b[key]) < .00001 for a, b in zip(actual, row["particles"]) for key in ("x", "y", "size", "opacity")), row["time"]
            assert all(a["color"] == b["color"] for a, b in zip(actual, row["particles"]))
            for ratio in (.5, 2, 3):
                resized = vn_visual_copy.deepcopy(data)
                vn_visual_retime(resized, data["duration"] * ratio)
                scaled = vn_visual_glyph_particles(resized, row["time"] * ratio, config.screen_width, config.screen_height)
                assert all(abs(a[key] - b[key]) < .00001 for a, b in zip(scaled, row["particles"]) for key in ("x", "y", "size", "opacity"))
                assert all(a["color"] == b["color"] for a, b in zip(scaled, row["particles"]))
        display, delay = vn_visual_display(2, 2, data)
        renpy.render_to_surface(display, resize=True)

    def qa_text_glyph():
        data = vn_prepare_visual(${pythonLiteral({ ...glyph, text: '第一章 {春日}', glyphParticles: { ...glyph.glyphParticles!, source: 'text', assetId: undefined, motionScale: 0, emissionStart: 0 } })})
        assert "glyphPath" not in data
        original = vn_visual_glyph_particles(data, 1, 960, 540)
        assert len(original) == 200
        assert any(p["opacity"] > 0 for p in original)
        assert original == vn_visual_glyph_particles(data, 1, 960, 540)
        data["textItalic"] = True
        slanted = vn_visual_glyph_particles(data, 1, 960, 540)
        assert [(p["x"], p["y"]) for p in slanted] != [(p["x"], p["y"]) for p in original]
        data["textItalic"] = False
        assert original == vn_visual_glyph_particles(data, 1, 960, 540)
        data["text"] = "另一章"
        changed = vn_visual_glyph_particles(data, 1, 960, 540)
        assert [(p["x"], p["y"]) for p in changed] != [(p["x"], p["y"]) for p in original]
        data["text"] = ""
        assert vn_visual_glyph_particles(data, 1, 960, 540) == []
        data["text"] = "第一章"
        display, delay = vn_visual_display(1, 1, data)
        renpy.render_to_file(display, "tests/text-glyph.png", resize=True)

    def qa_chapter_composition():
        data = vn_prepare_visual(${pythonLiteral(chapterGroup)})
        for time in (0, 1.5, 3.5, 6.8):
            display, delay = vn_visual_display(time, time, data)
            canvas = Fixed(Transform(display, align=(.5, .5)), xysize=(config.screen_width, config.screen_height))
            renpy.render_to_file(canvas, "tests/chapter-composition-" + str(time) + ".png", resize=True)

    def qa_text_effects():
        data = {"text": "文字", "fontSize": 72, "color": "#ffffff", "textEffects": {"outlineWidth": 3, "outlineColor": "#ff0000", "shadowX": 18, "shadowY": 12, "shadowColor": "#0000ff", "shadowOpacity": 1}}
        renpy.render_to_file(vn_visual_text(data, 400, 160), "tests/text-effects.png", resize=True)
        glyph = dict(data, glyphParticles={"source": "text", "count": 10, "emissionStart": 0, "timeScale": 1, "sizeScale": 1, "motionScale": 1, "rect": {"x": 0, "y": 0, "width": 1, "height": 1}})
        first = vn_visual_glyph_particles(glyph, 1, 400, 160)
        glyph["textEffects"] = {"outlineWidth": 12, "outlineColor": "#ffffff"}
        second = vn_visual_glyph_particles(glyph, 1, 400, 160)
        assert first != second

    def qa_text_clip():
        data = {"text": "文字", "fontSize": 72, "color": "#ffffff", "textClip": {"x": 0, "y": 0, "width": 0.5, "height": 1}}
        renpy.render_to_file(vn_visual_text(data, 400, 160), "tests/text-clip.png", resize=True)
        data["textClip"] = {"x": 0, "y": -2, "width": 1, "height": 1}
        surface = renpy.render_to_surface(vn_visual_text(data, 400, 160), 400, 160, resize=True)
        assert not any(surface.get_at((x, y))[3] for y in range(160) for x in range(400))
        glyph = dict(data, glyphParticles={"source": "text", "count": 10, "emissionStart": 0, "timeScale": 1, "sizeScale": 1, "motionScale": 1, "rect": {"x": 0, "y": 0, "width": 1, "height": 1}})
        assert not vn_visual_glyph_particles(glyph, 1, 400, 160)

    def qa_text_alignment():
        for horizontal, vertical in (("left", "top"), ("right", "bottom")):
            data = {"text": "文字", "fontSize": 32, "color": "#ffffff", "textAlign": horizontal, "textVerticalAlign": vertical}
            display = vn_visual_text(data, 400, 160)
            renpy.render_to_file(display, "tests/align-" + horizontal + ".png", resize=True)

    def qa_text_italic():
        for italic in (False, True):
            data = {"text": "I", "fontSize": 72, "color": "#ffffff", "textItalic": italic}
            renpy.render_to_file(vn_visual_text(data, 160, 120), "tests/italic-stem-" + str(italic) + ".png", resize=True)
            data["text"] = "1645 弘光元年"
            data["fontSize"] = 48
            renpy.render_to_file(vn_visual_text(data, 600, 120), "tests/italic-era-" + str(italic) + ".png", resize=True)

    def qa_hidden_dialogue():
        # The hidden screen retains transparent Text for native voice/skip handling.
        assert renpy.get_widget("say", "window") is None
        screen = renpy.get_screen("say")
        if screen is not None:
            surface = renpy.render_to_surface(screen, 160, 90, resize=True)
            width, height = surface.get_size()
            assert not any(surface.get_at((x, y))[3] for y in range(height) for x in range(width))

    def qa_text_chapter_binding():
${textChapterInputs}
        data = vn_prepare_visual(${textChapterExpression})
        children = data["children"][1]["children"]
        for value in ("春日新章", "江畔重逢"):
            bound = [item for item in children if item.get("text") == value]
            assert len(bound) == 2
            title = next(item for item in bound if item["content"] == "text")
            emitter = next(item for item in bound if item.get("glyphParticles"))
            assert title.get("fontPath", "fonts/SourceHanSansLite.ttf") == emitter.get("fontPath", "fonts/SourceHanSansLite.ttf")
            assert title["textAlign"] == emitter["textAlign"] == ("right" if value == "春日新章" else "center")
            assert title["textVerticalAlign"] == emitter["textVerticalAlign"] == ("bottom" if value == "春日新章" else "center")
            expected_effects = dict(outlineWidth=5, outlineColor="#00ff00", outlineOpacity=.4, shadowX=-8, shadowY=6, shadowBlur=0, shadowColor="#0000ff", shadowOpacity=.8) if value == "春日新章" else dict(outlineWidth=0, outlineColor="#000000", outlineOpacity=1, shadowX=0, shadowY=0, shadowBlur=0, shadowColor="#000000", shadowOpacity=.7)
            assert title["textEffects"] == emitter["textEffects"] == expected_effects, (value, title["textEffects"], emitter["textEffects"], expected_effects)
            assert title["fontSize"] == emitter["fontSize"]
            assert title["fontSize"] == (72 if value == "春日新章" else 24)
            assert title.get("fontPath", "fonts/SourceHanSansLite.ttf") == ("test-font.ttf" if value == "春日新章" else "fonts/SourceHanSansLite.ttf")
            assert len(vn_visual_glyph_particles(emitter, 3, config.screen_width, config.screen_height)) == 200
        display, delay = vn_visual_display(3, 3, data)
        renpy.render_to_file(display, "tests/chapter-text-binding.png", resize=True)

testsuite global:
    before testcase:
        $ _test.timeout = 30.0
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
    teardown:
        exit

testcase visual_objects:
    run Function(qa_visual_samples)
    run Function(qa_visual_fit)
    run Function(qa_static_text_updates)
    run Function(qa_visual_group)
    run Function(qa_visual_glyph)
    run Function(qa_text_glyph)
    run Function(qa_chapter_composition)
    run Function(qa_text_effects)
    run Function(qa_text_clip)
    run Function(qa_text_alignment)
    run Function(qa_text_italic)
    run Function(qa_text_chapter_binding)
    click id "vn_main_start"
    pause until "观察四秒对象演出。"
    pause .5
    assert eval renpy.showing("vn_visual_${title.instanceId}")
    assert eval renpy.showing("vn_visual_${particles.instanceId}")
    assert eval renpy.showing("vn_visual_${picture.instanceId}")
    screenshot "01-objects.png"
    pause 1.5
    screenshot "01b-dissolving.png"
    pause 2.5
    assert eval isinstance(vn_visual_display(4, 4, ${pythonLiteral(title)})[0], Null)
    assert eval isinstance(vn_visual_display(4, 4, ${pythonLiteral(particles)})[0], Null)
    screenshot "02-expired.png"
    $ qa_started = renpy.get_game_runtime()
    click pos (640, 500)
    pause .3
    run Function(qa_hidden_dialogue)
    assert eval renpy.showing("vn_visual_${reusable.instanceId}")
    screenshot "03-exposed-text.png"
    pause until "调用结束。"
    assert eval renpy.get_game_runtime() - qa_started >= 1.4
`);
const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 60000 });
await fs.writeFile(path.join(output, 'runtime.log'), result.log);
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: result.code === 0 ? 'checking-alignment' : 'failed', code: result.code }, null, 2));
console.log(output); console.log(result.log.slice(-4000)); assert.equal(result.code, 0);


function bounds(png: PNG) {
  let left=png.width, top=png.height, right=-1, bottom=-1;
  for(let y=0;y<png.height;y++) for(let x=0;x<png.width;x++) if(png.data[(y*png.width+x)*4+3]>32){ left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y); }
  assert.ok(right>=left);return {left,top,right,bottom};
}
const alignLeft=bounds(PNG.sync.read(await fs.readFile(path.join(game,'tests/align-left.png'))));
const alignRight=bounds(PNG.sync.read(await fs.readFile(path.join(game,'tests/align-right.png'))));
assert.ok(alignRight.left > alignLeft.right + 100, JSON.stringify({alignLeft,alignRight}));
assert.ok(alignRight.top > alignLeft.bottom + 40, JSON.stringify({alignLeft,alignRight}));
await fs.writeFile(path.join(output,'alignment.json'),JSON.stringify({alignLeft,alignRight},null,2));

const clipped = bounds(PNG.sync.read(await fs.readFile(path.join(game, 'tests/text-clip.png'))));
assert.ok(clipped.right < 200, JSON.stringify(clipped));
const effectsPng = PNG.sync.read(await fs.readFile(path.join(game, 'tests/text-effects.png')));
let red = 0, blue = 0;
for (let i = 0; i < effectsPng.data.length; i += 4) { const [r, g, b, a] = effectsPng.data.subarray(i, i + 4); if (a > 100 && r > 150 && g < 80 && b < 80) red++; if (a > 100 && b > 150 && r < 80 && g < 80) blue++; }
assert.ok(red > 100 && blue > 100, JSON.stringify({ red, blue }));
const italicStems = await Promise.all(['False', 'True'].map(async name => {
  const png = PNG.sync.read(await fs.readFile(path.join(game, `tests/italic-stem-${name}.png`))), box = bounds(png);
  const centerAt = (fraction: number) => {
    const y = Math.round(box.top + (box.bottom - box.top) * fraction), xs = [];
    for (let x = 0; x < png.width; x++) if (png.data[(y * png.width + x) * 4 + 3] > 64) xs.push(x);
    assert.ok(xs.length); return xs.reduce((sum, x) => sum + x, 0) / xs.length;
  };
  return { italic: name === 'True', box, lean: centerAt(.25) - centerAt(.75) };
}));
assert.ok(Math.abs(italicStems[0].lean) < 1);
assert.ok(italicStems[1].lean > 2 && italicStems[1].lean < 12, JSON.stringify(italicStems));
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', code: result.code, alignLeft, alignRight, red, blue, italicStems, italicGlyphCache: 'passed', italicArtworkCache: 'passed' }, null, 2));
