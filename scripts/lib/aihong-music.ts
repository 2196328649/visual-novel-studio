import type { Project } from '../../src/core/model';

// Row order transcribed from the two original music-room pages (2026-10-02).
export const aihongMusicTracks = [
  ['妖兵入城', '妖兵入城'], ['烟云消散', '烟云消散'],
  ['烟花风月', '烟花风月'], ['雨井烟垣', '雨井烟垣'],
  ['心悸时刻', '心悸时刻'], ['繁华落尽', '繁华落尽'],
  ['花街柳巷', '花街柳巷'], ['重重墙囚', '重重墙囚'],
  ['青梅竹马', '青梅竹马'], ['一等青楼', '一等青楼'],
  ['與雁同行', '与雁同行'], ['侠心凛然', '侠心凛然'],
  ['死生别离', '死生别离'], ['游船画舫', '游船画舫'],
  ['曳曳夜灯', '哀鸿_曳曳夜灯'], ['吟诗作对', '吟诗作对'],
  ['葬花埋香', '葬花埋香'], ['翩翩偏偏', '翩翩偏偏'],
  ['翩翩如此', '哀鸿_翩翩如此'], ['那年翩翩', '那年翩翩'],
] as const;

export function addAihongMusic(project: Project) {
  const component = project.ui.components.find(c => c.id === 'ai_musicroom_items');
  if (!component) throw new Error('Missing music room');
  const ids = aihongMusicTracks.map(([name, sourceName], index) => {
    const existing = project.assets.find(a => a.kind === 'audio' && !a.id.startsWith('ai_music_room_') && (a.name === name || a.name === sourceName));
    if (existing) return existing.id;
    const id = `ai_music_room_${index + 1}`;
    if (!project.assets.some(a => a.id === id)) project.assets.push({ id, kind: 'audio', name, path: `assets/${id}.ogg`, category: 'bgm' });
    return id;
  });
  // Include the independent bottom page rail inside the editable component bounds.
  component.height = (1000 - component.y * 1080) / 1080;
  const pageSkin = project.ui.components.find(c => c.id === 'ai_gallery_items')?.list?.pageSkin;
  component.list = { ...component.list, columns: 2, rows: 6, assetIds: ids, pageSkin,
    pageTextColor: '#ffffff', pageSelectedTextColor: '#ffffff',
    navigationRect: { x: (453 - component.x * 1920) / (component.width * 1920), y: (938 - component.y * 1080) / (component.height * 1080), width: 168 / (component.width * 1920), height: 56 / (component.height * 1080) } };
  component.style = { ...component.style, fontAssetId: project.assets.find(a => a.name === 'SourceHanSerifCN-Bold')?.id, fontSize: 36 };
}
