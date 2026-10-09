import { addProjectGraphs, projectGraphs } from '../core/project-resources';
import type { UiAnimationFocus } from './ui-animation-editor-focus';
import type { BlueprintFocus } from './BlueprintGraphEditor';
import type { BlueprintSelection, UiPageSelection, UiAnimationSelection } from '../core/ai-selection';
import { UiDock } from './UiDock';
import { UiAddMenu } from './UiAddMenu';
import { availableBlueprintName } from '../core/blueprint-names';
import { UiLogicEditor } from './UiLogicEditor';
import { useUiPreviewWindow, type UiPreviewWindowControls } from './useUiPreviewWindow';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Image, Film, Bone, MousePointer2, SlidersHorizontal, Type, ListFilter, Save, ChevronLeft, ChevronRight, Plus, GitBranch, Trash2, Square, Gauge } from 'lucide-react';
import { editableUiComponent, effectiveUiComponents, effectiveUiTheme, inheritanceReaches, localUiComponents, makeId, orderedUiComponents, sortUiComponents, uiComponentLimit, type Diagnostic, type Project, type UiButtonState, type UiComponent } from '../core/model';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph } from '../core/blueprint';
import { isStandaloneNode, standaloneChapter } from '../core/standalone-performance';
import { expandPreviewActions, previewActionContext } from '../core/preview-actions';
import { editableUiPages, uiSkinAsset, uiStateNames, uiTooltip } from '../core/ui';
import { UiAssetSelect, UiFontFaces, UiSkinImage, uiFontFamily, uiStateColor, uiTextShadow } from './UiAppearance';
import { UiCollectionPreview } from './UiCollectionPreview';
import { SpinePreview } from './SpinePreview';
import { playerPreferenceKeys, playerPreferenceOptions, playerPreferences, replacesPreferenceOption, replacesStandardPreferences, sliderPreferences, standardPreferenceChoices } from '../core/preferences';
import { AuthoredPreferencePreview } from './PlayerPreferences';
import { parameterSets, settingsParameters, parameterValueText } from '../core/parameter-sets';
import type { Commit } from './editor';
import { IconButton } from './components';
import { hexOpacity, type AssetUrl } from './StageEditor';
import { ParameterEditor } from './ParameterEditor';
import { reparentUiComponent, reorderUiList, resolveUiHierarchy, uiListOrder } from '../core/ui-hierarchy';
import { UiHierarchy } from './UiHierarchy';
import { UiParentGuide, type UiParentDrop } from './UiParentGuide';
import { UiTransformHandles } from './UiTransformHandles';
import { useUiComponentTransform } from './useUiComponentTransform';
import { useUiViewport } from './useUiViewport';
import { UiZoomControls } from './UiZoomControls';
import { useUiEditorCommands } from './useUiEditorCommands';
import { UiComponentContent, uiComponentPreviewStyle } from './UiComponentVisual';
import { ChapterBackdrop, ChapterPreview } from './ChapterPreview';
import { chapterEffectNames, chapterPresentation } from '../core/chapter';

import { availableUiPages, actionName, uiPageNames, componentNames, componentName, preferenceNames, bindingNames } from './UiNames';
export { uiPageNames, componentNames, componentName, preferenceNames, bindingNames } from './UiNames';
const specialPageKinds: Partial<Record<UiComponent['page'], UiComponent['kind']>> = {
  pause: 'pauseMenu', history: 'historyList', gallery: 'galleryGrid', musicRoom: 'musicTrackList', voiceCollection: 'voiceCollection',
  chapterSelect: 'chapterList', chapterTitle: 'chapterTitle', staff: 'staffRoll', keyboard: 'keyboard',
  flowchart: 'flowchart', gameOver: 'gameOver',
};

export interface UiFocus { target: NonNullable<Diagnostic['ui']>; request: number; field?: 'action' }
export function UiEditor({ animationFocus, blueprintFocus, project, commit, selectedId, select, assetUrl, openBlueprint, focus, dirty, saving, onSave, onNavigate, advanced = false, onAdvancedChange, inspector, onActiveBlueprint, onActiveAnimation, onActivePage, onPreviewControls }: { animationFocus?:UiAnimationFocus; blueprintFocus?:BlueprintFocus; project: Project; commit: Commit; selectedId?: string; select: (id?: string) => void; assetUrl: AssetUrl; openBlueprint?: (graphId: string) => void; focus?: UiFocus; dirty?: boolean; saving?: boolean; onSave?: () => void; onNavigate?: (action: () => void) => void; advanced?: boolean; onAdvancedChange?: (advanced: boolean) => void; inspector?: ReactNode; onActivePage?: (selection?: UiPageSelection) => void; onActiveAnimation?: (selection?: UiAnimationSelection) => void; onActiveBlueprint?: (selection?: BlueprintSelection) => void; onPreviewControls?: (controls?: UiPreviewWindowControls) => void }) {
  const setAdvanced = (value: boolean) => onAdvancedChange?.(value);
  const [page, setPage] = useState<UiComponent['page']>('main');
  const canvas = useRef<HTMLDivElement>(null);
  const viewport = useUiViewport(project.width, project.height);
  const canvasScale = viewport.scale;
  const [previewState, setPreviewState] = useState<UiButtonState>('idle');
  const [hoveredButton, setHoveredButton] = useState<string>();
  const [savePreviewMode, setSavePreviewMode] = useState<'save' | 'load'>('save');
  const [savePreviewFilled, setSavePreviewFilled] = useState(false);
  const [customPageId, setCustomPageId] = useState(project.ui.customPages?.[0]?.id ?? '');
  const [minigameId, setMinigameId] = useState(project.minigames?.[0]?.id ?? '');
  useEffect(() => {
    if (!focus) return;
    setPage(focus.target.page);
    if (focus.target.customPageId) setCustomPageId(focus.target.customPageId);
    const component = effectiveUiComponents(project.ui).find(component => component.id === focus.target.componentId);
    if (component?.saveMode) setSavePreviewMode(component.saveMode);
  }, [focus]);
  const [hierarchyError, setHierarchyError] = useState('');
  const [highlightedId, setHighlightedId] = useState<string>();
  const [hierarchyDrop, setHierarchyDrop] = useState<UiParentDrop>();
  const [chapterId, setChapterId] = useState('');
  const [chapterReplay, setChapterReplay] = useState(0);
  const [playingChapter, setPlayingChapter] = useState(false);
  const finishChapter = useCallback(() => setPlayingChapter(false), []);
  const chapterNodes = project.nodes.flatMap(node => {
    const action = standaloneChapter(node) ?? (isStandaloneNode(node) ? expandPreviewActions(project, node.lines[0].actions, previewActionContext(project)).find(action => action.kind === 'chapter') : undefined);
    return action?.kind === 'chapter' ? [{ ...action, id: node.id }] : [];
  });
  const previewChapter = chapterNodes.find(n => n.id === chapterId) ?? chapterNodes[0];
  const chapterLook = chapterPresentation(project, previewChapter);
  useEffect(() => setPlayingChapter(false), [page, chapterId, project.ui.activeInstanceId]);
  const instances = project.ui.instances ?? [];
  const customPages = project.ui.customPages ?? [];
  const activeCustomPage = customPages.find(item => item.id === customPageId) ?? customPages[0];
  const activePageId=page==='custom'?activeCustomPage?.id:'ui:'+page;
  useEffect(()=>{onActivePage?.(activePageId?{pageId:activePageId,...(page!=='custom'?{uiInstanceId:project.ui.activeInstanceId??'base'}:{}),mode:advanced?'events':'design'}:undefined);},[activePageId, page, project.ui.activeInstanceId, advanced, onActivePage]);
  useEffect(()=>()=>onActivePage?.(undefined),[onActivePage]);
  const pageMinigames = (project.minigames ?? []).filter(item => item.uiPageId === activeCustomPage?.id);
  const activeMinigame = pageMinigames.find(item => item.id === minigameId) ?? pageMinigames[0];
  useEffect(() => { if (project.ui.disabledPages?.includes(page)) { setPage('main'); select(undefined); } }, [page, project.ui.disabledPages]);
  const effectiveTheme = effectiveUiTheme(project.ui);
  const pageSettings = page === 'custom' ? activeCustomPage ? { layout: 'custom' as const, backgroundId: activeCustomPage.backgroundId, background: activeCustomPage.background, backgroundOpacity: 1 } : undefined : effectiveTheme.pages?.[page];
  const customLayout = page === 'custom' || pageSettings?.layout === 'custom';
  useEffect(() => {
    if (!activeCustomPage && customPages[0]) setCustomPageId(customPages[0].id);
  }, [activeCustomPage, customPages]);
  useEffect(() => {
    if (page !== 'custom') return;
    const first = (project.minigames ?? []).find(item => item.uiPageId === activeCustomPage?.id);
    if (!activeMinigame && first) setMinigameId(first.id);
  }, [page, activeCustomPage?.id, activeMinigame, project.minigames]);
  const observeCanvas = useCallback((element: HTMLDivElement | null) => {
    canvas.current = element;
  }, []);
  const activeInstance = instances.find(instance => instance.id === project.ui.activeInstanceId);
  const localComponents = page === 'custom' ? activeCustomPage?.components ?? [] : localUiComponents(project.ui);
  const localIds = new Set(localComponents.map(component => component.id));
  const inheritedIds = new Set(page !== 'custom' && activeInstance ? effectiveUiComponents({ ...project.ui, activeInstanceId: activeInstance.baseUiId }).map(component => component.id) : []);
  const canAdd = (page !== 'custom' || !!activeCustomPage) && localComponents.length < uiComponentLimit;
  const canCreateInstance = instances.length < 64;
  const derivedInstances = activeInstance ? instances.filter(instance => instance.baseUiId === activeInstance.id) : [];
  const pageComponents = useMemo(() => page === 'custom' ? sortUiComponents(activeCustomPage?.components ?? []) : orderedUiComponents(project.ui).filter(component => component.page === page), [project.ui, page, activeCustomPage]);
  const listComponents = useMemo(() => page === 'custom' ? activeCustomPage?.components ?? [] : effectiveUiComponents(project.ui).filter(component => component.page === page), [project.ui, page, activeCustomPage]);
  const transform = useUiComponentTransform({ canvas, components: pageComponents, page, ownerId: page === 'custom' ? activeCustomPage?.id : activeInstance?.id,
    project, commit, select, canEdit: id => localIds.has(id) || canAdd });
  const previewWindow = useUiPreviewWindow(project, pageComponents, activePageId ?? '', assetUrl);
  useEffect(() => {
    onPreviewControls?.({ show: previewWindow.show, close: previewWindow.close });
    return () => onPreviewControls?.(undefined);
  }, [onPreviewControls, previewWindow.show, previewWindow.close]);
  const previewButton = <button className="small-button" disabled={!activePageId} aria-pressed={previewWindow.open} title={previewWindow.open ? '显示已打开的预览窗口' : '在独立窗口预览当前页面'} onClick={() => void previewWindow.show()}>预览窗口</button>;
  const previewError = previewWindow.error && <div className="ui-event-notice" role="alert">{previewWindow.error}</div>;
  const customPreferences = customLayout || replacesStandardPreferences(pageComponents);
  const unplacedParameters = page === 'preferences' ? settingsParameters(project).filter(variable => variable.setting?.visible !== false && !pageComponents.some(component => component.parameterId === variable.id)) : [];
  const visibleInHierarchy = (component: UiComponent) => page !== 'save' || !component.saveMode || component.saveMode === savePreviewMode;
  const canReorder = page === 'custom' || localComponents.length + pageComponents.filter(c => !localIds.has(c.id)).length <= uiComponentLimit;
  const editInHierarchy = (id: string, change: (component: UiComponent) => void) => commit('调整控件层级', draft => {
    const changed = page === 'custom' ? draft.ui.customPages?.find(item => item.id === activeCustomPage?.id)?.components.find(c => c.id === id) : editableUiComponent(draft.ui, id);
    if (changed) change(changed);
  });
  const reorderInHierarchy = (id: string, targetId: string, placement: 'before' | 'after') => {
    if (!canReorder) return false;
    try {
      const changes = reorderUiList(listComponents, id, targetId, placement);
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
    if (!canReorder || !pageComponents.some(c => c.id === id && c.parentId !== parentId)) return false;
    try {
      const change = reparentUiComponent(pageComponents, id, parentId);
      editInHierarchy(id, c => { Object.assign(c, change); });
      setHierarchyError('');
      return true;
    } catch (error) { setHierarchyError((error as Error).message); return false; }
  };
  const designRows = useMemo(() => resolveUiHierarchy(pageComponents.map(c => transform.preview?.id === c.id ? { ...c, ...transform.preview.rect } : c), {
    design: true, playerOpacity: Number(project.playerDefaults?.dialogueOpacity ?? 1),
    visible: c => page !== 'save' || !c.saveMode || c.saveMode === savePreviewMode,
    state: c => c.disabled ? 'disabled' : previewState === 'idle' && hoveredButton === c.id ? 'hover' : previewState,
  }), [pageComponents, transform.preview, project.playerDefaults?.dialogueOpacity, page, savePreviewMode, previewState, hoveredButton]);
  const transformComponent = designRows.find(row => row.component.id === selectedId && row.visible && !row.component.editor?.locked && (localIds.has(row.component.id) || canAdd))?.component;
  const commands = useUiEditorCommands({ project, components: pageComponents, page, customPageId: activeCustomPage?.id, selectedId, select, commit,
    canEdit: id => localIds.has(id) || canAdd, viewport, enabled: !advanced });
  const singletonKinds = new Set<UiComponent['kind']>(['choiceList', 'saveSlots', ...Object.values(specialPageKinds).filter((kind): kind is UiComponent['kind'] => !!kind)]);
  const createInstance = (derived: boolean) => {
    if (!canCreateInstance) return;
    const id = makeId('ui_instance');
    commit(derived ? '创建派生界面实例' : '新建界面实例', draft => {
      const items = draft.ui.instances ??= [];
      if (items.length >= 64) return;
      items.push({ id, name: derived && activeInstance ? `${activeInstance.name.slice(0, 114)} 派生` : `界面实例 ${items.length + 1}`, baseUiId: derived ? activeInstance?.id : undefined, components: [] });
      draft.ui.activeInstanceId = id;
    });
    select(undefined);
  };
  const has = (kind: UiComponent['kind'], binding?: UiComponent['binding'], preference?: UiComponent['preference']) => pageComponents.some(component => component.kind === kind && (!binding || component.binding === binding) && (!preference || component.preference === preference));
  const add = (kind: UiComponent['kind'], patch: Partial<UiComponent> = {}) => {
    const existing = pageComponents.find(component => singletonKinds.has(kind) ? component.kind === kind : patch.binding ? component.binding === patch.binding : false);
    if (existing) { select(existing.id); return; }
    if (!canAdd) return;
    const id = makeId('ui');
    const specialized = !['text', 'button', 'image', 'video', 'spine', 'choiceList', 'saveSlots', 'preference', 'preferenceChoice'].includes(kind);
    const component: UiComponent = { id, kind, page, text: kind === 'text' ? '新的文字' : kind === 'button' ? page === 'main' ? '开始游戏' : page === 'custom' ? '完成' : '返回' : specialized ? componentNames[kind] : '', action: kind === 'button' ? page === 'main' ? 'start' : page === 'custom' ? 'minigameSuccess' : 'return' : undefined, assetId: kind === 'image' ? project.assets.find(asset => asset.kind === 'image')?.id : undefined, x: 0.4, y: 0.4, width: kind === 'image' ? 0.3 : specialized ? 0.7 : 0.2, height: kind === 'image' ? 0.3 : specialized ? 0.28 : 0.08, ...patch };
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
  const defaultButtons: NonNullable<UiComponent['action']>[] = ['start', 'load', 'preferences', 'gallery', 'music', 'quit'];
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
  const createCustomPage = () => {
    const id = makeId('custom_page'), name = '自定义界面 ' + (customPages.length + 1);
    const graph = createBlueprintGraph('ui', availableBlueprintName(project, '界面交互'));
    const buttonId = makeId('ui');
    const open = blueprintNodeDefaults('showUiPage'); open.properties = { pageId: id, wait: true }; open.x = 480;
    const click = blueprintNodeDefaults('eventClick'); click.properties.componentId = buttonId; click.y = 450;
    const close = blueprintNodeDefaults('closeUiPage'); close.properties = { pageId: id, result: '完成' }; close.x = 480; close.y = 450;
    graph.nodes.push(open, click, close); connectBlueprintPins(graph, graph.nodes[0].id, 'exec', open.id, 'exec_in'); connectBlueprintPins(graph, click.id, 'exec', close.id, 'exec_in');
    const components: UiComponent[] = [
      { id: makeId('ui'), page: 'custom', kind: 'text', text: name, name: '页面标题', x: 0.25, y: 0.2, width: 0.5, height: 0.15, style: { align: 'center', fontSize: 32 } },
      { id: buttonId, page: 'custom', kind: 'button', text: '关闭', name: '关闭按钮', x: 0.4, y: 0.7, width: 0.2, height: 0.1 },
    ];
    commit('创建自定义界面', draft => { draft.ui.customPages.push({ id, name, components, background: draft.ui.background, modal: true }); addProjectGraphs(draft, graph); });
    setPage('custom'); setCustomPageId(id); setMinigameId(''); select(undefined);
  };
  const createMinigame = () => {
    if (!activeCustomPage || (project.minigames?.length ?? 0) >= 128) return;
    const graph = createBlueprintGraph('minigame', availableBlueprintName(project, '小游戏逻辑'));
    const id = makeId('minigame');
    commit('创建小游戏定义', draft => {
      addProjectGraphs(draft, graph);
      (draft.minigames ??= []).push({ id, name: `小游戏 ${(project.minigames?.length ?? 0) + 1}`, mode: 'blueprint', blueprintId: graph.id, uiPageId: activeCustomPage.id });
    });
    setMinigameId(id);
  };
  if (advanced) return <div className="ui-workspace ui-advanced-workspace">
    <div className="workspace-toolbar"><strong>界面蓝图 · {page === 'custom' ? activeCustomPage?.name : uiPageNames[page]}</strong><div className="segmented" aria-label="界面编辑模式"><button onClick={()=>setAdvanced(false)}>设计</button><button className="active" aria-pressed="true">事件图</button></div><span>{dirty ? '有未保存的修改' : '已保存'}</span><div className="spacer"/>{previewButton}<button className="primary" disabled={saving || !dirty} onClick={onSave}>保存界面</button></div>
    {previewError}
    <div className="workspace-toolbar"><label>当前页面<select aria-label="事件图页面" value={page==='custom'?activeCustomPage?.id??'':'ui:'+page} onChange={e=>{const id=e.target.value;const change=()=>{if(id.startsWith('ui:'))setPage(id.slice(3) as UiComponent['page']);else{setPage('custom');setCustomPageId(id);}select(undefined);};if(onNavigate)onNavigate(change);else change();}}>{availableUiPages(project.ui).filter(([id])=>id!=='custom').map(([id,name])=><option key={id} value={'ui:'+id}>{name}</option>)}{customPages.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><span>{activeInstance?.name??'默认界面'} · 控件与事件属于当前页面</span></div>
    <UiLogicEditor animationFocus={animationFocus} onActiveAnimation={onActiveAnimation} blueprintFocus={blueprintFocus} onDesign={()=>setAdvanced(false)} onActiveBlueprint={onActiveBlueprint} selectedComponentId={selectedId} onComponentSelect={select} key={(page === 'custom' ? activeCustomPage?.id : page)+'/'+(project.ui.activeInstanceId??'base')} project={project} components={pageComponents} pageId={page === 'custom' ? activeCustomPage?.id ?? '' : 'ui:' + page} commit={commit} assetUrl={assetUrl}/>
  </div>;
  return <div className="ui-workspace" onKeyDownCapture={commands.keyDown}>
    {commands.menuElement}
    <UiFontFaces project={project} assetUrl={assetUrl} />
    <div className="workspace-toolbar"><strong>界面编辑</strong><div className="segmented" aria-label="界面编辑模式"><button className="active" aria-pressed="true">设计</button><button onClick={()=>setAdvanced(true)}>事件图</button></div><span>{dirty ? '有未保存的修改' : '已保存'}</span><div className="spacer" />{previewButton}<button className="primary" disabled={saving || !dirty} onClick={onSave}><Save size={15} />保存界面</button></div>
    {previewError}
    <div className="workspace-toolbar ui-toolbar"><label className="ui-page-picker"><span>当前页面</span><select aria-label="设计页面" value={page} onChange={event => { const key = event.target.value as UiComponent['page']; const navigate = () => { setPage(key); select(undefined); }; if (key !== page && onNavigate) onNavigate(navigate); else navigate(); }}>{availableUiPages(project.ui).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label><UiZoomControls viewport={viewport} /></div>

    <UiDock addComponent={<UiAddMenu project={project} page={page} canAdd={canAdd} add={add} specialKind={specialPageKinds[page]} confirmation={!pageComponents.some(c => c.binding === 'confirmation') && localComponents.length + 5 <= uiComponentLimit ? createConfirmation : undefined}/>} panels={{hierarchy: (<UiHierarchy key={focus?.request} components={listComponents} visible={visibleInHierarchy} selectedId={selectedId} select={select} edit={editInHierarchy} move={moveInHierarchy} reparent={reparentInHierarchy} reorder={reorderInHierarchy} canEdit={id => localIds.has(id) || canAdd} canReorder={canReorder}
      title={`${page === 'custom' ? activeCustomPage?.name ?? '自定义页面' : uiPageNames[page]} / Canvas`}
      origin={id => page !== 'custom' && activeInstance ? localIds.has(id) ? inheritedIds.has(id) ? '覆盖' : '本地' : '继承' : ''}
      contextMenu={commands.openMenu} highlight={setHighlightedId} previewDrop={setHierarchyDrop} locate={id => { select(id); canvas.current?.querySelector(`[data-component-id="${id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }} />), canvas: (
    <div className="ui-scroll ui-zoom-scroll" ref={viewport.observe} tabIndex={0} aria-label="界面设计画布">{hierarchyError && <p role="alert">{hierarchyError}</p>}<div className="ui-zoom-stage"><div className={`ui-canvas page-${page}`} data-ui-zoom-surface ref={observeCanvas} style={{ width: project.width * canvasScale, height: project.height * canvasScale, backgroundColor: pageSettings?.background ?? effectiveTheme.background, color: effectiveTheme.textColor, fontFamily: uiFontFamily(effectiveTheme.fontAssetId) }} onPointerDownCapture={commands.cycle} onContextMenu={commands.openMenu} onClick={event => { if (event.target === event.currentTarget) select(undefined); }}>
      {page === 'chapterTitle' && <ChapterBackdrop presentation={chapterLook} assetUrl={assetUrl} />}
      {page !== 'chapterTitle' && (pageSettings?.backgroundId || (effectiveTheme.menuBackgroundId && ['main', 'say', 'choice'].includes(page))) && <img className="stage-background" src={assetUrl((pageSettings?.backgroundId ?? effectiveTheme.menuBackgroundId)!)} alt="界面背景" draggable={false} style={{ opacity: pageSettings?.backgroundOpacity ?? 1 }} />}
      {page === 'main' && !customLayout && <>
        <div className="ui-menu-shade" />
        {!has('text', 'title') && native('作品名称', 'text', project.name, { binding: 'title', text: '', style: { fontSize: Math.min(48, Math.max(28, project.ui.fontSize + 8)) } }, 'ui-title-native')}
        <div className="ui-main-menu">{defaultButtons.map(action => <div key={action}>{pageComponents.some(component => component.kind === 'button' && component.action === action) ? <div className="ui-main-menu-item ui-replaced-placeholder">{actionName(action)}</div> : native(actionName(action), 'button', actionName(action), { text: actionName(action), action }, 'ui-main-menu-item')}</div>)}</div>
        <span className="ui-version">{project.version}</span>
      </>}
      {page === 'say' && <>
        {!customLayout && <>
        <div className="ui-say-window" style={{ height: `${project.ui.dialogueHeight * 100}%`, backgroundColor: has('text', 'speaker') && has('text', 'dialogue') ? undefined : hexOpacity(project.ui.background, project.ui.dialogueOpacity) }}>
          {!has('text', 'speaker') && native('当前说话人', 'text', speaker, { binding: 'speaker', text: '', style: { textColor: project.ui.accent } }, 'ui-speaker-native', { color: project.ui.accent })}
          {!has('text', 'dialogue') && native('当前对白', 'text', line, { binding: 'dialogue', text: '' }, 'ui-dialogue-native', { fontSize: Math.round(project.ui.fontSize * 0.6) })}
        </div></>}{pageSettings?.showQuickMenu !== false && <div className="ui-quick-menu-native">回退　历史　跳过　自动　存档　读档　设置</div>}
      </>}
      {page === 'choice' && !customLayout && !has('choiceList') && native('选项列表', 'choiceList', <ChoicePreview project={project} />, {}, 'ui-choice-native')}
      {(page === 'save' || page === 'preferences' || page === 'voiceSettings') && !customLayout && <div className="ui-game-menu-header"><h3>{page === 'save' ? '存档' : uiPageNames[page]}</h3><span>{page === 'voiceSettings' ? '返回设置' : '返回游戏'}</span><nav>存档　读档　设置　历史　画廊　音乐　返回标题</nav></div>}
      {page === 'save' && !customLayout && !has('saveSlots') && native('存档槽', 'saveSlots', <SavePreview />, {}, 'ui-save-native')}
      {page === 'messageBox' && !customLayout && <div className="ui-confirmation-native"><p>确定要继续吗？</p><div><span>确定</span><span>取消</span></div><small>点击“创建确认框布局”编辑这些组件</small></div>}
      {page === 'voiceSettings' && !customLayout && <div className="ui-preferences-default">{[...project.characters.map(c => ({ id: c.id, name: c.name })), { id: undefined, name: '旁白及其他' }].map(c => <div key={c.id ?? 'other'}>{!pageComponents.some(item => item.kind === 'preference' && item.preference === 'characterVolume' && item.preferenceCharacterId === c.id) && native(`${c.name}音量`, 'preference', <PreferencePreview project={project} preference="characterVolume" text={c.name} />, { preference: 'characterVolume', preferenceCharacterId: c.id, text: c.name }, 'ui-preference-native')}</div>)}</div>}
      {page === 'preferences' && !customPreferences && <div className="ui-preferences-default"><h4>显示</h4><div className="ui-preference-options">{(['window', 'fullscreen'] as const).filter(action => !pageComponents.some(component => component.action === action)).map(action => <span key={action}>{native(actionName(action), 'button', actionName(action), { action, text: actionName(action) })}</span>)}</div>
        {(['textSpeed', 'autoForwardTime'] as const).map(preference => <div key={preference}>{has('preference', undefined, preference) ? <div className="ui-preference-native ui-replaced-placeholder" /> : native(preferenceNames[preference], 'preference', <PreferencePreview project={project} preference={preference} />, { preference, text: '' }, 'ui-preference-native')}</div>)}
        <h4>跳过范围</h4><div className="ui-preference-options">{(['skipSeen', 'skipAll'] as const).filter(action => !pageComponents.some(component => component.action === action)).map(action => <span key={action}>{native(actionName(action), 'button', actionName(action), { action, text: actionName(action) })}</span>)}</div>
        {!pageComponents.some(component => component.action === 'transitions') && <div className="ui-preference-options">{native('跳过转场', 'button', '跳过转场', { action: 'transitions', text: '跳过转场' })}</div>}
        {(['musicVolume', 'soundVolume', 'voiceVolume'] as const).map(preference => <div key={preference}>{has('preference', undefined, preference) ? <div className="ui-preference-native ui-replaced-placeholder" /> : native(preferenceNames[preference], 'preference', <PreferencePreview project={project} preference={preference} />, { preference, text: '' }, 'ui-preference-native')}</div>)}
        {!pageComponents.some(component => component.action === 'mute') && native('全部静音', 'button', '全部静音', { action: 'mute', text: '全部静音' }, 'ui-mute-native')}
        {(['masterVolume', 'ambientVolume', 'dialogueOpacity'] as const).map(preference => <div key={preference}>{has('preference', undefined, preference) ? <div className="ui-preference-native ui-replaced-placeholder" /> : native(preferenceNames[preference], 'preference', <PreferencePreview project={project} preference={preference} />, { preference, text: '' }, 'ui-preference-native')}</div>)}
        {!pageComponents.some(component => component.action === 'voiceSettings') && <div className="ui-preference-options">{native('角色音量', 'button', '角色音量', { action: 'voiceSettings', text: '角色音量' })}</div>}
        {standardPreferenceChoices.map(group => <div key={group.preference}><h4>{group.title}</h4><div className={`ui-preference-options${group.preference === 'windowSize' ? ' ui-preference-size-options' : ''}`}>{group.options.map(option => <span key={String(option.value)}>{pageComponents.some(component => replacesPreferenceOption(component, group.preference, option.value)) ? <div className="ui-native-region ui-replaced-placeholder">{option.label}</div> : native(option.label, 'button', option.label, { action: 'setPlayerPreference', preference: group.preference, preferenceValue: option.value, text: option.label })}</span>)}</div></div>)}
        {!pageComponents.some(component => component.action === 'resetPreferences') && <div className="ui-preference-options">{native('恢复初始设置', 'button', '恢复初始设置', { action: 'resetPreferences', text: '恢复初始设置' })}</div>}
        {parameterSets(project).filter(set => set.kind === 'settings').map(set => { const parameters = unplacedParameters.filter(variable => variable.parameterSetId === set.id); return !!parameters.length && <div key={set.id}><h4>{set.name}</h4>{parameters.map(variable => <div key={variable.id}>{native(variable.name, 'preference', <div className="ui-preference-preview"><span>{variable.name}</span><span>{parameterValueText(variable.initial)}</span></div>, { parameterId: variable.id, text: variable.name }, 'ui-preference-native')}</div>)}</div>; })}
      </div>}
      {page === 'preferences' && customPreferences && !!unplacedParameters.length && <span className="ui-parameter-more" title="运行时打开尚未放置的自定义设置">更多设置</span>}
      {specialPageKinds[page] && !customLayout && !pageComponents.some(component => component.kind === specialPageKinds[page]) && native(uiPageNames[page], specialPageKinds[page]!, <SpecialPagePreview page={page} />, {}, 'ui-special-page-native')}
      {designRows.filter(row => row.visible).map(({ component, state }) => {
        const point = component;
        return <div key={component.id} data-component-id={component.id} data-preview-state={state} className={`ui-component ${component.kind} ${selectedId === component.id ? 'selected' : ''} ${highlightedId === component.id ? 'highlighted' : ''} ${component.editor?.locked ? 'locked' : ''}`} style={uiComponentPreviewStyle(project, component, canvasScale, state, point)}
          title={component.kind === 'button' ? uiTooltip(component) || undefined : undefined}
          onPointerEnter={() => { if (component.kind === 'button') setHoveredButton(component.id); }}
          onPointerLeave={() => { if (component.kind === 'button') setHoveredButton(undefined); }}
          {...transform.handlers(component.id)}>
          {['saveSlots', 'galleryGrid', 'musicTrackList', 'voiceCollection', 'chapterList', 'flowchart', 'historyList'].includes(component.kind) ? <UiCollectionPreview project={project} component={component} assetUrl={assetUrl} scale={canvasScale} state={state} filled={savePreviewFilled} saveMode={savePreviewMode} /> : component.kind === 'choiceList' ? <ChoicePreview project={project} component={component} assetUrl={assetUrl} scale={canvasScale} state={state} /> : ['preference', 'preferenceChoice'].includes(component.kind) ? <AuthoredPreferencePreview project={project} component={component} assetUrl={assetUrl} scale={canvasScale} state={state} /> : <UiComponentContent project={project} component={component} assetUrl={assetUrl} scale={canvasScale} state={state} bindings={{ speaker, dialogue: line, tooltip: hoveredButton ? uiTooltip(pageComponents.find(c => c.id === hoveredButton) ?? component) : selectedId === component.id ? '按钮悬停提示' : '', chapterTitle: previewChapter?.title, chapterSubtitle: previewChapter?.subtitle, chapterTitleImageId: previewChapter?.titleImageId }} />}
        </div>;
      })}
      <UiParentGuide rows={designRows} selectedId={selectedId} drop={hierarchyDrop} width={project.width} height={project.height} />
      {transformComponent && !hierarchyDrop && <UiTransformHandles component={transformComponent} width={project.width} height={project.height} handlers={transform.handlers} />}
      {page === 'chapterTitle' && playingChapter && <ChapterPreview key={chapterReplay} project={project} node={previewChapter} assetUrl={assetUrl} scale={canvasScale} onComplete={finishChapter} />}
    </div></div>
    </div>), settings: (<>    {page === 'custom' && <div className="workspace-toolbar ui-instance-toolbar ui-custom-page-toolbar">
      <label><span>交互页面</span><select aria-label="选择自定义页面" value={activeCustomPage?.id ?? ''} onChange={event => { setCustomPageId(event.target.value); setMinigameId(''); select(undefined); }}><option value="">选择页面</option>{customPages.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <div className="ui-instance-actions"><IconButton title="新建自定义页面" disabled={customPages.length >= 64} onClick={createCustomPage}><Plus size={16} /></IconButton><IconButton title={pageMinigames.length ? '先删除使用此页面的小游戏定义' : '删除自定义页面'} disabled={!activeCustomPage || pageMinigames.length > 0} onClick={() => {
        if (!activeCustomPage) return;
        const nextId = customPages.find(item => item.id !== activeCustomPage.id)?.id ?? '';
        commit('删除自定义页面', draft => { draft.ui.customPages = draft.ui.customPages?.filter(item => item.id !== activeCustomPage.id) ?? []; });
        setCustomPageId(nextId); select(undefined);
      }}><Trash2 size={16} /></IconButton></div>
      {activeCustomPage && <label><span>页面名称</span><input aria-label="自定义页面名称" maxLength={120} value={activeCustomPage.name} onChange={event => { if (event.target.value.trim()) commit('自定义页面名称', draft => { const target = draft.ui.customPages?.find(item => item.id === activeCustomPage.id); if (target) target.name = event.target.value; }); }} /></label>}
      <output className="ui-component-count">组件 {localComponents.length}/{uiComponentLimit}</output>
    </div>}
    {page !== 'custom' && <div className="workspace-toolbar ui-instance-toolbar">
      <label title="选择要编辑并供游戏使用的界面方案；派生方案可以继承基础方案的控件和主题。"><span>界面方案</span><select aria-label="选择界面实例" value={activeInstance?.id ?? ''} onChange={event => {
        const instanceId = event.target.value || undefined;
        commit('切换界面实例', draft => { draft.ui.activeInstanceId = instanceId; });
        select(undefined);
      }}><option value="">主题默认</option>{instances.map(instance => <option key={instance.id} value={instance.id}>{instance.name}</option>)}</select></label>
      <div className="ui-instance-actions">
        <IconButton title={canCreateInstance ? '新建界面实例' : '界面实例已达 64 个'} disabled={!canCreateInstance} onClick={() => createInstance(false)}><Plus size={16} /></IconButton>
        <IconButton title="创建派生界面实例" disabled={!activeInstance || !canCreateInstance} onClick={() => createInstance(true)}><GitBranch size={16} /></IconButton>
        <IconButton title={derivedInstances.length ? `被 ${derivedInstances.length} 个界面实例继承，无法删除` : '删除界面实例'} disabled={!activeInstance || derivedInstances.length > 0} onClick={() => {
          if (!activeInstance || derivedInstances.length) return;
          commit('删除界面实例', draft => {
            if (draft.ui.instances?.some(instance => instance.baseUiId === activeInstance.id)) return;
            draft.ui.instances = draft.ui.instances?.filter(instance => instance.id !== activeInstance.id);
            draft.ui.activeInstanceId = activeInstance.baseUiId;
          });
          select(undefined);
        }}><Trash2 size={16} /></IconButton>
      </div>
      {activeInstance && <>
        <label><span>名称</span><input aria-label="界面实例名称" maxLength={120} value={activeInstance.name} onChange={event => {
          const name = event.target.value;
          if (!name.trim()) return;
          commit('界面实例名称', draft => { const instance = draft.ui.instances?.find(item => item.id === activeInstance.id); if (instance) instance.name = name; });
        }} /></label>
        <label><span>继承自</span><select aria-label="基础界面实例" value={activeInstance.baseUiId ?? ''} onChange={event => {
          const baseUiId = event.target.value || undefined;
          commit('界面实例继承', draft => {
            const items = draft.ui.instances ?? [];
            if (inheritanceReaches(items, baseUiId, activeInstance.id, item => item.baseUiId)) return;
            const instance = items.find(item => item.id === activeInstance.id);
            if (instance) instance.baseUiId = baseUiId;
          });
          select(undefined);
        }}><option value="">主题默认</option>{instances.filter(instance => !inheritanceReaches(instances, instance.id, activeInstance.id, item => item.baseUiId)).map(instance => <option key={instance.id} value={instance.id}>{instance.name}</option>)}</select></label>
        <label><span>界面蓝图</span><select aria-label="界面实例蓝图" value={activeInstance.blueprintId ?? ''} onChange={event => commit('界面实例蓝图', draft => { const instance = draft.ui.instances?.find(item => item.id === activeInstance.id); if (instance) instance.blueprintId = event.target.value || undefined; })}><option value="">不绑定</option>{(projectGraphs(project) ?? []).map(graph => <option key={graph.id} value={graph.id}>{graph.name}</option>)}</select></label>
      </>}
      <output className="ui-component-count" title="当前界面的本地组件数量">本地 {localComponents.length}/{uiComponentLimit}</output>
    </div>}
    {page === 'custom' && <div className="workspace-toolbar ui-instance-toolbar ui-minigame-toolbar">
      <label><span>小游戏</span><select aria-label="选择小游戏定义" value={activeMinigame?.id ?? ''} onChange={event => setMinigameId(event.target.value)}><option value="">选择小游戏</option>{pageMinigames.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <div className="ui-instance-actions"><IconButton title="为此页面新建小游戏" disabled={!activeCustomPage || (project.minigames?.length ?? 0) >= 128} onClick={createMinigame}><Plus size={16} /></IconButton><IconButton title={activeMinigame && project.nodes.some(node => node.kind === 'minigame' && node.minigameId === activeMinigame.id) ? '剧情节点正在使用此小游戏' : '删除小游戏定义'} disabled={!activeMinigame || project.nodes.some(node => node.kind === 'minigame' && node.minigameId === activeMinigame.id)} onClick={() => {
        if (!activeMinigame) return;
        const nextId = pageMinigames.find(item => item.id !== activeMinigame.id)?.id ?? '';
        commit('删除小游戏定义', draft => { draft.minigames = (draft.minigames ?? []).filter(item => item.id !== activeMinigame.id); });
        setMinigameId(nextId);
      }}><Trash2 size={16} /></IconButton></div>
      {activeMinigame && <><label><span>名称</span><input aria-label="小游戏名称" maxLength={120} value={activeMinigame.name} onChange={event => { if (event.target.value.trim()) commit('小游戏名称', draft => { const target = draft.minigames?.find(item => item.id === activeMinigame.id); if (target) target.name = event.target.value; }); }} /></label>
        <label><span>逻辑来源</span><select aria-label="小游戏逻辑来源" value={activeMinigame.mode} onChange={event => commit('小游戏逻辑来源', draft => { const target = draft.minigames?.find(item => item.id === activeMinigame.id); if (!target) return; target.mode = event.target.value as 'blueprint' | 'script'; if (target.mode === 'blueprint') target.blueprintId ??= projectGraphs(draft)?.find(item => item.kind === 'minigame')?.id; else { const scriptAsset = draft.assets.find(item => item.kind === 'script'); if (!scriptAsset) return; target.script ??= { assetId: scriptAsset.id, entry: 'minigame_main', args: {} }; target.script.assetId ||= scriptAsset.id; } })}><option value="blueprint">蓝图</option><option value="script" disabled={!project.assets.some(item => item.kind === 'script')}>Ren'Py 脚本</option></select></label>
        {activeMinigame.mode === 'blueprint' ? <label><span>逻辑蓝图</span><select aria-label="小游戏逻辑蓝图" value={activeMinigame.blueprintId ?? ''} onChange={event => commit('小游戏逻辑蓝图', draft => { const target = draft.minigames?.find(item => item.id === activeMinigame.id); if (target) target.blueprintId = event.target.value || undefined; })}><option value="">选择蓝图</option>{(projectGraphs(project) ?? []).filter(item => item.kind === 'minigame').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : <><label><span>脚本素材</span><select aria-label="小游戏脚本素材" value={activeMinigame.script?.assetId ?? ''} onChange={event => commit('小游戏脚本素材', draft => { const target = draft.minigames?.find(item => item.id === activeMinigame.id); if (target) target.script = { assetId: event.target.value, entry: target.script?.entry ?? 'minigame_main', args: target.script?.args ?? {} }; })}><option value="">选择 .rpy 脚本</option>{project.assets.filter(item => item.kind === 'script').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span>入口 Label</span><input aria-label="小游戏脚本入口" value={activeMinigame.script?.entry ?? ''} onChange={event => { if (/^[a-z][a-z0-9_]{0,63}$/.test(event.target.value)) commit('小游戏脚本入口', draft => { const target = draft.minigames?.find(item => item.id === activeMinigame.id); if (target) target.script = { assetId: target.script?.assetId ?? '', entry: event.target.value, args: target.script?.args ?? {} }; }); }} /></label><div className="minigame-script-args"><span>入口参数</span><ParameterEditor value={activeMinigame.script?.args ?? {}} onChange={args => commit('小游戏脚本参数', draft => { const target = draft.minigames?.find(item => item.id === activeMinigame.id); if (target?.script) target.script.args = args; })} /></div></>}
      </>}
      {activeMinigame?.mode === 'blueprint' && activeMinigame.blueprintId && openBlueprint && <button className="text-button" onClick={() => openBlueprint(activeMinigame.blueprintId!)}><GitBranch size={13} />编辑逻辑蓝图</button>}
    </div>}
    <div className="workspace-toolbar ui-page-toolbar">
      {page !== 'custom' && <label>页面布局<select aria-label="当前页面布局" value={pageSettings?.layout ?? 'native'} onChange={event => commit('页面布局', draft => { const pages = editableUiPages(draft.ui); pages[page] = { ...pages[page], layout: event.target.value as 'native' | 'custom' }; })}><option value="native">标准布局</option><option value="custom">全部自定义</option></select></label>}
      <label>页面背景<UiAssetSelect assetUrl={assetUrl} project={project} kind="image" value={pageSettings?.backgroundId} label="当前页面背景" empty="主题默认" onChange={value => commit('页面背景', draft => { if (page === 'custom') { const target = draft.ui.customPages?.find(item => item.id === activeCustomPage?.id); if (target) target.backgroundId = value; } else { const pages = editableUiPages(draft.ui); pages[page] = { ...pages[page], backgroundId: value }; } })} /></label>
      {page === 'custom' && activeCustomPage && <><label>底色<input aria-label="自定义页面底色" type="color" value={activeCustomPage.background ?? effectiveTheme.background} onChange={event => commit('自定义页面底色', draft => { const target = draft.ui.customPages?.find(item => item.id === activeCustomPage.id); if (target) target.background = event.target.value; })} /></label><label className="ui-inline-check"><input type="checkbox" checked={activeCustomPage.modal} onChange={event => commit('自定义页面模态', draft => { const target = draft.ui.customPages?.find(item => item.id === activeCustomPage.id); if (target) target.modal = event.target.checked; })} />阻止下层交互</label><label>显示事件<select aria-label="自定义页面显示事件" value={activeCustomPage.onShowBlueprintId ?? ''} onChange={event => commit('自定义页面显示事件', draft => { const target = draft.ui.customPages?.find(item => item.id === activeCustomPage.id); if (target) target.onShowBlueprintId = event.target.value || undefined; })}><option value="">不执行</option>{(projectGraphs(project) ?? []).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></>}
      <label>预览状态<select aria-label="按钮预览状态" value={previewState} onChange={event => setPreviewState(event.target.value as UiButtonState)}>{Object.entries(uiStateNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
      {page === 'save' && <><label>预览页面<select aria-label="存读档预览页面" value={savePreviewMode} onChange={event => { setSavePreviewMode(event.target.value as 'save' | 'load'); select(undefined); }}><option value="save">存档</option><option value="load">读档</option></select></label><label>预览内容<select aria-label="存档预览内容" value={savePreviewFilled ? 'filled' : 'empty'} onChange={event => setSavePreviewFilled(event.target.value === 'filled')}><option value="empty">空存档</option><option value="filled">示例存档</option></select></label></>}
      {page === 'say' && <label className="ui-inline-check"><input type="checkbox" aria-label="显示底部快捷菜单" checked={pageSettings?.showQuickMenu ?? true} onChange={event => commit('快捷菜单显示', draft => { const pages = editableUiPages(draft.ui); pages[page] = { ...pages[page], showQuickMenu: event.target.checked }; })} />底部快捷菜单</label>}
      {page === 'chapterTitle' && <><label>预览章节<select aria-label="预览章节" value={previewChapter?.id ?? ''} onChange={event => setChapterId(event.target.value)}>{chapterNodes.length ? chapterNodes.map(n => <option key={n.id} value={n.id}>{n.title}</option>) : <option value="">示例章节</option>}</select></label><label>默认进场<select aria-label="默认章节进场效果" value={effectiveTheme.chapterTransition?.effect ?? 'fade'} onChange={event => commit('章节进场效果', draft => { draft.ui.chapterTransition = { ...draft.ui.chapterTransition, effect: event.target.value as 'none' | 'fade' | 'ink' }; })}>{Object.entries(chapterEffectNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><button className="small-button" onClick={() => { setChapterReplay(v => v + 1); setPlayingChapter(true); }}>播放进场</button></>}
    </div>
</>), inspector}}/>
  </div>;
}
function ChoicePreview({ project, component, assetUrl, scale = 1, state = 'idle' }: { project: Project; component?: UiComponent; assetUrl?: AssetUrl; scale?: number; state?: UiButtonState }) {
  const choice = project.nodes.find(node => node.kind === 'choice');
  const captions = choice?.kind === 'choice' ? choice.choices.map(option => option.text) : ['一起继续前行', '留在这里'];
  if (!component || !assetUrl) return <div className="ui-choice-preview">{captions.map((caption, index) => <div key={index}>{caption}</div>)}</div>;
  const gap = component.list?.gapY ?? 10;
  const font = component.style?.fontSize ?? project.ui.fontSize;
  const height = Math.max(32, component.list?.itemHeight ?? Math.max(font + 24, Math.min(80, Math.floor((component.height * project.height - gap * Math.max(0, captions.length - 1)) / Math.max(1, captions.length)))));
  const rect = component.list?.caption;
  const align = component.style?.align ?? 'left';
  return <div className="ui-choice-preview" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', gap: gap * scale, width: '100%', height: '100%', overflowY: 'auto', padding: 0 }}>{captions.map((caption, index) => <div data-choice-index={index} key={index} style={{ flex: 'none', position: 'relative', minHeight: 0, height: height * scale, margin: 0, padding: 0, background: component.skin?.idle ? 'transparent' : component.style?.background, fontSize: Math.min(font, height - 12) * scale }}><UiSkinImage skin={component.skin} state={state} assetUrl={assetUrl} scale={scale} /><span data-choice-caption style={{ position: 'absolute', left: rect ? `${rect.x * 100}%` : 12 * scale, top: rect ? `${rect.y * 100}%` : 6 * scale, width: rect ? `max(${scale}px, min(${rect.width * 100}%, ${(1 - rect.x) * 100}%))` : `calc(100% - ${24 * scale}px)`, height: rect ? `max(${scale}px, min(${rect.height * 100}%, ${(1 - rect.y) * 100}%))` : `calc(100% - ${12 * scale}px)`, display: 'flex', alignItems: 'center', justifyContent: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start', textAlign: align }}><span>{caption}</span></span></div>)}</div>;
}
function SavePreview() { return <div className="ui-save-preview"><div className="ui-slot-pages"><span><ChevronLeft size={10} /></span>{['自动', '快速', '1', '2', '3', '4', '5', '6'].map(item => <span key={item}>{item}</span>)}<span><ChevronRight size={10} /></span></div><div className="ui-slot-grid">{Array.from({ length: 6 }, (_, index) => <div className="ui-save-slot" key={index}><div className="ui-slot-image"><span>{String(index + 1).padStart(2, '0')}</span></div><div className="ui-slot-caption"><span>空存档</span><span>删除</span></div></div>)}</div></div>; }
function PreferencePreview({ project, preference, text }: { project: Project; preference: NonNullable<UiComponent['preference']>; text?: string }) {
  const info = playerPreferences[preference];
  const value = Number(project.playerDefaults?.[preference] ?? info.initial);
  return <div className="ui-preference-preview"><span>{text || info.name}</span><input aria-label={info.name} type="range" min={info.min} max={info.max} step="any" value={preference === 'textSpeed' ? value === 0 ? info.max : value - 1 : value} readOnly tabIndex={-1} /></div>;
}
function SpecialPagePreview({ page }: { page: UiComponent['page'] }) {
  const labels: Record<string, string[]> = {
    pause: ['继续游戏', '存档', '设置', '返回标题'], history: ['对话历史', '暂无对话记录'], gallery: ['CG 图鉴', '未解锁图片', '点击查看大图'], musicRoom: ['音乐室', '播放 / 暂停', '上一首　下一首'], voiceCollection: ['语音收藏', '已解锁语音', '播放语音'], chapterSelect: ['章节选择', '第一章', '第二章'], chapterTitle: ['章节标题', '第一章：归'], messageBox: ['消息框标题', '这里显示系统消息或提示。'], staff: ['制作人员名单', '编剧　美术　音乐　程序'], keyboard: ['虚拟键盘', '可自定义小游戏控件'], custom: ['自定义页面', '可由蓝图控制的复用界面'], flowchart: ['剧情流程图', '节点　分支　结局'], gameOver: ['游戏结束', '重新开始　返回标题'],
  };
  return <div className="ui-special-preview">{(labels[page] ?? [uiPageNames[page]]).map((label, index) => <div key={`${label}-${index}`} className={index === 0 ? 'ui-special-preview-title' : ''}>{label}</div>)}</div>;
}
export { actionName } from './UiNames';
