import titleEmissionMesh from './aihong-title-mesh.json';
import titleTwoEmissionMesh from './aihong-title-two-mesh.json';
import type { EmissionMesh } from '../../src/core/emission-mesh';
import type { Project } from '../../src/core/model';
import { chapterSource } from '../../src/core/chapter';

export const aihongPresentationAssets = [
  { id: 'ai_presentation_music_main', name: '哀鸿 · 标题音乐 Main', kind: 'audio' as const, source: 'Resources/starveling/sound/BGM/Main.ogg' },
  { id: 'ai_presentation_chapter_one', name: '章节进场 · 夜宴庭院', kind: 'image' as const, source: 'Resources/title/chapterbg/BG_Ji_1.png' },
  { id: 'ai_presentation_chapter_two', name: '章节进场 · 方院', kind: 'image' as const, source: 'Resources/title/chapterbg/BG_Ji_2.png' },
  { id: 'ai_presentation_brush', name: '章节进场 · 记之笔触', kind: 'image' as const, source: 'Resources/title/titlebg/chapter_bg_J.png' },
  { id: 'ai_presentation_mask', name: '章节进场 · 竖向笔刷蒙板', kind: 'image' as const, source: 'Texture2D/chapter_img_mask2.png' },
  { id: 'ai_presentation_fade', name: '章节进场 · 柔边渐变 FadeCircle', kind: 'image' as const, source: 'Texture2D/FadeCircle.png' },
  { id: 'ai_presentation_title_one', name: '章节题字 · 记第一回 醉梦', kind: 'image' as const, source: 'Resources/title/textsprite/sc/chapter_title_J1.png' },
  { id: 'ai_presentation_title_two', name: '章节题字 · 记第二回 遇雁', kind: 'image' as const, source: 'Resources/title/textsprite/sc/chapter_title_J2.png' },
];

/** Add presentation defaults to the known template while retaining authored overrides. */
export function addAihongPresentation(project: Project) {
  for (const asset of aihongPresentationAssets) if (!project.assets.some(a => a.id === asset.id)) project.assets.push({ id: asset.id, name: asset.name, kind: asset.kind, path: `assets/${asset.id}.${asset.source.split('.').at(-1)}` });
  project.ui.menuMusicId ??= 'ai_presentation_music_main';
  project.ui.menuMusicFade ??= 0.3;
  const titleMeshAsset = project.assets.find(asset => asset.id === 'ai_presentation_title_one');
  if (titleMeshAsset) titleMeshAsset.emissionMesh ??= structuredClone(titleEmissionMesh) as EmissionMesh;
  const secondTitleMeshAsset = project.assets.find(asset => asset.id === 'ai_presentation_title_two');
  if (secondTitleMeshAsset) secondTitleMeshAsset.emissionMesh ??= structuredClone(titleTwoEmissionMesh) as EmissionMesh;
  project.ui.chapterTransition ??= { effect: 'ink', overlayId: 'ai_presentation_brush', particles: true };
  project.ui.chapterTransition.maskId ??= 'ai_presentation_mask';
  // Both imported chapter commands use anchoredPosition.x = 265 on a 1920-wide canvas.
  project.ui.chapterTransition.backgroundOffsetX ??= 265 / 1920;
  // First chapter uses Liang: source RGB .5, converted by TitleParticle in the Gamma project.
  project.ui.chapterTransition.particleColor ??= '#bcbcbc';
  project.ui.chapterTransition.ripple ??= true;
  project.ui.chapterTransition.rippleStrength ??= chapterSource.shaders.ripple.strength;
  project.ui.chapterTransition.rippleSpeed ??= chapterSource.shaders.ripple.speed;
  for (const [id, background, music] of [['ai_title_one', 'ai_presentation_chapter_one', 'ai_story_music_wine'], ['ai_title_two', 'ai_presentation_chapter_two', 'ai_story_music_rain']]) {
    const node = project.nodes.find(n => n.id === id);
    if (node?.kind !== 'chapterTitle') continue;
    node.backgroundId ??= background;
    if (project.assets.some(a => a.id === music)) node.soundId ??= music;
    if (node.duration === 2.2 || node.duration === 4.2) node.duration = chapterSource.timing.duration;
    const titleAsset = id === 'ai_title_one' ? 'ai_presentation_title_one' : 'ai_presentation_title_two';
    if (node.title === '第一章 · 酒醒城破' || node.title === '第二章 · 方院抉择') node.titleImageId ??= titleAsset;
  }
  const grain = project.ui.components.find(c => c.id === 'ai_chapter_title_background');
  // This original texture already carries only 20/255 alpha. Do not dim it twice.
  if (grain && (grain.style?.opacity === undefined || grain.style.opacity === 0.12)) grain.style = { ...grain.style, opacity: 1 };
  const title = project.ui.components.find(c => c.id === 'ai_chapter_title_text');
  if (title && (title.x === 0.2 && title.y === 0.33 && title.width === 0.6 && title.height === 0.25 || title.x === 0.13 && title.y === 0.425 && title.width === 0.74 && title.height === 0.2)) Object.assign(title, { x: 0.14, y: 0.445, width: 0.36, height: 0.12, style: { ...title.style, fontSize: 54, textColor: '#101018', outlineWidth: 0, align: 'center' } });
}
