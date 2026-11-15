import { useEffect, useRef } from 'react';
import type { Project } from '../core/model';
import type { StudioBridge } from '../core/bridge';

/** One recovery stream for project edits and the separate, discardable UI draft. */
export function useProjectRecovery({ project, workingProject, projectDirty, uiDirty, ready, busy, saving, bridge, status }: {
  project: Project; workingProject: Project; projectDirty: boolean; uiDirty: boolean;
  ready: boolean; busy: boolean; saving: { current: boolean }; bridge: StudioBridge; status: (message: string) => void;
}) {
  const attempted = useRef<Project | undefined>(undefined);
  useEffect(() => {
    if (!ready || busy || saving.current) return;
    const dirty = projectDirty || uiDirty;
    // After discard/undo, clear the last recovery too. The desktop serializes
    // this behind in-flight writes, so a slow old write cannot resurrect it.
    if (!dirty && attempted.current?.id !== project.id) return;
    let active = true;
    const timer = setTimeout(() => {
      if (saving.current) return;
      attempted.current = project;
      void bridge.autosave(project, { projectDirty, ...(uiDirty ? { uiDraft: workingProject } : {}), clear: !dirty }).then(result => {
        if (!active) return;
        if (!dirty) { attempted.current = undefined; return; }
        if (result.savedAt) status(result.locationMissing ? '工程位置已失效，编辑内容已暂存，请重新定位工程' : '恢复副本已自动保存');
      }).catch(error => { if (active) status(`自动恢复保存失败：${String(error)}`); });
    }, dirty ? 2000 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [project, workingProject, projectDirty, uiDirty, ready, busy, saving, bridge, status]);
  return { recovered: (project: Project) => { attempted.current = project; } };
}
