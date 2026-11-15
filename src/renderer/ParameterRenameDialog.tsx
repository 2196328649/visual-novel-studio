import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export function ParameterRenameDialog({ title, name, error, setName, close, submit }: {
  title: string; name: string; error: string; setName: (value: string) => void; close: () => void; submit: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), previous = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => {
    const element = dialog.current; element?.showModal();
    element?.querySelector('input')?.select();
    return () => { element?.close(); requestAnimationFrame(() => { if (previous.current?.isConnected) previous.current.focus({ preventScroll: true }); }); };
  }, []);
  return createPortal(<dialog ref={dialog} className="dialog parameter-name-dialog" aria-label="重命名" onCancel={event => { event.preventDefault(); close(); }}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.nativeEvent.isComposing || event.keyCode === 229) { if (event.key === 'Enter') event.preventDefault(); return; }
      if (['F5', 'F6'].includes(event.key) || (event.ctrlKey || event.metaKey) && ['s', 'z', 'y'].includes(event.key.toLowerCase())) event.preventDefault();
    }}>
    <form onSubmit={event => { event.preventDefault(); submit(); }}><h2>{title}</h2><input aria-label="新名称" autoFocus maxLength={120} value={name} onChange={event => setName(event.target.value)} />
      {error && <p role="alert">{error}</p>}<footer><button type="button" onClick={close}>取消</button><button type="submit" className="primary">确定</button></footer>
    </form>
  </dialog>, document.body);
}
