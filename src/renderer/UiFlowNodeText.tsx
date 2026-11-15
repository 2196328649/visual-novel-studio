import { useEffect, useRef, useState } from 'react';
import { Paintbrush, Plus, Trash2 } from 'lucide-react';
import type { Project } from '../core/model';
import type { StoryMenuEntry } from '../core/story-menu';
import { editStoryFlowEntry, storyFlowContentEdit, storyFlowOwner, storyFlowSourceLabel } from '../core/story-flow-authoring';
import { Field, IconButton } from './components';
import type { Commit } from './editor';

/** Draft rows retain empty inputs while editing; storage stays compatible with ｜. */
export function UiFlowNodeText({ project, entry, commit, disabled = false, selectedPart, onSelectPart, onEditStyle, localContent }: {
  project: Project; entry: StoryMenuEntry; commit: Commit; disabled?: boolean;
  selectedPart?: number; onSelectPart?: (textIndex: number) => void; onEditStyle?: (textIndex: number) => void;
  localContent?: { name?: string; write: (draft: Project, name: string | undefined) => boolean };
}) {
  const raw = localContent ? localContent.name : storyFlowOwner(project, entry.owner)?.flowchart?.name;
  const display = raw ?? entry.title ?? entry.name;
  const [parts, setParts] = useState(() => display.split('｜'));
  const lastWritten = useRef<string | undefined>(raw);
  const previousDisplay = useRef(display);
  const latest = useRef({ disabled, id: entry.id });
  latest.current = { disabled, id: entry.id };
  useEffect(() => {
    if (raw !== lastWritten.current || raw === undefined && display !== previousDisplay.current) setParts(display.split('｜'));
    lastWritten.current = raw;
    previousDisplay.current = display;
  }, [raw, display]);
  const update = (next: string[]) => {
    if (latest.current.disabled || latest.current.id !== entry.id) return false;
    const name = next.join('｜') || undefined;
    if (name === lastWritten.current) { setParts(next); return true; }
    let written = false;
    commit(localContent ? '本图节点文字' : storyFlowContentEdit, draft => {
      if (localContent) written = localContent.write(draft, name);
      else { editStoryFlowEntry(draft, entry.id, { name }); written = true; }
    });
    if (!written) return false;
    lastWritten.current = name;
    setParts(next);
    return true;
  };
  const used = parts.join('｜').length;
  // Empty draft rows are not visible text parts: runtime captions trim and skip
  // them. Keep their input state without selecting another part's appearance.
  const visiblePartIndex = (index: number) => parts[index].trim() ? parts.slice(0, index).filter(part => part.trim()).length : undefined;
  return <fieldset className="flow-node-text-editor" disabled={disabled} aria-label="当前节点文字">
    <p className="flow-edit-scope">剧情来源：<strong>{storyFlowSourceLabel(project, entry.owner) || entry.title || entry.name}</strong><br />{localContent ? '文字只用于当前这张图，剧情标题保持原样。' : '文字同步到其他“跟随剧本”的剧情图。'}</p>
    {parts.map((part, index) => {
      const textIndex = visiblePartIndex(index);
      const selectPart = () => { if (!latest.current.disabled && latest.current.id === entry.id && textIndex !== undefined) onSelectPart?.(textIndex); };
      return <div className="flow-node-text-row" key={index} data-flow-text-part={textIndex} data-flow-text-selected={textIndex !== undefined && selectedPart === textIndex ? '' : undefined}>
        <Field label={`文字第 ${index + 1} 段`}><input aria-label={`节点文字第 ${index + 1} 段`} data-flow-node-field={index === 0 ? entry.id : undefined} value={part} maxLength={Math.max(part.length, 120 - used + part.length)} placeholder={parts.length === 1 ? entry.title : '输入这一段文字'} onFocus={selectPart} onChange={event => {
          const next = parts.map((value, at) => at === index ? event.target.value : value);
          if (update(next) && next[index].trim()) onSelectPart?.(next.slice(0, index).filter(value => value.trim()).length);
        }} /></Field>
        {(onEditStyle || parts.length > 1) && <div className="flow-node-text-actions">
          {onEditStyle && <IconButton title={`调整文字第 ${index + 1} 段外观`} disabled={textIndex === undefined} onClick={() => { if (!latest.current.disabled && latest.current.id === entry.id && textIndex !== undefined) { onSelectPart?.(textIndex); onEditStyle(textIndex); } }}><Paintbrush size={13} /></IconButton>}
          {parts.length > 1 && <IconButton title={`删除文字第 ${index + 1} 段`} onClick={() => {
            const next = parts.filter((_, at) => at !== index), visibleCount = next.filter(value => value.trim()).length;
            if (update(next) && selectedPart !== undefined && visibleCount) onSelectPart?.(Math.min(visibleCount - 1, Math.max(0, selectedPart - (textIndex !== undefined && textIndex < selectedPart ? 1 : 0))));
          }}><Trash2 size={13} /></IconButton>}
        </div>}
      </div>;
    })}
    <div className="button-row"><button type="button" className="small-button" disabled={used >= 120} onClick={() => { if (!latest.current.disabled && latest.current.id === entry.id) setParts([...parts, '']); }}><Plus size={13} />添加文字段</button><button type="button" className="text-button" disabled={raw === undefined} onClick={() => {
      if (latest.current.disabled || latest.current.id !== entry.id) return;
      let written = false;
      commit(localContent ? '本图节点文字' : storyFlowContentEdit, draft => {
        if (localContent) written = localContent.write(draft, undefined);
        else { editStoryFlowEntry(draft, entry.id, { name: undefined }); written = true; }
      });
      if (written) { lastWritten.current = undefined; setParts((entry.title ?? entry.name).split('｜')); }
    }}>使用剧情标题</button></div>
  </fieldset>;
}
