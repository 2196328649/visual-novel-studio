import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../../src/core/blueprint';
import { setBlueprintUiPropertyRows, type BlueprintUiPropertyAssignment } from '../../src/core/blueprint-ui-property-batch';
import { createUiEventGraph, ensureUiClickEvent } from '../../src/core/ui-logic';
import type { BlueprintGraph, BlueprintNode, UiComponent } from '../../src/core/model';
import { createUiPropertyControlFixture, uiPropertyControlFixturePng } from './ui-property-control-fixture';
import { spineFixtureAssets, writeUiSpineFixtureAssets } from './ui-spine-fixture';
import { writeUiVideoFixtureAssets } from './ui-video-fixture';

/** Source-only fixture: its native runner is scheduled by the main acceptance. */
export function createBlueprintUiPropertyBatchRuntimeFixture() {
  const base = createUiPropertyControlFixture({ runtimePersistent: true });
  const { project, page, graph } = base;
  project.id = 'blueprint_ui_property_batch_20261112';
  project.name = '一个节点设置多项界面属性';
  project.variables.push(
    { id: 'pb_min', name: '批次下限', type: 'number', initial: 0, persistent: false },
    { id: 'pb_max', name: '批次上限', type: 'number', initial: 100, persistent: false },
    { id: 'pb_linked_min', name: '同时决定下限的当前值', type: 'number', initial: 0, persistent: false },
    { id: 'pb_length', name: '批次文字长度', type: 'number', initial: 3, persistent: false },
    { id: 'pb_text', name: '批次文字', type: 'string', initial: '甲乙', persistent: false },
    { id: 'pb_skin', name: '批次皮肤', type: 'string', initial: 'default', persistent: false },
    { id: 'pb_done', name: '后台批次已完成', type: 'boolean', initial: false, persistent: false },
  );
  const pc = (id: string) => page.components.find(component => component.id === id)!;
  const slider = pc('pc_slider');
  slider.propertyControls = { ...slider.propertyControls, minimum: { mode: 'sync', parameterId: 'pb_min' }, maximum: { mode: 'sync', parameterId: 'pb_max' } };
  const button = (id: string, text: string, index: number): UiComponent => ({ id, text, name: text, kind: 'button', page: 'custom', x: .015 + index % 5 * .198, y: .735 + Math.floor(index / 5) * .06, width: .185, height: .05, style: { fontSize: 18 } });
  // Keep both original pages' active controls available for shared-reader checks.
  for (const component of page.components) if (component.y >= .69 && component.y < .86) component.y -= .045;
  const buttons = [
    ['pb_snapshot', '先读再设置'], ['pb_range', '整体扩展范围'], ['pb_source', '改参数来源'],
    ['pb_async', '后台整批设置'], ['pb_media', '切骨骼与皮肤'], ['pb_legacy', '旧单项设置'],
  ];
  page.components.push(...buttons.map(([id, text], index) => button(id, text, index)));
  const hidden = (id: string, kind: UiComponent['kind'], extra: Partial<UiComponent>): UiComponent => ({ id, kind, page: 'custom', name: id, text: id, x: -.7, y: -.5, width: .3, height: .07, ...extra });
  page.components.push(
    hidden('pb_legacy_slider', 'preference', { parameterId: 'pc_legacy_number', controlRange: { min: 0, max: 100, step: 1 } }),
    hidden('pb_legacy_input', 'preferenceChoice', { parameterId: 'pb_text', input: { maxLength: 8 } }),
    hidden('pb_short_reader', 'preferenceChoice', { parameterId: 'pb_text', input: { maxLength: 3 } }),
    hidden('pb_strict_input', 'preferenceChoice', { parameterId: 'pb_text', input: { maxLength: 3 }, propertyControls: { maxLength: { mode: 'sync', parameterId: 'pb_length' } } }),
    hidden('pb_conflict', 'text', { style: { opacity: .4 }, propertyControls: { x: { mode: 'sync', parameterId: 'pc_alpha' }, opacity: { mode: 'sync', parameterId: 'pc_alpha' } } }),
    hidden('pb_persist_mix', 'text', { style: { opacity: .25 }, propertyControls: { x: { mode: 'sync', parameterId: 'pc_alpha' }, opacity: { mode: 'sync', parameterId: 'pc_persistent_alpha' } } }),
    hidden('pb_ratio_cycle', 'preference', { parameterId: 'pc_legacy_number', controlRange: { min: 0, max: 100, step: 1 }, propertyControls: { minimum: { mode: 'sync', parameterId: 'pb_linked_min' }, numberValue: { mode: 'sync', parameterId: 'pb_linked_min' } } }),
    { id: 'pb_rig', kind: 'spine', page: 'custom', name: '批次骨骼', text: '', assetId: 'rig_a', x: .36, y: .65, width: .11, height: .075, spine: { animation: 'swing', skin: 'default', loop: true, autoplay: false } },
    hidden('pb_sync_rig', 'spine', { assetId: 'rig_a', spine: { animation: 'swing', skin: 'default', loop: true, autoplay: false }, propertyControls: { spineSkin: { mode: 'sync', parameterId: 'pb_skin' } } }),
    hidden('pb_video', 'video', { assetId: 'movie_a', loop: true, x: .48, y: .65, width: .02, height: .025 }),
    hidden('pb_condition_rig', 'spine', { assetId: 'rig_a', x: .51, y: .65, width: .03, height: .055, spine: { animation: 'swing', skin: 'default', loop: true, autoplay: false }, visibleWhen: { kind: 'compare', variableId: 'pc_alpha', operator: 'lt', value: .5 } }),
    hidden('pb_legacy_image', 'image', { assetId: 'pc_asset_a', assetParameterId: 'pc_image' }),
  );
  project.ui.pages = { ...project.ui.pages, preferences: { layout: 'custom', background: '#172334' } };
  project.ui.components = project.ui.components.filter(component => component.page !== 'preferences');
  project.ui.components.push(
    { ...hidden('pb_preference', 'preference', { preference: 'musicVolume', controlRange: { min: 0, max: 1, step: .01 } }), page: 'preferences', x: .08, y: .1, text: '音乐音量' },
    { ...hidden('pb_preference_reader', 'preference', { preference: 'musicVolume', controlRange: { min: 0, max: .5, step: .01 } }), page: 'preferences', x: .08, y: .3, text: '只显示 0 至 0.5' },
    { ...hidden('pb_fullscreen', 'preferenceChoice', { preference: 'fullscreen' }), page: 'preferences' },
    { ...hidden('pb_text_speed', 'preference', { preference: 'textSpeed' }), page: 'preferences', x: .55, y: .1, text: '文字速度' },
    { ...hidden('pb_character_volume', 'preference', { preference: 'characterVolume', ...(project.characters[0] ? { preferenceCharacterId: project.characters[0].id } : {}) }), page: 'preferences' },
    { id: 'pb_preferences_close', kind: 'button', page: 'preferences', name: '返回', text: '返回', action: 'return', x: .75, y: .8, width: .2, height: .1 },
  );
  const assets = structuredClone(spineFixtureAssets.filter(asset => asset.id !== 'rig_broken'));
  assets.find(asset => asset.id === 'rig_b')!.spine!.skins = ['default', 'blue_only'];
  project.assets.push(...assets);
  project.assets.push({ id: 'movie_a', name: '批次视频', kind: 'video', category: 'video', path: 'assets/movie-a.webm' });
  const unopened = { id: 'pb_unopened', name: '未打开的严格读者', modal: false, components: [
    { ...hidden('pb_inactive_reader', 'preferenceChoice', { parameterId: 'pb_text', input: { maxLength: 1 } }), text: '未打开时不约束修改' },
  ] };
  project.ui.customPages.push(unopened);
  createUiEventGraph(project, unopened.id, '未打开的读者');
  let serial = 0;
  const node = (owner: BlueprintGraph, type: BlueprintNode['type'], properties: BlueprintNode['properties'] = {}) => {
    const created = blueprintNodeDefaults(type);
    created.id = 'pb_node_' + ++serial; Object.assign(created.properties, properties);
    owner.nodes.push(created); synchronizeBlueprintSignatures(project); return created;
  };
  const wire = (owner: BlueprintGraph, from: BlueprintNode, output: string, to: BlueprintNode, input: string) => {
    synchronizeBlueprintSignatures(project);
    assert.equal(connectBlueprintPins(owner, from.id, output, to.id, input), undefined);
  };
  const next = (owner: BlueprintGraph, from: BlueprintNode, to: BlueprintNode) => {
    wire(owner, from, from.pins.find(pin => pin.direction === 'output' && pin.dataType === 'exec')!.id, to, 'exec_in'); return to;
  };
  const batch = (owner: BlueprintGraph, componentId: string, assignments: readonly BlueprintUiPropertyAssignment[]) => {
    const created = node(owner, 'setUiProperty', { componentId });
    const rows = assignments.map((assignment, index) => ({ id: 'value_row_' + index, property: assignment.property, writeMode: assignment.writeMode }));
    setBlueprintUiPropertyRows(created, rows);
    assignments.forEach((assignment, index) => { created.properties[rows[index].id] = assignment.value; });
    synchronizeBlueprintSignatures(project); return created;
  };
  const event = (id: string) => ensureUiClickEvent(project, graph, id, page.id);
  const snapshot = batch(graph, 'pc_default', [
    { property: 'x', value: .5, writeMode: 'override' }, { property: 'y', value: 0, writeMode: 'override' }, { property: 'text', value: '同一节点的三项写入', writeMode: 'override' },
  ]);
  next(graph, event('pb_snapshot'), snapshot);
  const oldX = node(graph, 'getUiProperty', { componentId: 'pc_default', property: 'x' });
  wire(graph, oldX, 'value', snapshot, 'value_row_1');
  const range = batch(graph, 'pc_slider', [
    { property: 'normalizedValue', value: .5, writeMode: 'override' }, { property: 'minimum', value: 200, writeMode: 'override' },
    { property: 'maximum', value: 400, writeMode: 'override' }, { property: 'step', value: 5, writeMode: 'override' },
  ]);
  next(graph, event('pb_range'), range);
  const source = batch(graph, 'pb_legacy_slider', [
    { property: 'numberValue', value: 250, writeMode: 'source' }, { property: 'minimum', value: 200, writeMode: 'override' }, { property: 'maximum', value: 300, writeMode: 'override' },
  ]);
  next(graph, event('pb_source'), source);
  const media = batch(graph, 'pb_rig', [
    { property: 'spineSkin', value: 'blue_only', writeMode: 'override' }, { property: 'spineAsset', value: 'rig_b', writeMode: 'override' }, { property: 'spineSpeed', value: 2, writeMode: 'override' },
  ]);
  next(graph, event('pb_media'), media);
  const legacy = node(graph, 'setUiProperty', { componentId: 'pc_default', property: 'text', value: '旧单项仍可运行', writeMode: 'override' });
  next(graph, event('pb_legacy'), legacy);
  const worker = createBlueprintGraph('function', '后台批次赋值'); worker.id = 'pb_worker'; project.blueprints.push(worker);
  const taskBatch = batch(worker, 'pc_default', [
    { property: 'x', value: .6, writeMode: 'override' }, { property: 'y', value: 0, writeMode: 'override' }, { property: 'text', value: '后台已完成批次', writeMode: 'override' },
  ]);
  const workerOldX = node(worker, 'getUiProperty', { componentId: 'pc_default', property: 'x' }); wire(worker, workerOldX, 'value', taskBatch, 'value_row_1');
  next(worker, worker.nodes[0], taskBatch);
  next(worker, taskBatch, node(worker, 'setVariable', { variableId: 'pb_done', value: true }));
  const launch = node(graph, 'startTask', { graphId: worker.id, scope: 'page', pageId: page.id, conflict: 'replace' });
  next(graph, event('pb_async'), launch);
  synchronizeBlueprintSignatures(project);
  return { ...base, node, wire, next, batch, snapshot, range, source, media, legacy, worker, taskBatch, launch };
}

export async function writeBlueprintUiPropertyBatchRuntimeAssets(directory: string) {
  await fs.mkdir(path.join(directory, 'assets'), { recursive: true });
  for (const name of ['property-control-a.png', 'property-control-b.png']) await fs.writeFile(path.join(directory, 'assets', name), uiPropertyControlFixturePng());
  await writeUiSpineFixtureAssets(directory);
  await writeUiVideoFixtureAssets(directory);
  const file = path.join(directory, 'assets/rig-b/rig.json');
  const skeleton = JSON.parse(await fs.readFile(file, 'utf8')) as { skins: { name: string }[] };
  skeleton.skins.find(skin => skin.name === 'alternate')!.name = 'blue_only';
  await fs.writeFile(file, JSON.stringify(skeleton));
}
