import { useEffect, useId, useState, type InputHTMLAttributes } from 'react';
import { uiSpineSpeedProblem, uiSpineSpeedRange } from '../core/ui-spine';
import { NumberInput } from './NumberInput';

/** Keep domain rejection outside NumberInput's general min/max clamping.
 * Both inspector fields and blueprint pins retain the last accepted value. */
export function useSpineSpeedInput(value: unknown, onChange: (value: number) => void) {
  const [rejected, setRejected] = useState<string>();
  const errorId = useId();
  useEffect(() => setRejected(undefined), [value]);
  const error = rejected ?? uiSpineSpeedProblem(value);
  const input: InputHTMLAttributes<HTMLInputElement> = {
    type: 'number', value: String(value ?? ''), step: .1,
    title: `支持 ${uiSpineSpeedRange} 倍；超出范围会拒绝，保留原值。`,
    'aria-invalid': !!error, 'aria-describedby': error ? errorId : undefined,
    onChange: event => {
      const next = event.currentTarget.valueAsNumber, problem = uiSpineSpeedProblem(next);
      setRejected(problem);
      if (!problem) onChange(next);
    },
    onInput: event => {
      // NumberInput does not publish non-finite input. Still explain rejection
      // when the browser exposes a complete overflowing exponent.
      if (event.currentTarget.value.trim()) setRejected(uiSpineSpeedProblem(event.currentTarget.valueAsNumber));
    },
    onKeyDown: event => {
      if (event.key === 'Escape') setRejected(undefined);
      if (event.key === 'Enter' && uiSpineSpeedProblem(event.currentTarget.valueAsNumber)) {
        event.preventDefault(); event.stopPropagation();
        setRejected(uiSpineSpeedProblem(event.currentTarget.valueAsNumber));
        event.currentTarget.blur();
      }
    },
  };
  return { input, error, errorId };
}

export function SpineSpeedValueInput({ value, onChange, label }: { value: unknown; onChange: (value: number) => void; label: string }) {
  const speed = useSpineSpeedInput(value, onChange);
  return <div className="blueprint-value-input" data-invalid={!!speed.error || undefined} data-value-unit="倍">
    <NumberInput {...speed.input} aria-label={label} />
    <small className="blueprint-value-unit" title={speed.input.title}>{uiSpineSpeedRange} 倍</small>
    {speed.error && <small id={speed.errorId} className="blueprint-value-error" role="status">{speed.error}</small>}
  </div>;
}
