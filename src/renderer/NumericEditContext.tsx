import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Project } from '../core/model';
import { shareProjectBranches } from '../core/project-history';
import type { Commit } from './editor';

export const NumericEditContext = createContext<{ begin: () => void; finish: (cancel?: boolean) => void } | undefined>(undefined);

/** Keep numeric gestures in the preview; serialize and record one undo step at
 * the end. Unchanged project branches retain the preview reader's caches. */
export function useLiveParameterEdit(project: Project, commit?: Commit) {
  const [preview, setPreview] = useState<{ base: Project; value: Project }>();
  const session = useRef<{ base: Project; value: Project; label: string; edits: ((project: Project) => void)[] } | undefined>(undefined);
  const latest = useRef({ project, commit }); latest.current = { project, commit };
  const begin = useCallback(() => {
    if (!latest.current.commit || session.current) return;
    const base = latest.current.project;
    session.current = { base, value: base, label: '', edits: [] };
  }, []);
  const finish = useCallback((cancel = false) => {
    const current = session.current; session.current = undefined;
    if (!current) return;
    if (!cancel && current.edits.length && current.base === latest.current.project) {
      latest.current.commit?.(current.label, draft => { for (const edit of current.edits) edit(draft); }, { separate: true });
    }
    setPreview(undefined);
  }, []);
  const edit: Commit = useCallback((label, change, options) => {
    const current = session.current;
    if (!current || current.base !== latest.current.project) { latest.current.commit?.(label, change, options); return; }
    const draft = structuredClone(current.value); change(draft);
    const next = shareProjectBranches(current.value, draft);
    if (next === current.value) return;
    current.value = next; current.label = label; current.edits.push(change);
    setPreview({ base: current.base, value: next });
  }, []);
  useEffect(() => { if (session.current && session.current.base !== project) finish(true); }, [project, finish]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!session.current) return;
      if ((event.ctrlKey || event.metaKey) && ['s', 'z', 'y'].includes(event.key.toLowerCase())) finish();
    };
    const blur = () => finish();
    document.addEventListener('keydown', key, true); window.addEventListener('blur', blur);
    return () => { document.removeEventListener('keydown', key, true); window.removeEventListener('blur', blur); session.current = undefined; };
  }, [finish]);
  return { project: preview?.base === project ? preview.value : project, commit: commit ? edit : undefined, controls: useMemo(() => commit ? { begin, finish } : undefined, [!!commit, begin, finish]) };
}
