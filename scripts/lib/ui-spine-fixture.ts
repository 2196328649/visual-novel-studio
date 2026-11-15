import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { createProject, type Asset, type BlueprintGraph, type BlueprintNode, type UiComponent, type VariableValue } from '../../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../../src/core/blueprint';
import { createUiEventGraph, ensureUiClickEvent, ensureUiSpineEvent } from '../../src/core/ui-logic';
import type { UiProperty } from '../../src/core/ui-properties';

/** No downloaded artwork: tiny real Spine 4.2 skeletons and a two-colour atlas. */
export const spineFixtureAssets: Asset[] = ['a', 'b', 'broken'].map(name => ({
  id: 'rig_' + name, name: '骨骼 ' + name, kind: 'spine', path: 'assets/rig-' + name + '/rig.json',
  spine: { version: '4.2.43', atlasPath: 'assets/rig-' + name + '/rig.atlas',
    pages: [{ name: 'page.png', path: 'assets/rig-' + name + '/page.png', width: 32, height: 16 }],
    bounds: { x: -32, y: -32, width: 64, height: 64 }, skins: ['default', 'alternate'],
    animations: name === 'b' ? [{ name: 'bounce', duration: 1.2 }] : [{ name: 'swing', duration: 2.4 }, { name: 'quick', duration: .6 }, { name: 'instant', duration: 0 }] },
}));

export function createUiSpineFixture() {
  const project = createProject('骨骼动画状态与实例事件'); project.id = 'ui_spine_fixture'; project.width = 1280; project.height = 720;
  project.assets.push(...structuredClone(spineFixtureAssets), { id: 'not_spine', name: '普通图片', kind: 'image', path: 'assets/not-spine.png' });
  for (const [id, initial] of Object.entries({ spine_completed: 0, spine_failed: 0, spine_child_completed: 0, spine_native_completed: 0,
    spine_event_asset: '', spine_event_animation: '', spine_event_skin: '', spine_event_position: 0, spine_event_duration: 0, spine_event_error: '',
    spine_status: '', spine_animation: '', spine_skin: '', spine_source: '', spine_position: 0, spine_duration: 0, spine_known: false, spine_progress: 0,
    spine_playing: false, spine_paused: false, spine_error: '', spine_job_done: false })) {
    project.variables.push({ id, name: id, type: typeof initial as 'number' | 'string' | 'boolean', initial, persistent: false });
  }
  const actions = [['play', '播放骨骼'], ['pause', '暂停骨骼'], ['resume', '继续骨骼'], ['restart', '从头重播骨骼'], ['quick', '切换短动画'],
    ['loop', '骨骼开启循环'], ['once', '骨骼关闭循环'], ['skin', '切换骨骼皮肤'], ['zero', '骨骼零速度'], ['speed', '骨骼正常速度'],
    ['swap', '切换骨骼素材'], ['same', '相同骨骼素材'], ['clear', '清空骨骼'], ['restore', '恢复骨骼素材'], ['reset', '重置骨骼控件'],
    ['hide', '隐藏骨骼'], ['show', '显示骨骼'], ['fail', '加载损坏骨骼'], ['transform', '骨骼内部变换'], ['observe', '读取骨骼状态'],
    ['background', '后台控制骨骼'], ['child', '打开骨骼子页'], ['native', '打开骨骼模板'], ['instant', '零时长动画'], ['close', '关闭骨骼页']] as const;
  const rig: UiComponent = { id: 'rig', page: 'custom', kind: 'spine', name: '被测骨骼', text: '', assetId: 'rig_a',
    spine: { animation: 'swing', skin: 'default', loop: false, autoplay: false }, x: .04, y: .02, width: .52, height: .31 };
  const mirror: UiComponent = { ...structuredClone(rig), id: 'rig_mirror', name: '独立骨骼', x: .66, width: .29, spine: { animation: 'swing', loop: true, autoplay: true } };
  const page = { id: 'spine_page', name: '骨骼场景', modal: true, background: '#263847', components: [rig, mirror,
    ...actions.map(([id, text], i): UiComponent => ({ id: 'spine_action_' + id, page: 'custom', kind: 'button', text,
      x: .025 + i % 5 * .195, y: .365 + Math.floor(i / 5) * .125, width: .18, height: .1, style: { fontSize: 19 }, ...(id === 'close' ? { action: 'return' as const } : {}) }))] };
  const child = { id: 'spine_child', name: '骨骼子页', modal: true, background: '#17273380', components: [
    { ...structuredClone(rig), id: 'rig_child', assetId: 'rig_b', spine: { animation: 'bounce', loop: false, autoplay: true }, x: .2, y: .14, width: .6, height: .4 },
    { id: 'spine_child_close', page: 'custom', kind: 'button', text: '关闭骨骼子页', action: 'return', x: .35, y: .74, width: .3, height: .1 }] as UiComponent[] };
  project.ui.customPages.push(page, child);
  project.ui.pages ??= {}; project.ui.pages.preferences = { layout: 'custom', background: '#20313d' };
  project.ui.components = project.ui.components.filter(c => c.page !== 'preferences');
  project.ui.components.push({ ...structuredClone(rig), id: 'rig_native', page: 'preferences', spine: { animation: 'quick', loop: false, autoplay: true }, x: .2, y: .14, width: .6, height: .4 },
    { id: 'spine_native_close', page: 'preferences', kind: 'button', text: '关闭骨骼模板', action: 'return', x: .35, y: .75, width: .3, height: .1 });
  const graph = createUiEventGraph(project, page.id, '骨骼同源场景'); let serial = 0;
  const node = (owner: BlueprintGraph, type: BlueprintNode['type'], properties: Record<string, VariableValue> = {}) => {
    const n = blueprintNodeDefaults(type); n.id = 'spine_node_' + ++serial; Object.assign(n.properties, properties);
    n.x = 80 + serial % 5 * 380; n.y = 400 + Math.floor(serial / 5) * 260; owner.nodes.push(n); synchronizeBlueprintSignatures(project); return n;
  };
  const wire = (owner: BlueprintGraph, from: BlueprintNode, output: string, to: BlueprintNode, input: string) => assert.equal(connectBlueprintPins(owner, from.id, output, to.id, input), undefined);
  const next = (owner: BlueprintGraph, from: BlueprintNode, to: BlueprintNode) => { wire(owner, from, from.pins.find(pin => pin.direction === 'output' && pin.dataType === 'exec')!.id, to, 'exec_in'); return to; };
  const action = (name: typeof actions[number][0]) => ensureUiClickEvent(project, graph, 'spine_action_' + name, page.id);
  const step = (previous: BlueprintNode, type: BlueprintNode['type'], properties: Record<string, VariableValue> = {}) => next(graph, previous, node(graph, type, properties));
  const mutations: Record<string, BlueprintNode> = {};
  for (const [name, type, properties] of [['play', 'playSpine', { animation: 'swing', loop: false, restart: false }], ['restart', 'playSpine', { animation: 'swing', loop: false, restart: true }],
    ['quick', 'playSpine', { animation: 'quick', loop: false, restart: true }], ['instant', 'playSpine', { animation: 'instant', loop: false, restart: true }],
    ['pause', 'pauseSpine', { paused: true }], ['resume', 'pauseSpine', { paused: false }], ['zero', 'setSpineSpeed', { speed: 0 }], ['speed', 'setSpineSpeed', { speed: 1 }]] as [typeof actions[number][0], BlueprintNode['type'], Record<string, VariableValue>][]) {
    mutations[name] = step(action(name), type, { componentId: rig.id, ...properties });
  }
  for (const [name, property, value] of [['loop', 'spineLoop', true], ['once', 'spineLoop', false], ['skin', 'spineSkin', 'alternate'], ['swap', 'spineAsset', 'rig_b'], ['same', 'spineAsset', 'rig_a'],
    ['clear', 'spineAsset', ''], ['fail', 'spineAsset', 'rig_broken'], ['hide', 'visible', false], ['show', 'visible', true]] as [typeof actions[number][0], UiProperty, VariableValue][]) {
    mutations[name] = step(action(name), 'setUiProperty', { componentId: rig.id, property, value });
  }
  mutations.restore = step(action('restore'), 'resetUiProperty', { componentId: rig.id, property: 'spineAsset' });
  mutations.reset = step(action('reset'), 'resetUiComponent', { componentId: rig.id });
  let transform = action('transform');
  for (const [property, value] of [['spineFit', 'manual'], ['spineScale', 1.5], ['spineOriginX', .3], ['spineOriginY', .6], ['spineRotation', 25], ['spineFlipX', true]] as [UiProperty, VariableValue][]) transform = step(transform, 'setUiProperty', { componentId: rig.id, property, value });
  step(action('child'), 'showUiPage', { pageId: child.id, wait: true }); step(action('native'), 'showUiPage', { pageId: 'ui:preferences', wait: true });
  let observe = action('observe');
  for (const [property, variableId] of [['spineStatus', 'spine_status'], ['spineAnimation', 'spine_animation'], ['spineSkin', 'spine_skin'], ['spineAsset', 'spine_source'], ['spinePosition', 'spine_position'],
    ['spineDuration', 'spine_duration'], ['spineDurationKnown', 'spine_known'], ['spineProgress', 'spine_progress'], ['spinePlaying', 'spine_playing'], ['spinePaused', 'spine_paused'], ['spineError', 'spine_error']] as [UiProperty, string][]) {
    const read = node(graph, 'getUiProperty', { componentId: rig.id, property }), store = node(graph, 'setVariable', { variableId });
    if (property === 'spineAsset') { const text = node(graph, 'formatText', { format: '{value}' }); wire(graph, read, 'value', text, 'value'); wire(graph, text, 'text', store, 'value'); }
    else wire(graph, read, 'value', store, 'value');
    observe = next(graph, observe, store);
  }
  const increment = (owner: BlueprintGraph, event: BlueprintNode, variableId: string) => {
    const read = node(owner, 'getVariable', { variableId }), add = node(owner, 'math', { operation: 'add', b: 1 }), store = node(owner, 'setVariable', { variableId });
    wire(owner, read, 'value', add, 'a'); wire(owner, add, 'result', store, 'value'); return next(owner, event, store);
  };
  const eventRoots: Record<string, BlueprintNode> = {};
  for (const [trigger, variableId] of [['completed', 'spine_completed'], ['failed', 'spine_failed']] as const) {
    const event = eventRoots[trigger] = ensureUiSpineEvent(project, graph, rig.id, page.id, trigger); let tail = increment(graph, event, variableId);
    for (const pin of ['assetId', 'animation', 'skin', 'position', 'duration', 'error']) {
      const store = node(graph, 'setVariable', { variableId: 'spine_event_' + (pin === 'assetId' ? 'asset' : pin) });
      if (pin === 'assetId') { const text = node(graph, 'formatText', { format: '{value}' }); wire(graph, event, pin, text, 'value'); wire(graph, text, 'text', store, 'value'); }
      else wire(graph, event, pin, store, 'value');
      tail = next(graph, tail, store);
    }
  }
  for (const [pageId, componentId, variableId] of [[child.id, 'rig_child', 'spine_child_completed'], ['ui:preferences', 'rig_native', 'spine_native_completed']]) {
    const owner = createUiEventGraph(project, pageId, '骨骼实例事件 ' + pageId.replaceAll(':', ' '));
    increment(owner, ensureUiSpineEvent(project, owner, componentId, pageId, 'completed'), variableId);
  }
  const background = createBlueprintGraph('function', '后台骨骼控制'); project.blueprints.push(background);
  let tail = next(background, background.nodes[0], node(background, 'setUiProperty', { componentId: rig.id, property: 'spineAsset', value: 'rig_b' }));
  tail = next(background, tail, node(background, 'playSpine', { componentId: rig.id, animation: 'bounce', loop: false, restart: true }));
  tail = next(background, tail, node(background, 'pauseSpine', { componentId: rig.id, paused: true }));
  next(background, tail, node(background, 'setVariable', { variableId: 'spine_job_done', value: true }));
  step(action('background'), 'startTask', { graphId: background.id, scope: 'page', pageId: page.id, seconds: .2, conflict: 'parallel' });
  const open = createBlueprintGraph('function', '打开骨骼场景'); project.blueprints.push(open); next(open, open.nodes[0], node(open, 'showUiPage', { pageId: page.id, wait: true }));
  const passage = project.nodes.find(n => n.kind === 'passage'); if (!passage || passage.kind !== 'passage') throw Error('Missing passage');
  passage.lines[0].text = '骨骼页关闭后继续剧情。'; passage.lines[0].actions = [{ kind: 'blueprint', blueprintId: open.id }];
  const editGraph = createBlueprintGraph('function', '骨骼属性创作'); project.blueprints.push(editGraph);
  const editorSet = node(editGraph, 'setUiProperty', { componentId: rig.id, property: 'spineAsset', value: 'rig_a' });
  const editorSkin = node(editGraph, 'setUiProperty', { componentId: rig.id, property: 'spineSkin', value: 'default' });
  const editorPlay = node(editGraph, 'playSpine', { componentId: rig.id, animation: 'swing' });
  const editorGet = node(editGraph, 'getUiProperty', { componentId: rig.id, property: 'spineStatus' });
  synchronizeBlueprintSignatures(project);
  return { project, page, rig, mirror, child, graph, background, open, editGraph, editorSet, editorSkin, editorPlay, editorGet, mutations, eventRoots, node, wire, next };
}

export async function writeUiSpineFixtureAssets(directory: string) {
  const png = new PNG({ width: 32, height: 16 });
  for (let y = 0; y < 16; y++) for (let x = 0; x < 32; x++) png.data.set(x < 16 ? [240, 100, 55, 255] : [40, 205, 240, 255], (y * 32 + x) * 4);
  const image = PNG.sync.write(png);
  for (const asset of spineFixtureAssets) {
    const metadata = asset.spine!, animation = (duration: number) => ({ bones: { root: { rotate: [{ value: -20 }, { time: duration / 2, value: 20 }, { time: duration, value: -20 }] } } });
    const skeleton = { skeleton: { spine: metadata.version, ...metadata.bounds }, bones: [{ name: 'root' }], slots: [{ name: 'body', bone: 'root', attachment: 'tile' }],
      skins: metadata.skins.map((name, i) => ({ name, attachments: { body: { tile: { type: 'region', path: i ? 'cool' : 'warm', width: 64, height: 64 } } } })),
      animations: Object.fromEntries(metadata.animations.map(({ name, duration }) => [name, duration ? animation(duration) : {}])) };
    await fs.mkdir(path.dirname(path.join(directory, asset.path)), { recursive: true });
    await fs.writeFile(path.join(directory, asset.path), asset.id === 'rig_broken' ? '{ invalid skeleton' : JSON.stringify(skeleton));
    await fs.writeFile(path.join(directory, metadata.atlasPath), 'page.png\nsize:32,16\nfilter:Nearest,Nearest\npma:false\nwarm\nbounds:0,0,16,16\ncool\nbounds:16,0,16,16\n');
    await fs.writeFile(path.join(directory, metadata.pages[0].path), image);
  }
  await fs.writeFile(path.join(directory, 'assets/not-spine.png'), image);
}
