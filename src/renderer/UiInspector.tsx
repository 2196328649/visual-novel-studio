import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Box, Eye, Layers, List, MousePointer2, Paintbrush, RotateCcw, Search, Trash2, X } from 'lucide-react';
import { editableUiComponent, effectiveUiComponents, localUiComponents, uiComponentLimit, type Project, type UiButtonState, type UiComponent } from '../core/model';
import { applyUiDesignProperty } from '../core/ui-design-properties';
import { uiPropertyControlDesignSnapshot } from '../core/ui-property-control-snapshot';
import { uiPropertyControlFor } from '../core/ui-property-control';
import { uiControlKindName } from '../core/ui-control-authoring';
import { hideInheritedUiObject, removeUiObject, restoreInheritedUiObject } from '../core/ui-hierarchy-edit';
import { uiComponentPageId } from '../core/ui-page-settings';
import { uiInspectorSearchLabels } from '../core/ui-inspector-search';
import type { CollectionPart } from '../core/ui-collection-layout';
import { collectionInspectorParts, collectionInspectorPartKeywords, collectionInspectorPartName, collectionInspectorPartScope } from '../core/ui-collection-inspector';
import { resolveUiLayout, uiLayoutProblem, uiLayoutValues } from '../core/ui-layout';
import { componentName, componentNames } from './UiNames';
import { Field } from './components';
import { NumberInput } from './NumberInput';
import { UiPropertyGroup } from './UiPropertyGroup';
import { UiPropertyControlProvider } from './UiPropertyControl';
import { UiInspectorProvider, UiInspectorSearchScope, useUiInspectorGroupActive } from './UiInspectorContext';
import { UiInspectorBindings, UiInspectorContent, inspectorCollectionKinds, uiInspectorContentSummary } from './UiInspectorContent';
import { UiCommonAppearance } from './UiCommonAppearance';
import { UiInspectorOpacity } from './UiInspectorVisibility';
import { UiInspectorInteraction, UiInspectorVisibilityRule, uiInspectorInteractionSummary } from './UiInspectorInteraction';
import { UiCollectionInspector, UiCollectionPartInspector } from './UiCollectionInspector';
import { useCollectionEditing } from './UiCollectionEditing';
import { UiPreferenceFields } from './PlayerPreferences';
import { UiLayoutFields } from './UiLayoutFields';
import { UiChildObjects } from './UiChildObjects';
import { UiPropertyCapabilities } from './UiPropertyCapabilities';
import { UiFlowInspector } from './UiFlowInspector';
import { UiFlowAuthoringStatusContext, UiFlowEditContext, type FlowInspectorTarget } from './UiFlowEditing';
import { playerFlowAllEntries, playerFlowGroups, playerFlowMode, playerFlowView } from '../core/player-flow-content';
import type { UiInspectorPageContext } from './UiPageSettings';
import type { Commit } from './editor';
import type { AssetUrl } from './StageEditor';
import './ui-inspector.css';

type EditComponent = (change: (component: UiComponent) => void, options?: { separate?: boolean }) => void;
type GeometryUnit = 'percent' | 'pixel';
/** Common authoring shell. The group session belongs to a task, while field
 * drafts belong to the selected component. Neither changes project data. */
export function ThemeInspector({ project, id, selectionRequest, pageContext, commit, assetUrl, selectUi, onParameter }: {
  project: Project; id?: string; selectionRequest?: string; pageContext?: UiInspectorPageContext;
  commit: Commit; assetUrl: AssetUrl; selectUi?: (id?: string) => void; onParameter?: (id: string) => void;
}) {
  const all = useMemo(() => effectiveUiComponents(project.ui), [project.ui]);
  const customCandidate = project.ui.customPages.find(page => page.components.some(component => component.id === id));
  const candidate = customCandidate?.components.find(item => item.id === id) ?? all.find(item => item.id === id);
  const component = candidate && (!pageContext || uiComponentPageId(project, candidate) === pageContext.pageId) ? candidate : undefined;
  const custom = component ? customCandidate : undefined;
  const propertyPreview = useMemo(() => component ? uiPropertyControlDesignSnapshot(project, component) : undefined, [project, component]);
  const peers = useMemo(() => custom?.components ?? all.filter(item => item.page === component?.page), [custom?.components, all, component?.page]);
  const instance = custom ? undefined : project.ui.instances?.find(item => item.id === project.ui.activeInstanceId);
  const local = custom?.components ?? localUiComponents(project.ui);
  const localComponent = local.find(item => item.id === id);
  const inherited = useMemo(() => instance ? effectiveUiComponents({ ...project.ui, activeInstanceId: instance.baseUiId }) : [], [project.ui, instance]);
  const baseComponent = inherited.find(item => item.id === id);
  const actualKind = component ? uiControlKindName(project, component) || componentNames[component.kind] : '页面';
  const keywords = useMemo(() => ({
    content: component ? uiInspectorSearchLabels(project, component, 'content') : [],
    layout: component ? uiInspectorSearchLabels(project, component, 'layout') : [],
    appearance: component ? uiInspectorSearchLabels(project, component, 'appearance') : [],
    interaction: component ? uiInspectorSearchLabels(project, component, 'interaction') : [],
    visibility: component ? uiInspectorSearchLabels(project, component, 'visibility') : [],
    children: component ? uiInspectorSearchLabels(project, component, 'children') : [],
    collectionLayout: component ? uiInspectorSearchLabels(project, component, 'collection-layout') : [],
  }), [component, project.variables, project.ui, project.assets, project.minigames]);
  const pageId = pageContext?.pageId || (component ? uiComponentPageId(project, component) : '');
  const scope = custom ? custom.id : project.ui.activeInstanceId ?? 'base';
  const taskKey = JSON.stringify([project.id, pageId, scope, actualKind]);
  const pageTaskKey = JSON.stringify([project.id, pageId, scope, 'page']);
  const [section, setSection] = useState<'component' | 'page'>(component ? 'component' : 'page');
  const activeSection = component ? section : 'page';
  const [searches, setSearches] = useState<Record<string, string>>({});
  const [units, setUnits] = useState<Record<string, GeometryUnit>>({});
  const unit = units[taskKey] ?? 'percent';
  const [localState, setLocalState] = useState<UiButtonState>('idle');
  const state = pageContext?.previewState ?? localState;
  const changeState = pageContext?.onPreviewStateChange ?? setLocalState;
  const [notice, setNotice] = useState('');
  const root = useRef<HTMLDivElement>(null), header = useRef<HTMLDivElement>(null), scrollPositions = useRef(new Map<string, number>());
  const status = useContext(UiFlowAuthoringStatusContext), flowEditing = useContext(UiFlowEditContext);
  const collectionEditing = useCollectionEditing();
  const availableParts = component ? collectionInspectorParts(component) : [];
  const requestedPart = collectionEditing?.selection && collectionEditing.selection.componentId === id ? collectionEditing.selection : undefined;
  const selectedPart = requestedPart && availableParts.includes(requestedPart.part) ? requestedPart : undefined;
  const part = selectedPart?.part;
  const flowTarget = component?.kind === 'flowchart' && flowEditing && flowEditing.componentId === id ? flowEditing.inspector : undefined;
  const flowSubview = flowTarget && flowTarget.kind !== 'map' ? flowTarget : undefined;
  const flowKey = flowSubview ? JSON.stringify([flowSubview, flowEditing?.groupId, flowEditing?.browseTrail]) : '';
  const flowNode = useMemo(() => component && flowSubview && 'nodeId' in flowSubview ? playerFlowAllEntries(project, component).find(entry => entry.id === flowSubview.nodeId) : undefined, [project, component, flowKey]);
  const flowLocal = component && playerFlowMode(component) === 'custom';
  const flowTitle = flowSubview?.kind === 'node' ? flowNode?.name ?? '剧情节点'
    : flowSubview?.kind === 'call' && component ? playerFlowView(project, component, flowEditing?.groupId).entries.find(entry => entry.callId === flowSubview.callId)?.name ?? '子剧情'
    : flowSubview?.kind === 'group' && component ? playerFlowGroups(component).find(group => group.id === flowSubview.groupId)?.name ?? '显示分组'
    : flowSubview?.kind === 'edge' ? '连线来源'
    : flowSubview?.kind === 'base' ? '本图基础外观' : flowSubview?.kind === 'preset' ? project.ui.flowStyles?.find(preset => preset.id === flowSubview.presetId)?.name ?? '节点外观预设' : flowLocal ? '本图剧情' : '显示的剧情';
  const internalView = !!part || !!flowSubview;
  const currentTaskKey = part ? JSON.stringify([taskKey, 'part', part]) : flowSubview ? JSON.stringify([taskKey, id, 'flow', flowKey]) : taskKey;
  const query = searches[currentTaskKey] ?? '', rootQuery = searches[taskKey] ?? '';
  const changeSearch = (value: string, target = currentTaskKey) => setSearches(previous => ({ ...previous, [target]: value }));
  const identity = JSON.stringify([project.id, scope, pageId, id, component?.kind, component?.kind === 'flowchart' ? playerFlowMode(component) : undefined]);
  const latest = useRef({ identity, part, flowKey, section: activeSection, saving: status.saving });
  latest.current = { identity, part, flowKey, section: activeSection, saving: status.saving };
  const mounted = useRef(true);
  const searching = activeSection === 'component' && !!query.trim();
  const scrollKey = activeSection === 'page' ? pageTaskKey : `${currentTaskKey}/${searching ? 'search' : 'component'}`;

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setSection(component ? 'component' : 'page'); setNotice(''); }, [id, selectionRequest, pageContext?.pageId, !!component]);
  useLayoutEffect(() => {
    const scroll = root.current?.closest<HTMLElement>('.inspector-scroll'), element = header.current;
    if (!scroll || !element) return;
    const measure = () => scroll.style.setProperty('--ui-inspector-sticky-height', `${element.offsetHeight + 12}px`);
    const observer = new ResizeObserver(measure); observer.observe(element); measure();
    return () => { observer.disconnect(); scroll.style.removeProperty('--ui-inspector-sticky-height'); };
  }, []);
  useLayoutEffect(() => {
    const scroll = root.current?.closest<HTMLElement>('.inspector-scroll');
    if (!scroll) return;
    scroll.scrollTop = scrollPositions.current.get(scrollKey) ?? 0;
    const remember = () => scrollPositions.current.set(scrollKey, scroll.scrollTop);
    scroll.addEventListener('scroll', remember, { passive: true });
    return () => scroll.removeEventListener('scroll', remember);
  }, [scrollKey, identity]);
  useEffect(() => {
    if (requestedPart && !selectedPart) collectionEditing?.clear();
  }, [requestedPart, selectedPart, collectionEditing?.clear]);
  useEffect(() => {
    if (part) setSection('component');
  }, [part, collectionEditing?.request]);
  useEffect(() => {
    const reveal = selectedPart?.reveal;
    if (!part || !reveal) return;
    changeSearch('', currentTaskKey);
    const frame = requestAnimationFrame(() => {
      if (latest.current.identity !== identity || latest.current.part !== part) return;
      const target = root.current?.querySelector<HTMLElement>(`.ui-inspector-view:not([hidden]) [data-ui-inspector-group="part-${reveal}"]`);
      target?.scrollIntoView({ block: 'start' });
      target?.querySelector<HTMLElement>(':scope > summary')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [identity, part, selectedPart?.reveal, collectionEditing?.request]);
  useEffect(() => {
    if (flowEditing && flowEditing.componentId === id && flowEditing.selectionRequest !== undefined) setSection('component');
  }, [id, flowEditing?.selectionRequest]);

  const canEdit = !!component && (!!localComponent || local.length < uiComponentLimit);
  const current = (expectedPart?: CollectionPart, expectedFlow = '') => mounted.current && latest.current.identity === identity && latest.current.part === expectedPart && latest.current.flowKey === expectedFlow && latest.current.section === 'component' && !latest.current.saving;
  const resolveScopedComponent = (draft: Project) => {
    if (!component) return;
    const target = custom
      ? draft.ui.customPages.find(page => page.id === custom.id)?.components.find(item => item.id === component.id)
      : effectiveUiComponents(draft.ui).find(item => item.id === component.id);
    if (!target || target.kind !== component.kind || target.page !== component.page || uiComponentPageId(draft, target) !== pageId) return;
    return target;
  };
  const commitInScope = (expectedFlow = ''): Commit => (label, change, options) => {
    if (!current(undefined, expectedFlow)) return;
    commit(label, draft => {
      if (current(undefined, expectedFlow) && draft.id === project.id && (custom || draft.ui.activeInstanceId === project.ui.activeInstanceId) && resolveScopedComponent(draft)) change(draft);
    }, options);
  };
  const scopedCommit = commitInScope(), flowCommit = commitInScope(flowKey);
  const editInScope = (expectedPart?: CollectionPart, expectedFlow = ''): EditComponent => (change, options) => {
    if (!component || !canEdit || !current(expectedPart, expectedFlow)) return;
    try {
      commit(`界面控件 ${component.id}`, draft => {
        if (draft.id !== project.id || !current(expectedPart, expectedFlow)) return;
        if (!custom && draft.ui.activeInstanceId !== project.ui.activeInstanceId) return;
        const candidate = resolveScopedComponent(draft);
        if (!candidate) return;
        const target = custom ? candidate : editableUiComponent(draft.ui, component.id);
        if (target) change(target);
      }, options);
      setNotice('');
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  };
  const editComponent = editInScope(), editPart = editInScope(part), editFlow = editInScope(undefined, flowKey);
  const isCollection = !!component && inspectorCollectionKinds.has(component.kind);
  const isControl = component?.kind === 'preference' || component?.kind === 'preferenceChoice';
  const source = custom ? '自定义页面' : instance ? baseComponent ? localComponent ? `${instance.name} · 整控件覆盖` : `沿用${project.ui.instances?.find(item => item.id === instance.baseUiId)?.name ?? '基础界面'}` : `${instance.name} · 本方案控件` : '基础界面';
  const hidden = instance?.hiddenComponentIds?.map(hiddenId => instance.components.find(item => item.id === hiddenId) ?? inherited.find(item => item.id === hiddenId)).filter((item): item is UiComponent => !!item && uiComponentPageId(project, item) === pageId) ?? [];
  const partName = component && part ? collectionInspectorPartName(component, part) : '';
  const previewComponent = propertyPreview?.component ?? component;
  const visibleControl = component && uiPropertyControlFor(project, component, 'visible');
  const visibleSummary = visibleControl ? `${visibleControl.control.mode === 'sync' ? '同步' : '跟随'}：${project.variables.find(item => item.id === visibleControl.control.parameterId)?.name ?? '参数已删除'}` : component?.visibleWhen ? '按条件显示' : '始终显示';
  const partKeywords = component && part ? collectionInspectorPartKeywords(component, part) : { layout: '', appearance: '' };
  const leavePart = () => {
    collectionEditing?.clear();
    requestAnimationFrame(() => header.current?.querySelector<HTMLElement>('[data-ui-inspector-breadcrumb]')?.focus({ preventScroll: true }));
  };
  const navigateFlow = (target: FlowInspectorTarget) => {
    flowEditing?.inspect?.(target);
    requestAnimationFrame(() => header.current?.querySelector<HTMLElement>('[data-ui-inspector-breadcrumb]')?.focus({ preventScroll: true }));
  };
  const layout = component && <>
    <UiInspectorGeometry project={project} component={component} peers={peers} edit={editComponent} unit={unit} setUnit={value => setUnits(previous => ({ ...previous, [taskKey]: value }))} />
    <UiLayoutFields project={project} component={component} components={peers} edit={editComponent} select={selectUi} section="object" />
    <UiChildObjects project={project} component={component} peers={peers} commit={scopedCommit} edit={editComponent} select={selectUi} section="parent" />
  </>;
  const interaction = component && <>
    {isCollection && <UiCollectionInspector project={project} component={component} edit={editComponent} assetUrl={assetUrl} section="interaction" />}
    <UiInspectorInteraction project={project} component={component} pageId={pageId} edit={editComponent} commit={scopedCommit} assetUrl={assetUrl} onOpenGraph={pageContext?.onOpenGraph} onParameter={onParameter} includeVisibility={false} />
  </>;
  return <UiInspectorProvider taskKey={activeSection === 'page' ? pageTaskKey : currentTaskKey} query={activeSection === 'component' ? query : ''}>
    <div className="ui-inspector" ref={root} data-ui-inspector-kind={component?.kind} data-ui-inspector-part={part} data-ui-flow-view={component?.kind === 'flowchart' ? flowSubview?.kind ?? 'map' : undefined}>
      <div className="ui-inspector-header" ref={header}>
      <div className="ui-inspector-tabs" role="tablist" aria-label="界面属性范围" onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); const next = event.key === 'Home' ? component ? 'component' : 'page' : event.key === 'End' ? 'page' : activeSection === 'component' ? 'page' : component ? 'component' : 'page';
        setSection(next); event.currentTarget.querySelector<HTMLButtonElement>(`[data-section="${next}"]`)?.focus();
      }}>
        {(['component', 'page'] as const).map(tab => <button type="button" role="tab" key={tab} data-section={tab} aria-selected={activeSection === tab} tabIndex={activeSection === tab ? 0 : -1} className={activeSection === tab ? 'active' : undefined} disabled={tab === 'component' && !component} onClick={() => setSection(tab)}>{tab === 'component' ? '组件设置' : '页面设置'}</button>)}
      </div>
      {activeSection === 'component' && component && <nav className="ui-inspector-breadcrumb" aria-label="当前编辑对象" data-ui-inspector-breadcrumb tabIndex={-1}>
        {part ? <><button type="button" className="text-button" aria-label="返回整个控件" title={`返回${componentName(component)}的整体设置`} onClick={leavePart}><ArrowLeft size={14} aria-hidden="true" /><span>{componentName(component)}</span></button><span aria-hidden="true">›</span><strong>{partName}</strong></> : flowSubview ? <><button type="button" className="text-button" aria-label="返回整张图设置" onClick={() => navigateFlow({ kind: 'map' })}><ArrowLeft size={14} aria-hidden="true" /><span>{componentName(component)}</span></button><span aria-hidden="true">›</span>{flowSubview.kind !== 'node' && flowNode && <><button type="button" className="text-button" aria-label="返回当前节点内容" onClick={() => navigateFlow({ kind: 'node', nodeId: flowNode.id })}>{flowNode.name}</button><span aria-hidden="true">›</span></>}<strong>{flowTitle}</strong></> : <><strong>{componentName(component)}</strong><span>{component.kind === 'flowchart' ? '整张图' : '整个控件'}</span></>}
      </nav>}
      </div>
      {activeSection === 'component' ? component ? <>
        <div className="ui-inspector-selection">
          <div className="ui-inspector-object"><strong>{part ? partName : flowSubview ? flowSubview.kind === 'preset' ? '节点外观预设' : flowTitle : actualKind}</strong><span title={instance && baseComponent && !localComponent ? `${source}。修改后在当前方案保存整个控件的副本。` : source}>{flowSubview?.kind === 'preset' ? '整个工程共用' : flowSubview?.kind === 'edge' || flowSubview?.kind === 'call' ? '由真实剧情生成' : flowSubview?.kind === 'group' || flowLocal && (flowSubview?.kind === 'sources' || flowSubview?.kind === 'node') ? '只影响本图' : flowSubview?.kind === 'sources' ? '整个工程共用' : flowSubview?.kind === 'node' ? '剧情入口' : source}</span></div>
          {part ? <><Field label="编辑部件"><select aria-label="当前列表部件" value={part} onChange={event => collectionEditing?.select(component.id, event.target.value as CollectionPart)}>{availableParts.map(value => <option key={value} value={value}>{collectionInspectorPartName(component, value)}</option>)}</select></Field><p className="ui-inspector-part-scope" role="note">{collectionInspectorPartScope(component, part)}</p></> : !flowSubview && <Field label="名称"><input aria-label="控件显示名称" maxLength={120} disabled={status.saving || !canEdit} value={component.name ?? ''} placeholder={componentName(component)} onChange={event => editComponent(c => { c.name = event.target.value || undefined; })} /></Field>}
        </div>
        <div className="ui-inspector-search"><Search size={14} aria-hidden="true" /><input type="search" aria-label="搜索控件属性" placeholder={part ? `搜索${partName}属性` : flowSubview ? `搜索${flowTitle}的属性` : '搜索属性，例如字体、点击'} value={query} onChange={event => changeSearch(event.target.value)} />{query && <button type="button" className="icon-button" aria-label="清除属性搜索" onClick={() => changeSearch('')}><X size={13} /></button>}</div>
        {!canEdit && <p className="ui-inspector-source" role="status">当前方案的控件数量已达上限，暂时不能创建此继承控件的覆盖。</p>}
        {notice && <p className="ui-inspector-notice" role="alert">{notice}</p>}
        <fieldset className="ui-inspector-fields" key={identity} disabled={status.saving || !canEdit}>
          <UiInspectorProvider taskKey={taskKey} query={rootQuery}>
          <UiInspectorSearchScope matched={false} active={!internalView}>
          <UiPropertyControlProvider project={project} component={component} pageId={pageId} commit={scopedCommit} disabled={internalView || status.saving || !canEdit} onOpenGraph={pageContext?.onOpenGraph} onParameter={onParameter}>
          <div className="ui-inspector-view" data-ui-inspector-view="component" data-searching={!!rootQuery.trim()} hidden={internalView} inert={internalView}>
          <p className="ui-property-control-hint">右键属性名称或输入框可设置参数控制，默认设置允许蓝图临时修改。</p>
          <section className="ui-inspector-region" data-ui-inspector-region="common" aria-label="通用属性">
            <h3 className="ui-inspector-region-title">通用属性 <span>{component.kind === 'flowchart' ? '作用于整张图' : '作用于整个控件'}</span></h3>
            <UiPropertyGroup id="layout" title="位置与大小" icon={<Box size={15} />} summary={`${Math.round(previewComponent!.width * 100)}% × ${Math.round(previewComponent!.height * 100)}%`} searchKeywords={keywords.layout} defaultOpen>{layout}</UiPropertyGroup>
            <UiPropertyGroup id="visibility" title="显示" icon={<Eye size={15} />} summary={`${visibleSummary} · ${Math.round((previewComponent?.style?.opacity ?? 1) * 100)}%`} searchKeywords={keywords.visibility}>
              <UiInspectorOpacity project={project} component={component} edit={editComponent} />
              <UiInspectorVisibilityRule project={project} component={component} edit={editComponent} />
            </UiPropertyGroup>
            <UiPropertyGroup id="children" title="子对象" icon={<Layers size={15} />} summary={`${peers.filter(item => item.parentId === component.id).length} 个子对象`} searchKeywords={keywords.children}>
              <UiChildObjects project={project} component={component} peers={peers} commit={scopedCommit} edit={editComponent} select={selectUi} section="children" embedded />
              <UiLayoutFields project={project} component={component} components={peers} edit={editComponent} select={selectUi} section="children" />
            </UiPropertyGroup>
          </section>
          <section className="ui-inspector-region" data-ui-inspector-region="function" aria-label={`${actualKind}功能`}>
            <h3 className="ui-inspector-region-title"><span>控件功能</span><strong data-ui-inspector-function-title>{actualKind}</strong></h3>
          {component.kind === 'flowchart' ? <UiFlowInspector project={project} component={component} previewComponent={pageContext?.previewComponent} commit={scopedCommit} edit={editComponent} assetUrl={assetUrl} target={{ kind: 'map' }} active={!internalView && activeSection === 'component'} onNavigate={navigateFlow} /> : <>
            <UiPropertyGroup id="content" title="内容" icon={<List size={15} />} summary={uiInspectorContentSummary(project, component)} searchKeywords={keywords.content} defaultOpen>
              <UiInspectorContent project={project} component={component} peers={peers} edit={editComponent} commit={scopedCommit} assetUrl={assetUrl} pageId={pageId} onOpenGraph={pageContext?.onOpenGraph} onParameter={onParameter} includeBindings={false} />
            </UiPropertyGroup>
            {isCollection && <UiPropertyGroup id="collection-layout" title="列表排列" icon={<List size={15} />} summary="行列、间距与浏览方式" searchKeywords={keywords.collectionLayout}>
              <UiCollectionInspector project={project} component={component} edit={editComponent} assetUrl={assetUrl} section="layout" />
            </UiPropertyGroup>}
            <UiPropertyGroup id="appearance" title="外观" icon={<Paintbrush size={15} />} summary={isCollection ? '条目默认外观与部件' : component.kind === 'button' ? '按状态编辑' : '文字、图片与底色'} searchKeywords={keywords.appearance} defaultOpen={isCollection}>
              {isCollection ? <>
                <UiCollectionInspector project={project} component={component} edit={editComponent} assetUrl={assetUrl} section="appearance" />
                <UiPropertyGroup id="collection-common-appearance" title="条目默认外观" summary="列表共用基础值" searchKeywords="基础 字体 字号 颜色 背景 底图">
                  <p className="ui-inspector-source">此列表的条目共用这些基础值；内部部件单独设置的样式优先。</p>
                  <UiCommonAppearance project={project} component={component} edit={editComponent} assetUrl={assetUrl} state={state} onStateChange={changeState} includeVisibility={false} />
                </UiPropertyGroup>
              </> : <UiCommonAppearance project={project} component={component} edit={editComponent} assetUrl={assetUrl} state={state} onStateChange={changeState} includeVisibility={false} />}
              {isControl && <UiPreferenceFields project={project} component={component} edit={editComponent} assetUrl={assetUrl} section="appearance" onParameter={onParameter} />}
            </UiPropertyGroup>
          </>}
          <UiPropertyGroup id="interaction" title={component.kind === 'flowchart' ? '整图事件与反馈' : '交互'} icon={<MousePointer2 size={15} />} summary={uiInspectorInteractionSummary(project, component, pageId, false)} searchKeywords={keywords.interaction}>{interaction}</UiPropertyGroup>
          <UiInspectorBindings project={project} component={component} peers={peers} commit={scopedCommit} pageId={pageId} onOpenGraph={pageContext?.onOpenGraph} />
          <UiPropertyGroup id="capabilities" title="控件能力参考" icon={<Layers size={15} />} summary="蓝图可用属性" searchKeywords="蓝图 能力 操作 属性 读写 动画">
            <UiPropertyCapabilities project={project} component={component} embedded />
          </UiPropertyGroup>
          </section>
          {rootQuery.trim() && <p className="ui-inspector-no-matches" role="status">没有匹配的属性，试试“字体”“位置”或“点击”。</p>}
          </div>
          </UiPropertyControlProvider>
          </UiInspectorSearchScope>
          </UiInspectorProvider>
          {flowSubview && <div className="ui-inspector-view" data-ui-inspector-view="flow" data-searching={searching} key={flowKey}>
            <UiFlowInspector project={project} component={component} previewComponent={pageContext?.previewComponent} commit={flowCommit} edit={editFlow} assetUrl={assetUrl} target={flowSubview} active={activeSection === 'component'} onNavigate={navigateFlow} />
            {query.trim() && <p className="ui-inspector-no-matches" role="status">当前编辑对象没有匹配的属性。返回整张图可查找布局和玩家操作。</p>}
          </div>}
          {part && <div className="ui-inspector-view" data-ui-inspector-view="part" data-searching={searching} key={part}>
            <section className="ui-inspector-region" data-ui-inspector-region="common" aria-label="部件通用属性">
              <h3 className="ui-inspector-region-title">通用属性 <span>当前部件</span></h3>
              <UiPropertyGroup id="part-layout" title="位置与大小" icon={<Box size={15} />} summary={partName} searchKeywords={partKeywords.layout} defaultOpen revealOn={selectedPart?.reveal === 'layout' ? String(collectionEditing?.request) : undefined}>
                <UiCollectionPartInspector project={project} component={component} part={part} edit={editPart} assetUrl={assetUrl} section="layout" />
              </UiPropertyGroup>
            </section>
            <section className="ui-inspector-region" data-ui-inspector-region="function" aria-label={`${partName}功能`}>
              <h3 className="ui-inspector-region-title"><span>部件功能</span><strong data-ui-inspector-function-title>{partName}</strong></h3>
              <UiPropertyGroup id="part-appearance" title="外观" icon={<Paintbrush size={15} />} searchKeywords={partKeywords.appearance} defaultOpen revealOn={selectedPart?.reveal === 'appearance' ? String(collectionEditing?.request) : undefined}>
                <UiCollectionPartInspector project={project} component={component} part={part} edit={editPart} assetUrl={assetUrl} section="appearance" />
              </UiPropertyGroup>
            </section>
            {query.trim() && <p className="ui-inspector-no-matches" role="status">当前部件没有匹配的属性。可返回整个控件继续查找。</p>}
          </div>}
        </fieldset>
        {!internalView && <div className="ui-inspector-footer">
          {instance && baseComponent && localComponent && <button type="button" className="text-button" disabled={status.saving} title="移除当前方案对整个控件的覆盖，恢复上级控件的内容、布局、外观和交互。子对象各自的覆盖保留。" onClick={() => {
            try {
              scopedCommit('恢复整个继承控件', draft => { if (draft.ui.activeInstanceId === instance.id) restoreInheritedUiObject(draft, component.id); }, { separate: true });
              setNotice('');
            } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
          }}><RotateCcw size={13} />恢复整个继承控件</button>}
          <button type="button" className="text-button danger-text" disabled={status.saving} onClick={() => {
            try {
              scopedCommit(baseComponent ? '隐藏继承控件' : '删除界面控件', draft => {
                if (baseComponent) hideInheritedUiObject(draft, component.id);
                else removeUiObject(draft, component.id);
              }, { separate: true });
              selectUi?.(undefined);
            } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
          }}><Trash2 size={13} />{baseComponent ? '在本方案隐藏' : '删除控件'}</button>
        </div>}
      </> : <div className="ui-inspector-empty"><Box size={27} /><strong>选择一个控件</strong><p>点击画布或左侧列表，编辑它的内容、位置、外观和交互。</p><button type="button" className="text-button" onClick={() => setSection('page')}>查看页面设置</button></div> : <>
        <fieldset className="ui-inspector-fields" disabled={status.saving}>{pageContext?.settings ?? <div className="ui-inspector-empty"><strong>先选择一个页面</strong><p>页面设置用于修改此页的默认外观和打开行为。</p></div>}</fieldset>
        {!!hidden.length && <UiPropertyGroup id="hidden-components" title="本方案隐藏的控件" summary={`${hidden.length} 个`}>
          <p className="ui-inspector-source">恢复显示会同时恢复随它隐藏的子对象。</p>
          {hidden.map(item => <button key={item.id} type="button" className="text-button" disabled={status.saving} onClick={() => commit('恢复隐藏控件', draft => {
            if (draft.id !== project.id || draft.ui.activeInstanceId !== instance?.id) return;
            const target = draft.ui.instances?.find(value => value.id === instance?.id);
            if (target) target.hiddenComponentIds = target.hiddenComponentIds?.filter(hiddenId => hiddenId !== item.id);
          }, { separate: true })}>恢复显示：{componentName(item)}</button>)}
        </UiPropertyGroup>}
      </>}
    </div>
  </UiInspectorProvider>;
}

function UiInspectorGeometry({ project, component, peers, edit, unit, setUnit }: { project: Project; component: UiComponent; peers: UiComponent[]; edit: EditComponent; unit: GeometryUnit; setUnit: (unit: GeometryUnit) => void }) {
  const active = useUiInspectorGroupActive();
  const geometry = useMemo(() => {
    if (!active || unit !== 'pixel') return;
    const snapshots = peers.map(item => uiPropertyControlDesignSnapshot(project, item));
    const hidden = new Set(snapshots.filter(snapshot => snapshot.values.visible === false).map(snapshot => snapshot.component.id));
    return resolveUiLayout(snapshots.map(snapshot => snapshot.component), project, item => !hidden.has(item.id)).get(component.id);
  }, [active, unit, peers, project, component.id]);
  const authoredParent = peers.find(item => item.id === component.parentId);
  const parent = useMemo(() => authoredParent ? uiPropertyControlDesignSnapshot(project, authoredParent).component : undefined, [project, authoredParent]);
  const arranged = !!parent && component.childLayer !== 'background' && uiLayoutValues(parent).flow !== 'absolute';
  const problem = uiLayoutProblem(component);
  const unitLabel = unit === 'pixel' ? 'px' : '%';
  return <div className="ui-inspector-geometry">
    <div className="ui-inspector-unit"><span>{arranged ? '排列中的附加偏移与尺寸' : parent ? component.childLayer === 'background' ? '相对父对象外框' : '相对父内容区' : '相对画面'}</span><select aria-label="位置尺寸单位" value={unit} onChange={event => setUnit(event.target.value as GeometryUnit)}><option value="percent">百分比 %</option><option value="pixel">像素 px</option></select></div>
    <div className="ui-inspector-transform">{(['x', 'y', 'width', 'height'] as const).map(property => {
      const horizontal = property === 'x' || property === 'width';
      const factor = unit === 'percent' ? 100 : (horizontal ? geometry?.basis.width : geometry?.basis.height) ?? 0;
      const label = { x: arranged ? '横向附加偏移' : '横向位置', y: arranged ? '纵向附加偏移' : '纵向位置', width: '宽度', height: '高度' }[property];
      return <Field key={property} label={label} uiProperty={property}><div className="ui-inspector-number"><NumberInput aria-label={`${label} ${unitLabel}`} disabled={!!problem || factor === 0} min={property === 'width' || property === 'height' ? 0 : undefined} step={unit === 'percent' ? .1 : 1} value={Number((component[property] * factor).toFixed(4))} onChange={event => edit(c => { applyUiDesignProperty(project, c, property, Number(event.target.value) / factor); })} /><small aria-hidden="true">{unitLabel}</small></div></Field>;
    })}</div>
  </div>;
}
