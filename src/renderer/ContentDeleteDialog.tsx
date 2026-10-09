import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { contentRemovalSelection } from '../core/content-browser';

export function ContentDeleteDialog({ removal, error, onCancel, onDelete }: {
  removal: ReturnType<typeof contentRemovalSelection>; error: string; onCancel: () => void; onDelete: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => previous?.focus({ preventScroll: true });
  }, []);
  const count = `${removal.items.length} 项资源${removal.folders.length ? `、${removal.folders.length} 个文件夹` : ''}`;
  return createPortal(<div className="modal-backdrop" onPointerDown={event => event.stopPropagation()} onKeyDown={event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
    if (event.key === 'Tab') {
      const buttons = [...dialog.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const next = buttons[(buttons.indexOf(document.activeElement as HTMLButtonElement) + (event.shiftKey ? buttons.length - 1 : 1)) % buttons.length];
      event.preventDefault(); next?.focus();
    }
  }}><section ref={dialog} className="dialog content-delete-dialog" role="alertdialog" aria-modal="true" aria-label="删除资源" aria-describedby="content-delete-description">
    <h2>删除{count}？</h2>
    <p id="content-delete-description">{removal.folders.length ? '将删除文件夹及其中全部资源和子文件夹，包括筛选隐藏的内容。' : '将从项目中删除所选资源。'}</p>
    <ul>{[...removal.folders.map(folder => folder.name + ' /'), ...removal.items.map(item => item.name)].slice(0, 6).map((name, index) => <li key={index}>{name}</li>)}{removal.keys.length > 6 && <li>以及其余 {removal.keys.length - 6} 项</li>}</ul>
    <p className="muted">导入的源文件保留。删除后可用 Ctrl+Z 撤销。</p>
    {error && <p role="alert" className="danger-text">{error}</p>}
    <footer><button type="button" onClick={onCancel}>取消</button><button type="button" className="danger-text" disabled={!removal.keys.length} onClick={onDelete}>确认删除</button></footer>
  </section></div>, document.body);
}
