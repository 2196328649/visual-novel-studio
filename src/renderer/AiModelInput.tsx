import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

/** The same value can be typed or selected; unavailable model lists never block manual entry. */
export function AiModelInput({ value, models, onChange, disabled }: {
  value: string; models: string[]; onChange: (value: string) => void; disabled?: boolean;
}) {
  const id = useId(), root = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false), [filter, setFilter] = useState(''), [active, setActive] = useState(0);
  const filtered = models.filter(model => model.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  const options = filtered.slice(0, 100);
  useEffect(() => { if (disabled || !models.length) setOpen(false); }, [disabled, models.length]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [open]);
  useEffect(() => {
    if (open) root.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);
  const choose = (model: string) => { onChange(model); setOpen(false); setFilter(''); input.current?.focus(); };
  return <div ref={root} className="ai-model-input" onBlur={event => {
    if (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
  }}>
    <div className="ai-model-entry">
      <input ref={input} aria-label="AI 模型名称" role="combobox" aria-autocomplete="list" aria-expanded={open}
        aria-controls={id} aria-activedescendant={open && options[active] ? `${id}-${active}` : undefined}
        value={value} disabled={disabled} autoComplete="off" spellCheck={false} placeholder="输入模型名称，或获取后选择"
        onChange={event => { onChange(event.target.value); setFilter(event.target.value); setActive(0); setOpen(models.length > 0); }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!open) { setFilter(''); setActive(0); setOpen(models.length > 0); }
            else setActive(index => Math.max(0, Math.min(options.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));
          } else if (event.key === 'Enter' && open && options[active]) { event.preventDefault(); choose(options[active]); }
          else if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
        }} />
      <button type="button" className="icon-button" aria-label="选择可用模型" title={models.length ? `${models.length} 个可用模型` : '先获取模型列表，也可直接输入'}
        aria-expanded={open} aria-controls={id} disabled={disabled || !models.length}
        onClick={() => { const selected = models.indexOf(value); setFilter(''); setActive(selected >= 0 && selected < 100 ? selected : 0); setOpen(!open); input.current?.focus(); }}><ChevronDown size={15} /></button>
    </div>
    {open && <div className="ai-model-options">
      <div id={id} role="listbox" aria-label="可用模型">
        {options.map((model, index) => <div key={model} id={`${id}-${index}`} role="option" aria-selected={active === index}
          onPointerDown={event => event.preventDefault()} onClick={() => choose(model)} onPointerMove={() => setActive(index)}>
          <span>{model}</span>{model === value && <Check size={14} aria-hidden="true" />}
        </div>)}
      </div>
      {!options.length && <p>没有匹配项，可以直接使用输入的模型名称。</p>}
      {filtered.length > options.length && <p>显示前 100 项，输入名称可继续筛选。</p>}
    </div>}
  </div>;
}
