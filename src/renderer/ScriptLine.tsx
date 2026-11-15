import { memo } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, Copy, Plus, Trash2 } from 'lucide-react';
import { makeId, type Project, type StoryLine } from '../core/model';
import { cloneData } from '../core/project-mutation';
import { setLineText } from '../core/text-spans';
import type { PerformanceTarget } from '../core/performance-workspace';
import { findLine, type Commit } from './editor';
import { editorPalette, readableColor } from './editor-theme';
import { IconButton } from './components';
import { LineEffects, lineTextEffectSummary } from './LineEffects';
import { TextSelectionToolbar } from './TextSpanTools';
import type { AssetUrl } from './StageEditor';

export interface ScriptTextSelection { lineId: string; start: number; end: number }
interface ScriptLineProps {
  /** Changes only when sibling rows' controls/resources can change. */
  context: Project;
  /** Event handlers and newly opened panels always read the latest snapshot. */
  getProject: () => Project;
  nodeId: string; line: StoryLine; index: number; lineCount: number;
  selected: boolean; expanded: boolean; textSelection?: ScriptTextSelection;
  palette: ReturnType<typeof editorPalette>;
  commit: Commit; playbackCommit: Commit; assetUrl: AssetUrl;
  /** New/copied rows need navigation; pointer/focus activation does not. */
  select: (nodeId: string, lineId: string) => void;
  activate: (nodeId: string, lineId: string) => void;
  focus: (nodeId: string, lineId: string) => void;
  toggle: (nodeId: string, lineId: string) => void;
  selectText: (lineId: string, start: number, end: number) => void;
  contextMenu: (nodeId: string, lineId: string, x: number, y: number) => void;
  openBlueprint?: (id: string) => void;
  openPerformance?: (target: PerformanceTarget) => void;
}

/** One changed line should not reconcile every textarea, speaker option and
 * action chip in a scene. Keep row UI mounted and memoize its actual inputs. */
export const ScriptLine = memo(function ScriptLine(props: ScriptLineProps) {
  const { selected, ...body } = props;
  const { nodeId, line, expanded, activate, contextMenu } = body;
  return <div id={`line-${line.id}`} className={`story-line${selected ? ' selected' : ''}${expanded ? ' text-expanded' : ''}`}
    onClick={() => activate(nodeId, line.id)}
    onContextMenu={event => { event.preventDefault(); event.stopPropagation(); contextMenu(nodeId, line.id, event.clientX, event.clientY); }}>
    <ScriptLineBody {...body} />
  </div>;
});

/** Selection is painted by the row's CSS. Its fields and live sample keep their
 * state without rebuilding whenever focus moves to another line. */
const ScriptLineBody = memo(function ScriptLineBody(props: Omit<ScriptLineProps, 'selected'>) {
  const { nodeId, line, index, lineCount, expanded, textSelection, palette, commit, playbackCommit, assetUrl, select, activate, focus, toggle, selectText, openBlueprint, openPerformance } = props;
  const project = props.getProject();
  const number = index + 1;
  const summary = lineTextEffectSummary(project, line);
  const edit = (label: string, change: (line: StoryLine) => void) => commit(label, draft => {
    const target = findLine(draft, nodeId, line.id);
    if (target?.id === line.id) change(target);
  });
  const move = (offset: number) => commit('移动对白', draft => {
    const node = draft.nodes.find(node => node.id === nodeId);
    if (node?.kind !== 'passage') return;
    const at = node.lines.findIndex(item => item.id === line.id), to = at + offset;
    if (at >= 0 && to >= 0 && to < node.lines.length) [node.lines[at], node.lines[to]] = [node.lines[to], node.lines[at]];
  });
  return <>
    <div className="line-gutter">
      <span className="line-number">{number}</span>
      {!line.silent && <button type="button" className={`line-expand${expanded ? ' is-open' : ''}`} aria-expanded={expanded} aria-label={`${expanded ? '收起' : '展开'}第${number}行台词文字演出`} title={summary.text || '设置这句台词的文字演出'} onClick={event => { event.stopPropagation(); toggle(nodeId, line.id); }}><ChevronRight size={14} />{!!summary.count && <span>{summary.count}</span>}</button>}
    </div>
    <div className="line-content">
      <LineEffects project={project} nodeId={nodeId} line={line} number={number} commit={commit} playbackCommit={playbackCommit} assetUrl={assetUrl} select={() => activate(nodeId, line.id)} openBlueprint={openBlueprint} openPerformance={openPerformance} mode="stage" />
      <div className="line-top">
        {line.silent ? <button className="text-button" onClick={() => edit('为演出添加对白', target => { delete target.silent; })}><Plus size={13} />仅演出 · 添加台词</button> : <select
          aria-label={`第${number}行说话人`} value={line.speakerId ?? ''}
          style={{ color: readableColor(project.characters.find(character => character.id === line.speakerId)?.color ?? palette.text, palette.input) }}
          onChange={event => edit(`说话人 ${line.id}`, target => { target.speakerId = event.target.value || undefined; })}>
          <option value="">旁白</option>{project.characters.map(character => <option key={character.id} value={character.id}>{character.name}</option>)}
        </select>}
        <div className="line-actions">
          <IconButton title="向上移动" disabled={index === 0} onClick={event => { event.stopPropagation(); move(-1); }}><ArrowUp size={13} /></IconButton>
          <IconButton title="向下移动" disabled={index === lineCount - 1} onClick={event => { event.stopPropagation(); move(1); }}><ArrowDown size={13} /></IconButton>
          <IconButton title="复制对白" onClick={event => {
            event.stopPropagation(); const id = makeId('line');
            commit('复制对白', draft => {
              const node = draft.nodes.find(node => node.id === nodeId);
              if (node?.kind !== 'passage') return;
              const at = node.lines.findIndex(item => item.id === line.id);
              if (at >= 0) node.lines.splice(at + 1, 0, { ...cloneData(node.lines[at]), id });
            });
            select(nodeId, id);
          }}><Copy size={13} /></IconButton>
          <IconButton title="删除对白" onClick={event => {
            event.stopPropagation(); commit('删除对白', draft => {
              const node = draft.nodes.find(node => node.id === nodeId);
              if (node?.kind !== 'passage') return;
              const at = node.lines.findIndex(item => item.id === line.id);
              if (at >= 0) node.lines.splice(at, 1);
            });
          }}><Trash2 size={13} /></IconButton>
        </div>
      </div>
      {!line.silent && <textarea aria-label={`第${number}行对白`} className="dialogue-input" placeholder="输入对白或旁白…"
        rows={Math.max(1, Math.min(7, Math.ceil(line.text.length / 46)))} value={line.text}
        onFocus={() => focus(nodeId, line.id)}
        onSelect={event => { const input = event.currentTarget; selectText(line.id, Array.from(input.value.slice(0, input.selectionStart)).length, Array.from(input.value.slice(0, input.selectionEnd)).length); }}
        onChange={event => edit(`对白 ${line.id}`, target => setLineText(target, event.target.value))} />}
      {!line.silent && !expanded && !!summary.count && <span className="line-summary muted" title={summary.text}>{summary.text}</span>}
      {!line.silent && expanded && <LineEffects project={project} nodeId={nodeId} line={line} number={number} commit={commit} assetUrl={assetUrl} select={() => activate(nodeId, line.id)} mode="text"
        topSlot={textSelection ? <TextSelectionToolbar project={project} line={line} start={textSelection.start} end={textSelection.end} edit={edit} assetUrl={assetUrl} /> : undefined} />}
    </div>
  </>;
});
