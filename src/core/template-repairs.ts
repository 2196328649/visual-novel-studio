import { type Project, type UiSkin } from './model';
import { templateVoiceCollectionComponents } from './template-voice-collection';

/** Exact partial-artwork signature produced by the former file-free repair. */
export function legacyTemplateVoiceArtwork(project: Project): boolean {
  const items = project.ui.components.find(c => c.id === 'ai_voicecollection_items');
  return items?.kind === 'voiceCollection' && items.list?.itemWidth === 701 && items.list.itemHeight === 94 && items.list.columns === 2 && items.list.rows === 6 &&
    !items.skin?.idle && items.skin?.fit === 'stretch' && items.skin.hideText === false && !items.list.voiceFavoriteSkin?.idle &&
    ['ai_gallery_voicecollection', 'ai_musicroom_voicecollection', 'ai_voicecollection_voicecollection'].every(id => {
      const c = project.ui.components.find(c => c.id === id); return c?.action === 'voiceCollection' && c.skin?.hideText === false && !c.skin.idle;
    });
}
export const templateVoiceArtworkAssetIds = [...new Set(JSON.stringify(templateVoiceCollectionComponents).match(/ai_ui_[a-f0-9]+/g) ?? [])];

export function restoreTemplateVoiceArtwork(project: Project): void {
  if (!legacyTemplateVoiceArtwork(project)) return;
  const ids = new Set(project.assets.map(a => a.id));
  if (!templateVoiceArtworkAssetIds.every(id => ids.has(id))) return;
  for (const original of templateVoiceCollectionComponents) {
    const component = project.ui.components.find(c => c.id === original.id);
    if (!component) { if (original.kind === 'image') project.ui.components.push(structuredClone(original)); continue; }
    if (!component.skin?.idle && original.skin?.idle) component.skin = structuredClone(original.skin);
    if (component.kind === 'voiceCollection') {
      component.list ??= {};
      if (!component.list.voiceFavoriteSkin?.idle) component.list.voiceFavoriteSkin = structuredClone(original.list?.voiceFavoriteSkin);
      if (!component.style?.fontAssetId && component.style?.fontSize === original.style?.fontSize) component.style = { ...component.style, fontAssetId: original.style?.fontAssetId };
    }
  }
}

/** Restore only the exact signature left by the former sample simplifier. */
export function repairTemplateVoiceCollection(project: Project): void {
  const previousDisabled = ['chapterSelect', 'voiceCollection', 'voiceSettings', 'staff', 'keyboard', 'gameOver'];
  const disabled = project.ui.disabledPages;
  if (!disabled || disabled.length !== previousDisabled.length || !previousDisabled.every(page => disabled.includes(page as typeof disabled[number]))
    || project.ui.pages?.voiceCollection || project.ui.components.some(component => component.page === 'voiceCollection' || component.action === 'voiceCollection')
    || !project.ui.components.some(component => component.id === 'ai_gallery_items' && component.kind === 'galleryGrid')
    || !project.ui.components.some(component => component.id === 'ai_musicroom_items' && component.kind === 'musicTrackList')
    || !project.ui.components.some(component => component.id === 'ai_flowchart_items' && component.kind === 'flowchart')) return;
  const assets = new Set(project.assets.map(asset => asset.id));
  const withoutMissingAssets = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, field] of Object.entries(value)) {
      if (typeof field === 'string' && field.startsWith('ai_ui_') && !assets.has(field)) delete (value as Record<string, unknown>)[key];
      else withoutMissingAssets(field);
    }
  };
  for (const original of templateVoiceCollectionComponents) {
    if (project.ui.components.some(component => component.id === original.id)) continue;
    const component = structuredClone(original);
    withoutMissingAssets(component);
    if (component.kind === 'image' && !component.assetId) continue;
    if (component.skin && !component.skin.idle) {
      component.skin.hideText = false;
      if (component.kind === 'button') component.style = { textColor: '#f5f7f7', background: '#283133', fontSize: 32, align: 'center', ...component.style };
    }
    project.ui.components.push(component);
  }
  project.ui.pages = { ...project.ui.pages, voiceCollection: { layout: 'custom', background: '#e3dfca' } };
  project.ui.disabledPages = disabled.filter(page => page !== 'voiceCollection');
}

export const templateFlowFontId = 'ai_ui_3510f58115c3cc3c';
export const templateFlowSoftShadow = { shadowX: 0, shadowY: 0, shadowBlur: 7, shadowColor: '#000000', shadowOpacity: .4 };
export function legacyTemplateFlowText(project: Project) {
  return [...project.ui.components, ...(project.ui.instances ?? []).flatMap(instance => instance.components), ...(project.ui.customPages ?? []).flatMap(page => page.components)].filter(component =>
    component.id === 'ai_flowchart_items' && component.kind === 'flowchart' && component.list?.layout === 'flow' &&
    component.skin?.idle === 'ai_ui_37adb4cb2b67d83f' && component.skin.disabled === 'ai_ui_ae60f933b9c28da3' &&
    (!component.skin.hover || component.skin.hover === 'ai_ui_fd5ccd7009a7038d') &&
    component.style?.fontSize === 28 && component.style.textColor === '#242a26' && !component.style.fontAssetId && !component.style.outlineWidth);
}

/** Repair the exact old bundled flow skin, leaving authored replacements untouched. */
export function repairTemplateFlow(project: Project): void {
  for (const component of legacyTemplateFlowText(project)) {
    component.list!.showProgress = false;
    if (project.assets.some(asset => asset.id === templateFlowFontId && asset.kind === 'font')) {
      Object.assign(component.style!, { fontAssetId: templateFlowFontId, fontSize: 60, textColor: '#ffffff', outlineWidth: 1, outlineColor: '#000000', outlineOpacity: 0.5 });
      if (!component.style!.hoverTextColor || component.style!.hoverTextColor === '#f4f0e6') component.style!.hoverTextColor = '#ffffff';
    }
  }
  for (const component of [...project.ui.components, ...(project.ui.instances ?? []).flatMap(instance => instance.components), ...(project.ui.customPages ?? []).flatMap(page => page.components)]) {
    if (component.id !== 'ai_flowchart_items' || component.kind !== 'flowchart' || component.list?.layout !== 'flow') continue;
    const text = component.style;
    if (component.skin?.idle === 'ai_ui_37adb4cb2b67d83f' && text?.fontAssetId === templateFlowFontId && text.fontSize === 60 && text.textColor === '#ffffff'
      && text.hoverTextColor === '#ffffff' && text.outlineWidth === 1 && text.outlineColor === '#000000' && text.outlineOpacity === .5
      && text.shadowX === 2 && text.shadowY === 3 && text.shadowColor === '#000000' && text.shadowOpacity === .7 && text.shadowBlur === undefined) Object.assign(text, templateFlowSoftShadow);
    const thumb = component.list.flowScrollbar?.thumb;
    if (thumb?.idle === 'ai_ui_a441471ec430d257' && thumb.fit === 'stretch' && !thumb.borders && !thumb.hover && !thumb.pressed && !thumb.selected && !thumb.disabled) {
      thumb.fit = 'nineSlice'; thumb.borders = { left: 24, top: 0, right: 24, bottom: 0 };
    }
    let repaired = false;
    const repair = (skin: UiSkin | undefined, idle: string) => {
      if (!skin || skin.idle !== idle || skin.hover !== 'ai_ui_fd5ccd7009a7038d' || skin.pressed !== skin.hover || skin.selected || skin.brightness || skin.disabled !== 'ai_ui_ae60f933b9c28da3' || skin.fit !== 'stretch') return;
      if (![idle, skin.hover, skin.disabled].every(id => project.assets.some(asset => asset.id === id && asset.kind === 'image'))) return;
      delete skin.hover; delete skin.pressed;
      skin.brightness = { hover: 118 / 255, pressed: 200 / 255, selected: 118 / 255 };
      repaired = true;
    };
    repair(component.skin, 'ai_ui_37adb4cb2b67d83f');
    repair(component.list.flowEndSkin, 'ai_ui_469e3bdcacbe8fd1');
    repair(component.list.flowChapterSkin, 'ai_ui_b97c86336119f069');
    if (repaired && component.style?.textColor === '#242a26' && !component.style.hoverTextColor) component.style.hoverTextColor = '#f4f0e6';
  }
}
