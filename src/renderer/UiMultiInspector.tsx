import { useCallback, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { Eye, RotateCcw, Type, X } from 'lucide-react';
import type { Project, VariableValue } from '../core/model';
import { applyUiMultiEdit, planUiMultiEdit, readUiMultiSelection, uiMultiProperties, type UiMultiEdit, type UiMultiEditScope, type UiMultiField, type UiMultiProperty } from '../core/ui-multi-edit';
import type { Commit } from './editor';
import type { AssetUrl } from './StageEditor';
import { UiAssetSelect } from './AssetPicker';
import { Field } from './components';
import { NumberInput } from './NumberInput';
import { NumericEditContext, type NumericEditControls } from './NumericEditContext';
import { UiInspectorProvider } from './UiInspectorContext';
import { UiPropertyGroup } from './UiPropertyGroup';
import './ui-inspector.css';
import './ui-multi-inspector.css';

type Pending = Partial<Record<UiMultiProperty, UiMultiEdit>>;
interface MenuRequest { field: UiMultiField; x: number; y: number; returnFocus: HTMLElement }
const labels: Record<UiMultiProperty, string> = { opacity: '不透明度 %', font: '字体', fontSize: '字号', textColor: '文字颜色' };

function valueLabel(project: Project, property: UiMultiProperty, value: VariableValue): string {
  if (property === 'font') return value ? project.assets.find(asset => asset.id === value && asset.kind === 'font')?.name ?? '字体素材已丢失' : '默认字体';
  if (property === 'opacity') return `${Number((Number(value) * 100).toFixed(4))}%`;
  return String(value) + (property === 'fontSize' ? ' px' : '');
}

/** Selection identity owns unfinished fields, so a late picker result cannot edit a new selection. */
export function UiMultiInspector(props: { project: Project; scope: UiMultiEditScope; selectedIds: readonly string[]; commit: Commit; assetUrl: AssetUrl; disabled?: boolean; onSelect?: (id: string) => void }) {
  const key = JSON.stringify([props.scope.projectId, props.scope.page, props.scope.ownerId, props.selectedIds]);
  return <MultiInspectorFields key={key} {...props} />;
}

function MultiInspectorFields({ project, scope, selectedIds, commit, assetUrl, disabled = false, onSelect }: Parameters<typeof UiMultiInspector>[0]) {
  const selection = useMemo(() => readUiMultiSelection(project, scope, selectedIds), [project, scope.projectId, scope.page, scope.ownerId, selectedIds]);
  const [pending, setPending] = useState<Pending>({});
  const pendingRef = useRef(pending);
  const numericBefore = useRef(new Map<UiMultiProperty, UiMultiEdit | undefined>());
  const [fieldVersions, setFieldVersions] = useState<Partial<Record<UiMultiProperty, number>>>({});
  const [notice, setNotice] = useState('');
  const [menu, setMenu] = useState<MenuRequest>();
  const menuRef = useRef(menu); menuRef.current = menu;
  const [openSources, setOpenSources] = useState<Partial<Record<UiMultiProperty, boolean>>>({});
  const detailNodes = useRef(new Map<UiMultiProperty, HTMLDetailsElement>());
  const live = useRef(true), latest = useRef({ disabled, project, scope, selectedIds });
  latest.current = { disabled, project, scope, selectedIds };
  useLayoutEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const updatePending = useCallback((change: (previous: Pending) => Pending) => {
    const next = change(pendingRef.current); pendingRef.current = next; setPending(next);
  }, []);
  const numericControls = useMemo(() => Object.fromEntries(uiMultiProperties.map(property => [property, {
    begin: () => {
      if (live.current && !latest.current.disabled && !numericBefore.current.has(property)) numericBefore.current.set(property, pendingRef.current[property]);
    },
    finish: (cancel = false) => {
      if (!numericBefore.current.has(property)) return;
      const before = numericBefore.current.get(property); numericBefore.current.delete(property);
      if (!cancel || !live.current) return;
      updatePending(previous => {
        const next = { ...previous };
        if (before) next[property] = before; else delete next[property];
        return next;
      });
    },
  }])) as Record<UiMultiProperty, NumericEditControls>, [updatePending]);
  const edits = uiMultiProperties.flatMap(property => pending[property] ? [pending[property]!] : []);
  const plan = useMemo(() => planUiMultiEdit(project, scope, selectedIds, edits), [project, scope.projectId, scope.page, scope.ownerId, selectedIds, pending]);
  const editable = !disabled && !selection.problems.length;
  const stage = (edit: UiMultiEdit) => {
    if (!live.current || latest.current.disabled) return;
    const field = readUiMultiSelection(latest.current.project, latest.current.scope, latest.current.selectedIds).fields.find(field => field.property === edit.property);
    if (!field || field.problems.length) return;
    if (edit.mode === 'reset') setFieldVersions(previous => ({ ...previous, [edit.property]: (previous[edit.property] ?? 0) + 1 }));
    updatePending(previous => ({ ...previous, [edit.property]: edit })); setNotice('');
  };
  const discard = (property: UiMultiProperty) => {
    numericBefore.current.delete(property);
    updatePending(previous => { const next = { ...previous }; delete next[property]; return next; }); setNotice('');
    setFieldVersions(previous => ({ ...previous, [property]: (previous[property] ?? 0) + 1 }));
  };
  const clearPending = () => {
    numericBefore.current.clear(); updatePending(() => ({}));
    setFieldVersions(previous => Object.fromEntries(uiMultiProperties.map(property => [property, (previous[property] ?? 0) + 1])));
  };
  const apply = () => {
    if (!live.current || latest.current.disabled || !edits.length) return;
    try {
      const prepared = planUiMultiEdit(latest.current.project, latest.current.scope, latest.current.selectedIds, edits);
      if (prepared.problems.length) throw new Error(prepared.problems.map(problem => problem.message).join('\n'));
      if (!prepared.changedIds.length) { clearPending(); setNotice('这些属性已是所填的值。'); return; }
      let changed = 0;
      commit('批量修改界面共同属性', draft => {
        if (!live.current || latest.current.disabled) return;
        changed = applyUiMultiEdit(draft, scope, selectedIds, edits).length;
      }, { separate: true });
      if (changed) { clearPending(); setNotice(`已修改 ${changed} 个控件，可一次撤销。`); }
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  };
  const closeMenu = useCallback((restore = false) => {
    const focus = menuRef.current?.returnFocus;
    const fallback = focus?.closest<HTMLElement>('[data-ui-multi-field]');
    setMenu(undefined);
    if (restore) requestAnimationFrame(() => {
      if (!live.current) return;
      // Restoring a design default remounts the value editor. Its stable field
      // remains a focus target even after the originating input disappears.
      const target = focus?.isConnected && !focus.matches(':disabled') ? focus : fallback?.isConnected ? fallback : undefined;
      target?.focus({ preventScroll: true });
    });
  }, []);
  const openMenu = (event: MouseEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>, field: UiMultiField) => {
    if (!(event.target instanceof HTMLElement) || !event.currentTarget.contains(event.target)
      || event.target.closest('[data-ui-multi-field]') !== event.currentTarget
      || event.target.closest('button,summary,.ui-multi-sources,.field-help')) return;
    event.preventDefault(); event.stopPropagation();
    const bounds = event.target.getBoundingClientRect();
    setMenu({ field, x: 'clientX' in event ? event.clientX : bounds.left, y: 'clientY' in event ? event.clientY : bounds.bottom,
      returnFocus: event.target.closest<HTMLElement>('input,select,[tabindex]') ?? event.currentTarget });
  };
  const showDetails = (property: UiMultiProperty) => {
    closeMenu(); const node = detailNodes.current.get(property);
    if (node) { node.open = true; node.scrollIntoView({ block: 'nearest' }); node.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true }); }
  };
  const fieldEditor = (field: UiMultiField) => {
    const { property } = field, edit = pending[property];
    const stagedReset = edit?.mode === 'reset';
    const mixed = !edit && field.mixed;
    const value = edit?.mode === 'set' ? edit.value : stagedReset ? undefined : field.value;
    const blocked = !editable || !!field.problems.length;
    return <div key={property} className="ui-multi-field" data-ui-multi-field={property} data-mixed={mixed || undefined} data-pending={!!edit || undefined} tabIndex={-1}
      onContextMenu={event => openMenu(event, field)} onKeyDown={event => { if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') openMenu(event, field); }}>
      <fieldset className="ui-multi-field-input" disabled={blocked}>
        <div className="ui-multi-field-row">
          {property === 'font' ? <Field label="字体"><UiAssetSelect key={fieldVersions[property] ?? 0} project={project} assetUrl={assetUrl} kind="font" label="共同字体" allowEmpty={false}
            value={typeof value === 'string' ? value : undefined} empty={stagedReset ? '待恢复页面默认' : mixed ? '多个值' : '沿用页面字体'}
            onChange={value => { if (value) stage({ property, mode: 'set', value }); }} /></Field>
            : property === 'textColor' ? <Field label="文字颜色"><MultiColorInput key={fieldVersions[property] ?? 0} value={typeof value === 'string' ? value : undefined}
              mixed={mixed} placeholder={stagedReset ? '待恢复页面默认' : mixed ? '多个值' : '#RRGGBB 或 #RRGGBBAA'} disabled={blocked}
              onChange={value => stage({ property, mode: 'set', value })} /></Field>
              : <NumericEditContext.Provider value={numericControls[property]}><Field label={labels[property]} hint={property === 'opacity' ? '每个选中对象各设此值；父子同时选中时，显示效果仍按原有规则叠加。' : '修改保存的字号；实际显示仍遵守控件原有的高度与最小字号规则。'}>
                <NumberInput key={fieldVersions[property] ?? 0} aria-label={`共同${labels[property]}`} min={property === 'opacity' ? 0 : 1}
                  max={property === 'opacity' ? 100 : undefined} step={1} disabled={blocked}
                  value={typeof value === 'number' ? Number((value * (property === 'opacity' ? 100 : 1)).toFixed(8)) : ''}
                  placeholder={stagedReset ? '待恢复默认' : mixed ? '多个值' : ''}
                  onChange={event => stage({ property, mode: 'set', value: property === 'opacity' ? Number(event.target.value) / 100 : Math.round(Number(event.target.value)) })} />
              </Field></NumericEditContext.Provider>}
          <button type="button" className="ui-design-reset" disabled={blocked || stagedReset || !field.canReset && !edit}
            title={`恢复各自${property === 'opacity' ? '不透明度默认值（100%）' : '页面默认' + labels[property]}；只清除此设计字段，保留其他属性与参数关联。`}
            aria-label={`恢复共同${labels[property]}设计默认值`} onClick={() => stage({ property, mode: 'reset' })}><RotateCcw size={13} aria-hidden="true" /></button>
        </div>
      </fieldset>
      {edit && <div className="ui-multi-pending"><span>{stagedReset ? '待应用：恢复各自设计默认值' : '待应用到全部所选控件'}</span><button type="button" className="text-button" disabled={disabled} aria-label={`取消共同${labels[property]}待改值`} onClick={() => discard(property)}><X size={12} aria-hidden="true" />取消</button></div>}
      <details className="ui-multi-sources" ref={node => { if (node) detailNodes.current.set(property, node); else detailNodes.current.delete(property); }}
        onToggle={event => { const open = event.currentTarget.open; setOpenSources(previous => previous[property] === open ? previous : { ...previous, [property]: open }); }}>
        <summary aria-label={`查看共同${labels[property]}来源`}>{field.mixedSources ? '来源不同' : field.targets[0]?.source} · 查看各对象</summary>
        {openSources[property] && field.targets.map(target => <div key={target.id} className="ui-multi-source-row" data-ui-multi-source={target.id}>
          <div><strong>{target.name}</strong><span>{valueLabel(project, property, target.value)}</span></div>
          <small>{target.source}</small>{target.problem && <p>{target.problem}</p>}
          {target.problem && onSelect && <button type="button" className="text-button" disabled={disabled} onClick={() => onSelect(target.id)}>单独查看此控件</button>}
        </div>)}
      </details>
      {!!field.problems.length && <p className="ui-multi-restriction" role="note">{field.problems.length} 个控件限制了此项批量修改。展开来源查看原因。</p>}
    </div>;
  };
  const opacity = selection.fields.find(field => field.property === 'opacity'), text = selection.fields.filter(field => field.property !== 'opacity');
  return <NumericEditContext.Provider value={undefined}><aside className="inspector ui-inspector-shell ui-multi-inspector-shell" aria-label="共同属性编辑">
    <div className="inspector-scroll"><UiInspectorProvider taskKey={JSON.stringify([scope.projectId, scope.page, scope.ownerId, 'multi'])}>
      <div className="ui-inspector ui-multi-inspector" data-ui-multi-count={selection.ids.length}>
        <header className="ui-multi-header"><strong>共同属性</strong><span>已选 {selection.ids.length} 个控件</span></header>
        <p className="ui-inspector-source">只修改填写的项目。填写后统一应用，可一次撤销。</p>
        {!!selection.inheritedCount && <p className="ui-multi-inherited">含 {selection.inheritedCount} 个继承控件；改动会在当前方案建立整控件副本。</p>}
        {selection.problems.map((problem, index) => <p key={index} className="ui-multi-restriction" role="alert">{problem.message}</p>)}
        <section className="ui-inspector-region" data-ui-inspector-region="common" aria-label="通用属性">
          <h3 className="ui-inspector-region-title">通用属性 <span>作用于每个所选控件</span></h3>
          {opacity && <UiPropertyGroup id="multi-visibility" title="显示" icon={<Eye size={15} />} defaultOpen>{fieldEditor(opacity)}</UiPropertyGroup>}
        </section>
        <section className="ui-inspector-region" data-ui-inspector-region="function" aria-label="共同文字功能">
          <h3 className="ui-inspector-region-title">共同功能 <span>文字</span></h3>
          {text.length ? <UiPropertyGroup id="multi-text" title="文字外观" icon={<Type size={15} />} defaultOpen>{text.map(fieldEditor)}</UiPropertyGroup>
            : <p className="ui-inspector-source">共同字体、字号和颜色适用于文字与显示文字的按钮。列表条目及其他控件请单独编辑。</p>}
        </section>
        <div className="ui-multi-apply">
          {edits.length > 0 && plan.problems.map((problem, index) => <p key={index} className="ui-multi-restriction" role="alert">{problem.message}</p>)}
          <button type="button" disabled={!editable || !edits.length || !!plan.problems.length} onClick={apply}>应用到 {selection.ids.length} 个控件</button>
          <button type="button" className="text-button" disabled={disabled || !edits.length} onClick={() => { clearPending(); setNotice(''); }}>取消待改值</button>
          {notice && <p className="ui-inspector-notice" role="status">{notice}</p>}
        </div>
        {menu && <MultiPropertyMenu request={menu} close={closeMenu} details={() => showDetails(menu.field.property)}
          canReset={editable && !menu.field.problems.length && (menu.field.canReset || !!pending[menu.field.property])}
          reset={() => { stage({ property: menu.field.property, mode: 'reset' }); closeMenu(true); }} />}
      </div>
    </UiInspectorProvider></div>
  </aside></NumericEditContext.Provider>;
}

function MultiColorInput({ value, mixed, placeholder, disabled, onChange }: { value?: string; mixed: boolean; placeholder: string; disabled: boolean; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value ?? '');
  const previous = useRef(value);
  useLayoutEffect(() => { if (previous.current !== value) { previous.current = value; setDraft(value ?? ''); } }, [value]);
  const valid = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(draft);
  const chosen = value && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value) ? value : '#ffffff';
  return <span className="ui-multi-color">
    <span className={`ui-multi-swatch${mixed ? ' is-mixed' : ''}`}><input type="color" aria-label="共同文字颜色色块" value={chosen.slice(0, 7)} disabled={disabled}
      onChange={event => { const next = event.target.value + (chosen.length === 9 ? chosen.slice(7) : ''); setDraft(next); onChange(next); }} /></span>
    <input type="text" aria-label="共同文字颜色" value={draft} spellCheck={false} maxLength={9} placeholder={placeholder} disabled={disabled} aria-invalid={!!draft && !valid}
      onChange={event => { const next = event.target.value; setDraft(next); if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(next)) onChange(next.toLowerCase()); }}
      onBlur={() => { if (!valid) setDraft(value ?? ''); }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDraft(value ?? ''); } }} />
  </span>;
}

function MultiPropertyMenu({ request, close, details, reset, canReset }: { request: MenuRequest; close: (restore?: boolean) => void; details: () => void; reset: () => void; canReset: boolean }) {
  const node = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = node.current; if (!element) return;
    const positions = new Map<Element, { left: number; top: number }>();
    for (let parent: HTMLElement | null = request.returnFocus; parent; parent = parent.parentElement) positions.set(parent, { left: parent.scrollLeft, top: parent.scrollTop });
    const bounds = element.getBoundingClientRect();
    element.style.left = Math.max(8, Math.min(request.x, innerWidth - bounds.width - 8)) + 'px';
    element.style.top = Math.max(8, Math.min(request.y, innerHeight - bounds.height - 8)) + 'px';
    element.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !element.contains(event.target)) close(); };
    const scroll = (event: Event) => { if (event.target instanceof Element) { const origin = positions.get(event.target); if (origin && (origin.left !== event.target.scrollLeft || origin.top !== event.target.scrollTop)) close(); } };
    const dismiss = () => close();
    document.addEventListener('pointerdown', outside, true); document.addEventListener('scroll', scroll, true); window.addEventListener('resize', dismiss); window.addEventListener('blur', dismiss);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', dismiss); window.removeEventListener('blur', dismiss); };
  }, [request, close]);
  return createPortal(<div ref={node} className="ui-property-control-menu ui-multi-menu" role="menu" aria-label="共同属性菜单" style={{ left: request.x, top: request.y }}
    onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }} onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); close(true); return; }
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')], index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length]?.focus();
    }}>
    <span className="ui-property-control-menu-title">共同{labels[request.field.property]}</span>
    <button type="button" role="menuitem" onClick={details}>查看各对象来源</button>
    <button type="button" role="menuitem" disabled={!canReset} onClick={reset}>恢复各自设计默认值…</button>
    <small>恢复只清除此设计字段；填写后统一应用。关联参数需单独调整。</small>
  </div>, document.body);
}
