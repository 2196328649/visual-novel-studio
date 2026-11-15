import type { UiComponent } from '../core/model';

/** Shared by authored controls, default menus and collection widgets. */
export const componentActions: Partial<Record<NonNullable<UiComponent['action']>, string>> = {
  start: 'Start()', load: 'VnUiMenu("load")', preferences: 'VnUiMenu("preferences")',
  gallery: 'VnUiMenu("gallery")', music: 'VnUiMenu("music_room")', quit: 'Quit(confirm=True)',
  save: 'VnUiMenu("save")', history: 'VnUiMenu("history")',
  auto: 'Preference("auto-forward", "toggle")', skip: 'VnSkip()',
  return: 'VnUiNavigate(Jump("vn_bp_menu_return") if vn_bp_menu_active else VnUiMenu("main_menu") if main_menu else Return())', mainMenu: 'MainMenu()', rollback: 'Rollback()',
  window: 'Preference("display", "window")', fullscreen: 'Preference("display", "fullscreen")',
  mute: 'Preference("all mute", "toggle")', skipSeen: 'Preference("skip", "seen")',
  skipAll: 'Preference("skip", "all")', transitions: 'Preference("transitions", "toggle")',
  pause: 'VnUiMenu("pause_menu")', chapterSelect: 'VnUiMenu("chapter_select")', voiceCollection: 'VnUiMenu("voice_collection")',
  flowchart: 'VnUiMenu("flowchart")', staff: 'VnUiMenu("staff_roll")',
  hideInterface: 'HideInterface()', musicPrevious: 'vn_music_room.Previous()', musicNext: 'vn_music_room.Next()',
  musicPlayPause: 'vn_music_room.TogglePause()', musicStop: 'vn_music_room.Stop()', musicLoop: 'vn_music_room.ToggleLoop()', musicShuffle: 'vn_music_room.ToggleShuffle()',
  voiceSettings: 'VnUiMenu("voice_settings")', resetPreferences: 'Confirm("恢复全部初始设置吗？", Function(vn_reset_preferences))',
  confirmYes: 'yes_action', confirmNo: 'no_action',
};
