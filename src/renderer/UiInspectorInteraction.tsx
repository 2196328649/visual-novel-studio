import { useEffect, useState } from 'react';
import type { Condition, Project, UiComponent } from '../core/model';
import { blueprintResources, projectGraphs } from '../core/project-resources';
import { uiActionAvailable } from '../core/ui-availability';
import { uiClickHandlers, findUiControlEvent, ownsUiEventGraph, uiPageComponents, uiPageGraphs } from '../core/ui-logic';
import { uiControlValueType } from '../core/ui-control-events';
import { uiPropertyControlFor } from '../core/ui-property-control';
import { ensureUiInspectorEvent, uiConditionDescription, uiInspectorControlEvents, uiInspectorPageId, type UiInspectorControlEvent } from '../core/ui-inspector-interaction';
import { uiPageFlowEvents } from '../core/ui-page-flow';
import { uiHoverSound, uiClickSound } from '../core/ui-sound';
import { uiShortcutKey, uiShortcutKeys } from '../core/ui-shortcuts';
import { preferenceInfo } from '../core/preferences';
import { actionName, componentName } from './UiNames';
import { ConditionEditor, Field } from './components';
import { UiPreferenceFields } from './PlayerPreferences';
import { UiPropertyGroup } from './UiPropertyGroup';
import type { Commit } from './editor';
import type { AssetUrl } from './StageEditor';
import './ui-control-authoring.css';

export { uiInspectorInteractionSummary } from '../core/ui-inspector-interaction';

type EditComponent = (change: (component: UiComponent) => void, options?: { separate?: boolean }) => void;
type OpenGraph = (graphId: string, nodeId?: string) => void;
const soundKinds = new Set<UiComponent['kind']>(['button', 'flowchart', 'chapterList', 'musicTrackList', 'voiceCollection', 'historyList']);
const commonActions: NonNullable<UiComponent['action']>[] = ['start', 'load', 'preferences', 'gallery', 'music', 'quit', 'save', 'history', 'auto', 'skip', 'return', 'mainMenu', 'rollback', 'window', 'fullscreen', 'mute', 'skipSeen', 'skipAll', 'transitions', 'pause', 'chapterSelect', 'voiceCollection', 'flowchart', 'staff', 'blueprint', 'hideInterface', 'musicPrevious', 'musicNext', 'musicPlayPause', 'musicStop', 'musicLoop', 'musicShuffle', 'setPlayerPreference', 'resetPreferences', 'voiceSettings'];

export function UiInspectorInteraction({ project, component, pageId, edit, commit, assetUrl, onOpenGraph, onParameter, includeVisibility = true }: {
  project: Project; component: UiComponent; pageId?: string; edit: EditComponent; commit: Commit; assetUrl: AssetUrl; onOpenGraph?: OpenGraph; onParameter?: (id: string) => void;
  includeVisibility?: boolean;
}) {
  const [notice, setNotice] = useState('');
  useEffect(() => setNotice(''), [component.id, pageId]);
  const owner = uiInspectorPageId(project, component, pageId);
  const button = component.kind === 'button';
  const handlers = owner && button ? uiClickHandlers(project, owner, component.id) : [];
  const events = uiInspectorControlEvents(project, component);
  const primaryEvents = events.filter(event => event.type !== 'eventButton');
  const extraEvents = events.filter(event => event.type === 'eventButton');
  const isMinigame = component.page === 'custom' && (project.minigames.some(game => game.uiPageId === owner) || component.action?.startsWith('minigame'));
  const actions = [...commonActions, ...(isMinigame ? ['minigameSuccess', 'minigameFailure', 'minigameCancel'] as const : []), ...(component.page === 'messageBox' ? ['confirmYes', 'confirmNo'] as const : [])].filter(action => uiActionAvailable(project.ui, action));
  const openEvent = (event: UiInspectorControlEvent, independent = false) => {
    if (!owner || !onOpenGraph) return;
    try {
      const existing = !independent && findUiControlEvent(project, owner, component.id, event.type, event.trigger);
      if (existing) { onOpenGraph(existing.g.id, existing.n.id); return; }
      let graphId = '', nodeId = '';
      commit('添加控件' + event.label + '事件', draft => { ({ graphId, nodeId } = ensureUiInspectorEvent(draft, component, event.id, owner, independent)); }, { separate: true });
      if (graphId) onOpenGraph(graphId, nodeId);
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  };
  const eventRow = (event: UiInspectorControlEvent) => {
    const existing = owner && findUiControlEvent(project, owner, component.id, event.type, event.trigger);
    const inherited = existing && owner && !ownsUiEventGraph(project, existing.g, owner);
    return <div key={event.id} className="ui-inspector-event-row">
      <span>{event.label}</span><button type="button" className="small-button" disabled={!owner || !onOpenGraph || event.type === 'eventClick' && component.clickMode === 'replace' && !existing} onClick={() => openEvent(event)} aria-label={(existing ? '编辑' : '添加') + event.label + '事件'}>{existing ? '编辑事件' : '添加事件'}</button>
      {inherited && <div className="ui-inspector-event-inherited"><span>来自{existing.g.uiInstanceId === 'base' ? '基础界面' : existing.g.uiInstanceId ? '上级方案' : '共用蓝图'}；编辑会影响使用它的内容。</span><button type="button" className="text-button" disabled={!onOpenGraph} onClick={() => openEvent(event, true)}>为{owner!.startsWith('ui:') ? '当前方案' : '当前页面'}添加事件</button></div>}
    </div>;
  };
  const inactiveEvents = owner ? uiPageGraphs(project, owner).flatMap(graph => graph.nodes.filter(node => ['eventValueChanged', 'eventTextCommitted', 'eventButton', 'eventImage', 'eventVideo', 'eventSpine'].includes(node.type) && node.properties.componentId === component.id && !events.some(event => event.type === node.type && (event.trigger === undefined || event.trigger === node.properties.trigger))).map(node => ({ graph, node }))) : [];
  const shortcut = uiShortcutKey(component.shortcut);
  const conflicts = owner && shortcut ? uiPageComponents(project, owner).filter(other => other.id !== component.id && other.kind === 'button' && uiShortcutKey(other.shortcut) === shortcut) : [];
  return <div className="ui-inspector-interaction">
    {notice && <p role="alert" className="ui-field-help">{notice}</p>}
    {button && <>
      <Field label="点击后"><select aria-label="点击行为" value={component.action ?? ''} onChange={event => edit(target => {
        target.action = event.target.value as UiComponent['action'] || undefined;
        if (target.action === 'setPlayerPreference') { target.preference ??= 'musicVolume'; target.preferenceValue ??= preferenceInfo(project, target.preference).initial; delete target.parameterId; }
      }, { separate: true })}>
        <option value="">{handlers.length ? '仅执行点击事件' : '尚未设置点击行为'}</option>
        {component.action && !actions.includes(component.action) && <option value={component.action} disabled>{actionName(component.action)}（当前页面不可用）</option>}
        {actions.map(action => <option value={action} key={action}>{actionName(action)}</option>)}
      </select></Field>
      {component.action === 'blueprint' && <UiBoundGraphField label="调用蓝图" project={project} value={component.blueprintId} onChange={value => edit(target => { target.blueprintId = value; })} onOpenGraph={onOpenGraph} empty="选择蓝图" />}
      <UiPreferenceFields project={project} component={component} edit={edit} assetUrl={assetUrl} section="interaction" onParameter={onParameter} />
      {(handlers.length > 0 || component.action) && <UiPropertyGroup id="interaction-click-order" className="ui-inspector-click-order" title="点击执行顺序" summary={(handlers.length + (component.action && component.action !== 'blueprint' ? 1 : 0)) + ' 项'} searchKeywords="点击 事件 蓝图 主操作 页面接入 执行顺序">
        <ol aria-label="按钮执行顺序">{handlers.map((handler, index) => {
          const graph = projectGraphs(project).find(item => item.id === handler.graphId), node = graph?.nodes.find(item => item.id === handler.nodeId);
          return <li key={handler.graphId + ':' + (handler.nodeId ?? index)}><span>{{ beforeClick: '页面接入', event: '点击事件', callback: '绑定事件', action: '主操作' }[handler.source]}：</span><button type="button" className="text-button" disabled={!graph || !onOpenGraph} onClick={() => graph && onOpenGraph?.(graph.id, node?.id)}>{graph ? node?.name ?? graph.name : '蓝图已删除'}</button></li>;
        })}{component.action && component.action !== 'blueprint' && <li>主操作：{actionName(component.action)}</li>}</ol>
        <p className="muted ui-field-help">按顺序开始执行；含等待或打开页面的事件仍遵守其原有流程。</p>
      </UiPropertyGroup>}
      {component.clickMode === 'replace' && <p className="muted ui-field-help">原点击事件已停用；页面接入入口和主操作仍会执行。可在下方“已有蓝图与流程出口”恢复。</p>}
    </>}
    {!button && <UiPreferenceFields project={project} component={component} edit={edit} assetUrl={assetUrl} section="interaction" onParameter={onParameter} />}
    {primaryEvents.length > 0 && <div className="ui-inspector-events" aria-label="控件事件">{primaryEvents.map(eventRow)}</div>}
    {extraEvents.length > 0 && <UiPropertyGroup id="interaction-button-events" title="更多按钮事件" searchKeywords="悬停 移出 按下 松开 鼠标 事件">{extraEvents.map(eventRow)}</UiPropertyGroup>}
    {!button && uiControlValueType(project, component) && <p className="muted ui-field-help">值改变事件由玩家输入触发；蓝图赋值不会伪造玩家操作。</p>}
    {(button || uiControlValueType(project, component)) && <Field label="允许玩家操作" uiProperty="enabled"><input aria-label="允许玩家操作" type="checkbox" checked={!component.disabled} onChange={event => edit(target => { target.disabled = !event.target.checked; })} /></Field>}
    {includeVisibility && <UiInspectorVisibilityRule project={project} component={component} edit={edit} />}
    {(button || uiControlValueType(project, component)) && <UiConditionRule project={project} component={component} field="enabledWhen" edit={edit} />}
    {button && <UiConditionRule project={project} component={component} field="selectedWhen" edit={edit} />}
    {soundKinds.has(component.kind) && <UiPropertyGroup id="interaction-sounds" title="声音反馈" summary={component.hoverSoundId !== undefined || component.clickSoundId !== undefined ? '已单独设置' : '沿用页面'} searchKeywords="音效 声音 点击 悬停 页面 默认 静音">{(['hoverSoundId', 'clickSoundId'] as const).map(field => {
      const label = field === 'hoverSoundId' ? '悬停音效' : '点击音效';
      const current = component[field];
      const resolved = field === 'hoverSoundId' ? uiHoverSound(project, component) : uiClickSound(project, component);
      const audio = project.assets.filter(asset => asset.kind === 'audio');
      return <Field key={field} label={label} uiProperty={field === 'hoverSoundId' ? 'hoverSound' : 'clickSound'} hint={current === undefined ? '当前：' + (audio.find(asset => asset.id === resolved)?.name ?? '不播放') : current === null ? '此控件不播放音效。' : undefined}><select aria-label={'按钮' + label} value={current === null ? '__silent' : current ?? ''} onChange={event => edit(target => { target[field] = event.target.value === '__silent' ? null : event.target.value || undefined; })}>
        <option value="">使用页面默认音效</option><option value="__silent">不播放</option>{current && !audio.some(asset => asset.id === current) && <option value={current} disabled>音频已删除或类型不符</option>}{audio.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
      </select></Field>;
    })}</UiPropertyGroup>}
    {button && <UiPropertyGroup id="interaction-shortcut" title="提示与快捷键" summary={shortcut ? uiShortcutKeys[shortcut] : undefined} searchKeywords="悬停提示 按钮文字 键盘 快捷键">
      <Field label="悬停提示" uiProperty="tooltip" hint={component.tooltip === undefined ? component.skin?.hideText ? '沿用按钮文字；输入空文字可关闭提示。' : '默认没有提示。' : '此控件单独设置；空文字表示关闭提示。'}><input aria-label="悬停提示" maxLength={200} value={component.tooltip ?? (component.skin?.hideText ? component.text : '')} onChange={event => edit(target => { target.tooltip = event.target.value; })} /></Field>
      {component.tooltip !== undefined && !uiPropertyControlFor(project, component, 'tooltip') && <button type="button" className="text-button" onClick={() => edit(target => { delete target.tooltip; }, { separate: true })}>恢复默认悬停提示</button>}
      <Field label="快捷键"><select aria-label="按钮快捷键" value={shortcut ?? component.shortcut ?? ''} onChange={event => edit(target => { target.shortcut = event.target.value || undefined; })}>
        <option value="">无</option>{component.shortcut && !shortcut && <option value={component.shortcut} disabled>{component.shortcut}（自定义键，预览未支持）</option>}{Object.entries(uiShortcutKeys).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
      </select></Field>
      {conflicts.length > 0 && <p className="muted ui-field-help">此页面的{conflicts.map(other => '“' + componentName(other) + '”').join('、')}也使用此键；会优先命中显示在上层的按钮。</p>}
    </UiPropertyGroup>}
    <UiPropertyGroup id="interaction-existing-graphs" title={'已有蓝图' + (button ? '与流程出口' : '绑定')} summary={(component.events?.beforeClick || component.events?.onClick || component.events?.onShow) ? '已绑定' : undefined} searchKeywords="高级事件 页面接入 原点击 模式 停用 绑定 显示 蓝图 流程图 出口 名称">
      {button && <>
        <UiBoundGraphField label="页面接入入口" ariaLabel="按钮页面接入入口" hint="先执行此入口，再执行点击事件和主操作。" project={project} value={component.events?.beforeClick} onChange={value => edit(target => { target.events = { ...target.events, beforeClick: value }; })} onOpenGraph={onOpenGraph} />
        <Field label="原点击事件"><select aria-label="原点击事件模式" value={component.clickMode ?? 'append'} onChange={event => edit(target => { target.clickMode = event.target.value as 'append' | 'replace'; })}><option value="append">执行点击事件，再执行主操作</option><option value="replace">停用原点击事件，保留接入与主操作</option></select></Field>
        <UiBoundGraphField label="点击事件蓝图" hint={component.clickMode === 'replace' ? '引用保留，当前停用。切回执行点击事件后恢复。' : '在页面点击事件之后、主操作之前执行。'} disabled={component.clickMode === 'replace'} project={project} value={component.events?.onClick} onChange={value => edit(target => { target.events = { ...target.events, onClick: value }; })} onOpenGraph={onOpenGraph} />
      </>}
      <UiBoundGraphField label="显示事件蓝图" hint="控件所在页面显示时执行一次；不随显示条件反复触发。" project={project} value={component.events?.onShow} onChange={value => edit(target => { target.events = { ...target.events, onShow: value }; })} onOpenGraph={onOpenGraph} />
      {inactiveEvents.length > 0 && <div className="ui-inspector-inactive-events"><strong>当前绑定不适用的事件</strong>{inactiveEvents.map(({ graph, node }) => <button key={node.id} type="button" className="text-button" disabled={!onOpenGraph} onClick={() => onOpenGraph?.(graph.id, node.id)}>{node.name}</button>)}<p className="muted ui-field-help">事件保留在原蓝图中；更换控件来源后可能重新适用。</p></div>}
      {button && owner && <UiFlowExitFields project={project} component={component} pageId={owner} edit={edit} />}
      {button && component.nativeSlot && <p className="muted ui-field-help">此控件替代原系统按钮。修改点击行为后，系统按钮的位置仍由此控件占用。</p>}
    </UiPropertyGroup>
  </div>;
}

function UiBoundGraphField({ project, label, ariaLabel = label, hint, value, onChange, onOpenGraph, disabled, empty = '不执行' }: { project: Project; label: string; ariaLabel?: string; hint?: string; value?: string; onChange: (id?: string) => void; onOpenGraph?: OpenGraph; disabled?: boolean; empty?: string }) {
  const graphs = blueprintResources(project), existing = projectGraphs(project).find(graph => graph.id === value);
  return <Field label={label} hint={hint}><div className="ui-inspector-graph-field"><select aria-label={ariaLabel} value={value ?? ''} disabled={disabled} onChange={event => onChange(event.target.value || undefined)}>
    <option value="">{empty}</option>{value && !graphs.some(graph => graph.id === value) && <option value={value} disabled>{existing ? existing.name + '（当前引用）' : '蓝图已删除'}</option>}{graphs.map(graph => <option key={graph.id} value={graph.id}>{graph.name}</option>)}
  </select>{existing && onOpenGraph && <button type="button" className="small-button" aria-label={'打开' + label} onClick={() => onOpenGraph(existing.id)}>打开</button>}</div></Field>;
}

/** The same condition editor can live in the common display group without
 * duplicating a rule or changing its draft/apply/undo behavior. */
export function UiInspectorVisibilityRule({ project, component, edit }: { project: Project; component: UiComponent; edit: EditComponent }) {
  return <UiConditionRule project={project} component={component} field="visibleWhen" edit={edit} />;
}

function UiConditionRule({ project, component, field, edit }: { project: Project; component: UiComponent; field: 'visibleWhen' | 'enabledWhen' | 'selectedWhen'; edit: EditComponent }) {
  const [draft, setDraft] = useState<Condition>();
  useEffect(() => setDraft(undefined), [component.id]);
  const condition = component[field], value = condition ?? draft;
  const label = { visibleWhen: '显示', enabledWhen: '可操作', selectedWhen: '选中状态' }[field];
  const inherited = field === 'visibleWhen' ? '始终显示' : field === 'enabledWhen' ? component.disabled ? '已手动禁用' : '允许时可操作' : '跟随按钮功能';
  const description = condition ? uiConditionDescription(project, condition) : inherited;
  const property = ({ visibleWhen: 'visible', enabledWhen: 'enabled', selectedWhen: 'selected' } as const)[field];
  const propertyControl = uiPropertyControlFor(project, component, property)?.control;
  const parameter = propertyControl && project.variables.find(variable => variable.id === propertyControl.parameterId);
  const summary = propertyControl ? `${propertyControl.mode === 'sync' ? '同步' : '跟随'}：${parameter?.name ?? '参数已删除'}` : description;
  const first = project.variables[0];
  return <UiPropertyGroup id={'interaction-condition-' + field} className="ui-inspector-condition" title={label + '条件'} summary={summary} searchKeywords="参数 规则 条件 显示 可操作 选中 启用 全部 任一 比较">
    {field !== 'enabledWhen' && <Field label={field === 'visibleWhen' ? '显示状态' : '选中状态'} uiProperty={property} hint="默认由下方条件或控件功能决定；也可右键指定参数。"><span>{description}</span></Field>}
    {propertyControl && <p className="muted ui-field-help">当前{label}状态由关联参数决定；下面的默认条件已保留，恢复默认设置后生效。</p>}
    {value ? <>
      {condition && field === 'enabledWhen' && <p className="muted ui-field-help">{description}{component.disabled ? '；默认设置中，此控件仍处于手动禁用状态。' : ''}</p>}
      {condition && field === 'selectedWhen' && !propertyControl && <p className="muted ui-field-help">此条件会替代按钮功能自身的选中规则。</p>}
      <ConditionEditor project={project} condition={value} groupBySet onChange={next => condition ? edit(target => { target[field] = next; }) : setDraft(next)} />
      {condition ? <button type="button" className="text-button" onClick={() => { edit(target => { delete target[field]; }, { separate: true }); setDraft(undefined); }}>清除{label}条件</button> : <div className="button-row"><button type="button" className="small-button" onClick={() => { edit(target => { target[field] = value; }, { separate: true }); setDraft(undefined); }}>应用{label}条件</button><button type="button" className="text-button" onClick={() => setDraft(undefined)}>取消</button></div>}
    </> : <><p className="muted ui-field-help">{field === 'enabledWhen' ? inherited + '。' : ''}{field === 'selectedWhen' ? '只有需要自定义选中规则时才添加条件。' : '需要满足特定参数状态时，可以添加条件。'}</p><button type="button" className="small-button" disabled={!first} onClick={() => first && setDraft({ kind: 'compare', variableId: first.id, operator: 'eq', value: first.initial })}>添加{label}条件</button>{!first && <p className="muted ui-field-help">先在参数集中添加参数。</p>}</>}
  </UiPropertyGroup>;
}

function UiFlowExitFields({ project, component, pageId, edit }: { project: Project; component: UiComponent; pageId: string; edit: EditComponent }) {
  const actual = uiPageFlowEvents(project, pageId).find(event => event.componentId === component.id);
  return <UiPropertyGroup id="interaction-flow-exit" title="流程图出口" summary={actual ? '已显示' : '未显示'} searchKeywords="出口 名称 公开 页面 内部 自动 流程图">
    <Field label="流程图出口" hint="自动根据真实导航行为决定；手动禁用的按钮默认不显示。"><select aria-label="按钮流程图出口" value={component.flowEvent?.visible === undefined ? 'auto' : component.flowEvent.visible ? 'show' : 'hide'} onChange={event => edit(target => { target.flowEvent = { ...target.flowEvent, visible: event.target.value === 'auto' ? undefined : event.target.value === 'show' }; })}><option value="auto">自动判断</option><option value="show">公开为流程图出口</option><option value="hide">只在页面内部使用</option></select></Field>
    {(actual || component.flowEvent?.name) && <Field label="出口名称"><input aria-label="按钮流程图出口名称" maxLength={120} placeholder={component.name || component.text || '沿用按钮名称'} value={component.flowEvent?.name ?? ''} onChange={event => edit(target => { target.flowEvent = { ...target.flowEvent, name: event.target.value || undefined }; })} /></Field>}
    {actual?.problem && <p className="muted ui-field-help">{actual.problem}</p>}
  </UiPropertyGroup>;
}
