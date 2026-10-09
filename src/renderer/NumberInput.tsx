import { useContext, useEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { NumericEditContext } from './NumericEditContext';

/** Numeric editing keeps unfinished text local; only finite values reach the
 * project. Bounds belong to domain validation, never to typing or deletion. */
export function NumberInput({ value, onChange, onBlur, onFocus, onKeyDown, type = 'number', min: _min, max: _max, step = 'any', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const numericEdit = useContext(NumericEditContext);
  const numericEditRef = useRef(numericEdit); numericEditRef.current = numericEdit;
  const input = useRef<HTMLInputElement>(null);
  const current = useRef({ value, step, min: _min, max: _max, disabled: props.disabled, readOnly: props.readOnly });
  current.current = { value, step, min: _min, max: _max, disabled: props.disabled, readOnly: props.readOnly };
  const [draft, setDraft] = useState(String(value ?? ''));
  const published = useRef(value);
  useEffect(() => {
    if (String(value ?? '') !== String(published.current ?? '')) setDraft(String(value ?? ''));
    published.current = value;
  }, [value]);
  useEffect(() => {
    const field = input.current, label = field?.closest('label');
    if (type !== 'number' || !field || !label) return;
    label.classList.add('number-drag-label');
    const labelText = label.querySelector<HTMLElement>('.field-label') ?? label;
    const originalTitle = labelText.getAttribute('title');
    if (!originalTitle) labelText.title = '左右拖动调整数值；Shift 精调，Ctrl 加速';
    let drag: { start: number; value: number; x: number; pointerId: number; unit: number } | undefined;
    let dragged = false;
    const publish = (next: number) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, String(Number(next.toFixed(8))));
      field.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const finish = (revert = false) => {
      const previous = drag; drag = undefined;
      label.classList.remove('number-dragging');
      if (previous && label.hasPointerCapture(previous.pointerId)) label.releasePointerCapture(previous.pointerId);
      if (revert && previous) publish(previous.start);
      if (previous) numericEditRef.current?.finish(revert);
    };
    const down = (event: PointerEvent) => {
      const options = current.current;
      if (event.button !== 0 || options.disabled || options.readOnly || (event.target as Element).closest('input,button,select,textarea,a,summary,[role="button"]')) return;
      const start = Number(field.value);
      if (!Number.isFinite(start)) return;
      event.preventDefault(); event.stopPropagation(); dragged = false;
      (document.activeElement as HTMLElement | null)?.blur?.();
      const explicitStep = Number(options.step);
      const unit = Number.isFinite(explicitStep) && explicitStep > 0 ? explicitStep : Math.max(.01, 10 ** (Math.floor(Math.log10(Math.abs(start) || 1)) - 1));
      drag = { start, value: start, x: event.clientX, pointerId: event.pointerId, unit };
      numericEditRef.current?.begin();
      label.setPointerCapture(event.pointerId); label.classList.add('number-dragging');
    };
    const move = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const dx = event.clientX - drag.x; drag.x = event.clientX;
      if (!dx) return;
      dragged = true; event.preventDefault();
      const options = current.current, multiplier = event.shiftKey ? .1 : event.ctrlKey || event.metaKey ? 10 : 1;
      const min = options.min === undefined ? -Infinity : Number(options.min), max = options.max === undefined ? Infinity : Number(options.max);
      drag.value = Math.max(min, Math.min(max, drag.value + dx * drag.unit / 5 * multiplier));
      publish(drag.value);
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId !== drag?.pointerId) return;
      // Browsers can coalesce moves while the inspector rerenders. Include the
      // release position so a fast drag always reaches its final value.
      move(event); finish();
    };
    const lost = () => finish();
    const cancel = () => finish(true);
    const key = (event: KeyboardEvent) => { if (drag && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); } };
    const click = (event: MouseEvent) => { if (dragged) { event.preventDefault(); event.stopPropagation(); dragged = false; } };
    label.addEventListener('pointerdown', down);
    label.addEventListener('pointermove', move);
    label.addEventListener('pointerup', up);
    label.addEventListener('pointercancel', cancel);
    label.addEventListener('lostpointercapture', lost);
    label.addEventListener('click', click, true);
    document.addEventListener('keydown', key, true);
    return () => {
      finish(); label.classList.remove('number-drag-label');
      if (!originalTitle) labelText.removeAttribute('title');
      label.removeEventListener('pointerdown', down); label.removeEventListener('pointermove', move); label.removeEventListener('pointerup', up); label.removeEventListener('pointercancel', cancel); label.removeEventListener('lostpointercapture', lost); label.removeEventListener('click', click, true); document.removeEventListener('keydown', key, true);
    };
  }, [type]);
  if (type !== 'number') return <input {...props} type={type} value={value} onChange={onChange} onBlur={onBlur} onFocus={onFocus} onKeyDown={onKeyDown} />;
  return <input {...props} ref={input} type="number" step={step} value={draft} onFocus={event => { numericEdit?.begin(); onFocus?.(event); }} onKeyDown={event => {
    if (event.key === 'Escape' && numericEdit) { event.preventDefault(); event.stopPropagation(); numericEdit.finish(true); }
    else if (event.key === 'Enter') { numericEdit?.finish(); numericEdit?.begin(); }
    onKeyDown?.(event);
  }} onChange={event => {
    setDraft(event.target.value);
    if (event.target.value.trim() && Number.isFinite(event.target.valueAsNumber)) {
      published.current = event.target.valueAsNumber;
      onChange?.(event);
    }
  }} onBlur={event => {
    // Domain validation may reject or clamp a finite edit without changing the
    // published prop. Reconcile on blur so the field never reports a false value.
    if (!event.target.value.trim() || !Number.isFinite(event.target.valueAsNumber) || event.target.valueAsNumber !== Number(value)) setDraft(String(value ?? ''));
    numericEdit?.finish();
    onBlur?.(event);
  }} />;
}
