import { useCallback, useMemo, useRef, useState } from 'react';
import type { Project } from '../core/model';
import { mutateProject } from '../core/project-mutation';
import { shareProjectBranches, singleProjectChange } from '../core/project-history';
import { applyUiDraft, uiDraftChanged, type UiDraft } from '../core/ui-draft';

/** UI edits remain a separate, discardable draft until the author saves it. */
export function useUiDraftHistory(project: Project) {
  const [draft, setDraft] = useState<UiDraft>();
  const current = useRef<UiDraft | undefined>(undefined);
  const latestProject = useRef(project); latestProject.current = project;
  const past = useRef<UiDraft[]>([]), future = useRef<UiDraft[]>([]);
  const lastEdit = useRef({ label: '', field: undefined as string | undefined, time: 0 });
  const numeric = useRef<{ before?: UiDraft; past: UiDraft[]; future: UiDraft[]; edited: boolean } | undefined>(undefined);
  const update = useCallback((next?: UiDraft) => {
    if (!next) { past.current = []; future.current = []; numeric.current = undefined; lastEdit.current = { label: '', field: undefined, time: 0 }; }
    current.current = next; setDraft(next);
  }, []);
  const begin = useCallback(() => {
    numeric.current ??= { before: current.current, past: [...past.current], future: [...future.current], edited: false };
  }, []);
  const finish = useCallback((cancel = false) => {
    const gesture = numeric.current; numeric.current = undefined;
    if (!gesture) return;
    lastEdit.current = { label: '', field: undefined, time: 0 };
    const unchanged = !gesture.edited || !uiDraftChanged({ base: applyUiDraft(latestProject.current, gesture.before), value: applyUiDraft(latestProject.current, current.current) });
    if (cancel || unchanged) {
      update(gesture.before); past.current = gesture.past; future.current = gesture.future;
    }
  }, [update]);
  const commit = useCallback((label: string, edit: (draft: Project, before: Project) => void, options?: { separate?: boolean }) => {
    const project = latestProject.current;
    const before = applyUiDraft(project, current.current);
    const next = shareProjectBranches(before, mutateProject(before, edit));
    if (next === before || !uiDraftChanged({ base: before, value: next })) return before;
    const now = Date.now(), field = singleProjectChange(before, next);
    if (options?.separate) finish();
    const gesture = numeric.current;
    // A focused numeric edit or label scrub is one gesture, even across pauses.
    if (gesture ? !gesture.edited : options?.separate || !field || lastEdit.current.field !== field || lastEdit.current.label !== label || now - lastEdit.current.time > 700) {
      past.current.push(current.current ?? { base: project, value: project });
      if (past.current.length > 100) past.current.shift();
    }
    if (gesture) gesture.edited = true;
    future.current = [];
    lastEdit.current = { label: options?.separate ? '' : label, field, time: now };
    update({ base: current.current?.base ?? project, value: next });
    return next;
  }, [update, finish]);
  const undo = useCallback(() => {
    finish();
    const previous = past.current.pop();
    if (!previous) return;
    if (current.current) future.current.push(current.current);
    lastEdit.current = { label: '', field: undefined, time: 0 }; update(previous);
  }, [update, finish]);
  const redo = useCallback(() => {
    finish();
    const next = future.current.pop();
    if (!next) return;
    if (current.current) past.current.push(current.current);
    lastEdit.current = { label: '', field: undefined, time: 0 }; update(next);
  }, [update, finish]);
  const numericEdit = useMemo(() => ({ begin, finish }), [begin, finish]);
  return { draft, current, update, commit, undo, redo, numericEdit, canUndo: past.current.length > 0, canRedo: future.current.length > 0 };
}
