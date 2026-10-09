import { useState } from 'react';
import type { AiPortraitComparison, AiPortraitImage, AiWorkflowProposal } from '../core/ai-workflow';

function PortraitImage({ image, label }: { image?: AiPortraitImage; label: string }) {
  const [failed, setFailed] = useState(false);
  return <figure className="ai-portrait-image">
    <figcaption>{label}</figcaption>
    <div>{image?.previewUrl && !failed
      ? <img src={image.previewUrl} alt={`${label}：${image.name}`} onError={() => setFailed(true)} />
      : <span>{image ? '图片暂不可用' : '无立绘'}</span>}</div>
    <small title={image?.path}>{image?.name ?? '—'}</small>
  </figure>;
}

function PortraitComparison({ portrait }: { portrait: AiPortraitComparison }) {
  const [selected, setSelected] = useState(portrait.expressions[0].id);
  const row = portrait.expressions.find(item => item.id === selected) ?? portrait.expressions[0];
  return <article className="ai-portrait-comparison" aria-label={`${portrait.name}立绘对比`}>
    <header><strong>{portrait.name}</strong><label>表情 <select aria-label={`${portrait.name}对比表情`} value={row.id} onChange={event => setSelected(event.target.value)}>
      {portrait.expressions.map(expression => <option key={expression.id} value={expression.id}>{expression.name}</option>)}
    </select></label></header>
    <div className="ai-portrait-pair">
      <PortraitImage key={'before_' + row.id + row.before?.previewUrl} image={row.before} label="修改前" />
      <PortraitImage key={'after_' + row.id + row.after?.previewUrl} image={row.after} label="修改后" />
    </div>
    <small className="muted">共 {portrait.expressions.length} 个表情的图片有变化，可切换检查。</small>
  </article>;
}

export function AiAgentReview({ proposal, applied }: { proposal: AiWorkflowProposal; applied: boolean }) {
  return <>
    {!!proposal.tasks?.length && <div className="ai-task-review" aria-label="逐项结果核对">
      <strong>逐项结果核对</strong>
      <ul>{proposal.tasks.map(task => <li key={task.id} data-status={task.status}>
        <div><b>{task.status === 'incomplete' ? '未完成' : task.status === 'unchanged' ? '无需修改' : applied ? '已应用' : '已核对'}</b><span>{task.title}</span></div>
        <p>{task.detail}</p>
      </li>)}</ul>
    </div>}
    {!!proposal.portraits?.length && <div className="ai-portrait-review" aria-label="立绘前后对比">
      <strong>立绘前后对比</strong>
      {proposal.portraits.map(portrait => <PortraitComparison key={portrait.characterId} portrait={portrait} />)}
    </div>}
  </>;
}
