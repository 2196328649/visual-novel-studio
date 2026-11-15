import { useState } from 'react';
import { Check } from 'lucide-react';
import type { AiChange } from '../core/ai';
import type { AiWorkflowProposal } from '../core/ai-workflow';
import { AiAgentReview } from './AiAgentReview';
import type { AssetUrl } from './StageEditor';

export interface AiProposalResult { changes: AiChange[]; selected: Set<number>; applied: boolean }

export function AiProposal({ result, assetUrl, readOnly, disabled, applying, onChange, onApply, onLocate }: {
  result: AiProposalResult; assetUrl: AssetUrl; readOnly: boolean; disabled: boolean; applying: boolean;
  onChange: (result: AiProposalResult) => void; onApply: () => void; onLocate: (id: string) => void;
}) {
  const [page, setPage] = useState(0);
  return <section className="ai-proposal" aria-label="AI 建议修改">
    <header><strong>{result.applied ? '已应用修改' : `待应用修改 · ${result.changes.length} 项`}</strong>
      {!result.applied && <label><input type="checkbox" aria-label="选择全部 AI 建议" disabled={disabled} checked={result.selected.size === result.changes.length}
        onChange={event => onChange({ ...result, selected: event.target.checked ? new Set(result.changes.map((_, i) => i)) : new Set() })} />全选</label>}
    </header>
    {result.changes.slice(page * 40, page * 40 + 40).map((change, offset) => {
      const i = page * 40 + offset;
      return <div className="ai-change" key={i}>
        <label><input type="checkbox" aria-label={`应用建议 ${i + 1}`} checked={result.selected.has(i)} disabled={result.applied || disabled}
          onChange={event => { const selected = new Set(result.selected); if (event.target.checked) selected.add(i); else selected.delete(i); onChange({ ...result, selected }); }} /><span>{change.label}</span></label>
        <div className="ai-change-detail">
          {change.assetId && <img src={assetUrl(change.assetId)} alt={`建议表情：${change.after}`} />}
          <div><small>原内容</small><pre>{change.before}</pre><small>建议</small><pre>{change.after}</pre></div>
          {change.lineId && <button type="button" className="text-button" disabled={disabled} onClick={() => onLocate(change.lineId!)}>定位台词</button>}
        </div>
      </div>;
    })}
    {result.changes.length > 40 && <div className="ai-result-pages"><button disabled={!page} onClick={() => setPage(page - 1)}>上一页</button><span>{page + 1} / {Math.ceil(result.changes.length / 40)}</span><button disabled={(page + 1) * 40 >= result.changes.length} onClick={() => setPage(page + 1)}>下一页</button></div>}
    <footer>{result.applied ? <span><Check size={14} />已写入工程，可撤销。</span> : <button className="primary" disabled={!result.selected.size || readOnly || disabled} onClick={onApply}>{applying ? '正在应用…' : `应用选中的 ${result.selected.size} 项修改`}</button>}</footer>
  </section>;
}

export function AiWorkflowReview({ value, disabled, onApply }: { value: { proposal: AiWorkflowProposal; applied: boolean }; disabled: boolean; onApply: () => void }) {
  const [page, setPage] = useState(0), proposal = value.proposal, summary = proposal.summary;
  const unchanged = proposal.kind === 'agent' && !proposal.changedFields?.length;
  const incomplete = proposal.tasks?.some(task => task.status === 'incomplete');
  const counts = [
    ['场景', summary.scenes], ['选择', summary.choices], ['结局', summary.endings],
    ['立绘更新', summary.portraitCharacters], ['台词修改', summary.changedLines],
    ['角色演出', summary.portraitLines], ['表情初选', summary.expressions], ['配音', summary.voices],
    ['新增素材', summary.importedAssets], ['章节变动', summary.chapters],
  ].filter((entry): entry is [string, number] => typeof entry[1] === 'number');
  const important = counts.filter(([, count]) => count > 0).slice(0, 4);
  return <section className="ai-proposal ai-workflow-proposal" aria-label="AI 创作方案">
    <header><strong>{value.applied ? '已应用创作方案' : unchanged ? '检查结果' : '待应用创作方案'}</strong>
      {incomplete && <span className="ai-incomplete-label">有未完成项</span>}
    </header>
    <p className="ai-proposal-summary">{proposal.kind === 'agent' ? `实际改动 ${summary.changes ?? 0} 处` : important.map(([name, count]) => `${name} ${count}`).join(' · ') || '已准备方案'}<span>检查了 {summary.lines} 句台词</span></p>
    {proposal.warnings.length > 0 && <div className="ai-proposal-warnings" aria-label="方案注意事项">{proposal.warnings.map((warning, index) => <p className="ai-workflow-warning" key={index}>{warning}</p>)}</div>}
    <AiAgentReview proposal={proposal} applied={value.applied} />
    <details className="ai-review-details"><summary>修改统计</summary><div className="ai-workflow-counts">{counts.map(([name, count]) => <span key={name}>{name}<b>{count}</b></span>)}</div></details>
    {!!proposal.details.length && <details className="ai-review-details"><summary>查看 {proposal.details.length} 项剧情与演出安排</summary>
      {proposal.details.slice(page * 30, page * 30 + 30).map((detail, index) => <div className="ai-workflow-detail" key={page * 30 + index}><strong>{detail.speaker}</strong><p>{detail.text}</p><span>{detail.action}</span>{detail.reason && <small>{detail.reason}</small>}</div>)}
      {proposal.details.length > 30 && <div className="ai-result-pages"><button disabled={!page} onClick={() => setPage(page - 1)}>上一页</button><span>{page + 1} / {Math.ceil(proposal.details.length / 30)}</span><button disabled={(page + 1) * 30 >= proposal.details.length} onClick={() => setPage(page + 1)}>下一页</button></div>}
    </details>}
    <footer>{value.applied ? <span><Check size={14} />已写入工程，可撤销。</span> : unchanged ? <span>没有实际修改，无需应用。</span> : <button className="primary" disabled={disabled} onClick={onApply}>{incomplete ? '应用已完成部分' : '应用创作方案'}</button>}</footer>
  </section>;
}
