import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createProject, type UiComponent } from '../src/core/model';
import { uiInspectorSearchLabels, type UiInspectorSearchGroup } from '../src/core/ui-inspector-search';
import { uiInspectorSearchMatches } from '../src/core/ui-inspector-session';

const component = (kind: UiComponent['kind'], values: Partial<UiComponent> = {}): UiComponent => ({ id: 'control', kind, page: 'main', text: '', x: 0, y: 0, width: .2, height: .1, ...values });
const groups: readonly UiInspectorSearchGroup[] = ['layout', 'visibility', 'content', 'appearance', 'interaction', 'collection-layout', 'children', 'bindings'];

type GroupRenderer = typeof import('../src/renderer/UiPropertyGroup') & typeof import('../src/renderer/UiInspectorContext');
let groupRendererPromise: Promise<GroupRenderer> | undefined;

/** The real JSX and contexts share one in-memory bundle; no temporary files. */
function groupRenderer() {
  return groupRendererPromise ??= build({
    stdin: {
      contents: "export { UiPropertyGroup } from './src/renderer/UiPropertyGroup'; export { UiInspectorProvider, UiInspectorSearchScope } from './src/renderer/UiInspectorContext';",
      resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts',
    },
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
    loader: { '.css': 'empty' }, logLevel: 'silent',
  }).then(result => {
    const module = { exports: {} as GroupRenderer };
    new Function('module', 'exports', 'require', result.outputFiles[0].text)(module, module.exports, createRequire(import.meta.url));
    return module.exports;
  });
}

function groupState(markup: string, id: string) {
  const opening = [...markup.matchAll(/<details\b[^>]*>/g)].find(match => match[0].includes(`data-ui-inspector-group="${id}"`))?.[0];
  assert.ok(opening, `未挂载分组：${id}`);
  return { hidden: /\bhidden=""/.test(opening), open: /\bopen=""/.test(opening), matched: opening.includes('data-search-match="true"') };
}

function searchTree(api: GroupRenderer, query: string, mode: 'all' | 'title' = 'title') {
  const group = (id: string, title: string, searchKeywords: string, children: ReactNode, extra: Partial<Parameters<typeof api.UiPropertyGroup>[0]> = {}) => createElement(api.UiPropertyGroup, { key: id, id, title, searchKeywords, children, ...extra });
  const nested = group('font-deep', '逐段设置', '第 2 段字体 第 2 段字号', '字体字段');
  const advanced = group('font-advanced', '字间距', '字符留白', '字间距字段');
  const font = group('font', '文字字体', '字体 字号 第 2 段字体 第 2 段字号 字符留白', [nested, advanced]);
  const skin = group('skin', '节点底图', '普通图片 悬停图片', '图片字段', { defaultOpen: true });
  const frame = group('frame', '边框与圆角', '边框宽度 圆角', '边框字段');
  const effects = group('effects', '文字阴影', '阴影颜色 阴影柔化', '阴影字段');
  const parent = group('flow-style', '节点样式', '字体 字号 第 2 段字体 第 2 段字号 字符留白 普通图片 悬停图片 边框宽度 圆角 阴影颜色 阴影柔化', [font, skin, frame, effects], { searchChildren: mode, searchGroupNames: ['节点外观'], summary: '字体来自页面' });
  return renderToStaticMarkup(createElement(api.UiInspectorProvider, { taskKey: 'search-regression', query, children: parent }));
}

test('真实分组的精确搜索仅展开相关子组，聚合匹配与摘要不扩散', async () => {
  const api = await groupRenderer();
  const markup = searchTree(api, '字体');
  assert.deepEqual(groupState(markup, 'flow-style'), { hidden: false, open: true, matched: true });
  assert.deepEqual(groupState(markup, 'font'), { hidden: false, open: true, matched: true });
  assert.deepEqual(groupState(markup, 'font-deep'), { hidden: false, open: true, matched: true });
  for (const id of ['skin', 'frame', 'effects']) assert.equal(groupState(markup, id).hidden, true, id);
  const summary = searchTree(api, '页面');
  assert.equal(groupState(summary, 'flow-style').hidden, false);
  for (const id of ['font', 'skin', 'frame', 'effects']) assert.equal(groupState(summary, id).hidden, true, id);
});

test('真实分组明确组名和别名搜索展开整个子树，精确字段搜索穿过未打开的祖先', async () => {
  const api = await groupRenderer();
  for (const query of ['节点样式', '节点外观']) {
    const markup = searchTree(api, query);
    for (const id of ['flow-style', 'font', 'font-deep', 'font-advanced', 'skin', 'frame', 'effects']) assert.deepEqual(groupState(markup, id), { hidden: false, open: true, matched: true }, `${query}: ${id}`);
  }
  const deep = searchTree(api, '第 2 段字号');
  for (const id of ['flow-style', 'font', 'font-deep']) assert.equal(groupState(deep, id).open, true, id);
  for (const id of ['font-advanced', 'skin', 'frame', 'effects']) assert.equal(groupState(deep, id).hidden, true, id);
});

test('真实分组继承精确策略但默认保留旧祖先索引，搜索后恢复各组原来的折叠状态', async () => {
  const api = await groupRenderer();
  const legacyGroup = createElement(api.UiPropertyGroup, { id: 'legacy', title: '子对象', searchKeywords: '横向初始位置', children: createElement(api.UiPropertyGroup, { id: 'legacy-scroll', title: '裁剪与滚动', searchKeywords: '横向 纵向 位置', children: '初始位置字段' }) });
  const markup = renderToStaticMarkup(createElement(api.UiInspectorProvider, { taskKey: 'legacy-regression', query: '横向初始位置', children: legacyGroup }));
  assert.equal(groupState(markup, 'legacy-scroll').open, true);
  searchTree(api, '字体');
  const cleared = searchTree(api, '');
  assert.deepEqual(groupState(cleared, 'flow-style'), { hidden: false, open: false, matched: false });
  // lazy parents remain closed; this separate non-lazy tree lets React render
  // each descendant's own saved/default preference after the search is cleared.
  const reopened = renderToStaticMarkup(createElement(api.UiInspectorProvider, { taskKey: 'search-regression', query: '', children: createElement(api.UiPropertyGroup, { id: 'flow-style', title: '节点样式', lazy: false, children: [
    createElement(api.UiPropertyGroup, { key: 'font', id: 'font', title: '文字字体', children: '字体字段' }),
    createElement(api.UiPropertyGroup, { key: 'skin', id: 'skin', title: '节点底图', defaultOpen: true, children: '图片字段' }),
  ] }) }));
  assert.equal(groupState(reopened, 'font').open, false);
  assert.equal(groupState(reopened, 'skin').open, true);
});

test('搜索完整中文标签可跨过未挂载的外层组', () => {
  const project = createProject(), text = component('text');
  for (const name of ['父对象', '控件整体旋转', '横向附加偏移']) assert.equal(uiInspectorSearchMatches(name, uiInspectorSearchLabels(project, text, 'layout')), true, name);
  for (const name of ['容器滚动方向', '横向初始位置']) assert.equal(uiInspectorSearchMatches(name, uiInspectorSearchLabels(project, text, 'children')), true, name);
  for (const name of ['阴影柔化', '阴影扩展', '文字对齐', '描边不透明度']) assert.equal(uiInspectorSearchMatches(name, uiInspectorSearchLabels(project, text, 'appearance')), true, name);
  const image = component('image', { style: { imageFit: 'nineSlice' } });
  for (const name of ['四角', '切片', '源图像素']) assert.equal(uiInspectorSearchMatches(name, uiInspectorSearchLabels(project, image, 'content')), true, name);
});

test('按实际输入能力归组，滑条尺寸不混入输入框或范围组', () => {
  const project = createProject();
  project.variables.push({ id: 'name_input', name: '姓名', type: 'string', initial: '', persistent: false });
  const slider = component('preference', { page: 'preferences', preference: 'musicVolume' });
  const input = component('preference', { parameterId: 'name_input' });
  assert.equal(uiInspectorSearchMatches('滑条尺寸', uiInspectorSearchLabels(project, slider, 'appearance')), true);
  assert.equal(uiInspectorSearchMatches('滑条尺寸', uiInspectorSearchLabels(project, slider, 'content')), false);
  assert.equal(uiInspectorSearchMatches('滑条尺寸', uiInspectorSearchLabels(project, input, 'appearance')), false);
  assert.equal(uiInspectorSearchMatches('输入最大长度', uiInspectorSearchLabels(project, input, 'content')), true);
  assert.equal(uiInspectorSearchMatches('控件范围下限', uiInspectorSearchLabels(project, slider, 'content')), true);
  assert.equal(uiInspectorSearchMatches('反向滑条', uiInspectorSearchLabels(project, slider, 'interaction')), true);
  assert.equal(uiInspectorSearchMatches('骨骼动画名称', uiInspectorSearchLabels(project, component('spine'), 'content')), true);
  assert.equal(uiInspectorSearchMatches('名单文字', uiInspectorSearchLabels(project, component('staffRoll'), 'content')), true);
});

test('能力过滤不把字体显示给进度条，也保留暂不适用设置的查找入口', () => {
  const project = createProject(), progress = component('progress');
  assert.equal(uiInspectorSearchMatches('字体', uiInspectorSearchLabels(project, progress, 'appearance')), false);
  assert.equal(uiInspectorSearchMatches('鼠标经过图片', uiInspectorSearchLabels(project, component('text', { parentId: 'button', inheritState: true }), 'appearance')), false);
  assert.equal(uiInspectorSearchMatches('外观预览状态', uiInspectorSearchLabels(project, component('text'), 'appearance')), false);
  const invalid = component('preference', { parameterId: 'deleted', controlRange: { min: 0, max: 100, step: 1 }, slider: { trackHeight: 12 } });
  assert.equal(uiInspectorSearchMatches('恢复绑定源范围', uiInspectorSearchLabels(project, invalid, 'content')), true);
  assert.equal(uiInspectorSearchMatches('已保存滑条外观', uiInspectorSearchLabels(project, invalid, 'appearance')), true);
  assert.equal(uiInspectorSearchMatches('滑块宽度', uiInspectorSearchLabels(project, invalid, 'appearance')), false);
});

test('部件和未知控件保留对应范围，搜索目录读取不修改工程', () => {
  const project = createProject(), saved = JSON.stringify(project), slots = component('saveSlots');
  assert.equal(uiInspectorSearchMatches('对白摘要字体', uiInspectorSearchLabels(project, slots, 'appearance')), true);
  assert.equal(uiInspectorSearchMatches('自定义缩略图位置', uiInspectorSearchLabels(project, slots, 'appearance')), true);
  assert.equal(uiInspectorSearchMatches('条目默认外观', uiInspectorSearchLabels(project, slots, 'appearance')), true);
  assert.equal(uiInspectorSearchMatches('每页行数', uiInspectorSearchLabels(project, slots, 'collection-layout')), true);
  assert.equal(uiInspectorSearchMatches('输入焦点', uiInspectorSearchLabels(project, slots, 'content')), false);
  const future = { ...component('panel'), kind: 'futureControl' as UiComponent['kind'] };
  assert.equal(uiInspectorSearchMatches('父对象', uiInspectorSearchLabels(project, future, 'layout')), true);
  assert.equal(JSON.stringify(project), saved);
});

test('当前对象布局和子对象容器功能分别可查，原有父级与高级变换不丢失', () => {
  const project = createProject(), panel = component('panel');
  const layout = uiInspectorSearchLabels(project, panel, 'layout'), children = uiInspectorSearchLabels(project, panel, 'children');
  for (const property of ['x', 'y', 'width', 'height', 'layer', 'layoutOrder', 'layoutRotation', 'scaleX', 'scaleY', 'anchorX', 'anchorY', 'pivotX', 'pivotY']) {
    assert.ok(layout.includes(property), property);
    assert.equal(children.includes(property), false, property);
  }
  for (const name of ['父对象', '相对父对象外框', '子对象放置位置', '跟随父级按钮状态']) {
    assert.equal(uiInspectorSearchMatches(name, layout), true, name);
    assert.equal(uiInspectorSearchMatches(name, children), false, name);
  }
  for (const property of ['layoutFlow', 'childGap', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'clipChildren', 'scrollMode', 'scrollX', 'scrollY']) {
    assert.ok(children.includes(property), property);
    assert.equal(layout.includes(property), false, property);
  }
  for (const name of ['子对象间距', '内边距', '容器滚动方向', '横向初始位置', '查看滚动范围', '添加子文字', '复制组件及子对象']) {
    assert.equal(uiInspectorSearchMatches(name, children), true, name);
    assert.equal(uiInspectorSearchMatches(name, layout), false, name);
  }
});

test('整体透明度与显示条件属于通用显示组，描边阴影透明度仍属于外观', () => {
  const project = createProject();
  for (const kind of ['button', 'text', 'saveSlots', 'flowchart'] as const) {
    const target = component(kind, { page: 'say' });
    for (const name of ['控件不透明度', '显示条件', '应用显示条件', '清除显示条件', '始终显示', '跟随玩家对话框透明度']) {
      const matches = groups.filter(group => uiInspectorSearchMatches(name, uiInspectorSearchLabels(project, target, group)));
      assert.deepEqual(matches, ['visibility'], `${kind}: ${name}`);
    }
  }
  for (const [target, name] of [[component('flowchart'), '整图不透明度'], [component('saveSlots'), '整个列表不透明度']] as const) {
    assert.deepEqual(groups.filter(group => uiInspectorSearchMatches(name, uiInspectorSearchLabels(project, target, group))), ['visibility']);
  }
  const text = component('text');
  assert.equal(uiInspectorSearchMatches('描边不透明度', uiInspectorSearchLabels(project, text, 'appearance')), true);
  assert.equal(uiInspectorSearchMatches('阴影不透明度', uiInspectorSearchLabels(project, text, 'appearance')), true);
  assert.equal(uiInspectorSearchMatches('阴影不透明度', uiInspectorSearchLabels(project, text, 'visibility')), false);
  assert.equal(uiInspectorSearchMatches('显示事件蓝图', uiInspectorSearchLabels(project, text, 'interaction')), true);
  assert.equal(uiInspectorSearchMatches('显示事件蓝图', uiInspectorSearchLabels(project, text, 'visibility')), false);
  const button = component('button');
  for (const name of ['enabledWhen', 'selectedWhen', '应用可操作条件', '清除选中状态条件']) {
    assert.deepEqual(groups.filter(group => uiInspectorSearchMatches(name, uiInspectorSearchLabels(project, button, group))), ['interaction'], name);
  }
});

test('属性联动独立于内容来源，控件范围和素材参数继续在内容中查找', () => {
  const project = createProject(), slider = component('preference', { preference: 'musicVolume' });
  for (const name of ['属性跟随参数', '参数绑定', '属性联动', '解除联动', '联动参数', '新建参数并联动']) {
    assert.deepEqual(groups.filter(group => uiInspectorSearchMatches(name, uiInspectorSearchLabels(project, slider, group))), ['bindings'], name);
  }
  for (const name of ['parameterId', '值来源', '绑定设置或参数', '控件范围下限', '控件数值范围', '恢复绑定源范围', '在参数集中查看']) {
    assert.deepEqual(groups.filter(group => uiInspectorSearchMatches(name, uiInspectorSearchLabels(project, slider, group))), ['content'], name);
  }
  for (const [kind, name] of [['image', '图片来源'], ['video', '视频来源']] as const) {
    const target = component(kind, { assetParameterId: 'asset_parameter' });
    for (const query of [name, 'assetParameterId', '素材绑定', '素材参数', '查看来源参数', '参数为空时显示']) assert.deepEqual(groups.filter(group => uiInspectorSearchMatches(query, uiInspectorSearchLabels(project, target, group))), ['content'], query);
  }
});

test('集合排列从整控件几何中拆出，不把内部部件或容器字段混进列表排列', () => {
  const project = createProject(), save = component('saveSlots'), history = component('historyList'), choice = component('choiceList');
  for (const name of ['每行数量', '每页行数', '横向间距', '手动存档页数']) {
    assert.deepEqual(groups.filter(group => uiInspectorSearchMatches(name, uiInspectorSearchLabels(project, save, group))), ['collection-layout'], name);
  }
  const collection = uiInspectorSearchLabels(project, save, 'collection-layout');
  for (const name of ['横向位置', '控件整体旋转', '子对象间距', '父对象', '条目宽度', '条目高度', '分页位置', '对白摘要字体', '自定义缩略图位置']) assert.equal(uiInspectorSearchMatches(name, collection), false, name);
  for (const [target, name] of [
    [save, '条目宽度'], [save, '条目高度'], [save, '分页位置'],
    [history, '姓名列宽度'], [history, '历史行最小高度'], [history, '历史行上下留白'], [history, '重播与收藏按钮大小'],
    [component('galleryGrid'), '最多同时显示页码'], [component('galleryGrid'), '页码按钮宽度'],
  ] as const) assert.deepEqual(groups.filter(group => uiInspectorSearchMatches(name, uiInspectorSearchLabels(project, target, group))), ['appearance'], name);
  assert.equal(uiInspectorSearchMatches('姓名／按钮间距', uiInspectorSearchLabels(project, history, 'collection-layout')), true);
  assert.equal(uiInspectorSearchMatches('条目宽度', uiInspectorSearchLabels(project, history, 'collection-layout')), false);
  assert.equal(uiInspectorSearchMatches('条目高度', uiInspectorSearchLabels(project, choice, 'appearance')), true);
  assert.equal(uiInspectorSearchMatches('每行数量', uiInspectorSearchLabels(project, choice, 'collection-layout')), false);
  assert.deepEqual(uiInspectorSearchLabels(project, component('panel'), 'collection-layout'), []);
});
