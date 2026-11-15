import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, type BlueprintGraph, type BlueprintNode, type Project, type UiComponent, type VariableValue } from '../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { createUiEventGraph, ensureUiClickEvent, ensureUiValueChangedEvent } from '../src/core/ui-logic';
import { previewUiLogic, prepareUiPropertyBatchMedia, type UiPreviewEvent, type UiPropertyBatchMediaSnapshot } from '../src/core/ui-logic-preview';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { blueprintUiPropertyDefinition } from '../src/core/blueprint-ui-property-batch';
import { uiVideoRequest, suspendUiVideo } from '../src/core/ui-video';
import { uiSpineRequest, suspendUiSpine } from '../src/core/ui-spine';
import { uiImageRequest } from '../src/core/ui-image';
import { resolveUiLayout } from '../src/core/ui-layout';
import { uiPropertyDefaults, type UiProperty } from '../src/core/ui-properties';

// These cases are executed with the main agent's unified verification pass.
type Owner = { project: Project; graph: BlueprintGraph };
type Write = readonly [property: string, value: VariableValue, writeMode?: string];
const click = (componentId: string): UiPreviewEvent => ({ kind: 'click', componentId });
const advance = (seconds: number): UiPreviewEvent => ({ kind: 'advance', seconds });
const closeTo = (actual: unknown, expected: number) => assert.ok(typeof actual === 'number' && Math.abs(actual - expected) < 1e-9, `${String(actual)} != ${expected}`);
const component = (id: string, fields: Partial<UiComponent> = {}): UiComponent => ({ id, page: 'custom', kind: 'text', text: id, x: .1, y: .2, width: .4, height: .1, ...fields });

function fixture() {
  const project = createProject('组件批量属性预览'); project.ui.components = [];
  const page = { id: 'batch_page', name: '批量属性', modal: true, background: '#172334', components: [] as UiComponent[] };
  project.ui.customPages = [page];
  const graph = createUiEventGraph(project, page.id, '批量属性事件');
  return { project, page, graph };
}
type Fixture = ReturnType<typeof fixture>;
const sample = (f: Fixture, events: UiPreviewEvent[] = []) => previewUiLogic(f.project, f.page.components, f.page.id, {}, events, { timed: true, trace: true });
const shown = (result: ReturnType<typeof sample>, id: string) => result.components.find(row => row.component.id === id)!.component;
function node(f: Owner, type: BlueprintNode['type'], properties: BlueprintNode['properties']) {
  const result = blueprintNodeDefaults(type); Object.assign(result.properties, properties); f.graph.nodes.push(result);
  synchronizeBlueprintSignatures(f.project); return result;
}
function wire(f: Owner, from: BlueprintNode, output: string, to: BlueprintNode, input: string) {
  assert.equal(connectBlueprintPins(f.graph, from.id, output, to.id, input), undefined);
}
function onClick(f: Fixture, name: string, target: BlueprintNode) {
  f.page.components.push(component(name, { kind: 'button', y: .8 }));
  wire(f, ensureUiClickEvent(f.project, f.graph, name, f.page.id), 'exec', target, 'exec_in'); return target;
}
function batch(f: Owner, target: string, writes: readonly Write[]) {
  const rows = writes.map(([property, , mode], index) => ({ id: 'value_row' + index, property, writeMode: mode ?? 'override' }));
  return node(f, 'setUiProperty', { componentId: target, propertyBatchVersion: 1, propertyWrites: JSON.stringify(rows), ...Object.fromEntries(writes.map(([, value], index) => [rows[index].id, value])) });
}
function parameter(f: Owner, id: string, initial: VariableValue, setting?: { min?: number; max?: number; step?: number; options?: string[] }) {
  f.project.variables.push({ id, name: id, type: typeof initial as 'number' | 'string' | 'boolean', initial, persistent: false, setting });
}

class ReadTrackedMap<T> extends Map<string, T> {
  readonly reads: string[] = [];
  override get(id: string) { this.reads.push(id); return super.get(id); }
}
function mediaPreparationFixture(components = [component('button', { kind: 'button' }),
  component('image', { kind: 'image', assetId: 'image_a', parentId: 'button', inheritState: true, skin: { pressed: 'image_b' } }),
  component('video', { kind: 'video', assetId: 'video_a' }), component('rig', { kind: 'spine', assetId: 'rig_a' })]) {
  const project = createProject('批量媒体预提交');
  for (const id of ['a', 'b']) {
    project.assets.push({ id: 'image_' + id, name: id, kind: 'image', path: `assets/${id}.png` }, { id: 'video_' + id, name: id, kind: 'video', path: `assets/${id}.webm` },
      { id: 'rig_' + id, name: id, kind: 'spine', path: `assets/${id}.json`, spine: { version: '4.2.43', atlasPath: `assets/${id}.atlas`, pages: [{ name: 'page.png', path: `assets/${id}.png`, width: 64, height: 64 }], bounds: { x: 0, y: 0, width: 64, height: 64 }, skins: ['one', 'two'], animations: [] } });
  }
  const records = { image: uiImageRequest(undefined, 'image_a', 1), video: uiVideoRequest(undefined, 'video_a', true, 1), spine: uiSpineRequest(undefined, project.assets.find(asset => asset.id === 'rig_a'), {}, 1) };
  const requests = { images: new ReadTrackedMap([[ 'image', records.image ]]), videos: new ReadTrackedMap([[ 'video', records.video ]]), spines: new ReadTrackedMap([[ 'rig', records.spine ]]) };
  const snapshot = (rows = components, values: Record<string, Record<string, VariableValue>> = {}, visible: (component: UiComponent) => boolean = () => true): UiPropertyBatchMediaSnapshot => {
    const defaults = uiPropertyDefaults(project, rows), geometry = resolveUiLayout(rows, project, visible);
    return { geometry, read: (id, property) => Object.hasOwn(values[id] ?? {}, property) ? values[id][property] : defaults[id]?.[property as UiProperty],
      shown: component => geometry.get(component.id)?.visible !== false, imageState: () => 'idle' };
  };
  const before = snapshot(), pages = [{ components, instance: 1, displayed: true }];
  const prepare = (target: Parameters<typeof prepareUiPropertyBatchMedia>[2], after = snapshot()) => prepareUiPropertyBatchMedia(project, pages, target, before, after, requests);
  return { project, components, records, requests, snapshot, before, prepare };
}

test('batch preview resolves target and all linked rows before one host call while legacy hosts retain set', () => {
  const project = createProject('先读后写'), graph = createBlueprintGraph('function', '交换坐标'); project.blueprints.push(graph);
  const f = { project, graph }, set = batch(f, 'target', [['x', 0], ['y', 0]]), context = previewActionContext(project), calls: string[] = [];
  const state = { x: .2, y: .7 };
  const target = node(f, 'getUiProperty', { componentId: 'selector', property: 'text' });
  const x = node(f, 'getUiProperty', { componentId: 'target', property: 'x' }), y = node(f, 'getUiProperty', { componentId: 'target', property: 'y' });
  // The component pin normally requires a typed component producer; this saved
  // link intentionally proves execution reads and checks the actual target once.
  graph.links.push({ id: 'dynamic_target', fromNodeId: target.id, fromPinId: 'value', toNodeId: set.id, toPinId: 'componentId' });
  wire(f, y, 'value', set, 'value_row0'); wire(f, x, 'value', set, 'value_row1'); wire(f, graph.nodes[0], 'exec', set, 'exec_in');
  context.ui = {
    get: (id, property) => { calls.push('read:' + property); return id === 'selector' ? 'target' : state[property as keyof typeof state]; },
    set: () => { assert.fail('v1 不得降级为逐项 set'); }, reset: () => true,
    setMany: (id, rows) => { calls.push('commit'); assert.equal(id, 'target'); assert.deepEqual(rows.map(row => row.value), [.7, .2]); for (const row of rows) state[row.property as keyof typeof state] = Number(row.value); return true; },
  };
  expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: graph.id }], context);
  assert.equal(context.incomplete, false); assert.deepEqual(calls, ['read:text', 'read:y', 'read:x', 'commit']); assert.deepEqual(state, { x: .7, y: .2 });
  delete set.properties.propertyBatchVersion; delete set.properties.propertyWrites;
  Object.assign(set.properties, { componentId: 'target', property: 'visible', value: false });
  graph.links = graph.links.filter(link => link.toNodeId !== set.id || link.toPinId === 'exec_in'); synchronizeBlueprintSignatures(project);
  const legacy = previewActionContext(project); let legacyCalls = 0;
  legacy.ui = { get: () => undefined, reset: () => true, set: (id, property, value) => { legacyCalls++; assert.deepEqual([id, property, value], ['target', 'visible', false]); return true; } };
  expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: graph.id }], legacy);
  assert.equal(legacy.incomplete, false); assert.equal(legacyCalls, 1);
});

test('batch input failures never become success through a downstream fallback and stop subsequent nodes', () => {
  const project = createProject('失败不写'), graph = createBlueprintGraph('function', '读取失败'); project.blueprints.push(graph);
  const f = { project, graph }; parameter(f, 'after', false);
  const set = batch(f, 'target', [['text', '原值'], ['x', .8]]), format = node(f, 'formatText', { value: 7 });
  const missing = node(f, 'getUiProperty', { componentId: 'missing', property: 'text' });
  const after = node(f, 'setVariable', { variableId: 'after', value: true });
  wire(f, missing, 'value', format, 'format'); wire(f, format, 'text', set, 'value_row0'); wire(f, graph.nodes[0], 'exec', set, 'exec_in'); wire(f, set, 'exec_out', after, 'exec_in');
  const context = previewActionContext(project); let commits = 0;
  context.ui = { get: () => undefined, set: () => true, reset: () => true, setMany: () => { commits++; return true; } };
  expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: graph.id }], context);
  assert.equal(context.incomplete, true); assert.equal(commits, 0); assert.equal(context.variables.after, false);
});

test('malformed definitions and missing batch capability reject complete calls without falling back to legacy set', () => {
  for (const properties of [{ propertyBatchVersion: 2 }, { propertyWrites: '{' }, { propertyWrites: '[]' }, {}]) {
    const project = createProject('版本拒绝'), graph = createBlueprintGraph('function', '版本拒绝'); project.blueprints.push(graph);
    const f = { project, graph }; parameter(f, 'after', false);
    const set = batch(f, 'target', [['x', .8], ['y', .3]]); Object.assign(set.properties, properties);
    const after = node(f, 'setVariable', { variableId: 'after', value: true });
    wire(f, graph.nodes[0], 'exec', set, 'exec_in'); wire(f, set, 'exec_out', after, 'exec_in');
    const context = previewActionContext(project); let calls = 0;
    context.ui = { get: () => undefined, set: () => { calls++; return true; }, reset: () => true };
    expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: graph.id }], context);
    assert.equal(context.incomplete, true); assert.equal(calls, 0); assert.equal(context.variables.after, false);
  }
});

test('a rejected nested batch stops parent continuation, later sequence outputs and remaining stage actions', () => {
  for (const kind of ['function', 'macro'] as const) for (const legacy of [false, true]) {
    const project = createProject('失败沿调用传播'), graph = createBlueprintGraph('function', '父流程'), child = createBlueprintGraph(kind, '子流程'); project.blueprints.push(graph, child);
    const parent = { project, graph }, nested = { project, graph: child };
    parameter(parent, 'after_call', false); parameter(parent, 'after_sequence', false);
    const set = legacy ? node(nested, 'setUiProperty', { componentId: 'missing', property: 'visible', value: false }) : batch(nested, 'missing', [['x', .8], ['y', .3]]);
    wire(nested, child.nodes[0], 'exec', set, 'exec_in');
    const sequence = node(parent, 'sequence', {}), call = node(parent, kind === 'function' ? 'callFunction' : 'callMacro', { graphId: child.id });
    const afterCall = node(parent, 'setVariable', { variableId: 'after_call', value: true }), afterSequence = node(parent, 'setVariable', { variableId: 'after_sequence', value: true });
    wire(parent, graph.nodes[0], 'exec', sequence, 'exec_in'); wire(parent, sequence, 'then_0', call, 'exec_in'); wire(parent, call, 'exec_out', afterCall, 'exec_in'); wire(parent, sequence, 'then_1', afterSequence, 'exec_in');
    const context = previewActionContext(project); context.ui = { get: () => undefined, set: () => false, setMany: () => false, reset: () => true };
    const result = expandPreviewActions(project, [{ kind: 'blueprint', blueprintId: graph.id }, { kind: 'pause', seconds: .25 }], context);
    assert.equal(context.incomplete, true); assert.equal(context.variables.after_call, legacy); assert.equal(context.variables.after_sequence, legacy);
    assert.deepEqual(result, legacy ? [{ kind: 'pause', seconds: .25 }] : []);
    // Failure is invocation-local: the next independent runner still executes.
    assert.deepEqual(expandPreviewActions(project, [{ kind: 'pause', seconds: .5 }], context), [{ kind: 'pause', seconds: .5 }]);
  }
});

test('coordinate swaps in the interactive preview read the original state and leave project data intact', () => {
  const f = fixture(); f.page.components.push(component('target', { x: .2, y: .7 }));
  const set = onClick(f, 'swap', batch(f, 'target', [['x', 0], ['y', 0]]));
  const x = node(f, 'getUiProperty', { componentId: 'target', property: 'x' }), y = node(f, 'getUiProperty', { componentId: 'target', property: 'y' });
  wire(f, y, 'value', set, 'value_row0'); wire(f, x, 'value', set, 'value_row1');
  const authored = structuredClone(f.project), result = sample(f, [click('swap')]);
  assert.equal(result.incomplete, false); closeTo(shown(result, 'target').x, .7); closeTo(shown(result, 'target').y, .2); assert.deepEqual(f.project, authored);
});

test('any invalid final field retains local animation ownership and stops the following action', () => {
  const f = fixture(); f.page.components.push(component('target', { style: { opacity: .2 } })); parameter(f, 'after', false);
  onClick(f, 'animate', node(f, 'animateUiProperty', { componentId: 'target', property: 'opacity', value: 1, duration: 2, easing: 'linear', wait: false }));
  const set = onClick(f, 'reject', batch(f, 'target', [['opacity', .7], ['width', -1]])), after = node(f, 'setVariable', { variableId: 'after', value: true }); wire(f, set, 'exec_out', after, 'exec_in');
  const result = sample(f, [click('animate'), advance(.5), click('reject'), advance(.5)]);
  assert.equal(result.incomplete, true); closeTo(shown(result, 'target').style?.opacity, .6); assert.equal(shown(result, 'target').width, .4); assert.equal(result.variables.after, false);
});

test('successful equal assignments take ownership of every written animation together', () => {
  const f = fixture(); f.page.components.push(component('target', { style: { opacity: .2 } }));
  onClick(f, 'animate', node(f, 'animateUiProperty', { componentId: 'target', property: 'opacity', value: 1, duration: 2, easing: 'linear', wait: false }));
  onClick(f, 'commit', batch(f, 'target', [['opacity', .4], ['x', .3]]));
  const result = sample(f, [click('animate'), advance(.5), click('commit'), advance(2)]);
  assert.equal(result.incomplete, false); closeTo(shown(result, 'target').style?.opacity, .4); closeTo(shown(result, 'target').x, .3);
});

test('range bounds, step and normalized value validate against the complete new range regardless of row order', () => {
  for (const reversed of [false, true]) {
    const f = fixture(); parameter(f, 'number', 5, { min: 0, max: 10, step: 1 });
    f.page.components.push(component('slider', { kind: 'preference', parameterId: 'number' }));
    const writes: Write[] = [['normalizedValue', .5], ['minimum', 100], ['maximum', 200], ['step', 5]];
    onClick(f, 'range', batch(f, 'slider', reversed ? [...writes].reverse() : writes));
    const result = sample(f, [click('range')]); assert.equal(result.incomplete, false);
    assert.equal(result.controlValues.slider, 150); assert.equal(result.variables.number, 5); assert.deepEqual(shown(result, 'slider').controlRange, { min: 100, max: 200, step: 5 });
  }
});

test('source current value, linked bounds and shared readers use the same final range without user events', () => {
  const f = fixture(); parameter(f, 'number', 5, { min: 0, max: 10, step: 1 }); parameter(f, 'low', 0); parameter(f, 'high', 10); parameter(f, 'changed', false);
  f.page.components.push(component('slider', { kind: 'preference', parameterId: 'number', propertyControls: { minimum: { mode: 'sync', parameterId: 'low' }, maximum: { mode: 'sync', parameterId: 'high' } } }), component('reader', { kind: 'preference', parameterId: 'number', controlRange: { min: 0, max: 10, step: 1 } }));
  const event = ensureUiValueChangedEvent(f.project, f.graph, 'slider', f.page.id), count = node(f, 'setVariable', { variableId: 'changed', value: true }); wire(f, event, 'exec', count, 'exec_in');
  onClick(f, 'range', batch(f, 'slider', [['normalizedValue', .5, 'source'], ['minimum', 100], ['maximum', 200]]));
  const result = sample(f, [click('range')]); assert.equal(result.incomplete, false);
  assert.equal(result.variables.number, 150); assert.equal(result.variables.low, 100); assert.equal(result.variables.high, 200); assert.equal(result.controlValues.slider, 150); assert.equal(result.controlValues.reader, 10); assert.equal(result.variables.changed, false);
});

test('same-value aliases are still conflicting writes and self-changing normalization is rejected', () => {
  const f = fixture(); parameter(f, 'number', 0, { min: 0, max: 10, step: 1 });
  const slider = component('slider', { kind: 'preference', parameterId: 'number' }); f.page.components.push(slider);
  onClick(f, 'aliases', batch(f, 'slider', [['numberValue', 5], ['normalizedValue', .5], ['x', .8]]));
  const aliases = sample(f, [click('aliases')]); assert.equal(aliases.incomplete, true); assert.equal(aliases.variables.number, 0); assert.equal(aliases.controlValues.slider, 0); closeTo(shown(aliases, 'slider').x, .1);
  slider.propertyControls = { minimum: { mode: 'sync', parameterId: 'number' }, numberValue: { mode: 'sync', parameterId: 'number' } };
  onClick(f, 'feedback', batch(f, 'slider', [['normalizedValue', .5], ['x', .8]]));
  const feedback = sample(f, [click('feedback')]); assert.equal(feedback.incomplete, true); assert.equal(feedback.variables.number, 0); closeTo(shown(feedback, 'slider').x, .1);
  assert.ok(feedback.trace?.entries.some(entry => entry.reason?.includes('归一化值的来源同时改变')));
});

test('follow, conflicting shared values and invalid shared readers reject the whole batch and keep source animations', () => {
  for (const reason of ['follow', 'conflict', 'reader'] as const) {
    const f = fixture(); parameter(f, 'shared', .2);
    const target = component('target', { propertyControls: { x: { mode: 'sync', parameterId: 'shared' } } });
    const reader = component('reader', { propertyControls: { opacity: { mode: 'follow', parameterId: 'shared' } } }); f.page.components.push(target, reader);
    onClick(f, 'animate', node(f, 'animateUiProperty', { componentId: 'target', property: 'x', value: .8, duration: 2, easing: 'linear', wait: false }));
    if (reason !== 'reader') target.propertyControls!.y = { mode: reason === 'follow' ? 'follow' : 'sync', parameterId: 'shared' };
    onClick(f, 'reject', batch(f, 'target', [['x', reason === 'reader' ? 2 : .5], ['y', .6]]));
    const result = sample(f, [click('animate'), advance(.5), click('reject'), advance(.5)]);
    assert.equal(result.incomplete, true); closeTo(result.variables.shared, .5); closeTo(shown(result, 'reader').style?.opacity, .5);
    closeTo(shown(result, 'target').y, reason === 'reader' ? .2 : .5);
  }
});

test('multiple properties may write the same parameter only when their values agree', () => {
  const f = fixture(); parameter(f, 'shared', .2);
  f.page.components.push(component('target', { propertyControls: { x: { mode: 'sync', parameterId: 'shared' }, y: { mode: 'sync', parameterId: 'shared' } } }));
  onClick(f, 'write', batch(f, 'target', [['x', .6], ['y', .6]])); const result = sample(f, [click('write')]);
  assert.equal(result.incomplete, false); assert.equal(result.variables.shared, .6); closeTo(shown(result, 'target').x, .6); closeTo(shown(result, 'target').y, .6);
});

test('maxLength and text use the final Unicode-length pair for override and old source writes', () => {
  for (const mode of ['override', 'source'] as const) for (const reverse of [false, true]) {
    const f = fixture(); parameter(f, 'text', '旧文字很长');
    f.page.components.push(component('input', { kind: 'preferenceChoice', parameterId: 'text', input: { maxLength: 8 } }));
    const writes: Write[] = [['stringValue', '🦊a', mode], ['maxLength', 2]];
    onClick(f, 'write', batch(f, 'input', reverse ? [...writes].reverse() : writes));
    const result = sample(f, [click('write')]); assert.equal(result.incomplete, false); assert.equal(result.controlValues.input, '🦊a'); assert.equal(shown(result, 'input').input?.maxLength, 2); assert.equal(result.variables.text, mode === 'source' ? '🦊a' : '旧文字很长');
  }
});

test('maxLength-only batches inspect current local text while legacy single still permits reducing its limit', () => {
  const f = fixture(); parameter(f, 'text', '长文字');
  f.page.components.push(component('input', { kind: 'preferenceChoice', parameterId: 'text', input: { maxLength: 8 } }));
  onClick(f, 'overlay', node(f, 'setUiProperty', { componentId: 'input', property: 'stringValue', value: '覆盖文字' }));
  onClick(f, 'batch', batch(f, 'input', [['maxLength', 2], ['x', .8]]));
  onClick(f, 'single', node(f, 'setUiProperty', { componentId: 'input', property: 'maxLength', value: 2 }));
  const rejected = sample(f, [click('overlay'), click('batch')]); assert.equal(rejected.incomplete, true); assert.equal(rejected.controlValues.input, '覆盖文字'); assert.equal(shown(rejected, 'input').input?.maxLength, 8); closeTo(shown(rejected, 'input').x, .1);
  const legacy = sample(f, [click('overlay'), click('single')]); assert.equal(legacy.incomplete, false); assert.equal(legacy.controlValues.input, '覆盖文字'); assert.equal(shown(legacy, 'input').input?.maxLength, 2);
});

test('a source parameter changing both another input limit and target text uses the complete candidate', () => {
  for (const accepted of [false, true]) {
    const f = fixture(); parameter(f, 'limit', 8); parameter(f, 'text', '原文'); parameter(f, 'mirror_text', accepted ? '短' : '旧长文本');
    f.page.components.push(component('input', { kind: 'preferenceChoice', parameterId: 'text', propertyControls: {
      stringValue: { mode: 'sync', parameterId: 'text' }, maxLength: { mode: 'sync', parameterId: 'limit' },
    } }), component('mirror', { kind: 'preferenceChoice', parameterId: 'mirror_text', propertyControls: { maxLength: { mode: 'follow', parameterId: 'limit' } } }));
    onClick(f, 'write', batch(f, 'input', [['stringValue', '🦊a'], ['maxLength', 2], ['x', .8]]));
    const result = sample(f, [click('write')]); assert.equal(result.incomplete, !accepted);
    assert.equal(result.variables.limit, accepted ? 2 : 8); assert.equal(result.variables.text, accepted ? '🦊a' : '原文'); closeTo(shown(result, 'input').x, accepted ? .8 : .1);
    assert.equal(result.controlValues.mirror, accepted ? '短' : '旧长文本'); assert.equal(shown(result, 'mirror').input?.maxLength, accepted ? 2 : 8);
  }
});

test('source clearing an override validates final text and active legacy readers, preserving hidden readers and their own overrides', () => {
  for (const reader of ['active', 'overridden', 'closed'] as const) {
    const f = fixture(); parameter(f, 'text', '初');
    const input = component('input', { kind: 'preferenceChoice', parameterId: 'text', input: { maxLength: 8 } });
    const mirror = component('reader', { kind: 'preferenceChoice', parameterId: 'text', input: { maxLength: 2 } }); f.page.components.push(input);
    if (reader === 'closed') f.project.ui.customPages.push({ id: 'closed', name: '未打开', modal: true, background: '#172334', components: [mirror] }); else f.page.components.push(mirror);
    onClick(f, 'overlay', node(f, 'setUiProperty', { componentId: 'input', property: 'stringValue', value: '过长覆盖文字' }));
    if (reader === 'overridden') onClick(f, 'reader_overlay', node(f, 'setUiProperty', { componentId: 'reader', property: 'stringValue', value: '短' }));
    onClick(f, 'write', batch(f, 'input', [['stringValue', '三字长', 'source'], ['maxLength', 3], ['x', .8]]));
    const result = sample(f, [click('overlay'), ...(reader === 'overridden' ? [click('reader_overlay')] : []), click('write')]);
    if (reader === 'active') { assert.equal(result.incomplete, true); assert.equal(result.variables.text, '初'); assert.equal(result.controlValues.input, '过长覆盖文字'); closeTo(shown(result, 'input').x, .1); }
    else { assert.equal(result.incomplete, false); assert.equal(result.variables.text, '三字长'); assert.equal(result.controlValues.input, '三字长'); if (reader === 'overridden') assert.equal(result.controlValues.reader, '短'); }
  }
});

test('optionIndex uses the current edited option list and cannot coexist with its primary alias', () => {
  const f = fixture(); parameter(f, 'choice', 'A', { options: ['A', 'B'] });
  f.page.components.push(component('choice', { kind: 'preferenceChoice', parameterId: 'choice' }));
  const edit = onClick(f, 'edit', node(f, 'editUiControlOptions', { componentId: 'choice', operation: 'insert', index: 1, label: '运行值', value: '运行', valueType: 'string' }));
  const write = batch(f, 'choice', [['optionIndex', 1], ['x', .8]]); wire(f, edit, 'exec_out', write, 'exec_in');
  const result = sample(f, [click('edit')]); assert.equal(result.incomplete, false); assert.equal(result.controlValues.choice, '运行'); assert.equal(result.variables.choice, 'A');
  onClick(f, 'alias', batch(f, 'choice', [['optionIndex', 1], ['stringValue', 'B']])); const rejected = sample(f, [click('alias')]); assert.equal(rejected.incomplete, true); assert.equal(rejected.controlValues.choice, 'A');
});

test('player preference source changes are staged together and reject invalid character targets without local writes', () => {
  for (const badCharacter of [false, true]) {
    const f = fixture(); f.page.components.push(component('volume', { kind: 'preference', preference: badCharacter ? 'characterVolume' : 'musicVolume', ...(badCharacter ? { preferenceCharacterId: 'missing' } : {}) }));
    onClick(f, 'write', batch(f, 'volume', [['numberValue', .3, 'source'], ['x', .8]])); const result = sample(f, [click('write')]);
    assert.equal(result.incomplete, badCharacter); closeTo(shown(result, 'volume').x, badCharacter ? .1 : .8);
    if (badCharacter) assert.equal(result.characterVolumes.missing, undefined); else assert.equal(result.preferences.musicVolume, .3);
  }
});

test('source mode without an explicit property source is limited to the bound primary control value', () => {
  for (const property of ['font', 'image', 'video', 'spineAsset', 'hoverImage'] as const) {
    const f = fixture(); f.project.variables.push({ id: 'asset_source', name: '素材来源', type: 'asset', assetKind: property === 'video' ? 'video' : 'image', initial: '', persistent: false });
    const kind = property === 'image' ? 'image' : property === 'video' ? 'video' : property === 'spineAsset' ? 'spine' : property === 'hoverImage' ? 'button' : 'text';
    f.page.components.push(component('target', { kind, ...(['image', 'video'].includes(kind) ? { assetParameterId: 'asset_source' } : {}) }));
    onClick(f, 'reject', batch(f, 'target', [['x', .8], [property, '', 'source']]));
    const result = sample(f, [click('reject')]); assert.equal(result.incomplete, true); closeTo(shown(result, 'target').x, .1); assert.equal(result.variables.asset_source, '');
  }
});

test('a rejected batch preserves focus, pointer state and image/video request identities', () => {
  const f = fixture(); parameter(f, 'text', '原值');
  f.project.assets.push({ id: 'a', name: '甲', kind: 'image', path: 'assets/a.png' }, { id: 'b', name: '乙', kind: 'image', path: 'assets/b.png' }, { id: 'va', name: '视频甲', kind: 'video', path: 'assets/a.webm' }, { id: 'vb', name: '视频乙', kind: 'video', path: 'assets/b.webm' });
  f.page.components.push(component('input', { kind: 'preferenceChoice', parameterId: 'text' }), component('held', { kind: 'button' }), component('image', { kind: 'image', assetId: 'a' }), component('video', { kind: 'video', assetId: 'va' }));
  onClick(f, 'bad_input', batch(f, 'input', [['visible', false], ['width', -1]]));
  onClick(f, 'bad_image', batch(f, 'image', [['image', 'b'], ['width', -1]]));
  onClick(f, 'bad_video', batch(f, 'video', [['video', 'vb'], ['videoLoop', false], ['width', -1]]));
  onClick(f, 'bad_held', batch(f, 'held', [['visible', false], ['enabled', false], ['width', -1]]));
  const focus: UiPreviewEvent = { kind: 'focus', componentId: 'input', focused: true }, press: UiPreviewEvent = { kind: 'button', componentId: 'held', trigger: 'press' }, before = sample(f, [focus, press]);
  const result = sample(f, [focus, press, click('bad_input'), click('bad_image'), click('bad_video'), click('bad_held')]);
  assert.equal(result.incomplete, true); assert.equal(result.focusedComponentId, 'input'); assert.deepEqual(result.inputFocusCommand, before.inputFocusCommand);
  assert.equal(before.components.find(row => row.component.id === 'held')!.state, 'pressed'); assert.equal(result.components.find(row => row.component.id === 'held')!.state, 'pressed');
  assert.deepEqual(result.imageRequests.image, before.imageRequests.image); assert.deepEqual(result.videoRequests.video, before.videoRequests.video);
});

test('video replacement, loop and visibility prepare only the final request and equal batches keep its generation', () => {
  const f = fixture(); f.project.assets.push({ id: 'a', name: '甲', kind: 'video', path: 'assets/a.webm' }, { id: 'b', name: '乙', kind: 'video', path: 'assets/b.webm' });
  f.page.components.push(component('video', { kind: 'video', assetId: 'a', loop: true }));
  onClick(f, 'write', batch(f, 'video', [['video', 'b'], ['visible', false], ['videoLoop', false]]));
  const before = sample(f), result = sample(f, [click('write')]), repeated = sample(f, [click('write'), click('write')]);
  assert.equal(result.incomplete, false); assert.equal(result.videoRequests.video.assetId, 'b'); assert.equal(result.videoRequests.video.loop, false); assert.equal(result.videoRequests.video.suspended, true);
  assert.equal(result.videoRequests.video.sourceSequence, before.videoRequests.video.sourceSequence + 1); assert.equal(result.videoRequests.video.sequence, before.videoRequests.video.sequence + 2); assert.deepEqual(repeated.videoRequests.video, result.videoRequests.video);
});

test('candidate parameter conditions clear focus and pointer state and suspend media in the same commit', () => {
  const f = fixture(); parameter(f, 'shown', true); parameter(f, 'text', '原文');
  f.project.assets.push({ id: 'video_asset', name: '视频', kind: 'video', path: 'assets/video.webm' });
  const visibleWhen = { kind: 'compare' as const, variableId: 'shown', operator: 'eq' as const, value: true };
  f.page.components.push(component('target', { propertyControls: { visible: { mode: 'sync', parameterId: 'shown' } } }),
    component('input', { kind: 'preferenceChoice', parameterId: 'text', visibleWhen }), component('held', { kind: 'button', visibleWhen }), component('video', { kind: 'video', assetId: 'video_asset', visibleWhen }));
  onClick(f, 'write', batch(f, 'target', [['visible', false], ['x', .8]]));
  const prefix: UiPreviewEvent[] = [{ kind: 'focus', componentId: 'input', focused: true }, { kind: 'button', componentId: 'held', trigger: 'press' }];
  const before = sample(f, prefix), result = sample(f, [...prefix, click('write')]);
  assert.equal(result.incomplete, false); assert.equal(result.variables.shown, false); assert.equal(result.focusedComponentId, undefined); assert.equal(result.inputFocusCommand?.focused, false);
  assert.equal(result.components.find(row => row.component.id === 'held')!.state, 'idle'); assert.equal(result.videoRequests.video.suspended, true); assert.equal(result.videoRequests.video.sequence, before.videoRequests.video.sequence + 1); closeTo(shown(result, 'target').x, .8);
});

test('candidate asset parameters update ordinary bound media but preserve independent local overlays', () => {
  for (const kind of ['image', 'video'] as const) for (const overlay of [false, true]) {
    const f = fixture();
    f.project.assets.push({ id: 'a', name: '甲', kind, path: 'assets/a.' + (kind === 'image' ? 'png' : 'webm') }, { id: 'b', name: '乙', kind, path: 'assets/b.' + (kind === 'image' ? 'png' : 'webm') });
    f.project.variables.push({ id: 'asset_source', name: '素材', type: 'asset', assetKind: kind, initial: 'a', persistent: false });
    f.page.components.push(component('target', { kind, assetId: 'a', propertyControls: { [kind]: { mode: 'sync', parameterId: 'asset_source' } } }), component('reader', { kind, assetId: 'a', assetParameterId: 'asset_source' }));
    onClick(f, 'overlay', node(f, 'setUiProperty', { componentId: 'reader', property: kind, value: 'a' }));
    onClick(f, 'write', batch(f, 'target', [[kind, 'b'], ['x', .8]]));
    const result = sample(f, [...(overlay ? [click('overlay')] : []), click('write')]);
    assert.equal(result.incomplete, false); assert.equal(result.variables.asset_source, 'b'); assert.equal(shown(result, 'target').assetId, 'b'); assert.equal(shown(result, 'reader').assetId, overlay ? 'a' : 'b');
    assert.equal((kind === 'image' ? result.imageRequests : result.videoRequests).reader.assetId, overlay ? 'a' : 'b');
  }
});

test('finite fields that overflow composed layout reject the complete batch before changing animation ownership', () => {
  for (const property of ['x', 'width', 'scaleX', 'layoutRotation'] as const) {
    const f = fixture(); f.page.components.push(component('target', { style: { opacity: .2 } })); parameter(f, 'after', false);
    onClick(f, 'animate', node(f, 'animateUiProperty', { componentId: 'target', property: 'opacity', value: 1, duration: 2, easing: 'linear', wait: false }));
    const set = onClick(f, 'reject', batch(f, 'target', [['opacity', .3], [property, Number.MAX_VALUE]])), after = node(f, 'setVariable', { variableId: 'after', value: true }); wire(f, set, 'exec_out', after, 'exec_in');
    const result = sample(f, [click('animate'), advance(.5), click('reject'), advance(.5)]);
    assert.equal(result.incomplete, true); closeTo(shown(result, 'target').style?.opacity, .6); assert.equal(result.variables.after, false);
    closeTo(shown(result, 'target').x, .1); closeTo(shown(result, 'target').width, .4); assert.ok(result.trace?.entries.some(entry => entry.reason?.includes('布局超出可计算范围')));
  }
});

test('an unopened target is checked for layout overflow without opening its page or creating media requests', () => {
  const f = fixture(); parameter(f, 'after', false);
  f.project.ui.customPages.push({ id: 'closed', name: '未打开', modal: true, components: [component('closed_target', { kind: 'video' })] });
  const set = onClick(f, 'reject', batch(f, 'closed_target', [['width', Number.MAX_VALUE], ['x', .8]])), after = node(f, 'setVariable', { variableId: 'after', value: true }); wire(f, set, 'exec_out', after, 'exec_in');
  const result = sample(f, [click('reject')]); assert.equal(result.incomplete, true); assert.equal(result.variables.after, false);
  assert.equal(result.layers.some(page => page.pageId === 'closed'), false); assert.equal(result.videoRequests.closed_target, undefined); assert.ok(result.trace?.entries.some(entry => entry.reason?.includes('布局超出可计算范围')));
});

test('Spine asset and explicit skin commit as one request in either order and equal writes do not restart', () => {
  for (const reverse of [false, true]) {
    const f = fixture();
    for (const [id, skin] of [['rig_a', 'old'], ['rig_b', 'new']]) f.project.assets.push({ id, name: id, kind: 'spine', path: `assets/${id}.json`, spine: { version: '4.2.43', atlasPath: `assets/${id}.atlas`, pages: [{ name: 'page.png', path: `assets/${id}.png`, width: 64, height: 64 }], bounds: { x: 0, y: 0, width: 64, height: 64 }, skins: [skin], animations: [{ name: 'idle', duration: 1 }] } });
    f.page.components.push(component('rig', { kind: 'spine', assetId: 'rig_a', spine: { skin: 'old', autoplay: false } }));
    const writes: Write[] = [['spineAsset', 'rig_b'], ['spineSkin', 'new'], ['spineSpeed', 2]];
    onClick(f, 'swap', batch(f, 'rig', reverse ? [...writes].reverse() : writes));
    onClick(f, 'bad', batch(f, 'rig', [['spineAsset', 'rig_b'], ['spineSkin', 'old'], ['x', .8]]));
    const before = sample(f), result = sample(f, [click('swap')]), repeated = sample(f, [click('swap'), click('swap')]);
    assert.equal(result.incomplete, false); assert.equal(result.spineRequests.rig.assetId, 'rig_b'); assert.equal(result.spineRequests.rig.skin, 'new'); assert.equal(result.spineRequests.rig.speed, 2); assert.equal(result.spineRequests.rig.sequence, before.spineRequests.rig.sequence + 1); assert.equal(result.spineRequests.rig.sourceSequence, before.spineRequests.rig.sourceSequence + 1);
    assert.deepEqual(repeated.spineRequests.rig, result.spineRequests.rig);
    const rejected = sample(f, [click('bad')]); assert.equal(rejected.incomplete, true); assert.deepEqual(rejected.spineRequests.rig, before.spineRequests.rig); closeTo(shown(rejected, 'rig').x, .1);
  }
});

test('pure media preparation rejects actual counter growth at MAX while allowing unchanged records', () => {
  const max = Number.MAX_SAFE_INTEGER;
  const video = { ...uiVideoRequest(undefined, 'a', true, 1), sequence: max, sourceSequence: max }, savedVideo = structuredClone(video);
  assert.equal(suspendUiVideo(uiVideoRequest(video, 'a', true, 1), false), video);
  assert.throws(() => uiVideoRequest(video, 'b', true, 1)); assert.throws(() => uiVideoRequest(video, 'a', false, 1)); assert.throws(() => suspendUiVideo(video, true));
  assert.throws(() => suspendUiVideo(uiVideoRequest({ ...video, sequence: max - 1, sourceSequence: 1 }, 'b', true, 1), true));
  assert.deepEqual(video, savedVideo);
  const asset = { id: 'rig', name: '骨骼', kind: 'spine' as const, path: 'assets/rig.json', spine: { version: '4.2.43', atlasPath: 'assets/rig.atlas', pages: [{ name: 'page.png', path: 'assets/page.png', width: 64, height: 64 }], bounds: { x: 0, y: 0, width: 64, height: 64 }, skins: ['one', 'two'], animations: [] } };
  const spine = { ...uiSpineRequest(undefined, asset, { skin: 'one', speed: 1 }, 1), sequence: max, sourceSequence: max }, savedSpine = structuredClone(spine);
  assert.equal(suspendUiSpine(uiSpineRequest(spine, asset, { skin: 'one', speed: 1 }, 1), false), spine);
  assert.throws(() => uiSpineRequest(spine, { ...asset, id: 'replacement' }, { skin: 'one' }, 1)); assert.throws(() => uiSpineRequest(spine, asset, { skin: 'two' }, 1)); assert.throws(() => suspendUiSpine(spine, true));
  assert.throws(() => suspendUiSpine(uiSpineRequest({ ...spine, sequence: max - 1, sourceSequence: 1 }, { ...asset, id: 'replacement' }, { skin: 'two' }, 1), true));
  assert.deepEqual(spine, savedSpine);
});

test('unrelated malformed, pending and MAX media requests are never read or adopted by a text batch', () => {
  const targets: { id: string; values: Record<string, VariableValue> }[] = [{ id: 'button', values: { text: '更新文字' } }, { id: 'video', values: { opacity: .3, layer: 2 } }, { id: 'rig', values: { opacity: .3, layer: 2 } }];
  for (const state of ['invalid', 'pending', 'max'] as const) for (const target of targets) {
    const f = mediaPreparationFixture(), max = Number.MAX_SAFE_INTEGER;
    const badVersion = { version: 9 as 1 }, pending = { sequence: state === 'max' ? max : 5, sourceSequence: state === 'max' ? max : 3 };
    f.requests.images.set('image', { ...f.records.image, assetId: 'image_b', baseId: 'image_b', ...(state === 'invalid' ? badVersion : { sequence: pending.sequence }) });
    f.requests.videos.set('video', { ...f.records.video, assetId: 'video_b', ...(state === 'invalid' ? badVersion : pending) });
    f.requests.spines.set('rig', { ...f.records.spine, assetId: 'rig_b', ...(state === 'invalid' ? badVersion : pending) });
    const saved = structuredClone([...Object.values(f.requests).map(requests => [...requests])]);
    const after = f.snapshot(f.components, { [target.id]: target.values }), prepared = f.prepare(target, after);
    assert.deepEqual([prepared.images.size, prepared.videos.size, prepared.spines.size], [0, 0, 0]);
    for (const requests of Object.values(f.requests)) assert.deepEqual(requests.reads, []);
    assert.deepEqual([...Object.values(f.requests).map(requests => [...requests])], saved);
  }
});

test('explicit equal media properties still validate their own request while equal indirect readers stay untouched', () => {
  for (const [id, property, value] of [['video', 'video', 'video_a'], ['video', 'videoLoop', true], ['video', 'videoPoster', ''], ['rig', 'spineAsset', 'rig_a'], ['rig', 'spineLoop', true], ['rig', 'spineFit', 'contain']] as const) {
    const f = mediaPreparationFixture(), table = id === 'video' ? f.requests.videos : f.requests.spines;
    if (id === 'video') f.requests.videos.set(id, { ...f.records.video, version: 9 as 1 }); else f.requests.spines.set(id, { ...f.records.spine, version: 9 as 1 });
    const equal = f.snapshot(f.components, { [id]: { [property]: value } }), saved = structuredClone([...table]);
    const ordinary = f.prepare({ id: 'button', values: { text: '同值参数读者' } }, equal);
    assert.deepEqual([ordinary.videos.size, ordinary.spines.size], [0, 0]); assert.deepEqual(table.reads, []);
    assert.throws(() => f.prepare({ id, values: { [property]: value } }, equal)); assert.deepEqual(table.reads, [id]); assert.deepEqual([...table], saved);
  }
});

test('selected media requests reject source, setting and suspension growth at MAX without mutating live tables', () => {
  for (const kind of ['video', 'spine'] as const) {
    const f = mediaPreparationFixture(), max = Number.MAX_SAFE_INTEGER, id = kind === 'video' ? 'video' : 'rig', table = kind === 'video' ? f.requests.videos : f.requests.spines;
    const sourceProperty = kind === 'video' ? 'video' : 'spineAsset', sourceValue = kind === 'video' ? 'video_a' : 'rig_a';
    if (kind === 'video') f.requests.videos.set(id, { ...f.records.video, sequence: max, sourceSequence: max });
    else f.requests.spines.set(id, { ...f.records.spine, sequence: max, sourceSequence: max });
    const saved = structuredClone([...table]), equal = f.prepare({ id, values: { [sourceProperty]: sourceValue } });
    assert.equal((kind === 'video' ? equal.videos : equal.spines).get(id), [...table][0][1]);
    const changed = [{ [sourceProperty]: kind === 'video' ? 'video_b' : 'rig_b' }, { [kind === 'video' ? 'videoLoop' : 'spineSpeed']: kind === 'video' ? false : 2 }];
    for (const values of changed) assert.throws(() => f.prepare({ id: 'button', values: { text: '联动' } }, f.snapshot(f.components, { [id]: values })));
    assert.throws(() => f.prepare({ id: 'button', values: { text: '条件隐藏' } }, f.snapshot(f.components, {}, component => component.id !== id)));
    assert.deepEqual([...table], saved);
    if (kind === 'video') f.requests.videos.set(id, { ...f.records.video, sequence: max - 1 }); else f.requests.spines.set(id, { ...f.records.spine, sequence: max - 1 });
    const savedBeforeOverflow = structuredClone([...table]);
    assert.throws(() => f.prepare({ id, values: { [sourceProperty]: kind === 'video' ? 'video_b' : 'rig_b', visible: false } }, f.snapshot(f.components, { [id]: changed[0] }, component => component.id !== id)));
    assert.deepEqual([...table], savedBeforeOverflow);
  }
});

test('ancestor movement, ancestor hiding and sibling flow all select the affected media before any commit', () => {
  for (const kind of ['video', 'spine'] as const) for (const change of ['move', 'hide', 'flow'] as const) {
    const id = kind === 'video' ? 'video' : 'rig', components = [component('container', { kind: 'panel', x: 0, y: 0, width: .6, height: .6, layout: { version: 1, flow: 'horizontal', clip: true } }),
      component('sibling', { parentId: 'container', x: 0, y: 0, width: .2, height: 1 }), component(id, { kind, assetId: kind === 'video' ? 'video_a' : 'rig_a', parentId: 'container', x: 0, y: 0, width: .5, height: 1 })];
    const f = mediaPreparationFixture(components);
    if (kind === 'video') f.requests.videos.set(id, { ...f.records.video, version: 9 as 1 }); else f.requests.spines.set(id, { ...f.records.spine, version: 9 as 1 });
    const afterRows = components.map(component => ({ ...component }));
    if (change === 'move') afterRows[0].x = .3; if (change === 'flow') afterRows[1].width = 1.2;
    const after = f.snapshot(afterRows, {}, component => change !== 'hide' || component.id !== 'container');
    if (change === 'flow') { assert.equal(f.before.geometry.get(id)?.clippedOut, false); assert.equal(after.geometry.get(id)?.clippedOut, true); }
    assert.throws(() => f.prepare({ id: change === 'flow' ? 'sibling' : 'container', values: change === 'hide' ? { visible: false } : change === 'flow' ? { width: 1.2 } : { x: .3 } }, after));
  }
});

test('an image inherited state change is prepared while unrelated video and Spine records remain unread', () => {
  const f = mediaPreparationFixture(); f.requests.videos.set('video', { ...f.records.video, version: 9 as 1 }); f.requests.spines.set('rig', { ...f.records.spine, version: 9 as 1 });
  const after = { ...f.snapshot(), imageState: () => 'pressed' as const }, prepared = f.prepare({ id: 'button', values: { selected: true } }, after);
  assert.equal(prepared.images.get('image')?.assetId, 'image_b'); assert.equal(prepared.images.get('image')?.sequence, f.records.image.sequence + 1);
  assert.deepEqual(f.requests.images.reads, ['image']); assert.deepEqual(f.requests.videos.reads, []); assert.deepEqual(f.requests.spines.reads, []);
  assert.equal(f.requests.images.get('image'), f.records.image);
});

test('rows retained for semantic repair remain visible to the interpreter but are never partially executed', () => {
  const f = fixture(); f.page.components.push(component('target'));
  const set = onClick(f, 'bad', batch(f, 'target', [['x', .8], ['missingProperty', 4]]));
  assert.equal(blueprintUiPropertyDefinition(set).rows?.length, 2);
  const before = structuredClone(set), result = sample(f, [click('bad')]);
  assert.equal(result.incomplete, true); closeTo(shown(result, 'target').x, .1); assert.deepEqual(set, before);
});
