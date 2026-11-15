import type { UiPreviewActionHandler } from '../core/ui-preview-actions';
import type { BlueprintUsage } from '../core/blueprint-usages';
import { addProjectGraphs, projectGraphs } from '../core/project-resources';
import type { UiAnimationFocus } from './ui-animation-editor-focus';
import type { BlueprintFocus } from './BlueprintGraphEditor';
import type { OpenBlueprintGraph } from './blueprint-navigation';
import type { BlueprintSelection, UiPageSelection, UiAnimationSelection } from '../core/ai-selection';
import { UiDock } from './UiDock';
import { UiMultiInspector } from './UiMultiInspector';
import { UiAddMenu } from './UiAddMenu';
import { availableBlueprintName } from '../core/blueprint-names';
import { UiLogicEditor } from './UiLogicEditor';
import { createUiAuthoringSession, type UiAuthoringSession } from './ui-authoring-session';
import { useUiPreviewWindow, type UiPreviewWindowControls } from './useUiPreviewWindow';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Save, ChevronLeft, ChevronRight, Check, Circle, MapPin, Eye } from 'lucide-react';
import { editableUiComponent, effectiveUiComponents, effectiveUiTheme, localUiComponents, makeId, uiComponentLimit, type Diagnostic, type Project, type UiButtonState, type UiComponent } from '../core/model';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph } from '../core/blueprint';
import { isStandaloneNode, standaloneChapter } from '../core/standalone-performance';
import { expandPreviewActions, previewActionContext } from '../core/preview-actions';
import { editableUiPages, uiSkinAsset, uiStateNames, uiTooltip } from '../core/ui';
import { UiFontFaces, UiSkinImage, uiFontFamily } from './UiAppearance';
import { UiCollectionPreview } from './UiCollectionPreview';
import { UiCollectionCanvas, UiCollectionEditProvider, useCollectionEditing, useUiCollectionEditSession, collectionPartProps } from './UiCollectionEditing';
import { collectionInspectorPartName, collectionInspectorPartScope } from '../core/ui-collection-inspector';
import { UiFlowEditContext, UiFlowAuthoringStatusContext, flowInspectorReference, flowEnterView, flowLocateBrowseTrail, flowBrowseTrailToView, flowValidBrowseTrail, playerFlowPreviewEntryIds, type UiFlowEditing, type FlowInspectorTarget, type FlowBrowseFrame, type FlowBrowseViewport } from './UiFlowEditing';
import { UiFlowPreviewControls } from './UiFlowPreviewControls';
import { playerFlowAllEntries, playerFlowView, playerFlowViews, playerFlowGroups, playerFlowMode, setPlayerFlowPosition } from '../core/player-flow-content';
import { storyFlowLayout } from '../core/story-flow';
import { SpinePreview } from './SpinePreview';
import { playerPreferenceKeys, playerPreferenceOptions, playerPreferences, preferenceInfo, replacesPreferenceOption, replacesStandardPreferences, sliderPreferences, standardPreferenceChoices } from '../core/preferences';
import { AuthoredPreferencePreview } from './PlayerPreferences';
import type { Commit } from './editor';
import { hexOpacity, type AssetUrl } from './StageEditor';
import { reparentUiComponent, reorderUiList, resolveUiHierarchy, uiListOrder } from '../core/ui-hierarchy';
import { UiHierarchy } from './UiHierarchy';
import { UiParentGuide, type UiParentDrop } from './UiParentGuide';
import { UiTransformHandles } from './UiTransformHandles';
import { useUiComponentTransform } from './useUiComponentTransform';
import { useUiViewport } from './useUiViewport';
import { useStableCallbacks } from './useStableCallbacks';
import { UiZoomControls } from './UiZoomControls';
import { useUiEditorCommands } from './useUiEditorCommands';
import { UiComponentContent, uiComponentPreviewStyle } from './UiComponentVisual';
import { uiPropertyControlDesignSnapshot } from '../core/ui-property-control-snapshot';
import { ChapterBackdrop, ChapterPreview } from './ChapterPreview';
import { chapterPresentation } from '../core/chapter';
import { createCustomUiPage, removeCustomUiPage, type UiPageUsage } from '../core/game-flow';
import { collectUiPageUsages } from '../core/ui-page-usages';
import { chapterEditorEntries, enableUiPage, uiSelectionContext, uiSelectionFallback } from '../core/ui-page-authoring';
import { uiMainButtons, uiMenuButtons, uiQuickButtons, uiPauseButtons } from '../core/ui-page-catalog';
import { mainButtonSlot, replacesMainButton } from '../core/ui-native-main';
import { uiActionAvailable } from '../core/ui-availability';
import type { PerformanceTarget } from '../core/performance-workspace';
import { UiPagePicker, UiPageUsageHint } from './UiPagePicker';
import type { GameFlowPhase } from '../core/game-flow-schema';
import { PageConnectionDialog } from './PageConnectionDialog';
import { UiLayoutToolbar } from './UiLayoutToolbar';
import { UiSnapGuides } from './UiSnapGuides';
import { UiPageOptions } from './UiPageOptions';
import { UiPageSettings, type UiInspectorPageContext } from './UiPageSettings';
import { uiPageTheme } from '../core/ui-page-settings';
import { ensureUiPageEvent, uiEventAuthoringGraph } from '../core/ui-logic';
import { synchronizeBlueprintSignatures, type BlueprintNodeType } from '../core/blueprint';
import type { UiPageLifecyclePhase } from '../core/ui-page-interface';
import type { VariableValue } from '../core/model';
import { UiToolbarPopover } from './UiToolbarPopover';
import { useUiSelection } from './useUiSelection';
import { useUiMarquee } from './useUiMarquee';
import { applyUiRectChanges, planUiArrangement, uiRectChangeProblem, uiSelectionRoots, type UiArrangement, type UiEditScope } from '../core/ui-arrange';
import './ui-layout-toolbar.css';

import { actionName, uiPageNames, componentNames, componentName, preferenceNames, bindingNames } from './UiNames';
export { uiPageNames, componentNames, componentName, preferenceNames, bindingNames } from './UiNames';
const specialPageKinds: Partial<Record<UiComponent['page'], UiComponent['kind']>> = {
  pause: 'pauseMenu', history: 'historyList', gallery: 'galleryGrid', musicRoom: 'musicTrackList', voiceCollection: 'voiceCollection',
  chapterSelect: 'chapterList', chapterTitle: 'chapterTitle', staff: 'staffRoll', keyboard: 'keyboard',
  flowchart: 'flowchart', gameOver: 'gameOver',
};

export interface UiFocus { target: NonNullable<Diagnostic['ui']>; request: number; field?: 'action'; saveMode?: 'save' | 'load' }
interface FlowEditorSession {
  scope: string; componentId: string; inspector: FlowInspectorTarget; request: number;
  groupId?: string;
  browseTrail?: FlowBrowseFrame[];
  locate?: UiFlowEditing['locate']; preview: UiFlowEditing['preview'];
  visualState?: UiFlowEditing['visualState']; impact?: UiFlowEditing['impact']; region?: UiFlowEditing['region'];
  selectedPart?: number;
}
export function UiEditor({ textPending = false, authoringSessions, navigation, onPreviewClosed, onPreviewAction, onLocateUsage, animationFocus, blueprintFocus, project, commit, selectedId, select: selectPrimary, assetUrl, openBlueprint, focus, dirty, saving, onSave, advanced = false, onAdvancedChange, inspector, onActiveBlueprint, onActiveAnimation, onActivePage, onPreviewControls, storyPosition, onOpenGameFlow, onLocatePageUsage, onLocateStory, onOpenGlobalSettings, onOpenPerformance }: { textPending?: boolean; authoringSessions?: Map<string, UiAuthoringSession>; navigation?: ReactNode; onPreviewClosed?: () => void; onPreviewAction?: UiPreviewActionHandler; onLocateUsage?: (usage: BlueprintUsage) => void; animationFocus?:UiAnimationFocus; blueprintFocus?:BlueprintFocus; project: Project; commit: Commit; selectedId?: string; select: (id?: string) => void; assetUrl: AssetUrl; openBlueprint?: OpenBlueprintGraph; focus?: UiFocus; dirty?: boolean; saving?: boolean; onSave?: () => void; advanced?: boolean; onAdvancedChange?: (advanced: boolean) => void; inspector?: ReactNode | ((context: UiInspectorPageContext) => ReactNode); onOpenGlobalSettings?: () => void; onOpenPerformance?: (target: PerformanceTarget) => void; onActivePage?: (selection?: UiPageSelection) => void; onActiveAnimation?: (selection?: UiAnimationSelection) => void; onActiveBlueprint?: (selection?: BlueprintSelection) => void; onPreviewControls?: (controls?: UiPreviewWindowControls) => void; storyPosition?: { nodeId?: string; lineId?: string }; onOpenGameFlow?: (phase: GameFlowPhase, stepId?: string) => void; onLocatePageUsage?: (usage: UiPageUsage) => void; onLocateStory?: (nodeId: string) => void }) {
  const setAdvanced = (value: boolean) => onAdvancedChange?.(value);
  const [initialSelection] = useState(() => uiSelectionContext(project, selectedId));
  const [page, setPage] = useState<UiComponent['page']>(initialSelection?.page ?? 'main');
  const canvas = useRef<HTMLDivElement>(null);
  const designLocate = useRef<{ id: string; scope: string } | undefined>(undefined);
  const [previewState, setPreviewState] = useState<UiButtonState>('idle');
  const [hoveredButton, setHoveredButton] = useState<string>();
  const [savePreviewMode, setSavePreviewMode] = useState<'save' | 'load'>(initialSelection?.saveMode ?? 'save');
  const [savePreviewFilled, setSavePreviewFilled] = useState(false);
  const [customPageId, setCustomPageId] = useState(initialSelection?.customPageId ?? project.ui.customPages?.[0]?.id ?? '');
  const [pageDialog, setPageDialog] = useState<{ id: string; mode: 'connect' | 'delete' }>();
  const inspectingDisabled = useRef<UiComponent['page'] | undefined>(undefined);
  useEffect(() => {
    if (!focus) return;
    inspectingDisabled.current = project.ui.disabledPages?.includes(focus.target.page) ? focus.target.page : undefined;
    setPage(focus.target.page);
    if (focus.target.customPageId) setCustomPageId(focus.target.customPageId);
    const component = effectiveUiComponents(project.ui).find(component => component.id === focus.target.componentId);
    if (focus.saveMode || component?.saveMode) setSavePreviewMode(focus.saveMode ?? component!.saveMode!);
  }, [focus]);
  const [hierarchyError, setHierarchyError] = useState('');
  const [highlightedId, setHighlightedId] = useState<string>();
  const [hierarchyDrop, setHierarchyDrop] = useState<UiParentDrop>();
  const [chapterId, setChapterId] = useState('');
  const [chapterReplay, setChapterReplay] = useState(0);
  const [playingChapter, setPlayingChapter] = useState(false);
  const finishChapter = useCallback(() => setPlayingChapter(false), []);
  const chapterNodes = useMemo(() => page !== 'chapterTitle' ? [] : project.nodes.flatMap(node => {
    const action = standaloneChapter(node) ?? (isStandaloneNode(node) ? expandPreviewActions(project, node.lines[0].actions, previewActionContext(project)).find(action => action.kind === 'chapter') : undefined);
    return action?.kind === 'chapter' ? [{ ...action, id: node.id }] : [];
  }), [page, project]);
  const previewChapter = chapterNodes.find(n => n.id === chapterId) ?? chapterNodes[0];
  const chapterLook = chapterPresentation(project, previewChapter);
  useEffect(() => setPlayingChapter(false), [page, chapterId, project.ui.activeInstanceId]);
  const instances = project.ui.instances ?? [];
  const customPages = project.ui.customPages ?? [];
  const activeCustomPage = customPages.find(item => item.id === customPageId) ?? customPages[0];
  const activePageId=page==='custom'?activeCustomPage?.id:'ui:'+page;
  const viewKey = JSON.stringify([project.id, activePageId, page === 'custom' ? 'base' : project.ui.activeInstanceId ?? 'base']);
  const localAuthoringSessions = useRef(new Map<string, UiAuthoringSession>());
  const sessions = authoringSessions ?? localAuthoringSessions.current;
  const authoringSession = useMemo(() => {
    let value = sessions.get(viewKey);
    if (!value) { value = createUiAuthoringSession(); sessions.set(viewKey, value); }
    return value;
  }, [viewKey, sessions]);
  const viewport = useUiViewport(project.width, project.height, viewKey);
  const canvasScale = viewport.scale;
  const usageIndex = useMemo(() => collectUiPageUsages(project), [project]);
  const pageUsages = activePageId ? usageIndex.get(activePageId) ?? [] : [];
  const connectionActions = activePageId && <button type="button" className="small-button ui-page-usages" aria-label="页面使用位置" title="查看或添加这个页面的打开位置。只修改外观时保存即可，无需额外设置。" onClick={() => setPageDialog({ id: activePageId, mode: 'connect' })}><MapPin size={14} aria-hidden="true" /><span>页面使用位置</span>{pageUsages.length > 0 && <small>{pageUsages.length}</small>}</button>;
  const connectionDialog = pageDialog && <PageConnectionDialog key={pageDialog.id + pageDialog.mode} project={project} usages={usageIndex.get(pageDialog.id) ?? []} pageId={pageDialog.id} commit={commit} storyPosition={storyPosition} onClose={() => setPageDialog(undefined)} onLocate={onLocatePageUsage} onOpenGameFlow={onOpenGameFlow} onDelete={pageDialog.mode === 'delete' ? () => {
    const nextId = customPages.find(item => item.id !== pageDialog.id)?.id ?? '';
    commit('删除自定义页面', draft => { removeCustomUiPage(draft, pageDialog.id); }, { separate: true });
    setCustomPageId(nextId); select(undefined); setPageDialog(undefined);
  } : undefined} />;
  useEffect(()=>{onActivePage?.(activePageId?{pageId:activePageId,...(page!=='custom'?{uiInstanceId:project.ui.activeInstanceId??'base'}:{}),mode:advanced?'events':'design'}:undefined);},[activePageId, page, project.ui.activeInstanceId, advanced, onActivePage]);
  useEffect(()=>()=>onActivePage?.(undefined),[onActivePage]);
  useEffect(() => {
    if (project.ui.disabledPages?.includes(page) && inspectingDisabled.current !== page) {
      const fallback = uiSelectionFallback(project);
      setPage(fallback.page); if (fallback.customPageId) setCustomPageId(fallback.customPageId); select(undefined);
    }
  }, [page, project.ui.disabledPages]);
  const effectiveTheme = useMemo(() => uiPageTheme(project, activePageId ?? ''), [project, activePageId]);
  const pageProject = useMemo(() => ({ ...project, ui: effectiveTheme }), [project, effectiveTheme]);
  const pageSettings = page === 'custom' ? activeCustomPage ? { layout: 'custom' as const, backgroundId: activeCustomPage.backgroundId, background: activeCustomPage.background, backgroundOpacity: 1 } : undefined : effectiveTheme.pages?.[page];
  const overlayCanvas = page === 'custom' && activeCustomPage?.opening?.presentation === 'overlay';
  const customLayout = page === 'custom' || pageSettings?.layout === 'custom';
  useEffect(() => {
    if (!activeCustomPage && customPages[0]) setCustomPageId(customPages[0].id);
  }, [activeCustomPage, customPages]);
  const observeCanvas = useCallback((element: HTMLDivElement | null) => {
    canvas.current = element;
    if (!element) return;
    const request = designLocate.current;
    if (request && request.scope !== viewKey) designLocate.current = undefined;
    let first = 0, second = 0;
    if (request?.scope === viewKey) first = requestAnimationFrame(() => { second = requestAnimationFrame(() => {
      if (canvas.current !== element || designLocate.current !== request) return;
      designLocate.current = undefined;
      element.querySelector<HTMLElement>('[data-component-id="' + CSS.escape(request.id) + '"]')?.scrollIntoView({ block: 'center', inline: 'center' });
    }); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); if (canvas.current === element) canvas.current = null; };
  }, [viewKey, sessions]);
  const activeInstance = instances.find(instance => instance.id === project.ui.activeInstanceId);
  const localComponents = page === 'custom' ? activeCustomPage?.components ?? [] : localUiComponents(project.ui);
  const localIds = new Set(localComponents.map(component => component.id));
  const inheritedIds = new Set(page !== 'custom' && activeInstance ? effectiveUiComponents({ ...project.ui, activeInstanceId: activeInstance.baseUiId }).map(component => component.id) : []);
  const canAdd = (page !== 'custom' || !!activeCustomPage) && localComponents.length < uiComponentLimit;
  const { locateDesignComponent } = useStableCallbacks({ locateDesignComponent: (id: string) => {
    const components = page === 'custom' ? activeCustomPage?.components ?? [] : effectiveUiComponents(project.ui).filter(component => component.page === page);
    if (!components.some(component => component.id === id)) return;
    designLocate.current = { id, scope: viewKey }; select(id); onAdvancedChange?.(false);
  } });
  const pageComponents = useMemo(() => page === 'custom' ? activeCustomPage?.components ?? [] : effectiveUiComponents(project.ui).filter(component => component.page === page), [project.ui, page, activeCustomPage]);
  const designSnapshots = useMemo(() => new Map(pageComponents.map(component => [component.id, uiPropertyControlDesignSnapshot(project, component)])), [pageComponents, project]);
  const designComponents = useMemo(() => pageComponents.map(component => designSnapshots.get(component.id)!.component), [pageComponents, designSnapshots]);
  const visibleInHierarchy = useCallback((component: UiComponent) => page !== 'save' || !component.saveMode || component.saveMode === savePreviewMode, [page, savePreviewMode]);
  const visibleOnCanvas = useCallback((component: UiComponent) => visibleInHierarchy(component) && designSnapshots.get(component.id)?.values.visible !== false, [visibleInHierarchy, designSnapshots]);
  const selection = useUiSelection(viewKey, pageComponents.filter(visibleInHierarchy).map(c => c.id), selectedId, selectPrimary);
  const collectionEditing = useUiCollectionEditSession({ scope: viewKey, components: pageComponents, selectedIds: selection.ids, enabled: !advanced,
    onSelectComponent: selection.select, previewState, onPreviewStateChange: setPreviewState, savePreviewMode, onSavePreviewModeChange: setSavePreviewMode });
  const collectionPart = collectionEditing.selection;
  const collectionComponent = collectionPart && pageComponents.find(component => component.id === collectionPart.componentId);
  const [flowSelection, setFlowSelection] = useState<FlowEditorSession>();
  const flowRequest = useRef(0), flowMounted = useRef(true);
  useEffect(() => { flowMounted.current = true; return () => { flowMounted.current = false; }; }, []);
  const selectedFlow = !advanced && !collectionPart && selection.ids.length === 1 ? pageComponents.find(c => c.id === selectedId && c.kind === 'flowchart') : undefined;
  const flowAllEntries = useMemo(() => selectedFlow ? playerFlowAllEntries(project, selectedFlow) : [], [project, selectedFlow]);
  const flowAllEntryIds = useMemo(() => new Set(flowAllEntries.map(entry => entry.id)), [flowAllEntries]);
  const flowGroups = useMemo(() => selectedFlow ? playerFlowGroups(selectedFlow) : [], [selectedFlow]);
  const flowViews = useMemo(() => selectedFlow ? playerFlowViews(project, selectedFlow) : undefined, [project, selectedFlow]);
  const flowProgressIds = useMemo(() => selectedFlow ? playerFlowPreviewEntryIds(project, selectedFlow) : [], [project, selectedFlow]);
  const flowScope = selectedFlow ? JSON.stringify([viewKey, selectedFlow.id, playerFlowMode(selectedFlow)]) : undefined;
  const storedFlowSession = flowScope && flowSelection?.scope === flowScope ? flowSelection : undefined;
  const flowTrail = flowViews ? flowValidBrowseTrail(flowViews.root, flowViews.views, storedFlowSession?.browseTrail ?? (storedFlowSession?.groupId ? [{ viewId: storedFlowSession.groupId }] : [])) : [];
  const flowTrailKey = JSON.stringify(flowTrail), flowGroupId = flowTrail.at(-1)?.viewId;
  const flowView = flowViews && (flowGroupId ? flowViews.views.get(flowGroupId) : flowViews.root);
  const flowEntries = flowView?.entries ?? [];
  const flowEntryIds = useMemo(() => new Set(flowEntries.map(entry => entry.id)), [flowEntries]);
  const flowViewports = useRef(new Map<string, FlowBrowseViewport>());
  useEffect(() => { flowViewports.current.clear(); }, [flowScope]);
  const rawFlowTarget = storedFlowSession?.inspector;
  const flowGraph = useMemo(() => selectedFlow && rawFlowTarget?.kind === 'edge' ? storyFlowLayout(project, selectedFlow, flowGroupId, flowView) : undefined, [project, selectedFlow, flowGroupId, rawFlowTarget?.kind, flowView]);
  let flowTarget: FlowInspectorTarget = rawFlowTarget ?? { kind: 'map' };
  const targetPresetId = flowTarget.kind === 'preset' ? flowTarget.presetId : undefined;
  if (flowTarget.kind === 'node' && !flowAllEntryIds.has(flowTarget.nodeId)
    || flowTarget.kind === 'call' && !flowEntries.some(entry => entry.callId === (flowTarget.kind === 'call' ? flowTarget.callId : undefined))
    || flowTarget.kind === 'group' && !flowGroups.some(group => flowTarget.kind === 'group' && group.id === flowTarget.groupId)
    || flowTarget.kind === 'edge' && !flowGraph?.edges.some(edge => flowTarget.kind === 'edge' && edge.from === flowTarget.from && edge.to === flowTarget.to)
    || flowTarget.kind === 'preset' && !!targetPresetId && !project.ui.flowStyles?.some(preset => preset.id === targetPresetId)) flowTarget = { kind: 'map' };
  else if (flowTarget.kind === 'base' || flowTarget.kind === 'preset') {
    const nodeId = flowInspectorReference(flowTarget, flowAllEntries);
    if (flowTarget.nodeId !== nodeId) flowTarget = { ...flowTarget, nodeId };
  }
  const flowTargetKey = JSON.stringify(flowTarget);
  const flowTargetValid = JSON.stringify(rawFlowTarget) === flowTargetKey;
  const flowCurrent = useRef({ scope: flowScope, target: flowTargetKey, groupId: flowGroupId, trail: flowTrailKey, saving: !!saving });
  flowCurrent.current = { scope: flowScope, target: flowTargetKey, groupId: flowGroupId, trail: flowTrailKey, saving: !!saving };
  const flowInternal = !!selectedFlow && (flowTarget.kind !== 'map' || !!flowGroupId);
  const makeFlowSession = (): FlowEditorSession => ({ scope: flowScope!, componentId: selectedFlow!.id, inspector: { kind: 'map' }, request: flowRequest.current, preview: { mode: 'all' } });
  // Hide invalid sessions immediately and discard them after rendering, so a
  // later visit to the same page or component cannot revive an old preview.
  useEffect(() => {
    if (!flowSelection) return;
    if (flowSelection.scope !== flowScope) setFlowSelection(previous => previous === flowSelection ? undefined : previous);
    else if (JSON.stringify(flowSelection.inspector) !== flowTargetKey || flowSelection.groupId !== flowGroupId || JSON.stringify(flowSelection.browseTrail ?? []) !== flowTrailKey) {
      const request = ++flowRequest.current;
      const sameAppearance = flowSelection.inspector.kind === flowTarget.kind && (flowTarget.kind === 'base' || flowTarget.kind === 'preset' && flowSelection.inspector.kind === 'preset' && flowSelection.inspector.presetId === flowTarget.presetId);
      setFlowSelection(previous => previous && previous === flowSelection ? { ...previous, groupId: flowGroupId, browseTrail: flowTrail, inspector: flowTarget, request, locate: undefined, visualState: sameAppearance ? previous.visualState : undefined, impact: undefined, region: sameAppearance ? previous.region : undefined, selectedPart: undefined } : previous);
    }
  }, [flowSelection, flowScope, flowTargetKey, flowGroupId, flowTrailKey]);
  const inspectFlow = useCallback((target: FlowInspectorTarget, locate = false) => {
    if (!flowMounted.current || !flowScope || flowCurrent.current.scope !== flowScope || flowCurrent.current.groupId !== flowGroupId || !selectedFlow) return;
    if (target.kind === 'node' && !flowAllEntryIds.has(target.nodeId)
      || target.kind === 'call' && !flowEntries.some(entry => entry.callId === target.callId)
      || target.kind === 'group' && !flowGroups.some(group => group.id === target.groupId)
      || target.kind === 'edge' && !(flowGraph ?? storyFlowLayout(project, selectedFlow, flowGroupId, flowView)).edges.some(edge => edge.from === target.from && edge.to === target.to)
      || target.kind === 'preset' && !!target.presetId && !project.ui.flowStyles?.some(preset => preset.id === target.presetId)) return;
    const inspector = target.kind === 'base' || target.kind === 'preset' ? { ...target, nodeId: flowInspectorReference(target, flowAllEntries) } : target;
    const request = ++flowRequest.current;
    setFlowSelection(previous => {
      const session = previous?.scope === flowScope ? previous : makeFlowSession();
      const natural = inspector.kind === 'map' || inspector.kind === 'sources' || inspector.kind === 'group' || inspector.kind === 'call' || inspector.kind === 'edge';
      const sameTarget = JSON.stringify(session.inspector) === JSON.stringify(inspector);
      const previousNodeId = 'nodeId' in session.inspector ? session.inspector.nodeId : undefined;
      const nextNodeId = 'nodeId' in inspector ? inspector.nodeId : undefined;
      const selectedPart = inspector.kind === 'map' ? undefined : nextNodeId && previousNodeId === nextNodeId ? session.selectedPart ?? 0 : 0;
      const previousCall = session.inspector.kind === 'call' ? flowEntries.find(entry => entry.callId === (session.inspector.kind === 'call' ? session.inspector.callId : undefined)) : undefined;
      const locateTrail = previousCall?.viewId && previousCall.callId ? flowEnterView(flowTrail, { viewId: previousCall.viewId, callId: previousCall.callId }) : flowTrail;
      const browseTrail = inspector.kind === 'node' && locate && flowViews ? flowLocateBrowseTrail(flowViews.root, flowViews.views, inspector.nodeId, locateTrail) ?? flowTrail : flowTrail;
      const groupId = browseTrail.at(-1)?.viewId;
      return { ...session, groupId, browseTrail, inspector, request, locate: inspector.kind === 'node' && locate ? { nodeId: inspector.nodeId, request } : undefined,
        visualState: natural ? undefined : session.visualState, impact: natural || !sameTarget ? undefined : session.impact, region: sameTarget && !natural ? session.region : undefined, selectedPart };
    });
  }, [flowScope, selectedFlow, flowGroupId, flowEntryIds, flowAllEntryIds, flowAllEntries, flowGroups, flowGraph, project, flowViews, flowTrailKey, flowEntries]);
  const enterFlowView = (viewId: string, callId?: string) => {
    if (!flowScope || !flowViews || flowCurrent.current.scope !== flowScope || flowCurrent.current.trail !== flowTrailKey || !flowViews.views.has(viewId)) return;
    const entry = flowEntries.find(item => (item.viewId ?? item.groupId) === viewId && (!callId || item.callId === callId));
    const requested = flowViews.views.get(viewId)!;
    if (!entry && !(requested.kind === 'group' && requested.parentViewId === flowView?.id)) return;
    const browseTrail = flowEnterView(flowTrail, { viewId, ...(callId ? { callId } : {}) });
    const request = ++flowRequest.current;
    setFlowSelection(previous => ({ ...(previous?.scope === flowScope ? previous : makeFlowSession()), browseTrail, groupId: browseTrail.at(-1)?.viewId, inspector: { kind: 'map' }, request, locate: undefined, visualState: undefined, impact: undefined, region: undefined, selectedPart: undefined }));
  };
  const backFlowView = () => {
    if (!flowScope || flowCurrent.current.scope !== flowScope || flowCurrent.current.trail !== flowTrailKey || !flowTrail.length) return;
    const browseTrail = flowTrail.slice(0, -1), request = ++flowRequest.current, departed = flowTrail.at(-1)!;
    const inspector: FlowInspectorTarget = departed.callId ? { kind: 'call', callId: departed.callId } : { kind: 'map' };
    setFlowSelection(previous => ({ ...(previous?.scope === flowScope ? previous : makeFlowSession()), browseTrail, groupId: browseTrail.at(-1)?.viewId, inspector, request, locate: undefined, visualState: undefined, impact: undefined, region: undefined, selectedPart: undefined }));
  };
  const exitFlowScope = () => flowTarget.kind === 'map' && flowGroupId ? backFlowView() : inspectFlow((flowTarget.kind === 'base' || flowTarget.kind === 'preset') && flowTarget.nodeId ? { kind: 'node', nodeId: flowTarget.nodeId } : { kind: 'map' });
  const flowReferenceNodeId = 'nodeId' in flowTarget ? flowTarget.nodeId : undefined;
  const flowNodeName = flowAllEntries.find(entry => entry.id === flowReferenceNodeId)?.name;
  const flowPresetId = flowTarget.kind === 'preset' ? flowTarget.presetId : undefined;
  const flowScopeName = flowTarget.kind === 'node' ? `当前节点：${flowNodeName ?? '剧情节点'}`
    : flowTarget.kind === 'call' ? `子剧情：${flowEntries.find(entry => entry.callId === (flowTarget.kind === 'call' ? flowTarget.callId : undefined))?.name ?? '子剧情'}`
    : flowTarget.kind === 'group' ? `显示分组：${flowGroups.find(group => flowTarget.kind === 'group' && group.id === flowTarget.groupId)?.name ?? '分组'}`
    : flowTarget.kind === 'edge' ? '连线来源'
    : flowTarget.kind === 'base' ? '本图基础外观'
    : flowTarget.kind === 'preset' ? `外观预设：${project.ui.flowStyles?.find(preset => preset.id === flowPresetId)?.name ?? '预设'}` : flowTarget.kind === 'map' && flowGroupId ? flowView?.name ?? '子剧情' : selectedFlow && playerFlowMode(selectedFlow) === 'custom' ? '本图剧情' : '剧情来源';
  const flowBackLabel = (flowTarget.kind === 'base' || flowTarget.kind === 'preset') && flowTarget.nodeId ? '返回当前节点' : flowTarget.kind === 'map' && flowGroupId ? '返回上一级剧情图' : flowGroupId ? '返回当前剧情图' : '返回整张图';
  const alignmentReferenceId = uiSelectionRoots(pageComponents, selection.ids).length > 1 ? selection.ids.at(-1) : undefined;
  // Explicit object selection (including its hierarchy row) leaves the internal view.
  // The part session uses selection.select directly when entering or changing a part.
  const select = (id?: string, additive = false) => { collectionEditing.clear(); if (!additive && selectedFlow && id === selectedFlow.id) inspectFlow({ kind: 'map' }); else setFlowSelection(undefined); selection.select(id, additive); };
  const selectMany = (ids: readonly string[]) => { collectionEditing.clear(); setFlowSelection(undefined); selection.selectMany(ids); };
  const editScope: UiEditScope = { page, ownerId: page === 'custom' ? activeCustomPage?.id : project.ui.activeInstanceId };
  const [layoutFeedback, setLayoutFeedback] = useState('');
  const [snapEnabled, setSnapEnabled] = useState(() => { try { return localStorage.getItem('vns-ui-smart-snap') !== 'off'; } catch { return true; } });
  useEffect(() => { try { localStorage.setItem('vns-ui-smart-snap', snapEnabled ? 'on' : 'off'); } catch { /* Keep the current session preference. */ } }, [snapEnabled]);
  const selectionKey = selection.ids.join('/');
  useEffect(() => setLayoutFeedback(''), [viewKey, selectionKey]);
  const arrange = (operation: UiArrangement, label: string) => {
    if (collectionPart || flowInternal) return;
    const plan = planUiArrangement(designComponents, selection.ids, project, operation, visibleOnCanvas);
    const problem = plan.problem ?? uiRectChangeProblem(project, editScope, plan.changes);
    if (problem) { setLayoutFeedback(problem); return; }
    if (!plan.changes.length) { setLayoutFeedback('无需调整'); return; }
    commit(label, draft => applyUiRectChanges(draft, editScope, plan.changes), { separate: true });
    setLayoutFeedback(label);
  };
  const listComponents = pageComponents;
  const transform = useUiComponentTransform({ canvas, components: pageComponents, designComponents, page, ownerId: page === 'custom' ? activeCustomPage?.id : activeInstance?.id,
    project, commit, selectedIds: selection.ids, select, canEdit: id => localIds.has(id) || canAdd, visible: visibleOnCanvas, onProblem: setLayoutFeedback, snapEnabled, enabled: !advanced, selectionOnly: !!collectionPart || flowInternal });
  const previewWindow = useUiPreviewWindow(project, pageComponents, activePageId ?? '', assetUrl, onPreviewAction, onPreviewClosed);
  useEffect(() => {
    onPreviewControls?.({ show: previewWindow.show, close: previewWindow.close });
    return () => onPreviewControls?.(undefined);
  }, [onPreviewControls, previewWindow.show, previewWindow.close]);
  const previewButton = <button className="small-button" disabled={!activePageId} aria-pressed={previewWindow.open} title={previewWindow.open ? '显示已打开的当前页面预览' : '从当前页面预览（不执行整条游戏流程）'} onClick={() => void previewWindow.show()}>预览窗口</button>;
  const previewError = previewWindow.error && <div className="ui-event-notice" role="alert">{previewWindow.error}</div>;
  const customPreferences = customLayout || replacesStandardPreferences(pageComponents);
  const canReorder = page === 'custom' || localComponents.length + pageComponents.filter(c => !localIds.has(c.id)).length <= uiComponentLimit;
  const moveFlowNode = (id: string, nodeId: string, position?: { x: number; y: number }) => {
    if (!flowMounted.current || !flowScope || flowCurrent.current.scope !== flowScope || flowCurrent.current.groupId !== flowGroupId || flowCurrent.current.saving || selectedFlow?.id !== id || selectedFlow.editor?.locked || saving || selectedFlow.list?.layout !== 'flow' || !flowEntryIds.has(nodeId)) return;
    if (position && (!Number.isFinite(position.x) || !Number.isFinite(position.y) || position.x < 0 || position.y < 0)) return;
    commit('流程图节点位置', draft => {
      if (!flowMounted.current || flowCurrent.current.scope !== flowScope || flowCurrent.current.groupId !== flowGroupId || flowCurrent.current.saving || draft.id !== project.id || page !== 'custom' && draft.ui.activeInstanceId !== project.ui.activeInstanceId) return;
      const changed = page === 'custom' ? draft.ui.customPages?.find(item => item.id === activeCustomPage?.id)?.components.find(c => c.id === id) : editableUiComponent(draft.ui, id);
      if (!changed || changed.kind !== 'flowchart' || changed.page !== page || changed.editor?.locked || changed.list?.layout !== 'flow' || !playerFlowView(draft, changed, flowGroupId).entries.some(entry => entry.id === nodeId)) return;
      setPlayerFlowPosition(changed, nodeId, position, flowGroupId);
    }, { separate: true });
  };
  const setFlowVisualState = useCallback((value?: UiButtonState) => {
    if (!flowMounted.current || !flowScope || flowCurrent.current.scope !== flowScope || flowCurrent.current.target !== flowTargetKey) return;
    setFlowSelection(previous => { const session = previous?.scope === flowScope ? previous : makeFlowSession(); return JSON.stringify(session.inspector) !== flowTargetKey || session.visualState === value ? previous : { ...session, visualState: value }; });
  }, [flowScope, flowTargetKey]);
  const setFlowImpact = useCallback((value?: UiFlowEditing['impact']) => {
    if (!flowMounted.current || !flowScope || flowCurrent.current.scope !== flowScope || flowCurrent.current.target !== flowTargetKey) return;
    const impact = value ? { nodeIds: [...new Set(value.nodeIds)].filter(id => flowAllEntryIds.has(id)), label: value.label } : undefined;
    setFlowSelection(previous => { const session = previous?.scope === flowScope ? previous : makeFlowSession(); return JSON.stringify(session.inspector) !== flowTargetKey || JSON.stringify(session.impact) === JSON.stringify(impact) ? previous : { ...session, impact }; });
  }, [flowScope, flowTargetKey, flowAllEntryIds]);
  const setFlowPreview = useCallback((value: UiFlowEditing['preview']) => {
    if (!flowMounted.current || !flowScope || flowCurrent.current.scope !== flowScope) return;
    const preview = { mode: value.mode, currentId: value.currentId && flowProgressIds.includes(value.currentId) ? value.currentId : undefined };
    setFlowSelection(previous => { const session = previous?.scope === flowScope ? previous : makeFlowSession(); return JSON.stringify(session.preview) === JSON.stringify(preview) ? previous : { ...session, preview }; });
  }, [flowScope, flowProgressIds]);
  const setFlowRegion = useCallback((region?: UiFlowEditing['region']) => {
    if (!flowMounted.current || !flowScope || flowCurrent.current.scope !== flowScope || flowCurrent.current.target !== flowTargetKey) return;
    setFlowSelection(previous => { const session = previous?.scope === flowScope ? previous : makeFlowSession(); return JSON.stringify(session.inspector) !== flowTargetKey || session.region === region ? previous : { ...session, region }; });
  }, [flowScope, flowTargetKey]);
  const setFlowSelectedPart = useCallback((index: number) => {
    if (!flowMounted.current || !flowScope || flowCurrent.current.scope !== flowScope || flowCurrent.current.target !== flowTargetKey || !Number.isInteger(index) || index < 0) return;
    setFlowSelection(previous => {
      if (!previous || previous.scope !== flowScope || JSON.stringify(previous.inspector) !== flowTargetKey || previous.inspector.kind === 'map') return previous;
      const selectedPart = previous.inspector.kind === 'sources' ? 0 : index;
      return previous.selectedPart === selectedPart ? previous : { ...previous, selectedPart };
    });
  }, [flowScope, flowTargetKey]);
  const flowEditing: UiFlowEditing | undefined = selectedFlow ? {
    componentId: selectedFlow.id,
    groupId: flowGroupId,
    browseTrail: flowTrail, browseNames: flowTrail.map(frame => flowViews?.views.get(frame.viewId)?.name ?? '剧情分组'), view: flowView, enterView: enterFlowView, backView: backFlowView, viewports: flowViewports.current,
    entryIds: playerFlowMode(selectedFlow) === 'custom' || project.nodes.some(node => node.kind === 'call') ? flowProgressIds : undefined,
    enterGroup: groupId => {
      if (!groupId) { backFlowView(); return; }
      const entry = flowEntries.find(item => item.groupId === groupId || item.viewId === groupId);
      const groupView = flowViews && [...flowViews.views.values()].find(view => view.kind === 'group' && view.groupId === groupId && view.parentViewId === flowView?.id);
      if (entry) enterFlowView(entry.viewId ?? entry.groupId!);
      else if (groupView?.id) enterFlowView(groupView.id);
      else if (flowScope && flowViews && flowCurrent.current.scope === flowScope) {
        const candidate = [...flowViews.views.values()].find(view => view.kind === 'group' && view.groupId === groupId);
        const browseTrail = candidate?.id ? flowBrowseTrailToView(flowViews.root, flowViews.views, candidate.id) : undefined;
        if (!browseTrail) return;
        const request = ++flowRequest.current;
        setFlowSelection(previous => ({ ...(previous?.scope === flowScope ? previous : makeFlowSession()), browseTrail, groupId: browseTrail.at(-1)?.viewId, inspector: { kind: 'map' }, request, locate: undefined, visualState: undefined, impact: undefined, region: undefined, selectedPart: undefined }));
      }
    },
    locateSource: onLocateStory,
    inspector: flowTarget, inspect: inspectFlow,
    nodeId: flowReferenceNodeId,
    selectionRequest: storedFlowSession?.request ?? flowRequest.current,
    locate: flowTargetValid ? storedFlowSession?.locate : undefined,
    select: (nodeId, locate = false) => {
      const entry = flowEntries.find(item => item.id === nodeId);
      inspectFlow(!nodeId ? { kind: 'map' } : entry?.callId ? { kind: 'call', callId: entry.callId } : entry?.groupId ? { kind: 'group', groupId: entry.groupId } : { kind: 'node', nodeId }, locate);
    },
    locateNode: nodeId => {
      if (!flowScope || flowCurrent.current.scope !== flowScope || flowCurrent.current.target !== flowTargetKey || !flowAllEntryIds.has(nodeId)) return;
      const request = ++flowRequest.current;
      const browseTrail = flowViews ? flowLocateBrowseTrail(flowViews.root, flowViews.views, nodeId, flowTrail) ?? flowTrail : flowTrail;
      setFlowSelection(previous => previous?.scope === flowScope && JSON.stringify(previous.inspector) === flowTargetKey ? { ...previous, browseTrail, groupId: browseTrail.at(-1)?.viewId, locate: { nodeId, request } } : previous);
    },
    move: moveFlowNode, movable: !selectedFlow.editor?.locked && !saving && selectedFlow.list?.layout === 'flow',
    preview: storedFlowSession?.preview ?? { mode: 'all' }, setPreview: setFlowPreview,
    visualState: flowTargetValid ? storedFlowSession?.visualState : undefined, setVisualState: setFlowVisualState,
    impact: flowTargetValid ? storedFlowSession?.impact : undefined, setImpact: setFlowImpact,
    region: flowTargetValid ? storedFlowSession?.region : undefined, setRegion: setFlowRegion,
    selectedPart: flowTarget.kind === 'map' ? undefined : flowTargetValid ? storedFlowSession?.selectedPart ?? 0 : 0, setSelectedPart: setFlowSelectedPart,
  } : undefined;
  const editInHierarchy = (id: string, change: (component: UiComponent) => void) => commit('调整控件层级', draft => {
    const changed = page === 'custom' ? draft.ui.customPages?.find(item => item.id === activeCustomPage?.id)?.components.find(c => c.id === id) : editableUiComponent(draft.ui, id);
    if (changed) change(changed);
  });
  const reorderInHierarchy = (id: string, targetId: string, placement: 'before' | 'after') => {
    if (!canReorder || collectionPart || flowInternal) return false;
    try {
      const changes = reorderUiList(listComponents, id, targetId, placement, project);
      if (!changes.length) return false;
      if (localComponents.length + changes.filter(item => !localIds.has(item.id)).length > uiComponentLimit) throw new Error('当前界面组件数量已达到上限。');
      commit('调整组件列表顺序', draft => {
        for (const item of changes) {
          const changed = page === 'custom' ? draft.ui.customPages.find(page => page.id === activeCustomPage?.id)?.components.find(c => c.id === item.id) : editableUiComponent(draft.ui, item.id);
          if (changed) Object.assign(changed, item.change);
        }
      });
      setHierarchyError(''); return true;
    } catch (error) { setHierarchyError((error as Error).message); return false; }
  };
  const moveInHierarchy = (id: string, to: number) => {
    const parentId = listComponents.find(c => c.id === id)?.parentId;
    const siblings = uiListOrder(listComponents).filter(c => c.parentId === parentId && visibleInHierarchy(c));
    const from = siblings.findIndex(c => c.id === id);
    if (from < 0 || to < 0 || to >= siblings.length || from === to) return;
    reorderInHierarchy(id, siblings[to].id, to < from ? 'before' : 'after');
  };
  const reparentInHierarchy = (id: string, parentId?: string) => {
    if (!canReorder || collectionPart || flowInternal || !pageComponents.some(c => c.id === id && c.parentId !== parentId)) return false;
    try {
      const change = reparentUiComponent(pageComponents, id, parentId, project);
      editInHierarchy(id, c => { Object.assign(c, change); });
      setHierarchyError('');
      return true;
    } catch (error) { setHierarchyError((error as Error).message); return false; }
  };
  const designRows = useMemo(() => {
    const changes = new Map(transform.preview.map(change => [change.id, change.rect]));
    return resolveUiHierarchy(designComponents.map(c => changes.has(c.id) ? { ...c, ...changes.get(c.id) } : c), {
    design: true, viewport: project, playerOpacity: Number(project.playerDefaults?.dialogueOpacity ?? 1),
    visible: visibleOnCanvas,
    state: c => c.disabled || c.action && !uiActionAvailable(project.ui, c.action) ? 'disabled' : designSnapshots.get(c.id)?.values.selected === true ? 'selected' : previewState === 'idle' && hoveredButton === c.id ? 'hover' : previewState,
    });
  }, [designComponents, designSnapshots, visibleOnCanvas, transform.preview, project.width, project.height, project.ui.disabledPages, project.playerDefaults?.dialogueOpacity, previewState, hoveredButton]);
  const marquee = useUiMarquee({ canvas, rows: designRows, width: project.width, height: project.height, scale: canvasScale,
    scope: JSON.stringify([viewKey, savePreviewMode]), revision: designComponents, enabled: !advanced && !collectionPart && !flowInternal && !playingChapter,
    selectedIds: selection.ids, selectMany, transform });
  const selectedSet = new Set(marquee.previewIds ?? selection.ids);
  const transformComponent = !collectionPart && !flowInternal && !marquee.previewIds && selection.ids.length === 1 ? designRows.find(row => row.component.id === selection.ids[0] && row.visible && !row.component.editor?.locked && (localIds.has(row.component.id) || canAdd))?.component : undefined;
  const commands = useUiEditorCommands({ project, components: pageComponents, designComponents, page, customPageId: activeCustomPage?.id, selectedId, selectedIds: selection.ids, select, selectMany, nudge: delta => arrange({ kind: 'move', delta }, '微调界面组件位置'), commit,
    canEdit: id => localIds.has(id) || canAdd, viewport, enabled: !advanced, visible: visibleOnCanvas,
    partEditing: collectionPart ? { componentId: collectionPart.componentId, onExit: collectionEditing.clear } : flowInternal && selectedFlow ? { componentId: selectedFlow.id, onExit: exitFlowScope, label: `正在编辑${flowScopeName}；在属性面板中调整。`, exitLabel: flowBackLabel } : undefined });
  const singletonKinds = new Set<UiComponent['kind']>(['choiceList', 'saveSlots', ...Object.values(specialPageKinds).filter((kind): kind is UiComponent['kind'] => !!kind)]);
  const has = (kind: UiComponent['kind'], binding?: UiComponent['binding'], preference?: UiComponent['preference']) => pageComponents.some(component => component.kind === kind && (!binding || component.binding === binding) && (!preference || component.preference === preference));
  const add = (kind: UiComponent['kind'], patch: Partial<UiComponent> = {}) => {
    const existing = pageComponents.find(component => singletonKinds.has(kind) ? component.kind === kind : patch.binding ? component.binding === patch.binding : false);
    if (existing) { select(existing.id); return; }
    if (!canAdd) return;
    const id = makeId('ui');
    const specialized = !['text', 'button', 'image', 'video', 'spine', 'choiceList', 'saveSlots', 'preference', 'preferenceChoice'].includes(kind);
    const component: UiComponent = { id, kind, page, text: kind === 'text' ? '新的文字' : kind === 'button' ? page === 'main' ? '开始游戏' : page === 'custom' ? '完成' : '返回' : specialized ? componentNames[kind] : '', action: kind === 'button' ? page === 'main' ? 'start' : 'return' : undefined, assetId: kind === 'image' ? project.assets.find(asset => asset.kind === 'image')?.id : undefined, x: 0.4, y: 0.4, width: kind === 'image' ? 0.3 : specialized ? 0.7 : 0.2, height: kind === 'image' ? 0.3 : specialized ? 0.28 : 0.08, ...patch };
    if (kind === 'choiceList') Object.assign(component, { x: 0.2, y: 0.3, width: 0.6, height: 0.4 }, patch);
    if (kind === 'button' && !component.style?.textColor) component.style = { ...component.style, textColor: '#f5f7f7' };
    if (kind === 'spine') { const asset = project.assets.find(asset => asset.kind === 'spine'); Object.assign(component, { x: 0.2, y: 0.1, width: 0.6, height: 0.6, text: '骨骼动画', assetId: asset?.id, spine: { animation: asset?.spine?.animations[0]?.name, autoplay: true, loop: true, fit: 'contain' } }, patch); }
    if (kind === 'video') Object.assign(component, { x: 0, y: 0, width: 1, height: 1, assetId: project.assets.find(asset => asset.kind === 'video')?.id }, patch);
    if (kind === 'saveSlots') Object.assign(component, { x: 0.035, y: 0.21, width: 0.93, height: 0.72 }, patch);
    if (kind === 'preference') Object.assign(component, { x: 0.08, y: Math.min(0.8, 0.25 + pageComponents.filter(c => c.kind === 'preference').length * 0.1), width: 0.6, height: 0.1, preference: 'musicVolume' }, patch);
    if (kind === 'preferenceChoice') Object.assign(component, { x: 0.3, y: 0.3, width: 0.25, height: 0.06, preference: 'windowSize', selector: { options: playerPreferenceOptions('windowSize') } }, patch);
    if (kind === 'panel') Object.assign(component, { x: 0.2, y: 0.2, width: 0.6, height: 0.6, style: { background: '#182124', opacity: 0.94 } }, patch);
    if (kind === 'progress') Object.assign(component, { x: 0.3, y: 0.5, width: 0.4, height: 0.035, value: 0.5, style: { background: '#283133', selectedBackground: project.ui.accent } }, patch);
    commit('添加界面组件', draft => {
      const components = page === 'custom' ? draft.ui.customPages?.find(item => item.id === activeCustomPage?.id)?.components : localUiComponents(draft.ui);
      if (!components) return;
      if (components.length < uiComponentLimit) components.push(component);
    });
    select(id);
  };
  const materialize = (element: HTMLElement, kind: UiComponent['kind'], patch: Partial<UiComponent> = {}) => {
    if (!canvas.current) return;
    const parent = canvas.current.getBoundingClientRect();
    const bounds = element.getBoundingClientRect();
    add(kind, { x: Math.max(0, (bounds.x - parent.x) / parent.width), y: Math.max(0, (bounds.y - parent.y) / parent.height), width: Math.min(1, bounds.width / parent.width), height: Math.min(1, bounds.height / parent.height), ...patch });
  };
  const native = (name: string, kind: UiComponent['kind'], children: ReactNode, patch: Partial<UiComponent> = {}, className = '', style?: CSSProperties) => <div role="button" tabIndex={0} aria-label={`编辑${name}`} title={`编辑${name}`} className={`ui-native-region ${className}`} style={style} onClick={event => { event.stopPropagation(); materialize(event.currentTarget, kind, patch); }} onKeyDown={event => { if (event.key === 'Enter') materialize(event.currentTarget, kind, patch); }}>{children}</div>;
  const firstPassage = project.nodes.find(node => node.kind === 'passage');
  const firstLine = firstPassage?.kind === 'passage' ? firstPassage.lines[0] : undefined;
  const speaker = firstLine ? project.characters.find(character => character.id === firstLine.speakerId)?.name : '角色名';
  const line = firstLine?.text || '此刻，故事即将展开。';
  const defaultButtons = uiMainButtons.map(([action]) => action).filter(action => uiActionAvailable(project.ui, action));
  const createConfirmation = () => {
    if (localComponents.length + 5 > uiComponentLimit) return;
    const entries: UiComponent[] = [
      { id: makeId('ui'), page: 'messageBox', kind: 'text', text: '', x: 0, y: 0, width: 1, height: 1, style: { background: '#000000', opacity: 0.65 } },
      { id: makeId('ui'), page: 'messageBox', kind: 'text', text: '', x: 0.26, y: 0.29, width: 0.48, height: 0.4, style: { background: project.ui.background } },
      { id: makeId('ui'), page: 'messageBox', kind: 'text', text: '', binding: 'confirmation', x: 0.3, y: 0.34, width: 0.4, height: 0.16, style: { align: 'center' } },
      { id: makeId('ui'), page: 'messageBox', kind: 'button', text: '确定', action: 'confirmYes', x: 0.32, y: 0.56, width: 0.14, height: 0.07 },
      { id: makeId('ui'), page: 'messageBox', kind: 'button', text: '取消', action: 'confirmNo', x: 0.54, y: 0.56, width: 0.14, height: 0.07 },
    ];
    commit('创建确认框布局', draft => {
      localUiComponents(draft.ui).push(...entries);
      const pages = editableUiPages(draft.ui);
      pages.messageBox = { ...pages.messageBox, layout: 'custom', backgroundOpacity: 0 };
    });
    select(entries[2].id);
  };
  const [pageGraphFocus, setPageGraphFocus] = useState<{ scope: string; focus: BlueprintFocus }>();
  useEffect(() => setPageGraphFocus(undefined), [blueprintFocus]);
  const openPageGraph = (graphId: string, nodeId?: string) => {
    authoringSession.graphId = graphId; authoringSession.animationId = undefined; authoringSession.timelineVisits = [];
    setPageGraphFocus(previous => ({ scope: viewKey, focus: { graphId, nodeId, request: (previous?.focus.request ?? 0) + 1 } }));
    setAdvanced(true);
  };
  const addPageNode = (type: BlueprintNodeType, properties: Record<string, VariableValue> = {}) => {
    if (!activePageId) return;
    try {
      let graphId = '', nodeId = '';
      commit('添加页面蓝图节点', draft => {
        const graph = uiEventAuthoringGraph(draft, activePageId, page === 'custom' ? activeCustomPage!.name : uiPageNames[page]);
        if (graph.nodes.length >= 512) throw new Error('节点数量已达到上限。');
        const node = blueprintNodeDefaults(type); Object.assign(node.properties, properties);
        node.x = 420; node.y = Math.max(60, ...graph.nodes.filter(item => item.x >= 350).map(item => item.y + 260));
        graph.nodes.push(node); synchronizeBlueprintSignatures(draft); graphId = graph.id; nodeId = node.id;
      }, { separate: true });
      if (graphId && nodeId) openPageGraph(graphId, nodeId);
    } catch (error) { setHierarchyError(error instanceof Error ? error.message : String(error)); }
  };
  const editPageEvent = (phase: UiPageLifecyclePhase | 'show') => {
    if (!activePageId) return;
    try {
      let graphId = '', nodeId = '';
      commit('页面事件入口', draft => {
        const { graph, node } = ensureUiPageEvent(draft, activePageId, page === 'custom' ? activeCustomPage!.name : uiPageNames[page], phase);
        graphId = graph.id; nodeId = node.id;
      }, { separate: true });
      if (graphId && nodeId) openPageGraph(graphId, nodeId);
    } catch (error) { setHierarchyError(error instanceof Error ? error.message : String(error)); }
  };
  const pageSettingsPanel = <UiPageSettings key={viewKey} project={project} pageId={activePageId ?? ''} components={pageComponents} selectedId={selectedId} commit={commit} assetUrl={assetUrl} usageHint={activePageId && <UiPageUsageHint usages={pageUsages} onOpen={() => setPageDialog({ id: activePageId, mode: 'connect' })} />} onOpenGlobal={onOpenGlobalSettings} onOpenGraph={openPageGraph} onAddNode={addPageNode} onPageEvent={editPageEvent} />;
  const pageInspector = selection.ids.length > 1 && !collectionPart
    ? <UiMultiInspector project={project} scope={{ ...editScope, projectId: project.id }} selectedIds={selection.ids} commit={commit} assetUrl={assetUrl} disabled={!!saving || textPending} onSelect={select} />
    : typeof inspector === 'function' ? inspector({ pageId: activePageId ?? '', onOpenGraph: openPageGraph, previewState, previewComponent: designRows.find(row => row.component.id === selectedId)?.component, onPreviewStateChange: setPreviewState, settings: pageSettingsPanel }) : inspector;
  const selectPage = (id: string) => {
    inspectingDisabled.current = undefined;
    if (id.startsWith('ui:')) setPage(id.slice(3) as UiComponent['page']);
    else { setPage('custom'); if (id !== 'custom') setCustomPageId(id); }
    select(undefined);
  };
  const legacyNote = page === 'chapterTitle' && <div className="ui-legacy-page-note"><p>旧版章节布局：修改不会同步到已生成的时间轴。编辑当前章节请打开对应演出。</p>{onOpenPerformance && chapterEditorEntries(project).map(entry => <button type="button" className="text-button" key={entry.id} onClick={() => onOpenPerformance(entry.target)}>{entry.name} ↗</button>)}</div>;
  const disabledNote = page !== 'custom' && project.ui.disabledPages?.includes(page) && <div className="ui-legacy-page-note" role="status"><p>此页面已停用。可以查看并修复引用，保存修改不会启用页面。</p><button type="button" className="small-button" onClick={() => commit('启用' + uiPageNames[page], draft => enableUiPage(draft, page), { separate: true })}>启用此页面</button></div>;
  const createCustomPage = () => {
    let id = '';
    commit('创建自定义界面', draft => { id = createCustomUiPage(draft, '自定义界面 ' + (customPages.length + 1)).id; }, { separate: true });
    setPage('custom'); setCustomPageId(id); select(undefined);
    setPageDialog(undefined);
  };
  const modeSwitch = <div className="segmented" aria-label="界面编辑模式"><button className={!advanced ? 'active' : undefined} aria-pressed={!advanced} onClick={() => setAdvanced(false)}>设计</button><button className={advanced ? 'active' : undefined} aria-pressed={advanced} onClick={() => setAdvanced(true)}>事件图</button></div>;
  const saveControls = <div className="ui-editor-save-controls"><span className="ui-save-status" data-dirty={!!dirty} role="status" title={saving ? '正在保存界面' : dirty ? '有未保存的修改' : '界面已保存'}>{dirty ? <Circle size={8} aria-hidden="true" /> : <Check size={13} aria-hidden="true" />}<span>{saving ? '保存中…' : dirty ? '未保存' : '已保存'}</span></span>{previewButton}<button className="primary" aria-label="保存界面" disabled={saving || !dirty} onClick={onSave}><Save size={14} aria-hidden="true" /><span>保存界面</span></button></div>;
  const editorHeader = <div className={'workspace-toolbar ui-editor-header' + (advanced ? ' ui-blueprint-header' : '')}>
      {navigation}<div className="ui-editor-mode-group"><strong>界面编辑</strong>{modeSwitch}</div>
      <div className="ui-blueprint-location">
        {advanced && page !== 'custom' && <label className="ui-blueprint-scheme"><span>方案</span><select aria-label="选择界面实例" title={(activeInstance?.name ?? '基础界面') + ' · 选择要编辑并供游戏使用的界面方案'} value={activeInstance?.id ?? ''} onChange={event => { const instanceId = event.target.value || undefined; if (instanceId === project.ui.activeInstanceId) return; commit('切换界面实例', draft => { draft.ui.activeInstanceId = instanceId; }); select(undefined); }}><option value="">基础界面</option>{instances.map(instance => <option key={instance.id} value={instance.id}>{instance.name}</option>)}</select></label>}
        <UiPagePicker project={project} selectedId={activePageId} advanced={advanced} commit={commit} usages={usageIndex} onSelect={selectPage} onChapter={onOpenPerformance} />
        {!advanced && <UiPageOptions key={viewKey} project={project} page={page} customPageId={activeCustomPage?.id} commit={commit} assetUrl={assetUrl} openBlueprint={openBlueprint} createCustomPage={createCustomPage} deleteCustomPage={() => { if (activeCustomPage) setPageDialog({ id: activeCustomPage.id, mode: 'delete' }); }} clearSelection={() => select(undefined)} connectionActions={connectionActions} />}
      </div>
      <div className="spacer" />{saveControls}
    </div>;
  if (advanced) return <div className="ui-workspace ui-advanced-workspace">
    {connectionDialog}{editorHeader}{disabledNote}{legacyNote}
    {previewError}
    <UiLogicEditor saving={saving} pageActions={<>{connectionActions}{pageSettingsPanel}</>} onLocateComponent={locateDesignComponent} session={authoringSession} onLocateUsage={onLocateUsage} openBlueprint={openBlueprint} animationFocus={animationFocus} onActiveAnimation={onActiveAnimation} blueprintFocus={pageGraphFocus?.scope === viewKey ? pageGraphFocus.focus : blueprintFocus} onDesign={()=>setAdvanced(false)} onActiveBlueprint={onActiveBlueprint} selectedComponentId={selectedId} onComponentSelect={select} key={(page === 'custom' ? activeCustomPage?.id : page)+'/'+(project.ui.activeInstanceId??'base')} project={project} components={pageComponents} pageId={page === 'custom' ? activeCustomPage?.id ?? '' : 'ui:' + page} commit={commit} assetUrl={assetUrl}/>
  </div>;
  const canvasTools = <><UiZoomControls viewport={viewport} />{selectedFlow && <UiFlowPreviewControls key={flowScope} project={project} component={selectedFlow} />}<UiToolbarPopover key={viewKey} label="画布预览" title="画布预览：按钮状态与示例内容（不会保存到游戏）" icon={<Eye size={16} />}>
    <p>只影响设计画布，不修改游戏数据。</p>
    <label><span>按钮状态</span><select aria-label="按钮预览状态" value={previewState} onChange={event => setPreviewState(event.target.value as UiButtonState)}>{Object.entries(uiStateNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
    {page === 'save' && <><label><span>预览页面</span><select aria-label="存读档预览页面" value={savePreviewMode} onChange={event => { setSavePreviewMode(event.target.value as 'save' | 'load'); select(undefined); }}><option value="save">存档</option><option value="load">读档</option></select></label><label><span>预览内容</span><select aria-label="存档预览内容" value={savePreviewFilled ? 'filled' : 'empty'} onChange={event => setSavePreviewFilled(event.target.value === 'filled')}><option value="empty">空存档</option><option value="filled">示例存档</option></select></label></>}
    {page === 'chapterTitle' && <><label><span>预览章节</span><select aria-label="预览章节" value={previewChapter?.id ?? ''} onChange={event => setChapterId(event.target.value)}>{chapterNodes.length ? chapterNodes.map(n => <option key={n.id} value={n.id}>{n.title}</option>) : <option value="">示例章节</option>}</select></label><button className="small-button" onClick={() => { setChapterReplay(v => v + 1); setPlayingChapter(true); }}>播放进场</button></>}
  </UiToolbarPopover></>;
  return <UiFlowAuthoringStatusContext.Provider value={{ textPending, saving: !!saving }}><UiFlowEditContext.Provider value={flowEditing}><UiCollectionEditProvider key={viewKey} value={collectionEditing}><div className="ui-workspace" onKeyDownCapture={event => {
    const target = event.target as HTMLElement;
    if (flowInternal && event.key === 'Escape' && !event.defaultPrevented && !event.nativeEvent.isComposing && !target.closest('input,textarea,select,[contenteditable=true],[popover]')) {
      event.preventDefault(); event.stopPropagation(); exitFlowScope(); return;
    }
    commands.keyDown(event);
  }}>
    {marquee.overlay}
    {connectionDialog}
    {commands.menuElement}
    <UiFontFaces project={project} assetUrl={assetUrl} />
    {editorHeader}{disabledNote}{legacyNote}
    {previewError}

    <UiDock autoSizeSettings showReset={false} labels={{ hierarchy: '组件列表', canvas: '画布', settings: collectionPart ? '部件编辑' : flowInternal ? '剧情图编辑' : '布局工具', inspector: '属性' }} panelActions={{ canvas: canvasTools, inspector: selection.ids.length > 1 ? <small className="ui-primary-selection-note" title="共同属性作用于全部所选控件；不同值和不同来源会分别显示。">共同属性 · {selection.ids.length} 项</small> : undefined }} addComponent={<UiAddMenu project={project} page={page} pageId={activePageId} canAdd={canAdd} add={add} specialKind={specialPageKinds[page]} confirmation={!pageComponents.some(c => c.binding === 'confirmation') && localComponents.length + 5 <= uiComponentLimit ? createConfirmation : undefined}/>} panels={{hierarchy: (<UiHierarchy key={focus?.request} viewport={project} components={listComponents} visible={visibleInHierarchy} selectedId={selectedId} selectedIds={selection.ids} referenceId={alignmentReferenceId} select={select} edit={(id, change) => { collectionEditing.clear(); editInHierarchy(id, change); }} move={moveInHierarchy} reparent={reparentInHierarchy} reorder={reorderInHierarchy} canEdit={id => localIds.has(id) || canAdd} canReorder={canReorder && !collectionPart && !flowInternal}
      title={`${page === 'custom' ? activeCustomPage?.name ?? '自定义页面' : uiPageNames[page]} / Canvas`}
      origin={id => page !== 'custom' && activeInstance ? localIds.has(id) ? inheritedIds.has(id) ? '覆盖' : '本地' : '继承' : ''}
      contextMenu={commands.openMenu} highlight={setHighlightedId} previewDrop={setHierarchyDrop} locate={id => { select(id); canvas.current?.querySelector(`[data-component-id="${id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }} />), canvas: (
    <div className="ui-scroll ui-zoom-scroll" ref={viewport.observe} tabIndex={0} aria-label="界面设计画布" aria-description="先单击选中控件，再拖动调整位置。同位置重复单击选择下层控件；点击背景先取消选择，再次点击选中背景。双击集合部件进入编辑。从空白或未选控件上拖框，完整框住的控件会被选中。Shift 追加选择，Ctrl 切换选择，Esc 取消框选。" {...marquee.events}>{hierarchyError && <p role="alert">{hierarchyError}</p>}<div className="ui-zoom-stage"><UiCollectionCanvas className={`ui-canvas page-${page}${overlayCanvas ? ' ui-overlay-canvas' : ''}`} data-ui-zoom-surface ref={observeCanvas} style={{ width: project.width * canvasScale, height: project.height * canvasScale, backgroundColor: overlayCanvas ? undefined : pageSettings?.background ?? effectiveTheme.background, color: effectiveTheme.textColor, fontFamily: uiFontFamily(effectiveTheme.fontAssetId) }} onPointerDownCapture={commands.cycle} onContextMenu={commands.openMenu} onPointerDown={event => {
      // Keep the original empty-canvas exit from internal editing. This gesture
      // only leaves that scope; selecting whole objects needs a fresh pointerdown.
      if ((collectionPart || flowInternal || playingChapter) && event.button === 0 && !event.defaultPrevented && event.target === event.currentTarget) {
        event.preventDefault(); select(undefined);
      }
    }}>
      {page === 'chapterTitle' && <ChapterBackdrop presentation={chapterLook} assetUrl={assetUrl} />}
      {!overlayCanvas && page !== 'chapterTitle' && (pageSettings?.backgroundId || (effectiveTheme.menuBackgroundId && ['main', 'say', 'choice'].includes(page))) && <img className="stage-background" src={assetUrl((pageSettings?.backgroundId ?? effectiveTheme.menuBackgroundId)!)} alt="界面背景" draggable={false} style={{ opacity: pageSettings?.backgroundOpacity ?? 1 }} />}
      {page === 'main' && !customLayout && <>
        <div className="ui-menu-shade" />
        {!has('text', 'title') && native('作品名称', 'text', project.name, { binding: 'title', text: '', style: { fontSize: Math.min(48, Math.max(28, effectiveTheme.fontSize + 8)) } }, 'ui-title-native')}
        <div className="ui-main-menu">{defaultButtons.map(action => <div key={action}>{pageComponents.some(component => replacesMainButton(component, action)) ? <div className="ui-main-menu-item ui-replaced-placeholder">{actionName(action)}</div> : native(actionName(action), 'button', actionName(action), { text: actionName(action), action, nativeSlot: mainButtonSlot(action) }, 'ui-main-menu-item')}</div>)}</div>
        <span className="ui-version">{project.version}</span>
      </>}
      {page === 'say' && <>
        {!customLayout && <>
        <div className="ui-say-window" style={{ height: `${project.ui.dialogueHeight * 100}%`, backgroundColor: has('text', 'speaker') && has('text', 'dialogue') ? undefined : hexOpacity(project.ui.background, project.ui.dialogueOpacity) }}>
          {!has('text', 'speaker') && native('当前说话人', 'text', speaker, { binding: 'speaker', text: '', style: { textColor: effectiveTheme.accent } }, 'ui-speaker-native', { color: effectiveTheme.accent })}
          {!has('text', 'dialogue') && native('当前对白', 'text', line, { binding: 'dialogue', text: '' }, 'ui-dialogue-native', { fontSize: Math.round(effectiveTheme.fontSize * 0.6) })}
        </div></>}{pageSettings?.showQuickMenu !== false && <div className="ui-quick-menu-native">{uiQuickButtons.filter(([action]) => uiActionAvailable(project.ui, action)).map(([, name]) => name).join('　')}</div>}
      </>}
      {page === 'choice' && !customLayout && !has('choiceList') && native('选项列表', 'choiceList', <ChoicePreview project={pageProject} />, {}, 'ui-choice-native')}
      {(page === 'save' || page === 'preferences' || page === 'voiceSettings') && !customLayout && <div className="ui-game-menu-header"><h3>{page === 'save' ? '存档' : uiPageNames[page]}</h3><span>{page === 'voiceSettings' ? '返回设置' : '返回游戏'}</span><nav>{uiMenuButtons.filter(([action]) => uiActionAvailable(project.ui, action)).map(([, name]) => name).join('　')}</nav></div>}
      {page === 'save' && !customLayout && !has('saveSlots') && native('存档槽', 'saveSlots', <SavePreview />, {}, 'ui-save-native')}
      {page === 'messageBox' && !customLayout && <div className="ui-confirmation-native"><p>确定要继续吗？</p><div><span>确定</span><span>取消</span></div><small>点击“创建确认框布局”编辑这些组件</small></div>}
      {page === 'voiceSettings' && !customLayout && <div className="ui-preferences-default">{[...project.characters.map(c => ({ id: c.id, name: c.name })), { id: undefined, name: '旁白及其他' }].map(c => <div key={c.id ?? 'other'}>{!pageComponents.some(item => item.kind === 'preference' && item.preference === 'characterVolume' && item.preferenceCharacterId === c.id) && native(`${c.name}音量`, 'preference', <PreferencePreview project={pageProject} preference="characterVolume" text={c.name} />, { preference: 'characterVolume', preferenceCharacterId: c.id, text: c.name }, 'ui-preference-native')}</div>)}</div>}
      {page === 'preferences' && !customPreferences && <div className="ui-preferences-default">{preferenceInfo(project, 'fullscreen').visible && <><h4>显示</h4><div className="ui-preference-options">{(['window', 'fullscreen'] as const).filter(action => !pageComponents.some(component => component.action === action)).map(action => <span key={action}>{native(actionName(action), 'button', actionName(action), { action, text: actionName(action) })}</span>)}</div></>}
        {(['textSpeed', 'autoForwardTime'] as const).filter(preference => preferenceInfo(project, preference).visible).map(preference => <div key={preference}>{has('preference', undefined, preference) ? <div className="ui-preference-native ui-replaced-placeholder" /> : native(preferenceInfo(project, preference).name, 'preference', <PreferencePreview project={pageProject} preference={preference} />, { preference, text: '' }, 'ui-preference-native')}</div>)}
        {preferenceInfo(project, 'skipAll').visible && <><h4>跳过范围</h4><div className="ui-preference-options">{(['skipSeen', 'skipAll'] as const).filter(action => !pageComponents.some(component => component.action === action)).map(action => <span key={action}>{native(actionName(action), 'button', actionName(action), { action, text: actionName(action) })}</span>)}</div></>}
        {!pageComponents.some(component => component.action === 'transitions') && <div className="ui-preference-options">{native('跳过转场', 'button', '跳过转场', { action: 'transitions', text: '跳过转场' })}</div>}
        {(['musicVolume', 'soundVolume', 'voiceVolume'] as const).filter(preference => preferenceInfo(project, preference).visible).map(preference => <div key={preference}>{has('preference', undefined, preference) ? <div className="ui-preference-native ui-replaced-placeholder" /> : native(preferenceInfo(project, preference).name, 'preference', <PreferencePreview project={pageProject} preference={preference} />, { preference, text: '' }, 'ui-preference-native')}</div>)}
        {!pageComponents.some(component => component.action === 'mute') && native('全部静音', 'button', '全部静音', { action: 'mute', text: '全部静音' }, 'ui-mute-native')}
        {(['masterVolume', 'ambientVolume', 'dialogueOpacity'] as const).filter(preference => preferenceInfo(project, preference).visible).map(preference => <div key={preference}>{has('preference', undefined, preference) ? <div className="ui-preference-native ui-replaced-placeholder" /> : native(preferenceInfo(project, preference).name, 'preference', <PreferencePreview project={pageProject} preference={preference} />, { preference, text: '' }, 'ui-preference-native')}</div>)}
        {preferenceInfo(project, 'characterVolume').visible && uiActionAvailable(project.ui, 'voiceSettings') && !pageComponents.some(component => component.action === 'voiceSettings') && <div className="ui-preference-options">{native('角色音量', 'button', '角色音量', { action: 'voiceSettings', text: '角色音量' })}</div>}
        {standardPreferenceChoices.filter(group => preferenceInfo(project, group.preference).visible).map(group => <div key={group.preference}><h4>{group.title}</h4><div className={`ui-preference-options${group.preference === 'windowSize' ? ' ui-preference-size-options' : ''}`}>{group.options.map(option => <span key={String(option.value)}>{pageComponents.some(component => replacesPreferenceOption(component, group.preference, option.value)) ? <div className="ui-native-region ui-replaced-placeholder">{option.label}</div> : native(option.label, 'button', option.label, { action: 'setPlayerPreference', preference: group.preference, preferenceValue: option.value, text: option.label })}</span>)}</div></div>)}
        {!pageComponents.some(component => component.action === 'resetPreferences') && <div className="ui-preference-options">{native('恢复初始设置', 'button', '恢复初始设置', { action: 'resetPreferences', text: '恢复初始设置' })}</div>}
      </div>}
      {specialPageKinds[page] && !customLayout && !pageComponents.some(component => component.kind === specialPageKinds[page]) && native(uiPageNames[page], specialPageKinds[page]!, <SpecialPagePreview project={project} page={page} />, {}, 'ui-special-page-native')}
      {designRows.filter(row => row.visible).map(({ component, state, geometry }) => {
        const point = component;
        const values = designSnapshots.get(component.id)?.values;
        return <div key={component.id} data-component-id={component.id} data-preview-state={state} className={`ui-component ${component.kind} ${selectedSet.has(component.id) ? 'selected' : ''} ${!marquee.previewIds && component.id === alignmentReferenceId ? 'alignment-reference' : ''} ${highlightedId === component.id ? 'highlighted' : ''} ${component.editor?.locked ? 'locked' : ''}`} style={uiComponentPreviewStyle(project, component, canvasScale, state, point, geometry)}
          title={component.kind === 'button' ? uiTooltip(component) || undefined : undefined}
          onPointerEnter={() => { if (component.kind === 'button') setHoveredButton(component.id); }}
          onPointerLeave={() => { if (component.kind === 'button') setHoveredButton(undefined); }}
          {...transform.handlers(component.id)}>
          {['saveSlots', 'galleryGrid', 'musicTrackList', 'voiceCollection', 'chapterList', 'flowchart', 'historyList'].includes(component.kind) ? <UiCollectionPreview project={pageProject} component={component} geometry={geometry} assetUrl={assetUrl} scale={canvasScale} state={state} filled={savePreviewFilled} saveMode={savePreviewMode} /> : component.kind === 'choiceList' ? <ChoicePreview project={pageProject} component={component} assetUrl={assetUrl} scale={canvasScale} state={state} /> : ['preference', 'preferenceChoice'].includes(component.kind) ? <AuthoredPreferencePreview project={pageProject} component={component} value={values?.numberValue ?? values?.booleanValue ?? values?.stringValue} assetUrl={assetUrl} scale={canvasScale} state={state} /> : <UiComponentContent project={pageProject} component={component} assetUrl={assetUrl} scale={canvasScale} state={state} bindings={{ speaker, dialogue: line, tooltip: hoveredButton ? uiTooltip(designComponents.find(c => c.id === hoveredButton) ?? component) : selectedId === component.id ? '按钮悬停提示' : '', chapterTitle: previewChapter?.title, chapterSubtitle: previewChapter?.subtitle, chapterTitleImageId: previewChapter?.titleImageId }} />}
        </div>;
      })}
      {!collectionPart && !flowInternal && !marquee.previewIds && <UiParentGuide rows={designRows} selectedId={selection.ids.length === 1 ? selection.ids[0] : undefined} drop={hierarchyDrop} width={project.width} height={project.height} />}
      {transformComponent && !hierarchyDrop && <UiTransformHandles component={transformComponent} geometry={designRows.find(row => row.component.id === transformComponent.id)?.geometry} scale={canvasScale} width={project.width} height={project.height} handlers={transform.handlers} />}
      <UiSnapGuides guides={transform.guides} components={designComponents} width={project.width} height={project.height} scale={canvasScale} />
      {page === 'chapterTitle' && playingChapter && <ChapterPreview key={chapterReplay} project={pageProject} node={previewChapter} assetUrl={assetUrl} scale={canvasScale} onComplete={finishChapter} />}
    </UiCollectionCanvas></div>
    </div>), settings: collectionPart && collectionComponent ? <div className="ui-layout-tools" data-ui-part-tools={collectionPart.part}>
      <div className="ui-layout-tool-row" role="toolbar" aria-label="部件编辑工具"><button type="button" className="small-button" aria-label="画布返回整个控件" onClick={collectionEditing.clear}><ChevronLeft size={14} aria-hidden="true" />返回整个控件</button><strong>{collectionInspectorPartName(collectionComponent, collectionPart.part)}</strong></div>
      <div className="ui-layout-help"><span>{collectionInspectorPartScope(collectionComponent, collectionPart.part)}</span><span>在右侧调整部件属性 · Esc 返回整个控件</span></div>
    </div> : flowInternal ? <div className="ui-layout-tools" data-ui-flow-tools={flowTarget.kind}>
      <div className="ui-layout-tool-row" role="toolbar" aria-label="剧情图对象编辑工具"><button type="button" className="small-button" aria-label={`画布${flowBackLabel}`} onClick={exitFlowScope}><ChevronLeft size={14} aria-hidden="true" />{flowBackLabel}</button><strong>{flowScopeName}</strong></div>
      <div className="ui-layout-help"><span>在属性面板中调整当前对象</span><span>Esc {flowBackLabel}</span></div>
    </div> : <UiLayoutToolbar key={viewKey} project={project} components={designComponents} selectedIds={selection.ids} scope={editScope} visible={visibleOnCanvas} arrange={arrange} feedback={layoutFeedback} snapEnabled={snapEnabled} setSnapEnabled={setSnapEnabled} />, inspector: pageInspector}}/>
  </div></UiCollectionEditProvider></UiFlowEditContext.Provider></UiFlowAuthoringStatusContext.Provider>;
}
function ChoicePreview({ project, component, assetUrl, scale = 1, state = 'idle' }: { project: Project; component?: UiComponent; assetUrl?: AssetUrl; scale?: number; state?: UiButtonState }) {
  const editing = useCollectionEditing();
  const choice = project.nodes.find(node => node.kind === 'choice');
  const captions = choice?.kind === 'choice' ? choice.choices.map(option => option.text) : ['一起继续前行', '留在这里'];
  if (!component || !assetUrl) return <div className="ui-choice-preview">{captions.map((caption, index) => <div key={index}>{caption}</div>)}</div>;
  const gap = component.list?.gapY ?? 10;
  const font = component.style?.fontSize ?? project.ui.fontSize;
  const height = Math.max(32, component.list?.itemHeight ?? Math.max(font + 24, Math.min(80, Math.floor((component.height * project.height - gap * Math.max(0, captions.length - 1)) / Math.max(1, captions.length)))));
  const rect = component.list?.caption;
  const align = component.style?.align ?? 'left';
  return <div className="ui-choice-preview" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', gap: gap * scale, width: '100%', height: '100%', overflowY: 'auto', padding: 0 }}>{captions.map((caption, index) => <div data-choice-index={index} {...collectionPartProps(editing, component.id, 'item')} key={index} style={{ flex: 'none', position: 'relative', minHeight: 0, height: height * scale, margin: 0, padding: 0, background: component.skin?.idle ? 'transparent' : component.style?.background, fontSize: Math.min(font, height - 12) * scale }}><UiSkinImage skin={component.skin} state={state} assetUrl={assetUrl} scale={scale} /><span data-choice-caption {...collectionPartProps(editing, component.id, 'caption')} style={{ position: 'absolute', left: rect ? `${rect.x * 100}%` : 12 * scale, top: rect ? `${rect.y * 100}%` : 6 * scale, width: rect ? `max(${scale}px, min(${rect.width * 100}%, ${(1 - rect.x) * 100}%))` : `calc(100% - ${24 * scale}px)`, height: rect ? `max(${scale}px, min(${rect.height * 100}%, ${(1 - rect.y) * 100}%))` : `calc(100% - ${12 * scale}px)`, display: 'flex', alignItems: 'center', justifyContent: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start', textAlign: align }}><span>{caption}</span></span></div>)}</div>;
}
function SavePreview() { return <div className="ui-save-preview"><div className="ui-slot-pages"><span><ChevronLeft size={10} /></span>{['自动', '快速', '1', '2', '3', '4', '5', '6'].map(item => <span key={item}>{item}</span>)}<span><ChevronRight size={10} /></span></div><div className="ui-slot-grid">{Array.from({ length: 6 }, (_, index) => <div className="ui-save-slot" key={index}><div className="ui-slot-image"><span>{String(index + 1).padStart(2, '0')}</span></div><div className="ui-slot-caption"><span>空存档</span><span>删除</span></div></div>)}</div></div>; }
function PreferencePreview({ project, preference, text }: { project: Project; preference: NonNullable<UiComponent['preference']>; text?: string }) {
  const info = preferenceInfo(project, preference);
  const value = Number(info.initial);
  return <div className="ui-preference-preview"><span>{text || info.name}</span><input aria-label={info.name} type="range" min={info.min} max={info.max} step="any" value={preference === 'textSpeed' && value === 0 ? info.max : value} readOnly tabIndex={-1} /></div>;
}
function SpecialPagePreview({ project, page }: { project: Project; page: UiComponent['page'] }) {
  const labels: Record<string, string[]> = {
    pause: uiPauseButtons.filter(([action]) => uiActionAvailable(project.ui, action)).map(([, text]) => text), history: ['对话历史', '暂无对话记录'], gallery: ['CG 图鉴', '未解锁图片', '点击查看大图'], musicRoom: ['音乐室', '播放 / 暂停', '上一首　下一首'], voiceCollection: ['语音收藏', '已解锁语音', '播放语音'], chapterSelect: ['章节选择', '第一章', '第二章'], chapterTitle: ['章节标题', '第一章：归'], messageBox: ['确认对话框', '确认继续吗？'], staff: ['制作人员名单', '编剧　美术　音乐　程序'], keyboard: ['虚拟键盘', '输入文字'], custom: ['自定义页面', '可由蓝图控制的复用界面'], flowchart: ['剧情流程图', '节点　分支　结局'], gameOver: ['游戏结束', '重新开始　返回标题'],
  };
  return <div className="ui-special-preview">{(labels[page] ?? [uiPageNames[page]]).map((label, index) => <div key={`${label}-${index}`} className={index === 0 ? 'ui-special-preview-title' : ''}>{label}</div>)}</div>;
}
export { actionName } from './UiNames';
