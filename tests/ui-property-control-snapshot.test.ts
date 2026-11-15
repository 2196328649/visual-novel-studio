import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, type UiComponent } from '../src/core/model';
import { uiPropertyControlDesignSnapshot, uiPropertyControlSnapshot } from '../src/core/ui-property-control-snapshot';

const object = (patch: Partial<UiComponent> = {}): UiComponent => ({ id: 'text', name: '文字', kind: 'text', page: 'say', text: '原文字', x: .1, y: .2, width: .3, height: .1, ...patch });
function scene() {
  const project = createProject('对白参数快照');
  project.variables = [
    { id: 'position', name: '位置', type: 'number', initial: .1, persistent: false },
    { id: 'alpha', name: '不透明度', type: 'number', initial: .2, persistent: false },
    { id: 'caption', name: '文字', type: 'string', initial: '初始文字', persistent: false },
    { id: 'shown', name: '显示', type: 'boolean', initial: true, persistent: false },
    { id: 'color', name: '颜色', type: 'string', initial: '#112233', persistent: false },
  ];
  return project;
}

test('story snapshots use current follow and sync values while design snapshots keep their initial values', () => {
  const project = scene(), component = object({ binding: 'dialogue', style: { opacity: 1 }, propertyControls: {
    x: { mode: 'follow', parameterId: 'position' }, opacity: { mode: 'sync', parameterId: 'alpha' }, text: { mode: 'follow', parameterId: 'caption' }, visible: { mode: 'sync', parameterId: 'shown' },
  } });
  const current = { position: 0, alpha: .6, caption: '', shown: false }, before = structuredClone({ project, component, current });
  const snapshot = uiPropertyControlSnapshot(project, component, current), design = uiPropertyControlDesignSnapshot(project, component);
  assert.equal(snapshot.component.x, 0); assert.equal(snapshot.component.style?.opacity, .6);
  assert.equal(snapshot.component.text, ''); assert.equal(snapshot.component.binding, undefined); assert.equal(snapshot.values.visible, false);
  assert.equal(design.component.x, .1); assert.equal(design.component.style?.opacity, .2); assert.equal(design.component.text, '初始文字');
  snapshot.component.style!.opacity = .4;
  assert.deepEqual({ project, component, current }, before);
});

test('a valid current value is accepted even if its initial value is invalid; absent current keys use initial values', () => {
  const project = scene(), component = object({ style: { opacity: .8 }, propertyControls: {
    opacity: { mode: 'follow', parameterId: 'alpha' }, x: { mode: 'sync', parameterId: 'position' },
  } });
  project.variables.find(variable => variable.id === 'alpha')!.initial = 5;
  assert.equal(uiPropertyControlDesignSnapshot(project, component).component.style?.opacity, .8);
  const snapshot = uiPropertyControlSnapshot(project, component, { alpha: .6 });
  assert.equal(snapshot.component.style?.opacity, .6); assert.equal(snapshot.component.x, .1);
});

test('invalid metadata or current fields retain their authored values without discarding valid siblings', () => {
  const project = scene(), component = object({ binding: 'dialogue', style: { opacity: .8 }, propertyControls: {
    opacity: { mode: 'follow', parameterId: 'alpha' }, text: { mode: 'sync', parameterId: 'caption' }, x: { mode: 'follow', parameterId: 'position' },
    y: { mode: 'follow', parameterId: 'missing' }, width: { mode: 'follow', parameterId: 'caption' }, unsupported: { mode: 'follow', parameterId: 'alpha' },
  } });
  const before = structuredClone(component);
  const snapshot = uiPropertyControlSnapshot(project, component, { alpha: 2, caption: 123, position: .7 });
  assert.equal(snapshot.component.style?.opacity, .8); assert.equal(snapshot.component.text, '原文字'); assert.equal(snapshot.component.binding, 'dialogue');
  assert.equal(snapshot.component.x, .7); assert.equal(snapshot.component.y, .2); assert.equal(snapshot.component.width, .3);
  assert.deepEqual(snapshot.values, { x: .7 }); assert.deepEqual(component, before);
  const plain = object(); assert.equal(uiPropertyControlSnapshot(project, plain, {}).component, plain);
  const invalidOnly = object({ propertyControls: { opacity: { mode: 'follow', parameterId: 'missing' } } });
  assert.equal(uiPropertyControlSnapshot(project, invalidOnly, {}).component, invalidOnly);
});

test('current range pairs are validated together and clamp only the displayed source value', () => {
  const project = scene();
  project.variables.push(
    { id: 'value', name: '值', type: 'number', initial: 30, persistent: false },
    { id: 'min', name: '下限', type: 'number', initial: 0, persistent: false },
    { id: 'max', name: '上限', type: 'number', initial: 40, persistent: false },
  );
  const component = object({ kind: 'preference', parameterId: 'value', controlRange: { min: 0, max: 40, step: 2 }, propertyControls: {
    numberValue: { mode: 'follow', parameterId: 'value' }, minimum: { mode: 'sync', parameterId: 'min' }, maximum: { mode: 'sync', parameterId: 'max' },
  } });
  const current = { value: 200, min: 60, max: 100 }, before = structuredClone({ component, project, current });
  const snapshot = uiPropertyControlSnapshot(project, component, current);
  assert.deepEqual(snapshot.component.controlRange, { min: 60, max: 100, step: 2 });
  assert.equal(snapshot.values.numberValue, 100); assert.equal(snapshot.component.readOnly, true);
  assert.deepEqual({ component, project, current }, before);
  const invalid = uiPropertyControlSnapshot(project, component, { value: 200, min: 110, max: 100 });
  assert.deepEqual(invalid.component.controlRange, component.controlRange); assert.equal(invalid.values.numberValue, 40);
  assert.equal(invalid.values.minimum, undefined); assert.equal(invalid.values.maximum, undefined);
});

test('current text controls honor the current length limit and reject invalid options without changing sources', () => {
  const project = scene();
  project.variables.push({ id: 'limit', name: '长度', type: 'number', initial: 2, persistent: false }, { id: 'source', name: '默认文字', type: 'string', initial: '默认', persistent: false });
  const component = object({ kind: 'preference', parameterId: 'source', input: { maxLength: 2 }, propertyControls: {
    stringValue: { mode: 'sync', parameterId: 'caption' }, maxLength: { mode: 'follow', parameterId: 'limit' },
  } });
  const valid = uiPropertyControlSnapshot(project, component, { caption: '一😀二', limit: 3 });
  assert.equal(valid.values.stringValue, '一😀二'); assert.equal(valid.component.input?.maxLength, 3);
  const invalid = uiPropertyControlSnapshot(project, component, { caption: '一😀二三', limit: 3 });
  assert.equal(invalid.values.stringValue, undefined); assert.equal(invalid.component.input?.maxLength, 3);
  project.variables.find(variable => variable.id === 'source')!.setting = { options: ['默认', '另一项'] };
  assert.equal(uiPropertyControlSnapshot(project, component, { caption: '不存在的选项', limit: 30 }).values.stringValue, undefined);
});

test('legacy current-value aliases resolve to the typed source and conflicting aliases stay authored', () => {
  const project = scene();
  project.variables.push({ id: 'source', name: '值', type: 'number', initial: 20, persistent: false });
  const component = object({ kind: 'preference', parameterId: 'source', controlRange: { min: 0, max: 100, step: 1 }, propertyControls: {
    normalizedValue: { mode: 'sync', parameterId: 'source' },
  } });
  const snapshot = uiPropertyControlSnapshot(project, component, { source: 75 });
  assert.deepEqual(snapshot.values, { numberValue: 75 });
  const conflicting = { ...component, propertyControls: { ...component.propertyControls, numberValue: { mode: 'follow' as const, parameterId: 'source' } } };
  const invalid = uiPropertyControlSnapshot(project, conflicting, { source: 75 });
  assert.deepEqual(invalid.values, {}); assert.equal(invalid.component, conflicting);
});

test('current Spine skin sources must belong to the current asset while independent properties still update', () => {
  const project = scene();
  project.assets.push({ id: 'rig', name: '骨骼', kind: 'spine', path: 'rig.json', spine: {
    version: '4.2', atlasPath: 'rig.atlas', pages: [{ name: 'rig.png', path: 'rig.png', width: 16, height: 16 }],
    animations: [], skins: ['default', 'coat'], bounds: { x: 0, y: 0, width: 16, height: 16 },
  } });
  const component = object({ kind: 'spine', assetId: 'rig', spine: { skin: 'default' }, propertyControls: {
    spineSkin: { mode: 'follow', parameterId: 'caption' }, opacity: { mode: 'sync', parameterId: 'alpha' },
  } });
  assert.equal(uiPropertyControlSnapshot(project, component, { caption: 'coat' }).component.spine?.skin, 'coat');
  const invalid = uiPropertyControlSnapshot(project, component, { caption: 'missing', alpha: .6 });
  assert.equal(invalid.component.spine?.skin, 'default'); assert.equal(invalid.component.style?.opacity, .6);
  assert.equal(uiPropertyControlSnapshot(project, component, { caption: '' }).component.spine?.skin, '');
});

test('current legacy media follows a valid source and explicit empty media never falls back to the legacy binding', () => {
  const project = scene();
  project.assets = [{ id: 'original', name: '原图', kind: 'image', path: 'original.png' }, { id: 'next', name: '新图', kind: 'image', path: 'next.png' }];
  project.variables.push({ id: 'legacy', name: '旧图片参数', type: 'asset', assetKind: 'image', initial: 'original', persistent: false }, { id: 'image', name: '图片参数', type: 'asset', assetKind: 'image', initial: 'original', persistent: false });
  const component = object({ kind: 'image', assetId: 'original', assetParameterId: 'legacy' }), before = structuredClone(component);
  assert.equal(uiPropertyControlSnapshot(project, component, { legacy: 'next' }).component.assetId, 'next');
  assert.equal(uiPropertyControlSnapshot(project, component, { legacy: '' }).component.assetId, 'original');
  assert.equal(uiPropertyControlSnapshot(project, component, { legacy: 'missing' }).component.assetId, 'original');
  const explicit = { ...component, propertyControls: { image: { mode: 'sync' as const, parameterId: 'image' } } };
  const cleared = uiPropertyControlSnapshot(project, explicit, { legacy: 'next', image: '' });
  assert.equal(cleared.component.assetId, ''); assert.equal(cleared.component.assetParameterId, undefined);
  assert.equal(uiPropertyControlSnapshot(project, explicit, { legacy: 'next', image: 'missing' }).component.assetId, 'original');
  assert.deepEqual(component, before);
});

test('base color controls reach unspecified states while independently authored or linked colors retain priority', () => {
  const project = scene(), component = object({ kind: 'button', style: { background: '#101010', hoverBackground: '#202020' }, propertyControls: {
    background: { mode: 'sync', parameterId: 'color' },
  } });
  const snapshot = uiPropertyControlSnapshot(project, component, { color: '#abcdef' });
  assert.equal(snapshot.component.style?.background, '#abcdef'); assert.equal(snapshot.component.style?.disabledBackground, '#abcdef');
  assert.equal(snapshot.component.style?.hoverBackground, '#202020'); assert.equal(snapshot.component.style?.selectedBackground, undefined);
  const plain = { ...component, style: { background: '#101010' } }, inherited = uiPropertyControlSnapshot(project, plain, { color: '#abcdef' });
  assert.equal(inherited.component.style?.selectedBackground, '#abcdef'); assert.equal(inherited.component.style?.pressedBackground, '#abcdef');
  const linked = { ...plain, propertyControls: { ...plain.propertyControls, selectedBackground: { mode: 'follow' as const, parameterId: 'caption' } } };
  assert.equal(uiPropertyControlSnapshot(project, linked, { color: '#abcdef', caption: '#fedcba' }).component.style?.selectedBackground, '#fedcba');
  assert.equal(uiPropertyControlDesignSnapshot(project, plain).component.style?.selectedBackground, undefined);
});
