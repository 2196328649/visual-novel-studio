import type { BlueprintDataType } from '../core/blueprint';

/** Author-facing labels only: stored pin types and the runtime contract stay unchanged. */
export const blueprintMemberTypes: Record<BlueprintDataType, {
  name: string;
  group: '基础值' | '对象引用' | '高级';
  description: string;
  example: string;
}> = {
  boolean: { name: '开关', group: '基础值', description: '只有“是”和“否”两种状态，用于条件判断。', example: '例如：是否看过开场、是否显示提示。' },
  number: { name: '数值', group: '基础值', description: '可以计算和比较的数值，也可填写小数。', example: '例如：好感度、音量、等待秒数。' },
  string: { name: '文字', group: '基础值', description: '一段文字，用于显示内容或比较文字是否相同。', example: '例如：玩家姓名、提示内容。' },
  asset: { name: '素材引用', group: '对象引用', description: '选择工程中的素材，使用时需符合目标所需的素材种类。', example: '读取输入 → 切换背景 · 背景素材。' },
  scene: { name: '场景引用', group: '对象引用', description: '选择剧情目录中的场景／小章节，用于决定跳到哪段剧情。', example: '读取输入 → 切换场景 · 目标场景。' },
  character: { name: '角色引用', group: '对象引用', description: '选择工程中定义的角色，用于指定显示哪个角色。', example: '读取输入 → 显示角色 · 角色。' },
  ui: { name: '页面引用', group: '对象引用', description: '选择界面列表中的页面，用于打开指定页面。', example: '读取输入 → 打开页面 · 页面。' },
  component: { name: '控件引用', group: '对象引用', description: '选择页面中的控件，用于读取或调整它的文字、位置等属性。', example: '读取输入 → 设置组件属性 · 界面组件。' },
  any: { name: '任意值', group: '高级', description: '暂不限定值的类型，具体用法由连接到的节点决定。', example: '需要多种类型共用同一接口时使用。' },
  exec: { name: '执行', group: '高级', description: '连接动作的执行顺序，不保存数据。', example: '例如：先显示角色，再播放音效。' },
};
