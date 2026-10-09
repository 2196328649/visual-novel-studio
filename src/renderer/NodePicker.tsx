import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Plus, Search, X } from 'lucide-react';
import { completionScore } from '../core/text-completion';
import { moveMenuIndex, useMenuWheel } from './menu-navigation';

export interface NodePickerItem { id: string; name: string; hint: string; category: string; disabled?: boolean; choose: () => void }
export function NodePicker({ x, y, items, onClose, title = '添加节点', embedded = false, closeOnChoose = true, initialQuery = '' }: { x: number; y: number; items: NodePickerItem[]; onClose: () => void; title?: string; embedded?: boolean; closeOnChoose?: boolean; initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState(0);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const filtered = useMemo(() => items.filter(item => completionScore(item.name, query, [item.hint, item.category]) > 0), [items, query]);
  const groups = [...new Set(filtered.map(item => item.category))];
  const available = groups.flatMap(group => collapsed.has(group) && !query ? [] : filtered.filter(item => item.category === group && !item.disabled));
  const current = available[Math.min(active, Math.max(0, available.length - 1))];
  useMenuWheel(root, direction => setActive(previous => moveMenuIndex(previous, direction, available.length)), embedded ? '.node-picker-results' : undefined);
  useEffect(() => { input.current?.focus(); const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) onClose(); }; document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside); }, []);
  useEffect(() => {
    const list = root.current?.querySelector<HTMLElement>('.node-picker-results'), item = list?.querySelector<HTMLElement>('[data-active="true"]');
    if (!list || !item) return;
    const top = item.offsetTop - list.offsetTop;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + item.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + item.offsetHeight - list.clientHeight;
  }, [current?.id]);
  const choose = (item: NodePickerItem) => { if (!item.disabled) { item.choose(); if (closeOnChoose) onClose(); } };
  return <div ref={root} role="dialog" aria-label={embedded ? '中文指令面板' : '添加蓝图节点'} className={`node-picker ${embedded ? 'text-command-palette' : ''}`} style={embedded ? { position: 'absolute', left: 14, top: 12 } : { left: Math.max(8, Math.min(x, innerWidth - 340)), top: Math.max(8, Math.min(y, innerHeight - Math.min(450, innerHeight - 16))) }} onPointerDown={event => event.stopPropagation()} onKeyDown={event => {
    if (event.nativeEvent.isComposing) return;
    if ((event.target as HTMLElement).closest('.menu-group-toggle') && (event.key === 'Enter' || event.code === 'Space')) return;
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); setActive(previous => moveMenuIndex(previous, event.key === 'ArrowDown' ? 1 : -1, available.length)); }
    if (event.key === 'Enter' || event.code === 'Space') { event.preventDefault(); event.stopPropagation(); if (current) choose(current); }
  }}>
    <div className="node-picker-heading"><strong>{title}</strong><button title="关闭节点搜索" onClick={onClose}><X size={15} /></button></div>
    <div className="search"><Search size={15} /><input ref={input} aria-label={embedded ? '筛选中文指令' : '搜索要添加的节点'} placeholder="输入名称、用途或拼音首字母…" value={query} onChange={event => { setQuery(event.target.value); setActive(0); }} /></div>
    <div className="node-picker-results">{groups.map(group => <section key={group}><button className="menu-group-toggle" aria-expanded={!collapsed.has(group) || !!query} onClick={() => { setCollapsed(previous => { const next = new Set(previous); next.has(group) ? next.delete(group) : next.add(group); return next; }); setActive(0); }}><ChevronRight size={13} />{group}<small>{filtered.filter(item => item.category === group).length}</small></button>{(!collapsed.has(group) || !!query) && filtered.filter(item => item.category === group).map(item => <button key={item.id} disabled={item.disabled} data-active={current?.id === item.id} onMouseEnter={() => { const position = available.findIndex(candidate => candidate.id === item.id); if (position >= 0) setActive(position); }} onClick={() => choose(item)} title={item.hint}><Plus size={14} /><span><strong>{item.name}</strong><small>{item.hint}</small></span></button>)}</section>)}{!filtered.length && <p>没有兼容的节点，试试其他搜索词。</p>}</div>
    <footer>{embedded ? '滚轮滚动 · ↑ ↓ 选择' : '滚轮 / ↑ ↓ 选择'} · Enter / 空格 添加 · Esc 关闭</footer>
  </div>;
}
