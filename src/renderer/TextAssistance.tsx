import { textareaOffsetPoint } from './text-wrap-layout';
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { ChevronRight, Code2, UserRound } from 'lucide-react';
import type { TextAssistance as Assistance, TextCompletion } from '../core/text-completion';
import type { Project } from '../core/model';
import { serializeParameterValue, textReference } from '../core/text-script';
import { UiAssetSelect } from './AssetPicker';
import type { AssetUrl } from './StageEditor';

/** Position a popup by the native caret without moving focus away from the IME. */
export function TextAssistance({ project, assistance, input, selected, onSelect, assetUrl, visibleItems, collapsed, onToggleGroup, onMove, onBrowseChange }: {
  project: Project;
  assistance: Assistance; input: RefObject<HTMLTextAreaElement | null>; selected: number; onSelect: (item: TextCompletion) => void; assetUrl: AssetUrl;
  visibleItems: TextCompletion[]; collapsed: Set<string>; onToggleGroup: (group: string) => void; onMove: (direction: number) => void;
  onBrowseChange?: (open: boolean) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = root.current;
    const wheel = (event: WheelEvent) => { const list = element?.querySelector<HTMLElement>('.text-completion-list'); if (!list) return; event.preventDefault(); event.stopPropagation(); list.scrollTop += event.deltaY * (event.deltaMode === 1 ? 24 : 1); };
    element?.addEventListener('wheel', wheel, { passive: false });
    return () => element?.removeEventListener('wheel', wheel);
  }, []);
  const groups = [...new Set(assistance.items.map(item => item.group ?? '建议'))];
  const [position, setPosition] = useState<{ left: number; top: number; maxHeight: number }>();
  useLayoutEffect(() => {
    const textarea = input.current, popup = root.current;
    if (!textarea || !popup) return;
    const place = () => {
      const parent = popup.offsetParent as HTMLElement | null; if (!parent) return;
      const style = getComputedStyle(textarea), bounds = textarea.getBoundingClientRect(), outer = parent.getBoundingClientRect();
      const caret = textarea.selectionStart;
      const point=textareaOffsetPoint(textarea,caret);
      const lineHeight = parseFloat(style.lineHeight) || 22;
      const x=bounds.left-outer.left+point.x-textarea.scrollLeft;
      const y=bounds.top-outer.top+point.y-textarea.scrollTop;
      if (y < -lineHeight || y > outer.height || x < bounds.left - outer.left - 20 || x > outer.width + 10) { setPosition(undefined); return; }
      const height = Math.min(popup.scrollHeight || 260, 300, outer.height - 16);
      const below = y + lineHeight + 4;
      setPosition({ left: Math.max(6, Math.min(x, outer.width - popup.offsetWidth - 8)), top: below + height < outer.height ? below : Math.max(8, y - height - 4), maxHeight: Math.max(80, Math.min(300, outer.height - 16)) });
    };
    place(); textarea.addEventListener('scroll', place);
    const observer = new ResizeObserver(place); observer.observe(textarea);
    return () => { textarea.removeEventListener('scroll', place); observer.disconnect(); };
  }, [assistance, input]);
  useLayoutEffect(() => {
    const list = root.current?.querySelector<HTMLElement>('.text-completion-list');
    const item = list?.querySelector<HTMLElement>('[aria-selected=true]');
    if (!list || !item) return;
    const top = item.offsetTop - list.offsetTop;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + item.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + item.offsetHeight - list.clientHeight;
  }, [selected, assistance.items.length]);
  const field = assistance.signature?.parameters[assistance.parameterIndex ?? 0];
  return <div ref={root} className="text-assistance" style={position ? { ...position, visibility: 'visible' } : { visibility: 'hidden' }} onMouseDown={event => { if (!(event.target as HTMLElement).closest('dialog')) event.preventDefault(); }}>
    {assistance.signature && <div className="text-signature" role="note" aria-label={assistance.syntax === 'heading' ? '目录参数提示' : '指令参数提示'}><strong>{assistance.syntax === 'heading' ? '#' : '@'}{assistance.signature.name}</strong><span>（{assistance.signature.parameters.map((parameter, index) => <button type="button" key={index} className={index === assistance.parameterIndex ? 'active' : ''} title={`填写${parameter.name}`} aria-label={`填写${parameter.name}`} onClick={() => { const edit = assistance.parameterEdits?.[index]; if (edit) onSelect(edit); }}>{parameter.name}</button>)}）</span><small>{field?.detail ?? assistance.signature.detail}</small>
      {assistance.resource && <UiAssetSelect project={project} assetUrl={assetUrl} {...assistance.resource} buttonOnly allowEmpty={assistance.items.some(item => item.id === 'none')} empty="无" label={field?.name ?? '指令素材'} onBrowserOpenChange={open => { if (!open) input.current?.focus({ preventScroll: true }); onBrowseChange?.(open); }} onChange={id => { const asset = project.assets.find(asset => asset.id === id); if (asset) onSelect({ id: asset.id, label: asset.name, detail: '', kind: '资源', insertText: serializeParameterValue(textReference(asset.name, asset.id)) }); else if (!id) onSelect({ id: 'none', label: '无', detail: '', kind: '资源', insertText: '无' }); }} />}
    </div>}
    {assistance.items.length > 0 && <div id="text-completion-list" className="text-completion-list" role="listbox" aria-label="文本补全建议">{groups.map(group => <section key={group}>{group !== '建议' && <button type="button" className="menu-group-toggle" aria-expanded={!!assistance.query || !collapsed.has(group)} onClick={() => onToggleGroup(group)}><ChevronRight size={12} />{group}</button>}{visibleItems.filter(item => (item.group ?? '建议') === group).map(item => { const index = visibleItems.findIndex(candidate => candidate.id === item.id); return <button type="button" role="option" aria-selected={index === selected} id={`text-completion-${index}`} key={item.id} onClick={() => onSelect(item)}>
      {item.assetId ? <img src={assetUrl(item.assetId)} alt="" /> : item.kind === '说话人' || item.kind === '角色' ? <UserRound size={14} /> : <Code2 size={14} />}<span><strong>{item.label}</strong>{item.detail && item.detail !== item.kind && <small>{item.detail}</small>}</span>{!assistance.signature && <em>{item.kind}</em>}
    </button>; })}</section>)}</div>}
    {assistance.items.length > 0 && <div className="text-completion-help">滚轮滚动 · ↑↓ 选择 · Enter / 空格 / Tab 补全 · Esc 收起</div>}
  </div>;
}
