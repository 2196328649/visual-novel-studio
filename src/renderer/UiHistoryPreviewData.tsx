import type { Project } from '../core/model';
import type { previewUiLogic, UiPreviewEvent } from '../core/ui-logic-preview';

export function UiHistoryPreviewData({ project, preview, onEvent }: { project: Project; preview: ReturnType<typeof previewUiLogic>; onEvent: (event: UiPreviewEvent) => void }) {
 const source = preview.historySource;
 return <details className="ui-gallery-preview-data"><summary>历史测试记录</summary><p>这里使用工程中的示例对白，不读取玩家存档。可选择段落检查长台词和语音按钮；每个段落最多展示末尾 250 条，切换记录会停止试听。</p>
  <label>记录来源<select aria-label="历史测试记录来源" value={source.empty ? 'empty' : source.nodeId ? 'node:' + source.nodeId : 'recent'} onChange={e => onEvent({ kind: 'historyData', ...(e.target.value === 'empty' ? { empty: true } : e.target.value.startsWith('node:') ? { nodeId: e.target.value.slice(5) } : {}) })}>
   <option value="recent">最近 20 条示例对白</option><option value="empty">空历史</option>{project.nodes.filter(n => n.kind === 'passage').map(n => <option key={n.id} value={'node:' + n.id}>{n.name}</option>)}
  </select></label><output aria-label="历史测试记录数量">{preview.history.length} 条</output>
 </details>;
}
