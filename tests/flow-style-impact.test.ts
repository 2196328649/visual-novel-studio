import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject, projectSchema, type UiComponent } from '../src/core/model';
import { flowStyleImpact, type FlowStyleImpactNode } from '../src/core/flow-style-impact';
import { flowNodeAppearance } from '../src/core/flow-style';

const map = (): UiComponent => ({ id: 'map', kind: 'flowchart', page: 'flowchart', text: '', x: 0, y: 0, width: 1, height: 1, list: { layout: 'flow' } });
const fixture = () => {
  const project = createProject('外观影响');
  project.ui.flowStyles = [{ id: 'main', name: '主线框' }, { id: 'other', name: '回忆框' }];
  const component = map();
  const nodes: FlowStyleImpactNode[] = [{ id: 'plain', name: '普通' }, { id: 'main-node', name: '主线', styleId: 'main' }, { id: 'other-node', name: '回忆', styleId: 'other' }];
  return { project, component, nodes };
};

test('base properties exclude a real preset override but still reach inherited and missing preset references', () => {
  const { project, component, nodes } = fixture();
  component.style = { fontSize: 32 };
  project.ui.flowStyles![0].style = { fontSize: 60 };
  nodes.push({ id: 'missing', name: '旧样式', styleId: 'deleted' });
  const result = flowStyleImpact(project, component, nodes, { kind: 'base' }, { kind: 'style', key: 'fontSize' }, 'idle', 'main-node');
  assert.deepEqual(result.nodeIds, ['plain', 'other-node', 'missing']);
  assert.equal(result.reference.affected, false);
  assert.equal(result.reference.source, '节点外观预设“主线框”');
  assert.match(result.reference.reason!, /单独设置/);
});

test('editing a preset reaches only its references, including currently inherited fields', () => {
  const { project, component, nodes } = fixture();
  component.style = { fontSize: 36 };
  const result = flowStyleImpact(project, component, nodes, { kind: 'preset', presetId: 'main' }, { kind: 'style', key: 'fontSize' }, 'idle', 'other-node');
  assert.deepEqual(result.nodeIds, ['main-node']);
  assert.equal(result.reference.source, '本图基础外观');
  assert.match(result.reference.reason!, /没有使用/);
  assert.deepEqual(flowStyleImpact(project, component, nodes, { kind: 'preset', presetId: 'deleted' }, { kind: 'style', key: 'fontSize' }).nodeIds, []);
});

test('explicit zero preset letter spacing blocks base spacing until restored to inheritance', () => {
  const { project, component, nodes } = fixture();
  component.style = { letterSpacing: -1.25 };
  project.ui.flowStyles![0].style = { letterSpacing: 0 };
  project.ui.flowStyles![1].style = { letterSpacing: undefined };
  const before = JSON.stringify({ project, component, nodes });
  const base = flowStyleImpact(project, component, nodes, { kind: 'base' }, { kind: 'style', key: 'letterSpacing' }, 'idle', 'main-node');
  assert.deepEqual(base.nodeIds, ['plain', 'other-node']);
  assert.equal(base.reference.source, '节点外观预设“主线框”');
  assert.equal(base.reference.affected, false);
  assert.equal(flowNodeAppearance(project, component, nodes[1]).style?.letterSpacing, 0);
  assert.equal(flowNodeAppearance(project, component, nodes[2]).style?.letterSpacing, -1.25);
  assert.deepEqual(flowStyleImpact(project, component, nodes, { kind: 'preset', presetId: 'main' }, { kind: 'style', key: 'letterSpacing' }).nodeIds, ['main-node']);
  assert.equal(JSON.stringify({ project, component, nodes }), before);
  project.ui.flowStyles![0].style!.letterSpacing = undefined;
  for (const snapshot of [project, projectSchema.parse(JSON.parse(JSON.stringify(project)))]) {
    assert.equal(flowNodeAppearance(snapshot, component, nodes[1]).style?.letterSpacing, -1.25);
    const inherited = flowStyleImpact(snapshot, component, nodes, { kind: 'base' }, { kind: 'style', key: 'letterSpacing' }, 'idle', 'main-node');
    assert.deepEqual(inherited.nodeIds, nodes.map(node => node.id));
    assert.equal(inherited.reference.source, '本图基础外观');
  }
});

test('caption zero spacing overrides text spacing, while an absent caption value still follows the base or preset', () => {
  const { project, component, nodes } = fixture();
  nodes.forEach(node => { node.parts = ['前半', '后半']; });
  component.style = { letterSpacing: 2.5, captionParts: [{ letterSpacing: 0, gap: 8 }, { letterSpacing: -1, gap: 0 }] };
  project.ui.flowStyles![0].style = { captionParts: [{}, { letterSpacing: 0 }] };
  project.ui.flowStyles![1].style = { captionParts: [] };
  const base = flowStyleImpact(project, component, nodes, { kind: 'base' }, { kind: 'style', key: 'letterSpacing' });
  assert.deepEqual(base.nodeIds, ['main-node', 'other-node']);
  assert.equal(base.reference.affected, false);
  assert.match(base.reference.reason!, /所有显示的文字都单独设置/);
  assert.deepEqual(flowStyleImpact(project, component, nodes, { kind: 'base' }, { kind: 'caption', index: 1, key: 'letterSpacing' }).nodeIds, ['plain']);
  assert.deepEqual(flowStyleImpact(project, component, nodes, { kind: 'preset', presetId: 'main' }, { kind: 'caption', index: 1, key: 'letterSpacing' }).nodeIds, ['main-node']);
  const inherited = flowStyleImpact(project, component, nodes, { kind: 'preset', presetId: 'main' }, { kind: 'caption', index: 0, key: 'letterSpacing' }, 'idle', 'main-node');
  assert.equal(inherited.reference.source, '本图基础外观');
  project.ui.flowStyles![0].style!.letterSpacing = 0;
  assert.equal(flowStyleImpact(project, component, nodes, { kind: 'preset', presetId: 'main' }, { kind: 'caption', index: 0, key: 'letterSpacing' }, 'idle', 'main-node').reference.source, '节点外观预设“主线框”');
  project.ui.flowStyles![0].style!.captionParts![0].letterSpacing = 0;
  assert.deepEqual(flowStyleImpact(project, component, nodes, { kind: 'preset', presetId: 'main' }, { kind: 'style', key: 'letterSpacing' }).nodeIds, []);
  delete project.ui.flowStyles![0].style!.captionParts![0].letterSpacing;
  assert.deepEqual(flowStyleImpact(project, component, nodes, { kind: 'preset', presetId: 'main' }, { kind: 'style', key: 'letterSpacing' }).nodeIds, ['main-node']);
});

test('letter spacing affects a final caption unlike its gap, respects unread slot mapping and is hidden by caption images', () => {
  const { project, component } = fixture();
  component.style = { letterSpacing: 1.25, captionParts: [{ letterSpacing: -1 }, { letterSpacing: 0, gap: 12 }] };
  const nodes: FlowStyleImpactNode[] = [{ id: 'one', name: '单段标题' }, { id: 'two', name: '两段', parts: ['前段', '后段'] }];
  assert.deepEqual(flowStyleImpact(project, component, nodes, { kind: 'base' }, { kind: 'caption', index: 1, key: 'letterSpacing' }).nodeIds, ['one', 'two']);
  assert.deepEqual(flowStyleImpact(project, component, nodes, { kind: 'base' }, { kind: 'caption', index: 1, key: 'gap' }).nodeIds, []);
  assert.deepEqual(flowStyleImpact(project, component, nodes, { kind: 'base' }, { kind: 'caption', index: 0, key: 'letterSpacing' }, 'disabled').nodeIds, []);
  assert.deepEqual(flowStyleImpact(project, component, nodes, { kind: 'base' }, { kind: 'caption', index: 1, key: 'letterSpacing' }, 'disabled').nodeIds, ['one', 'two']);
  component.style.captionParts = undefined;
  component.skin = { disabled: 'unread-caption-image' };
  const hiddenUnread = flowStyleImpact(project, component, nodes, { kind: 'base' }, { kind: 'style', key: 'letterSpacing' }, 'disabled');
  assert.deepEqual(hiddenUnread.nodeIds, []); assert.match(hiddenUnread.reference.reason!, /专用图片/);
  assert.deepEqual(flowStyleImpact(project, component, nodes, { kind: 'base' }, { kind: 'style', key: 'letterSpacing' }, 'hover').nodeIds, ['one', 'two']);
  component.skin.hideText = true;
  assert.deepEqual(flowStyleImpact(project, component, nodes, { kind: 'base' }, { kind: 'style', key: 'letterSpacing' }).nodeIds, []);
});

test('whole caption override does not merge by index, and explicit part values mask only inherited text fields', () => {
  const { project, component, nodes } = fixture();
  component.style = { fontSize: 30, textColor: '#112233', captionParts: [{ fontSize: 20 }, { fontSize: 40, color: '#445566' }] };
  project.ui.flowStyles![0].style = { captionParts: [{}, {}] };
  nodes[0].parts = ['前', '后']; nodes[1].parts = ['前', '后']; nodes[2].parts = ['前', '后'];
  assert.deepEqual(flowStyleImpact(project, component, nodes, { kind: 'base' }, { kind: 'style', key: 'fontSize' }).nodeIds, ['main-node']);
  assert.deepEqual(flowStyleImpact(project, component, nodes, { kind: 'base' }, { kind: 'caption', index: 1, key: 'fontSize' }).nodeIds, ['plain', 'other-node']);
  const color = flowStyleImpact(project, component, nodes, { kind: 'base' }, { kind: 'style', key: 'textColor' });
  assert.deepEqual(color.nodeIds, ['plain', 'main-node', 'other-node']);
  assert.equal(color.reference.affected, true, 'one inherited segment is enough to affect the node');
});

test('a single caption uses the last slot; extra text reuses the first; last gap has no effect', () => {
  const { project, component } = fixture();
  component.style = { captionParts: [{ fontSize: 20 }, { fontSize: 40 }] };
  const nodes = [{ id: 'one', name: '单段' }, { id: 'three', name: '三段', parts: ['甲', '乙', '丙'] }];
  assert.deepEqual(flowStyleImpact(project, component, nodes, { kind: 'base' }, { kind: 'caption', index: 0, key: 'fontSize' }).nodeIds, ['three']);
  assert.deepEqual(flowStyleImpact(project, component, nodes, { kind: 'base' }, { kind: 'caption', index: 1, key: 'fontSize' }).nodeIds, ['one', 'three']);
  const lastGap = flowStyleImpact(project, component, nodes, { kind: 'base' }, { kind: 'caption', index: 1, key: 'gap' });
  assert.deepEqual(lastGap.nodeIds, []);
  assert.match(lastGap.reference.reason!, /末段/);
  assert.deepEqual(flowStyleImpact(project, component, nodes, { kind: 'base' }, { kind: 'caption', index: 0, key: 'gap' }).nodeIds, ['three']);
});

test('unreached captions use one last style slot, and absent slots have no claimed influence', () => {
  const { project, component, nodes } = fixture();
  component.style = { captionParts: [{ fontSize: 20 }, { fontSize: 40 }] };
  nodes[0].parts = ['甲', '乙', '丙'];
  assert.deepEqual(flowStyleImpact(project, component, nodes, { kind: 'base' }, { kind: 'caption', index: 0, key: 'fontSize' }, 'disabled').nodeIds, []);
  assert.deepEqual(flowStyleImpact(project, component, nodes, { kind: 'base' }, { kind: 'caption', index: 1, key: 'fontSize' }, 'disabled').nodeIds, nodes.map(node => node.id));
  assert.deepEqual(flowStyleImpact(project, component, nodes, { kind: 'base' }, { kind: 'caption', index: 2, key: 'fontSize' }).nodeIds, []);
});

test('empty and undefined caption arrays preserve their distinct whole-override meanings through serialization', () => {
  const { project, component, nodes } = fixture();
  component.style = { captionParts: [{ fontSize: 40 }] };
  project.ui.flowStyles![0].style = { captionParts: [] };
  project.ui.flowStyles![1].style = { captionParts: undefined };
  const result = flowStyleImpact(project, component, nodes, { kind: 'base' }, { kind: 'caption', index: 0, key: 'fontSize' });
  assert.deepEqual(result.nodeIds, ['plain', 'other-node']);
  assert.deepEqual(flowStyleImpact(projectSchema.parse(JSON.parse(JSON.stringify(project))), component, nodes, { kind: 'base' }, { kind: 'caption', index: 0, key: 'fontSize' }), result);
});

test('hover and pressed share one text color and individual slot colors can hide it', () => {
  const { project, component, nodes } = fixture();
  component.style = { hoverTextColor: '#abcdef' };
  project.ui.flowStyles![0].style = { captionParts: [{ color: '#112233' }] };
  const hover = flowStyleImpact(project, component, nodes, { kind: 'base' }, { kind: 'style', key: 'hoverTextColor' }, 'hover', 'main-node');
  const pressed = flowStyleImpact(project, component, nodes, { kind: 'base' }, { kind: 'style', key: 'hoverTextColor' }, 'pressed');
  assert.deepEqual(hover.nodeIds, ['plain', 'other-node']);
  assert.deepEqual(pressed.nodeIds, hover.nodeIds);
  assert.match(hover.reference.reason!, /所有显示的文字/);
  assert.deepEqual(flowStyleImpact(project, component, nodes, { kind: 'base' }, { kind: 'style', key: 'hoverTextColor' }, 'idle').nodeIds, []);
  assert.deepEqual(flowStyleImpact(project, component, nodes, { kind: 'base' }, { kind: 'style', key: 'textColor' }, 'hover').nodeIds, []);
});

test('whole skins and type skins override the map skin even when only one field is set', () => {
  const { project, component, nodes } = fixture();
  component.skin = { idle: 'normal' };
  component.list!.flowEndSkin = { idle: 'ending' };
  component.list!.flowChapterSkin = { idle: 'chapter' };
  project.ui.flowStyles![0].skin = {};
  nodes.push({ id: 'end', name: '结局', kind: 'end' }, { id: 'chapter', name: '章节', kind: 'chapterTitle' });
  const result = flowStyleImpact(project, component, nodes, { kind: 'base' }, { kind: 'skin' }, 'idle', 'end');
  assert.deepEqual(result.nodeIds, ['plain', 'other-node']);
  assert.equal(result.reference.source, '本图结局底图');
  assert.match(result.reference.reason!, /整套覆盖/);
  assert.deepEqual(flowStyleImpact(project, component, nodes, { kind: 'preset', presetId: 'main' }, { kind: 'skin' }).nodeIds, ['main-node']);
});

test('state image dependencies follow pressed/selected to hover to idle, not directly to idle', () => {
  const { project, component, nodes } = fixture();
  component.skin = { idle: 'normal', hover: 'hover' };
  assert.deepEqual(flowStyleImpact(project, component, nodes, { kind: 'base' }, { kind: 'skin', state: 'idle' }, 'pressed').nodeIds, []);
  const hover = flowStyleImpact(project, component, nodes, { kind: 'base' }, { kind: 'skin', state: 'hover' }, 'selected');
  assert.deepEqual(hover.nodeIds, nodes.map(node => node.id));
  assert.match(hover.reference.source, /悬停图片/);
  component.skin.pressed = 'pressed';
  assert.deepEqual(flowStyleImpact(project, component, nodes, { kind: 'base' }, { kind: 'skin', state: 'hover' }, 'pressed').nodeIds, []);
  assert.deepEqual(flowStyleImpact(project, component, nodes, { kind: 'preset', presetId: 'main' }, { kind: 'skin', state: 'disabled' }, 'idle').nodeIds, []);
});

test('hidden captions and image covered backgrounds explain why visual changes are absent', () => {
  const { project, component, nodes } = fixture();
  component.skin = { idle: 'normal', disabled: 'locked' };
  assert.deepEqual(flowStyleImpact(project, component, nodes, { kind: 'base' }, { kind: 'style', key: 'background' }).nodeIds, []);
  const locked = flowStyleImpact(project, component, nodes, { kind: 'base' }, { kind: 'style', key: 'fontSize' }, 'disabled');
  assert.deepEqual(locked.nodeIds, []); assert.match(locked.reference.reason!, /专用图片/);
  component.skin.hideText = true;
  const hidden = flowStyleImpact(project, component, nodes, { kind: 'base' }, { kind: 'style', key: 'textColor' });
  assert.deepEqual(hidden.nodeIds, []); assert.match(hidden.reference.reason!, /图片已含文字/);
});

test('map opacity never becomes node opacity while a preset opacity does', () => {
  const { project, component, nodes } = fixture();
  component.style = { opacity: .25 };
  const base = flowStyleImpact(project, component, nodes, { kind: 'base' }, { kind: 'style', key: 'opacity' });
  assert.deepEqual(base.nodeIds, []); assert.match(base.reference.reason!, /整张图/);
  assert.deepEqual(flowStyleImpact(project, component, nodes, { kind: 'preset', presetId: 'main' }, { kind: 'style', key: 'opacity' }).nodeIds, ['main-node']);
  assert.deepEqual(flowStyleImpact(project, component, nodes, { kind: 'preset', presetId: 'main' }, { kind: 'style', key: 'playerOpacity' }).nodeIds, []);
});

test('base font size still affects an automatic scrolling directory height when preset text has its own size', () => {
  const { project, component, nodes } = fixture();
  component.list = { layout: 'grid', rows: 0 };
  project.ui.flowStyles![0].style = { fontSize: 60, captionParts: [{ fontSize: 42 }] };
  const result = flowStyleImpact(project, component, nodes, { kind: 'base' }, { kind: 'style', key: 'fontSize' }, 'idle', 'main-node');
  assert.deepEqual(result.nodeIds, nodes.map(node => node.id));
  assert.equal(result.reference.source, '节点外观预设“主线框”');
  assert.match(result.reference.reason!, /自动节点高度/);
  component.list.itemHeight = 90;
  assert.deepEqual(flowStyleImpact(project, component, nodes, { kind: 'base' }, { kind: 'style', key: 'fontSize' }).nodeIds, ['plain', 'other-node']);
});

test('inactive text effects report why colors are invisible but enabling effect geometry can affect nodes', () => {
  const { project, component, nodes } = fixture();
  assert.deepEqual(flowStyleImpact(project, component, nodes, { kind: 'base' }, { kind: 'style', key: 'outlineColor' }).nodeIds, []);
  assert.deepEqual(flowStyleImpact(project, component, nodes, { kind: 'base' }, { kind: 'style', key: 'outlineWidth' }).nodeIds, nodes.map(node => node.id));
  assert.deepEqual(flowStyleImpact(project, component, nodes, { kind: 'base' }, { kind: 'style', key: 'shadowColor' }).nodeIds, []);
  assert.deepEqual(flowStyleImpact(project, component, nodes, { kind: 'base' }, { kind: 'style', key: 'shadowBlur' }).nodeIds, nodes.map(node => node.id));
  component.style = { shadowOpacity: 0, shadowBlur: 14 };
  assert.deepEqual(flowStyleImpact(project, component, nodes, { kind: 'base' }, { kind: 'style', key: 'shadowBlur' }).nodeIds, []);
  assert.deepEqual(flowStyleImpact(project, component, nodes, { kind: 'base' }, { kind: 'style', key: 'shadowOpacity' }).nodeIds, nodes.map(node => node.id));
});

test('impact analysis is read only, deduplicates node identities, and handles absent reference nodes', () => {
  const { project, component, nodes } = fixture();
  const before = JSON.stringify({ project, component, nodes });
  const result = flowStyleImpact(project, component, [...nodes, nodes[0]], { kind: 'base' }, { kind: 'style', key: 'fontSize' });
  assert.equal(result.nodeIds.length, 3);
  assert.equal(JSON.stringify({ project, component, nodes }), before);
  const empty = flowStyleImpact(project, component, [], { kind: 'base' }, { kind: 'style', key: 'fontSize' });
  assert.deepEqual(empty.nodeIds, []); assert.equal(empty.reference.source, '未选择节点');
});
