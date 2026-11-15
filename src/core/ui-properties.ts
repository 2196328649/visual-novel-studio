import { uiSpineMaximumSpeed, uiSpineSpeedMessage, uiSpineSpeedProblem, uiSpineSpeedRange, uiSpineStatuses } from './ui-spine';
import { uiVideoStatuses } from './ui-video';
import { uiImageStatuses } from './ui-image';
import { resolveUiLayout, uiLayoutObservation, isUiLayoutObservation, type UiLayoutGeometry } from './ui-layout';
import { allUiComponents, effectiveUiComponents, type Asset, type Project, type UiComponent, type UiTheme, type VariableValue } from './model';
import { uiComponentTheme, uiPageTheme } from './ui-page-settings';
import { uiControlDefinition, uiControlPropertyApplies, uiControlPropertyDefault, isUiControlValueProperty, isUiControlRangeProperty, type UiControlDefinition } from './ui-control-properties';

export interface UiPropertyDefinition {
  name: string;
  type: 'boolean' | 'number' | 'string';
  initial: VariableValue;
  path: readonly string[];
  kinds?: readonly UiComponent['kind'][];
  readable: boolean;
  writable: boolean;
  bindable: boolean;
  animated: boolean;
  unit?: string;
  min?: number;
  max?: number;
  integer?: boolean;
  options?: Record<string, string>;
  resource?: Asset['kind'];
  color?: boolean;
  reset: 'field' | 'none';
  description?: string;
  invalidMessage?: string;
  preview: boolean;
  runtime: boolean;
}
const define = (info: Pick<UiPropertyDefinition, 'name' | 'type' | 'initial' | 'path'> & Partial<UiPropertyDefinition>): UiPropertyDefinition => ({ readable: true, writable: true, bindable: true, animated: false, reset: 'field', preview: true, runtime: true, ...info });
const textKinds: UiComponent['kind'][] = ['text', 'button'];
const controlKinds: UiComponent['kind'][] = ['preference', 'preferenceChoice'];
const boxKinds: UiComponent['kind'][] = ['text', 'button', 'panel', 'progress'];
const framedKinds: UiComponent['kind'][] = [...boxKinds, 'image', 'video', 'spine'];
const observed = (info: Pick<UiPropertyDefinition, 'name' | 'type' | 'initial'> & Partial<UiPropertyDefinition>) => define({ path: [], writable: false, bindable: false, reset: 'none', ...info });
const image = (name: string, path: string[], kinds: UiComponent['kind'][] = ['button']) => define({ name, path, kinds, type: 'string', initial: '', resource: 'image' });
const color = (name: string, field: string, initial: string, kinds = textKinds) => define({ name, path: ['style', field], type: 'string', initial, kinds, color: true });

/** Stable IDs are shared by pins, field editors, diagnostics, preview and generated runtime. */
export const uiProperties = {
  visible: define({ name: '显示', type: 'boolean', initial: true, path: [] }),
  enabled: define({ name: '启用', type: 'boolean', initial: true, path: [], kinds: ['button', 'preference', 'preferenceChoice'] }),
  selected: define({ name: '选中', type: 'boolean', initial: false, path: [], kinds: ['button'] }),
  hovered: observed({ name: '鼠标悬停（只读）', type: 'boolean', initial: false, kinds: ['button'], description: '当前页面实例上真实鼠标命中状态；隐藏、禁用或失去页面输入时为否。' }),
  pressed: observed({ name: '鼠标按下（只读）', type: 'boolean', initial: false, kinds: ['button'], description: '鼠标按住并仍在按钮内；程序赋值不能伪造点击。' }),
  layer: define({ name: '显示层级（同级）', type: 'number', initial: 0, path: ['layer'], description: '同父级、同前景/背景分组内排序；同值保持原顺序，不越过父级子树或页面模态顺序。' }),
  screenX: observed({ name: '画面横向坐标（只读）', type: 'number', initial: 0, unit: '画面像素' }),
  screenY: observed({ name: '画面纵向坐标（只读）', type: 'number', initial: 0, unit: '画面像素' }),
  screenWidth: observed({ name: '画面宽度（只读）', type: 'number', initial: 0, unit: '画面像素' }),
  screenHeight: observed({ name: '画面高度（只读）', type: 'number', initial: 0, unit: '画面像素' }),
  text: define({ name: '文字', type: 'string', initial: '', path: ['text'], kinds: textKinds }),
  x: define({ name: '横向位置（父级比例）', type: 'number', initial: 0, path: ['x'], unit: '父级宽度比例', animated: true }),
  y: define({ name: '纵向位置（父级比例）', type: 'number', initial: 0, path: ['y'], unit: '父级高度比例', animated: true }),
  width: define({ name: '宽度（父级比例）', type: 'number', initial: 1, path: ['width'], unit: '父级宽度比例', min: 0, animated: true }),
  height: define({ name: '高度（父级比例）', type: 'number', initial: 1, path: ['height'], unit: '父级高度比例', min: 0, animated: true }),
  opacity: define({ name: '不透明度（0～1）', type: 'number', initial: 1, path: ['style', 'opacity'], min: 0, max: 1, animated: true }),
  value: define({ name: '进度（0～1）', type: 'number', initial: 0, path: ['value'], kinds: ['progress'], min: 0, max: 1, animated: true }),
  numberValue: define({ name: '当前数值', type: 'number', initial: 0, path: [], kinds: controlKinds, description: '实际控件值。默认设置下，临时覆盖仅影响本控件，修改绑定源会同步其他控件；有关联时按这一项的控制方式处理。程序赋值不触发用户改值事件。' }),
  stringValue: define({ name: '当前文字值', type: 'string', initial: '', path: [], kinds: controlKinds, description: '输入或文字选项的实际值；不修改标签。默认设置下可临时覆盖或修改原绑定源；有关联时按这一项的控制方式处理。' }),
  booleanValue: define({ name: '当前开关值', type: 'boolean', initial: false, path: [], kinds: controlKinds }),
  minimum: define({ name: '控件范围下限', type: 'number', initial: 0, path: ['controlRange', 'min'], kinds: controlKinds, description: '限制本控件的有效数值，不改当前值的来源。若范围属性另设双向同步，修改范围会写回其关联参数。跨越原上下限时使用“设置控件范围”一次更新。' }),
  maximum: define({ name: '控件范围上限', type: 'number', initial: 1, path: ['controlRange', 'max'], kinds: controlKinds }),
  step: define({ name: '用户调整步长', type: 'number', initial: 1, path: ['controlRange', 'step'], kinds: controlKinds, description: '必须大于 0；程序赋值不按步长取整。上下限相等时控件固定在该值。' }),
  sourceMinimum: observed({ name: '绑定源范围下限（只读）', type: 'number', initial: 0, kinds: controlKinds }),
  sourceMaximum: observed({ name: '绑定源范围上限（只读）', type: 'number', initial: 1, kinds: controlKinds }),
  sourceStep: observed({ name: '绑定源步长（只读）', type: 'number', initial: 1, kinds: controlKinds }),
  normalizedValue: define({ name: '归一化值（0～1）', type: 'number', initial: 0, path: [], kinds: controlKinds, min: 0, max: 1, description: '按当前控件范围映射；下限为 0 且上限大于 0 时，文字速度最右端 1 表示立即显示（实际数值 0）。固定范围归一化为 0；方向反转只改变画面。' }),
  optionCount: observed({ name: '选项数量（只读）', type: 'number', initial: 0, kinds: controlKinds }),
  optionIndex: define({ name: '当前选项索引', type: 'number', initial: 0, path: [], kinds: controlKinds, min: -1, integer: true, description: '从 0 开始；读取 -1 表示无匹配值。赋值只能选择现有选项，值、索引和标签同步变化。' }),
  optionLabel: observed({ name: '当前选项标签（只读）', type: 'string', initial: '', kinds: controlKinds }),
  readOnly: define({ name: '禁止用户改值', type: 'boolean', initial: false, path: ['readOnly'], kinds: controlKinds, description: '只限制玩家操作；蓝图能否改写当前值取决于该值的控制方式。默认设置可临时覆盖或修改原绑定源，程序赋值不会伪造用户事件。' }),
  placeholder: define({ name: '输入占位文字', type: 'string', initial: '', path: ['input', 'placeholder'], kinds: controlKinds, max: 2000 }),
  maxLength: define({ name: '输入最大长度', type: 'number', initial: 200, path: ['input', 'maxLength'], kinds: controlKinds, min: 0, integer: true, unit: 'Unicode 字符', description: '减少上限不截断已保存的绑定值；后续输入或程序赋值按新上限检查。' }),
  focused: observed({ name: '输入焦点（只读）', type: 'boolean', initial: false, kinds: controlKinds, description: '输入框实际正在接收键盘输入，不表示已有焦点请求；页面关闭、被模态遮挡、禁用或只读后为否。' }),
  sliderTrackImage: image('滑条轨道图片', ['slider', 'trackId'], controlKinds),
  sliderFillImage: image('滑条填充图片', ['slider', 'fillId'], controlKinds),
  sliderThumbImage: image('滑块普通图片', ['slider', 'thumb', 'idle'], controlKinds),
  sliderHoverThumbImage: image('滑块悬停图片', ['slider', 'thumb', 'hover'], controlKinds),
  sliderPressedThumbImage: image('滑块按下图片', ['slider', 'thumb', 'pressed'], controlKinds),
  sliderDisabledThumbImage: image('滑块禁用图片', ['slider', 'thumb', 'disabled'], controlKinds),
  sliderTrackColor: define({ name: '滑条轨道颜色', type: 'string', initial: '#515c60', path: ['slider', 'trackColor'], kinds: controlKinds, color: true }),
  sliderFillColor: define({ name: '滑条填充颜色', type: 'string', initial: '#78bbaa', path: ['slider', 'fillColor'], kinds: controlKinds, color: true }),
  sliderThumbColor: define({ name: '滑块底色', type: 'string', initial: '#eef1ef', path: ['slider', 'thumbColor'], kinds: controlKinds, color: true }),
  sliderTrackHeight: define({ name: '滑条轨道高度', type: 'number', initial: 12, path: ['slider', 'trackHeight'], kinds: controlKinds, min: 0.01, unit: '画面像素' }),
  sliderThumbWidth: define({ name: '滑块宽度', type: 'number', initial: 26, path: ['slider', 'thumbWidth'], kinds: controlKinds, min: 0.01, unit: '画面像素' }),
  sliderThumbHeight: define({ name: '滑块高度', type: 'number', initial: 26, path: ['slider', 'thumbHeight'], kinds: controlKinds, min: 0.01, unit: '画面像素' }),
  sliderReverse: define({ name: '滑条方向反转', type: 'boolean', initial: false, path: ['slider', 'reverse'], kinds: controlKinds }),
  sliderShowLabel: define({ name: '显示滑条标签', type: 'boolean', initial: true, path: ['slider', 'showLabel'], kinds: controlKinds }),
  anchorX: define({ name: '父内容区横向锚点', type: 'number', initial: 0, path: ['layout', 'anchorX'], min: 0, max: 1, description: '位置为相对父内容区锚点的偏移；0 左、0.5 中、1 右。根级相对画面。' }),
  anchorY: define({ name: '父内容区纵向锚点', type: 'number', initial: 0, path: ['layout', 'anchorY'], min: 0, max: 1 }),
  pivotX: define({ name: '自身横向轴心', type: 'number', initial: 0, path: ['layout', 'pivotX'], min: 0, max: 1 }),
  pivotY: define({ name: '自身纵向轴心', type: 'number', initial: 0, path: ['layout', 'pivotY'], min: 0, max: 1 }),
  layoutRotation: define({ name: '控件整体旋转', type: 'number', initial: 0, path: ['layout', 'rotation'], unit: '顺时针角度', description: '围绕自身轴心旋转整个控件、子树和命中区域；与图片效果、Spine 内部变换分开。' }),
  scaleX: define({ name: '控件整体横向缩放', type: 'number', initial: 1, path: ['layout', 'scaleX'], description: '负值镜像；0 不可见且不可命中。先缩放再旋转，不改变排列槽位。' }),
  scaleY: define({ name: '控件整体纵向缩放', type: 'number', initial: 1, path: ['layout', 'scaleY'] }),
  layoutFlow: define({ name: '前景子项排列', type: 'string', initial: 'absolute', path: ['layout', 'flow'], options: { absolute: '自由布局', horizontal: '横向排列', vertical: '纵向排列' }, description: '仅排列创作的直接前景子项；隐藏项不占槽位，背景子项不随排列或滚动移动。复杂控件内部条目不受此设置影响。' }),
  layoutOrder: define({ name: '子项排列顺序', type: 'number', initial: 0, path: ['layout', 'order'], description: '同父级内排序；不改变绘制层级或编辑器列表顺序。' }),
  childGap: define({ name: '子项间距', type: 'number', initial: 0, path: ['layout', 'gap'], min: 0, unit: '画面像素' }),
  paddingLeft: define({ name: '容器左内边距', type: 'number', initial: 0, path: ['layout', 'paddingLeft'], min: 0, unit: '画面像素' }),
  paddingTop: define({ name: '容器上内边距', type: 'number', initial: 0, path: ['layout', 'paddingTop'], min: 0, unit: '画面像素' }),
  paddingRight: define({ name: '容器右内边距', type: 'number', initial: 0, path: ['layout', 'paddingRight'], min: 0, unit: '画面像素' }),
  paddingBottom: define({ name: '容器下内边距', type: 'number', initial: 0, path: ['layout', 'paddingBottom'], min: 0, unit: '画面像素' }),
  clipChildren: define({ name: '裁剪子项', type: 'boolean', initial: false, path: ['layout', 'clip'], description: '前景子项裁到内容区，背景子项裁到外框；裁剪后的区域不接收指针或焦点。' }),
  scrollMode: define({ name: '容器滚动方向', type: 'string', initial: 'none', path: ['layout', 'scroll'], options: { none: '不滚动', horizontal: '横向', vertical: '纵向', both: '双向' }, description: '启用滚动会同时裁剪子项。滚轮优先最内层容器，到边界后可交给父容器；Shift 滚轮横移。' }),
  scrollX: define({ name: '横向滚动位置', type: 'number', initial: 0, path: ['layout', 'scrollX'], unit: '画面像素', description: '读取当前有效位置；写入/绑定的请求值按当前内容边界限制，不修改设计数据。' }),
  scrollY: define({ name: '纵向滚动位置', type: 'number', initial: 0, path: ['layout', 'scrollY'], unit: '画面像素' }),
  scrollMinimumX: observed({ name: '横向滚动下限', type: 'number', initial: 0, unit: '画面像素' }),
  scrollMinimumY: observed({ name: '纵向滚动下限', type: 'number', initial: 0, unit: '画面像素' }),
  scrollMaximumX: observed({ name: '横向滚动上限', type: 'number', initial: 0, unit: '画面像素' }),
  scrollMaximumY: observed({ name: '纵向滚动上限', type: 'number', initial: 0, unit: '画面像素' }),
  contentWidth: observed({ name: '可滚动内容宽度', type: 'number', initial: 0, unit: '画面像素' }),
  contentHeight: observed({ name: '可滚动内容高度', type: 'number', initial: 0, unit: '画面像素' }),
  spineAsset: define({ name: '骨骼素材（空值清空）', type: 'string', initial: '', path: ['assetId'], kinds: ['spine'], resource: 'spine', description: '换素材从其第一个动画与默认皮肤开始；保留循环、速度和作者暂停。相同素材赋值不重播。' }),
  spineSkin: define({ name: '骨骼皮肤（空值默认）', type: 'string', initial: '', path: ['spine', 'skin'], kinds: ['spine'], description: '只替换皮肤与插槽，不重启动画；名称须属于当前素材。' }),
  spineLoop: define({ name: '骨骼循环播放', type: 'boolean', initial: true, path: ['spine', 'loop'], kinds: ['spine'], description: '修改循环不重播当前片段；完成事件只在非循环动画结束时发生。' }),
  spineSpeed: define({ name: '骨骼播放速度', type: 'number', initial: 1, path: ['spine', 'speed'], kinds: ['spine'], min: 0, max: uiSpineMaximumSpeed, unit: '倍', invalidMessage: uiSpineSpeedMessage, description: `支持 ${uiSpineSpeedRange} 倍；0 保留当前姿态，改变速度不重播。超出范围会拒绝，保留原值。` }),
  spineFit: define({ name: '骨骼内部布局', type: 'string', initial: 'contain', path: ['spine', 'fit'], kinds: ['spine'], options: { contain: '适应组件区域', manual: '自定义原点与缩放' } }),
  spineScale: define({ name: '骨骼内部缩放', type: 'number', initial: 1, path: ['spine', 'scale'], kinds: ['spine'], description: '仅自定义布局有效；不改变整个控件的布局与命中范围。' }),
  spineOriginX: define({ name: '骨骼横向原点', type: 'number', initial: .5, path: ['spine', 'originX'], kinds: ['spine'], unit: '控件宽度比例' }),
  spineOriginY: define({ name: '骨骼纵向原点', type: 'number', initial: .5, path: ['spine', 'originY'], kinds: ['spine'], unit: '控件高度比例' }),
  spineRotation: define({ name: '骨骼内部旋转', type: 'number', initial: 0, path: ['spine', 'rotation'], kinds: ['spine'], unit: '顺时针角度' }),
  spineFlipX: define({ name: '骨骼水平翻转', type: 'boolean', initial: false, path: ['spine', 'flipX'], kinds: ['spine'] }),
  spineFlipY: define({ name: '骨骼垂直翻转', type: 'boolean', initial: false, path: ['spine', 'flipY'], kinds: ['spine'] }),
  spineAnimation: observed({ name: '当前骨骼动画（只读）', type: 'string', initial: '', kinds: ['spine'], description: '当前播放请求的动画名称；切换使用播放骨骼动画节点。' }),
  spineStatus: observed({ name: '骨骼播放状态（只读）', type: 'string', initial: 'empty', kinds: ['spine'], options: uiSpineStatuses }),
  spinePlaying: observed({ name: '骨骼正在播放（只读）', type: 'boolean', initial: false, kinds: ['spine'] }),
  spinePaused: observed({ name: '骨骼已暂停（只读）', type: 'boolean', initial: false, kinds: ['spine'], description: '包括作者暂停、隐藏挂起或零速度；重新显示不会解除作者暂停。' }),
  spinePosition: observed({ name: '骨骼当前位置（只读）', type: 'number', initial: 0, kinds: ['spine'], unit: '当前动画周期内的秒数' }),
  spineDuration: observed({ name: '骨骼动画时长（只读）', type: 'number', initial: 0, kinds: ['spine'], unit: '秒' }),
  spineDurationKnown: observed({ name: '骨骼时长已知（只读）', type: 'boolean', initial: false, kinds: ['spine'], description: '实际运行库加载后的时长；零时长动画也可为已知。' }),
  spineProgress: observed({ name: '骨骼动画进度（只读）', type: 'number', initial: 0, kinds: ['spine'], min: 0, max: 1 }),
  spineError: observed({ name: '骨骼播放错误（只读）', type: 'string', initial: '', kinds: ['spine'] }),
  video: define({ name: '视频素材（空值清空）', type: 'string', initial: '', path: ['assetId'], kinds: ['video'], resource: 'video', description: '切换来源从头播放；清空不触发结束事件。相同素材赋值不重播，显式重播请用播放视频节点。' }),
  videoPoster: image('视频封面（空值清空）', ['posterId'], ['video']),
  videoLoop: define({ name: '视频循环播放', type: 'boolean', initial: true, path: ['loop'], kinds: ['video'], description: '改变循环不重播当前片段；循环边界不触发播放结束事件。' }),
  videoStatus: observed({ name: '视频播放状态（只读）', type: 'string', initial: 'empty', kinds: ['video'], options: uiVideoStatuses, description: '来自实际播放器和解码器；素材登记或预演时钟不能伪造开始、结束或失败。隐藏和宿主挂起暂停，重新显示按作者播放模式恢复。' }),
  videoPlaying: observed({ name: '视频正在播放（只读）', type: 'boolean', initial: false, kinds: ['video'] }),
  videoPaused: observed({ name: '视频已暂停（只读）', type: 'boolean', initial: false, kinds: ['video'] }),
  videoPosition: observed({ name: '视频当前位置（只读）', type: 'number', initial: 0, kinds: ['video'], unit: '秒' }),
  videoDuration: observed({ name: '视频总时长（只读）', type: 'number', initial: 0, kinds: ['video'], unit: '秒', description: '实际播放器报告的时长；videoDurationKnown 为否时 0 表示未知，不代表零时长。' }),
  videoDurationKnown: observed({ name: '视频时长已知（只读）', type: 'boolean', initial: false, kinds: ['video'] }),
  videoProgress: observed({ name: '视频进度（只读）', type: 'number', initial: 0, kinds: ['video'], min: 0, max: 1 }),
  videoError: observed({ name: '视频播放错误（只读）', type: 'string', initial: '', kinds: ['video'] }),
  videoCanSeek: observed({ name: '视频支持作者定位（只读）', type: 'boolean', initial: false, kinds: ['video'], description: '当前共享接口不提供作者定位操作；内部存档位置恢复不等同于开放定位能力。' }),
  image: image('图片素材（空值清空）', ['assetId'], ['image']),
  imageFit: define({ name: '图片缩放方式', type: 'string', initial: 'contain', path: ['style', 'imageFit'], kinds: ['image'], options: { contain: '完整显示', cover: '裁切铺满', stretch: '拉伸铺满', nineSlice: '九宫格缩放' } }),
  imageCropX: define({ name: '图片裁切横向起点', type: 'number', initial: 0, path: ['imageEffects', 'cropX'], kinds: ['image'], min: 0, max: 1, unit: '源图宽度比例', description: '先按源图裁切，再缩放到控件；超出源图部分被裁去，零面积透明，不改变控件布局。' }),
  imageCropY: define({ name: '图片裁切纵向起点', type: 'number', initial: 0, path: ['imageEffects', 'cropY'], kinds: ['image'], min: 0, max: 1, unit: '源图高度比例' }),
  imageCropWidth: define({ name: '图片裁切宽度', type: 'number', initial: 1, path: ['imageEffects', 'cropWidth'], kinds: ['image'], min: 0, max: 1, unit: '源图宽度比例' }),
  imageCropHeight: define({ name: '图片裁切高度', type: 'number', initial: 1, path: ['imageEffects', 'cropHeight'], kinds: ['image'], min: 0, max: 1, unit: '源图高度比例' }),
  imageFlipX: define({ name: '图片水平翻转', type: 'boolean', initial: false, path: ['imageEffects', 'flipX'], kinds: ['image'], description: '只翻转本图片，不改变子项坐标或控件的布局、命中区域。' }),
  imageFlipY: define({ name: '图片垂直翻转', type: 'boolean', initial: false, path: ['imageEffects', 'flipY'], kinds: ['image'] }),
  imageTint: define({ name: '图片乘色', type: 'string', initial: '#ffffff', path: ['imageEffects', 'tint'], kinds: ['image'], color: true, description: '逐通道相乘，白色保留原色；支持 RGBA 透明度。状态亮度在乘色后叠加。' }),
  imageStatus: observed({ name: '图片加载状态（只读）', type: 'string', initial: 'empty', kinds: ['image'], options: uiImageStatuses, description: '实际当前显示图片的加载结果；仅登记素材或隐藏未渲染时不会报告成功。清空不产生加载事件。' }),
  imageError: observed({ name: '图片加载错误（只读）', type: 'string', initial: '', kinds: ['image'] }),
  imageSource: observed({ name: '实际显示图片（只读）', type: 'string', initial: '', kinds: ['image'], resource: 'image', description: '含父级交互状态皮肤的实际来源；与可写的普通图片素材分开。' }),
  imageSourceWidth: observed({ name: '源图片宽度（只读）', type: 'number', initial: 0, kinds: ['image'], unit: '源图像素' }),
  imageSourceHeight: observed({ name: '源图片高度（只读）', type: 'number', initial: 0, kinds: ['image'], unit: '源图像素' }),
  textColor: color('文字颜色', 'textColor', '#f5f7f7'),
  hoverTextColor: color('悬停文字颜色', 'hoverTextColor', '#f5f7f7'),
  selectedTextColor: color('选中文字颜色', 'selectedTextColor', '#f5f7f7'),
  disabledTextColor: color('禁用文字颜色', 'disabledTextColor', '#f5f7f7'),
  fontSize: define({ name: '字号', type: 'number', initial: 28, path: ['style', 'fontSize'], kinds: textKinds, unit: '画面像素', min: 1, integer: true }),
  font: define({ name: '字体素材（空值使用默认）', type: 'string', initial: '', path: ['style', 'fontAssetId'], kinds: textKinds, resource: 'font' }),
  align: define({ name: '文字对齐', type: 'string', initial: 'left', path: ['style', 'align'], kinds: textKinds, options: { left: '左对齐', center: '居中', right: '右对齐' } }),
  outlineWidth: define({ name: '描边宽度', type: 'number', initial: 0, path: ['style', 'outlineWidth'], kinds: textKinds, unit: '画面像素', min: 0 }),
  outlineColor: color('描边颜色', 'outlineColor', '#000000'),
  outlineOpacity: define({ name: '描边不透明度', type: 'number', initial: 1, path: ['style', 'outlineOpacity'], kinds: textKinds, min: 0, max: 1 }),
  shadowX: define({ name: '阴影横向偏移', type: 'number', initial: 0, path: ['style', 'shadowX'], kinds: textKinds, unit: '画面像素' }),
  shadowY: define({ name: '阴影纵向偏移', type: 'number', initial: 0, path: ['style', 'shadowY'], kinds: textKinds, unit: '画面像素' }),
  shadowColor: color('阴影颜色', 'shadowColor', '#000000'),
  shadowOpacity: define({ name: '阴影不透明度', type: 'number', initial: .7, path: ['style', 'shadowOpacity'], kinds: textKinds, min: 0, max: 1 }),
  shadowBlur: define({ name: '阴影模糊半径', type: 'number', initial: 0, path: ['style', 'shadowBlur'], kinds: textKinds, min: 0, unit: '画面像素' }),
  shadowSpread: define({ name: '阴影扩展', type: 'number', initial: 0, path: ['style', 'shadowSpread'], kinds: textKinds, min: 0, unit: '画面像素' }),
  background: color('背景颜色', 'background', '#283133', boxKinds),
  hoverBackground: color('悬停背景颜色', 'hoverBackground', '#3b8f80', boxKinds),
  pressedBackground: color('按下背景颜色', 'pressedBackground', '#3b8f80', boxKinds),
  selectedBackground: color('选中/进度填充颜色', 'selectedBackground', '#3b8f80', boxKinds),
  disabledBackground: color('禁用背景颜色', 'disabledBackground', '#22282a', boxKinds),
  borderColor: color('边框颜色', 'borderColor', '#ffffff', framedKinds),
  borderWidth: define({ name: '边框宽度', type: 'number', initial: 0, path: ['style', 'borderWidth'], kinds: framedKinds, min: 0, unit: '画面像素' }),
  radius: define({ name: '圆角半径', type: 'number', initial: 0, path: ['style', 'radius'], kinds: framedKinds, min: 0, unit: '画面像素', description: '圆角只影响控件自身背景和媒体内容；不裁切文字阴影或子控件。实际半径不超过控件短边的一半。' }),
  idleImage: image('按钮普通图片', ['skin', 'idle']),
  hoverImage: image('按钮悬停图片', ['skin', 'hover']),
  pressedImage: image('按钮按下图片', ['skin', 'pressed']),
  selectedImage: image('按钮选中图片', ['skin', 'selected']),
  disabledImage: image('按钮禁用图片', ['skin', 'disabled']),
  tooltip: define({ name: '按钮提示', type: 'string', initial: '', path: ['tooltip'], kinds: ['button'], max: 200 }),
  hoverSound: define({ name: '悬停音效（空值静音）', type: 'string', initial: '', path: ['hoverSoundId'], kinds: ['button'], resource: 'audio' }),
  clickSound: define({ name: '点击音效（空值静音）', type: 'string', initial: '', path: ['clickSoundId'], kinds: ['button'], resource: 'audio' }),
};
export type UiProperty = keyof typeof uiProperties;
export function uiPropertyApplies(component: UiComponent, property: UiProperty, project?: Project, control?: UiControlDefinition): boolean {
  const info = uiProperties[property];
  return !!info && (!info.kinds || info.kinds.includes(component.kind)) && (!project || uiControlPropertyApplies(control ?? uiControlDefinition(project, component), property));
}
export function uiPropertyWritable(property: string): boolean { return uiProperties[property as UiProperty]?.writable === true; }
export function uiPropertyPinType(property: string) {
  const info = uiProperties[property as UiProperty];
  return info?.resource ? 'asset' as const : info?.type;
}
export function uiPropertyValueProblem(project: Project, property: string, value: unknown): string | undefined {
  const info = uiProperties[property as UiProperty];
  if (!info) return '组件属性不存在。';
  if (property === 'spineSpeed') return uiSpineSpeedProblem(value);
  if (typeof value !== info.type || typeof value === 'number' && (!Number.isFinite(value) || info.min !== undefined && value < info.min || info.max !== undefined && value > info.max || info.integer && !Number.isInteger(value))) return info.name + '的类型或范围不正确。';
  if (property === 'step' && Number(value) <= 0) return '控件步长必须大于 0。';
  if (info.options && !Object.hasOwn(info.options, String(value))) return '请选择有效的' + info.name + '。';
  if (info.color && !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(String(value))) return info.name + '需要六位 RGB 或八位 RGBA 十六进制颜色。';
  if (typeof value === 'string' && info.max !== undefined && value.length > info.max) return info.name + '超出长度限制。';
  if (info.resource && value !== '' && !project.assets.some(a => a.id === value && a.kind === info.resource)) return info.name + '引用的素材缺失或类型不正确。';
}
function uiLayoutDesignComponents(project: Project, component: UiComponent): UiComponent[] {
  const active = allUiComponents(project);
  if (active.some(c => c.id === component.id)) return active;
  const owner = project.ui.components.some(c => c.id === component.id) ? undefined : project.ui.instances?.find(instance => instance.components.some(c => c.id === component.id))?.id;
  return effectiveUiComponents({ ...project.ui, activeInstanceId: owner });
}
export function uiPropertyDefault(project: Project, component: UiComponent, property: UiProperty, components?: readonly UiComponent[], control?: UiControlDefinition, resolvedTheme?: UiTheme): VariableValue {
  const info = uiProperties[property];
  let value: unknown = component;
  for (const key of info.path) value = value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
  if (info.path.length && value !== undefined && value !== null) return value as VariableValue;
  const bound = control ?? uiControlDefinition(project, component);
  const controlDefault = bound && uiControlPropertyDefault(bound, property);
  if (controlDefault !== undefined) return controlDefault;
  const theme = resolvedTheme ?? uiComponentTheme(project, component);
  if (property === 'sliderFillColor') return component.slider?.trackId ? '#00000000' : theme.accent;
  if (['textColor', 'hoverTextColor', 'selectedTextColor', 'disabledTextColor'].includes(property)) return component.style?.textColor ?? theme.textColor;
  if (property === 'layer') {
    const page = component.page === 'custom' ? project.ui.customPages.find(page => page.components.some(c => c.id === component.id)) : undefined;
    const ids = page && new Set(page.components.map(c => c.id));
    return Math.max(0, (components ?? allUiComponents(project)).filter(c => c.page === component.page && (!ids || ids.has(c.id))).findIndex(c => c.id === component.id));
  }
  if (property === 'spineAnimation') return component.spine?.animation ?? project.assets.find(a => a.id === component.assetId)?.spine?.animations[0]?.name ?? '';
  if (property === 'scrollX' || property === 'scrollY') return info.initial;
  if (isUiLayoutObservation(property)) {
    const geometry = resolveUiLayout(components ?? uiLayoutDesignComponents(project, component), project).get(component.id);
    if (geometry) return uiLayoutObservation(geometry, property) ?? info.initial;
  }
  if (property === 'hoverBackground') return component.style?.background ?? (component.kind === 'button' ? theme.accent : '#00000000');
  if (property === 'pressedBackground') return component.style?.hoverBackground ?? (component.kind === 'button' ? theme.accent : component.style?.background ?? '#00000000');
  if (property === 'selectedBackground') return component.kind === 'progress' ? theme.accent : component.style?.hoverBackground ?? (component.kind === 'button' ? theme.accent : component.style?.background ?? '#00000000');
  if (property === 'disabledBackground') return component.kind === 'button' ? '#22282a' : component.style?.background ?? '#00000000';
  if (property === 'fontSize') return theme.fontSize;
  if (property === 'font') return theme.fontAssetId ?? '';
  if (property === 'align') return component.kind === 'text' ? 'left' : 'center';
  if (property === 'background' && component.kind !== 'button' && component.kind !== 'progress') return '#00000000';
  if (property === 'enabled') return !component.disabled;
  if (property === 'tooltip') return component.skin?.hideText ? component.text : '';
  if (property === 'hoverSound') return project.assets.find(asset => asset.kind === 'audio' && asset.id === (component.hoverSoundId === undefined ? theme.hoverSoundId : component.hoverSoundId))?.id ?? '';
  if (property === 'clickSound') return project.assets.find(asset => asset.kind === 'audio' && asset.id === (component.clickSoundId === undefined ? theme.clickSoundId : component.clickSoundId))?.id ?? '';
  return info.initial;
}
/** Build once for a preview/compile snapshot; property reads never rescan the project. */
export function uiPropertyDefaults(project: Project, components: readonly UiComponent[]): Record<string, Partial<Record<UiProperty, VariableValue>>> {
  const activeIds = new Set(allUiComponents(project).map(c => c.id));
  const inactiveIds = new Set([...project.ui.components, ...(project.ui.instances ?? []).flatMap(i => i.components)].filter(c => !activeIds.has(c.id)).map(c => c.id));
  const world = resolveUiLayout(components.filter(c => !inactiveIds.has(c.id)), project);
  // Resolve each inactive definition in its own authored inheritance chain, not
  // a synthetic page containing unrelated variants (or active parent overrides).
  const ownerById = new Map(project.ui.components.map(c => [c.id, 'base']));
  for (const instance of project.ui.instances ?? []) for (const c of instance.components) if (!ownerById.has(c.id)) ownerById.set(c.id, instance.id);
  const scenes = new Map<string, ReturnType<typeof resolveUiLayout>>();
  const inactiveWorld = new Map<string, UiLayoutGeometry>();
  for (const component of components) if (inactiveIds.has(component.id)) {
    const owner = ownerById.get(component.id) ?? 'base';
    let scene = scenes.get(owner);
    if (!scene) { scene = resolveUiLayout(effectiveUiComponents({ ...project.ui, activeInstanceId: owner === 'base' ? undefined : owner }), project); scenes.set(owner, scene); }
    const geometry = scene.get(component.id); if (geometry) inactiveWorld.set(component.id, geometry);
  }
  const customOwners = new Map(project.ui.customPages.flatMap(page => page.components.map(component => [component.id, page.id] as const))), pageRanks = new Map<string, number>();
  const themes = new Map<string, UiTheme>();
  return Object.fromEntries(components.map(component => {
    const control = uiControlDefinition(project, component);
    const page = component.page === 'custom' ? customOwners.get(component.id) ?? 'custom' : component.page;
    const owner = inactiveIds.has(component.id) ? ownerById.get(component.id) ?? 'base' : project.ui.activeInstanceId ?? 'base';
    const themeKey = owner + '/' + page;
    let theme = themes.get(themeKey);
    if (!theme) {
      theme = uiPageTheme(owner === (project.ui.activeInstanceId ?? 'base') ? project : { ...project, ui: { ...project.ui, activeInstanceId: owner === 'base' ? undefined : owner } }, component.page === 'custom' ? page : 'ui:' + page);
      themes.set(themeKey, theme);
    }
    const index = pageRanks.get(page) ?? 0; pageRanks.set(page, index + 1);
    return [component.id, Object.fromEntries((Object.keys(uiProperties) as UiProperty[])
    .filter(property => uiPropertyApplies(component, property, project, control)).map(property => {
      const geometry = world.get(component.id) ?? inactiveWorld.get(component.id);
      const value = property === 'layer' ? component.layer ?? index : property === 'layoutOrder' ? component.layout?.order ?? 0
        : geometry && isUiLayoutObservation(property) && !['scrollX', 'scrollY'].includes(property) ? uiLayoutObservation(geometry, property)! : uiPropertyDefault(project, component, property, components, control, theme);
      return [property, value];
    }))];
  }));
}

/** Apply values to a private render snapshot, never to authored components. */
export function applyUiPropertySnapshot(component: UiComponent, property: UiProperty, value: VariableValue): void {
  if (!uiProperties[property].writable) return;
  const path = uiProperties[property].path;
  if (path[0] === 'layout') component.layout ??= { version: 1 };
  if (!path.length) return;
  let target = component as unknown as Record<string, unknown>;
  for (const key of path.slice(0, -1)) target = (target[key] ??= {}) as Record<string, unknown>;
  target[path.at(-1)!] = value;
  if (property === 'text') delete component.binding;
}

/** Only undeclared state fields inherit a base override; authored state colors remain independent. */
export function uiPropertyFallbacks(component: UiComponent, property: UiProperty): UiProperty[] {
  const info = uiProperties[property], style = component.style as Record<string, unknown> | undefined;
  if (info.path[0] !== 'style' || style?.[info.path[1]] !== undefined || component.kind === 'progress' && property === 'selectedBackground') return [];
  if (['hoverTextColor', 'selectedTextColor', 'disabledTextColor'].includes(property)) return ['textColor'];
  if (property === 'hoverBackground' || property === 'disabledBackground') return ['background'];
  if (property === 'pressedBackground' || property === 'selectedBackground') return style?.hoverBackground !== undefined ? ['hoverBackground'] : ['hoverBackground', 'background'];
  return [];
}

export function uiPropertySources(component: UiComponent, property: UiProperty): string[] {
  const info = uiProperties[property], sources = [info.writable ? '设计默认值 / 方案继承' : '当前页面实例（只读）'];
  if (isUiControlValueProperty(property)) sources.push('绑定源实时值；临时覆盖 / 修改绑定源由节点明确选择；用户改值解除本控件值覆盖');
  if (isUiControlRangeProperty(property)) sources.push('控件设计范围 / 绑定源范围；缩小只限制本控件显示，扩大或重置会重新显示原来源值');
  if (property === 'text' && component.binding) sources.push('系统文字绑定；只能临时覆盖显示，不修改系统来源');
  if (property === 'visible' && component.visibleWhen || property === 'enabled' && component.enabledWhen || property === 'selected' && component.selectedWhen) sources.push('条件求值');
  if (uiPropertyFallbacks(component, property).length) sources.push('未单独指定的状态颜色继承基础颜色覆盖');
  if (info.animated) sources.push('动画：新赋值/单项重置只替换这一属性的动画');
  if (info.writable) sources.push('页面实例覆盖；单项重置后恢复原来源');
  return sources;
}

export const uiOperations = [
  { id: 'getUiProperty', name: '读取有效属性', target: 'component' },
  { id: 'getUiDefault', name: '读取设计默认值', target: 'component' },
  { id: 'setUiProperty', name: '设置组件属性', target: 'component' },
  { id: 'resetUiProperty', name: '重置单项属性', target: 'component' },
  { id: 'resetUiComponent', name: '重置整控件', target: 'component' },
  { id: 'getUiControlOption', name: '读取选项标签和值', target: 'component', requires: 'choice' },
  { id: 'editUiControlOptions', name: '编辑本实例选项', target: 'component', requires: 'choice' },
  { id: 'focusUiComponent', name: '请求输入焦点', target: 'component', requires: 'textInput' },
  { id: 'setUiControlRange', name: '设置控件范围', target: 'component', requires: 'number' },
  { id: 'resetUiControlRange', name: '重置控件范围', target: 'component', requires: 'number' },
  { id: 'animateUiProperty', name: '播放属性动画', target: 'component' },
  { id: 'playSpine', name: '播放或重播骨骼动画', target: 'component', requires: 'spine' },
  { id: 'pauseSpine', name: '暂停或继续骨骼动画', target: 'component', requires: 'spine' },
  { id: 'setSpineSpeed', name: '设置骨骼播放速度', target: 'component', requires: 'spine' },
  { id: 'playUiVideo', name: '播放或重播视频', target: 'component', requires: 'video' },
  { id: 'pauseUiVideo', name: '暂停或继续视频', target: 'component', requires: 'video' },
  { id: 'stopUiVideo', name: '停止视频', target: 'component', requires: 'video' },
] as const;

export function uiOperationApplies(project: Project, component: UiComponent, operationId: string): boolean {
  const operation = uiOperations.find(item => item.id === operationId);
  if (!operation) return false;
  if (!('requires' in operation)) return true;
  if (operation.requires === 'spine') return component.kind === 'spine';
  if (operation.requires === 'video') return component.kind === 'video';
  const control = uiControlDefinition(project, component);
  return operation.requires === 'number' ? control?.type === 'number' : operation.requires === 'choice' ? !!control?.choice : !!control?.textInput;
}
