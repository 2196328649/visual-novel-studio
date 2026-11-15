import assert from 'node:assert/strict';
import test from 'node:test';
import type { UiComponent } from '../src/core/model';
import { uiInspectorChildScope, uiInspectorLayoutContext } from '../src/core/ui-inspector-layout';

const text = (id: string, values: Partial<UiComponent> = {}): UiComponent => ({ id, kind: 'text', page: 'main', text: '', x: .1, y: .2, width: .3, height: .1, ...values });

test('横纵排列中的子对象保留位置和大小，背景子对象不占排列槽位', () => {
  const parent = text('parent', { kind: 'panel', layout: { version: 1, flow: 'horizontal' } });
  const child = text('child', { parentId: parent.id }), background = text('background', { parentId: parent.id, childLayer: 'background' });
  const components = [parent, child, background], before = JSON.stringify(components);
  assert.equal(uiInspectorLayoutContext(child, components).arranged, true);
  assert.equal(uiInspectorLayoutContext(child, components).showOrder, true);
  assert.equal(uiInspectorLayoutContext(background, components).arranged, false);
  assert.equal(uiInspectorLayoutContext(background, components).background, true);
  assert.equal(uiInspectorLayoutContext(background, components).showOrder, false);
  assert.equal(JSON.stringify(components), before);
});

test('没有子对象的普通控件收起容器字段，已有容器设置仍可编辑', () => {
  const simple = text('simple');
  assert.equal(uiInspectorLayoutContext(simple, [simple]).container, false);
  assert.equal(uiInspectorLayoutContext({ ...simple, kind: 'panel' }, [simple]).container, true);
  assert.equal(uiInspectorLayoutContext(simple, [simple, text('child', { parentId: simple.id })]).container, true);
  assert.equal(uiInspectorLayoutContext({ ...simple, layout: { version: 1, paddingLeft: 0 } }, [simple]).container, true);
  assert.equal(uiInspectorLayoutContext({ ...simple, layout: { version: 1, rotation: 30 } }, [simple]).container, false);
});

test('暂停使用的间距与滚动位置保持可见，不把设计值当作有效运行值', () => {
  const component = text('saved', { layout: { version: 1, flow: 'absolute', gap: 14, scroll: 'vertical', scrollX: 42, scrollY: 18, order: 9 } });
  const before = JSON.stringify(component), context = uiInspectorLayoutContext(component, [component]);
  assert.equal(context.showGap, true);
  assert.equal(context.showOrder, true);
  assert.equal(context.showScrollX, true);
  assert.equal(context.scrollXEnabled, false);
  assert.equal(context.showScrollY, true);
  assert.equal(context.scrollYEnabled, true);
  assert.equal(context.layout.scrollX, 42);
  assert.equal(JSON.stringify(component), before);
});

test('重复控件的子对象范围与每个条目模板分开说明', () => {
  assert.match(uiInspectorChildScope(text('save', { kind: 'saveSlots' })) ?? '', /属于整个列表.*不会复制到每个条目/);
  assert.match(uiInspectorChildScope(text('flow', { kind: 'flowchart' })) ?? '', /整个剧情图.*每个剧情节点/);
  assert.equal(uiInspectorChildScope(text('plain')), undefined);
});
