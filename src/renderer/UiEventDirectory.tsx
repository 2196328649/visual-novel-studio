import type { ReactNode } from 'react';
import { Film, GitBranch, MousePointer2, Plus, Search } from 'lucide-react';
import type { BlueprintGraph, Project, UiComponent, VariableValue } from '../core/model';
import type { BlueprintNodeType } from '../core/blueprint';
import { completionScore } from '../core/text-completion';
import { uiButtonEvents, type UiButtonEvent } from '../core/ui-button-events';
import { uiImageEvents, type UiImageEvent } from '../core/ui-image';
import { uiVideoEvents, type UiVideoEvent } from '../core/ui-video';
import { uiSpineEvents, type UiSpineEvent } from '../core/ui-spine';
import { uiControlValueType, uiTextInput } from '../core/ui-control-events';
import { uiControlDefinition, uiControlPrimaryProperty } from '../core/ui-control-properties';
import { uiControlValue } from '../core/ui-control-value';
import { findUiControlEvent, ownsUiEventGraph, uiClickHandlers } from '../core/ui-logic';
import { uiPageAnimations } from '../core/ui-animation-clips';
import { projectGraphs } from '../core/project-resources';
import { UiLibraryHeading, useUiLibrarySections } from './UiLibraryHeading';
import { UiEventDetail, useUiEventSidebar } from './UiEventSidebar';
import { UiGraphVariables } from './UiGraphVariables';
import { UiPageInterfaceEditor } from './UiPageInterfaceEditor';
import { UiParameterBindings } from './UiParameterBindings';
import { actionName, componentName, componentNames } from './UiNames';
import type { Commit } from './editor';

export type UiDirectoryEventTrigger = UiButtonEvent | UiImageEvent | UiVideoEvent | UiSpineEvent;
interface Props {
  project: Project; components: UiComponent[]; component?: UiComponent;
  pageId: string; graph?: BlueprintGraph; commit: Commit; saving: boolean;
  pageActions?: ReactNode; modules?: ReactNode;
  add(type: BlueprintNodeType, properties?: Record<string, VariableValue>): void;
  selectComponent(id?: string): void;
  locateComponent?(id: string): void;
  locate(graphId: string, nodeId?: string): void;
  design?(): void;
  clickEvent(): void; newClickEvent(): void;
  controlEvent(type: BlueprintNodeType, trigger?: UiDirectoryEventTrigger, independent?: boolean): void;
  createAnimation(): void; openAnimation(id: string): void;
  notice(message: string): void;
}

export function UiEventDirectory(props: Props) {
  const { project, components, component, pageId, graph, commit, saving, pageActions, modules, add,
    selectComponent, locate, createAnimation, openAnimation, notice } = props;
  const sidebar = useUiEventSidebar()!;
  const section = useUiLibrarySections();
  const matches = (name: string, extra: string[] = []) => completionScore(name, sidebar.search, extra) > 0;
  const controlKind = (control: UiComponent) => {
    if (uiTextInput(project, control)) return '文字输入';
    const type = uiControlValueType(project, control);
    if (control.kind === 'preferenceChoice' && type) return '选项';
    return type ? { number: '滑块', boolean: '开关', string: '选项' }[type] : componentNames[control.kind];
  };
  const selectControl = (id: string) => { selectComponent(id); sidebar.select('component:' + id); };
  const events = graph?.nodes.filter(node => ['event', 'eventClick', 'eventButton', 'eventValueChanged', 'eventTextCommitted', 'eventImage', 'eventVideo', 'eventSpine', 'eventKey', 'eventTimer', 'eventPage'].includes(node.type)) ?? [];
  const animations = uiPageAnimations(project, pageId);
  const graphKey = 'graph:' + (graph?.id ?? 'none');
  const collapse = (id: string) => sidebar.search.trim() ? { ...section(id), collapsed: false } : section(id);
  return <aside className="ui-event-library ui-event-directory-content" aria-label="我的界面">
    <div className="search ui-event-directory-search"><Search size={13}/><input aria-label="搜索我的界面" placeholder="搜索控件、事件、变量…" value={sidebar.search} onChange={event => sidebar.setSearch(event.target.value)}/>{sidebar.search && <button type="button" className="text-button" aria-label="清除目录搜索" onClick={() => sidebar.setSearch('')}>×</button>}</div>
    <nav className="ui-event-directory-links" aria-label="事件图设置">
      <button type="button" className="small-button" aria-pressed={sidebar.active === graphKey} onClick={() => sidebar.select(graphKey)}>本图设置</button>
      <button type="button" className="small-button" aria-pressed={sidebar.active === 'bindings'} onClick={() => sidebar.select('bindings')}>属性关联</button>
      {pageActions && <button type="button" className="small-button" aria-pressed={sidebar.active === 'page-settings'} onClick={() => sidebar.select('page-settings')}>页面设置</button>}
    </nav>
    <section data-collapsed={collapse('components').collapsed || undefined}>
      <UiLibraryHeading title="控件" icon={<MousePointer2 size={14}/>} count={components.length} collapse={collapse('components')}/>
      <div className="ui-event-components" aria-label="当前页面控件">{[...components].reverse().filter(control => matches(componentName(control), [controlKind(control)])).map(control => <button key={control.id} type="button" data-ui-component-id={control.id} draggable aria-pressed={sidebar.active === 'component:' + control.id} className={sidebar.active === 'component:' + control.id ? 'active' : ''} onClick={() => selectControl(control.id)} onDragStart={event => { event.dataTransfer.setData('application/vns-ui-component', control.id); event.dataTransfer.effectAllowed = 'copy'; selectControl(control.id); }}><span>{componentName(control)}</span><small>{controlKind(control)}</small></button>)}</div>
      {!components.length && <p>在设计中添加控件，再连接它们的行为。</p>}
    </section>
    <section data-collapsed={collapse('events').collapsed || undefined}>
      <UiLibraryHeading title="事件" icon={<GitBranch size={14}/>} count={events.length} collapse={collapse('events')}><button type="button" className="text-button" aria-label="新增页面事件" disabled={!graph} onClick={() => sidebar.select('new-event')}><Plus size={13}/></button></UiLibraryHeading>
      {events.filter(node => matches(node.type === 'event' ? '页面显示时' : node.name)).map(node => <button type="button" key={node.id} className="ui-event-entry" data-event-node-id={node.id} aria-pressed={sidebar.active === 'node:' + graph!.id + ':' + node.id} onClick={() => locate(graph!.id, node.id)}>{node.type === 'event' && graph?.uiPageId ? '页面显示时' : node.name}</button>)}
      {!events.length && <p>选择控件添加事件，或创建页面事件。</p>}
    </section>
    <section className="ui-animation-list" data-collapsed={collapse('animations').collapsed || undefined}>
      <UiLibraryHeading title="动画" icon={<Film size={14}/>} count={animations.length} collapse={collapse('animations')}><button type="button" className="text-button" disabled={(project.ui.animations?.length ?? 0) >= 256} onClick={createAnimation}>＋ 新建动画</button></UiLibraryHeading>
      {animations.filter(animation => matches(animation.name)).map(animation => <div key={animation.id} data-ui-animation-id={animation.id}><button type="button" className="text-button" aria-pressed={sidebar.active === 'animation:' + animation.id} title="双击编辑关键帧；可拖入画布播放" draggable onDragStart={event => { event.dataTransfer.setData('application/vns-ui-animation', animation.id); event.dataTransfer.effectAllowed = 'copy'; }} onClick={() => sidebar.select('animation:' + animation.id)} onDoubleClick={() => openAnimation(animation.id)}>{animation.name}</button></div>)}
    </section>
    <UiPageInterfaceEditor key={pageId} project={project} graph={graph} pageId={pageId} commit={commit} add={add} collapse={collapse('interface')}/>
    <UiGraphVariables key={(graph?.id ?? 'none') + '/' + pageId} project={project} graph={graph} pageId={pageId} commit={commit} canAddNode={!!graph} add={add} onNotice={notice} collapse={collapse('state')}/>
    {modules}
    {component && <UiEventDetail id={'component:' + component.id} title={componentName(component)} kind={controlKind(component)}><ControlDetails {...props} component={component}/></UiEventDetail>}
    <UiEventDetail id="new-event" title="新增页面事件" kind="事件"><p>选择触发时机，再在画布连接要执行的动作。</p><div className="ui-event-detail-actions"><button type="button" className="small-button" disabled={!graph} onClick={() => add('eventKey')}>按键事件</button><button type="button" className="small-button" disabled={!graph} onClick={() => add('eventTimer')}>定时事件</button><button type="button" className="small-button" disabled={!graph} onClick={() => add('eventPage', { pageId, phase: 'closeRequested' })}>生命周期事件</button>{graph && !graph.nodes.some(node => node.type === 'event') && <button type="button" className="small-button" onClick={() => add('event')}>页面显示事件</button>}</div></UiEventDetail>
    {animations.map(animation => <UiEventDetail key={animation.id} id={'animation:' + animation.id} title={animation.name} kind="控件动画"><p>{animation.duration} 秒 · {animation.tracks.length} 条属性轨道</p><p className="ui-field-help">双击目录中的动画，或进入关键帧编辑。</p><div className="ui-event-detail-actions"><button type="button" className="small-button" onClick={() => openAnimation(animation.id)}>编辑关键帧</button><button type="button" className="small-button" disabled={!graph} onClick={() => add('playUiAnimation', { animationId: animation.id })}>添加播放节点</button><button type="button" className="small-button" disabled={!graph} onClick={() => add('stopUiAnimationPlayback', { animationId: animation.id })}>添加停止节点</button></div></UiEventDetail>)}
    <UiEventDetail id="bindings" title="属性关联" kind="控件与参数"><UiParameterBindings embedded disabled={saving} project={project} components={components} pageId={pageId} commit={commit} selectedComponentId={component?.id} onComponentSelect={selectComponent} onGraphChange={id => locate(id)}/></UiEventDetail>
    {pageActions && <UiEventDetail id="page-settings" title="页面设置" kind="当前界面">{pageActions}</UiEventDetail>}
  </aside>;
}

function ControlDetails({ project, component, pageId, graph, add, locate, locateComponent, design, controlEvent, clickEvent, newClickEvent }: Props & { component: UiComponent }) {
  const sidebar = useUiEventSidebar()!;
  const handlers = uiClickHandlers(project, pageId, component.id);
  const info = uiControlDefinition(project, component), value = uiControlValue(project, component);
  const scope = pageId.startsWith('ui:') ? '当前方案' : '当前页面';
  const events: { name: string; type: BlueprintNodeType; trigger?: UiDirectoryEventTrigger }[] = [];
  if (uiTextInput(project, component)) events.push({ name: '文字提交时', type: 'eventTextCommitted' });
  if (uiControlValueType(project, component)) events.push({ name: '值改变时', type: 'eventValueChanged' });
  if (component.kind === 'button') for (const [trigger, event] of Object.entries(uiButtonEvents)) events.push({ name: event.name, type: 'eventButton', trigger: trigger as UiButtonEvent });
  const media = component.kind === 'image' ? uiImageEvents : component.kind === 'video' ? uiVideoEvents : component.kind === 'spine' ? uiSpineEvents : undefined;
  if (media) for (const [trigger, name] of Object.entries(media)) events.push({ name, type: component.kind === 'image' ? 'eventImage' : component.kind === 'video' ? 'eventVideo' : 'eventSpine', trigger: trigger as UiDirectoryEventTrigger });
  const withExisting = events.map(event => ({ ...event, existing: findUiControlEvent(project, pageId, component.id, event.type, event.trigger) }));
  const inherited = withExisting.filter(event => event.existing && !ownsUiEventGraph(project, event.existing.g, pageId));
  return <div className="ui-event-control-details">
    <div className="ui-event-detail-actions">{locateComponent && <button type="button" className="small-button" onClick={() => locateComponent(component.id)}>在设计中定位</button>}<button type="button" className="small-button" onClick={() => sidebar.select('bindings')}>属性关联</button></div>
    <h4>控件事件</h4>
    {component.kind === 'button' && <div className="ui-event-event-row"><span>点击时</span><button type="button" className="small-button" aria-label="点击时" onClick={clickEvent}>{handlers.length ? '定位 →' : '＋ 添加'}</button></div>}
    {withExisting.map(event => <div key={event.type + ':' + (event.trigger ?? '')} className="ui-event-event-row"><span>{event.name}</span><button type="button" className="small-button" aria-label={event.name} onClick={() => controlEvent(event.type, event.trigger)}>{event.existing ? '定位 →' : '＋ 添加'}</button></div>)}
    {!withExisting.length && component.kind !== 'button' && <p className="ui-field-help">此控件没有独立事件，可通过下方属性节点控制。</p>}
    {component.kind === 'button' && (handlers.length > 0 || component.action) && <details className="ui-event-detail-help"><summary>点击后的执行顺序</summary><ol>{handlers.map((handler, index) => { const owner = projectGraphs(project).find(item => item.id === handler.graphId), node = owner?.nodes.find(item => item.id === handler.nodeId); return <li key={index}><button type="button" className="text-button" disabled={!owner} onClick={() => owner && locate(owner.id, node?.id ?? owner.nodes.find(item => item.type === 'event')?.id)}>{owner ? (handler.source === 'event' ? '事件：' : handler.source === 'callback' ? '绑定事件：' : '调用：') + (node?.name ?? owner.name) : '缺失蓝图：' + handler.graphId}</button></li>; })}{component.action && component.action !== 'blueprint' && <li>预设动作：{actionName(component.action)}</li>}</ol>{design && <button type="button" className="text-button" onClick={design}>编辑按钮行为</button>}{handlers.length > 0 && <button type="button" className="text-button" onClick={newClickEvent}>＋ 添加独立点击事件</button>}</details>}
    {inherited.length > 0 && <details className="ui-event-detail-help"><summary>继承或共用的事件</summary><p>新增独立事件只作用于{scope}，原有事件仍会执行。</p>{inherited.map(event => <button type="button" key={event.type + ':' + event.trigger} className="text-button" onClick={() => controlEvent(event.type, event.trigger, true)}>另加{event.name}事件</button>)}</details>}
    <h4>添加控制节点</h4>
    <div className="ui-event-detail-actions"><button type="button" className="small-button" disabled={!graph} onClick={() => add('getUiProperty', { componentId: component.id })}>读取属性</button><button type="button" className="small-button" disabled={!graph} onClick={() => add('setUiProperty', { componentId: component.id })}>设置属性</button><button type="button" className="small-button" disabled={!graph} onClick={() => add('animateUiProperty', { componentId: component.id })}>属性动画</button><button type="button" className="small-button" disabled={!graph} onClick={() => add('stopUiAnimation', { componentId: component.id })}>停止动画</button></div>
    {value && <details className="ui-event-detail-help" open={!!value.error}><summary>控件值与绑定源</summary>{value.error ? <><p role="alert">{value.error}</p>{design && <button type="button" className="text-button" onClick={design}>编辑控件绑定</button>}</> : <><p>值来自：{value.label}</p><div className="ui-event-detail-actions"><button type="button" className="small-button" disabled={!graph} onClick={() => add(value.read!.type, value.read!.properties)}>读取绑定源</button><button type="button" className="small-button" disabled={!graph} onClick={() => add(value.write!.type, value.write!.properties)}>设置绑定源</button>{info && <><button type="button" className="small-button" disabled={!graph} onClick={() => add('getUiProperty', { componentId: component.id, property: uiControlPrimaryProperty(info) })}>读取有效控件值</button><button type="button" className="small-button" disabled={!graph} onClick={() => add('setUiProperty', { componentId: component.id, property: uiControlPrimaryProperty(info), value: info.initial, writeMode: 'override' })}>临时覆盖控件值</button></>}</div><p>有效值包含本控件覆盖。要同步修改来源并解除覆盖，在“设置组件属性”选择“修改绑定源”。</p></>}</details>}
    {(info?.textInput || info?.choice || info?.range || component.kind === 'spine') && <details className="ui-event-detail-help"><summary>更多控制</summary><div className="ui-event-detail-actions">
      {info?.textInput && <><button type="button" className="small-button" disabled={!graph} onClick={() => add('focusUiComponent', { componentId: component.id, focused: true })}>请求输入焦点</button><button type="button" className="small-button" disabled={!graph} onClick={() => add('focusUiComponent', { componentId: component.id, focused: false })}>释放输入焦点</button></>}
      {info?.choice && <><button type="button" className="small-button" disabled={!graph} onClick={() => add('getUiControlOption', { componentId: component.id, valueType: info.type, index: 0 })}>读取控件选项</button><button type="button" className="small-button" disabled={!graph} onClick={() => add('editUiControlOptions', { componentId: component.id, valueType: info.type, index: info.options.length, label: '选项', value: info.initial })}>编辑控件选项</button></>}
      {info?.range && <><button type="button" className="small-button" disabled={!graph} onClick={() => add('setUiControlRange', { componentId: component.id, minimum: info.range!.min, maximum: info.range!.max, step: info.range!.step })}>设置控件范围</button><button type="button" className="small-button" disabled={!graph} onClick={() => add('resetUiControlRange', { componentId: component.id })}>重置控件范围</button></>}
      {component.kind === 'spine' && <><button type="button" className="small-button" disabled={!graph} onClick={() => add('playSpine', { componentId: component.id, animation: component.spine?.animation ?? project.assets.find(asset => asset.id === component.assetId)?.spine?.animations[0]?.name ?? '', loop: false, restart: true })}>播放骨骼动画</button><button type="button" className="small-button" disabled={!graph} onClick={() => add('pauseSpine', { componentId: component.id, paused: true })}>暂停骨骼动画</button><button type="button" className="small-button" disabled={!graph} onClick={() => add('setUiProperty', { componentId: component.id, property: 'spineSkin', value: '' })}>切换骨骼皮肤</button></>}
    </div></details>}
  </div>;
}
