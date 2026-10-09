import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createProject, projectSchema } from '../src/core/model';
import { resolveUiHierarchy } from '../src/core/ui-hierarchy';
import { uiComponentBounds } from '../src/core/ui';
import { assetSourcePath } from '../src/desktop/project-store';
import { buildProject, runRenpy } from '../src/runtime/service';

const root = path.resolve('.');
const source = path.resolve(process.env.VNS_AUTHOR_PROJECT ?? 'E:/Project/Visual Novel Studio/我的视觉小说1/project.vns.json');
const original = await fs.readFile(source);
const author = projectSchema.parse(JSON.parse(original.toString()));
const sourceSha256 = createHash('sha256').update(original).digest('hex');
const output = path.resolve(process.env.VNS_UI_VERIFY_OUTPUT ?? path.join('artifacts/ui-preview-runtime', new Date().toISOString().replaceAll(':', '-')));
const seed = createProject('UI image geometry verification');
seed.width = author.width; seed.height = author.height;
seed.ui.background = '#363636';
seed.ui.pages = { main: { layout: 'custom', background: '#363636' } };
const button = author.ui.components.find(c => c.page === 'main' && c.kind === 'button' && c.action === 'start');
assert.ok(button);
const ids = new Set([button.id]);
for (let changed = true; changed;) {
  changed = false;
  for (const c of author.ui.components) if (c.parentId && ids.has(c.parentId) && !ids.has(c.id)) { ids.add(c.id); changed = true; }
}
seed.ui.components = structuredClone(author.ui.components.filter(c => ids.has(c.id)));
seed.ui.components[0].action = undefined;
const references = JSON.stringify(seed.ui);
seed.assets = author.assets.filter(a => references.includes(a.id)).map(a => ({ ...a, externalPath: assetSourcePath(path.dirname(source), a) }));
const project = projectSchema.parse(seed);
await fs.mkdir(output, { recursive: true });
await fs.writeFile(path.join(output, 'project.vns.json'), JSON.stringify(project, null, 2));
const bounds = resolveUiHierarchy(project.ui.components).map(row => ({ id: row.component.id, rect: uiComponentBounds(row.component, project.width, project.height) }));
const expected = bounds.map(({id, rect}) => {
  const parentId = project.ui.components.find(c => c.id === id)?.parentId;
  const parent = bounds.find(b => b.id === parentId)?.rect;
  return { id, ...rect, localX: rect.x - (parent?.x ?? 0), localY: rect.y - (parent?.y ?? 0) };
});
await fs.writeFile(path.join(output, 'editor-geometry.json'), JSON.stringify({ source, sourceSha256, bounds }, null, 2));
const game = path.join(output, 'game');
const sdk = path.join(root, 'resources/runtime');
const built = await buildProject({ project, projectDir: path.dirname(source), outputDir: game, sdkRoot: sdk, development: true });
await fs.writeFile(path.join(output, 'build.json'), JSON.stringify(built, null, 2));
assert.ok(built.ok, JSON.stringify(built));
await fs.writeFile(path.join(game, 'game/testcases.rpy'), `
init -999 python:
    import renpy as _qa_engine
    _qa_engine.safe_mode_checked = True
init python:
    import json as qa_json
    def qa_verify_geometry():
        for row in ${JSON.stringify(expected)}:
            identity = row["id"]
            assert vn_ui_position(identity, "x") == row["localX"], (identity, "x", row)
            assert vn_ui_position(identity, "y") == row["localY"], (identity, "y", row)
            widget = renpy.get_widget("main_menu", "vn_component_" + identity)
            assert widget is not None, identity
            if isinstance(widget, VnSkinButton):
                frames = []
                renpy.get_screen("main_menu").child.visit_all(lambda d: frames.append(d) if type(d).__name__ == "Window" and widget in d.children else None)
                assert len(frames) == 1, (identity, frames)
                widget = frames[0]
            placement = widget.get_placement()
            assert placement[0] == row["localX"] and placement[1] == row["localY"], (identity, placement, row)
        surfaces = []
        for asset in ${JSON.stringify(project.assets.filter(a => a.kind === 'image').map(a => a.path.replaceAll('\\', '/')))}:
            for fit in ("contain", "cover", "stretch"):
                for state in ("idle", "hover", "pressed", "selected", "disabled"):
                    for width, height in ((290, 163), (130, 250), (310, 174)):
                        surface = vn_ui_surface(dict(idle=asset, fit=fit), state, width, height, "#00000000")
                        render = renpy.render(surface, width, height, 0, 0)
                        assert render.get_size() == (width, height), (asset, fit, state, render.get_size())
                        if fit in ("contain", "cover"):
                            found = []
                            surface.visit_all(lambda d: found.append(d) if type(d).__name__ == "MultiBox" else None)
                            box = found[0]
                            child_render = renpy.render(box.children[0], width, height, 0, 0)
                            child_w, child_h = child_render.get_size()
                            renpy.render(box, width, height, 0, 0)
                            dx, dy = box.offsets[0]
                            assert abs(dx - (width - child_w) / 2.0) < 0.6 and abs(dy - (height - child_h) / 2.0) < 0.6, (fit, state, (dx, dy), (child_w, child_h))
                        surfaces.append(dict(asset=asset, fit=fit, state=state, size=(width, height)))
        with open(renpy.config.basedir + "/surface-checks.json", "w", encoding="utf-8") as file:
            qa_json.dump(surfaces, file, indent=2)
    def qa_dump():
        result = []
        for identity in ${JSON.stringify([...ids])}:
            widget = renpy.get_widget("main_menu", "vn_component_" + identity)
            rows = []
            def visit(d):
                r = renpy.render(d, ${project.width}, ${project.height}, 0, 0)
                rows.append(dict(type=type(d).__name__, size=r.get_size(), offsets=getattr(d, "offsets", None), placement=[str(v) for v in d.get_placement()]))
            widget.visit_all(visit)
            result.append(dict(id=identity, rows=rows))
        with open(renpy.config.basedir + "/geometry.json", "w", encoding="utf-8") as file:
            qa_json.dump(result, file, indent=2)

testsuite global:
    before testcase:
        $ _test.timeout = 15.0
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit

testcase geometry:
    pause until screen "main_menu"
    move pos (8, 8)
    pause 0.3
    screenshot "01-idle.png"
    $ qa_verify_geometry()
    $ qa_dump()
`);
const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 120000, env: { SDL_VIDEO_WINDOW_POS: '2400,0' } });
await fs.writeFile(path.join(output, 'runtime.log'), result.log);
assert.ok((await fs.readFile(source)).equals(original), 'Author project changed during verification');
const passed = result.code === 0 && /Test cases\s*:\s*1\s*\|\s*1 passed/.test(result.log);
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: passed ? 'passed' : 'failed', source, sourceSha256, bounds, expected, surfaceChecks: passed ? JSON.parse(await fs.readFile(path.join(game, 'surface-checks.json'), 'utf8')).length : 0, code: result.code }, null, 2));
console.log(output);
assert.ok(passed, result.log.slice(-6000));
