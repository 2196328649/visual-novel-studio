import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Clapperboard } from 'lucide-react';
import type { Project } from '../core/model';
import { type PerformanceTarget } from '../core/performance-workspace';
import type { PreviewSelection } from '../core/line-preview';
import type { Commit } from './editor';
import type { AssetUrl } from './StageEditor';
import { LineEffects } from './LineEffects';
import './performance-workspace.css';

export function PassagePerformances({ project, nodeId, lineId, selectedLineIds, commit, assetUrl, select, openBlueprint, openPerformance }: {
  project: Project; nodeId?: string; lineId?: string; selectedLineIds?: string[]; commit: Commit; assetUrl: AssetUrl;
  select: (selection: PreviewSelection) => void; openBlueprint?: (id: string) => void; openPerformance?: (target: PerformanceTarget) => void;
}) {
  const [showOthers, setShowOthers] = useState(() => { try { return localStorage.getItem('vns:performance-show-unselected') === 'true'; } catch { return false; } });
  const selected = selectedLineIds?.length ? selectedLineIds : lineId ? [lineId] : [];
  const selectionKey = selected.join('/');
  const [expanded, setExpanded] = useState(() => new Set(lineId ? [lineId] : []));
  const rows = useRef(new Map<string, HTMLDivElement>());
  useEffect(() => { setExpanded(previous => new Set([...previous, ...selected])); }, [selectionKey]);
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => {
      const row = rows.current.get(lineId ?? '');
      const scroller = row?.closest<HTMLElement>('.preview-detail-scroll, .performance-authoring');
      if (!row || !scroller) return;
      const bounds = scroller.getBoundingClientRect(), heading = row.getBoundingClientRect();
      if (heading.top < bounds.top || heading.top + 40 > bounds.bottom) scroller.scrollTop += heading.top - bounds.top;
    });
    return () => cancelAnimationFrame(frame);
  }, [lineId]);
  const node = project.nodes.find(node => node.id === nodeId);
  if (!node || !['passage', 'chapterTitle'].includes(node.kind)) return null;
  return <section className="passage-performances" aria-label="所选段落演出" data-node-id={node.id}>
    {node.kind === 'passage' && <div className="performance-visibility"><label><input type="checkbox" checked={showOthers} onChange={event => { setShowOthers(event.target.checked); try { localStorage.setItem('vns:performance-show-unselected', String(event.target.checked)); } catch { /* Session preference still works. */ } }} />显示未选中台词演出</label></div>}
    {node.kind === 'passage' && <div className="passage-performance-lines">{node.lines.map((line, index) => {
      const opened = expanded.has(line.id), active = selected.includes(line.id);
      if (!showOthers && !active) return null;
      const choose = () => select({ nodeId: node.id, lineId: line.id });
      return <div key={line.id} ref={element => { if (element) rows.current.set(line.id, element); else rows.current.delete(line.id); }} className={`passage-performance-line ${active ? 'active' : ''}`} data-line-id={line.id}>
        <div className="performance-line-title"><button type="button" className="performance-line-heading" aria-expanded={opened} onClick={() => { choose(); setExpanded(previous => { const next = new Set(previous); next.has(line.id) ? next.delete(line.id) : next.add(line.id); return next; }); }}>
          {opened ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<span className="performance-line-number">{index + 1}</span><span title={line.text}>{line.silent ? '独立演出' : `${project.characters.find(character => character.id === line.speakerId)?.name ?? '旁白'}：${line.text || '（空白台词）'}`}</span><small>{line.actions.length + (line.voiceId ? 1 : 0)}</small>
        </button>{openPerformance && <button className="icon-button" title="在蓝图中编辑演出" aria-label="在蓝图中编辑演出" onClick={() => openPerformance({ nodeId: node.id, lineId: line.id })}><Clapperboard size={15} /></button>}</div>
        {opened && <LineEffects project={project} nodeId={node.id} line={line} number={index + 1} commit={commit} assetUrl={assetUrl} select={choose} autoExpand={active && selected.length === 1} openBlueprint={graphId => openPerformance ? openPerformance({ nodeId: node.id, lineId: line.id, graphId }) : openBlueprint?.(graphId)} />}
      </div>;
    })}</div>}
  </section>;
}
