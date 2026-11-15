import { useContext, useMemo } from 'react';
import { Eye, RotateCcw } from 'lucide-react';
import type { Project, UiButtonState, UiComponent } from '../core/model';
import { UiFlowEditContext, playerFlowPreviewOptions, type FlowPreviewMode } from './UiFlowEditing';
import { UiToolbarPopover } from './UiToolbarPopover';
import './ui-flow-preview-controls.css';

const visualStates: readonly { value: UiButtonState; label: string }[] = [
  { value: 'idle', label: '普通' }, { value: 'hover', label: '悬停' },
  { value: 'pressed', label: '按住' }, { value: 'disabled', label: '未到达' },
  { value: 'selected', label: '当前位置' },
];

/** This toolbar edits only the canvas session, never player progress or the project. */
export function UiFlowPreviewControls({ project, component }: { project: Project; component: UiComponent }) {
  const editing = useContext(UiFlowEditContext);
  const entries = useMemo(() => playerFlowPreviewOptions(project, component), [project, component]);
  if (!editing) return null;
  const currentId = entries.some(entry => entry.id === editing.preview.currentId) ? editing.preview.currentId!
    : entries.some(entry => entry.id === project.entryId) ? project.entryId : entries[0]?.id ?? '';
  const fixedState = visualStates.find(state => state.value === editing.visualState)?.label;
  const natural = editing.visualState === undefined && editing.preview.mode === 'all' && !editing.preview.currentId && !editing.impact && !editing.region;
  const restore = () => {
    editing.setVisualState?.(undefined); editing.setPreview({ mode: 'all' });
    editing.setImpact?.(undefined); editing.setRegion(undefined);
  };
  return <>
    {fixedState && <span className="ui-flow-preview-state" aria-label={`剧情图固定预览：${fixedState}`} title="当前节点与受影响节点的设计预览状态">{fixedState}</span>}
    <UiToolbarPopover label="剧情图预览" title="剧情图预览：视觉状态与玩家进度样例" icon={<Eye size={16} />}>
      <div className="ui-flow-preview-controls">
        <p>仅用于设计预览，不保存到游戏。</p>
        <label><span>视觉状态</span><select aria-label="预览视觉状态" value={editing.visualState ?? 'auto'} onChange={event => editing.setVisualState?.(event.target.value === 'auto' ? undefined : event.target.value as UiButtonState)}>
          <option value="auto">自动（随鼠标与进度）</option>
          {visualStates.map(state => <option key={state.value} value={state.value}>{state.label}</option>)}
        </select></label>
        <label><span>玩家进度</span><select aria-label="预览玩家进度" value={editing.preview.mode} onChange={event => editing.setPreview({ ...editing.preview, mode: event.target.value as FlowPreviewMode })}>
          <option value="all">全部到达</option><option value="partial">部分到达</option><option value="current">标出当前位置</option>
        </select></label>
        <label><span>当前节点</span><select aria-label="预览当前节点" value={currentId} disabled={!entries.length} onChange={event => editing.setPreview({ ...editing.preview, currentId: event.target.value || undefined })}>
          {entries.length ? entries.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>) : <option value="">暂无剧情节点</option>}
        </select></label>
        <small>固定视觉应用于当前参考节点和正在调整的节点；玩家进度决定到达范围。</small>
        <button type="button" className="small-button" disabled={natural} onClick={restore}><RotateCcw size={13} aria-hidden="true" />恢复自然预览</button>
      </div>
    </UiToolbarPopover>
  </>;
}
