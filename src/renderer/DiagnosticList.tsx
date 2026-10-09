import { useId, useLayoutEffect, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, Check, ChevronDown, ChevronRight, CircleHelp } from 'lucide-react';
import type { Diagnostic, Project } from '../core/model';
import type { TextParseResult } from '../core/text-script';
import { diagnosticKey, diagnosticLocation, diagnosticSourceLine } from '../core/diagnostic-location';
import { visibleTextLine, type TextDocument } from '../core/text-document';
import './diagnostics.css';

interface DiagnosticListProps {
  issues: Diagnostic[];
  project: Project;
  parsed?: TextParseResult;
  document?: TextDocument;
  mode?: 'script' | 'text' | 'other';
  onLocate?: (issue: Diagnostic) => void;
  compact?: boolean;
}

function DiagnosticItem({ issue, project, parsed, document, mode, onLocate, compact }: Omit<DiagnosticListProps, 'issues'> & { issue: Diagnostic }) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const row = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (!expanded || !row.current) return;
    const scroller = row.current.closest<HTMLElement>('.diagnostic-scroll, .problems-content');
    if (!scroller) return;
    const bounds = scroller.getBoundingClientRect(), item = row.current.getBoundingClientRect();
    if (item.top < bounds.top || item.height > scroller.clientHeight) scroller.scrollTop += item.top - bounds.top;
    else if (item.bottom > bounds.bottom) scroller.scrollTop += item.bottom - bounds.bottom;
  }, [expanded]);
  const { label, destination } = diagnosticLocation(project, issue, parsed);
  const sourceLine = diagnosticSourceLine(issue, parsed);
  const visibleLine = sourceLine && document ? visibleTextLine(document, sourceLine) : undefined;
  const text = destination?.kind === 'text' || destination?.kind === 'story' && (mode === 'text' && !!sourceLine || !!issue.sourceLine);
  const action = !destination || !onLocate ? '查看说明' : text ? '定位文本' : destination.kind === 'story' ? '定位模块' : destination.kind === 'blueprint' ? '定位蓝图' : destination.kind === 'ui' ? '定位控件' : destination.kind === 'asset' ? '查看素材' : '设置入口';
  const guidance = issue.help ?? (destination?.kind === 'blueprint' ? '检查此蓝图节点的参数和连线。' : destination?.kind === 'story' || destination?.kind === 'text' ? '点击定位，在对应的段落或指令处检查提示中提到的内容。' : destination?.kind === 'asset' ? '打开对应素材，检查文件是否存在、类型是否正确。' : '根据这条提示检查作品设置、素材或界面配置。');
  return <article ref={row} className={'diagnostic-item ' + issue.severity} data-code={issue.code} data-node-id={issue.nodeId} data-component-id={issue.ui?.componentId} data-ui-instance-id={issue.ui?.instanceId} data-ui-page-id={issue.ui?.customPageId ?? issue.ui?.page}>
    <div className="diagnostic-item-heading">
      <button type="button" className={(compact ? 'text-issue ' : 'diagnostic ') + 'diagnostic-main ' + issue.severity} title={action + '：' + label} onClick={() => { setExpanded(true); if (destination) onLocate?.(issue); }}>
        {issue.severity === 'error' ? <AlertCircle size={15} /> : <AlertTriangle size={15} />}
        <span className="diagnostic-copy"><strong>{issue.message}</strong><small>{label}{visibleLine ? ' · 文本第 ' + visibleLine + ' 行' : ''}</small></span>
        <span className="diagnostic-destination">{action}<ChevronRight size={13} /></span>
      </button>
      <button type="button" className="diagnostic-help" aria-label={'查看原因与处理方法：' + issue.message} aria-expanded={expanded} aria-controls={detailsId} title="原因与处理方法" onClick={() => setExpanded(value => !value)}><CircleHelp size={15} /></button>
    </div>
    {expanded && <div className="diagnostic-details" id={detailsId}><p>{guidance}</p><small>{issue.severity === 'warning' ? '提醒 · 不阻止试玩' : '错误 · 可能导致试玩或导出失败'}</small></div>}
  </article>;
}

export function DiagnosticList(props: DiagnosticListProps) {
  return <>{props.issues.map(issue => <DiagnosticItem {...props} issue={issue} key={diagnosticKey(issue)} />)}</>;
}

export function TextDiagnostics(props: DiagnosticListProps) {
  const [collapsed, setCollapsed] = useState(false);
  const listId = useId();
  const errors = props.issues.filter(issue => issue.severity === 'error').length;
  const warnings = props.issues.length - errors;
  if (!props.issues.length) return <div className="text-parse-status ok"><Check size={14} /><span>内容检查通过</span></div>;
  return <>
    <button type="button" className={'text-parse-status text-diagnostic-summary ' + (errors ? 'error' : 'warning')} aria-expanded={!collapsed} aria-controls={listId} aria-label={collapsed ? '展开全部问题' : '收起问题列表'} onClick={() => setCollapsed(value => !value)}>
      {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
      <span>{[errors ? errors + ' 个错误' : '', warnings ? warnings + ' 条提醒' : ''].filter(Boolean).join(' · ')}</span>
      <small>{errors ? '点击问题定位并查看处理方法' : '点击问题定位 · 提醒不阻止试玩'}</small>
    </button>
    {!collapsed && <div className="text-issue-list diagnostic-scroll" id={listId} aria-label="全部问题"><DiagnosticList {...props} compact /></div>}
  </>;
}
