import type { UiComponent, UiTheme } from './model';
import { playerPreferenceKeys, playerPreferences } from './preferences';

export const uiPageNames: Record<UiComponent['page'], string> = {
  main: '标题', say: '对话', choice: '选项', save: '存读档', preferences: '设置', voiceSettings: '角色音量', pause: '暂停菜单', history: '对话历史',
  gallery: '画廊', musicRoom: '音乐室', voiceCollection: '语音收藏', chapterSelect: '章节选择', chapterTitle: '章节标题',
  messageBox: '消息框', staff: '制作人员', keyboard: '虚拟键盘', custom: '自定义页面', flowchart: '剧情流程图', gameOver: '游戏结束',
};
export function availableUiPages(theme: UiTheme) {
  return Object.entries(uiPageNames).filter(([page]) => !theme.disabledPages?.includes(page as UiComponent['page']));
}
export const componentNames: Record<UiComponent['kind'], string> = {
  text: '文字', button: '按钮', image: '图片', video: '循环视频', spine: '骨骼动画', panel: '面板', progress: '进度条', choiceList: '选项列表', saveSlots: '存档槽', preference: '设置滑条', preferenceChoice: '设置下拉菜单', pauseMenu: '暂停菜单',
  historyList: '历史列表', galleryGrid: '画廊网格', musicTrackList: '音乐列表', voiceCollection: '语音收藏列表', chapterList: '章节列表',
  chapterTitle: '章节标题', messageBox: '消息框', staffRoll: '制作人员名单', keyboard: '虚拟键盘', flowchart: '剧情流程图', gameOver: '游戏结束',
};
export const preferenceNames = Object.fromEntries(playerPreferenceKeys.map(key => [key, playerPreferences[key].name])) as Record<NonNullable<UiComponent['preference']>, string>;
export const bindingNames: Record<NonNullable<UiComponent['binding']>, string> = { title: '作品名称', speaker: '当前说话人', dialogue: '当前对白', tooltip: '按钮悬停提示', confirmation: '确认提示', minigameTitle: '小游戏标题', minigamePrompt: '小游戏提示', minigameStatus: '小游戏状态' };
export function componentName(component: UiComponent) { return component.name || (component.binding ? bindingNames[component.binding] : component.kind === 'preference' && component.preference ? component.text || preferenceNames[component.preference] : component.text || componentNames[component.kind]); }

export function actionName(action: NonNullable<UiComponent['action']>) { return { start: '开始游戏', load: '读取存档', preferences: '设置', gallery: '画廊', music: '音乐', quit: '退出游戏', save: '保存', history: '历史记录', auto: '自动播放', skip: '跳过', return: '返回', mainMenu: '返回标题', rollback: '回退', window: '窗口', fullscreen: '全屏', mute: '全部静音', skipSeen: '已读文本', skipAll: '全部文本', transitions: '跳过转场', pause: '暂停菜单', chapterSelect: '章节选择', voiceCollection: '语音收藏', flowchart: '剧情流程图', staff: '制作人员', blueprint: '执行蓝图', hideInterface: '隐藏界面', musicPrevious: '播放上一首', musicNext: '播放下一首', musicPlayPause: '音乐播放/暂停', musicStop: '停止播放', musicLoop: '循环播放', musicShuffle: '随机播放', setPlayerPreference: '设置玩家选项', resetPreferences: '恢复初始设置', voiceSettings: '角色音量', confirmYes: '确定', confirmNo: '取消', minigameSuccess: '结束小游戏：成功', minigameFailure: '结束小游戏：失败', minigameCancel: '结束小游戏：取消' }[action]; }
