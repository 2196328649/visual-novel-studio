import { promises as fs } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { buildProject, runRenpy } from '../src/runtime/service';
import { createGalleryFixture } from './lib/gallery-fixture';

const root = path.resolve('.'), output = path.join(root, 'artifacts/gallery-pages', new Date().toISOString().replaceAll(':', '-'));
const fixture = path.join(output, 'project'), game = path.join(output, 'game'), sdk = path.join(root, 'resources/runtime');
const project = await createGalleryFixture(fixture);
const result = await buildProject({ project, projectDir: fixture, outputDir: game, sdkRoot: sdk, development: true }); assert.ok(result.ok, result.log);
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
testcase gallery_groups:
    pause 1
    $ persistent.vn_unlocks = ["full_a", "full_c"]
    run ShowMenu("gallery")
    pause .2
    assert eval renpy.get_widget("gallery", "vn_gallery_group_0").is_sensitive()
    assert eval not renpy.get_widget("gallery", "vn_gallery_group_1").is_sensitive()
    assert eval renpy.get_widget("gallery", "vn_component_test_gallery_page_11") is not None
    screenshot "page-one.png"
    click id "vn_gallery_group_0"
    assert screen "vn_gallery_image"
    assert eval renpy.get_screen("vn_gallery_image").scope["paths"] == ["assets/full_c.png", "assets/full_a.png"]
    assert eval renpy.get_screen("vn_gallery_image").scope["active_variant"] == 0
    assert eval renpy.get_widget("vn_gallery_image", "vn_gallery_close") is None
    screenshot "first-variant-cover.png"
    click id "vn_gallery_advance"
    assert eval renpy.get_screen("vn_gallery_image").scope["active_variant"] == 1
    screenshot "second-variant.png"
    click id "vn_gallery_advance"
    assert not screen "vn_gallery_image"
    click id "vn_component_test_gallery_page_11"
    assert eval renpy.get_widget("gallery", "vn_gallery_group_88") is not None
    assert eval renpy.get_widget("gallery", "vn_gallery_group_93") is not None
    assert eval renpy.get_widget("gallery", "vn_gallery_group_0") is None
    assert eval renpy.get_widget("gallery", "vn_component_test_gallery_page_11").is_selected()
    screenshot "page-twelve.png"
    click id "vn_gallery_group_93"
    click id "vn_gallery_advance"
    assert not screen "vn_gallery_image"
    assert eval renpy.get_widget("gallery", "vn_gallery_group_93") is not None
    click id "vn_gallery_group_93"
    keysym "K_ESCAPE"
    assert not screen "vn_gallery_image"
    assert eval renpy.get_widget("gallery", "vn_component_test_gallery_page_11").is_selected()
    click id "vn_component_test_gallery_page_0"
    python:
        persistent.vn_unlocks.append("full_b")
        renpy.restart_interaction()
    pause .1
    assert eval renpy.get_widget("gallery", "vn_gallery_group_1").is_sensitive()
    click id "vn_gallery_group_0"
    assert eval renpy.get_screen("vn_gallery_image").scope["paths"] == ["assets/full_c.png", "assets/full_a.png", "assets/full_b.png"]
    assert eval renpy.get_screen("vn_gallery_image").scope["active_variant"] == 0
    keysym "K_ESCAPE"
    run Show("vn_gallery_image", asset_paths=["assets/full_a.png", "assets/full_c.png"], fit="contain", end_action="loop", show_controls=True)
    click id "vn_gallery_next"
    assert eval renpy.get_screen("vn_gallery_image").scope["active_variant"] == 1
    click id "vn_gallery_next"
    assert eval renpy.get_screen("vn_gallery_image").scope["active_variant"] == 0
    keysym "K_RIGHT"
    assert eval renpy.get_screen("vn_gallery_image").scope["active_variant"] == 1
    click id "vn_gallery_previous"
    assert eval renpy.get_screen("vn_gallery_image").scope["active_variant"] == 0
    screenshot "controls-contain.png"
    click id "vn_gallery_close"
    run Show("vn_gallery_image", asset_path="assets/full_b.png")
    assert eval renpy.get_screen("vn_gallery_image").scope["paths"] == ["assets/full_b.png"]
    click id "vn_gallery_advance"
    assert not screen "vn_gallery_image"
`);
const run = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 90000 });
await fs.writeFile(path.join(output, 'runtime.log'), run.log); assert.equal(run.code, 0, run.log);
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', fixture, checks: ['94组共12页，首末页条目与当前页选中态', '独立缩略图与部分解锁；详情只按作者顺序展示已解锁分镜', '末张返回、Esc返回保持页码、重入从第一张开始', '新增解锁即时生效', '循环/上一张/方向键/关闭控制', '平面图鉴详情参数兼容'], limitation: '合成图像隔离数据验证；原作末项点击和八处重名资源仍待确认。' }, null, 2));
console.log(output);
