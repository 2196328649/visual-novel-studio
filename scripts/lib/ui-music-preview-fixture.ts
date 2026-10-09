import { createUiEventGraph } from '../../src/core/ui-logic';
import { createUiConfirmPreviewFixture } from './ui-confirm-preview-fixture';
import type { UiComponent } from '../../src/core/model';
export { writeUiVoicePreviewAudio as writeUiMusicPreviewAudio } from './ui-voice-preview-fixture';

export function createUiMusicPreviewFixture(native = false) {
 const { project, graph } = createUiConfirmPreviewFixture(); project.name = native ? '标准音乐预演验收' : '音乐列表预演验收';
 project.blueprints = [graph]; project.ui.customPages = []; createUiEventGraph(project,'ui:main','标题');
 project.width = 1280; project.height = 720; project.playerDefaults = { masterVolume: .8, musicVolume: .5 };
 project.assets = Array.from({ length: 13 }, (_, i) => ({ id: 'track_' + i, kind: 'audio' as const, category: 'bgm' as const, name: i === 12 ? '[name] {b} 测试音乐 13' : '测试音乐 ' + (i + 1), path: 'assets/voice_' + i + '.wav' }));
 // Standard playlists discover music used in the story; custom lists preserve their own order.
 project.nodes.find(n => n.kind === 'passage')!.lines[0].actions = project.assets.map(a => ({ kind: 'music' as const, assetId: a.id, loop: true, fade: 0 }));
 project.ui.components = project.ui.components.filter(c => c.page === 'messageBox');
 project.ui.components.push({ id: 'open_music', kind: 'button', page: 'main', text: '打开音乐鉴赏', action: 'music', x: .15, y: .2, width: .7, height: .2 });
 if (!native) {
  project.ui.pages!.musicRoom = { layout: 'custom', background: '#162b30' };
  project.ui.components.push({ id: 'music_list', kind: 'musicTrackList', page: 'musicRoom', text: '', x: .06, y: .05, width: .88, height: .56, style: { fontSize: 28, textColor: '#ffffff' }, list: { columns: 2, rows: 2, itemHeight: 120, gapX: 24, gapY: 12, navigationRect: { x: .34, y: .82, width: .4, height: .12 }, assetIds: project.assets.map(a => a.id).reverse() } });
  const actions: [NonNullable<UiComponent['action']>, string][] = [['musicPrevious','上一首'],['musicPlayPause','播放 / 暂停'],['musicNext','下一首'],['musicStop','停止'],['musicLoop','循环'],['musicShuffle','随机']];
  actions.forEach(([action, text], i) => project.ui.components.push({ id: action.toLowerCase(), kind: 'button', page: 'musicRoom', action, text, x: .04 + i * .16, y: .65, width: .15, height: .08, style: { fontSize: 24 } }));
  project.ui.components.push({ id: 'music_back', kind: 'button', page: 'musicRoom', action: 'return', text: '返回标题', x: .7, y: .88, width: .26, height: .08 },
   { id: 'music_confirm', kind: 'button', page: 'musicRoom', action: 'blueprint', blueprintId: graph.id, text: '试听中确认', x: .04, y: .88, width: .25, height: .08 },
   { id: 'music_gain', kind: 'button', page: 'musicRoom', action: 'setPlayerPreference', preference: 'musicVolume', preferenceValue: .25, text: '音乐音量 25%', x: .35, y: .8, width: .28, height: .15 },
   { id: 'mute', kind: 'button', page: 'musicRoom', action: 'mute', text: '静音', x: .04, y: .77, width: .25, height: .08 });
 } else project.ui.pages!.musicRoom = { layout: 'native' };
 return project;
}
