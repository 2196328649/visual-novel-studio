import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Field, IconButton } from './components';

export function StoryGroupDialog({ name = '新的剧情组', count, onClose, onSave }: { name?: string; count?: number; onClose: () => void; onSave: (name: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null), returnFocus = useRef(document.activeElement as HTMLElement | null);
  const [value, setValue] = useState(name), [error, setError] = useState('');
  useEffect(() => { const element = dialog.current; element?.showModal(); element?.querySelector('input')?.select(); return () => { element?.close(); if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true }); }; }, []);
  const submit = () => { try { if (!value.trim() || value.trim().length > 120) throw new Error('请输入 1～120 字的剧情组名称。'); onSave(value.trim()); onClose(); } catch (error) { setError(error instanceof Error ? error.message : String(error)); } };
  return createPortal(<dialog ref={dialog} className="page-connection-dialog story-group-dialog" aria-label={count === undefined ? '重命名剧情组' : '打组为剧情组'} onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Enter' && event.target instanceof HTMLInputElement && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } }}>
    <header><h2>{count === undefined ? '重命名剧情组' : '打组为剧情组'}</h2><div className="spacer" /><IconButton title="关闭剧情组命名" onClick={onClose}><X size={17} /></IconButton></header>
    <div className="page-connection-body"><Field label="名称"><input aria-label="剧情组名称" value={value} maxLength={120} onChange={event => setValue(event.target.value)} /></Field>
      {count !== undefined && <p className="muted">收纳选中的 {count} 项内容，双击进入后继续编辑。原有剧情连接保持一致。</p>}{error && <p role="alert" className="game-flow-error">{error}</p>}
    </div><footer><div className="spacer" /><button className="small-button" onClick={onClose}>取消</button><button className="primary" disabled={!value.trim()} onClick={submit}>{count === undefined ? '保存名称' : '创建剧情组'}</button></footer>
  </dialog>, document.body);
}

export function StoryTargetDialog({ options, onClose, onChoose, entryChange }: { options: { id: string; name: string; location: string }[]; onClose: () => void; onChoose: (id: string) => void; entryChange?: { previous: string; next: string } }) {
  const dialog = useRef<HTMLDialogElement>(null), returnFocus = useRef(document.activeElement as HTMLElement | null);
  const [target, setTarget] = useState(options[0]?.id ?? '');
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => { element?.close(); if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true }); }; }, []);
  return createPortal(<dialog ref={dialog} className="page-connection-dialog story-group-dialog" aria-label={entryChange ? '更改故事入口' : '选择剧情组入口'} onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={event => event.stopPropagation()}>
    <header><h2>{entryChange ? '更改故事入口' : '进入组内哪个节点'}</h2><div className="spacer" /><IconButton title="取消入口选择" onClick={onClose}><X size={17} /></IconButton></header>
    <div className="page-connection-body">{entryChange ? <p>新游戏的故事入口将从“{entryChange.previous}”改为“{entryChange.next}”。可以一步撤销。</p> : <Field label="入口节点"><select aria-label="剧情组入口节点" value={target} onChange={event => setTarget(event.target.value)}>{options.map(option => <option key={option.id} value={option.id}>{option.name} · {option.location}</option>)}</select></Field>}</div>
    <footer><div className="spacer" /><button className="small-button" onClick={onClose}>取消</button><button className="primary" disabled={!target} onClick={() => onChoose(target)}>{entryChange ? '更改入口' : '连接到此处'}</button></footer>
  </dialog>, document.body);
}
