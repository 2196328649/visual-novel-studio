import { promises as fs } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createProject, projectSchema } from '../src/core/model';
import { buildProject, runRenpy } from '../src/runtime/service';
import { aihongGalleryGroups, type GallerySourceManifest } from './lib/aihong-gallery';

const root = path.resolve('.'), output = path.join(root, 'artifacts/aihong-gallery-page', new Date().toISOString().replaceAll(':', '-'));
const fixture = path.join(output, 'project'), game = path.join(output, 'game'), sdk = path.join(root, 'resources/runtime');
const source = path.join(root, 'artifacts/aihong-gallery-source'), templateDir = path.join(root, 'resources/templates/aihong');
const manifest: GallerySourceManifest = JSON.parse(await fs.readFile(path.join(source, 'manifest.json'), 'utf8'));
const template = projectSchema.parse(JSON.parse(await fs.readFile(path.join(templateDir, 'project.vns.json'), 'utf8')));
const project = createProject(); project.name = '原作图鉴第一页核对'; project.width = template.width; project.height = template.height;
project.ui = { ...project.ui, fontAssetId: template.ui.fontAssetId, pages: { gallery: { layout: 'custom' } }, components: structuredClone(template.ui.components.filter(c => c.page === 'gallery')) };
for (const c of project.ui.components) { delete c.events; delete c.visibleWhen; delete c.enabledWhen; delete c.selectedWhen; }
const imported = aihongGalleryGroups(manifest, {}, manifest.groups.slice(0, 8).map(group => group.id));
const gallery = project.ui.components.find(c => c.id === 'ai_gallery_items')!;
gallery.list = { ...gallery.list, assetIds: undefined, galleryGroups: manifest.groups.map((group, i) => imported.groups[i] ?? { id: group.id, name: group.name, assetIds: [] }), galleryPageButtonLimit: 12, galleryFit: 'cover', galleryShowControls: false };
// Only page one and its first group are under test. Later pages intentionally
// contain empty groups; no unresolved candidate is selected or shipped.
const references = new Set<string>();
const visit = (value: unknown) => { if (typeof value === 'string') references.add(value); else if (value && typeof value === 'object') Object.values(value).forEach(visit); };
visit(project.ui);
project.assets = [...template.assets.filter(asset => references.has(asset.id)), ...imported.assets];
await fs.mkdir(path.join(fixture, 'assets'), { recursive: true });
for (const asset of project.assets) {
  const from = path.join(imported.assets.some(item => item.id === asset.id) ? source : templateDir, asset.path);
  const to = path.join(fixture, asset.path); await fs.mkdir(path.dirname(to), { recursive: true }); await fs.link(from, to);
}
await fs.writeFile(path.join(fixture, 'project.vns.json'), JSON.stringify(projectSchema.parse(project), null, 2));
const built = await buildProject({ project, projectDir: fixture, outputDir: game, sdkRoot: sdk, development: true }); assert.ok(built.ok, built.log);
const first = imported.groups[0];
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
testcase gallery_page_one:
    pause 1
    $ persistent.vn_unlocks = ${JSON.stringify(imported.groups.flatMap(group => group.assetIds))}
    run ShowMenu("gallery")
    move pos (8, 8)
    pause .2
    assert eval renpy.get_widget("gallery", "vn_component_ai_gallery_items_page_11") is not None
    assert eval renpy.get_widget("gallery", "vn_component_ai_gallery_items_page_0").vn_bounds == (84, 67)
    assert eval renpy.get_widget("gallery", "vn_gallery_thumb_${first.id}").vn_state == "idle"
    screenshot "page-01.png"
    move id "vn_gallery_${first.id}"
    pause .2
    assert eval renpy.get_widget("gallery", "vn_gallery_thumb_${first.id}").vn_state == "hover"
    screenshot "hover-first-card.png"
    click id "vn_gallery_${first.id}"
    move pos (8, 8)
    assert eval len(renpy.get_screen("vn_gallery_image").scope["paths"]) == 5
    screenshot "group-01-variant-01.png"
    click id "vn_gallery_advance"
    move pos (8, 8)
    screenshot "group-01-variant-02.png"
    click id "vn_gallery_advance"
    move pos (8, 8)
    screenshot "group-01-variant-03.png"
`);
const run = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 90000 });
await fs.writeFile(path.join(output, 'runtime.log'), run.log); assert.equal(run.code, 0, run.log);
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', sourceManifest: path.join(source, 'manifest.json'), checkedGroups: imported.groups.map(g => ({ id: g.id, variants: g.assetIds.length })), checks: ['第一页8组按原作清单顺序、独立缩略图、12个页码', '首组5分镜；保存前3张用于原作对照', '原图采用居中裁切铺满；隐藏详情按钮'], limitation: '第9组以后仅为保持页数的空测试组；八处重名路径未选择候选。未同步正式模板，未证明原作末项点击及返回行为等价。' }, null, 2));
console.log(output);
