import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { createProject } from '../src/core/model';
import { blueprintNodeDefaults, blueprintPin, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { addTimelineComponent } from '../src/core/timeline-component';
import { insertTimelineAction } from '../src/core/performance-timeline';
import { exposePerformanceInputs, performanceInputs } from '../src/core/blueprint-authoring';
import { buildProject, runRenpy } from '../src/runtime/service';

const root = path.resolve('.'), output = path.join(root, 'artifacts/timeline-component-runtime', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const project = createProject('时间轴组件原生验收');
for (const [id, color] of [['default_image', [220, 40, 40]], ['override_image', [40, 70, 220]]] as const) {
  const png = new PNG({ width: 16, height: 16 });
  for (let i = 0; i < png.data.length; i += 4) { png.data[i] = color[0]; png.data[i + 1] = color[1]; png.data[i + 2] = color[2]; png.data[i + 3] = 255; }
  await fs.writeFile(path.join(output, id + '.png'), PNG.sync.write(png));
  project.assets.push({ id, name: id, kind: 'image', category: 'scene', path: id + '.png' });
}
const owner = createBlueprintGraph('effect', '素材参数演出'); project.blueprints.push(owner);
owner.exposedInputs.push(blueprintPin('picture', '素材', 'input', 'asset', ''));
const { timeline, node } = addTimelineComponent(project, owner.id);
const clip = insertTimelineAction(project, timeline, { kind: 'background', assetId: 'default_image', transition: 'none', wait: false }, .25);
exposePerformanceInputs(timeline, [performanceInputs(timeline).find(input => input.nodeId === clip && input.pinId === 'assetId')!]);
const read = blueprintNodeDefaults('getInput'); read.properties.inputId = 'picture'; owner.nodes.push(read);
synchronizeBlueprintSignatures(project);
assert.equal(connectBlueprintPins(owner, read.id, 'value', node.id, 'arg_' + timeline.exposedInputs[0].id), undefined);
const passage = project.nodes.find(node => node.kind === 'passage')!;
passage.lines = [
  { id: 'default_line', text: '默认素材', actions: [{ kind: 'blueprint', blueprintId: owner.id }] },
  { id: 'override_line', text: '传入素材', actions: [{ kind: 'blueprint', blueprintId: owner.id, inputs: { picture: 'override_image' } }] },
  { id: 'empty_line', text: '空值回退', actions: [{ kind: 'blueprint', blueprintId: owner.id, inputs: { picture: '' } }] },
];
project.entryId = passage.id;
const game = path.join(output, 'game'), sdk = path.join(root, 'resources/runtime');
const built = await buildProject({ project, projectDir: output, outputDir: game, sdkRoot: sdk });
assert.ok(built.ok, JSON.stringify(built.diagnostics));
await fs.mkdir(path.join(game, 'tests'), { recursive: true });
await fs.writeFile(path.join(game, 'game/testcases.rpy'), `
testsuite global:
    before testcase:
        $ _test.timeout = 15.0
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
    teardown:
        exit

testcase timeline_component:
    click id "vn_main_start"
    pause until "默认素材"
    assert eval renpy.showing("vn_background_default_image")
    screenshot "default.png"
    click pos (640, 500)
    pause until "传入素材"
    assert eval renpy.showing("vn_background_override_image")
    screenshot "override.png"
    click pos (640, 500)
    pause until "空值回退"
    assert eval renpy.showing("vn_background_default_image")
    screenshot "fallback.png"
`);
const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), timeoutMs: 60000 });
await fs.writeFile(path.join(output, 'runtime.log'), result.log);
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: result.code === 0 ? 'passed' : 'failed', code: result.code, checks: ['编译并实际执行蓝图中的时间轴组件', '未传入使用默认图片', '父蓝图素材输入经数据线覆盖', '显式空素材回退到组件默认图片'] }, null, 2));
console.log(output); console.log(result.log.slice(-3000)); assert.equal(result.code, 0);
