import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { createProject, type BlueprintGraph, type BlueprintNode, type UiComponent, type VariableValue } from '../../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../../src/core/blueprint';
import { createUiEventGraph, ensureUiClickEvent, ensureUiImageEvent } from '../../src/core/ui-logic';
import type { UiProperty } from '../../src/core/ui-properties';

/** Shared authored project, not a mock renderer or a second gameplay model. */
export function createUiImageFixture() {
  const project = createProject('普通图片属性与加载事件'); project.id = 'ui_image_fixture'; project.width = 1280; project.height = 720;
  for (const [id, initial] of Object.entries({ image_loaded: 0, image_failed: 0, image_event_width: 0, image_event_height: 0, image_event_error: '', image_status: '', image_error: '', image_width: 0, image_height: 0, image_job_done: false })) project.variables.push({ id, name: id, type: typeof initial as 'number' | 'string' | 'boolean', initial, persistent: false });
  project.assets.push(...(['a', 'b', 'broken'] as const).map(name => ({ id: 'picture_' + name, name: '图片 ' + name, kind: 'image' as const, path: 'assets/picture-' + name + '.png', width: 64, height: 32 })));
  const actions = [['effects', '应用图片效果'], ['contain', '完整显示'], ['cover', '裁切铺满'], ['stretch', '拉伸铺满'], ['nineSlice', '九宫格'], ['swap', '切换图片'], ['clear', '清空图片'], ['restore', '恢复普通图片'], ['reset', '重置图片控件'], ['fail', '加载损坏图片'], ['observe', '读取图片状态'], ['background', '后台换图'], ['child', '打开子页'], ['native', '打开模板'], ['close', '关闭图片页']] as const;
  const components: UiComponent[] = [
    { id: 'picture', page: 'custom', kind: 'image', text: '', name: '被测图片', assetId: 'picture_a', x: .04, y: .04, width: .42, height: .33, skin: { borders: { left: 8, right: 8, top: 6, bottom: 6 } }, style: { imageFit: 'contain' } },
    { id: 'picture_parent', page: 'custom', kind: 'button', text: '状态继承', x: .55, y: .04, width: .4, height: .33, skin: { hideText: true } },
    { id: 'picture_state', parentId: 'picture_parent', childLayer: 'foreground', inheritState: true, page: 'custom', kind: 'image', text: '', assetId: 'picture_a', skin: { hover: 'picture_b', disabled: 'picture_b' }, x: .1, y: .1, width: .8, height: .8 },
    ...actions.map(([id, text], i): UiComponent => ({ id: 'image_action_' + id.toLowerCase(), page: 'custom', kind: 'button', text, x: .025 + i % 4 * .245, y: .43 + Math.floor(i / 4) * .13, width: .23, height: .095, style: { fontSize: 22 }, ...(id === 'close' ? { action: 'return' as const } : {}) })),
  ];
  const page = { id: 'image_page', name: '普通图片', modal: true, background: '#263847', components };
  const child = { id: 'image_child', name: '图片子页', modal: true, background: '#173329', components: [
    { id: 'picture_child', page: 'custom', kind: 'image', text: '', assetId: 'picture_b', x: .2, y: .16, width: .6, height: .35 },
    { id: 'image_child_close', page: 'custom', kind: 'button', text: '关闭图片子页', action: 'return', x: .35, y: .7, width: .3, height: .1 },
  ] as UiComponent[] };
  project.ui.customPages.push(page, child);
  project.ui.pages ??= {}; project.ui.pages.preferences = { layout: 'custom', background: '#20313d' };
  project.ui.components = project.ui.components.filter(c => c.page !== 'preferences');
  project.ui.components.push({ id: 'picture_native', page: 'preferences', kind: 'image', text: '', assetId: 'picture_b', x: .2, y: .15, width: .6, height: .4, imageEffects: { flipY: true, tint: '#ff8080' } }, { id: 'image_native_close', page: 'preferences', kind: 'button', text: '关闭图片模板', action: 'return', x: .35, y: .75, width: .3, height: .1 });
  const graph = createUiEventGraph(project, page.id, '图片同源场景'); let serial = 0;
  const node = (owner: BlueprintGraph, type: BlueprintNode['type'], properties: Record<string, VariableValue> = {}) => {
    const n = blueprintNodeDefaults(type); n.id = 'image_node_' + ++serial; Object.assign(n.properties, properties);
    n.x = 80 + serial % 5 * 380; n.y = 400 + Math.floor(serial / 5) * 260; owner.nodes.push(n); synchronizeBlueprintSignatures(project); return n;
  };
  const wire = (owner: BlueprintGraph, from: BlueprintNode, output: string, to: BlueprintNode, input: string) => assert.equal(connectBlueprintPins(owner, from.id, output, to.id, input), undefined);
  const next = (owner: BlueprintGraph, from: BlueprintNode, to: BlueprintNode) => { wire(owner, from, from.pins.find(pin => pin.direction === 'output' && pin.dataType === 'exec')!.id, to, 'exec_in'); return to; };
  const action = (name: typeof actions[number][0]) => ensureUiClickEvent(project, graph, 'image_action_' + name.toLowerCase(), page.id);
  const step = (previous: BlueprintNode, type: BlueprintNode['type'], properties: Record<string, VariableValue> = {}) => next(graph, previous, node(graph, type, properties));
  const mutations: Record<string, BlueprintNode> = {};
  for (const name of ['contain', 'cover', 'stretch', 'nineSlice'] as const) mutations[name] = step(action(name), 'setUiProperty', { componentId: 'picture', property: 'imageFit', value: name });
  let effects = action('effects');
  for (const [property, value] of Object.entries({ imageCropX: .25, imageCropY: 0, imageCropWidth: .5, imageCropHeight: 1, imageFlipX: true, imageFlipY: true, imageTint: '#80ffff80' })) effects = mutations[property] = step(effects, 'setUiProperty', { componentId: 'picture', property, value });
  for (const [name, value] of [['swap', 'picture_b'], ['clear', ''], ['fail', 'picture_broken']] as const) mutations[name] = step(action(name), 'setUiProperty', { componentId: 'picture', property: 'image', value });
  mutations.restore = step(action('restore'), 'resetUiProperty', { componentId: 'picture', property: 'image' });
  mutations.reset = step(action('reset'), 'resetUiComponent', { componentId: 'picture' });
  step(action('child'), 'showUiPage', { pageId: child.id, wait: true }); step(action('native'), 'showUiPage', { pageId: 'ui:preferences', wait: true });
  let observe = action('observe');
  for (const [property, variableId] of [['imageStatus', 'image_status'], ['imageError', 'image_error'], ['imageSourceWidth', 'image_width'], ['imageSourceHeight', 'image_height']] as [UiProperty, string][]) {
    const read = node(graph, 'getUiProperty', { componentId: 'picture', property }), store = node(graph, 'setVariable', { variableId }); wire(graph, read, 'value', store, 'value'); observe = next(graph, observe, store);
  }
  const eventRoots: Record<string, BlueprintNode> = {};
  for (const [trigger, variableId] of [['loaded', 'image_loaded'], ['failed', 'image_failed']] as const) {
    const event = eventRoots[trigger] = ensureUiImageEvent(project, graph, 'picture', page.id, trigger), read = node(graph, 'getVariable', { variableId }), add = node(graph, 'math', { operation: 'add', b: 1 }), store = node(graph, 'setVariable', { variableId });
    wire(graph, read, 'value', add, 'a'); wire(graph, add, 'result', store, 'value'); let tail = next(graph, event, store);
    for (const [pin, variableId] of [['width', 'image_event_width'], ['height', 'image_event_height'], ['error', 'image_event_error']]) {
      const store = node(graph, 'setVariable', { variableId }); wire(graph, event, pin, store, 'value'); tail = next(graph, tail, store);
    }
  }
  const background = createBlueprintGraph('function', '后台换图片'); project.blueprints.push(background);
  const changed = next(background, background.nodes[0], node(background, 'setUiProperty', { componentId: 'picture', property: 'image', value: 'picture_b' }));
  next(background, changed, node(background, 'setVariable', { variableId: 'image_job_done', value: true }));
  step(action('background'), 'startTask', { graphId: background.id, scope: 'page', pageId: page.id, seconds: .2, conflict: 'parallel' });
  const open = createBlueprintGraph('function', '打开图片场景'); project.blueprints.push(open);
  next(open, open.nodes[0], node(open, 'showUiPage', { pageId: page.id, wait: true }));
  const passage = project.nodes.find(n => n.kind === 'passage'); if (!passage || passage.kind !== 'passage') throw new Error('Missing passage');
  passage.lines[0].text = '图片页关闭后继续剧情。'; passage.lines[0].actions = [{ kind: 'blueprint', blueprintId: open.id }];
  const editGraph = createBlueprintGraph('function', '图片属性创作'); project.blueprints.push(editGraph);
  const editorSet = node(editGraph, 'setUiProperty', { componentId: 'picture', property: 'imageTint', value: '#ffffff' });
  const editorGet = node(editGraph, 'getUiProperty', { componentId: 'picture', property: 'imageStatus' });
  synchronizeBlueprintSignatures(project);
  return { project, page, child, graph, editGraph, editorSet, editorGet, mutations, eventRoots, node, wire, next, open };
}

export function uiImageFixturePng(alternate = false): Buffer {
  const width = 64, height = 32, chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]); let crc = 0xffffffff;
    for (const byte of body) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    const result = Buffer.alloc(data.length + 12); result.writeUInt32BE(data.length, 0); body.copy(result, 4); result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4); return result;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * (1 + width * 4) + 1 + x * 4, border = x < 8 || x >= 56 || y < 6 || y >= 26;
    pixels[i] = alternate ? 40 : x < 32 ? 240 : 40; pixels[i + 1] = alternate ? x < 32 ? 240 : 70 : y < 16 ? 65 : 220; pixels[i + 2] = border ? 220 : 45; pixels[i + 3] = 255;
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
