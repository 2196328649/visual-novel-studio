import { projectGraphs } from './project-resources';
import { actionSchema, effectiveUiTheme, orderedUiComponents, type Project, type StageAction, type VisualObject } from './model';
import { chapterPresentation, chapterSource, chapterTitleRect, type ChapterContent } from './chapter';
import { uiComponentFontSize } from './ui';
import { createVisualObject } from './visual-object';

export type ChapterTextLayout = Record<string, { title: { x: number; y: number; width: number; height: number }; subtitle?: { x: number; y: number; width: number; height: number } }>;

/** Repair only the old generated fade; preserve object paths, bindings and authored animation. */
export function normalizeChapterCompositions(project: Project): boolean {
  let changed = false;
  const keysEqual = (a: VisualObject['curves'], b: VisualObject['curves']) => {
    const left = a?.opacity, right = b?.opacity;
    return left?.length === right?.length && !!left && !!right && left.every((key, index) => {
      const other = right[index];
      return Math.abs(key.at - other.at) < 1e-9 && key.value === other.value && key.easing === other.easing;
    });
  };
  const defaultPose = (object: VisualObject) => object.keyframes.length === 1 && object.keyframes[0].opacity === 1 && !object.startAt;
  const visit = (action: StageAction): boolean => {
    if (action.kind !== 'visual') return false;
    let repaired = false;
    const [black, presence] = action.children ?? [];
    const duration = action.duration || action.retimeBasisDuration;
    const generated = action.content === 'group' && action.name === '标题演出组合' && action.children?.length === 2
      && black?.content === 'solid' && black.name === '黑色底层' && presence?.content === 'group' && presence.name === '整体淡入淡出';
    if (generated && action.chapterPresentation === undefined) { action.chapterPresentation = true; repaired = true; }
    if (generated && duration && black.color === '#000000' && !black.curves && black.duration === duration
      && presence.duration === duration && !action.curves?.opacity && defaultPose(action) && defaultPose(black) && defaultPose(presence)) {
      const key = (at: number, value: number, easing: 'linear' | 'outquad' = 'linear') => ({ at, value, easing });
      const t = chapterSource.timing, ratio = duration / t.duration;
      const ink = { opacity: [key(0, 0), key(t.fadeIn * ratio, 1, 'outquad'), key((t.fadeIn + t.holdBackground) * ratio, 1), key(duration, 1 - t.fadeTarget, 'outquad')] };
      const fade = { opacity: [key(0, 0), key(duration * .22, 1), key(duration * .83, 1), key(duration, 0)] };
      if (keysEqual(presence.curves, ink) || keysEqual(presence.curves, fade)) {
        action.curves = { ...action.curves, opacity: presence.curves!.opacity };
        delete presence.curves!.opacity;
        if (!Object.keys(presence.curves!).length) delete presence.curves;
        repaired = true;
      }
    }
    for (const child of action.children ?? []) repaired = visit(child) || repaired;
    changed ||= repaired;
    return repaired;
  };
  project.nodes.forEach(node => { if (node.kind === 'passage') node.lines.forEach(line => line.actions.forEach(visit)); });
  project.scenes.forEach(scene => scene.entryActions?.forEach(visit));
  project.effects.forEach(effect => effect.actions?.forEach(visit));
  project.characters.forEach(character => character.features?.forEach(feature => feature.actions?.forEach(visit)));
  for (const graph of projectGraphs(project)) for (const node of graph.nodes) {
    if (node.type !== 'savedAction' || typeof node.properties.action !== 'string') continue;
    try {
      const result = actionSchema.safeParse(JSON.parse(node.properties.action));
      if (result.success && visit(result.data)) node.properties.action = JSON.stringify(result.data);
    } catch { /* Invalid saved actions are reported by project validation. */ }
  }
  return changed;
}

/** Creates independent editable data; does not mutate the source chapter or theme. */
export function chapterComposition(project: Project, chapter: ChapterContent & { wait?: boolean }, textLayout: ChapterTextLayout = {}, options: { includeEmptySubtitle?: boolean; titleMode?: 'text' | 'image'; fourPartText?: boolean } = {}) {
  const p = chapterPresentation(project, chapter), theme = effectiveUiTheme(project.ui), duration = p.duration;
  const imageTitle = options.titleMode ? options.titleMode === 'image' : !!p.titleImageId;
  const warnings: string[] = [];
  let backgroundInstanceId: string | undefined;
  const imageLayerBindings: { instanceId: string; property: 'assetId' | 'maskAssetId'; key: string; name: string }[] = [];
  const decoration = (object: VisualObject) => imageLayerBindings.push({ instanceId: object.instanceId, property: 'assetId', key: 'decoration_' + imageLayerBindings.length, name: object.name });
  const titleImageBindings: { instanceId: string; property: 'assetId' | 'glyphAssetId' }[] = [];
  const titleTextBindings: { instanceId: string; input: 'title' | 'subtitle' | 'firstLine' | 'secondLine' | 'rightText'; styleId: string }[] = [];
  const make = (content: VisualObject['content'], name: string, layer: number, assetId?: string) => ({ ...createVisualObject(content, assetId), name, duration, layer });
  const root = make('group', '标题演出组合', 1000), presence = make('group', '整体淡入淡出', 1), black = make('solid', '黑色底层', 0);
  black.color = '#000000'; root.wait = chapter.wait !== false; root.children = [black, presence]; presence.children = [];
  root.chapterPresentation = true;
  root.retimeOnDuration = true;
  const key = (at: number, value: number, easing: 'linear' | 'outquad' = 'linear') => ({ at, value, easing });
  // Fade the complete composition, including its black base, over the scene.
  if (p.effect === 'ink') {
    const t = chapterSource.timing, ratio = duration / t.duration;
    root.curves = { opacity: [key(0, 0), key(t.fadeIn * ratio, 1, 'outquad'), key((t.fadeIn + t.holdBackground) * ratio, 1), key(duration, 1 - t.fadeTarget, 'outquad')] };
  } else if (p.effect === 'fade') root.curves = { opacity: [key(0, 0), key(duration * .22, 1), key(duration * .83, 1), key(duration, 0)] };
  if (p.backgroundId || options.titleMode) {
    const background = make('image', '章节背景', 0, p.backgroundId); backgroundInstanceId = background.instanceId; background.imageFit = 'cover';
    background.keyframes[0] = { ...background.keyframes[0], x: .5 + p.backgroundOffsetX, y: .5 + p.backgroundOffsetY };
    if (p.effect === 'ink' && p.ripple) background.ripple = { strength: p.rippleStrength, speed: p.rippleSpeed * chapterSource.timing.duration / duration };
    presence.children.push(background);
  }
  if (p.effect === 'ink' && p.overlayId) {
    const overlay = make('image', '笔触遮罩层', 1, p.overlayId); overlay.imageFit = 'cover'; overlay.maskAssetId = p.maskId; presence.children.push(overlay);
    imageLayerBindings.push({ instanceId: overlay.instanceId, property: 'assetId', key: 'overlayId', name: '笔触叠图' }, { instanceId: overlay.instanceId, property: 'maskAssetId', key: 'maskId', name: '笔触遮罩' });
  }
  const titleObjects: VisualObject[] = [];
  const place = (object: VisualObject, rect: { x: number; y: number; width: number; height: number }) => {
    object.width = Math.max(1, Math.round(rect.width * project.width)) / project.width;
    object.height = Math.max(1, Math.round(rect.height * project.height)) / project.height;
    // Keep the text's top and wrapping width when its measured height exceeds
    // the editable surface limit. The original UI clip still owns visibility.
    if (object.content === 'text' && object.height > 4) { object.height = 4; object.textVerticalAlign = 'top'; }
    object.keyframes[0] = { ...object.keyframes[0], x: Math.round(rect.x * project.width) / project.width + object.width / 2, y: Math.round(rect.y * project.height) / project.height + object.height / 2 };
    return object;
  };
  const clipText = (object: VisualObject, area: { x: number; y: number; width: number; height: number }) => {
    const x = object.keyframes[0].x - object.width / 2, y = object.keyframes[0].y - object.height / 2;
    object.textClip = { x: (area.x - x) / object.width, y: (area.y - y) / object.height, width: area.width / object.width, height: area.height / object.height };
  };
  const makeTitle = (rect: ReturnType<typeof chapterTitleRect>, fontSize: number, color: string, fontAssetId?: string) => {
    const title = place(make(imageTitle ? 'image' : 'text', '章节标题', 10, imageTitle ? p.titleImageId : undefined), rect);
    title.imageFit = 'contain'; title.imageAlign = theme.pages?.chapterTitle?.layout === 'custom' ? 'top' : 'center'; title.text = chapter.title; title.fontSize = fontSize; title.color = color; title.fontAssetId = fontAssetId; title.textAlign = 'center'; title.textVerticalAlign ??= 'center';
    if (title.content === 'text') titleTextBindings.push({ instanceId: title.instanceId, input: 'title', styleId: title.instanceId });
    titleObjects.push(title); presence.children!.push(title); return title;
  };
  if (!imageTitle && options.fourPartText) {
    // Independent editable rectangles follow the four regions of the original 682×111 title art.
    const area = chapterTitleRect(project), factor = Math.min(area.width * project.width / 682, area.height * project.height / 111);
    const left = area.x + (area.width * project.width - 682 * factor) / project.width / 2;
    const serif = project.assets.find(a => a.kind === 'font' && /SourceHanSerif.*Regular/.test(a.name))?.id ?? theme.fontAssetId;
    const bold = project.assets.find(a => a.kind === 'font' && /SourceHanSerif.*(?:SemiBold|Bold)/.test(a.name))?.id ?? serif;
    const calligraphy = project.assets.find(a => a.kind === 'font' && /喜鹊燕书|书法|楷体/.test(a.name))?.id ?? serif;
    const regions = [
      { input: 'firstLine' as const, name: '第一行小字', text: '- 记或忆 -', x: 0, y: 8, width: 158, height: 36, size: 26, font: serif },
      { input: 'secondLine' as const, name: '第二行小字', text: '- 第一回 -', x: 0, y: 57, width: 158, height: 38, size: 26, font: bold },
      { input: 'title' as const, name: '章节标题', text: chapter.title, x: 170, y: -13, width: 242, height: 138, size: 114, font: calligraphy },
      { input: 'rightText' as const, name: '右侧字', text: chapter.subtitle || '1645 弘光元年', x: 433, y: 29, width: 254, height: 56, size: 29, font: bold },
    ];
    for (const region of regions) {
      const object = place(make('text', region.name, 10), { x: left + region.x * factor / project.width, y: area.y + region.y * factor / project.height, width: region.width * factor / project.width, height: region.height * factor / project.height });
      object.text = region.text; object.fontSize = Math.max(12, Math.min(300, Math.round(region.size * factor))); object.fontAssetId = region.font;
      if (region.input === 'rightText') object.textItalic = true;
      object.color = theme.components.find(c => c.page === 'chapterTitle' && c.kind === 'chapterTitle')?.style?.textColor ?? theme.accent;
      object.textAlign = 'center'; object.textVerticalAlign = 'center';
      titleObjects.push(object); presence.children.push(object);
      titleTextBindings.push({ instanceId: object.instanceId, input: region.input, styleId: object.instanceId });
    }
    for (const c of orderedUiComponents(project.ui).filter(c => c.page === 'chapterTitle' && c.kind === 'image' && c.assetId)) {
      const object = place(make('image', c.text || '装饰图片', 2, c.assetId), c); object.imageFit = c.style?.imageFit === 'nineSlice' ? 'stretch' : c.style?.imageFit ?? 'contain'; object.keyframes[0].opacity = c.style?.opacity ?? 1; presence.children.push(object);
      decoration(object);
    }
  } else if (theme.pages?.chapterTitle?.layout === 'custom') {
    for (const [index, c] of orderedUiComponents(project.ui).filter(c => c.page === 'chapterTitle').entries()) {
      let object: VisualObject;
      if (c.kind === 'chapterTitle') { object = makeTitle(imageTitle ? c : textLayout[c.id]?.title ?? c, uiComponentFontSize(c, theme, project.width, project.height), c.style?.textColor ?? theme.textColor, c.style?.fontAssetId ?? theme.fontAssetId); object.textAlign = c.style?.align ?? 'center'; if (object.content === 'text' && c.style) object.textEffects = { outlineWidth: c.style.outlineWidth, outlineColor: c.style.outlineColor, outlineOpacity: c.style.outlineOpacity, shadowX: c.style.shadowX, shadowY: c.style.shadowY, shadowColor: c.style.shadowColor, shadowOpacity: c.style.shadowOpacity }; }
      else if (c.kind === 'image' && c.assetId) { object = place(make('image', c.text || '装饰图片', index + 2, c.assetId), c); object.imageFit = c.style?.imageFit === 'nineSlice' ? 'stretch' : c.style?.imageFit ?? 'contain'; if (c.style?.imageFit === 'nineSlice') warnings.push(`“${c.text}”的九宫格图片暂按拉伸转换，需要检查。`); presence.children.push(object); decoration(object); }
      else { warnings.push(`自定义章节组件“${c.text || c.kind}”尚需手工转换。`); continue; }
      if (object.content === 'text') clipText(object, c);
      object.layer = index * 2 + 2; object.keyframes[0].opacity = c.style?.opacity ?? 1;
      if (c.kind === 'chapterTitle' && !imageTitle && (chapter.subtitle || options.includeEmptySubtitle)) {
        const size = Math.min(object.fontSize, 32), measured = textLayout[c.id]?.subtitle;
        const fallback = { x: c.x, y: c.y + (object.fontSize * 1.2 + 12) / project.height, width: c.width, height: size * 1.2 / project.height };
        const subtitle = place(make('text', '章节副标题', object.layer + 1), measured ?? fallback);
        subtitle.text = chapter.subtitle; subtitle.fontSize = size; subtitle.color = object.color; subtitle.fontAssetId = object.fontAssetId;
        subtitle.textAlign = object.textAlign; subtitle.textVerticalAlign ??= 'center'; subtitle.textEffects = object.textEffects ? structuredClone(object.textEffects) : undefined; subtitle.keyframes[0].opacity = c.style?.opacity ?? 1;
        clipText(subtitle, c);
        titleObjects.push(subtitle); presence.children.push(subtitle); titleTextBindings.push({ instanceId: subtitle.instanceId, input: 'subtitle', styleId: subtitle.instanceId });
        if (!measured) warnings.push('自定义副标题尚未按字体测量，需检查换行和位置。');
      }

    }
  } else {
    makeTitle(chapterTitleRect(project), Math.min(56, Math.max(28, theme.fontSize + 12)), theme.accent, theme.fontAssetId);
    if ((chapter.subtitle || options.includeEmptySubtitle) && !imageTitle) { const subtitle = place(make('text', '章节副标题', 11), { x: .1, y: .58, width: .8, height: .08 }); subtitle.text = chapter.subtitle; subtitle.fontSize = 24; subtitle.color = theme.accent; subtitle.fontAssetId = theme.fontAssetId; subtitle.textAlign = 'center'; subtitle.textVerticalAlign = 'center'; titleObjects.push(subtitle); presence.children.push(subtitle); titleTextBindings.push({ instanceId: subtitle.instanceId, input: 'subtitle', styleId: subtitle.instanceId }); }
    warnings.push('默认章节文字布局已转为独立矩形，需要检查文字排版。');
  }
  for (const title of titleObjects) {
    if (p.effect === 'ink') {
      const t = chapterSource.timing, ratio = duration / t.duration, x = title.keyframes[0].x;
      title.curves = { x: [key(0, x - .5), key(t.move * ratio, x, 'outquad')], dissolveStrength: [key(0, 1), key((t.move + t.holdTitle) * ratio, 1), key((t.move + t.holdTitle + t.disappear) * ratio, -1, 'outquad')] };
    } else if (p.effect === 'fade') title.curves = { opacity: [key(0, 0), key(duration * .12, 0), key(duration * .2, 1), key(duration * .73, 1), key(duration * .95, 0)] };
  }
  if (p.effect === 'ink' && p.particles) {
    if (imageTitle) {
      const particles = make('particles', '标题字形粒子', 100); particles.color = p.particleColor; particles.width = particles.height = 1;
      particles.glyphParticles = { assetId: p.titleImageId, count: 200, emissionStart: (chapterSource.timing.move + chapterSource.timing.holdTitle) * duration / chapterSource.timing.duration, timeScale: chapterSource.timing.duration / duration, sizeScale: 1, motionScale: 1, rect: chapterTitleRect(project) };
      titleImageBindings.push({ instanceId: particles.instanceId, property: 'glyphAssetId' });
      presence.children.push(particles);
    } else for (const title of titleObjects) {
      const particles = make('particles', title.name + '字形粒子', 100); particles.color = p.particleColor; particles.width = particles.height = 1;
      particles.textClip = title.textClip ? structuredClone(title.textClip) : undefined; particles.textEffects = title.textEffects ? structuredClone(title.textEffects) : undefined; particles.text = title.text; particles.fontSize = title.fontSize; particles.fontAssetId = title.fontAssetId; particles.textAlign = title.textAlign; particles.textVerticalAlign = title.textVerticalAlign; particles.textItalic = title.textItalic;
      particles.keyframes[0].opacity = title.keyframes[0].opacity;
      particles.glyphParticles = { source: 'text', count: 200, emissionStart: (chapterSource.timing.move + chapterSource.timing.holdTitle) * duration / chapterSource.timing.duration, timeScale: chapterSource.timing.duration / duration, sizeScale: 1, motionScale: 1,
        rect: { x: title.keyframes[0].x - title.width / 2, y: title.keyframes[0].y - title.height / 2, width: title.width, height: title.height } };
      const binding = titleTextBindings.find(binding => binding.instanceId === title.instanceId)!;
      titleTextBindings.push({ instanceId: particles.instanceId, input: binding.input, styleId: binding.styleId });
      presence.children.push(particles);
    }
  }
  titleImageBindings.unshift(...titleObjects.filter(title => title.content === 'image').map(title => ({ instanceId: title.instanceId, property: 'assetId' as const })));
  return { actions: [...(chapter.soundId ? [{ kind: 'sound' as const, assetId: chapter.soundId }] : []), root], warnings, backgroundInstanceId, imageLayerBindings, titleImageBindings, titleTextBindings };
}
