import { projectGraphs } from '../core/project-resources';
import { flowNodeAppearance } from '../core/flow-style';
import { uiAncestors } from '../core/ui-hierarchy';
import { isStandaloneNode } from '../core/standalone-performance';
import { omitDisabledUiScreens, uiActionAvailable } from '../core/ui-availability';
import { musicRoomEntries } from '../core/music-preview';
import { uiEventInActiveInstance, uiGraphOnPage } from '../core/ui-logic';
import { uiTextOutlines } from '../core/ui-text-effects';
import { visualObjectRuntime } from './visual-objects';
import { effectiveUiComponents, orderedUiComponents, sortUiComponents, type CustomUiPage, type Project, type UiComponent, type VariableValue } from '../core/model';
import { effectiveUiTheme } from '../core/model';
import { pythonBlockLiteral, pythonLiteral, renpyText } from './literals';
import { conditionExpression } from './expressions';
import { dialogueLayout, uiComponentBounds, uiComponentFontSize, uiTooltip } from '../core/ui';
import { componentSkinData, uiSkinData } from './ui-runtime';
import { playerPreferenceOptions, playerPreferences, replacesPreferenceOption, replacesStandardPreferences, standardPreferenceChoices } from '../core/preferences';
import { createUiWidgets } from './ui-widgets';
import { storyMenuEntries, storyVoiceEntries } from '../core/story-menu';
import { galleryRuntimeEntries } from '../core/gallery';
export { pythonLiteral, renpyText } from './literals';

const componentActions: Partial<Record<NonNullable<UiComponent['action']>, string>> = {
  start: 'Start()', load: 'ShowMenu("load")', preferences: 'ShowMenu("preferences")',
  gallery: 'ShowMenu("gallery")', music: 'ShowMenu("music_room")', quit: 'Quit(confirm=True)',
  save: 'ShowMenu("save")', history: 'ShowMenu("history")',
  auto: 'Preference("auto-forward", "toggle")', skip: 'VnSkip()',
  return: '(Jump("vn_bp_menu_return") if vn_bp_menu_active else ShowMenu("main_menu") if main_menu else Return())', mainMenu: 'MainMenu()', rollback: 'Rollback()',
  window: 'Preference("display", "window")', fullscreen: 'Preference("display", "fullscreen")',
  mute: 'Preference("all mute", "toggle")', skipSeen: 'Preference("skip", "seen")',
  skipAll: 'Preference("skip", "all")', transitions: 'Preference("transitions", "toggle")',
  pause: 'ShowMenu("pause_menu")', chapterSelect: 'ShowMenu("chapter_select")', voiceCollection: 'ShowMenu("voice_collection")',
  flowchart: 'ShowMenu("flowchart")', staff: 'ShowMenu("staff_roll")',
  hideInterface: 'HideInterface()', musicPrevious: 'vn_music_room.Previous()', musicNext: 'vn_music_room.Next()',
  musicPlayPause: 'vn_music_room.TogglePause()', musicStop: 'vn_music_room.Stop()', musicLoop: 'vn_music_room.ToggleLoop()', musicShuffle: 'vn_music_room.ToggleShuffle()',
  voiceSettings: 'ShowMenu("voice_settings")', resetPreferences: 'Confirm("恢复全部初始设置吗？", Function(vn_reset_preferences))',
  confirmYes: 'yes_action', confirmNo: 'no_action',
};
function componentAction(project: Project, component: UiComponent, custom = false): string {
  if (component.action && !uiActionAvailable(project.ui, component.action)) return 'NullAction()';
  const actions: string[] = [];
  for (const graph of projectGraphs(project)) for (const node of graph.nodes) if (node.type === 'eventClick' && node.properties.componentId === component.id && uiEventInActiveInstance(project,node) && uiGraphOnPage(project,graph,component.page==='custom'?project.ui.customPages.find(p=>p.components.some(c=>c.id===component.id))?.id??'':'ui:'+component.page)) actions.push(`Function(vn_run_blueprint, ${pythonLiteral(graph.id)}, ${pythonLiteral(node.id)})`);
  if (component.events?.onClick && projectGraphs(project)?.some(graph => graph.id === component.events?.onClick)) {
    actions.push(`Function(vn_run_blueprint, ${pythonLiteral(component.events.onClick)})`);
  }
  let primary: string | undefined;
  if (component.action === 'setPlayerPreference') primary = `VnSetPreference(${pythonLiteral(component.preference)}, ${pythonLiteral(component.preferenceValue)}, ${pythonLiteral(component.preferenceCharacterId)})`;
  else if (component.page === 'voiceSettings' && component.action === 'return') primary = 'ShowMenu("preferences")';
  else if (component.action === 'blueprint' && component.blueprintId && projectGraphs(project)?.some(graph => graph.id === component.blueprintId)) primary = `Function(vn_run_blueprint, ${pythonLiteral(component.blueprintId)})`;
  else if (custom && component.action === 'minigameSuccess') { actions.push('Function(vn_finish_minigame, "success")'); primary = 'Return("success")'; }
  else if (custom && component.action === 'minigameFailure') { actions.push('Function(vn_finish_minigame, "failure")'); primary = 'Return("failure")'; }
  else if (custom && component.action === 'minigameCancel') { actions.push('Function(vn_finish_minigame, "cancel")'); primary = 'Return("cancel")'; }
  else if (custom && component.action === 'return') {
    const pageId=project.ui.customPages.find(page=>page.components.some(c=>c.id===component.id))?.id;
    primary=pageId?`If(${pythonLiteral(pageId)} in vn_ui_open_pages, Function(vn_ui_close_page, ${pythonLiteral(pageId)}, ""), Return())`:'Return()';
  }
  else primary = component.action ? componentActions[component.action] : undefined;
  if (primary) actions.push(primary);
  return actions.length > 1 ? `[${actions.join(', ')}]` : actions[0] ?? 'NullAction()';
}

const preferenceControls = {
  textSpeed: { name: 'text speed', title: '文字速度' },
  autoForwardTime: { name: 'auto-forward time', title: '自动播放间隔' },
  musicVolume: { name: 'music volume', title: '音乐音量' },
  soundVolume: { name: 'sound volume', title: '音效音量' },
  voiceVolume: { name: 'voice volume', title: '语音音量' },
  masterVolume: { name: 'main volume', title: '总音量' },
  ambientVolume: { name: 'mixer ambient volume', title: '环境音量' },
  dialogueOpacity: { name: '', title: '对话框不透明度' },
};

function componentScreen(project: Project, page: UiComponent['page'], options: { name?: string; components?: UiComponent[]; custom?: boolean; pageId?: string; onShowBlueprintId?: string } = {}): string {
  const components = options.components ? sortUiComponents(options.components) : orderedUiComponents(project.ui).filter(item => item.page === page);
  const custom = options.custom ?? false;
  const parameters = custom ? 'minigame_title="", minigame_prompt=""' : page === 'say' ? 'who, what' : page === 'choice' ? 'items' : page === 'messageBox' ? 'message, yes_action, no_action' : page === 'chapterTitle' ? 'title, subtitle, effect="none", duration=2.5, title_image=None' : '';
  const lines: string[] = [`screen ${options.name ?? `vn_components_${page}`}(${parameters}):`];
  const bindings: string[] = [];
  if (projectGraphs(project).some(g => g.nodes.some(n => ['animateUiProperty','playUiAnimation'].includes(n.type)))) lines.push('    use vn_ui_animation_clock');
  const activeInstance = custom ? undefined : project.ui.instances?.find(instance => instance.id === project.ui.activeInstanceId);
  const pageId=options.pageId??'ui:'+page;
  const showBlueprints = [...projectGraphs(project).filter(g=>g.uiPageId&&g.uiPageId===pageId&&g.nodes.some(n=>n.type==='event')&&uiGraphOnPage(project,g,pageId)).map(g=>g.id), options.onShowBlueprintId, activeInstance?.blueprintId, ...components.map(component => component.events?.onShow)]
    .filter((id, index, values): id is string => !!id && values.indexOf(id) === index && !!projectGraphs(project)?.some(graph => graph.id === id));
  if (showBlueprints.length) {
    const actions = showBlueprints.map(id => `Function(vn_run_ui_show, ${pythonLiteral(id)})`);
    lines.push(`    on "show" action ${actions.length === 1 ? actions[0] : `[${actions.join(', ')}]`}`);
  }
  if (!custom) {
    const keyActions = new Map<string,string[]>();
    for (const graph of projectGraphs(project)) for (const node of graph.nodes) {
      if (!uiGraphOnPage(project,graph,'ui:'+page) || !uiEventInActiveInstance(project,node) || node.properties.pageId !== 'ui:' + page || !['eventTimer','eventKey'].includes(node.type)) continue;
      const action = 'Function(vn_run_blueprint, ' + pythonLiteral(graph.id) + ', ' + pythonLiteral(node.id) + ')';
      if (node.type === 'eventTimer') lines.push('    timer ' + pythonLiteral(node.properties.interval ?? 1) + ' repeat ' + pythonLiteral(node.properties.repeat ?? true) + ' action ' + action);
      else { const key=String(node.properties.key ?? 'K_SPACE');keyActions.set(key,[...keyActions.get(key)??[],action]); }
    }
    for (const [key,actions] of keyActions) lines.push('    key ' + pythonLiteral(key) + ' action [' + actions.join(', ') + ']');
  }
  const blocks = new Map<string, { block: string[]; contentAt: number; guards: string[]; runtimeWidth: string; runtimeHeight: string }>();
  for (const component of components) {
    const children = components.filter(c => c.parentId === component.id);
    const { x, y, width, height } = uiComponentBounds(component, project.width, project.height);
    const block: string[] = [];
    const fontSize = uiComponentFontSize(component, effectiveUiTheme(project.ui), project.width, project.height);
    const font = project.assets.find(item => item.id === (component.style?.fontAssetId ?? project.ui.fontAssetId) && item.kind === 'font')?.path.replaceAll('\\', '/') ?? 'fonts/SourceHanSansLite.ttf';
    const textColor = pythonLiteral(component.style?.textColor ?? project.ui.textColor);
    const textOutlines = uiTextOutlines(component);
    const outline = textOutlines.length ? ` outlines ${pythonLiteral(textOutlines)}` : '';
    const surface = pythonLiteral(component.style?.background ?? (component.kind === 'historyList' && component.list?.historyLayout === 'columns' ? '#00000000' : '#283133'));
    const align = { left: 0, center: 0.5, right: 1 }[component.style?.align ?? (component.kind === 'text' ? 'left' : 'center')];
    const componentId = `vn_component_${component.id}`;
    const parameter = project.variables.find(variable => variable.id === component.parameterId);
    const property = (name: string, fallback?: string) => `vn_ui_get(${pythonLiteral(component.id)}, ${pythonLiteral(name)}${fallback === undefined ? '' : `, ${fallback}`})`;
    const extent = (name: 'width' | 'height') => component.parentId ? `vn_ui_extent(${pythonLiteral(component.id)}, ${pythonLiteral(name)})` : property(name);
    const runtimeWidth = `max(1, int(${extent('width')} * ${project.width} + 0.5))`;
    const runtimeHeight = `max(1, int(${extent('height')} * ${project.height} + 0.5))`;
    const asset = project.assets.find(item => item.id === component.assetId);
    const skin = pythonLiteral(componentSkinData(project, component));
    const listOptions = { ...component.list };
    if (component.kind === 'galleryGrid') { delete listOptions.galleryGroups; delete listOptions.galleryUnlockWhen; }
    const optionData = { ...listOptions,
      galleryGeometry: component.kind === 'galleryGrid' ? galleryLayout(project, component) : undefined,
      galleryEntries: component.kind === 'galleryGrid' ? galleryRuntimeEntries(project, component) : undefined,
      pageFontPath: project.assets.find(asset => asset.id === component.list?.pageFontAssetId)?.path.replaceAll('\\', '/'),
      flowLooks: component.kind === 'flowchart' ? Object.fromEntries(storyMenuEntries(project, 'flowchart').map(entry => {
        const node = project.nodes.find(n => n.id === entry.nodeId);
        const look = flowNodeAppearance(project, component, { ...entry, kind: node && isStandaloneNode(node) ? 'chapterTitle' : node?.kind });
        return [entry.id, { skin: componentSkinData(project, look), style: look.style, textOutlines: uiTextOutlines(look, false), font: project.assets.find(a => a.id === (look.style?.fontAssetId ?? project.ui.fontAssetId))?.path.replaceAll('\\', '/') }];
      })) : undefined,
      flowGraph: component.kind === 'flowchart' && component.list?.layout === 'flow' ? storyFlowLayout(project, component) : undefined,
      hoverTextColor: component.style?.hoverTextColor,
      textOutlines: textOutlines.length ? textOutlines : undefined,
      pageSkin: uiSkinData(project, component.list?.pageSkin),
      slotActionSkin: uiSkinData(project, component.list?.slotActionSkin),
      slotSaveSkin: component.list?.slotSaveSkin ? uiSkinData(project, component.list.slotSaveSkin) : undefined,
      autoSlotSkin: component.list?.autoSlotSkin ? uiSkinData(project, component.list.autoSlotSkin) : undefined,
      numberSkin: uiSkinData(project, component.list?.numberSkin),
      flowEndSkin: component.list?.flowEndSkin ? uiSkinData(project, component.list.flowEndSkin) : undefined,
      flowChapterSkin: component.list?.flowChapterSkin ? uiSkinData(project, component.list.flowChapterSkin) : undefined,
      flowCurrentMarker: component.list?.flowCurrentMarker ? { ...component.list.flowCurrentMarker, path: project.assets.find(item => item.id === component.list?.flowCurrentMarker?.assetId)?.path.replaceAll('\\', '/') } : undefined,
      flowScrollbar: component.list?.flowScrollbar ? { ...component.list.flowScrollbar,
        trackPath: project.assets.find(item => item.id === component.list?.flowScrollbar?.trackId)?.path.replaceAll('\\', '/'),
        thumb: uiSkinData(project, component.list.flowScrollbar.thumb) } : undefined,
      flowLinePath: project.assets.find(item => item.id === component.list?.flowLineAssetId)?.path.replaceAll('\\', '/'),
      flowVerticalLinePath: project.assets.find(item => item.id === component.list?.flowVerticalLineAssetId)?.path.replaceAll('\\', '/'),
      voiceReplaySkin: uiSkinData(project, component.list?.voiceReplaySkin),
      historyScrollbar: component.list?.historyScrollbar ? { ...component.list.historyScrollbar,
        trackPath: project.assets.find(item => item.id === component.list?.historyScrollbar?.trackId)?.path.replaceAll('\\', '/'),
        thumb: uiSkinData(project, component.list.historyScrollbar.thumb) } : undefined,
      voiceFavoriteSkin: uiSkinData(project, component.list?.voiceFavoriteSkin),
      lockedPath: project.assets.find(item => item.id === component.list?.lockedAssetId)?.path.replaceAll('\\', '/'),
      emptyPath: project.assets.find(item => item.id === component.list?.emptyAssetId)?.path.replaceAll('\\', '/'),
      hoverOverlayPath: project.assets.find(item => item.id === component.list?.hoverOverlayId)?.path.replaceAll('\\', '/'),
      thumbnailFramePath: project.assets.find(item => item.id === component.list?.thumbnailFrame?.assetId)?.path.replaceAll('\\', '/'),
      assetPaths: component.list?.assetIds?.map(id => project.assets.find(item => item.id === id)?.path.replaceAll('\\', '/')).filter(Boolean),
    };
    const options = component.kind === 'galleryGrid' ? 'vn_gallery_options_' + component.id : pythonLiteral(optionData);
    if (component.kind === 'galleryGrid') bindings.push('init python:\n    ' + options + ' = ' + pythonBlockLiteral(optionData, 1));
    const stateFrame = component.parentId && component.kind !== 'button';
    block.push(stateFrame ? '    vn_state_frame:' : '    frame:', ...(stateFrame ? [`        vn_inherit_state ${pythonLiteral(component.inheritState ?? false)}`] : []), `        xpos vn_ui_position(${pythonLiteral(component.id)}, "x")`, `        ypos vn_ui_position(${pythonLiteral(component.id)}, "y")`, `        xysize (${runtimeWidth}, ${runtimeHeight})`,
      '        padding (0, 0)', `        at ${component.kind === 'chapterTitle' ? '[' : ''}Transform(alpha=${property('opacity')}${component.style?.playerOpacity ? ' * vn_preference_get("dialogueOpacity")' : ''})${component.kind === 'chapterTitle' ? ', vn_chapter_letters(effect, duration)]' : ''}`,
      `        background ${component.style?.background && !['button', 'choiceList', 'saveSlots'].includes(component.kind) ? `Solid(${surface})` : 'None'}`);
    if (stateFrame) for (const [prefix, key] of [['hover', 'hoverBackground'], ['activate', 'pressedBackground'], ['selected', 'selectedBackground'], ['selected_hover', 'selectedBackground'], ['selected_activate', 'pressedBackground'], ['insensitive', 'disabledBackground'], ['selected_insensitive', 'disabledBackground']] as const) {
      const color = component.style?.[key] ?? component.style?.background;
      if (color) block.push(`        ${prefix}_background Solid(${pythonLiteral(color)})`);
    }
    if (component.kind !== 'button') block.push(`        id ${pythonLiteral(componentId)}`);
    const contentAt = block.length;
    if (component.kind === 'spine') {
      block.push(`        add vns_spine.player(${pythonLiteral(component.id)}, ${runtimeWidth}, ${runtimeHeight}) id ${pythonLiteral(`vn_spine_${component.id}`)}`);
    } else if (component.kind === 'video') {
      const poster = project.assets.find(item => item.id === component.posterId)?.path.replaceAll('\\', '/');
      if (asset) block.push(`        add Movie(play=${pythonLiteral(asset.path.replaceAll('\\', '/'))}, size=(${runtimeWidth}, ${runtimeHeight}), loop=${pythonLiteral(component.loop ?? true)}, start_image=${pythonLiteral(poster)}, image=${pythonLiteral(poster)}) id ${pythonLiteral(`vn_video_${component.id}`)}`);
      else block.push('        null');
    } else if (component.kind === 'image') {
      if (asset) {
        const imageSkin = pythonLiteral(Object.fromEntries(Object.entries({ ...componentSkinData(project, component), idle: asset.path.replaceAll('\\', '/'), fit: component.style?.imageFit ?? 'contain' }).filter(([, value]) => value !== undefined)));
        block.push(`        add ${component.parentId ? `VnUiStateSurface(${imageSkin}, ${runtimeWidth}, ${runtimeHeight}, ${pythonLiteral(component.inheritState ?? false)})` : `vn_ui_surface(${imageSkin}, "idle", ${runtimeWidth}, ${runtimeHeight}, "#00000000")`} xysize (${runtimeWidth}, ${runtimeHeight})`);
      }
      else block.push('        null');
    } else if (component.kind === 'button') {
      const action = componentAction(project, component, custom);
      const interactionEvents=Object.fromEntries(['hover','unhover','press','release'].map(trigger=>[trigger,projectGraphs(project).flatMap(graph=>uiGraphOnPage(project,graph,pageId)?graph.nodes.filter(node=>node.type==='eventButton'&&node.properties.componentId===component.id&&node.properties.trigger===trigger&&uiEventInActiveInstance(project,node)).map(node=>`Function(vn_run_blueprint, ${pythonLiteral(graph.id)}, ${pythonLiteral(node.id)})`):[])]));
      block.push('        vn_skin_button:', `            id ${pythonLiteral(componentId)}`,
        `            vn_component_id ${pythonLiteral(component.id)}`,
        `            vn_events {${Object.entries(interactionEvents).filter(([,actions])=>actions.length).map(([trigger,actions])=>`${pythonLiteral(trigger)}: [${actions.join(', ')}]`).join(', ')}}`,
        `            xysize (${runtimeWidth}, ${runtimeHeight})`, `            padding ${component.skin?.hideText || children.length ? '(0, 0)' : '(8, 4)'}`,
        `            alt ${renpyText(component.text)}`,
        `            tooltip ${pythonLiteral(uiTooltip(component) || undefined)}`,
        `            background vn_ui_surface(${skin}, "idle", ${runtimeWidth}, ${runtimeHeight}, ${surface})`,
        `            hover_background vn_ui_surface(${skin}, "hover", ${runtimeWidth}, ${runtimeHeight}, ${pythonLiteral(component.style?.hoverBackground ?? component.style?.background ?? '#3b8f80')})`,
        `            activate_background vn_ui_surface(${skin}, "pressed", ${runtimeWidth}, ${runtimeHeight}, ${pythonLiteral(component.style?.pressedBackground ?? component.style?.hoverBackground ?? '#3b8f80')})`,
        `            insensitive_background vn_ui_surface(${skin}, "disabled", ${runtimeWidth}, ${runtimeHeight}, ${pythonLiteral(component.style?.disabledBackground ?? '#22282a')})`,
        `            selected_background vn_ui_surface(${skin}, "selected", ${runtimeWidth}, ${runtimeHeight}, ${pythonLiteral(component.style?.selectedBackground ?? component.style?.hoverBackground ?? '#3b8f80')})`,
        `            selected_hover_background vn_ui_surface(${skin}, "selected", ${runtimeWidth}, ${runtimeHeight}, ${pythonLiteral(component.style?.selectedBackground ?? component.style?.hoverBackground ?? '#3b8f80')})`,
        `            selected_activate_background vn_ui_surface(${skin}, "pressed", ${runtimeWidth}, ${runtimeHeight}, ${pythonLiteral(component.style?.pressedBackground ?? '#3b8f80')})`,
        `            selected_insensitive_background vn_ui_surface(${skin}, "disabled", ${runtimeWidth}, ${runtimeHeight}, ${pythonLiteral(component.style?.disabledBackground ?? '#22282a')})`,
        `            action ${action}`);
      block.push(`            sensitive (${component.parentId ? `vn_ui_ancestor_enabled(${pythonLiteral(component.id)}) and ` : ''}${property('enabled')} and renpy.display.behavior.is_sensitive(${action}))`);
      block.push(`            selected (${property('selected')} if "selected" in vn_ui_overrides.get(${pythonLiteral(component.id)}, {})${component.selectedWhen ? ' or True' : ''} else None)`);
      block.push(component.skin?.hideText ? '            null' : `            text vn_ui_literal(${property('text')}) substitute False font ${pythonLiteral(font)} size ${fontSize} color ${textColor} hover_color ${pythonLiteral(component.style?.hoverTextColor ?? component.style?.textColor ?? project.ui.textColor)} selected_color ${pythonLiteral(component.style?.selectedTextColor ?? component.style?.textColor ?? project.ui.textColor)} insensitive_color ${pythonLiteral(component.style?.disabledTextColor ?? component.style?.textColor ?? project.ui.textColor)} text_align ${align} xalign ${align} yalign 0.5 xmaximum max(1, ${runtimeWidth} - 16)${outline}`);
    } else if (component.kind === 'panel') {
      block.push('        null');
    } else if (component.kind === 'progress') {
      block.push('        fixed:', `            xysize (${runtimeWidth}, ${runtimeHeight})`,
        `            add Solid(${pythonLiteral(component.style?.background ?? '#283133')}) xysize (${runtimeWidth}, ${runtimeHeight})`,
        `            add Solid(${pythonLiteral(component.style?.selectedBackground ?? project.ui.accent)}) xysize (max(0, int(${property('value')} * ${runtimeWidth})), ${runtimeHeight})`);
    } else if (component.kind === 'choiceList') {
      block.push(`        use vn_choice_items(items, ${runtimeWidth}, ${runtimeHeight}, ${fontSize}, ${textColor}, ${surface}, ${align}, ${pythonLiteral(componentId)}, ${skin}, ${pythonLiteral(font)}, ${options})`);
    } else if (component.kind === 'saveSlots') {
      block.push(`        use vn_skin_slots(${runtimeWidth}, ${runtimeHeight}, ${fontSize}, ${textColor}, ${surface}, ${skin}, ${options}, ${pythonLiteral(font)})`);
    } else if (component.parameterId && ['preference', 'preferenceChoice'].includes(component.kind) && parameter?.type !== 'number') {
      block.push(`        use vn_parameter_control(${pythonLiteral(component.parameterId)}, width=${runtimeWidth}, height=${runtimeHeight}, font_size=${fontSize}, color=${textColor}, font=${pythonLiteral(font)}, caption=${renpyText(component.text)}, component_id=${pythonLiteral(component.id)})`);
    } else if (component.kind === 'preference' || component.kind === 'preferenceChoice' && parameter?.type === 'number') {
      const slider = { ...component.slider, thumb: uiSkinData(project, component.slider?.thumb),
        trackPath: project.assets.find(a => a.id === component.slider?.trackId)?.path.replaceAll('\\', '/'),
        fillPath: project.assets.find(a => a.id === component.slider?.fillId)?.path.replaceAll('\\', '/') };
      block.push(`        use vn_preference_slider(${pythonLiteral(component.preference)}, ${pythonLiteral(component.preferenceCharacterId)}, ${renpyText(component.text || parameter?.name || playerPreferences[component.preference!]?.name || '')}, ${runtimeWidth}, ${runtimeHeight}, ${fontSize}, ${textColor}, ${pythonLiteral(font)}, ${pythonLiteral(slider)}, ${pythonLiteral(componentId)}${parameter ? ', parameter_id=' + pythonLiteral(parameter.id) : ''}, component_id=${pythonLiteral(component.id)})`);
    } else if (component.kind === 'preferenceChoice') {
      const info = playerPreferences[component.preference!];
      const choices = component.selector?.options ?? playerPreferenceOptions(component.preference!);
      const selector = { ...component.selector, options: choices, itemSkin: uiSkinData(project, component.selector?.itemSkin), popupPath: project.assets.find(a => a.id === component.selector?.popupBackgroundId)?.path.replaceAll('\\', '/'), arrowPath: project.assets.find(a => a.id === component.selector?.arrowId)?.path.replaceAll('\\', '/') };
      block.push(`        use vn_preference_choice(${pythonLiteral(component.preference)}, ${pythonLiteral(component.preferenceCharacterId)}, ${pythonLiteral(selector)}, ${skin}, int(${property('x')} * ${project.width}), int(${property('y')} * ${project.height}), ${runtimeWidth}, ${runtimeHeight}, ${fontSize}, ${textColor}, ${surface}, ${pythonLiteral(font)}, ${pythonLiteral(componentId)}, component_id=${pythonLiteral(component.id)})`);
    } else if (['galleryGrid', 'musicTrackList', 'voiceCollection', 'chapterList', 'historyList', 'flowchart', 'pauseMenu', 'staffRoll'].includes(component.kind)) {
      block.push(`        use vn_collection(${pythonLiteral(component.kind)}, ${runtimeWidth}, ${runtimeHeight}, ${fontSize}, ${textColor}, ${surface}, ${skin}, ${options}, ${pythonLiteral(componentId)}, ${pythonLiteral(font)}, ${renpyText(component.text)})`);
    } else if (['keyboard', 'chapterTitle', 'messageBox', 'gameOver'].includes(component.kind)) {
      const contextArgs = component.kind === 'chapterTitle' ? `, title, subtitle, font=${pythonLiteral(font)}, title_image=title_image, align=${align}, text_outlines=${outline ? outline.trim().slice('outlines '.length) : '[]'}` : '';
      block.push(`        use vn_context_component(${pythonLiteral(component.kind)}, ${runtimeWidth}, ${runtimeHeight}, ${fontSize}, ${textColor}, ${renpyText(component.text)}${contextArgs})`);
    } else if (component.binding === 'confirmation') {
      block.push(`        use vn_confirmation_text(_(message), ${runtimeWidth}, ${runtimeHeight}, ${fontSize}, ${textColor}, ${pythonLiteral(font)}, ${align}, ${pythonLiteral(componentId)}, text_outlines=${outline ? outline.trim().slice('outlines '.length) : '[]'})`);
    } else if (component.binding === 'tooltip') {
      block.push(`        add vn_ui_surface(${skin}, "idle", ${runtimeWidth}, ${runtimeHeight}, "#00000000")`,
        `        text vn_ui_literal(GetTooltip() or "") substitute False font ${pythonLiteral(font)} size ${fontSize} color ${textColor} xalign ${align} yalign 0.5 text_align ${align} xmaximum ${runtimeWidth}${outline}`);
    } else {
      const text = component.binding === 'title' ? renpyText(project.name) : component.binding === 'speaker' ? 'who' : component.binding === 'dialogue' ? 'what' : component.binding === 'minigameTitle' ? 'minigame_title' : component.binding === 'minigamePrompt' ? 'minigame_prompt' : component.binding === 'minigameStatus' ? 'vn_minigame_status()' : property('text');
      const bindingId = component.binding === 'speaker' ? ' id "who"' : component.binding === 'dialogue' ? ' id "what"' : '';
      if (component.binding === 'speaker') block.push('        if who is not None:');
      const indent = component.binding === 'speaker' ? '            ' : '        ';
      const stateColors = stateFrame ? ` hover_color ${pythonLiteral(component.style?.hoverTextColor ?? component.style?.textColor ?? project.ui.textColor)} activate_color ${pythonLiteral(component.style?.hoverTextColor ?? component.style?.textColor ?? project.ui.textColor)} selected_color ${pythonLiteral(component.style?.selectedTextColor ?? component.style?.textColor ?? project.ui.textColor)} insensitive_color ${pythonLiteral(component.style?.disabledTextColor ?? component.style?.textColor ?? project.ui.textColor)}` : '';
      block.push(`${indent}${stateFrame ? 'vn_state_viewport' : 'viewport'}:`, `${indent}    xysize (${runtimeWidth}, ${runtimeHeight})`, `${indent}    mousewheel True`, `${indent}    draggable False`,
        `${indent}    ${component.binding === 'dialogue' ? 'vn_dialogue_text' : 'text'} ${component.binding ? text : `vn_ui_literal(${text}) substitute False`}${bindingId} font ${pythonLiteral(font)} xsize ${runtimeWidth} min_width ${runtimeWidth} size ${fontSize} color ${textColor}${stateColors} text_align ${align}${outline}`);
    }
    const guards = [property('visible'), component.binding === 'tooltip' ? 'GetTooltip()' : '', component.page === 'save' && component.saveMode ? `renpy.get_screen(${pythonLiteral(component.saveMode)}) is not None` : ''].filter(Boolean);
    blocks.set(component.id, { block, contentAt, guards, runtimeWidth, runtimeHeight });
  }
  const renderTree = (component: UiComponent, seen = new Set<string>()): string[] => {
    if (seen.has(component.id)) return [];
    const entry = blocks.get(component.id)!;
    const block = [...entry.block], children = components.filter(c => c.parentId === component.id);
    if (children.length) {
      const branch = (background: boolean, indent: number) => children.filter(c => (c.childLayer === 'background') === background).flatMap(c => renderTree(c, new Set(seen).add(component.id)).map(line => ' '.repeat(indent) + line));
      if (component.kind === 'button') {
        const labelAt = block.findIndex(line => line.startsWith('            text ') || line === '            null');
        const label = block[labelAt];
        let content = ['    ' + label];
        if (children.some(c => c.childLayer === 'background')) {
          // Draw the button's own surface after background children, just like
          // the editor. Keep every native button state and its input handling.
          for (let i = 0; i < block.length; i++) if (/^            (?:\w+_)?background vn_ui_surface\(/.test(block[i])) {
            block[i] = block[i].replace(/vn_ui_surface\(.*$/, 'None');
          }
          const colors = { idle: component.style?.background ?? '#283133',
            hover: component.style?.hoverBackground ?? component.style?.background ?? '#3b8f80',
            pressed: component.style?.pressedBackground ?? component.style?.hoverBackground ?? '#3b8f80',
            selected: component.style?.selectedBackground ?? component.style?.hoverBackground ?? '#3b8f80',
            disabled: component.style?.disabledBackground ?? '#22282a' };
          content = [`                add VnUiStateSurface(${pythonLiteral(componentSkinData(project, component))}, ${entry.runtimeWidth}, ${entry.runtimeHeight}, True, colors=${pythonLiteral(colors)}) xysize (${entry.runtimeWidth}, ${entry.runtimeHeight})`, '    ' + label];
        }
        block.splice(labelAt, 1, '            fixed:', '                xysize (' + entry.runtimeWidth + ', ' + entry.runtimeHeight + ')', ...branch(true, 12), ...content, ...branch(false, 12));
      } else {
        const content = block.splice(entry.contentAt);
        block.push('        fixed:', '            xysize (' + entry.runtimeWidth + ', ' + entry.runtimeHeight + ')', ...branch(true, 8), ...content.map(line => '    ' + line), ...branch(false, 8));
      }
    }
    return entry.guards.length ? ['    if ' + entry.guards.join(' and ') + ':', ...block.map(line => '    ' + line)] : block;
  };
  for (const root of components.filter(c => !c.parentId)) lines.push(...renderTree(root));
  // Keys belong to the screen: an enclosing button can consume keyboard events
  // before nested displayables receive them. Keep the whole ancestor guard.
  for (const component of components.filter(c => c.kind === 'button' && c.shortcut)) {
    const guards = [component, ...uiAncestors(components, component.id)].flatMap(c => blocks.get(c.id)!.guards);
    const action = componentAction(project, component, custom);
    lines.push('    if ' + [...new Set(guards)].join(' and ') + ':', `        key ${pythonLiteral(component.shortcut)} action If(vn_ui_ancestor_enabled(${pythonLiteral(component.id)}) and vn_ui_get(${pythonLiteral(component.id)}, "enabled") and renpy.display.behavior.is_sensitive(${action}), ${action}, NullAction())`);
  }
  if (lines.length === 1) lines.push('    pass');
  return [...bindings, lines.join('\n')].join('\n\n');
}

function customPageScreens(project: Project): string {
  const pages = project.ui.customPages ?? [];
  const screens = pages.map((page: CustomUiPage) => {
    const background = page.background ?? project.ui.background;
    const backgroundPath = project.assets.find(asset => asset.id === page.backgroundId && asset.kind === 'image')?.path.replaceAll('\\', '/');
    const events = projectGraphs(project).flatMap(graph => graph.nodes.filter(node => ['eventKey', 'eventTimer'].includes(node.type) && node.properties.pageId === page.id && uiGraphOnPage(project,graph,page.id) && uiEventInActiveInstance(project,node)).map(node => ({ graph, node })));
    const keyActions = new Map<string, string[]>(), timers: string[] = [];
    for (const { graph, node } of events) {
      const action = `Function(vn_run_blueprint, ${pythonLiteral(graph.id)}, ${pythonLiteral(node.id)})`;
      if (node.type === 'eventKey') {
        const key = String(node.properties.key ?? 'K_SPACE');
        keyActions.set(key, [...keyActions.get(key) ?? [], action]);
      } else timers.push(`    timer ${pythonLiteral(node.properties.interval ?? 1)} repeat ${pythonLiteral(node.properties.repeat ?? true)} action ${action}`);
    }
    // Separate key statements consume the event before later handlers can run.
    const triggers = [...keyActions].map(([key, actions]) => `    key ${pythonLiteral(key)} action [${actions.join(', ')}]`).concat(timers).join('\n');
    return `screen vn_custom_page_${page.id}(minigame_title="", minigame_prompt="", _vn_waiting=False):
    modal ${page.modal ? 'True' : 'False'}
    zorder 60
    add Solid(${pythonLiteral(background)})
${backgroundPath ? `    add Transform(${pythonLiteral(backgroundPath)}, xysize=(${project.width}, ${project.height}), fit="cover")` : ''}
    use vn_components_custom_${page.id}(minigame_title=minigame_title, minigame_prompt=minigame_prompt)
${triggers}
    if _vn_waiting:
        timer 0.02 repeat True action If(${pythonLiteral(page.id)} in vn_ui_page_results, Return(vn_ui_page_results.get(${pythonLiteral(page.id)}, "")), NullAction())
    key "game_menu" action Function(vn_ui_cancel_page, ${pythonLiteral(page.id)})

${componentScreen(project, 'custom', { name: `vn_components_custom_${page.id}`, components: page.components, custom: true, pageId: page.id, onShowBlueprintId: page.onShowBlueprintId })}`;
  }).join('\n\n');
  const choices = pages.map((page, index) => `${index ? '    el' : '    '}if page_id == ${pythonLiteral(page.id)}:\n        use vn_custom_page_${page.id}(minigame_title=title, minigame_prompt=prompt)`).join('\n');
  return `${screens}${screens ? '\n\n' : ''}screen vn_blueprint_pages():
    zorder 65
    modal any(vn_custom_pages.get(page_id, {}).get("modal", True) for page_id, mode in vn_ui_open_pages.items() if mode == "shown")
${pages.map(page => `    if vn_ui_open_pages.get(${pythonLiteral(page.id)}) == "shown":\n        use vn_custom_page_${page.id}()`).join('\n') || '    pass'}

screen vn_minigame_custom(minigame_id, title="", prompt=""):
    modal vn_minigame_page_modal()
    zorder 50
    $ page_id = vn_minigame_page(minigame_id)
${choices || '    if True:\n        text "小游戏界面不存在" xalign 0.5 yalign 0.5'}
    timer 0.05 repeat True action If(vn_minigame_finished in ("success", "failure", "cancel"), Return(vn_minigame_finished), NullAction())
    key "game_menu" action [Function(vn_finish_minigame, "cancel"), Return("cancel")]
`;
}

export function createScreens(project: Project): string {
  project = { ...project, ui: effectiveUiTheme(project.ui) };
  const { width: w, height: h, ui } = project;
  const components = effectiveUiComponents(ui);
  const fs = ui.fontSize;
  const menuFs = Math.min(24, fs);
  const smallFs = Math.min(18, fs);
  const mainButtonHeight = Math.max(24, Math.min(50, Math.floor((h * 0.7 - 40) / 6)));
  const mainButtonFont = Math.min(menuFs, Math.max(14, mainButtonHeight - 16));
  const { margin, contentWidth, quickHeight, dialogueHeight } = dialogueLayout(w, h, ui);
  const dialogueColor = ui.background + Math.round(ui.dialogueOpacity * 255).toString(16).padStart(2, '0');
  const slotWidth = Math.floor((contentWidth - 24) / 3);
  const slotHeight = Math.max(80, Math.floor((h - 205) / 2));
  const thumbnailHeight = Math.max(35, slotHeight - 56);
  const menuImage = project.assets.find(asset => asset.id === ui.menuBackgroundId);
  const chapterOverlay = project.assets.find(asset => asset.id === ui.chapterTransition?.overlayId && asset.kind === 'image');
  const chapterMask = project.assets.find(asset => asset.id === ui.chapterTransition?.maskId && asset.kind === 'image');
  const chapterBackground = project.assets.find(asset => asset.id === ui.pages?.chapterTitle?.backgroundId && asset.kind === 'image');
  const fontPath = project.assets.find(asset => asset.id === ui.fontAssetId && asset.kind === 'font')?.path.replaceAll('\\', '/') ?? 'fonts/SourceHanSansLite.ttf';
  const customMain = ui.pages?.main?.layout === 'custom';
  const customSay = ui.pages?.say?.layout === 'custom';
  const imageEntries = project.assets.filter(asset => asset.kind === 'image');
  const musicEntries = musicRoomEntries(project, components);
  const galleryData = imageEntries.map(asset => `        (${pythonLiteral(asset.id)}, ${renpyText(asset.name)}, ${pythonLiteral(asset.path.replaceAll('\\', '/'))}),`).join('\n');
  const musicData = musicEntries.map(asset => `        (${renpyText(asset.name)}, ${pythonLiteral(asset.path.replaceAll('\\', '/'))}),`).join('\n');
  const voiceEntries = storyVoiceEntries(project).map(asset => `        (${pythonLiteral(asset.id)}, ${renpyText(asset.caption)}, ${pythonLiteral(asset.path.replaceAll('\\', '/'))}),`).join('\n');
  const menuData = (kind: 'chapterList' | 'flowchart') => storyMenuEntries(project, kind).map(entry => `        (${pythonLiteral(entry.id)}, ${renpyText(entry.name)}, ${pythonLiteral(entry.nodeId ? `vn_node_${entry.nodeId}` : '')}),`).join('\n');
  const chapterEntries = menuData('chapterList');
  const flowEntries = menuData('flowchart');
  const customActions = new Set(components.filter(component => component.page === 'main' && component.kind === 'button').map(component => component.action));
  const bindings = new Set(components.filter(component => component.kind === 'text').map(component => component.binding));
  const customChoiceList = components.some(component => component.page === 'choice' && component.kind === 'choiceList');
  const customSaveSlots = components.some(component => component.page === 'save' && component.kind === 'saveSlots');
  const customPreferences = new Set(components.filter(component => component.page === 'preferences' && component.kind === 'preference').map(component => component.preference));
  const customPreferenceActions = new Set(components.filter(component => component.page === 'preferences' && component.kind === 'button').map(component => component.action));
  const fullyCustomPreferences = ui.pages?.preferences?.layout === 'custom' || replacesStandardPreferences(components);
  const preferenceLabelHeight = Math.ceil(menuFs * 1.4);
  const preferenceControl = (key: keyof typeof preferenceControls) => customPreferences.has(key) ?
    `        null height ${preferenceLabelHeight + 38}` :
    `        label ${renpyText(preferenceControls[key].title)} ysize ${preferenceLabelHeight}\n        bar value VnPreferenceValue(${pythonLiteral(key)}) style "slider"`;
  const preferenceButton = (key: NonNullable<UiComponent['action']>, text: string, indent = '        ') => {
    const buttonWidth = text.length * menuFs + 24;
    const buttonHeight = preferenceLabelHeight + 16;
    return customPreferenceActions.has(key) ? `${indent}null width ${buttonWidth} height ${buttonHeight}` :
      `${indent}textbutton ${renpyText(text)} action ${componentActions[key]} xysize (${buttonWidth}, ${buttonHeight})`;
  };
  const preferenceChoices = standardPreferenceChoices.map(group => [
    `        label ${renpyText(group.title)}`,
    `        ${group.preference === 'windowSize' ? 'grid 2 2:' : 'hbox:'}`,
    '            spacing 8',
    ...group.options.map((option, index) => {
      const size = `xysize (${option.label.length * smallFs + 24}, ${Math.ceil(smallFs * 1.4) + 16})`;
      return components.some(component => component.page === 'preferences' && replacesPreferenceOption(component, group.preference, option.value)) ?
        `            null ${size}` :
        `            textbutton ${renpyText(option.label)} action VnSetPreference(${pythonLiteral(group.preference)}, ${pythonLiteral(option.value)}) style "vn_small_button" ${size} id "vn_preference_${group.preference}_${index}"`;
    }),
  ].join('\n')).join('\n');
  const customVoiceCharacters = components.filter(component => component.page === 'voiceSettings' && component.kind === 'preference' && component.preference === 'characterVolume').map(component => component.preferenceCharacterId ?? '');
  const mainButtons: [UiComponent['action'], string][] = [['start', '开始游戏'], ['load', '读取存档'], ['preferences', '设置'], ['gallery', '画廊'], ['music', '音乐'], ['quit', '退出游戏']];
  const mainNavigation = mainButtons.map(([action, title]) => customActions.has(action) ?
    `        null width ${Math.min(260, contentWidth)} height ${mainButtonHeight}` :
    `        textbutton ${pythonLiteral(title)} action ${componentActions[action!]} xsize ${Math.min(260, contentWidth)} ysize ${mainButtonHeight} text_size ${mainButtonFont} id ${pythonLiteral(`vn_main_${action}`)}`).join('\n');

  const generated = `# Generated player screens. All paths resolve inside the exported game.

default quick_menu = True
default vn_interface_visible = True
default vn_retained_dialogue = None

init -10 python:
    # SourceHanSansLite omits these Latin glyphs. Use Ren'Py's bundled font
    # for the missing characters while retaining its CJK and punctuation.
    vn_default_font = FontGroup()
    for start, end in [(0x00a1, 0x00a4), (0x00a6, 0x00a8), (0x00aa, 0x00ac),
                       (0x00ae, 0x00af), (0x00b1, 0x00d6), (0x00d8, 0x00f6),
                       (0x00f8, 0x024f)]:
        vn_default_font.add("DejaVuSans.ttf", start, end)
    vn_default_font.add("fonts/SourceHanSansLite.ttf", None, None)
    config.font_name_map["fonts/SourceHanSansLite.ttf"] = vn_default_font

init python:
    def vn_keep_dialogue():
        global vn_retained_dialogue
        last = renpy.last_say()
        vn_retained_dialogue = (getattr(last.who, "name", None), last.what)

    def vn_empty_window():
        if vn_interface_visible and not vn_performance_active and vn_retained_dialogue is not None:
            # Retain the previous words only for this interaction. Reusing a
            # persistent say screen carries the stage wait into the next
            # sentence's typewriter clock.
            renpy.show_screen("say", who=vn_retained_dialogue[0], what=vn_retained_dialogue[1], _transient=True)
        else:
            _default_empty_window()

    config.empty_window = vn_empty_window

    def vn_set_interface_visible(visible):
        global vn_interface_visible
        vn_interface_visible = bool(visible)
        if vn_interface_visible:
            _window_show(trans=None)
        else:
            _window_hide(trans=None)

    if "quick_menu" not in config.overlay_screens:
        config.overlay_screens.append("quick_menu")
    # Standard Ren'Py actions read layout; retain the previous gui aliases.
    layout.ARE_YOU_SURE = gui.ARE_YOU_SURE = "确认继续吗？"
    layout.DELETE_SAVE = gui.DELETE_SAVE = "确认删除这个存档吗？"
    layout.OVERWRITE_SAVE = gui.OVERWRITE_SAVE = "确认覆盖这个存档吗？"
    layout.LOADING = gui.LOADING = "读取存档后，尚未保存的进度将丢失。确认读取吗？"
    layout.QUIT = gui.QUIT = "确认退出游戏吗？"
    layout.MAIN_MENU = gui.MAIN_MENU = "返回标题后，尚未保存的进度将丢失。确认返回吗？"
    layout.CONTINUE = gui.CONTINUE = "继续上次的游戏吗？"
    layout.END_REPLAY = gui.END_REPLAY = "确认结束回放吗？"
    layout.SLOW_SKIP = gui.SLOW_SKIP = "确认开始跳过对话吗？"
    layout.FAST_SKIP_SEEN = gui.FAST_SKIP_SEEN = "确认跳到下一个选择吗？"
    layout.FAST_SKIP_UNSEEN = gui.FAST_SKIP_UNSEEN = "确认跳过未读对话并到达下一个选择吗？"
    gui.UNKNOWN_TOKEN = "这个存档来自另一台设备。请仅在信任存档来源时继续读取。"
    gui.TRUST_TOKEN = "确认信任创建此存档的设备吗？"
    vn_gallery_entries = [
${galleryData}
    ]
    vn_music_entries = [
${musicData}
    ]
    vn_voice_entries = [
${voiceEntries}
    ]
    vn_chapter_entries = [
${chapterEntries}
    ]
    vn_flow_entries = [
${flowEntries}
    ]
    renpy.music.register_channel("vn_musicroom", mixer="music", loop=True)
    vn_music_room = MusicRoom(channel="vn_musicroom", fadeout=0.3, fadein=0.3)
    for vn_track_name, vn_track_path in vn_music_entries:
        vn_music_room.add(vn_track_path)

    def vn_password_matches(actual, expected, case_sensitive):
        if case_sensitive:
            return actual == expected
        return actual.casefold() == expected.casefold()

style default:
    font ${pythonLiteral(fontPath)}
    size ${fs}
    color ${pythonLiteral(ui.textColor)}
    language "unicode"

style button:
    background Solid("#283133")
    hover_background Solid(${pythonLiteral(ui.accent)})
    selected_background Solid(${pythonLiteral(ui.accent)})
    insensitive_background Solid("#22282a")
    padding (12, 8)

style button_text:
    size ${menuFs}
    color ${pythonLiteral(ui.textColor)}
    hover_color "#ffffff"
    selected_color "#ffffff"
    insensitive_color "#737d80"
    yalign 0.5

style label_text:
    size ${menuFs}
    color ${pythonLiteral(ui.accent)}

style frame:
    background None
    padding (0, 0)

style window:
    background None
    padding (0, 0)

style input:
    color ${pythonLiteral(ui.textColor)}
    size ${fs}

style bar:
    ysize 16
    left_bar Solid(${pythonLiteral(ui.accent)})
    right_bar Solid("#354044")
    thumb Solid("#edf5f3", xsize=12, ysize=22)

style slider is bar
style slider:
    xsize ${Math.min(450, contentWidth)}
    ysize 20

style scrollbar:
    ysize 10
    base_bar Solid("#22282a")
    thumb Solid(${pythonLiteral(ui.accent)})

style vscrollbar:
    xsize 10
    base_bar Solid("#22282a")
    thumb Solid(${pythonLiteral(ui.accent)})

style vn_small_button is button
style vn_small_button:
    padding (6, 6)

style vn_small_button_text is button_text
style vn_small_button_text:
    size ${smallFs}

screen main_menu():
    tag menu
${customMain ? '    use vn_page_background("main")' : `    add Solid(${pythonLiteral(ui.background)})
${menuImage ? `    add Transform(${pythonLiteral(menuImage.path.replaceAll('\\', '/'))}, xysize=(${w}, ${h}), fit="cover")` : ''}
    add Solid("#00000070")
${bindings.has('title') ? '' : `    text ${renpyText(project.name)} xpos ${margin} ypos ${Math.round(h * 0.085)} xsize ${contentWidth} size ${Math.min(48, Math.max(28, fs + 8))} outlines [(2, "#00000080", 0, 1)]`}
    vbox:
        xpos ${margin}
        yalign 0.82
        spacing 8
${mainNavigation || '        pass'}
    text ${renpyText(project.version)} xalign 0.97 yalign 0.96 size ${smallFs}`}
    use vn_components_main

screen say(who, what):
    if vn_interface_visible and not vn_performance_active:
${(customSay ? '    window:\n        id "window"\n        background None\n        null' : `    window:
        id "window"
        yalign 1.0
        yoffset -${quickHeight}
        xfill True
        ysize ${dialogueHeight}
        background ${bindings.has('speaker') && bindings.has('dialogue') ? 'None' : `Transform(Solid(${pythonLiteral(dialogueColor)}), alpha=vn_preference_get("dialogueOpacity"))`}
        vbox:
            xpos ${margin}
            ypos 16
            xsize ${contentWidth}
            spacing 8
${bindings.has('speaker') ? '' : `            if who is not None:\n                text who id "who" color ${pythonLiteral(ui.accent)} size ${Math.min(fs, 30)}`}
${bindings.has('dialogue') ? '' : `            vn_dialogue_text what id "what" size ${fs} xsize ${contentWidth} line_spacing 5`}
${bindings.has('speaker') && bindings.has('dialogue') ? '            pass' : ''}`).split('\n').map(line => '    ' + line).join('\n')}
        use vn_components_say(who, what)
    else:
        # Character still needs its Text object to manage voice, skipping and
        # dialogue advancement while the authored interface is hidden.
        vn_dialogue_text what id "what" color "#00000000" size 1

screen choice(items):
${customChoiceList ? '' : `    vbox:
        xalign 0.5
        yalign 0.45
        xsize ${Math.min(760, contentWidth)}
        spacing 12
        for item in items:
            button:
                action item.action
                xfill True
                padding (20, 14)
                text item.caption xalign 0.5 text_align 0.5`}
    use vn_components_choice(items)

screen vn_choice_items(items, area_width, area_height, font_size, text_color, surface, alignment, component_id, skin={}, font="fonts/SourceHanSansLite.ttf", options={}):
    $ gap = max(0, int(options.get("gapY", 10)))
    $ item_height = max(32, int(options.get("itemHeight", max(font_size + 24, min(80, int((area_height - gap * max(0, len(items) - 1)) / max(1, len(items))))))))
    $ overflow = item_height * len(items) + gap * max(0, len(items) - 1) > area_height
    $ item_width = max(1, area_width - (18 if overflow else 0))
    $ caption = vn_ui_rect(options["caption"], item_width, item_height) if options.get("caption") else (12, 6, max(1, item_width - 24), max(1, item_height - 12))
    viewport:
        id (component_id + "_viewport")
        xysize (area_width, area_height)
        mousewheel True
        draggable True
        scrollbars ("vertical" if overflow else None)
        vbox:
            xsize item_width
            spacing gap
            for index, item in enumerate(items):
                vn_skin_button:
                    id (component_id + "_choice_%d" % index)
                    action item.action
                    xysize (item_width, item_height)
                    padding (0, 0)
                    background vn_ui_surface(skin, "idle", item_width, item_height, surface)
                    hover_background vn_ui_surface(skin, "hover", item_width, item_height, "#586157")
                    activate_background vn_ui_surface(skin, "pressed", item_width, item_height, "#344638")
                    fixed:
                        pos (caption[0], caption[1])
                        xysize (caption[2], caption[3])
                        text item.caption id (component_id + "_caption_%d" % index) font font color text_color size min(font_size, item_height - 12) xmaximum caption[2] text_align alignment xalign alignment yalign 0.5

screen quick_menu():
    zorder 100
    if quick_menu and vn_interface_visible and not vn_performance_active and not main_menu${ui.pages?.say?.showQuickMenu === false ? ' and False' : ''}:
        frame:
            yalign 1.0
            xfill True
            ysize ${quickHeight}
            background Solid("#101719f0")
            hbox:
                xalign 0.5
                yalign 0.5
                spacing 5
                style_prefix "vn_small"
                textbutton "回退" action Rollback()
                textbutton "历史" action ShowMenu("history")
                textbutton "跳过" action VnSkip() alternate VnSkip(fast=True, confirm=True)
                textbutton "自动" action Preference("auto-forward", "toggle")
                textbutton "存档" action ShowMenu("save")
                textbutton "读档" action ShowMenu("load")
                textbutton "设置" action ShowMenu("preferences")

screen vn_game_menu(title, scroll=False, page=None, return_action=None):
    use vn_page_background(page)
    if vn_ui_pages.get(page, {}).get("layout") != "custom":
        vbox:
            xpos ${margin}
            ypos 22
            xsize ${contentWidth}
            ysize ${h - 44}
            spacing 18
            hbox:
                xfill True
                text title size ${Math.min(32, fs + 4)} yalign 0.5
                textbutton ("返回设置" if return_action else "返回" if vn_bp_menu_active else "返回标题" if main_menu else "返回游戏"):
                    action (return_action or ${componentActions.return})
                    id "vn_game_menu_return"
                    xalign 1.0
                    style "vn_small_button"
            hbox:
                spacing 5
                style_prefix "vn_small"
                textbutton "存档" action ShowMenu("save") sensitive not main_menu
                textbutton "读档" action ShowMenu("load")
                textbutton "设置" action ShowMenu("preferences")
                textbutton "历史" action ShowMenu("history") sensitive not main_menu
                textbutton "画廊" action ShowMenu("gallery")
                textbutton "音乐" action ShowMenu("music_room")
                textbutton "标题" action MainMenu()
            frame:
                xfill True
                yfill True
                if page in vn_ui_replaced_pages:
                    null
                elif scroll:
                    viewport:
                        scrollbars "vertical"
                        mousewheel True
                        draggable True
                        pagekeys True
                        vbox:
                            xsize ${contentWidth - 18}
                            spacing 18
                            transclude
                else:
                    transclude
    key "game_menu" action ${componentActions.return}
    key "mouseup_3" action ${componentActions.return}

screen save():
    tag menu
${customSaveSlots ? '    use vn_game_menu("存档", page="save"):\n        pass' : '    use vn_slots("存档")'}
    use vn_components_save

screen load():
    tag menu
${customSaveSlots ? '    use vn_game_menu("读档", page="save"):\n        pass' : '    use vn_slots("读档")'}
    use vn_components_save

screen vn_slots(title):
    use vn_game_menu(title, page="save"):
        vbox:
            spacing 12
            hbox:
                spacing 5
                style_prefix "vn_small"
                textbutton "上一页" action FilePagePrevious()
                textbutton "自动" action FilePage("auto")
                textbutton "快速" action FilePage("quick")
                for page in range(1, 7):
                    textbutton str(page) action FilePage(page)
                textbutton "下一页" action FilePageNext()
            grid 3 2:
                spacing 12
                for slot in range(1, 7):
                    frame:
                        xysize (${slotWidth}, ${slotHeight})
                        background Solid("#222a2d")
                        vbox:
                            spacing 3
                            button:
                                id ("vn_file_slot_%d" % slot)
                                action FileAction(slot)
                                xsize ${slotWidth}
                                padding (4, 4)
                                add FileScreenshot(slot) xysize (${slotWidth - 8}, ${thumbnailHeight})
                            hbox:
                                xsize ${slotWidth}
                                text FileTime(slot, format="%Y-%m-%d %H:%M", empty="空存档") size ${Math.min(15, smallFs)} yalign 0.5
                                textbutton "删除" action FileDelete(slot, confirm=True) style "vn_small_button" xalign 1.0

screen vn_slot_grid(area_width, area_height, font_size, text_color, surface):
    $ gap = max(2, min(10, int(area_width / 100)))
    $ navigation_height = max(24, min(38, int(area_height * 0.12)))
    $ navigation_width = max(1, int((area_width - 9 * gap) / 10))
    $ navigation_font = max(8, min(18, font_size, int(navigation_width / 3)))
    $ slot_width = max(1, int((area_width - 2 * gap) / 3))
    $ slot_height = max(1, int((area_height - navigation_height - 2 * gap) / 2))
    $ caption_height = max(18, min(30, int(slot_height * 0.25)))
    $ delete_width = max(1, min(54, int(slot_width / 3)))
    $ caption_font = max(8, min(15, font_size, int((slot_width - delete_width) / 16)))
    vbox:
        xysize (area_width, area_height)
        spacing gap
        hbox:
            spacing gap
            for caption, action in [("上一页", FilePagePrevious()), ("自动", FilePage("auto")), ("快速", FilePage("quick"))] + [(str(page), FilePage(page)) for page in range(1, 7)] + [("下一页", FilePageNext())]:
                textbutton caption action action xysize (navigation_width, navigation_height) padding (2, 2) text_size navigation_font text_color text_color background Solid(surface)
        grid 3 2:
            spacing gap
            for slot in range(1, 7):
                frame:
                    xysize (slot_width, slot_height)
                    background Solid(surface)
                    vbox:
                        button:
                            id ("vn_file_slot_%d" % slot)
                            action FileAction(slot)
                            xysize (slot_width, max(1, slot_height - caption_height))
                            padding (4, 4)
                            add FileScreenshot(slot) xysize (max(1, slot_width - 8), max(1, slot_height - caption_height - 8))
                        hbox:
                            xysize (slot_width, caption_height)
                            text FileTime(slot, format="%Y-%m-%d %H:%M", empty="空存档") xsize (slot_width - delete_width) size caption_font color text_color yalign 0.5
                            textbutton "删除" action FileDelete(slot, confirm=True) xysize (delete_width, caption_height) padding (2, 2) text_size min(14, font_size) text_color text_color

screen preferences():
    tag menu
${fullyCustomPreferences ? '    use vn_game_menu("设置", page="preferences"):\n        pass' : `    use vn_game_menu("设置", scroll=True, page="preferences"):
${customPreferenceActions.has('window') && customPreferenceActions.has('fullscreen') ? `        null height ${preferenceLabelHeight}` : `        label "显示" ysize ${preferenceLabelHeight}`}
        hbox:
            spacing 10
${preferenceButton('window', '窗口', '            ')}
${preferenceButton('fullscreen', '全屏', '            ')}
            pass
${preferenceControl('textSpeed')}
${preferenceControl('autoForwardTime')}
${customPreferenceActions.has('skipSeen') && customPreferenceActions.has('skipAll') ? `        null height ${preferenceLabelHeight}` : `        label "跳过范围" ysize ${preferenceLabelHeight}`}
        hbox:
            spacing 10
${preferenceButton('skipSeen', '已读文本', '            ')}
${preferenceButton('skipAll', '全部文本', '            ')}
            pass
${preferenceButton('transitions', '跳过转场')}
${preferenceControl('musicVolume')}
${preferenceControl('soundVolume')}
${preferenceControl('voiceVolume')}
${preferenceButton('mute', '全部静音')}
${preferenceControl('masterVolume')}
${preferenceControl('ambientVolume')}
${preferenceControl('dialogueOpacity')}
${preferenceButton('voiceSettings', '角色音量')}
${preferenceChoices}
        use vn_parameter_settings(${pythonLiteral(components.filter(component => component.page === 'preferences' && component.parameterId).map(component => component.parameterId))}, width=${contentWidth - 30}, font_size=${menuFs}, color=${pythonLiteral(ui.textColor)})
${preferenceButton('resetPreferences', '恢复初始设置')}`}
    use vn_components_preferences
${fullyCustomPreferences ? `    if vn_parameter_unplaced(${pythonLiteral(components.filter(component => component.page === 'preferences' && component.parameterId).map(component => component.parameterId))}):
        textbutton "更多设置" action ShowMenu("vn_parameter_settings_menu") xalign 0.97 yalign 0.97 text_size ${menuFs}` : ''}

screen vn_parameter_settings_menu():
    tag menu
    use vn_game_menu("更多设置", scroll=True, return_action=ShowMenu("preferences")):
        use vn_parameter_settings(${pythonLiteral(components.filter(component => component.page === 'preferences' && component.parameterId).map(component => component.parameterId))}, width=${contentWidth - 30}, font_size=${menuFs}, color=${pythonLiteral(ui.textColor)})

screen voice_settings():
    tag menu
    use vn_game_menu("角色音量", scroll=True, page="voiceSettings", return_action=ShowMenu("preferences")):
        for character_id, character_name in vn_voice_characters:
            if character_id not in ${pythonLiteral(customVoiceCharacters)}:
                label character_name
                bar value VnPreferenceValue("characterVolume", character_id) style "slider" id ("vn_character_volume_" + (character_id or "other"))
    use vn_components_voiceSettings

screen history():
    tag menu
    predict False
    on "hide" action Stop("vn_replayvoice")
    on "replaced" action Stop("vn_replayvoice")
    use vn_game_menu("历史", scroll=True, page="history"):
        if not _history_list:
            text "暂无对话记录" size ${menuFs}
        for entry in _history_list:
            vbox:
                spacing 6
                if entry.who:
                    text entry.who color entry.who_args.get("color", ${pythonLiteral(ui.accent)}) size ${menuFs}
                text entry.what substitute False size ${menuFs} xmaximum ${contentWidth - 30}
                if getattr(getattr(entry, "voice", None), "filename", None):
                    hbox:
                        spacing 15
                        textbutton "重播语音" action VnReplayVoice(entry.voice.filename, vn_capture_history_voice(entry)) id ("vn_history_replay_" + str(_history_list.index(entry)))
                        textbutton ("取消收藏" if VnFavoriteVoice(entry.voice.filename, vn_capture_history_voice(entry)).get_selected() else "收藏语音") action VnFavoriteVoice(entry.voice.filename, vn_capture_history_voice(entry)) id ("vn_history_favorite_" + str(_history_list.index(entry)))
            null height 12
    use vn_components_history

screen gallery():
    tag menu
    use vn_game_menu("画廊", scroll=True, page="gallery"):
        if not vn_gallery_entries:
            text "暂无图片" size ${menuFs}
        else:
            vpgrid:
                cols 3
                spacing 12
                for asset_id, asset_name, asset_path in vn_gallery_entries:
                    button:
                        id ("vn_gallery_%s" % asset_id)
                        xysize (${slotWidth - 6}, ${Math.max(120, Math.round(h * 0.25))})
                        action Show("vn_gallery_image", asset_path=asset_path)
                        sensitive asset_id in persistent.vn_unlocks
                        vbox:
                            spacing 6
                            if asset_id in persistent.vn_unlocks:
                                add Transform(asset_path, xysize=(${slotWidth - 30}, ${Math.max(50, Math.round(h * 0.25) - 54)}), fit="contain")
                                text asset_name size ${smallFs} xmaximum ${slotWidth - 30}
                            else:
                                text "未解锁" size ${menuFs} xalign 0.5
    use vn_components_gallery

screen vn_gallery_image(asset_path=None, asset_paths=None, fit="contain", end_action="close", show_controls=True):
    default gallery_variant = 0
    modal True
    zorder 250
    $ paths = asset_paths if asset_paths is not None else ([asset_path] if asset_path else [])
    $ active_variant = min(gallery_variant, max(0, len(paths) - 1))
    $ next_variant = SetScreenVariable("gallery_variant", active_variant + 1) if active_variant + 1 < len(paths) else (SetScreenVariable("gallery_variant", 0) if end_action == "loop" and paths else Hide("vn_gallery_image"))
    add Solid("#080b0df5")
    button:
        background None
        hover_background None
        xfill True
        yfill True
        id "vn_gallery_advance"
        padding (0, 0)
        action next_variant
        if paths:
            add vn_gallery_thumbnail(paths[active_variant], ${w}, ${h}, fit) xalign 0.5 yalign 0.5 id "vn_gallery_full_image"
    if show_controls:
        textbutton "关闭" id "vn_gallery_close" action Hide("vn_gallery_image") xalign 0.97 yalign 0.03
        if len(paths) > 1:
            hbox:
                align (0.5, 0.96)
                spacing 24
                textbutton "上一张" id "vn_gallery_previous" action SetScreenVariable("gallery_variant", max(0, active_variant - 1)) sensitive active_variant > 0
                text ("%d / %d" % (active_variant + 1, len(paths))) yalign 0.5
                textbutton "下一张" id "vn_gallery_next" action next_variant
    key "K_RIGHT" action next_variant
    key "K_LEFT" action SetScreenVariable("gallery_variant", max(0, active_variant - 1))
    key "game_menu" action Hide("vn_gallery_image")
    key "mouseup_3" action [Hide("vn_gallery_image"), ${componentActions.return}]

screen music_room():
    tag menu
    default original_pause = renpy.music.get_pause(channel="music")
    on "show" action Function(renpy.music.set_pause, True, channel="music")
    on "replace" action Function(renpy.music.set_pause, True, channel="music")
    on "hide" action [vn_music_room.Stop(), Function(renpy.music.set_pause, original_pause, channel="music")]
    on "replaced" action [vn_music_room.Stop(), Function(renpy.music.set_pause, original_pause, channel="music")]
    use vn_game_menu("音乐", scroll=True, page="musicRoom"):
        if not vn_music_entries:
            text "暂无音乐" size ${menuFs}
        else:
            hbox:
                spacing 10
                textbutton "上一首" action vn_music_room.Previous()
                textbutton "播放 / 暂停" action vn_music_room.TogglePause()
                textbutton "下一首" action vn_music_room.Next()
                textbutton "停止" action vn_music_room.Stop()
            hbox:
                spacing 10
                textbutton "循环" action vn_music_room.ToggleLoop()
                textbutton "随机" action vn_music_room.ToggleShuffle()
            for track_name, track_path in vn_music_entries:
                textbutton (track_name if vn_music_room.is_unlocked(track_path) else "未解锁"):
                    action vn_music_room.Play(track_path)
                    xfill True
    use vn_components_musicRoom

screen pause_menu():
    tag menu
    use vn_game_menu("暂停菜单", page="pause"):
        vbox:
            spacing 12
            textbutton "继续游戏" action Return()
            textbutton "保存进度" action ShowMenu("save")
            textbutton "设置" action ShowMenu("preferences")
            textbutton "返回标题" action MainMenu()
    use vn_components_pause

screen chapter_select():
    tag menu
    use vn_game_menu("章节选择", scroll=True, page="chapterSelect"):
        if not vn_chapter_entries:
            text "暂无章节" size ${menuFs}
        else:
            vbox:
                spacing 8
                for chapter_id, chapter_name, chapter_label in vn_chapter_entries:
                    textbutton chapter_name:
                        if chapter_label:
                            action VnStoryStart("chapterList", chapter_id, chapter_label, chapter_name)
                        else:
                            action NullAction()
                        xfill True
    use vn_components_chapterSelect

screen voice_collection():
    tag menu
    on "hide" action Stop("vn_replayvoice")
    on "replaced" action Stop("vn_replayvoice")
    use vn_game_menu("语音收藏", page="voiceCollection"):
        use vn_collection("voiceCollection", ${contentWidth - 36}, ${Math.max(100, h - 230)}, ${menuFs}, ${pythonLiteral(ui.textColor)}, "#283133", {}, {"favoritesOnly": True}, "vn_voice_collection", ${pythonLiteral(fontPath)})
    use vn_components_voiceCollection

screen flowchart():
    tag menu
    use vn_game_menu("剧情流程图", scroll=True, page="flowchart"):
        if not vn_flow_entries:
            text "暂无流程节点" size ${menuFs}
        else:
            vbox:
                spacing 5
                for node_id, node_name, node_label in vn_flow_entries:
                    textbutton node_name action VnStoryStart("flowchart", node_id, node_label, node_name) xfill True
    use vn_components_flowchart

screen staff_roll():
    tag menu
    use vn_game_menu("制作人员", scroll=True, page="staff"):
        text "制作人员名单可由组件实例自定义。" size ${menuFs}
    use vn_components_staff

screen confirm(message, yes_action, no_action):
    modal True
    zorder 200
${ui.pages?.messageBox?.layout === 'custom' ? `    use vn_page_background("messageBox")
    use vn_components_messageBox(message, yes_action, no_action)` : `
    add Solid("#000000aa")
    frame:
        xalign 0.5
        yalign 0.5
        xsize ${Math.min(720, contentWidth)}
        padding (24, 24)
        background Solid(${pythonLiteral(ui.background)})
        vbox:
            spacing 24
            text _(message) size ${menuFs} xmaximum ${Math.min(672, contentWidth - 48)}
            hbox:
                spacing 20
                textbutton "确认" action yes_action
                textbutton "取消" action no_action`}
    key "game_menu" action no_action

screen input(prompt):
    window:
        yalign 1.0
        ysize ${dialogueHeight}
        background Solid(${pythonLiteral(dialogueColor)})
        vbox:
            xpos ${margin}
            ypos 18
            xsize ${contentWidth}
            spacing 12
            text prompt
            input id "input"

screen notify(message):
    zorder 150
    frame:
        xalign 0.5
        yalign 0.08
        padding (16, 10)
        background Solid("#14201ff0")
        text message size ${menuFs}
    timer 3.0 action Hide("notify")

screen skip_indicator():
    zorder 100
    text "跳过中" xpos 20 ypos 20 size ${smallFs} color "#ffffff" outlines [(2, "#000000", 0, 0)]

screen vn_interaction(prompt, hotspots, timeout_seconds=0, show_hints=True):
    modal True
    zorder 50
    for hotspot in hotspots:
        button:
            id ("vn_hotspot_" + hotspot["id"])
            xpos int(hotspot["x"] * ${w})
            ypos int(hotspot["y"] * ${h})
            xysize (max(1, int(hotspot["width"] * ${w})), max(1, int(hotspot["height"] * ${h})))
            background (Solid("#ffffff22") if show_hints else None)
            hover_background Solid("#ffffff44")
            action Return(hotspot["id"])
            if show_hints:
                text hotspot["name"] substitute False size ${smallFs} xalign 0.5 yalign 0.5 text_align 0.5
    frame:
        xpos ${margin}
        ypos 18
        xsize ${contentWidth}
        padding (14, 10)
        background Solid("#101719dd")
        hbox:
            spacing 16
            text prompt size ${menuFs} xmaximum ${contentWidth - 150}
            textbutton "取消" action Return("cancel") style "vn_small_button" id "vn_interaction_cancel"
    if timeout_seconds > 0:
        timer 0.1 repeat True action If(vn_interaction_remaining <= 0.1, Return("timeout"), SetVariable("vn_interaction_remaining", vn_interaction_remaining - 0.1))
    key "game_menu" action Return("cancel")

screen vn_minigame_password(title, prompt, password, case_sensitive=False):
    modal True
    zorder 50
${ui.pages?.keyboard?.layout === 'custom' ? '    use vn_page_background("keyboard")' : '    add Solid("#080b0dcc")'}
    frame:
        xalign 0.5
        yalign 0.5
        xsize ${Math.min(680, contentWidth)}
        padding (28, 28)
        background Solid(${pythonLiteral(ui.background)})
        vbox:
            spacing 20
            text title size ${fs} color ${pythonLiteral(ui.accent)}
            text prompt size ${fs} xmaximum ${Math.min(624, contentWidth - 56)}
            text ("剩余次数：%d" % vn_minigame_remaining) size ${smallFs}
            input value VariableInputValue("vn_minigame_answer") length 128 id "vn_minigame_input"
            hbox:
                spacing 14
                textbutton "提交":
                    id "vn_minigame_submit"
                    action If(vn_password_matches(vn_minigame_answer, password, case_sensitive), Return("success"), [SetVariable("vn_minigame_remaining", vn_minigame_remaining - 1), SetVariable("vn_minigame_answer", ""), If(vn_minigame_remaining <= 1, Return("failure"), NullAction())])
                textbutton "取消" action Return("cancel") id "vn_minigame_cancel"
    key "game_menu" action Return("cancel")

screen vn_minigame_timed_clicks(title, prompt, target_clicks):
    modal True
    zorder 50
${ui.pages?.keyboard?.layout === 'custom' ? '    use vn_page_background("keyboard")' : '    add Solid("#080b0dcc")'}
    frame:
        xalign 0.5
        yalign 0.5
        xsize ${Math.min(680, contentWidth)}
        padding (28, 28)
        background Solid(${pythonLiteral(ui.background)})
        vbox:
            spacing 20
            text title size ${fs} color ${pythonLiteral(ui.accent)}
            text prompt size ${fs} xmaximum ${Math.min(624, contentWidth - 56)}
            text ("进度：%d / %d" % (vn_minigame_clicks, target_clicks)) size ${menuFs}
            text ("剩余：%.1f 秒" % vn_minigame_time_left) size ${smallFs}
            textbutton "点击":
                id "vn_minigame_click"
                xysize (220, 100)
                xalign 0.5
                action If(vn_minigame_clicks + 1 >= target_clicks, Return("success"), SetVariable("vn_minigame_clicks", vn_minigame_clicks + 1))
            textbutton "取消" action Return("cancel") id "vn_minigame_cancel"
    timer 0.1 repeat True action If(vn_minigame_time_left <= 0.1, Return("failure"), SetVariable("vn_minigame_time_left", vn_minigame_time_left - 0.1))
    key "game_menu" action Return("cancel")

screen vn_chapter_title(title, subtitle="", duration=2.5, effect=None, background=None, title_image=None, _vn_wait=True, _vn_allow_click=None, _vn_layer="screens"):
    # Screen properties run before parameter binding; supplied arguments are in _kwargs.
    modal _kwargs.get("_vn_wait", True)
    zorder 80
    default can_dismiss = False
    $ effect = effect or ${pythonLiteral(ui.chapterTransition?.effect ?? 'fade')}
    $ duration = max(0.01, duration)
    $ background = background or ${pythonLiteral(chapterBackground?.path.replaceAll('\\', '/'))}
    fixed:
        xysize (${w}, ${h})
        at vn_chapter_presence(duration, effect)
        add Solid("#000000")
        if background:
            add Transform(background, xysize=(${w}, ${h}), fit="cover") at vn_chapter_background(duration, effect)
        else:
            add Solid("#0b1017")
${chapterOverlay ? `        if effect == "ink":
            add ${chapterMask ? `AlphaMask(Transform(${pythonLiteral(chapterOverlay.path.replaceAll('\\', '/'))}, xysize=(${w}, ${h})), Transform(${pythonLiteral(chapterMask.path.replaceAll('\\', '/'))}, xysize=(${w}, ${h})))` : `Transform(${pythonLiteral(chapterOverlay.path.replaceAll('\\', '/'))}, xysize=(${w}, ${h}))`}` : ''}
${ui.pages?.chapterTitle?.layout === 'custom' ? '        use vn_components_chapterTitle(title, subtitle, effect, duration, title_image)' : `        vbox:
            xalign 0.5
            yalign 0.5
            xsize ${Math.round(w * 0.8)}
            spacing 12
            at vn_chapter_letters(effect, duration)
            if title_image:
                add Transform(title_image, xysize=(${Math.round(w * 0.7)}, ${Math.round(h * 0.16)}), fit="contain") xalign 0.5
            else:
                text title size ${Math.min(56, Math.max(28, fs + 12))} color ${pythonLiteral(ui.accent)} xalign 0.5 text_align 0.5
            if subtitle and not title_image:
                text subtitle size ${Math.min(28, Math.max(16, menuFs))} color ${pythonLiteral(ui.textColor)} xalign 0.5 text_align 0.5`}
${ui.chapterTransition?.particles === false ? '' : `        if effect == "ink":
            for particle in vn_chapter_particles_for(title_image, title):
                add Solid(${pythonLiteral(ui.chapterTransition?.particleColor ?? "#ffffff")}, xsize=max(1, int(particle["pixels"])), ysize=max(1, int(particle["pixels"]))):
                    at vn_chapter_particle_motion(particle, duration)`}
    timer (min(0.3, duration * 0.1)) action SetScreenVariable("can_dismiss", True)
    timer duration action (Return(True) if _vn_wait else Hide("vn_chapter_title", _layer=_vn_layer))
    timer 0.05 repeat True action If(renpy.is_skipping(), (Return(True) if _vn_wait else Hide("vn_chapter_title", _layer=_vn_layer)), NullAction())
    if _vn_wait:
        key "dismiss" action If(can_dismiss and (_vn_allow_click if _vn_allow_click is not None else vn_performance_active and vn_performance_settings.get("clickSkip", False)), Return("click"), NullAction())

${createUiWidgets()}

${componentScreen(project, 'main')}

${componentScreen(project, 'say')}

${componentScreen(project, 'choice')}

${componentScreen(project, 'save')}

${componentScreen(project, 'preferences')}
${componentScreen(project, 'voiceSettings')}
${componentScreen(project, 'pause')}
${componentScreen(project, 'history')}
${componentScreen(project, 'gallery')}
${componentScreen(project, 'musicRoom')}
${componentScreen(project, 'voiceCollection')}
${componentScreen(project, 'chapterSelect')}
${componentScreen(project, 'chapterTitle')}
${componentScreen(project, 'messageBox')}
${componentScreen(project, 'staff')}
${componentScreen(project, 'keyboard')}
${componentScreen(project, 'flowchart')}
${componentScreen(project, 'gameOver')}

${customPageScreens(project)}
${visualObjectRuntime}
`;
  return omitDisabledUiScreens(generated, ui);
}
import { galleryLayout } from '../core/gallery-layout';
import { storyFlowLayout } from '../core/story-flow';
