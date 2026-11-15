import assert from 'node:assert/strict';
import test from 'node:test';
import { createUiInspectorGroupMemory, uiInspectorChildSearchMatch, uiInspectorGroupVisibility, uiInspectorSearchMatches } from '../src/core/ui-inspector-session';

test('同类任务共享分组偏好，页面和实际控件模式分别保存', () => {
  const memory = createUiInspectorGroupMemory();
  assert.equal(memory.get('main/button', 'appearance', false), false);
  memory.set('main/button', 'appearance', true);
  assert.equal(memory.get('main/button', 'appearance', false), true);
  assert.equal(memory.get('main/input', 'appearance', false), false);
  assert.equal(memory.get('save/button', 'appearance', false), false);
  let notifications = 0;
  const unsubscribe = memory.subscribe('main/button', 'appearance', () => notifications++);
  memory.set('main/input', 'appearance', true);
  memory.set('main/button', 'appearance', false);
  memory.set('main/button', 'appearance', false);
  assert.equal(notifications, 1);
  unsubscribe(); memory.set('main/button', 'appearance', true);
  assert.equal(notifications, 1);
});

test('搜索临时展开相关组，清除查询保留原来的折叠偏好', () => {
  const memory = createUiInspectorGroupMemory();
  memory.set('button', 'appearance', false);
  const labels = ['外观', '字体 字号 阴影 颜色'];
  const search = uiInspectorGroupVisibility('阴影', labels, memory.get('button', 'appearance', true));
  assert.deepEqual(search, { searching: true, matched: true, hidden: false, open: true });
  assert.equal(memory.get('button', 'appearance', true), false);
  assert.equal(uiInspectorGroupVisibility('', labels, memory.get('button', 'appearance', true)).open, false);
  assert.equal(uiInspectorGroupVisibility('点击', labels, false).hidden, true);
  assert.equal(uiInspectorGroupVisibility('阴影', ['文字效果'], false, true).open, true);
});

test('属性搜索接受中文、多个关键词与全角大小写', () => {
  assert.equal(uiInspectorSearchMatches('  字体  颜色 ', ['文字字体', '颜色']), true);
  assert.equal(uiInspectorSearchMatches('ＰＩＶＯＴ', ['pivot 轴心']), true);
  assert.equal(uiInspectorSearchMatches('阴影 位置', ['阴影颜色']), false);
  assert.equal(uiInspectorSearchMatches('  ', []), true);
});

test('精确搜索区分父组聚合的字段索引与明确组名，字体不会展开底图和边框', () => {
  const labels = ['flow-style', '节点样式', '基础字体 预设字体 字号 节点底图 边框 阴影'], names = ['节点样式', '节点外观'];
  const state = uiInspectorGroupVisibility('字体', labels, false);
  assert.equal(state.open, true);
  const childrenMatched = uiInspectorChildSearchMatch('字体', labels, names, false, 'title');
  assert.equal(childrenMatched, false);
  assert.equal(uiInspectorGroupVisibility('字体', ['分段文字样式', '字体 字号'], false, childrenMatched).hidden, false);
  for (const child of [['节点底图', '普通图片'], ['边框与圆角', '边框宽度'], ['文字阴影', '阴影颜色']]) {
    assert.equal(uiInspectorGroupVisibility('字体', child, true, childrenMatched).hidden, true);
  }
  for (const query of ['节点样式', '节点外观']) assert.equal(uiInspectorChildSearchMatch(query, [...labels, ...names], names, false, 'title'), true, query);
});

test('标题模式不把内部组编号、状态摘要或组名与字段的组合查询当成全组搜索', () => {
  const labels = ['flow-style', '节点样式', '当前字体来源：基础样式', '字体 阴影'], names = ['节点样式'];
  for (const query of ['flow-style', '基础样式', '节点样式 字体']) {
    assert.equal(uiInspectorGroupVisibility(query, labels, false).matched, true, query);
    assert.equal(uiInspectorChildSearchMatch(query, labels, names, false, 'title'), false, query);
  }
  assert.equal(uiInspectorChildSearchMatch('节点 外观', ['节点样式', '基础外观'], ['节点样式', '基础外观'], false, 'title'), false);
  assert.equal(uiInspectorChildSearchMatch('  ', labels, names, true, 'title'), false);
});

test('明确祖先组名命中继续穿过不含该组名的深层子组，默认兼容旧祖先字段索引', () => {
  const groupMatched = uiInspectorChildSearchMatch('节点样式', ['节点样式'], ['节点样式'], false, 'title');
  const childMatched = uiInspectorChildSearchMatch('节点样式', ['文字字体'], ['文字字体'], groupMatched, 'title');
  assert.equal(childMatched, true);
  assert.equal(uiInspectorGroupVisibility('节点样式', ['字形设置'], false, childMatched).open, true);
  const legacyLabels = ['子对象', '横向初始位置'];
  const legacyChildMatched = uiInspectorChildSearchMatch('横向初始位置', legacyLabels, ['子对象']);
  assert.equal(legacyChildMatched, true);
  assert.equal(uiInspectorGroupVisibility('横向初始位置', ['裁剪与滚动', '横向 纵向 位置'], false, legacyChildMatched).hidden, false);
});
