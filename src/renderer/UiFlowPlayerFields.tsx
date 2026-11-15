import { useContext } from 'react';
import type { Project, UiComponent } from '../core/model';
import { playerFlowMode } from '../core/player-flow-content';
import { Field } from './components';
import { UiAssetSelect } from './AssetPicker';
import { UiFlowRectNumbers } from './UiFlowRectFields';
import { UiFlowEditContext, playerFlowPreviewOptions, type FlowPreviewMode } from './UiFlowEditing';
import { UiPropertyGroup } from './UiPropertyGroup';
import type { AssetUrl } from './StageEditor';

export const uiFlowPlayerRulesSearchLabels: readonly string[] = [
  '可进入的剧情', '全部剧情', '曾经到达的剧情', '未到达的节点', '显示占位节点', '隐藏节点', '未到达时显示的文字',
  '未到达的连线', '正常显示', '变暗', '隐藏', '重新开始前确认', '文字附加已读和当前位置', '重玩', '跳转', '解锁',
];
export const uiFlowPlayerBrowsingSearchLabels: readonly string[] = [
  '显示缩放与定位按钮', '当前位置标记', '标记图片', '在画布标出当前位置标记', '当前位置标记区域', '恢复覆盖整个节点',
  ...['横向', '纵向', '宽度', '高度'].map(dimension => '当前位置标记区域' + dimension),
];
export const uiFlowPlayerSearchLabels: readonly string[] = [...uiFlowPlayerRulesSearchLabels, ...uiFlowPlayerBrowsingSearchLabels, '预览玩家进度', '全部已到达', '部分已到达', '显示当前位置', '预览当前节点'];

export function UiFlowPlayerFields({ project, component, edit, assetUrl, showPreview = true, section }: { project: Project; component: UiComponent; edit: (change: (component: UiComponent) => void) => void; assetUrl: AssetUrl; showPreview?: boolean; section?: 'rules' | 'browsing' }) {
  const list = component.list, branch = list?.layout === 'flow', editing = useContext(UiFlowEditContext);
  const entries = playerFlowPreviewOptions(project, component);
  const showRules = !section || section === 'rules', showBrowsing = !section || section === 'browsing';
  return <>
    {showRules && <>
    <p className="muted ui-field-help">{playerFlowMode(component) === 'custom' ? '设为“从这里重玩”的节点遵循以下规则；“仅查看”的节点不会开始剧情。' : '玩家点击剧情节点后，从此处重新开始剧情。'}未保存的本局进度不会带入。{project.nodes.some(node => node.kind === 'call') && '子剧情卡片用于进入查看，不会立即重玩。'}</p>
    <Field label="可进入的剧情"><select aria-label="可进入的剧情" value={list?.lockUnread ? 'reached' : 'all'} onChange={event => edit(c => { c.list = { ...c.list, lockUnread: event.target.value === 'reached' }; })}><option value="all">全部剧情</option><option value="reached">曾经到达的剧情</option></select></Field>
    {list?.lockUnread && <>
      <p className="muted ui-field-help">到达记录跨存档、跨周目保留。游戏起点始终可进入。</p>
      <Field label="未到达的节点"><select aria-label="未到达的节点" value={list.flowLockedNode ?? 'show'} onChange={event => edit(c => { c.list = { ...c.list, flowLockedNode: event.target.value === 'hide' ? 'hide' : undefined }; })}><option value="show">显示占位节点</option><option value="hide">隐藏节点</option></select></Field>
      {list.flowLockedNode !== 'hide' && <Field label="未到达时显示的文字" hint="留空时不显示文字。设置了未到达图片的样式直接显示图片。"><input aria-label="未到达时显示的文字" maxLength={40} value={list.flowLockedCaption ?? '未到达'} onChange={event => edit(c => { c.list = { ...c.list, flowLockedCaption: event.target.value === '未到达' ? undefined : event.target.value }; })} /></Field>}
      {branch && (list.flowLockedNode === 'hide' ? <p className="muted ui-field-help">隐藏节点时，与它相连的线也会隐藏。</p> : <Field label="未到达的连线"><select aria-label="未到达的连线" value={list.flowLockedLine ?? 'show'} onChange={event => edit(c => { c.list = { ...c.list, flowLockedLine: event.target.value === 'show' ? undefined : event.target.value as 'dim' | 'hide' }; })}><option value="show">正常显示</option><option value="dim">变暗</option><option value="hide">隐藏</option></select></Field>)}
    </>}
    <Field label="重新开始前确认" hint="游戏进行中询问是否放弃未保存进度；从主菜单进入时直接开始。"><input type="checkbox" checked={list?.confirmJump ?? true} onChange={event => edit(c => { c.list = { ...c.list, confirmJump: event.target.checked }; })} /></Field>
    <Field label="文字附加已读和当前位置"><input type="checkbox" checked={list?.showProgress ?? false} onChange={event => edit(c => { c.list = { ...c.list, showProgress: event.target.checked }; })} /></Field>
    </>}
    {showBrowsing && branch && <>
      <Field label="显示缩放与定位按钮"><input type="checkbox" checked={list.flowShowControls ?? true} onChange={event => edit(c => { c.list = { ...c.list, flowShowControls: event.target.checked }; })} /></Field>
      <UiPropertyGroup id="flow-player-current-marker" title="当前位置标记" searchKeywords="标记图片 在画布标出当前位置标记 恢复覆盖整个节点 当前位置标记区域横向 当前位置标记区域纵向 当前位置标记区域宽度 当前位置标记区域高度">
        <Field label="标记图片"><UiAssetSelect project={project} assetUrl={assetUrl} kind="image" label="当前位置标记" value={list.flowCurrentMarker?.assetId} onChange={value => edit(c => { c.list = { ...c.list, flowCurrentMarker: value ? { assetId: value, rect: c.list?.flowCurrentMarker?.rect ?? { x: 0, y: 0, width: 1, height: 1 } } : undefined }; })} /></Field>
        {list.flowCurrentMarker && <>
          <button type="button" className="text-button" aria-pressed={editing?.region === 'marker'} onClick={() => { editing?.setRegion(editing.region === 'marker' ? undefined : 'marker'); editing?.setPreview({ mode: 'current', currentId: editing.nodeId ?? entries[0]?.id }); }}>在画布标出当前位置标记</button>
          <p className="muted ui-field-help">相对当前节点摆放；宽高 100% 时覆盖整个节点。清空标记图片可关闭标记。</p>
          <UiFlowRectNumbers name="当前位置标记区域" value={list.flowCurrentMarker.rect} onChange={value => edit(c => { if (c.list?.flowCurrentMarker) c.list.flowCurrentMarker.rect = value; })} />
          <button type="button" className="text-button" disabled={list.flowCurrentMarker.rect.x === 0 && list.flowCurrentMarker.rect.y === 0 && list.flowCurrentMarker.rect.width === 1 && list.flowCurrentMarker.rect.height === 1} onClick={() => edit(c => { if (c.list?.flowCurrentMarker) c.list.flowCurrentMarker.rect = { x: 0, y: 0, width: 1, height: 1 }; })}>恢复覆盖整个节点</button>
        </>}
      </UiPropertyGroup>
    </>}
    {showPreview && editing && <div className="flow-progress-preview">
      <Field label="预览玩家进度"><select aria-label="预览玩家进度" value={editing.preview.mode} onChange={event => editing.setPreview({ ...editing.preview, mode: event.target.value as FlowPreviewMode })}><option value="all">全部已到达</option><option value="partial">部分已到达</option><option value="current">显示当前位置</option></select></Field>
      {editing.preview.mode === 'current' && <Field label="预览当前节点"><select aria-label="预览当前节点" value={editing.preview.currentId ?? entries.find(entry => entry.id === project.entryId)?.id ?? entries[0]?.id ?? ''} onChange={event => editing.setPreview({ mode: 'current', currentId: event.target.value })}>{entries.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></Field>}
      <small className="muted">仅供设计预览，不改变实际游戏进度。</small>
    </div>}
  </>;
}
