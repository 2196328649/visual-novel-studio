import type { UiComponent } from './model';
import type { CollectionPart } from './ui-collection-layout';

const partNames: Record<CollectionPart, string> = {
  item: '整个条目', thumbnail: '缩略图', chapter: '存档章节', caption: '对白摘要', number: '槽位编号', slotAction: '读写按钮',
  thumbnailFrame: '缩略图相框', navigationRect: '分页按钮', lockedRect: '未解锁图片', voiceFavoriteRect: '收藏按钮', voiceReplay: '重播按钮',
  historyName: '姓名', historyText: '对白正文', historyScrollbar: '滚动条', autoSlot: '自动存档',
};

/** Internal editing targets. They remain parts of the authored list, not child UI objects. */
export function collectionInspectorParts(component: UiComponent): CollectionPart[] {
  const paged = !!component.list?.rows;
  switch (component.kind) {
    case 'saveSlots': return ['item', 'thumbnail', 'chapter', 'caption', 'number', 'slotAction', 'autoSlot', 'thumbnailFrame', 'navigationRect'];
    case 'galleryGrid': return ['item', 'thumbnail', 'thumbnailFrame', 'lockedRect', 'navigationRect'];
    case 'historyList': return ['item', 'historyName', 'historyText', 'voiceReplay', 'voiceFavoriteRect', 'historyScrollbar'];
    case 'voiceCollection': return ['item', 'caption', 'voiceFavoriteRect', ...(paged ? ['navigationRect'] as const : [])];
    case 'musicTrackList': case 'chapterList': return ['item', ...(paged ? ['navigationRect'] as const : [])];
    case 'choiceList': return ['item', 'caption'];
    default: return [];
  }
}

export function collectionInspectorPartName(component: UiComponent, part: CollectionPart): string {
  if (part === 'caption' && component.kind !== 'saveSlots') return component.kind === 'choiceList' ? '选项文字' : '收藏文字';
  return partNames[part];
}

export function collectionInspectorPartScope(component: UiComponent, part: CollectionPart): string {
  if (part === 'navigationRect') return '整个列表的分页区域；位置相对整个列表。';
  if (part === 'historyScrollbar') return '整个列表的滚动条；位置相对整个列表。';
  if (part === 'autoSlot') return '只影响固定显示的自动存档格；大小沿用列表的条目尺寸。';
  if (part === 'item') return '影响此列表的所有条目；条目尺寸与列表在画面上的尺寸分别设置。';
  if (component.kind === 'historyList') return `影响每条历史记录的${collectionInspectorPartName(component, part)}。`;
  if (component.kind === 'saveSlots') return part === 'caption' && !component.list?.caption
    ? '影响每个存档格的底栏文字；自定义位置相对存档内容区，不含底栏。'
    : '影响每个存档格的此部件；位置相对存档内容区，不含底栏。';
  return '影响此列表的所有条目；位置相对每个条目。';
}

/** Kept separate from the root inspector's fields so part searches never reveal list coordinates. */
export function collectionInspectorPartKeywords(component: UiComponent, part: CollectionPart): { layout: string; appearance: string } {
  const name = collectionInspectorPartName(component, part);
  const coordinates = `${name} ${['横向', '纵向', '宽度', '高度'].map(field => name + field).join(' ')} 百分比`;
  const rect = `自定义${name}位置 ${coordinates} 恢复自动`;
  const text = `${name}字体 ${name}字号 ${name}文字颜色 ${name}对齐 恢复 字体素材 字号 左对齐 居中 右对齐`;
  const skin = (label: string, states = '部件状态 普通 鼠标经过 按住 开启 当前项 不可用') => `${states} ${label} ${label}缩放 ${['左', '上', '右', '下'].map(edge => label + edge + '边距').join(' ')} 图片 素材 拉伸铺满 完整显示 裁切铺满 九宫格缩放 移除此状态图片 清除${label}设置`;
  switch (part) {
    case 'item': return {
      layout: component.kind === 'historyList' ? `${component.list?.historyLayout === 'columns' ? '历史行最小高度' : ''} 历史行上下留白 重播与收藏按钮大小 条目排列 列表设置`
        : `${component.kind === 'choiceList' ? '条目高度' : '条目宽度 条目高度'} 恢复自动 ${component.kind === 'voiceCollection' && !component.list?.voiceFavoriteRect ? '收藏按钮默认大小' : ''} 列表设置`,
      appearance: `${name} 条目默认外观 ${component.kind === 'saveSlots' ? '空槽图片 悬停装饰图' : component.kind === 'galleryGrid' ? '悬停装饰图' : component.kind === 'historyList' ? '历史文字加粗 历史文字字距' : ''} 返回列表设置`,
    };
    case 'navigationRect': return {
      layout: `${rect} 整个列表 ${component.kind === 'saveSlots' ? '分页位置 顶部 底部' : component.kind === 'galleryGrid' ? '页码按钮宽度 页码按钮高度 页码按钮间距 最多同时显示页码' : ''}`,
      appearance: `${skin('分页按钮图片')} ${component.kind === 'saveSlots' ? text : component.kind === 'galleryGrid' ? '页码字体 页码字号 页码粗体 分页文字颜色' : '分页文字颜色'} 当前页文字颜色`,
    };
    case 'historyScrollbar': return { layout: `${coordinates} 整个列表 历史滚动条样式 系统滚动条 自定义滚动条 滚动条轨道宽度`, appearance: `${skin('历史滑块图片', '部件状态 普通 鼠标经过 按住 不可用')} 历史滚动条轨道` };
    case 'historyName': return { layout: component.list?.historyLayout === 'columns' ? '姓名列宽度 分列 宽度' : '自动排布 姓名在对白上方 姓名与对白分列 返回列表设置', appearance: text };
    case 'historyText': return { layout: '自动排布 姓名列宽度 条目上下留白 返回列表设置', appearance: text };
    case 'voiceReplay': return { layout: '共享尺寸 重播与收藏按钮大小 编辑整个条目', appearance: `${skin('重播按钮图片')} 图片已含文字` };
    case 'voiceFavoriteRect': return { layout: component.kind === 'historyList' ? '共享尺寸 重播与收藏按钮大小 编辑整个条目' : rect, appearance: `${skin('收藏按钮图片')} 图片已含文字` };
    case 'thumbnailFrame': return { layout: '相框横向 相框纵向 相框宽度 相框高度 相框位置 百分比', appearance: '缩略图相框 图片 素材 移除相框' };
    case 'thumbnail': return { layout: rect, appearance: component.kind === 'galleryGrid' ? '缩略图缩放 缩略图亮度 部件状态 普通 鼠标经过 按住 开启 不可用 恢复此状态亮度' : '保存时的画面截屏 空槽图片 内容来源' };
    case 'lockedRect': return { layout: `${rect} 未解锁底图`, appearance: '未解锁图片 素材' };
    case 'autoSlot': return { layout: '条目宽度 条目高度 列表排列 固定自动存档 编辑整个条目', appearance: skin('自动档底图', '部件状态 普通 鼠标经过 按住 不可用') };
    case 'slotAction': return { layout: rect, appearance: `${skin('读取按钮底图')} ${component.saveMode === 'load' ? '读取存档' : `${skin('保存按钮底图')} 编辑读写按钮 读取存档 保存存档`} 图片已含文字` };
    case 'number': return { layout: rect, appearance: `${text} ${skin('编号底图', '普通')}` };
    case 'chapter': return { layout: rect, appearance: text };
    case 'caption': return { layout: rect, appearance: component.kind === 'saveSlots' ? text : '沿用条目默认外观 字体 字号 颜色 对齐 返回列表设置' };
  }
}
