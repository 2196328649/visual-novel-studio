import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { projectSchema } from '../src/core/model';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { pythonLiteral } from '../src/runtime/literals';
import { buildProject, runRenpy } from '../src/runtime/service';

assert.ok(process.argv[2], 'Pass the saved chapter-entry-presets fixture directory.');
const root = path.resolve('.'), source = path.resolve(process.argv[2]);
const output = path.join(root, 'artifacts/chapter-entry-runtime', new Date().toISOString().replaceAll(':', '-'));
const game = path.join(output, 'game'), sdk = path.join(root, 'resources/runtime');
await fs.mkdir(output, { recursive: true });
const project = projectSchema.parse(JSON.parse(await fs.readFile(path.join(source, 'project.vns.json'), 'utf8')));
project.playerDefaults = { ...project.playerDefaults, masterVolume: 0, textSpeed: 0 };
const textId = 'builtin_chapter_text', imageId = 'builtin_chapter_image';
const visual = (id: string) => {
  const action = expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: id }], previewActionContext(project)).find(action => action.kind === 'visual');
  assert.ok(action?.kind === 'visual'); return action;
};
const text = visual(textId), image = visual(imageId);
assert.match(JSON.stringify(text), /第三章 · 可直接修改/); assert.match(JSON.stringify(text), /故城重逢/);
const node = (id: string) => ({ id, name: id, sceneId: project.scenes[0].id, x: 0, y: 0 });
project.entryId = 'verify_text'; delete project.scriptText;
project.nodes = [
  { ...node('verify_text'), kind: 'passage', next: 'after_text', lines: [{ id: 'verify_text_line', text: '', silent: true, actions: [{ kind: 'blueprint', blueprintId: textId }] }] },
  { ...node('after_text'), kind: 'passage', next: 'verify_image', lines: [{ id: 'after_text_line', text: '文字章节结束。', actions: [] }] },
  { ...node('verify_image'), kind: 'passage', next: 'after_image', lines: [{ id: 'verify_image_line', text: '', silent: true, actions: [{ kind: 'blueprint', blueprintId: imageId }] }] },
  { ...node('after_image'), kind: 'passage', next: 'verify_end', lines: [{ id: 'after_image_line', text: '图片章节结束。', actions: [] }] },
  { ...node('verify_end'), kind: 'end' },
];
try {
  const built = await buildProject({ project, projectDir: source, outputDir: game, sdkRoot: sdk });
  assert.ok(built.ok, JSON.stringify(built.diagnostics) + built.log);
  await fs.writeFile(path.join(game, 'game/testcases.rpy'), `
init -999 python:
    import renpy as _engine
    _engine.safe_mode_checked = True

init 999 python:
    qa_chapter_objects = {}
    qa_original_show_visual = vn_show_visual
    def qa_show_visual(data):
        qa_chapter_objects[data["instanceId"]] = vn_prepare_visual(vn_visual_copy.deepcopy(data))
        return qa_original_show_visual(data)
    vn_show_visual = qa_show_visual
    def qa_chapter_walk(data):
        return [data] + [nested for child in data.get("children", []) for nested in qa_chapter_walk(child)]
    def qa_visible_particles(instance, time):
        return [p for child in qa_chapter_walk(qa_chapter_objects[instance]) if child.get("glyphParticles")
            for p in vn_visual_glyph_particles(child, time, config.screen_width, config.screen_height)
            if p["opacity"] > 0 and p["size"] > 0]

testsuite global:
    before testcase:
        $ _test.timeout = 20.0
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
        $ preferences.afm_enable = False
    teardown:
        exit

testcase saved_chapter_entries:
    assert eval list(vn_default_font.segment("第三章 · café")) == [("fonts/SourceHanSansLite.ttf", "第三章 "), ("DejaVuSans.ttf", "· "), ("fonts/SourceHanSansLite.ttf", "caf"), ("DejaVuSans.ttf", "é")]
    click id "vn_main_start"
    pause .8
    assert eval vn_current_node == "verify_text" and vn_performance_active
    assert eval renpy.showing(${pythonLiteral('vn_visual_' + text.instanceId)})
    assert eval any(child.get("content") == "text" and child["text"] == "第三章 · 可直接修改" for child in qa_chapter_walk(qa_chapter_objects[${pythonLiteral(text.instanceId)}]))
    assert eval any(child.get("content") == "text" and child["text"] == "故城重逢" for child in qa_chapter_walk(qa_chapter_objects[${pythonLiteral(text.instanceId)}]))
    assert eval any(child.get("glyphParticles", {}).get("source") == "text" and child["text"] == "第三章 · 可直接修改" for child in qa_chapter_walk(qa_chapter_objects[${pythonLiteral(text.instanceId)}]))
    screenshot "01-edited-text-title.png"
    pause 2.2
    assert eval bool(qa_visible_particles(${pythonLiteral(text.instanceId)}, 3.0))
    assert eval any(child.get("curves", {}).get("dissolveStrength") for child in qa_chapter_walk(qa_chapter_objects[${pythonLiteral(text.instanceId)}]))
    screenshot "02-text-dissolve-particles.png"
    pause until "文字章节结束。"
    assert eval not vn_performance_active
    assert eval not renpy.showing(${pythonLiteral('vn_visual_' + text.instanceId)})
    click pos (700, 80)
    pause .8
    assert eval vn_current_node == "verify_image" and vn_performance_active
    assert eval renpy.showing(${pythonLiteral('vn_visual_' + image.instanceId)})
    assert eval any(child.get("content") == "image" and child.get("assetId") == "title_image" for child in qa_chapter_walk(qa_chapter_objects[${pythonLiteral(image.instanceId)}]))
    screenshot "03-image-title.png"
    pause 2.2
    assert eval bool(qa_visible_particles(${pythonLiteral(image.instanceId)}, 3.0))
    screenshot "04-image-dissolve-particles.png"
    pause until "图片章节结束。"
    assert eval not vn_performance_active
    assert eval not renpy.showing(${pythonLiteral('vn_visual_' + image.instanceId)})
    screenshot "05-finished.png"
`);
  const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 90000, env: { RENPY_RENDERER: 'gl2', SDL_VIDEO_WINDOW_POS: '2400,0' } });
  await fs.writeFile(path.join(output, 'runtime.log'), result.log); assert.equal(result.code, 0, result.log.slice(-5000));
  assert.match(result.log, /Test cases\s*:\s*1\s*\|\s*1 passed/);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', source, checks: [
    '保存后外层章节标题、副标题传入实际文字和字形粒子。',
    '文字与图片两种普通时间轴在原生运行时显示、消散、产生可见粒子，并正常结束。',
    '文字版本无需制作题图，图片版本使用原有素材。',
  ] }, null, 2));
  console.log(output);
} catch (error) {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', source, error: String(error) }, null, 2)); console.log(output); throw error;
}
