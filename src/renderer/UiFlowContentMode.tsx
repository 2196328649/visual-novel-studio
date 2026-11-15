import { useEffect, useState } from 'react';
import { ChevronRight, Copy, FilePlus2, RefreshCw } from 'lucide-react';
import { Field } from './components';

export const uiFlowContentSearchLabels: readonly string[] = [
  '内容生成 剧情图内容来源 跟随剧本 自定义 从当前图开始 新建空图 从剧本重新生成 管理本图剧情 管理显示的剧情',
  '添加剧情节点 添加剧情分组 缺失剧情 修复入口 点击这个节点 从这里重玩 仅查看',
];

/** Switching back keeps the inactive configuration; replacing it is explicit. */
export function UiFlowContentMode({ scope, mode, hasCustom, count, disabled, scriptPending, onMode, onInitialize, onRegenerate, onManage }: {
  scope: string; mode: 'script' | 'custom'; hasCustom: boolean; count: number; disabled?: boolean; scriptPending?: boolean;
  onMode: (mode: 'script' | 'custom') => void; onInitialize: (from: 'current' | 'empty') => void;
  onRegenerate: () => void; onManage: () => void;
}) {
  const [choosing, setChoosing] = useState(false), [confirming, setConfirming] = useState(false);
  useEffect(() => { setChoosing(false); setConfirming(false); }, [scope, mode]);
  const shownMode = choosing ? 'custom' : mode;
  return <div className="flow-content-mode" data-flow-content-mode={mode}>
    <Field label="内容来源"><select aria-label="剧情图内容来源" disabled={disabled} value={shownMode} onChange={event => {
      setConfirming(false);
      if (event.target.value === 'custom' && !hasCustom) setChoosing(true);
      else { setChoosing(false); onMode(event.target.value as 'script' | 'custom'); }
    }}><option value="script">跟随剧本</option><option value="custom">自定义</option></select></Field>
    {choosing ? <div className="flow-content-initialize" role="group" aria-label="开始自定义剧情图">
      <p className="muted ui-field-help">选择起点。以后可随时切回跟随剧本，两种模式分别保留内容。</p>
      <button type="button" className="flow-navigation-card" disabled={disabled || scriptPending} onClick={() => onInitialize('current')}><Copy size={16} /><span><strong>从当前图开始</strong><small>复制当前节点、文字、外观预设与位置</small></span><ChevronRight size={15} /></button>
      <button type="button" className="flow-navigation-card" disabled={disabled} onClick={() => onInitialize('empty')}><FilePlus2 size={16} /><span><strong>新建空图</strong><small>从已有剧情中逐个加入入口</small></span><ChevronRight size={15} /></button>
      {scriptPending && <p className="muted ui-field-help">同步剧本文本后可复制当前图。</p>}
    </div> : <>
      <p className="flow-edit-scope">{mode === 'script' ? '根据剧本中的章节与显示设置生成。新增章节会自动加入。' : '只编辑当前这张图的节点、文字和分组。新增章节不会自动加入。'}</p>
      <button type="button" className="flow-navigation-card" disabled={disabled} onClick={onManage}><span><strong>{mode === 'custom' ? '管理本图剧情' : '管理显示的剧情'}</strong><small>{count} 个剧情节点{mode === 'custom' ? ' · 添加、排序、分组' : ' · 章节、小章节和段落'}</small></span><ChevronRight size={16} /></button>
      {mode === 'script' && hasCustom && <small className="muted">已保留自定义内容，切换回自定义即可继续编辑。</small>}
      {mode === 'custom' && <>
        <small className="muted">连线始终来自真实剧情分支；整理图示不会改动剧情顺序。</small>
        {confirming ? <div className="flow-content-confirm" role="alertdialog" aria-label="从剧本重新生成">
          <strong>替换这张图的自定义内容？</strong>
          <p>按当前剧本显示设置重新复制节点、文字、外观预设和位置；已有分组会清空。本图外观与玩家操作设置保留，可撤销。</p>
          <div className="button-row"><button type="button" className="small-button danger-text" disabled={disabled || scriptPending} onClick={() => { onRegenerate(); setConfirming(false); }}>替换自定义内容</button><button type="button" className="text-button" onClick={() => setConfirming(false)}>保留当前内容</button></div>
        </div> : <button type="button" className="text-button" disabled={disabled || scriptPending} onClick={() => setConfirming(true)}><RefreshCw size={13} />从剧本重新生成</button>}
        {scriptPending && <small className="muted">同步剧本文本后可从剧本重新生成。</small>}
      </>}
    </>}
  </div>;
}
