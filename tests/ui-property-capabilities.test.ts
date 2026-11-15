import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema, type BlueprintNode, type VariableValue } from '../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { createUiEventGraph, ensureUiClickEvent } from '../src/core/ui-logic';
import { previewUiLogic } from '../src/core/ui-logic-preview';
import { uiProperties, uiPropertyApplies, uiPropertyValueProblem } from '../src/core/ui-properties';
import { validateBlueprints } from '../src/core/blueprint-validation';
import { compileProject } from '../src/runtime/compiler';
import { blueprintNodeAssetFilter } from '../src/core/blueprint-assets';

function fixture() {
  const p = createProject();
  p.assets.push({ id: 'first', name: '第一张', kind: 'image', path: 'assets/first.png', width: 32, height: 64 }, { id: 'second', name: '第二张', kind: 'image', path: 'assets/second.png', width: 200, height: 100 });
  p.ui.customPages.push({ id: 'property_page', name: '属性页面', modal: true, components: [
    { id: 'picture', page: 'custom', kind: 'image', text: '', assetId: 'first', x: 0, y: 0, width: .5, height: .5 },
    { id: 'button', page: 'custom', kind: 'button', text: '切换', x: .5, y: .5, width: .2, height: .1 },
    { id: 'caption', page: 'custom', kind: 'text', text: '原文字', x: .5, y: 0, width: .5, height: .2 },
  ] });
  const page = p.ui.customPages[0], graph = createUiEventGraph(p, page.id, '属性');
  const click = ensureUiClickEvent(p, graph, 'button', page.id);
  const append = (type: BlueprintNode['type'], properties: Record<string, VariableValue>, previous = click) => {
    const node = blueprintNodeDefaults(type); node.properties = properties; graph.nodes.push(node); synchronizeBlueprintSignatures(p);
    assert.equal(connectBlueprintPins(graph, previous.id, previous === click ? 'exec' : 'exec_out', node.id, 'exec_in'), undefined); return node;
  };
  const sample = () => previewUiLogic(p, page.components, page.id, {}, [{ kind: 'click', componentId: 'button' }]);
  return { p, page, graph, click, append, sample };
}

test('image replacement, fitting and clearing use typed assets and private render snapshots', () => {
  const { p, page, graph, append, sample } = fixture();
  const write = append('setUiProperty', { componentId: 'picture', property: 'image', value: 'second' });
  append('setUiProperty', { componentId: 'picture', property: 'imageFit', value: 'cover' }, write);
  assert.equal(write.pins.find(pin => pin.id === 'value')?.dataType, 'asset');
  assert.deepEqual(blueprintNodeAssetFilter(write, 'value'), { kind: 'image', category: 'all' });
  assert.deepEqual(validateBlueprints(p), []);
  const before = JSON.stringify(p), result = sample();
  assert.equal(result.incomplete, false);
  assert.equal(result.components.find(c => c.component.id === 'picture')?.component.assetId, 'second');
  assert.equal(result.components.find(c => c.component.id === 'picture')?.component.style?.imageFit, 'cover');
  assert.equal(JSON.stringify(p), before);
  write.properties.value = ''; assert.equal(sample().components.find(c => c.component.id === 'picture')?.component.assetId, '');
  write.properties.value = 'missing'; assert.ok(validateBlueprints(p).some(d => d.nodeId === write.id && /素材/.test(d.message)));
  assert.equal(sample().incomplete, true);
  assert.equal(page.components[0].assetId, 'first');
  assert.deepEqual(projectSchema.parse(JSON.parse(before)).blueprints.find(g => g.id === graph.id)?.nodes, graph.nodes.map(n => n.id === write.id ? { ...n, properties: { ...n.properties, value: 'second' } } : n));
});

test('per-field reset restores only its design value while preserving other overrides', () => {
  const { p, append, sample } = fixture();
  const image = append('setUiProperty', { componentId: 'picture', property: 'image', value: 'second' });
  const opacity = append('setUiProperty', { componentId: 'picture', property: 'opacity', value: .3 }, image);
  append('resetUiProperty', { componentId: 'picture', property: 'image' }, opacity);
  const result = sample(), picture = result.components.find(c => c.component.id === 'picture')!.component;
  assert.equal(picture.assetId, 'first'); assert.equal(picture.style?.opacity, .3); assert.equal(result.incomplete, false);
  const code = Object.values(compileProject(p).files).join('\n');
  assert.match(code, /vn_ui_reset_property\("picture", "image"\)/);
  assert.match(code, /vn_ui_skin\("picture", .*True\)/);
});

test('every exposed property has consistent validation and only supported primitive targets', () => {
  const { p, page } = fixture();
  assert.equal(uiPropertyApplies(page.components[1], 'image'), false);
  assert.equal(uiPropertyApplies(page.components[1], 'hoverImage'), true);
  assert.ok(uiPropertyValueProblem(p, 'fontSize', 0)); assert.equal(uiPropertyValueProblem(p, 'fontSize', 200), undefined);
  assert.ok(uiPropertyValueProblem(p, 'textColor', 'red'));
  assert.ok(uiPropertyValueProblem(p, 'imageFit', 'tile'));
  assert.equal(uiPropertyValueProblem(p, 'image', ''), undefined);
  for (const info of Object.values(uiProperties)) {
    assert.ok(info.readable && info.preview && info.runtime);
    assert.equal(info.reset, info.writable ? 'field' : 'none');
    if (!info.writable) assert.equal(info.bindable, false);
  }
});
