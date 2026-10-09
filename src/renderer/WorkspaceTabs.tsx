import { useEffect, useRef, useState, type ComponentType } from 'react';

type Tab = { id: string; label: string; Icon: ComponentType<{ size?: number }>; active: boolean; select: () => void };
const key = 'vns-workspace-tab-order';
export function WorkspaceTabs({ items }: { items: Tab[] }) {
  const [order, setOrder] = useState<string[]>(() => { try { const value = JSON.parse(localStorage.getItem(key) ?? '[]'); return Array.isArray(value) ? value.filter(item => typeof item === 'string') : []; } catch { return []; } });
  const [dragging, setDragging] = useState<string>();
  const active = useRef<string | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const suppressClick = useRef(false);
  const sorted = [...order.filter(id => items.some(item => item.id === id)), ...items.map(item => item.id).filter(id => !order.includes(id))];
  useEffect(() => { localStorage.setItem(key, JSON.stringify(order)); }, [order]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const move = (source: string, target: string) => {
    if (source === target) return;
    const next = [...sorted], from = next.indexOf(source), to = next.indexOf(target);
    if (from < 0 || to < 0) return;
    next.splice(from, 1); next.splice(to, 0, source); setOrder(next);
  };
  const finish = () => { clearTimeout(timer.current); active.current = undefined; setDragging(undefined); };
  return <div className="tabs reorderable-tabs">{sorted.map(id => {
    const tab = items.find(item => item.id === id)!;
    return <button key={id} data-workspace-tab={id} className={`${tab.active ? 'active' : ''} ${dragging === id ? 'tab-dragging' : ''}`} title="长按拖动调整位置；Alt + 左右方向键也可移动"
      onPointerDown={event => {
        if (event.button !== 0) return;
        suppressClick.current = false; clearTimeout(timer.current);
        event.currentTarget.setPointerCapture(event.pointerId);
        timer.current = setTimeout(() => { active.current = id; setDragging(id); suppressClick.current = true; }, 350);
      }}
      onPointerMove={event => { if (!active.current) return; const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-workspace-tab]')?.dataset.workspaceTab; if (target) move(active.current, target); }}
      onPointerUp={finish} onPointerCancel={finish}
      onClick={() => { if (!suppressClick.current) tab.select(); suppressClick.current = false; }}
      onKeyDown={event => { if (event.altKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); const target = sorted[sorted.indexOf(id) + (event.key === 'ArrowLeft' ? -1 : 1)]; if (target) move(id, target); } }}>
      <tab.Icon size={16} />{tab.label}
    </button>;
  })}</div>;
}
