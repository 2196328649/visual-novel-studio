import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { createProject, type BlueprintNode, type VariableValue } from '../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { createUiEventGraph, ensureUiClickEvent } from '../src/core/ui-logic';
import { projectForExport } from '../src/core/export-assets';
import { buildProject, runRenpy } from '../src/runtime/service';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runDir = path.join(root, 'artifacts', 'blueprint-ui-runtime', new Date().toISOString().replaceAll(':', '-'));
const sourceDir = path.join(runDir, 'source'), outputDir = path.join(runDir, 'game');
const sdk = process.env.VNS_RENPY_SDK ?? 'E:/Tools/renpy-8.5.3-sdk';
const report: { status: string; steps: { name: string; code: number; logPath: string }[]; error?: string; outputDir: string } = { status: 'running', steps: [], outputDir };
const saveReport = () => fs.writeFile(path.join(runDir, 'report.json'), JSON.stringify(report, null, 2));
async function step(name: string, result: { code: number; log: string }) {
  const logPath = path.join(runDir, name + '.log'); await fs.writeFile(logPath, result.log);
  report.steps.push({ name, code: result.code, logPath }); await saveReport(); console.log(name + ': ' + result.code);
  if (result.code) throw new Error(name + ': ' + result.log.slice(-5000));
}
async function main() {
  await fs.mkdir(path.join(sourceDir, 'assets'), { recursive: true }); await saveReport();
  const p = createProject(); p.id = 'blueprint_ui_verification'; p.name = '蓝图与界面验收';
  p.ui.disabledPages = ['gallery'];
  for (const [id, width, height, rgb] of [['first', 48, 96, [244, 112, 90]], ['second', 240, 80, [58, 142, 228]]] as const) {
    const png = new PNG({ width, height });
    for (let i = 0; i < png.data.length; i += 4) { png.data[i] = rgb[0]; png.data[i + 1] = rgb[1]; png.data[i + 2] = rgb[2]; png.data[i + 3] = 255; }
    await fs.writeFile(path.join(sourceDir, 'assets', id + '.png'), PNG.sync.write(png));
    p.assets.push({ id, name: id, kind: 'image', path: 'assets/' + id + '.png', width, height });
  }
  const page = { id: 'properties', name: '图片与文字', modal: true, background: '#182124', components: [
    { id: 'picture', page: 'custom' as const, kind: 'image' as const, text: '', assetId: 'first', x: .08, y: .12, width: .48, height: .48 },
    { id: 'caption', page: 'custom' as const, kind: 'text' as const, text: '初始文字', x: .58, y: .18, width: .36, height: .2, style: { fontSize: 28, textColor: '#ffffff', outlineWidth: 1, outlineColor: '#000000', shadowX: -2, shadowY: 3 } },
    ...['switch', 'reset', 'clear', 'toggle', 'close'].map((id, i) => ({ id, page: 'custom' as const, kind: 'button' as const, text: ['切换', '重置图片', '清空图片', '显示取反', '关闭'][i], x: .05 + i * .19, y: .78, width: .17, height: .08 })),
  ] };
  p.ui.customPages.push(page);
  const graph = createUiEventGraph(p, page.id, '属性事件');
  const append = (previous: BlueprintNode, type: BlueprintNode['type'], properties: Record<string, VariableValue>) => {
    const n = blueprintNodeDefaults(type); n.properties = properties; graph.nodes.push(n); synchronizeBlueprintSignatures(p);
    const error = connectBlueprintPins(graph, previous.id, previous.type === 'eventClick' ? 'exec' : 'exec_out', n.id, 'exec_in'); if (error) throw new Error(error); return n;
  };
  let next = ensureUiClickEvent(p, graph, 'switch', page.id);
  for (const [componentId, property, value] of [['picture', 'image', 'second'], ['picture', 'imageFit', 'cover'], ['picture', 'opacity', .7], ['caption', 'text', '属性修改已生效'], ['caption', 'textColor', '#87deaa'], ['caption', 'fontSize', 42], ['switch', 'idleImage', 'second']] as const) next = append(next, 'setUiProperty', { componentId, property, value });
  append(ensureUiClickEvent(p, graph, 'reset', page.id), 'resetUiProperty', { componentId: 'picture', property: 'image' });
  append(ensureUiClickEvent(p, graph, 'clear', page.id), 'setUiProperty', { componentId: 'picture', property: 'image', value: '' });
  append(ensureUiClickEvent(p, graph, 'close', page.id), 'closeUiPage', { pageId: page.id, result: '完成' });
  const toggle = append(ensureUiClickEvent(p, graph, 'toggle', page.id), 'setUiProperty', { componentId: 'picture', property: 'visible', value: false });
  const read = blueprintNodeDefaults('getUiProperty'), not = blueprintNodeDefaults('not'); read.properties = { componentId: 'picture', property: 'visible' };
  graph.nodes.push(read, not); connectBlueprintPins(graph, read.id, 'value', not.id, 'a'); connectBlueprintPins(graph, not.id, 'result', toggle.id, 'value');
  const open = createBlueprintGraph('function', '打开属性页面'), show = blueprintNodeDefaults('showUiPage'); show.properties = { pageId: page.id, wait: true }; open.nodes.push(show); connectBlueprintPins(open, open.nodes[0].id, 'exec', show.id, 'exec_in'); p.blueprints.push(open);
  const passage = p.nodes.find(n => n.kind === 'passage')!; if (passage.kind !== 'passage') throw new Error('Missing passage');
  passage.lines[0].text = '页面关闭后剧情继续。'; passage.lines[0].actions = [{ kind: 'blueprint', blueprintId: open.id }];
  synchronizeBlueprintSignatures(p);
  if (!projectForExport(p).assets.some(a => a.id === 'second')) throw new Error('Blueprint-only asset was omitted from export selection');
  await fs.writeFile(path.join(sourceDir, 'project.vns.json'), JSON.stringify(p, null, 2));
  const built = await buildProject({ project: p, projectDir: sourceDir, sdkRoot: sdk, outputDir, development: true });
  await step('compile', { code: built.ok ? 0 : 1, log: built.log + '\n' + JSON.stringify(built.diagnostics) });
  await fs.writeFile(path.join(outputDir, 'game', 'testcases.rpy'), `testsuite global:
    before testcase:
        $ _test.timeout = 12.0
        $ _test.transition_timeout = 0.05
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
    teardown:
        exit

testcase image_properties_and_logic:
    click id "vn_main_start"
    pause until eval ("properties" in vn_ui_open_pages)
    assert eval (renpy.get_screen("vn_blueprint_pages") is not None)
    assert eval (vn_ui_get("picture", "image") == "first")
    assert eval (vn_ui_default("picture", "opacity") == 1)
    screenshot "properties-before.png"
    click id "vn_component_switch"
    assert eval (vn_ui_get("picture", "image") == "second")
    assert eval (vn_ui_get("picture", "imageFit") == "cover")
    assert eval (vn_ui_get("picture", "opacity") == .7)
    assert eval (vn_ui_get("caption", "textColor") == "#87deaa")
    assert eval (vn_ui_get("caption", "fontSize") == 42)
    assert eval (vn_ui_default("caption", "fontSize") == 28)
    assert eval (vn_ui_get("switch", "idleImage") == "second")
    screenshot "properties-after.png"
    click id "vn_component_reset"
    assert eval (vn_ui_get("picture", "image") == "first")
    assert eval (vn_ui_get("picture", "opacity") == .7)
    click id "vn_component_clear"
    assert eval (vn_ui_get("picture", "image") == "")
    screenshot "properties-cleared.png"
    click id "vn_component_toggle"
    assert eval (vn_ui_get("picture", "visible") is False)
    click id "vn_component_toggle"
    assert eval (vn_ui_get("picture", "visible") is True)
    click id "vn_component_close"
    pause until "页面关闭后剧情继续。"
    assert eval ("properties" not in vn_ui_open_pages)
    run FileSave("property_values", confirm=False, slot=True)
    run MainMenu(confirm=False)
    pause until screen "main_menu"
    run FileLoad("property_values", confirm=False, slot=True)
    pause until "页面关闭后剧情继续。"
    run MainMenu(confirm=False)
    pause until screen "main_menu"
`);
  await step('lint', await runRenpy(sdk, outputDir, ['lint'], { savedir: path.join(runDir, 'saves'), timeoutMs: 60000 }));
  const tested = await runRenpy(sdk, outputDir, ['test', '--report-detailed', '--report-skipped'], { savedir: path.join(runDir, 'saves'), timeoutMs: 120000, onData: text => process.stdout.write(text) });
  await step('runtime', tested);
  if (!/Test cases\s*:\s*1\s*\|\s*1 passed/.test(tested.log)) throw new Error('Native test did not report success');
  report.status = 'passed'; await saveReport(); console.log('Report: ' + path.join(runDir, 'report.json'));
}
try { await main(); } catch (error) { report.status = 'failed'; report.error = String(error); await saveReport(); console.error(error); process.exitCode = 1; }
