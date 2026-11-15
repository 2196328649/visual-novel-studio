import { useEffect, useState } from 'react';

/** Permit normal temporary input states, commit one valid name on blur/Enter. */
export function ParameterNameInput({ value, label, problem, onCommit }: {
  value: string; label: string; problem: (value: string) => string | undefined; onCommit: (value: string) => void;
}) {
  const [text, setText] = useState(value), [error, setError] = useState<string>();
  useEffect(() => { setText(value); setError(undefined); }, [value]);
  const commit = () => {
    if (text === value) return;
    const invalid = problem(text);
    if (invalid) { setError(invalid); return; }
    try { onCommit(text.trim()); setText(text.trim()); setError(undefined); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
  };
  return <span className="parameter-name-input"><input aria-label={label} aria-invalid={!!error} value={text} maxLength={120}
    onChange={event => { setText(event.target.value); setError(problem(event.target.value)); }} onBlur={commit}
    onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === 'Enter') { event.preventDefault(); commit(); }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setText(value); setError(undefined); }
    }} />{error && <small role="alert">{error}</small>}</span>;
}
