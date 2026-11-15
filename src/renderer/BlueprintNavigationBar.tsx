import { useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { Project } from '../core/model';
import { projectGraphs } from '../core/project-resources';
import type { BlueprintVisit } from './blueprint-navigation';
import './blueprint-navigation.css';

export function BlueprintNavigationBar({ project, visits, onBack, compact = false }: { compact?: boolean; project: Project; visits: readonly BlueprintVisit[]; onBack(): void }) {
  useEffect(() => {
    const back = (event: KeyboardEvent) => {
      if (document.querySelector('dialog[open], .modal-backdrop, [popover]:popover-open')) return;
      if (event.altKey && event.key === 'ArrowLeft' && !event.ctrlKey && !event.metaKey && !event.shiftKey && !(event.target as HTMLElement)?.closest('input, textarea, select, [contenteditable="true"], dialog, .modal-backdrop')) { event.preventDefault(); onBack(); }
    };
    window.addEventListener('keydown', back); return () => window.removeEventListener('keydown', back);
  }, [onBack]);
  if (!visits.length) return null;
  const names = new Map<string, string>();
  for (const visit of visits) if (visit.from.origin.performance?.temporary) for (const graph of projectGraphs(visit.from.origin.performance.temporary.workspace.project)) names.set(graph.id, graph.name);
  for (const graph of projectGraphs(project)) names.set(graph.id, graph.name);
  const name = (id: string) => names.get(id) ?? '已删除的蓝图';
  const path = [visits[0].from.origin.graphId, ...visits.map(visit => visit.targetId)].map(name).join(' / ');
  return <nav className={'blueprint-navigation-bar' + (compact ? ' compact' : '')} aria-label="模块调用导航" title={path}><button className="small-button" aria-label="返回调用位置" title={'返回「' + name(visits.at(-1)!.from.origin.graphId) + '」（Alt+←），恢复选择与画布位置，不撤销编辑。调用路径：' + path} onClick={onBack}><ArrowLeft size={14} /><span>返回</span><span className="blueprint-return-source">「{name(visits.at(-1)!.from.origin.graphId)}」</span></button>{!compact&&<><span title={path}>{path}</span><small>返回不撤销修改</small></>}</nav>;
}
