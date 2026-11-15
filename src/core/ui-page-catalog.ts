import type { UiComponent } from './model';

export type BuiltinUiPage = Exclude<UiComponent['page'], 'custom'>;
interface PageDefinition {
  name: string;
  group: 'common' | 'optional' | 'legacy';
  hosts: readonly string[];
  menu?: string;
  /** Ren'Py still needs these hosts even when author controls are disabled. */
  keepHost?: boolean;
  openProblem?: string;
}

/** Names, addresses and authoring groups share one registry. Saved IDs stay stable. */
export const builtinUiPages: Record<BuiltinUiPage, PageDefinition> = {
  main: { name: '标题', group: 'common', hosts: ['main_menu'], openProblem: '标题页面由启动流程或“返回标题”系统操作进入。' },
  say: { name: '对话', group: 'common', hosts: ['say'], keepHost: true, openProblem: '对话模板需要当前台词，请使用剧情对话或“开始对白”。' },
  choice: { name: '选项', group: 'common', hosts: ['choice'], keepHost: true, openProblem: '选项模板需要剧情提供的选项数据，请使用剧情选项。' },
  save: { name: '存读档', group: 'common', hosts: ['save', 'load'], menu: 'load' },
  preferences: { name: '设置', group: 'common', hosts: ['preferences'], menu: 'preferences' },
  history: { name: '对话历史', group: 'common', hosts: ['history'], menu: 'history' },
  messageBox: { name: '确认对话框', group: 'common', hosts: ['confirm'], keepHost: true, openProblem: '确认对话框需要确定/取消上下文，请使用“确认提示”。' },
  gallery: { name: '画廊', group: 'common', hosts: ['gallery'], menu: 'gallery' },
  musicRoom: { name: '音乐室', group: 'common', hosts: ['music_room'], menu: 'music_room' },
  voiceCollection: { name: '语音收藏', group: 'common', hosts: ['voice_collection'], menu: 'voice_collection' },
  flowchart: { name: '剧情流程图', group: 'common', hosts: ['flowchart'], menu: 'flowchart' },
  pause: { name: '暂停菜单', group: 'optional', hosts: ['pause_menu'], menu: 'pause_menu' },
  chapterSelect: { name: '章节选择', group: 'optional', hosts: ['chapter_select'], menu: 'chapter_select' },
  voiceSettings: { name: '角色音量', group: 'optional', hosts: ['voice_settings'], menu: 'voice_settings' },
  staff: { name: '制作人员', group: 'optional', hosts: ['staff_roll'], menu: 'staff_roll' },
  keyboard: { name: '虚拟键盘', group: 'optional', hosts: ['input'], keepHost: true, openProblem: '输入模板需要文字输入上下文。' },
  gameOver: { name: '游戏结束', group: 'optional', hosts: ['vn_game_over'], openProblem: '游戏结束模板由剧情结束流程进入。' },
  chapterTitle: { name: '章节标题', group: 'legacy', hosts: ['vn_chapter_title'], keepHost: true, openProblem: '这是旧版章节布局。当前章节演出请在对应时间轴中编辑；这里的修改不会同步到已生成的时间轴。' },
};

export const uiActionPages: Partial<Record<NonNullable<UiComponent['action']>, BuiltinUiPage>> = {
  load: 'save', save: 'save', mainMenu: 'main', preferences: 'preferences', history: 'history',
  gallery: 'gallery', music: 'musicRoom', voiceCollection: 'voiceCollection', flowchart: 'flowchart',
  pause: 'pause', chapterSelect: 'chapterSelect', voiceSettings: 'voiceSettings', staff: 'staff',
};
export const uiScreenPages: Record<string, BuiltinUiPage> = Object.fromEntries(
  Object.entries(builtinUiPages).flatMap(([page, definition]) => definition.hosts.map(host => [host, page as BuiltinUiPage])),
);
export function builtinUiPageId(address: string): string | undefined {
  if (address.startsWith('ui:') && Object.hasOwn(builtinUiPages, address.slice(3))) return address;
  const page = uiScreenPages[address];
  return page ? 'ui:' + page : undefined;
}

type Button = readonly [NonNullable<UiComponent['action']>, string];
export const uiMainButtons: readonly Button[] = [['start', '开始游戏'], ['load', '读取存档'], ['preferences', '设置'], ['gallery', '画廊'], ['music', '音乐'], ['quit', '退出游戏']];
export const uiMenuButtons: readonly Button[] = [['save', '存档'], ['load', '读档'], ['preferences', '设置'], ['history', '历史'], ['gallery', '画廊'], ['music', '音乐'], ['mainMenu', '标题']];
export const uiQuickButtons: readonly Button[] = [['rollback', '回退'], ['history', '历史'], ['skip', '跳过'], ['auto', '自动'], ['save', '存档'], ['load', '读档'], ['preferences', '设置']];
export const uiPauseButtons: readonly Button[] = [['return', '继续游戏'], ['save', '保存进度'], ['preferences', '设置'], ['mainMenu', '返回标题']];
/** The authored pause widget has always offered a separate load shortcut. */
export const uiPauseWidgetButtons: readonly Button[] = [uiPauseButtons[0], uiPauseButtons[1], ['load', '读取存档'], ...uiPauseButtons.slice(2)];
