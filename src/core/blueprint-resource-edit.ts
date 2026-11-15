import type { Project } from './model';
import { synchronizeBlueprintSignatures } from './blueprint';
import { mutateProject } from './project-mutation';
import { sameProjectValue } from './project-history';
import { applyTextScript, projectToText } from './text-script';
import { patchStageSource } from './stage-edit';

/** Edit a named blueprint without applying or reformatting the author's text draft.
 * Interface changes may deliberately leave calls invalid until the author repairs
 * them. Only synchronized performance arguments need a targeted source patch. */
export function blueprintResourceEditedProject(project: Project, edit: (draft: Project) => void, read: typeof applyTextScript = applyTextScript): Project {
  const next = mutateProject(project, draft => { edit(draft); synchronizeBlueprintSignatures(draft, project); });
  const source = project.scriptText?.content;
  if (source === undefined || next.scriptText?.content !== source || sameProjectValue(project.nodes, next.nodes)) return next;
  const parsed = read(project, source);
  // An independent draft, including a valid but unapplied edit, belongs to the
  // text editor. Do not replace its commands with the last visual snapshot.
  if (parsed.issues.some(issue => issue.severity === 'error') || projectToText(parsed.project) !== projectToText(project)) return next;
  const patched = patchStageSource(project, next, source, parsed.sourceMap, parsed.nodeLocations);
  return patched === source ? next : { ...next, scriptText: { ...next.scriptText, content: patched } };
}
