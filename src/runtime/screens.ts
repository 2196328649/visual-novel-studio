import { createUiPageStyles } from './ui-page-styles';
import { uiPageTheme } from '../core/ui-page-settings';
import { uiPropertyApplies } from '../core/ui-properties';
import { isUiLayoutObservation } from '../core/ui-layout';
import { projectGraphs } from '../core/project-resources';
import { flowNodeAppearance } from '../core/flow-style';
import { uiAncestors } from '../core/ui-hierarchy';
import { isStandaloneNode } from '../core/standalone-performance';
import { omitDisabledUiScreens, uiActionAvailable } from '../core/ui-availability';
import { uiMainButtons, uiMenuButtons, uiQuickButtons, uiPauseButtons } from '../core/ui-page-catalog';
import { replacesMainButton } from '../core/ui-native-main';
import { musicRoomEntries } from '../core/music-preview';
import { uiEventInActiveInstance, uiGraphOnPage, uiClickHandlers, uiPageShowGraphIds, uiPageLifecycleHandlers } from '../core/ui-logic';
import { uiTextOutlines } from '../core/ui-text-effects';
import { visualObjectRuntime } from './visual-objects';
import { effectiveUiComponents, orderedUiComponents, sortUiComponents, type CustomUiPage, type Project, type UiComponent, type VariableValue } from '../core/model';
import { effectiveUiTheme } from '../core/model';
import { pythonBlockLiteral, pythonLiteral, renpyText } from './literals';
import { conditionExpression } from './expressions';
import { dialogueLayout, uiComponentBounds, uiComponentFontSize, uiTooltip } from '../core/ui';
import { componentSkinData, uiSkinData } from './ui-runtime';
import { playerPreferenceOptions, playerPreferences, preferenceInfo, replacesPreferenceOption, replacesStandardPreferences, standardPreferenceChoices, type PlayerPreference } from '../core/preferences';
import { createUiWidgets } from './ui-widgets';
import { componentActions } from './ui-actions';
import { storyMenuEntries, storyVoiceEntries } from '../core/story-menu';
import { playerFlowAllEntries, playerFlowGroups, playerFlowMode, playerFlowViews } from '../core/player-flow-content';
import { storyFlowConnections } from '../core/story-flow-connections';
import { galleryRuntimeEntries } from '../core/gallery';
export { pythonLiteral, renpyText } from './literals';

const pageScopeArgument = (pageId: string) => pageId ? `, page_id=${pythonLiteral(pageId)}` : '';
/** In-memory field resets must compile like the same project after a JSON save. */
function withoutUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(field => withoutUndefined(field)) as T;
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined).map(([key, field]) => [key, withoutUndefined(field)])) as T;
}

/** A player map owns its content; global story menus remain only the legacy fallback. */
export function playerFlowRuntimeData(project: Project, component: UiComponent) {
  const projected = playerFlowViews(project, component);
  const hasCalls = projected.hasCalls;
  const rootEntries = projected.root.entries;
  const graph = component.list?.layout === 'flow' || playerFlowMode(component) === 'custom' || hasCalls ? storyFlowLayout(project, component, undefined, projected.root) : undefined;
  // Script directories need the same hidden-node location mapping as a branch
  // map, but do not need node positions, connector geometry or a canvas extent.
  const locations = graph ? undefined : Object.fromEntries([...storyFlowConnections(project, rootEntries).locations].map(([id, location]) => [id, location.id]));
  const groups = (hasCalls ? [] : playerFlowGroups(component)).map(group => ({
    id: group.id, name: group.name,
    entries: projected.views.get(group.id)?.entries ?? [],
    graph: storyFlowLayout(project, component, group.id, projected.views.get(group.id)),
  }));
  const entries = new Map([...playerFlowAllEntries(project, component), ...rootEntries].map(entry => [entry.id, entry]));
  const tuple = (entry: typeof rootEntries[number]) => [entry.id, entry.name, entry.nodeId ? `vn_node_${entry.nodeId}` : ''];
  const views = hasCalls ? Object.fromEntries([...projected.views].map(([id, view]) => {
    for (const entry of view.entries) entries.set(entry.id, entry);
    return [id, { id, kind: view.kind, name: view.name, targetId: view.targetId, parentViewId: view.parentViewId,
      nodeIds: view.nodeIds, entries: view.entries.map(tuple), graph: storyFlowLayout(project, component, id, view) }];
  })) : undefined;
  return withoutUndefined({
    flowLooks: Object.fromEntries([...entries.values()].map(entry => {
      const node = project.nodes.find(item => item.id === entry.nodeId);
      const look = flowNodeAppearance(project, component, { ...entry, kind: node && isStandaloneNode(node) ? 'chapterTitle' : node?.kind });
      return [entry.id, {
        node: entry,
        skin: componentSkinData(project, look), style: look.style,
        textOutlines: uiTextOutlines(look, false),
        captionParts: look.style?.captionParts?.map(part => ({
          size: part.fontSize, color: part.color, gap: part.gap, letterSpacing: part.letterSpacing,
          font: project.assets.find(asset => asset.id === part.fontAssetId && asset.kind === 'font')?.path.replaceAll('\\', '/'),
        })),
        font: project.assets.find(asset => asset.id === (look.style?.fontAssetId ?? project.ui.fontAssetId) && asset.kind === 'font')?.path.replaceAll('\\', '/'),
      }];
    })),
    flowGraph: graph,
    flowLocations: locations,
    flowEntries: rootEntries.map(tuple),
    flowGroups: groups.length ? Object.fromEntries(groups.map(group => [group.id, { ...group, entries: group.entries.map(tuple) }])) : undefined,
    ...(hasCalls ? { flowViews: views, flowComponentId: component.id } : {}),
  });
}
const pageActions = (actions: string[], pageId: string) => {
  if (!actions.length) return 'NullAction()';
  if (actions.length === 1) return actions[0];
  const list = `[${actions.join(', ')}]`;
  return pageScopeArgument(pageId) ? `VnUiActions(${pythonLiteral(pageId)}, ${list})` : list;
};
function componentAction(project: Project, component: UiComponent, custom = false): string {
  if (component.action && !uiActionAvailable(project.ui, component.action)) return 'NullAction()';
  const actions: string[] = [`Function(vn_ui_play_click, ${pythonLiteral(component.id)})`];
  const pageId = component.page === 'custom' ? project.ui.customPages.find(p => p.components.some(c => c.id === component.id))?.id ?? '' : 'ui:' + component.page;
  for (const handler of uiClickHandlers(project, pageId, component.id).filter(h => h.source !== 'action')) actions.push(`Function(vn_run_blueprint, ${pythonLiteral(handler.graphId)}, ${pythonLiteral(handler.nodeId)}${pageScopeArgument(pageId)})`);
  let primary: string | undefined;
  if (component.action === 'setPlayerPreference') primary = `VnSetPreference(${pythonLiteral(component.preference)}, ${pythonLiteral(component.preferenceValue)}, ${pythonLiteral(component.preferenceCharacterId)})`;
  else if (component.page === 'voiceSettings' && component.action === 'return' && uiActionAvailable(project.ui, 'preferences')) primary = 'VnUiMenu("preferences")';
  else if (component.action === 'blueprint' && component.blueprintId && projectGraphs(project)?.some(graph => graph.id === component.blueprintId)) primary = `Function(vn_run_blueprint, ${pythonLiteral(component.blueprintId)}${pageScopeArgument(pageId)})`;
  else if (custom && component.action === 'minigameSuccess') { actions.push('Function(vn_finish_minigame, "success")'); primary = 'Return("success")'; }
  else if (custom && component.action === 'minigameFailure') { actions.push('Function(vn_finish_minigame, "failure")'); primary = 'Return("failure")'; }
  else if (custom && component.action === 'minigameCancel') { actions.push('Function(vn_finish_minigame, "cancel")'); primary = 'Return("cancel")'; }
  else if (custom && component.action === 'return') {
    const pageId=project.ui.customPages.find(page=>page.components.some(c=>c.id===component.id))?.id;
    primary=pageId?`If(${pythonLiteral(pageId)} in vn_ui_open_pages, Function(vn_ui_close_page, ${pythonLiteral(pageId)}, ""), Return())`:'Return()';
  }
  else primary = component.action ? componentActions[component.action] : undefined;
  if (primary) actions.push(primary);
  return pageActions(actions, pageId);
}

/** The default settings menu's sliders; their names come from the project's settings. */
const preferenceControls = { textSpeed: true, autoForwardTime: true, musicVolume: true, soundVolume: true, voiceVolume: true, masterVolume: true, ambientVolume: true, dialogueOpacity: true } as const;

function componentScreen(project: Project, page: UiComponent['page'], options: { name?: string; components?: UiComponent[]; custom?: boolean; pageId?: string; onShowBlueprintId?: string } = {}): string {
  project = { ...project, ui: uiPageTheme(project, options.pageId ?? 'ui:' + page) };
  const components = options.components ? sortUiComponents(options.components) : orderedUiComponents(project.ui).filter(item => item.page === page);
  const custom = options.custom ?? false;
  const parameters = custom ? 'minigame_title="", minigame_prompt="", _vn_session=None' : page === 'say' ? 'who, what' : page === 'choice' ? 'items' : page === 'messageBox' ? 'message, yes_action, no_action' : page === 'chapterTitle' ? 'title, subtitle, effect="none", duration=2.5, title_image=None' : '';
  const screenName = options.name ?? `vn_components_${page}`;
  const forwarded = custom ? 'minigame_title=minigame_title, minigame_prompt=minigame_prompt, _vn_session=_vn_session' : page === 'say' ? 'who, what' : page === 'choice' ? 'items' : page === 'messageBox' ? 'message, yes_action, no_action' : page === 'chapterTitle' ? 'title, subtitle, effect=effect, duration=duration, title_image=title_image' : '';
  const childForwarded = [forwarded, '_vn_layout=_vn_layout'].filter(Boolean).join(', ');
  const componentParameters = [parameters, '_vn_layout=None'].filter(Boolean).join(', ');
  const componentScreens: string[] = [];
  const lines: string[] = [`screen ${screenName}(${parameters}):`];
  lines.push('    $ _vn_layout = vn_ui_layout_resolve(' + pythonLiteral(components.map(c => c.id)) + ')');
  const bindings: string[] = [];
  if (projectGraphs(project).some(g => g.nodes.some(n => ['animateUiProperty','playUiAnimation'].includes(n.type)))) lines.push('    use vn_ui_animation_clock');
  const pageId=options.pageId??'ui:'+page;
  const showBlueprints = uiPageShowGraphIds(project, pageId);
  if (custom) {
    // Page lifecycle timers live outside the input-gated control transform.
    lines.push('    if _vn_session is not None:', '        pass');
    if (showBlueprints.length || ['created', 'closed', 'focusGained', 'focusLost', 'closeRequested'].some(phase => uiPageLifecycleHandlers(project, pageId, phase).length)) {
      lines.push(`    elif vn_minigame_owns_page(${pythonLiteral(pageId)}):`, '        if not vn_minigame_context.get("didShow", True):', `            timer 0.001 action Function(vn_minigame_page_shown, ${pythonLiteral(pageId)}, vn_minigame_context.get("token"), ${pythonLiteral(showBlueprints)})`);
      const actions = showBlueprints.map(id => `Function(vn_run_ui_show, ${pythonLiteral(id)}${pageScopeArgument(pageId)})`);
      lines.push('    else:', `        on "show" action ${pageActions(actions, pageId)}`);
    }
  } else {
    const shown = `Function(vn_ui_native_page_shown, ${pythonLiteral(pageId)}, ${pythonLiteral(showBlueprints)})`;
    lines.push(`    on "show" action ${shown}`, `    on "replace" action ${shown}`);
    lines.push(`    if vn_ui_native_page_needs_show(${pythonLiteral(pageId)}):`, `        timer 0.001 action ${shown}`);
  }
  if (!custom) {
    const keyActions = new Map<string,string[]>();
    for (const graph of projectGraphs(project)) for (const node of graph.nodes) {
      if (!uiGraphOnPage(project,graph,'ui:'+page) || !uiEventInActiveInstance(project,node) || node.properties.pageId !== 'ui:' + page || !['eventTimer','eventKey'].includes(node.type)) continue;
      const action = 'Function(vn_run_blueprint, ' + pythonLiteral(graph.id) + ', ' + pythonLiteral(node.id) + pageScopeArgument(pageId) + ')';
      if (node.type === 'eventTimer') lines.push(`    if vn_ui_native_page_events_ready(${pythonLiteral(pageId)}):`, '        timer ' + pythonLiteral(node.properties.interval ?? 1) + ' repeat ' + pythonLiteral(node.properties.repeat ?? true) + ' action ' + action);
      else { const key=String(node.properties.key ?? 'K_SPACE');keyActions.set(key,[...keyActions.get(key)??[],action]); }
    }
    for (const [key,actions] of keyActions) lines.push(`    if vn_ui_native_page_events_ready(${pythonLiteral(pageId)}):`, '        key ' + pythonLiteral(key) + ' action ' + pageActions(actions, pageId));
  }
  const blocks = new Map<string, { block: string[]; contentAt: number; guards: string[]; runtimeWidth: string; runtimeHeight: string }>();
  for (const component of components) {
    const children = components.filter(c => c.parentId === component.id);
    const { x, y, width, height } = uiComponentBounds(component, project.width, project.height);
    const block: string[] = [];
    const property = (name: string, fallback?: string) => isUiLayoutObservation(name) ? `vn_ui_layout_observe(${pythonLiteral(component.id)}, ${pythonLiteral(name)}, _vn_layout)` : `vn_ui_get(${pythonLiteral(component.id)}, ${pythonLiteral(name)}${fallback === undefined ? '' : `, ${fallback}`})`;
    const dynamicText = component.kind === 'text' || component.kind === 'button';
    const fontSize = uiComponentFontSize(component, project.ui, project.width, project.height);
    const font = project.assets.find(item => item.id === (component.style?.fontAssetId ?? project.ui.fontAssetId) && item.kind === 'font')?.path.replaceAll('\\', '/') ?? 'fonts/SourceHanSansLite.ttf';
    const textColor = dynamicText ? property('textColor') : pythonLiteral(component.style?.textColor ?? project.ui.textColor);
    const textOutlines = uiTextOutlines(component);
    const outline = dynamicText ? ` outlines vn_ui_outlines(${pythonLiteral(component.id)})` : textOutlines.length ? ` outlines ${pythonLiteral(textOutlines)}` : '';
    const appearance = uiPropertyApplies(component, 'borderWidth') ? `vn_ui_appearance(${pythonLiteral(component.id)})` : 'None';
    const foregroundBorder = ['image', 'video', 'spine', 'progress'].includes(component.kind) || component.binding === 'tooltip';
    const surface = uiPropertyApplies(component, 'background') ? property('background') : pythonLiteral(component.style?.background ?? (component.kind === 'historyList' && component.list?.historyLayout === 'columns' ? '#00000000' : '#283133'));
    const align = dynamicText ? `{'left': 0, 'center': .5, 'right': 1}[${property('align')}]` : { left: 0, center: 0.5, right: 1 }[component.style?.align ?? (component.kind === 'text' ? 'left' : 'center')];
    const componentId = `vn_component_${component.id}`;
    const parameter = project.variables.find(variable => variable.id === component.parameterId);
    const runtimeWidth = 'vn_ui_layout_size(' + pythonLiteral(component.id) + ', "width", _vn_layout)';
    const runtimeHeight = 'vn_ui_layout_size(' + pythonLiteral(component.id) + ', "height", _vn_layout)';
    const asset = project.assets.find(item => item.id === component.assetId);
    const skin = component.kind === 'button' ? `vn_ui_skin(${pythonLiteral(component.id)}, ${pythonLiteral(componentSkinData(project, component))})` : pythonLiteral(componentSkinData(project, component));
    const runtimeFont = dynamicText ? `vn_ui_font(${pythonLiteral(component.id)})` : pythonLiteral(font);
    const runtimeFontSize = dynamicText ? `vn_ui_font_size(${pythonLiteral(component.id)}, ${runtimeHeight})` : String(fontSize);
    const listOptions = { ...component.list };
    delete listOptions.textStyles;
    delete listOptions.flowContent;
    if (component.kind === 'galleryGrid') { delete listOptions.galleryGroups; delete listOptions.galleryUnlockWhen; }
    const optionData = withoutUndefined({ ...listOptions,
      ...(component.list?.textStyles ? { textStyles: Object.fromEntries(Object.entries(component.list.textStyles).flatMap(([part, value]) => {
        if (!value) return [];
        const { fontAssetId, ...style } = value;
        const fontPath = project.assets.find(asset => asset.id === fontAssetId && asset.kind === 'font')?.path.replaceAll('\\', '/');
        return [[part, Object.fromEntries(Object.entries({ ...style, fontPath }).filter(([, field]) => field !== undefined))]];
      })) } : {}),
      galleryGeometry: component.kind === 'galleryGrid' ? galleryLayout(project, component) : undefined,
      galleryEntries: component.kind === 'galleryGrid' ? galleryRuntimeEntries(project, component) : undefined,
      pageFontPath: project.assets.find(asset => asset.id === component.list?.pageFontAssetId)?.path.replaceAll('\\', '/'),
      ...(component.kind === 'flowchart' ? playerFlowRuntimeData(project, component) : {}),
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
      // Items of a collection answer with its own sounds; absent keys leave them on the defaults.
      ...(component.hoverSoundId === undefined ? {} : { hoverSoundPath: project.assets.find(item => item.id === component.hoverSoundId)?.path.replaceAll('\\', '/') ?? null }),
      ...(component.clickSoundId === undefined ? {} : { clickSoundPath: project.assets.find(item => item.id === component.clickSoundId)?.path.replaceAll('\\', '/') ?? null }),
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
    });
    const compiledCollection = component.kind === 'galleryGrid' || component.kind === 'flowchart';
    const options = compiledCollection ? (component.kind === 'flowchart' ? 'vn_flow_options_' : 'vn_gallery_options_') + component.id : pythonLiteral(optionData);
    if (compiledCollection) bindings.push('init python:\n    ' + options + ' = ' + pythonBlockLiteral(optionData, 1));
    const stateFrame = component.parentId && component.kind !== 'button';
    block.push(stateFrame ? '    vn_state_frame:' : '    frame:', ...(stateFrame ? [`        vn_inherit_state ${pythonLiteral(component.inheritState ?? false)}`] : []), '        xpos 0', '        ypos 0', `        xysize (${runtimeWidth}, ${runtimeHeight})`,
      '        padding (0, 0)', `        at ${component.kind === 'chapterTitle' ? '[' : ''}vn_ui_layout_transform(${pythonLiteral(component.id)}, _vn_layout, alpha=${property('opacity')}${component.style?.playerOpacity ? ' * vn_preference_get("dialogueOpacity")' : ''})${component.kind === 'chapterTitle' ? ', vn_chapter_letters(effect, duration)]' : ''}`,
      `        background ${(component.style?.background || uiPropertyApplies(component, 'background')) && !['button', 'choiceList', 'saveSlots', 'progress'].includes(component.kind) ? `vn_ui_box({}, "idle", ${runtimeWidth}, ${runtimeHeight}, ${surface}, ${appearance}${foregroundBorder ? ', with_border=False' : ''})` : 'None'}`);
    if (foregroundBorder) block.push(`        foreground vn_ui_border(${runtimeWidth}, ${runtimeHeight}, ${appearance})`);
    if (stateFrame) for (const [prefix, key] of [['hover', 'hoverBackground'], ['activate', 'pressedBackground'], ['selected', 'selectedBackground'], ['selected_hover', 'selectedBackground'], ['selected_activate', 'pressedBackground'], ['insensitive', 'disabledBackground'], ['selected_insensitive', 'disabledBackground']] as const) {
      const color = component.style?.[key] ?? component.style?.background;
      if (component.kind === 'progress') continue;
      if (uiPropertyApplies(component, key)) block.push(`        ${prefix}_background vn_ui_box({}, "idle", ${runtimeWidth}, ${runtimeHeight}, ${property(key)}, ${appearance}${foregroundBorder ? ', with_border=False' : ''})`);
      else if (color) block.push(`        ${prefix}_background vn_ui_box({}, "idle", ${runtimeWidth}, ${runtimeHeight}, ${pythonLiteral(color)}, ${appearance}${foregroundBorder ? ', with_border=False' : ''})`);
    }
    if (component.kind !== 'button') block.push(`        id ${pythonLiteral(componentId)}`);
    const contentAt = block.length;
    if (component.kind === 'spine') {
      block.push(`        add vn_ui_round(vns_spine.player(${pythonLiteral(component.id)}, ${runtimeWidth}, ${runtimeHeight}), ${runtimeWidth}, ${runtimeHeight}, ${appearance}) id ${pythonLiteral(`vn_spine_${component.id}`)}`);
    } else if (component.kind === 'video') {
      block.push(`        add vn_ui_round(VnUiVideoSurface(${pythonLiteral(component.id)}, ${runtimeWidth}, ${runtimeHeight}), ${runtimeWidth}, ${runtimeHeight}, ${appearance}) id ${pythonLiteral(`vn_video_${component.id}`)} xysize (${runtimeWidth}, ${runtimeHeight})`);
    } else if (component.kind === 'image') {
      const imageSkin = `vn_ui_skin(${pythonLiteral(component.id)}, ${pythonLiteral(componentSkinData(project, component))}, True)`;
      block.push(`        add vn_ui_round(VnUiImageSurface(${pythonLiteral(component.id)}, ${imageSkin}, ${runtimeWidth}, ${runtimeHeight}, ${pythonLiteral(!!component.parentId && (component.inheritState ?? false))}), ${runtimeWidth}, ${runtimeHeight}, ${appearance}) id ${pythonLiteral(`vn_image_${component.id}`)} xysize (${runtimeWidth}, ${runtimeHeight})`);
    } else if (component.kind === 'button') {
      const action = componentAction(project, component, custom);
      const interactionEvents=Object.fromEntries(['hover','unhover','press','release'].map(trigger=>[trigger,projectGraphs(project).flatMap(graph=>uiGraphOnPage(project,graph,pageId)?graph.nodes.filter(node=>node.type==='eventButton'&&node.properties.componentId===component.id&&node.properties.trigger===trigger&&uiEventInActiveInstance(project,node)).map(node=>`Function(vn_run_blueprint, ${pythonLiteral(graph.id)}, ${pythonLiteral(node.id)}${pageScopeArgument(pageId)})`):[])]));
      block.push('        vn_skin_button:', `            id ${pythonLiteral(componentId)}`,
        `            vn_component_id ${pythonLiteral(component.id)}`,
        `            vn_events {${Object.entries(interactionEvents).filter(([,actions])=>actions.length).map(([trigger,actions])=>`${pythonLiteral(trigger)}: ${pageActions(actions, pageId)}`).join(', ')}}`,
        `            xysize (${runtimeWidth}, ${runtimeHeight})`, `            padding ${component.skin?.hideText || children.length ? '(0, 0)' : '(8, 4)'}`,
        `            alt ${renpyText(component.text)}`, '            activate_sound None',
        `            tooltip ${property('tooltip', pythonLiteral(uiTooltip(component) || ''))}`,
        `            background vn_ui_box(${skin}, "idle", ${runtimeWidth}, ${runtimeHeight}, ${surface}, ${appearance})`,
        `            hover_background vn_ui_box(${skin}, "hover", ${runtimeWidth}, ${runtimeHeight}, ${property('hoverBackground')}, ${appearance})`,
        `            activate_background vn_ui_box(${skin}, "pressed", ${runtimeWidth}, ${runtimeHeight}, ${property('pressedBackground')}, ${appearance})`,
        `            insensitive_background vn_ui_box(${skin}, "disabled", ${runtimeWidth}, ${runtimeHeight}, ${property('disabledBackground')}, ${appearance})`,
        `            selected_background vn_ui_box(${skin}, "selected", ${runtimeWidth}, ${runtimeHeight}, ${property('selectedBackground')}, ${appearance})`,
        `            selected_hover_background vn_ui_box(${skin}, "selected", ${runtimeWidth}, ${runtimeHeight}, ${property('selectedBackground')}, ${appearance})`,
        `            selected_activate_background vn_ui_box(${skin}, "pressed", ${runtimeWidth}, ${runtimeHeight}, ${property('pressedBackground')}, ${appearance})`,
        `            selected_insensitive_background vn_ui_box(${skin}, "disabled", ${runtimeWidth}, ${runtimeHeight}, ${property('disabledBackground')}, ${appearance})`,
        `            action ${action}`);
      block.push(`            sensitive (${component.action && !uiActionAvailable(project.ui, component.action) ? 'False and ' : ''}${component.parentId ? `vn_ui_ancestor_enabled(${pythonLiteral(component.id)}) and ` : ''}${property('enabled')} and renpy.display.behavior.is_sensitive(${action}))`);
      block.push(`            selected (${property('selected')} if "selected" in vn_ui_overrides.get(${pythonLiteral(component.id)}, {}) or vn_ui_property_control(${pythonLiteral(component.id)}, "selected") is not None${component.selectedWhen ? ' or True' : ''} else None)`);
      block.push(component.skin?.hideText ? '            null' : `            text vn_ui_literal(${property('text')}) substitute False font ${runtimeFont} size ${runtimeFontSize} color ${textColor} hover_color ${dynamicText ? property('hoverTextColor') : pythonLiteral(component.style?.hoverTextColor ?? component.style?.textColor ?? project.ui.textColor)} selected_color ${dynamicText ? property('selectedTextColor') : pythonLiteral(component.style?.selectedTextColor ?? component.style?.textColor ?? project.ui.textColor)} insensitive_color ${dynamicText ? property('disabledTextColor') : pythonLiteral(component.style?.disabledTextColor ?? component.style?.textColor ?? project.ui.textColor)} text_align ${align} xalign ${align} yalign 0.5 xmaximum max(1, ${runtimeWidth} - 16)${outline}`);
    } else if (component.kind === 'panel') {
      block.push('        null');
    } else if (component.kind === 'progress') {
      block.push(`        add vn_ui_progress_surface(${property('value')}, ${runtimeWidth}, ${runtimeHeight}, ${surface}, ${property('selectedBackground')}, ${appearance}) xysize (${runtimeWidth}, ${runtimeHeight})`);
    } else if (component.kind === 'choiceList') {
      block.push(`        use vn_choice_items(items, ${runtimeWidth}, ${runtimeHeight}, ${runtimeFontSize}, ${textColor}, ${surface}, ${align}, ${pythonLiteral(componentId)}, ${skin}, ${runtimeFont}, ${options})`);
    } else if (component.kind === 'saveSlots') {
      block.push(`        use vn_skin_slots(${runtimeWidth}, ${runtimeHeight}, ${runtimeFontSize}, ${textColor}, ${surface}, ${skin}, ${options}, ${runtimeFont})`);
    } else if (component.parameterId && ['preference', 'preferenceChoice'].includes(component.kind) && parameter?.type !== 'number') {
      block.push(`        use vn_parameter_control(${pythonLiteral(component.parameterId)}, width=${runtimeWidth}, height=${runtimeHeight}, font_size=${runtimeFontSize}, color=${textColor}, font=${runtimeFont}, caption=${renpyText(component.text)}, component_id=${pythonLiteral(component.id)}, layout_rows=_vn_layout)`);
    } else if (component.kind === 'preference' || component.kind === 'preferenceChoice' && parameter?.type === 'number') {
      const slider = withoutUndefined({ ...component.slider, thumb: uiSkinData(project, component.slider?.thumb),
        trackPath: project.assets.find(a => a.id === component.slider?.trackId)?.path.replaceAll('\\', '/'),
        fillPath: project.assets.find(a => a.id === component.slider?.fillId)?.path.replaceAll('\\', '/') });
      block.push(`        use vn_preference_slider(${pythonLiteral(component.preference)}, ${pythonLiteral(component.preferenceCharacterId)}, ${renpyText(component.text || parameter?.name || (component.preference ? preferenceInfo(project, component.preference).name : ''))}, ${runtimeWidth}, ${runtimeHeight}, ${runtimeFontSize}, ${textColor}, ${runtimeFont}, ${pythonLiteral(slider)}, ${pythonLiteral(componentId)}${parameter ? ', parameter_id=' + pythonLiteral(parameter.id) : ''}, component_id=${pythonLiteral(component.id)}, layout_rows=_vn_layout)`);
    } else if (component.kind === 'preferenceChoice') {
      const info = playerPreferences[component.preference!];
      const choices = component.selector?.options ?? playerPreferenceOptions(component.preference!, project);
      const selector = withoutUndefined({ ...component.selector, options: choices, itemSkin: uiSkinData(project, component.selector?.itemSkin), popupPath: project.assets.find(a => a.id === component.selector?.popupBackgroundId)?.path.replaceAll('\\', '/'), arrowPath: project.assets.find(a => a.id === component.selector?.arrowId)?.path.replaceAll('\\', '/') });
      block.push(`        use vn_preference_choice(${pythonLiteral(component.preference)}, ${pythonLiteral(component.preferenceCharacterId)}, ${pythonLiteral(selector)}, ${skin}, int(${property('screenX')}), int(${property('screenY')}), ${runtimeWidth}, ${runtimeHeight}, ${runtimeFontSize}, ${textColor}, ${surface}, ${runtimeFont}, ${pythonLiteral(componentId)}, component_id=${pythonLiteral(component.id)}, layout_rows=_vn_layout)`);
    } else if (['galleryGrid', 'musicTrackList', 'voiceCollection', 'chapterList', 'historyList', 'flowchart', 'pauseMenu', 'staffRoll'].includes(component.kind)) {
      block.push(`        use vn_collection(${pythonLiteral(component.kind)}, ${runtimeWidth}, ${runtimeHeight}, ${runtimeFontSize}, ${textColor}, ${surface}, ${skin}, ${options}, ${pythonLiteral(componentId)}, ${runtimeFont}, ${renpyText(component.text)})`);
    } else if (['keyboard', 'chapterTitle', 'messageBox', 'gameOver'].includes(component.kind)) {
      const contextArgs = component.kind === 'chapterTitle' ? `, title, subtitle, font=${runtimeFont}, title_image=title_image, align=${align}, text_outlines=${outline ? outline.trim().slice('outlines '.length) : '[]'}` : component.kind === 'keyboard' && page === 'keyboard' ? ', native_input=True' : '';
      block.push(`        use vn_context_component(${pythonLiteral(component.kind)}, ${runtimeWidth}, ${runtimeHeight}, ${runtimeFontSize}, ${textColor}, ${renpyText(component.text)}${contextArgs})`);
    } else if (component.binding === 'confirmation') {
      block.push(`        use vn_confirmation_text(vn_ui_bound_display(${pythonLiteral(component.id)}, _(message)), ${runtimeWidth}, ${runtimeHeight}, ${runtimeFontSize}, ${textColor}, ${runtimeFont}, ${align}, ${pythonLiteral(componentId)}, text_outlines=${outline ? outline.trim().slice('outlines '.length) : '[]'})`);
    } else if (component.binding === 'tooltip') {
      block.push(`        add vn_ui_round(vn_ui_surface(${skin}, "idle", ${runtimeWidth}, ${runtimeHeight}, "#00000000"), ${runtimeWidth}, ${runtimeHeight}, ${appearance})`,
        `        text vn_ui_literal(${property('text')}) substitute False font ${runtimeFont} size ${runtimeFontSize} color ${textColor} xalign ${align} yalign 0.5 text_align ${align} xmaximum ${runtimeWidth}${outline}`);
    } else {
      const boundText = component.binding === 'title' ? renpyText(project.name) : component.binding === 'speaker' ? 'who' : component.binding === 'dialogue' ? 'what' : component.binding === 'minigameTitle' ? 'minigame_title' : component.binding === 'minigamePrompt' ? 'minigame_prompt' : component.binding === 'minigameStatus' ? 'vn_minigame_status()' : property('text');
      const text = component.binding ? `vn_ui_bound_display(${pythonLiteral(component.id)}, ${boundText})` : boundText;
      const bindingId = component.binding === 'speaker' ? ' id "who"' : component.binding === 'dialogue' ? ' id "what"' : '';
      if (component.binding === 'speaker') block.push('        if who is not None:');
      const indent = component.binding === 'speaker' ? '            ' : '        ';
      const stateColors = stateFrame ? ` hover_color ${dynamicText ? property('hoverTextColor') : pythonLiteral(component.style?.hoverTextColor ?? component.style?.textColor ?? project.ui.textColor)} activate_color ${dynamicText ? property('hoverTextColor') : pythonLiteral(component.style?.hoverTextColor ?? component.style?.textColor ?? project.ui.textColor)} selected_color ${dynamicText ? property('selectedTextColor') : pythonLiteral(component.style?.selectedTextColor ?? component.style?.textColor ?? project.ui.textColor)} insensitive_color ${dynamicText ? property('disabledTextColor') : pythonLiteral(component.style?.disabledTextColor ?? component.style?.textColor ?? project.ui.textColor)}` : '';
      block.push(`${indent}${stateFrame ? 'vn_state_viewport' : 'viewport'}:`, `${indent}    xysize (${runtimeWidth}, ${runtimeHeight})`, `${indent}    mousewheel "change"`, `${indent}    draggable False`,
        `${indent}    ${component.binding === 'dialogue' ? 'vn_dialogue_text' : 'text'} ${component.binding ? text : `vn_ui_literal(${text}) substitute False`}${bindingId}${component.binding === 'dialogue' ? ' vn_line_style True' : ''} font ${runtimeFont} xsize ${runtimeWidth} min_width ${runtimeWidth} size ${runtimeFontSize} color ${textColor}${stateColors} text_align ${align}${outline}`);
    }
    const guards = [property('visible'), `vn_ui_layout_paintable(${pythonLiteral(component.id)}, _vn_layout)`, component.binding === 'tooltip' ? 'GetTooltip()' : '', component.page === 'save' && component.saveMode ? `renpy.get_screen(${pythonLiteral(component.saveMode)}) is not None` : ''].filter(Boolean);
    blocks.set(component.id, { block, contentAt, guards, runtimeWidth, runtimeHeight });
  }
  const renderSiblings = (siblings: UiComponent[], seen = new Set<string>()): string[] => {
    if (!siblings.length) return [];
    for (const sibling of siblings) renderTree(sibling, seen);
    return [`    for _vn_component index _vn_component in vn_ui_layer_order(${pythonLiteral(siblings.map(c => c.id))}):`,
      `        use expression (${pythonLiteral(screenName + '_component_')} + _vn_component) pass (${childForwarded}) id _vn_component`];
  };
  const renderTree = (component: UiComponent, seen = new Set<string>()): string[] => {
    if (seen.has(component.id)) return [];
    const entry = blocks.get(component.id)!;
    const block = [...entry.block], children = components.filter(c => c.parentId === component.id);
    if (children.length) {
      const branch = (background: boolean, indent: number) => {
        const nested = renderSiblings(children.filter(c => (c.childLayer === 'background') === background), new Set(seen).add(component.id));
        if (!nested.length) return [];
        const prefix = ' '.repeat(indent + 8);
        return [' '.repeat(indent + 4) + 'vn_layout_children:', prefix + 'vn_component_id ' + pythonLiteral(component.id), prefix + 'vn_rows _vn_layout',
          prefix + 'vn_background ' + pythonLiteral(background), prefix + 'xysize (' + entry.runtimeWidth + ', ' + entry.runtimeHeight + ')',
          ...nested.map(line => ' '.repeat(indent + 4) + line)];
      };
      if (component.kind === 'button') {
        const labelAt = block.findIndex(line => line.startsWith('            text ') || line === '            null');
        const label = block[labelAt];
        let content = ['    ' + label];
        if (children.some(c => c.childLayer === 'background')) {
          // Draw the button's own surface after background children, just like
          // the editor. Keep every native button state and its input handling.
          for (let i = 0; i < block.length; i++) if (/^            (?:\w+_)?background vn_ui_(?:surface|box)\(/.test(block[i])) {
            block[i] = block[i].replace(/vn_ui_(?:surface|box)\(.*$/, 'None');
          }
          content = [`                add VnUiStateSurface(vn_ui_skin(${pythonLiteral(component.id)}, ${pythonLiteral(componentSkinData(project, component))}), ${entry.runtimeWidth}, ${entry.runtimeHeight}, True, colors=vn_ui_state_colors(${pythonLiteral(component.id)}), look=vn_ui_appearance(${pythonLiteral(component.id)})) xysize (${entry.runtimeWidth}, ${entry.runtimeHeight})`, '    ' + label];
        }
        block.splice(labelAt, 1, '            fixed:', '                xysize (' + entry.runtimeWidth + ', ' + entry.runtimeHeight + ')', ...branch(true, 12), ...content, ...branch(false, 12));
      } else {
        const content = block.splice(entry.contentAt);
        block.push('        fixed:', '            xysize (' + entry.runtimeWidth + ', ' + entry.runtimeHeight + ')', ...branch(true, 8), ...content.map(line => '    ' + line), ...branch(false, 8));
      }
    }
    const body = ['    if _vn_layout is None:', '        $ _vn_layout = vn_ui_layout_resolve(' + pythonLiteral(components.map(c => c.id)) + ')', ...(entry.guards.length ? ['    if ' + entry.guards.join(' and ') + ':', ...block.map(line => '    ' + line)] : block)];
    componentScreens.push(`screen ${screenName}_component_${component.id}(${componentParameters}):\n${body.join('\n')}`);
    return body;
  };
  lines.push(...renderSiblings(components.filter(c => !c.parentId)));
  // Keys belong to the screen: an enclosing button can consume keyboard events
  // before nested displayables receive them. Keep the whole ancestor guard.
  for (const component of components.filter(c => c.kind === 'button' && c.shortcut)) {
    const guards = [component, ...uiAncestors(components, component.id)].flatMap(c => blocks.get(c.id)!.guards);
    const action = componentAction(project, component, custom);
    lines.push('    if ' + [...new Set(guards)].join(' and ') + ':', `        key ${pythonLiteral(component.shortcut)} action If(vn_ui_ancestor_enabled(${pythonLiteral(component.id)}) and vn_ui_get(${pythonLiteral(component.id)}, "enabled") and renpy.display.behavior.is_sensitive(${action}), ${action}, NullAction())`);
  }
  if (lines.length === 1) lines.push('    pass');
  return [...bindings, lines.join('\n'), ...componentScreens].join('\n\n');
}

function customPageScreens(project: Project): string {
  const pages = project.ui.customPages ?? [];
  const screens = pages.map((page: CustomUiPage) => {
    const background = page.background ?? project.ui.background;
    const backgroundPath = project.assets.find(asset => asset.id === page.backgroundId && asset.kind === 'image')?.path.replaceAll('\\', '/');
    const events = projectGraphs(project).flatMap(graph => graph.nodes.filter(node => ['eventKey', 'eventTimer'].includes(node.type) && node.properties.pageId === page.id && uiGraphOnPage(project,graph,page.id) && uiEventInActiveInstance(project,node)).map(node => ({ graph, node })));
    const keyActions = new Map<string, string[]>(), timers: string[] = [];
    for (const { graph, node } of events) {
      const action = `Function(vn_run_blueprint, ${pythonLiteral(graph.id)}, ${pythonLiteral(node.id)}${pageScopeArgument(page.id)})`;
      if (node.type === 'eventKey') {
        const key = String(node.properties.key ?? 'K_SPACE');
        keyActions.set(key, [...keyActions.get(key) ?? [], `If(_vn_interactive, ${action}, NullAction())`]);
      } else timers.push(`    if not vn_game_flow_transition_page_held(_vn_session):\n        timer ${pythonLiteral(node.properties.interval ?? 1)} repeat ${pythonLiteral(node.properties.repeat ?? true)} action ${action}`);
    }
    // Separate key statements consume the event before later handlers can run.
    const triggers = [...keyActions].map(([key, actions]) => `    if _vn_interactive:\n        key ${pythonLiteral(key)} action ${pageActions(actions, page.id)}`).concat(timers).join('\n');
    return `screen vn_custom_page_${page.id}(minigame_title="", minigame_prompt="", _vn_waiting=False, _vn_session=None, _vn_interactive=True):
    # Keep the released call-screen name and argument for saved continuations.
    # The shared host draws the page exactly once; this screen only waits.
    default _vn_wait_token = vn_ui_page_token(${pythonLiteral(page.id)})
    default _vn_wait_context = renpy.context()
    if _vn_waiting:
        use vn_ui_page_wait(${pythonLiteral(page.id)}, _vn_wait_token)
    else:
        use vn_custom_page_body_${page.id}(minigame_title, minigame_prompt, _vn_session, _vn_interactive)

screen vn_custom_page_body_${page.id}(minigame_title="", minigame_prompt="", _vn_session=None, _vn_interactive=True):
    modal (_vn_session or {}).get("modal", ${page.modal ? 'True' : 'False'})
    zorder 60
    if (_vn_session or {}).get("opening", {}).get("presentation", ${pythonLiteral(page.opening?.presentation ?? 'page')}) != "overlay":
        add Solid(${pythonLiteral(background)})
${backgroundPath ? `        add Transform(${pythonLiteral(backgroundPath)}, xysize=(${project.width}, ${project.height}), fit="cover")` : ''}
    if _vn_session is not None and not _vn_session.get("didShow", True) and vn_ui_page_show_ready(${pythonLiteral(page.id)}):
        timer 0.001 action Function(vn_ui_page_shown, ${pythonLiteral(page.id)}, _vn_session["token"], ${pythonLiteral(uiPageShowGraphIds(project, page.id))})
    vn_ui_input_gate vn_interactive _vn_interactive:
        use vn_components_custom_${page.id}(minigame_title=minigame_title, minigame_prompt=minigame_prompt, _vn_session=_vn_session)
${triggers}
    if _vn_interactive:
        if _vn_session and _vn_session.get("confirm"):
            textbutton "继续" action Function(vn_ui_close_page, ${pythonLiteral(page.id)}, "完成", "completed", _vn_session["token"]) xalign 0.95 yalign 0.95
            key "K_RETURN" action Function(vn_ui_close_page, ${pythonLiteral(page.id)}, "完成", "completed", _vn_session["token"])
        if _vn_session and _vn_session.get("allowSkip"):
            textbutton "跳过" action Function(vn_ui_close_page, ${pythonLiteral(page.id)}, "取消", "cancelled", _vn_session["token"]) xalign 0.95 yalign 0.05
        if vn_ui_page_cancel_target() == ${pythonLiteral(page.id)} and ${keyActions.has('game_menu') || keyActions.has('K_ESCAPE') ? 'False' : 'True'}:
            key "game_menu" action Function(vn_ui_cancel_page, ${pythonLiteral(page.id)})

${componentScreen(project, 'custom', { name: `vn_components_custom_${page.id}`, components: page.components, custom: true, pageId: page.id, onShowBlueprintId: page.onShowBlueprintId })}`;
  }).join('\n\n');
  const choices = pages.map((page, index) => `${index ? '    el' : '    '}if page_id == ${pythonLiteral(page.id)}:\n        use vn_custom_page_${page.id}(minigame_title=title, minigame_prompt=prompt)`).join('\n');
  return `${screens}${screens ? '\n\n' : ''}screen vn_blueprint_pages():
    zorder 65
    modal False
    # The host survives page closes; screen-level modal expressions are otherwise cached.
    $ renpy.current_screen().modal = vn_ui_pages_modal()
    for _vn_page_id in vn_ui_visible_page_order():
${pages.map(page => `        if _vn_page_id == ${pythonLiteral(page.id)}:\n            use vn_custom_page_${page.id}(_vn_session=vn_ui_page_sessions[_vn_page_id], _vn_interactive=vn_ui_page_interactive(_vn_page_id)) id vn_ui_page_token(_vn_page_id)`).join('\n') || '        pass'}

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
  const components = effectiveUiComponents(ui).filter(component => !ui.disabledPages?.includes(component.page));
  const customPage = (page: UiComponent['page']) => !ui.disabledPages?.includes(page) && ui.pages?.[page]?.layout === 'custom';
  const pageThemes = new Map<string, Project['ui']>();
  const pageTheme = (page: string) => { let theme = pageThemes.get(page); if (!theme) { theme = uiPageTheme(project, 'ui:' + page); pageThemes.set(page, theme); } return theme; };
  const pageFontPath = (page: string) => project.assets.find(asset => asset.kind === 'font' && asset.id === pageTheme(page).fontAssetId)?.path.replaceAll('\\', '/') ?? 'fonts/SourceHanSansLite.ttf';
  const fs = ui.fontSize;
  const menuFs = Math.min(24, fs);
  const smallFs = Math.min(18, fs);
  const mainButtonHeight = Math.max(24, Math.min(50, Math.floor((h * 0.7 - 40) / 6)));
  const mainButtonFont = Math.min(Math.min(24, pageTheme('main').fontSize), Math.max(14, mainButtonHeight - 16));
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
  const customMain = customPage('main');
  const customSay = customPage('say');
  const imageEntries = project.assets.filter(asset => asset.kind === 'image');
  const musicEntries = musicRoomEntries(project, components);
  const galleryData = imageEntries.map(asset => `        (${pythonLiteral(asset.id)}, ${renpyText(asset.name)}, ${pythonLiteral(asset.path.replaceAll('\\', '/'))}),`).join('\n');
  const musicData = musicEntries.map(asset => `        (${renpyText(asset.name)}, ${pythonLiteral(asset.path.replaceAll('\\', '/'))}),`).join('\n');
  const voiceEntries = storyVoiceEntries(project).map(asset => `        (${pythonLiteral(asset.id)}, ${renpyText(asset.caption)}, ${pythonLiteral(asset.path.replaceAll('\\', '/'))}),`).join('\n');
  // Story actions consume raw captions; each text display escapes its own markup.
  const menuData = (kind: 'chapterList' | 'flowchart') => storyMenuEntries(project, kind).map(entry => `        (${pythonLiteral(entry.id)}, ${pythonLiteral(entry.name)}, ${pythonLiteral(entry.nodeId ? `vn_node_${entry.nodeId}` : '')}),`).join('\n');
  const chapterEntries = menuData('chapterList');
  const flowEntries = menuData('flowchart');
  // The built-in directory needs the same sub-story semantics when the author
  // has not placed a flowchart control. Its ID cannot collide with authored IDs.
  const nativeCallDirectory = project.nodes.some(node => node.kind === 'call') ? {
    ...playerFlowRuntimeData(project, { id: ':native-flow', kind: 'flowchart', page: 'flowchart', text: '', x: 0, y: 0, width: 1, height: 1, list: { layout: 'grid' } }),
    layout: 'grid', lockUnread: false, confirmJump: true,
  } : undefined;
  const bindings = new Set(components.filter(component => component.kind === 'text').map(component => component.binding));
  const customChoiceList = components.some(component => component.page === 'choice' && component.kind === 'choiceList');
  const customSaveSlots = components.some(component => component.page === 'save' && component.kind === 'saveSlots');
  const customPreferences = new Set(components.filter(component => component.page === 'preferences' && component.kind === 'preference').map(component => component.preference));
  const customPreferenceActions = new Set(components.filter(component => component.page === 'preferences' && component.kind === 'button').map(component => component.action));
  const fullyCustomPreferences = ui.pages?.preferences?.layout === 'custom' || replacesStandardPreferences(components);
  const preferenceLabelHeight = Math.ceil(Math.min(24, pageTheme('preferences').fontSize) * 1.4);
  // Settings the author hid leave the default menu entirely; names follow the author's wording.
  const preferenceShown = (key: PlayerPreference) => preferenceInfo(project, key).visible;
  const preferenceControl = (key: keyof typeof preferenceControls) => !preferenceShown(key) ? '' : customPreferences.has(key) ?
    `        null height ${preferenceLabelHeight + 38}` :
    `        label ${renpyText(preferenceInfo(project, key).name)} ysize ${preferenceLabelHeight}\n        bar value VnPreferenceValue(${pythonLiteral(key)}) style vn_ui_native_style("preferences", "slider")`;
  const preferenceButton = (key: NonNullable<UiComponent['action']>, text: string, indent = '        ') => {
    if (!uiActionAvailable(ui, key)) return '';
    const buttonWidth = text.length * Math.min(24, pageTheme('preferences').fontSize) + 24;
    const buttonHeight = preferenceLabelHeight + 16;
    return customPreferenceActions.has(key) ? `${indent}null width ${buttonWidth} height ${buttonHeight}` :
      `${indent}textbutton ${renpyText(text)} action ${componentActions[key]} xysize (${buttonWidth}, ${buttonHeight})`;
  };
  const preferenceChoices = standardPreferenceChoices.filter(group => preferenceShown(group.preference)).map(group => [
    `        label ${renpyText(group.title)}`,
    `        ${group.preference === 'windowSize' ? 'grid 2 2:' : 'hbox:'}`,
    '            spacing 8',
    ...group.options.map((option, index) => {
      const size = `xysize (${option.label.length * Math.min(18, pageTheme('preferences').fontSize) + 24}, ${Math.ceil(Math.min(18, pageTheme('preferences').fontSize) * 1.4) + 16})`;
      return components.some(component => component.page === 'preferences' && replacesPreferenceOption(component, group.preference, option.value)) ?
        `            null ${size}` :
        `            textbutton ${renpyText(option.label)} action VnSetPreference(${pythonLiteral(group.preference)}, ${pythonLiteral(option.value)}) style vn_ui_native_style("preferences", "vn_small_button") ${size} id "vn_preference_${group.preference}_${index}"`;
    }),
  ].join('\n')).join('\n');
  const customVoiceCharacters = components.filter(component => component.page === 'voiceSettings' && component.kind === 'preference' && component.preference === 'characterVolume').map(component => component.preferenceCharacterId ?? '');
  const mainButtons = uiMainButtons.filter(([action]) => uiActionAvailable(ui, action));
  const mainNavigation = mainButtons.map(([action, title]) => components.some(c => replacesMainButton(c, action)) ?
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
        vn_stop_type_sound()
        last = renpy.last_say()
        vn_retained_dialogue = (getattr(last.who, "name", None), last.what)
        store.vn_retained_look = (store.vn_line_dialogue or {}).get("presentation")

    def vn_empty_window():
        if vn_interface_visible and not vn_performance_active and vn_retained_dialogue is not None:
            # Retain the previous words only for this interaction. Reusing a
            # persistent say screen carries the stage wait into the next
            # sentence's typewriter clock.
            store.vn_showing_retained = True
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
${nativeCallDirectory ? '    globals()["vn_flow_options_:native-flow"] = ' + pythonBlockLiteral(nativeCallDirectory, 1) : ''}
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

${createUiPageStyles(project)}

screen main_menu():
    style_prefix vn_ui_native_prefix("main")
    tag menu
${customMain ? '    use vn_page_background("main")' : `    add Solid(${pythonLiteral(ui.background)})
${menuImage ? `    add Transform(${pythonLiteral(menuImage.path.replaceAll('\\', '/'))}, xysize=(${w}, ${h}), fit="cover")` : ''}
    add Solid("#00000070")
${bindings.has('title') ? '' : `    text ${renpyText(project.name)} xpos ${margin} ypos ${Math.round(h * 0.085)} xsize ${contentWidth} size ${Math.min(48, Math.max(28, pageTheme('main').fontSize + 8))} outlines [(2, "#00000080", 0, 1)]`}
    vbox:
        xpos ${margin}
        yalign 0.82
        spacing 8
${mainNavigation || '        pass'}
    text ${renpyText(project.version)} xalign 0.97 yalign 0.96 size ${Math.min(18, pageTheme('main').fontSize)}`}
    use vn_components_main

screen say(who, what):
    style_prefix vn_ui_native_prefix("say")
    $ _vn_text_place = vn_line_text_place(what)
    if vn_interface_visible and not vn_performance_active and _vn_text_place:
        # A line placed on the screen replaces the dialogue window and its components.
        vn_dialogue_text what id "what" vn_line_style True font ${pythonLiteral(pageFontPath('say'))} color ${pythonLiteral(pageTheme('say').textColor)} size ${pageTheme('say').fontSize} line_spacing 5 xpos int(_vn_text_place["x"] * ${w}) ypos int(_vn_text_place["y"] * ${h}) xanchor 0.5 yanchor 0.5 xsize max(1, int(_vn_text_place["width"] * ${w})) min_width max(1, int(_vn_text_place["width"] * ${w}))
    elif vn_interface_visible and not vn_performance_active:
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
${bindings.has('speaker') ? '' : `            if who is not None:\n                text who id "who" color ${pythonLiteral(pageTheme('say').accent)} size ${Math.min(pageTheme('say').fontSize, 30)}`}
${bindings.has('dialogue') ? '' : `            vn_dialogue_text what id "what" vn_line_style True font ${pythonLiteral(pageFontPath('say'))} color ${pythonLiteral(pageTheme('say').textColor)} size ${pageTheme('say').fontSize} xsize ${contentWidth} min_width ${contentWidth} line_spacing 5`}
${bindings.has('speaker') && bindings.has('dialogue') ? '            pass' : ''}`).split('\n').map(line => '    ' + line).join('\n')}
        use vn_components_say(who, what)
    else:
        # Character still needs its Text object to manage voice, skipping and
        # dialogue advancement while the authored interface is hidden.
        vn_dialogue_text what id "what" color "#00000000" size 1 vn_line_style "timing"

screen choice(items):
    style_prefix vn_ui_native_prefix("choice")
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
    style_prefix vn_ui_native_prefix("say")
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
                style_prefix vn_ui_native_prefix("say", "vn_small")
${uiQuickButtons.filter(([action]) => uiActionAvailable(ui, action)).map(([action, text]) => `                textbutton ${pythonLiteral(text)} action ${componentActions[action]}${action === 'skip' ? ' alternate VnSkip(fast=True, confirm=True)' : ''}`).join('\n')}

screen vn_game_menu(title, scroll=False, page=None, return_action=None, back_action=None):
    style_prefix vn_ui_native_prefix(page)
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
                text title size vn_ui_native_title_size(page, ${Math.min(32, fs + 4)}) yalign 0.5
                textbutton ("返回设置" if return_action else "返回" if vn_bp_menu_active else "返回标题" if main_menu else "返回游戏"):
                    action (return_action or ${componentActions.return})
                    id "vn_game_menu_return"
                    xalign 1.0
                    style vn_ui_native_style(page, "vn_small_button")
            hbox:
                spacing 5
                style_prefix vn_ui_native_prefix(page, "vn_small")
${uiMenuButtons.filter(([action]) => uiActionAvailable(ui, action)).map(([action, text]) => `                textbutton ${pythonLiteral(text)} action ${componentActions[action]}${action === 'save' || action === 'history' ? ' sensitive not main_menu' : ''}`).join('\n')}
                pass
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
    # Escape/right-click step back to the page the player came from; a page
    # opened directly (for example by a story blueprint) closes as before.
    key "game_menu" action (back_action or ${componentActions.return})
    key "mouseup_3" action (back_action or ${componentActions.return})

screen save():
    style_prefix vn_ui_native_prefix("save")
    tag menu
${customSaveSlots ? '    use vn_game_menu("存档", page="save"):\n        pass' : '    use vn_slots("存档")'}
    use vn_components_save

screen load():
    style_prefix vn_ui_native_prefix("save")
    tag menu
${customSaveSlots ? '    use vn_game_menu("读档", page="save"):\n        pass' : '    use vn_slots("读档")'}
    use vn_components_save

screen vn_slots(title):
    style_prefix vn_ui_native_prefix("save")
    use vn_game_menu(title, page="save"):
        vbox:
            spacing 12
            hbox:
                spacing 5
                style_prefix vn_ui_native_prefix("save", "vn_small")
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
                                text FileTime(slot, format="%Y-%m-%d %H:%M", empty="空存档") size ${Math.min(15, Math.min(18, pageTheme('save').fontSize))} yalign 0.5
                                textbutton "删除" action FileDelete(slot, confirm=True) style vn_ui_native_style("save", "vn_small_button") xalign 1.0

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
    style_prefix vn_ui_native_prefix("preferences")
    tag menu
${fullyCustomPreferences ? '    use vn_game_menu("设置", page="preferences"):\n        pass' : `    use vn_game_menu("设置", scroll=True, page="preferences"):
${preferenceShown('fullscreen') ? `${customPreferenceActions.has('window') && customPreferenceActions.has('fullscreen') ? `        null height ${preferenceLabelHeight}` : `        label "显示" ysize ${preferenceLabelHeight}`}
        hbox:
            spacing 10
${preferenceButton('window', '窗口', '            ')}
${preferenceButton('fullscreen', '全屏', '            ')}
            pass` : ''}
${preferenceControl('textSpeed')}
${preferenceControl('autoForwardTime')}
${preferenceShown('skipAll') ? `${customPreferenceActions.has('skipSeen') && customPreferenceActions.has('skipAll') ? `        null height ${preferenceLabelHeight}` : `        label "跳过范围" ysize ${preferenceLabelHeight}`}
        hbox:
            spacing 10
${preferenceButton('skipSeen', '已读文本', '            ')}
${preferenceButton('skipAll', '全部文本', '            ')}
            pass` : ''}
${preferenceButton('transitions', '跳过转场')}
${preferenceControl('musicVolume')}
${preferenceControl('soundVolume')}
${preferenceControl('voiceVolume')}
${preferenceButton('mute', '全部静音')}
${preferenceControl('masterVolume')}
${preferenceControl('ambientVolume')}
${preferenceControl('dialogueOpacity')}
${preferenceShown('characterVolume') ? preferenceButton('voiceSettings', preferenceInfo(project, 'characterVolume').name === playerPreferences.characterVolume.name ? '角色音量' : preferenceInfo(project, 'characterVolume').name) : ''}
${preferenceChoices}
${preferenceButton('resetPreferences', '恢复初始设置')}`}
    use vn_components_preferences

# Old saves may still restore this removed screen. Redirect to the authored
# settings page; groups no longer create player controls automatically.
screen vn_parameter_settings_menu(vn_back=None):
    tag menu
    timer 0.01 action ${uiActionAvailable(ui, 'preferences') ? 'VnUiMenu("preferences")' : componentActions.return}

screen voice_settings(vn_back=None):
    style_prefix vn_ui_native_prefix("voiceSettings")
    tag menu
    use vn_game_menu("角色音量", scroll=True, page="voiceSettings", return_action=${uiActionAvailable(ui, 'preferences') ? 'VnUiMenu("preferences")' : 'None'}, back_action=VnUiMenu(vn_back) if vn_back else None):
        for character_id, character_name in vn_voice_characters:
            if character_id not in ${pythonLiteral(customVoiceCharacters)}:
                label character_name
                bar value VnPreferenceValue("characterVolume", character_id) style vn_ui_native_style("voiceSettings", "slider") id ("vn_character_volume_" + (character_id or "other"))
    use vn_components_voiceSettings

screen history():
    style_prefix vn_ui_native_prefix("history")
    tag menu
    predict False
    on "hide" action Stop("vn_replayvoice")
    on "replaced" action Stop("vn_replayvoice")
    use vn_game_menu("历史", scroll=True, page="history"):
        if not _history_list:
            text "暂无对话记录" size ${Math.min(24, pageTheme('history').fontSize)}
        for entry in _history_list:
            vbox:
                spacing 6
                if entry.who:
                    text entry.who color entry.who_args.get("color", ${pythonLiteral(pageTheme('history').accent)}) size ${Math.min(24, pageTheme('history').fontSize)}
                text entry.what substitute False size ${Math.min(24, pageTheme('history').fontSize)} xmaximum ${contentWidth - 30}
                if getattr(getattr(entry, "voice", None), "filename", None):
                    hbox:
                        spacing 15
                        textbutton "重播语音" action VnReplayVoice(entry.voice.filename, vn_capture_history_voice(entry)) id ("vn_history_replay_" + str(_history_list.index(entry)))
                        textbutton ("取消收藏" if VnFavoriteVoice(entry.voice.filename, vn_capture_history_voice(entry)).get_selected() else "收藏语音") action VnFavoriteVoice(entry.voice.filename, vn_capture_history_voice(entry)) id ("vn_history_favorite_" + str(_history_list.index(entry)))
            null height 12
    use vn_components_history

screen gallery():
    style_prefix vn_ui_native_prefix("gallery")
    tag menu
    use vn_game_menu("画廊", scroll=True, page="gallery"):
        if not vn_gallery_entries:
            text "暂无图片" size ${Math.min(24, pageTheme('gallery').fontSize)}
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
                                text asset_name size ${Math.min(18, pageTheme('gallery').fontSize)} xmaximum ${slotWidth - 30}
                            else:
                                text "未解锁" size ${Math.min(24, pageTheme('gallery').fontSize)} xalign 0.5
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
    style_prefix vn_ui_native_prefix("musicRoom")
    tag menu
    default original_pause = renpy.music.get_pause(channel="music")
    on "show" action Function(renpy.music.set_pause, True, channel="music")
    on "replace" action Function(renpy.music.set_pause, True, channel="music")
    on "hide" action [vn_music_room.Stop(), Function(renpy.music.set_pause, original_pause, channel="music")]
    on "replaced" action [vn_music_room.Stop(), Function(renpy.music.set_pause, original_pause, channel="music")]
    use vn_game_menu("音乐", scroll=True, page="musicRoom"):
        if not vn_music_entries:
            text "暂无音乐" size ${Math.min(24, pageTheme('musicRoom').fontSize)}
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
    style_prefix vn_ui_native_prefix("pause")
    tag menu
    use vn_game_menu("暂停菜单", page="pause"):
        vbox:
            spacing 12
${uiPauseButtons.filter(([action]) => uiActionAvailable(ui, action)).map(([action, text]) => `            textbutton ${pythonLiteral(text)} action ${componentActions[action]}`).join('\n')}
    use vn_components_pause

screen chapter_select():
    style_prefix vn_ui_native_prefix("chapterSelect")
    tag menu
    use vn_game_menu("章节选择", scroll=True, page="chapterSelect"):
        if not vn_chapter_entries:
            text "暂无章节" size ${Math.min(24, pageTheme('chapterSelect').fontSize)}
        else:
            vbox:
                spacing 8
                for chapter_id, chapter_name, chapter_label in vn_chapter_entries:
                    textbutton vn_ui_literal(chapter_name):
                        substitute False
                        if chapter_label:
                            action VnStoryStart("chapterList", chapter_id, chapter_label, chapter_name)
                        else:
                            action NullAction()
                        xfill True
    use vn_components_chapterSelect

screen voice_collection():
    style_prefix vn_ui_native_prefix("voiceCollection")
    tag menu
    on "hide" action Stop("vn_replayvoice")
    on "replaced" action Stop("vn_replayvoice")
    use vn_game_menu("语音收藏", page="voiceCollection"):
        use vn_collection("voiceCollection", ${contentWidth - 36}, ${Math.max(100, h - 230)}, ${Math.min(24, pageTheme('voiceCollection').fontSize)}, ${pythonLiteral(pageTheme('voiceCollection').textColor)}, "#283133", {}, {"favoritesOnly": True}, "vn_voice_collection", ${pythonLiteral(pageFontPath('voiceCollection'))})
    use vn_components_voiceCollection

screen flowchart():
    style_prefix vn_ui_native_prefix("flowchart")
    tag menu
    use vn_game_menu("剧情流程图", scroll=${nativeCallDirectory ? 'False' : 'True'}, page="flowchart"):
${nativeCallDirectory ? `        use vn_collection("flowchart", ${contentWidth - 36}, ${Math.max(100, h - 210)}, ${Math.min(24, pageTheme('flowchart').fontSize)}, ${pythonLiteral(pageTheme('flowchart').textColor)}, "#283133", {}, globals()["vn_flow_options_:native-flow"], "vn_flow_native", ${pythonLiteral(pageFontPath('flowchart'))})` : `
        if not vn_flow_entries:
            text "暂无流程节点" size ${Math.min(24, pageTheme('flowchart').fontSize)}
        else:
            vbox:
                spacing 5
                for node_id, node_name, node_label in vn_flow_entries:
                    textbutton vn_ui_literal(node_name) substitute False action VnStoryStart("flowchart", node_id, node_label, node_name) xfill True`}
    use vn_components_flowchart

screen staff_roll():
    style_prefix vn_ui_native_prefix("staff")
    tag menu
    use vn_game_menu("制作人员", scroll=True, page="staff"):
        text "制作人员名单可由组件实例自定义。" size ${Math.min(24, pageTheme('staff').fontSize)}
    use vn_components_staff

screen confirm(message, yes_action, no_action):
    style_prefix vn_ui_native_prefix("messageBox")
    modal True
    zorder 200
${customPage('messageBox') ? `    use vn_page_background("messageBox")` : `
    add Solid("#000000aa")
    frame:
        xalign 0.5
        yalign 0.5
        xsize ${Math.min(720, contentWidth)}
        padding (24, 24)
        background Solid(${pythonLiteral(ui.background)})
        vbox:
            spacing 24
            text _(message) size ${Math.min(24, pageTheme('messageBox').fontSize)} xmaximum ${Math.min(672, contentWidth - 48)}
            hbox:
                spacing 20
                textbutton "确认" action yes_action id "vn_confirm_yes"
                textbutton "取消" action no_action id "vn_confirm_no"`}
    use vn_components_messageBox(message, yes_action, no_action)
    key "game_menu" action no_action

screen input(prompt):
    style_prefix vn_ui_native_prefix("keyboard")
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
    use vn_components_keyboard

screen vn_game_over():
    style_prefix vn_ui_native_prefix("gameOver")
    modal True
    zorder 80
    use vn_page_background("gameOver")
${ui.pages?.gameOver?.layout === 'custom' || components.some(component => component.page === 'gameOver' && component.kind === 'gameOver') ? '' : `    vbox:
        xalign 0.5
        yalign 0.5
        spacing 24
        text "游戏结束" size ${Math.min(24, pageTheme('gameOver').fontSize)}
        textbutton "重新开始" action Start() id "vn_game_over_start"
        textbutton "返回标题" action Return() id "vn_game_over_title"`}
    use vn_components_gameOver
    key "game_menu" action Return()

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
    style_prefix vn_ui_native_prefix("chapterTitle")
    # Screen properties run before parameter binding; supplied arguments are in _kwargs.
    modal _kwargs.get("_vn_wait", True)
    zorder 80
    default can_dismiss = False
    default _vn_clock = vn_chapter_clock()
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
${customPage('chapterTitle') ? '' : `        vbox:
            xalign 0.5
            yalign 0.5
            xsize ${Math.round(w * 0.8)}
            spacing 12
            at vn_chapter_letters(effect, duration)
            if title_image:
                add Transform(title_image, xysize=(${Math.round(w * 0.7)}, ${Math.round(h * 0.16)}), fit="contain") xalign 0.5
            else:
                text title size ${Math.min(56, Math.max(28, pageTheme('chapterTitle').fontSize + 12))} color ${pythonLiteral(pageTheme('chapterTitle').accent)} xalign 0.5 text_align 0.5
            if subtitle and not title_image:
                text subtitle size ${Math.min(28, Math.max(16, Math.min(24, pageTheme('chapterTitle').fontSize)))} color ${pythonLiteral(pageTheme('chapterTitle').textColor)} xalign 0.5 text_align 0.5`}
        use vn_components_chapterTitle(title, subtitle, effect, duration, title_image)
${ui.chapterTransition?.particles === false ? '' : `        if effect == "ink":
            for particle in vn_chapter_particles_for(title_image, title):
                add Solid(${pythonLiteral(ui.chapterTransition?.particleColor ?? "#ffffff")}, xsize=max(1, int(particle["pixels"])), ysize=max(1, int(particle["pixels"]))):
                    at vn_chapter_particle_motion(particle, duration)`}
    if _vn_clock["held"]:
        timer 0.02 repeat True action Function(vn_chapter_tick, _vn_clock, duration, _vn_wait, _vn_layer, _update_screens=False)
    else:
        timer (min(0.3, duration * 0.1)) action SetScreenVariable("can_dismiss", True)
        timer duration action (Return(True) if _vn_wait else Hide("vn_chapter_title", _layer=_vn_layer))
        timer 0.05 repeat True action If(renpy.is_skipping(), (Return(True) if _vn_wait else Hide("vn_chapter_title", _layer=_vn_layer)), NullAction())
    if _vn_wait:
        key "dismiss" action If(can_dismiss and (_vn_allow_click if _vn_allow_click is not None else vn_performance_active and vn_performance_settings.get("clickSkip", False)), Return("click"), NullAction())

${createUiWidgets(ui)}

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
