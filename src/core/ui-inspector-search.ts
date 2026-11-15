import type { Project, UiComponent } from './model';
import { uiDesignProperties, uiDesignPropertyApplies } from './ui-design-properties';
import { uiControlDefinition } from './ui-control-properties';
import { uiInspectorControlEvents } from './ui-inspector-interaction';
import { uiInspectorAppearanceStates, uiInspectorSkinApplies } from './ui-inspector-appearance';
import { uiInspectorContainerProperties } from './ui-inspector-layout';
import { collectionSupports } from './ui-collection-layout';
import { uiProperties, type UiProperty } from './ui-properties';
import { uiPropertyControlKey, uiPropertyControlModes } from './ui-property-control';

export type UiInspectorSearchGroup = 'content' | 'layout' | 'appearance' | 'interaction' | 'visibility' | 'children' | 'collection-layout' | 'bindings';

const groupLabels: Record<UiInspectorSearchGroup, readonly string[]> = {
  content: ['内容', '内容来源', '查看来源参数'],
  layout: ['位置与大小', '位置尺寸单位', '百分比 %', '像素 px', '相对画面', '相对父内容区', '相对父对象外框', '排列中的附加偏移与尺寸',
    '父对象与层级', '父级与层级', '父对象', '编辑父对象', '页面根级', '放置位置', '子对象放置位置',
    '父级内容前方', '父级内容后方', '前景子对象', '背景子对象', '跟随父级按钮状态', '更多布局', '高级变换', '恢复锚点与变换默认值'],
  visibility: ['显示与透明度', '可见性', 'visibleWhen', '显示条件', '添加显示条件', '应用显示条件', '清除显示条件', '始终显示'],
  children: ['子对象', '子对象列表', '子对象布局', '设置子对象布局', '容器布局', '恢复子对象布局默认值',
    '添加或复制对象', '添加子图片', '添加背景子图', '添加子文字', '添加子按钮', '复制组件及子对象'],
  'collection-layout': ['列表排列', '条目排列'],
  bindings: ['已关联属性', '属性控制', '控制来源', '默认设置', '单向跟随参数', '与参数双向同步', '关联其他属性', '新建参数并关联', '原关联需要修复', '跟随', '同步',
    '属性跟随参数', '参数绑定', '属性联动', '替换联动', '解除联动', '联动组件', '联动属性', '联动参数',
    '跟随参数的属性', '来源参数', '更换来源参数', '跟随此参数', '打开已有联动蓝图', '改用所选参数', '此属性的已有联动', '其他已联动属性',
    '新建参数并联动', '新建联动参数', '新参数名称', '新参数初始值', '新参数所属参数集', '创建参数并联动', '蓝图控制'],
  appearance: ['外观', '恢复本组外观'],
  interaction: ['交互', '控件事件', '已有蓝图绑定', '显示事件蓝图', '当前绑定不适用的事件'],
};

const stateNames = { idle: '普通', hover: '鼠标经过', pressed: '按住', selected: '开启', disabled: '不可用' } as const;
const containerProperties: ReadonlySet<UiProperty> = new Set(uiInspectorContainerProperties);

/** Registry names remain searchable even when the inspector uses a short label. */
const propertyLabels: Partial<Record<UiProperty, readonly string[]>> = {
  x: ['横向位置', '横向附加偏移', 'X'], y: ['纵向位置', '纵向附加偏移', 'Y'], width: ['宽度', 'W'], height: ['高度', 'H'], layer: ['显示层级'],
  anchorX: ['横向锚点', '锚点', '更多布局'], anchorY: ['纵向锚点'], pivotX: ['横向轴心', '轴心'], pivotY: ['纵向轴心'],
  layoutRotation: ['整体旋转'], scaleX: ['横向缩放', '镜像'], scaleY: ['纵向缩放'], layoutFlow: ['排列方式', '子对象排列'],
  layoutOrder: ['排列顺序'], childGap: ['子对象间距'], paddingLeft: ['内边距', '左侧'], paddingRight: ['内边距', '右侧'], paddingTop: ['内边距', '上方'], paddingBottom: ['内边距', '下方'],
  clipChildren: ['裁剪与滚动', '裁剪超出部分'], scrollX: ['横向初始位置', '查看滚动范围', '横向滚动范围', '有效位置'], scrollY: ['纵向初始位置', '查看滚动范围', '纵向滚动范围', '内容宽度', '内容高度'], scrollMode: ['滚动方向'],
  font: ['字体', '沿用页面字体'], fontSize: ['字号'], textColor: ['文字颜色'], hoverTextColor: ['文字颜色', '鼠标经过文字颜色'], selectedTextColor: ['文字颜色', '开启文字颜色'], disabledTextColor: ['文字颜色', '不可用文字颜色'], align: ['文字对齐'],
  outlineWidth: ['文字效果', '文字描边', '描边宽度'], outlineColor: ['描边颜色'], outlineOpacity: ['描边不透明度 %'],
  shadowX: ['文字效果', '文字阴影', '阴影横向偏移'], shadowY: ['阴影纵向偏移'], shadowBlur: ['阴影柔化'], shadowSpread: ['阴影扩展'], shadowColor: ['阴影颜色'], shadowOpacity: ['阴影不透明度 %'],
  opacity: ['控件不透明度 %'], radius: ['边框与圆角', '圆角半径'], borderWidth: ['边框宽度'], borderColor: ['边框颜色'],
  background: ['背景颜色', '底色'], hoverBackground: ['背景颜色', '鼠标经过背景'], pressedBackground: ['背景颜色', '按住背景'], selectedBackground: ['背景颜色', '开启背景'], disabledBackground: ['背景颜色', '不可用背景'],
  idleImage: ['普通图片'], hoverImage: ['鼠标经过图片'], pressedImage: ['按住图片'], selectedImage: ['开启图片'], disabledImage: ['不可用图片'],
  image: ['图片来源', '图片素材', '固定图片', '参数为空时显示'], imageFit: ['图片缩放', '九宫格边距', '四角', '切片', '源图像素', '图片左边距', '图片上边距', '图片右边距', '图片下边距'],
  imageCropX: ['图片裁切、翻转与乘色', '横向裁切起点'], imageCropY: ['纵向裁切起点'], imageCropWidth: ['裁切宽度'], imageCropHeight: ['裁切高度'], imageTint: ['图片乘色', '图片染色'],
  video: ['视频来源', '视频素材', '固定视频', '参数为空时显示'], videoPoster: ['加载时显示图片'], videoLoop: ['循环播放'],
  spineSkin: ['骨骼皮肤'], spineLoop: ['动画循环'], spineSpeed: ['动画速度'], spineFit: ['骨骼布局'], spineScale: ['骨骼缩放'], spineOriginX: ['横向原点 %'], spineOriginY: ['纵向原点 %'], spineRotation: ['骨骼旋转'],
  value: ['初始进度 %', '进度条初始值'], placeholder: ['输入占位文字'], maxLength: ['输入最大长度'],
  readOnly: ['只读', '禁止用户改值'], sliderReverse: ['反向滑条'], sliderShowLabel: ['显示滑条标题'],
  sliderTrackHeight: ['滑条尺寸', '滑轨高度'], sliderThumbWidth: ['滑条尺寸', '滑块宽度'], sliderThumbHeight: ['滑条尺寸', '滑块高度'],
  sliderTrackImage: ['轨道与滑块图片', '滑条底图'], sliderFillImage: ['滑条填充图'], sliderThumbImage: ['普通滑块', '滑块状态'], sliderHoverThumbImage: ['悬停滑块', '鼠标经过滑块'], sliderPressedThumbImage: ['按住滑块'], sliderDisabledThumbImage: ['不可用滑块'],
  tooltip: ['提示与快捷键', '悬停提示', '恢复默认悬停提示'], hoverSound: ['声音反馈', '悬停音效'], clickSound: ['声音反馈', '点击音效'],
};

function propertyGroup(property: UiProperty): UiInspectorSearchGroup {
  const path = uiProperties[property].path;
  if (property === 'opacity') return 'visibility';
  if (property === 'visible') return 'visibility';
  if (property === 'enabled' || property === 'selected') return 'interaction';
  if (containerProperties.has(property)) return 'children';
  if (path[0] === 'layout' || ['x', 'y', 'width', 'height', 'layer'].includes(property)) return 'layout';
  if (['readOnly', 'sliderReverse', 'tooltip', 'hoverSound', 'clickSound'].includes(property)) return 'interaction';
  if (['text', 'value', 'image', 'imageFit', 'video', 'videoPoster', 'videoLoop', 'placeholder', 'maxLength'].includes(property) || property.startsWith('spine')) return 'content';
  if (['style', 'skin', 'slider', 'imageEffects'].includes(path[0])) return 'appearance';
  return 'content';
}

const collectionLabels: Partial<Record<UiComponent['kind'], Partial<Record<UiInspectorSearchGroup, readonly string[]>>>> = {
  choiceList: { content: ['选项文字', '剧情选择分支'], appearance: ['选项文字', '选项文字对齐'] },
  saveSlots: {
    content: ['存档文字内容', '显示条目文字', '保存时间', '章节和对白摘要', '固定显示自动存档'],
    'collection-layout': ['每行数量', '每页行数', '手动存档页数'],
    appearance: ['空槽图片', '悬停装饰图', '缩略图', '缩略图相框', '存档章节', '对白摘要', '槽位编号', '读写按钮', '自动存档', '编辑读写按钮', '保存按钮底图', '读取按钮底图', '编号底图', '自动档底图', '分页位置'],
    interaction: ['显示删除存档'],
  },
  galleryGrid: {
    content: ['管理图鉴内容', '显示条目文字', '图鉴内容来源', '图鉴分组', '手动选择图片'],
    'collection-layout': ['每行数量', '每页行数', '画廊排列', '等距网格', '上下错列', '隔行横移'],
    appearance: ['悬停装饰图', '缩略图', '缩略图相框', '缩略图缩放', '缩略图亮度 %', '未解锁图片', '页码按钮宽度', '页码按钮高度', '页码按钮间距', '页码字号', '页码字体', '页码粗体', '最多同时显示页码'],
    interaction: ['详情图片缩放', '最后一张再点击', '详情显示翻页和关闭按钮', '返回图鉴', '从第一张循环'],
  },
  historyList: {
    content: ['对白历史', '当前周目', '剧情语音'],
    'collection-layout': ['历史条目排列', '姓名在对白上方', '姓名、语音按钮与对白分列', '姓名／按钮间距'],
    appearance: ['历史文字加粗', '历史文字字距', '姓名', '对白正文', '重播按钮', '收藏按钮', '重播与收藏按钮大小', '重播按钮图片', '收藏按钮图片', '滚动条', '历史滚动条样式', '系统滚动条', '自定义滚动条', '历史滚动条轨道', '滚动条轨道宽度', '历史滑块图片', '姓名列宽度', '历史行最小高度', '历史行上下留白'],
  },
  musicTrackList: { content: ['管理音乐曲目', '自动收集剧情配乐', '手动选择曲目'], 'collection-layout': ['音乐列表浏览方式', '每页行数'] },
  voiceCollection: {
    content: ['管理语音范围', '全部剧情语音', '收藏文字内容', '姓名和对白摘要', '仅对白', '单行显示并省略长文本', '收藏排列顺序', '资源顺序', '收藏先后顺序'],
    'collection-layout': ['语音列表浏览方式', '每页行数'], appearance: ['收藏文字', '收藏按钮', '收藏按钮默认大小', '收藏按钮图片'],
    interaction: ['默认只看收藏', '显示筛选和停止按钮', '删除收藏前确认', '删除收藏提示'],
  },
  chapterList: { content: ['章节目录', '显示已读和当前位置'], 'collection-layout': ['章节列表浏览方式', '每页行数'], interaction: ['锁定未到达的剧情', '游戏中跳转前确认'] },
};

function addCollectionLabels(component: UiComponent, group: UiInspectorSearchGroup, labels: Set<string>) {
  if (!collectionSupports(component)) return;
  for (const label of collectionLabels[component.kind]?.[group] ?? []) labels.add(label);
  if (group === 'collection-layout') {
    // Match the collection editor's available dimensions without calculating
    // layout geometry just to populate a search index.
    labels.add('纵向间距');
    if (!['historyList', 'choiceList'].includes(component.kind)) for (const label of ['横向间距', '每行数量']) labels.add(label);
    if (['musicTrackList', 'voiceCollection', 'chapterList'].includes(component.kind)) for (const label of ['浏览方式', '滚动列表', '按页切换']) labels.add(label);
  }
  if (group === 'visibility') labels.add('整个列表不透明度 %');
  if (group !== 'appearance') return;
  // Root search can lead to the entry point. The entered part's own inspector
  // indexes its fields separately and never inherits this control's geometry.
  for (const label of ['编辑列表部件', '编辑条目部件', '条目默认外观', '整个条目', '整个控件外观', '条目背景颜色', '部件状态']) labels.add(label);
  if (component.kind !== 'historyList') for (const label of ['条目高度', '恢复自动']) labels.add(label);
  if (!['historyList', 'choiceList'].includes(component.kind)) labels.add('条目宽度');
  const rectangles = component.kind === 'saveSlots' ? ['缩略图', '存档章节', '对白摘要', '槽位编号', '读写按钮', '相框', '分页按钮']
    : component.kind === 'galleryGrid' ? ['缩略图', '相框', '未解锁图片', '分页按钮']
    : component.kind === 'voiceCollection' ? ['收藏按钮', '分页按钮']
    : component.kind === 'historyList' ? ['滚动条'] : ['musicTrackList', 'chapterList'].includes(component.kind) ? ['分页按钮'] : [];
  for (const name of rectangles) {
    labels.add(`自定义${name}位置`);
    for (const dimension of ['横向', '纵向', '宽度', '高度']) labels.add(name + dimension);
  }
  const textParts = component.kind === 'saveSlots' ? ['存档章节', '对白摘要', '槽位编号', '分页按钮'] : component.kind === 'historyList' ? ['姓名', '对白正文'] : [];
  for (const name of textParts) for (const property of ['字体', '字号', '文字颜色', '对齐']) labels.add(name + property);
  if (['saveSlots', 'galleryGrid', 'musicTrackList', 'voiceCollection', 'chapterList'].includes(component.kind)) {
    for (const label of ['分页按钮', '分页按钮图片', '分页文字颜色', '当前页文字颜色']) labels.add(label);
  }
}

/** Search reads the same capabilities as the fields. It never needs to mount a
 * collapsed group, inspect DOM, materialize defaults, or change a component. */
export function uiInspectorSearchLabels(project: Project, component: UiComponent, group: UiInspectorSearchGroup): readonly string[] {
  if (group === 'collection-layout' && !collectionSupports(component)) return [];
  const labels = new Set(groupLabels[group]);
  // Source names are searchable in their own section as well as the compact
  // association summary. Reading the index never migrates legacy graph links.
  for (const [property, control] of Object.entries(component.propertyControls ?? {})) {
    const known = Object.hasOwn(uiProperties, property);
    const key = known ? uiPropertyControlKey(project, component, property as UiProperty) : undefined;
    if (group !== 'bindings' && (!key || propertyGroup(key) !== group)) continue;
    labels.add(property); labels.add(key ? uiProperties[key].name : property);
    for (const name of ['控制来源', '关联参数', '恢复默认设置', control.mode === 'sync' ? '同步' : '跟随', uiPropertyControlModes[control.mode]]) labels.add(name);
    const source = project.variables.find(variable => variable.id === control.parameterId);
    labels.add(source?.name ?? '参数已删除');
  }
  const states = uiInspectorAppearanceStates(project, component);
  for (const property of uiDesignProperties) {
    if (propertyGroup(property) !== group || !uiDesignPropertyApplies(component, property, project)) continue;
    // State colors are authored through the state selector, not as permanently
    // visible fields on ordinary text/panels or a progress fill.
    if (group === 'appearance' && ['hoverTextColor', 'selectedTextColor', 'disabledTextColor', 'hoverBackground', 'pressedBackground', 'selectedBackground', 'disabledBackground'].includes(property)
      && states.length === 1 && !(component.kind === 'progress' && property === 'selectedBackground')) continue;
    const info = uiProperties[property];
    labels.add(property); labels.add(info.name);
    if (info.unit) labels.add(info.unit);
    for (const label of propertyLabels[property] ?? []) labels.add(label);
    for (const label of Object.values(info.options ?? {})) labels.add(label);
  }
  const control = uiControlDefinition(project, component), isControl = component.kind === 'preference' || component.kind === 'preferenceChoice';
  if (group === 'content') {
    if (component.kind === 'staffRoll') for (const label of ['名单文字', '制作人员', '演职员']) labels.add(label);
    if (component.kind === 'image' || component.kind === 'video') for (const label of ['assetParameterId', '素材绑定', '素材参数', '素材来源参数']) labels.add(label);
    if (component.kind === 'text') {
      for (const label of ['文字来源', '文字内容', '固定文字', '悬停提示']) labels.add(label);
      if (component.page === 'main' || component.binding === 'title') labels.add('作品名称');
      if (component.page === 'say' || component.binding === 'speaker') labels.add('当前说话人');
      if (component.page === 'say' || component.binding === 'dialogue') labels.add('当前对白');
      if (component.page === 'messageBox' || component.binding === 'confirmation') labels.add('确认提示');
      if (component.page === 'custom' && (component.binding?.startsWith('minigame') || project.minigames.some(game => project.ui.customPages.find(page => page.id === game.uiPageId)?.components.some(item => item.id === component.id)))) {
        for (const label of ['小游戏标题', '小游戏提示', '小游戏状态']) labels.add(label);
      }
    }
    // Choosing a Spine asset/initial clip uses the dedicated atomic editor;
    // these fields are intentionally excluded from the generic design adapter.
    if (component.kind === 'spine') for (const label of ['骨骼素材', '骨骼动画名称', '自动播放']) labels.add(label);
    if (isControl) {
      for (const label of ['标题', '控件标题', 'parameterId', '当前值', '值来源', '绑定设置或参数', '默认设置或参数', '玩家设置', '初始值', '在参数集中查看', '绑定失效', '重新选择来源']) labels.add(label);
      if (control?.range || component.controlRange) {
        for (const property of ['minimum', 'maximum', 'step'] as const) { labels.add(property); labels.add(uiProperties[property].name); }
        for (const label of ['自定义控件范围', '控件数值范围', '应用整个控件范围', '恢复绑定源范围', '最小值', '最大值', '范围如何生效']) labels.add(label);
      }
      if (control?.choice) for (const label of component.parameterId ? ['横向选项组', '选项文字', '选项值'] : ['下拉选项', '添加选项', '删除选项', '选项文字', '选项值']) labels.add(label);
      if (!component.parameterId && component.preference === 'characterVolume') labels.add('配音角色');
    }
  }
  if (group === 'appearance') {
    if (states.length > 1) for (const label of ['预览状态', '外观预览状态']) labels.add(label);
    if (uiInspectorSkinApplies(project, component)) {
      for (const state of states) if (state !== 'idle' || component.kind !== 'image') labels.add(stateNames[state] + '图片');
      if (component.kind !== 'image') for (const label of ['图片缩放', '图片缩放方式', '九宫格边距', '左边距', '上边距', '右边距', '下边距', '恢复图片缩放']) labels.add(label);
      labels.add('图片亮度 %');
    }
    if (component.kind === 'image') labels.add('图片亮度 %');
    if (component.kind === 'button') labels.add('图片已含文字');
    if (component.kind === 'progress') for (const label of ['轨道颜色', '填充颜色']) labels.add(label);
    if (control?.slider) labels.add('滑条外观');
    if (control?.choice && !component.parameterId) {
      for (const label of ['选项行高', '下拉箭头图片']) labels.add(label);
      if (component.preference !== 'windowSize') for (const label of ['下拉面板底图', '下拉选项状态图片', '选项状态', '普通选项图', '悬停选项图', '按住选项图', '不可用选项图']) labels.add(label);
    }
    if (isControl && component.slider && !control?.slider) labels.add('已保存滑条外观');
    if (isControl && component.selector && !(control?.choice && !component.parameterId)) labels.add('已保存下拉外观');
  }
  if (group === 'visibility') {
    if (component.kind === 'flowchart') labels.add('整图不透明度 %');
    if (component.page === 'say') { labels.add('playerOpacity'); labels.add('跟随玩家对话框透明度'); }
  }
  if (group === 'interaction') {
    for (const event of uiInspectorControlEvents(project, component)) { labels.add(event.label); labels.add(`添加${event.label}事件`); labels.add(`编辑${event.label}事件`); }
    if (component.kind === 'button' || control) for (const label of ['允许玩家操作', 'enabledWhen', '可操作条件', '添加可操作条件', '应用可操作条件', '清除可操作条件', '禁用', '启用']) labels.add(label);
    if (component.kind === 'button') {
      for (const label of ['点击后', '点击行为', '点击执行顺序', '调用蓝图', '更多按钮事件', 'selectedWhen', '选中状态条件', '添加选中状态条件', '应用选中状态条件', '清除选中状态条件', '提示与快捷键', '快捷键', '按钮快捷键', '页面接入入口', '原点击事件模式', '点击事件蓝图', '已有蓝图与流程出口', '流程图出口', '出口名称']) labels.add(label);
      if (component.action === 'setPlayerPreference') for (const label of ['绑定设置或参数', '玩家设置', '设置值', '配音角色']) labels.add(label);
    }
    if (['button', 'flowchart', 'chapterList', 'musicTrackList', 'voiceCollection', 'historyList'].includes(component.kind)) for (const label of ['声音反馈', '悬停音效', '点击音效', '静音', '不播放', '使用页面默认音效']) labels.add(label);
    if (isControl && component.readOnly !== undefined) labels.add('禁止用户改值');
  }
  addCollectionLabels(component, group, labels);
  return [...labels];
}
