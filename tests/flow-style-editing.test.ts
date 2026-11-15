import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject, projectSchema, type UiComponent } from '../src/core/model';
import { flowCaptionSlot } from '../src/core/flow-style';
import {
  editFlowCaptionSlot, editFlowCaptionText, flowCaptionSlotIndex, flowTextBackdropMode, flowTextBackdropOpacity,
  hasFlowNodeAppearance, hasFlowStyleGroup, resetFlowNodeAppearance, resetFlowStyleGroup, setFlowBackdropOpacity,
  type FlowCaptionStyles, type FlowNodeStyle,
} from '../src/core/flow-style-editing';

test('map and preset letter spacing preserve signed fractions, explicit zero and absent inheritance through JSON', () => {
  for (const letterSpacing of [-2.75, 0, 1.5, undefined]) {
    const project = createProject('字间距往返');
    const component: UiComponent = { id: 'spacing_map', page: 'flowchart', kind: 'flowchart', text: '', x: 0, y: 0, width: 1, height: 1,
      style: { letterSpacing, captionParts: [{ letterSpacing, gap: 0 }, { gap: 13 }] } };
    project.ui.components.push(component);
    project.ui.flowStyles = [{ id: 'spacing_preset', name: '字间距预设', style: { letterSpacing, captionParts: [{ letterSpacing, gap: 0 }, { gap: 13 }] } }];
    const before = JSON.stringify(project);
    const saved = projectSchema.parse(JSON.parse(JSON.stringify(projectSchema.parse(project))));
    const styles = [saved.ui.components[0].style!, saved.ui.flowStyles![0].style!];
    for (const style of styles) {
      assert.equal(style.letterSpacing, letterSpacing);
      assert.equal(Object.hasOwn(style, 'letterSpacing'), letterSpacing !== undefined);
      assert.equal(style.captionParts![0].letterSpacing, letterSpacing);
      assert.equal(Object.hasOwn(style.captionParts![0], 'letterSpacing'), letterSpacing !== undefined);
      assert.equal(style.captionParts![0].gap, 0, 'zero gap is independent from zero letter spacing');
      assert.deepEqual(style.captionParts![1], { gap: 13 });
    }
    assert.equal(JSON.stringify(project), before, 'schema validation must not materialize inherited fields');
  }
});

test('non-finite letter spacing is rejected in map and preset text and caption fields', () => {
  for (const value of [NaN, Infinity, -Infinity]) for (const location of ['map', 'map-caption', 'preset', 'preset-caption'] as const) {
    const project = createProject('无效字间距');
    project.ui.components.push({ id: 'spacing_map', page: 'flowchart', kind: 'flowchart', text: '', x: 0, y: 0, width: 1, height: 1, style: {} });
    project.ui.flowStyles = [{ id: 'spacing_preset', name: '字间距预设', style: {} }];
    const style = location.startsWith('map') ? project.ui.components[0].style! : project.ui.flowStyles[0].style!;
    if (location.endsWith('caption')) style.captionParts = [{ letterSpacing: value }];
    else style.letterSpacing = value;
    const result = projectSchema.safeParse(project);
    assert.equal(result.success, false, `${location} should reject ${String(value)} before JSON serialization`);
    if (!result.success) assert.ok(result.error.issues.some(issue => issue.path.at(-1) === 'letterSpacing'), `${location} should identify the invalid spacing field`);
  }
});

test('caption editing uses the renderer end alignment, including shared leading texts and unused slots', () => {
  for (let slots = 1; slots <= 8; slots++) {
    const parts = Array.from({ length: slots }, (_, index) => ({ fontSize: 20 + index }));
    for (let texts = 1; texts <= 12; texts++) for (let text = 0; text < texts; text++) {
      const slot = flowCaptionSlotIndex(slots, texts, text)!;
      assert.equal(parts[slot], flowCaptionSlot(parts, texts, text));
    }
  }
  assert.equal(flowCaptionSlotIndex(3, 1, 0), 2);
  assert.equal(flowCaptionSlotIndex(2, 3, 0), 0);
  assert.equal(flowCaptionSlotIndex(2, 3, 1), 0);
  for (const [slots, texts, index] of [[0, 1, 0], [1, 0, 0], [2, 2, -1], [2, 2, 2], [2, 2, .5], [1.5, 2, 0], [2, Infinity, 0]]) {
    assert.equal(flowCaptionSlotIndex(slots, texts, index), undefined);
  }
});

test('a caption field edit preserves other slots and explicit zero gaps without mutating inherited data', () => {
  const parts: FlowCaptionStyles = [{ fontSize: 24, gap: 0 }, { color: '#112233', fontSize: 40 }, { fontAssetId: 'unused-font' }];
  const before = JSON.stringify(parts);
  const changed = editFlowCaptionText(parts, 2, 0, 'fontSize', 60)!;
  assert.equal(changed[1].fontSize, 60);
  assert.equal(changed[1].color, '#112233');
  assert.equal(changed[0], parts[0]); assert.equal(changed[2], parts[2]);
  const cleared = editFlowCaptionSlot(changed, 1, 'fontSize', undefined);
  assert.deepEqual(cleared[1], { color: '#112233' });
  assert.equal(cleared[0].gap, 0);
  assert.equal(JSON.stringify(parts), before);
  assert.equal(editFlowCaptionSlot(parts, -1, 'gap', 8), parts);
  assert.equal(editFlowCaptionSlot(parts, 3, 'gap', 8), parts);
  assert.equal(editFlowCaptionSlot(parts, .5, 'gap', 8), parts);
});

test('letter spacing resets only the selected trailing slot and preserves gap and other text styles', () => {
  const parts: FlowCaptionStyles = [{ letterSpacing: 3, gap: 0, fontSize: 22 }, { letterSpacing: -1.25, gap: 13, color: '#112233' }, { letterSpacing: 0, gap: 0 }];
  const before = JSON.stringify(parts);
  const changed = editFlowCaptionText(parts, 2, 0, 'letterSpacing', 0)!;
  assert.deepEqual(changed[1], { letterSpacing: 0, gap: 13, color: '#112233' });
  assert.equal(changed[0], parts[0]); assert.equal(changed[2], parts[2]);
  const cleared = editFlowCaptionSlot(changed, 1, 'letterSpacing', undefined);
  assert.deepEqual(cleared[1], { gap: 13, color: '#112233' });
  assert.equal(Object.hasOwn(cleared[1], 'letterSpacing'), false);
  assert.equal(cleared[0], parts[0]); assert.equal(cleared[2], parts[2]);
  assert.equal(JSON.stringify(parts), before);
  assert.deepEqual(editFlowCaptionText(undefined, 2, 1, 'letterSpacing', 0), [{}, { letterSpacing: 0 }]);
  assert.equal(editFlowCaptionText(undefined, 2, 1, 'letterSpacing', undefined), undefined);
});

test('restoring base text clears explicit zero spacing while retaining every segment override and unrelated group', () => {
  const parts: FlowCaptionStyles = [{ letterSpacing: -.5, gap: 0 }, { letterSpacing: 0, gap: 17 }];
  const target: { style?: FlowNodeStyle } = { style: { letterSpacing: 0, captionParts: parts, opacity: .35, shadowBlur: 14 } };
  assert.equal(hasFlowStyleGroup(target.style, 'text'), true);
  resetFlowStyleGroup(target, 'text');
  assert.deepEqual(target.style, { captionParts: parts, opacity: .35, shadowBlur: 14 });
  assert.equal(target.style?.captionParts, parts);
  assert.equal(hasFlowStyleGroup(target.style, 'text'), false);
  resetFlowNodeAppearance(target, false);
  assert.deepEqual(target, { style: { opacity: .35 } });
});

test('only explicit caption edits create bounded style arrays, and clearing absent overrides is a no-op', () => {
  const empty: FlowCaptionStyles = [];
  assert.equal(editFlowCaptionText(undefined, 2, 0, 'fontSize', undefined), undefined);
  assert.equal(editFlowCaptionText(empty, 2, 0, 'fontSize', undefined), empty);
  assert.equal(editFlowCaptionText(undefined, 2, 2, 'fontSize', 24), undefined);
  assert.deepEqual(editFlowCaptionText(undefined, 2, 1, 'fontSize', 24), [{}, { fontSize: 24 }]);
  const many = editFlowCaptionText(undefined, 10, 0, 'gap', 0)!;
  assert.equal(many.length, 8);
  assert.deepEqual(many[0], { gap: 0 });
  assert.equal(flowCaptionSlotIndex(many.length, 10, 2), 0);
});

test('visual group resets preserve every other group and the map opacity', () => {
  const target = { style: { fontSize: 28, captionParts: [{ gap: 0 }], background: '#223344', radius: 8, outlineWidth: 2, shadowBlur: 14, shadowOpacity: 0, opacity: .35 } as FlowNodeStyle };
  assert.equal(hasFlowStyleGroup(target.style, 'shadow'), true);
  resetFlowStyleGroup(target, 'shadow');
  assert.deepEqual(target.style, { fontSize: 28, captionParts: [{ gap: 0 }], background: '#223344', radius: 8, outlineWidth: 2, opacity: .35 });
  assert.equal(hasFlowStyleGroup(target.style, 'shadow'), false);
  resetFlowStyleGroup(target, 'text');
  assert.deepEqual(target.style.captionParts, [{ gap: 0 }]);
  assert.equal(target.style.opacity, .35);
});

test('resetting all base node appearance preserves general map style and layout', () => {
  const target = {
    x: .1, y: .2, width: .8, height: .7, name: '地图',
    style: { opacity: .35, playerOpacity: true, imageFit: 'contain', fontSize: 60, captionParts: [], background: '#223344', radius: 8, outlineWidth: 2, shadowBlur: 14 } as FlowNodeStyle,
    skin: { idle: 'node-image' },
  };
  assert.equal(hasFlowNodeAppearance(target, false), true);
  resetFlowNodeAppearance(target, false);
  assert.deepEqual(target, { x: .1, y: .2, width: .8, height: .7, name: '地图', style: { opacity: .35, playerOpacity: true, imageFit: 'contain' } });
  assert.equal(hasFlowNodeAppearance(target, false), false);
  assert.equal(hasFlowNodeAppearance(target, true), true);
});

test('a shared preset reset also clears node opacity and keeps preset identity', () => {
  const target: { id: string; name: string; style?: FlowNodeStyle; skin?: { idle: string } } = { id: 'main', name: '主线框', style: { opacity: 0, shadowOpacity: 0 }, skin: { idle: 'node-image' } };
  resetFlowStyleGroup(target, 'shadow');
  assert.deepEqual(target.style, { opacity: 0 });
  resetFlowNodeAppearance(target, true);
  assert.deepEqual(target, { id: 'main', name: '主线框' });
  assert.equal(hasFlowNodeAppearance(target, true), false);
  const empty: { style?: FlowNodeStyle } = { style: { borderWidth: 0 } };
  resetFlowStyleGroup(empty, 'frame');
  assert.deepEqual(empty, {});
});

test('backdrop classification reads saved geometry and combined alpha without rewriting it', () => {
  const saved: FlowNodeStyle = { shadowColor: '#000000cc', shadowOpacity: .9, shadowBlur: 14, shadowSpread: 5 };
  const before = JSON.stringify(saved);
  assert.equal(flowTextBackdropMode(saved), 'soft');
  assert.ok(Math.abs(flowTextBackdropOpacity(saved) - .72) < 1e-12);
  assert.equal(JSON.stringify(saved), before);
  assert.equal(flowTextBackdropMode({ ...saved, shadowX: -.5 }), 'custom');
  assert.equal(flowTextBackdropMode({ ...saved, shadowColor: '#112233' }), 'custom');
  assert.equal(flowTextBackdropMode({ ...saved, shadowColor: '#00000000' }), 'none');
  assert.equal(flowTextBackdropMode({ ...saved, shadowOpacity: 0 }), 'none');
  assert.equal(flowTextBackdropMode({ shadowColor: '#000000', shadowOpacity: 1 }), 'none');
  assert.equal(flowTextBackdropMode(undefined), 'none');
});

test('the simple black backdrop opacity controls visible opacity once, preserving inherited geometry', () => {
  const effective: FlowNodeStyle = { shadowColor: '#000000cc', shadowOpacity: .9, shadowBlur: 14, shadowSpread: 5 };
  const target: { style?: FlowNodeStyle } = { style: { radius: 8 } };
  setFlowBackdropOpacity(target, effective, .5);
  assert.deepEqual(target.style, { radius: 8, shadowColor: '#000000', shadowOpacity: .5 });
  assert.equal(flowTextBackdropOpacity({ ...effective, ...target.style }), .5);
  assert.equal(effective.shadowColor, '#000000cc');
  setFlowBackdropOpacity(target, effective, 2);
  assert.equal(target.style?.shadowOpacity, 1);
  setFlowBackdropOpacity(target, effective, -1);
  assert.equal(target.style?.shadowOpacity, 0);
});
